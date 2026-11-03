-- =========================================================
-- 15) 현금영수증·세금계산서 신청 정보 · 송장번호 · 단계별 안내 문자 · 매출 정리용 날짜
--     여러 번 실행해도 안전합니다.
-- =========================================================
alter table public.orders add column if not exists receipt jsonb not null default '{"type":"none"}'::jsonb;
alter table public.orders add column if not exists receipt_issued_at timestamptz;
alter table public.orders add column if not exists receipt_ref text;
alter table public.orders add column if not exists courier text;
alter table public.orders add column if not exists tracking_no text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists shipped_at timestamptz;

-- 현금영수증 신청 정보 확인 · 정리 (none / personal 소득공제 / business 지출증빙 / invoice 세금계산서)
create or replace function public.norm_receipt(p jsonb, ph text)
returns jsonb language plpgsql immutable set search_path = public as $$
declare t text := coalesce(nullif(p ->> 'type', ''), 'none'); n text; em text;
begin
  if t not in ('none', 'personal', 'business', 'invoice') then raise exception '현금영수증 종류를 확인해 주세요'; end if;
  if t = 'none' then return '{"type":"none"}'::jsonb; end if;
  if t = 'personal' then
    n := regexp_replace(coalesce(nullif(p ->> 'no', ''), ph, ''), '\D', '', 'g');
    if char_length(n) not between 10 and 18 then raise exception '현금영수증 휴대폰 번호를 확인해 주세요'; end if;
    return jsonb_build_object('type', t, 'no', n);
  end if;
  n := regexp_replace(coalesce(p ->> 'no', ''), '\D', '', 'g');
  if char_length(n) <> 10 then raise exception '사업자등록번호 10자리를 확인해 주세요'; end if;
  if t = 'business' then return jsonb_build_object('type', t, 'no', n); end if;
  em := trim(coalesce(p ->> 'email', ''));
  if char_length(trim(coalesce(p ->> 'company', ''))) not between 1 and 50 then raise exception '상호를 입력해 주세요'; end if;
  if char_length(trim(coalesce(p ->> 'ceo', ''))) not between 1 and 30 then raise exception '대표자 이름을 입력해 주세요'; end if;
  if em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(em) > 100 then raise exception '계산서 받을 이메일을 확인해 주세요'; end if;
  return jsonb_build_object('type', t, 'no', n, 'company', trim(p ->> 'company'), 'ceo', trim(p ->> 'ceo'), 'email', em);
end $$;

-- 구매 신청 (상품 1개) — 현금영수증 정보 추가
drop function if exists public.submit_order(uuid, int, text, text, text, text, text, numeric);
drop function if exists public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb);
create function public.submit_order(
  p_product_id uuid, p_qty int, p_name text, p_phone text,
  p_receive text, p_address text, p_note text, p_quoted numeric, p_receipt jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.products; si public.shop_info; rc jsonb;
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
  perform public.check_spam('orders', ph);

  select * into si from public.shop_info where id = 1;
  c := public.new_code('O');
  pname := case when pr.kind = 'zodiac' then 'GBK 카드형 골드바 1g (' || pr.name || ')' else pr.name end;
  unit := public.quote_price(pr);
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
revoke all on function public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb) from public;
grant execute on function public.submit_order(uuid, int, text, text, text, text, text, numeric, jsonb) to anon, authenticated;

