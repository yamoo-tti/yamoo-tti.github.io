/* 공통: Supabase 클라이언트 + 실시간 시세 계산 (홈페이지·관리자 페이지 공용) */
(function () {
  const cfg = window.YAMOO_CONFIG || {};
  const sb = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

  const OZ = 31.1034768; // 1 트로이온스(g)
  const DON = 3.75;
  const VAT = 1.1;

  // 2026.10.29 국내 실거래 시세(순금 살 때 763,000 / 팔 때 647,000 등)에 맞춘 기본값
  const DEFAULT_SETTINGS = {
    gold_buy_pct: 7.2, gold_sell_pct: 0, k18_factor: 0.735, k14_factor: 0.57,
    pt_buy_pct: 6.8, pt_sell_pct: -4.6, ag_buy_pct: 2.9, ag_sell_pct: -3.8,
  };

  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  // 국제 시세 — 원화(KRW/oz)로 바로 받음. 실시간 원/달러 환율 포함
  async function fetchLive() {
    const syms = ["XAU", "XAG", "XPT", "XPD"];
    const metals = await Promise.all(syms.map(s => getJSON(`https://api.gold-api.com/price/${s}/KRW`)));
    let krw = Number(metals[0].exchangeRate);
    if (!krw) {
      const fx = await getJSON("https://open.er-api.com/v6/latest/USD");
      krw = Number(fx.rates && fx.rates.KRW);
    }
    const usd = {};
    metals.forEach(m => { usd[m.symbol] = Number(m.price) / (Number(m.exchangeRate) || krw); });
    if (!usd.XAU || !krw) throw new Error("시세 응답 형식 오류");
    return { usd, krw, updatedAt: new Date(metals[0].updatedAt) };
  }

  // 국제 시세를 원화 1돈(3.75g) 가격으로 환산
  const perDon = (live, sym) => live.usd[sym] * live.krw / OZ * DON;

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
    const gold = perDon(live, "XAU"), pt = perDon(live, "XPT"), ag = perDon(live, "XAG");
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

  // 상품 판매가 — 골드바·카드형: 순금 살 때(g당) × 중량 × (1+프리미엄%)
  //               실버바·은 그래뉼: 은 살 때(g당) × 중량 × (1+프리미엄%)
  //               악세사리: 해당 함량 팔 때(g당) × 1.3 × 중량 + 공임
  function productPrice(p, d) {
    const g = key => d.items.find(i => i.key === key);
    if (p.kind === "silver") return r100(g("ag").buy / DON * Number(p.weight_g) * (1 + Number(p.premium_pct || 0) / 100));
    if (p.kind === "accessory") {
      const rate = g(String(p.karat).toLowerCase()).sell / DON * 1.3;
      return Math.round((rate * Number(p.weight_g) + Number(p.labor || 0)) / 1000) * 1000;
    }
    return r100(g("24k").buy / DON * Number(p.weight_g) * (1 + Number(p.premium_pct || 0) / 100));
  }

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const won = n => Math.round(n).toLocaleString("ko-KR") + "원";
  const fmtDate = (d, withTime = true) => {
    if (!d) return "-";
    d = new Date(d);
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}` + (withTime ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : "");
  };

  // 주문·매입 진행 단계 (홈페이지 조회 + 관리자 공용)
  const ORDER_STATUS = { new: "접수", confirmed: "주문 확인", paid: "입금 확인", ready: "수령 준비 완료", done: "완료", canceled: "취소" };
  const SELL_STATUS = { new: "접수", scheduled: "일정 확정", received: "입고·감정", done: "지급 완료", canceled: "취소" };
  const fmtPhone = p => String(p || "").replace(/^(02|0\d{2})(\d{3,4})(\d{4})$/, "$1-$2-$3");

  window.YAMOO = { sb, OZ, DON, VAT, DEFAULT_SETTINGS, fetchLive, perDon, fetchSettings, computeDomestic, productPrice, ORDER_STATUS, SELL_STATUS, fmtPhone, esc, won, fmtDate };
})();
