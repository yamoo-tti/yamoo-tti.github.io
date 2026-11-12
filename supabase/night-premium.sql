-- 2026-11-12 야간 할증: 18시~다음 날 9시(한국 시간) 주문은 콩알금 판매가에 +1% (매장이 아침 9시에야 금을 사 올 수 있어서)
--   · % 는 관리자 > 시세 설정 > '야간 할증'에서 바꿀 수 있어요 (0 이면 끔)
--   · quote_price 는 bar-ceil-1000.sql 과 같은 식에 야간 할증만 더했어요 (홈페이지 common.js productPrice 와 같은 규칙)
-- 여러 번 실행해도 안전합니다.

alter table public.price_settings add column if not exists night_pct numeric not null default 1 check (night_pct >= 0 and night_pct <= 10);

-- 지금이 야간(한국 시간 18시~다음 날 9시)인지
create or replace function public.is_night_kst() returns boolean
language sql stable as $$
  select extract(hour from (now() at time zone 'Asia/Seoul')) >= 18 or extract(hour from (now() at time zone 'Asia/Seoul')) < 9
$$;

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
  -- 야간 할증 (콩알금만)
  if coalesce(p.opt_group, '') = '순금 콩알금' and coalesce(s.night_pct, 0) > 0 and public.is_night_kst() then
    k := k * (1 + s.night_pct / 100);
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

select night_pct as 야간_할증_퍼센트, public.is_night_kst() as 지금_야간,
       (select string_agg(name || ' ' || to_char(public.quote_price(p), 'FM999,999,999') || '원', ' · ' order by weight_g)
          from public.products p where opt_group = '순금 콩알금') as 지금_콩알금_가격
  from public.price_settings where id = 1;
