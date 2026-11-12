-- 2026-11-12 사진 후기: 후기 1개에 사진 최대 3장
-- 사진은 Supabase Storage 'review-photos' 칸에 회원별 폴더(회원id/파일)로 저장, 누구나 볼 수 있음

-- 1) 사진 저장 칸 (사진 1장 최대 5MB, 사진 파일만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- 회원은 자기 폴더에만 올리고 지울 수 있음 · 관리자는 모두 지울 수 있음
drop policy if exists "review_photos_insert_own" on storage.objects;
create policy "review_photos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "review_photos_delete_own" on storage.objects;
create policy "review_photos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'review-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- 2) 후기에 사진 칸 추가 (저장 경로 목록)
alter table public.reviews add column if not exists photos text[] not null default '{}';

-- 사진 경로 검사: 내 폴더의 파일만, 최대 3장
create or replace function public.review_photos_ok(p_photos text[])
returns text[] language plpgsql stable set search_path = public as $$
declare x text; out text[] := '{}';
begin
  if p_photos is null then return out; end if;
  if cardinality(p_photos) > 3 then raise exception '사진은 3장까지 올릴 수 있어요'; end if;
  foreach x in array p_photos loop
    if x !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]{1,80}$') then raise exception '사진을 다시 올려 주세요'; end if;
    out := out || x;
  end loop;
  return out;
end $$;

-- 3) 후기 쓰기: 사진 받도록 바꿈 (예전 함수는 지움)
drop function if exists public.submit_review(uuid, int, text, text, text);
create or replace function public.submit_review(p_product uuid, p_rating int, p_body text, p_photos text[] default null)
returns text language plpgsql volatile security definer set search_path = public as $$
declare o public.orders; nm text; opt text; rid bigint; si public.shop_info; ph text[];
begin
  if auth.uid() is null then raise exception '후기는 로그인한 회원만 쓸 수 있어요'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception '별점을 골라 주세요'; end if;
  if char_length(trim(coalesce(p_body, ''))) < 10 then raise exception '후기는 10자 이상 써 주세요'; end if;
  if char_length(p_body) > 1000 then raise exception '후기는 1000자까지 쓸 수 있어요'; end if;
  ph := public.review_photos_ok(p_photos);

  -- 이 상품이 들어 있고, 아직 후기를 안 쓴 내 주문 (주문 1건당 후기 1개)
  select x.* into o from public.orders x
   where x.user_id = auth.uid()
     and x.status in ('paid', 'ready', 'done')
     and (x.product_id = p_product
          or coalesce(x.items, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('product_id', p_product::text)))
     and not exists (select 1 from public.reviews r where r.order_id = x.id)
   order by x.created_at desc limit 1;

  if o.id is null then
    return case when exists (select 1 from public.orders x
                              where x.user_id = auth.uid() and x.status in ('paid', 'ready', 'done')
                                and (x.product_id = p_product
                                     or coalesce(x.items, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('product_id', p_product::text))))
                then '이 주문의 후기는 이미 써 주셨어요. 후기는 주문 1건당 1개만 쓸 수 있어요. 쓴 후기는 목록에서 ''수정''을 눌러 고칠 수 있어요.'
                else '이 계정으로 구매하신 기록을 찾지 못했어요. 후기는 회원으로 주문하고 입금이 확인된 뒤에 쓸 수 있어요.' end;
  end if;

  nm := coalesce(nullif(trim((select p.name from public.profiles p where p.id = auth.uid())), ''), o.name);
  select it ->> 'name' into opt from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) it
   where it ->> 'product_id' = p_product::text limit 1;
  insert into public.reviews (product_id, order_id, user_id, name, rating, body, option_label, photos)
  values (p_product, o.id, auth.uid(), left(nm, 40), p_rating, trim(p_body), left(coalesce(opt, o.product_name), 120), ph)
  returning id into rid;

  -- 후기 이벤트: 쿠폰 지급 (받은 날부터 N개월)
  select * into si from public.shop_info where id = 1;
  if si.review_event and si.review_coupon > 0 then
    insert into public.coupons (user_id, name, amount, min_order, expires_at, source)
    values (auth.uid(), '후기 감사 쿠폰', si.review_coupon, si.coupon_min, now() + make_interval(months => si.coupon_months), 'review:' || rid)
    on conflict do nothing;
    return 'ok_coupon:' || si.review_coupon;
  end if;
  return 'ok';
end $$;
revoke all on function public.submit_review(uuid, int, text, text[]) from public, anon;
grant execute on function public.submit_review(uuid, int, text, text[]) to authenticated;

-- 4) 내 후기 고치기: 사진도 바꿀 수 있게 (p_photos 를 안 보내면 사진은 그대로)
drop function if exists public.update_my_review(bigint, int, text);
create or replace function public.update_my_review(p_id bigint, p_rating int, p_body text, p_photos text[] default null)
returns text language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인해 주세요'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception '별점을 골라 주세요'; end if;
  if char_length(trim(coalesce(p_body, ''))) < 10 then raise exception '후기는 10자 이상 써 주세요'; end if;
  if char_length(p_body) > 1000 then raise exception '후기는 1000자까지 쓸 수 있어요'; end if;
  update public.reviews
     set rating = p_rating, body = trim(p_body), edited_at = now(),
         photos = case when p_photos is null then photos else public.review_photos_ok(p_photos) end
   where id = p_id and user_id = auth.uid();
  if not found then raise exception '내가 쓴 후기만 고칠 수 있어요'; end if;
  return 'ok';
end $$;
revoke all on function public.update_my_review(bigint, int, text, text[]) from public, anon;
grant execute on function public.update_my_review(bigint, int, text, text[]) to authenticated;

-- 5) 손님 화면용 후기 목록에 사진 추가
drop function if exists public.product_reviews(uuid[]);
create function public.product_reviews(p_ids uuid[])
returns table (id bigint, product_id uuid, name text, rating int, body text, option_label text, reply text, created_at timestamptz,
               mine boolean, edited boolean, gift boolean, photos text[])
language sql stable security definer set search_path = public as $$
  select r.id, r.product_id,
         case when char_length(r.name) <= 2 then left(r.name, 1) || '*'
              else left(r.name, 1) || repeat('*', char_length(r.name) - 2) || right(r.name, 1) end,
         r.rating, r.body, r.option_label, r.reply, r.created_at,
         (auth.uid() is not null and r.user_id = auth.uid()), r.edited_at is not null,
         exists (select 1 from public.coupons c where c.source = 'review:' || r.id),
         r.photos
    from public.reviews r
   where r.visible and r.product_id = any(p_ids)
   order by r.created_at desc
   limit 200;
$$;
revoke all on function public.product_reviews(uuid[]) from public;
grant execute on function public.product_reviews(uuid[]) to anon, authenticated;

select '사진 후기 설정 완료' as result;
