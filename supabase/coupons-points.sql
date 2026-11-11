-- =========================================================
-- 쿠폰 · 후기 이벤트 (회원 전용 · 홈페이지 주문에서만 사용)
--   · 포인트: 지금은 꺼 둠 (적립률 0 · 사용 불가). 표와 처리 로직은 나중을 위해 남겨 둠
--   · 쿠폰은 골드바·실버바·카드형 골드바에는 못 씀
--   · 후기 이벤트: 회원이 후기를 쓰면 쿠폰 자동 지급 (금액·최소 주문·유효기간은 관리자 > 시세 설정)
--   · 후기는 주문 1건당 1개 · 쓴 후기는 본인이 고칠 수 있음
--   · 주문이 취소되면 쓴 쿠폰·포인트는 돌려주고, 적립한 포인트는 회수
--   reviews-restock.sql 실행 뒤에 실행하세요. 여러 번 실행해도 안전합니다.
-- =========================================================

-- 1) 설정 (관리자 > 시세 설정에서 수정)
alter table public.shop_info add column if not exists point_rate   numeric not null default 0.5 check (point_rate between 0 and 10);
alter table public.shop_info add column if not exists review_event boolean not null default true;
alter table public.shop_info add column if not exists review_coupon int not null default 10000 check (review_coupon >= 0);
alter table public.shop_info add column if not exists coupon_min   int not null default 200000 check (coupon_min >= 0);
alter table public.shop_info add column if not exists coupon_days  int not null default 90 check (coupon_days between 1 and 3650); -- (예전 칸 · 안 씀)
alter table public.shop_info add column if not exists coupon_months int not null default 3 check (coupon_months between 1 and 36); -- 쿠폰 유효기간: 받은 날부터 N개월

-- 2) 쿠폰 · 포인트 내역
create table if not exists public.coupons (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  amount     int  not null check (amount > 0),
  min_order  int  not null default 0 check (min_order >= 0),
  expires_at timestamptz not null,
  used_at    timestamptz,
  order_id   bigint references public.orders on delete set null,
  source     text,                         -- review:후기번호 / admin
  created_at timestamptz not null default now()
);
create index if not exists coupons_user_idx on public.coupons (user_id, used_at, expires_at);
create unique index if not exists coupons_source_once on public.coupons (source) where source like 'review:%';
alter table public.coupons enable row level security;
drop policy if exists "coupons_own_read" on public.coupons;
create policy "coupons_own_read" on public.coupons for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "coupons_admin_write" on public.coupons;
create policy "coupons_admin_write" on public.coupons for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.point_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  amount     int  not null check (amount <> 0),  -- + 적립 / - 사용·회수
  reason     text not null,
  order_id   bigint references public.orders on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists point_logs_user_idx on public.point_logs (user_id, created_at desc);
alter table public.point_logs enable row level security;
drop policy if exists "points_own_read" on public.point_logs;
create policy "points_own_read" on public.point_logs for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "points_admin_write" on public.point_logs;
create policy "points_admin_write" on public.point_logs for insert with check (public.is_admin());

create or replace function public.point_balance(p_uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from public.point_logs where user_id = p_uid;
$$;
revoke all on function public.point_balance(uuid) from public, anon, authenticated;

-- ★ 포인트 기능은 일단 쓰지 않음 (2026-11-11): 적립률 0 → 입금 확인 때 적립 안 됨, 주문에서 포인트 사용 불가
--   표(point_logs)와 칸은 나중에 다시 켤 수 있게 남겨 둠
alter table public.shop_info alter column point_rate set default 0;
update public.shop_info set point_rate = 0 where id = 1;
drop function if exists public.expire_points(uuid);
drop function if exists public.point_expired_due(uuid, timestamptz);

-- 주문에 쓴 쿠폰 · 포인트
alter table public.orders add column if not exists coupon_id       bigint references public.coupons on delete set null;
alter table public.orders add column if not exists coupon_discount int not null default 0;
alter table public.orders add column if not exists points_used     int not null default 0;
alter table public.orders add column if not exists points_earned   int not null default 0;

-- 3) 내 쿠폰 (회원 화면 · 주문 창)
drop function if exists public.my_benefits();
create function public.my_benefits()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'coupons', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'amount', c.amount, 'min_order', c.min_order, 'expires_at', c.expires_at) order by c.expires_at)
                          from public.coupons c where c.user_id = auth.uid() and c.used_at is null and c.expires_at > now()), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.my_benefits() from public, anon;
