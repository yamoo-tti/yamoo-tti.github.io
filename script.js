/* =========================================================
   시세 데이터 (예시) — 실제 운영 시 시세 API 응답으로 교체하세요.
   모든 국내 가격은 3.75g(1돈) 기준, 원 단위
   ========================================================= */
const PRICE = {
  updated: "2026.10.29 10:30",
  items: [
    { key: "24k", name: "순금 24K", sub: "99.99%", buy: 820000, sell: 695000, diff: 4000 },
    { key: "18k", name: "18K", sub: "75.0%", buy: null, sell: 510800, diff: 2900 },
    { key: "14k", name: "14K", sub: "58.5%", buy: null, sell: 396100, diff: 2300 },
    { key: "pt", name: "백금", sub: "Pt 99.95%", buy: 302000, sell: 248000, diff: -1000 },
    { key: "ag", name: "은", sub: "Ag 99.99%", buy: 11800, sell: 8700, diff: -60 },
  ],
  intl: [
    { name: "국제 금", unit: "USD/oz", value: 4108.2, diff: 12.4, dec: 2 },
    { name: "국제 은", unit: "USD/oz", value: 53.77, diff: -0.13, dec: 2 },
    { name: "국제 백금", unit: "USD/oz", value: 1592.5, diff: -4.1, dec: 2 },
    { name: "국제 팔라듐", unit: "USD/oz", value: 1184.0, diff: 6.5, dec: 2 },
    { name: "원/달러", unit: "KRW", value: 1421.5, diff: 2.3, dec: 1 },
  ],
};

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

/* ---------- 유틸 ---------- */
const $ = s => document.querySelector(s);
const won = n => Math.round(n).toLocaleString("ko-KR") + "원";
const round100 = n => Math.round(n / 100) * 100;
const round1000 = n => Math.round(n / 1000) * 1000;
const byKey = Object.fromEntries(PRICE.items.map(i => [i.key, i]));
const DON = 3.75;
const perGram = (key, side) => (byKey[key][side] ?? 0) / DON;
// 악세사리 판매용 금값(g당): 팔 때 시세 × 1.3 (제품 시세 가정)
const KARAT_RATE = { "24K": perGram("24k", "buy"), "18K": perGram("18k", "sell") * 1.3, "14K": perGram("14k", "sell") * 1.3 };

function diffHTML(d, dec = 0) {
  if (!d) return `<span class="chg">-</span>`;
  const cls = d > 0 ? "up" : "down";
  const sign = d > 0 ? "▲" : "▼";
  return `<span class="chg ${cls}">${sign} ${Math.abs(d).toLocaleString("ko-KR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}</span>`;
}

/* ---------- 티커 ---------- */
function renderTicker() {
  const items = [
    ...PRICE.intl.map(i => ({ name: i.name, unit: i.unit, val: i.value.toLocaleString("en-US", { minimumFractionDigits: i.dec, maximumFractionDigits: i.dec }), diff: i.diff, dec: i.dec })),
    { name: "순금 살 때", unit: "3.75g", val: byKey["24k"].buy.toLocaleString("ko-KR"), diff: byKey["24k"].diff, dec: 0 },
    { name: "순금 팔 때", unit: "3.75g", val: byKey["24k"].sell.toLocaleString("ko-KR"), diff: byKey["24k"].diff, dec: 0 },
  ];
  const html = items.map(i => {
    const cls = i.diff > 0 ? "up" : "down";
    const sign = i.diff > 0 ? "▲" : "▼";
    return `<div class="ticker__item"><span>${i.name}</span><b class="num">${i.val}</b><span>${i.unit}</span><em class="num ${cls}" style="font-style:normal">${sign}${Math.abs(i.diff).toFixed(i.dec)}</em></div>`;
  }).join("");
  $("#ticker").innerHTML = html + html; // 무한 스크롤용 복제
}

/* ---------- 시세표 ---------- */
function renderPriceTable() {
  $("#priceTime").textContent = PRICE.updated;
  $("#priceBody").innerHTML = PRICE.items.map(i => `
    <tr class="${i.key === "24k" ? "is-main" : ""}">
      <td class="item">${i.name}<small>${i.sub}</small></td>
      <td>${i.buy ? `<span class="val">${i.buy.toLocaleString("ko-KR")}</span>${diffHTML(i.diff)}` : `<span class="na">제품시세 적용</span>`}</td>
      <td><span class="val">${i.sell.toLocaleString("ko-KR")}</span>${diffHTML(i.sellDiff ?? i.diff)}</td>
    </tr>`).join("");
}

