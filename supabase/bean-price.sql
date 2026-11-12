-- 2026-11-12 순금 콩알금 8종 가격을 경쟁사보다 1,000원 이상 싸게 맞춤 (공임 0원 · '시세 대비 %'로 조정)
-- 기준(2026-11-12 낮 경쟁사): 0.1g 30,900 · 0.5g 107,950 · 1g 203,520 · 반돈 369,750 · 1돈 725,100 · 5돈 3,625,000 · 10돈 7,247,000 (2돈은 1돈×2)
-- 실행하는 순간의 시세로 목표 가격에 딱 맞게 % 를 계산해 넣음 → 이후에는 시세를 따라 함께 움직임
-- 0.1g · 반돈 · 5돈 · 10돈 상품이 아직 없으면 먼저 추가합니다. 여러 번 실행해도 안전합니다.

insert into public.products (kind, name, weight_g, karat, category, premium_pct, labor, img, photos, sort, visible, sold_out, info,
                             opt_group, opt_label, addon_name, addon_price)
select 'gift', v.name, v.weight_g, '24K', 'goods', 0, 0, 'store/12553693981.jpg', E'store/bean-pile.jpg\nstore/bean-tray.jpg',
       v.sort, true, false, '{}'::jsonb, '순금 콩알금', v.opt_label, '유리케이스', 5000
  from (values
    ('순금 콩알금 0.1g', 0.1::numeric,   48, '0.1g'),
    ('순금 콩알금 반돈', 1.875::numeric, 50, '반돈'),
    ('순금 콩알금 5돈',  18.75::numeric, 52, '5돈'),
    ('순금 콩알금 10돈', 37.5::numeric,  53, '10돈')
  ) as v(name, weight_g, sort, opt_label)
 where not exists (select 1 from public.products p where p.name = v.name);

do $$
declare s public.price_settings; au numeric; buy_g numeric;
begin
  select * into s from public.price_settings where id = 1;
  select krw_per_oz into au from public.live_prices where symbol = 'XAU' and fetched_at > now() - interval '10 minutes';
  if au is null then raise exception '지금 시세를 못 받아 왔어요. 1분 뒤 다시 실행해 주세요'; end if;
  -- 금비 순금 살 때 시세 1g (quote_price 와 같은 식)
  buy_g := round(au / 31.1034768 * 3.75 * (1 + s.gold_buy_pct / 100) * 1.1 / 100) * 100 / 3.75;
  update public.products p
     set labor = 0,
         premium_pct = round((t.target / (buy_g * p.weight_g) - 1) * 100, 4),
         updated_at = now()
    from (values
      ('순금 콩알금 0.1g',      29000::numeric),
      ('순금 콩알금 0.5g',     106000),
      ('순금 콩알금 1g',       202000),
      ('순금 콩알금 반돈',     368000),
      ('순금 콩알금 1돈',      724000),
      ('순금 콩알금 2돈',     1449000),
      ('순금 콩알금 5돈',     3624000),
      ('순금 콩알금 10돈',    7246000)
    ) as t(name, target)
   where p.name = t.name and p.opt_group = '순금 콩알금';
end $$;

select name, weight_g, premium_pct as 시세대비_퍼센트, labor as 공임, public.quote_price(p) as 지금_판매가
  from public.products p where opt_group = '순금 콩알금' order by weight_g;
