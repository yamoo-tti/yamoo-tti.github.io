-- =========================================================
-- 상품 상세 설명 · 구매 후기(리뷰) · 재입고 알림
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- =========================================================

-- 1) 상품 상세 설명 (관리자 > 상품 관리에서 입력 → 상품 상세 화면에 표시)
alter table public.products add column if not exists description text;
-- 문자 속 홈페이지 주소 (도메인을 바꾸면 이 값만 바꾸면 됨)
alter table public.shop_info add column if not exists site_url text not null default 'https://keumbi.wnsdn9203.workers.dev';

-- 2) 구매 후기 ------------------------------------------------
--  · 입금 확인 이후(paid · ready · done) 주문에 들어 있는 상품만 후기를 쓸 수 있음
--  · 회원은 로그인만 하면 되고, 비회원은 접수번호 + 주문할 때 쓴 휴대폰 번호로 확인
--  · 한 주문의 한 상품에 후기 1개
create table if not exists public.reviews (
  id           bigint generated always as identity primary key,
  product_id   uuid not null references public.products on delete cascade,
  order_id     bigint references public.orders on delete set null,
  user_id      uuid references auth.users on delete set null,
  name         text not null,
  rating       int  not null check (rating between 1 and 5),
  body         text not null check (char_length(body) between 10 and 1000),
  option_label text,
  reply        text,
  replied_at   timestamptz,
  visible      boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index if not exists reviews_order_product on public.reviews (order_id, product_id);
create index if not exists reviews_product_idx on public.reviews (product_id, created_at desc);
alter table public.reviews enable row level security;
drop policy if exists "reviews_admin_all" on public.reviews;
create policy "reviews_admin_all" on public.reviews for all using (public.is_admin()) with check (public.is_admin());

-- 손님 화면용: 노출 중인 후기만, 이름은 가려서 (김*수)
create or replace function public.product_reviews(p_ids uuid[])
returns table (id bigint, product_id uuid, name text, rating int, body text, option_label text, reply text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.product_id,
         case when char_length(r.name) <= 2 then left(r.name, 1) || '*'
              else left(r.name, 1) || repeat('*', char_length(r.name) - 2) || right(r.name, 1) end,
         r.rating, r.body, r.option_label, r.reply, r.created_at
    from public.reviews r
   where r.visible and r.product_id = any(p_ids)
   order by r.created_at desc
   limit 200;
$$;
revoke all on function public.product_reviews(uuid[]) from public;
grant execute on function public.product_reviews(uuid[]) to anon, authenticated;

-- 상품 목록용: 상품별 후기 수 · 평균 별점
create or replace function public.review_stats()
returns table (product_id uuid, cnt int, avg_rating numeric)
language sql stable security definer set search_path = public as $$
  select r.product_id, count(*)::int, round(avg(r.rating)::numeric, 1)
    from public.reviews r where r.visible group by r.product_id;
$$;
revoke all on function public.review_stats() from public;
grant execute on function public.review_stats() to anon, authenticated;

-- 후기 쓰기: 성공하면 'ok', 구매 기록을 못 찾으면 안내 문구를 돌려줌
create or replace function public.submit_review(p_product uuid, p_rating int, p_body text, p_code text default null, p_phone text default null)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  o public.orders; nm text; opt text;
  v_ip text := 'ip:' || coalesce(public.client_ip(), '-');
  has_code boolean := nullif(trim(coalesce(p_code, '')), '') is not null;
begin
  if p_rating is null or p_rating not between 1 and 5 then raise exception '별점을 골라 주세요'; end if;
  if char_length(trim(coalesce(p_body, ''))) < 10 then raise exception '후기는 10자 이상 써 주세요'; end if;
  if char_length(p_body) > 1000 then raise exception '후기는 1000자까지 쓸 수 있어요'; end if;
  if not has_code and auth.uid() is null then raise exception '로그인하거나 접수번호로 구매 확인을 해 주세요'; end if;
  -- 접수번호 무작위 대입 방지 (1시간에 10번 틀리면 잠시 막음)
  if (select count(*) from public.lookup_fail f where f.k = v_ip and f.created_at > now() - interval '1 hour') >= 10 then
    raise exception '시도가 너무 많아요. 잠시 후 다시 시도해 주세요';
  end if;

  select x.* into o from public.orders x
   where x.status in ('paid', 'ready', 'done')
     and (x.product_id = p_product
          or coalesce(x.items, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('product_id', p_product::text)))
     and ((not has_code and x.user_id = auth.uid())
          or (has_code and x.code = upper(trim(p_code)) and x.phone = public.clean_phone(p_phone)))
     and not exists (select 1 from public.reviews r where r.order_id = x.id and r.product_id = p_product)
   order by x.created_at desc limit 1;

  if o.id is null then
    if has_code then
      insert into public.lookup_fail (k) values (v_ip);
      delete from public.lookup_fail where created_at < now() - interval '1 day';
    end if;
    return case when exists (select 1 from public.reviews r join public.orders x on x.id = r.order_id
                              where r.product_id = p_product
                                and ((not has_code and x.user_id = auth.uid())
                                     or (has_code and x.code = upper(trim(p_code)) and x.phone = public.clean_phone(p_phone))))
                then '이미 이 상품의 후기를 써 주셨어요. 감사합니다!'
                else '이 상품을 구매하신 기록을 찾지 못했어요. 후기는 입금 확인 이후에 쓸 수 있어요. 비회원이면 접수번호와 주문할 때 쓴 휴대폰 번호를 확인해 주세요.' end;
  end if;

  nm := coalesce(nullif(trim((select p.name from public.profiles p where p.id = auth.uid() and not has_code)), ''), o.name);
  select it ->> 'name' into opt from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) it
   where it ->> 'product_id' = p_product::text limit 1;
  insert into public.reviews (product_id, order_id, user_id, name, rating, body, option_label)
  values (p_product, o.id, case when has_code then o.user_id else auth.uid() end, left(nm, 40), p_rating, trim(p_body),
          left(coalesce(opt, o.product_name), 120));
  return 'ok';
end $$;
revoke all on function public.submit_review(uuid, int, text, text, text) from public;
grant execute on function public.submit_review(uuid, int, text, text, text) to anon, authenticated;

-- 3) 재입고 알림 ----------------------------------------------
--  · 품절 상품에서 휴대폰 번호를 남기면, 관리자가 '품절'을 끄는 순간 문자 1통
--  · 문자를 보낸 번호는 30일 뒤, 못 보낸 신청은 180일 뒤 자동 삭제
create table if not exists public.restock_requests (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products on delete cascade,
  phone       text not null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz
);
create unique index if not exists restock_once on public.restock_requests (product_id, phone) where notified_at is null;
create index if not exists restock_phone_idx on public.restock_requests (phone, created_at);
alter table public.restock_requests enable row level security;
drop policy if exists "restock_admin_read" on public.restock_requests;
create policy "restock_admin_read" on public.restock_requests for select using (public.is_admin());
drop policy if exists "restock_admin_delete" on public.restock_requests;
create policy "restock_admin_delete" on public.restock_requests for delete using (public.is_admin());

