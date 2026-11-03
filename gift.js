/* 순금선물 목록: 분류 탭 · 정렬 · 상품 카드 · 상담 창
   가격: 아래 price 는 순금 1돈 살 때 BASE 원일 때의 판매가.
         시세가 바뀌면 같은 비율로 자동 조정 (1,000원 단위) */
(function () {
  const Y = window.YAMOO;
  const $ = s => document.querySelector(s);
  const PHONE = "010-5287-8002";
  const BASE = 756700; // 2026.11.03 순금 1돈 살 때 (가격 맞춘 기준)

  const CATS = { all: "전체", dol: "돌반지", necklace: "돌목걸이", bracelet: "돌팔찌", key: "행운의 열쇠", bar: "기념 골드바", plaque: "감사패" };
  const P = [
    { id: "dol-half", cat: "dol", art: "ring", name: "순금 돌반지 반돈", w: 1.875, price: 436000, best: true, desc: "복(福)·수(壽) 글자 또는 띠 디자인. 안쪽에 아이 이름·날짜 각인." },
    { id: "dol-1", cat: "dol", art: "ring", name: "순금 돌반지 한돈", w: 3.75, price: 817000, best: true, desc: "가장 많이 찾는 돌반지. 복(福)·수(壽)·띠 디자인, 이름·날짜 각인." },
    { id: "neck-1", cat: "necklace", art: "necklace", name: "순금 돌목걸이 한돈", w: 3.75, price: 942000, desc: "띠 펜던트 돌목걸이. 아이 목에 맞는 길이 줄 포함." },
    { id: "brace-1", cat: "bracelet", art: "bracelet", name: "순금 돌팔찌 한돈", w: 3.75, price: 942000, desc: "아기 손목 크기 순금 팔찌. 이름 각인 가능." },
    { id: "key-1g", cat: "key", art: "key", name: "행운의 열쇠 1g", w: 1, price: 227000, desc: "개업·취업·이사 선물용 순금 열쇠. 케이스 포함." },
    { id: "key-half", cat: "key", art: "key", name: "행운의 열쇠 반돈", w: 1.875, price: 405000, desc: "개업·취업·이사 선물용 순금 열쇠. 케이스 포함." },
    { id: "key-1", cat: "key", art: "key", name: "행운의 열쇠 한돈", w: 3.75, price: 788000, best: true, desc: "가장 많이 찾는 중량. 문구·이름 각인, 케이스 포함." },
    { id: "key-2", cat: "key", art: "key", name: "행운의 열쇠 두돈", w: 7.5, price: 1572000, desc: "문구·이름 각인, 고급 케이스 포함." },
    { id: "key-3", cat: "key", art: "key", name: "행운의 열쇠 세돈", w: 11.25, price: 2273000, desc: "문구·이름 각인, 고급 케이스 포함." },
    { id: "key-5", cat: "key", art: "key", name: "행운의 열쇠 다섯돈", w: 18.75, price: 3789000, desc: "정년퇴임·공로 기념용. 액자형 가능." },
    { id: "key-10", cat: "key", art: "key", name: "행운의 열쇠 열돈", w: 37.5, price: null, desc: "주문 제작 상품이에요. 전화로 문의해 주세요." },
    { id: "bar-1", cat: "bar", art: "bar", name: "기념 각인 골드바 한돈", w: 3.75, price: 788000, desc: "승진·결혼·환갑 기념. 앞면에 원하는 문구 각인." },
    { id: "bar-3", cat: "bar", art: "bar", name: "기념 각인 골드바 세돈", w: 11.25, price: 2273000, desc: "원하는 문구·날짜 각인, 고급 케이스 포함." },
    { id: "bar-5", cat: "bar", art: "bar", name: "기념 각인 골드바 다섯돈", w: 18.75, price: 3789000, desc: "원하는 문구·날짜 각인, 고급 케이스 포함." },
    { id: "bar-10", cat: "bar", art: "bar", name: "기념 각인 골드바 열돈", w: 37.5, price: null, desc: "주문 제작 상품이에요. 전화로 문의해 주세요." },
    { id: "plaque-key", cat: "plaque", art: "plaque", name: "순금 열쇠 감사패", w: null, price: null, desc: "원목 패에 순금 열쇠 장식. 순금 중량·문안은 상담으로 정해요." },
    { id: "plaque-wood", cat: "plaque", art: "plaque", name: "원목 순금 감사패", w: null, price: null, desc: "공로패·재직기념패. 순금 장식 중량·문안은 상담으로 정해요." },
  ];
  P.forEach((p, i) => { p.order = i; });

  let ratio = 1, cat = "all", sort = "rec";
  const priceOf = p => p.price == null ? null : Math.round(p.price * ratio / 1000) * 1000;
  const wText = w => w == null ? "중량 선택" : `${w}g` + (w >= 1.875 ? ` (${Math.round(w / Y.DON * 100) / 100}돈)` : "");
  const art = a => `<svg viewBox="0 0 200 200" aria-hidden="true"><use href="#art-${a}"/></svg>`;

  function render() {
    let list = P.filter(p => cat === "all" || p.cat === cat);
    if (sort === "low" || sort === "high") {
      const v = p => priceOf(p) ?? (sort === "low" ? Infinity : -Infinity);
      list = list.slice().sort((a, b) => sort === "low" ? v(a) - v(b) : v(b) - v(a));
    }
    $("#giftCount").innerHTML = `총 <b>${list.length}</b>개 상품`;
    $("#giftGrid").innerHTML = list.map(p => {
      const pr = priceOf(p);
      return `
        <li class="gcard">
          <button type="button" class="gcard__btn" data-gid="${p.id}">
            <span class="gcard__img">${art(p.art)}${p.best ? '<em class="gcard__badge">BEST</em>' : ""}</span>
            <span class="gcard__name">${Y.esc(p.name)}</span>
            <span class="gcard__w">순금 24K · ${wText(p.w)}</span>
            <span class="gcard__price">${pr ? `<strong>${Y.won(pr)}</strong>` : `<strong class="ask">전화문의</strong>`}</span>
          </button>
        </li>`;
    }).join("");
    document.querySelectorAll("#giftCats button").forEach(b => {
      const on = b.dataset.cat === cat;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on);
    });
  }

  function setCat(c, push) {
    cat = CATS[c] ? c : "all";
    render();
    if (push) history.replaceState(null, "", cat === "all" ? location.pathname : "#" + cat);
  }

  $("#giftCats").innerHTML = Object.entries(CATS).map(([k, v]) => `<button type="button" role="tab" data-cat="${k}">${v}</button>`).join("");
  $("#giftCats").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (b) setCat(b.dataset.cat, true); });
  $("#giftSort").addEventListener("change", e => { sort = e.target.value; render(); });
  window.addEventListener("hashchange", () => setCat(location.hash.slice(1)));
  setCat(location.hash.slice(1));

  /* 상품 상담 창 */
  const modal = $("#giftModal");
  const close = () => { modal.hidden = true; document.body.style.overflow = ""; };
  modal.addEventListener("click", e => { if (e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) close(); });
  $("#giftGrid").addEventListener("click", e => {
    const b = e.target.closest("[data-gid]");
    if (!b) return;
    const p = P.find(x => x.id === b.dataset.gid), pr = priceOf(p);
    const sms = "sms:" + PHONE + "?body=" + encodeURIComponent(`[${p.name} 문의] `);
    $("#giftModalBody").innerHTML = `
      <div class="gm__img">${art(p.art)}</div>
      <div class="gm__info">
        <p class="gm__cat">${CATS[p.cat]}</p>
        <h2 class="modal__title" id="giftModalTitle">${Y.esc(p.name)}</h2>
        <p class="gm__price">${pr ? Y.won(pr) : "전화문의"}</p>
        <table class="pinfo__tbl"><tbody>
          <tr><th scope="row">소재 · 순도</th><td>순금 24K (Au 999.9)</td></tr>
          <tr><th scope="row">중량</th><td>${wText(p.w)}</td></tr>
          <tr><th scope="row">구성</th><td>보증서 · 선물 케이스</td></tr>
          <tr><th scope="row">제조국</th><td>한국</td></tr>
        </tbody></table>
        <p class="gm__desc">${Y.esc(p.desc)}</p>
        <p class="gift-note">${pr ? "* 판매가는 오늘 금 시세에 맞춰 바뀌어요. 주문하는 날 금액으로 확정해 안내해 드려요." : "* 디자인·중량에 따라 금액이 달라져 상담 후 안내해 드려요."} 각인 문구는 상담할 때 알려 주세요.</p>
        <div class="gift-cta"><a class="btn btn--dark" href="tel:${PHONE}">전화 주문 · 상담</a><a class="btn btn--line" href="${sms}">문자 문의</a></div>
      </div>`;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  });

  /* 오늘 시세 비율 (화면에 시세는 안 보여주고 가격 계산에만 사용) */
  async function loadRate() {
    try {
      const [live, s] = await Promise.all([Y.fetchLive(), Y.fetchSettings()]);
      const don = Y.computeDomestic(live, s).items.find(i => i.key === "24k").buy;
      if (don > 0) { ratio = don / BASE; render(); }
    } catch (e) { /* 시세를 못 받으면 기준 가격 그대로 표시 */ }
  }
  loadRate();
  setInterval(loadRate, 60000);
})();
