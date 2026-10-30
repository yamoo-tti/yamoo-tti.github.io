/* 금비 GOLD 관리자 */
(function () {
  const { sb, esc, won, fmtDate, fetchLive, fetchSettings, computeDomestic, DEFAULT_SETTINGS } = window.YAMOO;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const GRADE = { basic: "일반", silver: "실버", gold: "골드", vip: "VIP" };
  const STATUS = { active: "정상", suspended: "정지", withdrawn: "탈퇴" };
  const ROLE = { member: "회원", admin: "관리자" };
  const FIELD = { name: "이름", phone: "연락처", role: "권한", grade: "등급", status: "상태", marketing: "마케팅", memo: "메모" };
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

  /* ---------- 화면 전환 ---------- */
  const loaders = { dash: loadDash, members: loadMembers, price: loadPrice, logs: loadLogs };
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
    if (e.target.closest("[data-refresh]")) loaders[current]();
  });

  /* ---------- 대시보드 ---------- */
  const count = q => q.then(r => { if (r.error) throw r.error; return r.count || 0; });
  const base = () => sb.from("profiles").select("id", { count: "exact", head: true });

  async function loadDash() {
    try {
      const week = new Date(Date.now() - 7 * 864e5).toISOString();
      const [total, fresh, active, suspended, ...grades] = await Promise.all([
        count(base()),
        count(base().gte("created_at", week)),
        count(base().eq("status", "active")),
        count(base().eq("status", "suspended")),
        ...Object.keys(GRADE).map(g => count(base().eq("grade", g).neq("status", "withdrawn"))),
      ]);
      $("#kpis").innerHTML = `
        <div class="kpi kpi--gold"><p>전체 회원</p><strong>${total.toLocaleString()}</strong><small>탈퇴 포함</small></div>
        <div class="kpi"><p>최근 7일 신규</p><strong>${fresh.toLocaleString()}</strong></div>
        <div class="kpi"><p>정상 회원</p><strong>${active.toLocaleString()}</strong></div>
        <div class="kpi"><p>이용 정지</p><strong>${suspended.toLocaleString()}</strong></div>`;
      const max = Math.max(1, ...grades);
      $("#gradeBars").innerHTML = Object.keys(GRADE).map((g, i) => `
        <div class="hbar"><span>${GRADE[g]}</span><div class="hbar__track"><div class="hbar__fill" style="width:${(grades[i] / max) * 100}%"></div></div><span>${grades[i].toLocaleString()}명</span></div>`).join("");

      const { data, error } = await sb.from("profiles").select(COLS).order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      rows = data;
      $("#recentTable").innerHTML = memberTable(data, false);
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

  /* ---------- 회원 목록 ---------- */
  function memberTable(list, withActions = true) {
    const head = `<thead><tr><th>회원</th><th>연락처</th><th>등급</th><th>상태</th><th>권한</th><th>가입일</th><th>최근 로그인</th>${withActions ? "<th>빠른 작업</th>" : ""}</tr></thead>`;
    if (!list.length) return head + `<tbody><tr><td class="empty" colspan="8">회원이 없습니다</td></tr></tbody>`;
    return head + "<tbody>" + list.map(m => `
      <tr class="clickable" data-id="${esc(m.id)}">
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

  // 행 클릭 → 상세 / 빠른 작업
  document.addEventListener("click", async e => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const m = rows.find(r => r.id === tr.dataset.id);
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
  let editing = null;
  function openDrawer(m) {
    editing = m;
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
  const closeDrawer = () => { $("#drawer").hidden = true; editing = null; };
  $("#drawer").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeDrawer(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });

  $("#memberForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!editing) return;
    const f = e.target;
    const patch = {
      name: f.name.value.trim() || null,
      phone: f.phone.value.trim() || null,
      grade: f.grade.value,
      marketing: f.marketing.checked,
      memo: f.memo.value.trim() || null,
    };
    if (editing.id !== me.id) {
      patch.role = f.role.value;
      patch.status = f.querySelector("[name=status]:checked").value;
      if (patch.role === "admin" && editing.role !== "admin" && !confirm("이 회원에게 관리자 권한을 부여합니다. 계속할까요?")) return;
    }
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    const { error } = await sb.from("profiles").update(patch).eq("id", editing.id);
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
    toast("시세 설정이 저장되었습니다 · 홈페이지에 반영됩니다");
    loadPrice();
  });

  /* ---------- 변경 이력 ---------- */
  async function loadLogs() {
    const { data, error } = await sb.from("admin_logs").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) return fail(error);
    const ids = [...new Set(data.flatMap(l => [l.admin_id, l.target_id]).filter(Boolean))];
    const names = {};
    if (ids.length) {
      const r = await sb.from("profiles").select("id,name,email").in("id", ids);
      (r.data || []).forEach(p => { names[p.id] = p.name || p.email; });
    }
    const val = (k, v) => v == null || v === "" ? "없음" : k === "grade" ? GRADE[v] : k === "status" ? STATUS[v] : k === "role" ? ROLE[v] : k === "marketing" ? (v ? "동의" : "거부") : v;
    const head = `<thead><tr><th>일시</th><th>처리자</th><th>대상 회원</th><th>변경 내용</th></tr></thead>`;
    $("#logTable").innerHTML = head + "<tbody>" + (data.length ? data.map(l => `
      <tr>
        <td>${fmtDate(l.created_at)}</td>
        <td>${esc(names[l.admin_id] || "-")}</td>
        <td>${esc(names[l.target_id] || "-")}</td>
        <td class="changes">${Object.entries(l.changes).map(([k, [a, b]]) => `<span><b>${FIELD[k] || esc(k)}</b> <del>${esc(val(k, a))}</del> → ${esc(val(k, b))}</span>`).join("")}</td>
      </tr>`).join("") : `<tr><td class="empty" colspan="4">변경 이력이 없습니다</td></tr>`) + "</tbody>";
  }

  boot();
})();
