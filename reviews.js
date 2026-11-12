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
  // 주문내역의 '후기 쓰기'로 들어오면(?p=상품&review=1) 쓰기 칸을 바로 엶
  let autoWrite = new URLSearchParams(location.search).get("review") === "1";

  // 로그인·로그아웃하면 "내 후기" 표시가 바뀌니 다시 불러옴
  sb.auth.onAuthStateChange(ev => {
    if (ev !== "SIGNED_IN" && ev !== "SIGNED_OUT") return;
    Object.keys(cache).forEach(k => delete cache[k]);
    if (cur && !box.hidden) window.renderReviews(cur, curOpts, true);
  });

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
    if (autoWrite) { autoWrite = false; writing = true; force = true; setTimeout(() => box.scrollIntoView({ behavior: "smooth", block: "start" }), 400); }
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
      ${writing ? formHtml(typeof writing === "object" ? writing : null) : ""}
      ${list.some(r => r.gift) ? `<p class="rv__disc">‘쿠폰 지급 후기’는 후기를 쓴 회원께 감사 쿠폰을 드린 후기예요. 별점·내용과 관계없이 똑같이 드리며, 후기를 고르거나 숨기지 않아요.</p>` : ""}
      ${n ? `<ul class="rv__list">${list.map(r => `
        <li class="rv">
          <div class="rv__top">${stars(r.rating)}<b>${esc(r.name)}</b><time>${fmtDate(r.created_at, false)}${r.edited ? " · 수정됨" : ""}</time>${r.gift ? `<span class="rv__giftTag" title="후기 작성 후 쿠폰을 받은 후기예요">쿠폰 지급 후기</span>` : ""}${r.mine ? `<span class="rv__mine">내 후기</span><button type="button" class="rv__edit" data-rvedit="${r.id}">수정</button>` : ""}</div>
          ${r.option_label ? `<p class="rv__opt">${esc(r.option_label)}</p>` : ""}
          <p class="rv__body">${esc(r.body)}</p>
          ${(r.photos || []).length ? `<div class="rv__photos">${r.photos.map(p => `<img src="${esc(photoUrl(p))}" alt="후기 사진" loading="lazy">`).join("")}</div>` : ""}
          ${r.reply ? `<div class="rv__reply"><b>금비 GOLD 답글</b><p>${esc(r.reply)}</p></div>` : ""}
        </li>`).join("")}</ul>`
        : `<p class="rv__empty">아직 후기가 없어요. 구매하신 분은 첫 후기를 남겨 주세요.</p>`}`;
    if (writing) drawThumbs();
  };

  /* ---------- 사진 후기 (최대 3장, 올리기 전에 긴 변 1600px JPEG로 줄임) ---------- */
  let photoState = []; // { path?: 이미 올린 사진, file?: 새로 고른 사진, url: 미리보기 }
  const photoUrl = p => sb.storage.from("review-photos").getPublicUrl(p).data.publicUrl;
  function drawThumbs() {
    const el = $("#rvThumbs");
    if (!el) return;
    el.innerHTML = photoState.map((p, i) => `<span class="rv__thumb"><img src="${esc(p.url)}" alt="첨부 사진 ${i + 1}"><button type="button" data-rvrm="${i}" aria-label="사진 ${i + 1} 빼기">×</button></span>`).join("")
      + (photoState.length < 3 ? `<button type="button" class="rv__add" data-rvadd aria-label="사진 추가">＋<small>${photoState.length}/3</small></button>` : "");
  }
  async function shrink(file) {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
    const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return await new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error("blob")), "image/jpeg", 0.85));
  }
  // 새 사진을 올리고, 남길 사진 전체의 경로 목록을 돌려줌
  async function uploadPhotos(msg) {
    if (!photoState.some(p => p.file)) return photoState.map(p => p.path);
    const { data: { session } } = await sb.auth.getSession();
    const uid = session.user.id, out = [];
    for (let i = 0; i < photoState.length; i++) {
      const p = photoState[i];
      if (p.path) { out.push(p.path); continue; }
      msg.textContent = `사진 올리는 중… (${i + 1}/${photoState.length})`;
      const blob = await shrink(p.file);
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await sb.storage.from("review-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      p.path = path; delete p.file;
      out.push(path);
    }
    return out;
  }

  // ed: 고칠 내 후기 (없으면 새 후기)
  function formHtml(ed) {
    const many = curOpts.length > 1, rate = ed ? ed.rating : 5;
    return `
      <form class="rv__form auth-form" id="rvForm"${ed ? ` data-edit="${ed.id}"` : ""}>
        <p class="rv__for">${ed ? "<b>내 후기 수정</b> · 별점과 내용을 고칠 수 있어요." : many ? `<b>${esc(window.YAMOO.optLabel(cur))}</b> 옵션의 후기를 써요. 다른 중량을 사셨다면 위에서 먼저 골라 주세요. <small>(주문 1건당 후기 1개)</small>` : `<b>${esc(cur.name)}</b> <small>(주문 1건당 후기 1개)</small>`}</p>
        <p class="rv__label">별점</p>
        <fieldset class="rv__rate"><legend class="sr-only">별점</legend>
          ${[5, 4, 3, 2, 1].map(v => `<input type="radio" name="rating" value="${v}" id="rv${v}" ${v === rate ? "checked" : ""}><label for="rv${v}" title="${v}점">★</label>`).join("")}
        </fieldset>
        <label>후기 <small>10자 이상 · 받아 보신 느낌, 실물·포장 상태 등</small><textarea name="body" rows="4" minlength="10" maxlength="1000" required>${ed ? esc(ed.body) : ""}</textarea></label>
        <div class="rv__photoField"><p class="rv__label">사진 <small>선택 · 최대 3장 · 실물·착용 사진을 올려 주시면 다른 손님께 큰 도움이 돼요</small></p>
          <div class="rv__thumbs" id="rvThumbs"></div>
          <input type="file" id="rvFile" accept="image/*" multiple hidden></div>
        <p class="rv__msg" id="rvMsg" role="status"></p>
        <div class="rv__btns"><button type="button" class="btn btn--line" data-rvcancel>취소</button><button type="submit" class="btn btn--dark">${ed ? "수정 완료" : "후기 등록"}</button></div>
      </form>`;
  }

  // 후기는 로그인한 회원만 (비회원은 로그인 창으로 안내)
  const loggedIn = async () => { try { const { data: { session } } = await sb.auth.getSession(); return !!session; } catch { return false; } };
  function askLogin() {
    toast("후기는 회원만 쓸 수 있어요. 로그인해 주세요");
    const b = document.querySelector('#authNav [data-open="login"]');
    if (b) b.click();
  }

  box.addEventListener("click", async e => {
    if (e.target.closest("[data-rvwrite]")) {
      if (!(await loggedIn())) { askLogin(); return; }
      photoState = []; writing = true; await window.renderReviews(cur, curOpts, true); const t = $("#rvForm textarea"); t && t.focus(); return;
    }
    if (e.target.closest("[data-rvcancel]")) { writing = false; window.renderReviews(cur, curOpts, true); }
    if (e.target.closest("[data-rvadd]")) { $("#rvFile").click(); return; }
    const rm = e.target.closest("[data-rvrm]");
    if (rm) { photoState.splice(+rm.dataset.rvrm, 1); drawThumbs(); return; }
    const ed = e.target.closest("[data-rvedit]");
    if (ed) {
      const list = cache[curOpts.map(o => o.id).join(",")] || [];
      const r = list.find(x => String(x.id) === ed.dataset.rvedit);
      if (!r) return;
      photoState = (r.photos || []).map(path => ({ path, url: photoUrl(path) }));
      writing = r; await window.renderReviews(cur, curOpts, true);
      box.scrollIntoView({ behavior: "smooth", block: "start" });
      const t = $("#rvForm textarea"); t && t.focus();
    }
  });
  box.addEventListener("change", e => {
    if (e.target.id !== "rvFile") return;
    const files = [...e.target.files].filter(f => /^image\//.test(f.type));
    const room = 3 - photoState.length;
    if (files.length > room) toast("사진은 3장까지 올릴 수 있어요");
    files.slice(0, Math.max(0, room)).forEach(file => photoState.push({ file, url: URL.createObjectURL(file) }));
    e.target.value = "";
    drawThumbs();
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
    if (!(await loggedIn())) { askLogin(); return; }
    btn.disabled = true; msg.textContent = "확인 중…"; msg.classList.remove("is-error");
    const editId = f.dataset.edit;
    let paths;
    try { paths = await uploadPhotos(msg); }
    catch { btn.disabled = false; msg.textContent = "사진을 올리지 못했어요. 사진을 빼고 다시 시도하거나 잠시 후 다시 해 주세요."; msg.classList.add("is-error"); return; }
    msg.textContent = "등록 중…";
    const { data, error } = editId
      ? await sb.rpc("update_my_review", { p_id: +editId, p_rating: +f.rating.value, p_body: f.body.value, p_photos: paths })
      : await sb.rpc("submit_review", { p_product: cur.id, p_rating: +f.rating.value, p_body: f.body.value, p_photos: paths });
    btn.disabled = false;
    if (error || !/^ok/.test(data || "")) {
      msg.textContent = error ? (/[가-힣]/.test(error.message || "") ? error.message : "등록하지 못했어요. 잠시 후 다시 시도해 주세요.") : data;
      msg.classList.add("is-error");
      return;
    }
    Object.keys(cache).forEach(k => delete cache[k]);
    writing = false;
    const cp = /^ok_coupon:(\d+)/.exec(data);
    if (cp) {
      const amt = Number(cp[1]).toLocaleString() + "원";
      window.renderReviews(cur, curOpts, true).then(() => {
        box.insertAdjacentHTML("afterbegin", `<div class="rv__gift">🎁 후기 감사 쿠폰 <b>${amt}</b>을 드렸어요! <a href="my-orders.html#benefits">내 쿠폰 보기</a> · 다음 홈페이지 주문 때 쓸 수 있어요.</div>`);
      });
      toast(`후기 등록 완료! ${amt} 쿠폰을 드렸어요`);
      return;
    }
    toast(editId ? "후기를 수정했어요" : "후기를 등록했어요. 감사합니다!");
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
