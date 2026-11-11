/* 상품 상세: 구매 후기(리뷰) · 재입고 알림 (supabase/reviews-restock.sql 실행 후 동작) */
(function () {
  const { sb, esc, fmtDate } = window.YAMOO;
  const $ = s => document.querySelector(s);
  const toast = m => window.toast && window.toast(m);
  const box = $("#pdReviews"), starsBox = $("#pdStars"), alertBox = $("#pdAlert");
  if (!box || !sb) return;

  const stars = n => `<span class="rv-stars" aria-label="별점 ${n}점">${"★".repeat(Math.round(n))}<i>${"★".repeat(5 - Math.round(n))}</i></span>`;
  const cache = {}; // 묶음 첫 상품 id → 후기 목록
  let cur = null, curOpts = [], writing = false, seq = 0;

  async function load(ids) {
    const key = ids.join(",");
    if (cache[key]) return cache[key];
    const { data, error } = await sb.rpc("product_reviews", { p_ids: ids });
    if (error) return null; // SQL 실행 전이면 후기 칸을 숨김
    return (cache[key] = data || []);
  }

  // force: 후기 쓰기·취소처럼 직접 다시 그릴 때. 시세 갱신(1분마다)으로 불릴 때는 쓰던 글을 지우지 않음
  window.renderReviews = async function (p, opts, force) {
    const changed = !cur || cur.id !== p.id;
    cur = p; curOpts = opts && opts.length ? opts : [p];
    if (changed) writing = false;
    renderAlert(p);
    if (!changed && !force && !box.hidden && box.innerHTML) return;
    const my = ++seq;
    const list = await load(curOpts.map(o => o.id));
    if (my !== seq) return; // 그 사이 다른 상품을 열었으면 무시
    if (!list) { box.hidden = true; starsBox.innerHTML = ""; return; }
    box.hidden = false;
    const n = list.length, avg = n ? list.reduce((s, r) => s + r.rating, 0) / n : 0;
    starsBox.innerHTML = n ? `<a href="#pdReviews" class="pd__stars" data-rvjump>${stars(avg)} <b>${avg.toFixed(1)}</b> <span>후기 ${n}개</span></a>` : "";
    box.innerHTML = `
      <div class="rv__head">
        <h3>구매 후기 <span>${n}</span></h3>
        ${n ? `<p class="rv__avg">${stars(avg)} <b>${avg.toFixed(1)}</b> / 5</p>` : ""}
        ${writing ? "" : `<button type="button" class="btn btn--line rv__write" data-rvwrite>후기 쓰기</button>`}
      </div>
      ${writing ? formHtml() : ""}
      ${n ? `<ul class="rv__list">${list.map(r => `
        <li class="rv">
          <div class="rv__top">${stars(r.rating)}<b>${esc(r.name)}</b><time>${fmtDate(r.created_at, false)}</time></div>
          ${r.option_label ? `<p class="rv__opt">${esc(r.option_label)}</p>` : ""}
          <p class="rv__body">${esc(r.body)}</p>
          ${r.reply ? `<div class="rv__reply"><b>금비 GOLD 답글</b><p>${esc(r.reply)}</p></div>` : ""}
        </li>`).join("")}</ul>`
        : `<p class="rv__empty">아직 후기가 없어요. 구매하신 분은 첫 후기를 남겨 주세요.</p>`}`;
  };

  function formHtml() {
    const many = curOpts.length > 1;
    return `
      <form class="rv__form auth-form" id="rvForm">
        <p class="rv__for">${many ? `<b>${esc(window.YAMOO.optLabel(cur))}</b> 옵션의 후기를 써요. 다른 중량을 사셨다면 위에서 먼저 골라 주세요.` : `<b>${esc(cur.name)}</b>`}</p>
        <p class="rv__label">별점</p>
        <fieldset class="rv__rate"><legend class="sr-only">별점</legend>
          ${[5, 4, 3, 2, 1].map(v => `<input type="radio" name="rating" value="${v}" id="rv${v}" ${v === 5 ? "checked" : ""}><label for="rv${v}" title="${v}점">★</label>`).join("")}
        </fieldset>
        <label>후기 <small>10자 이상 · 받아 보신 느낌, 실물·포장 상태 등</small><textarea name="body" rows="4" minlength="10" maxlength="1000" required></textarea></label>
        <div id="rvGuest" hidden>
          <p class="form-note">비회원은 <b>접수번호</b>와 <b>주문할 때 쓴 휴대폰 번호</b>로 구매를 확인해요. 회원이면 로그인 후 바로 쓸 수 있어요.</p>
          <div class="row2">
            <label>접수번호<input name="code" maxlength="20" autocapitalize="characters" placeholder="예) O261030-7KQ2M9XA"></label>
            <label>휴대폰 번호<input name="phone" type="tel" maxlength="13" placeholder="010-0000-0000"></label>
          </div>
        </div>
        <p class="rv__msg" id="rvMsg" role="status"></p>
        <div class="rv__btns"><button type="button" class="btn btn--line" data-rvcancel>취소</button><button type="submit" class="btn btn--dark">후기 등록</button></div>
      </form>`;
  }

  // 로그인 안 했으면 접수번호 칸 보이기
  async function syncGuest() {
    const g = $("#rvGuest");
    if (!g) return;
    const { data: { session } } = await sb.auth.getSession();
    g.hidden = !!session;
    g.querySelectorAll("input").forEach(i => { i.required = !session; });
  }

  box.addEventListener("click", async e => {
    if (e.target.closest("[data-rvwrite]")) { writing = true; await window.renderReviews(cur, curOpts, true); syncGuest(); const t = $("#rvForm textarea"); t && t.focus(); return; }
    if (e.target.closest("[data-rvcancel]")) { writing = false; window.renderReviews(cur, curOpts, true); }
  });
  starsBox.addEventListener("click", e => {
    if (!e.target.closest("[data-rvjump]")) return;
    e.preventDefault();
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  box.addEventListener("submit", async e => {
    if (e.target.id !== "rvForm") return;
    e.preventDefault();
    const f = e.target, btn = f.querySelector("[type=submit]"), msg = $("#rvMsg");
    const guest = !$("#rvGuest").hidden;
    btn.disabled = true; msg.textContent = "확인 중…"; msg.classList.remove("is-error");
    const { data, error } = await sb.rpc("submit_review", {
      p_product: cur.id, p_rating: +f.rating.value, p_body: f.body.value,
      p_code: guest ? f.code.value : null, p_phone: guest ? f.phone.value : null,
    });
    btn.disabled = false;
    if (error || data !== "ok") {
      msg.textContent = error ? (/[가-힣]/.test(error.message || "") ? error.message : "등록하지 못했어요. 잠시 후 다시 시도해 주세요.") : data;
      msg.classList.add("is-error");
      return;
    }
    Object.keys(cache).forEach(k => delete cache[k]);
    writing = false;
    toast("후기를 등록했어요. 감사합니다!");
    window.renderReviews(cur, curOpts, true);
  });

  /* ---------- 재입고 알림 (품절 상품) ---------- */
  function renderAlert(p) {
    if (!alertBox) return;
    if (!p.sold_out) { alertBox.innerHTML = ""; return; }
    if (alertBox.dataset.pid === p.id && alertBox.innerHTML) return;
    alertBox.dataset.pid = p.id;
    alertBox.innerHTML = `
      <form class="restock" id="restockForm">
        <p class="restock__t"><b>재입고 알림 받기</b> 다시 들어오면 문자로 한 번 알려드려요.</p>
        <div class="restock__row"><input name="phone" type="tel" inputmode="tel" maxlength="13" placeholder="휴대폰 번호" required aria-label="휴대폰 번호"><button type="submit" class="btn btn--dark">알림 신청</button></div>
        <label class="check restock__agree"><input type="checkbox" name="agree" required> <span>재입고 문자 발송을 위해 휴대폰 번호를 수집·이용하는 데 동의해요 (알림 후 30일 안에 삭제)</span></label>
      </form>`;
  }
  alertBox && alertBox.addEventListener("submit", async e => {
    if (e.target.id !== "restockForm") return;
    e.preventDefault();
    const f = e.target, btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    const { error } = await sb.rpc("request_restock", { p_product: cur.id, p_phone: f.phone.value });
    btn.disabled = false;
    if (error) { toast(/[가-힣]/.test(error.message || "") ? error.message : "신청하지 못했어요. 잠시 후 다시 시도해 주세요"); return; }
    f.outerHTML = `<p class="restock restock--done">✓ 재입고 알림을 신청했어요. 다시 들어오면 문자로 알려드릴게요.</p>`;
  });
})();
