/* 홈페이지 고객 접수: 구매 신청 · 금 매입 신청 · 접수 조회 · 공지사항 */
(function () {
  const { sb, esc, won, fmtDate, ORDER_STATUS, SELL_STATUS } = window.YAMOO;
  const $ = s => document.querySelector(s);
  const toast = m => window.toast && window.toast(m);
  const PHONE = "010-5287-8002";

  /* ---------- 공통 모달 ---------- */
  function openModal(el) {
    el.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => { const f = el.querySelector("input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select"); f && f.focus(); }, 30);
  }
  function closeModal(el) { el.hidden = true; document.body.style.overflow = ""; }
  ["#orderModal", "#sellModal", "#lookupModal", "#noticeModal"].forEach(id => {
    const el = $(id);
    el.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeModal(el); });
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".modal:not([hidden])").forEach(m => { if (m.id !== "authModal") closeModal(m); });
  });

  // 수령/접수 방법에 따라 주소·방문일 칸 보이기
  function bindWhen(form, name) {
    const sync = () => {
      const v = form.querySelector(`[name=${name}]:checked`).value;
      form.querySelectorAll("[data-when]").forEach(el => {
        const on = el.dataset.when === v;
        el.hidden = !on;
        const input = el.querySelector("input");
        if (input && name === "receive") input.required = on;
      });
    };
    form.addEventListener("change", e => { if (e.target.name === name) sync(); });
    sync();
    return sync;
  }

  const rpcError = err => {
    const m = (err && err.message) || "";
    return /[가-힣]/.test(m) ? m : "접수 중 문제가 생겼어요. 잠시 후 다시 시도하거나 " + PHONE + "로 전화 주세요.";
  };

  function doneHtml(code, title, lines) {
    return `
      <p class="done__icon" aria-hidden="true">✓</p>
      <h2 class="modal__title">${title}</h2>
      <p class="done__code">접수번호 <strong>${esc(code)}</strong></p>
      <p class="form-note">${lines}</p>
      <p class="form-note">진행 상황은 상단 <b>접수 조회</b>에서 접수번호와 연락처로 확인할 수 있어요.</p>
      <button class="btn btn--dark" type="button" data-close>확인</button>`;
  }

  /* ---------- 구매 신청 ---------- */
  const orderModal = $("#orderModal"), orderForm = $("#orderForm");
  const syncReceive = bindWhen(orderForm, "receive");
  let current = null;

  function updateTotal() {
    const qty = Math.min(99, Math.max(1, parseInt(orderForm.qty.value, 10) || 1));
    const unit = window.SHOP.price(current);
    $("#orderTotal").textContent = unit ? won(unit * qty) : "매장 문의";
    return unit ? unit * qty : null;
  }

  window.openOrder = function (p) {
    if (!sb || !p.id) { toast(`전화로 주문해 주세요 · ${PHONE}`); return; }
    current = p;
    const unit = window.SHOP.price(p);
    const name = p.kind === "zodiac" ? `GBK 카드형 골드바 1g (${p.name})` : p.name;
    $("#orderItem").innerHTML = `
      <img src="${esc(/^https?:/.test(p.img || "") ? p.img : "images/" + (p.img || "bar-close.jpg"))}" alt="">
      <div><b>${esc(name)}</b><span>${unit ? won(unit) + " / 개 · 현재 시세 기준" : "가격 매장 문의"}</span></div>`;
    orderForm.reset();
    syncReceive();
    orderForm.hidden = false;
    $("#orderDone").hidden = true;
    updateTotal();
    openModal(orderModal);
  };

  orderForm.addEventListener("click", e => {
    const b = e.target.closest("[data-qty]");
    if (!b) return;
    orderForm.qty.value = Math.min(99, Math.max(1, (parseInt(orderForm.qty.value, 10) || 1) + +b.dataset.qty));
    updateTotal();
  });
  orderForm.qty.addEventListener("input", updateTotal);

  orderForm.addEventListener("submit", async e => {
    e.preventDefault();
    const f = orderForm, btn = f.querySelector("[type=submit]");
    const qty = Math.min(99, Math.max(1, parseInt(f.qty.value, 10) || 1));
    btn.disabled = true;
    const { data, error } = await sb.rpc("submit_order", {
      p_product_id: current.id, p_qty: qty, p_name: f.name.value, p_phone: f.phone.value,
      p_receive: f.receive.value, p_address: f.address.value, p_note: f.note.value, p_quoted: updateTotal(),
    });
    btn.disabled = false;
    if (error) { toast(rpcError(error)); return; }
    f.hidden = true;
    const done = $("#orderDone");
    done.innerHTML = doneHtml(data, "구매 신청이 접수됐어요",
      `영업시간(평일 10:00–19:00) 안에 매장에서 확정 금액과 입금 방법을 연락드립니다.<br>급하시면 ${PHONE}로 전화 주세요.`);
    done.hidden = false;
  });

  /* ---------- 금 매입 신청 ---------- */
  const sellModal = $("#sellModal"), sellForm = $("#sellForm");
  const syncMethod = bindWhen(sellForm, "method");
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

  document.addEventListener("click", e => {
    if (!e.target.closest("[data-sell]")) return;
    if (!sb) { toast(`전화로 매입 상담해 주세요 · ${PHONE}`); return; }
    sellForm.reset();
    syncMethod();
    sellForm.visit_date.min = today();
    sellForm.hidden = false;
    $("#sellDone").hidden = true;
    openModal(sellModal);
  });

  sellForm.addEventListener("submit", async e => {
    e.preventDefault();
    const f = sellForm, btn = f.querySelector("[type=submit]");
    const visit = f.method.value === "visit" && f.visit_date.value ? f.visit_date.value : null;
    btn.disabled = true;
    const { data, error } = await sb.rpc("submit_sell", {
      p_items: f.items.value, p_karat: f.karat.value, p_weight: f.weight.value ? Number(f.weight.value) : null,
      p_method: f.method.value, p_visit_date: visit, p_name: f.name.value, p_phone: f.phone.value, p_note: f.note.value,
    });
    btn.disabled = false;
    if (error) { toast(rpcError(error)); return; }
    f.hidden = true;
    const done = $("#sellDone");
    done.innerHTML = doneHtml(data, "매입 신청이 접수됐어요",
      f.method.value === "delivery"
        ? `안심 택배 접수 방법을 문자로 안내드립니다.`
        : `방문 일정을 확인하는 연락을 드립니다. 매장: 종로구 율곡로10길 105 디아망 빌딩 2층`);
    done.hidden = false;
  });

  /* ---------- 접수 조회 ---------- */
  const lookupModal = $("#lookupModal"), lookupForm = $("#lookupForm");
  document.addEventListener("click", e => {
    if (!e.target.closest("[data-lookup]")) return;
    if (!sb) { toast(`전화로 문의해 주세요 · ${PHONE}`); return; }
    lookupForm.reset();
    $("#lookupResult").hidden = true;
    openModal(lookupModal);
  });
  lookupForm.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = lookupForm.querySelector("[type=submit]");
    btn.disabled = true;
    const { data, error } = await sb.rpc("lookup_request", { p_code: lookupForm.code.value, p_phone: lookupForm.phone.value });
    btn.disabled = false;
    const box = $("#lookupResult");
    box.hidden = false;
    if (error) { box.innerHTML = `<p class="form-note">조회 중 문제가 생겼어요. ${PHONE}로 문의해 주세요.</p>`; return; }
    if (!data || !data.length) { box.innerHTML = `<p class="form-note">일치하는 접수가 없어요. 접수번호와 연락처를 다시 확인해 주세요.</p>`; return; }
    box.innerHTML = data.map(r => {
      const steps = r.kind === "order" ? ORDER_STATUS : SELL_STATUS;
      const keys = Object.keys(steps).filter(k => k !== "canceled");
      const at = keys.indexOf(r.status);
      return `
        <div class="track">
          <p class="track__kind">${r.kind === "order" ? "구매 신청" : "금 매입 신청"} · ${fmtDate(r.created_at)}</p>
          <p class="track__title">${esc(r.title)}</p>
          ${r.status === "canceled"
            ? `<p class="track__cancel">취소된 접수입니다. 문의: ${PHONE}</p>`
            : `<ol class="track__steps">${keys.map((k, i) => `<li class="${i < at ? "is-past" : i === at ? "is-now" : ""}">${steps[k]}</li>`).join("")}</ol>`}
          <p class="track__time">최근 업데이트 ${fmtDate(r.updated_at)}</p>
        </div>`;
    }).join("");
  });

  /* ---------- 공지사항 · 시황 ---------- */
  const CAT = { notice: "공지", event: "이벤트", market: "시황" };
  let notices = [];
  async function loadNotices() {
    if (!sb) return; // DB 연결 전에는 기존 예시 글 유지
    const { data, error } = await sb.from("notices").select("id,category,title,body,pinned,created_at")
      .eq("visible", true).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(30);
    if (error) return;
    notices = data;
    const md = d => { const x = new Date(d); return `${String(x.getMonth() + 1).padStart(2, "0")}.${String(x.getDate()).padStart(2, "0")}`; };
    const li = n => `<li><a href="#" data-notice="${n.id}">${n.pinned ? "<b class='pin'>필독</b> " : ""}${n.category === "event" ? "[이벤트] " : ""}${esc(n.title)}</a><time>${md(n.created_at)}</time></li>`;
    const fill = (id, list, empty) => { $(id).innerHTML = list.slice(0, 5).map(li).join("") || `<li class="board__empty">${empty}</li>`; };
    fill("#boardMarket", data.filter(n => n.category === "market"), "등록된 시황이 없습니다");
    fill("#boardNotice", data.filter(n => n.category !== "market"), "등록된 공지가 없습니다");
  }
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-notice]");
    if (!a) return;
    e.preventDefault();
    const n = notices.find(x => String(x.id) === a.dataset.notice);
    if (!n) return;
    $("#noticeMeta").textContent = `${CAT[n.category]} · ${fmtDate(n.created_at, false)}`;
    $("#noticeTitle").textContent = n.title;
    $("#noticeBody").textContent = n.body || "";
    openModal($("#noticeModal"));
  });
  loadNotices();
})();
