-- =========================================================
-- 17) 주문 메일: 손님에게 '구매내역서', 사장님에게 '주문내역서' (구글 지메일로 발송)
--     메일 안 [구매내역 보기] 링크를 누르면 휴대폰 번호 없이 바로 주문 화면이 열림
--     여러 번 실행해도 안전합니다.
--     지메일 웹앱 주소(gmail_script_url)를 넣기 전까지는 메일을 보내지 않고 건너뜁니다.
-- =========================================================
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- 주문내역서 받을 메일 · 사이트 주소 (도메인 사면 site_url만 바꾸면 됨)
alter table public.shop_info add column if not exists owner_email text not null default 'wnsdn9203@naver.com';
alter table public.shop_info add column if not exists site_url text not null default 'https://keumbi.wnsdn9203.workers.dev';

-- 주문별 메일 기록 + 링크용 열쇠 (주문 표는 건드리지 않음)
create table if not exists public.order_mails (
  order_id    bigint primary key references public.orders on delete cascade,
  token       text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  email       text,
  owner_at    timestamptz,
  customer_at timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.order_mails enable row level security;
drop policy if exists "order_mails_admin_read" on public.order_mails;
create policy "order_mails_admin_read" on public.order_mails for select using (public.is_admin());
grant select on public.order_mails to authenticated;

-- 새 주문이 들어오면 기록 칸 만들기
create or replace function public.orders_mail_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.order_mails (order_id) values (new.id) on conflict do nothing;
  return new;
exception when others then
  raise warning '주문 메일 준비 실패: %', sqlerrm;
  return new;
end $$;
drop trigger if exists orders_mail_row on public.orders;
create trigger orders_mail_row after insert on public.orders for each row execute function public.orders_mail_row();
revoke all on function public.orders_mail_row() from public, anon, authenticated;

-- 글자 안전하게 (손님이 쓴 글이 메일 모양을 바꾸지 못하게)
create or replace function public.html_esc(t text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

-- 메일 보내기 (구글 Apps Script 웹앱). 하루 90통 · 같은 주소 하루 10통까지 (지메일 무료 한도 100통)
create table if not exists public.email_log (id bigint generated always as identity primary key, to_addr text not null, created_at timestamptz not null default now());
create index if not exists email_log_t on public.email_log (created_at);
create index if not exists email_log_a on public.email_log (to_addr, created_at);
alter table public.email_log enable row level security;

create or replace function public.send_email(p_to text, p_subject text, p_html text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare si public.shop_info; u text; k text; t text := lower(trim(coalesce(p_to, '')));
begin
  if t !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return false; end if;
  select decrypted_secret into u from vault.decrypted_secrets where name = 'gmail_script_url';
  select decrypted_secret into k from vault.decrypted_secrets where name = 'gmail_script_secret';
  if u is null or k is null then return false; end if;
  select * into si from public.shop_info where id = 1;
  if (select count(*) from public.email_log where created_at > now() - interval '24 hours') >= 90 then
    raise warning '메일 발송 한도(하루 90통) 초과'; return false;
  end if;
  if t <> lower(si.owner_email)
     and (select count(*) from public.email_log where to_addr = t and created_at > now() - interval '24 hours') >= 10 then
    return false;
  end if;
  insert into public.email_log (to_addr) values (t);
  perform net.http_post(
    url := u,
    body := jsonb_build_object('secret', k, 'to', t, 'subject', p_subject, 'html', p_html, 'replyTo', si.owner_email),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000);
  return true;
exception when others then
  raise warning '메일 발송 실패: %', sqlerrm;
  return false;
end $$;
revoke all on function public.send_email(text, text, text) from public, anon, authenticated;

-- 메일 내용 (p_owner = true 면 사장님용 주문내역서, 아니면 손님용 구매내역서)
create or replace function public.order_mail_html(o public.orders, m public.order_mails, p_owner boolean)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  si public.shop_info; it jsonb; link text; rows text := ''; info text := ''; extra text := ''; btn text; st text; rc text;
  td  text := 'padding:10px 0;border-bottom:1px solid #eee;vertical-align:top';
  tdr text := 'padding:10px 0;border-bottom:1px solid #eee;vertical-align:top;text-align:right;white-space:nowrap';
  th  text := 'padding:9px 14px 9px 0;border-bottom:1px solid #f0f0f0;color:#888;font-weight:400;text-align:left;white-space:nowrap;vertical-align:top';
  tv  text := 'padding:9px 0;border-bottom:1px solid #f0f0f0;vertical-align:top';
begin
  select * into si from public.shop_info where id = 1;
  link := si.site_url || '/order-done?code=' || o.code || '&t=' || m.token;

  -- 상품 목록
  if jsonb_typeof(o.items) = 'array' and jsonb_array_length(o.items) > 0 then
    for it in select value from jsonb_array_elements(o.items) loop
      rows := rows || format('<tr><td style="%s">%s × %s</td><td style="%s">%s</td></tr>',
        td, public.html_esc(it ->> 'name'), public.html_esc(it ->> 'qty'), tdr,
        coalesce(public.fmt_won((it ->> 'subtotal')::numeric) || '원', '-'));
    end loop;
  else
    rows := format('<tr><td style="%s">%s × %s</td><td style="%s">%s</td></tr>',
      td, public.html_esc(o.product_name), o.qty, tdr,
      coalesce(public.fmt_won(o.final_price - coalesce(o.shipping_fee, 0)) || '원', '-'));
  end if;
  if coalesce(o.shipping_fee, 0) > 0 then
    rows := rows || format('<tr><td style="%s">택배비 (보험 등기)</td><td style="%s">%s원</td></tr>', td, tdr, public.fmt_won(o.shipping_fee));
  end if;
  rows := rows || format('<tr><td style="padding:14px 0 4px;font-weight:700">합계</td><td style="padding:14px 0 4px;text-align:right;white-space:nowrap;font-weight:700;font-size:19px;color:#9c7629">%s</td></tr>',
    coalesce(public.fmt_won(o.final_price) || '원', '금액 확정 전'));

  st := case o.status when 'new' then '접수' when 'confirmed' then '입금 대기' when 'paid' then '입금 확인'
          when 'ready' then case when o.receive = 'delivery' then '발송' else '수령 준비' end
          when 'done' then '완료' when 'canceled' then '취소' else o.status end;

  -- 주문 정보
  info := format('<tr><th style="%s">접수번호</th><td style="%s"><b>%s</b></td></tr>', th, tv, o.code)
       || format('<tr><th style="%s">주문일시</th><td style="%s">%s</td></tr>', th, tv, to_char(o.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'))
       || format('<tr><th style="%s">진행 상태</th><td style="%s">%s</td></tr>', th, tv, st);
  if p_owner then
    rc := case o.receipt ->> 'type'
            when 'personal' then '현금영수증 (소득공제) ' || coalesce(o.receipt ->> 'no', '')
            when 'business' then '현금영수증 (지출증빙) ' || coalesce(o.receipt ->> 'no', '')
            when 'invoice'  then '세금계산서 · ' || concat_ws(' / ', o.receipt ->> 'company', o.receipt ->> 'ceo', o.receipt ->> 'no', o.receipt ->> 'email')
            else '신청 안 함' end;
    info := info
       || format('<tr><th style="%s">주문자</th><td style="%s"><b>%s</b></td></tr>', th, tv, public.html_esc(o.name))
       || format('<tr><th style="%s">휴대폰</th><td style="%s"><a href="tel:%s" style="color:#16140f">%s</a></td></tr>', th, tv, o.phone, o.phone)
       || format('<tr><th style="%s">이메일</th><td style="%s">%s</td></tr>', th, tv, coalesce(public.html_esc(m.email), '-'))
       || format('<tr><th style="%s">수령 방법</th><td style="%s">%s</td></tr>', th, tv, case when o.receive = 'delivery' then '안심 택배' else '매장 방문 수령' end)
       || case when o.receive = 'delivery' then format('<tr><th style="%s">배송 주소</th><td style="%s">%s</td></tr>', th, tv, public.html_esc(o.address)) else '' end
       || format('<tr><th style="%s">요청 사항</th><td style="%s">%s</td></tr>', th, tv, coalesce(nullif(public.html_esc(o.note), ''), '-'))
       || format('<tr><th style="%s">영수증</th><td style="%s">%s</td></tr>', th, tv, public.html_esc(rc))
       || case when o.pay_deadline is not null then format('<tr><th style="%s">입금 기한</th><td style="%s">%s (지나면 자동 취소)</td></tr>', th, tv, to_char(o.pay_deadline at time zone 'Asia/Seoul', 'MM/DD HH24:MI')) else '' end;
    btn := format('<a href="%s/admin" style="display:block;text-align:center;background:#16140f;color:#ecd08a;padding:15px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">관리자 페이지에서 처리하기</a>'
               || '<p style="text-align:center;margin:12px 0 0;font-size:13px"><a href="%s" style="color:#888">손님에게 보이는 화면 보기</a></p>',
               si.site_url, public.html_esc(link));
  else
    info := info
       || format('<tr><th style="%s">수령 방법</th><td style="%s">%s</td></tr>', th, tv, case when o.receive = 'delivery' then '안심 택배 (보험 등기)' else '매장 방문 수령' end)
       || case when o.receive = 'delivery' then format('<tr><th style="%s">배송 주소</th><td style="%s">%s</td></tr>', th, tv, public.html_esc(o.address)) else '' end;
    if o.status = 'confirmed' and o.final_price is not null then
      extra := format(
        '<div style="margin:22px 0 0;padding:18px;border:1px solid #e8dcc0;background:#fffaf0;border-radius:10px;line-height:1.8">'
        || '<b style="font-size:15px">입금 안내</b><br>'
        || '입금하실 금액 <b style="color:#9c7629">%s원</b><br>'
        || '입금 계좌 <b>%s %s</b> (예금주 %s)<br>'
        || '<b style="color:#c0392b">%s까지</b> 입금되지 않으면 주문이 자동 취소돼요.<br>'
        || '<span style="color:#888;font-size:13px">입금자명은 주문하신 분 이름과 같게 해 주세요.</span></div>',
        public.fmt_won(o.final_price), public.html_esc(si.bank_name), public.html_esc(si.bank_account), public.html_esc(si.bank_holder),
        to_char(o.pay_deadline at time zone 'Asia/Seoul', 'MM/DD HH24:MI'));
    elsif o.final_price is null then
      extra := '<p style="margin:22px 0 0;padding:16px;background:#f7f7f7;border-radius:10px;line-height:1.7">지금은 금액이 확정되지 않았어요. 매장에서 확정 금액과 입금 계좌를 곧 연락드릴게요.</p>';
    end if;
    extra := extra || '<p style="margin:16px 0 0;color:#888;font-size:13px;line-height:1.7">· 금·은 시세 상품은 금액 확정·입금 후 단순 변심에 의한 취소·반품이 어려워요.<br>· 진행 상황(입금 확인·발송)은 아래 버튼에서 언제든 확인할 수 있어요.</p>';
    btn := format('<a href="%s" style="display:block;text-align:center;background:#16140f;color:#ecd08a;padding:15px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">구매내역 보기</a>', public.html_esc(link));
  end if;

  return format(
    '<div style="background:#f3f0e8;padding:28px 12px;font-family:''Apple SD Gothic Neo'',''Malgun Gothic'',''맑은 고딕'',sans-serif;color:#16140f">'
    || '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden">'
    || '<div style="background:#16140f;padding:20px 26px;font-size:21px;font-weight:700;color:#ecd08a;letter-spacing:.5px">금비 <span style="font-weight:400">GOLD</span></div>'
    || '<div style="padding:26px">'
    || '<h1 style="margin:0 0 6px;font-size:23px">%s</h1>'
    || '<p style="margin:0 0 22px;color:#666;line-height:1.6">%s</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%%;border-collapse:collapse;font-size:14px;margin-bottom:22px">%s</table>'
    || '<p style="margin:0 0 4px;font-weight:700;font-size:15px">주문 상품</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%%;border-collapse:collapse;font-size:14px">%s</table>'
    || '%s'
    || '<div style="margin-top:26px">%s</div>'
    || '</div>'
    || '<div style="padding:18px 26px;background:#faf8f3;color:#999;font-size:12px;line-height:1.7">'
    || '%s상호 금비 · 대표 김신애 · 사업자등록번호 101-12-25419 · 통신판매업신고 제2021-서울종로-1219호<br>'
    || '서울특별시 종로구 율곡로10길 105 디아망 빌딩 2층 · 고객센터 010-5287-8002</div>'
    || '</div></div>',
    case when p_owner then '주문내역서' else '구매내역서' end,
    case when p_owner then '홈페이지에서 새 주문이 들어왔어요.'
         else public.html_esc(o.name) || '님, 금비 GOLD에서 주문해 주셔서 감사합니다.' end,
    info, rows, extra, btn,
    case when p_owner then '' else '이 메일에 답장하시면 매장으로 전달돼요.<br>' end);
end $$;
revoke all on function public.order_mail_html(public.orders, public.order_mails, boolean) from public, anon, authenticated;

-- 한 주문의 메일 보내기 (이미 보낸 건 다시 안 보냄)
create or replace function public.mail_order(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; m public.order_mails; si public.shop_info;
begin
  select * into o from public.orders where id = p_id;
  select * into m from public.order_mails where order_id = p_id for update;
  if o.id is null or m.order_id is null then return; end if;
  select * into si from public.shop_info where id = 1;
  if m.customer_at is null and m.email is not null then
    if public.send_email(m.email, '[금비 GOLD] 구매내역서 (접수번호 ' || o.code || ')', public.order_mail_html(o, m, false)) then
      update public.order_mails set customer_at = now() where order_id = p_id;
    end if;
  end if;
  if m.owner_at is null then
    if public.send_email(si.owner_email,
         '[금비] 주문내역서 ' || o.code || ' · ' || o.name || ' · ' || coalesce(public.fmt_won(o.final_price) || '원', '금액 미확정'),
         public.order_mail_html(o, m, true)) then
      update public.order_mails set owner_at = now() where order_id = p_id;
    end if;
  end if;
end $$;
revoke all on function public.mail_order(bigint) from public, anon, authenticated;

-- 주문 직후 홈페이지가 부름: 손님 이메일 저장 + 두 메일 발송
-- (주문 후 30분 안, 접수번호·휴대폰이 맞을 때만 · 회원은 이메일을 비워도 가입 이메일로 보냄)
create or replace function public.send_order_receipt(p_code text, p_phone text, p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.orders; em text := lower(trim(coalesce(p_email, '')));
begin
  select * into o from public.orders
   where code = upper(trim(p_code)) and phone = public.clean_phone(p_phone) and created_at > now() - interval '30 minutes';
  if o.id is null then return false; end if;
  if em = '' and auth.uid() is not null and o.user_id = auth.uid() then
    select lower(email) into em from auth.users where id = auth.uid();
  end if;
  if em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(em) > 100 then em := null; end if;
  update public.order_mails set email = coalesce(email, em) where order_id = o.id;
  perform public.mail_order(o.id);
  return true;
end $$;
revoke all on function public.send_order_receipt(text, text, text) from public;
grant execute on function public.send_order_receipt(text, text, text) to anon, authenticated;

-- 혹시 홈페이지가 못 불렀을 때를 대비해 1분마다: 2분 지난 새 주문의 사장님 메일 보내기
create or replace function public.mail_pending_orders()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select m.order_id from public.order_mails m
     where m.owner_at is null and m.created_at < now() - interval '2 minutes' and m.created_at > now() - interval '1 day'
     order by m.created_at limit 20
  loop
    perform public.mail_order(r.order_id);
  end loop;
end $$;
revoke all on function public.mail_pending_orders() from public, anon, authenticated;
select cron.schedule('keumbi-order-mail', '* * * * *', 'select public.mail_pending_orders()');

-- 메일 링크로 주문 보기 (휴대폰 번호 없이, 링크의 열쇠가 맞을 때만)
create or replace function public.order_view(p_code text, p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', o.code,
    'product', case when jsonb_array_length(coalesce(o.items, '[]')) > 1 then o.product_name else o.product_name || ' × ' || o.qty end,
    'items', o.items, 'total', o.final_price, 'shipping_fee', o.shipping_fee,
    'deadline', o.pay_deadline, 'locked_at', o.price_locked_at, 'status', o.status, 'receive', o.receive,
    'courier', o.courier, 'tracking_no', o.tracking_no,
    'bank_name', si.bank_name, 'bank_account', si.bank_account, 'bank_holder', si.bank_holder)
    from public.orders o
    join public.order_mails m on m.order_id = o.id
    cross join public.shop_info si
   where si.id = 1 and o.code = upper(trim(p_code)) and char_length(coalesce(p_token, '')) = 32 and m.token = p_token;
$$;
revoke all on function public.order_view(text, text) from public;
grant execute on function public.order_view(text, text) to anon, authenticated;

-- 지메일 웹앱 주소·비밀번호는 공개 저장소에 올리지 않고 SQL Editor에서 따로 넣습니다
--   vault 이름: gmail_script_url, gmail_script_secret

select '주문 메일 설정 완료' as result, (select owner_email from public.shop_info where id = 1) as owner_email;
