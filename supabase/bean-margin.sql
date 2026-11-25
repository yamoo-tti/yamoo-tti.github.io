-- 2026-11-25 콩알금 가격을 '원가 기준 이익률'로 바꿈 (cost-add.sql 다음에 실행 · 여러 번 실행해도 안전)
--   · 판매가 = 삼성금거래소 원가 ÷ (1 − 이익률), 1,000원 단위 올림
--     원가 = 삼성 100% 기준가 1g × 순금 함량 × 1.1 + 개당 추가(쓰리나인 cost_add_999 / 포나인 cost_add_9999)
--   · 국내 시세가 국제 시세와 따로 움직여도 이익률이 그대로 유지됨
--   · products.margin_pct 가 비어 있는 상품은 예전 식 그대로 (시세 대비 % + 공임)
--   · 삼성 시세가 30분 넘게 안 들어오면 예전 식으로 계산 (그래서 시세 대비 %도 지금 가격에 맞춰 둠)
--   · 삼성 원가 기록을 10분마다 남김 (supplier_price_log, 관리자만 보기) → 지난 날짜 경쟁사 가격 비교용
--   · 홈페이지 common.js productPrice 와 같은 식

alter table public.products add column if not exists margin_pct numeric
  check (margin_pct is null or (margin_pct >= 0 and margin_pct < 90));

-- 홈페이지가 가격을 계산하려면 삼성 기준가를 읽어야 함 (삼성 사이트에 공개된 값)
drop policy if exists "supplier_prices_public_read" on public.supplier_prices;
create policy "supplier_prices_public_read" on public.supplier_prices for select using (true);
grant select on public.supplier_prices to anon, authenticated;

-- 삼성 원가 기록 (10분마다 · 400일 보관)
create table if not exists public.supplier_price_log (
  at        timestamptz not null,
  metal     text not null,
  don_price numeric not null,
  primary key (at, metal)
);
alter table public.supplier_price_log enable row level security;
drop policy if exists "supplier_price_log_admin_read" on public.supplier_price_log;
create policy "supplier_price_log_admin_read" on public.supplier_price_log for select using (public.is_admin());
grant select on public.supplier_price_log to authenticated;

create or replace function public.log_supplier_prices()
returns void language sql security definer set search_path = public as $$
  insert into public.supplier_price_log (at, metal, don_price)
  select date_trunc('minute', now()), metal, don_price from public.supplier_prices
   where fetched_at > now() - interval '30 minutes'
  on conflict do nothing;
  delete from public.supplier_price_log where at < now() - interval '400 days';
$$;
revoke all on function public.log_supplier_prices() from public, anon, authenticated;
select cron.unschedule('keumbi-samsung-log') where exists (select 1 from cron.job where jobname = 'keumbi-samsung-log');
select cron.schedule('keumbi-samsung-log', '*/10 * * * *', 'select public.log_supplier_prices()');
select public.log_supplier_prices();

-- 판매가 계산 (bar-ceil-1000.sql 식 + 원가 기준 이익률)
create or replace function public.quote_price(p public.products)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  s public.price_settings;
  au numeric; ag numeric; don numeric; buy numeric; sell numeric; f numeric;
  sup numeric; pure numeric; cost numeric; silver boolean;
  w numeric := p.weight_g;
  k numeric := 1 + coalesce(p.premium_pct, 0) / 100;
  l numeric := coalesce(p.labor, 0);
