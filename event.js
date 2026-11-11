/* 후기 이벤트 팝업 (첫 화면) — 관리자 > 시세 설정 '후기 이벤트'를 끄면 안 뜸 · '오늘 하루 보지 않기' */
(function () {
  const { sb, won } = window.YAMOO;
  if (!sb) return;
  const KEY = "keumbi_evt_hide";
  const today = new Date().toDateString();
  try { if (localStorage.getItem(KEY) === today) return; } catch { /* 저장이 막혀 있으면 그냥 보여줌 */ }
  if (new URLSearchParams(location.search).get("p")) return; // 상품 링크로 들어온 손님은 방해하지 않음

  sb.from("shop_info").select("review_event,review_coupon,coupon_min,coupon_days").eq("id", 1).maybeSingle().then(({ data, error }) => {
    if (error || !data || !data.review_event || !(data.review_coupon > 0)) return;
    setTimeout(() => show(data), 1200);
  }, () => {});

  function show(c) {
    if (document.querySelector(".modal:not([hidden]), #searchPanel:not([hidden])")) return; // 다른 창을 보고 있으면 띄우지 않음
    const m = document.createElement("div");
    m.className = "modal evt-modal";
    m.innerHTML = `
      <div class="modal__backdrop" data-evx></div>
      <div class="modal__box evt" role="dialog" aria-modal="true" aria-labelledby="evtTitle">
        <button class="modal__x evt__x" data-evx aria-label="닫기">×</button>
        <div class="evt__top">
          <p class="evt__eyebrow">REVIEW EVENT</p>
          <h2 id="evtTitle">구매 후기 남기면<br><b>${won(c.review_coupon)}</b> 쿠폰</h2>
          <p class="evt__coin" aria-hidden="true">₩</p>
        </div>
        <div class="evt__body">
          <ol class="evt__steps">
            <li><b>1</b><span>회원으로 로그인하고 주문</span></li>
            <li><b>2</b><span>입금 확인 후 상품 상세 또는 주문내역에서 <em>후기 쓰기</em></span></li>
            <li><b>3</b><span>등록 즉시 쿠폰 지급</span></li>
          </ol>
          <p class="evt__note">홈페이지 주문 전용${c.coupon_min ? ` · 상품 금액 ${won(c.coupon_min)} 이상` : ""} · 지급일부터 ${c.coupon_days}일 동안 사용 · 후기 1개당 1장</p>
          <a class="btn btn--dark evt__go" href="my-orders.html#review">후기 쓰러 가기</a>
          <button type="button" class="evt__hide" data-evhide>오늘 하루 보지 않기</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    document.body.style.overflow = "hidden";
    const close = () => { m.remove(); document.body.style.overflow = document.querySelector(".modal:not([hidden])") ? "hidden" : ""; document.removeEventListener("keydown", esc); };
    const esc = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    m.addEventListener("click", e => {
      if (e.target.closest("[data-evhide]")) { try { localStorage.setItem(KEY, today); } catch {} close(); return; }
      if (e.target.closest("[data-evx]")) close();
    });
    m.querySelector(".evt__go").focus();
  }
})();
