-- 남성 팔각 광폭 체인 순금 팔찌 20돈: 공임 40만원 · 18K 잠금장식 45만원 (2026-11-11 시장 수준에 맞춤)
update public.products
   set labor = 400000, addon_price = 450000
 where name = '남성 팔각 광폭 체인 순금 팔찌 20돈';

select name, labor, addon_price from public.products where name = '남성 팔각 광폭 체인 순금 팔찌 20돈';