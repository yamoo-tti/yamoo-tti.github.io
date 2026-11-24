-- =========================================================
-- 대표 주소 변경: keumbigold.com (2026-11-24)
--   주문 메일 속 링크 등에 쓰이는 사이트 주소를 새 주소로 바꿉니다.
--   여러 번 실행해도 안전합니다.
-- =========================================================
update public.shop_info set site_url = 'https://keumbigold.com' where id = 1;
alter table public.shop_info alter column site_url set default 'https://keumbigold.com';
