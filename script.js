/* =========================================================
   홈페이지 — 실시간 시세 기반
   국제 시세·실시간 환율(gold-api.com) → 국내 3.75g 시세
   마진은 관리자 페이지 > 시세 설정 값을 사용 (미설정 시 기본값)
   ========================================================= */
const { fetchLive, fetchSettings, computeDomestic, productPrice, esc, won, fmtDate, DON } = window.YAMOO;

// 상품 목록은 관리자 페이지 > 상품 관리(DB)에서 불러옴.
// DB 연결 전에는 아래 기본 목록을 사용 (setup.sql 초기 상품과 동일)
const P = (kind, name, weight_g, img, extra = {}) => ({ id: null, kind, name, weight_g, img, karat: "24K", premium_pct: 0, labor: 0, sold_out: false, ...extra });
const FALLBACK_PRODUCTS = [
  P("bar", "GBK 순금 골드바 1g", 1, "gbk/bar-1g.webp", { premium_pct: 8, tag: "입문용" }),
  P("bar", "GBK 순금 골드바 1.875g (반돈)", 1.875, "gbk/bar-1_875g.webp", { premium_pct: 6.42 }),
  P("bar", "GBK 순금 골드바 3.75g", 3.75, "gbk/bar-3_75g.webp", { premium_pct: 4, tag: "BEST" }),
  P("bar", "GBK 순금 골드바 7.5g (두돈)", 7.5, "gbk/bar-7_5g.webp", { premium_pct: 3.08 }),
  P("bar", "GBK 순금 골드바 10g", 10, "gbk/bar-10g.webp", { premium_pct: 3 }),
  P("bar", "GBK 순금 골드바 11.25g (세돈)", 11.25, "gbk/bar-11_25g.webp", { premium_pct: -0.67 }),
  P("bar", "GBK 순금 골드바 18.75g", 18.75, "gbk/bar-18_75g.webp", { premium_pct: 2.5 }),
  P("bar", "GBK 순금 골드바 37.5g", 37.5, "gbk/bar-37_5g.webp", { premium_pct: 2, tag: "선물 추천" }),
  P("bar", "GBK 순금 골드바 100g", 100, "gbk/bar-100g.webp", { premium_pct: 1.5 }),
  ...[["쥐띠", 10], ["소띠", 2], ["호랑이띠", 9], ["토끼띠", 6], ["용띠", 7], ["뱀띠", 4], ["말띠", 5], ["양띠", 1],
      ["원숭이띠", 11], ["닭띠", 8], ["개띠", 13], ["돼지띠", 12], ["부엉이", 3]]
    .map(([n, i]) => P("zodiac", n, 1, `gbk/zodiac-${String(i).padStart(2, "0")}.webp`, { premium_pct: 10, tag: n === "부엉이" ? "스페셜" : null })),
  P("silver", "실버바 500g", 500, "silver/bar-500g.jpg", { premium_pct: 3, tag: "BEST" }),
  P("silver", "은 그래뉼 100g", 100, "silver/granule-100g.jpg", { premium_pct: 6 }),
  P("silver", "은 그래뉼 1kg", 1000, "silver/granule-1kg.jpg", { premium_pct: 3 }),
];

const $ = s => document.querySelector(s);
const round100 = n => Math.round(n / 100) * 100;

let state = { live: null, domestic: null, products: FALLBACK_PRODUCTS };
const item = key => state.domestic.items.find(i => i.key === key);
const ofKind = k => state.products.filter(p => p.kind === k);
// 악세사리 칸: 주얼리 + 순금 콩알금(순금선물이지만 같이 보여줌)
const accList = () => state.products.filter(p => p.kind === "accessory" || p.opt_group === "순금 콩알금");
const priceOf = p => productPrice(p, state.domestic);
const imgSrc = p => /^https?:\/\//.test(p.img || "") ? p.img : `images/${p.img || "bar-close.jpg"}`;
const donLabel = g => { const d = g / DON; return Number.isInteger(Math.round(d * 1000) / 1000) && d >= 1 ? `${Math.round(d)}돈` : ""; };

// 홈페이지 주문 창(shop.js)에서 쓰는 정보
window.SHOP = { find: id => state.products.find(p => p.id === id), price: p => state.domestic ? priceOf(p) : null };

async function loadProducts() {
  const sb = window.YAMOO.sb;
  if (!sb) return;
  const { data, error } = await sb.from("products").select("*").eq("visible", true).order("sort").order("created_at");
  if (error || !data || !data.length) return; // 실패하면 기본 목록 유지
  state.products = data;
  state.stats = await window.YAMOO.loadStats();
  if (state.domestic) { renderBars(); renderProducts(currentFilter); }
}

/* ---------- 시세 불러오기 ---------- */
const CACHE_KEY = "yamoo_live_v1";
function loadCache() { try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); if (c) c.updatedAt = new Date(c.updatedAt); return c; } catch { return null; } }
function saveCache(live) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(live)); } catch {} }

let settings = null;
async function refresh() {
  const dot = $("#liveDot");
  dot.className = "live-dot is-loading";
  try {
    if (!settings) settings = await fetchSettings();
    const live = await fetchLive();
    saveCache(live);
    apply(live);
    dot.className = "live-dot";
  } catch (e) {
    console.warn("시세 조회 실패", e);
    dot.className = "live-dot is-error";
    if (!state.live) {
      const cached = loadCache();
      if (cached) { apply(cached); $("#priceTime").textContent += " (지연)"; }
      else $("#priceTime").textContent = "시세를 불러오지 못했습니다";
    }
  }
}

function apply(live) {
  state.live = live;
  state.domestic = computeDomestic(live, settings || window.YAMOO.DEFAULT_SETTINGS);
  $("#priceTime").textContent = fmtDate(live.updatedAt);
  renderPriceTable();
  renderIntl();
  renderTicker();
  updateCalc();
  renderBars();
  renderProducts(currentFilter);
}

/* ---------- 국제 시세 (원화 1돈 환산) ---------- */
const usdFmt = v => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const donWon = sym => window.YAMOO.perDon(state.live, sym);
// 국내 판매가와 비교해 오해가 없도록 국제 시세도 부가세(10%) 포함 금액을 크게 표시
const donWonVat = sym => donWon(sym) * window.YAMOO.VAT;
// 은은 1돈 대신 1g 가격으로 표시
const intlVal = sym => sym === "XAG" ? [won(donWonVat(sym) / DON), "1g · VAT 포함"] : [won(donWonVat(sym)), "1돈 · VAT 포함"];
function renderIntl() {
  if (!$("#intl")) return; // 국제 시세 카드는 손님 화면에서 뺌
  const { usd, krw } = state.live;
  const metals = [["금", "XAU"], ["은", "XAG"], ["백금", "XPT"], ["팔라듐", "XPD"]];
  $("#intl").innerHTML = metals.map(([n, s]) => `
    <div class="intl__card">
      <p class="intl__name">국제 ${n} <span>${intlVal(s)[1]}</span></p>
      <p class="intl__val num">${intlVal(s)[0]}</p>
      <p class="intl__sub num">${usdFmt(usd[s])}/oz</p>
    </div>`).join("") + `
    <div class="intl__card">
      <p class="intl__name">원/달러 <span>실시간</span></p>
      <p class="intl__val num">${krw.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원</p>
      <p class="intl__sub">1달러 기준</p>
    </div>`;
}

