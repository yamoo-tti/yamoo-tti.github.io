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
  // 아래에 상품 상세가 열려 있으면 화면 스크롤은 계속 막아 둠
  function closeModal(el) { el.hidden = true; document.body.style.overflow = document.querySelector(".modal:not([hidden])") ? "hidden" : ""; }
  ["#orderModal", "#sellModal", "#lookupModal", "#noticeModal", "#cartModal", "#infoModal"].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeModal(el); });
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".modal:not([hidden])").forEach(m => { if (m.id !== "authModal" && m.id !== "pdModal") closeModal(m); });
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

  // 현금영수증 · 세금계산서: 고른 종류에 맞는 칸만 보이기
  function bindReceipt(form) {
    const sync = () => {
      const v = form.rc_type.value;
      form.querySelectorAll("[data-rc]").forEach(el => {
        const on = el.dataset.rc.split(" ").includes(v);
        el.hidden = !on;
        el.querySelectorAll("input").forEach(i => { i.required = on && i.name !== "rc_phone"; });
      });
    };
    form.rc_type.addEventListener("change", sync);
    sync();
    return sync;
  }
  // 서버로 보낼 영수증 정보 (형식이 틀리면 안내 문구를 던짐)
  function receiptOf(form) {
    const type = form.rc_type.value, digits = v => String(v || "").replace(/\D/g, "");
    if (type === "none") return { type };
    if (type === "personal") {
      const no = digits(form.rc_phone.value) || digits(form.phone.value);
      if (no.length < 10 || no.length > 18) throw "현금영수증 휴대폰 번호를 확인해 주세요";
      return { type, no };
    }
    const no = digits(form.rc_biz.value);
    if (no.length !== 10) throw "사업자등록번호 10자리를 확인해 주세요";
    if (type === "business") return { type, no };
    return { type, no, company: form.rc_company.value.trim(), ceo: form.rc_ceo.value.trim(), email: form.rc_email.value.trim() };
  }

  // 입금 계좌 · 입금 기한 (관리자 페이지 > 시세 설정에서 수정)
  let shopInfo = { bank_name: "", bank_account: "", bank_holder: "", pay_minutes: 30, delivery_fee: 3000 };
  if (sb) sb.from("shop_info").select("bank_name,bank_account,bank_holder,pay_minutes,delivery_fee").eq("id", 1).maybeSingle()
    .then(({ data }) => {
      if (!data) return;
      shopInfo = { ...shopInfo, ...data };
      const m = $("#payMinutes"); if (m) m.textContent = data.pay_minutes;
      const d = $("#deliveryFee"); if (d) d.textContent = won(shopInfo.delivery_fee);
    });
  const hm = d => { const x = new Date(d); return `${String(x.getMonth() + 1).padStart(2, "0")}/${String(x.getDate()).padStart(2, "0")} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
  const payBox = (amount, deadline, bank) => `
      <dl class="pay-box">
        <dt>입금액</dt><dd><strong>${won(amount)}</strong></dd>
        <dt>입금 계좌</dt><dd>${esc(bank.bank_name)} ${esc(bank.bank_account)}<br><span>예금주 ${esc(bank.bank_holder)}</span>
          <button type="button" class="copy-btn" data-copy="${esc(bank.bank_account)}">계좌번호 복사</button></dd>
        <dt>입금 기한</dt><dd><b>${hm(deadline)}</b>까지 <span>(지나면 자동 취소)</span></dd>
      </dl>`;
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy.replace(/[^0-9-]/g, "")); toast("계좌번호를 복사했어요"); }
    catch { toast(b.dataset.copy); }
  });

  // [선택] 마케팅 수신 동의에 체크한 손님만 명단에 저장 (실패해도 주문은 그대로)
  async function saveMarketing(f) {
    if (!f.mkt || !f.mkt.checked) return;
    try { await sb.rpc("add_marketing_contact", { p_name: f.name.value, p_phone: f.phone.value }); } catch { /* 무시 */ }
  }

  // 선물로 보내기: 받는 분·메시지 카드·가격 서류 제외를 요청 사항 앞에 붙여 사장님이 보게 함 (최대 500자)
  function noteOf(f) {
    const note = (f.note.value || "").trim();
    const box = f.querySelector(".giftopt");
    if (!box || !f.gift_to) return note;
    const to = f.gift_to.value.trim(), ph = f.gift_phone.value.trim(), msg = f.gift_msg.value.trim();
    if (!to && !ph && !msg) return note;
    const g = ["[선물]", to && `받는 분: ${to}`, ph && `연락처: ${ph}`, msg && `카드: "${msg}"`, f.gift_noprice.checked ? "가격 서류 빼기" : ""].filter(Boolean).join(" / ");
    return (g + (note ? "\n" + note : "")).slice(0, 500);
  }

  // [필수] 취소·반품 불가 동의 기록 남기기 (분쟁 대비 증거, 실패해도 주문은 그대로)
  async function saveConsent(f, code) {
    if (!code || !f.nocancel || !f.nocancel.checked) return;
    const notice = f.nocancel.closest("label").textContent.replace(/\s*자세히\s*$/, "").trim();
    try { await sb.rpc("record_order_consent", { p_code: code, p_phone: f.phone.value, p_notice: notice, p_agent: navigator.userAgent.slice(0, 300) }); } catch { /* 무시 */ }
  }

  // 회원이면 가입한 이메일을 미리 채움 (비회원은 직접 입력)
  async function fillEmail(f) {
    if (!sb || !f.email || f.email.value) return;
    try {
      const { data: { session } } = await sb.auth.getSession();
      const em = session && session.user && session.user.email;
      if (em && !f.email.value) f.email.value = em;
    } catch { /* 무시 */ }
  }
  // 주문 직후: 손님에게 구매내역서, 사장님에게 주문내역서 메일 (실패해도 주문은 그대로)
  async function sendReceipt(f, code) {
    if (!code) return;
    try { await sb.rpc("send_order_receipt", { p_code: code, p_phone: f.phone.value, p_email: f.email ? f.email.value : "" }); } catch { /* 무시 */ }
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
      <div class="form-note">${lines}</div>
      <p class="form-note">진행 상황은 상단 <b>접수 조회</b>에서 접수번호와 연락처로 확인할 수 있어요.</p>
      <button class="btn btn--dark" type="button" data-close>확인</button>`;
  }

  /* ---------- 상품정보 제공고시 ---------- */
  const infoTable = p => `<table class="pinfo__tbl"><tbody>${window.YAMOO.productInfo(p)
    .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
  window.openInfo = function (p) {
    window.YAMOO.trackView(p.id);
    $("#infoTitle").textContent = p.name;
    $("#infoBody").innerHTML = infoTable(p);
    openModal($("#infoModal"));
  };

  /* ---------- 사이즈 · 추가 옵션 (팔찌·목걸이 사이즈, 18K 잠금장식 등) ---------- */
  const Y = window.YAMOO;
  const optsHtml = (p, pre = {}) => {
    const sz = Y.sizeList(p);
    const un = Y.sizeUnit(p);
    return (sz.length ? `<label>사이즈 (${un})<select name="opt_size" required><option value="">사이즈를 골라 주세요</option>${sz.map(s =>
      `<option value="${esc(s)}"${pre.size === s ? " selected" : ""}>${esc(s)}${un}</option>`).join("")}</select></label>${Number(p.base_size) > 0 ? `<p class="opt-w"></p>` : ""}` : "")
      + (Y.hasAddon(p) ? `<label class="check opt-addon"><input type="checkbox" name="opt_addon"${pre.addon ? " checked" : ""}> <span>${esc(p.addon_name)} 추가 <b>+${won(Number(p.addon_price))}</b></span></label>` : "");
  };
  const pickOf = f => ({ size: f.opt_size ? f.opt_size.value : "", addon: !!(f.opt_addon && f.opt_addon.checked) });
  // 고른 사이즈·옵션의 1개 금액 (사이즈만큼 금 중량 반영 + 추가 옵션)
  const unitOf = (p, pick) => { const b = window.SHOP.price(Y.sized(p, pick && pick.size)); return b == null ? null : b + addonOf(p, pick); };
  const optNote = (box, p, pick) => {
    const el = box.querySelector(".opt-w");
    if (!el || !(Number(p.base_size) > 0)) return;
    const w = Number(Y.sized(p, pick.size).weight_g);
    el.innerHTML = pick.size
      ? `고른 사이즈 <b>${esc(pick.size)}cm</b> · 금 중량 <b>${w}g</b> (${Math.round(w / Y.DON * 100) / 100}돈) <small>· 등록 ${Number(p.weight_g)}g은 ${Number(p.base_size)}cm 기준</small>`
      : `등록 중량 ${Number(p.weight_g)}g은 <b>${Number(p.base_size)}cm</b> 기준이에요. 사이즈에 따라 금 중량·가격이 달라져요.`;
  };
  const addonOf = (p, pick) => pick && pick.addon && Y.hasAddon(p) ? Number(p.addon_price) : 0;
  const withPick = (name, p, pick) => { const l = pick ? Y.pickLabel(p, pick.size, pick.addon) : ""; return l ? `${name} (${l})` : name; };

  /* ---------- 쿠폰 (회원 · coupons-points.sql 실행 후) ---------- */
  let bnf = null, bnfCfg = null; // bnf: 내 쿠폰, bnfCfg: 후기 쿠폰 금액(비회원 안내용)
  // 비회원 안내용 (membership.sql 실행 전이면 등급 칸 없이 다시 불러옴)
  const CFG = "review_event,review_coupon,coupon_min";
  if (sb) sb.from("shop_info").select(CFG + ",signup_coupon,tier_rule").eq("id", 1).maybeSingle()
    .then(r => r.error ? sb.from("shop_info").select(CFG).eq("id", 1).maybeSingle() : r)
    .then(({ data }) => { bnfCfg = data || null; }, () => {});
  async function loadBnf() {
    bnf = null;
    if (!sb) return;
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;
      const { data, error } = await sb.rpc("my_benefits");
      if (!error && data) bnf = data;
    } catch { /* 실패하면 쿠폰 칸 없이 주문 */ }
  }
  const bnfBox = form => {
    let box = form.querySelector(".bnf");
    if (!box) {
      box = document.createElement("div");
      box.className = "bnf";
      (form.querySelector(".order-total, .cart-sum")).before(box);
    }
    return box;
  };
  function renderBnf(form) {
    const box = bnfBox(form);
    if (!bnf) {
      const c = bnfCfg;
      const perks = c ? [c.signup_coupon > 0 ? `가입하면 ${won(c.signup_coupon)} 쿠폰` : "", c.tier_rule ? "구매할수록 등급업 쿠폰" : "", c.review_event && c.review_coupon > 0 ? `후기 쓰면 ${won(c.review_coupon)} 쿠폰` : ""].filter(Boolean) : [];
      box.innerHTML = perks.length
        ? `<p class="bnf__hint">🎁 <b>회원 혜택</b> ${perks.join(" · ")} <button type="button" class="bnf__login" data-bnflogin>로그인·가입</button></p>`
        : "";
      return;
    }
    const cps = bnf.coupons || [];
    if (!cps.length) { box.innerHTML = ""; return; }
    const d = s => { const x = new Date(s); return `${x.getMonth() + 1}/${x.getDate()}`; };
    box.innerHTML = `
      <fieldset class="bnf__set"><legend>쿠폰 <small>홈페이지 주문 전용 · 골드바·실버바 제외</small></legend>
        <label>쿠폰<select name="coupon"><option value="">사용 안 함 (${cps.length}장 보유)</option>${cps.map(c =>
          `<option value="${c.id}" data-amt="${c.amount}" data-min="${c.min_order}">${won(c.amount)} ${esc(c.name)}${c.min_order ? ` (${c.min_order % 10000 ? won(c.min_order) : c.min_order / 10000 + "만원"} 이상)` : ""} ~${d(c.expires_at)}</option>`).join("")}</select></label>
        <p class="bnf__msg" data-bnfmsg></p>
      </fieldset>`;
  }
  // 고른 쿠폰으로 할인 금액 계산 (서버 bnf_check 와 같은 규칙) · 포인트 기능은 지금 쓰지 않음 (pts 항상 0)
  // 쿠폰은 마진이 적은 골드바·실버바·카드형 골드바에는 못 씀
  const NOCOUP = ["bar", "silver", "zodiac"];
  const coupOk = p => !!p && !NOCOUP.includes(p.kind);
  function calcBnf(form, goods, cgoods) {
    const out = { coupon: null, cdisc: 0, pts: 0, msg: "" };
    if (!bnf || goods == null) return out;
    const cg = cgoods == null ? goods : cgoods;
    const sel = form.querySelector("[name=coupon]");
    if (sel && sel.value) {
      const o = sel.selectedOptions[0], min = Number(o.dataset.min) || 0;
      if (cg <= 0) out.msg = "쿠폰은 골드바·실버바에는 쓸 수 없어요";
      else if (cg < min) out.msg = `이 쿠폰은 골드바·실버바를 뺀 상품 금액이 ${won(min)} 이상일 때 쓸 수 있어요`;
      else { out.coupon = +sel.value; out.cdisc = Math.min(Number(o.dataset.amt) || 0, Math.floor(cg)); }
    }
    const m = form.querySelector("[data-bnfmsg]");
    if (m) {
      m.textContent = out.msg || (out.cdisc ? `할인 ${won(out.cdisc)} 적용` : "");
      m.classList.toggle("is-error", !!out.msg);
    }
    return out;
  }
  const bnfArgs = b => b.cdisc ? { p_coupon: b.coupon } : {};
  document.addEventListener("click", e => {
    if (e.target.closest("[data-bnflogin]")) {
      document.querySelectorAll(".modal:not([hidden])").forEach(m => { if (m.id !== "authModal" && m.id !== "pdModal") closeModal(m); });
      const b = document.querySelector('#authNav [data-open="login"]');
      if (b) b.click();
    }
  });

  /* ---------- 구매 신청 ---------- */
  const orderModal = $("#orderModal"), orderForm = $("#orderForm");
  const syncReceive = bindWhen(orderForm, "receive");
  const syncOrderReceipt = bindReceipt(orderForm);
  let current = null;
  let orderOpts = $("#orderOpts");
  if (!orderOpts) { orderOpts = document.createElement("div"); orderOpts.id = "orderOpts"; orderOpts.className = "order-opts"; $("#orderInfo").before(orderOpts); }

  function updateTotal() {
    const qty = Math.min(99, Math.max(1, parseInt(orderForm.qty.value, 10) || 1));
    const pk = pickOf(orderForm), unit = unitOf(current, pk);
    optNote(orderOpts, current, pk);
    const fee = orderForm.receive.value === "delivery" ? Number(shopInfo.delivery_fee) || 0 : 0;
    const b = calcBnf(orderForm, unit ? unit * qty : null, unit && coupOk(current) ? unit * qty : 0), disc = b.cdisc + b.pts;
    orderForm._bnf = b;
    $("#orderTotal").innerHTML = unit ? won(unit * qty - disc + fee) + [fee ? `택배비 ${won(fee)} 포함` : "", disc ? `할인 ${won(disc)} 적용` : ""].filter(Boolean).map(t => `<small>${t}</small>`).join("") : "매장 문의";
    return unit ? unit * qty - disc + fee : null;
  }
  orderForm.addEventListener("change", e => { if (["receive", "opt_addon", "opt_size", "coupon"].includes(e.target.name)) updateTotal(); });

  window.openOrder = function (p) {
    if (!sb || !p.id) { toast(`전화로 주문해 주세요 · ${PHONE}`); return; }
    window.YAMOO.trackView(p.id);
    current = p;
    const unit = window.SHOP.price(p);
    const name = p.kind === "zodiac" ? `GBK 카드형 골드바 1g (${p.name})` : p.name;
    $("#orderItem").innerHTML = `
      <img src="${esc(/^https?:/.test(p.img || "") ? p.img : "images/" + (p.img || "bar-close.jpg"))}" alt="">
      <div><b>${esc(name)}</b><span>${unit ? won(unit) + " / 개 · 현재 시세 기준" : "가격 매장 문의"}</span></div>`;
    $("#orderInfo").open = false;
    $("#orderInfoBody").innerHTML = infoTable(p);
    orderForm.reset();
    orderOpts.innerHTML = optsHtml(p);
    orderOpts.hidden = !Y.needsPick(p);
    fillEmail(orderForm);
    syncReceive();
    syncOrderReceipt();
    orderForm.hidden = false;
    $("#orderDone").hidden = true;
    renderBnf(orderForm);
    updateTotal();
    openModal(orderModal);
    loadBnf().then(() => { if (current === p) { renderBnf(orderForm); updateTotal(); } });
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
    let receipt;
    try { receipt = receiptOf(f); } catch (msg) { toast(msg); return; }
    btn.disabled = true;
    const { data, error } = await sb.rpc("submit_order", {
      p_product_id: current.id, p_qty: qty, p_name: f.name.value, p_phone: f.phone.value,
      p_receive: f.receive.value, p_address: f.address.value, p_note: noteOf(f), p_quoted: updateTotal(),
      p_receipt: receipt,
      ...(Y.needsPick(current) ? { p_size: pickOf(f).size || null, p_addon: pickOf(f).addon } : {}),
      ...bnfArgs(f._bnf || {}),
    });
    btn.disabled = false;
    if (error) { toast(rpcError(error)); return; }
    const r = typeof data === "string" ? { code: data } : (data || {});
    await Promise.all([saveMarketing(f), sendReceipt(f, r.code), saveConsent(f, r.code)]);
    // 주문 완료 페이지로 이동 (정보는 이 브라우저 탭에만 잠시 보관)
    if (r.code) {
      const pname = withPick(current.kind === "zodiac" ? `GBK 카드형 골드바 1g (${current.name})` : current.name, current, pickOf(f));
      try { sessionStorage.setItem("keumbi_order_" + r.code, JSON.stringify({ ...r, product: pname, qty, receive: f.receive.value })); }
      catch { /* 저장이 막힌 브라우저면 완료 페이지에서 연락처로 다시 확인 */ }
      location.href = "order-done.html?code=" + encodeURIComponent(r.code);
      return;
    }
    f.hidden = true;
    const done = $("#orderDone");
    if (r.total) {
      done.innerHTML = doneHtml(r.code, "주문이 확정됐어요",
        `확정일시 ${hm(r.locked_at)} 시세 기준 금액이에요.${r.shipping_fee ? ` (택배비 ${won(r.shipping_fee)} 포함)` : ""}` + payBox(r.total, r.deadline, r) +
        `입력하신 휴대폰으로도 같은 내용을 문자로 보내드려요. 입금이 확인되면 ${f.receive.value === "delivery" ? "보험 등기로 발송" : "매장 수령 일정을 안내"}해 드려요.`);
    } else {
      done.innerHTML = doneHtml(r.code, "구매 신청이 접수됐어요",
        `지금은 시세를 확인하지 못해 금액을 바로 확정하지 못했어요. 곧 매장에서 확정 금액과 입금 계좌를 연락드립니다.<br>급하시면 ${PHONE}로 전화 주세요.`);
    }
    done.hidden = false;
  });

  /* ---------- 장바구니 (이 브라우저에 저장) ---------- */
  const CART_KEY = "keumbi_cart_v1";
  const cartModal = $("#cartModal"), cartForm = $("#cartForm");
  const syncCartReceive = bindWhen(cartForm, "receive");
  bindReceipt(cartForm);
  let cartItems = [];
  try { cartItems = JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { cartItems = []; }
  const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cartItems)); } catch {} updateCartBadge(); };
  const cartCount = () => cartItems.reduce((s, i) => s + i.qty, 0);
  const displayName = p => p.kind === "zodiac" ? `GBK 카드형 골드바 1g (${p.name})` : p.name;
  const imgOf = p => /^https?:/.test(p.img || "") ? p.img : "images/" + (p.img || "bar-close.jpg");

  function updateCartBadge() {
    const b = $("#cartCount"), n = cartCount();
    if (!b) return;
    b.textContent = n;
    b.classList.toggle("has-items", n > 0);
  }

  // 장바구니 한 줄 = 상품 + 사이즈 + 추가 옵션 (같은 상품이라도 사이즈가 다르면 따로)
  const keyOf = i => [i.id, i.size || "", i.addon ? 1 : 0].join("|");
  window.addToCart = function (p, pick) {
    if (!sb || !p.id) { toast(`전화로 주문해 주세요 · ${PHONE}`); return; }
    if (p.sold_out) { toast("품절된 상품이에요"); return; }
    if (!pick && Y.needsPick(p)) { openPick(p); return; }
    window.YAMOO.trackView(p.id);
    const row = { id: p.id, qty: 1, size: (pick && pick.size) || "", addon: !!(pick && pick.addon) };
    const it = cartItems.find(i => keyOf(i) === keyOf(row));
    if (it) it.qty = Math.min(99, it.qty + 1); else cartItems.push(row);
    if (cartItems.length > 20) { cartItems.pop(); toast("장바구니에는 20종류까지 담을 수 있어요"); return; }
    saveCart();
    const b = $("#cartCount");
    if (b) { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }
    toast(`‘${withPick(displayName(p), p, row)}’을(를) 장바구니에 담았어요`);
  };

  // 장바구니 담기 전 사이즈·옵션 고르는 창
  let pickModal = null, pickCur = null;
  function openPick(p) {
    if (!pickModal) {
      pickModal = document.createElement("div");
      pickModal.className = "modal"; pickModal.id = "pickModal"; pickModal.hidden = true;
      pickModal.innerHTML = `<div class="modal__backdrop" data-close></div>
        <div class="modal__box" role="dialog" aria-modal="true" aria-labelledby="pickTitle">
          <button class="modal__x" data-close aria-label="닫기">×</button>
          <form class="auth-form" id="pickForm">
            <h2 class="modal__title" id="pickTitle">옵션 선택</h2>
            <div class="order-item" id="pickItem"></div>
            <div class="order-opts" id="pickOpts"></div>
            <p class="order-total">1개 금액 <strong id="pickTotal">-</strong></p>
            <button class="btn btn--dark" type="submit">장바구니 담기</button>
          </form>
        </div>`;
      document.body.appendChild(pickModal);
      pickModal.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeModal(pickModal); });
      const pf = pickModal.querySelector("#pickForm");
      pf.addEventListener("change", () => updatePick());
      pf.addEventListener("submit", e => { e.preventDefault(); const pick = pickOf(pf); closeModal(pickModal); window.addToCart(pickCur, pick); });
    }
    pickCur = p;
    const unit = window.SHOP.price(p);
    $("#pickItem").innerHTML = `<img src="${esc(imgOf(p))}" alt=""><div><b>${esc(displayName(p))}</b><span>${unit ? won(unit) + " / 개 · 현재 시세 기준" : "가격 매장 문의"}</span></div>`;
    $("#pickOpts").innerHTML = optsHtml(p);
    updatePick();
    openModal(pickModal);
  }
  function updatePick() {
    const pk = pickOf($("#pickForm")), unit = unitOf(pickCur, pk);
    optNote($("#pickOpts"), pickCur, pk);
    $("#pickTotal").textContent = unit ? won(unit) : "매장 문의";
  }

  // 장바구니 내용 + 합계 (가격은 현재 시세로 다시 계산)
  function renderCart() {
    // 판매 종료·숨김 상품은 빼고 보여줌
    const rows = cartItems.map(i => ({ ...i, p: window.SHOP.find(i.id) }));
    const gone = rows.filter(r => !r.p);
    if (gone.length) { cartItems = cartItems.filter(i => window.SHOP.find(i.id)); saveCart(); }
    const live = rows.filter(r => r.p);
    if (!live.length) {
      $("#cartList").innerHTML = `<div class="cart-empty"><p>장바구니가 비어 있어요.</p><a href="./#goldbar" class="btn btn--dark" data-close>골드바 보러 가기</a></div>`;
      cartForm.hidden = true;
      return;
    }
    cartForm.hidden = false;
    let goods = 0, cgoods = 0, priced = true;
    const noSize = r => Y.sizeList(r.p).length > 0 && !Y.sizeList(r.p).includes(r.size || "");
    $("#cartList").innerHTML = (gone.length ? `<p class="cart-warn">판매가 끝난 상품 ${gone.length}개를 장바구니에서 뺐어요.</p>` : "") + live.map(r => {
      const unit = unitOf(r.p, r);
      if (unit == null) priced = false; else { goods += unit * r.qty; if (coupOk(r.p)) cgoods += unit * r.qty; }
      const k = esc(keyOf(r));
      return `
        <div class="cart-row${r.p.sold_out ? " is-soldout" : ""}">
          <img src="${esc(imgOf(r.p))}" alt="">
          <div class="cart-row__info">
            <b>${esc(withPick(displayName(r.p), r.p, r))}</b>
            <span>${unit != null ? won(unit) + " / 개" : "가격 확인 중"}${r.p.sold_out ? ' · <em>품절</em>' : ""}${noSize(r) ? ' · <em>사이즈를 골라 다시 담아 주세요</em>' : ""}</span>
          </div>
          <div class="qty qty--sm"><button type="button" data-cq="${k}:-1" aria-label="빼기">−</button><input value="${r.qty}" readonly aria-label="수량"><button type="button" data-cq="${k}:1" aria-label="더하기">+</button></div>
          <p class="cart-row__sub">${unit != null ? won(unit * r.qty) : "-"}</p>
          <button type="button" class="cart-row__x" data-cdel="${k}" aria-label="삭제">×</button>
        </div>`;
    }).join("");
    const fee = cartForm.receive.value === "delivery" ? Number(shopInfo.delivery_fee) || 0 : 0;
    const b = calcBnf(cartForm, priced ? goods : null, cgoods), disc = b.cdisc + b.pts;
    cartForm._bnf = b;
    let dRow = $("#cartDiscRow");
    if (!dRow) {
      dRow = document.createElement("p"); dRow.id = "cartDiscRow"; dRow.innerHTML = `<span>쿠폰 할인</span><b id="cartDisc"></b>`;
      $("#cartTotal").closest("p").before(dRow);
    }
    dRow.hidden = !disc;
    $("#cartDisc").textContent = "−" + won(disc);
    $("#cartGoods").textContent = priced ? won(goods) : "-";
    $("#cartFee").textContent = won(fee);
    $("#cartTotal").textContent = priced ? won(goods - disc + fee) : "매장 문의";
    const hasSoldOut = live.some(r => r.p.sold_out), missing = live.some(noSize);
    $("#cartSubmit").disabled = hasSoldOut || missing;
    $("#cartSubmit").textContent = hasSoldOut ? "품절 상품을 빼 주세요" : missing ? "사이즈 없는 상품을 빼고 다시 담아 주세요" : `${live.length}종 ${cartCount()}개 주문하기`;
  }

  function openCart() {
    if (!sb) { toast(`전화로 주문해 주세요 · ${PHONE}`); return; }
    syncCartReceive();
    fillEmail(cartForm);
    renderBnf(cartForm);
    renderCart();
    openModal(cartModal);
    loadBnf().then(() => { renderBnf(cartForm); renderCart(); });
  }
  const cartBtn = $("#cartBtn");
  if (cartBtn) cartBtn.addEventListener("click", openCart);
  cartModal.addEventListener("click", e => {
    const q = e.target.closest("[data-cq]");
    if (q) {
      const cut = q.dataset.cq.lastIndexOf(":"), k = q.dataset.cq.slice(0, cut), d = q.dataset.cq.slice(cut + 1);
      const it = cartItems.find(i => keyOf(i) === k);
      if (it) { it.qty = Math.min(99, Math.max(1, it.qty + +d)); saveCart(); renderCart(); }
      return;
    }
    const x = e.target.closest("[data-cdel]");
    if (x) { cartItems = cartItems.filter(i => keyOf(i) !== x.dataset.cdel); saveCart(); renderCart(); return; }
    if (e.target.closest("a[data-close]")) closeModal(cartModal);
  });
  cartForm.addEventListener("change", e => { if (["receive", "coupon"].includes(e.target.name)) renderCart(); });

  cartForm.addEventListener("submit", async e => {
    e.preventDefault();
    const f = cartForm, btn = $("#cartSubmit");
    const items = cartItems.filter(i => window.SHOP.find(i.id)).map(i => ({ id: i.id, qty: i.qty, size: i.size || null, addon: !!i.addon }));
    if (!items.length) { renderCart(); return; }
    let receipt;
    try { receipt = receiptOf(f); } catch (msg) { toast(msg); return; }
    btn.disabled = true;
    const { data, error } = await sb.rpc("submit_cart", {
      p_items: items, p_name: f.name.value, p_phone: f.phone.value,
      p_receive: f.receive.value, p_address: f.address.value, p_note: noteOf(f), p_receipt: receipt,
      ...bnfArgs(f._bnf || {}),
    });
    btn.disabled = false;
    if (error) { toast(rpcError(error)); return; }
    const r = data || {};
    await Promise.all([saveMarketing(f), sendReceipt(f, r.code), saveConsent(f, r.code)]);
    const names = items.map(i => { const p = window.SHOP.find(i.id); return withPick(displayName(p), p, i); });
    try {
      sessionStorage.setItem("keumbi_order_" + r.code, JSON.stringify({
        ...r, receive: f.receive.value,
        product: names[0] + (names.length > 1 ? ` 외 ${names.length - 1}건` : ""),
      }));
    } catch {}
    cartItems = []; saveCart();
    location.href = "order-done.html?code=" + encodeURIComponent(r.code);
  });
  updateCartBadge();

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
    if (error) { box.innerHTML = `<p class="form-note">${/[가-힣]/.test(error.message || "") ? esc(error.message) : `조회 중 문제가 생겼어요. ${PHONE}로 문의해 주세요.`}</p>`; return; }
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
          ${r.kind === "order" && r.status === "confirmed" && r.amount && r.deadline ? payBox(r.amount, r.deadline, shopInfo) : ""}
          ${r.kind === "order" && r.amount && r.status !== "confirmed" && r.status !== "canceled" ? `<p class="track__time">확정 금액 ${won(r.amount)}</p>` : ""}
          ${r.tracking_no ? `<p class="track__time">${esc(r.courier || "택배")} ${esc(r.tracking_no)} · <a class="u" href="${esc(window.YAMOO.trackUrl(r.courier, r.tracking_no))}" target="_blank" rel="noopener">배송 조회</a></p>` : ""}
          <p class="track__time">최근 업데이트 ${fmtDate(r.updated_at)}</p>
        </div>`;
    }).join("");
  });

  /* ---------- 공지사항 · 시황 ---------- */
  const CAT = { notice: "공지", event: "이벤트", market: "시황" };
  let notices = [];
  async function loadNotices() {
    if (!sb || !$("#boardMarket")) return; // DB 연결 전에는 기존 예시 글 유지 · 게시판 없는 페이지는 건너뜀
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
