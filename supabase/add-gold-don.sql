-- 7-2) 골드바 반돈·두돈·세돈 (프리미엄 = 2026.11.02 삼성금거래소 프레스 골드바보다 2% 싸게 맞춘 값)
insert into public.products (kind, name, weight_g, karat, premium_pct, img, sort)
select v.* from (values
  ('bar', 'GBK 순금 골드바 1.875g (반돈)', 1.875::numeric, '24K', 5.42::numeric, 'gbk/bar-1_875g.webp', 15),
  ('bar', 'GBK 순금 골드바 7.5g (두돈)',   7.5,   '24K', 2.11,  'gbk/bar-7_5g.webp',   25),
  ('bar', 'GBK 순금 골드바 11.25g (세돈)', 11.25, '24K', -1.6,  'gbk/bar-11_25g.webp', 35)
) as v(kind, name, weight_g, karat, premium_pct, img, sort)
where not exists (select 1 from public.products p where p.name = v.name);

select name, weight_g, premium_pct from public.products where kind = 'bar' order by weight_g;
