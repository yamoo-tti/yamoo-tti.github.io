-- 2026-11-12 '기념 각인 골드바' 3종 삭제 (이제 일반 골드바 구매 때 '각인 추가'를 체크하면 무료 각인)
-- 지난 주문 기록은 상품명·금액이 따로 저장돼 있어 그대로 남아요. 여러 번 실행해도 안전합니다.

delete from public.products
 where kind = 'gift' and name in ('기념 각인 골드바 한돈', '기념 각인 골드바 세돈', '기념 각인 골드바 다섯돈');

select count(*) as 남은_기념각인골드바 from public.products where name like '기념 각인 골드바%';
