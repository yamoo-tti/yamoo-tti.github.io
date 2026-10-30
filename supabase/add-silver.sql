-- 실버바 · 은 그래뉼 추가 (한 번만 실행)
-- 7-1) 실버바 · 은 그래뉼 (은 살 때 시세 × 중량 × (1+프리미엄%))
alter table public.products drop constraint if exists products_kind_check;
alter table public.products add constraint products_kind_check check (kind in ('bar','zodiac','silver','accessory'));
do $$ begin
  if not exists (select 1 from public.products where kind = 'silver') then
    insert into public.products (kind, name, weight_g, karat, premium_pct, img, tag, sort) values
      ('silver', '실버바 100g',     100,  '24K', 8, 'silver/bar-100g.svg', '입문용', 10),
      ('silver', '실버바 1kg',      1000, '24K', 3, 'silver/bar-1kg.svg',  'BEST',   20),
      ('silver', '은 그래뉼 100g',  100,  '24K', 6, 'silver/granule.svg',  null,     30),
      ('silver', '은 그래뉼 500g',  500,  '24K', 4, 'silver/granule.svg',  null,     40),
      ('silver', '은 그래뉼 1kg',   1000, '24K', 3, 'silver/granule.svg',  null,     50);
  end if;
end $$;
