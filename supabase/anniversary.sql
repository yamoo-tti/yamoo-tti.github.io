-- =========================================================
-- 생일 · 기념일 쿠폰
--   · 회원이 '주문내역 > 내 혜택'에서 생일·기념일(월·일)을 등록 (선택 · 동의 필요)
--   · 그날 7일 전에 5,000원 쿠폰 자동 지급 (상품 20만원 이상 · 30일 안에 사용)
--   · 생일 1장 + 기념일 1장, 각각 1년에 한 번 (날짜를 바꿔도 그 해에는 다시 안 나감)
--   · 마케팅(혜택 문자) 동의한 회원에게만 오전 9시에 '(광고)' 문자 안내
--   membership.sql 실행 뒤에 실행하세요. 여러 번 실행해도 안전합니다.
-- =========================================================

-- 1) 설정 (관리자 > 시세 설정에서 수정)
alter table public.shop_info add column if not exists anniv_coupon int not null default 5000   check (anniv_coupon >= 0);
alter table public.shop_info add column if not exists anniv_min    int not null default 200000 check (anniv_min >= 0);
alter table public.shop_info add column if not exists anniv_days   int not null default 30     check (anniv_days between 1 and 365); -- 쿠폰 유효기간(일)
alter table public.shop_info add column if not exists anniv_lead   int not null default 7      check (anniv_lead between 0 and 30);  -- 며칠 전에 지급

-- 2) 회원 생일 · 기념일 (월-일만 저장, 연도는 받지 않음)
alter table public.profiles add column if not exists birthday        text check (birthday  ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
alter table public.profiles add column if not exists anniv_name      text check (char_length(anniv_name) <= 20);
alter table public.profiles add column if not exists anniv_date      text check (anniv_date ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
alter table public.profiles add column if not exists anniv_agreed_at timestamptz; -- 수집·이용 동의 시각

create unique index if not exists coupons_source_anniv on public.coupons (source) where source like 'bday:%' or source like 'anniv:%';

-- 3) 쿠폰 1장 지급 (+ 문자 안내)
create or replace function public.anniv_give(p_uid uuid, p_kind text, p_year int, p_label text, p_sms boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare si public.shop_info; pf public.profiles; src text := p_kind || ':' || p_year || ':' || p_uid;
begin
  select * into si from public.shop_info where id = 1;
  if coalesce(si.anniv_coupon, 0) <= 0 then return false; end if;
  if exists (select 1 from public.coupons where source = src) then return false; end if;
  select * into pf from public.profiles where id = p_uid;
  insert into public.coupons (user_id, name, amount, min_order, expires_at, source)
  values (p_uid, p_label || ' 축하 쿠폰', si.anniv_coupon, si.anniv_min, now() + make_interval(days => si.anniv_days), src);
  if p_sms and pf.marketing and coalesce(pf.phone, '') <> '' then
    perform public.send_sms(pf.phone, format(E'(광고)[금비 GOLD] %s님, %s을 미리 축하드려요!\n%s원 쿠폰을 드렸어요.\n상품 %s원 이상 · %s일 안에 사용 (골드바·실버바 제외)\n홈페이지 > 주문내역에서 확인하세요.\n수신거부: 홈페이지 주문내역 > 혜택 문자 끄기',
      coalesce(nullif(pf.name, ''), '회원'), p_label, public.fmt_won(si.anniv_coupon), public.fmt_won(si.anniv_min), si.anniv_days));
  end if;
  return true;
exception when unique_violation then return false;
end $$;
revoke all on function public.anniv_give(uuid, text, int, text, boolean) from public, anon, authenticated;

-- 4) 오늘부터 N일 안에 생일·기념일이 있는 회원에게 지급 (p_uid 를 주면 그 회원만)
create or replace function public.issue_anniv_coupons(p_uid uuid default null, p_sms boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare
  si public.shop_info; p record; d int; day date; md text; n int := 0;
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select * into si from public.shop_info where id = 1;
  if coalesce(si.anniv_coupon, 0) <= 0 then return 0; end if;
  for p in select id, birthday, anniv_name, anniv_date from public.profiles
            where role = 'member' and status = 'active' and anniv_agreed_at is not null
              and (birthday is not null or anniv_date is not null)
              and (p_uid is null or id = p_uid) loop
    for d in 0 .. si.anniv_lead loop
      day := today + d; md := to_char(day, 'MM-DD');
      -- 2월 29일은 평년에 2월 28일로
      if p.birthday = md or (p.birthday = '02-29' and md = '02-28' and to_char(day + 1, 'MM-DD') = '03-01') then
        if public.anniv_give(p.id, 'bday', extract(year from day)::int, '생일', p_sms) then n := n + 1; end if;
      end if;
      if p.anniv_date = md or (p.anniv_date = '02-29' and md = '02-28' and to_char(day + 1, 'MM-DD') = '03-01') then
        if public.anniv_give(p.id, 'anniv', extract(year from day)::int, coalesce(nullif(trim(p.anniv_name), ''), '기념일'), p_sms) then n := n + 1; end if;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.issue_anniv_coupons(uuid, boolean) from public, anon, authenticated;

-- 회원이 날짜를 등록한 직후: 7일 안이면 바로 지급 (화면에서 보므로 문자는 안 보냄)
create or replace function public.my_anniv_check()
returns int language sql volatile security definer set search_path = public as $$
  select case when auth.uid() is null then 0 else public.issue_anniv_coupons(auth.uid(), false) end;
$$;
revoke all on function public.my_anniv_check() from public, anon;
grant execute on function public.my_anniv_check() to authenticated;

-- 5) 매일 오전 9시(한국 시간)에 자동 실행
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'keumbi-anniv';
select cron.schedule('keumbi-anniv', '0 0 * * *', $job$select public.issue_anniv_coupons()$job$);

select jobname, schedule, active from cron.job where jobname = 'keumbi-anniv';
