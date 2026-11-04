-- 2026-11-04 1돈(3.75g) 미만 순금(24K) 주얼리·순금선물: 공임 35,000원으로 통일
-- (1돈 이상은 그대로 1돈당 50,000원 기준 · 실버는 그대로)
update public.products
   set labor = 35000, premium_pct = 0
 where karat = '24K' and kind in ('accessory', 'gift') and weight_g < 3.75;

select name as "공임 35,000원으로 바꾼 상품", weight_g as "중량(g)"
  from public.products
 where karat = '24K' and kind in ('accessory', 'gift') and weight_g < 3.75
 order by weight_g, name;