grant execute on function public.my_benefits() to authenticated;

-- 4) 쿠폰 · 포인트 확인 → 할인 금액
--    p_goods: 택배비 뺀 상품 금액 / p_cgoods: 그중 쿠폰을 쓸 수 있는 금액 (골드바·실버바·카드형 골드바 제외)
drop function if exists public.bnf_check(bigint, int, numeric);
create or replace function public.bnf_check(p_coupon bigint, p_points int, p_goods numeric, p_cgoods numeric default null, out cdisc int, out pts int)
language plpgsql security definer set search_path = public as $$
declare cp public.coupons; bal int; cg numeric := coalesce(p_cgoods, p_goods);
begin
  cdisc := 0; pts := greatest(coalesce(p_points, 0), 0);
  if p_coupon is null and pts = 0 then return; end if;
  if pts > 0 then raise exception '포인트는 지금 사용할 수 없어요'; end if; -- 포인트 기능 중지
  if auth.uid() is null then raise exception '쿠폰·포인트는 로그인한 회원만 쓸 수 있어요'; end if;
  if p_goods is null then raise exception '금액이 확정되지 않아 쿠폰·포인트를 쓸 수 없어요. 잠시 후 다시 시도해 주세요'; end if;
  perform pg_advisory_xact_lock(hashtext('bnf:' || auth.uid()::text)); -- 같은 회원 동시 주문 막기
  if p_coupon is not null then
    select * into cp from public.coupons where id = p_coupon and user_id = auth.uid() for update;
    if cp.id is null or cp.used_at is not null then raise exception '이미 사용했거나 없는 쿠폰이에요'; end if;
    if cp.expires_at <= now() then raise exception '기간이 지난 쿠폰이에요'; end if;
    if cg <= 0 then raise exception '쿠폰은 골드바·실버바에는 쓸 수 없어요'; end if;
    if cg < cp.min_order then raise exception '이 쿠폰은 골드바·실버바를 뺀 상품 금액이 %원 이상일 때 쓸 수 있어요', public.fmt_won(cp.min_order); end if;
    cdisc := least(cp.amount, floor(cg)::int);
  end if;
  if pts > 0 then
    bal := public.point_balance(auth.uid());
    if pts > bal then raise exception '포인트가 부족해요 (보유 %P)', public.fmt_won(bal); end if;
    pts := least(pts, greatest(floor(p_goods)::int - cdisc, 0));
  end if;
end $$;
revoke all on function public.bnf_check(bigint, int, numeric, numeric) from public, anon, authenticated;

