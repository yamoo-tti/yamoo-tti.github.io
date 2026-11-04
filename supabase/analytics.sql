-- =========================================================
-- 20) 판매 분석용 기록 (2026-11-04)
--     · 방문자: 하루·유입경로·기기별 숫자만 (이름·IP 등 개인정보는 저장하지 않음, 같은 브라우저는 하루 1번)
--     · 상품 조회·검색: 날짜별로도 쌓음 (기존 누적 숫자는 그대로)
--     · 검색어: 손님이 검색한 말과 '결과 없음' 횟수
--     · 관리자만 볼 수 있는 요약 함수 analytics_counts
--     여러 번 실행해도 안전합니다. 이 SQL을 먼저 실행한 뒤 홈페이지를 배포하세요.
-- =========================================================
create or replace function public.kst_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Seoul')::date $$;

-- 1) 방문자
create table if not exists public.site_daily (
  day    date not null,
  source text not null,
  device text not null,
  visits int  not null default 0,
  primary key (day, source, device)
);
alter table public.site_daily enable row level security;
drop policy if exists "site_daily_admin" on public.site_daily;
create policy "site_daily_admin" on public.site_daily for select using (public.is_admin());

create or replace function public.track_visit(p_source text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
declare src text := lower(coalesce(p_source, '')); dev text := lower(coalesce(p_device, ''));
begin
  if src not in ('naver', 'google', 'daum', 'kakao', 'instagram', 'facebook', 'youtube', 'email', 'direct', 'other') then src := 'other'; end if;
  if dev not in ('mobile', 'pc') then dev := 'pc'; end if;
  if (select coalesce(sum(visits), 0) from public.site_daily where day = public.kst_today()) >= 50000 then return; end if; -- 장난 방지
  insert into public.site_daily (day, source, device, visits) values (public.kst_today(), src, dev, 1)
  on conflict (day, source, device) do update set visits = public.site_daily.visits + 1;
end $$;
revoke all on function public.track_visit(text, text) from public;
grant execute on function public.track_visit(text, text) to anon, authenticated;

-- 2) 상품 날짜별 조회·검색
create table if not exists public.product_daily (
  day        date not null,
  product_id uuid not null references public.products on delete cascade,
  views      int  not null default 0,
  searches   int  not null default 0,
  primary key (day, product_id)
);
alter table public.product_daily enable row level security;
drop policy if exists "product_daily_admin" on public.product_daily;
create policy "product_daily_admin" on public.product_daily for select using (public.is_admin());

create or replace function public.bump_view(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.products where id = p_id and visible) then return; end if;
  insert into public.product_stats (product_id, views) values (p_id, 1)
  on conflict (product_id) do update set views = public.product_stats.views + 1, updated_at = now();
  insert into public.product_daily (day, product_id, views) values (public.kst_today(), p_id, 1)
  on conflict (day, product_id) do update set views = public.product_daily.views + 1;
end $$;
revoke all on function public.bump_view(uuid) from public;
grant execute on function public.bump_view(uuid) to anon, authenticated;

create or replace function public.bump_search(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.products where id = p_id and visible) then return; end if;
  insert into public.product_stats (product_id, searches) values (p_id, 1)
  on conflict (product_id) do update set searches = public.product_stats.searches + 1, updated_at = now();
  insert into public.product_daily (day, product_id, searches) values (public.kst_today(), p_id, 1)
  on conflict (day, product_id) do update set searches = public.product_daily.searches + 1;
end $$;
revoke all on function public.bump_search(uuid) from public;
grant execute on function public.bump_search(uuid) to anon, authenticated;

-- 3) 검색어 (결과가 0개였던 횟수도 함께)
create table if not exists public.search_daily (
  day  date not null,
  term text not null,
  n    int  not null default 0,
  zero int  not null default 0,
  primary key (day, term)
);
alter table public.search_daily enable row level security;
drop policy if exists "search_daily_admin" on public.search_daily;
create policy "search_daily_admin" on public.search_daily for select using (public.is_admin());

create or replace function public.track_search_term(p_term text, p_results int)
returns void language plpgsql security definer set search_path = public as $$
declare t text := lower(regexp_replace(trim(coalesce(p_term, '')), '\s+', ' ', 'g'));
begin
  if char_length(t) not between 1 and 30 then return; end if;
  if (select coalesce(sum(n), 0) from public.search_daily where day = public.kst_today()) >= 20000 then return; end if; -- 장난 방지
  insert into public.search_daily (day, term, n, zero) values (public.kst_today(), t, 1, case when coalesce(p_results, 0) = 0 then 1 else 0 end)
  on conflict (day, term) do update set n = public.search_daily.n + 1,
    zero = public.search_daily.zero + case when coalesce(p_results, 0) = 0 then 1 else 0 end;
end $$;
revoke all on function public.track_search_term(text, int) from public;
grant execute on function public.track_search_term(text, int) to anon, authenticated;

-- 4) 관리자용 기간 요약 (방문자·유입경로·기기·상품별 조회/검색·검색어)
create or replace function public.analytics_counts(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있어요'; end if;
  return jsonb_build_object(
    'visits', coalesce((select jsonb_object_agg(d::text, v) from (
        select day d, sum(visits) v from public.site_daily where day between p_from and p_to group by day) t), '{}'::jsonb),
    'sources', coalesce((select jsonb_object_agg(source, v) from (
        select source, sum(visits) v from public.site_daily where day between p_from and p_to group by source) t), '{}'::jsonb),
    'devices', coalesce((select jsonb_object_agg(device, v) from (
        select device, sum(visits) v from public.site_daily where day between p_from and p_to group by device) t), '{}'::jsonb),
    'products', coalesce((select jsonb_object_agg(pid::text, jsonb_build_object('v', v, 's', s)) from (
        select product_id pid, sum(views) v, sum(searches) s from public.product_daily where day between p_from and p_to group by product_id) t), '{}'::jsonb),
    'terms', coalesce((select jsonb_agg(jsonb_build_object('t', term, 'n', n, 'z', z) order by n desc) from (
        select term, sum(n) n, sum(zero) z from public.search_daily where day between p_from and p_to
         group by term order by sum(n) desc limit 60) t), '[]'::jsonb)
  );
end $$;
revoke all on function public.analytics_counts(date, date) from public, anon;
grant execute on function public.analytics_counts(date, date) to authenticated;

select '판매 분석 기록 준비 완료' as result;
