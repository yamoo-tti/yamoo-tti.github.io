-- 2026-11-12 순금 콩알금 중량 추가: 0.1g · 반돈 · 5돈 · 10돈 (공임 0원, 가격은 '시세 대비 %'로 조정)
-- 판매가 = 금비 순금 살 때 시세(g당) × 중량 × (1 + 시세 대비 %) → 1,000원 단위 반올림
-- 같은 묶음('순금 콩알금')이라 메인 콩알금 칸·상품 상세의 중량 선택에 함께 나옵니다. 여러 번 실행해도 한 번만 들어가요.
insert into public.products (kind, name, weight_g, karat, category, premium_pct, labor, img, photos, sort, visible, sold_out, info,
                             opt_group, opt_label, addon_name, addon_price)
select v.kind, v.name, v.weight_g, '24K', 'goods', v.premium_pct, 0, 'store/12553693981.jpg', E'store/bean-pile.jpg\nstore/bean-tray.jpg',
       v.sort, true, false, '{}'::jsonb, '순금 콩알금', v.opt_label, '유리케이스', 5000
  from (values
    ('gift', '순금 콩알금 0.1g', 0.1::numeric,    46.0::numeric, 48, '0.1g'),
    ('gift', '순금 콩알금 반돈', 1.875::numeric,  -1.3::numeric, 50, '반돈'),
    ('gift', '순금 콩알금 5돈',  18.75::numeric,  -2.7::numeric, 52, '5돈'),
    ('gift', '순금 콩알금 10돈', 37.5::numeric,   -2.7::numeric, 53, '10돈')
  ) as v(kind, name, weight_g, premium_pct, sort, opt_label)
 where not exists (select 1 from public.products p where p.name = v.name);

select name, weight_g, premium_pct, labor, public.quote_price(p) as 지금_판매가
  from public.products p where opt_group = '순금 콩알금' order by weight_g;