-- 주문 저장 뒤: 쿠폰 사용 처리 · 포인트 차감
create or replace function public.bnf_commit(p_order bigint, p_coupon bigint, p_cdisc int, p_pts int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_coupon is not null and p_cdisc > 0 then
    update public.coupons set used_at = now(), order_id = p_order where id = p_coupon;
  end if;
  if p_pts > 0 then
    insert into public.point_logs (user_id, amount, reason, order_id) values (auth.uid(), -p_pts, '주문에 사용', p_order);
  end if;
end $$;
revoke all on function public.bnf_commit(bigint, bigint, int, int) from public, anon, authenticated;

-- 주문 상품 목록 끝에 할인 줄 추가 (메일·주문내역에 그대로 보임 · product_id 없음)
create or replace function public.bnf_lines(p_lines jsonb, p_cdisc int, p_pts int)
returns jsonb language sql immutable as $$
  select p_lines
    || case when p_cdisc > 0 then jsonb_build_array(jsonb_build_object('name', '쿠폰 할인', 'qty', 1, 'unit', -p_cdisc, 'subtotal', -p_cdisc, 'discount', true)) else '[]'::jsonb end
    || case when p_pts   > 0 then jsonb_build_array(jsonb_build_object('name', '포인트 사용', 'qty', 1, 'unit', -p_pts, 'subtotal', -p_pts, 'discount', true)) else '[]'::jsonb end;
$$;

-- 5) 구매 신청 (상품 1개) — size-weight.sql 버전 + 쿠폰·포인트
drop function if exists public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb, text, boolean);
drop function if exists public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb, text, boolean, bigint, int);
create function public.submit_order(
  p_product_id uuid, p_qty int, p_name text, p_phone text,
  p_receive text, p_address text, p_note text, p_quoted numeric, p_receipt jsonb default null,
  p_size text default null, p_addon boolean default false,
  p_coupon bigint default null, p_points int default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.products; sp public.products; si public.shop_info; rc jsonb; oc record; b record;
  c text; ph text := public.clean_phone(p_phone); pname text; oid bigint; lines jsonb := null;
  unit numeric; total numeric; fee numeric := 0; dl timestamptz; kst text; disc int := 0;
begin
  select * into pr from public.products where id = p_product_id and visible;
  if not found then raise exception '상품을 찾을 수 없습니다'; end if;
  if pr.sold_out then raise exception '품절된 상품입니다'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception '이름을 확인해 주세요'; end if;
  if char_length(ph) not between 9 and 12 then raise exception '연락처를 확인해 주세요'; end if;
  if coalesce(p_qty, 0) not between 1 and 99 then raise exception '수량을 확인해 주세요'; end if;
  if p_receive not in ('visit', 'delivery') then raise exception '수령 방법을 확인해 주세요'; end if;
  if p_receive = 'delivery' and char_length(trim(coalesce(p_address, ''))) < 5 then raise exception '배송 주소를 입력해 주세요'; end if;
  rc := public.norm_receipt(coalesce(p_receipt, '{}'::jsonb), ph);
  select * into oc from public.opt_check(pr, p_size, p_addon);
  sp := public.size_scaled(pr, p_size);
  if sp.weight_g <> pr.weight_g then oc.label := oc.label || ' · ' || public.fmt_g(sp.weight_g) || 'g'; end if;
  perform public.check_spam('orders', ph);

  select * into si from public.shop_info where id = 1;
  c := public.new_code('O');
  pname := case when pr.kind = 'zodiac' then 'GBK 카드형 골드바 1g (' || pr.name || ')' else pr.name end
        || case when oc.label <> '' then ' (' || oc.label || ')' else '' end;
  unit := public.quote_price(sp) + oc.extra;
  select * into b from public.bnf_check(p_coupon, p_points, unit * p_qty,
    case when pr.kind in ('bar', 'silver', 'zodiac') then 0 else unit * p_qty end);
  disc := b.cdisc + b.pts;
  if p_receive = 'delivery' then fee := coalesce(si.delivery_fee, 0); end if;
  if unit is not null then
    total := unit * p_qty - disc + fee;
    dl := now() + make_interval(mins => si.pay_minutes);
  end if;
  if disc > 0 then
    lines := public.bnf_lines(jsonb_build_array(jsonb_build_object('product_id', pr.id, 'name', pname, 'qty', p_qty, 'unit', unit, 'subtotal', unit * p_qty)), b.cdisc, b.pts);
  end if;

  insert into public.orders (code, user_id, product_id, product_name, qty, items, quoted_price, final_price,
                             price_locked_at, pay_deadline, shipping_fee, status, name, phone, receive, address, note, receipt,
                             coupon_id, coupon_discount, points_used)
  values (c, auth.uid(), pr.id, pname, p_qty, lines, total, total,
          case when total is not null then now() end, dl, fee,
          case when total is not null then 'confirmed' else 'new' end,
          trim(p_name), ph, p_receive,
          left(nullif(trim(p_address), ''), 200), left(nullif(trim(p_note), ''), 500), rc,
          case when b.cdisc > 0 then p_coupon end, b.cdisc, b.pts)
  returning id into oid;
  perform public.bnf_commit(oid, p_coupon, b.cdisc, b.pts);

  kst := to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI');
  if total is not null then
    perform public.send_sms(ph, format(E'[금비 GOLD] 주문 확정\n접수번호 %s\n%s × %s\n확정일시 %s\n입금액 %s원%s%s\n계좌 %s %s (예금주 %s)\n%s까지 입금이 확인되지 않으면 자동 취소됩니다.\n문의 010-5287-8002',
      c, pname, p_qty, kst, public.fmt_won(total), case when fee > 0 then ' (택배비 ' || public.fmt_won(fee) || '원 포함)' else '' end,
      case when disc > 0 then E'\n쿠폰·포인트 할인 ' || public.fmt_won(disc) || '원 적용' else '' end,
      si.bank_name, si.bank_account, si.bank_holder, to_char(dl at time zone 'Asia/Seoul', 'MM/DD HH24:MI')));
  else
    perform public.send_sms(ph, format(E'[금비 GOLD] 구매 신청 접수\n접수번호 %s\n%s × %s\n확정 금액과 입금 계좌를 곧 연락드립니다.\n문의 010-5287-8002', c, pname, p_qty));
  end if;
  perform public.send_sms(si.owner_phone, format(E'[금비] 새 주문 %s\n%s %s\n%s × %s\n%s · %s%s',
    c, trim(p_name), ph, pname, p_qty,
    coalesce(public.fmt_won(total) || '원 입금대기', '금액 미확정'),
    case when p_receive = 'delivery' then '택배' else '방문수령' end,
    case when disc > 0 then ' · 할인 ' || public.fmt_won(disc) || '원' else '' end));

  return jsonb_build_object(
    'code', c, 'total', total, 'shipping_fee', fee, 'discount', disc, 'items', lines,
    'locked_at', case when total is not null then now() end, 'deadline', dl,
    'bank_name', si.bank_name, 'bank_account', si.bank_account, 'bank_holder', si.bank_holder);
end $$;
revoke all on function public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb, text, boolean, bigint, int) from public;
grant execute on function public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb, text, boolean, bigint, int) to anon, authenticated;