create or replace function public.request_restock(p_product uuid, p_phone text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare ph text := public.clean_phone(p_phone);
begin
  if ph !~ '^01[0-9]{8,9}$' then raise exception '휴대폰 번호를 확인해 주세요'; end if;
  if not exists (select 1 from public.products where id = p_product and visible and sold_out) then
    raise exception '지금 구매할 수 있는 상품이에요. 새로고침해 주세요';
  end if;
  perform public.check_spam('restock_requests', ph);
  insert into public.restock_requests (product_id, phone) values (p_product, ph)
  on conflict (product_id, phone) where notified_at is null do nothing;
  delete from public.restock_requests
   where (notified_at is not null and notified_at < now() - interval '30 days')
      or created_at < now() - interval '180 days';
  return 'ok';
end $$;
revoke all on function public.request_restock(uuid, text) from public;
grant execute on function public.request_restock(uuid, text) to anon, authenticated;

-- 관리자가 품절을 끄면(또는 숨김 상품을 품절 아닌 상태로 다시 노출하면) 신청한 분들께 문자
-- 문자 기능(솔라피)이 꺼져 있으면 보내지 않고 신청을 그대로 남겨 둠
create or replace function public.products_restock_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; url text;
begin
  if new.visible and not new.sold_out and (old.sold_out or not old.visible)
     and exists (select 1 from public.shop_info where id = 1 and sms_enabled) then
    url := rtrim(coalesce((select site_url from public.shop_info where id = 1), 'https://keumbi.wnsdn9203.workers.dev'), '/') || '/?p=' || new.id;
    for r in select * from public.restock_requests where product_id = new.id and notified_at is null order by created_at limit 50 loop
      perform public.send_sms(r.phone, format(E'[금비 GOLD] 재입고 알림\n%s 상품이 다시 입고되었어요.\n%s\n문의 010-5287-8002', new.name, url));
      update public.restock_requests set notified_at = now() where id = r.id;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists products_restock_notify on public.products;
create trigger products_restock_notify after update on public.products for each row execute function public.products_restock_notify();
revoke all on function public.products_restock_notify() from public, anon, authenticated;

-- 관리자 화면용: 상품별 재입고 알림 대기 인원
create or replace function public.restock_waiting()
returns table (product_id uuid, waiting int)
language sql stable security definer set search_path = public as $$
  select r.product_id, count(*)::int from public.restock_requests r
   where public.is_admin() and r.notified_at is null group by r.product_id;
$$;
revoke all on function public.restock_waiting() from public, anon;
grant execute on function public.restock_waiting() to authenticated;

select '상품 설명 · 후기 · 재입고 알림 설정 완료' as result;
