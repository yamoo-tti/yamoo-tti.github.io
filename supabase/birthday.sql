-- =========================================================
-- 생일 쿠폰 (기념일은 악용 우려로 쓰지 않음)
--   · 회원이 '주문내역 > 내 혜택'에서 생일(월·일)을 등록 (선택 · 동의 필요 · 연도는 받지 않음)
--   · 생일 7일 전 오전 9시에 5,000원 쿠폰 자동 지급 (상품 20만원 이상 · 30일 안에 사용) · 1년에 1장
--   · 악용 방지: 등록하고 30일이 지나야 쿠폰 대상 / 한 번 등록한 생일은 본인이 바꿀 수 없음(관리자만) /
--               등록 시각은 서버가 기록 (화면에서 조작 불가)
--   · 마케팅(혜택 문자) 동의한 회원에게만 '(광고)' 문자 안내
--   membership.sql 실행 뒤에 실행하세요. 여러 번 실행해도 안전합니다. (예전 anniversary.sql 을 실행했어도 됨)
-- =========================================================

-- 1) 설정 (관리자 > 시세 설정에서 수정)
alter table public.shop_info add column if not exists anniv_coupon int not null default 5000   check (anniv_coupon >= 0);
alter table public.shop_info add column if not exists anniv_min    int not null default 200000 check (anniv_min >= 0);
alter table public.shop_info add column if not exists anniv_days   int not null default 30     check (anniv_days between 1 and 365); -- 쿠폰 유효기간(일)
alter table public.shop_info add column if not exists anniv_lead   int not null default 7      check (anniv_lead between 0 and 30);  -- 생일 며칠 전에 지급
alter table public.shop_info add column if not exists bday_wait    int not null default 30     check (bday_wait between 0 and 365);  -- 등록 후 며칠 지나야 대상

-- 2) 회원 생일 (월-일) · 등록 시각
alter table public.profiles add column if not exists birthday        text check (birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
alter table public.profiles add column if not exists anniv_agreed_at timestamptz; -- 생일 등록(수집 동의) 시각 — 서버가 기록
-- 기념일 칸은 쓰지 않으므로 지움 (예전 SQL을 실행했다면 입력된 기념일도 함께 삭제)
alter table public.profiles drop column if exists anniv_name;
alter table public.profiles drop column if exists anniv_date;

create unique index if not exists coupons_source_anniv on public.coupons (source) where source like 'bday:%' or source like 'anniv:%';

-- 생일 수정 막기 + 등록 시각은 서버가 정함
create or replace function public.profiles_birthday_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.birthday is null then
    new.anniv_agreed_at := null;                      -- 삭제(동의 철회)
  elsif old.birthday is null then
    new.anniv_agreed_at := now();                     -- 새로 등록 → 이때부터 30일 대기
  elsif new.birthday is distinct from old.birthday then
    if auth.uid() is not null and not public.is_admin() then
      raise exception '생일은 한 번 등록하면 바꿀 수 없어요. 고객센터(010-5287-8002)로 문의해 주세요';
    end if;
    new.anniv_agreed_at := old.anniv_agreed_at;       -- 관리자가 고친 경우 등록 시각 유지
  else
    new.anniv_agreed_at := old.anniv_agreed_at;       -- 다른 칸만 바꿀 때 등록 시각 조작 방지
  end if;
  return new;
end $$;
drop trigger if exists profiles_birthday_guard on public.profiles;
create trigger profiles_birthday_guard before update of birthday, anniv_agreed_at on public.profiles
  for each row execute function public.profiles_birthday_guard();
revoke all on function public.profiles_birthday_guard() from public, anon, authenticated;

-- 3) 쿠폰 1장 지급 (+ 문자 안내)
drop function if exists public.anniv_give(uuid, text, int, text, boolean);
create or replace function public.bday_give(p_uid uuid, p_year int, p_sms boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare si public.shop_info; pf public.profiles; src text := 'bday:' || p_year || ':' || p_uid;
begin
  select * into si from public.shop_info where id = 1;
  if coalesce(si.anniv_coupon, 0) <= 0 then return false; end if;
  if exists (select 1 from public.coupons where source = src) then return false; end if;
  select * into pf from public.profiles where id = p_uid;
  insert into public.coupons (user_id, name, amount, min_order, expires_at, source)
  values (p_uid, '생일 축하 쿠폰', si.anniv_coupon, si.anniv_min, now() + make_interval(days => si.anniv_days), src);
  if p_sms and pf.marketing and coalesce(pf.phone, '') <> '' then
    perform public.send_sms(pf.phone, format(E'(광고)[금비 GOLD] %s님, 생일을 미리 축하드려요!\n%s원 쿠폰을 드렸어요.\n상품 %s원 이상 · %s일 안에 사용 (골드바·실버바 제외)\n홈페이지 > 주문내역에서 확인하세요.\n수신거부: 홈페이지 주문내역 > 혜택 문자 끄기',
      coalesce(nullif(pf.name, ''), '회원'), public.fmt_won(si.anniv_coupon), public.fmt_won(si.anniv_min), si.anniv_days));
  end if;
  return true;
exception when unique_violation then return false;
end $$;
revoke all on function public.bday_give(uuid, int, boolean) from public, anon, authenticated;

-- 4) 매일: 생일이 오늘부터 N일 안이고, 등록한 지 30일이 지난 회원에게 지급
drop function if exists public.issue_anniv_coupons(uuid, boolean);
drop function if exists public.my_anniv_check();
create or replace function public.issue_bday_coupons()
returns int language plpgsql security definer set search_path = public as $$
declare
  si public.shop_info; p record; d int; day date; md text; n int := 0;
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select * into si from public.shop_info where id = 1;
  if coalesce(si.anniv_coupon, 0) <= 0 then return 0; end if;
  for p in select id, birthday, anniv_agreed_at from public.profiles
            where role = 'member' and status = 'active' and birthday is not null and anniv_agreed_at is not null loop
    for d in 0 .. si.anniv_lead loop
      day := today + d; md := to_char(day, 'MM-DD');
      -- 2월 29일 생일은 평년에 2월 28일로
      if (p.birthday = md or (p.birthday = '02-29' and md = '02-28' and to_char(day + 1, 'MM-DD') = '03-01'))
         and p.anniv_agreed_at <= day - make_interval(days => si.bday_wait) then
        if public.bday_give(p.id, extract(year from day)::int, true) then n := n + 1; end if;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.issue_bday_coupons() from public, anon, authenticated;

-- 5) 매일 오전 9시(한국 시간)에 자동 실행
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'keumbi-anniv';
select cron.schedule('keumbi-anniv', '0 0 * * *', $job$select public.issue_bday_coupons()$job$);

select jobname, schedule, active from cron.job where jobname = 'keumbi-anniv';
