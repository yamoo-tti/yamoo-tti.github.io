-- =========================================================
-- 회원 등급 · 가입 쿠폰 · 등급업 쿠폰
--   · 가입하면 3,000원 쿠폰 1장
--   · 구매 1회 → 실버 (1만원 쿠폰) · 3회 → 골드 (2만원) · 5회 → VIP (3만원)
--   · 구매 1회 = 입금 확인된 회원 주문 중 상품 금액(택배비 제외) 10만원 이상
--   · 쿠폰 최소 주문 금액 = 쿠폰 금액 × 20 (할인율이 5%를 넘지 않게) · 유효기간은 쿠폰 유효기간(3개월)
--   · 등급은 올라가기만 함 (관리자가 직접 올린 등급도 유지) · 관리자 계정은 제외
--   coupons-points.sql 실행 뒤에 실행하세요. 여러 번 실행해도 안전합니다.
-- =========================================================

-- 1) 설정 (관리자 > 시세 설정에서 수정)
alter table public.shop_info add column if not exists signup_coupon  int not null default 3000 check (signup_coupon >= 0);
alter table public.shop_info add column if not exists tier_rule      jsonb not null default
  '[{"g":"silver","n":1,"amt":10000},{"g":"gold","n":3,"amt":20000},{"g":"vip","n":5,"amt":30000}]'::jsonb;
alter table public.shop_info add column if not exists tier_min_order int not null default 100000 check (tier_min_order >= 0);
alter table public.shop_info add column if not exists coupon_x       int not null default 20 check (coupon_x between 0 and 100);

-- 같은 회원에게 같은 쿠폰이 두 번 나가지 않게
create unique index if not exists coupons_source_tier on public.coupons (source) where source like 'tier:%' or source like 'signup:%';

-- 2) 쿠폰 1장 지급 (이미 받은 쿠폰이면 건너뜀)
create or replace function public.give_coupon(p_uid uuid, p_name text, p_amt int, p_source text)
returns boolean language plpgsql security definer set search_path = public as $$
declare si public.shop_info;
begin
  if p_uid is null or coalesce(p_amt, 0) <= 0 then return false; end if;
  if exists (select 1 from public.coupons where source = p_source) then return false; end if;
  select * into si from public.shop_info where id = 1;
  insert into public.coupons (user_id, name, amount, min_order, expires_at, source)
  values (p_uid, p_name, p_amt, p_amt * coalesce(si.coupon_x, 20), now() + make_interval(months => coalesce(si.coupon_months, 3)), p_source);
  return true;
exception when unique_violation then return false;
end $$;
revoke all on function public.give_coupon(uuid, text, int, text) from public, anon, authenticated;

-- 3) 구매 횟수 (입금 확인 이후 · 상품 금액 기준 이상)
create or replace function public.paid_count(p_uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.orders o
   where o.user_id = p_uid and o.status in ('paid', 'ready', 'done')
     and coalesce(o.final_price, 0) - coalesce(o.shipping_fee, 0) >= (select tier_min_order from public.shop_info where id = 1);
$$;
revoke all on function public.paid_count(uuid) from public, anon, authenticated;

-- 4) 등급 확인 → 쿠폰 지급 · 등급 올리기
create or replace function public.apply_tier(p_uid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  pf public.profiles; si public.shop_info; r jsonb; cnt int; best text := 'basic';
  rank_of jsonb := '{"basic":0,"silver":1,"gold":2,"vip":3}'::jsonb;
  label jsonb := '{"silver":"실버","gold":"골드","vip":"VIP"}'::jsonb;
begin
  select * into pf from public.profiles where id = p_uid;
  if pf.id is null or pf.role = 'admin' or pf.status <> 'active' then return null; end if;
  select * into si from public.shop_info where id = 1;
  cnt := public.paid_count(p_uid);
  for r in select value from jsonb_array_elements(si.tier_rule) loop
    if cnt >= (r ->> 'n')::int then
      perform public.give_coupon(p_uid, (label ->> (r ->> 'g')) || ' 등급 축하 쿠폰', (r ->> 'amt')::int, 'tier:' || (r ->> 'g') || ':' || p_uid);
      if (rank_of ->> (r ->> 'g'))::int > (rank_of ->> best)::int then best := r ->> 'g'; end if;
    end if;
  end loop;
  if (rank_of ->> best)::int > (rank_of ->> pf.grade)::int then
    update public.profiles set grade = best where id = p_uid;
  end if;
  return best;
end $$;
revoke all on function public.apply_tier(uuid) from public, anon, authenticated;

-- 입금 확인(또는 그 이후 단계로 이동)되면 등급 확인
create or replace function public.orders_tier()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and new.status in ('paid', 'ready', 'done')
     and (tg_op = 'INSERT' or old.status not in ('paid', 'ready', 'done')) then
    perform public.apply_tier(new.user_id);
  end if;
  return null;
end $$;
drop trigger if exists orders_tier on public.orders;
create trigger orders_tier after insert or update of status on public.orders
  for each row execute function public.orders_tier();
revoke all on function public.orders_tier() from public, anon, authenticated;

-- 5) 가입 쿠폰: 새 회원이 생기면 자동 지급
create or replace function public.profiles_signup_coupon()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'member' then
    perform public.give_coupon(new.id, '가입 환영 쿠폰', (select signup_coupon from public.shop_info where id = 1), 'signup:' || new.id);
  end if;
  return null;
end $$;
drop trigger if exists profiles_signup_coupon on public.profiles;
create trigger profiles_signup_coupon after insert on public.profiles
  for each row execute function public.profiles_signup_coupon();
revoke all on function public.profiles_signup_coupon() from public, anon, authenticated;

-- 6) 내 쿠폰 + 등급 정보 (주문내역 화면)
drop function if exists public.my_benefits();
create function public.my_benefits()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'coupons', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'amount', c.amount, 'min_order', c.min_order, 'expires_at', c.expires_at) order by c.expires_at)
                          from public.coupons c where c.user_id = auth.uid() and c.used_at is null and c.expires_at > now()), '[]'::jsonb),
    'grade', (select grade from public.profiles where id = auth.uid()),
    'count', public.paid_count(auth.uid()),
    'tier_rule', si.tier_rule,
    'tier_min_order', si.tier_min_order
  ) end
  from public.shop_info si where si.id = 1;
$$;
revoke all on function public.my_benefits() from public, anon;
grant execute on function public.my_benefits() to authenticated;

-- 7) 지금 있는 회원에게도 적용: 가입 쿠폰 1장 + 지금까지 구매 횟수로 등급·쿠폰
do $$
declare p record;
begin
  for p in select id from public.profiles where role = 'member' and status = 'active' loop
    perform public.give_coupon(p.id, '가입 환영 쿠폰', (select signup_coupon from public.shop_info where id = 1), 'signup:' || p.id);
    perform public.apply_tier(p.id);
  end loop;
end $$;

select grade, count(*) as 회원수 from public.profiles where role = 'member' group by grade order by grade;