begin
  select * into s from public.price_settings where id = 1;

  -- 원가 기준 이익률 상품 (콩알금)
  if p.margin_pct is not null and p.margin_pct >= 0 and p.margin_pct < 90 then
    silver := p.kind = 'silver' or p.karat = 'SV';
    pure := w * case when silver or p.kind in ('bar', 'zodiac') or p.karat = '24K' then 1
                     when p.karat = '18K' then 0.75 when p.karat = '14K' then 0.585 end;
    select don_price into sup from public.supplier_prices
     where metal = case when silver then 'silver' else 'gold' end and fetched_at > now() - interval '30 minutes';
    if sup is not null and pure is not null then
      cost := round(sup / 3.75 * pure * 1.1)
            + case when public.is_four_nine(p) then coalesce(s.cost_add_9999, 2000) else coalesce(s.cost_add_999, 1000) end;
      return ceil(round(cost / (1 - p.margin_pct / 100)) / 1000) * 1000;
    end if;
  end if;

  select krw_per_oz into au from public.live_prices where symbol = 'XAU' and fetched_at > now() - interval '10 minutes';
  select krw_per_oz into ag from public.live_prices where symbol = 'XAG' and fetched_at > now() - interval '10 minutes';
  if p.kind = 'silver' or (p.kind in ('accessory', 'gift') and p.karat = 'SV') then
    if ag is null then return null; end if;
    don := ag / 31.1034768 * 3.75;
    buy := round(don * (1 + s.ag_buy_pct / 100) * 1.1 / 10) * 10;
    if p.kind = 'silver' then
      return ceil(round(buy / 3.75 * w * k + l) / 1000) * 1000;
    end if;
    return round((buy / 3.75 * w * k + l) / 1000) * 1000;
  end if;
  if au is null then return null; end if;
  don := au / 31.1034768 * 3.75;
  buy := round(don * (1 + s.gold_buy_pct / 100) * 1.1 / 100) * 100;
  if p.kind in ('accessory', 'gift') then
    if p.karat = '24K' then
      return round((buy / 3.75 * w * k + l) / 1000) * 1000;
    end if;
    f := case p.karat when '18K' then s.k18_factor when '14K' then s.k14_factor else 1 end;
    sell := round(don * (1 + s.gold_sell_pct / 100) * f / 100) * 100;
    return round((sell / 3.75 * 1.3 * w * k + l) / 1000) * 1000;
  end if;
  return ceil(round(buy / 3.75 * w * k + l) / 1000) * 1000;
end $$;
revoke all on function public.quote_price(public.products) from public, anon, authenticated;

-- 콩알금 이익률 (2026-11-25 사장님 결정 · 반떼 공구가보다 조금 낮게)
update public.products p
   set margin_pct = t.m, labor = 0, updated_at = now()
  from (values
    ('순금 콩알금 0.1g', 33::numeric),
    ('순금 콩알금 0.5g', 11),
    ('순금 콩알금 1g',    7),
    ('순금 콩알금 반돈',  4.5),
    ('순금 콩알금 1돈',   3),
    ('순금 콩알금 2돈',   3),
    ('순금 콩알금 5돈',   3),
    ('순금 콩알금 10돈',  3)
  ) as t(name, m)
 where p.name = t.name and p.opt_group = '순금 콩알금';

-- 삼성 시세가 끊겼을 때 쓰는 예전 식(시세 대비 %)도 지금 새 가격에 맞춰 둠
do $$
declare s public.price_settings; au numeric; buy_g numeric; r public.products; target numeric;
begin
  select * into s from public.price_settings where id = 1;
  select krw_per_oz into au from public.live_prices where symbol = 'XAU' and fetched_at > now() - interval '10 minutes';
  if au is null then return; end if;
  buy_g := round(au / 31.1034768 * 3.75 * (1 + s.gold_buy_pct / 100) * 1.1 / 100) * 100 / 3.75;
  for r in select * from public.products where opt_group = '순금 콩알금' and margin_pct is not null loop
    target := public.quote_price(r);
    if target is not null then
      update public.products set premium_pct = round((target / (buy_g * r.weight_g) - 1) * 100, 4) where id = r.id;
    end if;
  end loop;
end $$;

select name as 상품, margin_pct as 이익률, public.quote_price(p) as 지금_판매가, li.cost as 원가
  from public.products p cross join lateral public.loss_info(p) li
 where opt_group = '순금 콩알금' order by weight_g;