-- 장바구니 주문 — 현금영수증 정보 추가
drop function if exists public.submit_cart(jsonb, text, text, text, text, text);
drop function if exists public.submit_cart(jsonb, text, text, text, text, text, jsonb);
create function public.submit_cart(
  p_items jsonb, p_name text, p_phone text, p_receive text, p_address text, p_note text, p_receipt jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  si public.shop_info; pr public.products; it jsonb; q int; rc jsonb;
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

-- 입금 확인 · 발송 시각 자동 기록
create or replace function public.orders_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.paid_at is null then new.paid_at := now(); end if;
  if new.tracking_no is not null and new.tracking_no is distinct from old.tracking_no then new.shipped_at := now(); end if;
  return new;
end $$;
drop trigger if exists orders_stamp on public.orders;
create trigger orders_stamp before update on public.orders for each row execute function public.orders_stamp();

-- 단계가 바뀌면 손님에게 안내 문자 (솔라피 키를 넣기 전에는 조용히 건너뜀)
create or replace function public.orders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    perform public.send_sms(new.phone, format(E'[금비 GOLD] 입금 확인\n접수번호 %s\n입금 %s원이 확인되었습니다.\n%s\n문의 010-5287-8002',
      new.code, coalesce(public.fmt_won(new.final_price), '-'),
      case when new.receive = 'delivery' then '보험 등기 택배로 발송하고 송장번호를 문자로 알려드릴게요.'
           else '상품이 준비되면 매장 수령 안내를 드릴게요.' end));
  end if;
  if new.receive = 'delivery' and new.tracking_no is not null and new.status in ('ready', 'done')
     and (new.tracking_no is distinct from old.tracking_no or old.status not in ('ready', 'done')) then
    perform public.send_sms(new.phone, format(E'[금비 GOLD] 발송 완료\n접수번호 %s\n%s %s\n배송 조회: keumbi.netlify.app/my-orders.html\n문의 010-5287-8002',
      new.code, coalesce(new.courier, '택배'), new.tracking_no));
  end if;
  if new.receive = 'visit' and new.status = 'ready' and old.status is distinct from 'ready' then
    perform public.send_sms(new.phone, format(E'[금비 GOLD] 수령 준비 완료\n접수번호 %s\n매장에서 받아 가실 수 있어요.\n평일 10:00~19:00 · 종로구 율곡로10길 105 디아망 빌딩 2층\n문의 010-5287-8002', new.code));
  end if;
  return new;
end $$;
drop trigger if exists orders_notify on public.orders;
create trigger orders_notify after update on public.orders for each row execute function public.orders_notify();
revoke all on function public.orders_notify() from public, anon, authenticated;

-- 고객 조회에 수령 방법 · 택배사 · 송장번호 추가 (반환 칸이 바뀌어 다시 만듦)
-- 조회를 계속 틀리면(1시간에 10번) 잠시 막음 — 접수번호 무작위 대입 방지
create table if not exists public.lookup_fail (k text not null, created_at timestamptz not null default now());
create index if not exists lookup_fail_k on public.lookup_fail (k, created_at);
alter table public.lookup_fail enable row level security;

-- 요청한 사람의 IP (Supabase 앞단이 넣어 주는 값)
create or replace function public.client_ip()
returns text language sql stable set search_path = public as $$
  select coalesce(
    nullif(current_setting('request.headers', true)::json ->> 'cf-connecting-ip', ''),
    nullif(current_setting('request.headers', true)::json ->> 'x-real-ip', ''),
    nullif(trim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), ''));
$$;

