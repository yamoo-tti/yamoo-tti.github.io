-- 실버바 · 은 그래뉼 추가 + 사진 적용 (여러 번 실행해도 안전)
-- 7-1) 실버바 · 은 그래뉼 (은 살 때 시세 × 중량 × (1+프리미엄%))
alter table public.products drop constraint if exists products_kind_check;
alter table public.products add constraint products_kind_check check (kind in ('bar','zodiac','silver','accessory'));
do $$ begin
  if not exists (select 1 from public.products where kind = 'silver') then
    insert into public.products (kind, name, weight_g, karat, premium_pct, img, tag, sort) values
      ('silver', '실버바 500g',     500,  '24K', 3, 'silver/bar-500g.jpg',     'BEST',   20),
      ('silver', '은 그래뉼 100g',  100,  '24K', 6, 'silver/granule-100g.jpg', null,     30),
      ('silver', '은 그래뉼 1kg',   1000, '24K', 3, 'silver/granule-1kg.jpg',  null,     50);
  end if;
end $$;
-- 실제 사진으로 교체 (임시 그림을 쓰던 상품만)
update public.products set img = 'silver/bar-1kg.jpg'      where kind = 'silver' and name = '실버바 1kg'     and img = 'silver/bar-1kg.svg';
update public.products set img = 'silver/granule-100g.jpg' where kind = 'silver' and name = '은 그래뉼 100g' and img = 'silver/granule.svg';
update public.products set img = 'silver/granule-1kg.jpg'  where kind = 'silver' and name = '은 그래뉼 1kg'  and img = 'silver/granule.svg';
