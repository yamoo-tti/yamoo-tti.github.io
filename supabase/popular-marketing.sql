-- 2026-11-03 인기순 정렬(조회수·판매수) + 마케팅 수신 동의 명단
--  · 조회수: 손님이 사진 크게 보기·상품정보·구매 창·장바구니 담기를 하면 1번 (같은 사람은 하루 1번)
--  · 판매수: 주문이 '입금 확인'(또는 그 이후 단계)이 되면 수량만큼 +, 그 뒤 취소되면 -
--  · 마케팅 명단: 주문할 때 [선택] 마케팅 수신에 체크한 손님만 저장 (동의 없이 광고 문자 금지 — 정보통신망법 제50조)
--  여러 번 실행해도 괜찮아요.

-- 1) 상품 통계 (상품 표와 따로 둬서 변경 이력이 조회수로 도배되지 않게)
create table if not exists public.product_stats (
  product_id uuid primary key references public.products on delete cascade,
  views      int not null default 0,
  sold       int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.product_stats enable row level security;
drop policy if exists "stats_read" on public.product_stats;
create policy "stats_read" on public.product_stats for select using (true);

create or replace function public.bump_view(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.products where id = p_id and visible) then return; end if;
  insert into public.product_stats (product_id, views) values (p_id, 1)
  on conflict (product_id) do update set views = public.product_stats.views + 1, updated_at = now();
end $$;
revoke all on function public.bump_view(uuid) from public;
grant execute on function public.bump_view(uuid) to anon, authenticated;

create or replace function public.add_sold(p_id uuid, p_qty int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_id is null or not exists (select 1 from public.products where id = p_id) then return; end if;
  insert into public.product_stats (product_id, sold) values (p_id, greatest(p_qty, 0))
  on conflict (product_id) do update set sold = greatest(0, public.product_stats.sold + p_qty), updated_at = now();
end $$;
revoke all on function public.add_sold(uuid, int) from public, anon, authenticated;

create or replace function public.count_sold()
returns trigger language plpgsql security definer set search_path = public as $$
declare d int; it jsonb;
begin
  if new.status in ('paid', 'ready', 'done') and old.status not in ('paid', 'ready', 'done') then d := 1;
  elsif new.status = 'canceled' and old.status in ('paid', 'ready', 'done') then d := -1;
  else return new; end if;
  if new.items is not null and jsonb_typeof(new.items) = 'array' and jsonb_array_length(new.items) > 0 then
    for it in select value from jsonb_array_elements(new.items) loop
      perform public.add_sold((it ->> 'product_id')::uuid, d * coalesce((it ->> 'qty')::int, 1));
    end loop;
  else
    perform public.add_sold(new.product_id, d * coalesce(new.qty, 1));
  end if;
  return new;
end $$;
drop trigger if exists orders_count_sold on public.orders;
create trigger orders_count_sold after update of status on public.orders for each row execute function public.count_sold();

-- 지금까지 입금 확인된 주문으로 판매수 채우기 (처음 한 번)
do $$ begin
  if not exists (select 1 from public.product_stats where sold > 0) then
    insert into public.product_stats (product_id, sold)
    select pid, sum(q)::int from (
      select (it ->> 'product_id')::uuid pid, coalesce((it ->> 'qty')::int, 1) q
        from public.orders o, jsonb_array_elements(o.items) it
       where o.status in ('paid', 'ready', 'done') and o.items is not null and jsonb_typeof(o.items) = 'array'
      union all
      select o.product_id, o.qty from public.orders o
       where o.status in ('paid', 'ready', 'done') and (o.items is null or jsonb_typeof(o.items) <> 'array' or jsonb_array_length(o.items) = 0)
    ) s
    where pid in (select id from public.products)
    group by pid
    on conflict (product_id) do update set sold = excluded.sold;
  end if;
end $$;

-- 2) 마케팅 수신 동의 명단
create table if not exists public.marketing_contacts (
  phone        text primary key,
  name         text not null,
  source       text not null default 'order',
  consented_at timestamptz not null default now()
);
alter table public.marketing_contacts enable row level security;
drop policy if exists "mkt_admin_read" on public.marketing_contacts;
create policy "mkt_admin_read" on public.marketing_contacts for select using (public.is_admin());
drop policy if exists "mkt_admin_delete" on public.marketing_contacts;
create policy "mkt_admin_delete" on public.marketing_contacts for delete using (public.is_admin());

-- 주문 직후에만 등록돼요 (방금 주문한 번호가 아니면 무시 → 아무 번호나 넣는 장난 방지)
create or replace function public.add_marketing_contact(p_name text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare ph text := public.clean_phone(p_phone);
begin
  if char_length(ph) not between 9 and 12 or char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then return; end if;
  if not exists (select 1 from public.orders where phone = ph and created_at > now() - interval '30 minutes') then return; end if;
  insert into public.marketing_contacts (phone, name, source) values (ph, trim(p_name), 'order')
  on conflict (phone) do update set name = excluded.name, consented_at = now();
end $$;
revoke all on function public.add_marketing_contact(text, text) from public;
grant execute on function public.add_marketing_contact(text, text) to anon, authenticated;

-- 관리자용 명단: 주문 때 동의한 손님 + 가입 때 동의한 회원 (번호 겹치면 한 번만)
create or replace function public.marketing_list()
returns table (name text, phone text, source text, consented_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '권한이 없습니다'; end if;
  return query
    select m.name, m.phone, '주문'::text, m.consented_at from public.marketing_contacts m
    union all
    select p.name, public.clean_phone(p.phone), '회원가입'::text, p.created_at from public.profiles p
     where p.marketing and p.status = 'active' and coalesce(p.phone, '') <> ''
       and not exists (select 1 from public.marketing_contacts m where m.phone = public.clean_phone(p.phone))
    order by 4 desc;
end $$;
revoke all on function public.marketing_list() from public, anon;
grant execute on function public.marketing_list() to authenticated;
