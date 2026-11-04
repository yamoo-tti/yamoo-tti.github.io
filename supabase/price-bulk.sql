-- =========================================================
-- 19) 가격 기준 통일 + 실버 공임 조정 (2026-11-04)
--     모든 상품 = 시세(g당) × 중량 × (1 + 시세 대비 %) + 공임
--     → 관리자에서 상품마다 '%' 또는 '돈당 공임' 어느 쪽으로든 정할 수 있음
--     (홈페이지 common.js productPrice 와 같은 식)
--     여러 번 실행해도 안전합니다.
-- =========================================================

-- 지금까지 계산에 안 쓰이던 값은 0으로 정리 (가격 변화 없음)
update public.products set premium_pct = 0 where kind in ('accessory', 'gift') and coalesce(premium_pct, 0) <> 0;
update public.products set labor = 0 where kind in ('bar', 'zodiac', 'silver') and coalesce(labor, 0) <> 0;

create or replace function public.quote_price(p public.products)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  s public.price_settings;
  au numeric; ag numeric; don numeric; buy numeric; sell numeric; f numeric;
  w numeric := p.weight_g;
  k numeric := 1 + coalesce(p.premium_pct, 0) / 100;
  l numeric := coalesce(p.labor, 0);
begin
  select * into s from public.price_settings where id = 1;
  select krw_per_oz into au from public.live_prices where symbol = 'XAU' and fetched_at > now() - interval '10 minutes';
  select krw_per_oz into ag from public.live_prices where symbol = 'XAG' and fetched_at > now() - interval '10 minutes';
  if p.kind = 'silver' or (p.kind in ('accessory', 'gift') and p.karat = 'SV') then
    if ag is null then return null; end if;
    don := ag / 31.1034768 * 3.75;
    buy := round(don * (1 + s.ag_buy_pct / 100) * 1.1 / 10) * 10;
    if p.kind = 'silver' then
      return round((buy / 3.75 * w * k + l) / 100) * 100;
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
  return round((buy / 3.75 * w * k + l) / 100) * 100;
end $$;
revoke all on function public.quote_price(public.products) from public, anon, authenticated;

-- 실버 주얼리 공임: 1돈(3.75g)당 25,000원 (순금 5만원의 절반)
update public.products
   set labor = round(25000 * weight_g / 3.75 / 100) * 100, premium_pct = 0
 where karat = 'SV' and kind in ('accessory', 'gift');

select count(*) as "공임 바꾼 실버 상품 수" from public.products where karat = 'SV' and kind in ('accessory', 'gift');
