-- =========================================================
-- 17) 상품정보 제공고시 · 보유기간 지난 개인정보 자동 파기
--     여러 번 실행해도 안전합니다.
-- =========================================================

-- 상품별 고시 정보 (제조자, 제조국, 치수 등). 비어 있으면 홈페이지가 기본값을 보여줌
alter table public.products add column if not exists info jsonb not null default '{}'::jsonb;

-- 자동 파기 기록 (언제 몇 건 지웠는지)
create table if not exists public.privacy_purge_log (
  id        bigint generated always as identity primary key,
  ran_at    timestamptz not null default now(),
  orders    int not null default 0,
  sells     int not null default 0,
  logs      int not null default 0
);
alter table public.privacy_purge_log enable row level security;
drop policy if exists "purge_log_admin_read" on public.privacy_purge_log;
create policy "purge_log_admin_read" on public.privacy_purge_log for select using (public.is_admin());
grant select on public.privacy_purge_log to authenticated;

-- 개인정보처리방침 3항의 보유기간에 맞춰 삭제
--  · 거래가 안 된 구매·매입 신청(접수·입금대기·취소 / 접수·일정확정·취소): 접수일로부터 1년
--  · 거래된 주문·매입(입금확인 이후 / 입고·지급완료): 접수일로부터 5년 (전자상거래법·국세기본법)
--  · 위 기록의 관리자 변경 이력도 함께 삭제, 그 밖의 관리자 이력은 5년
--  · 문자 발송 기록(전화번호)은 하루 발송 한도 확인용이라 7일 뒤 삭제
create or replace function public.purge_personal_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare o_codes text[]; s_codes text[]; n_logs int;
begin
  with d as (
    delete from public.orders
     where (status in ('new', 'confirmed', 'canceled') and created_at < now() - interval '1 year')
        or (status in ('paid', 'ready', 'done')        and created_at < now() - interval '5 years')
    returning code)
  select coalesce(array_agg(code), '{}') into o_codes from d;

  with d as (
    delete from public.sell_requests
     where (status in ('new', 'scheduled', 'canceled') and created_at < now() - interval '1 year')
        or (status in ('received', 'done')             and created_at < now() - interval '5 years')
    returning code)
  select coalesce(array_agg(code), '{}') into s_codes from d;

  with d as (
    delete from public.admin_logs
     where (entity = 'order' and ref = any(o_codes))
        or (entity = 'sell'  and ref = any(s_codes))
        or created_at < now() - interval '5 years'
    returning 1)
  select count(*) into n_logs from d;

  delete from public.sms_log where created_at < now() - interval '7 days';
  delete from public.lookup_fail where created_at < now() - interval '1 day';
  delete from public.submit_log where created_at < now() - interval '1 day';

  insert into public.privacy_purge_log (orders, sells, logs)
  values (cardinality(o_codes), cardinality(s_codes), n_logs);
  delete from public.privacy_purge_log where ran_at < now() - interval '1 year';

  return jsonb_build_object('orders', cardinality(o_codes), 'sells', cardinality(s_codes), 'logs', n_logs);
end $$;
revoke all on function public.purge_personal_data() from public, anon, authenticated;

-- 매일 새벽 3시(한국 시간)에 자동 실행 (서버 시간 UTC 18:00)
select cron.schedule('keumbi-purge-personal', '0 18 * * *', 'select public.purge_personal_data()');

-- 지금 한 번 실행해서 잘 되는지 확인 (아직 1년 지난 기록이 없으니 0건이 정상)
select '상품정보·자동 파기 설정 완료' as result, public.purge_personal_data() as deleted;
