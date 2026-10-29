/* 공통: Supabase 클라이언트 + 실시간 시세 계산 (홈페이지·관리자 페이지 공용) */
(function () {
  const cfg = window.YAMOO_CONFIG || {};
  const sb = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

  const OZ = 31.1034768; // 1 트로이온스(g)
  const DON = 3.75;
  const VAT = 1.1;

  const DEFAULT_SETTINGS = {
    gold_buy_pct: 14, gold_sell_pct: 6, k18_factor: 0.735, k14_factor: 0.57,
    pt_buy_pct: 22, pt_sell_pct: 0, ag_buy_pct: 35, ag_sell_pct: -2,
  };

  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  // 국제 시세(USD/oz) + 원/달러 환율
  async function fetchLive() {
    const syms = ["XAU", "XAG", "XPT", "XPD"];
    const [metals, fx] = await Promise.all([
      Promise.all(syms.map(s => getJSON("https://api.gold-api.com/price/" + s))),
      getJSON("https://open.er-api.com/v6/latest/USD"),
    ]);
    const usd = {};
    metals.forEach(m => { usd[m.symbol] = Number(m.price); });
    const krw = Number(fx.rates && fx.rates.KRW);
    if (!usd.XAU || !krw) throw new Error("시세 응답 형식 오류");
    return { usd, krw, updatedAt: new Date(metals[0].updatedAt) };
  }

  async function fetchSettings() {
    if (!sb) return { ...DEFAULT_SETTINGS };
    const { data, error } = await sb.from("price_settings").select("*").eq("id", 1).maybeSingle();
    if (error || !data) return { ...DEFAULT_SETTINGS };
    const s = { ...DEFAULT_SETTINGS };
    Object.keys(DEFAULT_SETTINGS).forEach(k => { if (data[k] != null) s[k] = Number(data[k]); });
    return s;
  }

  const r100 = n => Math.round(n / 100) * 100;
  const r10 = n => Math.round(n / 10) * 10;

  // 국내 시세 (3.75g 기준, 원)
  function computeDomestic(live, s) {
    const perDon = sym => (live.usd[sym] * live.krw / OZ) * DON;
    const gold = perDon("XAU"), pt = perDon("XPT"), ag = perDon("XAG");
    const goldSell = gold * (1 + s.gold_sell_pct / 100);
    return {
      base: { gold, pt, ag },
      items: [
        { key: "24k", name: "순금 24K", sub: "99.99%", buy: r100(gold * (1 + s.gold_buy_pct / 100) * VAT), sell: r100(goldSell) },
        { key: "18k", name: "18K", sub: "75.0%", buy: null, sell: r100(goldSell * s.k18_factor) },
        { key: "14k", name: "14K", sub: "58.5%", buy: null, sell: r100(goldSell * s.k14_factor) },
        { key: "pt", name: "백금", sub: "Pt 99.95%", buy: r100(pt * (1 + s.pt_buy_pct / 100) * VAT), sell: r100(pt * (1 + s.pt_sell_pct / 100)) },
        { key: "ag", name: "은", sub: "Ag 99.99%", buy: r10(ag * (1 + s.ag_buy_pct / 100) * VAT), sell: r10(ag * (1 + s.ag_sell_pct / 100)) },
      ],
    };
  }

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const won = n => Math.round(n).toLocaleString("ko-KR") + "원";
  const fmtDate = (d, withTime = true) => {
    if (!d) return "-";
    d = new Date(d);
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}` + (withTime ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : "");
  };

  window.YAMOO = { sb, OZ, DON, VAT, DEFAULT_SETTINGS, fetchLive, fetchSettings, computeDomestic, esc, won, fmtDate };
})();
