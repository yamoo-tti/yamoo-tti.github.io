/* 금비 GOLD 관리자 */
(function () {
  const { sb, esc, won, fmtDate, fetchLive, fetchSettings, computeDomestic, productPrice, ORDER_STATUS, SELL_STATUS, fmtPhone, DEFAULT_SETTINGS } = window.YAMOO;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const GRADE = { basic: "일반", silver: "실버", gold: "골드", vip: "VIP" };
  const STATUS = { active: "정상", suspended: "정지", withdrawn: "탈퇴" };
  const ROLE = { member: "회원", admin: "관리자" };
  const KIND = { bar: "골드바", zodiac: "카드형 1g", accessory: "악세사리" };
  const CATEGORY = { necklace: "목걸이", ring: "반지", bracelet: "팔찌", earring: "귀걸이" };
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
  };
  const ORDER_FLOW = ["new", "confirmed", "paid", "ready", "done"];
  const SELL_FLOW = ["new", "scheduled", "received", "done"];
  const IMAGES = [
    "gbk/bar-1g.webp", "gbk/bar-3_75g.webp", "gbk/bar-10g.webp", "gbk/bar-18_75g.webp", "gbk/bar-37_5g.webp", "gbk/bar-100g.webp",
    ...Array.from({ length: 13 }, (_, i) => `gbk/zodiac-${String(i + 1).padStart(2, "0")}.webp`),
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
  const loaders = { dash: loadDash, orders: () => loadRequests("orders"), sells: () => loadRequests("sells"), products: loadProducts, notices: loadNotices, members: loadMembers, price: loadPrice, logs: loadLogs };
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
    const cnt = k => k === "all" ? all.length : k === "open" ? all.filter(r => !["done", "canceled"].includes(r.status)).length : all.filter(r => r.status === k).length;
    const tabs = [["open", "진행 중"], ...Object.entries(c.status), ["all", "전체"]];
    $(c.tabs).innerHTML = tabs.map(([k, v]) => `<button data-tab="${kind}:${k}" class="${reqTab[kind] === k ? "is-on" : ""}">${v} <span>${cnt(k)}</span></button>`).join("");
    const t = reqTab[kind];
    let list = t === "all" ? all : t === "open" ? all.filter(r => !["done", "canceled"].includes(r.status)) : all.filter(r => r.status === t);
    const q = reqQ[kind].toLowerCase().replace(/-/g, "");
    if (q) list = list.filter(r => [r.code, r.name, r.phone, r.product_name, r.items].some(v => String(v || "").toLowerCase().replace(/-/g, "").includes(q)));
    $(c.list).innerHTML = requestTable(kind, list, false);
  }

  function requestTable(kind, list, compact) {
    const c = REQ[kind], isO = kind === "orders";
    const head = compact
      ? `<thead><tr><th>접수</th><th>${isO ? "상품" : "품목"}</th><th>고객</th><th>상태</th></tr></thead>`
      : `<thead><tr><th>접수번호</th><th>접수일시</th><th>${isO ? "상품 · 수량" : "품목 · 함량"}</th><th>고객</th><th>${isO ? "수령" : "방법 · 방문일"}</th><th>${isO ? "금액" : "매입가"}</th><th>상태</th><th>다음 단계</th></tr></thead>`;
    if (!list.length) return head + `<tbody><tr><td class="empty" colspan="8">${compact ? "처리할 접수가 없습니다 👍" : "접수가 없습니다"}</td></tr></tbody>`;
    return head + "<tbody>" + list.map(r => {
      const what = isO ? `${esc(r.product_name)} <span class="muted">× ${r.qty}</span>` : `${esc(r.items)} <span class="muted">${KARAT[r.karat] || ""}${r.weight_g ? " · " + Number(r.weight_g) + "g" : ""}</span>`;
      const who = `<b>${esc(r.name)}</b><span>${esc(fmtPhone(r.phone))}</span>`;
      const st = `<span class="pill st-${esc(r.status)}">${esc(c.status[r.status])}</span>${isToday(r.created_at) && r.status === "new" ? ' <span class="pill st-today">오늘</span>' : ""}`;
      if (compact) return `<tr class="clickable" data-rec="${kind}:${r.id}"><td>${fmtDate(r.created_at).slice(5)}</td><td class="ellipsis">${what}</td><td class="who">${who}</td><td>${st}</td></tr>`;
      const i = c.flow.indexOf(r.status), next = i >= 0 && i < c.flow.length - 1 ? c.flow[i + 1] : null;
      const money = isO ? (r.final_price ? `<b>${won(r.final_price)}</b>` : r.quoted_price ? `<span class="muted">예상 ${won(r.quoted_price)}</span>` : "-") : (r.final_amount ? `<b>${won(r.final_amount)}</b>` : "-");
      const how = isO ? RECEIVE[r.receive] : `${RECEIVE[r.method]}${r.visit_date ? " · " + r.visit_date.slice(5).replace("-", ".") : ""}`;
      return `<tr class="clickable" data-rec="${kind}:${r.id}">
        <td class="code">${esc(r.code)}</td><td>${fmtDate(r.created_at)}</td><td class="ellipsis">${what}</td>
        <td class="who">${who}</td><td>${how}</td><td>${money}</td><td>${st}</td>
        <td><div class="row-actions">${next ? `<button data-next="${kind}:${r.id}:${next}">→ ${esc(c.status[next])}</button>` : ""}</div></td>
      </tr>`;
    }).join("") + "</tbody>";
  }

  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tab]");
    if (!t) return;
    const [kind, k] = t.dataset.tab.split(":");
    if (REQ[kind]) { reqTab[kind] = k; renderRequests(kind); }
    else if (kind === "products") { productTab = k; renderProducts(); }
    else if (kind === "logs") { logTab = k; renderLogs(); }
  });
  Object.keys(REQ).forEach(kind => $(REQ[kind].search).addEventListener("submit", e => {
    e.preventDefault(); reqQ[kind] = e.target.q.value.trim(); renderRequests(kind);
  }));

  async function setStatus(kind, id, status) {
    const c = REQ[kind];
    const { error } = await sb.from(c.table).update({ status }).eq("id", id);
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

  function openRequest(kind, r) {
    const c = REQ[kind], isO = kind === "orders";
    const tel = `<a href="tel:${esc(r.phone)}">${esc(fmtPhone(r.phone))}</a>`;
    const meta = isO
      ? `<dt>접수번호</dt><dd><b>${esc(r.code)}</b></dd><dt>접수일시</dt><dd>${fmtDate(r.created_at)}</dd>
         <dt>상품</dt><dd>${esc(r.product_name)} × ${r.qty}</dd><dt>예상 금액</dt><dd>${r.quoted_price ? won(r.quoted_price) + " (접수 시점 시세)" : "-"}</dd>
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
      <label>진행 상태<select name="status">${opts(c.status, r.status)}</select></label>
      ${isO
        ? `<label>확정 금액 (원) <small>고객에게 안내한 최종 금액</small><input type="number" name="final_price" min="0" step="100" value="${r.final_price ?? ""}"></label>`
        : `<div class="row2"><label>방문일<input type="date" name="visit_date" value="${r.visit_date ?? ""}"></label>
           <label>매입가 (원)<input type="number" name="final_amount" min="0" step="100" value="${r.final_amount ?? ""}"></label></div>`}
      <label>관리 메모 <small>고객에게 보이지 않습니다</small><textarea name="admin_memo" rows="4" maxlength="1000">${esc(r.admin_memo || "")}</textarea></label>
      <p class="muted">최종 수정 ${fmtDate(r.updated_at)}</p>`;
    openEdit(`${isO ? "구매" : "매입"} 신청 · ${r.code}`, html, {
      save: async f => {
        const patch = { status: f.status.value, admin_memo: f.admin_memo.value.trim() || null };
        if (isO) patch.final_price = num(f.final_price.value);
        else { patch.final_amount = num(f.final_amount.value); patch.visit_date = f.visit_date.value || null; }
        if (patch.status === "canceled" && r.status !== "canceled" && !confirm("이 접수를 취소 처리할까요?")) return false;
        must(await sb.from(c.table).update(patch).eq("id", r.id));
        toast("저장했습니다");
      },
    });
  }

  /* ---------- 상품 관리 ---------- */
  let products = [], productTab = "bar";
  async function loadProducts() {
    const { data, error } = await sb.from("products").select("*").order("kind").order("sort").order("created_at");
    if (error) return fail(error);
    products = data;
    let d = null;
    try { d = await domestic(); } catch { d = null; }
    products.forEach(p => { p._price = d ? productPrice(p, d) : null; });
    renderProducts();
  }
  function renderProducts() {
    const tabs = [...Object.entries(KIND), ["all", "전체"]];
    $("#productTabs").innerHTML = tabs.map(([k, v]) => `<button data-tab="products:${k}" class="${productTab === k ? "is-on" : ""}">${v} <span>${k === "all" ? products.length : products.filter(p => p.kind === k).length}</span></button>`).join("");
    const list = productTab === "all" ? products : products.filter(p => p.kind === productTab);
    const head = `<thead><tr><th></th><th>상품명</th><th>종류</th><th>중량 · 함량</th><th>가격 조정</th><th>현재 판매가</th><th>노출</th><th>품절</th><th>순서</th></tr></thead>`;
    $("#productTable").innerHTML = head + "<tbody>" + (list.length ? list.map(p => `
      <tr class="clickable${p.visible ? "" : " is-dim"}" data-product="${p.id}">
        <td><img class="thumb" src="${esc(imgUrl(p.img))}" alt=""></td>
        <td><b>${esc(p.name)}</b>${p.tag ? ` <span class="pill g-gold">${esc(p.tag)}</span>` : ""}</td>
        <td>${KIND[p.kind]}${p.category ? " · " + CATEGORY[p.category] : ""}</td>
        <td>${Number(p.weight_g)}g · ${p.karat}</td>
        <td>${p.kind === "accessory" ? "공임 " + won(p.labor) : "+" + Number(p.premium_pct) + "%"}</td>
        <td>${p._price ? won(p._price) : "-"}</td>
        <td><button class="switch ${p.visible ? "is-on" : ""}" data-toggle="${p.id}:visible" aria-label="노출">${p.visible ? "노출" : "숨김"}</button></td>
        <td><button class="switch switch--warn ${p.sold_out ? "is-on" : ""}" data-toggle="${p.id}:sold_out" aria-label="품절">${p.sold_out ? "품절" : "판매중"}</button></td>
        <td>${p.sort}</td>
      </tr>`).join("") : `<tr><td class="empty" colspan="9">상품이 없습니다</td></tr>`) + "</tbody>";
  }

  function openProduct(p) {
    const isNew = !p;
    p = p || { kind: productTab === "all" ? "bar" : productTab, name: "", weight_g: "", karat: "24K", category: null, premium_pct: 0, labor: 0, img: "", tag: "", sort: (products.length + 1) * 10, visible: true, sold_out: false };
    const html = `
      <div class="pimg"><img id="pimgPreview" src="${esc(imgUrl(p.img))}" alt=""></div>
      <div class="row2">
        <label>종류<select name="kind">${opts(KIND, p.kind)}</select></label>
        <label data-for="accessory">분류<select name="category"><option value="">-</option>${opts(CATEGORY, p.category)}</select></label>
      </div>
      <label>상품명<input name="name" maxlength="80" required value="${esc(p.name)}" placeholder="예) GBK 순금 골드바 5g"></label>
      <div class="row2">
        <label>중량 (g)<input type="number" name="weight_g" min="0.01" step="0.01" required value="${p.weight_g}"></label>
        <label>함량<select name="karat">${opts({ "24K": "24K", "18K": "18K", "14K": "14K" }, p.karat)}</select></label>
      </div>
      <div class="row2">
        <label data-for="bar zodiac">프리미엄 (%) <small>순금 살 때 시세 대비</small><input type="number" name="premium_pct" step="0.1" value="${p.premium_pct}"></label>
        <label data-for="accessory">공임 (원)<input type="number" name="labor" min="0" step="1000" value="${p.labor}"></label>
        <label>예상 판매가<output id="pricePreview" class="price-out">-</output></label>
      </div>
      <label>이미지 <small>목록에서 고르거나 이미지 주소(https://…) 입력</small><input name="img" list="imgList" value="${esc(p.img || "")}"><datalist id="imgList">${IMAGES.map(i => `<option value="${i}">`).join("")}</datalist></label>
      <div class="row2">
        <label>표시 태그 <small>예) BEST, NEW</small><input name="tag" maxlength="12" value="${esc(p.tag || "")}"></label>
        <label>순서 <small>작을수록 앞</small><input type="number" name="sort" step="1" value="${p.sort}"></label>
      </div>
      <label class="inline"><input type="checkbox" name="visible" ${p.visible ? "checked" : ""}> 홈페이지에 노출</label>
      <label class="inline"><input type="checkbox" name="sold_out" ${p.sold_out ? "checked" : ""}> 품절 (구매 버튼 막기)</label>`;
    openEdit(isNew ? "상품 추가" : "상품 수정", html, {
      after: f => {
        const sync = async () => {
          const k = f.kind.value;
          f.querySelectorAll("[data-for]").forEach(el => { el.hidden = !el.dataset.for.split(" ").includes(k); });
          $("#pimgPreview").src = imgUrl(f.img.value.trim());
          try {
            const d = await domestic();
            const w = Number(f.weight_g.value);
            $("#pricePreview").textContent = w > 0 ? won(productPrice({ kind: k, weight_g: w, karat: f.karat.value, premium_pct: f.premium_pct.value, labor: f.labor.value }, d)) : "-";
          } catch { $("#pricePreview").textContent = "시세 확인 불가"; }
        };
        f.addEventListener("input", sync);
        sync();
      },
      save: async f => {
        const row = {
          kind: f.kind.value, name: f.name.value.trim(), weight_g: Number(f.weight_g.value), karat: f.karat.value,
          category: f.kind.value === "accessory" ? (f.category.value || null) : null,
          premium_pct: f.kind.value === "accessory" ? 0 : Number(f.premium_pct.value) || 0,
          labor: f.kind.value === "accessory" ? Number(f.labor.value) || 0 : 0,
          img: f.img.value.trim() || null, tag: f.tag.value.trim() || null, sort: parseInt(f.sort.value, 10) || 0,
          visible: f.visible.checked, sold_out: f.sold_out.checked,
        };
        must(isNew ? await sb.from("products").insert(row) : await sb.from("products").update(row).eq("id", p.id));
        toast(isNew ? "상품을 추가했습니다" : "저장했습니다 · 홈페이지에 바로 반영돼요");
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
  document.addEventListener("click", async e => {
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
  }
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
