/* 순금선물 페이지: 오늘 순금 시세로 중량별 예상 금값 표시 */
(function () {
  const Y = window.YAMOO;
  const $$ = s => document.querySelectorAll(s);

  async function load() {
    try {
      const [live, s] = await Promise.all([Y.fetchLive(), Y.fetchSettings()]);
      const d = Y.computeDomestic(live, s);
      const donBuy = d.items.find(i => i.key === "24k").buy; // 순금 살 때 (1돈, VAT 포함)
      document.getElementById("rateDon").textContent = Y.won(donBuy);
      document.getElementById("rateTime").textContent = Y.fmtDate(new Date());
      $$("[data-w]").forEach(el => {
        const g = Number(el.dataset.w);
        el.textContent = Y.won(Math.round(donBuy / Y.DON * g / 100) * 100);
      });
    } catch (e) {
      document.getElementById("rateDon").textContent = "매장 문의";
      $$("[data-w]").forEach(el => { el.textContent = "매장 문의"; });
    }
  }
  load();
  setInterval(load, 60000);

  // 위쪽 분류 탭: 지금 보고 있는 구역 표시
  const tabs = [...$$(".gift-tabs a")];
  const io = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      tabs.forEach(a => a.classList.toggle("is-on", a.getAttribute("href") === "#" + e.target.id));
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  $$(".gift-sec").forEach(s => io.observe(s));
})();
