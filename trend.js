/* 순금 시세 흐름 그래프 (supabase/price-history.sql 실행 후 동작) */
(function () {
  const { sb, won } = window.YAMOO;
  const $ = s => document.querySelector(s);
  const card = $("#trend");
  if (!card || !sb) return;
  let rows = [], days = 30;

  async function load() {
    const { data, error } = await sb.from("price_daily").select("day,au_buy,au_high,au_low").order("day", { ascending: false }).limit(366);
    if (error) return; // SQL 실행 전이면 칸을 숨긴 채로 둠
    rows = (data || []).reverse();
    card.hidden = false;
    draw();
  }

  const md = d => { const [, m, dd] = d.split("-"); return `${+m}/${+dd}`; };
  function draw() {
    const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const r = rows.filter(x => x.day >= from);
    const note = $("#trendNote"), box = $("#trendSvg");
    if (r.length < 2) {
      box.innerHTML = `<div class="trend__empty">시세 기록을 모으는 중이에요.<br><small>${rows.length ? `${md(rows[0].day)}부터 매일 기록하고 있어요. 며칠 뒤부터 그래프가 보여요.` : "오늘부터 매일 기록해요."}</small></div>`;
      note.textContent = r.length ? `오늘 순금 1돈 살 때 ${won(r[r.length - 1].au_buy)}` : "";
      return;
    }
    const W = 600, H = 200, P = { l: 8, r: 8, t: 16, b: 22 };
    const v = r.map(x => Number(x.au_buy));
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || hi * 0.01;
    const X = i => P.l + (W - P.l - P.r) * i / (r.length - 1);
    const Y = y => P.t + (H - P.t - P.b) * (1 - (y - lo) / span);
    const pts = v.map((y, i) => `${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join(" ");
    const iHi = v.indexOf(hi), iLo = v.indexOf(lo), last = v[v.length - 1], first = v[0];
    const diff = last - first, pct = diff / first * 100;
    const lab = (i, y, t, below) => `<text x="${Math.min(Math.max(X(i), 40), W - 40)}" y="${Y(y) + (below ? 14 : -6)}" text-anchor="middle" class="trend__lab">${t}</text>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 ${days}일 순금 1돈 살 때 가격 그래프, 최고 ${won(hi)}, 최저 ${won(lo)}, 현재 ${won(last)}">
      <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c09a45" stop-opacity=".28"/><stop offset="1" stop-color="#c09a45" stop-opacity="0"/></linearGradient></defs>
      <polygon points="${X(0)},${H - P.b} ${pts} ${X(r.length - 1)},${H - P.b}" fill="url(#trendFill)"/>
      <polyline points="${pts}" fill="none" stroke="#9c7629" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(r.length - 1)}" cy="${Y(last)}" r="4" fill="#9c7629"/>
      ${iHi !== iLo ? lab(iHi, hi, `최고 ${(hi / 10000).toFixed(1)}만`, false) + lab(iLo, lo, `최저 ${(lo / 10000).toFixed(1)}만`, true) : ""}
      <text x="${P.l}" y="${H - 4}" class="trend__axis">${md(r[0].day)}</text><text x="${W - P.r}" y="${H - 4}" text-anchor="end" class="trend__axis">${md(r[r.length - 1].day)}</text>
    </svg>`;
    note.innerHTML = `지금 <b>${won(last)}</b> · ${r.length}일 전보다 <b class="${diff > 0 ? "up" : diff < 0 ? "down" : ""}">${diff > 0 ? "▲" : diff < 0 ? "▼" : ""} ${won(Math.abs(diff))} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)</b>`;
  }

  card.addEventListener("click", e => {
    const t = e.target.closest("[data-days]");
    if (!t) return;
    days = +t.dataset.days;
    card.querySelectorAll("[data-days]").forEach(b => b.classList.toggle("is-on", b === t));
    draw();
  });

  load();
  setInterval(load, 30 * 60 * 1000);
})();
