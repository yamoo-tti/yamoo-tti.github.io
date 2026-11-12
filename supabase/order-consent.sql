-- 주문할 때 손님이 체크한 '[필수] 취소·반품 불가 동의' 기록 보관 (분쟁 대비 증거)
-- 주문번호별로 동의 일시, 동의한 문구, 사용한 기기 정보를 남김. 손님·외부에서는 볼 수 없고 관리자만 조회.

create table if not exists public.order_consents (
  order_id   bigint primary key references public.orders(id) on delete cascade,
  agreed_at  timestamptz not null default now(),
  notice     text not null,
  user_agent text
);
alter table public.order_consents enable row level security;

drop policy if exists "관리자만 동의 기록 조회" on public.order_consents;
create policy "관리자만 동의 기록 조회" on public.order_consents
  for select using (public.is_admin());

-- 홈페이지가 주문 직후 호출: 방금(30분 안) 들어온 주문만, 한 번만 기록
create or replace function public.record_order_consent(p_code text, p_phone text, p_notice text, p_agent text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from public.orders
   where code = upper(trim(p_code)) and phone = public.clean_phone(p_phone) and created_at > now() - interval '30 minutes';
  if v_id is null then return false; end if;
  insert into public.order_consents (order_id, notice, user_agent)
  values (v_id, left(coalesce(p_notice, ''), 500), left(p_agent, 300))
  on conflict (order_id) do nothing;
  return true;
end $$;
revoke all on function public.record_order_consent(text, text, text, text) from public;
grant execute on function public.record_order_consent(text, text, text, text) to anon, authenticated;

select '취소·반품 불가 동의 기록 설정 완료' as result;