-- 6) 장바구니 주문 — size-weight.sql 버전 + 쿠폰·포인트
drop function if exists public.submit_cart(jsonb, text, text, text, text, text, jsonb);
drop function if exists public.submit_cart(jsonb, text, text, text, text, text, jsonb, bigint, int);
create function public.submit_cart(
  p_items jsonb, p_name text, p_phone text, p_receive text, p_address text, p_note text, p_receipt jsonb default null,
  p_coupon bigint default null, p_points int default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  si public.shop_info; pr public.products; sp public.products; it jsonb; q int; rc jsonb; oc record; b record;
  c text; ph text := public.clean_phone(p_phone); pname text; first_name text; oid bigint;
  unit numeric; total numeric := 0; cg numeric := 0; fee numeric := 0; priced boolean := true; disc int := 0;
  lines jsonb := '[]'::jsonb; cnt int := 0; nsum int := 0; lst text := '';
  dl timestamptz; kst text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception '장바구니가 비어 있어요'; end if;
  if jsonb_array_length(p_items) > 20 then raise exception '한 번에 20종류까지 주문할 수 있어요'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception '이름을 확인해 주세요'; end if;
  if char_length(ph) not between 9 and 12 then raise exception '연락처를 확인해 주세요'; end if;
  if p_receive not in ('visit', 'delivery') then raise exception '수령 방법을 확인해 주세요'; end if;
  if p_receive = 'delivery' and char_length(trim(coalesce(p_address, ''))) < 5 then raise exception '배송 주소를 입력해 주세요'; end if;
  rc := public.norm_receipt(coalesce(p_receipt, '{}'::jsonb), ph);
  perform public.check_spam('orders', ph);
  select * into si from public.shop_info where id = 1;

  for it in select value from jsonb_array_elements(p_items) loop
    q := coalesce((it ->> 'qty')::int, 0);
    if q not between 1 and 99 then raise exception '수량을 확인해 주세요'; end if;
    select * into pr from public.products where id = (it ->> 'id')::uuid and visible;
    if not found then raise exception '판매가 끝난 상품이 있어요. 장바구니를 확인해 주세요'; end if;
    if pr.sold_out then raise exception '품절된 상품이 있어요: %', pr.name; end if;
    select * into oc from public.opt_check(pr, it ->> 'size', coalesce((it ->> 'addon')::boolean, false));
    sp := public.size_scaled(pr, it ->> 'size');
    if sp.weight_g <> pr.weight_g then oc.label := oc.label || ' · ' || public.fmt_g(sp.weight_g) || 'g'; end if;
    pname := case when pr.kind = 'zodiac' then 'GBK 카드형 골드바 1g (' || pr.name || ')' else pr.name end
          || case when oc.label <> '' then ' (' || oc.label || ')' else '' end;
    unit := public.quote_price(sp) + oc.extra;
    if unit is null then priced := false; end if;
    lines := lines || jsonb_build_object('product_id', pr.id, 'name', pname, 'qty', q, 'unit', unit, 'subtotal', unit * q);
    total := total + coalesce(unit * q, 0);
    if pr.kind not in ('bar', 'silver', 'zodiac') then cg := cg + coalesce(unit * q, 0); end if;
    cnt := cnt + 1; nsum := nsum + q;
    first_name := coalesce(first_name, pname);
    lst := lst || E'\n- ' || pname || ' × ' || q;
  end loop;

  select * into b from public.bnf_check(p_coupon, p_points, case when priced then total end, cg);
  disc := b.cdisc + b.pts;
  lines := public.bnf_lines(lines, b.cdisc, b.pts);
  if p_receive = 'delivery' then fee := coalesce(si.delivery_fee, 0); end if;
  if priced then
    total := total - disc + fee;
    dl := now() + make_interval(mins => si.pay_minutes);
  else
    total := null;
  end if;

  c := public.new_code('O');
  pname := first_name || case when cnt > 1 then ' 외 ' || (cnt - 1) || '건' else '' end;
  insert into public.orders (code, user_id, product_id, product_name, qty, items, final_price,
                             price_locked_at, pay_deadline, shipping_fee, status, name, phone, receive, address, note, receipt,
                             coupon_id, coupon_discount, points_used)
  values (c, auth.uid(), case when cnt = 1 then (lines -> 0 ->> 'product_id')::uuid end, pname, nsum, lines, total,
          case when priced then now() end, dl, fee,
          case when priced then 'confirmed' else 'new' end,
          trim(p_name), ph, p_receive,
          left(nullif(trim(p_address), ''), 200), left(nullif(trim(p_note), ''), 500), rc,
          case when b.cdisc > 0 then p_coupon end, b.cdisc, b.pts)
  returning id into oid;
  perform public.bnf_commit(oid, p_coupon, b.cdisc, b.pts);

  kst := to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI');
  if priced then
    perform public.send_sms(ph, format(E'[금비 GOLD] 주문 확정\n접수번호 %s%s\n확정일시 %s\n입금액 %s원%s%s\n계좌 %s %s (예금주 %s)\n%s까지 입금이 확인되지 않으면 자동 취소됩니다.\n문의 010-5287-8002',
      c, lst, kst, public.fmt_won(total), case when fee > 0 then ' (택배비 ' || public.fmt_won(fee) || '원 포함)' else '' end,
      case when disc > 0 then E'\n쿠폰·포인트 할인 ' || public.fmt_won(disc) || '원 적용' else '' end,
      si.bank_name, si.bank_account, si.bank_holder, to_char(dl at time zone 'Asia/Seoul', 'MM/DD HH24:MI')));
  else
    perform public.send_sms(ph, format(E'[금비 GOLD] 구매 신청 접수\n접수번호 %s%s\n확정 금액과 입금 계좌를 곧 연락드립니다.\n문의 010-5287-8002', c, lst));
  end if;
  perform public.send_sms(si.owner_phone, format(E'[금비] 새 주문 %s\n%s %s%s\n%s · %s%s',
    c, trim(p_name), ph, lst, coalesce(public.fmt_won(total) || '원 입금대기', '금액 미확정'),
    case when p_receive = 'delivery' then '택배' else '방문수령' end,
    case when disc > 0 then ' · 할인 ' || public.fmt_won(disc) || '원' else '' end));

  return jsonb_build_object(
    'code', c, 'total', total, 'shipping_fee', fee, 'discount', disc, 'items', lines,
    'locked_at', case when priced then now() end, 'deadline', dl,
    'bank_name', si.bank_name, 'bank_account', si.bank_account, 'bank_holder', si.bank_holder);
end $$;
revoke all on function public.submit_cart(jsonb, text, text, text, text, text, jsonb, bigint, int) from public;
grant execute on function public.submit_cart(jsonb, text, text, text, text, text, jsonb, bigint, int) to anon, authenticated;

-- 7) 입금 확인 → 포인트 적립 / 취소 → 쿠폰·포인트 되돌리기, 적립 회수
create or replace function public.orders_benefits()
returns trigger language plpgsql security definer set search_path = public as $$
declare rate numeric; earn int;
begin
  if new.status is not distinct from old.status then return new; end if;
  -- 입금 확인(또는 그 이후 단계로 바로 이동): 회원이면 적립
  if new.status in ('paid', 'ready', 'done') and old.status not in ('paid', 'ready', 'done')
     and new.user_id is not null and coalesce(new.points_earned, 0) = 0 then
    select point_rate into rate from public.shop_info where id = 1;
    earn := floor(greatest(coalesce(new.final_price, 0) - coalesce(new.shipping_fee, 0), 0) * coalesce(rate, 0) / 100);
    if earn > 0 then
      insert into public.point_logs (user_id, amount, reason, order_id) values (new.user_id, earn, '구매 적립 (' || new.code || ')', new.id);
      new.points_earned := earn;
    end if;
  end if;
  -- 취소: 쓴 쿠폰·포인트 돌려주기, 적립했던 포인트 회수
  if new.status = 'canceled' and old.status <> 'canceled' then
    if new.coupon_id is not null then
      update public.coupons set used_at = null, order_id = null where id = new.coupon_id and order_id = new.id;
    end if;
    if coalesce(new.points_used, 0) > 0 and new.user_id is not null then
      insert into public.point_logs (user_id, amount, reason, order_id) values (new.user_id, new.points_used, '주문 취소로 돌려받음 (' || new.code || ')', new.id);
    end if;
    if coalesce(new.points_earned, 0) > 0 and new.user_id is not null then
      insert into public.point_logs (user_id, amount, reason, order_id) values (new.user_id, -new.points_earned, '주문 취소로 적립 회수 (' || new.code || ')', new.id);
      new.points_earned := 0;
    end if;
  end if;
  -- 취소했던 주문을 다시 살리면 쿠폰·포인트를 다시 사용 처리
  if old.status = 'canceled' and new.status <> 'canceled' then
    if new.coupon_id is not null then
      update public.coupons set used_at = now(), order_id = new.id where id = new.coupon_id and used_at is null;
    end if;
    if coalesce(new.points_used, 0) > 0 and new.user_id is not null then
      insert into public.point_logs (user_id, amount, reason, order_id) values (new.user_id, -new.points_used, '주문 다시 진행 (' || new.code || ')', new.id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_benefits on public.orders;
create trigger orders_benefits before update on public.orders for each row execute function public.orders_benefits();
revoke all on function public.orders_benefits() from public, anon, authenticated;

-- 8) 후기 — 로그인한 회원만 · 주문 1건당 후기 1개 · 본인 후기 수정 가능 + 후기 이벤트 쿠폰
alter table public.reviews add column if not exists edited_at timestamptz;
create unique index if not exists reviews_one_per_order on public.reviews (order_id);