drop function if exists public.lookup_request(text, text);
create function public.lookup_request(p_code text, p_phone text)
returns table (kind text, title text, status text, created_at timestamptz, updated_at timestamptz,
               amount numeric, deadline timestamptz, items jsonb, method text, courier text, tracking_no text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare v_ip text := 'ip:' || coalesce(public.client_ip(), '-'); v_ph text := 'ph:' || public.clean_phone(p_phone);
begin
  if (select count(*) from public.lookup_fail f where f.k in (v_ip, v_ph) and f.created_at > now() - interval '1 hour') >= 10 then
    raise exception '조회 시도가 너무 많아요. 잠시 후 다시 시도하거나 010-5287-8002로 문의해 주세요';
  end if;
  return query
    select 'order'::text, case when jsonb_array_length(coalesce(o.items, '[]')) > 1 then o.product_name else o.product_name || ' × ' || o.qty end,
           o.status, o.created_at, o.updated_at, o.final_price, o.pay_deadline, o.items, o.receive, o.courier, o.tracking_no
      from public.orders o where o.code = upper(trim(p_code)) and o.phone = public.clean_phone(p_phone)
    union all
    select 'sell'::text, s.items, s.status, s.created_at, s.updated_at, s.final_amount, null::timestamptz, null::jsonb, s.method, null::text, null::text
      from public.sell_requests s where s.code = upper(trim(p_code)) and s.phone = public.clean_phone(p_phone);
  if not found then
    insert into public.lookup_fail (k) values (v_ip), (v_ph);
    delete from public.lookup_fail where created_at < now() - interval '1 day';
  end if;
end $$;
revoke all on function public.lookup_request(text, text) from public;
grant execute on function public.lookup_request(text, text) to anon, authenticated;

drop function if exists public.my_requests();
create function public.my_requests()
returns table (kind text, code text, title text, status text, amount numeric, shipping_fee numeric,
               deadline timestamptz, locked_at timestamptz, method text, created_at timestamptz, updated_at timestamptz,
               items jsonb, courier text, tracking_no text)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'order'::text, o.code,
           case when jsonb_array_length(coalesce(o.items, '[]')) > 1 then o.product_name else o.product_name || ' × ' || o.qty end,
           o.status, o.final_price, o.shipping_fee, o.pay_deadline, o.price_locked_at, o.receive, o.created_at, o.updated_at,
           o.items, o.courier, o.tracking_no
      from public.orders o where auth.uid() is not null and o.user_id = auth.uid()
    union all
    select 'sell'::text, s.code, s.items, s.status, s.final_amount, null::numeric,
           null::timestamptz, null::timestamptz, s.method, s.created_at, s.updated_at, null::jsonb, null::text, null::text
      from public.sell_requests s where auth.uid() is not null and s.user_id = auth.uid()
  ) t order by t.created_at desc limit 100;
$$;
revoke all on function public.my_requests() from public, anon;
grant execute on function public.my_requests() to authenticated;

-- =========================================================
-- 16) 보안 보강 (오픈 전 점검 결과)
-- =========================================================
-- 접수번호를 더 길고 예측 불가능하게: O261103-7KQ2M9XA (예전 번호도 그대로 조회됨)
create or replace function public.new_code(prefix text)
returns text language sql volatile set search_path = public, extensions as $$
  select prefix || to_char(now() at time zone 'Asia/Seoul', 'YYMMDD') || '-' ||
    (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', get_byte(b, i) % 32 + 1, 1), '' order by i)
       from extensions.gen_random_bytes(8) b, generate_series(0, 7) i);
$$;