function renderTicker() {
  const g = item("24k");
  const items = [
    ["순금 살 때", won(g.buy), "3.75g", true],
    ["순금 팔 때", won(g.sell), "3.75g", true],
    ["18K 팔 때", won(item("18k").sell), "3.75g"],
    ["14K 팔 때", won(item("14k").sell), "3.75g"],
    ["백금 살 때", won(item("pt").buy), "3.75g"],
    ["은 살 때", won(item("ag").buy / DON), "1g"],
  ];
  const html = items.map(([n, v, u, gold]) => `<div class="ticker__item${gold ? " is-gold" : ""}"><span>${n}</span><b class="num">${v}</b><em>${u}</em></div>`).join("");
  const track = $("#ticker");
  track.innerHTML = html + html; // 끊김 없는 스크롤용 복제
  track.classList.add("is-running");
}

/* ---------- 국내 시세표 ---------- */
function renderPriceTable() {
  // 은은 1g 가격으로 표시 (나머지는 3.75g 기준)
  const per = i => i.key === "ag" ? v => Math.round(v / DON) : v => v;
  $("#priceBody").innerHTML = state.domestic.items.map(i => `
    <tr class="${i.key === "24k" ? "is-main" : ""}">
      <td class="item">${i.name}<small>${i.sub}${i.key === "ag" ? " · <b>1g 기준</b>" : ""}</small></td>
      <td>${i.buy ? `<span class="val">${per(i)(i.buy).toLocaleString("ko-KR")}</span>` : `<span class="na">제품시세 적용</span>`}</td>
      <td><span class="val">${per(i)(i.sell).toLocaleString("ko-KR")}</span></td>
    </tr>`).join("");
}
$("#refreshBtn").addEventListener("click", refresh);

/* ---------- 계산기 ---------- */
const calcSel = $("#calcItem");
calcSel.innerHTML = ["24k:순금 24K", "18k:18K", "14k:14K", "pt:백금", "ag:은"].map(s => { const [k, n] = s.split(":"); return `<option value="${k}">${n}</option>`; }).join("");
function updateCalc() {
  if (!state.domestic) return;
  const it = item(calcSel.value);
  const w = parseFloat($("#calcWeight").value) || 0;
  const don = $("#calcUnit").value === "g" ? w / DON : w;
  $("#calcBuy").textContent = it.buy ? won(round100(it.buy * don)) : "제품시세";
  $("#calcSell").textContent = won(round100(it.sell * don));
}
["#calcItem", "#calcWeight", "#calcUnit"].forEach(s => $(s).addEventListener("input", updateCalc));

/* ---------- 골드바 ---------- */
// 주문 버튼: DB 상품이면 id, 기본 목록이면 순번으로 찾음
const orderKey = p => p.id ? esc(p.id) : "idx:" + state.products.indexOf(p);
const orderAttr = p => `data-order="${orderKey(p)}"`;
const cartAttr = p => `data-cart="${orderKey(p)}"`;

const wLabel = w => w >= 1000 && w % 1000 === 0 ? `${w / 1000}kg` : `${w}g`;
const barSpec = b => b.kind === "silver"
  ? (b.name.includes("그래뉼") ? "Ag 999.9 · 그래뉼(알갱이) · 품질보증서" : "Ag 999.9 · 순은 실버바 · 품질보증서")
  : "Au 999.9 · GBK 정품 보증서 · 금비 공식 총판";

function barCard(b) {
  const price = priceOf(b), w = Number(b.weight_g), label = wLabel(w), don = b.kind === "silver" ? "" : donLabel(w);
  return `
      <article class="bar${b.kind === "silver" ? " bar--silver" : ""}${b.sold_out ? " is-soldout" : ""}">
        <div class="bar__img">
          <img src="${esc(imgSrc(b))}" alt="${esc(b.name)}" loading="lazy">
          <span class="bar__weight">${label}${don ? `<small>${don}</small>` : ""}</span>
          ${b.sold_out ? `<span class="bar__tag bar__tag--out">품절</span>` : b.tag ? `<span class="bar__tag">${esc(b.tag)}</span>` : ""}
        </div>
        <div class="bar__body">
          <h3 class="bar__name">${esc(b.name)}</h3>
          <p class="bar__spec">${barSpec(b)}</p>
          <p class="bar__price">${won(price)}</p>
          <p class="bar__unit">실시간 시세 연동</p>
          <button type="button" class="info-link" data-info="${orderKey(b)}">상품정보 제공고시</button>
          <div class="bar__btns">
            <button class="cart-btn" ${cartAttr(b)} ${b.sold_out ? "disabled" : ""}>장바구니</button>
            <button class="buy-btn" ${orderAttr(b)} ${b.sold_out ? "disabled" : ""}>${b.sold_out ? "품절" : "바로 구매"}</button>
          </div>
        </div>
      </article>`;
}

