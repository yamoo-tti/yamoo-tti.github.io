/* 홈페이지 회원 기능: 로그인 · 회원가입 · 정지 회원 차단 */
(function () {
  const { sb, esc } = window.YAMOO;
  const $ = s => document.querySelector(s);
  const modal = $("#authModal"), msg = $("#authMsg"), nav = $("#authNav");
  const toast = m => window.toast && window.toast(m);

  const STATUS_MSG = {
    suspended: "이용이 정지된 계정입니다. 고객센터(1588-0000)로 문의해 주세요.",
    withdrawn: "탈퇴 처리된 계정입니다.",
  };

  function setMsg(t, isError) { msg.textContent = t || ""; msg.classList.toggle("is-error", !!isError); }

  function open(tab) {
    if (!sb) { toast("회원 기능 준비 중입니다. 관리자 설정 후 이용할 수 있어요."); return; }
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    switchTab(tab);
    setTimeout(() => modal.querySelector(`[data-pane="${tab}"] input`).focus(), 30);
  }
  function close() { modal.hidden = true; document.body.style.overflow = ""; setMsg(""); }
  function switchTab(tab) {
    modal.querySelectorAll(".auth-tabs button").forEach(b => b.classList.toggle("is-on", b.dataset.tab === tab));
    modal.querySelectorAll("[data-pane]").forEach(p => { p.hidden = p.dataset.pane !== tab; });
    setMsg("");
  }

  modal.addEventListener("click", e => {
    if (e.target.closest("[data-close]")) close();
    const t = e.target.closest(".auth-tabs button");
    if (t) switchTab(t.dataset.tab);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) close(); });
  nav.addEventListener("click", e => {
    const b = e.target.closest("[data-open]");
    if (b) open(b.dataset.open);
    if (e.target.closest("#logoutBtn")) sb.auth.signOut().then(() => toast("로그아웃되었습니다"));
  });

  function renderNav(profile) {
    if (!profile) {
      nav.innerHTML = `<button type="button" data-open="login">로그인</button><button type="button" data-open="signup">회원가입</button><a href="#">주문조회</a><a href="#">고객센터</a>`;
      return;
    }
    const admin = profile.role === "admin" ? `<a href="admin.html" class="util__admin">관리자</a>` : "";
    nav.innerHTML = `<span class="util__me"><b>${esc(profile.name || profile.email)}</b>님</span>${admin}<button type="button" id="logoutBtn">로그아웃</button><a href="#">고객센터</a>`;
  }

  async function loadProfile(user) {
    const { data } = await sb.from("profiles").select("name,email,role,status").eq("id", user.id).maybeSingle();
    return data;
  }

  // 로그인 상태 확인 — 정지/탈퇴 회원은 즉시 로그아웃
  async function sync(session, fromLogin) {
    if (!session) { renderNav(null); return; }
    const p = await loadProfile(session.user);
    if (p && p.status !== "active") {
      await sb.auth.signOut();
      renderNav(null);
      if (fromLogin) setMsg(STATUS_MSG[p.status], true); else toast(STATUS_MSG[p.status]);
      return false;
    }
    renderNav(p || { email: session.user.email });
    return true;
  }

  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("[type=submit]");
    btn.disabled = true; setMsg("로그인 중…");
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false;
    if (error) { setMsg(error.message.includes("confirm") ? "이메일 인증을 먼저 완료해 주세요." : "이메일 또는 비밀번호가 올바르지 않습니다.", true); return; }
    const ok = await sync(data.session, true);
    if (ok) {
      sb.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", data.user.id).then(() => {});
      close(); f.reset(); toast("로그인되었습니다");
    }
  });

  $("#signupForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("[type=submit]");
    if (f.password.value.length < 8) { setMsg("비밀번호는 8자 이상이어야 합니다.", true); return; }
    btn.disabled = true; setMsg("가입 처리 중…");
    const { data, error } = await sb.auth.signUp({
      email: f.email.value.trim(),
      password: f.password.value,
      options: {
        data: { name: f.name.value.trim(), phone: f.phone.value.trim(), marketing: f.marketing.checked },
        emailRedirectTo: location.origin + location.pathname,
      },
    });
    btn.disabled = false;
    if (error) { setMsg(error.message.includes("registered") ? "이미 가입된 이메일입니다." : "가입에 실패했습니다: " + error.message, true); return; }
    f.reset();
    if (data.session) { await sync(data.session); close(); toast("가입을 환영합니다!"); }
    else setMsg("가입 확인 메일을 보냈습니다. 메일의 링크를 눌러 인증을 완료해 주세요.");
  });

  $("#resetBtn").addEventListener("click", async () => {
    const email = $("#loginForm").email.value.trim();
    if (!email) { setMsg("이메일을 먼저 입력해 주세요.", true); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    setMsg(error ? "메일 발송에 실패했습니다." : "비밀번호 재설정 메일을 보냈습니다.", !!error);
  });

  if (sb) {
    sb.auth.getSession().then(({ data }) => sync(data.session));
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") renderNav(null);
      if (event === "PASSWORD_RECOVERY") {
        const pw = prompt("새 비밀번호를 입력해 주세요 (8자 이상)");
        if (pw && pw.length >= 8) {
          const { error } = await sb.auth.updateUser({ password: pw });
          toast(error ? "비밀번호 변경에 실패했습니다" : "비밀번호가 변경되었습니다");
        }
      }
    });
  }
})();