-- 장난 접수 막기: 같은 번호 10분 3건 + 같은 IP 1시간 10건
create table if not exists public.submit_log (ip text not null, created_at timestamptz not null default now());
create index if not exists submit_log_i on public.submit_log (ip, created_at);
alter table public.submit_log enable row level security;
create or replace function public.check_spam(p_table text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare c int; v_ip text := public.client_ip();
begin
  execute format('select count(*) from public.%I where phone = $1 and created_at > now() - interval ''10 minutes''', p_table)
    into c using p_phone;
  if c >= 3 then raise exception '잠시 후 다시 시도해 주세요'; end if;
  if v_ip is not null then
    if (select count(*) from public.submit_log where ip = v_ip and created_at > now() - interval '1 hour') >= 10 then
      raise exception '접수가 너무 많아요. 잠시 후 다시 시도하거나 010-5287-8002로 전화 주세요';
    end if;
    insert into public.submit_log (ip) values (v_ip);
    delete from public.submit_log where created_at < now() - interval '1 day';
  end if;
end $$;
revoke all on function public.check_spam(text, text) from public, anon, authenticated;

-- 문자 보내기: 한 번호에 하루 6통, 전체 1시간 60통까지 (요금 폭탄 방지). 사장님 번호는 번호별 제한 없음
create table if not exists public.sms_log (id bigint generated always as identity primary key, to_phone text not null, created_at timestamptz not null default now());
create index if not exists sms_log_t on public.sms_log (created_at);
create index if not exists sms_log_p on public.sms_log (to_phone, created_at);
alter table public.sms_log enable row level security;
create or replace function public.send_sms(p_to text, p_text text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare si public.shop_info; k text; sec text; d text; salt text; sig text; t text := public.clean_phone(p_to);
begin
  select * into si from public.shop_info where id = 1;
  if si.id is null or not si.sms_enabled or coalesce(t, '') = '' then return; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'solapi_api_key';
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'solapi_api_secret';
  if k is null or sec is null then return; end if;
  if (select count(*) from public.sms_log where created_at > now() - interval '1 hour') >= 60 then
    raise warning '문자 발송 한도(1시간 60통) 초과'; return;
  end if;
  if t <> public.clean_phone(si.owner_phone)
     and (select count(*) from public.sms_log where to_phone = t and created_at > now() - interval '24 hours') >= 6 then
    return;
  end if;
  insert into public.sms_log (to_phone) values (t);
  d := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  salt := encode(gen_random_bytes(16), 'hex');
  sig := encode(hmac(d || salt, sec, 'sha256'), 'hex');
  perform net.http_post(
    url := 'https://api.solapi.com/messages/v4/send',
    body := jsonb_build_object('message', jsonb_build_object('to', t, 'from', public.clean_phone(si.sms_sender), 'text', p_text)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', format('HMAC-SHA256 apiKey=%s, date=%s, salt=%s, signature=%s', k, d, salt, sig))
  );
exception when others then
  raise warning '문자 발송 실패: %', sqlerrm;
end $$;
revoke all on function public.send_sms(text, text) from public, anon, authenticated;

-- 매입 신청: 손님에게 가는 문자에 손님이 쓴 글을 넣지 않음 (문자 사칭 방지)
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
  perform public.send_sms(ph, format(E'[금비 GOLD] 매입 신청 접수\n접수번호 %s\n방문 일정·감정 안내를 곧 연락드립니다.\n문의 010-5287-8002', c));
  perform public.send_sms(si.owner_phone, format(E'[금비] 새 매입 %s\n%s %s\n%s (%s)\n%s%s',
    c, trim(p_name), ph, trim(p_items), p_karat,
    case when p_method = 'delivery' then '택배' else '방문' end,
    coalesce(' · ' || to_char(p_visit_date, 'MM/DD'), '')));
  return c;
end $$;

-- 시세 받기: 직전 값보다 5% 넘게 튀는 값은 버림 (외부 시세 오류로 잘못된 금액 확정 방지)
-- 직전 값이 1시간 넘게 낡았으면 새 값을 그대로 받음
create or replace function public.refresh_live_prices()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare r record; v numeric; l public.live_prices;
begin
  for r in
    select f.id, f.symbol, h.status_code, h.content
      from public.price_fetches f join net._http_response h on h.id = f.id
  loop
    begin
      v := case when r.status_code = 200 then (r.content::jsonb ->> 'price')::numeric end;
      select * into l from public.live_prices where symbol = r.symbol;
      if v > 0 and (l.symbol is null or l.fetched_at < now() - interval '1 hour' or abs(v / l.krw_per_oz - 1) < 0.05) then
        insert into public.live_prices (symbol, krw_per_oz, fetched_at)
        values (r.symbol, v, now())
        on conflict (symbol) do update set krw_per_oz = excluded.krw_per_oz, fetched_at = excluded.fetched_at;
      end if;
    exception when others then null;
    end;
    delete from public.price_fetches where id = r.id;
  end loop;
  delete from public.price_fetches where created_at < now() - interval '10 minutes';
  insert into public.price_fetches (id, symbol)
  select net.http_get('https://api.gold-api.com/price/' || s || '/KRW'), s
    from unnest(array['XAU', 'XAG']) as s;
end $$;
revoke all on function public.refresh_live_prices() from public, anon, authenticated;
revoke all on function public.client_ip() from public, anon, authenticated;
revoke all on function public.norm_receipt(jsonb, text) from public, anon, authenticated;

select '영수증·송장·보안 설정 완료' as result;