/* ---------- 간판 상품 칸 (콩알금 · 광폭 팔찌) ---------- */
// 콩알금: 관리자에서 묶음 이름이 '순금 콩알금'인 상품들 = 중량 옵션 (사진은 모든 옵션 사진을 함께 보여줌)
// 광폭 팔찌: 아래 상품 번호(id)의 상품들 = 중량 옵션. 디자인이 달라서 고른 상품의 사진만 보여줌
const BEAN = "순금 콩알금";
const BANGLE_IDS = [
  "c0af80ee-ee48-4d47-bb3e-89255607332c", // 남성 팔각 광폭 체인 순금 팔찌 20돈
  "aff480e7-b89c-493c-9db9-679f7144221e", // 팔각 광폭 체인 순금 팔찌 30돈
  "f5c6247a-71d3-438e-89f5-7ff03a553b3b", // 팔각 체인 콤비 순금 팔찌 50돈
  "77fd78d2-2c4a-45ce-b2a3-bdcef8dab42e", // 남성 팔각 광폭 체인 순금 팔찌 70돈
];
const byWeight = (a, b) => a.weight_g - b.weight_g;
const FEATURES = {
  bean: { opts: () => state.products.filter(p => p.opt_group === BEAN).sort(byWeight), sharePhotos: true },
  bangle: { opts: () => state.products.filter(p => BANGLE_IDS.includes(p.id)).sort(byWeight), sharePhotos: false, showName: true },
};
const featState = {}; // { bean: { pick, photo, gallery }, … }
// 사진: 상품 사진 + 관리자 '추가 사진'(한 줄에 하나)
const photosOf = p => [p.img, ...String(p.photos || "").split(/\r?\n/)].map(s => (s || "").trim()).filter(Boolean);
const photoSrc = s => /^https?:\/\//.test(s) ? s : `images/${s}`;
function renderFeature(key) {
  const box = document.querySelector(`[data-feature="${key}"]`), cfg = FEATURES[key];
  if (!box || !cfg) return;
  const st = featState[key] || (featState[key] = { pick: null, photo: null, gallery: [] });
  const f = n => box.querySelector(`[data-f="${n}"]`);
  const opts = cfg.opts();
  box.hidden = !opts.length;
  if (!opts.length || !state.domestic) return;
  const Y = window.YAMOO, p = Y.optPick(opts, st.pick), price = priceOf(p), w = Number(p.weight_g);
  const gallery = cfg.sharePhotos ? [...new Set([...photosOf(p), ...opts.flatMap(photosOf)])] : photosOf(p);
  const main = gallery.includes(st.photo) ? st.photo : gallery[0];
  const img = f("main");
  if (main && img.getAttribute("src") !== photoSrc(main)) img.src = photoSrc(main);
  img.alt = p.name;
  st.gallery = gallery;
  const many = gallery.length > 1;
  box.querySelectorAll("[data-bnav]").forEach(b => { b.hidden = !many; });
  f("count").hidden = !many;
  f("count").textContent = `${gallery.indexOf(main) + 1} / ${gallery.length}`;
  f("thumbs").innerHTML = gallery.length < 2 ? "" : gallery.map((s, i) =>
    `<button type="button" data-bphoto="${esc(s)}" class="${s === main ? "is-on" : ""}" aria-label="사진 ${i + 1}"><img src="${esc(photoSrc(s))}" alt="" loading="lazy"></button>`).join("");
  const sub = o => { const ow = Number(o.weight_g), l = Y.optLabel(o); return /g$/.test(l) ? `${Math.round(ow / DON * 100) / 100}돈` : `${ow}g`; };
  f("opts").style.setProperty("--n", Math.min(opts.length, 4));
  f("opts").innerHTML = opts.map(o => `
    <button type="button" class="bean-opt${o.id === p.id ? " is-on" : ""}" data-fopt="${esc(o.id)}" aria-pressed="${o.id === p.id}" ${o.sold_out ? "disabled" : ""}>
      <b>${esc(Y.optLabel(o))}</b><span>${sub(o)}</span><em>${o.sold_out ? "품절" : won(priceOf(o))}</em>
    </button>`).join("");
  f("sel").innerHTML = `<b>${esc(Y.optLabel(p))}</b> 선택 · ${/g$/.test(Y.optLabel(p)) ? sub(p) : `${w}g`}${cfg.showName ? `<br><small>${esc(p.name)}</small>` : ""}`;
  f("price").textContent = p.sold_out ? "품절" : won(price);
  const nn = Y.nightNote(p), ft = box.querySelector(".bean__foot span");
  if (ft) { ft.textContent = nn ? `${nn.short} · 1분마다 갱신` : "오늘 시세 기준 · 1분마다 갱신"; ft.classList.toggle("is-night", !!(nn && nn.on)); }
  const cart = f("cart"), buy = f("buy");
  cart.dataset.cart = orderKey(p); buy.dataset.order = orderKey(p); f("info").dataset.info = orderKey(p);
  cart.disabled = buy.disabled = !!p.sold_out;
  buy.textContent = p.sold_out ? "품절" : "바로 구매";
}
const renderFeatures = () => Object.keys(FEATURES).forEach(renderFeature);
const featKey = el => { const b = el.closest("[data-feature]"); return b && b.dataset.feature; };
document.addEventListener("click", e => {
  const key = featKey(e.target);
  if (!key) return;
  const st = featState[key] || (featState[key] = { pick: null, photo: null, gallery: [] });
  const o = e.target.closest("[data-fopt]");
  if (o) { st.pick = o.dataset.fopt; st.photo = null; renderFeature(key); return; }
  const ph = e.target.closest("[data-bphoto]");
  if (ph) { st.photo = ph.dataset.bphoto; renderFeature(key); return; }
  const nv = e.target.closest("[data-bnav]");
  if (nv) featStep(key, +nv.dataset.bnav);
});
// 큰 사진 넘기기 (화살표 · 손가락으로 밀기)
function featStep(key, d) {
  const st = featState[key];
  if (!st || st.gallery.length < 2) return;
  const src = document.querySelector(`[data-feature="${key}"] [data-f="main"]`).getAttribute("src");
  const at = Math.max(0, st.gallery.findIndex(s => photoSrc(s) === src));
  st.photo = st.gallery[(at + d + st.gallery.length) % st.gallery.length];
  renderFeature(key);
}
document.querySelectorAll("[data-feature] .bean__main").forEach(m => {
  let x0 = null;
  m.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
  m.addEventListener("touchend", e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) featStep(featKey(m), dx < 0 ? 1 : -1);
  });
});

function renderBars() {
  renderFeatures();
  $("#bars").innerHTML = ofKind("bar").map(barCard).join("");
  // 실버: 은 그래뉼을 앞에, 실버바를 맨 뒤에 (같은 종류끼리는 원래 순서 유지)
  const silver = ofKind("silver").sort((a, b) => a.name.includes("그래뉼") ? (b.name.includes("그래뉼") ? 0 : -1) : (b.name.includes("그래뉼") ? 1 : 0));
  $("#silverBlock").hidden = !silver.length;
  $("#silverBars").innerHTML = silver.map(barCard).join("");
  refreshSearch();
  if (pd.id) renderPd(); // 시세가 바뀌면 열려 있는 상세 가격도 새로
  bootPd();

  const zodiac = ofKind("zodiac");
  $("#zodiacBlock").hidden = !zodiac.length;
  if (!zodiac.length) return;
  const prices = zodiac.map(priceOf);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  $("#zodiacPrice").textContent = lo === hi ? won(lo) : `${won(lo)} ~ ${won(hi)}`;
  $("#zodiacGrid").innerHTML = zodiac.map(z => `
    <article class="zcard${z.sold_out ? " is-soldout" : ""}">
      <div class="zcard__img">
        <img src="${esc(imgSrc(z))}" alt="GBK 십이지신 카드형 골드바 1g ${esc(z.name)}" loading="lazy">
        ${z.sold_out ? `<span class="bar__tag bar__tag--out">품절</span>` : z.tag ? `<span class="bar__tag">${esc(z.tag)}</span>` : ""}
      </div>
      <div class="zcard__body">
        <h4>${esc(z.name)}</h4>
        <div class="zcard__btns"><button class="zcard__cart" ${cartAttr(z)} ${z.sold_out ? "disabled" : ""} aria-label="장바구니 담기">담기</button><button class="zcard__btn" ${orderAttr(z)} ${z.sold_out ? "disabled" : ""}>${z.sold_out ? "품절" : "구매"}</button></div>
      </div>
    </article>`).join("");
}

