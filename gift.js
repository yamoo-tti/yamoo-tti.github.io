/* 순금선물 목록: 관리자 > 상품 관리의 '순금선물' 상품을 시세 그대로 보여주고 장바구니·구매 (주문 창은 shop.js) */
(function () {
  const Y = window.YAMOO;
  const $ = s => document.querySelector(s);
  const PHONE = "010-5287-8002";
  const CATS = { all: "전체", goods: "순금 기념품", dol: "돌선물", key: "행운의 열쇠", memo: "기념 골드바", plaque: "감사패" };
  const ALIAS = { bar: "memo" }; // 예전 주소(gift.html#bar) 호환

  let products = [], stats = {}, domestic = null, cat = "all", sort = "rec";
  const imgSrc = p => /^https?:\/\//.test(p.img || "") ? p.img : `images/${p.img || "bar-close.jpg"}`;
  const priceOf = p => domestic ? Y.productPrice(p, domestic) : null;
  const wText = w => `${w}g` + (w >= 1.875 ? ` (${Math.round(w / Y.DON * 100) / 100}돈)` : "");

  // shop.js(주문·장바구니)가 쓰는 정보
  window.SHOP = { find: id => products.find(p => p.id === id), price: p => priceOf(p) };
  let tt;
  window.toast = m => { const t = $("#toast"); t.textContent = m; t.classList.add("is-show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("is-show"), 2400); };

  const plaqueCard = () => `
    <li class="gcard gcard--ask">
      <div class="gcard__img"><img src="images/gift/plaque.svg" alt="순금 감사패" loading="lazy"></div>
      <p class="gcard__name">순금 감사패 · 공로패 (주문 제작)</p>
      <p class="gcard__w">원목·크리스탈 패 + 순금 장식</p>
      <p class="gcard__price"><strong class="ask">전화문의</strong></p>
      <div class="gcard__btns"><a class="gbtn gbtn--buy" href="tel:${PHONE}">전화 상담</a></div>
    </li>`;

  // 옵션(1g · 1돈 · 2돈 …)이 있는 상품은 카드 하나에 옵션 버튼으로
  let chosen = {}, shownGroups = [], tagOfNow = p => p.tag || "";
  const optChips = (opts, p) => opts.length < 2 ? "" : `<div class="optchips" role="group" aria-label="옵션 선택">${opts.map(o =>
    `<button type="button" data-opt="${o.id}" class="${o.id === p.id ? "is-on" : ""}${o.sold_out ? " is-out" : ""}" aria-pressed="${o.id === p.id}">${Y.esc(Y.optLabel(o))}</button>`).join("")}</div>`;
  function cardHtml(opts) {
    const p = Y.optPick(opts, chosen[opts[0].opt_group]), pr = priceOf(p), off = p.sold_out ? "disabled" : "";
    const tag = opts.map(tagOfNow).find(Boolean);
    const title = Y.optTitle(opts, p);
    return `
        <li class="gcard${p.sold_out ? " is-soldout" : ""}" data-gkey="${Y.esc(opts[0].id)}">
          <div class="gcard__img">
            <img src="${Y.esc(imgSrc(p))}" alt="${Y.esc(title)}" loading="lazy">
            ${p.sold_out ? '<em class="gcard__badge gcard__badge--out">품절</em>' : tag ? `<em class="gcard__badge">${Y.esc(tag)}</em>` : ""}
          </div>
          <p class="gcard__name">${Y.esc(title)}</p>
          ${optChips(opts, p)}
          <p class="gcard__w">순금 24K · ${wText(Number(p.weight_g))}</p>
          <p class="gcard__price"><strong>${pr ? Y.won(pr) : "시세 확인 중"}</strong></p>
          <button type="button" class="info-link" data-ginfo="${p.id}">상품정보 제공고시</button>
          <div class="gcard__btns">
            <button type="button" class="gbtn" data-gcart="${p.id}" ${off}>장바구니</button>
            <button type="button" class="gbtn gbtn--buy" data-gbuy="${p.id}" ${off}>${p.sold_out ? "품절" : "바로 구매"}</button>
          </div>
        </li>`;
  }

  function render() {
    const ranked = Y.rankProducts(products.filter(p => p.kind === "gift"), stats);
    const tagOf = p => p.tag || (ranked.best.has(p.id) ? "BEST" : "");
    tagOfNow = tagOf;
    let list = ranked.list.filter(p => cat === "all" || p.category === cat);
    let groups = Y.groupOptions(list);
    if (sort !== "rec") {
      const v = o => priceOf(Y.optPick(o, chosen[o[0].opt_group])) ?? 0;
      groups = groups.slice().sort((a, b) => sort === "low" ? v(a) - v(b) : v(b) - v(a));
    }
    shownGroups = groups;
    const showPlaque = cat === "all" || cat === "plaque";
    $("#giftCount").innerHTML = `총 <b>${groups.length + (showPlaque ? 1 : 0)}</b>개 상품`;
    $("#giftGrid").innerHTML = groups.map(cardHtml).join("") + (showPlaque ? plaqueCard() : "");
    document.querySelectorAll("#giftCats button").forEach(b => {
      const on = b.dataset.cat === cat;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on);
    });
  }

  function setCat(c, push) {
    c = ALIAS[c] || c;
    cat = CATS[c] ? c : "all";
    render();
    if (push) history.replaceState(null, "", cat === "all" ? location.pathname : "#" + cat);
  }

  $("#giftCats").innerHTML = Object.entries(CATS).map(([k, v]) => `<button type="button" role="tab" data-cat="${k}">${v}</button>`).join("");
  $("#giftCats").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (b) setCat(b.dataset.cat, true); });
  $("#giftSort").addEventListener("change", e => { sort = e.target.value; render(); });
  window.addEventListener("hashchange", () => setCat(location.hash.slice(1)));

  $("#giftGrid").addEventListener("click", e => {
    const find = attr => { const b = e.target.closest(`[${attr}]`); return b && products.find(p => p.id === b.getAttribute(attr)); };
    let p;
    if ((p = find("data-opt"))) {
      const card = e.target.closest("[data-gkey]"), opts = shownGroups.find(o => o[0].id === card.dataset.gkey);
      if (!opts) return;
      chosen[opts[0].opt_group] = p.id;
      card.outerHTML = cardHtml(opts);
      return;
    }
    if ((p = find("data-ginfo"))) return window.openInfo && window.openInfo(p);
    if ((p = find("data-gcart"))) return window.addToCart && window.addToCart(p);
    if ((p = find("data-gbuy"))) return window.openOrder && window.openOrder(p);
  });

  async function loadPrices() {
    try {
      const [live, s] = await Promise.all([Y.fetchLive(), Y.fetchSettings()]);
      domestic = Y.computeDomestic(live, s);
      render();
    } catch (e) { /* 시세를 못 받으면 '시세 확인 중' 표시 */ }
  }
  async function loadProducts() {
    if (!Y.sb) return;
    const { data, error } = await Y.sb.from("products").select("*").eq("visible", true).order("sort").order("created_at");
    if (!error && data) { products = data; stats = await Y.loadStats(); render(); }
  }
  setCat(location.hash.slice(1));
  loadProducts();
  loadPrices();
  setInterval(loadPrices, 60000);
})();
