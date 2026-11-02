-- =========================================================
-- 14) 장바구니 한꺼번에 주문: 접수번호 1개에 여러 상품 (여러 번 실행해도 안전)
-- =========================================================
alter table public.orders add column if not exists items jsonb;

create or replace function public.submit_cart(
  p_items jsonb, p_name text, p_phone text, p_receive text, p_address text, p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  si public.shop_info; pr public.products; it jsonb; q int;
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
  perform public.check_spam('orders', ph);
  select * into si from public.shop_info where id = 1;

  for it in select value from jsonb_array_elements(p_items) loop
    q := coalesce((it ->> 'qty')::int, 0);
    if q not between 1 and 99 then raise exception '수량을 확인해 주세요'; end if;
    select * into pr from public.products where id = (it ->> 'id')::uuid and visible;
    if not found then raise exception '판매가 끝난 상품이 있어요. 장바구니를 확인해 주세요'; end if;
    if pr.sold_out then raise exception '품절된 상품이 있어요: %', pr.name; end if;
    pname := case when pr.kind = 'zodiac' then 'GBK 카드형 골드바 1g (' || pr.name || ')' else pr.name end;
    unit := public.quote_price(pr);
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
                             price_locked_at, pay_deadline, shipping_fee, status, name, phone, receive, address, note)
  values (c, auth.uid(), case when cnt = 1 then (lines -> 0 ->> 'product_id')::uuid end, pname, nsum, lines, total,
          case when priced then now() end, dl, fee,
          case when priced then 'confirmed' else 'new' end,
          trim(p_name), ph, p_receive,
          left(nullif(trim(p_address), ''), 200), left(nullif(trim(p_note), ''), 500));

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
revoke all on function public.submit_cart(jsonb, text, text, text, text, text) from public;
grant execute on function public.submit_cart(jsonb, text, text, text, text, text) to anon, authenticated;

-- 조회 화면에도 상품 목록이 보이도록 (반환 칸이 바뀌어 다시 만듦)
drop function if exists public.lookup_request(text, text);
create function public.lookup_request(p_code text, p_phone text)
returns table (kind text, title text, status text, created_at timestamptz, updated_at timestamptz,
               amount numeric, deadline timestamptz, items jsonb)
language sql stable security definer set search_path = public as $$
  select 'order', case when jsonb_array_length(coalesce(o.items, '[]')) > 1 then o.product_name else o.product_name || ' × ' || o.qty end,
         o.status, o.created_at, o.updated_at, o.final_price, o.pay_deadline, o.items
    from public.orders o where o.code = upper(trim(p_code)) and o.phone = public.clean_phone(p_phone)
  union all
  select 'sell', s.items, s.status, s.created_at, s.updated_at, s.final_amount, null, null
    from public.sell_requests s where s.code = upper(trim(p_code)) and s.phone = public.clean_phone(p_phone);
$$;
revoke all on function public.lookup_request(text, text) from public;
grant execute on function public.lookup_request(text, text) to anon, authenticated;

drop function if exists public.my_requests();
create function public.my_requests()
returns table (kind text, code text, title text, status text, amount numeric, shipping_fee numeric,
               deadline timestamptz, locked_at timestamptz, method text, created_at timestamptz, updated_at timestamptz, items jsonb)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'order'::text, o.code,
           case when jsonb_array_length(coalesce(o.items, '[]')) > 1 then o.product_name else o.product_name || ' × ' || o.qty end,
           o.status, o.final_price, o.shipping_fee, o.pay_deadline, o.price_locked_at, o.receive, o.created_at, o.updated_at, o.items
      from public.orders o where auth.uid() is not null and o.user_id = auth.uid()
    union all
    select 'sell'::text, s.code, s.items, s.status, s.final_amount, null::numeric,
           null::timestamptz, null::timestamptz, s.method, s.created_at, s.updated_at, null::jsonb
      from public.sell_requests s where auth.uid() is not null and s.user_id = auth.uid()
  ) t order by t.created_at desc limit 100;
$$;
revoke all on function public.my_requests() from public, anon;
grant execute on function public.my_requests() to authenticated;

select '장바구니 주문 설정 완료' as result;
