-- 2026-11-12 시세 기록(그래프용) + 시세 알림(이메일)
-- 10분마다: 오늘 시세를 기록하고, 조건에 맞는 알림 메일을 보냄. 여러 번 실행해도 안전합니다.

-- 1) 날짜별 시세 (1돈 기준 · 살 때는 부가세 포함, 홈페이지 시세표와 같은 식)
create table if not exists public.price_daily (
  day        date primary key,
  au_buy     numeric not null,
  au_sell    numeric not null,
  ag_buy     numeric,
  au_high    numeric,
  au_low     numeric,
  updated_at timestamptz not null default now()
);
alter table public.price_daily enable row level security;
drop policy if exists "price_daily_read" on public.price_daily;
create policy "price_daily_read" on public.price_daily for select using (true);
grant select on public.price_daily to anon, authenticated;

-- 지금 시세 (1돈): 순금 살 때 · 순금 팔 때 · 은 살 때
create or replace function public.current_don_prices(out au_buy numeric, out au_sell numeric, out ag_buy numeric)
language plpgsql stable security definer set search_path = public as $$
declare s public.price_settings; au numeric; ag numeric; d numeric;
begin
  select * into s from public.price_settings where id = 1;
  select krw_per_oz into au from public.live_prices where symbol = 'XAU' and fetched_at > now() - interval '10 minutes';
  select krw_per_oz into ag from public.live_prices where symbol = 'XAG' and fetched_at > now() - interval '10 minutes';
  if au is not null then
    d := au / 31.1034768 * 3.75;
    au_buy := round(d * (1 + s.gold_buy_pct / 100) * 1.1 / 100) * 100;
    au_sell := round(d * (1 + s.gold_sell_pct / 100) / 100) * 100;
  end if;
  if ag is not null then
    ag_buy := round(ag / 31.1034768 * 3.75 * (1 + s.ag_buy_pct / 100) * 1.1 / 10) * 10;
  end if;
end $$;
revoke all on function public.current_don_prices() from public, anon, authenticated;

