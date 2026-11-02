-- =========================================================
-- 13) 내 주문내역 (회원): 본인 주문·매입만, 손님에게 보여도 되는 칸만
-- =========================================================
create or replace function public.my_requests()
returns table (kind text, code text, title text, status text, amount numeric, shipping_fee numeric,
               deadline timestamptz, locked_at timestamptz, method text, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'order'::text, o.code, o.product_name || ' × ' || o.qty, o.status, o.final_price, o.shipping_fee,
           o.pay_deadline, o.price_locked_at, o.receive, o.created_at, o.updated_at
      from public.orders o where auth.uid() is not null and o.user_id = auth.uid()
    union all
    select 'sell'::text, s.code, s.items, s.status, s.final_amount, null::numeric,
           null::timestamptz, null::timestamptz, s.method, s.created_at, s.updated_at
      from public.sell_requests s where auth.uid() is not null and s.user_id = auth.uid()
  ) t order by t.created_at desc limit 100;
$$;
revoke all on function public.my_requests() from public, anon;
grant execute on function public.my_requests() to authenticated;

select '주문내역 설정 완료' as result;