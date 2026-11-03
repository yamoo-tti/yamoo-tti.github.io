-- 2026-11-03 순금(24K) 주얼리·순금선물 공임을 1돈(3.75g)당 5만원으로 변경 (실버는 그대로)
update public.products
   set labor = round(50000 * weight_g / 3.75 / 1000) * 1000
 where karat = '24K' and kind in ('accessory', 'gift');