/* ---------- 차트 (예시 데이터) ---------- */
function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function makeSeries(days) {
  const rnd = seeded(days * 7919);
  const end = byKey["24k"].buy;
  const vals = [end];
  for (let i = 1; i < days; i++) {
    const drift = days > 100 ? 0.0011 : 0.0006; // 장기 상승 추세 가정
    vals.push(vals[i - 1] * (1 - drift + (rnd() - 0.5) * 0.018));
  }
  return vals.reverse();
}
function renderChart(days = 30) {
  const data = makeSeries(days);
  const W = 600, H = 220, pad = 10;
  const min = Math.min(...data), max = Math.max(...data);
  const x = i => (i / (data.length - 1)) * W;
  const y = v => pad + (1 - (v - min) / (max - min || 1)) * (H - pad * 2);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const grid = [0.25, 0.5, 0.75].map(t => `<line class="grid" x1="0" x2="${W}" y1="${H * t}" y2="${H * t}"/>`).join("");
  $("#chart").innerHTML = `
    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c09a45" stop-opacity=".28"/><stop offset="1" stop-color="#c09a45" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path class="area" d="M0,${H} L${pts.join(" L")} L${W},${H} Z"/>
    <path class="line" d="M${pts.join(" L")}"/>`;
  const first = data[0], last = data[data.length - 1];
  const pct = ((last - first) / first) * 100;
  $("#chartValue").innerHTML = `${won(last)} <small class="${pct >= 0 ? "up" : "down"}">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%</small>`;
  const today = new Date(2026, 9, 29);
  const fmt = d => `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}`;
  const labels = [0, 0.25, 0.5, 0.75, 1].map(t => fmt(new Date(today - (1 - t) * (days - 1) * 864e5)));
  $("#chartAxis").innerHTML = labels.map(l => `<span>${l}</span>`).join("");
}
document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".seg button").forEach(x => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-selected", x === b); });
  renderChart(+b.dataset.range);
}));

/* ---------- 계산기 ---------- */
function initCalc() {
  const sel = $("#calcItem");
  sel.innerHTML = PRICE.items.map(i => `<option value="${i.key}">${i.name}</option>`).join("");
  const update = () => {
    const item = byKey[sel.value];
    const w = parseFloat($("#calcWeight").value) || 0;
    const don = $("#calcUnit").value === "g" ? w / DON : w;
    $("#calcBuy").textContent = item.buy ? won(round100(item.buy * don)) : "제품시세";
    $("#calcSell").textContent = won(round100(item.sell * don));
  };
  ["#calcItem", "#calcWeight", "#calcUnit"].forEach(s => $(s).addEventListener("input", update));
  update();
}

/* ---------- 골드바 ---------- */
function renderBars() {
  const g24 = perGram("24k", "buy");
  $("#bars").innerHTML = BARS.map((b, i) => {
    const price = round100(g24 * b.g * (1 + b.premium));
    return `
      <article class="bar">
        <div class="bar__img">
          <img src="images/${b.img}" alt="순금 골드바 ${b.label}" loading="lazy">
          <span class="bar__weight">${b.label}${b.sub ? `<small>${b.sub}</small>` : ""}</span>
          ${b.tag ? `<span class="bar__tag">${b.tag}</span>` : ""}
        </div>
        <div class="bar__body">
          <h3 class="bar__name">YAMOO 순금 골드바 ${b.label}</h3>
          <p class="bar__spec">Au 999.9 · 보증서 · 고급 케이스</p>
          <p class="bar__price">${won(price)}</p>
          <p class="bar__unit">1g당 ${won(price / b.g)} · 시세 연동</p>
          <div class="bar__btns">
            <button class="cart-btn" data-name="순금 골드바 ${b.label}">장바구니</button>
            <button class="buy-btn" data-name="순금 골드바 ${b.label}" data-buy>바로 구매</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

/* ---------- 악세사리 ---------- */
function renderProducts(filter = "all") {
  const list = filter === "all" ? ACCESSORIES : ACCESSORIES.filter(p => p.cat === filter);
  $("#products").innerHTML = list.map((p, i) => {
    const price = round1000(KARAT_RATE[p.karat] * p.g + p.labor);
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
  toastTimer = setTimeout(() => t.classList.remove("is-show"), 2200);
}
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
  const els = document.querySelectorAll(".section__head, .card, .bar, .editorial__text, .steps li, .board__col, .store");
  if (!("IntersectionObserver" in window)) return;
  els.forEach(el => el.classList.add("reveal"));
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
  }), { threshold: 0.12 });
  els.forEach(el => io.observe(el));
}

renderTicker();
renderPriceTable();
renderChart(30);
initCalc();
renderBars();
renderProducts();
initHero();
initReveal();
