-- =========================================================
-- 2026-11-04 사이즈 선택 + 추가 옵션(18K 잠금장식)
--   products.sizes      : 고를 수 있는 사이즈 (쉼표로 구분, cm) — 비우면 사이즈 없음
--   products.addon_name : 추가 옵션 이름 (예: 18K 잠금장식) — 비우면 옵션 없음
--   products.addon_price: 추가 옵션 금액 (원, 고정)
--   주문 금액 = 시세 판매가 + (옵션 고르면 추가 금액). 주문 상품명에 '(사이즈 17cm · 18K 잠금장식)'이 붙음
--   여러 번 실행해도 안전합니다. 이 SQL을 먼저 실행한 뒤 홈페이지를 배포하세요.
-- =========================================================
alter table public.products add column if not exists sizes text;
alter table public.products add column if not exists addon_name text;
alter table public.products add column if not exists addon_price numeric;

-- 팔찌 15~21cm (0.5 단위) · 목걸이 41~46cm (1 단위)
update public.products set sizes = '15,15.5,16,16.5,17,17.5,18,18.5,19,19.5,20,20.5,21'
 where kind = 'accessory' and category = 'bracelet';
update public.products set sizes = '41,42,43,44,45,46'
 where kind = 'accessory' and category = 'necklace';

-- 순금 팔찌·목걸이: 18K 잠금장식 (3돈 29만 · 5돈 32만 · 20돈 50만 기준, 중량 비율로 · 1,000원 단위 · 최소 25만)
update public.products p
   set addon_name = '18K 잠금장식',
       addon_price = greatest(250000, round((case
         when d <= 5  then 290000 + (d - 3) * 15000      -- 3돈 29만 → 5돈 32만 (1돈당 1만5천)
         else              320000 + (d - 5) * 12000      -- 5돈 32만 → 20돈 50만 (1돈당 1만2천)
       end) / 1000) * 1000)
  from (select id, weight_g / 3.75 as d from public.products) w
 where w.id = p.id and p.kind = 'accessory' and p.karat = '24K' and p.category in ('bracelet', 'necklace');

-- 주문 상품명 뒤에 붙일 옵션 글자 + 추가 금액 확인
create or replace function public.opt_check(pr public.products, p_size text, p_addon boolean, out label text, out extra numeric)
language plpgsql stable set search_path = public as $$
declare s text := nullif(trim(coalesce(p_size, '')), '');
begin
  label := ''; extra := 0;
  if coalesce(trim(pr.sizes), '') <> '' then
    if s is null then raise exception '사이즈를 골라 주세요: %', pr.name; end if;
    if not s = any (string_to_array(replace(pr.sizes, ' ', ''), ',')) then raise exception '사이즈를 다시 골라 주세요: %', pr.name; end if;
    label := '사이즈 ' || s || 'cm';
  end if;
  if coalesce(p_addon, false) then
    if coalesce(trim(pr.addon_name), '') = '' or coalesce(pr.addon_price, 0) <= 0 then raise exception '선택할 수 없는 옵션이에요: %', pr.name; end if;
    label := label || case when label = '' then '' else ' · ' end || pr.addon_name;
    extra := pr.addon_price;
  end if;
end $$;
revoke all on function public.opt_check(public.products, text, boolean) from public, anon, authenticated;

-- 구매 신청 (상품 1개) — 사이즈 · 추가 옵션
drop function if exists public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb);
drop function if exists public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb, text, boolean);
create function public.submit_order(
  p_product_id uuid, p_qty int, p_name text, p_phone text,
  p_receive text, p_address text, p_note text, p_quoted numeric, p_receipt jsonb default null,
  p_size text default null, p_addon boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.products; si public.shop_info; rc jsonb; oc record;
  c text; ph text := public.clean_phone(p_phone); pname text;
  unit numeric; total numeric; fee numeric := 0; dl timestamptz; kst text;
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
  perform public.check_spam('orders', ph);

  select * into si from public.shop_info where id = 1;
  c := public.new_code('O');
  pname := case when pr.kind = 'zodiac' then 'GBK 카드형 골드바 1g (' || pr.name || ')' else pr.name end
        || case when oc.label <> '' then ' (' || oc.label || ')' else '' end;
  unit := public.quote_price(pr) + oc.extra;
  if p_receive = 'delivery' then fee := coalesce(si.delivery_fee, 0); end if;
  if unit is not null then
    total := unit * p_qty + fee;
    dl := now() + make_interval(mins => si.pay_minutes);
  end if;

  insert into public.orders (code, user_id, product_id, product_name, qty, quoted_price, final_price,
                             price_locked_at, pay_deadline, shipping_fee, status, name, phone, receive, address, note, receipt)
  values (c, auth.uid(), pr.id, pname, p_qty, total, total,
          case when total is not null then now() end, dl, fee,
          case when total is not null then 'confirmed' else 'new' end,
          trim(p_name), ph, p_receive,
          left(nullif(trim(p_address), ''), 200), left(nullif(trim(p_note), ''), 500), rc);

  kst := to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI');
  if total is not null then
    perform public.send_sms(ph, format(E'[금비 GOLD] 주문 확정\n접수번호 %s\n%s × %s\n확정일시 %s\n입금액 %s원%s\n계좌 %s %s (예금주 %s)\n%s까지 입금이 확인되지 않으면 자동 취소됩니다.\n문의 010-5287-8002',
      c, pname, p_qty, kst, public.fmt_won(total), case when fee > 0 then ' (택배비 ' || public.fmt_won(fee) || '원 포함)' else '' end, si.bank_name, si.bank_account, si.bank_holder,
      to_char(dl at time zone 'Asia/Seoul', 'MM/DD HH24:MI')));
  else
    perform public.send_sms(ph, format(E'[금비 GOLD] 구매 신청 접수\n접수번호 %s\n%s × %s\n확정 금액과 입금 계좌를 곧 연락드립니다.\n문의 010-5287-8002', c, pname, p_qty));
  end if;
  perform public.send_sms(si.owner_phone, format(E'[금비] 새 주문 %s\n%s %s\n%s × %s\n%s · %s',
    c, trim(p_name), ph, pname, p_qty,
    coalesce(public.fmt_won(total) || '원 입금대기', '금액 미확정'),
    case when p_receive = 'delivery' then '택배' else '방문수령' end));

  return jsonb_build_object(
    'code', c, 'total', total, 'shipping_fee', fee, 'locked_at', case when total is not null then now() end, 'deadline', dl,
    'bank_name', si.bank_name, 'bank_account', si.bank_account, 'bank_holder', si.bank_holder);
end $$;
revoke all on function public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb, text, boolean) from public;
grant execute on function public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb, text, boolean) to anon, authenticated;

