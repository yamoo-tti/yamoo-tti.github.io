-- 2026-11-04 검색으로 찾은 횟수도 인기순에 반영
--  · 검색 결과에서 상품을 누르면(사진·이름·담기·구매) 1번 (같은 사람은 상품마다 하루 1번)
--  · 인기 점수 = 판매 × 30 + 검색 × 3 + 조회
--  여러 번 실행해도 괜찮아요. 이 SQL을 먼저 실행한 뒤 홈페이지를 배포하세요.
alter table public.product_stats add column if not exists searches int not null default 0;

create or replace function public.bump_search(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.products where id = p_id and visible) then return; end if;
  insert into public.product_stats (product_id, searches) values (p_id, 1)
  on conflict (product_id) do update set searches = public.product_stats.searches + 1, updated_at = now();
end $$;
revoke all on function public.bump_search(uuid) from public;
grant execute on function public.bump_search(uuid) to anon, authenticated;

select '검색 횟수 기록 준비 완료' as result;
