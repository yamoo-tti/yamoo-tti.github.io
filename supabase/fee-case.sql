-- 2026-11-12 택배비 3,000원 → 3,500원, 유리케이스 추가 옵션 5,000원 → 6,000원
-- (택배비는 나중에 관리자 > 시세 설정 > 주문·입금·문자 설정에서도 바꿀 수 있어요)

update public.shop_info set delivery_fee = 3500 where id = 1;
update public.products set addon_price = 6000, updated_at = now() where addon_name = '유리케이스' and addon_price <> 6000;

select (select delivery_fee from public.shop_info where id = 1) as 택배비,
       count(*) filter (where addon_price = 6000) as 유리케이스_6000원_상품수,
       count(*) filter (where addon_price <> 6000) as 다른_금액_남은_상품수
  from public.products where addon_name = '유리케이스';
