-- 2026-11-04 주얼리(24K·실버) 가격을 상품마다 조금씩 다르게: 공임에 −3,000 / −2,000 / +2,000 / +3,000원 중 하나를 무작위로 더함
-- (판매가는 1,000원 단위로 반올림되므로 판매가도 정확히 그만큼 바뀜) · 실행할 때마다 다시 섞이니 한 번만 실행하세요
update public.products
   set labor = greatest(0, labor + (array[-3000, -2000, 2000, 3000])[1 + floor(random() * 4)::int])
 where kind = 'accessory';

select count(*) as "바꾼 주얼리 상품 수" from public.products where kind = 'accessory';
