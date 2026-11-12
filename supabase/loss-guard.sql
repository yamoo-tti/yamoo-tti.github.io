-- 2026-11-12 적자 방지: 삼성금거래소 '살 때(부가세 포함)' 가격을 원가로 보고, 판매가가 원가보다 낮아지는 저장을 막음
--   · 원가 = 국제 금 시세(원화) × 금 함량(g) × (1 + 삼성 기준 %) × 1.1   → 시세를 따라 함께 움직임
--   · 금 함량: 골드바·카드형·24K = 중량 그대로, 18K = ×0.75, 14K = ×0.585 / 실버바·은 상품은 검사 안 함
--   · 막는 경우: ① 상품 저장(시세 대비 %·공임·중량·노출 켜기) ② 가격 일괄 변경 ③ 시세 설정의 살 때·팔 때 마진·18K/14K 계수 저장
--   · 숨김 상품은 검사 안 함. 쿠폰·적립금 할인과 택배비·케이스 비용은 계산에 넣지 않음
--   · 관리자 > 시세 설정 > '적자 방지'에서 삼성금거래소 1돈 가격을 넣으면 % 가 다시 계산됨
-- 여러 번 실행해도 안전합니다.

alter table public.price_settings add column if not exists supplier_gold_pct numeric;
comment on column public.price_settings.supplier_gold_pct is '삼성금거래소 살 때 가격 = 국제 시세 × (1 + 이 값/100) × 1.1 (null 이면 적자 검사 안 함)';
-- 처음 값: 2026-11-12 공급처 1돈 705,837원(부가세 포함)을 당시 시세로 환산한 추정치. 관리자에서 다시 넣으면 정확해짐
update public.price_settings set supplier_gold_pct = 0.22 where id = 1 and supplier_gold_pct is null;

-- 상품 1개의 지금 판매가와 삼성금거래소 기준 원가 (계산할 수 없으면 둘 다 null)
create or replace function public.loss_info(p public.products, out price numeric, out cost numeric)
language plpgsql stable security definer set search_path = public as $$
declare s public.price_settings; au numeric; pure numeric;
begin
  select * into s from public.price_settings where id = 1;
  if s.supplier_gold_pct is null or p.kind = 'silver' then return; end if;
  pure := p.weight_g * case when p.kind in ('bar', 'zodiac') or p.karat = '24K' then 1
                            when p.karat = '18K' then 0.75 when p.karat = '14K' then 0.585 end;
  if pure is null then return; end if;
  select krw_per_oz into au from public.live_prices where symbol = 'XAU';
  if au is null then return; end if;
  price := public.quote_price(p);           -- 시세가 10분 넘게 안 들어왔으면 null → 검사 건너뜀
  if price is null then return; end if;
  cost := round(au / 31.1034768 * pure * (1 + s.supplier_gold_pct / 100) * 1.1);
end $$;
revoke all on function public.loss_info(public.products) from public, anon, authenticated;

-- ① 상품 저장 · 가격 일괄 변경
create or replace function public.guard_product_loss() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not coalesce(new.visible, false) then return new; end if;
  if tg_op = 'UPDATE' and (new.premium_pct, new.labor, new.weight_g, new.karat, new.kind, new.visible)
     is not distinct from (old.premium_pct, old.labor, old.weight_g, old.karat, old.kind, old.visible) then
    return new; -- 품절·순서·사진 등 가격과 상관없는 수정은 그대로 통과
  end if;
  select * into r from public.loss_info(new);
  if r.price is not null and r.cost is not null and r.price < r.cost then
    raise exception '적자라서 저장할 수 없어요 · % : 판매가 %원 < 삼성금거래소 기준 원가 %원 (%원 손해). 시세 대비 %% 또는 공임을 올려 주세요',
      new.name, to_char(r.price, 'FM999,999,999,999'), to_char(r.cost, 'FM999,999,999,999'), to_char(r.cost - r.price, 'FM999,999,999,999');
  end if;
  return new;
end $$;
drop trigger if exists products_loss_guard on public.products;
create trigger products_loss_guard before insert or update on public.products
  for each row execute function public.guard_product_loss();

-- ② 시세 설정 (마진을 낮춰 노출 상품 중 하나라도 적자가 되면 저장 취소)
create or replace function public.guard_settings_loss() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; bad text;
begin
  if (new.gold_buy_pct, new.gold_sell_pct, new.k18_factor, new.k14_factor)
     is not distinct from (old.gold_buy_pct, old.gold_sell_pct, old.k18_factor, old.k14_factor) then
    return new; -- 삼성 기준 % 를 고치는 것은 사실 입력이라 막지 않음
  end if;
  select count(*) into n from public.products p cross join lateral public.loss_info(p) li
   where p.visible and li.price < li.cost;
  if n > 0 then
    select string_agg(format('%s (%s원 손해)', x.name, to_char(x.cost - x.price, 'FM999,999,999,999')), ', ') into bad
      from (select p.name, li.price, li.cost from public.products p cross join lateral public.loss_info(p) li
             where p.visible and li.price < li.cost order by li.price - li.cost limit 5) x;
    raise exception '적자라서 저장할 수 없어요 · 이 마진이면 상품 %개가 삼성금거래소 기준 원가보다 싸져요: % %', n, bad, case when n > 5 then '외' else '' end;
  end if;
  return new;
end $$;
drop trigger if exists settings_loss_guard on public.price_settings;
create trigger settings_loss_guard after update on public.price_settings
  for each row execute function public.guard_settings_loss();

-- 관리자 화면용: 남는 금액이 가장 적은 노출 상품 (적자부터)
create or replace function public.loss_report(p_limit int default 10)
returns table (name text, price numeric, cost numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있어요'; end if;
  return query
    select p.name, li.price, li.cost from public.products p cross join lateral public.loss_info(p) li
     where p.visible and li.price is not null and li.cost is not null
     order by (li.price - li.cost) / li.cost, p.name limit greatest(1, least(p_limit, 50));
end $$;
revoke all on function public.loss_report(int) from public, anon;
grant execute on function public.loss_report(int) to authenticated;

-- 결과: 지금 남는 게 가장 적은 상품 10개 (음수면 이미 적자)
select p.name as 상품, li.price as 지금_판매가, li.cost as 삼성기준_원가, li.price - li.cost as 남는_금액,
       round((li.price - li.cost) / li.cost * 100, 2) as 원가대비_퍼센트
  from public.products p cross join lateral public.loss_info(p) li
 where p.visible and li.price is not null and li.cost is not null
 order by (li.price - li.cost) / li.cost limit 10;
