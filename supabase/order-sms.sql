-- =========================================================
-- 12) 주문 즉시 금액 확정 · 입금 기한 자동 취소 · 문자 알림 (솔라피)
--     여러 번 실행해도 안전합니다.
--     문자는 솔라피 API 키를 Vault에 넣기 전까지는 보내지 않고 건너뜁니다.
-- =========================================================
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pgcrypto with schema extensions;

-- 가게 정보: 입금 계좌, 입금 기한, 알림 받을 번호 (관리자 페이지 > 시세 설정에서 수정)
create table if not exists public.shop_info (
  id           int primary key default 1 check (id = 1),
  bank_name    text not null default '카카오뱅크',
  bank_account text not null default '3333-20-8358860',
  bank_holder  text not null default '박준우',
  pay_minutes  int  not null default 30 check (pay_minutes between 5 and 1440),
  owner_phone  text not null default '01052878002',
  sms_sender   text not null default '01052878002',
  sms_enabled  boolean not null default true,
  updated_at   timestamptz not null default now()
);
insert into public.shop_info (id) values (1) on conflict (id) do nothing;
alter table public.shop_info enable row level security;
drop policy if exists "shop_info_read" on public.shop_info;
create policy "shop_info_read" on public.shop_info for select using (true);
drop policy if exists "shop_info_admin" on public.shop_info;
create policy "shop_info_admin" on public.shop_info for update using (public.is_admin()) with check (public.is_admin());
grant select on public.shop_info to anon, authenticated;
grant update on public.shop_info to authenticated;

-- 주문에 입금 기한 · 금액 확정 시각 추가
alter table public.orders add column if not exists pay_deadline timestamptz;
alter table public.orders add column if not exists price_locked_at timestamptz;

-- 서버가 1분마다 받아 두는 국제 시세 (원화/온스)
create table if not exists public.live_prices (
  symbol     text primary key,
  krw_per_oz numeric not null,
  fetched_at timestamptz not null
);
create table if not exists public.price_fetches (
  id         bigint primary key,
  symbol     text not null,
  created_at timestamptz not null default now()
);
alter table public.live_prices enable row level security;
alter table public.price_fetches enable row level security;

create or replace function public.refresh_live_prices()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  -- 지난번 요청의 응답을 반영
  for r in
    select f.id, f.symbol, h.status_code, h.content
      from public.price_fetches f join net._http_response h on h.id = f.id
  loop
    begin
      if r.status_code = 200 and (r.content::jsonb ->> 'price') is not null then
        insert into public.live_prices (symbol, krw_per_oz, fetched_at)
        values (r.symbol, (r.content::jsonb ->> 'price')::numeric, now())
        on conflict (symbol) do update set krw_per_oz = excluded.krw_per_oz, fetched_at = excluded.fetched_at;
      end if;
    exception when others then null; -- 응답 형식이 이상하면 무시
    end;
    delete from public.price_fetches where id = r.id;
  end loop;
  delete from public.price_fetches where created_at < now() - interval '10 minutes';
  -- 새로 요청
  insert into public.price_fetches (id, symbol)
  select net.http_get('https://api.gold-api.com/price/' || s || '/KRW'), s
    from unnest(array['XAU', 'XAG']) as s;
end $$;

-- 상품 1개 가격 (홈페이지 common.js productPrice 와 같은 계산). 시세가 10분 넘게 낡았으면 null
create or replace function public.quote_price(p public.products)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  s public.price_settings;
  au numeric; ag numeric; don numeric; buy numeric; sell numeric; f numeric;
begin
  select * into s from public.price_settings where id = 1;
  select krw_per_oz into au from public.live_prices where symbol = 'XAU' and fetched_at > now() - interval '10 minutes';
  select krw_per_oz into ag from public.live_prices where symbol = 'XAG' and fetched_at > now() - interval '10 minutes';
  if p.kind = 'silver' then
    if ag is null then return null; end if;
    don := ag / 31.1034768 * 3.75;
    buy := round(don * (1 + s.ag_buy_pct / 100) * 1.1 / 10) * 10;
    return round(buy / 3.75 * p.weight_g * (1 + p.premium_pct / 100) / 100) * 100;
  end if;
  if au is null then return null; end if;
  don := au / 31.1034768 * 3.75;
  if p.kind = 'accessory' then
    f := case p.karat when '18K' then s.k18_factor when '14K' then s.k14_factor else 1 end;
    sell := round(don * (1 + s.gold_sell_pct / 100) * f / 100) * 100;
    return round((sell / 3.75 * 1.3 * p.weight_g + p.labor) / 1000) * 1000;
  end if;
  buy := round(don * (1 + s.gold_buy_pct / 100) * 1.1 / 100) * 100;
  return round(buy / 3.75 * p.weight_g * (1 + p.premium_pct / 100) / 100) * 100;
end $$;

