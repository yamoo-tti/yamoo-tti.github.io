/* 주문내역: 회원은 본인 주문·매입 목록, 비회원은 접수번호 + 휴대폰으로 조회 */
(function () {
  const { sb, esc, won, fmtDate, ORDER_STATUS, SELL_STATUS, trackUrl } = window.YAMOO;
  const $ = s => document.querySelector(s);
  const PHONE = "010-5287-8002";
  const p2 = n => String(n).padStart(2, "0");
  const hm = d => { const x = new Date(d); return `${p2(x.getMonth() + 1)}/${p2(x.getDate())} ${p2(x.getHours())}:${p2(x.getMinutes())}`; };
  const SHORT = { ...ORDER_STATUS, confirmed: "입금 대기" };
  const DELIVERY_SHORT = { ...SHORT, ready: "발송 완료" };

  function card(r) {
    const isO = r.kind === "order";
    const st = (isO ? (r.method === "delivery" ? DELIVERY_SHORT : SHORT) : SELL_STATUS)[r.status] || r.status;
    const waiting = isO && r.status === "confirmed" && r.deadline && new Date(r.deadline) > new Date();
    const cls = r.status === "canceled" ? "is-off" : r.status === "done" ? "is-done" : waiting ? "is-wait" : "";
    return `
      <article class="mo__card ${cls}">
        <div class="mo__top">
          <span class="mo__kind">${isO ? "구매" : "매입"}</span>
          <span class="mo__date">${fmtDate(r.created_at)}</span>
          <span class="mo__st">${esc(st)}</span>
        </div>
        <p class="mo__title">${esc(r.title)}</p>
        <div class="mo__bottom">
          <span class="mo__code">${esc(r.code)}</span>
          <span class="mo__amt">${r.amount ? won(r.amount) : isO ? "금액 확정 전" : "감정 전"}</span>
        </div>
        ${waiting ? `<div class="mo__wait"><span><b data-deadline="${esc(r.deadline)}">--:--</b> 안에 입금해 주세요 (${hm(r.deadline)}까지)</span><a class="btn btn--dark" href="order-done.html?code=${encodeURIComponent(r.code)}">입금 정보 보기</a></div>` : ""}
        ${isO && r.tracking_no ? `<div class="mo__ship"><span>${esc(r.courier || "택배")} <b>${esc(r.tracking_no)}</b></span><a class="btn btn--line" href="${esc(trackUrl(r.courier, r.tracking_no))}" target="_blank" rel="noopener">배송 조회</a></div>` : ""}
        ${isO && r.status === "canceled" ? `<p class="mo__note">입금 기한이 지났거나 취소된 주문이에요.</p>` : ""}
      </article>`;
  }

  // 남은 시간 표시
  setInterval(() => {
    document.querySelectorAll("[data-deadline]").forEach(el => {
      const s = Math.max(0, Math.floor((new Date(el.dataset.deadline) - Date.now()) / 1000));
      el.textContent = s ? `${p2(Math.floor(s / 60))}:${p2(s % 60)}` : "기한 종료";
    });
  }, 1000);

  async function init() {
    if (!sb) { $("#list").innerHTML = `<p class="mo__empty">지금은 주문내역을 볼 수 없어요. ${PHONE}로 문의해 주세요.</p>`; return; }
    const { data: { session } } = await sb.auth.getSession();
    $("#guest").hidden = false;
    if (!session) {
      $("#who").innerHTML = `<a class="btn btn--dark" href="./?next=my-orders#login">로그인하고 전체 주문 보기</a>`;
      $("#list").innerHTML = "";
      return;
    }
    $("#who").textContent = `${session.user.email} 님의 주문·매입 신청`;
    const { data, error } = await sb.rpc("my_requests");
    if (error) { $("#list").innerHTML = `<p class="mo__empty">주문내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>`; return; }
    $("#list").innerHTML = data.length
      ? data.map(card).join("")
      : `<div class="mo__empty"><p>아직 주문 내역이 없어요.</p><a class="btn btn--dark" href="./#goldbar">골드바 보러 가기</a></div>`;
  }

  $("#findForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    const code = f.code.value.trim().toUpperCase();
    const { data, error } = await sb.rpc("lookup_request", { p_code: code, p_phone: f.phone.value });
    btn.disabled = false;
    const box = $("#found");
    if (error && /[가-힣]/.test(error.message || "")) { box.innerHTML = `<p class="mo__empty">${esc(error.message)}</p>`; return; }
    if (error || !data || !data.length) { box.innerHTML = `<p class="mo__empty">일치하는 접수가 없어요. 접수번호와 휴대폰 번호를 확인해 주세요.</p>`; return; }
    box.innerHTML = data.map(r => card({ ...r, code })).join("");
  });

  init();
})();