-- 장바구니 주문 — 항목마다 size · addon
create or replace function public.submit_cart(
  p_items jsonb, p_name text, p_phone text, p_receive text, p_address text, p_note text, p_receipt jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  si public.shop_info; pr public.products; it jsonb; q int; rc jsonb; oc record;
  c text; ph text := public.clean_phone(p_phone); pname text; first_name text;
  unit numeric; total numeric := 0; fee numeric := 0; priced boolean := true;
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
    pname := case when pr.kind = 'zodiac' then 'GBK 카드형 골드바 1g (' || pr.name || ')' else pr.name end
          || case when oc.label <> '' then ' (' || oc.label || ')' else '' end;
    unit := public.quote_price(pr) + oc.extra;
    if unit is null then priced := false; end if;
    lines := lines || jsonb_build_object('product_id', pr.id, 'name', pname, 'qty', q, 'unit', unit, 'subtotal', unit * q);
    total := total + coalesce(unit * q, 0);
    cnt := cnt + 1; nsum := nsum + q;
    first_name := coalesce(first_name, pname);
    lst := lst || E'\n- ' || pname || ' × ' || q;
  end loop;

  if p_receive = 'delivery' then fee := coalesce(si.delivery_fee, 0); end if;
  if priced then
    total := total + fee;
    dl := now() + make_interval(mins => si.pay_minutes);
  else
    total := null;
  end if;

  c := public.new_code('O');
  pname := first_name || case when cnt > 1 then ' 외 ' || (cnt - 1) || '건' else '' end;
  insert into public.orders (code, user_id, product_id, product_name, qty, items, final_price,
                             price_locked_at, pay_deadline, shipping_fee, status, name, phone, receive, address, note, receipt)
  values (c, auth.uid(), case when cnt = 1 then (lines -> 0 ->> 'product_id')::uuid end, pname, nsum, lines, total,
          case when priced then now() end, dl, fee,
          case when priced then 'confirmed' else 'new' end,
          trim(p_name), ph, p_receive,
          left(nullif(trim(p_address), ''), 200), left(nullif(trim(p_note), ''), 500), rc);

  kst := to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI');
  if priced then
    perform public.send_sms(ph, format(E'[금비 GOLD] 주문 확정\n접수번호 %s%s\n확정일시 %s\n입금액 %s원%s\n계좌 %s %s (예금주 %s)\n%s까지 입금이 확인되지 않으면 자동 취소됩니다.\n문의 010-5287-8002',
      c, lst, kst, public.fmt_won(total), case when fee > 0 then ' (택배비 ' || public.fmt_won(fee) || '원 포함)' else '' end,
      si.bank_name, si.bank_account, si.bank_holder, to_char(dl at time zone 'Asia/Seoul', 'MM/DD HH24:MI')));
  else
    perform public.send_sms(ph, format(E'[금비 GOLD] 구매 신청 접수\n접수번호 %s%s\n확정 금액과 입금 계좌를 곧 연락드립니다.\n문의 010-5287-8002', c, lst));
  end if;
  perform public.send_sms(si.owner_phone, format(E'[금비] 새 주문 %s\n%s %s%s\n%s · %s',
    c, trim(p_name), ph, lst, coalesce(public.fmt_won(total) || '원 입금대기', '금액 미확정'),
    case when p_receive = 'delivery' then '택배' else '방문수령' end));

  return jsonb_build_object(
    'code', c, 'total', total, 'shipping_fee', fee, 'items', lines,
    'locked_at', case when priced then now() end, 'deadline', dl,
    'bank_name', si.bank_name, 'bank_account', si.bank_account, 'bank_holder', si.bank_holder);
end $$;
revoke all on function public.submit_cart(jsonb, text, text, text, text, text, jsonb) from public;
grant execute on function public.submit_cart(jsonb, text, text, text, text, text, jsonb) to anon, authenticated;

select name as "상품", round(weight_g / 3.75, 2) as "돈", sizes as "사이즈", addon_name as "추가 옵션", addon_price as "옵션 금액"
  from public.products where kind = 'accessory' and category in ('bracelet', 'necklace') order by category, karat, weight_g;
