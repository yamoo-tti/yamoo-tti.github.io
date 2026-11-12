-- 2026-11-12 적자 방지 원가에 더하는 금액(상품 1개당)을 관리자 > 시세 설정에서 바꿀 수 있게 함 (samsung-cost.sql 다음에 실행)
--   원가 = 삼성금거래소 100% 기준가 × 함량 × 1.1 + 추가 금액
--   추가 금액: 포나인(99.99%) 기본 2,000원 = 골드바·카드형 1g·실버바(그래뉼)
--             쓰리나인(99.9%) 기본 1,000원 = 그 밖의 상품 (콩알금·주얼리·돌반지 등 순금선물·18K·14K·실버 주얼리)
-- 여러 번 실행해도 안전합니다.

alter table public.price_settings add column if not exists cost_add_999  numeric not null default 1000;
alter table public.price_settings add column if not exists cost_add_9999 numeric not null default 2000;

-- 포나인(99.99%) 상품인지
create or replace function public.is_four_nine(p public.products) returns boolean
language sql immutable as $$
  select p.kind in ('bar', 'zodiac', 'silver')   -- 콩알금·주얼리·순금선물은 쓰리나인
$$;

create or replace function public.loss_info(p public.products, out price numeric, out cost numeric)
language plpgsql stable security definer set search_path = public as $$
declare silver boolean; pure numeric; don numeric; s public.price_settings;
begin
  silver := p.kind = 'silver' or p.karat = 'SV';
  pure := p.weight_g * case when silver or p.kind in ('bar', 'zodiac') or p.karat = '24K' then 1
                            when p.karat = '18K' then 0.75 when p.karat = '14K' then 0.585 end;
  if pure is null then return; end if;
  select don_price into don from public.supplier_prices where metal = case when silver then 'silver' else 'gold' end;
  if don is null then return; end if;
  price := public.quote_price(p);           -- 우리 시세가 10분 넘게 안 들어왔으면 null → 검사 건너뜀
  if price is null then return; end if;
  select * into s from public.price_settings where id = 1;
  cost := round(don / 3.75 * pure * 1.1)
        + case when public.is_four_nine(p) then coalesce(s.cost_add_9999, 2000) else coalesce(s.cost_add_999, 1000) end;
end $$;
revoke all on function public.loss_info(public.products) from public, anon, authenticated;

select cost_add_999 as 쓰리나인_추가, cost_add_9999 as 포나인_추가 from public.price_settings where id = 1;
