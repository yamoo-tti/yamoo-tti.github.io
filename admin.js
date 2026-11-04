/* 금비 GOLD 관리자 */
(function () {
  const { sb, esc, won, fmtDate, fetchLive, fetchSettings, computeDomestic, productPrice, ORDER_STATUS, SELL_STATUS, fmtPhone, fmtBiz, RECEIPT, COURIERS, trackUrl, DEFAULT_SETTINGS, INFO_FIELDS, infoDefaults, optLabel } = window.YAMOO;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const GRADE = { basic: "일반", silver: "실버", gold: "골드", vip: "VIP" };
  const STATUS = { active: "정상", suspended: "정지", withdrawn: "탈퇴" };
  const ROLE = { member: "회원", admin: "관리자" };
  const KIND = { bar: "골드바", zodiac: "카드형 1g", silver: "실버", accessory: "주얼리 (24K·실버)", gift: "순금선물" };
  const CATEGORY = { necklace: "목걸이", ring: "반지", bracelet: "팔찌", earring: "귀걸이", goods: "순금 기념품", dol: "돌선물", key: "행운의 열쇠", memo: "기념 골드바" };
  const CAT_OF = { accessory: ["necklace", "ring", "bracelet", "earring"], gift: ["goods", "dol", "key", "memo"] };
  const KARAT_KO = { "24K": "순금 24K", "18K": "18K", "14K": "14K", SV: "실버 925" };
  const hasLabor = k => k === "accessory" || k === "gift";
  const NCAT = { notice: "공지", event: "이벤트", market: "시황" };
  const RECEIVE = { visit: "매장 방문", delivery: "택배" };
  const KARAT = { "24K": "순금 24K", "18K": "18K", "14K": "14K", unknown: "모름" };
  const ENTITY = { member: "회원", order: "구매", sell: "매입", product: "상품", notice: "공지" };
  const FIELD = {
    name: "이름", phone: "연락처", role: "권한", grade: "등급", status: "상태", marketing: "마케팅", memo: "메모",
    final_price: "확정 금액", final_amount: "매입가", admin_memo: "관리 메모", visit_date: "방문일",
    premium_pct: "프리미엄%", labor: "공임", sold_out: "품절", visible: "노출", title: "제목", body: "내용",
    pinned: "필독", sort: "순서", weight_g: "중량", img: "이미지", tag: "태그", karat: "함량", category: "분류",
    kind: "종류", qty: "수량", address: "주소", note: "요청사항",
    courier: "택배사", tracking_no: "송장번호", receipt_issued_at: "영수증 발행", receipt_ref: "승인번호", paid_at: "입금 확인일", shipped_at: "발송일", pay_deadline: "입금 기한",
  };
  const ORDER_FLOW = ["new", "confirmed", "paid", "ready", "done"];
  // 입금 확인 이후인데 현금영수증·계산서를 아직 발행하지 않은 주문 (미신청이라도 10만원 이상이면 자진발급 대상)
  const rcType = r => (r.receipt && r.receipt.type) || "none";
  const needsReceipt = r => ["paid", "ready", "done"].includes(r.status) && !r.receipt_issued_at && (rcType(r) !== "none" || Number(r.final_price) >= 100000);
  const SELL_FLOW = ["new", "scheduled", "received", "done"];
  const IMAGES = [
    "gbk/bar-1g.webp", "gbk/bar-1_875g.webp", "gbk/bar-3_75g.webp", "gbk/bar-7_5g.webp", "gbk/bar-10g.webp", "gbk/bar-11_25g.webp", "gbk/bar-18_75g.webp", "gbk/bar-37_5g.webp", "gbk/bar-100g.webp",
    ...Array.from({ length: 13 }, (_, i) => `gbk/zodiac-${String(i + 1).padStart(2, "0")}.webp`),
    "silver/bar-500g.jpg", "silver/granule-100g.jpg", "silver/granule-1kg.jpg", "silver/granule-1kg-2.jpg",
    "silver/bar-100g.svg", "silver/bar-1kg.svg", "silver/granule.svg",
    "necklace-oval.jpg", "ring-mirror.jpg", "bracelet-chain.jpg", "earring-hoop.jpg", "pendant.jpg", "ring-box.jpg",
    "bracelet-charm.jpg", "necklace-blazer.jpg", "necklace-model.jpg", "bar-close.jpg", "bar-stack.jpg", "coins.jpg",
  ];
  const PAGE = 20;
  const COLS = "id,email,name,phone,role,grade,status,marketing,memo,created_at,updated_at,last_login_at";

  let me = null;
  let page = 1, filters = {}, rows = [];

  /* ---------- 공통 ---------- */
  let toastTimer;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("is-error", !!isError);
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 2600);
  }
  const pill = (map, key, prefix) => `<span class="pill ${prefix}-${esc(key)}">${esc(map[key] || key)}</span>`;
  function fail(error) { console.error(error); toast("오류: " + (error.message || error), true); }
  const isToday = d => new Date(d).toDateString() === new Date().toDateString();
  const opts = (map, sel) => Object.entries(map).map(([k, v]) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
  const num = v => (v === "" || v == null ? null : Number(v));
  const imgUrl = p => /^https?:\/\//.test(p || "") ? p : `images/${p || "bar-close.jpg"}`;

  // 시세 (상품 가격 계산용) — 5분 캐시
  let domCache = null, domAt = 0;
  async function domestic() {
    if (domCache && Date.now() - domAt < 300000) return domCache;
    const [live, s] = await Promise.all([fetchLive(), fetchSettings()]);
    domCache = computeDomestic(live, s); domAt = Date.now();
    return domCache;
  }

  /* ---------- 진입 / 로그인 ---------- */
  async function boot() {
    if (!sb) { $("#setupGate").hidden = false; return; }
    const { data } = await sb.auth.getSession();
    if (data.session && await enter(data.session.user)) return;
    $("#loginGate").hidden = false;
  }

  async function enter(user) {
    const { data, error } = await sb.from("profiles").select("id,email,name,role,status").eq("id", user.id).maybeSingle();
    if (error || !data || data.role !== "admin" || data.status !== "active") {
      await sb.auth.signOut();
      $("#loginMsg").textContent = "관리자 권한이 없는 계정입니다.";
      return false;
    }
    me = data;
    $("#meName").textContent = (me.name || me.email) + " 님";
    $("#loginGate").hidden = true;
    $("#app").hidden = false;
    show("dash");
    refreshBadges();
    setInterval(() => { if (!document.hidden) refreshBadges(); }, 60000);
    return true;
  }

  $("#adminLogin").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button");
    $("#loginMsg").textContent = "";
    btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false;
    if (error) { $("#loginMsg").textContent = "이메일 또는 비밀번호가 올바르지 않습니다."; return; }
    await enter(data.user);
  });
  $("#logoutBtn").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  /* ---------- 새 접수 알림 배지 ---------- */
  let lastNew = null;
  async function refreshBadges() {
    const c = t => sb.from(t).select("id", { count: "exact", head: true }).eq("status", "new").then(r => r.count || 0);
    try {
      const [o, s] = await Promise.all([c("orders"), c("sell_requests")]);
      const set = (id, n) => { const b = $(id); b.textContent = n; b.hidden = !n; };
      set("#badgeOrders", o); set("#badgeSells", s);
      document.title = (o + s ? `(${o + s}) ` : "") + "금비 GOLD 관리자";
      if (lastNew != null && o + s > lastNew) toast(`새 접수 ${o + s - lastNew}건이 들어왔어요`);
      lastNew = o + s;
    } catch (e) { console.warn(e); }
  }

  /* ---------- 화면 전환 ---------- */
  const loaders = { dash: loadDash, sales: loadSales, stats: () => loadAnalytics(), orders: () => loadRequests("orders"), sells: () => loadRequests("sells"), products: loadProducts, notices: loadNotices, members: loadMembers, price: loadPrice, logs: loadLogs };
  let current = "dash";
  function show(view) {
    current = view;
    $$(".side__nav button").forEach(b => b.classList.toggle("is-on", b.dataset.view === view));
    $$(".view").forEach(v => { v.hidden = v.dataset.view !== view; });
    loaders[view]();
  }
  $$(".side__nav button").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
  document.addEventListener("click", e => {
    const go = e.target.closest("[data-go]"); if (go) show(go.dataset.go);
    if (e.target.closest("[data-refresh]")) { loaders[current](); refreshBadges(); }
  });

  /* ---------- 대시보드 ---------- */
  const count = q => q.then(r => { if (r.error) throw r.error; return r.count || 0; });
  const base = () => sb.from("profiles").select("id", { count: "exact", head: true });
  const openOf = t => sb.from(t).select("id", { count: "exact", head: true }).not("status", "in", "(done,canceled)");
  const todayOf = t => { const d = new Date(); d.setHours(0, 0, 0, 0); return sb.from(t).select("id", { count: "exact", head: true }).gte("created_at", d.toISOString()); };

  async function loadDash() {
    try {
      const [openO, openS, todayO, todayS, total, ...grades] = await Promise.all([
        count(openOf("orders")), count(openOf("sell_requests")), count(todayOf("orders")), count(todayOf("sell_requests")),
        count(base()),
        ...Object.keys(GRADE).map(g => count(base().eq("grade", g).neq("status", "withdrawn"))),
      ]);
      $("#kpis").innerHTML = `
        <button class="kpi kpi--gold" data-go="orders"><p>처리할 구매 신청</p><strong>${openO}</strong><small>완료·취소 제외</small></button>
        <button class="kpi kpi--gold" data-go="sells"><p>처리할 매입 신청</p><strong>${openS}</strong><small>완료·취소 제외</small></button>
        <div class="kpi"><p>오늘 접수</p><strong>${todayO + todayS}</strong><small>구매 ${todayO} · 매입 ${todayS}</small></div>
        <button class="kpi" data-go="members"><p>전체 회원</p><strong>${total.toLocaleString()}</strong><small>탈퇴 포함</small></button>`;
      const max = Math.max(1, ...grades);
      $("#gradeBars").innerHTML = Object.keys(GRADE).map((g, i) => `
        <div class="hbar"><span>${GRADE[g]}</span><div class="hbar__track"><div class="hbar__fill" style="width:${(grades[i] / max) * 100}%"></div></div><span>${grades[i].toLocaleString()}명</span></div>`).join("");

      const [o, s, m] = await Promise.all([
        sb.from("orders").select("*").not("status", "in", "(done,canceled)").order("created_at", { ascending: false }).limit(6),
        sb.from("sell_requests").select("*").not("status", "in", "(done,canceled)").order("created_at", { ascending: false }).limit(6),
        sb.from("profiles").select(COLS).order("created_at", { ascending: false }).limit(5),
      ]);
      if (o.error) throw o.error; if (s.error) throw s.error; if (m.error) throw m.error;
      cache.orders = o.data; cache.sells = s.data; rows = m.data;
      $("#dashOrders").innerHTML = requestTable("orders", o.data, true);
      $("#dashSells").innerHTML = requestTable("sells", s.data, true);
      $("#recentTable").innerHTML = memberTable(m.data, false);
    } catch (e) { fail(e); }
    loadDashPrice();
  }

  async function loadDashPrice() {
    try {
      const [live, s] = await Promise.all([fetchLive(), fetchSettings()]);
      const d = computeDomestic(live, s);
      $("#dashPriceTime").textContent = fmtDate(live.updatedAt) + " 기준";
      $("#dashPrice").innerHTML = priceRows(d.items);
    } catch (e) { $("#dashPrice").innerHTML = `<tr><td>시세를 불러오지 못했습니다</td></tr>`; }
  }
  const priceRows = items => `<tr><th>품목 (3.75g)</th><th>살 때</th><th>팔 때</th></tr>` +
    items.map(i => `<tr><td>${i.name}</td><td>${i.buy ? i.buy.toLocaleString() : "제품시세"}</td><td>${i.sell.toLocaleString()}</td></tr>`).join("");

  /* ---------- 구매 신청 · 매입 신청 ---------- */
  const REQ = {
    orders: { table: "orders", status: ORDER_STATUS, flow: ORDER_FLOW, tabs: "#orderTabs", list: "#orderTable", search: "#orderSearch" },
    sells: { table: "sell_requests", status: SELL_STATUS, flow: SELL_FLOW, tabs: "#sellTabs", list: "#sellTable", search: "#sellSearch" },
  };
  const cache = { orders: [], sells: [] };
  const reqTab = { orders: "open", sells: "open" };
  const reqQ = { orders: "", sells: "" };

  async function loadRequests(kind) {
    const c = REQ[kind];
    const { data, error } = await sb.from(c.table).select("*").order("created_at", { ascending: false }).limit(500);
    if (error) return fail(error);
    cache[kind] = data;
    renderRequests(kind);
  }

  function renderRequests(kind) {
    const c = REQ[kind], all = cache[kind];
    const pick = k => k === "all" ? all : k === "open" ? all.filter(r => !["done", "canceled"].includes(r.status)) : k === "receipt" ? all.filter(needsReceipt) : all.filter(r => r.status === k);
    const cnt = k => pick(k).length;
    const tabs = [["open", "진행 중"], ...Object.entries(c.status), ...(kind === "orders" ? [["receipt", "영수증 발행 필요"]] : []), ["all", "전체"]];
    $(c.tabs).innerHTML = tabs.map(([k, v]) => `<button data-tab="${kind}:${k}" class="${reqTab[kind] === k ? "is-on" : ""}">${v} <span>${cnt(k)}</span></button>`).join("");
    const t = reqTab[kind];
    let list = pick(t);
    const q = reqQ[kind].toLowerCase().replace(/-/g, "");
    if (q) list = list.filter(r => [r.code, r.name, r.phone, r.product_name, r.tracking_no, typeof r.items === "string" ? r.items : ""].some(v => String(v || "").toLowerCase().replace(/-/g, "").includes(q)));
    $(c.list).innerHTML = requestTable(kind, list, false);
  }

  function requestTable(kind, list, compact) {
    const c = REQ[kind], isO = kind === "orders";
    const head = compact
      ? `<thead><tr><th>접수</th><th>${isO ? "상품" : "품목"}</th><th>고객</th><th>상태</th></tr></thead>`
      : `<thead><tr><th>접수번호</th><th>접수일시</th><th>${isO ? "상품 · 수량" : "품목 · 함량"}</th><th>고객</th><th>${isO ? "수령" : "방법 · 방문일"}</th><th>${isO ? "금액" : "매입가"}</th><th>상태</th><th>처리</th></tr></thead>`;
    if (!list.length) return head + `<tbody><tr><td class="empty" colspan="8">${compact ? "처리할 접수가 없습니다 👍" : "접수가 없습니다"}</td></tr></tbody>`;
    return head + "<tbody>" + list.map(r => {
      const multi = isO && Array.isArray(r.items) && r.items.length > 1;
      const what = isO ? (multi ? `${esc(r.product_name)} <span class="muted">총 ${r.qty}개</span>` : `${esc(r.product_name)} <span class="muted">× ${r.qty}</span>`) : `${esc(r.items)} <span class="muted">${KARAT[r.karat] || ""}${r.weight_g ? " · " + Number(r.weight_g) + "g" : ""}</span>`;
      const who = `<b>${esc(r.name)}</b><span>${esc(fmtPhone(r.phone))}</span>`;
      const st = `<span class="pill st-${esc(r.status)}">${esc(c.status[r.status])}</span>${isToday(r.created_at) && r.status === "new" ? ' <span class="pill st-today">오늘</span>' : ""}`;
      if (compact) return `<tr class="clickable" data-rec="${kind}:${r.id}"><td>${fmtDate(r.created_at).slice(5)}</td><td class="ellipsis">${what}</td><td class="who">${who}</td><td>${st}</td></tr>`;
      const i = c.flow.indexOf(r.status), next = i >= 0 && i < c.flow.length - 1 ? c.flow[i + 1] : null;
      const due = isO && r.status === "confirmed" && r.pay_deadline
        ? `<br><span class="${new Date(r.pay_deadline) < new Date() ? "danger-text" : "muted"}">입금기한 ${fmtDate(r.pay_deadline).slice(11)}</span>` : "";
      const money = isO ? (r.final_price ? `<b>${won(r.final_price)}</b>${due}` : r.quoted_price ? `<span class="muted">예상 ${won(r.quoted_price)}</span>` : "-") : (r.final_amount ? `<b>${won(r.final_amount)}</b>` : "-");
      const ship = isO && r.tracking_no ? `<br><span class="muted">${esc(r.courier || "")} ${esc(r.tracking_no)}</span>` : "";
      const rcPill = isO && needsReceipt(r) ? `<br><span class="pill st-rc">${rcType(r) === "none" ? "자진발급 필요" : rcType(r) === "invoice" ? "계산서 발행 필요" : "영수증 발행 필요"}</span>` : "";
      const how = isO ? RECEIVE[r.receive] + ship :`${RECEIVE[r.method]}${r.visit_date ? " · " + r.visit_date.slice(5).replace("-", ".") : ""}`;
      return `<tr class="clickable" data-rec="${kind}:${r.id}">
        <td class="code">${esc(r.code)}</td><td>${fmtDate(r.created_at)}</td><td class="ellipsis">${what}</td>
        <td class="who">${who}</td><td>${how}</td><td>${money}${rcPill}</td><td>${st}</td>
        <td><div class="row-actions">
          ${next ? `<button data-next="${kind}:${r.id}:${next}">→ ${esc(c.status[next])}</button>` : ""}
          <select class="st-pick" data-setstatus="${kind}:${r.id}" aria-label="상태 바꾸기">
            <option value="">상태 변경…</option>
            ${Object.entries(c.status).filter(([k]) => k !== r.status && k !== "canceled").map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}
          </select>
          ${r.status !== "canceled" ? `<button class="danger" data-next="${kind}:${r.id}:canceled">취소</button>` : ""}
        </div></td>
      </tr>`;
    }).join("") + "</tbody>";
  }

  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tab]");
    if (!t) return;
    const [kind, k] = t.dataset.tab.split(":");
    if (REQ[kind]) { reqTab[kind] = k; renderRequests(kind); }
    else if (kind === "products") { productTab = k; productSub = "all"; renderProducts(); }
    else if (kind === "psub") { productSub = k; renderProducts(); }
    else if (kind === "logs") { logTab = k; renderLogs(); }
  });
  Object.keys(REQ).forEach(kind => $(REQ[kind].search).addEventListener("submit", e => {
    e.preventDefault(); reqQ[kind] = e.target.q.value.trim(); renderRequests(kind);
  }));

  async function setStatus(kind, id, status) {
    const c = REQ[kind];
    const row = (cache[kind] || []).find(x => x.id === id) || {};
    const patch = { status };
    if (kind === "orders" && status === "ready" && row.receive === "delivery" && !row.tracking_no) {
      toast("택배사와 송장번호를 입력하고 저장해 주세요");
      return openRequest(kind, row, "ready");
    }
    if (status === "canceled" && !confirm(`${row.code || "이 접수"}을(를) 취소할까요?`)) return;
    // 입금 대기로 되돌릴 때 기한이 이미 지났으면, 바로 자동 취소되지 않게 기한을 30분 연장
    if (kind === "orders" && status === "confirmed" && row.pay_deadline && new Date(row.pay_deadline) < new Date()) {
      if (!confirm("입금 기한이 이미 지난 주문이에요. 기한을 지금부터 30분 연장할까요?\n(취소를 누르면 상태를 바꾸지 않아요)")) return;
      patch.pay_deadline = new Date(Date.now() + 30 * 60000).toISOString();
    }
    const { error } = await sb.from(c.table).update(patch).eq("id", id);
    if (error) return fail(error);
    toast(`'${c.status[status]}'(으)로 변경했습니다`);
    loaders[current](); refreshBadges();
  }

  /* ---------- 공용 편집 드로어 ---------- */
  let editing = null; // { type, row, save, remove }
  function openEdit(title, html, cfg) {
    editing = cfg;
    $("#editTitle").textContent = title;
    $("#editBody").innerHTML = html;
    $("#editDelete").hidden = !cfg.remove;
    $("#editDrawer").hidden = false;
    cfg.after && cfg.after($("#editForm"));
  }
  const closeEdit = () => { $("#editDrawer").hidden = true; editing = null; };
  $("#editDrawer").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeEdit(); });
  $("#editForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!editing) return;
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      if (await editing.save(e.target) === false) return; // 확인 창에서 취소
      closeEdit(); loaders[current](); refreshBadges();
    }
    catch (err) { fail(err); }
    finally { btn.disabled = false; }
  });
  $("#editDelete").addEventListener("click", async () => {
    if (!editing || !editing.remove || !confirm("삭제하면 되돌릴 수 없어요. 삭제할까요?")) return;
    try { await editing.remove(); toast("삭제했습니다"); closeEdit(); loaders[current](); } catch (err) { fail(err); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#editDrawer").hidden) closeEdit(); });
  const must = r => { if (r.error) throw r.error; return r; };

  // 현금영수증 · 계산서 정보 (관리자 상세)
  function receiptBlock(r) {
    const rc = r.receipt || { type: "none" }, t = rc.type || "none";
    const copy = v => `<button type="button" class="link" data-copytext="${esc(v)}">복사</button>`;
    const lines = t === "none"
      ? `<p class="muted">손님이 신청하지 않았어요.${Number(r.final_price) >= 100000 ? " <b>10만원 이상 현금 거래라 국세청 지정번호(010-000-1234)로 자진발급</b>해야 해요." : ""}</p>`
      : `<dl class="meta meta--tight">
          <dt>번호</dt><dd><b>${esc(t === "personal" ? fmtPhone(rc.no) : fmtBiz(rc.no))}</b> ${copy(rc.no)}</dd>
          ${t === "invoice" ? `<dt>상호</dt><dd>${esc(rc.company)}</dd><dt>대표자</dt><dd>${esc(rc.ceo)}</dd><dt>이메일</dt><dd>${esc(rc.email)} ${copy(rc.email)}</dd>` : ""}
          <dt>발행 금액</dt><dd>${r.final_price ? won(r.final_price) : "-"}</dd>
        </dl>`;
    return `
      <fieldset class="box"><legend>현금영수증·계산서 · ${esc(RECEIPT[t] || t)}</legend>
        ${lines}
        <div class="row2">
          <label class="inline"><input type="checkbox" name="rc_done" ${r.receipt_issued_at ? "checked" : ""}> 발행 완료${r.receipt_issued_at ? ` <small>${fmtDate(r.receipt_issued_at)}</small>` : ""}</label>
          <label>승인번호 <small>선택</small><input name="receipt_ref" maxlength="40" value="${esc(r.receipt_ref || "")}"></label>
        </div>
      </fieldset>`;
  }
  function shipBlock(r) {
    if (r.receive !== "delivery") return "";
    return `
      <fieldset class="box" id="shipBox"><legend>택배 발송</legend>
        <div class="row2">
          <label>택배사<select name="courier">${COURIERS.map(x => `<option ${x === (r.courier || "우체국택배") ? "selected" : ""}>${x}</option>`).join("")}</select></label>
          <label>송장번호<input name="tracking_no" maxlength="30" inputmode="numeric" value="${esc(r.tracking_no || "")}"></label>
        </div>
        <p class="muted">송장번호를 넣고 상태를 '${ORDER_STATUS.ready}'로 저장하면 손님에게 발송 문자가 가고, 주문내역에 배송 조회 버튼이 생겨요.${r.tracking_no ? ` <a href="${esc(trackUrl(r.courier, r.tracking_no))}" target="_blank" rel="noopener">배송 조회 ↗</a>` : ""}</p>
      </fieldset>`;
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-copytext]");
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copytext); toast("복사했어요"); } catch { toast(b.dataset.copytext); }
  });

  function openRequest(kind, r, preset) {
    const c = REQ[kind], isO = kind === "orders";
    const tel = `<a href="tel:${esc(r.phone)}">${esc(fmtPhone(r.phone))}</a>`;
    const meta = isO
      ? `<dt>접수번호</dt><dd><b>${esc(r.code)}</b></dd><dt>접수일시</dt><dd>${fmtDate(r.created_at)}</dd>
         <dt>상품</dt><dd>${Array.isArray(r.items) && r.items.length ? `<ul class="items-list">${r.items.map(i => `<li>${esc(i.name)} × ${i.qty}${i.subtotal ? ` <span class="muted">${won(i.subtotal)}</span>` : ""}</li>`).join("")}</ul>` : `${esc(r.product_name)} × ${r.qty}`}</dd><dt>확정 금액</dt><dd>${r.final_price ? `<b>${won(r.final_price)}</b>${Number(r.shipping_fee) ? ` <span class="muted">택배비 ${won(r.shipping_fee)} 포함</span>` : ""}${r.price_locked_at ? ` <span class="muted">(${fmtDate(r.price_locked_at)} 시세 자동 확정)</span>` : ""}` : "-"}</dd>
         ${r.pay_deadline ? `<dt>입금 기한</dt><dd>${fmtDate(r.pay_deadline)}${r.status === "confirmed" ? " · 지나면 자동 취소" : ""}</dd>` : ""}
         ${r.paid_at ? `<dt>입금 확인</dt><dd>${fmtDate(r.paid_at)}</dd>` : ""}${r.shipped_at ? `<dt>발송</dt><dd>${fmtDate(r.shipped_at)}</dd>` : ""}
         <dt>화면 표시 금액</dt><dd>${r.quoted_price ? won(r.quoted_price) : "-"}</dd>
         <dt>고객</dt><dd>${esc(r.name)} · ${tel}${r.user_id ? ' <span class="pill r-admin">회원</span>' : ""}</dd>
         <dt>수령</dt><dd>${RECEIVE[r.receive]}</dd>${r.address ? `<dt>주소</dt><dd>${esc(r.address)}</dd>` : ""}
         ${r.note ? `<dt>요청사항</dt><dd>${esc(r.note)}</dd>` : ""}`
      : `<dt>접수번호</dt><dd><b>${esc(r.code)}</b></dd><dt>접수일시</dt><dd>${fmtDate(r.created_at)}</dd>
         <dt>품목</dt><dd>${esc(r.items)}</dd><dt>함량·중량</dt><dd>${KARAT[r.karat]}${r.weight_g ? " · 약 " + Number(r.weight_g) + "g" : ""}</dd>
         <dt>고객</dt><dd>${esc(r.name)} · ${tel}${r.user_id ? ' <span class="pill r-admin">회원</span>' : ""}</dd>
         <dt>방법</dt><dd>${RECEIVE[r.method]}</dd>${r.note ? `<dt>메모</dt><dd>${esc(r.note)}</dd>` : ""}`;
    const flow = c.flow.map((k, i) => `<li class="${i < c.flow.indexOf(r.status) ? "is-past" : k === r.status ? "is-now" : ""}">${c.status[k]}</li>`).join("");
    const html = `
      <dl class="meta">${meta}</dl>
      ${r.status === "canceled" ? '<p class="warn">취소된 접수입니다.</p>' : `<ol class="flow">${flow}</ol>`}
      <label>진행 상태<select name="status">${opts(c.status, preset || r.status)}</select></label>
      ${isO
        ? `<label>확정 금액 (원) <small>고객에게 안내한 최종 금액</small><input type="number" name="final_price" min="0" step="100" value="${r.final_price ?? ""}"></label>
           ${shipBlock(r)}${receiptBlock(r)}`
        : `<div class="row2"><label>방문일<input type="date" name="visit_date" value="${r.visit_date ?? ""}"></label>
           <label>매입가 (원)<input type="number" name="final_amount" min="0" step="100" value="${r.final_amount ?? ""}"></label></div>`}
      <label>관리 메모 <small>고객에게 보이지 않습니다</small><textarea name="admin_memo" rows="4" maxlength="1000">${esc(r.admin_memo || "")}</textarea></label>
      <p class="muted">최종 수정 ${fmtDate(r.updated_at)}</p>`;
    openEdit(`${isO ? "구매" : "매입"} 신청 · ${r.code}`, html, {
      after: f => { if (preset === "ready" && f.tracking_no) f.tracking_no.focus(); },
      save: async f => {
        const patch = { status: f.status.value, admin_memo: f.admin_memo.value.trim() || null };
        if (isO) {
          patch.final_price = num(f.final_price.value);
          patch.receipt_issued_at = f.rc_done.checked ? (r.receipt_issued_at || new Date().toISOString()) : null;
          patch.receipt_ref = f.receipt_ref.value.trim() || null;
          if (f.tracking_no) {
            patch.courier = f.courier.value;
            patch.tracking_no = f.tracking_no.value.replace(/\s/g, "") || null;
            if (["ready", "done"].includes(patch.status) && !patch.tracking_no && !confirm("송장번호 없이 저장할까요?\n(손님에게 발송 문자와 배송 조회가 안내되지 않아요)")) return false;
          }
        }
        else { patch.final_amount = num(f.final_amount.value); patch.visit_date = f.visit_date.value || null; }
        if (patch.status === "canceled" && r.status !== "canceled" && !confirm("이 접수를 취소 처리할까요?")) return false;
        if (isO && patch.status === "confirmed" && r.pay_deadline && new Date(r.pay_deadline) < new Date()) {
          if (!confirm("입금 기한이 이미 지난 주문이에요. 기한을 지금부터 30분 연장할까요?")) return false;
          patch.pay_deadline = new Date(Date.now() + 30 * 60000).toISOString();
        }
        must(await sb.from(c.table).update(patch).eq("id", r.id));
        toast("저장했습니다");
      },
    });
  }

  /* ---------- 매출 정리 ---------- */
  // 엑셀에서 한글이 깨지지 않는 CSV 내려받기
  function downloadCsv(name, head, rows) {
    const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const text = "﻿" + [head, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const ymd = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const PAID = ["paid", "ready", "done"];
  const paidDay = r => ymd(r.paid_at || r.created_at);
  let sales = { orders: [], sells: [], from: "", to: "" };

  function setRange(kind) {
    const f = $("#salesForm"), now = new Date();
    let a = new Date(now.getFullYear(), now.getMonth(), 1), b = now;
    if (kind === "today") a = now;
    if (kind === "week") { a = new Date(now); a.setDate(now.getDate() - 6); }
    if (kind === "last") { a = new Date(now.getFullYear(), now.getMonth() - 1, 1); b = new Date(now.getFullYear(), now.getMonth(), 0); }
    if (kind === "year") a = new Date(now.getFullYear(), 0, 1);
    f.from.value = ymd(a); f.to.value = ymd(b);
  }

  async function loadSales() {
    const f = $("#salesForm");
    if (!f.from.value) setRange("month");
    const from = f.from.value, to = f.to.value;
    if (from > to) return toast("시작일이 종료일보다 늦어요", true);
    // 입금 확인일 기준: 주문일이 조금 앞설 수 있어 넉넉히 불러온 뒤 거름
    const start = new Date(from + "T00:00:00"); start.setDate(start.getDate() - 14);
    const end = new Date(to + "T00:00:00"); end.setDate(end.getDate() + 1);
    const [o, s] = await Promise.all([
      sb.from("orders").select("*").in("status", PAID).gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at").limit(5000),
      sb.from("sell_requests").select("*").eq("status", "done").gte("updated_at", new Date(from + "T00:00:00").toISOString()).lt("updated_at", end.toISOString()).order("updated_at").limit(5000),
    ]);
    if (o.error) return fail(o.error);
    if (s.error) return fail(s.error);
    sales = { orders: o.data.filter(r => paidDay(r) >= from && paidDay(r) <= to), sells: s.data, from, to };
    renderSales();
  }

  // 주문 1건 → 상품별 줄 (장바구니 주문은 여러 줄)
  const orderLines = r => Array.isArray(r.items) && r.items.length
    ? r.items.map(i => ({ name: i.name, qty: i.qty, amount: Number(i.subtotal) || 0 }))
    : [{ name: r.product_name, qty: r.qty, amount: (Number(r.final_price) || 0) - (Number(r.shipping_fee) || 0) }];

  function renderSales() {
    const { orders, sells } = sales;
    const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
    const total = sum(orders, r => r.final_price), fee = sum(orders, r => r.shipping_fee);
    const rcTodo = orders.filter(needsReceipt).length, payout = sum(sells, r => r.final_amount);
    $("#salesKpis").innerHTML = `
      <div class="kpi kpi--gold"><p>입금 확인 매출</p><strong>${won(total)}</strong><small>${orders.length}건 · 택배비 포함</small></div>
      <div class="kpi"><p>상품 매출</p><strong>${won(total - fee)}</strong><small>택배비 ${won(fee)} 별도</small></div>
      <button class="kpi${rcTodo ? " kpi--warn" : ""}" data-go="orders" data-rctab><p>영수증·계산서 발행 필요</p><strong>${rcTodo}</strong><small>누르면 목록으로</small></button>
      <div class="kpi"><p>매입 지급</p><strong>${won(payout)}</strong><small>${sells.length}건 · 지급 완료</small></div>`;

    const days = {};
    orders.forEach(r => { const d = paidDay(r); days[d] = days[d] || { n: 0, amt: 0, buy: 0 }; days[d].n++; days[d].amt += Number(r.final_price) || 0; });
    sells.forEach(r => { const d = ymd(r.updated_at); days[d] = days[d] || { n: 0, amt: 0, buy: 0 }; days[d].buy += Number(r.final_amount) || 0; });
    const dk = Object.keys(days).sort().reverse();
    $("#salesDaily").innerHTML = `<thead><tr><th>날짜</th><th>주문</th><th>매출</th><th>매입 지급</th></tr></thead><tbody>` +
      (dk.length ? dk.map(d => `<tr><td>${d.slice(5).replace("-", ".")}</td><td>${days[d].n}건</td><td><b>${won(days[d].amt)}</b></td><td>${days[d].buy ? won(days[d].buy) : "-"}</td></tr>`).join("")
        : `<tr><td class="empty" colspan="4">이 기간에 입금 확인된 주문이 없어요</td></tr>`) + "</tbody>";

    const items = {};
    orders.forEach(r => orderLines(r).forEach(l => { items[l.name] = items[l.name] || { qty: 0, amt: 0 }; items[l.name].qty += Number(l.qty) || 0; items[l.name].amt += l.amount; }));
    const ik = Object.keys(items).sort((a, b) => items[b].amt - items[a].amt);
    $("#salesItems").innerHTML = `<thead><tr><th>상품</th><th>수량</th><th>금액</th></tr></thead><tbody>` +
      (ik.length ? ik.map(k => `<tr><td class="ellipsis">${esc(k)}</td><td>${items[k].qty}개</td><td>${won(items[k].amt)}</td></tr>`).join("")
        : `<tr><td class="empty" colspan="3">-</td></tr>`) + "</tbody>";

    $("#salesTable").innerHTML = `<thead><tr><th>입금 확인</th><th>접수번호</th><th>상품</th><th>고객</th><th>금액</th><th>영수증</th><th>상태</th></tr></thead><tbody>` +
      (orders.length ? [...orders].sort((a, b) => paidDay(b).localeCompare(paidDay(a))).map(r => `
        <tr class="clickable" data-rec="orders:${r.id}">
          <td>${fmtDate(r.paid_at || r.created_at)}</td><td class="code">${esc(r.code)}</td>
          <td class="ellipsis">${esc(r.product_name)} <span class="muted">${r.qty}개</span></td>
          <td class="who"><b>${esc(r.name)}</b><span>${esc(fmtPhone(r.phone))}</span></td>
          <td><b>${won(r.final_price)}</b></td>
          <td>${r.receipt_issued_at ? `<span class="pill st-done">발행 완료</span>` : needsReceipt(r) ? `<span class="pill st-rc">${rcType(r) === "none" ? "자진발급 필요" : "발행 필요"}</span>` : `<span class="muted">${esc(RECEIPT[rcType(r)])}</span>`}</td>
          <td><span class="pill st-${esc(r.status)}">${esc(ORDER_STATUS[r.status])}</span></td>
        </tr>`).join("") : `<tr><td class="empty" colspan="7">이 기간에 입금 확인된 주문이 없어요</td></tr>`) + "</tbody>";
    cache.orders = orders; // 행을 누르면 상세가 열리게
  }

  /* ---------- 판매 분석 ---------- */
  let anUnit = "day", an = null;
  const SRC_KO = { naver: "네이버", google: "구글", daum: "다음", kakao: "카카오", instagram: "인스타그램", facebook: "페이스북", youtube: "유튜브", email: "주문 메일 링크", direct: "직접 방문·즐겨찾기", other: "기타 사이트" };
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) + 1;
  const pct = (a, b) => b ? (a / b * 100) : 0;
  const pctTxt = v => (Math.round(v * 10) / 10).toLocaleString("ko-KR") + "%";

  function setARange(kind) {
    const f = $("#anForm"), now = new Date();
    let a = new Date(now.getFullYear(), now.getMonth(), 1), b = now;
    if (kind === "today") a = now;
    if (kind === "week") { a = new Date(now); a.setDate(now.getDate() - 6); }
    if (kind === "d30") { a = new Date(now); a.setDate(now.getDate() - 29); }
    if (kind === "last") { a = new Date(now.getFullYear(), now.getMonth() - 1, 1); b = new Date(now.getFullYear(), now.getMonth(), 0); }
    if (kind === "year") a = new Date(now.getFullYear(), 0, 1);
    f.from.value = ymd(a); f.to.value = ymd(b);
  }

  // 주문 1건 → 상품 줄 (상품 id 포함, 장바구니 주문은 여러 줄)
  const linesOf = r => Array.isArray(r.items) && r.items.length
    ? r.items.map(i => ({ id: i.product_id, name: i.name, qty: Number(i.qty) || 0, amount: Number(i.subtotal) || 0 }))
    : [{ id: r.product_id, name: r.product_name, qty: Number(r.qty) || 0, amount: (Number(r.final_price) || 0) - (Number(r.shipping_fee) || 0) }];

  async function loadAnalytics() {
    const f = $("#anForm");
    if (!f.from.value) setARange("d30");
    const from = f.from.value, to = f.to.value;
    if (from > to) return toast("시작일이 종료일보다 늦어요", true);
    const len = daysBetween(from, to), pFrom = addDays(from, -len), pTo = addDays(from, -1);
    const qStart = new Date(pFrom + "T00:00:00"); qStart.setDate(qStart.getDate() - 14);
    const qEnd = new Date(addDays(to, 1) + "T00:00:00");
    const [o, cur, prev, pr, mem, hist] = await Promise.all([
      sb.from("orders").select("id,status,final_price,shipping_fee,items,product_id,product_name,qty,phone,created_at,paid_at,receive")
        .gte("created_at", qStart.toISOString()).lt("created_at", qEnd.toISOString()).order("created_at").limit(5000),
      sb.rpc("analytics_counts", { p_from: from, p_to: to }),
      sb.rpc("analytics_counts", { p_from: pFrom, p_to: pTo }),
      sb.from("products").select("id,name,kind,karat,category,weight_g,visible"),
      sb.from("profiles").select("created_at").gte("created_at", new Date(pFrom + "T00:00:00").toISOString()).lt("created_at", qEnd.toISOString()).limit(5000),
      sb.from("orders").select("phone").in("status", PAID).lt("created_at", new Date(from + "T00:00:00").toISOString()).limit(10000),
    ]);
    for (const r of [o, pr, mem, hist]) if (r.error) return fail(r.error);
    if (cur.error || prev.error) { toast("판매 분석 SQL(analytics.sql)을 먼저 실행해 주세요", true); console.error(cur.error || prev.error); }
    an = { from, to, pFrom, pTo, orders: o.data, cur: cur.data || {}, prev: prev.data || {}, products: pr.data, members: mem.data, oldPhones: new Set(hist.data.map(r => r.phone)) };
    renderAnalytics();
  }

  // 세로 막대 차트 (막대에 마우스를 올리면 값)
  function vchart(el, keys, vals, fmt, lab) {
    const max = Math.max(0, ...vals);
    if (!keys.length || max === 0) { el.innerHTML = `<p class="muted an-empty">이 기간 기록이 없어요</p>`; return; }
    const every = Math.ceil(keys.length / 10);
    el.innerHTML = `<div class="vchart__max">${fmt(max)}</div><div class="vchart__bars">${keys.map((k, i) => `
      <div class="vbar" data-tip="${esc(lab(k))} · ${esc(fmt(vals[i]))}" tabindex="0" aria-label="${esc(lab(k))} ${esc(fmt(vals[i]))}">
        <i style="height:${vals[i] ? Math.max(2, vals[i] / max * 100) : 0}%"></i>
        <span>${i % every === 0 ? esc(lab(k)) : ""}</span>
      </div>`).join("")}</div>`;
  }
  function hbars(el, rows, fmt) {
    const max = Math.max(0, ...rows.map(r => r[1]));
    el.innerHTML = rows.length && max ? rows.map(([k, v, extra]) => `
      <div class="hbar"><span title="${esc(k)}">${esc(k)}</span><div class="hbar__track"><div class="hbar__fill" style="width:${v / max * 100}%"></div></div><span>${fmt(v)}${extra ? ` <small class="muted">${extra}</small>` : ""}</span></div>`).join("")
      : `<p class="muted">이 기간 기록이 없어요</p>`;
  }
  const delta = (c, p) => {
    if (!p) return c ? `<em class="dl up">새로 생김</em>` : "";
    const d = (c - p) / p * 100;
    if (Math.abs(d) < 0.05) return `<em class="dl">변화 없음</em>`;
    return `<em class="dl ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${pctTxt(Math.abs(d))}</em>`;
  };

  function analyticsData() {
    const { from, to, pFrom, pTo, orders, cur, prev, products, members, oldPhones } = an;
    const inR = (d, a, b) => d >= a && d <= b;
    const paidIn = (a, b) => orders.filter(r => PAID.includes(r.status) && inR(paidDay(r), a, b));
    const madeIn = (a, b) => orders.filter(r => inR(ymd(r.created_at), a, b));
    const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
    const vis = c => Object.values(c.visits || {}).reduce((s, v) => s + Number(v), 0);
    const P = paidIn(from, to), PP = paidIn(pFrom, pTo), M = madeIn(from, to), MP = madeIn(pFrom, pTo);
    const k = {
      rev: sum(P, r => r.final_price), revP: sum(PP, r => r.final_price),
      n: P.length, nP: PP.length, made: M.length, madeP: MP.length,
      cancel: M.filter(r => r.status === "canceled").length,
      visits: vis(cur), visitsP: vis(prev),
      mem: members.filter(m => inR(ymd(m.created_at), from, to)).length, memP: members.filter(m => inR(ymd(m.created_at), pFrom, pTo)).length,
    };
    k.aov = k.n ? k.rev / k.n : 0; k.aovP = k.nP ? k.revP / k.nP : 0;
    k.cv = pct(k.n, k.visits); k.cvP = pct(k.nP, k.visitsP);
    const buyers = new Set(P.map(r => r.phone));
    const cnt = {}; P.forEach(r => { cnt[r.phone] = (cnt[r.phone] || 0) + 1; });
    k.buyers = buyers.size;
    k.repeat = [...buyers].filter(ph => oldPhones.has(ph) || cnt[ph] > 1).length;

    // 상품별: 조회·검색(기록) + 판매(입금 주문)
    const byId = Object.fromEntries(products.map(p => [p.id, p]));
    const byName = Object.fromEntries(products.map(p => [p.name, p]));
    const rows = {};
    const row = id => (rows[id] = rows[id] || { id, v: 0, s: 0, qty: 0, amt: 0, n: 0 });
    Object.entries(cur.products || {}).forEach(([id, x]) => { const r = row(id); r.v = Number(x.v) || 0; r.s = Number(x.s) || 0; });
    P.forEach(o => {
      const seen = new Set();
      linesOf(o).forEach(l => {
        const p = byId[l.id] || byName[l.name] || byName[String(l.name || "").replace(/^GBK 카드형 골드바 1g \((.*)\)$/, "$1")];
        const id = p ? p.id : "name:" + l.name;
        const r = row(id); r.name = r.name || l.name;
        r.qty += l.qty; r.amt += l.amount;
        if (!seen.has(id)) { r.n++; seen.add(id); }
      });
    });
    const prow = Object.values(rows).map(r => {
      const p = byId[r.id];
      return { ...r, p, name: p ? (p.kind === "zodiac" ? `카드형 1g · ${p.name}` : p.name) : r.name, cv: r.v ? r.n / r.v * 100 : null };
    });

    // 묶음 (일별·월별)
    const keys = [];
    for (let d = from; d <= to; d = addDays(d, 1)) { const key = anUnit === "month" ? d.slice(0, 7) : d; if (keys[keys.length - 1] !== key) keys.push(key); }
    const bk = d => anUnit === "month" ? d.slice(0, 7) : d;
    const B = Object.fromEntries(keys.map(x => [x, { rev: 0, n: 0, made: 0, visits: 0 }]));
    P.forEach(r => { const b = B[bk(paidDay(r))]; if (b) { b.rev += Number(r.final_price) || 0; b.n++; } });
    M.forEach(r => { const b = B[bk(ymd(r.created_at))]; if (b) b.made++; });
    Object.entries(cur.visits || {}).forEach(([d, v]) => { const b = B[bk(d)]; if (b) b.visits += Number(v); });
    return { k, P, M, prow, keys, B };
  }

  function catOf(p) {
    if (!p) return "기타";
    if (p.kind === "accessory") return (p.karat === "SV" ? "실버 주얼리" : "24K 주얼리") + (p.category && CATEGORY[p.category] ? " · " + CATEGORY[p.category] : "");
    if (p.kind === "gift") return "순금선물" + (p.category && CATEGORY[p.category] ? " · " + CATEGORY[p.category] : "");
    return { bar: "골드바", zodiac: "카드형 골드바 1g", silver: "실버바" }[p.kind] || "기타";
  }

  function renderAnalytics() {
    if (!an) return;
    const { k, P, M, prow, keys, B } = analyticsData();
    $$("#anUnit button").forEach(b => b.classList.toggle("is-on", b.dataset.unit === anUnit));
    $("#anKpis").innerHTML = `
      <div class="kpi kpi--gold"><p>매출 (입금 확인)</p><strong>${won(k.rev)}</strong><small>${delta(k.rev, k.revP)} 지난 기간 ${won(k.revP)}</small></div>
      <div class="kpi"><p>결제 건수</p><strong>${k.n}건</strong><small>${delta(k.n, k.nP)} 주문 신청 ${k.made}건 · 자동취소 등 ${k.cancel}건</small></div>
      <div class="kpi"><p>객단가</p><strong>${won(Math.round(k.aov))}</strong><small>${delta(k.aov, k.aovP)} 결제 1건 평균</small></div>
      <div class="kpi"><p>방문자</p><strong>${k.visits.toLocaleString()}명</strong><small>${delta(k.visits, k.visitsP)} 하루 1번씩 셈</small></div>
      <div class="kpi"><p>구매 전환율</p><strong>${pctTxt(k.cv)}</strong><small>${delta(k.cv, k.cvP)} 방문자 중 결제 비율</small></div>
      <div class="kpi"><p>구매 고객 · 신규 회원</p><strong>${k.buyers}명 · ${k.mem}명</strong><small>재구매 고객 ${k.repeat}명 ${delta(k.mem, k.memP)}</small></div>`;

    const lab = x => anUnit === "month" ? x.replace("-", ".") : x.slice(5).replace("-", ".");
    vchart($("#anRevChart"), keys, keys.map(x => B[x].rev), won, lab);
    vchart($("#anVisitChart"), keys, keys.map(x => B[x].visits), v => v.toLocaleString() + "명", lab);
    $("#anRevSum").textContent = `합계 ${won(k.rev)}`;
    $("#anVisitSum").textContent = `합계 ${k.visits.toLocaleString()}명`;

    // 상품 성과
    const sortBy = $("#anSort").value;
    const list = prow.filter(r => r.v || r.s || r.qty).sort((a, b) => sortBy === "cv" ? ((b.cv ?? -1) - (a.cv ?? -1)) || b.v - a.v : (b[sortBy] - a[sortBy]) || (b.amt - a.amt) || (b.v - a.v));
    an.list = list;
    $("#anProducts").innerHTML = `<thead><tr><th>상품</th><th>종류</th><th>조회</th><th>검색으로 찾음</th><th>판매 수량</th><th>매출</th><th>구매 전환율 <small>(결제 주문 ÷ 조회)</small></th></tr></thead><tbody>` +
      (list.length ? list.slice(0, 150).map(r => `<tr><td class="ellipsis"><b>${esc(r.name)}</b>${r.p && !r.p.visible ? ' <span class="muted">숨김</span>' : ""}</td><td class="muted">${esc(catOf(r.p))}</td><td>${r.v}</td><td>${r.s}</td><td>${r.qty ? `<b>${r.qty}개</b>` : "-"}</td><td>${r.amt ? won(r.amt) : "-"}</td><td>${r.cv == null ? "-" : pctTxt(r.cv)}</td></tr>`).join("")
        : `<tr><td class="empty" colspan="7">이 기간 상품 기록이 없어요</td></tr>`) + "</tbody>";

    // 종류별 매출
    const cats = {};
    prow.forEach(r => { if (r.amt) { const c = catOf(r.p); cats[c] = (cats[c] || 0) + r.amt; } });
    const revSum = Object.values(cats).reduce((s, v) => s + v, 0);
    hbars($("#anCats"), Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, v, pctTxt(pct(v, revSum))]), won);

    // 유입 경로 · 기기
    const src = an.cur.sources || {}, srcSum = Object.values(src).reduce((s, v) => s + Number(v), 0);
    hbars($("#anSources"), Object.entries(src).map(([s, v]) => [SRC_KO[s] || s, Number(v), pctTxt(pct(v, srcSum))]).sort((a, b) => b[1] - a[1]), v => v.toLocaleString() + "명");
    const dv = an.cur.devices || {}, dvSum = (Number(dv.mobile) || 0) + (Number(dv.pc) || 0);
    $("#anDevices").textContent = dvSum ? `기기: 휴대폰 ${pctTxt(pct(dv.mobile || 0, dvSum))} · 컴퓨터 ${pctTxt(pct(dv.pc || 0, dvSum))}` : "";

    // 검색어
    const terms = an.cur.terms || [];
    $("#anTerms").innerHTML = terms.length ? terms.slice(0, 20).map(t => `<li><span>${esc(t.t)}</span><b>${t.n}회</b></li>`).join("") : `<p class="muted">이 기간 검색 기록이 없어요</p>`;
    const zero = terms.filter(t => t.z > 0).sort((a, b) => b.z - a.z);
    $("#anZero").innerHTML = zero.length ? zero.slice(0, 20).map(t => `<li><span>${esc(t.t)}</span><b>${t.z}회</b></li>`).join("") : `<p class="muted">결과가 없던 검색어가 없어요</p>`;

    // 요일 · 시간대
    const wk = Array(7).fill(0); P.forEach(r => { wk[new Date(r.paid_at || r.created_at).getDay()]++; });
    vchart($("#anWeek"), WEEK, wk, v => v + "건", x => x);
    const hr = Array(24).fill(0); M.forEach(r => { hr[new Date(r.created_at).getHours()]++; });
    vchart($("#anHour"), [...Array(24).keys()], hr, v => v + "건", x => x + "시");

    // 기간별 표
    $("#anTable").innerHTML = `<thead><tr><th>${anUnit === "month" ? "월" : "날짜"}</th><th>방문자</th><th>주문 신청</th><th>입금 주문</th><th>매출</th><th>객단가</th><th>구매 전환율</th></tr></thead><tbody>` +
      [...keys].reverse().map(x => { const b = B[x]; return `<tr><td>${anUnit === "month" ? x.replace("-", ".") : x.slice(5).replace("-", ".") + ` (${WEEK[new Date(x + "T00:00:00").getDay()]})`}</td><td>${b.visits || "-"}</td><td>${b.made || "-"}</td><td>${b.n || "-"}</td><td>${b.rev ? `<b>${won(b.rev)}</b>` : "-"}</td><td>${b.n ? won(Math.round(b.rev / b.n)) : "-"}</td><td>${b.visits ? pctTxt(pct(b.n, b.visits)) : "-"}</td></tr>`; }).join("") + "</tbody>";

    // 이번 기간 체크 포인트
    const tips = [];
    const top = [...prow].filter(r => r.qty).sort((a, b) => b.amt - a.amt)[0];
    if (top) tips.push(`<b>가장 많이 팔린 상품</b> ${esc(top.name)} — ${top.qty}개 · ${won(top.amt)}`);
    const cold = prow.filter(r => r.v >= 5 && !r.qty).sort((a, b) => b.v - a.v).slice(0, 3);
    if (cold.length) tips.push(`<b>보기만 하고 안 사는 상품</b> ${cold.map(r => `${esc(r.name)} (조회 ${r.v})`).join(", ")} — 가격·사진·설명을 점검해 보세요`);
    if (zero.length) tips.push(`<b>찾는데 없는 상품</b> ‘${zero.slice(0, 3).map(t => esc(t.t)).join("’, ‘")}’ — 이런 상품을 찾는 손님이 있어요`);
    if (k.made >= 3 && k.cancel / k.made >= 0.3) tips.push(`<b>입금 전 취소가 많아요</b> 주문 신청 ${k.made}건 중 ${k.cancel}건 취소 — 입금 기한이나 안내 문자를 점검해 보세요`);
    if (k.buyers) tips.push(`<b>구매 고객 ${k.buyers}명</b> 중 재구매 ${k.repeat}명 (${pctTxt(pct(k.repeat, k.buyers))})`);
    const topSrc = Object.entries(src).sort((a, b) => b[1] - a[1])[0];
    if (topSrc) tips.push(`<b>가장 많이 들어온 곳</b> ${SRC_KO[topSrc[0]] || topSrc[0]} (${pctTxt(pct(topSrc[1], srcSum))})`);
    $("#anTips").innerHTML = `<h2>이번 기간 체크 포인트</h2>` + (tips.length ? `<ul>${tips.map(t => `<li>${t}</li>`).join("")}</ul>` : `<p class="muted">아직 쌓인 기록이 적어요. 손님이 들어오고 주문이 생기면 여기에 할 일이 보여요.</p>`);
  }

  $("#anForm").addEventListener("submit", e => { e.preventDefault(); loadAnalytics(); });
  $("#anForm").addEventListener("click", e => {
    const b = e.target.closest("[data-arange]");
    if (b) { setARange(b.dataset.arange); loadAnalytics(); return; }
    const u = e.target.closest("[data-unit]");
    if (u) { anUnit = u.dataset.unit; renderAnalytics(); }
  });
  $("#anSort").addEventListener("change", renderAnalytics);
  $("#anCsv").addEventListener("click", () => {
    if (!an || !an.list) return toast("먼저 조회해 주세요", true);
    const head = ["상품", "종류", "조회", "검색으로 찾음", "판매 수량", "매출", "결제 주문 수", "구매 전환율(%)"];
    const rows = an.list.map(r => [r.name, catOf(r.p), r.v, r.s, r.qty, r.amt, r.n, r.cv == null ? "" : Math.round(r.cv * 10) / 10]);
    downloadCsv(`금비_상품성과_${an.from}_${an.to}.csv`, head, rows);
  });

  $("#salesForm").addEventListener("submit", e => { e.preventDefault(); loadSales(); });
  $("#salesForm").addEventListener("click", e => {
    const b = e.target.closest("[data-range]");
    if (b) { setRange(b.dataset.range); loadSales(); }
  });
  document.addEventListener("click", e => { if (e.target.closest("[data-rctab]")) reqTab.orders = "receipt"; }, true);

  $("#salesCsv").addEventListener("click", () => {
    const { orders, from, to } = sales;
    if (!orders.length) return toast("내려받을 주문이 없어요", true);
    const head = ["입금확인일시", "주문일시", "접수번호", "고객명", "연락처", "상품", "수량", "상품금액", "택배비", "결제금액", "수령방법", "상태",
      "영수증종류", "발행번호", "상호", "대표자", "이메일", "발행여부", "발행일시", "승인번호", "택배사", "송장번호", "발송일시", "배송주소"];
    const rows = orders.map(r => {
      const rc = r.receipt || {};
      return [fmtDate(r.paid_at || r.created_at), fmtDate(r.created_at), r.code, r.name, fmtPhone(r.phone),
        orderLines(r).map(l => `${l.name} x${l.qty}`).join(" / "), r.qty, (Number(r.final_price) || 0) - (Number(r.shipping_fee) || 0), Number(r.shipping_fee) || 0, Number(r.final_price) || 0,
        RECEIVE[r.receive], ORDER_STATUS[r.status], RECEIPT[rcType(r)], rc.no ? (rc.type === "personal" ? fmtPhone(rc.no) : fmtBiz(rc.no)) : "",
        rc.company, rc.ceo, rc.email, r.receipt_issued_at ? "발행" : needsReceipt(r) ? "미발행" : "-", r.receipt_issued_at ? fmtDate(r.receipt_issued_at) : "", r.receipt_ref,
        r.courier, r.tracking_no, r.shipped_at ? fmtDate(r.shipped_at) : "", r.address];
    });
    downloadCsv(`금비_매출_${from}_${to}.csv`, head, rows);
    toast(`주문 ${rows.length}건 내려받기 완료`);
  });
  $("#sellCsv").addEventListener("click", () => {
    const { sells, from, to } = sales;
    if (!sells.length) return toast("내려받을 매입 지급 건이 없어요", true);
    const head = ["지급완료 처리일시", "접수일시", "접수번호", "고객명", "연락처", "품목", "함량", "신고중량(g)", "매입가", "접수방법", "관리메모"];
    const rows = sells.map(r => [fmtDate(r.updated_at), fmtDate(r.created_at), r.code, r.name, fmtPhone(r.phone), r.items, KARAT[r.karat], r.weight_g, Number(r.final_amount) || 0, RECEIVE[r.method], r.admin_memo]);
    downloadCsv(`금비_매입_${from}_${to}.csv`, head, rows);
    toast(`매입 ${rows.length}건 내려받기 완료`);
  });

  /* ---------- 상품 관리 ---------- */
  let products = [], productTab = "bar", productSub = "all";
  let picked = new Set(), shownProducts = []; // 가격 일괄 변경용 체크
  let productW = "all", productSort = "sort";
  // 돈 수 구간 [이상, 미만, 이름] (1돈 = 3.75g)
  const DON_RANGE = { all: [0, Infinity, "전체"], u1: [0, 1, "1돈 미만"], d1: [1, 3, "1~3돈"], d3: [3, 5, "3~5돈"], d5: [5, 10, "5~10돈"], d10: [10, Infinity, "10돈 이상"] };
  const donTxt = w => { const d = Number(w) / 3.75; return (Math.round(d * 100) / 100).toLocaleString("ko-KR") + "돈"; };
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-pw]");
    if (b) { productW = b.dataset.pw; renderProducts(); }
  });
  document.addEventListener("change", e => {
    if (e.target.id === "productSort") { productSort = e.target.value; renderProducts(); }
  });
  // 관리 화면 묶음: 악세사리는 24K(순금)와 실버(실버바와 함께)로 나눠 보여줌
  const PGROUP = { bar: "골드바", zodiac: "카드형 1g", gold24: "24K", silver: "실버", gift: "순금선물" };
  const PSUB = { gold24: ["necklace", "ring", "bracelet", "earring"], gift: ["goods", "dol", "key", "memo"] };
  const groupOf = p => p.kind === "accessory" ? (p.karat === "SV" ? "silver" : "gold24") : p.kind;
  const kindLabel = p => p.kind === "accessory" ? (p.karat === "SV" ? "실버 주얼리" : "24K") : KIND[p.kind];
  async function loadProducts() {
    const { data, error } = await sb.from("products").select("*").order("kind").order("sort").order("created_at");
    if (error) return fail(error);
    products = data;
    const st = await window.YAMOO.loadStats();
    products.forEach(p => { const s = st[p.id] || {}; p._views = s.views || 0; p._searches = s.searches || 0; p._sold = s.sold || 0; });
    let d = null;
    try { d = await domestic(); } catch { d = null; }
    products.forEach(p => { p._price = d ? productPrice(p, d) : null; });
    renderProducts();
  }
  function renderProducts() {
    const tabs = [...Object.entries(PGROUP), ["all", "전체"]];
    const inTab = productTab === "all" ? products : products.filter(p => groupOf(p) === productTab);
    const subs = PSUB[productTab] || [];
    $("#productTabs").innerHTML = tabs.map(([k, v]) => `<button data-tab="products:${k}" class="${productTab === k ? "is-on" : ""}">${v} <span>${k === "all" ? products.length : products.filter(p => groupOf(p) === k).length}</span></button>`).join("")
      + (subs.length ? `<span class="ptabs-sep" aria-hidden="true">›</span>` + [["all", "전체"], ...subs.map(c => [c, CATEGORY[c]])].map(([k, v]) =>
        `<button data-tab="psub:${k}" class="sub${productSub === k ? " is-on" : ""}">${v} <span>${k === "all" ? inTab.length : inTab.filter(p => p.category === k).length}</span></button>`).join("") : "");
    const inSub = productSub === "all" || !subs.length ? inTab : inTab.filter(p => p.category === productSub);
    // 돈 수 필터 · 정렬
    const wr = DON_RANGE[productW] || DON_RANGE.all;
    const list = inSub.filter(p => { const d = Number(p.weight_g) / 3.75; return d >= wr[0] && d < wr[1]; });
    const SORTS = { w_asc: (a, b) => a.weight_g - b.weight_g, w_desc: (a, b) => b.weight_g - a.weight_g, p_asc: (a, b) => (a._price || 0) - (b._price || 0), p_desc: (a, b) => (b._price || 0) - (a._price || 0), pop: (a, b) => (b._sold * 30 + b._searches * 3 + b._views) - (a._sold * 30 + a._searches * 3 + a._views) };
    if (SORTS[productSort]) list.sort((a, b) => SORTS[productSort](a, b) || a.sort - b.sort);
    $("#productTools").innerHTML = `<span class="ptools__label">중량</span>${Object.entries(DON_RANGE).map(([k, r]) => `<button type="button" data-pw="${k}" class="${productW === k ? "is-on" : ""}">${r[2]} <span>${inSub.filter(p => { const d = Number(p.weight_g) / 3.75; return d >= r[0] && d < r[1]; }).length}</span></button>`).join("")}
      <select id="productSort" aria-label="정렬">${Object.entries({ sort: "기본 순서", w_asc: "돈 수 적은 순", w_desc: "돈 수 많은 순", p_asc: "판매가 낮은 순", p_desc: "판매가 높은 순", pop: "인기순" }).map(([k, v]) => `<option value="${k}"${productSort === k ? " selected" : ""}>${v}</option>`).join("")}</select>`;
    shownProducts = list;
    [...picked].forEach(id => { if (!list.some(p => p.id === id)) picked.delete(id); });
    const allOn = list.length && list.every(p => picked.has(p.id));
    const head = `<thead><tr><th class="pick"><input type="checkbox" data-pickall ${allOn ? "checked" : ""} aria-label="모두 선택"></th><th></th><th>상품명</th><th>종류</th><th>중량 · 함량</th><th>가격 조정</th><th>현재 판매가</th><th>조회 · 검색 · 판매</th><th>노출</th><th>품절</th><th>순서</th></tr></thead>`;
    $("#productTable").innerHTML = head + "<tbody>" + (list.length ? list.map(p => `
      <tr class="clickable${p.visible ? "" : " is-dim"}" data-product="${p.id}">
        <td class="pick"><input type="checkbox" data-pick="${p.id}" ${picked.has(p.id) ? "checked" : ""} aria-label="선택"></td>
        <td><img class="thumb" src="${esc(imgUrl(p.img))}" alt=""></td>
        <td><b>${esc(p.name)}</b>${p.tag ? ` <span class="pill g-gold">${esc(p.tag)}</span>` : ""}${p.opt_group ? `<br><span class="muted">옵션 묶음 '${esc(p.opt_group)}' · ${esc(optLabel(p))}</span>` : ""}</td>
        <td>${kindLabel(p)}${p.category ? " · " + CATEGORY[p.category] : ""}</td>
        <td>${Number(p.weight_g)}g <span class="muted">(${donTxt(p.weight_g)})</span> · ${p.kind === "silver" ? "은 999.9" : KARAT_KO[p.karat] || p.karat}</td>
        <td>${adjLabel(p)}</td>
        <td>${p._price ? won(p._price) : "-"}</td>
        <td class="muted">${p._views} · ${p._searches} · <b>${p._sold}</b></td>
        <td><button class="switch ${p.visible ? "is-on" : ""}" data-toggle="${p.id}:visible" aria-label="노출">${p.visible ? "노출" : "숨김"}</button></td>
        <td><button class="switch switch--warn ${p.sold_out ? "is-on" : ""}" data-toggle="${p.id}:sold_out" aria-label="품절">${p.sold_out ? "품절" : "판매중"}</button></td>
        <td>${p.sort}</td>
      </tr>`).join("") : `<tr><td class="empty" colspan="11">상품이 없습니다</td></tr>`) + "</tbody>";
    $("#bulkPrice").textContent = picked.size ? `가격 일괄 변경 (${picked.size}개 선택)` : "가격 일괄 변경";
    $("#bulkDelete").hidden = !picked.size;
    $("#bulkDelete").textContent = `선택 삭제 (${picked.size}개)`;
  }

  // 체크한 상품 삭제 (주문 기록은 상품명·금액이 따로 저장돼 그대로 남음)
  $("#bulkDelete").addEventListener("click", async () => {
    const targets = shownProducts.filter(p => picked.has(p.id));
    if (!targets.length) return;
    const names = targets.slice(0, 8).map(p => "· " + p.name).join("\n") + (targets.length > 8 ? `\n… 외 ${targets.length - 8}개` : "");
    if (!confirm(`${targets.length}개 상품을 삭제할까요? 되돌릴 수 없어요.\n(잠시 내리기만 하려면 '노출'을 '숨김'으로 바꾸세요)\n\n${names}`)) return;
    try {
      must(await sb.from("products").delete().in("id", targets.map(p => p.id)));
      targets.forEach(p => picked.delete(p.id));
      toast(`${targets.length}개 삭제했습니다`); loaders.products();
    } catch (err) { fail(err); }
  });

  // 상품 편집의 공임 입력 방식 (1돈당 / 총 공임) — 이 브라우저에 기억
  const laborMode = () => { try { return localStorage.getItem("keumbi_labor_mode") === "total" ? "total" : "don"; } catch { return "don"; } };
  // 가격 조정 표시: 시세 대비 % · 1돈(3.75g)당 공임
  const perDonOf = p => Number(p.weight_g) > 0 ? Number(p.labor || 0) / Number(p.weight_g) * 3.75 : 0;
  function adjLabel(p) {
    const a = [];
    if (Number(p.premium_pct)) a.push("+" + Number(p.premium_pct) + "%");
    if (Number(p.labor)) a.push(Number(p.weight_g) < 3.75 ? "공임 " + won(Number(p.labor)) : "돈당 " + won(Math.round(perDonOf(p) / 100) * 100));
    return a.join(" · ") || "-";
  }

  // 가격 일괄 변경: 체크한 상품(없으면 지금 보이는 목록 전체)에 같은 기준 적용
  document.addEventListener("change", e => {
    const one = e.target.closest("[data-pick]");
    if (one) { one.checked ? picked.add(one.dataset.pick) : picked.delete(one.dataset.pick); return renderProducts(); }
    if (e.target.closest("[data-pickall]")) {
      shownProducts.forEach(p => e.target.checked ? picked.add(p.id) : picked.delete(p.id));
      renderProducts();
    }
  });
  $("#bulkPrice").addEventListener("click", async () => {
    const targets = picked.size ? shownProducts.filter(p => picked.has(p.id)) : shownProducts;
    if (!targets.length) return toast("바꿀 상품이 없어요", true);
    const allSilver = targets.every(p => p.karat === "SV" || p.kind === "silver");
    const tabName = productTab === "all" ? "전체" : PGROUP[productTab] + (productSub !== "all" && CATEGORY[productSub] ? " › " + CATEGORY[productSub] : "");
    let d = null;
    try { d = await domestic(); } catch { d = null; }
    const html = `
      <p>대상 <b>${targets.length}개</b> <span class="muted">· ${picked.size ? "체크한 상품" : `지금 보고 있는 목록 전체 (${esc(tabName)})`}</span></p>
      <fieldset class="box">
        <legend>기준</legend>
        <label class="inline"><input type="radio" name="mode" value="don" checked> <span><b>돈당 공임</b> — 1돈(3.75g)마다 정한 금액을 더해요</span></label>
        <label class="inline"><input type="radio" name="mode" value="pct"> <span><b>%</b> — 금·은 시세 금액에 정한 비율을 더해요</span></label>
      </fieldset>
      <label data-m="don">1돈당 공임 (원) <small>참고: 순금 50,000 · 실버 25,000</small><input type="number" name="don" min="0" step="1000" value="${allSilver ? 25000 : 50000}"></label>
      <div class="row2" data-m="don">
        <label class="inline"><input type="checkbox" name="minOn" ${allSilver ? "" : "checked"}> <span>1돈(3.75g) 미만 상품은 공임 고정</span></label>
        <label>고정 공임 (원)<input type="number" name="minFlat" min="0" step="1000" value="35000"></label>
      </div>
      <label data-m="pct" hidden>시세 대비 더하기 (%) <small>예) 10 → 시세 금액의 10%를 더함 · 빼려면 −</small><input type="number" name="pct" step="0.1" value="10"></label>
      <p class="muted">고른 기준으로 바꾸면 다른 쪽 값은 0이 돼요. 공임·% 금액은 손님 화면에 보이지 않아요.</p>
      <div class="bulk-prev" id="bulkPrev"></div>`;
    const calc = (p, f) => f.mode.value === "pct"
      ? { premium_pct: Number(f.pct.value) || 0, labor: 0 }
      : { premium_pct: 0, labor: f.minOn.checked && Number(p.weight_g) < 3.75 ? Number(f.minFlat.value) || 0
          : Math.round((Number(f.don.value) || 0) * Number(p.weight_g) / 3.75 / 100) * 100 };
    openEdit("가격 일괄 변경", html, {
      after: f => {
        const sync = () => {
          if (!f.mode || !$("#bulkPrev")) return; // 다른 편집 창이 열려 있으면 무시
          f.querySelectorAll("[data-m]").forEach(el => { el.hidden = el.dataset.m !== f.mode.value; });
          $("#bulkPrev").innerHTML = `<table class="table table--mini"><thead><tr><th>상품</th><th>지금</th><th>바뀐 뒤</th></tr></thead><tbody>${targets.map(p => {
            const after = d ? productPrice({ ...p, ...calc(p, f) }, d) : null;
            const diff = after != null && p._price ? after - p._price : 0;
            return `<tr><td>${esc(p.name)} <span class="muted">${Number(p.weight_g)}g</span></td><td>${p._price ? won(p._price) : "-"}</td><td><b>${after != null ? won(after) : "-"}</b>${diff ? ` <small class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "+" : "−"}${won(Math.abs(diff))}</small>` : ""}</td></tr>`;
          }).join("")}</tbody></table>`;
        };
        f.addEventListener("input", sync);
        f.addEventListener("change", sync);
        sync();
      },
      save: async f => {
        if (!confirm(`${targets.length}개 상품의 가격 기준을 바꿀까요? 홈페이지에 바로 반영돼요.`)) return false;
        for (let i = 0; i < targets.length; i += 8) {
          await Promise.all(targets.slice(i, i + 8).map(async p => must(await sb.from("products").update(calc(p, f)).eq("id", p.id))));
        }
        picked.clear();
        toast(`${targets.length}개 상품 가격을 바꿨어요`);
      },
    });
  });

  // tpl: '옵션 추가'로 기존 상품을 복사해 새 옵션을 만들 때 ({ from: 원래 상품 })
  function openProduct(p, tpl) {
    const isNew = !p || !!tpl;
    const src = tpl && tpl.from;
    if (src) p = { ...src, id: undefined, weight_g: "", opt_label: "", name: "", opt_group: src.opt_group || src.name.replace(/\s*[\d.]+\s*(g|돈)\s*$/i, "").trim(), tag: "", sold_out: false, sort: (src.sort || 0) + 1 };
    const newKind = { all: "bar", gold24: "accessory" }[productTab] || productTab;
    p = p || { kind: newKind, name: "", weight_g: "", karat: "24K", category: PSUB[productTab] && productSub !== "all" ? productSub : null, premium_pct: 0, labor: 0, img: "", tag: "", sort: (products.length + 1) * 10, visible: true, sold_out: false };
    const html = `
      <div class="pimg"><img id="pimgPreview" src="${esc(imgUrl(p.img))}" alt=""></div>
      <div class="row2">
        <label>종류<select name="kind">${opts(KIND, p.kind)}</select></label>
        <label data-for="accessory gift">분류<select name="category"><option value="">-</option>${opts(CATEGORY, p.category)}</select></label>
      </div>
      <label>상품명<input name="name" maxlength="80" required value="${esc(p.name)}" placeholder="예) GBK 순금 골드바 5g"></label>
      <div class="row2">
        <label>중량 (g)<input type="number" name="weight_g" min="0.001" step="0.001" required value="${p.weight_g}"></label>
        <label data-for="bar zodiac accessory gift">함량<select name="karat">${opts(KARAT_KO, p.karat)}</select></label>
      </div>
      <div class="row2">
        <label>시세 대비 더하기 (%) <small>금·은 시세 금액에 더할 비율</small><input type="number" name="premium_pct" step="any" value="${p.premium_pct}"></label>
        <label>공임 (원) <small id="laborDon">손님 화면엔 안 보여요</small>
          <span class="labor-in"><select name="labor_mode" aria-label="공임 입력 방식"><option value="don"${laborMode() === "don" ? " selected" : ""}>1돈당</option><option value="total"${laborMode() === "total" ? " selected" : ""}>총 공임</option></select><input type="number" name="labor_in" min="0" step="100" value="${laborMode() === "don" ? perDonOf(p) ? Math.round(perDonOf(p) / 100) * 100 : 0 : Number(p.labor) || 0}" aria-label="공임 금액"></span>
          <input type="hidden" name="labor" value="${Number(p.labor) || 0}"></label>
      </div>
      <label>예상 판매가<output id="pricePreview" class="price-out">-</output></label>
      <label>이미지 <small>목록에서 고르거나 이미지 주소(https://…) 입력</small><input name="img" list="imgList" value="${esc(p.img || "")}"><datalist id="imgList">${IMAGES.map(i => `<option value="${i}">`).join("")}</datalist></label>
      <label>추가 사진 <small>한 줄에 하나 · 이미지 주소(https://…) 또는 images/ 아래 경로 · 지금은 메인 '순금 콩알금' 코너에서 사진 넘겨보기로 보여요</small><textarea name="photos" rows="3" placeholder="예) store/bean-2.jpg&#10;https://…/bean-3.jpg">${esc(p.photos || "")}</textarea></label>
      <div class="row2">
        <label>표시 태그 <small>예) BEST, NEW</small><input name="tag" maxlength="12" value="${esc(p.tag || "")}"></label>
        <label>순서 <small>작을수록 앞</small><input type="number" name="sort" step="1" value="${p.sort}"></label>
      </div>
      <fieldset class="box">
        <legend>옵션 (1g · 1돈 · 2돈 …)</legend>
        <p class="muted">묶음 이름이 같은 상품들은 홈페이지에서 카드 하나로 보이고, 손님이 옵션 버튼으로 골라요. 옵션마다 중량·공임·품절을 따로 정할 수 있어요.</p>
        <div class="row2">
          <label>묶음 이름 <small>예) 순금 콩알금 · 비우면 옵션 없음</small><input name="opt_group" maxlength="60" list="optGroups" value="${esc(p.opt_group || "")}"><datalist id="optGroups">${[...new Set(products.map(x => x.opt_group).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join("")}</datalist></label>
          <label>옵션 이름 <small id="optAuto">비우면 중량으로 자동</small><input name="opt_label" maxlength="20" value="${esc(p.opt_label || "")}"></label>
        </div>
        ${isNew ? "" : `<button type="button" class="btn btn--line" id="addOption">+ 이 상품으로 옵션 추가 (다른 중량)</button>`}
        ${(() => {
          const mem = p.opt_group ? products.filter(x => x.opt_group === p.opt_group).sort((a, b) => a.weight_g - b.weight_g) : [];
          if (src && !mem.length) return `<p class="muted">저장하면 '${esc(src.name)}'도 같은 묶음으로 들어가요.</p>`;
          return mem.length ? `<p class="muted">이 묶음의 옵션: ${mem.map(x => esc(optLabel(x)) + (x.sold_out ? "(품절)" : "")).join(" · ")}</p>` : "";
        })()}
      </fieldset>
      <label class="inline"><input type="checkbox" name="visible" ${p.visible ? "checked" : ""}> 홈페이지에 노출</label>
      <label class="inline"><input type="checkbox" name="sold_out" ${p.sold_out ? "checked" : ""}> 품절 (구매 버튼 막기)</label>
      <fieldset class="box pinfo-edit">
        <legend>상품정보 제공고시</legend>
        <p class="muted">비워 두면 흐린 글씨(기본값)가 손님에게 보여요. 보증서·품질보증기준·A/S는 모든 상품 공통이에요.</p>
        ${Object.entries(INFO_FIELDS).map(([k, label]) => k === "caution"
          ? `<label>${label}<textarea name="info_${k}" rows="2" maxlength="300">${esc((p.info || {})[k] || "")}</textarea></label>`
          : `<label>${label}<input name="info_${k}" maxlength="120" value="${esc((p.info || {})[k] || "")}"></label>`).join("")}
      </fieldset>`;
    openEdit(isNew ? "상품 추가" : "상품 수정", html, {
      after: f => {
        const sync = async ev => {
          if (!f.kind || !$("#pimgPreview")) return; // 다른 편집 창이 열려 있으면 무시
          const k = f.kind.value;
          f.querySelectorAll("[data-for]").forEach(el => { el.hidden = !el.dataset.for.split(" ").includes(k); });
          [...f.category.options].forEach(o => { o.hidden = !!o.value && !(CAT_OF[k] || []).includes(o.value); });
          if (f.category.value && !(CAT_OF[k] || []).includes(f.category.value)) f.category.value = "";
          $("#pimgPreview").src = imgUrl(f.img.value.trim());
          const dflt = infoDefaults({ kind: k, weight_g: Number(f.weight_g.value) || 0, karat: f.karat.value });
          Object.keys(INFO_FIELDS).forEach(key => { f["info_" + key].placeholder = dflt[key]; });
          const auto = optLabel({ weight_g: Number(f.weight_g.value) || 0 });
          $("#optAuto").textContent = Number(f.weight_g.value) > 0 ? `비우면 '${auto}'` : "비우면 중량으로 자동";
          // 옵션 추가: 상품명을 '묶음 이름 + 옵션'으로 자동 (직접 고치면 그대로 둠)
          if (src && !f.name.dataset.touched && f.opt_group.value.trim()) f.name.value = `${f.opt_group.value.trim()} ${f.opt_label.value.trim() || (Number(f.weight_g.value) > 0 ? auto : "")}`.trim();
          // 공임: '1돈당' 또는 '총 공임'으로 입력 → 저장은 항상 총 공임(원)
          const lw = Number(f.weight_g.value), mode = f.labor_mode.value;
          if (mode !== f.labor_mode.dataset.prev) {
            // 방식을 바꾸면 같은 공임이 되도록 숫자만 바꿔 줌
            const cur = Number(f.labor.value) || 0;
            f.labor_in.value = mode === "don" ? (lw > 0 ? Math.round(cur / lw * 3.75 / 100) * 100 : 0) : cur;
            f.labor_mode.dataset.prev = mode;
            try { localStorage.setItem("keumbi_labor_mode", mode); } catch { /* 무시 */ }
          }
          const lin = Number(f.labor_in.value) || 0;
          // 처음 열 때는 저장된 공임 그대로 (반올림으로 몇백 원 바뀌지 않게)
          if (ev) f.labor.value = mode === "don" ? (lw > 0 ? Math.round(lin * lw / 3.75 / 100) * 100 : 0) : lin;
          const lb = Number(f.labor.value);
          $("#laborDon").textContent = !(lw > 0) || !lb ? "손님 화면엔 안 보여요"
            : mode === "don" ? `= 총 공임 ${won(lb)} (${Math.round(lw / 3.75 * 100) / 100}돈) · 손님 화면엔 안 보여요`
            : `= 1돈당 ${won(Math.round(lb / lw * 3.75 / 100) * 100)} · 손님 화면엔 안 보여요`;
          try {
            const d = await domestic();
            const w = Number(f.weight_g.value);
            $("#pricePreview").textContent = w > 0 ? won(productPrice({ kind: k, weight_g: w, karat: f.karat.value, premium_pct: f.premium_pct.value, labor: f.labor.value }, d)) : "-";
          } catch { $("#pricePreview").textContent = "시세 확인 불가"; }
        };
        f.labor_mode.dataset.prev = f.labor_mode.value;
        f.addEventListener("input", sync);
        f.name.addEventListener("input", () => { f.name.dataset.touched = "1"; });
        const ao = $("#addOption");
        if (ao) ao.addEventListener("click", () => openProduct(null, { from: p }));
        sync();
      },
      save: async f => {
        const row = {
          kind: f.kind.value, name: f.name.value.trim(), weight_g: Number(f.weight_g.value), karat: f.karat.value,
          category: hasLabor(f.kind.value) ? (f.category.value || null) : null,
          premium_pct: Number(f.premium_pct.value) || 0,
          labor: Number(f.labor.value) || 0,
          img: f.img.value.trim() || null,
          photos: f.photos.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).join("\n") || null,
          tag: f.tag.value.trim() || null, sort: parseInt(f.sort.value, 10) || 0,
          visible: f.visible.checked, sold_out: f.sold_out.checked,
          opt_group: f.opt_group.value.trim() || null, opt_label: f.opt_label.value.trim() || null,
          info: Object.fromEntries(Object.keys(INFO_FIELDS).map(k => [k, f["info_" + k].value.trim()]).filter(([, v]) => v)),
        };
        must(isNew ? await sb.from("products").insert(row) : await sb.from("products").update(row).eq("id", p.id));
        // 원래 상품에 묶음 이름이 없었으면 같이 묶어 줌
        if (src && row.opt_group && !src.opt_group) must(await sb.from("products").update({ opt_group: row.opt_group }).eq("id", src.id));
        toast(isNew ? (src ? "옵션을 추가했습니다" : "상품을 추가했습니다") : "저장했습니다 · 홈페이지에 바로 반영돼요");
      },
      remove: isNew ? null : async () => must(await sb.from("products").delete().eq("id", p.id)),
    });
  }
  $("#addProduct").addEventListener("click", () => openProduct(null));

  /* ---------- 공지·이벤트 ---------- */
  let notices = [];
  async function loadNotices() {
    const { data, error } = await sb.from("notices").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(300);
    if (error) return fail(error);
    notices = data;
    const head = `<thead><tr><th>분류</th><th>제목</th><th>필독</th><th>노출</th><th>작성일</th></tr></thead>`;
    $("#noticeTable").innerHTML = head + "<tbody>" + (data.length ? data.map(n => `
      <tr class="clickable${n.visible ? "" : " is-dim"}" data-notice="${n.id}">
        <td><span class="pill nc-${n.category}">${NCAT[n.category]}</span></td>
        <td class="ellipsis"><b>${esc(n.title)}</b></td>
        <td>${n.pinned ? "📌" : ""}</td><td>${n.visible ? "노출" : '<span class="muted">숨김</span>'}</td>
        <td>${fmtDate(n.created_at)}</td>
      </tr>`).join("") : `<tr><td class="empty" colspan="5">아직 글이 없어요. '+ 글 쓰기'로 첫 공지를 올려보세요</td></tr>`) + "</tbody>";
  }
  function openNotice(n) {
    const isNew = !n;
    n = n || { category: "notice", title: "", body: "", pinned: false, visible: true };
    const html = `
      <label>분류<select name="category">${opts(NCAT, n.category)}</select></label>
      <label>제목<input name="title" maxlength="120" required value="${esc(n.title)}"></label>
      <label>내용<textarea name="body" rows="14" maxlength="5000">${esc(n.body || "")}</textarea></label>
      <label class="inline"><input type="checkbox" name="pinned" ${n.pinned ? "checked" : ""}> 필독 (맨 위 고정)</label>
      <label class="inline"><input type="checkbox" name="visible" ${n.visible ? "checked" : ""}> 홈페이지에 노출</label>`;
    openEdit(isNew ? "새 글" : "글 수정", html, {
      save: async f => {
        const row = { category: f.category.value, title: f.title.value.trim(), body: f.body.value, pinned: f.pinned.checked, visible: f.visible.checked };
        must(isNew ? await sb.from("notices").insert(row) : await sb.from("notices").update(row).eq("id", n.id));
        toast(isNew ? "게시했습니다" : "저장했습니다");
      },
      remove: isNew ? null : async () => must(await sb.from("notices").delete().eq("id", n.id)),
    });
  }
  $("#addNotice").addEventListener("click", () => openNotice(null));

  /* ---------- 행 클릭 공통 ---------- */
  // 목록에서 바로 상태 바꾸기 (중간 단계로 되돌리기 포함)
  document.addEventListener("change", e => {
    const s = e.target.closest("[data-setstatus]");
    if (!s || !s.value) return;
    const [kind, id] = s.dataset.setstatus.split(":");
    const v = s.value; s.value = "";
    setStatus(kind, +id, v);
  });
  document.addEventListener("click", async e => {
    if (e.target.closest(".st-pick")) return; // 선택 상자를 눌러도 상세 창이 열리지 않게
    if (e.target.closest("td.pick, th.pick")) return; // 상품 체크 칸
    const nx = e.target.closest("[data-next]");
    if (nx) { const [kind, id, st] = nx.dataset.next.split(":"); return setStatus(kind, +id, st); }
    const tg = e.target.closest("[data-toggle]");
    if (tg) {
      const [id, field] = tg.dataset.toggle.split(":");
      const p = products.find(x => x.id === id);
      const r = await sb.from("products").update({ [field]: !p[field] }).eq("id", id);
      if (r.error) return fail(r.error);
      toast(field === "visible" ? (p[field] ? "숨겼습니다" : "노출합니다") : (p[field] ? "판매를 재개합니다" : "품절 처리했습니다"));
      return loadProducts();
    }
    const rec = e.target.closest("[data-rec]");
    if (rec) {
      const [kind, id] = rec.dataset.rec.split(":");
      const r = cache[kind].find(x => String(x.id) === id);
      if (r) openRequest(kind, r);
      return;
    }
    const pr = e.target.closest("tr[data-product]");
    if (pr) { const p = products.find(x => x.id === pr.dataset.product); if (p) openProduct(p); return; }
    const nt = e.target.closest("tr[data-notice]");
    if (nt) { const n = notices.find(x => String(x.id) === nt.dataset.notice); if (n) openNotice(n); }
  });

  /* ---------- 회원 목록 ---------- */
  function memberTable(list, withActions = true) {
    const head = `<thead><tr><th>회원</th><th>연락처</th><th>등급</th><th>상태</th><th>권한</th><th>가입일</th><th>최근 로그인</th>${withActions ? "<th>빠른 작업</th>" : ""}</tr></thead>`;
    if (!list.length) return head + `<tbody><tr><td class="empty" colspan="8">회원이 없습니다</td></tr></tbody>`;
    return head + "<tbody>" + list.map(m => `
      <tr class="clickable" data-member="${esc(m.id)}">
        <td class="who"><b>${esc(m.name || "(이름 없음)")}</b><span>${esc(m.email)}</span></td>
        <td>${esc(m.phone || "-")}</td>
        <td>${pill(GRADE, m.grade, "g")}</td>
        <td>${pill(STATUS, m.status, "s")}</td>
        <td>${m.role === "admin" ? pill(ROLE, m.role, "r") : "회원"}</td>
        <td>${fmtDate(m.created_at, false)}</td>
        <td>${fmtDate(m.last_login_at)}</td>
        ${withActions ? `<td><div class="row-actions">${m.id === me.id ? "<span class='muted'>본인</span>" :
          m.status === "active"
            ? `<button data-quick="suspended" class="danger">정지</button>`
            : `<button data-quick="active">정상화</button>`}</div></td>` : ""}
      </tr>`).join("") + "</tbody>";
  }

  function applyFilters(q) {
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.grade) q = q.eq("grade", filters.grade);
    if (filters.role) q = q.eq("role", filters.role);
    if (filters.q) {
      const t = filters.q.replace(/[,()%*\\]/g, " ").trim();
      if (t) q = q.or(`name.ilike.*${t}*,email.ilike.*${t}*,phone.ilike.*${t}*`);
    }
    return q;
  }

  async function loadMembers() {
    const from = (page - 1) * PAGE;
    const { data, count: total, error } = await applyFilters(
      sb.from("profiles").select(COLS, { count: "exact" })
    ).order("created_at", { ascending: false }).range(from, from + PAGE - 1);
    if (error) return fail(error);
    rows = data;
    $("#memberTotal").textContent = `${(total || 0).toLocaleString()}명`;
    $("#memberTable").innerHTML = memberTable(data);
    renderPager(Math.max(1, Math.ceil((total || 0) / PAGE)));
  }

  function renderPager(pages) {
    const start = Math.max(1, Math.min(page - 2, pages - 4));
    const nums = [];
    for (let i = start; i <= Math.min(pages, start + 4); i++) nums.push(i);
    $("#pager").innerHTML = `<button data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="이전">‹</button>` +
      nums.map(n => `<button data-page="${n}" class="${n === page ? "is-on" : ""}">${n}</button>`).join("") +
      `<button data-page="${page + 1}" ${page >= pages ? "disabled" : ""} aria-label="다음">›</button>`;
  }
  $("#pager").addEventListener("click", e => {
    const b = e.target.closest("[data-page]");
    if (b && !b.disabled) { page = +b.dataset.page; loadMembers(); }
  });

  $("#filterForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target;
    filters = { q: f.q.value.trim(), status: f.status.value, grade: f.grade.value, role: f.role.value };
    page = 1;
    loadMembers();
  });
  $$("#filterForm select").forEach(s => s.addEventListener("change", () => $("#filterForm").requestSubmit()));

  // 회원 행 클릭 → 상세 / 빠른 작업
  document.addEventListener("click", async e => {
    const tr = e.target.closest("tr[data-member]");
    if (!tr) return;
    const m = rows.find(r => r.id === tr.dataset.member);
    if (!m) return;
    const quick = e.target.closest("[data-quick]");
    if (quick) {
      const to = quick.dataset.quick;
      const label = to === "suspended" ? "이용 정지" : "정상화";
      if (!confirm(`${m.name || m.email} 회원을 ${label} 처리할까요?`)) return;
      const { error } = await sb.from("profiles").update({ status: to }).eq("id", m.id);
      if (error) return fail(error);
      toast(`${label} 처리되었습니다`);
      loaders[current]();
      return;
    }
    openDrawer(m);
  });

  /* ---------- 회원 상세 (드로어) ---------- */
  let editingMember = null;
  function openDrawer(m) {
    editingMember = m;
    const f = $("#memberForm");
    f.name.value = m.name || "";
    f.phone.value = m.phone || "";
    f.grade.value = m.grade;
    f.role.value = m.role;
    f.querySelector(`[name=status][value=${m.status}]`).checked = true;
    f.marketing.checked = !!m.marketing;
    f.memo.value = m.memo || "";
    const self = m.id === me.id;
    f.role.disabled = self;
    f.querySelectorAll("[name=status]").forEach(r => { r.disabled = self; });
    $("#selfWarn").hidden = !self;
    $("#memberMeta").innerHTML = `
      <dt>이메일</dt><dd>${esc(m.email)}</dd>
      <dt>회원 ID</dt><dd>${esc(m.id)}</dd>
      <dt>가입일</dt><dd>${fmtDate(m.created_at)}</dd>
      <dt>최근 로그인</dt><dd>${fmtDate(m.last_login_at)}</dd>
      <dt>최종 수정</dt><dd>${fmtDate(m.updated_at)}</dd>`;
    $("#drawer").hidden = false;
  }
  const closeDrawer = () => { $("#drawer").hidden = true; editingMember = null; };
  $("#drawer").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeDrawer(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });

  $("#memberForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!editingMember) return;
    const f = e.target;
    const patch = {
      name: f.name.value.trim() || null,
      phone: f.phone.value.trim() || null,
      grade: f.grade.value,
      marketing: f.marketing.checked,
      memo: f.memo.value.trim() || null,
    };
    if (editingMember.id !== me.id) {
      patch.role = f.role.value;
      patch.status = f.querySelector("[name=status]:checked").value;
      if (patch.role === "admin" && editingMember.role !== "admin" && !confirm("이 회원에게 관리자 권한을 부여합니다. 계속할까요?")) return;
    }
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    const { error } = await sb.from("profiles").update(patch).eq("id", editingMember.id);
    btn.disabled = false;
    if (error) return fail(error);
    toast("저장되었습니다");
    closeDrawer();
    loaders[current]();
  });

  /* ---------- CSV ---------- */
  $("#csvBtn").addEventListener("click", async () => {
    const { data, error } = await applyFilters(sb.from("profiles").select(COLS)).order("created_at", { ascending: false }).limit(10000);
    if (error) return fail(error);
    const head = ["이메일", "이름", "연락처", "등급", "상태", "권한", "마케팅동의", "가입일", "최근로그인", "메모"];
    const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = data.map(m => [m.email, m.name, m.phone, GRADE[m.grade], STATUS[m.status], ROLE[m.role], m.marketing ? "Y" : "N", fmtDate(m.created_at), fmtDate(m.last_login_at), m.memo].map(cell).join(","));
    const blob = new Blob(["﻿" + [head.map(cell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `members_${fmtDate(new Date(), false).replace(/\./g, "")}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`${data.length}명 내보내기 완료`);
  });

  // 마케팅 수신 동의 명단 (주문 때 동의 + 가입 때 동의). 광고 문자 첫머리에 (광고), 끝에 무료 수신거부 방법을 꼭 넣어야 해요
  $("#mktBtn").addEventListener("click", async () => {
    const { data, error } = await sb.rpc("marketing_list");
    if (error) return fail(error);
    downloadCsv(`금비_마케팅동의_${fmtDate(new Date(), false).replace(/\./g, "")}.csv`,
      ["이름", "휴대폰", "동의 경로", "동의 일시"],
      (data || []).map(r => [r.name, fmtPhone(r.phone), r.source, fmtDate(r.consented_at)]));
    toast(`${(data || []).length}명 내보내기 완료`);
  });

  /* ---------- 시세 설정 ---------- */
  let liveCache = null;
  async function loadPrice() {
    const f = $("#settingsForm");
    const { data, error } = await sb.from("price_settings").select("*").eq("id", 1).maybeSingle();
    if (error) return fail(error);
    const s = { ...DEFAULT_SETTINGS, ...(data || {}) };
    Object.keys(DEFAULT_SETTINGS).forEach(k => { f[k].value = s[k]; });
    $("#settingsMeta").textContent = data ? `최종 수정 ${fmtDate(data.updated_at)}` : "";
    try { liveCache = await fetchLive(); } catch { liveCache = null; }
    preview();
    loadShop();
  }

  // 주문 · 입금 · 문자 설정 (shop_info)
  const SHOP_FIELDS = ["bank_name", "bank_account", "bank_holder", "pay_minutes", "delivery_fee", "owner_phone", "sms_sender"];
  async function loadShop() {
    const f = $("#shopForm");
    const { data, error } = await sb.from("shop_info").select("*").eq("id", 1).maybeSingle();
    if (error || !data) { $("#shopMeta").textContent = "설정 테이블이 없어요 · order-sms.sql 을 먼저 실행해 주세요"; f.querySelector("[type=submit]").disabled = true; return; }
    SHOP_FIELDS.forEach(k => { f[k].value = data[k] ?? ""; });
    f.sms_enabled.checked = !!data.sms_enabled;
    $("#shopMeta").textContent = `최종 수정 ${fmtDate(data.updated_at)}`;
  }
  $("#shopForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("[type=submit]");
    const row = { updated_at: new Date().toISOString(), sms_enabled: f.sms_enabled.checked };
    SHOP_FIELDS.forEach(k => { row[k] = ["pay_minutes", "delivery_fee"].includes(k) ? parseInt(f[k].value, 10) : f[k].value.trim(); });
    btn.disabled = true;
    const { error } = await sb.from("shop_info").update(row).eq("id", 1);
    btn.disabled = false;
    if (error) return fail(error);
    toast("주문·입금 설정을 저장했습니다");
    loadShop();
  });
  function readSettings() {
    const f = $("#settingsForm"), s = {};
    Object.keys(DEFAULT_SETTINGS).forEach(k => { s[k] = parseFloat(f[k].value); if (isNaN(s[k])) s[k] = DEFAULT_SETTINGS[k]; });
    return s;
  }
  function preview() {
    if (!liveCache) { $("#previewTable").innerHTML = "<tr><td>국제 시세를 불러오지 못했습니다</td></tr>"; return; }
    const d = computeDomestic(liveCache, readSettings());
    $("#previewTime").textContent = fmtDate(liveCache.updatedAt) + " 기준";
    $("#previewBase").textContent = `국제 금 1돈 환산 ${won(d.base.gold)} (${"$" + liveCache.usd.XAU.toFixed(2)}/oz × 환율 ${liveCache.krw.toFixed(2)}원)`;
    $("#previewTable").innerHTML = priceRows(d.items);
  }
  $("#settingsForm").addEventListener("input", preview);
  $("#settingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    const { error } = await sb.from("price_settings").update({ ...readSettings(), updated_at: new Date().toISOString(), updated_by: me.id }).eq("id", 1);
    btn.disabled = false;
    if (error) return fail(error);
    domCache = null;
    toast("시세 설정이 저장되었습니다 · 홈페이지에 반영됩니다");
    loadPrice();
  });

  /* ---------- 변경 이력 ---------- */
  let logs = [], logNames = {}, logTab = "all";
  async function loadLogs() {
    const { data, error } = await sb.from("admin_logs").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) return fail(error);
    logs = data;
    const ids = [...new Set(data.flatMap(l => [l.admin_id, l.target_id]).filter(Boolean))];
    logNames = {};
    if (ids.length) {
      const r = await sb.from("profiles").select("id,name,email").in("id", ids);
      (r.data || []).forEach(p => { logNames[p.id] = p.name || p.email; });
    }
    renderLogs();
  }
  function logVal(entity, k, v) {
    if (v == null || v === "") return "없음";
    if (typeof v === "boolean") return k === "marketing" ? (v ? "동의" : "거부") : v ? "켜짐" : "꺼짐";
    if (k === "status") return (entity === "order" ? ORDER_STATUS : entity === "sell" ? SELL_STATUS : STATUS)[v] || v;
    if (k === "grade") return GRADE[v] || v;
    if (k === "role") return ROLE[v] || v;
    if (k === "kind") return KIND[v] || v;
    if (k === "category") return entity === "notice" ? NCAT[v] || v : CATEGORY[v] || v;
    if (["final_price", "final_amount", "labor"].includes(k)) return won(v);
    const s = String(v);
    return s.length > 40 ? s.slice(0, 40) + "…" : s;
  }
  function renderLogs() {
    const tabs = [["all", "전체"], ...Object.entries(ENTITY)];
    $("#logTabs").innerHTML = tabs.map(([k, v]) => `<button data-tab="logs:${k}" class="${logTab === k ? "is-on" : ""}">${v}</button>`).join("");
    const list = logTab === "all" ? logs : logs.filter(l => (l.entity || "member") === logTab);
    const head = `<thead><tr><th>일시</th><th>처리자</th><th>구분</th><th>대상</th><th>변경 내용</th></tr></thead>`;
    $("#logTable").innerHTML = head + "<tbody>" + (list.length ? list.map(l => {
      const ent = l.entity || "member";
      return `<tr>
        <td>${fmtDate(l.created_at)}</td>
        <td>${esc(logNames[l.admin_id] || "-")}</td>
        <td>${ENTITY[ent] || ent}</td>
        <td>${esc(ent === "member" ? logNames[l.target_id] || "-" : l.ref || "-")}</td>
        <td class="changes">${Object.entries(l.changes).map(([k, [a, b]]) => `<span><b>${FIELD[k] || esc(k)}</b> <del>${esc(logVal(ent, k, a))}</del> → ${esc(logVal(ent, k, b))}</span>`).join("")}</td>
      </tr>`;
    }).join("") : `<tr><td class="empty" colspan="5">변경 이력이 없습니다</td></tr>`) + "</tbody>";
  }

  boot();
})();
