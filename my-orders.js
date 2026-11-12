/* 주문내역: 회원은 본인 주문·매입 목록, 비회원은 접수번호 + 휴대폰으로 조회 */
(function () {
  const { sb, esc, won, fmtDate, ORDER_STATUS, SELL_STATUS, trackUrl } = window.YAMOO;  const $ = s => document.querySelector(s);
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
        ${reviewBtns(r)}
      </article>`;
  }
  // 입금 확인 이후 주문: 상품마다 '후기 쓰기' (상품 상세의 후기 칸으로 이동)
  function reviewBtns(r) {
    if (r.guest || r.kind !== "order" || !["paid", "ready", "done"].includes(r.status)) return ""; // 후기는 회원만
    const list = Array.isArray(r.items) && r.items.length
      ? r.items.filter(i => i.product_id && !i.discount).map(i => ({ id: i.product_id, name: i.name }))
      : r.product_id ? [{ id: r.product_id, name: "" }] : [];
    if (!list.length) return "";
    const short = n => esc(String(n || "").replace(/\s*\(.*\)$/, "").slice(0, 18));
    // 이미 후기를 쓴 주문: 상품 화면에서 내 후기를 고칠 수 있게
    if (r.reviewed) return `<div class="mo__rv"><span class="mo__rvdone">✓ 후기 작성 완료</span>${list.map(i => `<a class="btn btn--line btn--sm" href="./?p=${encodeURIComponent(i.id)}#pdReviews">내 후기 보기·수정${list.length > 1 ? ` <small>${short(i.name)}</small>` : ""}</a>`).join("")}</div>`;
    // 주문 1건당 후기 1개: 여러 상품이면 하나를 골라서
    return `<div class="mo__rv">${list.length > 1 ? `<span class="mo__rvdone">후기는 주문당 1개 · 상품을 하나 골라 주세요</span>` : ""}${list.map(i => `<a class="btn btn--line btn--sm" href="./?p=${encodeURIComponent(i.id)}&review=1">✎ 후기 쓰기${list.length > 1 ? ` <small>${short(i.name)}</small>` : ""}</a>`).join("")}</div>`;
  }

  // 내 쿠폰 (coupons-points.sql 실행 후)
  async function loadBenefits() {
    const box = $("#benefits");
    const { data, error } = await sb.rpc("my_benefits");
    if (error || !data) return;
    const cps = data.coupons || [];
    const d = s => fmtDate(s, false);
    box.hidden = false;
    // 회원 등급 (membership.sql 실행 후)
    const GN = window.YAMOO.GRADE_NAME || { basic: "브론즈", silver: "실버", gold: "골드", vip: "VIP" }, RK = { basic: 0, silver: 1, gold: 2, vip: 3 };
    const badge = gg => window.YAMOO.gradeBadge ? window.YAMOO.gradeBadge(gg, 30) : "";
    const rules = Array.isArray(data.tier_rule) ? data.tier_rule : null, cnt = Number(data.count) || 0, g = data.grade || "basic";
    const next = rules && rules.find(r => cnt < r.n && RK[r.g] > RK[g]);
    const tier = rules ? `<div class="mo__tier"><p>회원 등급</p><strong class="mo__tiername">${badge(g)}${GN[g] || g}</strong><span>구매 ${cnt}회${data.tier_min_order ? ` (상품 ${won(data.tier_min_order)} 이상 주문)` : ""}</span>
      <span>${next ? `<b>${GN[next.g]}</b>까지 ${next.n - cnt}회 남음 · 달성하면 ${won(next.amt)} 쿠폰` : "최고 등급이에요. 감사합니다!"}</span></div>` : "";
    box.innerHTML = `
      <div class="mo__bnf-top${tier ? "" : " mo__bnf-top--one"}">
        ${tier}
        <div><p>내 쿠폰</p><strong>${cps.length}<small>장</small></strong><span>후기를 쓰면 쿠폰을 드려요 · 홈페이지 주문 전용 · 골드바·실버바 제외</span></div>
      </div>
      ${cps.length ? `<ul class="mo__cps">${cps.map(c => `<li><b>${won(c.amount)}</b><span>${esc(c.name)}${c.min_order ? ` · 상품 ${won(c.min_order)} 이상` : ""}</span><em>${d(c.expires_at)}까지</em></li>`).join("")}</ul>` : ""}`;
    renderAnniv(box);
    if (location.hash === "#benefits") box.scrollIntoView();
  }

  // 생일 쿠폰 등록 (birthday.sql 실행 후) — 생일 당일 오전 9시에 쿠폰 자동 지급
  //   악용 방지: 등록 30일 뒤부터 대상 · 한 번 등록하면 본인이 못 바꿈 (서버에서도 막음)
  async function renderAnniv(box) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const uid = session.user.id;
    const [pf, si] = await Promise.all([
      sb.from("profiles").select("birthday,anniv_agreed_at,marketing").eq("id", uid).maybeSingle(),
      sb.from("shop_info").select("anniv_coupon,anniv_min,anniv_days,anniv_lead,bday_wait").eq("id", 1).maybeSingle(),
    ]);
    if (pf.error || si.error || !pf.data || !si.data || !(si.data.anniv_coupon > 0)) return; // SQL 실행 전이거나 꺼져 있으면 숨김
    const p = pf.data, c = si.data, wait = Number(c.bday_wait) || 0;
    const opts = n => `<option value="">-</option>` + Array.from({ length: n }, (_, i) => `<option value="${p2(i + 1)}">${i + 1}</option>`).join("");
    let ready = "";
    if (p.birthday && p.anniv_agreed_at && wait) {
      const r = new Date(p.anniv_agreed_at); r.setDate(r.getDate() + wait);
      if (r > new Date()) ready = ` · ${fmtDate(r, false)}부터 쿠폰 대상`;
    }
    const el = document.createElement("form");
    el.className = "mo__anniv";
    el.innerHTML = `
      <h3>🎂 생일 쿠폰 <small>${won(c.anniv_coupon)} · 상품 ${won(c.anniv_min)} 이상 · 골드바·실버바 제외</small></h3>
      <p class="mo__anniv-desc">생일을 등록하면 매년 <b>생일 당일</b>에 쿠폰을 드려요 (${c.anniv_days}일 안에 사용 · 1년에 1장).${wait ? ` 등록하고 ${wait}일이 지난 뒤부터 드려요.` : ""} 한 번 등록한 생일은 바꿀 수 없어요.</p>
      ${p.birthday
        ? `<div class="mo__anniv-row"><span>생일</span><b>${+p.birthday.slice(0, 2)}월 ${+p.birthday.slice(3)}일</b><small class="mo__anniv-note">등록 완료${ready} · 변경은 고객센터 문의</small></div>`
        : `<div class="mo__anniv-row"><span>생일</span><select name="bm" aria-label="생일 월">${opts(12)}</select>월<select name="bd" aria-label="생일 일">${opts(31)}</select>일</div>
           <label class="mo__anniv-ok"><input type="checkbox" name="agree"> <span>[필수] 생일 쿠폰 발급을 위해 생일(월·일)을 수집·이용하는 데 동의합니다. 삭제하거나 탈퇴하면 바로 지워요.</span></label>`}
      <label class="mo__anniv-ok"><input type="checkbox" name="mkt"${p.marketing ? " checked" : ""}> <span>[선택] 쿠폰·이벤트 혜택 문자(광고)를 받겠습니다. 끄면 문자는 오지 않고 쿠폰은 그대로 드려요.</span></label>
      <div class="mo__anniv-btns">${p.birthday ? `<button type="button" class="btn btn--line btn--sm" data-annivdel>생일 삭제</button>` : ""}<button class="btn btn--dark btn--sm">저장</button></div>
      <p class="mo__anniv-msg" role="status"></p>`;
    box.appendChild(el);
    const msg = el.querySelector(".mo__anniv-msg");
    const save = async patch => {
      const { error } = await sb.from("profiles").update(patch).eq("id", uid);
      if (error) { msg.textContent = /[가-힣]/.test(error.message || "") ? error.message : "저장하지 못했어요. 잠시 후 다시 시도해 주세요."; return false; }
      return true;
    };
    el.addEventListener("submit", async e => {
      e.preventDefault();
      const f = el, patch = { marketing: f.mkt.checked };
      if (!p.birthday && (f.bm.value || f.bd.value)) {
        if (!f.bm.value || !f.bd.value) { msg.textContent = "월과 일을 모두 골라 주세요."; return; }
        if (new Date(2024, +f.bm.value - 1, +f.bd.value).getMonth() !== +f.bm.value - 1) { msg.textContent = "없는 날짜예요. 다시 골라 주세요."; return; }
        if (!f.agree.checked) { msg.textContent = "생일을 등록하려면 [필수] 수집·이용에 동의해 주세요."; return; }
        if (!confirm(`생일을 ${+f.bm.value}월 ${+f.bd.value}일로 등록할까요? 등록하면 바꿀 수 없어요.`)) return;
        patch.birthday = `${f.bm.value}-${f.bd.value}`;
      }
      if (!(await save(patch))) return;
      if (patch.birthday) { loadBenefits(); return; }
      msg.textContent = "저장했어요.";
    });
    el.addEventListener("click", async e => {
      if (!e.target.closest("[data-annivdel]") || !confirm("등록한 생일을 지울까요? 다시 등록하면 그날부터 대기 기간이 새로 시작돼요.")) return;
      if (await save({ birthday: null })) loadBenefits();
    });
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
    loadBenefits();
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
    box.innerHTML = data.map(r => card({ ...r, code, guest: true })).join("");
  });

  init();
})();
