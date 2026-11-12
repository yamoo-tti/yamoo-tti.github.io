-- 2026-11-12 순금 콩알금은 평일(월~금, 공휴일·휴무일 제외) 오전 9시~오후 6시(한국 시간)에만 주문 가능
--   · 매장이 공급처에서 바로 매입할 수 있는 시간에만 팔아서 밤·주말·공휴일 시세 변동 위험을 없앰
--   · 이 시간 밖에는 바로 구매·장바구니 주문 모두 막힘 (관리자가 직접 넣는 주문은 예외)
--   · 휴무일은 관리자 > 시세 설정 > '매장 휴무일'에서 더하거나 뺄 수 있어요 (2026~2027 공휴일은 미리 넣어 둠)
--   · 야간 할증(night-premium.sql)은 필요 없어져서 0% 로 끔
-- 여러 번 실행해도 안전합니다.

create table if not exists public.shop_holidays (
  day  date primary key,
  name text not null default '휴무'
);
alter table public.shop_holidays enable row level security;
drop policy if exists "holidays_read" on public.shop_holidays;
create policy "holidays_read" on public.shop_holidays for select using (true);
drop policy if exists "holidays_admin" on public.shop_holidays;
create policy "holidays_admin" on public.shop_holidays for all using (public.is_admin()) with check (public.is_admin());
grant select on public.shop_holidays to anon, authenticated;
grant insert, update, delete on public.shop_holidays to authenticated;

-- 공휴일 (대체공휴일 포함 · 2026-11-12 기준 앞으로의 날짜) — 정부 발표와 다르면 관리자에서 고쳐 주세요
insert into public.shop_holidays (day, name) values
  ('2026-12-25', '성탄절'),
  ('2027-01-01', '신정'),
  ('2027-02-06', '설날 연휴'), ('2027-02-07', '설날'), ('2027-02-08', '설날 연휴'), ('2027-02-09', '설날 대체공휴일'),
  ('2027-03-01', '삼일절'),
  ('2027-05-05', '어린이날'),
  ('2027-05-13', '부처님오신날'),
  ('2027-06-06', '현충일'),
  ('2027-08-15', '광복절'), ('2027-08-16', '광복절 대체공휴일'),
  ('2027-09-14', '추석 연휴'), ('2027-09-15', '추석'), ('2027-09-16', '추석 연휴'),
  ('2027-10-03', '개천절'), ('2027-10-04', '개천절 대체공휴일'),
  ('2027-10-09', '한글날'), ('2027-10-11', '한글날 대체공휴일'),
  ('2027-12-25', '성탄절'), ('2027-12-27', '성탄절 대체공휴일')
on conflict (day) do nothing;

-- 지금 콩알금을 팔 수 있는 시간인지
create or replace function public.bean_open() returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from (now() at time zone 'Asia/Seoul')) between 1 and 5
     and extract(hour from (now() at time zone 'Asia/Seoul')) >= 9
     and extract(hour from (now() at time zone 'Asia/Seoul')) < 18
     and not exists (select 1 from public.shop_holidays where day = (now() at time zone 'Asia/Seoul')::date)
$$;

create or replace function public.guard_bean_hours() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  if public.bean_open() or public.is_admin() then return new; end if;
  ids := array_remove(array[new.product_id], null)
      || coalesce((select array_agg((x ->> 'product_id')::uuid) from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x
                    where x ? 'product_id'), '{}');
  if exists (select 1 from public.products where id = any(ids) and opt_group = '순금 콩알금') then
    raise exception '순금 콩알금은 평일 오전 9시~오후 6시에만 주문할 수 있어요. 장바구니에서 콩알금을 빼면 다른 상품은 지금 주문할 수 있어요';
  end if;
  return new;
end $$;
drop trigger if exists orders_bean_hours on public.orders;
create trigger orders_bean_hours before insert on public.orders
  for each row execute function public.guard_bean_hours();

-- 야간 할증 끄기 (칸이 있을 때만)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'price_settings' and column_name = 'night_pct') then
    update public.price_settings set night_pct = 0 where id = 1;
  end if;
end $$;

select public.bean_open() as 지금_콩알금_주문_가능;
