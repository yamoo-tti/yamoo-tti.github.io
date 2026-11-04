-- 2026-11-04 순금 콩알금 추가 사진 (대표 사진은 기존 유리병 사진 유지)
update public.products
   set photos = E'store/bean-pile.jpg\nstore/bean-tray.jpg'
 where opt_group = '순금 콩알금';
select name as "상품", photos as "추가 사진" from public.products where opt_group = '순금 콩알금' order by weight_g;