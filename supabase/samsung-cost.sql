-- 2026-11-12 적자 방지 원가 = 삼성금거래소 실시간 '100% 기준' 시세 × 1.1(부가세) + 1,000원 (상품 1개당) (loss-guard.sql 다음에 실행)
--   · 1분마다 https://www.samsunggold.co.kr 의 실시간 100% 기준가(금·은 1g)를 받아 1돈(×3.75)으로 저장
--   · 원가: 금 상품 = 삼성 금 100% 1g × 금 함량(g) × 1.1 + 1,000원  (24K·골드바·카드형 100%, 18K 75%, 14K 58.5%)
--           은 상품 = 삼성 은 100% 1g × 중량(g) × 1.1 + 1,000원      (실버바·실버 주얼리)
--   · 모든 노출 상품(골드바·콩알금·주얼리·순금선물·실버)을 검사. 숨김 상품은 검사 안 함
--   · 막는 것: 저장 결과가 적자인데 가격을 '내리는' 변경 (새 상품·숨김→노출·시세 대비 %·공임·중량 낮추기, 시세 마진 낮추기)
--     이미 적자인 상품의 가격을 '올리는' 저장은 허용 (조금씩 고쳐 나갈 수 있게)
-- 여러 번 실행해도 안전합니다.

create table if not exists public.supplier_prices (
  metal      text primary key,          -- 'gold' / 'silver'
  don_price  numeric not null,          -- 삼성금거래소 100% 기준가 1돈(3.75g), 부가세 별도
  src_date   text,                      -- 삼성 쪽 기준 날짜
  fetched_at timestamptz not null
);
create table if not exists public.supplier_fetches (
  id         bigint primary key,
  created_at timestamptz not null default now()
);
alter table public.supplier_prices enable row level security;
alter table public.supplier_fetches enable row level security;
drop policy if exists "supplier_prices_admin_read" on public.supplier_prices;
create policy "supplier_prices_admin_read" on public.supplier_prices for select using (public.is_admin());
grant select on public.supplier_prices to authenticated;

create or replace function public.refresh_supplier_prices()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare r record; j jsonb; g numeric; s numeric;
begin
  -- 지난번 요청의 응답 반영
  for r in select f.id, h.status_code, h.content from public.supplier_fetches f join net._http_response h on h.id = f.id loop
    begin
      if r.status_code = 200 then
        j := r.content::jsonb #> '{data,hundredPercentStandardPriceDTO}';   -- 100% 기준가 (1g, 부가세 별도)
        g := nullif(replace(j ->> 'gold', ',', ''), '')::numeric * 3.75;
        s := nullif(replace(j ->> 'silver', ',', ''), '')::numeric * 3.75;
        if g > 100000 then
          insert into public.supplier_prices values ('gold', g, j ->> 'date', now())
          on conflict (metal) do update set don_price = excluded.don_price, src_date = excluded.src_date, fetched_at = excluded.fetched_at;
        end if;
        if s > 1000 then
          insert into public.supplier_prices values ('silver', s, j ->> 'date', now())
          on conflict (metal) do update set don_price = excluded.don_price, src_date = excluded.src_date, fetched_at = excluded.fetched_at;
        end if;
      end if;
    exception when others then null; -- 응답 형식이 바뀌면 무시 (마지막 값 유지)
    end;
    delete from public.supplier_fetches where id = r.id;
  end loop;
  delete from public.supplier_fetches where created_at < now() - interval '10 minutes';
  insert into public.supplier_fetches (id) select net.http_get('https://www.samsunggold.co.kr/realtime/ajax/getMarketData.php');
end $$;
revoke all on function public.refresh_supplier_prices() from public, anon, authenticated;

select cron.unschedule('keumbi-samsung-price') where exists (select 1 from cron.job where jobname = 'keumbi-samsung-price');
select cron.schedule('keumbi-samsung-price', '* * * * *', 'select public.refresh_supplier_prices()');
-- 예전(도매가)으로 받아 둔 값이 있으면 지금 바로 100% 기준가로 바꿔 둠 (실행 시점 값 · 이후 1분마다 자동 갱신)
insert into public.supplier_prices values
  ('gold', 170280 * 3.75, '2026-11-12', now() - interval '1 hour'),
  ('silver', 2208 * 3.75, '2026-11-12', now() - interval '1 hour')
