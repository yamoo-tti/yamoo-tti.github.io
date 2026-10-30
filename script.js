/* =========================================================
   홈페이지 — 실시간 시세 기반
   국제 시세·실시간 환율(gold-api.com) → 국내 3.75g 시세
   마진은 관리자 페이지 > 시세 설정 값을 사용 (미설정 시 기본값)
   ========================================================= */
const { fetchLive, fetchSettings, computeDomestic, won, fmtDate, DON } = window.YAMOO;

// 골드바: 중량(g)과 제작 프리미엄
const BARS = [
  { g: 1, label: "1g", img: "bar-three.jpg", premium: 0.08, tag: "입문용" },
  { g: 3.75, label: "3.75g", sub: "1돈", img: "bar-close.jpg", premium: 0.04, tag: "BEST" },
  { g: 10, label: "10g", img: "bar-stack.jpg", premium: 0.03 },
  { g: 18.75, label: "18.75g", sub: "5돈", img: "bar-pattern.jpg", premium: 0.025 },
  { g: 37.5, label: "37.5g", sub: "10돈", img: "bar-100oz.jpg", premium: 0.02, tag: "선물 추천" },
  { g: 100, label: "100g", img: "bar-coins.jpg", premium: 0.015 },
];

// 악세사리: 금 종류, 중량(g), 공임(원)
const ACCESSORIES = [
  { cat: "necklace", name: "오벌 링 펜던트 목걸이", karat: "14K", g: 3.2, labor: 89000, img: "necklace-oval.jpg", tag: "NEW" },
  { cat: "ring", name: "웨이브 볼드 링", karat: "18K", g: 5.1, labor: 120000, img: "ring-mirror.jpg", tag: "BEST" },
  { cat: "bracelet", name: "앵커 체인 팔찌", karat: "14K", g: 6.8, labor: 98000, img: "bracelet-chain.jpg" },
  { cat: "earring", name: "트위스트 후프 귀걸이", karat: "14K", g: 2.4, labor: 69000, img: "earring-hoop.jpg", tag: "BEST" },
  { cat: "necklace", name: "바 펜던트 목걸이", karat: "18K", g: 2.9, labor: 95000, img: "pendant.jpg" },
  { cat: "ring", name: "미니 큐빅 반지 3종", karat: "14K", g: 1.6, labor: 59000, img: "ring-box.jpg" },
  { cat: "bracelet", name: "참 체인 팔찌", karat: "14K", g: 1.9, labor: 64000, img: "bracelet-charm.jpg", tag: "NEW" },
  { cat: "necklace", name: "스네이크 체인 목걸이", karat: "18K", g: 4.3, labor: 85000, img: "necklace-blazer.jpg" },
];

const $ = s => document.querySelector(s);
const round100 = n => Math.round(n / 100) * 100;
const round1000 = n => Math.round(n / 1000) * 1000;

let state = { live: null, domestic: null };
const item = key => state.domestic.items.find(i => i.key === key);

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
function renderBars() {
  const g24 = item("24k").buy / DON;
  $("#bars").innerHTML = BARS.map(b => {
    const price = round100(g24 * b.g * (1 + b.premium));
    return `
      <article class="bar">
        <div class="bar__img">
          <img src="images/${b.img}" alt="순금 골드바 ${b.label}" loading="lazy">
          <span class="bar__weight">${b.label}${b.sub ? `<small>${b.sub}</small>` : ""}</span>
          ${b.tag ? `<span class="bar__tag">${b.tag}</span>` : ""}
        </div>
        <div class="bar__body">
          <h3 class="bar__name">금비 순금 골드바 ${b.label}</h3>
          <p class="bar__spec">Au 999.9 · 보증서 · 고급 케이스</p>
          <p class="bar__price">${won(price)}</p>
          <p class="bar__unit">1g당 ${won(price / b.g)} · 실시간 시세 연동</p>
          <div class="bar__btns">
            <button class="cart-btn" data-name="순금 골드바 ${b.label}">장바구니</button>
            <button class="buy-btn" data-name="순금 골드바 ${b.label}" data-buy>바로 구매</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

/* ---------- 악세사리 ---------- */
let currentFilter = "all";
function renderProducts(filter = "all") {
  if (!state.domestic) return;
  currentFilter = filter;
  // 제품 판매용 금값(g당): 팔 때 시세 × 1.3
  const rate = { "18K": item("18k").sell / DON * 1.3, "14K": item("14k").sell / DON * 1.3 };
  const list = filter === "all" ? ACCESSORIES : ACCESSORIES.filter(p => p.cat === filter);
  $("#products").innerHTML = list.map((p, i) => {
    const price = round1000(rate[p.karat] * p.g + p.labor);
    return `
      <article class="product" style="animation-delay:${i * 50}ms">
        <div class="product__img">
          <img src="images/${p.img}" alt="${p.name}" loading="lazy">
          ${p.tag ? `<span class="product__tag">${p.tag}</span>` : ""}
          <button class="add-cart" data-name="${p.name}">장바구니 담기</button>
        </div>
        <div class="product__info">
          <p class="product__spec"><span class="karat">${p.karat}</span><span>·</span><span>${p.g}g</span></p>
          <h3 class="product__name">${p.name}</h3>
          <p class="product__price">${won(price)}<span class="product__labor">공임 ${won(p.labor)} 포함</span></p>
        </div>
      </article>`;
  }).join("");
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
  const btn = e.target.closest("[data-name]");
  if (!btn) return;
  if (btn.hasAttribute("data-buy")) { toast(`‘${btn.dataset.name}’ 주문 페이지는 준비 중입니다`); return; }
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
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