-- 문자 보내기 (솔라피). 키가 없거나 꺼져 있으면 조용히 건너뜀. 실패해도 주문은 그대로 진행
create or replace function public.send_sms(p_to text, p_text text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare si public.shop_info; k text; sec text; d text; salt text; sig text;
begin
  select * into si from public.shop_info where id = 1;
  if si.id is null or not si.sms_enabled or coalesce(p_to, '') = '' then return; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'solapi_api_key';
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'solapi_api_secret';
  if k is null or sec is null then return; end if;
  d := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  salt := encode(gen_random_bytes(16), 'hex');
  sig := encode(hmac(d || salt, sec, 'sha256'), 'hex');
  perform net.http_post(
    url := 'https://api.solapi.com/messages/v4/send',
    body := jsonb_build_object('message', jsonb_build_object(
      'to', public.clean_phone(p_to), 'from', public.clean_phone(si.sms_sender), 'text', p_text)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', format('HMAC-SHA256 apiKey=%s, date=%s, salt=%s, signature=%s', k, d, salt, sig))
  );
exception when others then
  raise warning '문자 발송 실패: %', sqlerrm;
end $$;

-- 금액 표기 (1234567 → 1,234,567)
create or replace function public.fmt_won(n numeric)
returns text language sql immutable as $$ select to_char(n, 'FM999,999,999,990') $$;

-- 구매 신청: 접수와 동시에 금액 확정 + 입금 기한 설정 + 문자
drop function if exists public.submit_order(uuid, int, text, text, text, text, text, numeric);
create function public.submit_order(
  p_product_id uuid, p_qty int, p_name text, p_phone text,
  p_receive text, p_address text, p_note text, p_quoted numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.products; si public.shop_info;
  c text; ph text := public.clean_phone(p_phone); pname text;
  unit numeric; total numeric; dl timestamptz; kst text;
begin
  select * into pr from public.products where id = p_product_id and visible;
  if not found then raise exception '상품을 찾을 수 없습니다'; end if;
  if pr.sold_out then raise exception '품절된 상품입니다'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception '이름을 확인해 주세요'; end if;
  if char_length(ph) not between 9 and 12 then raise exception '연락처를 확인해 주세요'; end if;
  if coalesce(p_qty, 0) not between 1 and 99 then raise exception '수량을 확인해 주세요'; end if;
  if p_receive not in ('visit', 'delivery') then raise exception '수령 방법을 확인해 주세요'; end if;
  if p_receive = 'delivery' and char_length(trim(coalesce(p_address, ''))) < 5 then raise exception '배송 주소를 입력해 주세요'; end if;
  perform public.check_spam('orders', ph);

  select * into si from public.shop_info where id = 1;
  c := public.new_code('O');
  pname := case when pr.kind = 'zodiac' then 'GBK 카드형 골드바 1g (' || pr.name || ')' else pr.name end;
  unit := public.quote_price(pr);              -- 시세를 못 받았으면 null → 예전처럼 매장에서 금액 안내
  if unit is not null then
    total := unit * p_qty;
    dl := now() + make_interval(mins => si.pay_minutes);
  end if;

  insert into public.orders (code, user_id, product_id, product_name, qty, quoted_price, final_price,
                             price_locked_at, pay_deadline, status, name, phone, receive, address, note)
  values (c, auth.uid(), pr.id, pname, p_qty, p_quoted, total,
          case when total is not null then now() end, dl,
          case when total is not null then 'confirmed' else 'new' end,
          trim(p_name), ph, p_receive,
          left(nullif(trim(p_address), ''), 200), left(nullif(trim(p_note), ''), 500));

  kst := to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI');
  if total is not null then
    perform public.send_sms(ph, format(E'[금비 GOLD] 주문 확정\n접수번호 %s\n%s × %s\n확정일시 %s\n입금액 %s원\n계좌 %s %s (예금주 %s)\n%s까지 입금이 확인되지 않으면 자동 취소됩니다.\n문의 010-5287-8002',
      c, pname, p_qty, kst, public.fmt_won(total), si.bank_name, si.bank_account, si.bank_holder,
      to_char(dl at time zone 'Asia/Seoul', 'MM/DD HH24:MI')));
  else
    perform public.send_sms(ph, format(E'[금비 GOLD] 구매 신청 접수\n접수번호 %s\n%s × %s\n확정 금액과 입금 계좌를 곧 연락드립니다.\n문의 010-5287-8002', c, pname, p_qty));
  end if;
  perform public.send_sms(si.owner_phone, format(E'[금비] 새 주문 %s\n%s %s\n%s × %s\n%s · %s',
    c, trim(p_name), ph, pname, p_qty,
    coalesce(public.fmt_won(total) || '원 입금대기', '금액 미확정'),
    case when p_receive = 'delivery' then '택배' else '방문수령' end));

  return jsonb_build_object(
    'code', c, 'total', total, 'locked_at', case when total is not null then now() end, 'deadline', dl,
    'bank_name', si.bank_name, 'bank_account', si.bank_account, 'bank_holder', si.bank_holder);
end $$;
revoke all on function public.submit_order(uuid, int, text, text, text, text, text, numeric) from public;
grant execute on function public.submit_order(uuid, int, text, text, text, text, text, numeric) to anon, authenticated;

-- 매입 신청: 접수 + 사장님 알림 문자
create or replace function public.submit_sell(
  p_items text, p_karat text, p_weight numeric, p_method text, p_visit_date date,
  p_name text, p_phone text, p_note text
) returns text language plpgsql security definer set search_path = public as $$
declare c text; ph text := public.clean_phone(p_phone); si public.shop_info;
begin
  if char_length(trim(coalesce(p_items, ''))) not between 1 and 100 then raise exception '품목을 입력해 주세요'; end if;
  if p_karat not in ('24K', '18K', '14K', 'unknown') then raise exception '함량을 확인해 주세요'; end if;
  if p_method not in ('visit', 'delivery') then raise exception '접수 방법을 확인해 주세요'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception '이름을 확인해 주세요'; end if;
  if char_length(ph) not between 9 and 12 then raise exception '연락처를 확인해 주세요'; end if;
  if p_weight is not null and (p_weight <= 0 or p_weight > 100000) then raise exception '중량을 확인해 주세요'; end if;
  perform public.check_spam('sell_requests', ph);
  c := public.new_code('S');
  insert into public.sell_requests (code, user_id, items, karat, weight_g, method, visit_date, name, phone, note)
  values (c, auth.uid(), trim(p_items), p_karat, p_weight, p_method, p_visit_date, trim(p_name), ph,
          left(nullif(trim(p_note), ''), 500));
  select * into si from public.shop_info where id = 1;
  perform public.send_sms(ph, format(E'[금비 GOLD] 매입 신청 접수\n접수번호 %s\n%s\n방문 일정·감정 안내를 곧 연락드립니다.\n문의 010-5287-8002', c, trim(p_items)));
  perform public.send_sms(si.owner_phone, format(E'[금비] 새 매입 %s\n%s %s\n%s (%s)\n%s%s',
    c, trim(p_name), ph, trim(p_items), p_karat,
    case when p_method = 'delivery' then '택배' else '방문' end,
    coalesce(' · ' || to_char(p_visit_date, 'MM/DD'), '')));
  return c;
end $$;

-- 입금 기한이 지난 주문 자동 취소 (+ 고객 안내 문자)
create or replace function public.expire_orders()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    update public.orders
       set status = 'canceled',
           admin_memo = concat_ws(E'\n', nullif(admin_memo, ''), '입금 기한 경과로 자동 취소 (' || to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || ')')
     where status = 'confirmed' and pay_deadline is not null and pay_deadline < now()
    returning code, phone
  loop
    perform public.send_sms(r.phone, format(E'[금비 GOLD] 입금 기한이 지나 주문 %s이 자동 취소되었습니다.\n다시 주문하시거나 010-5287-8002로 문의해 주세요.', r.code));
  end loop;
end $$;

-- 고객 접수 조회: 확정 금액 · 입금 기한도 함께
drop function if exists public.lookup_request(text, text);
create function public.lookup_request(p_code text, p_phone text)
returns table (kind text, title text, status text, created_at timestamptz, updated_at timestamptz, amount numeric, deadline timestamptz)
language sql stable security definer set search_path = public as $$
  select 'order', o.product_name || ' × ' || o.qty, o.status, o.created_at, o.updated_at, o.final_price, o.pay_deadline
    from public.orders o where o.code = upper(trim(p_code)) and o.phone = public.clean_phone(p_phone)
  union all
  select 'sell', s.items, s.status, s.created_at, s.updated_at, s.final_amount, null
    from public.sell_requests s where s.code = upper(trim(p_code)) and s.phone = public.clean_phone(p_phone);
$$;
revoke all on function public.lookup_request(text, text) from public;
grant execute on function public.lookup_request(text, text) to anon, authenticated;

-- 내부용 함수는 손님이 직접 부를 수 없게
revoke all on function public.send_sms(text, text) from public, anon, authenticated;
revoke all on function public.refresh_live_prices() from public, anon, authenticated;
revoke all on function public.expire_orders() from public, anon, authenticated;
revoke all on function public.quote_price(public.products) from public, anon, authenticated;

-- 1분마다: 시세 받기 · 기한 지난 주문 취소
select cron.schedule('keumbi-live-prices', '* * * * *', 'select public.refresh_live_prices()');
select cron.schedule('keumbi-expire-orders', '* * * * *', 'select public.expire_orders()');
select public.refresh_live_prices();

select '설정 완료' as result, (select bank_name || ' ' || bank_account || ' ' || bank_holder from public.shop_info) as account;