--    p_code · p_phone 은 예전 화면과 호환용으로 남겨 두고 쓰지 않음
--    반환: 'ok' / 'ok_coupon:10000' (쿠폰 지급) / 안내 문구
create or replace function public.submit_review(p_product uuid, p_rating int, p_body text, p_code text default null, p_phone text default null)
returns text language plpgsql volatile security definer set search_path = public as $$
declare o public.orders; nm text; opt text; rid bigint; si public.shop_info;
begin
  if auth.uid() is null then raise exception '후기는 로그인한 회원만 쓸 수 있어요'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception '별점을 골라 주세요'; end if;
  if char_length(trim(coalesce(p_body, ''))) < 10 then raise exception '후기는 10자 이상 써 주세요'; end if;
  if char_length(p_body) > 1000 then raise exception '후기는 1000자까지 쓸 수 있어요'; end if;

  -- 이 상품이 들어 있고, 아직 후기를 안 쓴 내 주문 (주문 1건당 후기 1개)
  select x.* into o from public.orders x
   where x.user_id = auth.uid()
     and x.status in ('paid', 'ready', 'done')
     and (x.product_id = p_product
          or coalesce(x.items, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('product_id', p_product::text)))
     and not exists (select 1 from public.reviews r where r.order_id = x.id)
   order by x.created_at desc limit 1;

  if o.id is null then
    return case when exists (select 1 from public.orders x
                              where x.user_id = auth.uid() and x.status in ('paid', 'ready', 'done')
                                and (x.product_id = p_product
                                     or coalesce(x.items, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('product_id', p_product::text))))
                then '이 주문의 후기는 이미 써 주셨어요. 후기는 주문 1건당 1개만 쓸 수 있어요. 쓴 후기는 목록에서 ''수정''을 눌러 고칠 수 있어요.'
                else '이 계정으로 구매하신 기록을 찾지 못했어요. 후기는 회원으로 주문하고 입금이 확인된 뒤에 쓸 수 있어요.' end;
  end if;

  nm := coalesce(nullif(trim((select p.name from public.profiles p where p.id = auth.uid())), ''), o.name);
  select it ->> 'name' into opt from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) it
   where it ->> 'product_id' = p_product::text limit 1;
  insert into public.reviews (product_id, order_id, user_id, name, rating, body, option_label)
  values (p_product, o.id, auth.uid(), left(nm, 40), p_rating, trim(p_body), left(coalesce(opt, o.product_name), 120))
  returning id into rid;

  -- 후기 이벤트: 쿠폰 지급 (받은 날부터 N개월)
  select * into si from public.shop_info where id = 1;
  if si.review_event and si.review_coupon > 0 then
    insert into public.coupons (user_id, name, amount, min_order, expires_at, source)
    values (auth.uid(), '후기 감사 쿠폰', si.review_coupon, si.coupon_min, now() + make_interval(months => si.coupon_months), 'review:' || rid)
    on conflict do nothing;
    return 'ok_coupon:' || si.review_coupon;
  end if;
  return 'ok';