-- 2) 시세 알림 신청 (이메일 · 1회 발송 후 끝)
--    kind = 'buy'  : 순금 1돈 '살 때' 가격이 목표 이하가 되면
--    kind = 'sell' : 순금 1돈 '팔 때' 가격이 목표 이상이 되면
create table if not exists public.price_alerts (
  id         bigint generated always as identity primary key,
  email      text not null,
  kind       text not null check (kind in ('buy', 'sell')),
  target     numeric not null check (target > 0),
  user_id    uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists price_alerts_open on public.price_alerts (kind, target) where sent_at is null;
alter table public.price_alerts enable row level security;
drop policy if exists "price_alerts_admin_read" on public.price_alerts;
create policy "price_alerts_admin_read" on public.price_alerts for select using (public.is_admin());

create or replace function public.add_price_alert(p_email text, p_kind text, p_target numeric)
returns text language plpgsql volatile security definer set search_path = public as $$
declare e text := lower(trim(coalesce(p_email, ''))); c record;
begin
  if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(e) > 100 then raise exception '이메일 주소를 확인해 주세요'; end if;
  if p_kind not in ('buy', 'sell') then raise exception '알림 종류를 골라 주세요'; end if;
  select * into c from public.current_don_prices();
  if c.au_buy is null then raise exception '지금은 시세를 확인할 수 없어요. 잠시 후 다시 시도해 주세요'; end if;
  if p_target is null or p_target < c.au_buy * 0.5 or p_target > c.au_buy * 1.5 then
    raise exception '목표 가격은 지금 시세의 50%%~150%% 사이로 적어 주세요';
  end if;
  if p_kind = 'buy' and p_target >= c.au_buy then raise exception '지금 살 때 가격(%원)보다 낮은 금액을 적어 주세요', to_char(c.au_buy, 'FM999,999,999'); end if;
  if p_kind = 'sell' and p_target <= c.au_sell then raise exception '지금 팔 때 가격(%원)보다 높은 금액을 적어 주세요', to_char(c.au_sell, 'FM999,999,999'); end if;
  if (select count(*) from public.price_alerts where email = e and sent_at is null) >= 3 then
    raise exception '알림은 이메일 하나에 3개까지 신청할 수 있어요';
  end if;
  insert into public.price_alerts (email, kind, target, user_id) values (e, p_kind, round(p_target), auth.uid());
  return 'ok';
end $$;
revoke all on function public.add_price_alert(text, text, numeric) from public;
grant execute on function public.add_price_alert(text, text, numeric) to anon, authenticated;

-- 3) 10분마다: 오늘 시세 기록 + 알림 메일 (주문 메일 한도를 지키려고 알림 메일은 하루 20통까지)
create or replace function public.price_tick()
returns void language plpgsql security definer set search_path = public as $$
declare c record; a record; si public.shop_info; sent int; msg text; kind_txt text; now_price numeric;
begin
  select * into c from public.current_don_prices();
  if c.au_buy is null then return; end if;
  insert into public.price_daily as d (day, au_buy, au_sell, ag_buy, au_high, au_low)
  values (public.kst_today(), c.au_buy, c.au_sell, c.ag_buy, c.au_buy, c.au_buy)
  on conflict (day) do update set au_buy = excluded.au_buy, au_sell = excluded.au_sell, ag_buy = coalesce(excluded.ag_buy, d.ag_buy),
    au_high = greatest(d.au_high, excluded.au_buy), au_low = least(d.au_low, excluded.au_buy), updated_at = now();

  select * into si from public.shop_info where id = 1;
  select count(*) into sent from public.price_alerts where sent_at > now() - interval '24 hours';
  for a in
    select * from public.price_alerts
     where sent_at is null
       and ((kind = 'buy' and c.au_buy <= target) or (kind = 'sell' and c.au_sell >= target))
     order by created_at limit 20
  loop
    exit when sent >= 20;
    kind_txt := case a.kind when 'buy' then '살 때' else '팔 때' end;
    now_price := case a.kind when 'buy' then c.au_buy else c.au_sell end;
    msg := format('<div style="font-family:sans-serif;max-width:480px;margin:auto;color:#16140f">'
      || '<h2 style="font-size:18px">금 시세 알림</h2>'
      || '<p>신청하신 조건에 도달했어요.</p>'
      || '<p style="font-size:15px">순금 1돈 %s 가격: <b style="font-size:20px">%s원</b><br><span style="color:#888">(신청 목표 %s원 · %s 기준)</span></p>'
      || '<p><a href="%s" style="display:inline-block;background:#12110e;color:#ecd08a;padding:12px 20px;text-decoration:none;border-radius:6px">지금 시세 보기</a></p>'
      || '<p style="color:#888;font-size:12px">시세는 실시간으로 바뀌어 메일을 여는 시점에는 달라질 수 있어요. 이 알림은 한 번만 보내 드리며, 신청 정보는 발송 후 30일 안에 삭제돼요.</p></div>',
      kind_txt, to_char(now_price, 'FM999,999,999'), to_char(a.target, 'FM999,999,999'),
      to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI'), si.site_url || '/#price');
    if public.send_email(a.email, '[금비 GOLD] 순금 1돈 ' || kind_txt || ' ' || to_char(now_price, 'FM999,999,999') || '원 — 시세 알림', msg) then
      update public.price_alerts set sent_at = now() where id = a.id;
      sent := sent + 1;
    end if;
  end loop;

  -- 개인정보 정리: 보낸 알림은 30일, 안 보낸 알림은 180일 뒤 삭제
  delete from public.price_alerts where (sent_at is not null and sent_at < now() - interval '30 days') or created_at < now() - interval '180 days';
end $$;
revoke all on function public.price_tick() from public, anon, authenticated;

select cron.unschedule('keumbi-price-tick') where exists (select 1 from cron.job where jobname = 'keumbi-price-tick');
select cron.schedule('keumbi-price-tick', '*/10 * * * *', 'select public.price_tick()');
select public.price_tick();

select '시세 기록·시세 알림 설정 완료' as result;
