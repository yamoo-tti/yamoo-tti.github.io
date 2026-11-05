-- 2026-11-05 순금 콩알금 (1g · 1돈 · 2돈 전부) 유리케이스 옵션 +5,000원 — 여러 번 실행해도 안전
update public.products set addon_name = '유리케이스', addon_price = 5000
 where opt_group = '순금 콩알금';
select name as "상품", addon_name as "추가 옵션", addon_price as "옵션 금액" from public.products
 where opt_group = '순금 콩알금' order by weight_g;
