-- =========================================================
-- 18) 주문 메일 나누기
--     주문 직후: 손님 '주문 확인서'(입금 안내) + 사장님 '주문내역서'
--     관리자가 '입금 확인'으로 바꿀 때: 손님 '구매내역서'(결제 완료)
--     order-email.sql 을 먼저 실행한 뒤 실행하세요. 여러 번 실행해도 안전합니다.
-- =========================================================
alter table public.order_mails add column if not exists paid_at timestamptz;

drop function if exists public.order_mail_html(public.orders, public.order_mails, boolean);

-- p_kind: 'owner' 사장님 주문내역서 / 'confirm' 손님 주문 확인서 / 'paid' 손님 구매내역서
create or replace function public.order_mail_html(o public.orders, m public.order_mails, p_kind text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  si public.shop_info; it jsonb; link text; lines text := ''; info text := ''; extra text := ''; btn text; st text; rc text;
  title text; lead text;
  td  text := 'padding:10px 0;border-bottom:1px solid #eee;vertical-align:top';
  tdr text := 'padding:10px 0;border-bottom:1px solid #eee;vertical-align:top;text-align:right;white-space:nowrap';
  th  text := 'padding:9px 14px 9px 0;border-bottom:1px solid #f0f0f0;color:#888;font-weight:400;text-align:left;white-space:nowrap;vertical-align:top';
  tv  text := 'padding:9px 0;border-bottom:1px solid #f0f0f0;vertical-align:top';
  owner boolean := p_kind = 'owner';
begin
  select * into si from public.shop_info where id = 1;
  link := si.site_url || '/order-done?code=' || o.code || '&t=' || m.token;

  -- 상품 목록
  if jsonb_typeof(o.items) = 'array' and jsonb_array_length(o.items) > 0 then
    for it in select value from jsonb_array_elements(o.items) loop
      lines := lines || format('<tr><td style="%s">%s × %s</td><td style="%s">%s</td></tr>',
        td, public.html_esc(it ->> 'name'), public.html_esc(it ->> 'qty'), tdr,
        coalesce(public.fmt_won((it ->> 'subtotal')::numeric) || '원', '-'));
    end loop;
  else
    lines := format('<tr><td style="%s">%s × %s</td><td style="%s">%s</td></tr>',
      td, public.html_esc(o.product_name), o.qty, tdr,
      coalesce(public.fmt_won(o.final_price - coalesce(o.shipping_fee, 0)) || '원', '-'));
  end if;
  if coalesce(o.shipping_fee, 0) > 0 then
    lines := lines || format('<tr><td style="%s">택배비 (보험 등기)</td><td style="%s">%s원</td></tr>', td, tdr, public.fmt_won(o.shipping_fee));
  end if;
  lines := lines || format('<tr><td style="padding:14px 0 4px;font-weight:700">%s</td><td style="padding:14px 0 4px;text-align:right;white-space:nowrap;font-weight:700;font-size:19px;color:#9c7629">%s</td></tr>',
    case when p_kind = 'paid' then '결제 금액' else '합계' end,
    coalesce(public.fmt_won(o.final_price) || '원', '금액 확정 전'));

  st := case o.status when 'new' then '접수' when 'confirmed' then '입금 대기' when 'paid' then '입금 확인'
          when 'ready' then case when o.receive = 'delivery' then '발송' else '수령 준비' end
          when 'done' then '완료' when 'canceled' then '취소' else o.status end;

  -- 주문 정보
  info := format('<tr><th style="%s">접수번호</th><td style="%s"><b>%s</b></td></tr>', th, tv, o.code)
       || format('<tr><th style="%s">주문일시</th><td style="%s">%s</td></tr>', th, tv, to_char(o.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'))
       || case when p_kind = 'paid' then format('<tr><th style="%s">결제 확인</th><td style="%s">%s</td></tr>', th, tv, to_char(coalesce(o.paid_at, now()) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')) else '' end
       || format('<tr><th style="%s">진행 상태</th><td style="%s">%s</td></tr>', th, tv, st);

  if owner then
    title := '주문내역서';
    lead := '홈페이지에서 새 주문이 들어왔어요.';
    rc := case o.receipt ->> 'type'
            when 'personal' then '현금영수증 (소득공제) ' || coalesce(o.receipt ->> 'no', '')
            when 'business' then '현금영수증 (지출증빙) ' || coalesce(o.receipt ->> 'no', '')
            when 'invoice'  then '세금계산서 · ' || concat_ws(' / ', o.receipt ->> 'company', o.receipt ->> 'ceo', o.receipt ->> 'no', o.receipt ->> 'email')
            else '신청 안 함' end;
    info := info
       || format('<tr><th style="%s">주문자</th><td style="%s"><b>%s</b></td></tr>', th, tv, public.html_esc(o.name))
       || format('<tr><th style="%s">휴대폰</th><td style="%s"><a href="tel:%s" style="color:#16140f">%s</a></td></tr>', th, tv, o.phone, o.phone)
       || format('<tr><th style="%s">이메일</th><td style="%s">%s</td></tr>', th, tv, coalesce(nullif(public.html_esc(m.email), ''), '-'))
       || format('<tr><th style="%s">수령 방법</th><td style="%s">%s</td></tr>', th, tv, case when o.receive = 'delivery' then '안심 택배' else '매장 방문 수령' end)
       || case when o.receive = 'delivery' then format('<tr><th style="%s">배송 주소</th><td style="%s">%s</td></tr>', th, tv, public.html_esc(o.address)) else '' end
       || format('<tr><th style="%s">요청 사항</th><td style="%s">%s</td></tr>', th, tv, coalesce(nullif(public.html_esc(o.note), ''), '-'))
       || format('<tr><th style="%s">영수증</th><td style="%s">%s</td></tr>', th, tv, public.html_esc(rc))
       || case when o.pay_deadline is not null then format('<tr><th style="%s">입금 기한</th><td style="%s">%s (지나면 자동 취소)</td></tr>', th, tv, to_char(o.pay_deadline at time zone 'Asia/Seoul', 'MM/DD HH24:MI')) else '' end;
    btn := format('<a href="%s/admin" style="display:block;text-align:center;background:#16140f;color:#ecd08a;padding:15px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">관리자 페이지에서 처리하기</a>'
               || '<p style="text-align:center;margin:12px 0 0;font-size:13px"><a href="%s" style="color:#888">손님에게 보이는 화면 보기</a></p>',
               si.site_url, public.html_esc(link));
  else
    info := info
       || format('<tr><th style="%s">수령 방법</th><td style="%s">%s</td></tr>', th, tv, case when o.receive = 'delivery' then '안심 택배 (보험 등기)' else '매장 방문 수령' end)
       || case when o.receive = 'delivery' then format('<tr><th style="%s">배송 주소</th><td style="%s">%s</td></tr>', th, tv, public.html_esc(o.address)) else '' end;
    if p_kind = 'paid' then
      title := '구매내역서';
      lead := public.html_esc(o.name) || '님, 결제가 확인되었어요. 금비 GOLD에서 구매해 주셔서 감사합니다.';
      extra := '<div style="margin:22px 0 0;padding:18px;border:1px solid #cfe3d3;background:#f3faf4;border-radius:10px;line-height:1.8">'
        || '<b style="font-size:15px;color:#2e7d4f">결제 완료</b><br>'
        || case when o.receive = 'delivery'
             then '보험 등기 택배로 발송하고, 송장번호를 문자로 알려드릴게요.'
             else '상품이 준비되면 매장 수령 안내를 드릴게요.<br><span style="color:#888;font-size:13px">매장: 서울 종로구 율곡로10길 105 디아망 빌딩 2층 · 평일 10:00~19:00</span>' end
        || '</div>';
      btn := format('<a href="%s" style="display:block;text-align:center;background:#16140f;color:#ecd08a;padding:15px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">구매내역 보기</a>', public.html_esc(link));
    else
      title := '주문 확인서';
      lead := public.html_esc(o.name) || '님, 주문이 접수되었어요. 아래 계좌로 입금해 주시면 구매가 완료돼요.';
      if o.status = 'confirmed' and o.final_price is not null then
        extra := format(
          '<div style="margin:22px 0 0;padding:18px;border:1px solid #e8dcc0;background:#fffaf0;border-radius:10px;line-height:1.8">'
          || '<b style="font-size:15px">입금 안내</b><br>'
          || '입금하실 금액 <b style="color:#9c7629">%s원</b><br>'
          || '입금 계좌 <b>%s %s</b> (예금주 %s)<br>'
          || '<b style="color:#c0392b">%s까지</b> 입금되지 않으면 주문이 자동 취소돼요.<br>'
          || '<span style="color:#888;font-size:13px">입금자명은 주문하신 분 이름과 같게 해 주세요. 입금이 확인되면 구매내역서를 메일로 보내드려요.</span></div>',
          public.fmt_won(o.final_price), public.html_esc(si.bank_name), public.html_esc(si.bank_account), public.html_esc(si.bank_holder),
          to_char(o.pay_deadline at time zone 'Asia/Seoul', 'MM/DD HH24:MI'));
      elsif o.final_price is null then
        lead := public.html_esc(o.name) || '님, 구매 신청이 접수되었어요.';
        extra := '<p style="margin:22px 0 0;padding:16px;background:#f7f7f7;border-radius:10px;line-height:1.7">지금은 금액이 확정되지 않았어요. 매장에서 확정 금액과 입금 계좌를 곧 연락드릴게요.</p>';
      end if;
      btn := format('<a href="%s" style="display:block;text-align:center;background:#16140f;color:#ecd08a;padding:15px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">주문 내역 보기</a>', public.html_esc(link));
    end if;
    extra := extra || '<p style="margin:16px 0 0;color:#888;font-size:13px;line-height:1.7">· 금·은 시세 상품은 금액 확정·입금 후 단순 변심에 의한 취소·반품이 어려워요.<br>· 진행 상황(입금 확인·발송)은 아래 버튼에서 언제든 확인할 수 있어요.</p>';
  end if;

  return format(
    '<div style="background:#f3f0e8;padding:28px 12px;font-family:''Apple SD Gothic Neo'',''Malgun Gothic'',''맑은 고딕'',sans-serif;color:#16140f">'
    || '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden">'
    || '<div style="background:#16140f;padding:20px 26px;font-size:21px;font-weight:700;color:#ecd08a;letter-spacing:.5px">금비 <span style="font-weight:400">GOLD</span></div>'
    || '<div style="padding:26px">'
    || '<h1 style="margin:0 0 6px;font-size:23px">%s</h1>'
    || '<p style="margin:0 0 22px;color:#666;line-height:1.6">%s</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%%;border-collapse:collapse;font-size:14px;margin-bottom:22px">%s</table>'
    || '<p style="margin:0 0 4px;font-weight:700;font-size:15px">주문 상품</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%%;border-collapse:collapse;font-size:14px">%s</table>'
    || '%s'
    || '<div style="margin-top:26px">%s</div>'
    || '</div>'
    || '<div style="padding:18px 26px;background:#faf8f3;color:#999;font-size:12px;line-height:1.7">'
    || '%s상호 금비 · 대표 김신애 · 사업자등록번호 101-12-25419 · 통신판매업신고 제2021-서울종로-1219호<br>'
    || '서울특별시 종로구 율곡로10길 105 디아망 빌딩 2층 · 고객센터 010-5287-8002</div>'
    || '</div></div>',
    title, lead, info, lines, extra, btn,
    case when owner then '' else '이 메일에 답장하시면 매장으로 전달돼요.<br>' end);
end $$;
revoke all on function public.order_mail_html(public.orders, public.order_mails, text) from public, anon, authenticated;

-- 주문 직후 메일 (손님 주문 확인서 + 사장님 주문내역서, 이미 보낸 건 다시 안 보냄)
create or replace function public.mail_order(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; m public.order_mails; si public.shop_info;
begin
  select * into o from public.orders where id = p_id;
  select * into m from public.order_mails where order_id = p_id for update;
  if o.id is null or m.order_id is null then return; end if;
  select * into si from public.shop_info where id = 1;
  if m.customer_at is null and m.email is not null then
    if public.send_email(m.email, '[금비 GOLD] 주문 확인서 · 입금 안내 (접수번호 ' || o.code || ')', public.order_mail_html(o, m, 'confirm')) then
      update public.order_mails set customer_at = now() where order_id = p_id;
    end if;
  end if;
  if m.owner_at is null then
    if public.send_email(si.owner_email,
         '[금비] 주문내역서 ' || o.code || ' · ' || o.name || ' · ' || coalesce(public.fmt_won(o.final_price) || '원', '금액 미확정'),
         public.order_mail_html(o, m, 'owner')) then
      update public.order_mails set owner_at = now() where order_id = p_id;
    end if;
  end if;
end $$;
revoke all on function public.mail_order(bigint) from public, anon, authenticated;

-- 입금 확인 시 손님에게 구매내역서 (한 번만 · 실패해도 관리자 처리는 그대로)
create or replace function public.orders_mail_paid()
returns trigger language plpgsql security definer set search_path = public as $$
declare m public.order_mails;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    select * into m from public.order_mails where order_id = new.id;
    if m.order_id is not null and m.email is not null and m.paid_at is null then
      if public.send_email(m.email, '[금비 GOLD] 구매내역서 (접수번호 ' || new.code || ')', public.order_mail_html(new, m, 'paid')) then
        update public.order_mails set paid_at = now() where order_id = new.id;
      end if;
    end if;
  end if;
  return new;
exception when others then
  raise warning '구매내역서 발송 실패: %', sqlerrm;
  return new;
end $$;
drop trigger if exists orders_mail_paid on public.orders;
create trigger orders_mail_paid after update of status on public.orders for each row execute function public.orders_mail_paid();
revoke all on function public.orders_mail_paid() from public, anon, authenticated;

select '주문 메일 나누기 완료' as result;
