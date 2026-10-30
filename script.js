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
  P("bar", "GBK 순금 골드바 3.75g", 3.75, "gbk/bar-3_75g.webp", { premium_pct: 4, tag: "BEST" }),
  P("bar", "GBK 순금 골드바 10g", 10, "gbk/bar-10g.webp", { premium_pct: 3 }),
  P("bar", "GBK 순금 골드바 18.75g", 18.75, "gbk/bar-18_75g.webp", { premium_pct: 2.5 }),
  P("bar", "GBK 순금 골드바 37.5g", 37.5, "gbk/bar-37_5g.webp", { premium_pct: 2, tag: "선물 추천" }),
  P("bar", "GBK 순금 골드바 100g", 100, "gbk/bar-100g.webp", { premium_pct: 1.5 }),
  ...[["쥐띠", 10], ["소띠", 2], ["호랑이띠", 9], ["토끼띠", 6], ["용띠", 7], ["뱀띠", 4], ["말띠", 5], ["양띠", 1],
      ["원숭이띠", 11], ["닭띠", 8], ["개띠", 13], ["돼지띠", 12], ["부엉이", 3]]
    .map(([n, i]) => P("zodiac", n, 1, `gbk/zodiac-${String(i).padStart(2, "0")}.webp`, { premium_pct: 10, tag: n === "부엉이" ? "스페셜" : null })),
  P("silver", "실버바 100g", 100, "silver/bar-100g.svg", { premium_pct: 8, tag: "입문용" }),
  P("silver", "실버바 1kg", 1000, "silver/bar-1kg.svg", { premium_pct: 3, tag: "BEST" }),
  P("silver", "은 그래뉼 100g", 100, "silver/granule.svg", { premium_pct: 6 }),
  P("silver", "은 그래뉼 500g", 500, "silver/granule.svg", { premium_pct: 4 }),
  P("silver", "은 그래뉼 1kg", 1000, "silver/granule.svg", { premium_pct: 3 }),
  P("accessory", "오벌 링 펜던트 목걸이", 3.2, "necklace-oval.jpg", { karat: "14K", category: "necklace", labor: 89000, tag: "NEW" }),
  P("accessory", "웨이브 볼드 링", 5.1, "ring-mirror.jpg", { karat: "18K", category: "ring", labor: 120000, tag: "BEST" }),
  P("accessory", "앵커 체인 팔찌", 6.8, "bracelet-chain.jpg", { karat: "14K", category: "bracelet", labor: 98000 }),
  P("accessory", "트위스트 후프 귀걸이", 2.4, "earring-hoop.jpg", { karat: "14K", category: "earring", labor: 69000, tag: "BEST" }),
  P("accessory", "바 펜던트 목걸이", 2.9, "pendant.jpg", { karat: "18K", category: "necklace", labor: 95000 }),
  P("accessory", "미니 큐빅 반지 3종", 1.6, "ring-box.jpg", { karat: "14K", category: "ring", labor: 59000 }),
  P("accessory", "참 체인 팔찌", 1.9, "bracelet-charm.jpg", { karat: "14K", category: "bracelet", labor: 64000, tag: "NEW" }),
  P("accessory", "스네이크 체인 목걸이", 4.3, "necklace-blazer.jpg", { karat: "18K", category: "necklace", labor: 85000 }),
];

const $ = s => document.querySelector(s);
const round100 = n => Math.round(n / 100) * 100;

let state = { live: null, domestic: null, products: FALLBACK_PRODUCTS };
const item = key => state.domestic.items.find(i => i.key === key);
const ofKind = k => state.products.filter(p => p.kind === k);
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
  updateCalc();
  renderBars();
  renderProducts(currentFilter);
}

