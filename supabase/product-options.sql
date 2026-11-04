-- 2026-11-04 상품 옵션 (1g · 1돈 · 2돈 …)
-- 옵션 하나 = 상품 한 줄 (중량·공임·품절·주문은 지금처럼 상품별)
-- opt_group 이 같은 상품끼리 홈페이지에서 카드 하나로 묶여 옵션 버튼으로 고름
alter table public.products add column if not exists opt_group text;
alter table public.products add column if not exists opt_label text;

-- 콩알금: 지금 있는 '1돈' 상품을 묶음으로 만들고 1g · 2돈 옵션 추가 (여러 번 실행해도 한 번만 추가)
update public.products set opt_group = '순금 콩알금', opt_label = '1돈'
 where img = 'store/12553693981.jpg' and kind = 'gift' and abs(weight_g - 3.75) < 0.001;

insert into public.products (kind, name, weight_g, karat, category, premium_pct, labor, img, tag, sort, visible, sold_out, info, opt_group, opt_label)
select b.kind, '순금 콩알금 ' || o.label, o.w, b.karat, b.category, 0, o.labor, b.img, null, b.sort + o.dsort, true, false, b.info, '순금 콩알금', o.label
  from (select * from public.products where opt_group = '순금 콩알금' and opt_label = '1돈' limit 1) b
 cross join (values ('1g', 1.0, 35000, -1), ('2돈', 7.5, 100000, 1)) as o(label, w, labor, dsort)
 where not exists (select 1 from public.products x where x.opt_group = '순금 콩알금' and x.opt_label = o.label);

select name as "상품", opt_label as "옵션", weight_g as "중량(g)", labor as "공임" from public.products
 where opt_group = '순금 콩알금' order by weight_g;
