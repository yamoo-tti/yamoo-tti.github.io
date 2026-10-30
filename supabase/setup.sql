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

-- 6) 변경 이력 확장: 회원 외에 주문·매입·상품·공지 변경도 기록 --------
alter table public.admin_logs add column if not exists entity text not null default 'member';
alter table public.admin_logs add column if not exists ref text;

-- 관리자가 행을 수정하면 바뀐 칸만 이력에 남기고 updated_at 갱신
create or replace function public.track_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  d jsonb := '{}'::jsonb;
  k text;
begin
  for k in select jsonb_object_keys(n) loop
    if k not in ('updated_at', 'created_at') and (o -> k) is distinct from (n -> k) then
      d := d || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
    end if;
  end loop;
  if d <> '{}'::jsonb then
    new.updated_at := now();
    if auth.uid() is not null then
      insert into public.admin_logs (admin_id, entity, ref, changes)
      values (auth.uid(), tg_argv[0], coalesce(n ->> 'code', n ->> 'name', n ->> 'title'), d);
    end if;
  end if;
  return new;
end $$;

-- 7) 상품 ------------------------------------------------------
--  가격 = 골드바·카드형: 순금 살 때 시세(g당) × 중량 × (1 + 프리미엄%)
--         악세사리: 18K/14K 팔 때 시세(g당) × 1.3 × 중량 + 공임
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('bar','zodiac','silver','accessory')),
  name        text not null check (char_length(name) between 1 and 80),
  weight_g    numeric not null check (weight_g > 0),
  karat       text not null default '24K' check (karat in ('24K','18K','14K')),
  category    text check (category in ('necklace','ring','bracelet','earring')),
  premium_pct numeric not null default 0,
  labor       numeric not null default 0,
  img         text,
  tag         text check (char_length(tag) <= 12),
  sort        int not null default 0,
  visible     boolean not null default true,
  sold_out    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.products enable row level security;
drop policy if exists "products_read" on public.products;
create policy "products_read" on public.products for select using (visible or public.is_admin());
drop policy if exists "products_admin" on public.products;
create policy "products_admin" on public.products for all using (public.is_admin()) with check (public.is_admin());
drop trigger if exists products_track on public.products;
create trigger products_track before update on public.products for each row execute function public.track_changes('product');

-- 처음 한 번만: 지금 홈페이지에 있는 상품을 그대로 등록
do $$ begin
  if not exists (select 1 from public.products) then
    insert into public.products (kind, name, weight_g, karat, category, premium_pct, labor, img, tag, sort) values
      ('bar', 'GBK 순금 골드바 1g',      1,     '24K', null, 8,   0, 'gbk/bar-1g.webp',     '입문용',   10),
      ('bar', 'GBK 순금 골드바 3.75g',   3.75,  '24K', null, 4,   0, 'gbk/bar-3_75g.webp',  'BEST',     20),
      ('bar', 'GBK 순금 골드바 10g',     10,    '24K', null, 3,   0, 'gbk/bar-10g.webp',    null,       30),
      ('bar', 'GBK 순금 골드바 18.75g',  18.75, '24K', null, 2.5, 0, 'gbk/bar-18_75g.webp', null,       40),
      ('bar', 'GBK 순금 골드바 37.5g',   37.5,  '24K', null, 2,   0, 'gbk/bar-37_5g.webp',  '선물 추천', 50),
      ('bar', 'GBK 순금 골드바 100g',    100,   '24K', null, 1.5, 0, 'gbk/bar-100g.webp',   null,       60),
      ('zodiac', '쥐띠',     1, '24K', null, 10, 0, 'gbk/zodiac-10.webp', null, 10),
      ('zodiac', '소띠',     1, '24K', null, 10, 0, 'gbk/zodiac-02.webp', null, 20),
      ('zodiac', '호랑이띠', 1, '24K', null, 10, 0, 'gbk/zodiac-09.webp', null, 30),
      ('zodiac', '토끼띠',   1, '24K', null, 10, 0, 'gbk/zodiac-06.webp', null, 40),
      ('zodiac', '용띠',     1, '24K', null, 10, 0, 'gbk/zodiac-07.webp', null, 50),
      ('zodiac', '뱀띠',     1, '24K', null, 10, 0, 'gbk/zodiac-04.webp', null, 60),
      ('zodiac', '말띠',     1, '24K', null, 10, 0, 'gbk/zodiac-05.webp', null, 70),
      ('zodiac', '양띠',     1, '24K', null, 10, 0, 'gbk/zodiac-01.webp', null, 80),
      ('zodiac', '원숭이띠', 1, '24K', null, 10, 0, 'gbk/zodiac-11.webp', null, 90),
      ('zodiac', '닭띠',     1, '24K', null, 10, 0, 'gbk/zodiac-08.webp', null, 100),
      ('zodiac', '개띠',     1, '24K', null, 10, 0, 'gbk/zodiac-13.webp', null, 110),
      ('zodiac', '돼지띠',   1, '24K', null, 10, 0, 'gbk/zodiac-12.webp', null, 120),
      ('zodiac', '부엉이',   1, '24K', null, 10, 0, 'gbk/zodiac-03.webp', '스페셜', 130),
      ('accessory', '오벌 링 펜던트 목걸이', 3.2, '14K', 'necklace', 0, 89000,  'necklace-oval.jpg',   'NEW',  10),
      ('accessory', '웨이브 볼드 링',        5.1, '18K', 'ring',     0, 120000, 'ring-mirror.jpg',     'BEST', 20),
      ('accessory', '앵커 체인 팔찌',        6.8, '14K', 'bracelet', 0, 98000,  'bracelet-chain.jpg',  null,   30),
      ('accessory', '트위스트 후프 귀걸이',  2.4, '14K', 'earring',  0, 69000,  'earring-hoop.jpg',    'BEST', 40),
      ('accessory', '바 펜던트 목걸이',      2.9, '18K', 'necklace', 0, 95000,  'pendant.jpg',         null,   50),
      ('accessory', '미니 큐빅 반지 3종',    1.6, '14K', 'ring',     0, 59000,  'ring-box.jpg',        null,   60),
      ('accessory', '참 체인 팔찌',          1.9, '14K', 'bracelet', 0, 64000,  'bracelet-charm.jpg',  'NEW',  70),
      ('accessory', '스네이크 체인 목걸이',  4.3, '18K', 'necklace', 0, 85000,  'necklace-blazer.jpg', null,   80);
  end if;
