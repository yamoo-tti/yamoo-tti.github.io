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
      material: k === "silver" ? "순은 (Ag 999.9)" : k === "bar" || k === "zodiac" ? "순금 24K (Au 999.9)"
        : k === "accessory" && p.karat === "24K" || p.opt_group === "순금 콩알금" ? "순금 24K (Au 999 · 순도 99.9%)" : gold || p.karat === "24K" ? "순금 24K (Au 999.9)" : p.karat === "SV" ? "실버 925 (은 함량 92.5%)"
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
  // 옵션 묶음: opt_group이 같은 상품들을 카드 하나로 → [[상품], [옵션1, 옵션2, …], …]
  // 목록 순서는 묶음에서 가장 먼저 나온 상품 자리, 묶음 안은 중량 순
  function groupOptions(list) {
    const out = [], at = {};
    list.forEach(p => {
      const g = String(p.opt_group || "").trim();
      if (!g) return out.push([p]);
      if (at[g] == null) { at[g] = out.length; out.push([]); }
      out[at[g]].push(p);
    });
    out.forEach(o => o.length > 1 && o.sort((a, b) => Number(a.weight_g) - Number(b.weight_g) || (a.sort || 0) - (b.sort || 0)));
    return out;
  }
  // 사이즈 · 추가 옵션(예: 18K 잠금장식) — 주문 상품명 뒤 '(사이즈 17cm · 18K 잠금장식)'은 서버 opt_check와 같은 글자
  const sizeUnit = p => p.category === "ring" ? "호" : "cm"; // 반지는 호, 팔찌·목걸이는 cm (서버 opt_check와 같게)
  const sizeList = p => String(p.sizes || "").split(",").map(s => s.trim()).filter(Boolean);
  const hasAddon = p => !!String(p.addon_name || "").trim() && Number(p.addon_price) > 0;
  const needsPick = p => sizeList(p).length > 0 || hasAddon(p);
  // 발송까지 걸리는 시간 안내: 주얼리는 주문 후 제작(보통 2주) · 골드바·실버바·콩알금·돌반지는 빠르게 발송 · 그 밖의 순금선물은 재고에 따라 다름
  const leadTime = p => !p ? null : p.kind === "accessory" ? { slow: true, short: "제작 약 2주", text: "주문 후 제작하는 주얼리예요 · 발송까지 보통 2주 정도 걸려요" }
    : (["bar", "zodiac", "silver"].includes(p.kind) || p.opt_group === "순금 콩알금" || p.category === "dol") ? { slow: false, short: "빠른 발송", text: "입금 확인 후 빠르게 발송해요" }
    : p.kind === "gift" ? { slow: false, short: "재고 확인", text: "재고 상황에 따라 발송일이 달라요 · 입금 확인 후 발송일을 알려 드려요" } : null;
  // 고른 사이즈만큼 중량·공임을 바꾼 상품 (supabase size_scaled와 같은 식: 중량 소수 둘째 자리, 공임 원 단위)
  const sized = (p, size) => {
    const b = Number(p.base_size), s = Number(size);
    if (!(b > 0) || !sizeList(p).length || !(s > 0)) return p;
    const r = s / b;
    return { ...p, weight_g: Math.round(Number(p.weight_g) * r * 100) / 100, labor: Math.round(Number(p.labor || 0) * r) };
  };
  const pickLabel = (p, size, addon) => {
    const w = Number(sized(p, size).weight_g);
    return [size ? `사이즈 ${size}${sizeUnit(p)}` : "", addon && hasAddon(p) ? String(p.addon_name).trim() : "", w !== Number(p.weight_g) ? `${w}g` : ""].filter(Boolean).join(" · ");
  };
  const optLabel = p => {
    const t = String(p.opt_label || "").trim(), w = Number(p.weight_g), d = w / DON;
    return t || (w >= DON / 2 && Math.abs(d * 2 - Math.round(d * 2)) < 1e-6 ? (d === 0.5 ? "반돈" : `${d}돈`) : `${w}g`);
  };
  const optPick = (opts, id) => opts.find(p => p.id === id) || opts.find(p => !p.sold_out) || opts[0];
  const optTitle = (opts, p) => opts.length > 1 ? String(p.opt_group).trim() : p.name;
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
    else if (has("threads")) src = "threads"; // threads.net · threads.com · 링크에 ?utm_source=threads
    else if (has("instagram")) src = "instagram";
    else if (has("facebook") || ref === "l.facebook.com" || ref === "m.facebook.com") src = "facebook";
    else if (has("youtube") || ref.includes("youtu.be")) src = "youtube";
    else if (ref && ref !== location.hostname) src = "other";
    const dev = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "pc";
    sb.rpc("track_visit", { p_source: src, p_device: dev }).then(() => {}, () => {});
  }
  trackVisit();

  // 회원 등급 뱃지: 금속 베젤에 브릴리언트 컷 원석이 박힌 모양 (브론즈·실버·골드·VIP 다이아)
  //   면(facet)마다 빛 방향(왼쪽 위)에 따라 밝기를 달리 칠해 실제 보석처럼 보이게 함
  const GEM = {
    basic:  { n: "브론즈", m: ["#f7d2ad", "#b8743f", "#4f2810"], g: ["#ffc2a8", "#c0392b", "#3d0806"] }, // 동 + 가넷
    silver: { n: "실버",   m: ["#ffffff", "#c3cbd4", "#4f5864"], g: ["#cfe0ff", "#2f62d6", "#071645"] }, // 은 + 사파이어
    gold:   { n: "골드",   m: ["#fff4c2", "#dcaa2a", "#6b4904"], g: ["#ffc9d2", "#d4123e", "#45020f"] }, // 금 + 루비
    vip:    { n: "VIP",    m: ["#ffffff", "#dfe5ec", "#7b8796"], g: ["#ffffff", "#d7e4f1", "#5d7690"] }, // 백금 + 다이아몬드
  };
  const GRADE_NAME = { basic: "브론즈", silver: "실버", gold: "골드", vip: "VIP" };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => "#" + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");
  // 0(어두움) ~ 1(밝음) → 원석 색
  const shade = (g, v) => v < .5 ? mix(g[2], g[1], v * 2) : mix(g[1], g[0], (v - .5) * 2);
  function gradeBadge(grade, size) {
    const k = GEM[grade] ? grade : "basic", t = GEM[k], w = size || 20;
    const id = "gb" + k + Math.random().toString(36).slice(2, 7);
    const C = 16, R = 10.6, rad = d => d * Math.PI / 180;
    const pt = (deg, r) => [(C + r * Math.cos(rad(deg))).toFixed(2), (C + r * Math.sin(rad(deg))).toFixed(2)].join(",");
    const L = -135; // 빛: 왼쪽 위
    const lit = deg => (Math.cos(rad(deg - L)) + 1) / 2; // 빛을 정면으로 받을수록 1
    const fire = ["#ffd6e8", "#d6ecff", "#fff3c4", "#dff7e6"]; // 다이아몬드 무지개빛
    let facets = "";
    for (let i = 0; i < 8; i++) {
      const a = i * 45, T0 = pt(a, R * .5), T1 = pt(a + 45, R * .5), S = pt(a + 22.5, R * .76), Sp = pt(a - 22.5, R * .76);
      const G0 = pt(a, R), G1 = pt(a + 22.5, R), G2 = pt(a + 45, R);
      const v = lit(a), vs = lit(a + 22.5);
      const col = x => k === "vip" && i % 3 === 1 && x > .55 ? mix(shade(t.g, x), fire[i % 4], .35) : shade(t.g, x);
      facets += `<polygon points="${T0} ${Sp} ${G0} ${S}" fill="${col(.15 + v * .8)}"/>`;                 // 크라운(카이트) 면
      facets += `<polygon points="${S} ${G0} ${G1}" fill="${col(.9 - vs * .75)}"/>`;                       // 거들 면 (반대로 빛나 대비)
      facets += `<polygon points="${S} ${G1} ${G2}" fill="${col(.25 + vs * .6)}"/>`;
      facets += `<polygon points="${T0} ${T1} ${S}" fill="${col(.35 + vs * .55)}"/>`;                      // 스타 면
    }
    const table = Array.from({ length: 8 }, (_, i) => pt(i * 45, R * .5)).join(" ");
    const spark = (x, y, s, o) => `<path d="M${x} ${y - s}C${x + s * .12} ${y - s * .12} ${x + s * .12} ${y - s * .12} ${x + s} ${y}C${x + s * .12} ${y + s * .12} ${x + s * .12} ${y + s * .12} ${x} ${y + s}C${x - s * .12} ${y + s * .12} ${x - s * .12} ${y + s * .12} ${x - s} ${y}C${x - s * .12} ${y - s * .12} ${x - s * .12} ${y - s * .12} ${x} ${y - s}Z" fill="#fff" opacity="${o}"/>`;
    return `<svg class="gbadge gbadge--${k}" viewBox="0 0 32 32" width="${w}" height="${w}" role="img" aria-label="${t.n} 등급"><title>${t.n} 등급</title>
      <defs>
        <linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.m[0]}"/><stop offset=".45" stop-color="${t.m[1]}"/><stop offset="1" stop-color="${t.m[2]}"/></linearGradient>
        <linearGradient id="${id}b" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${t.m[0]}"/><stop offset=".5" stop-color="${t.m[1]}"/><stop offset="1" stop-color="${t.m[2]}"/></linearGradient>
        <linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(t.g, .95)}"/><stop offset=".6" stop-color="${shade(t.g, .55)}"/><stop offset="1" stop-color="${shade(t.g, .35)}"/></linearGradient>
        <radialGradient id="${id}s" cx=".5" cy=".5" r=".5"><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15.2" fill="url(#${id}a)"/>
      <circle cx="16" cy="16" r="15.2" fill="none" stroke="${t.m[2]}" stroke-opacity=".55" stroke-width=".6"/>
      <circle cx="16" cy="16" r="13.6" fill="none" stroke="${t.m[0]}" stroke-opacity=".75" stroke-width=".5"/>
      <circle cx="16" cy="16" r="12.3" fill="url(#${id}b)"/>
      <circle cx="16" cy="16" r="${R + .35}" fill="${t.m[2]}"/>
      ${facets}
      <polygon points="${table}" fill="url(#${id}t)" stroke="#fff" stroke-opacity=".35" stroke-width=".25"/>
      <circle cx="16" cy="16" r="${R}" fill="url(#${id}s)"/>
      <path d="M${pt(-160, R * .9)} A${R * .9} ${R * .9} 0 0 1 ${pt(-110, R * .9)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".8" stroke-linecap="round"/>
      ${spark(12.2, 11.6, k === "vip" ? 3.4 : 2.4, .95)}
      ${k === "vip" ? spark(25.6, 6.2, 2.6, 1) + spark(6.5, 25, 1.6, .85) : ""}
    </svg>`;
  }

  window.YAMOO = { gradeBadge, GRADE_NAME, sizeUnit, sizeList, hasAddon, needsPick, leadTime, pickLabel, sized, loadStats, rankProducts, groupOptions, optLabel, optPick, optTitle,trackView, trackSearch, trackTerm, sb, OZ, DON, VAT, DEFAULT_SETTINGS, fetchLive, perDon, fetchSettings, computeDomestic, productPrice, ORDER_STATUS, SELL_STATUS, fmtPhone, fmtBiz, RECEIPT, COURIERS, trackUrl, esc, won, fmtDate, INFO_FIELDS, infoDefaults, productInfo };
})();
