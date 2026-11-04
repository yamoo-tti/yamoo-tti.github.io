/* 카카오톡 채널 상담 버튼 (오른쪽 아래 고정) — 채널 주소가 바뀌면 아래 한 줄만 고치면 됨 */
(function () {
  const CHAT = "https://pf.kakao.com/_yvxhxeX/chat";
  window.KAKAO_CHAT = CHAT;

  const css = document.createElement("style");
  css.textContent = `
    .kakao-fab { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 90;
      display: inline-flex; align-items: center; gap: 7px; padding: 12px 16px 12px 13px; border-radius: 999px;
      background: #FEE500; color: #191919; font: 700 14px/1 "Noto Sans KR", sans-serif; text-decoration: none;
      box-shadow: 0 6px 20px -6px rgba(0,0,0,.35); transition: transform .2s, box-shadow .2s; }
    .kakao-fab:hover { transform: translateY(-2px); box-shadow: 0 10px 24px -8px rgba(0,0,0,.4); }
    .kakao-fab:focus-visible { outline: 3px solid #191919; outline-offset: 2px; }
    .kakao-fab svg { width: 22px; height: 22px; flex: none; }
    @media (max-width: 600px) { .kakao-fab { right: 12px; padding: 11px 14px 11px 12px; font-size: 13px; } }
    @media print { .kakao-fab { display: none; } }`;
  document.head.appendChild(css);

  const a = document.createElement("a");
  a.className = "kakao-fab";
  a.href = CHAT;
  a.target = "_blank";
  a.rel = "noopener";
  a.setAttribute("aria-label", "카카오톡으로 상담하기 (새 창)");
  a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3.5c-5.25 0-9.5 3.33-9.5 7.44 0 2.66 1.78 4.99 4.46 6.3l-.9 3.32c-.08.3.26.54.52.37l3.94-2.6c.48.05.97.08 1.48.08 5.25 0 9.5-3.33 9.5-7.47S17.25 3.5 12 3.5z"/></svg>카톡 상담`;
  document.body.appendChild(a);
})();
