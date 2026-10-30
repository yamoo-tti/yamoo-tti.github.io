-- =========================================================
-- 금비 GOLD · Supabase 초기 설정
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다.
-- =========================================================

-- 1) 회원 프로필 ----------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  email         text not null,
  name          text,
  phone         text,
  role          text not null default 'member'  check (role   in ('member','admin')),
  grade         text not null default 'basic'   check (grade  in ('basic','silver','gold','vip')),
  status        text not null default 'active'  check (status in ('active','suspended','withdrawn')),
  marketing     boolean not null default false,
  memo          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create index if not exists profiles_created_idx on public.profiles (created_at desc);
alter table public.profiles enable row level security;

-- 관리자 여부 (활성 상태의 admin 만 인정)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- 2) 관리자 변경 이력 -----------------------------------------
create table if not exists public.admin_logs (
  id         bigint generated always as identity primary key,
  admin_id   uuid references public.profiles(id) on delete set null,
  target_id  uuid references public.profiles(id) on delete cascade,
  changes    jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.admin_logs enable row level security;
drop policy if exists "logs_admin_read" on public.admin_logs;
create policy "logs_admin_read" on public.admin_logs for select using (public.is_admin());

-- 3) 권한 컬럼 보호 + 이력 기록 트리거 --------------------------
--  · 일반 회원은 이름/연락처/마케팅 동의/최근 로그인만 바꿀 수 있음
--  · 관리자도 자기 자신의 권한·상태는 바꿀 수 없음 (실수로 잠기는 것 방지)
--  · SQL Editor(auth.uid() 없음)에서는 제한 없음 → 첫 관리자 지정용
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  diff jsonb := '{}'::jsonb;
  uid  uuid  := auth.uid();
begin
  if uid is not null then
    if not public.is_admin() then
      if new.role is distinct from old.role or new.grade is distinct from old.grade
         or new.status is distinct from old.status or new.memo is distinct from old.memo
         or new.email is distinct from old.email then
        raise exception '권한이 없습니다';
      end if;
    elsif new.id = uid and (new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception '본인 계정의 권한·상태는 변경할 수 없습니다';
    end if;
  end if;

  if new.name      is distinct from old.name      then diff := diff || jsonb_build_object('name',      jsonb_build_array(old.name, new.name)); end if;
  if new.phone     is distinct from old.phone     then diff := diff || jsonb_build_object('phone',     jsonb_build_array(old.phone, new.phone)); end if;
  if new.role      is distinct from old.role      then diff := diff || jsonb_build_object('role',      jsonb_build_array(old.role, new.role)); end if;
  if new.grade     is distinct from old.grade     then diff := diff || jsonb_build_object('grade',     jsonb_build_array(old.grade, new.grade)); end if;
  if new.status    is distinct from old.status    then diff := diff || jsonb_build_object('status',    jsonb_build_array(old.status, new.status)); end if;
  if new.marketing is distinct from old.marketing then diff := diff || jsonb_build_object('marketing', jsonb_build_array(old.marketing, new.marketing)); end if;
  if new.memo      is distinct from old.memo      then diff := diff || jsonb_build_object('memo',      jsonb_build_array(old.memo, new.memo)); end if;

  if diff <> '{}'::jsonb and uid is not null and uid <> new.id then
    insert into public.admin_logs (admin_id, target_id, changes) values (uid, new.id, diff);
  end if;

  if diff <> '{}'::jsonb then new.updated_at := now(); end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- 4) 회원가입 시 프로필 자동 생성 -------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, phone, marketing)
  values (
    new.id, new.email,
    left(new.raw_user_meta_data->>'name', 40),
    left(new.raw_user_meta_data->>'phone', 20),
    coalesce((new.raw_user_meta_data->>'marketing')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) 시세 마진 설정 (관리자 페이지에서 조정) --------------------
create table if not exists public.price_settings (
  id            int primary key default 1 check (id = 1),
  -- 기본값은 2026.10.29 국내 실거래 시세에 맞춘 값
  gold_buy_pct  numeric not null default 7.2,   -- 24K 살 때: 국제시세 원화 환산가 대비 +% (부가세 별도 적용)
  gold_sell_pct numeric not null default 0,     -- 24K 팔 때: 국제시세 원화 환산가 대비 +%
  k18_factor    numeric not null default 0.735, -- 18K 팔 때 = 24K 팔 때 × 계수
  k14_factor    numeric not null default 0.57,  -- 14K 팔 때 = 24K 팔 때 × 계수
  pt_buy_pct    numeric not null default 6.8,
  pt_sell_pct   numeric not null default -4.6,
  ag_buy_pct    numeric not null default 2.9,
  ag_sell_pct   numeric not null default -3.8,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null
);
insert into public.price_settings (id) values (1) on conflict (id) do nothing;
alter table public.price_settings enable row level security;

drop policy if exists "settings_public_read" on public.price_settings;
create policy "settings_public_read" on public.price_settings for select using (true);
drop policy if exists "settings_admin_update" on public.price_settings;
create policy "settings_admin_update" on public.price_settings
  for update using (public.is_admin()) with check (public.is_admin());

-- =========================================================
-- 6) 첫 관리자 지정 — 홈페이지에서 회원가입을 먼저 한 뒤,
--    아래 이메일을 본인 것으로 바꿔서 이 한 줄만 다시 실행하세요.
-- update public.profiles set role = 'admin' where email = 'you@example.com';
-- =========================================================
