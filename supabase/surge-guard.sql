-- 2026-11-12
-- ① 생일 쿠폰: 생일 '당일' 오전 9시에 지급 (전에는 7일 전)
-- ② 금값 급등 자동 품절: 최근 1시간 최저가보다 1.5% 이상 오르면 금 상품 전부 품절 (실버는 그대로)
--    · 더 오르지 않고 30분이 지나면 자동으로 다시 열림
--    · 관리자 > 시세 설정 > '급등 자동 품절' 에서 [지금 바로 풀기] 가능, 기준(%, 분)도 바꿀 수 있음
-- 여러 번 실행해도 안전합니다.

-- ① 생일 당일 지급 ------------------------------------------------------------
update public.shop_info set anniv_lead = 0 where id = 1;

-- 문자 문구: '미리 축하' → '생일 축하' (나머지는 birthday.sql 과 같음)
create or replace function public.bday_give(p_uid uuid, p_year int, p_sms boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare si public.shop_info; pf public.profiles; src text := 'bday:' || p_year || ':' || p_uid;
begin
  select * into si from public.shop_info where id = 1;
  if coalesce(si.anniv_coupon, 0) <= 0 then return false; end if;
  if exists (select 1 from public.coupons where source = src) then return false; end if;
  select * into pf from public.profiles where id = p_uid;
  insert into public.coupons (user_id, name, amount, min_order, expires_at, source)
  values (p_uid, '생일 축하 쿠폰', si.anniv_coupon, si.anniv_min, now() + make_interval(days => si.anniv_days), src);
  if p_sms and pf.marketing and coalesce(pf.phone, '') <> '' then
    perform public.send_sms(pf.phone, format(E'(광고)[금비 GOLD] %s님, 생일 축하드려요!\n%s원 쿠폰을 드렸어요.\n상품 %s원 이상 · %s일 안에 사용 (골드바·실버바 제외)\n홈페이지 > 주문내역에서 확인하세요.\n수신거부: 홈페이지 주문내역 > 혜택 문자 끄기',
      coalesce(nullif(pf.name, ''), '회원'), public.fmt_won(si.anniv_coupon), public.fmt_won(si.anniv_min), si.anniv_days));
  end if;
  return true;
exception when unique_violation then return false;
end $$;
revoke all on function public.bday_give(uuid, int, boolean) from public, anon, authenticated;

-- ② 급등 자동 품절 ------------------------------------------------------------
alter table public.shop_info
  add column if not exists surge_auto       boolean not null default true,
  add column if not exists surge_pct        numeric not null default 1.5,
  add column if not exists surge_window_min int     not null default 60,
  add column if not exists surge_hold_min   int     not null default 30,
  add column if not exists surge_on         boolean not null default false,
  add column if not exists surge_since      timestamptz,
  add column if not exists surge_low        numeric,
  add column if not exists surge_peak       numeric,
  add column if not exists surge_peak_at    timestamptz,
  add column if not exists surge_reset_at   timestamptz;

alter table public.shop_info drop constraint if exists shop_info_surge_check;
alter table public.shop_info add constraint shop_info_surge_check
  check (surge_pct between 0.3 and 20 and surge_window_min between 10 and 360 and surge_hold_min between 5 and 360);

-- 1분마다 국제 금 시세(원/oz) 기록 (하루치만 보관)
create table if not exists public.gold_ticks (
  at         timestamptz primary key,
  krw_per_oz numeric not null
);
alter table public.gold_ticks enable row level security;
drop policy if exists "gold_ticks_admin" on public.gold_ticks;
create policy "gold_ticks_admin" on public.gold_ticks for select using (public.is_admin());
grant select on public.gold_ticks to authenticated;

-- 급등 판단 (1분마다 자동 실행)
create or replace function public.surge_check()
returns void language plpgsql security definer set search_path = public as $$
declare si public.shop_info; cur numeric; t timestamptz; low numeric;
begin
  select krw_per_oz, fetched_at into cur, t from public.live_prices where symbol = 'XAU';
  if cur is null or t < now() - interval '10 minutes' then return; end if; -- 시세가 낡았으면 판단하지 않음
  insert into public.gold_ticks (at, krw_per_oz) values (date_trunc('minute', now()), cur)
    on conflict (at) do update set krw_per_oz = excluded.krw_per_oz;
  delete from public.gold_ticks where at < now() - interval '1 day';

  select * into si from public.shop_info where id = 1 for update;
  if si.surge_on then
    if cur > coalesce(si.surge_peak, 0) then
      -- 더 오르는 중 → 30분 타이머 다시 시작
      update public.shop_info set surge_peak = cur, surge_peak_at = now() where id = 1;
    elsif now() - si.surge_peak_at >= make_interval(mins => si.surge_hold_min) then
      -- 정해진 시간 동안 더 오르지 않음 → 자동으로 다시 열기 (이 시점부터 새로 계산)
      update public.shop_info set surge_on = false, surge_reset_at = now() where id = 1;
    end if;
    return;
  end if;

  if not si.surge_auto then return; end if;
  select min(krw_per_oz) into low from public.gold_ticks
   where at >= greatest(now() - make_interval(mins => si.surge_window_min), coalesce(si.surge_reset_at, '-infinity'::timestamptz));
  if low > 0 and cur >= low * (1 + si.surge_pct / 100) then
    update public.shop_info
       set surge_on = true, surge_since = now(), surge_low = low, surge_peak = cur, surge_peak_at = now()
     where id = 1;
  end if;
end $$;
revoke all on function public.surge_check() from public, anon, authenticated;

-- 관리자: 지금 바로 풀기 (풀린 시점부터 다시 1.5%를 계산하므로 곧바로 다시 걸리지 않음)
create or replace function public.surge_release()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있어요'; end if;
  update public.shop_info set surge_on = false, surge_reset_at = now() where id = 1;
end $$;
revoke all on function public.surge_release() from public, anon;
grant execute on function public.surge_release() to authenticated;

-- 급등 품절 중에는 금 상품 주문을 서버에서도 막음 (관리자는 예외)
create or replace function public.guard_surge()
returns trigger language plpgsql security definer set search_path = public as $$
declare ids uuid[]; nm text;
begin
  if public.is_admin() or not coalesce((select surge_on from public.shop_info where id = 1), false) then return new; end if;
  ids := array_remove(array[new.product_id], null)
      || coalesce((select array_agg((x ->> 'product_id')::uuid) from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x
                    where x ? 'product_id'), '{}');
  select name into nm from public.products where id = any(ids) and kind <> 'silver' limit 1;
  if nm is not null then
    raise exception '품절된 상품이 있어요: %', nm;
  end if;
  return new;
end $$;
drop trigger if exists orders_surge on public.orders;
create trigger orders_surge before insert on public.orders for each row execute function public.guard_surge();

-- 1분마다 실행
select cron.unschedule(jobid) from cron.job where jobname = 'keumbi-surge';
select cron.schedule('keumbi-surge', '* * * * *', $job$select public.surge_check()$job$);

select '완료' as result;
