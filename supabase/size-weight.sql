-- =========================================================
-- 2026-11-04 사이즈에 따라 금 중량(=가격)이 달라짐
--   products.base_size: 등록된 중량이 몇 cm 기준인지 (팔찌 17 · 목걸이 45 기본, 관리자에서 상품별로 수정)
--   고른 사이즈 중량 = 등록 중량 × 고른 사이즈 ÷ 기준 사이즈 (소수 둘째 자리), 공임도 같은 비율
--   잠금장식 금액은 사이즈와 상관없이 그대로
--   주문 상품명: '… (사이즈 18cm · 18K 잠금장식 · 84.71g)'
--   size-addon.sql 실행 뒤에 실행하세요. 여러 번 실행해도 안전합니다.
-- =========================================================
alter table public.products add column if not exists base_size numeric;
update public.products set base_size = 17 where kind = 'accessory' and category = 'bracelet' and base_size is null;
update public.products set base_size = 45 where kind = 'accessory' and category = 'necklace' and base_size is null;

-- 고른 사이즈만큼 중량·공임을 바꾼 상품 (사이즈 없거나 기준 없으면 그대로)
create or replace function public.size_scaled(pr public.products, p_size text)
returns public.products language plpgsql stable set search_path = public as $$
declare r numeric;
begin
  if coalesce(pr.base_size, 0) <= 0 or coalesce(trim(pr.sizes), '') = '' or coalesce(trim(p_size), '') = '' then return pr; end if;
  r := trim(p_size)::numeric / pr.base_size;
  pr.weight_g := round(pr.weight_g * r, 2);
  pr.labor := round(coalesce(pr.labor, 0) * r);
  return pr;
end $$;
revoke all on function public.size_scaled(public.products, text) from public, anon, authenticated;

-- 중량 글자: 84.70 → 84.7, 85.00 → 85
create or replace function public.fmt_g(v numeric)
returns text language sql immutable as $$ select rtrim(rtrim(round(v, 2)::text, '0'), '.') $$;
-- 구매 신청 (상품 1개) — 사이즈 · 추가 옵션
drop function if exists public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb);
drop function if exists public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb, text, boolean);
create function public.submit_order(
  p_product_id uuid, p_qty int, p_name text, p_phone text,
  p_receive text, p_address text, p_note text, p_quoted numeric, p_receipt jsonb default null,
  p_size text default null, p_addon boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.products; sp public.products; si public.shop_info; rc jsonb; oc record;
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
  sp := public.size_scaled(pr, p_size);
  if sp.weight_g <> pr.weight_g then oc.label := oc.label || ' · ' || public.fmt_g(sp.weight_g) || 'g'; end if;
  perform public.check_spam('orders', ph);

  select * into si from public.shop_info where id = 1;
  c := public.new_code('O');
  pname := case when pr.kind = 'zodiac' then 'GBK 카드형 골드바 1g (' || pr.name || ')' else pr.name end
        || case when oc.label <> '' then ' (' || oc.label || ')' else '' end;
  unit := public.quote_price(sp) + oc.extra;
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
  si public.shop_info; pr public.products; sp public.products; it jsonb; q int; rc jsonb; oc record;
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
    sp := public.size_scaled(pr, it ->> 'size');
    if sp.weight_g <> pr.weight_g then oc.label := oc.label || ' · ' || public.fmt_g(sp.weight_g) || 'g'; end if;
    pname := case when pr.kind = 'zodiac' then 'GBK 카드형 골드바 1g (' || pr.name || ')' else pr.name end
          || case when oc.label <> '' then ' (' || oc.label || ')' else '' end;
    unit := public.quote_price(sp) + oc.extra;
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

select name as "상품", base_size as "기준(cm)", weight_g as "등록 중량", sizes as "사이즈" from public.products
 where kind = 'accessory' and category in ('bracelet', 'necklace') order by category, weight_g;