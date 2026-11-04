-- 2026-11-04 판매 분석 유입경로에 '쓰레드(threads)' 추가 (여러 번 실행해도 안전)
create or replace function public.track_visit(p_source text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
declare src text := lower(coalesce(p_source, '')); dev text := lower(coalesce(p_device, ''));
begin
  if src not in ('naver', 'google', 'daum', 'kakao', 'threads', 'instagram', 'facebook', 'youtube', 'email', 'direct', 'other') then src := 'other'; end if;
  if dev not in ('mobile', 'pc') then dev := 'pc'; end if;
  if (select coalesce(sum(visits), 0) from public.site_daily where day = public.kst_today()) >= 50000 then return; end if; -- 장난 방지
  insert into public.site_daily (day, source, device, visits) values (public.kst_today(), src, dev, 1)
  on conflict (day, source, device) do update set visits = public.site_daily.visits + 1;
end $$;
revoke all on function public.track_visit(text, text) from public;
grant execute on function public.track_visit(text, text) to anon, authenticated;
select '유입경로에 쓰레드 추가 완료' as result;
