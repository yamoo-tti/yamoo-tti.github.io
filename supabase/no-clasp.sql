-- 2026-11-04 18K 잠금장식이 들어가지 않는 팔찌에서 옵션 빼기 (사진 보고 고름) — 여러 번 실행해도 안전
--   비휴 오닉스 · 비휴 원석 (원석 알 줄팔찌) / 클로버 매듭 (끈 매듭) / 각인 패턴 뱅글 (잠금 없는 뱅글)
-- 비휴·매듭 팔찌는 금이 장식에만 있어서 사이즈를 바꿔도 금 중량이 그대로 → 사이즈 비례(base_size)도 끔
update public.products set addon_name = null, addon_price = null
 where kind = 'accessory' and category = 'bracelet'
   and img in ('store/8267792230.jpg', 'store/12612321775.jpg', 'store/11928380767.jpg', 'store/5731872814.jpg');
update public.products set base_size = null
 where kind = 'accessory' and category = 'bracelet'
   and img in ('store/8267792230.jpg', 'store/12612321775.jpg', 'store/11928380767.jpg');

-- 플렉스 팔각 광폭 체인 10돈 (18K 장식): 잠금장식 옵션 유지 (10돈 = 380,000원)
update public.products set addon_name = '18K 잠금장식', addon_price = 380000
 where kind = 'accessory' and img = 'store/8232319516.jpg';

-- 롱 목걸이 2개 (선버스트 · 클로버): 41~51cm
update public.products set sizes = '41,42,43,44,45,46,47,48,49,50,51'
 where kind = 'accessory' and category = 'necklace' and img in ('store/7216844342.jpg', 'store/7216866519.jpg');

select name as "상품", sizes as "사이즈", addon_name as "추가 옵션", addon_price as "옵션 금액", base_size as "중량 기준(cm)" from public.products
 where img in ('store/8267792230.jpg', 'store/12612321775.jpg', 'store/11928380767.jpg', 'store/5731872814.jpg', 'store/8232319516.jpg', 'store/7216844342.jpg', 'store/7216866519.jpg')
 order by category, name;