end $$;
revoke all on function public.submit_review(uuid, int, text, text, text) from public, anon;
grant execute on function public.submit_review(uuid, int, text, text, text) to authenticated;

-- 내 후기 고치기 (별점 · 내용)
create or replace function public.update_my_review(p_id bigint, p_rating int, p_body text)
returns text language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인해 주세요'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception '별점을 골라 주세요'; end if;
  if char_length(trim(coalesce(p_body, ''))) < 10 then raise exception '후기는 10자 이상 써 주세요'; end if;
  if char_length(p_body) > 1000 then raise exception '후기는 1000자까지 쓸 수 있어요'; end if;
  update public.reviews set rating = p_rating, body = trim(p_body), edited_at = now()
   where id = p_id and user_id = auth.uid();
  if not found then raise exception '내가 쓴 후기만 고칠 수 있어요'; end if;
  return 'ok';
end $$;
revoke all on function public.update_my_review(bigint, int, text) from public, anon;
grant execute on function public.update_my_review(bigint, int, text) to authenticated;

-- 손님 화면용 후기 목록: 내 후기(mine) · 수정됨(edited) · 쿠폰 받은 후기(gift — 공정위 추천·보증 심사지침에 따라 표시)
drop function if exists public.product_reviews(uuid[]);
create function public.product_reviews(p_ids uuid[])
returns table (id bigint, product_id uuid, name text, rating int, body text, option_label text, reply text, created_at timestamptz, mine boolean, edited boolean, gift boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.product_id,
         case when char_length(r.name) <= 2 then left(r.name, 1) || '*'
              else left(r.name, 1) || repeat('*', char_length(r.name) - 2) || right(r.name, 1) end,
         r.rating, r.body, r.option_label, r.reply, r.created_at,
         (auth.uid() is not null and r.user_id = auth.uid()), r.edited_at is not null,
         exists (select 1 from public.coupons c where c.source = 'review:' || r.id)
    from public.reviews r
   where r.visible and r.product_id = any(p_ids)
   order by r.created_at desc
   limit 200;
$$;
revoke all on function public.product_reviews(uuid[]) from public;
grant execute on function public.product_reviews(uuid[]) to anon, authenticated;

-- 9) 내 주문내역에 상품 번호 추가 (주문내역에서 '후기 쓰기' 버튼용)
drop function if exists public.my_requests();
create function public.my_requests()
returns table (kind text, code text, title text, status text, amount numeric, shipping_fee numeric,
               deadline timestamptz, locked_at timestamptz, method text, created_at timestamptz, updated_at timestamptz,
               items jsonb, courier text, tracking_no text, product_id uuid, reviewed boolean)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'order'::text, o.code,
           case when jsonb_array_length(coalesce(o.items, '[]')) > 1 then o.product_name else o.product_name || ' × ' || o.qty end,
           o.status, o.final_price, o.shipping_fee, o.pay_deadline, o.price_locked_at, o.receive, o.created_at, o.updated_at,
           o.items, o.courier, o.tracking_no, o.product_id,
           exists (select 1 from public.reviews r where r.order_id = o.id)
      from public.orders o where auth.uid() is not null and o.user_id = auth.uid()
    union all
    select 'sell'::text, s.code, s.items, s.status, s.final_amount, null::numeric,
           null::timestamptz, null::timestamptz, s.method, s.created_at, s.updated_at, null::jsonb, null::text, null::text, null::uuid, false
      from public.sell_requests s where auth.uid() is not null and s.user_id = auth.uid()
  ) t order by t.created_at desc limit 100;
