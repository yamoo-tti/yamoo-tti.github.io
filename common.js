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

  // 상품 판매가 = 시세(g당) × 중량 × (1 + 시세 대비 %) + 공임
  //   시세: 골드바·카드형·순금 24K = 순금 살 때 / 실버바·실버 주얼리 = 은 살 때 / 18K·14K = 해당 함량 팔 때 × 1.3
  //   끝자리: 골드바·카드형·실버바(그래뉼) 1,000원 단위 올림, 주얼리·순금선물 1,000원 단위 반올림
  //  ※ supabase quote_price 와 같은 식 유지
  const up1000 = x => Math.ceil(Math.round(x) / 1000) * 1000;
  function productPrice(p, d) {
    const g = key => d.items.find(i => i.key === key);
    const w = Number(p.weight_g), k = 1 + Number(p.premium_pct || 0) / 100, l = Number(p.labor || 0);
    if (p.kind === "silver") return up1000(g("ag").buy / DON * w * k + l);
    if (p.kind === "accessory" || p.kind === "gift") {
      const kt = String(p.karat).toUpperCase();
      const rate = kt === "24K" || kt === "SV" ? g(kt === "SV" ? "ag" : "24k").buy / DON : g(kt.toLowerCase()).sell / DON * 1.3;
      return Math.round((rate * w * k + l) / 1000) * 1000;
    }
    return up1000(g("24k").buy / DON * w * k + l);
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
  const ORDER_STATUS = { new: "접수", confirmed: "금액 확정·입금 대기", paid: "입금 확인", ready: "수령 준비·발송", done: "완료", canceled: "취소" };
  const SELL_STATUS = { new: "접수", scheduled: "일정 확정", received: "입고·감정", done: "지급 완료", canceled: "취소" };
  const fmtPhone = p => String(p || "").replace(/^(02|0\d{2})(\d{3,4})(\d{4})$/, "$1-$2-$3");
  const fmtBiz = n => String(n || "").replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3");

  // 현금영수증 · 계산서 종류
  const RECEIPT = { personal: "현금영수증 (소득공제)", business: "현금영수증 (지출증빙)", invoice: "세금계산서", none: "미신청" };
  // 택배 배송 조회 (택배사 + 송장번호로 네이버 배송 조회)
  const COURIERS = ["우체국택배", "CJ대한통운", "한진택배", "롯데택배", "로젠택배", "경동택배"];
  const trackUrl = (courier, no) => "https://search.naver.com/search.naver?query=" + encodeURIComponent(`${courier || ""} ${no}`.trim());

  // 상품정보 제공고시 (귀금속·보석·시계류). 관리자가 상품마다 info 칸에 적은 값이 있으면 그 값을 씀
  const INFO_FIELDS = { material: "소재 · 순도", weight: "중량", origin: "제조국", size: "치수", caution: "착용·보관 시 주의사항", spec: "주요 사양 · 등급" };
  function infoDefaults(p) {
    const w = Number(p.weight_g), k = p.kind;
    const don = Math.round(w / DON * 1000) / 1000;
    const gold = k === "bar" || k === "zodiac" || k === "gift";
    return {
      material: k === "silver" ? "순은 (Ag 999.9)" : gold || p.karat === "24K" ? "순금 24K (Au 999.9)" : p.karat === "SV" ? "실버 925 (은 함량 92.5%)"
        : p.karat === "18K" ? "18K 금 (금 함량 75%)" : p.karat === "14K" ? "14K 금 (금 함량 58.5%)" : String(p.karat || ""),
      weight: k === "accessory" ? `약 ${w}g (수작업 특성상 조금 차이가 날 수 있어요)`
        : (w >= 1000 && w % 1000 === 0 ? `${w / 1000}kg` : `${w}g`) + (gold ? ` (${don}돈)` : ""),
      origin: "한국",
      size: k === "zodiac" ? "카드형 (상품 이미지 참고)" : "상품 이미지 참고",
      caution: k === "accessory" || (k === "gift" && ["dol"].includes(p.category))
        ? "향수·화장품·땀·온천수·바닷물에 닿으면 변색될 수 있어요. 운동·잠잘 때는 빼 두고, 다른 장신구와 따로 보관해 주세요."
        : "투자·소장용 제품이에요. 맨손으로 만지면 지문·얼룩이 남을 수 있으니 받은 케이스에 넣어 보관해 주세요." + (k === "silver" ? " 은은 공기와 닿으면 색이 변할 수 있어요." : ""),
      spec: "해당 없음 (보석 없음)",
    };
  }
  function productInfo(p) {
    const d = infoDefaults(p), o = (p && p.info) || {};
    const rows = Object.entries(INFO_FIELDS).map(([key, label]) => [label, String(o[key] || "").trim() || d[key]]);
    return rows.concat([
      ["보증서 제공 여부", "제공 (모든 상품에 보증서 동봉)"],
      ["품질보증기준", "공정거래위원회 소비자분쟁해결기준에 따름"],
      ["A/S 책임자 · 전화번호", "금비 GOLD · 010-5287-8002"],
    ]);
  }

  // 인기순: 판매 1개 = 조회 30번으로 쳐서 점수가 높은 상품이 앞으로. 많이 팔린 상위 상품은 BEST
  async function loadStats() {
    if (!sb) return {};
    const { data, error } = await sb.from("product_stats").select("product_id,views,sold,searches");
    if (error || !data) return {};
    const m = {};
    data.forEach(r => { m[r.product_id] = r; });
    return m;
  }
  // 인기 점수 = 판매 × 30 + 검색으로 찾음 × 3 + 조회
  const popScore = (p, st) => { const s = st[p.id]; return s ? s.sold * 30 + (s.searches || 0) * 3 + s.views : 0; };
  function rankProducts(list, st, bestN = 3) {
    st = st || {};
    const ranked = list.map((p, i) => ({ p, i, s: popScore(p, st) })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.p);
    const best = new Set(list.filter(p => st[p.id] && st[p.id].sold > 0)
      .sort((a, b) => st[b.id].sold - st[a.id].sold).slice(0, bestN).map(p => p.id));
    return { list: ranked, best };
  }
  // 조회 1번 기록 (같은 상품은 이 브라우저에서 하루 1번만)
  function trackView(id) {
    if (!sb || !id || String(id).startsWith("idx:")) return;
    const k = "keumbi_v_" + id, today = new Date().toDateString();
    try { if (localStorage.getItem(k) === today) return; localStorage.setItem(k, today); } catch { /* 저장이 막혀 있으면 그냥 기록 */ }
    sb.rpc("bump_view", { p_id: id }).then(() => {}, () => {});
  }
  // 검색 결과에서 상품을 누름 1번 기록 (같은 상품은 이 브라우저에서 하루 1번만)
  function trackSearch(id) {
    if (!sb || !id || String(id).startsWith("idx:")) return;
    const k = "keumbi_s_" + id, today = new Date().toDateString();
    try { if (localStorage.getItem(k) === today) return; localStorage.setItem(k, today); } catch { /* 저장이 막혀 있으면 그냥 기록 */ }
    sb.rpc("bump_search", { p_id: id }).then(() => {}, () => {});
  }

  // 검색어 기록 (같은 검색어는 이 창에서 1번만 · 결과 0개였는지도 함께)
  const loggedTerms = new Set();
  function trackTerm(term, results) {
    const t = String(term || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!sb || t.length < 1 || t.length > 30 || loggedTerms.has(t)) return;
    loggedTerms.add(t);
    sb.rpc("track_search_term", { p_term: t, p_results: results | 0 }).then(() => {}, () => {});
  }

  // 방문자 기록: 하루·유입경로·기기별 숫자만 (같은 브라우저는 하루 1번, 개인정보 없음)
  function trackVisit() {
    if (!sb || /admin/.test(location.pathname)) return;
    const today = new Date().toDateString();
    try { if (localStorage.getItem("keumbi_visit") === today) return; localStorage.setItem("keumbi_visit", today); } catch { return; }
    const q = new URLSearchParams(location.search);
    const ref = (() => { try { return document.referrer ? new URL(document.referrer).hostname : ""; } catch { return ""; } })();
    const utm = (q.get("utm_source") || "").toLowerCase();
    let src = "direct";
    const has = s => utm.includes(s) || ref.includes(s);
    if (q.get("t") && /order-done/.test(location.pathname)) src = "email";
    else if (has("naver")) src = "naver";
    else if (has("google")) src = "google";
    else if (has("daum")) src = "daum";
    else if (has("kakao")) src = "kakao";
    else if (has("instagram")) src = "instagram";
    else if (has("facebook") || ref === "l.facebook.com" || ref === "m.facebook.com") src = "facebook";
    else if (has("youtube") || ref.includes("youtu.be")) src = "youtube";
    else if (ref && ref !== location.hostname) src = "other";
    const dev = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "pc";
    sb.rpc("track_visit", { p_source: src, p_device: dev }).then(() => {}, () => {});
  }
  trackVisit();

  window.YAMOO = { loadStats, rankProducts, trackView, trackSearch, trackTerm, sb, OZ, DON, VAT, DEFAULT_SETTINGS, fetchLive, perDon, fetchSettings, computeDomestic, productPrice, ORDER_STATUS, SELL_STATUS, fmtPhone, fmtBiz, RECEIPT, COURIERS, trackUrl, esc, won, fmtDate, INFO_FIELDS, infoDefaults, productInfo };
})();
