/* 상품 사진을 누르면 크게 보기 (홈페이지 · 순금선물 공용) */
(function () {
  const SEL = ".product__img img, .bar__img img, .zcard__img img, .gcard__img img";
  const box = document.createElement("div");
  box.className = "lightbox";
  box.hidden = true;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "상품 사진 크게 보기");
  box.innerHTML = `<button type="button" class="lightbox__x" aria-label="닫기">×</button>
    <figure class="lightbox__fig"><img alt=""><figcaption></figcaption></figure>`;
  document.body.appendChild(box);
  const img = box.querySelector("img"), cap = box.querySelector("figcaption");
  let lastFocus = null, prevOverflow = "";

  function open(src, name) {
    img.src = src;
    img.alt = name || "";
    cap.textContent = name || "";
    lastFocus = document.activeElement;
    prevOverflow = document.body.style.overflow;
    box.hidden = false;
    document.body.style.overflow = "hidden";
    box.querySelector(".lightbox__x").focus();
  }
  function close() {
    box.hidden = true;
    document.body.style.overflow = prevOverflow;
    img.removeAttribute("src");
    if (lastFocus) lastFocus.focus();
  }

  document.addEventListener("click", e => {
    const t = e.target.closest(SEL);
    if (!t || e.target.closest("button, a")) return;
    const card = t.closest("article, li");
    const nameEl = card && card.querySelector(".product__name, .bar__name, .gcard__name, h4");
    let name = nameEl ? nameEl.textContent.trim() : t.alt;
    if (t.closest(".zcard__img")) name = "GBK 카드형 골드바 1g · " + name;
    open(t.currentSrc || t.src, name);
  });
  box.addEventListener("click", e => { if (e.target === box || e.target.closest(".lightbox__x") || e.target.closest(".lightbox__fig")) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !box.hidden) { e.stopPropagation(); close(); } }, true);
})();
