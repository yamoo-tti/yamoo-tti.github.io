// 상품 데이터 — 실제 상품으로 교체하세요
const PRODUCTS = [
  { id: 1, cat: "ring",     icon: "i-ring",     metal: "gold",   name: "오브 솔리테어 링",      spec: "18K Gold · Diamond 0.3ct", price: 890000, tag: "Best" },
  { id: 2, cat: "necklace", icon: "i-necklace", metal: "silver", name: "드롭 다이아몬드 네크리스", spec: "14K White Gold",          price: 540000, tag: "New" },
  { id: 3, cat: "earring",  icon: "i-earring",  metal: "rose",   name: "써클 드롭 이어링",       spec: "14K Rose Gold",           price: 320000, was: 380000 },
  { id: 4, cat: "bracelet", icon: "i-bracelet", metal: "gold",   name: "스텔라 테니스 브레이슬릿", spec: "18K Gold · Cubic",        price: 1250000, tag: "Best" },
  { id: 5, cat: "necklace", icon: "i-pearl",    metal: "gold",   name: "루미에르 펄 네크리스",    spec: "Akoya Pearl · 18K Gold",  price: 980000, tag: "New" },
  { id: 6, cat: "ring",     icon: "i-band",     metal: "rose",   name: "데일리 플레인 밴드",      spec: "14K Rose Gold",           price: 260000 },
  { id: 7, cat: "earring",  icon: "i-earring",  metal: "silver", name: "미니 써클 이어링",       spec: "14K White Gold",          price: 290000 },
  { id: 8, cat: "ring",     icon: "i-ring",     metal: "silver", name: "에테르 프로포즈 링",      spec: "Platinum · Diamond 0.5ct", price: 2400000, tag: "Bridal" },
];

const METAL_COLOR = { gold: "#d4b06f", silver: "#cfd2d6", rose: "#e0ab98" };
const won = n => n.toLocaleString("ko-KR") + "원";

const grid = document.getElementById("products");
const cartCount = document.getElementById("cartCount");
const wishCount = document.getElementById("wishCount");
const toast = document.getElementById("toast");

let cart = 0;
const wishes = new Set();

function render(filter = "all") {
  const list = filter === "all" ? PRODUCTS : PRODUCTS.filter(p => p.cat === filter);
  grid.innerHTML = list.map((p, i) => {
    const tag = p.was
      ? `<span class="product__tag product__tag--sale">Sale</span>`
      : p.tag ? `<span class="product__tag">${p.tag}</span>` : "";
    const off = p.was ? `<span class="off">${Math.round((1 - p.price / p.was) * 100)}%</span>` : "";
    const was = p.was ? `<del>${won(p.was)}</del>` : "";
    return `
      <article class="product" style="animation-delay:${i * 60}ms">
        <div class="product__img" style="--metal:url(#${p.metal})">
          ${tag}
          <button class="wish ${wishes.has(p.id) ? "is-on" : ""}" data-id="${p.id}" aria-label="${p.name} 위시리스트에 담기" aria-pressed="${wishes.has(p.id)}">
            <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>
          </button>
          <svg aria-hidden="true"><use href="#${p.icon}"/></svg>
          <button class="add-cart" data-id="${p.id}">장바구니 담기</button>
        </div>
        <div class="product__info">
          <p class="product__metal">${p.spec}</p>
          <h3 class="product__name">${p.name}</h3>
          <p class="product__price">${off}<span>${won(p.price)}</span>${was}</p>
          <div class="swatches" aria-hidden="true">
            ${["gold", "rose", "silver"].map(m => `<i style="background:${METAL_COLOR[m]}"></i>`).join("")}
          </div>
        </div>
      </article>`;
  }).join("");
}

function bumpBadge(el, n) {
  el.textContent = n;
  el.classList.toggle("has-items", n > 0);
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-show"), 2200);
}

grid.addEventListener("click", e => {
  const add = e.target.closest(".add-cart");
  const wish = e.target.closest(".wish");
  if (add) {
    const p = PRODUCTS.find(x => x.id === +add.dataset.id);
    cart++;
    bumpBadge(cartCount, cart);
    showToast(`‘${p.name}’을(를) 장바구니에 담았습니다`);
  }
  if (wish) {
    const id = +wish.dataset.id;
    wishes.has(id) ? wishes.delete(id) : wishes.add(id);
    const on = wishes.has(id);
    wish.classList.toggle("is-on", on);
    wish.setAttribute("aria-pressed", on);
    bumpBadge(wishCount, wishes.size);
  }
});

// 필터
const chips = document.querySelectorAll(".chip");
function setFilter(f) {
  chips.forEach(c => {
    const on = c.dataset.filter === f;
    c.classList.toggle("is-active", on);
    c.setAttribute("aria-selected", on);
  });
  render(f);
}
chips.forEach(c => c.addEventListener("click", () => setFilter(c.dataset.filter)));
document.querySelectorAll("[data-jump]").forEach(a =>
  a.addEventListener("click", () => setFilter(a.dataset.jump))
);

// 헤더 스크롤 그림자
const header = document.getElementById("header");
const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 10);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// 모바일 메뉴
const toggle = document.querySelector(".menu-toggle");
const mobileNav = document.getElementById("mobileNav");
toggle.addEventListener("click", () => {
  const open = toggle.getAttribute("aria-expanded") !== "true";
  toggle.setAttribute("aria-expanded", open);
  mobileNav.classList.toggle("is-open", open);
});
mobileNav.addEventListener("click", e => {
  if (e.target.tagName === "A") {
    toggle.setAttribute("aria-expanded", "false");
    mobileNav.classList.remove("is-open");
  }
});

// 스크롤 등장 애니메이션 + 숫자 카운트
document.querySelectorAll(".section__head, .cat, .collection__text, .bridal__card, .story blockquote, .stats, .review, .newsletter")
  .forEach(el => el.classList.add("reveal"));

function countUp(el) {
  const target = +el.dataset.count;
  const start = performance.now();
  const dur = 1600;
  const step = now => {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased).toLocaleString("ko-KR");
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add("is-in");
      en.target.querySelectorAll("[data-count]").forEach(countUp);
      io.unobserve(en.target);
    });
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach(el => io.observe(el));
} else {
  document.querySelectorAll(".reveal").forEach(el => el.classList.add("is-in"));
  document.querySelectorAll("[data-count]").forEach(el => el.textContent = (+el.dataset.count).toLocaleString("ko-KR"));
}

// 뉴스레터
document.getElementById("newsletterForm").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("email");
  const msg = document.getElementById("newsletterMsg");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) {
    msg.textContent = "올바른 이메일 주소를 입력해 주세요.";
    msg.classList.add("is-error");
    return;
  }
  msg.classList.remove("is-error");
  msg.textContent = "구독해 주셔서 감사합니다. 첫 구매 10% 쿠폰을 메일로 보내드렸어요.";
  input.value = "";
});

render();
