/* 주문 완료 페이지: 확정 금액 · 입금 계좌 · 입금 기한(카운트다운) 안내 */
(function () {
  const { sb, esc, won, ORDER_STATUS } = window.YAMOO;
  const $ = s => document.querySelector(s);
  const PHONE = "010-5287-8002";
  const root = $("#od");
  const code = (new URLSearchParams(location.search).get("code") || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("is-show");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("is-show"), 2200);
  }
  const p2 = n => String(n).padStart(2, "0");
  const hm = d => { const x = new Date(d); return `${p2(x.getMonth() + 1)}/${p2(x.getDate())} ${p2(x.getHours())}:${p2(x.getMinutes())}`; };

  if (!code) { root.innerHTML = `<div class="od__card"><h1>주문 정보를 찾을 수 없어요</h1><p class="od__lead">홈페이지 상단 <b>접수 조회</b>에서 접수번호로 확인해 주세요.</p><a class="btn btn--dark od__btn" href="./">홈으로</a></div>`; return; }

  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem("keumbi_order_" + code)); } catch { saved = null; }
  if (saved) render(saved); else askPhone();

  // 새로고침하거나 다른 기기에서 열었을 때: 연락처로 다시 확인
  function askPhone(msg) {
    root.innerHTML = `
      <div class="od__card">
        <p class="od__kicker">주문 확인</p>
        <h1>접수번호 ${esc(code)}</h1>
        <p class="od__lead">주문하신 휴대폰 번호를 입력하면 입금 정보를 다시 보여드려요.</p>
        <form class="od__ask" id="askForm">
          <input type="tel" name="phone" placeholder="010-0000-0000" autocomplete="tel" required>
          <button class="btn btn--dark" type="submit">확인</button>
        </form>
        ${msg ? `<p class="od__err">${msg}</p>` : ""}
      </div>`;
    $("#askForm").addEventListener("submit", async e => {
      e.preventDefault();
      if (!sb) return askPhone(`지금은 확인할 수 없어요. ${PHONE}로 문의해 주세요.`);
      const phone = e.target.phone.value;
      const [{ data, error }, shop] = await Promise.all([
        sb.rpc("lookup_request", { p_code: code, p_phone: phone }),
        sb.from("shop_info").select("*").eq("id", 1).maybeSingle(),
      ]);
      const r = !error && data && data.find(x => x.kind === "order");
      if (!r) return askPhone("일치하는 주문이 없어요. 접수번호와 휴대폰 번호를 확인해 주세요.");
      const s = shop.data || {};
      render({ code, product: r.title, total: r.amount, deadline: r.deadline, status: r.status,
        bank_name: s.bank_name, bank_account: s.bank_account, bank_holder: s.bank_holder });
    });
  }

  function render(o) {
    const status = o.status || (o.total ? "confirmed" : "new");
    const steps = ["new", "confirmed", "paid", "ready", "done"];
    const labels = { new: "접수", confirmed: "입금 대기", paid: "입금 확인", ready: o.receive === "delivery" ? "발송" : "수령 준비", done: "완료" };
    const at = steps.indexOf(status);
    const track = status === "canceled" ? "" : `<ol class="od__steps">${steps.map((k, i) => `<li class="${i < at ? "is-past" : i === at ? "is-now" : ""}">${labels[k]}</li>`).join("")}</ol>`;

    if (status === "canceled") {
      root.innerHTML = `
        <div class="od__card">
          <p class="od__icon od__icon--off" aria-hidden="true">!</p>
          <h1>취소된 주문이에요</h1>
          <p class="od__lead">접수번호 <b>${esc(o.code)}</b><br>입금 기한이 지났거나 취소 처리된 주문입니다. 다시 구매하시려면 새로 신청해 주세요.</p>
          <div class="od__actions"><a class="btn btn--dark od__btn" href="./#goldbar">다시 주문하기</a><a class="btn od__btn od__btn--line" href="tel:${PHONE}">전화 문의</a></div>
        </div>`;
      return;
    }

    if (!o.total) {
      root.innerHTML = `
        <div class="od__card">
          <p class="od__icon" aria-hidden="true">✓</p>
          <h1>구매 신청이 접수됐어요</h1>
          <p class="od__code">접수번호 <strong>${esc(o.code)}</strong></p>
          ${track}
          <p class="od__lead">지금은 시세를 확인하지 못해 금액을 바로 확정하지 못했어요.<br>곧 매장에서 확정 금액과 입금 계좌를 연락드립니다.</p>
          <div class="od__actions"><a class="btn btn--dark od__btn" href="./">홈으로</a><a class="btn od__btn od__btn--line" href="tel:${PHONE}">전화 문의</a></div>
        </div>`;
      return;
    }

    const waiting = status === "confirmed";
    root.innerHTML = `
      <div class="od__card">
        <p class="od__icon" aria-hidden="true">✓</p>
        <h1>${waiting ? "주문이 확정됐어요" : esc(ORDER_STATUS[status] || "주문 진행 중")}</h1>
        <p class="od__code">접수번호 <strong>${esc(o.code)}</strong></p>
        ${track}

        ${waiting ? `
        <div class="od__timer" id="timer">
          <span>입금 마감까지</span>
          <strong id="remain">--:--</strong>
          <em>${hm(o.deadline)}까지 입금되지 않으면 자동 취소돼요</em>
        </div>` : ""}

        <dl class="od__info">
          ${o.product ? `<dt>상품</dt><dd>${esc(o.product)}${o.qty ? ` × ${o.qty}` : ""}</dd>` : ""}
          ${o.locked_at ? `<dt>금액 확정</dt><dd>${hm(o.locked_at)} 시세 기준</dd>` : ""}
          <dt>${waiting ? "입금하실 금액" : "확정 금액"}</dt>
          <dd class="od__amount">${won(o.total)}${Number(o.shipping_fee) ? `<small>택배비 ${won(o.shipping_fee)} 포함</small>` : ""}</dd>
          ${waiting ? `
          <dt>입금 계좌</dt>
          <dd><b>${esc(o.bank_name || "")} ${esc(o.bank_account || "")}</b><br><span class="muted">예금주 ${esc(o.bank_holder || "")}</span>
            <div class="od__copy">
              <button type="button" class="copy-btn" data-copy="${esc(o.bank_account || "")}">계좌번호 복사</button>
              <button type="button" class="copy-btn" data-copy="${esc(String(o.total))}">금액 복사</button>
            </div></dd>` : ""}
        </dl>

        ${waiting ? `<ul class="od__notes">
          <li>입금자명은 주문하신 분 이름과 같게 해 주세요.</li>
          <li>금액을 정확히 입금해 주셔야 빠르게 확인돼요.</li>
          <li>${o.receive === "delivery" ? "입금 확인 후 보험 등기 택배로 발송해 드려요." : "입금 확인 후 매장 수령 일정을 안내해 드려요."}</li>
          <li>같은 내용이 문자로도 발송돼요. 진행 상황은 홈페이지 <b>접수 조회</b>에서 확인할 수 있어요.</li>
          <li>금·은 시세 상품은 입금 후 단순 변심 취소가 어려워요. <a href="terms.html#a11">자세히</a></li>
        </ul>` : ""}

        <div class="od__actions">
          <a class="btn btn--dark od__btn" href="./">홈으로</a>
          <a class="btn od__btn od__btn--line" href="tel:${PHONE}">전화 문의 ${PHONE}</a>
        </div>
      </div>`;

    if (waiting) tick(new Date(o.deadline));
  }

  function tick(deadline) {
    const el = $("#remain"), box = $("#timer");
    const run = () => {
      const s = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      el.textContent = `${p2(Math.floor(s / 60))}:${p2(s % 60)}`;
      box.classList.toggle("is-urgent", s > 0 && s <= 300);
      if (s === 0) {
        box.classList.add("is-over");
        box.innerHTML = `<span>입금 기한이 지났어요</span><strong>자동 취소</strong><em>이미 입금하셨다면 ${PHONE}로 바로 연락 주세요.</em>`;
        clearInterval(timer);
      }
    };
    const timer = setInterval(run, 1000);
    run();
  }

  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    const v = b.dataset.copy.replace(/[^0-9-]/g, "");
    try { await navigator.clipboard.writeText(v); toast("복사했어요"); } catch { toast(v); }
  });
})();
