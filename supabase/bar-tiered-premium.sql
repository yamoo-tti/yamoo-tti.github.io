-- 2026-11-04 골드바 중량별 웃돈 (무거울수록 비율 낮게) + 카드형 1g을 일반 1g보다 조금 비싸게
-- 작은 바(1g·반돈·1돈)는 공임(원) 고정, 두돈 이상은 시세 대비 %로 (시세가 바뀌어도 비율 유지)
update public.products p
   set labor = v.labor, premium_pct = v.pct
  from (values
    (1.0,    20000, 0.0),   -- 1g
    (1.875,  25000, 0.0),   -- 반돈
    (3.75,   40000, 0.0),   -- 1돈
    (7.5,        0, 4.5),   -- 두돈
    (10.0,       0, 4.0),   -- 10g
    (11.25,      0, 4.0),   -- 세돈
    (18.75,      0, 3.5),   -- 18.75g
    (37.5,       0, 3.0),   -- 37.5g
    (100.0,      0, 2.0)    -- 100g
  ) as v(w, labor, pct)
 where p.kind = 'bar' and abs(p.weight_g - v.w) < 0.001;

-- 카드형 1g: 일반 1g(공임 20,000)보다 5,000원 높게
update public.products set labor = 25000, premium_pct = 0 where kind = 'zodiac';

select case kind when 'bar' then '골드바' else '카드형' end as "종류", name as "상품", weight_g as "중량(g)",
       labor as "공임(원)", premium_pct as "시세 대비 %"
  from public.products where kind in ('bar', 'zodiac') order by kind, weight_g, name;