/* ---------- 국제 시세 (원화 1돈 환산) ---------- */
const usdFmt = v => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const donWon = sym => window.YAMOO.perDon(state.live, sym);
function renderIntl() {
  const { usd, krw } = state.live;
  const metals = [["금", "XAU"], ["은", "XAG"], ["백금", "XPT"], ["팔라듐", "XPD"]];
  $("#intl").innerHTML = metals.map(([n, s]) => `
    <div class="intl__card">
      <p class="intl__name">국제 ${n} <span>1돈 환산</span></p>
      <p class="intl__val num">${won(donWon(s))}</p>
      <p class="intl__sub num">${usdFmt(usd[s])}/oz</p>
    </div>`).join("") + `
    <div class="intl__card">
      <p class="intl__name">원/달러 <span>실시간</span></p>
      <p class="intl__val num">${krw.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원</p>
      <p class="intl__sub">1달러 기준</p>
    </div>`;
  renderTicker();
  updateChartKrw();
}

function renderTicker() {
  const g = item("24k");
  const items = [
    ["순금 살 때", won(g.buy), "3.75g", true],
    ["순금 팔 때", won(g.sell), "3.75g", true],
    ["18K 팔 때", won(item("18k").sell), "3.75g"],
    ["14K 팔 때", won(item("14k").sell), "3.75g"],
    ["국제 금", won(donWon("XAU")), "1돈 환산"],
    ["국제 은", won(donWon("XAG")), "1돈 환산"],
    ["국제 백금", won(donWon("XPT")), "1돈 환산"],
    ["국제 팔라듐", won(donWon("XPD")), "1돈 환산"],
    ["원/달러", state.live.krw.toFixed(2) + "원", "실시간"],
  ];
  const html = items.map(([n, v, u, gold]) => `<div class="ticker__item${gold ? " is-gold" : ""}"><span>${n}</span><b class="num">${v}</b><em>${u}</em></div>`).join("");
  const track = $("#ticker");
  track.innerHTML = html + html; // 끊김 없는 스크롤용 복제
  track.classList.add("is-running");
}

const CHART_SYM = { "OANDA:XAUUSD": "XAU", "OANDA:XAGUSD": "XAG", "OANDA:XPTUSD": "XPT" };
let chartSymbol = "OANDA:XAUUSD";
function updateChartKrw() {
  if (!state.live) return;
  const m = CHART_SYM[chartSymbol];
  $("#chartKrw").textContent = m ? `현재 1돈 ${won(donWon(m))}` : `현재 ${state.live.krw.toFixed(2)}원`;
}

/* ---------- 국내 시세표 ---------- */
function renderPriceTable() {
  $("#priceBody").innerHTML = state.domestic.items.map(i => `
    <tr class="${i.key === "24k" ? "is-main" : ""}">
      <td class="item">${i.name}<small>${i.sub}</small></td>
      <td>${i.buy ? `<span class="val">${i.buy.toLocaleString("ko-KR")}</span>` : `<span class="na">제품시세 적용</span>`}</td>
      <td><span class="val">${i.sell.toLocaleString("ko-KR")}</span></td>
    </tr>`).join("");
}
$("#refreshBtn").addEventListener("click", refresh);

/* ---------- TradingView 국제 차트 ---------- */
function mountChart(symbol) {
  const box = $("#tvChart");
  box.innerHTML = `<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div></div>`;
  const s = document.createElement("script");
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  s.async = true;
  s.textContent = JSON.stringify({
    autosize: true, symbol, interval: "60", timezone: "Asia/Seoul", theme: "light", style: "1",
    locale: "kr", allow_symbol_change: false, hide_side_toolbar: true, hide_volume: true,
    calendar: false, save_image: false, support_host: "https://www.tradingview.com",
  });
  box.firstElementChild.appendChild(s);
}
document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".seg button").forEach(x => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-selected", x === b); });
  $("#chartTitle").textContent = b.dataset.title;
  chartSymbol = b.dataset.symbol;
  updateChartKrw();
  mountChart(b.dataset.symbol);
}));

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
const orderAttr = p => `data-order="${p.id ? esc(p.id) : "idx:" + state.products.indexOf(p)}"`;