on conflict (metal) do update set don_price = excluded.don_price, src_date = excluded.src_date, fetched_at = excluded.fetched_at;
select public.refresh_supplier_prices();

-- 상품 1개의 지금 판매가와 삼성금거래소 기준 원가 (계산할 수 없으면 null)
create or replace function public.loss_info(p public.products, out price numeric, out cost numeric)
language plpgsql stable security definer set search_path = public as $$
declare silver boolean; pure numeric; don numeric;
begin
  silver := p.kind = 'silver' or p.karat = 'SV';
  pure := p.weight_g * case when silver or p.kind in ('bar', 'zodiac') or p.karat = '24K' then 1
                            when p.karat = '18K' then 0.75 when p.karat = '14K' then 0.585 end;
  if pure is null then return; end if;
  select don_price into don from public.supplier_prices where metal = case when silver then 'silver' else 'gold' end;
  if don is null then return; end if;
  price := public.quote_price(p);           -- 우리 시세가 10분 넘게 안 들어왔으면 null → 검사 건너뜀
  if price is null then return; end if;
  cost := round(don / 3.75 * pure * 1.1) + 1000;   -- 100% 기준가 × 함량 × 1.1 + 1,000원
end $$;
revoke all on function public.loss_info(public.products) from public, anon, authenticated;

-- ① 상품 저장 · 가격 일괄 변경
create or replace function public.guard_product_loss() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; o record;
begin
  if not coalesce(new.visible, false) then return new; end if;
  if tg_op = 'UPDATE' and (new.premium_pct, new.labor, new.weight_g, new.karat, new.kind, new.visible)
     is not distinct from (old.premium_pct, old.labor, old.weight_g, old.karat, old.kind, old.visible) then
    return new; -- 품절·순서·사진·이름 등 가격과 상관없는 수정은 통과
  end if;
  select * into r from public.loss_info(new);
  if r.price is null or r.cost is null or r.price >= r.cost then return new; end if;
  -- 이미 노출 중이던 적자 상품의 가격을 올리는 수정은 허용
  if tg_op = 'UPDATE' and old.visible then
    select * into o from public.loss_info(old);
    if o.price is not null and r.price > o.price then return new; end if;
  end if;
  raise exception '적자라서 저장할 수 없어요 · % : 판매가 %원 < 삼성금거래소 원가 %원 (%원 손해). 시세 대비 %% 또는 공임을 올려 주세요',
    new.name, to_char(r.price, 'FM999,999,999,999'), to_char(r.cost, 'FM999,999,999,999'), to_char(r.cost - r.price, 'FM999,999,999,999');
end $$;
drop trigger if exists products_loss_guard on public.products;
create trigger products_loss_guard before insert or update on public.products
  for each row execute function public.guard_product_loss();

-- ② 시세 설정: 마진을 '낮췄는데' 노출 상품 중 적자가 생기면 저장 취소 (올리는 건 항상 허용)
create or replace function public.guard_settings_loss() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; bad text;
begin
  if not (new.gold_buy_pct < old.gold_buy_pct or new.gold_sell_pct < old.gold_sell_pct
          or new.k18_factor < old.k18_factor or new.k14_factor < old.k14_factor or new.ag_buy_pct < old.ag_buy_pct) then
    return new;
  end if;
  select count(*) into n from public.products p cross join lateral public.loss_info(p) li
   where p.visible and li.price < li.cost;
  if n > 0 then
    select string_agg(format('%s (%s원 손해)', x.name, to_char(x.cost - x.price, 'FM999,999,999,999')), ', ') into bad
      from (select p.name, li.price, li.cost from public.products p cross join lateral public.loss_info(p) li
             where p.visible and li.price < li.cost order by li.price - li.cost limit 5) x;
    raise exception '적자라서 저장할 수 없어요 · 이 마진이면 노출 상품 %개가 삼성금거래소 원가보다 싸요: % %', n, bad, case when n > 5 then '외' else '' end;
  end if;
  return new;
end $$;
drop trigger if exists settings_loss_guard on public.price_settings;
create trigger settings_loss_guard after update on public.price_settings
  for each row execute function public.guard_settings_loss();

select '설정 완료 · 1분 뒤 관리자 > 시세 설정 > 적자 방지에서 삼성 시세와 적자 상품을 확인하세요' as result;