$$;
revoke all on function public.my_requests() from public, anon;
grant execute on function public.my_requests() to authenticated;

-- 10) 판매 분석에서 관리자 계정 기록 빼기
--     관리자로 로그인한 상태의 방문 · 상품 조회 · 검색 · 검색어는 기록하지 않음, 관리자 계정 주문은 판매수(인기순)에 안 셈
create or replace function public.track_visit(p_source text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
declare src text := lower(coalesce(p_source, '')); dev text := lower(coalesce(p_device, ''));
begin
  if public.is_admin() then return; end if;
  if src not in ('naver', 'google', 'daum', 'kakao', 'threads', 'instagram', 'facebook', 'youtube', 'email', 'direct', 'other') then src := 'other'; end if;
  if dev not in ('mobile', 'pc') then dev := 'pc'; end if;
  if (select coalesce(sum(visits), 0) from public.site_daily where day = public.kst_today()) >= 50000 then return; end if; -- 장난 방지
  insert into public.site_daily (day, source, device, visits) values (public.kst_today(), src, dev, 1)
  on conflict (day, source, device) do update set visits = public.site_daily.visits + 1;
end $$;
revoke all on function public.track_visit(text, text) from public;
grant execute on function public.track_visit(text, text) to anon, authenticated;

create or replace function public.bump_view(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return; end if;
  if not exists (select 1 from public.products where id = p_id and visible) then return; end if;
  insert into public.product_stats (product_id, views) values (p_id, 1)
  on conflict (product_id) do update set views = public.product_stats.views + 1, updated_at = now();
  insert into public.product_daily (day, product_id, views) values (public.kst_today(), p_id, 1)
  on conflict (day, product_id) do update set views = public.product_daily.views + 1;
end $$;
revoke all on function public.bump_view(uuid) from public;
grant execute on function public.bump_view(uuid) to anon, authenticated;

create or replace function public.bump_search(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return; end if;
  if not exists (select 1 from public.products where id = p_id and visible) then return; end if;
  insert into public.product_stats (product_id, searches) values (p_id, 1)
  on conflict (product_id) do update set searches = public.product_stats.searches + 1, updated_at = now();
  insert into public.product_daily (day, product_id, searches) values (public.kst_today(), p_id, 1)
  on conflict (day, product_id) do update set searches = public.product_daily.searches + 1;
end $$;
revoke all on function public.bump_search(uuid) from public;
grant execute on function public.bump_search(uuid) to anon, authenticated;

create or replace function public.track_search_term(p_term text, p_results int)
returns void language plpgsql security definer set search_path = public as $$
declare t text := lower(regexp_replace(trim(coalesce(p_term, '')), '\s+', ' ', 'g'));
begin
  if public.is_admin() then return; end if;
  if char_length(t) not between 1 and 30 then return; end if;
  if (select coalesce(sum(n), 0) from public.search_daily where day = public.kst_today()) >= 20000 then return; end if; -- 장난 방지
  insert into public.search_daily (day, term, n, zero) values (public.kst_today(), t, 1, case when coalesce(p_results, 0) = 0 then 1 else 0 end)
  on conflict (day, term) do update set n = public.search_daily.n + 1,
    zero = public.search_daily.zero + case when coalesce(p_results, 0) = 0 then 1 else 0 end;
end $$;
revoke all on function public.track_search_term(text, int) from public;
grant execute on function public.track_search_term(text, int) to anon, authenticated;

create or replace function public.count_sold()
returns trigger language plpgsql security definer set search_path = public as $$
declare d int; it jsonb;
begin
  if new.user_id is not null and exists (select 1 from public.profiles where id = new.user_id and role = 'admin') then return new; end if;
  if new.status in ('paid', 'ready', 'done') and old.status not in ('paid', 'ready', 'done') then d := 1;
  elsif new.status = 'canceled' and old.status in ('paid', 'ready', 'done') then d := -1;
  else return new; end if;
  if new.items is not null and jsonb_typeof(new.items) = 'array' and jsonb_array_length(new.items) > 0 then
    for it in select value from jsonb_array_elements(new.items) loop
      perform public.add_sold((it ->> 'product_id')::uuid, d * coalesce((it ->> 'qty')::int, 1));
    end loop;
  else
    perform public.add_sold(new.product_id, d * coalesce(new.qty, 1));
  end if;
  return new;
end $$;
select '쿠폰 · 포인트 · 후기 이벤트 설정 완료' as result;
