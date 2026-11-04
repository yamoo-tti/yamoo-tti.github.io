-- 2026-11-04 골드바·카드형 골드바·실버바(은 그래뉼) 판매가: 1,000원 단위 올림 (예: 721,340원 → 722,000원)
-- 주얼리·순금선물은 그대로 1,000원 단위 반올림 · 홈페이지 common.js productPrice 와 같은 식
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

select '골드바·그래뉼 1,000원 올림 적용 완료' as result;
