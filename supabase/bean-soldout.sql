-- 2026-11-12 콩알금: '판매 시간' 안내를 없애고, 평일 9시~18시(공휴일·휴무일 제외) 밖에는 그냥 '품절'로 처리
--   · 손님 화면은 홈페이지 코드가 자동으로 품절 표시 (관리자의 품절 스위치는 그대로)
--   · 이 SQL은 그 시간에 들어오는 주문을 서버에서 막을 때 나오는 문구를 '품절'로 바꿈
-- 여러 번 실행해도 안전합니다. (bean-hours.sql 다음에 실행)

create or replace function public.guard_bean_hours() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; nm text;
begin
  if public.bean_open() or public.is_admin() then return new; end if;
  ids := array_remove(array[new.product_id], null)
      || coalesce((select array_agg((x ->> 'product_id')::uuid) from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x
                    where x ? 'product_id'), '{}');
  select name into nm from public.products where id = any(ids) and opt_group = '순금 콩알금' limit 1;
  if nm is not null then
    raise exception '품절된 상품이 있어요: %', nm;
  end if;
  return new;
end $$;

select '완료' as result;
