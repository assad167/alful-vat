/* VAT return workspace: review one card at a time -> settle pending items -> copy boxes to the ZATCA portal. */
'use strict';

(() => {
  const A = App;
  let D = null;
  const S = () => A.state;
  const $ = id => document.getElementById(id);
  const esc = A.esc;
  const fmt = A.fmt;
  const ic = A.icon;

  const STEPS = [
    { id: 'sales', label: 'المبيعات' },
    { id: 'purch', label: 'المشتريات' },
    { id: 'pending', label: 'المعلّق' },
    { id: 'file', label: 'التقديم' }
  ];
  const TYPE_LABEL = { sales: 'مبيعات', purch: 'مشتريات' };
  const DONE = '__done';

  A.boot(data => { D = data; init(); });

  function init() {
    $('logo').innerHTML = A.logoSVG(28);
    $('memoIcon').innerHTML = ic('note');
    $('footInfo').textContent = D.meta.company + ' · الرقم الضريبي ' + D.meta.vat + ' · شغلك ينحفظ تلقائي في هذا المتصفح';
    A.onChange(render);
    window.addEventListener('hashchange', () => { routeFromHash(); render(); window.scrollTo({ top: 0 }); focusPrimary(); });
    document.addEventListener('keydown', onKey);
    $('importFile').onchange = importBackup;
    routeFromHash();
    render();
    focusPrimary();
  }

  // ---------------- routing ----------------
  function routeFromHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return;
    const ui = S().ui;
    if (STEPS.some(s => s.id === h)) { ui.step = h; return; }
    if (D.missing.some(m => m.id === h) || D.decisions.some(d => 'd-' + d.id === h)) {
      ui.step = 'pending'; ui.view = 'focus'; ui.cur.pending = h.startsWith('d-') ? h.slice(2) : h; return;
    }
    const doc = A.effDocs().find(d => 'doc-' + d.id === h);
    if (doc) { ui.step = doc.type; ui.view = 'focus'; ui.cur[doc.type] = doc.id; }
  }
  function goStep(id, cur) {
    const ui = S().ui;
    ui.step = id;
    if (cur !== undefined) { ui.cur[id] = cur; ui.view = 'focus'; }
    history.replaceState(null, '', '#' + id);
    A.save();
    render();
    window.scrollTo({ top: 0 });
    focusPrimary();
  }

  // ---------------- queues & progress ----------------
  const queue = type => A.effDocs().filter(d => d.type === type && !d.decision);
  const decisionRows = type => A.effDocs().filter(d => d.type === type && d.decision);
  function pendingItems() {
    const decs = D.decisions.slice().sort((a, b) => (b.blocking ? 1 : 0) - (a.blocking ? 1 : 0))
      .map(d => ({ kind: 'decision', id: d.id, d }));
    const miss = D.missing.map(m => ({ kind: 'missing', id: m.id, m }));
    return decs.concat(miss);
  }
  const resolved = it => it.kind === 'decision' ? S().decisions[it.id] != null : !!S().missing[it.id];
  function progress() {
    const sales = queue('sales'), purch = queue('purch'), pend = pendingItems();
    const docs = sales.concat(purch);
    const done = docs.filter(d => d.status).length + pend.filter(resolved).length;
    const total = docs.length + pend.length;
    return { sales, purch, pend, done, total };
  }
  function stepDone(id, P) {
    if (id === 'sales') return P.sales.length > 0 && P.sales.every(d => d.status);
    if (id === 'purch') return P.purch.length > 0 && P.purch.every(d => d.status);
    if (id === 'pending') return P.pend.every(resolved);
    if (id === 'file') return D.meta && fileProgress().done === fileProgress().total;
    return false;
  }
  function fileProgress() {
    const boxes = portalRows().filter(r => r.tick);
    const steps = CHECKLIST.length;
    const done = boxes.filter(r => S().portal[r.n]).length + CHECKLIST.filter((c, i) => S().checklist[i]).length;
    return { done, total: boxes.length + steps };
  }

  // ---------------- render ----------------
  function render() {
    if (!D) return;
    const P = progress();
    renderStrip(P);
    renderStepper(P);
    const ui = S().ui;
    const stage = $('stage');
    if (ui.step === 'sales' || ui.step === 'purch') stage.innerHTML = ui.view === 'list' ? docList(ui.step) : docFocus(ui.step, P[ui.step]);
    else if (ui.step === 'pending') stage.innerHTML = ui.view === 'list' ? pendingList(P.pend) : pendingFocus(P.pend);
    else stage.innerHTML = fileStep(P);
    stage.insertAdjacentHTML('beforeend', ui.step !== 'file' ? runningLine() : '');
    wire();
  }

  function daysWord(n) {
    if (n === 1) return 'يوم واحد';
    if (n === 2) return 'يومين';
    if (n >= 3 && n <= 10) return n + ' أيام';
    return n + ' يوم';
  }
  function renderStrip(P) {
    const dl = A.deadline();
    let chip;
    if (dl.past) chip = `<span class="chip bad">${ic('warn')} فات الموعد (${dl.label}) — قدّم بأسرع وقت</span>`;
    else if (dl.days === 0) chip = `<span class="chip bad">${ic('warn')} اليوم آخر يوم للتقديم</span>`;
    else chip = `<span class="chip ${dl.days <= 3 ? 'warn' : ''}">${ic('timer')} آخر موعد ${dl.label} · باقي ${daysWord(dl.days)}</span>`;
    const plan = S().plan
      ? `<button class="chip" type="button" id="planBtn" title="غيّر الموعد">خطتك: ${esc(S().plan)}</button>`
      : `<button class="chip" type="button" id="planBtn">+ متى بتخلّصه؟</button>`;
    const pct = P.total ? Math.round(P.done / P.total * 100) : 0;
    $('strip').innerHTML = chip + plan +
      `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${P.total}" aria-valuenow="${P.done}" aria-label="التقدّم">
        <div class="track"><div class="fill" style="width:${pct}%"></div></div>
        <span class="lbl">تم ${P.done} · باقي ${P.total - P.done}</span></div>`;
    $('planBtn').onclick = openPlan;
  }

  function renderStepper(P) {
    const cur = S().ui.step;
    const T = A.totals();
    const sub = {
      sales: left => P.sales.length + ' مستند' + (left ? ' · باقي ' + left : ' · تمت'),
      purch: left => P.purch.length + ' مستند' + (left ? ' · باقي ' + left : ' · تمت'),
      pending: left => P.pend.length + ' بند' + (left ? ' · باقي ' + left : ' · تمت'),
      file: () => T.box16 >= 0 ? 'مستحق ' + A.fmt0(T.box16) : 'لكم ' + A.fmt0(-T.box16)
    };
    const left = {
      sales: P.sales.filter(d => !d.status).length,
      purch: P.purch.filter(d => !d.status).length,
      pending: P.pend.filter(it => !resolved(it)).length,
      file: 0
    };
    $('stepper').innerHTML = STEPS.map((s, i) => {
      const done = s.id !== 'file' && stepDone(s.id, P);
      return `<button class="step${done ? ' done' : ''}" type="button" data-step="${s.id}" aria-current="${cur === s.id ? 'step' : 'false'}">
        <span class="n">${done ? ic('check') : i + 1}</span>
        <span class="t">${s.label}<span class="c">${sub[s.id](left[s.id])}</span></span></button>`;
    }).join('');
  }

  function runningLine() {
    const T = A.totals();
    return `<div class="running" aria-label="الأرقام الحالية">
      <span>ضريبة المبيعات <b class="num">${fmt(T.s15vat)}</b></span>
      <span>ضريبة المشتريات <b class="num">${fmt(T.p15vat)}</b></span>
      <span>الرصيد المرحّل <b class="num">${fmt(T.box15)}</b></span>
      <span>${T.box16 >= 0 ? 'المستحق المتوقع' : 'الرصيد لكم المتوقع'} <b class="num">${fmt(Math.abs(T.box16))}</b></span>
    </div>`;
  }

  // ---------------- step 1/2: one document at a time ----------------
  function pickCurrent(step, items) {
    const ui = S().ui;
    const cur = ui.cur[step];
    if (cur === DONE && items.every(d => d.status)) return DONE;
    if (items.some(d => d.id === cur)) return cur;
    const firstOpen = items.find(d => !d.status);
    return firstOpen ? firstOpen.id : (items.length ? DONE : null);
  }

  function docFocus(step, items) {
    const curId = pickCurrent(step, items);
    S().ui.cur[step] = curId;
    if (!items.length) return emptyStep(step);
    if (curId === DONE) return stepFinished(step, items);
    const idx = items.findIndex(d => d.id === curId);
    const d = items[idx];
    const pill = d.status === 'ok' ? '<span class="status-pill ok">تمت ✓</span>'
      : d.status === 'out' ? '<span class="status-pill out">مستبعدة من الإقرار</span>'
      : '<span class="status-pill wait">بانتظار مراجعتك</span>';
    const kindPill = d.kind === 'credit' ? '<span class="status-pill dec">إشعار دائن</span>'
      : d.kind === 'receipt' ? '<span class="status-pill wait">دفعة مستلمة — شامل الضريبة</span>'
      : d.added ? '<span class="status-pill wait">أضفتها أنت</span>' : '';
    const sub = [A.fmtDate(d.date, d.approx), esc(d.num), d.pvat ? 'الرقم الضريبي <span class="num">' + esc(d.pvat) + '</span>' : '']
      .filter(Boolean).join('<span class="sep">·</span>');
    const total = A.r2(d.base + d.vat);
    const rateLbl = Number(d.rate) === 0 ? 'الضريبة 0%' : 'الضريبة 15%';
    let actions;
    if (d.status === 'ok') {
      actions = `<button class="btn primary" type="button" data-act="next" data-primary>التالي ${ic('arrowL')}</button>
        <button class="btn" type="button" data-act="edit">${ic('edit')} تعديل <kbd>E</kbd></button>
        <button class="btn quiet danger" type="button" data-act="out">${ic('x')} استبعاد <kbd>X</kbd></button>
        <button class="btn quiet" type="button" data-act="reset">رجّعها «بانتظار»</button>`;
    } else if (d.status === 'out') {
      actions = `<button class="btn primary" type="button" data-act="ok" data-primary>${ic('check')} رجّعها للإقرار <kbd>↵</kbd></button>
        <button class="btn" type="button" data-act="edit">${ic('edit')} تعديل <kbd>E</kbd></button>`;
    } else {
      actions = `<button class="btn primary" type="button" data-act="ok" data-primary>${ic('check')} صحيحة <kbd>↵</kbd></button>
        <button class="btn" type="button" data-act="edit">${ic('edit')} تعديل <kbd>E</kbd></button>
        <button class="btn quiet danger" type="button" data-act="out">${ic('x')} استبعاد <kbd>X</kbd></button>`;
    }
    if (d.added) actions += `<button class="btn quiet danger" type="button" data-act="delete">حذف</button>`;
    const noteKind = d.noteKind === 'warn' ? 'warn' : '';
    return `
    <section class="card narrow" aria-labelledby="docTitle" data-doc="${esc(d.id)}">
      <div class="cardhead"><span>${TYPE_LABEL[step]} · ${idx + 1} من ${items.length}</span>${pill}${kindPill}
        <span class="spacer"></span>
        <button class="linkbtn" type="button" data-view="list">عرض كقائمة <kbd>L</kbd></button></div>
      <h2 class="doc-title" id="docTitle">${esc(d.party)}</h2>
      <p class="doc-sub">${sub}</p>
      <div class="amounts">
        <div class="amt"><div class="k">قبل الضريبة</div><div class="v">${fmt(d.base)}</div></div>
        <div class="amt"><div class="k">${rateLbl}</div><div class="v">${fmt(d.vat)}</div></div>
        <div class="amt main"><div class="k">الإجمالي</div><div class="v">${fmt(total)}</div></div>
      </div>
      ${d.desc ? `<p class="muted" style="font-size:.92rem">${esc(d.desc)}</p>` : ''}
      ${d.note ? `<div class="note ${noteKind}">${ic(noteKind ? 'warn' : 'info')}<span>${esc(d.note)}</span></div>` : ''}
      ${d.src ? `<p class="src">${ic('file')} المصدر: ${esc(d.src)}</p>` : ''}
      <div class="actions">${actions}</div>
      <div class="pager">
        <button class="btn quiet small" type="button" data-move="-1" ${idx === 0 ? 'disabled' : ''}>${ic('arrowR')} السابق</button>
        <span>${ic('plus')} <button class="linkbtn" type="button" data-act="new">فاتورة جديدة <kbd>N</kbd></button></span>
        <button class="btn quiet small" type="button" data-move="1" ${idx === items.length - 1 ? 'disabled' : ''}>التالي ${ic('arrowL')}</button>
      </div>
    </section>`;
  }

  function emptyStep(step) {
    return `<section class="card narrow done-card"><div class="big">ما فيه ${TYPE_LABEL[step]} هنا</div>
      <p class="muted">أضف فاتورة لو عندك.</p>
      <div class="actions" style="justify-content:center"><button class="btn primary" type="button" data-act="new" data-primary>${ic('plus')} فاتورة جديدة</button></div></section>`;
  }

  function stepFinished(step, items) {
    const T = A.totals();
    const inc = items.filter(A.included);
    const vat = step === 'sales' ? T.s15vat : T.p15vat;
    const next = step === 'sales' ? 'purch' : 'pending';
    const nextLbl = step === 'sales' ? 'المشتريات' : 'المعلّق';
    return `<section class="card narrow done-card">
      <div class="check">${ic('check')}</div>
      <div class="big">خلصت ${TYPE_LABEL[step]} 👌</div>
      <p class="muted">${inc.length} مستند داخل الإقرار · ضريبة ${TYPE_LABEL[step]} <span class="num">${fmt(vat)}</span></p>
      <div class="actions" style="justify-content:center">
        <button class="btn primary" type="button" data-goto="${next}" data-primary>التالي: ${nextLbl} ${ic('arrowL')}</button>
        <button class="btn" type="button" data-review="${step}">راجعها من الأول</button>
        <button class="btn quiet" type="button" data-act="new">${ic('plus')} فاتورة جديدة</button>
      </div></section>`;
  }

  function docList(step) {
    const items = queue(step);
    const decs = decisionRows(step);
    const T = A.totals();
    const row = (d, viaDecision) => {
      const st = viaDecision ? '<span class="status-pill dec">حسب قرار</span>'
        : d.status === 'ok' ? '<span class="status-pill ok">تمت</span>'
        : d.status === 'out' ? '<span class="status-pill out">مستبعدة</span>' : '<span class="status-pill wait">بانتظار</span>';
      const target = viaDecision ? `data-dec="${esc(d.decision)}"` : `data-open="${esc(d.id)}"`;
      return `<tr class="click${d.status === 'out' ? ' dim' : ''}" ${target} tabindex="0">
        <td>${st}</td><td>${A.fmtDate(d.date, d.approx)}</td><td>${esc(d.num)}</td><td>${esc(d.party)}</td>
        <td class="n">${A.numHTML(d.base)}</td><td class="n">${A.numHTML(d.vat)}</td><td class="n">${A.numHTML(d.base + d.vat)}</td></tr>`;
    };
    const base = step === 'sales' ? T.s15 + T.s15adj + T.s0 + T.s0adj : T.p15 + T.p15adj + T.p0 + T.p0adj;
    const vat = step === 'sales' ? T.s15vat : T.p15vat;
    return `<div class="cardhead"><span>${TYPE_LABEL[step]} · ${items.length + decs.length} مستند</span><span class="spacer"></span>
        <button class="btn small" type="button" data-act="new">${ic('plus')} فاتورة جديدة</button>
        <button class="linkbtn" type="button" data-view="focus">بطاقة بطاقة <kbd>L</kbd></button></div>
      <div class="tablewrap"><table class="grid">
        <thead><tr><th>الحالة</th><th>التاريخ</th><th>المستند</th><th>الاسم</th><th class="n">قبل الضريبة</th><th class="n">الضريبة</th><th class="n">الإجمالي</th></tr></thead>
        <tbody>${items.map(d => row(d, false)).join('')}${decs.map(d => row(d, true)).join('')}</tbody>
        <tfoot><tr><td colspan="4">داخل الإقرار (بدون المستبعد)</td><td class="n">${A.numHTML(base)}</td><td class="n">${A.numHTML(vat)}</td><td class="n">${A.numHTML(base + vat)}</td></tr></tfoot>
      </table></div>`;
  }

  // ---------------- step 3: pending (decisions + possibly missing invoices) ----------------
  function pickPending(items) {
    const ui = S().ui;
    if (ui.cur.pending === DONE && items.every(resolved)) return DONE;
    if (items.some(it => it.id === ui.cur.pending)) return ui.cur.pending;
    const open = items.find(it => !resolved(it));
    return open ? open.id : DONE;
  }
  function pendingFocus(items) {
    const curId = pickPending(items);
    S().ui.cur.pending = curId;
    if (curId === DONE) {
      return `<section class="card narrow done-card"><div class="check">${ic('check')}</div>
        <div class="big">خلص المعلّق 👌</div><p class="muted">كل القرارات والفواتير الناقصة انحسمت.</p>
        <div class="actions" style="justify-content:center">
          <button class="btn primary" type="button" data-goto="file" data-primary>التالي: التقديم ${ic('arrowL')}</button>
          <button class="btn" type="button" data-review="pending">راجعها من الأول</button></div></section>`;
    }
    const idx = items.findIndex(it => it.id === curId);
    const it = items[idx];
    const nDec = items.filter(x => x.kind === 'decision').length;
    const body = it.kind === 'decision' ? decisionCard(it.d, idx + 1, nDec) : missingCard(it.m, idx - nDec + 1, items.length - nDec);
    return `<section class="card narrow" data-pending="${esc(it.id)}">${body}
      <div class="pager">
        <button class="btn quiet small" type="button" data-pmove="-1" ${idx === 0 ? 'disabled' : ''}>${ic('arrowR')} السابق</button>
        <button class="linkbtn" type="button" data-view="list">عرض كقائمة <kbd>L</kbd></button>
        <button class="btn quiet small" type="button" data-pmove="1" ${idx === items.length - 1 ? 'disabled' : ''}>التالي ${ic('arrowL')}</button>
      </div></section>`;
  }

  function decisionCard(d, i, n) {
    const chosen = S().decisions[d.id];
    const eff = A.decisionValue(d.id);
    const tag = d.blocking ? '<span class="status-pill dec">يأثر على هذا الإقرار</span>' : '<span class="status-pill wait">تصحيح فترة سابقة — ما يوقف التقديم</span>';
    const opts = d.options.map((o, k) => `
      <button class="opt" type="button" role="radio" aria-checked="${chosen === o.id}" data-choose="${esc(o.id)}">
        <span class="dot"></span><span><span class="l">${esc(o.label)}</span>${o.sub ? `<span class="s">${esc(o.sub)}</span>` : ''}</span>
        ${o.rec ? '<span class="rec">الأنسب</span>' : ''}<kbd style="margin-inline-start:${o.rec ? '8px' : 'auto'}">${k + 1}</kbd>
      </button>`).join('');
    const defOpt = d.options.find(o => o.id === eff);
    const status = chosen != null ? '' : defOpt
      ? `<p class="muted" style="font-size:.85rem;margin-top:10px">لين ما تختار، الأرقام محسوبة على: «${esc(defOpt.label)}».</p>`
      : `<p class="muted" style="font-size:.85rem;margin-top:10px">لين ما تختار، ما يتغير شي في الأرقام.</p>`;
    return `
      <div class="cardhead"><span>قرار · ${i} من ${n}</span>${tag}</div>
      <h2 class="doc-title">${esc(d.title)}</h2>
      <p class="doc-sub" style="margin-top:10px">${esc(d.body)}</p>
      ${d.check ? `<div class="note">${ic('info')}<span>${esc(d.check)}</span></div>` : ''}
      <div class="opts" role="radiogroup" aria-label="${esc(d.title)}">${opts}</div>
      ${status}
      <div class="actions"><button class="btn ${chosen != null ? 'primary' : ''}" type="button" data-pmove="1" ${chosen != null ? 'data-primary' : ''}>التالي ${ic('arrowL')} <kbd>↵</kbd></button></div>`;
  }

  function missingCard(m, i, n) {
    const st = S().missing[m.id];
    const linkId = S().missingLink[m.id];
    const linked = linkId ? S().added.find(a => a.id === linkId) : null;
    const pill = st === 'added' ? '<span class="status-pill ok">انضافت ✓</span>' : st === 'none' ? '<span class="status-pill wait">ما فيه فاتورة</span>' : '<span class="status-pill dec">بانتظارك</span>';
    let amounts = '';
    if (m.gross != null && m.exact) {
      const base = A.r2(m.gross / 1.15);
      amounts = `<div class="amounts">
        <div class="amt"><div class="k">قبل الضريبة</div><div class="v">${fmt(base)}</div></div>
        <div class="amt"><div class="k">الضريبة 15%</div><div class="v">${fmt(m.gross - base)}</div></div>
        <div class="amt main"><div class="k">الإجمالي</div><div class="v">${fmt(m.gross)}</div></div></div>`;
    } else if (m.gross != null) {
      amounts = `<div class="amounts" style="grid-template-columns:1fr"><div class="amt main"><div class="k">المبلغ المدفوع (مو بالضرورة نفس الفاتورة)</div><div class="v">${fmt(m.gross)}</div></div></div>`;
    }
    let actions;
    if (st === 'added') {
      actions = `<div class="note good">${ic('check')}<span>انضافت للمشتريات${linked ? ': ' + esc(linked.num || '') + ' · ضريبة <span class="num">' + fmt(linked.vat) + '</span>' : ''}.</span></div>
        <div class="actions"><button class="btn primary" type="button" data-pmove="1" data-primary>التالي ${ic('arrowL')}</button>
        ${linked ? '<button class="btn" type="button" data-medit>' + ic('edit') + ' تعديل الفاتورة</button>' : ''}
        <button class="btn quiet danger" type="button" data-munset>شيلها</button></div>`;
    } else if (st === 'none') {
      actions = `<div class="actions"><button class="btn primary" type="button" data-pmove="1" data-primary>التالي ${ic('arrowL')}</button>
        <button class="btn" type="button" data-madd>${ic('plus')} لقيتها — أضفها</button>
        <button class="btn quiet" type="button" data-munset>تراجع</button></div>`;
    } else {
      actions = `<div class="actions">
        <button class="btn primary" type="button" data-madd data-primary>${ic('plus')} ${m.exact ? 'عندي الفاتورة — أضفها' : 'عندي فاتورة — أدخلها'}</button>
        <button class="btn" type="button" data-mnone>ما فيه فاتورة جديدة</button>
        <button class="btn quiet" type="button" data-pmove="1">بعدين ${ic('arrowL')}</button></div>`;
    }
    const sub = [A.fmtDate(m.date), esc(m.what)].join('<span class="sep">·</span>');
    return `
      <div class="cardhead"><span>فاتورة ممكن تكون ناقصة · ${i} من ${n}</span>${pill}</div>
      <h2 class="doc-title">${esc(m.party)}${m.num ? ' — <span class="num">' + esc(m.num) + '</span>' : ''}</h2>
      <p class="doc-sub">${sub}</p>
      ${amounts}
      ${m.hint ? `<div class="note">${ic('info')}<span>${esc(m.hint)}</span></div>` : ''}
      <p class="src">${ic('file')} ${esc(m.src)}</p>
      ${actions}`;
  }

  function pendingList(items) {
    const decs = items.filter(it => it.kind === 'decision');
    const miss = items.filter(it => it.kind === 'missing');
    const dRows = decs.map(({ d }) => {
      const v = S().decisions[d.id];
      const opt = d.options.find(o => o.id === (v != null ? v : d.default));
      const st = v != null ? '<span class="status-pill ok">اخترت</span>' : '<span class="status-pill dec">افتراضي</span>';
      return `<tr class="click" data-goto-pending="${esc(d.id)}" tabindex="0"><td>${st}</td><td>${esc(d.title)}</td><td>${opt ? esc(opt.label) : '—'}</td></tr>`;
    }).join('');
    const mRows = miss.map(({ m }) => {
      const st = S().missing[m.id];
      const pill = st === 'added' ? '<span class="status-pill ok">انضافت</span>' : st === 'none' ? '<span class="status-pill wait">ما فيه</span>' : '<span class="status-pill dec">بانتظار</span>';
      return `<tr class="click" data-goto-pending="${esc(m.id)}" tabindex="0"><td>${pill}</td><td>${esc(m.party)}${m.num ? ' — ' + esc(m.num) : ''}</td><td>${esc(m.what)}</td><td class="n">${m.gross != null ? A.numHTML(m.gross) : '—'}</td></tr>`;
    }).join('');
    return `<div class="cardhead"><span>المعلّق</span><span class="spacer"></span><button class="linkbtn" type="button" data-view="focus">بطاقة بطاقة <kbd>L</kbd></button></div>
      <h3 class="section-title" style="margin-top:0">قرارات <span class="c">${decs.length}</span></h3>
      <div class="tablewrap"><table class="grid"><thead><tr><th>الحالة</th><th>القرار</th><th>المحسوب حالياً</th></tr></thead><tbody>${dRows}</tbody></table></div>
      <h3 class="section-title">فواتير ممكن تكون ناقصة <span class="c">${miss.length}</span></h3>
      <div class="tablewrap"><table class="grid"><thead><tr><th>الحالة</th><th>الجهة</th><th>إيش هي</th><th class="n">المبلغ</th></tr></thead><tbody>${mRows}</tbody></table></div>`;
  }

  // ---------------- step 4: file it ----------------
  const CHECKLIST = [
    'ادخل بوابة هيئة الزكاة والضريبة والجمارك ← ضريبة القيمة المضافة ← تقديم إقرار الربع الثالث 2026.',
    'أول سؤالين في النموذج (نسبة 5٪، والتوريدات للجهات الحكومية): مثل الربع الثاني «لا» — إلا لو تغيّر شي.',
    'انقل المربعات مربع مربع، وعلّم ✓ جنب كل مربع هنا بعد ما تكتبه.',
    'تأكد إن المربع 15 (الرصيد المرحّل) في البوابة نفس الرقم هنا.',
    'قارن المربع 16 في البوابة بالرقم الكبير فوق قبل الاعتماد.',
    'اعتمد الإقرار، ونزّل نسخة PDF منه واحفظها في مجلد «قانوني ورسمي».',
    'إذا فيه مبلغ مستحق: سدّده برقم السداد قبل نهاية آخر يوم.'
  ];

  function portalRows() {
    const T = A.totals();
    const s6 = { a: T.s15 + T.s0, adj: T.s15adj + T.s0adj, v: T.s15vat };
    const p12 = { a: T.p15 + T.p0, adj: T.p15adj + T.p0adj, v: T.p15vat };
    const rows = [
      { n: 1, l: 'المبيعات الخاضعة للنسبة الأساسية (15%)', a: T.s15, adj: T.s15adj, v: T.s15vat, tick: true },
      { n: 2, l: 'المبيعات التي تتحمل الدولة ضريبتها', a: 0, adj: 0, zero: true },
      { n: 3, l: 'المبيعات المحلية الخاضعة للنسبة الصفرية', a: T.s0, adj: T.s0adj, zero: !T.s0 && !T.s0adj, tick: !!(T.s0 || T.s0adj) },
      { n: 4, l: 'الصادرات', a: 0, adj: 0, zero: true },
      { n: 5, l: 'المبيعات المعفاة من الضريبة', a: 0, adj: 0, zero: true },
      { n: 6, l: 'إجمالي المبيعات', small: 'البوابة تجمعه تلقائي — طابقه', a: s6.a, adj: s6.adj, v: s6.v, sum: true },
      { n: 7, l: 'المشتريات الخاضعة للنسبة الأساسية (15%)', small: T.p15adj ? 'التعديل = ' + creditNotes('purch') : '', a: T.p15, adj: T.p15adj, v: T.p15vat, tick: true },
      { n: 8, l: 'الاستيرادات المدفوعة ضريبتها عند الاستيراد', a: 0, adj: 0, v: 0, zero: true },
      { n: 9, l: 'التوريدات الخاضعة لآلية الاحتساب العكسي', a: 0, adj: 0, v: 0, zero: true },
      { n: 10, l: 'المشتريات الخاضعة للنسبة الصفرية', a: T.p0, adj: T.p0adj, zero: !T.p0 && !T.p0adj, tick: !!(T.p0 || T.p0adj) },
      { n: 11, l: 'المشتريات المعفاة من الضريبة', a: 0, adj: 0, zero: true },
      { n: 12, l: 'إجمالي المشتريات', small: 'البوابة تجمعه تلقائي — طابقه', a: p12.a, adj: p12.adj, v: p12.v, sum: true },
      { n: 13, l: 'إجمالي الضريبة المستحقة للفترة الحالية', small: 'تلقائي', v: T.box13, sum: true },
      { n: 14, l: 'تصحيحات من الفترات السابقة (حدها 15,000 ريال زيادة أو نقص)', small: box14Note(), v: T.box14, tick: !!T.box14, zero: !T.box14 },
      { n: 15, l: 'الضريبة المرحّلة من الفترات السابقة', small: 'رصيدكم من الربع الثاني — غالباً معبّى تلقائي', v: T.box15, tick: true },
      { n: 16, l: 'صافي الضريبة المستحق (أو المستعاد)', small: 'تلقائي — لازم يطابق الرقم الكبير فوق', v: T.box16, sum: true, tick: true }
    ];
    return rows;
  }
  function creditNotes(type) {
    return A.effDocs().filter(d => d.type === type && d.kind === 'credit' && A.included(d)).map(d => 'إشعار دائن ' + d.num).join('، ');
  }
  function box14Note() {
    const parts = [];
    (D.adjustments || []).forEach(a => parts.push((a.short ? a.short + ' ' : '') + fmt(a.box14)));
    D.decisions.forEach(d => {
      const opt = d.options.find(o => o.id === A.decisionValue(d.id));
      if (opt && opt.box14) parts.push((d.short ? d.short + ' ' : '') + fmt(opt.box14));
    });
    if (Number(S().box14extra)) parts.push('يدوي ' + fmt(S().box14extra));
    return parts.length ? parts.join(' · ') : 'ما فيه تصحيحات (حسب قراراتك)';
  }

  function cell(v, cap) {
    if (v == null) return '<span class="bv"></span>';
    const raw = A.r2(v).toFixed(2);
    return `<span class="bv"><span class="cap">${cap}</span><button class="copy" type="button" data-copy="${raw}" title="انسخ ${raw}">${fmt(v)}</button></span>`;
  }

  function fileStep(P) {
    const T = A.totals();
    const warns = [];
    const blockingOpen = D.decisions.filter(d => d.blocking && S().decisions[d.id] == null);
    if (blockingOpen.length) warns.push(`باقي ${blockingOpen.length} قرار ما اخترت فيه — الأرقام محسوبة على الخيار الافتراضي. <a href="#pending">روح للمعلّق</a>`);
    const unrev = P.sales.concat(P.purch).filter(d => !d.status).length;
    if (unrev) warns.push(`${unrev} مستند ما راجعته بعد (محسوب ضمن الأرقام).`);
    const missOpen = D.missing.filter(m => !S().missing[m.id]).length;
    if (missOpen) warns.push(`${missOpen} فاتورة ممكن تكون ناقصة ما حسمتها — كل فاتورة مشتريات تلقاها تنزّل المستحق.`);
    const due = T.box16 >= 0;
    const rows = portalRows();
    const shown = rows.filter(r => !r.zero || r.n === 14 && T.box14);
    const zeros = rows.filter(r => r.zero && !(r.n === 14 && T.box14)).map(r => r.n);
    const boxHTML = shown.map(r => `
      <div class="box${r.sum ? ' sum' : ''}${S().portal[r.n] ? ' entered' : ''}">
        <span class="bn">${r.n}</span>
        <span class="bl">${esc(r.l)}${r.small ? `<small>${esc(r.small)}</small>` : ''}</span>
        ${cell(r.a, 'المبلغ')}${cell(r.adj, 'التعديل')}${cell(r.v, 'الضريبة')}
        ${r.tick || r.sum ? `<input class="tick" type="checkbox" data-portal="${r.n}" ${S().portal[r.n] ? 'checked' : ''} aria-label="دخلت المربع ${r.n} في البوابة">` : '<span></span>'}
      </div>`).join('');
    const fp = fileProgress();
    return `
      ${warns.length ? `<div class="note warn narrow" style="margin-bottom:14px">${ic('warn')}<span>${warns.join('<br>')}</span></div>` : ''}
      <section class="card hero">
        <div class="k">${due ? 'صافي الضريبة المستحقة للهيئة' : 'رصيد لكم (مستعاد أو يترحّل)'}</div>
        <div class="v">${fmt(Math.abs(T.box16))}<small>ريال</small></div>
        <div class="s">ضريبة المبيعات <span class="num">${fmt(T.s15vat)}</span> − المشتريات <span class="num">${fmt(T.p15vat)}</span>
          ${T.box14 ? ' + تصحيحات <span class="num">' + fmt(T.box14) + '</span>' : ''} − المرحّل <span class="num">${fmt(T.box15)}</span></div>
      </section>

      <h3 class="section-title">انقلها للبوابة <span class="c">اضغط على الرقم ينسخ · علّم ✓ بعد ما تكتبه (${fp.done} من ${fp.total})</span></h3>
      <div class="box-head"><span>#</span><span>المربع</span><span>المبلغ</span><span>التعديل</span><span>الضريبة</span><span></span></div>
      <div class="boxes">${boxHTML}</div>
      ${zeros.length ? `<p class="muted" style="font-size:.88rem;margin-top:10px">المربعات ${zeros.join('، ')}: كلها صفر — اتركها 0.00.</p>` : ''}

      <h3 class="section-title">خطوات التقديم</h3>
      <ul class="checklist card" style="padding:10px">${CHECKLIST.map((c, i) => `<li><label><input type="checkbox" data-check="${i}" ${S().checklist[i] ? 'checked' : ''}><span>${esc(c)}</span></label></li>`).join('')}</ul>

      <h3 class="section-title">احفظ نسخة</h3>
      <div class="actions" style="margin-top:0">
        <button class="btn" type="button" data-act="print">${ic('print')} اطبع ملخص الإقرار</button>
        <button class="btn" type="button" data-act="csv">${ic('download')} Excel (CSV)</button>
        <button class="btn quiet" type="button" data-act="backup">${ic('download')} نسخة احتياطية</button>
        <button class="btn quiet" type="button" data-act="import">استرجاع نسخة</button>
      </div>

      <details class="fold"><summary>ملاحظات للمحاسب (بعد التقديم)</summary><div class="body">
        ${D.alerts.map(a => `<p style="margin-bottom:8px"><b>${esc(a.title)}:</b> ${esc(a.body)}</p>`).join('')}
      </div></details>
      <details class="fold"><summary>إعدادات متقدمة</summary><div class="body">
        <div class="form">
          <div class="field"><label for="carryIn">المربع 15 — الرصيد المرحّل</label><input id="carryIn" class="ltr" type="number" step="0.01" value="${A.carry()}"><div class="hint">${esc(D.meta.carryNote)}</div></div>
          <div class="field"><label for="b14In">المربع 14 — تصحيح يدوي إضافي</label><input id="b14In" class="ltr" type="number" step="0.01" value="${Number(S().box14extra) || 0}"><div class="hint">فوق تصحيحات القرارات. موجب يزيد المستحق، سالب ينقصه.</div></div>
        </div>
        <div class="actions"><button class="btn quiet danger small" type="button" data-act="reset">امسح كل شغلي على هذا الجهاز</button></div>
      </div></details>`;
  }

  // ---------------- events ----------------
  function wire() {
    const stage = $('stage');
    document.querySelectorAll('[data-step]').forEach(b => b.onclick = () => goStep(b.dataset.step));
    stage.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { S().ui.view = b.dataset.view; A.save(); render(); focusPrimary(); });
    stage.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => goStep(b.dataset.goto));
    stage.querySelectorAll('[data-review]').forEach(b => b.onclick = () => {
      const st = b.dataset.review;
      const first = st === 'pending' ? pendingItems()[0] : queue(st)[0];
      goStep(st, first ? first.id : null);
    });
    stage.querySelectorAll('[data-move]').forEach(b => b.onclick = () => move(+b.dataset.move));
    stage.querySelectorAll('[data-pmove]').forEach(b => b.onclick = () => pmove(+b.dataset.pmove));
    stage.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act));
    stage.querySelectorAll('[data-open]').forEach(tr => {
      const go = () => { S().ui.view = 'focus'; goStep(S().ui.step, tr.dataset.open); };
      tr.onclick = go; tr.onkeydown = e => { if (e.key === 'Enter') go(); };
    });
    stage.querySelectorAll('[data-dec]').forEach(tr => {
      const go = () => goStep('pending', tr.dataset.dec);
      tr.onclick = go; tr.onkeydown = e => { if (e.key === 'Enter') go(); };
    });
    stage.querySelectorAll('[data-goto-pending]').forEach(tr => {
      const go = () => { S().ui.view = 'focus'; goStep('pending', tr.dataset.gotoPending); };
      tr.onclick = go; tr.onkeydown = e => { if (e.key === 'Enter') go(); };
    });
    stage.querySelectorAll('[data-choose]').forEach(b => b.onclick = () => choose(b.dataset.choose));
    stage.querySelectorAll('[data-madd]').forEach(b => b.onclick = missingAdd);
    stage.querySelectorAll('[data-mnone]').forEach(b => b.onclick = () => missingSet('none'));
    stage.querySelectorAll('[data-munset]').forEach(b => b.onclick = missingUnset);
    stage.querySelectorAll('[data-medit]').forEach(b => b.onclick = () => {
      const it = currentPending();
      const a = S().added.find(x => x.id === S().missingLink[it.id]);
      if (a) openDocForm({ doc: a });
    });
    stage.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
      if (await A.copyText(b.dataset.copy)) {
        b.classList.add('copied'); A.toast('انتسخ ' + b.dataset.copy);
        setTimeout(() => b.classList.remove('copied'), 1500);
      }
    });
    stage.querySelectorAll('[data-portal]').forEach(c => c.onchange = () => { S().portal[c.dataset.portal] = c.checked; A.changed(); });
    stage.querySelectorAll('[data-check]').forEach(c => c.onchange = () => { S().checklist[c.dataset.check] = c.checked; A.changed(); });
    const carryIn = $('carryIn');
    if (carryIn) carryIn.onchange = () => { const v = parseFloat(carryIn.value); S().carry = isNaN(v) ? null : v; A.changed(); };
    const b14 = $('b14In');
    if (b14) b14.onchange = () => { S().box14extra = parseFloat(b14.value) || 0; A.changed(); };
  }

  function focusPrimary() {
    requestAnimationFrame(() => {
      const p = document.querySelector('#stage [data-primary]');
      if (p) p.focus({ preventScroll: true });
    });
  }

  // current item helpers
  function currentDoc() {
    const step = S().ui.step;
    if (step !== 'sales' && step !== 'purch') return null;
    return queue(step).find(d => d.id === S().ui.cur[step]) || null;
  }
  function currentPending() {
    return pendingItems().find(it => it.id === S().ui.cur.pending) || null;
  }

  function move(delta) {
    const step = S().ui.step;
    const items = queue(step);
    let idx = items.findIndex(d => d.id === S().ui.cur[step]);
    if (idx < 0) idx = 0;
    const next = Math.min(items.length - 1, Math.max(0, idx + delta));
    if (items[next]) { S().ui.cur[step] = items[next].id; A.save(); render(); focusPrimary(); }
  }
  function pmove(delta) {
    const items = pendingItems();
    let idx = items.findIndex(it => it.id === S().ui.cur.pending);
    if (idx < 0) idx = 0;
    let next = idx + delta;
    if (next >= items.length) {
      // after the last card, jump to the first one still open, or finish
      const open = items.find(it => !resolved(it));
      S().ui.cur.pending = open ? open.id : DONE;
    } else S().ui.cur.pending = items[Math.max(0, next)].id;
    A.save(); render(); focusPrimary();
  }
  // after settling an item, go to the next open one (wrapping), or the finished state
  function advance(step) {
    const items = queue(step);
    const idx = items.findIndex(d => d.id === S().ui.cur[step]);
    const after = items.slice(idx + 1).concat(items.slice(0, idx + 1));
    const open = after.find(d => !d.status);
    S().ui.cur[step] = open ? open.id : DONE;
  }

  function setStatus(d, status) {
    const step = S().ui.step;
    const prevEntry = S().docs[d.id] ? Object.assign({}, S().docs[d.id]) : null;
    const prevCur = S().ui.cur[step];
    S().docs[d.id] = Object.assign({}, S().docs[d.id], { status });
    if (status === 'ok') advance(step);
    A.changed();
    focusPrimary();
    const msg = status === 'ok' ? '✓ ' + (d.num || d.party) : status === 'out' ? 'استبعدت ' + (d.num || d.party) : 'رجعت «بانتظار»';
    A.toast(msg, () => {
      if (prevEntry) S().docs[d.id] = prevEntry; else delete S().docs[d.id];
      S().ui.cur[step] = prevCur; A.changed(); focusPrimary();
    });
  }

  function act(a) {
    const d = currentDoc();
    if (a === 'ok' && d) setStatus(d, 'ok');
    else if (a === 'out' && d) setStatus(d, 'out');
    else if (a === 'reset' && d) setStatus(d, null);
    else if (a === 'next') { advance(S().ui.step); A.save(); render(); focusPrimary(); }
    else if (a === 'edit' && d) openDocForm({ doc: d });
    else if (a === 'delete' && d) deleteAdded(d.id);
    else if (a === 'new') openDocForm({ type: S().ui.step === 'sales' ? 'sales' : 'purch' });
    else if (a === 'print') printSummary();
    else if (a === 'csv') exportCSV();
    else if (a === 'backup') exportBackup();
    else if (a === 'import') $('importFile').click();
    else if (a === 'reset') resetAll();
  }

  function choose(optId) {
    const it = currentPending();
    if (!it || it.kind !== 'decision') return;
    const prev = S().decisions[it.id];
    S().decisions[it.id] = optId;
    A.changed();
    focusPrimary();
    const opt = it.d.options.find(o => o.id === optId);
    A.toast('اخترت: ' + opt.label, () => {
      if (prev == null) delete S().decisions[it.id]; else S().decisions[it.id] = prev;
      A.changed();
    });
  }

  function missingSet(val) {
    const it = currentPending();
    if (!it || it.kind !== 'missing') return;
    const prev = S().missing[it.id];
    S().missing[it.id] = val;
    A.changed();
    focusPrimary();
    A.toast(val === 'none' ? 'تمام — ما فيه فاتورة' : 'تم', () => {
      if (prev == null) delete S().missing[it.id]; else S().missing[it.id] = prev;
      A.changed();
    });
  }
  function missingAdd() {
    const it = currentPending();
    if (!it || it.kind !== 'missing') return;
    const m = it.m;
    if (m.exact && m.gross != null) {
      const base = A.r2(m.gross / 1.15);
      const doc = {
        id: 'a-' + m.id, type: 'purch', kind: 'invoice', date: m.date, num: m.num, party: m.party, pvat: m.pvat || '',
        base, vat: A.r2(m.gross - base), rate: 15, note: 'مطالبة متأخرة (فاتورة ' + A.fmtDate(m.date) + ') — المادة 49/8', src: m.src, from: m.id
      };
      S().added = S().added.filter(a => a.id !== doc.id).concat(doc);
      S().missing[m.id] = 'added';
      S().missingLink[m.id] = doc.id;
      A.changed();
      focusPrimary();
      A.toast('انضافت ' + m.num + ' · ضريبة ' + fmt(doc.vat), () => {
        S().added = S().added.filter(a => a.id !== doc.id);
        delete S().missing[m.id]; delete S().missingLink[m.id]; A.changed();
      });
    } else {
      openDocForm({ type: 'purch', fromMissing: m.id, prefill: { party: m.party, pvat: m.pvat, date: m.date, amount: m.gross, incl: true, note: m.what } });
    }
  }
  function missingUnset() {
    const it = currentPending();
    if (!it) return;
    const linkId = S().missingLink[it.id];
    const removed = linkId ? S().added.find(a => a.id === linkId) : null;
    const prev = S().missing[it.id];
    if (linkId) S().added = S().added.filter(a => a.id !== linkId);
    delete S().missing[it.id]; delete S().missingLink[it.id];
    A.changed();
    A.toast('رجعت «بانتظارك»', () => {
      if (removed) S().added.push(removed);
      S().missing[it.id] = prev; if (linkId) S().missingLink[it.id] = linkId;
      A.changed();
    });
  }
  function deleteAdded(id) {
    const a = S().added.find(x => x.id === id);
    if (!a) return;
    S().added = S().added.filter(x => x.id !== id);
    const mid = Object.keys(S().missingLink).find(k => S().missingLink[k] === id);
    if (mid) { delete S().missing[mid]; delete S().missingLink[mid]; }
    delete S().docs[id];
    advance(S().ui.step);
    A.changed();
    A.toast('انحذفت ' + (a.num || a.party), () => {
      S().added.push(a);
      if (mid) { S().missing[mid] = 'added'; S().missingLink[mid] = id; }
      S().ui.cur[a.type] = id; A.changed();
    });
  }

  // ---------------- keyboard ----------------
  function onKey(e) {
    if (A.isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = e.target.closest && e.target.closest('button, a, summary, [data-open], [data-dec], [data-goto-pending]');
    if ((e.key === 'Enter' || e.key === ' ') && onButton) return; // let the focused control handle it
    const ui = S().ui;
    if (e.code === 'KeyN' && ui.step !== 'file') { e.preventDefault(); act('new'); return; }
    if (e.code === 'KeyL' && ui.step !== 'file') { e.preventDefault(); ui.view = ui.view === 'list' ? 'focus' : 'list'; A.save(); render(); focusPrimary(); return; }
    if (ui.view === 'list') return;
    if (ui.step === 'sales' || ui.step === 'purch') {
      const d = currentDoc();
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); move(-1); return; }
      if (!d) return;
      if (e.key === 'Enter') { e.preventDefault(); d.status === 'ok' ? act('next') : setStatus(d, 'ok'); }
      else if (e.code === 'KeyE') { e.preventDefault(); openDocForm({ doc: d }); }
      else if (e.code === 'KeyX') { e.preventDefault(); setStatus(d, d.status === 'out' ? null : 'out'); }
    } else if (ui.step === 'pending') {
      const it = currentPending();
      if (e.key === 'ArrowLeft') { e.preventDefault(); pmove(1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); pmove(-1); return; }
      if (!it) return;
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m && it.kind === 'decision') {
        const opt = it.d.options[+m[1] - 1];
        if (opt) { e.preventDefault(); choose(opt.id); }
      } else if (e.key === 'Enter') { e.preventDefault(); pmove(1); }
    }
  }

  // ---------------- add / edit invoice dialog ----------------
  function partyOptions() {
    const set = new Set();
    D.docs.forEach(d => set.add(d.party));
    D.missing.forEach(m => set.add(m.party));
    S().added.forEach(a => set.add(a.party));
    return [...set].filter(Boolean).map(p => `<option value="${esc(p)}">`).join('');
  }

  function openDocForm(opts) {
    const dlg = $('docDlg');
    const d = opts.doc || null;
    const pre = opts.prefill || {};
    const f = {
      type: d ? d.type : (opts.type || 'purch'),
      kind: d ? (d.kind === 'credit' ? 'credit' : 'invoice') : 'invoice',
      rate: d ? Number(d.rate) : 15,
      incl: d ? false : !!pre.incl,
      vatTouched: false
    };
    const amount = d ? Math.abs(d.base) : (pre.amount != null ? pre.amount : '');
    dlg.innerHTML = `
      <form class="dlg" id="docForm" novalidate>
        <h2 id="docDlgTitle">${d ? 'تعديل مستند' : 'فاتورة جديدة'}</h2>
        <div class="form">
          <div class="field full"><div class="seg" role="group" aria-label="النوع">
            <button type="button" data-ftype="sales">مبيعات (صادرة)</button><button type="button" data-ftype="purch">مشتريات (واردة)</button></div></div>
          <div class="field full"><div class="seg" role="group" aria-label="نوع المستند">
            <button type="button" data-fkind="invoice">فاتورة</button><button type="button" data-fkind="credit">إشعار دائن (مرتجع)</button></div></div>
          <div class="field"><label for="fDate">التاريخ</label><input id="fDate" type="date" required value="${esc(d ? (d.date.length === 10 ? d.date : '') : (pre.date || ''))}"><div class="err" id="eDate"></div></div>
          <div class="field"><label for="fNum">رقم الفاتورة</label><input id="fNum" class="ltr" value="${esc(d ? d.num : (pre.num || ''))}"></div>
          <div class="field full"><label for="fParty">الاسم</label><input id="fParty" list="partyList" required value="${esc(d ? d.party : (pre.party || ''))}"><div class="err" id="eParty"></div></div>
          <div class="field"><label for="fPvat">الرقم الضريبي (اختياري)</label><input id="fPvat" class="ltr" inputmode="numeric" maxlength="15" value="${esc(d ? (d.pvat || '') : (pre.pvat || ''))}"></div>
          <div class="field"><label>النسبة</label><div class="seg" role="group" aria-label="النسبة"><button type="button" data-frate="15">15%</button><button type="button" data-frate="0">0%</button></div></div>
          <div class="field"><label for="fAmt">المبلغ</label><input id="fAmt" type="number" step="0.01" min="0" inputmode="decimal" required value="${amount === '' ? '' : A.r2(amount)}"><div class="err" id="eAmt"></div></div>
          <div class="field"><label>المبلغ اللي كتبته</label><div class="seg" role="group" aria-label="المبلغ"><button type="button" data-fincl="0">قبل الضريبة</button><button type="button" data-fincl="1">شامل الضريبة</button></div></div>
          <div class="field full"><label for="fVat">الضريبة</label><input id="fVat" type="number" step="0.01" inputmode="decimal" value="${d ? Math.abs(d.vat) : ''}"><div class="hint">تنحسب تلقائي — عدّلها بس لو الفاتورة مكتوب فيها رقم مختلف.</div></div>
          <div class="field full"><label for="fNote">ملاحظة (اختياري)</label><input id="fNote" value="${esc(d ? (d.note || '') : (pre.note || ''))}"></div>
        </div>
        <div class="preview"><div><div class="k">قبل الضريبة</div><div class="v" id="pvBase">0.00</div></div><div><div class="k">الضريبة</div><div class="v" id="pvVat">0.00</div></div><div><div class="k">الإجمالي</div><div class="v" id="pvTot">0.00</div></div></div>
        <div id="fWarn"></div>
        <div class="dlg-actions"><button class="btn primary" type="submit">حفظ <kbd>↵</kbd></button><button class="btn quiet" type="button" data-cancel>إلغاء <kbd>Esc</kbd></button></div>
        <datalist id="partyList">${partyOptions()}</datalist>
      </form>`;
    const q = s => dlg.querySelector(s);
    if (d) {
      const auto = A.r2(Math.abs(d.base) * f.rate / 100);
      f.vatTouched = Math.abs(auto - Math.abs(d.vat)) > 0.005;
    }
    const paintSeg = () => {
      dlg.querySelectorAll('[data-ftype]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ftype === f.type)));
      dlg.querySelectorAll('[data-fkind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fkind === f.kind)));
      dlg.querySelectorAll('[data-frate]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.frate === f.rate)));
      dlg.querySelectorAll('[data-fincl]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.fincl === '1') === f.incl)));
    };
    const calc = () => {
      const amt = Math.abs(parseFloat(q('#fAmt').value) || 0);
      const r = f.rate / 100;
      let base = f.incl ? A.r2(amt / (1 + r)) : A.r2(amt);
      let vat = f.incl ? A.r2(amt - base) : A.r2(base * r);
      if (f.vatTouched) vat = A.r2(Math.abs(parseFloat(q('#fVat').value) || 0));
      else q('#fVat').value = amt ? vat.toFixed(2) : '';
      const sign = f.kind === 'credit' ? -1 : 1;
      q('#pvBase').textContent = fmt(sign * base); q('#pvVat').textContent = fmt(sign * vat); q('#pvTot').textContent = fmt(sign * (base + vat));
      warnings(base, vat);
      return { base: sign * base, vat: sign * vat };
    };
    const warnings = (base, vat) => {
      const w = [];
      const date = q('#fDate').value;
      if (date) {
        if (date < D.meta.from) w.push(f.type === 'sales' ? 'تاريخ المبيعات قبل الربع الثالث — المبيعات تنحسب في فترتها.' : 'فاتورة من فترة سابقة — يجوز تخصمها الحين (المادة 49/8) إذا ما انخصمت قبل.');
        if (date > D.meta.to) w.push('التاريخ بعد 30 سبتمبر — مكانها إقرار الربع الرابع.');
      }
      const pv = q('#fPvat').value.trim();
      if (pv && !/^3\d{13}3$/.test(pv)) w.push('الرقم الضريبي عادة 15 رقم يبدأ وينتهي بـ3.');
      const num = q('#fNum').value.trim();
      if (!num) w.push('يفضّل تكتب رقم الفاتورة.');
      else if (A.effDocs().some(x => x.type === f.type && x.id !== (d && d.id) && String(x.num).toLowerCase() === num.toLowerCase())) w.push('فيه مستند ثاني بنفس الرقم — تأكد إنها مو مكررة.');
      if (f.vatTouched && f.rate && Math.abs(vat - base * f.rate / 100) > 1) w.push('الضريبة مو ' + f.rate + '% من المبلغ — تأكد من الفاتورة.');
      q('#fWarn').innerHTML = w.length ? `<div class="warnline">${w.map(esc).join('<br>')}</div>` : '';
    };
    dlg.querySelectorAll('[data-ftype]').forEach(b => b.onclick = () => { f.type = b.dataset.ftype; paintSeg(); calc(); });
    dlg.querySelectorAll('[data-fkind]').forEach(b => b.onclick = () => { f.kind = b.dataset.fkind; paintSeg(); calc(); });
    dlg.querySelectorAll('[data-frate]').forEach(b => b.onclick = () => { f.rate = +b.dataset.frate; f.vatTouched = false; paintSeg(); calc(); });
    dlg.querySelectorAll('[data-fincl]').forEach(b => b.onclick = () => { f.incl = b.dataset.fincl === '1'; f.vatTouched = false; paintSeg(); calc(); });
    q('#fAmt').oninput = calc;
    q('#fVat').oninput = () => { f.vatTouched = true; calc(); };
    ['#fDate', '#fNum', '#fPvat'].forEach(s => q(s).oninput = calc);
    q('[data-cancel]').onclick = () => dlg.close();
    q('#docForm').onsubmit = e => {
      e.preventDefault();
      const date = q('#fDate').value, party = q('#fParty').value.trim(), amt = parseFloat(q('#fAmt').value);
      q('#eDate').textContent = date ? '' : 'اكتب التاريخ';
      q('#eParty').textContent = party ? '' : 'اكتب الاسم';
      q('#eAmt').textContent = amt > 0 ? '' : 'اكتب المبلغ';
      if (!date || !party || !(amt > 0)) { (q('#eDate').textContent ? q('#fDate') : q('#eParty').textContent ? q('#fParty') : q('#fAmt')).focus(); return; }
      const { base, vat } = calc();
      const fields = {
        type: f.type, kind: f.kind, date, num: q('#fNum').value.trim(), party, pvat: q('#fPvat').value.trim(),
        base, vat, rate: f.rate, note: q('#fNote').value.trim()
      };
      saveDoc(d, fields, opts.fromMissing);
      dlg.close();
    };
    paintSeg(); calc();
    dlg.showModal();
    (d ? q('#fAmt') : (q('#fDate').value ? q('#fNum') : q('#fDate'))).focus();
  }

  function saveDoc(d, fields, fromMissing) {
    if (d && !d.added) {
      // edits on a document from the files are kept as an overlay, the original stays intact
      const prev = S().docs[d.id] ? JSON.parse(JSON.stringify(S().docs[d.id])) : null;
      S().docs[d.id] = Object.assign({}, S().docs[d.id], { edits: Object.assign({}, fields, { gross: undefined }), status: 'ok' });
      if (fields.type !== d.type) S().ui.cur[fields.type] = d.id; else advance(S().ui.step);
      A.changed(); focusPrimary();
      A.toast('انحفظ التعديل ✓', () => { if (prev) S().docs[d.id] = prev; else delete S().docs[d.id]; S().ui.cur[d.type] = d.id; A.changed(); });
      return;
    }
    if (d && d.added) {
      const i = S().added.findIndex(a => a.id === d.id);
      const prev = Object.assign({}, S().added[i]);
      S().added[i] = Object.assign({}, S().added[i], fields);
      A.changed(); focusPrimary();
      A.toast('انحفظ التعديل ✓', () => { S().added[i] = prev; A.changed(); });
      return;
    }
    const doc = Object.assign({ id: 'a-' + Date.now().toString(36) }, fields, fromMissing ? { from: fromMissing } : {});
    S().added.push(doc);
    if (fromMissing) { S().missing[fromMissing] = 'added'; S().missingLink[fromMissing] = doc.id; }
    else { S().ui.step = doc.type; S().ui.cur[doc.type] = doc.id; S().ui.view = 'focus'; }
    A.changed(); focusPrimary();
    A.toast('انضافت ' + (doc.num || doc.party) + ' · ضريبة ' + fmt(doc.vat), () => {
      S().added = S().added.filter(a => a.id !== doc.id);
      if (fromMissing) { delete S().missing[fromMissing]; delete S().missingLink[fromMissing]; }
      A.changed();
    });
  }

  // ---------------- plan ("when will you file?" — an implementation intention) ----------------
  function openPlan() {
    const dlg = $('docDlg');
    const sug = ['الليلة بعد العشاء', 'بكرة الصبح أول شي', 'بكرة بعد العصر', 'الجمعة الصبح'];
    dlg.innerHTML = `<form class="dlg" id="planForm">
      <h2 id="docDlgTitle">متى بتخلّص الإقرار؟</h2>
      <p class="muted" style="font-size:.9rem;margin-bottom:12px">لما تحدد وقت ومكان محدد، احتمال إنك تسويها فعلاً يرتفع كثير (Gollwitzer، 1999).</p>
      <div class="actions" style="margin:0 0 12px">${sug.map(s => `<button type="button" class="btn small" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div class="field"><label for="planIn">أو اكتب وقتك</label><input id="planIn" value="${esc(S().plan || '')}" placeholder="مثال: الخميس 8 مساءً في المكتب"></div>
      <div class="dlg-actions"><button class="btn primary" type="submit">حفظ</button><button class="btn quiet" type="button" data-cancel>إلغاء</button></div></form>`;
    dlg.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => { dlg.querySelector('#planIn').value = b.dataset.sug; });
    dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
    dlg.querySelector('#planForm').onsubmit = e => { e.preventDefault(); S().plan = dlg.querySelector('#planIn').value.trim(); A.changed(); dlg.close(); };
    dlg.showModal();
    dlg.querySelector('#planIn').focus();
  }

  // ---------------- print / export ----------------
  function printSummary() {
    const T = A.totals();
    const docs = A.effDocs().filter(A.included);
    const sales = docs.filter(d => d.type === 'sales'), purch = docs.filter(d => d.type === 'purch');
    const table = list => {
      if (!list.length) return '<p>لا يوجد.</p>';
      let b = 0, v = 0;
      const rows = list.map((d, i) => { b += A.hal(d.base); v += A.hal(d.vat); return `<tr><td>${i + 1}</td><td>${esc(d.date)}</td><td>${esc(d.num)}</td><td>${esc(d.party)}</td><td>${esc(d.pvat || '—')}</td><td>${fmt(d.base)}</td><td>${fmt(d.vat)}</td><td>${fmt(d.base + d.vat)}</td></tr>`; }).join('');
      return `<table><thead><tr><th>#</th><th>التاريخ</th><th>المستند</th><th>الاسم</th><th>الرقم الضريبي</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
        <tbody>${rows}<tr class="tot"><td colspan="5">الإجمالي (${list.length})</td><td>${fmt(b / 100)}</td><td>${fmt(v / 100)}</td><td>${fmt((b + v) / 100)}</td></tr></tbody></table>`;
    };
    const boxes = portalRows().map(r => `<tr><td>${r.n}</td><td>${esc(r.l)}</td><td>${r.a != null ? fmt(r.a) : ''}</td><td>${r.adj != null ? fmt(r.adj) : ''}</td><td>${r.v != null ? fmt(r.v) : ''}</td></tr>`).join('');
    const decs = D.decisions.map(d => { const o = d.options.find(x => x.id === A.decisionValue(d.id)); return `<tr><td>${esc(d.title)}</td><td>${o ? esc(o.label) : 'لم يُحسم'}</td></tr>`; }).join('');
    $('print').innerHTML = `
      <h1>ملخص إقرار ضريبة القيمة المضافة — الربع الثالث 2026</h1>
      <div class="ps">من ${D.meta.from} إلى ${D.meta.to}</div>
      <div class="ph2"><span><b>المنشأة:</b> ${esc(D.meta.company)}</span><span><b>الرقم الضريبي:</b> ${esc(D.meta.vat)}</span><span><b>تاريخ الطباعة:</b> ${A.todayISO()}</span></div>
      <h3>أولاً: مربعات الإقرار</h3>
      <table><thead><tr><th>#</th><th>البند</th><th>المبلغ</th><th>التعديل</th><th>الضريبة</th></tr></thead><tbody>${boxes}</tbody></table>
      <div class="netbox"><span>${T.box16 >= 0 ? 'صافي الضريبة المستحقة' : 'رصيد مستعاد / مرحّل'}</span><span>${fmt(Math.abs(T.box16))} ريال</span></div>
      <h3>ثانياً: المبيعات</h3>${table(sales)}
      <h3>ثالثاً: المشتريات</h3>${table(purch)}
      <h3>رابعاً: القرارات</h3><table><tbody>${decs}</tbody></table>
      <div class="sig"><div>إعداد</div><div>اعتماد</div></div>`;
    window.print();
  }
  function exportCSV() {
    const head = ['النوع', 'نوع المستند', 'التاريخ', 'المستند', 'الاسم', 'الرقم الضريبي', 'قبل الضريبة', 'النسبة', 'الضريبة', 'الإجمالي', 'الحالة', 'المصدر'];
    const rows = A.effDocs().map(d => [TYPE_LABEL[d.type], d.kind === 'credit' ? 'إشعار دائن' : d.kind === 'receipt' ? 'دفعة مستلمة' : 'فاتورة', d.date, d.num, d.party, d.pvat || '',
      A.r2(d.base).toFixed(2), d.rate + '%', A.r2(d.vat).toFixed(2), A.r2(d.base + d.vat).toFixed(2),
      d.status === 'out' ? 'مستبعدة' : d.status === 'ok' ? 'تمت' : 'بانتظار', d.src || (d.added ? 'مضافة يدوياً' : '')]);
    A.download('فواتير ضريبة الربع الثالث 2026.csv', A.csv([head].concat(rows)), 'text/csv;charset=utf-8');
  }
  function exportBackup() {
    const payload = { app: 'alfulvat', v: 1, at: new Date().toISOString(), state: S() };
    A.download('نسخة احتياطية - ضريبة الربع الثالث - ' + A.todayISO() + '.json', JSON.stringify(payload, null, 1), 'application/json');
  }
  function importBackup(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    file.text().then(t => {
      const p = JSON.parse(t);
      if (!p || p.app !== 'alfulvat' || !p.state) throw new Error('bad');
      if (!confirm('بيتم استبدال شغلك الحالي على هذا الجهاز بالنسخة (' + (p.at || '').slice(0, 10) + '). نكمل؟')) return;
      App.replaceState(p.state);
    }).catch(() => alert('الملف مو نسخة احتياطية من هذه الصفحة.'));
  }
  function resetAll() {
    if (!confirm('بيتم مسح كل مراجعاتك وقراراتك والفواتير اللي أضفتها على هذا الجهاز. متأكد؟')) return;
    if (!confirm('تأكيد أخير — نزّل نسخة احتياطية قبل لو تبغى ترجع لها. نكمل المسح؟')) return;
    App.replaceState(null);
  }
})();
