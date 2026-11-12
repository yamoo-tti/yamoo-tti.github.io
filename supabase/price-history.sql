-- 2026-11-12 시세 기록(그래프용) · 알림 기능 끄기
-- 10분마다 오늘 시세를 기록해 홈페이지 '순금 시세 흐름' 그래프에 씀. 여러 번 실행해도 안전합니다.
-- 시세 알림·재입고 알림은 사장님 요청으로 쓰지 않음 (문자 서비스 가입 전)

-- 1) 날짜별 시세 (1돈 기준 · 살 때는 부가세 포함, 홈페이지 시세표와 같은 식)
create table if not exists public.price_daily (
  day        date primary key,
  au_buy     numeric not null,
  au_sell    numeric not null,
  ag_buy     numeric,
  au_high    numeric,
  au_low     numeric,
  updated_at timestamptz not null default now()
);
alter table public.price_daily enable row level security;
drop policy if exists "price_daily_read" on public.price_daily;
create policy "price_daily_read" on public.price_daily for select using (true);
grant select on public.price_daily to anon, authenticated;

-- 지금 시세 (1돈): 순금 살 때 · 순금 팔 때 · 은 살 때
create or replace function public.current_don_prices(out au_buy numeric, out au_sell numeric, out ag_buy numeric)
language plpgsql stable security definer set search_path = public as $$
declare s public.price_settings; au numeric; ag numeric; d numeric;
begin
  select * into s from public.price_settings where id = 1;
  select krw_per_oz into au from public.live_prices where symbol = 'XAU' and fetched_at > now() - interval '10 minutes';
  select krw_per_oz into ag from public.live_prices where symbol = 'XAG' and fetched_at > now() - interval '10 minutes';
  if au is not null then
    d := au / 31.1034768 * 3.75;
    au_buy := round(d * (1 + s.gold_buy_pct / 100) * 1.1 / 100) * 100;
    au_sell := round(d * (1 + s.gold_sell_pct / 100) / 100) * 100;
  end if;
  if ag is not null then
    ag_buy := round(ag / 31.1034768 * 3.75 * (1 + s.ag_buy_pct / 100) * 1.1 / 10) * 10;
  end if;
end $$;
revoke all on function public.current_don_prices() from public, anon, authenticated;

-- 2) 10분마다 오늘 시세 기록 (그날 최고·최저도 함께)
create or replace function public.price_tick()
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.current_don_prices();
  if c.au_buy is null then return; end if;
  insert into public.price_daily as d (day, au_buy, au_sell, ag_buy, au_high, au_low)
  values (public.kst_today(), c.au_buy, c.au_sell, c.ag_buy, c.au_buy, c.au_buy)
  on conflict (day) do update set au_buy = excluded.au_buy, au_sell = excluded.au_sell, ag_buy = coalesce(excluded.ag_buy, d.ag_buy),
    au_high = greatest(d.au_high, excluded.au_buy), au_low = least(d.au_low, excluded.au_buy), updated_at = now();
end $$;
revoke all on function public.price_tick() from public, anon, authenticated;

select cron.unschedule('keumbi-price-tick') where exists (select 1 from cron.job where jobname = 'keumbi-price-tick');
select cron.schedule('keumbi-price-tick', '*/10 * * * *', 'select public.price_tick()');
select public.price_tick();

-- 3) 재입고 알림 끄기: 새 신청을 받지 않고, 다시 입고돼도 문자를 보내지 않음 (나중에 다시 켤 수 있게 표·함수는 남김)
revoke execute on function public.request_restock(uuid, text) from anon, authenticated;
drop trigger if exists products_restock_notify on public.products;

select '시세 기록 설정 완료 · 알림 기능 꺼짐' as result;