/* ---------- 악세사리 ---------- */
let currentFilter = "all", shown = 12, currentWeight = "all", currentSort = "pop", currentMaterial = "all";
const isMat = p => currentMaterial === "all" || (currentMaterial === "SV" ? p.karat === "SV" : p.karat !== "SV");
const PAGE = 12;
// 중량 구간 (돈): 아래쪽 포함 — 예) 3돈은 '3~5돈', 10돈은 '10돈 이상'
const W_RANGE = { "0-3": [0, 3], "3-5": [3, 5], "5-10": [5, 10], "10-": [10, Infinity] };
const inRange = (p, key) => { const r = W_RANGE[key]; if (!r) return true; const d = Number(p.weight_g) / DON; return d >= r[0] - 1e-9 && d < r[1] - 1e-9; };
function sortList(list) {
  if (currentSort === "pop") return list;
  const price = p => priceOf(p) || 0, w = p => Number(p.weight_g) || 0;
  const f = { low: (a, b) => price(a) - price(b), high: (a, b) => price(b) - price(a), light: (a, b) => w(a) - w(b) || price(a) - price(b), heavy: (a, b) => w(b) - w(a) || price(b) - price(a) }[currentSort];
  return f ? list.slice().sort(f) : list;
}
const karatLabel = k => k === "SV" ? "실버" : k === "24K" ? "순금 24K" : k;
function renderProducts(filter = "all") {
  if (!state.domestic) return;
  if (filter !== currentFilter) shown = PAGE;
  currentFilter = filter;
  // 분류에 맞춰 중량 버튼마다 개수 표시
  document.querySelectorAll("#materialChips .mchip").forEach(b => {
    const m = b.dataset.m, n = accList().filter(p => (filter === "all" || p.category === filter) && (m === "all" || (m === "SV" ? p.karat === "SV" : p.karat !== "SV"))).length;
    b.dataset.label = b.dataset.label || b.textContent.trim(); b.innerHTML = `${b.dataset.label}<span>${n}</span>`;
  });
  const byCat = accList().filter(p => (filter === "all" || p.category === filter) && isMat(p));
  document.querySelectorAll("#weightChips .wchip").forEach(b => {
    const n = b.dataset.w === "all" ? byCat.length : byCat.filter(p => inRange(p, b.dataset.w)).length;
    b.dataset.label = b.dataset.label || b.textContent.trim(); b.innerHTML = `${b.dataset.label}<span>${n}</span>`;
  });
  const ranked = window.YAMOO.rankProducts(accList(), state.stats);
  const all = ranked.list;
  const tagOf = p => p.tag || (ranked.best.has(p.id) ? "BEST" : "");
  prodTagOf = tagOf;
  // 정렬은 상품 단위로 한 뒤 옵션 묶음(1g · 1돈 · 2돈 …)을 카드 하나로
  const full = window.YAMOO.groupOptions(sortList(all.filter(p => (filter === "all" || p.category === filter) && isMat(p) && inRange(p, currentWeight))));
  const list = full.slice(0, shown);
  shownGroups = list;
  const more = $("#productsMore");
  if (more) {
    more.hidden = full.length <= shown;
    more.textContent = `더보기 (${full.length - list.length}개 더 있어요)`;
  }
  $("#products").innerHTML = list.map(productCard).join("") || `<p class="products__empty">준비 중인 상품입니다.</p>`;
}
let shownGroups = [], optChosen = {}, prodTagOf = p => p.tag || "";
function productCard(opts, i) {
  const Y = window.YAMOO, p = Y.optPick(opts, optChosen[opts[0].opt_group]), price = priceOf(p);
  const title = Y.optTitle(opts, p), tag = opts.map(prodTagOf).find(Boolean);
  const chipsHtml = opts.length < 2 ? "" : `<div class="optchips" role="group" aria-label="옵션 선택">${opts.map(o =>
    `<button type="button" data-popt="${esc(o.id)}" class="${o.id === p.id ? "is-on" : ""}${o.sold_out ? " is-out" : ""}" aria-pressed="${o.id === p.id}">${esc(Y.optLabel(o))}</button>`).join("")}</div>`;
  return `
      <article class="product${p.sold_out ? " is-soldout" : ""}" data-pkey="${esc(opts[0].id)}" style="${i < 0 ? "animation:none" : `animation-delay:${(i % PAGE) * 50}ms`}">
        <div class="product__img">
          <img src="${esc(imgSrc(p))}" alt="${esc(title)}" loading="lazy">
          ${p.sold_out ? `<span class="product__tag product__tag--out">품절</span>` : tag ? `<span class="product__tag">${esc(tag)}</span>` : ""}
        </div>
        <div class="product__info">
          <p class="product__spec"><span class="karat">${esc(karatLabel(p.karat))}</span><span>·</span><span>${Number(p.weight_g)}g</span></p>
          <h3 class="product__name">${esc(title)}</h3>
          ${(() => { const sz = Y.sizeList(p), t = [sz.length ? `사이즈 ${sz[0]}~${sz[sz.length - 1]}${Y.sizeUnit(p)}${Number(p.base_size) > 0 ? ` (중량 ${Number(p.base_size)}cm 기준)` : ""}` : "", Y.hasAddon(p) ? `${p.addon_name} 선택` : ""].filter(Boolean).join(" · "); return t ? `<p class="product__opt">${esc(t)}</p>` : ""; })()}
          ${chipsHtml}
          <p class="product__price">${won(price)}</p>
          ${p.sold_out ? `<p class="product__out">품절</p>` : `<div class="add-cart"><button class="p-cart" ${cartAttr(p)}>장바구니</button><button class="p-buy" ${orderAttr(p)}>바로 구매</button></div>`}
          <button type="button" class="info-link" data-info="${orderKey(p)}">상품정보 제공고시</button>
        </div>
      </article>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-popt]");
  if (!b) return;
  const card = b.closest("[data-pkey]"), opts = card && shownGroups.find(o => o[0].id === card.dataset.pkey);
  if (!opts) return;
  optChosen[opts[0].opt_group] = b.dataset.popt;
  card.outerHTML = productCard(opts, -1);
});
const chips = document.querySelectorAll(".chip");
chips.forEach(c => c.addEventListener("click", () => {
  chips.forEach(x => { const on = x === c; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", on); });
  renderProducts(c.dataset.filter);
}));
const wchips = document.querySelectorAll("#weightChips .wchip");
wchips.forEach(c => c.addEventListener("click", () => {
  wchips.forEach(x => { const on = x === c; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", on); });
  currentWeight = c.dataset.w; shown = PAGE;
  renderProducts(currentFilter);
}));
const mchips = document.querySelectorAll("#materialChips .mchip");
mchips.forEach(c => c.addEventListener("click", () => {
  mchips.forEach(x => { const on = x === c; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", on); });
  currentMaterial = c.dataset.m; shown = PAGE;
  renderProducts(currentFilter);
}));
const sortSel = $("#productSort");
if (sortSel) sortSel.addEventListener("change", () => { currentSort = sortSel.value; shown = PAGE; renderProducts(currentFilter); });
const moreBtn = $("#productsMore");
if (moreBtn) moreBtn.addEventListener("click", () => { shown += PAGE; renderProducts(currentFilter); });

/* ---------- 장바구니 / 토스트 ---------- */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-show"), 2400);
}
window.toast = toast;
document.addEventListener("click", e => {
  const inf = e.target.closest("[data-info]");
  if (inf) {
    const key = inf.dataset.info;
    const p = key.startsWith("idx:") ? state.products[+key.slice(4)] : window.SHOP.find(key);
    if (p && window.openInfo) window.openInfo(p);
    return;
  }
  if (e.target.closest("#zodiacInfo")) {
    const z = ofKind("zodiac")[0];
    if (z && window.openInfo) window.openInfo({ ...z, name: "GBK 십이지신 카드형 골드바 1g" });
    return;
  }
  const ord = e.target.closest("[data-order]");
  if (ord) {
    const key = ord.dataset.order;
    const p = key.startsWith("idx:") ? state.products[+key.slice(4)] : window.SHOP.find(key);
    if (p && window.openOrder) window.openOrder(p);
    return;
  }
  const c = e.target.closest("[data-cart]");
  if (!c) return;
  const key = c.dataset.cart;
  const p = key.startsWith("idx:") ? state.products[+key.slice(4)] : window.SHOP.find(key);
  if (p && window.addToCart) window.addToCart(p);
});

/* ---------- 찜한 상품 · 최근 본 상품 (이 기기 브라우저에만 저장) ---------- */
const MINE_MAX = { wish: 50, recent: 12 };
const mineGet = k => { try { const a = JSON.parse(localStorage.getItem("keumbi_" + k) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
const mineSet = (k, a) => { try { localStorage.setItem("keumbi_" + k, JSON.stringify(a.slice(0, MINE_MAX[k]))); } catch { /* 저장 막힌 브라우저 */ } };
const mineAdd = (k, id) => mineSet(k, [id, ...mineGet(k).filter(x => x !== id)]);
let mineTab = mineGet("wish").length ? "wish" : "recent";
function renderMine() {
  const box = $("#mine");
  if (!box || !state.domestic) return;
  const live = k => mineGet(k).map(id => state.products.find(p => p.id === id)).filter(Boolean);
  const lists = { wish: live("wish"), recent: live("recent") };
  box.hidden = !lists.wish.length && !lists.recent.length;
  if (box.hidden) return;
  $("#wishCount").textContent = lists.wish.length || "";
  box.querySelectorAll("[data-mine]").forEach(b => { const on = b.dataset.mine === mineTab; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", on); });
  $("#mineList").innerHTML = lists[mineTab].length ? lists[mineTab].map(p => {
    const ph = photosOf(p)[0] || "bar-close.jpg";
    return `<button type="button" class="mine__item${p.sold_out ? " is-soldout" : ""}" data-mineopen="${esc(p.id)}"><img src="${esc(photoSrc(ph))}" alt="" loading="lazy"><b>${esc(pdTitle(p))}</b><em>${p.sold_out ? "품절" : won(priceOf(p))}</em></button>`;
  }).join("") : `<p class="mine__empty">${mineTab === "wish" ? "아직 찜한 상품이 없어요. 상품 화면에서 ♡ 찜하기를 눌러 보세요." : "최근 본 상품이 없어요."}</p>`;
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-mine]");
  if (t) { mineTab = t.dataset.mine; renderMine(); return; }
  const o = e.target.closest("[data-mineopen]");
  if (o) openPd(o.dataset.mineopen);
});
function pdWishBtn() {
  const b = $("#pdWish");
  if (!b || !pd.id) return;
  const on = mineGet("wish").includes(pd.id);
  b.textContent = on ? "♥ 찜한 상품" : "♡ 찜하기";
  b.classList.toggle("is-on", on);
  b.setAttribute("aria-pressed", on);
}
function toggleWish() {
  if (!pd.id) return;
  const on = mineGet("wish").includes(pd.id);
  if (on) mineSet("wish", mineGet("wish").filter(x => x !== pd.id));
  else { mineAdd("wish", pd.id); mineTab = "wish"; }
  pdWishBtn();
  renderMine();
}

/* ---------- 사이즈 재는 법 (반지는 호, 팔찌·목걸이는 cm) ---------- */
function sizeGuideHtml(p) {
  if (p.category === "ring") {
    const rows = [5, 7, 9, 11, 13, 15, 17, 19, 21].map(n => `<tr><td>${n}호</td><td>약 ${40 + n}mm</td><td>약 ${((40 + n) / Math.PI).toFixed(1)}mm</td></tr>`).join("");
    return `<ol><li>실이나 얇은 종이띠를 손가락 <b>마디의 가장 굵은 곳</b>에 한 바퀴 감아요.</li><li>겹치는 곳에 표시하고 펴서 자로 길이(둘레)를 재요.</li><li>아래 표에서 가장 가까운 호수를 고르세요. 두 호수 사이면 <b>큰 쪽</b>을 추천해요.</li></ol>
      <table class="sizeguide__tbl"><thead><tr><th>호수</th><th>손가락 둘레</th><th>반지 안지름</th></tr></thead><tbody>${rows}</tbody></table>
      <p>가지고 계신 반지의 안지름을 재도 돼요. 손가락은 아침보다 저녁에 조금 굵어져요. 가게마다 1호 정도 차이가 날 수 있어요.</p>`;
  }
  if (p.category === "necklace") {
    return `<ul><li><b>40cm</b> 쇄골 위쪽에 오는 길이 (가장 많이 찾는 길이)</li><li><b>45cm</b> 쇄골 바로 아래, 펜던트와 잘 어울려요</li><li><b>50cm 이상</b> 가슴 위쪽까지 내려와요</li></ul><p>목이 굵은 편이거나 옷 위로 보이게 하려면 한 단계 긴 길이를 추천해요.</p>`;
  }
  return `<ol><li>줄자나 실로 <b>손목뼈 바로 아래</b> 둘레를 재요.</li><li>잰 둘레에 <b>1~1.5cm</b>를 더한 길이를 고르세요. 꼭 맞게는 +1cm, 여유 있게는 +2cm예요.</li></ol>
    <table class="sizeguide__tbl"><thead><tr><th>손목 둘레</th><th>추천 길이</th></tr></thead><tbody>${[14, 15, 16, 17, 18].map(n => `<tr><td>${n}cm</td><td>${n + 1}~${n + 1.5}cm</td></tr>`).join("")}</tbody></table>`;
}
function pdSizeGuide(p) {
  const box = $("#pdSizeGuide");
  if (!box) return;
  box.hidden = !window.YAMOO.sizeList(p).length;
  if (!box.hidden) $("#pdSizeBody").innerHTML = sizeGuideHtml(p) + `<p class="sizeguide__free">사이즈 조절은 <b>무료</b>예요. 잘 모르겠으면 010-5287-8002로 물어봐 주세요. 사이즈 작업을 시작한 뒤에는 취소·반품이 안 돼요.</p>`;
}

/* ---------- 상품 상세 (주소: ?p=상품번호 → 링크 공유·검색 노출용) ---------- */
const pdModal = $("#pdModal");
const pd = { id: null, photo: null, gallery: [], pushed: false, title: document.title, desc: "" };
const pdMeta = document.querySelector('meta[name="description"]');
pd.desc = pdMeta ? pdMeta.content : "";
const keyToProduct = key => key && (key.startsWith("idx:") ? state.products[+key.slice(4)] : window.SHOP.find(key));
// 같은 묶음(opt_group)의 옵션들 = 상세 화면의 중량 선택
const pdOpts = p => {
  const g = String(p.opt_group || "").trim();
  if (BANGLE_IDS.includes(p.id)) return state.products.filter(o => BANGLE_IDS.includes(o.id)).sort(byWeight);
  return g ? state.products.filter(o => String(o.opt_group || "").trim() === g).sort(byWeight) : [p];
};
const pdTitle = p => p.kind === "zodiac" ? `GBK 카드형 골드바 1g ${p.name}` : p.name;
function pdFacts(p) {
  const Y = window.YAMOO, d = Y.infoDefaults(p), o = p.info || {}, w = Number(p.weight_g), sz = Y.sizeList(p);
  return [
    ["소재", String(o.material || "").trim() || d.material],
    ["중량", `${wLabel(w)}${p.kind !== "silver" && w >= DON / 2 ? ` (${Math.round(w / DON * 100) / 100}돈)` : ""}${p.kind === "accessory" ? " · 수작업 특성상 약간 차이" : ""}`],
    sz.length ? ["사이즈", `${sz[0]}~${sz[sz.length - 1]}${Y.sizeUnit(p)}${Number(p.base_size) > 0 ? ` (중량은 ${Number(p.base_size)}cm 기준)` : ""}`] : null,
    Y.hasAddon(p) ? ["추가 옵션", `${p.addon_name} +${won(Number(p.addon_price))}`] : null,
    ["보증", "정품 보증서 동봉"],
    ["받는 방법", "보험 등기 택배 또는 종로 매장 방문 수령"],
  ].filter(Boolean);
}
function renderPd() {
  const p = state.products.find(x => x.id === pd.id);
  if (!p || !state.domestic) return;
  const Y = window.YAMOO, opts = pdOpts(p);
  const gallery = [...new Set(photosOf(p).length ? photosOf(p) : [p.img || "bar-close.jpg"])];
  const main = gallery.includes(pd.photo) ? pd.photo : gallery[0];
  pd.gallery = gallery;
  const img = $("#pdImg");
  if (img.getAttribute("src") !== photoSrc(main)) img.src = photoSrc(main);
  img.alt = pdTitle(p);
  const many = gallery.length > 1;
  pdModal.querySelectorAll("[data-pdnav]").forEach(b => { b.hidden = !many; });
  $("#pdCount").hidden = !many;
  $("#pdCount").textContent = `${gallery.indexOf(main) + 1} / ${gallery.length}`;
  $("#pdThumbs").innerHTML = many ? gallery.map((s, i) =>
    `<button type="button" data-pdphoto="${esc(s)}" class="${s === main ? "is-on" : ""}" aria-label="사진 ${i + 1}"><img src="${esc(photoSrc(s))}" alt="" loading="lazy"></button>`).join("") : "";
  const kindTxt = { bar: "순금 골드바", zodiac: "카드형 골드바", silver: "순은 실버", gift: "순금선물", accessory: karatLabel(p.karat) + " 주얼리" }[p.kind] || "";
  $("#pdSpec").textContent = kindTxt;
  $("#pdName").textContent = pdTitle(p);
  $("#pdOpts").innerHTML = opts.length < 2 ? "" : `<p class="pd__label">중량 선택</p><div class="pd__optlist">${opts.map(o =>
    `<button type="button" data-pdopt="${esc(o.id)}" class="${o.id === p.id ? "is-on" : ""}" aria-pressed="${o.id === p.id}" ${o.sold_out ? "disabled" : ""}><b>${esc(Y.optLabel(o))}</b><em>${o.sold_out ? "품절" : won(priceOf(o))}</em></button>`).join("")}</div>`;
  $("#pdPrice").textContent = p.sold_out ? "품절" : won(priceOf(p));
  const desc = String(p.description || "").trim();
  $("#pdDesc").hidden = !desc;
  $("#pdDesc").innerHTML = desc.split(/\n{2,}/).map(t => `<p>${esc(t).replace(/\n/g, "<br>")}</p>`).join("");
  $("#pdFacts").innerHTML = pdFacts(p).map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(v)}</b></li>`).join("");
  const cart = $("#pdCart"), buy = $("#pdBuy");
  cart.dataset.cart = buy.dataset.order = p.id;
  cart.disabled = buy.disabled = !!p.sold_out;
  buy.textContent = p.sold_out ? "품절" : "바로 구매";
  $("#pdInfo").innerHTML = `<table class="pinfo__tbl"><tbody>${Y.productInfo(p).map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
  if (window.renderReviews) window.renderReviews(p, opts);
  pdWishBtn();
  pdSizeGuide(p);
  const nn = Y.nightNote(p), nEl = $("#pdNight");
  if (nEl) { nEl.hidden = !nn; nEl.className = "pd__night" + (nn && nn.on ? " is-on" : ""); nEl.textContent = nn ? nn.text : ""; }
  const lt = Y.leadTime(p), ltEl = $("#pdLead");
  if (ltEl) { ltEl.hidden = !lt; ltEl.className = "pd__lead" + (lt && lt.slow ? " is-slow" : ""); ltEl.textContent = lt ? lt.text : ""; }
  // 검색엔진·카톡 공유용 제목·설명·상품 정보
  document.title = `${pdTitle(p)} | 금비 GOLD`;
  if (pdMeta) pdMeta.content = `${pdTitle(p)} · ${kindTxt} · ${wLabel(Number(p.weight_g))} · 실시간 시세 ${won(priceOf(p))}. 서울 종로 금비 GOLD 010-5287-8002`;
  let ld = $("#pdLd");
  if (!ld) { ld = document.createElement("script"); ld.type = "application/ld+json"; ld.id = "pdLd"; document.head.appendChild(ld); }
  ld.textContent = JSON.stringify({
    "@context": "https://schema.org", "@type": "Product", name: pdTitle(p), sku: p.id,
    image: gallery.map(s => new URL(photoSrc(s), location.href).href), brand: { "@type": "Brand", name: "금비 GOLD" },
    offers: { "@type": "Offer", priceCurrency: "KRW", price: priceOf(p), url: location.href, availability: p.sold_out ? "https://schema.org/SoldOut" : "https://schema.org/InStock" },
  });
}
function openPd(id, push = true) {
  const p = state.products.find(x => x.id === id);
  if (!p || !pdModal) return;
  pd.id = id; pd.photo = null;
  window.YAMOO.trackView(id);
  mineAdd("recent", id);
  renderMine();
  if (push && new URLSearchParams(location.search).get("p") !== id) {
    history[pdModal.hidden ? "pushState" : "replaceState"]({ pd: id }, "", `${location.pathname}?p=${encodeURIComponent(id)}`);
    if (pdModal.hidden) pd.pushed = true;
  }
  pdModal.hidden = false;
  document.body.style.overflow = "hidden";
  renderPd();
  pdModal.querySelector(".pd").scrollTop = 0;
}
function hidePd() {
  if (!pdModal || pdModal.hidden) return;
  pdModal.hidden = true;
  document.body.style.overflow = document.querySelector(".modal:not([hidden])") ? "hidden" : "";
  document.title = pd.title;
  if (pdMeta) pdMeta.content = pd.desc;
  const ld = $("#pdLd"); if (ld) ld.remove();
  pd.id = null;
}
function closePd() {
  if (pd.pushed) { pd.pushed = false; history.back(); return; } // popstate 에서 닫힘
  hidePd();
  history.replaceState(null, "", location.pathname);
}
window.openPd = openPd;
window.addEventListener("popstate", () => {
  const id = new URLSearchParams(location.search).get("p");
  if (id && state.products.some(x => x.id === id)) openPd(id, false);
  else { pd.pushed = false; hidePd(); }
});
// 주소에 ?p= 가 있으면 상품·시세가 준비된 뒤 상세를 엶 (renderBars 끝에서 부름)
let pdBoot = new URLSearchParams(location.search).get("p");
function bootPd() {
  renderMine();
  if (!pdBoot || !state.domestic || !state.products.some(x => x.id === pdBoot)) return;
  const id = pdBoot; pdBoot = null;
  openPd(id, false);
}
if (pdModal) {
  pdModal.addEventListener("click", e => {
    if (e.target.closest("[data-pdclose]")) return closePd();
    const o = e.target.closest("[data-pdopt]");
    if (o) return openPd(o.dataset.pdopt);
    const ph = e.target.closest("[data-pdphoto]");
    if (ph) { pd.photo = ph.dataset.pdphoto; return renderPd(); }
    const nv = e.target.closest("[data-pdnav]");
    if (nv) return pdStep(+nv.dataset.pdnav);
    if (e.target.closest("#pdShare")) return sharePd();
    if (e.target.closest("#pdWish")) return toggleWish();
  });
  const m = pdModal.querySelector(".pd__main");
  let x0 = null;
  m.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
  m.addEventListener("touchend", e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) pdStep(dx < 0 ? 1 : -1);
  });
  // ESC: 위에 다른 창(구매 창·사진 크게 보기)이 떠 있으면 그 창만 닫히게
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || pdModal.hidden) return;
    const other = [...document.querySelectorAll(".modal:not([hidden]), .lightbox:not([hidden])")].some(el => el !== pdModal);
    if (!other) closePd();
  }, true);
}
function pdStep(d) {
  if (pd.gallery.length < 2) return;
  const at = Math.max(0, pd.gallery.indexOf(pd.photo || pd.gallery[0]));
  pd.photo = pd.gallery[(at + d + pd.gallery.length) % pd.gallery.length];
  renderPd();
}
async function sharePd() {
  const p = state.products.find(x => x.id === pd.id);
  const url = `${location.origin}${location.pathname}?p=${encodeURIComponent(pd.id)}`;
  try {
    if (navigator.share) { await navigator.share({ title: `${pdTitle(p)} | 금비 GOLD`, url }); return; }
    await navigator.clipboard.writeText(url);
    toast("상품 링크를 복사했어요");
  } catch (err) { if (!err || err.name !== "AbortError") toast(url); }
}
// 목록의 상품 사진·이름을 누르면 상세 열기
document.addEventListener("click", e => {
  const hit = e.target.closest(".product__img, .product__name, .bar__img, .bar__name, .zcard__img, .zcard h4, .sres > img, .sres__body");
  if (!hit || e.target.closest("button, a")) return;
  const card = hit.closest("article");
  const k = card && card.querySelector("[data-info], [data-order], [data-cart]");
  const p = k && keyToProduct(k.dataset.info || k.dataset.order || k.dataset.cart);
  if (!p || !p.id) return;
  e.stopPropagation();
  if (hit.closest(".sres") && searchPanel && !searchPanel.hidden) {
    if (window.YAMOO.trackSearch) window.YAMOO.trackSearch(p.id);
    closeSearch();
  }
  openPd(p.id);
}, true);

/* ---------- 상품 검색 ---------- */
const searchPanel = $("#searchPanel"), searchInput = $("#searchInput"), searchBtn = $("#searchBtn");
const SEARCH_KEYS = ["1돈", "반돈", "10돈", "100g", "카드형", "용띠", "실버바", "그래뉼"];
const CAT_KO = { necklace: "목걸이", ring: "반지", bracelet: "팔찌", earring: "귀걸이" };
const DON_WORD = { 0.5: "반돈", 1: "한돈", 2: "두돈", 3: "세돈", 5: "닷돈", 10: "열돈" };
const norm = s => String(s || "").toLowerCase().replace(/\s+/g, "");

// 상품마다 무게 표현(10g, 1kg, 1000g, 1돈, 한돈 …)과 검색용 단어를 만들어 둠
function searchInfo(p) {
  const w = Number(p.weight_g), d = Math.round(w / DON * 1000) / 1000;
  const weights = new Set([`${w}g`]);
  if (w >= 1000 && w % 1000 === 0) weights.add(`${w / 1000}kg`);
  // 모든 상품: 무게를 돈으로도 검색되게 (3.75g = 1돈, 소수 둘째 자리까지. 예: 5.625g → 1.5돈)
  if (w > 0) weights.add(`${Math.round(w / DON * 100) / 100}돈`);
  if (DON_WORD[d]) weights.add(DON_WORD[d]);
  const words = {
    bar: "골드바 금괴 순금 금 GBK 24K 999.9 보증서",
    zodiac: "카드형 골드바 십이지 십이지신 띠 순금 금 GBK 24K 선물 돌 백일 보증서",
    silver: `실버 순은 은 ${p.name.includes("그래뉼") ? "그래뉼 알갱이" : "실버바"} 보증서`,
    accessory: `악세사리 액세서리 주얼리 쥬얼리 ${CAT_KO[p.category] || ""} ${p.karat === "SV" ? "실버 은 925" : "순금 금 " + (p.karat || "")}`,
    gift: `순금선물 선물 기념품 순금 금 24K ${CAT_KO[p.category] || ""}`,
  }[p.kind] || "";
  return { weights: [...weights].map(norm), hay: norm(`${p.name} ${p.tag || ""} ${words} ${[...weights].join(" ")}`) };
}

// 상품 이름에 무게가 적혀 있으면(예: '… 팔찌 50돈') 그것도 인정. '150돈' 안의 '50돈'은 제외
const nameHas = (p, t) => new RegExp(`(^|[^\\d.])${t.replace(/\./g, "\\.")}`).test(norm(p.name));
function searchMatch(p, terms) {
  const info = searchInfo(p);
  return terms.every(t => {
    t = t.replace(/^\d+(\.\d+)?/, n => String(+n)); // '1.50돈' → '1.5돈', '05g' → '5g'
    if (/^\d+(\.\d+)?(g|kg|돈)$/.test(t)) return info.weights.includes(t) || nameHas(p, t);
    if (/^\d+(\.\d+)?$/.test(t)) return info.weights.includes(t + "g") || info.weights.includes(t + "돈") || nameHas(p, t + "돈");
    return info.hay.includes(t);
  });
}

const KIND_ORDER = { bar: 0, zodiac: 1, silver: 2, gift: 3, accessory: 4 };
const KIND_KO = { bar: "골드바", zodiac: "카드형 골드바", silver: "실버", gift: "순금선물", accessory: "악세사리" };
function searchRow(p) {
  const price = state.domestic ? priceOf(p) : null, w = Number(p.weight_g);
  const name = p.kind === "zodiac" ? `카드형 골드바 1g · ${p.name}` : p.name;
  const sub = p.kind === "accessory" ? `${karatLabel(p.karat)} · ${w}g` : p.kind === "silver" ? `순은 · ${wLabel(w)}` : `순금 24K · ${wLabel(w)}${donLabel(w) ? " · " + donLabel(w) : ""}`;
  const off = p.sold_out ? "disabled" : "";
  return `
    <article class="sres${p.sold_out ? " is-soldout" : ""}">
      <img src="${esc(imgSrc(p))}" alt="" loading="lazy">
      <div class="sres__body">
        <p class="sres__kind">${KIND_ORDER[p.kind] !== undefined ? KIND_KO[p.kind] : ""}${p.sold_out ? ` · <b>품절</b>` : ""}</p>
        <h3 class="sres__name">${esc(name)}</h3>
        <p class="sres__sub">${esc(sub)}</p>
        <p class="sres__price">${price ? won(price) : "시세 확인 중"}</p>
      </div>
      <div class="sres__btns">
        <button class="sres__cart" ${cartAttr(p)} ${off}>담기</button>
        <button class="sres__buy" ${orderAttr(p)} ${off}>${p.sold_out ? "품절" : "구매"}</button>
      </div>
    </article>`;
}

// 검색어 기록: 엔터·추천어 누름·결과 누름·검색창 닫을 때 (입력 중인 글자는 기록 안 함)
let lastSearch = { q: "", n: 0 };
const logSearch = () => { if (lastSearch.q && window.YAMOO.trackTerm) window.YAMOO.trackTerm(lastSearch.q, lastSearch.n); };
function refreshSearch() {
  if (!searchPanel || searchPanel.hidden) return;
  const q = searchInput.value.trim();
  const terms = q.split(/\s+/).map(norm).filter(Boolean);
  const list = $("#searchList"), count = $("#searchCount");
  $("#searchKeys").innerHTML = (q ? "" : `<p>추천 검색어</p>`) + SEARCH_KEYS.map(k => `<button type="button" data-skey="${esc(k)}"${norm(k) === norm(q) ? ' class="is-on"' : ""}>${esc(k)}</button>`).join("");
  if (!terms.length) {
    lastSearch = { q: "", n: 0 };
    const hot = state.products.filter(p => p.tag && !p.sold_out && p.kind !== "accessory").slice(0, 6);
    count.textContent = hot.length ? "인기 상품" : "";
    list.innerHTML = hot.map(searchRow).join("");
    return;
  }
  const hits = state.products.filter(p => searchMatch(p, terms)).sort((a, b) => {
    const an = norm(a.name).includes(terms[0]) ? 0 : 1, bn = norm(b.name).includes(terms[0]) ? 0 : 1;
    return (a.sold_out - b.sold_out) || (an - bn) || ((KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)) || (a.weight_g - b.weight_g);
  });
  lastSearch = { q, n: hits.length };
  count.innerHTML = `<b>‘${esc(q)}’</b> 검색 결과 ${hits.length}개`;
  list.innerHTML = hits.map(searchRow).join("") || `
    <div class="search__empty">
      <p>찾으시는 상품이 없어요.</p>
      <span>무게(예: 3.75g, 1돈)나 종류(골드바, 실버)로 검색해 보세요.<br>원하시는 상품은 <a href="tel:010-5287-8002">010-5287-8002</a>로 문의해 주세요.</span>
    </div>`;
}

function openSearch() {
  searchPanel.hidden = false;
  searchBtn.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
  refreshSearch();
  setTimeout(() => searchInput.focus(), 30);
}
function closeSearch() {
  logSearch();
  searchPanel.hidden = true;
  searchBtn.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}
if (searchPanel) {
  searchBtn.addEventListener("click", openSearch);
  let st;
  searchInput.addEventListener("input", () => { clearTimeout(st); st = setTimeout(refreshSearch, 120); });
  $("#searchForm").addEventListener("submit", e => { e.preventDefault(); refreshSearch(); logSearch(); searchInput.blur(); });
  searchPanel.addEventListener("click", e => {
    if (e.target.closest("[data-sclose]")) return closeSearch();
    const k = e.target.closest("[data-skey]");
    if (k) { searchInput.value = k.dataset.skey; refreshSearch(); logSearch(); return; }
    // 검색 결과에서 상품을 누르면 '검색으로 찾음' 1번 (인기순에 반영)
    const hit = e.target.closest(".sres");
    if (hit) logSearch();
    const hid = hit && hit.querySelector("[data-order]");
    if (hid && window.YAMOO.trackSearch) window.YAMOO.trackSearch(hid.dataset.order);
    if (e.target.closest("[data-order]")) closeSearch(); // 구매 창으로 넘어감
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !searchPanel.hidden) closeSearch();
    else if (e.key === "/" && searchPanel.hidden && !/input|textarea|select/i.test(document.activeElement.tagName) && !document.querySelector(".modal:not([hidden])")) { e.preventDefault(); openSearch(); }
  });
}

/* ---------- 히어로 슬라이더 ---------- */
function initHero() {
  const slides = [...document.querySelectorAll(".slide")];
  const dots = $(".hero__dots");
  dots.innerHTML = slides.map((_, i) => `<button role="tab" aria-label="${i + 1}번 슬라이드"></button>`).join("");
  const dotBtns = [...dots.children];
  let idx = 0, timer;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const go = n => {
    idx = (n + slides.length) % slides.length;
    slides.forEach((s, i) => { s.classList.toggle("is-active", i === idx); s.setAttribute("aria-hidden", i !== idx); });
    dotBtns.forEach((d, i) => { d.classList.remove("is-on"); if (i === idx) { void d.offsetWidth; d.classList.add("is-on"); } d.setAttribute("aria-selected", i === idx); });
    clearTimeout(timer);
    if (!reduce) timer = setTimeout(() => go(idx + 1), 6000);
  };
  dotBtns.forEach((d, i) => d.addEventListener("click", () => go(i)));
  document.querySelectorAll(".arrow").forEach(a => a.addEventListener("click", () => go(idx + +a.dataset.dir)));
  go(0);
}

/* ---------- 금비 슬라이드: 금빛 비 효과 ---------- */
function initGoldRain() {
  const cv = $(".gold-rain");
  if (!cv) return;
  const slide = cv.closest(".slide");
  const ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, drops = [], glints = [], raf = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const newDrop = top => {
    const z = Math.random(); // 0 = 먼 곳(작고 느림), 1 = 가까운 곳(크고 빠름)
    return { x: rnd(-40, W + 40), y: top ? rnd(-H, 0) : rnd(0, H), z,
      len: 10 + z * 34, w: .6 + z * 2.2, v: 3 + z * 9, a: .25 + z * .6, tw: rnd(0, Math.PI * 2) };
  };
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(W, 1600) / (W < 700 ? 9 : 7));
    drops = Array.from({ length: n }, () => newDrop(false));
  };
  const SLANT = .12; // 살짝 비스듬히 내리는 비
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    for (const d of drops) {
      const x2 = d.x - d.len * SLANT, y2 = d.y - d.len;
      const g = ctx.createLinearGradient(d.x, d.y, x2, y2);
      const tw = .75 + .25 * Math.sin(d.tw);
      g.addColorStop(0, `rgba(255,236,170,${d.a * tw})`);
      g.addColorStop(.35, `rgba(236,198,110,${d.a * .7 * tw})`);
      g.addColorStop(1, "rgba(192,154,69,0)");
      ctx.strokeStyle = g; ctx.lineWidth = d.w; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(x2, y2); ctx.stroke();
      if (d.z > .55) { // 가까운 빗방울 끝의 반짝임
        ctx.fillStyle = `rgba(255,246,214,${d.a * tw})`;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.w * .9, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const s of glints) { // 바닥에 닿을 때 튀는 금빛
      const r = s.r * (1 - s.life) + 1;
      ctx.strokeStyle = `rgba(255,226,150,${.5 * s.life})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, r * 2.2, r * .6, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  };
  const step = () => {
    for (const d of drops) {
      d.y += d.v; d.x += d.v * SLANT; d.tw += .15;
      if (d.y - d.len > H) {
        if (d.z > .6 && glints.length < 40) glints.push({ x: d.x, y: H - rnd(4, 40), r: 4 + d.z * 6, life: 1 });
        Object.assign(d, newDrop(true), { y: rnd(-60, -10) });
      }
    }
    for (const s of glints) s.life -= .04;
    glints = glints.filter(s => s.life > 0);
  };
  const loop = () => {
    raf = 0;
    if (document.hidden || !slide.classList.contains("is-active")) return; // 안 보일 땐 멈춤
    step(); draw();
    raf = requestAnimationFrame(loop);
  };
  const start = () => { if (!raf && !reduce) raf = requestAnimationFrame(loop); };
  resize(); draw();
  addEventListener("resize", () => { resize(); draw(); });
  document.addEventListener("visibilitychange", start);
  new MutationObserver(start).observe(slide, { attributes: true, attributeFilter: ["class"] });
  start();
}

/* ---------- 모바일 메뉴 ---------- */
const toggle = $(".menu-toggle"), mnav = $("#mobileNav");
toggle.addEventListener("click", () => {
  const open = toggle.getAttribute("aria-expanded") !== "true";
  toggle.setAttribute("aria-expanded", open);
  mnav.classList.toggle("is-open", open);
});
mnav.addEventListener("click", e => { if (e.target.tagName === "A") { toggle.setAttribute("aria-expanded", "false"); mnav.classList.remove("is-open"); } });

/* ---------- 스크롤 등장 ---------- */
function initReveal() {
  const els = document.querySelectorAll(".section__head, .card, .editorial__text, .steps li, .board__col, .store");
  if (!("IntersectionObserver" in window)) return;
  els.forEach(el => el.classList.add("reveal"));
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
  }), { threshold: 0.12 });
  els.forEach(el => io.observe(el));
}

initHero();
initGoldRain();
initReveal();
loadProducts();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