end $$;

-- 7-1) 실버바 · 은 그래뉼 (은 살 때 시세 × 중량 × (1+프리미엄%))
alter table public.products drop constraint if exists products_kind_check;
alter table public.products add constraint products_kind_check check (kind in ('bar','zodiac','silver','accessory'));
do $$ begin
  if not exists (select 1 from public.products where kind = 'silver') then
    insert into public.products (kind, name, weight_g, karat, premium_pct, img, tag, sort) values
      ('silver', '실버바 100g',     100,  '24K', 8, 'silver/bar-100g.svg', '입문용', 10),
      ('silver', '실버바 1kg',      1000, '24K', 3, 'silver/bar-1kg.svg',  'BEST',   20),
      ('silver', '은 그래뉼 100g',  100,  '24K', 6, 'silver/granule.svg',  null,     30),
      ('silver', '은 그래뉼 500g',  500,  '24K', 4, 'silver/granule.svg',  null,     40),
      ('silver', '은 그래뉼 1kg',   1000, '24K', 3, 'silver/granule.svg',  null,     50);
  end if;
end $$;

-- 8) 구매 문의 · 금 매입 접수 ----------------------------------
--  고객은 아래 submit_* 함수로만 접수할 수 있고(직접 조회·수정 불가),
--  관리자만 목록을 보고 상태를 바꿀 수 있습니다.
create table if not exists public.orders (
  id           bigint generated always as identity primary key,
  code         text not null unique,
  user_id      uuid references auth.users on delete set null,
  product_id   uuid references public.products on delete set null,
  product_name text not null,
  qty          int not null default 1 check (qty between 1 and 99),
  quoted_price numeric,
  name         text not null,
  phone        text not null,
  receive      text not null default 'visit' check (receive in ('visit','delivery')),
  address      text,
  note         text,
  status       text not null default 'new' check (status in ('new','confirmed','paid','ready','done','canceled')),
  final_price  numeric,
  admin_memo   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists orders_created_idx on public.orders (created_at desc);
alter table public.orders enable row level security;
drop policy if exists "orders_admin_read" on public.orders;
create policy "orders_admin_read" on public.orders for select using (public.is_admin());
drop policy if exists "orders_admin_update" on public.orders;
create policy "orders_admin_update" on public.orders for update using (public.is_admin()) with check (public.is_admin());
drop trigger if exists orders_track on public.orders;
create trigger orders_track before update on public.orders for each row execute function public.track_changes('order');

create table if not exists public.sell_requests (
  id           bigint generated always as identity primary key,
  code         text not null unique,
  user_id      uuid references auth.users on delete set null,
  items        text not null,
  karat        text not null default 'unknown' check (karat in ('24K','18K','14K','unknown')),
  weight_g     numeric check (weight_g is null or weight_g > 0),
  method       text not null default 'visit' check (method in ('visit','delivery')),
  visit_date   date,
  name         text not null,
  phone        text not null,
  note         text,
  status       text not null default 'new' check (status in ('new','scheduled','received','done','canceled')),
  final_amount numeric,
  admin_memo   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sell_created_idx on public.sell_requests (created_at desc);
alter table public.sell_requests enable row level security;
drop policy if exists "sell_admin_read" on public.sell_requests;
create policy "sell_admin_read" on public.sell_requests for select using (public.is_admin());
drop policy if exists "sell_admin_update" on public.sell_requests;
create policy "sell_admin_update" on public.sell_requests for update using (public.is_admin()) with check (public.is_admin());
drop trigger if exists sell_track on public.sell_requests;
create trigger sell_track before update on public.sell_requests for each row execute function public.track_changes('sell');

-- 접수번호: O(주문)/S(매입) + 날짜 + 5자리. 예) O261030-7A2F9
create or replace function public.new_code(prefix text)
returns text language sql volatile as $$
  select prefix || to_char(now() at time zone 'Asia/Seoul', 'YYMMDD') || '-' ||
         upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
$$;

-- 같은 연락처로 10분에 3건 넘게 접수되면 막기 (장난 접수 방지)
create or replace function public.check_spam(p_table text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare c int;
begin
  execute format('select count(*) from public.%I where phone = $1 and created_at > now() - interval ''10 minutes''', p_table)
    into c using p_phone;
  if c >= 3 then raise exception '잠시 후 다시 시도해 주세요'; end if;
end $$;

create or replace function public.clean_phone(p text)
returns text language sql immutable as $$ select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') $$;

create or replace function public.submit_order(
  p_product_id uuid, p_qty int, p_name text, p_phone text,
  p_receive text, p_address text, p_note text, p_quoted numeric
) returns text language plpgsql security definer set search_path = public as $$
declare pr public.products; c text; ph text := public.clean_phone(p_phone);
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
  c := public.new_code('O');
  insert into public.orders (code, user_id, product_id, product_name, qty, quoted_price, name, phone, receive, address, note)
  values (c, auth.uid(), pr.id, case when pr.kind = 'zodiac' then 'GBK 카드형 골드바 1g (' || pr.name || ')' else pr.name end,
          p_qty, p_quoted, trim(p_name), ph, p_receive,
          left(nullif(trim(p_address), ''), 200), left(nullif(trim(p_note), ''), 500));
  return c;
end $$;

create or replace function public.submit_sell(
  p_items text, p_karat text, p_weight numeric, p_method text, p_visit_date date,
  p_name text, p_phone text, p_note text
) returns text language plpgsql security definer set search_path = public as $$
declare c text; ph text := public.clean_phone(p_phone);
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
  return c;
end $$;

-- 고객 접수 조회: 접수번호 + 연락처가 모두 맞아야 결과를 돌려줌
create or replace function public.lookup_request(p_code text, p_phone text)
returns table (kind text, title text, status text, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select 'order', o.product_name || ' × ' || o.qty, o.status, o.created_at, o.updated_at
    from public.orders o where o.code = upper(trim(p_code)) and o.phone = public.clean_phone(p_phone)
  union all
  select 'sell', s.items, s.status, s.created_at, s.updated_at
    from public.sell_requests s where s.code = upper(trim(p_code)) and s.phone = public.clean_phone(p_phone);
$$;

revoke all on function public.submit_order(uuid, int, text, text, text, text, text, numeric) from public;
revoke all on function public.submit_sell(text, text, numeric, text, date, text, text, text) from public;
revoke all on function public.lookup_request(text, text) from public;
revoke all on function public.check_spam(text, text) from public, anon, authenticated;
grant execute on function public.submit_order(uuid, int, text, text, text, text, text, numeric) to anon, authenticated;
grant execute on function public.submit_sell(text, text, numeric, text, date, text, text, text) to anon, authenticated;
grant execute on function public.lookup_request(text, text) to anon, authenticated;

-- 9) 공지사항 · 이벤트 · 시황 ----------------------------------
create table if not exists public.notices (
  id         bigint generated always as identity primary key,
  category   text not null default 'notice' check (category in ('notice','event','market')),
  title      text not null check (char_length(title) between 1 and 120),
  body       text,
  pinned     boolean not null default false,
  visible    boolean not null default true,
  author_id  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notices_created_idx on public.notices (created_at desc);
alter table public.notices enable row level security;
drop policy if exists "notices_read" on public.notices;
create policy "notices_read" on public.notices for select using (visible or public.is_admin());
drop policy if exists "notices_admin" on public.notices;
create policy "notices_admin" on public.notices for all using (public.is_admin()) with check (public.is_admin());
drop trigger if exists notices_track on public.notices;
create trigger notices_track before update on public.notices for each row execute function public.track_changes('notice');

-- 테이블 접근 권한 (실제로 누가 무엇을 볼 수 있는지는 위 보안 규칙(RLS)이 결정)
grant select on public.products, public.notices, public.price_settings to anon, authenticated;
grant insert, update, delete on public.products, public.notices to authenticated;
grant select, update on public.orders, public.sell_requests, public.profiles, public.price_settings to authenticated;
grant select on public.admin_logs to authenticated;

-- =========================================================
-- 10) 첫 관리자 지정 — 홈페이지에서 회원가입을 먼저 한 뒤,
--     아래 이메일을 본인 것으로 바꿔서 이 한 줄만 다시 실행하세요.
--     두 번째 관리자부터는 관리자 페이지 > 회원 관리에서 '관리자'로 바꾸면 됩니다.
-- update public.profiles set role = 'admin' where email = 'you@example.com';
-- =========================================================