const wLabel = w => w >= 1000 && w % 1000 === 0 ? `${w / 1000}kg` : `${w}g`;
const barSpec = b => b.kind === "silver"
  ? (b.name.includes("그래뉼") ? "Ag 999.9 · 알갱이(그래뉼) 형태 · 소분 보관 용이" : "Ag 999.9 · 순은 실버바 · 품질보증서")
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
          <p class="bar__unit">1g당 ${won(price / w)} · 실시간 시세 연동</p>
          <div class="bar__btns">
            <button class="cart-btn" data-name="${esc(b.name)}" ${b.sold_out ? "disabled" : ""}>장바구니</button>
            <button class="buy-btn" ${orderAttr(b)} ${b.sold_out ? "disabled" : ""}>${b.sold_out ? "품절" : "바로 구매"}</button>
          </div>
        </div>
      </article>`;
}

function renderBars() {
  $("#bars").innerHTML = ofKind("bar").map(barCard).join("");
  const silver = ofKind("silver");
  $("#silverBlock").hidden = !silver.length;
  $("#silverBars").innerHTML = silver.map(barCard).join("");

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
        <button class="zcard__btn" ${orderAttr(z)} ${z.sold_out ? "disabled" : ""}>${z.sold_out ? "품절" : "구매"}</button>
      </div>
    </article>`).join("");
}

/* ---------- 악세사리 ---------- */
let currentFilter = "all";
function renderProducts(filter = "all") {
  if (!state.domestic) return;
  currentFilter = filter;
  const all = ofKind("accessory");
  const list = filter === "all" ? all : all.filter(p => p.category === filter);
  $("#products").innerHTML = list.map((p, i) => {
    const price = priceOf(p);
    return `
      <article class="product${p.sold_out ? " is-soldout" : ""}" style="animation-delay:${i * 50}ms">
        <div class="product__img">
          <img src="${esc(imgSrc(p))}" alt="${esc(p.name)}" loading="lazy">
          ${p.sold_out ? `<span class="product__tag product__tag--out">품절</span>` : p.tag ? `<span class="product__tag">${esc(p.tag)}</span>` : ""}
          ${p.sold_out ? "" : `<button class="add-cart" ${orderAttr(p)}>구매 문의</button>`}
        </div>
        <div class="product__info">
          <p class="product__spec"><span class="karat">${esc(p.karat)}</span><span>·</span><span>${Number(p.weight_g)}g</span></p>
          <h3 class="product__name">${esc(p.name)}</h3>
          <p class="product__price">${won(price)}<span class="product__labor">공임 ${won(p.labor)} 포함</span></p>
        </div>
      </article>`;
  }).join("") || `<p class="products__empty">준비 중인 상품입니다.</p>`;
}
const chips = document.querySelectorAll(".chip");
chips.forEach(c => c.addEventListener("click", () => {
  chips.forEach(x => { const on = x === c; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", on); });
  renderProducts(c.dataset.filter);
}));

/* ---------- 장바구니 / 토스트 ---------- */
let cart = 0, toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-show"), 2400);
}
window.toast = toast;
document.addEventListener("click", e => {
  const ord = e.target.closest("[data-order]");
  if (ord) {
    const key = ord.dataset.order;
    const p = key.startsWith("idx:") ? state.products[+key.slice(4)] : window.SHOP.find(key);
    if (p && window.openOrder) window.openOrder(p);
    return;
  }
  const btn = e.target.closest("[data-name]");
  if (!btn) return;
  cart++;
  const badge = $("#cartCount");
  badge.textContent = cart;
  badge.classList.add("has-items");
  badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump");
  toast(`‘${btn.dataset.name}’을(를) 장바구니에 담았습니다`);
});

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
initReveal();
mountChart("OANDA:XAUUSD");
loadProducts();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
