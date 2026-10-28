/* Payments this quarter: what left the company account (bank statement), the project's
   disbursement statements as a second view, and the items outside the statement period. */
'use strict';

(() => {
  const A = App;
  let D = null;
  const S = () => A.state;
  const $ = id => document.getElementById(id);
  const esc = A.esc;
  const fmt = A.fmt;
  const ic = A.icon;
  const F = { month: null, cat: null, q: '', vat: '' };
  const MONTHS = [['07', 'يوليو'], ['08', 'أغسطس'], ['09', 'سبتمبر']];

  A.boot(data => { D = data; init(); });

  function init() {
    $('logo').innerHTML = A.logoSVG(28);
    $('memoIcon').innerHTML = ic('note');
    $('footInfo').textContent = D.meta.company + ' · شغلك ينحفظ تلقائي في هذا المتصفح';
    if (!S().ui.payView) S().ui.payView = 'bank';
    A.onChange(render);
    render();
  }

  const view = () => S().ui.payView;
  const cats = () => view() === 'bank' ? D.bankCats : D.cats;
  const monthOf = r => (r.date || '').slice(5, 7);

  function rows() {
    if (view() === 'bank') return A.bankRows();
    return A.groupRows('ledger').map(r => Object.assign({}, r, { payee: r.party, total: A.r2(r.amount), counted: true }));
  }
  function matches(r, ignoreCat) {
    if (F.month && monthOf(r) !== F.month) return false;
    if (!ignoreCat && F.cat && r.cat !== F.cat) return false;
    if (F.vat === 'ask' && !(r.vat && r.vat.startsWith('m-') && !S().missing[r.vat])) return false;
    if (F.vat === 'has' && !r.vat) return false;
    if (F.q) {
      const hay = [r.payee, r.party, r.note, r.desc, r.ref, cats()[r.cat]].join(' ').toLowerCase();
      if (!hay.includes(F.q.toLowerCase())) return false;
    }
    return true;
  }
  const sum = list => list.reduce((s, r) => s + A.hal(r.total), 0) / 100;

  // ---------------- render ----------------
  function render() {
    if (!D) return;
    const all = rows();
    const counted = all.filter(r => r.counted);
    const isBank = view() === 'bank';
    const M = D.bankMeta;
    const head = `
      <div class="ph">
        <div><h1>مدفوعات الربع الثالث</h1>
          <p>${isBank ? `حساب الشركة في ${esc(M.bank)} (${esc(M.account)}) · ${A.fmtDate(M.from, false, false)} – ${A.fmtDate(M.to, false, false)}` : esc(D.labels.ledgerSub)}</p></div>
        <div class="seg" role="group" aria-label="العرض" style="width:auto;margin-inline-start:auto">
          <button type="button" data-v="bank" aria-pressed="${isBank}">كشف البنك</button>
          <button type="button" data-v="ledger" aria-pressed="${!isBank}">${esc(D.labels.ledgerTab)}</button>
        </div>
      </div>
      <p class="group-note" style="margin-top:-8px">${esc(isBank ? D.paymentsNote.bank : D.paymentsNote.ledger)}</p>`;

    const total = sum(counted);
    const monthTiles = MONTHS.map(([m, name]) => {
      const list = counted.filter(r => monthOf(r) === m);
      return `<button class="tile" type="button" data-month="${m}" aria-pressed="${F.month === m}">
        <div class="k">${name}</div><div class="v">${A.fmt0(sum(list))}</div>
        <div class="s">${list.length ? list.length + ' عملية' : (m === '09' && isBank ? 'ما عندي كشف سبتمبر' : 'ما فيه')}</div></button>`;
    }).join('');
    const kpis = `
      <div class="kpis">
        <div class="tile hero-tile"><div class="k">${isBank ? 'طلع من حساب الشركة' : esc(D.labels.ledgerHero)}</div>
          <div class="v">${fmt(total)}</div><div class="s">${counted.length} ${isBank ? 'عملية' : 'بند'} · ريال</div></div>
        ${monthTiles}
      </div>`;

    // chart: one bar per category, sorted by size (single hue: magnitude, not identity)
    const forChart = counted.filter(r => matches(r, true));
    const byCat = {};
    forChart.forEach(r => { const c = byCat[r.cat] || (byCat[r.cat] = { amt: 0, n: 0 }); c.amt += A.hal(r.total); c.n++; });
    const catList = Object.entries(byCat).map(([k, v]) => ({ k, amt: v.amt / 100, n: v.n })).sort((a, b) => b.amt - a.amt);
    const max = catList.length ? catList[0].amt : 1;
    const chartTotal = sum(forChart);
    const bars = catList.map(c => `
      <button class="barrow" type="button" data-cat="${esc(c.k)}" aria-pressed="${F.cat === c.k}"
        data-tip="${esc(cats()[c.k] || c.k)}|${fmt(c.amt)}|${c.n}|${chartTotal ? Math.round(c.amt / chartTotal * 100) : 0}">
        <span class="bl">${esc(cats()[c.k] || c.k)}</span>
        <span class="btrack"><span class="bfill" style="width:${Math.max(0.6, c.amt / max * 82)}%"></span><span class="bval">${A.fmt0(c.amt)}</span></span>
      </button>`).join('');
    const chart = `
      <section class="chart" aria-labelledby="chartTitle">
        <h2 id="chartTitle">حسب الفئة</h2>
        <div class="sub">${F.month ? 'شهر ' + MONTHS.find(m => m[0] === F.month)[1] + ' · ' : ''}اضغط على فئة تفلتر الجدول تحت${F.cat ? ' · <button class="linkbtn" type="button" data-clear-cat>إلغاء الفلتر</button>' : ''}</div>
        <div class="bars">${bars || '<p class="muted">ما فيه شي بهالفلتر.</p>'}</div>
      </section>`;

    const filters = `
      <div class="filters">
        <label class="sr-only" for="q">بحث</label>
        <input type="search" id="q" placeholder="ابحث باسم أو مبلغ أو ملاحظة…" value="${esc(F.q)}">
        <label class="sr-only" for="vatF">الفاتورة الضريبية</label>
        <select id="vatF">
          <option value="" ${F.vat === '' ? 'selected' : ''}>كل العمليات</option>
          <option value="ask" ${F.vat === 'ask' ? 'selected' : ''}>تحتاج فاتورة ضريبية؟</option>
          <option value="has" ${F.vat === 'has' ? 'selected' : ''}>مرتبطة بالإقرار</option>
        </select>
        <button class="btn small" type="button" data-add>${ic('plus')} دفعة</button>
        <button class="btn small quiet" type="button" data-csv>${ic('download')} Excel (CSV)</button>
      </div>`;

    $('page').innerHTML = head + kpis + chart + filters + table(all.filter(r => matches(r))) + extras();
    wire();
  }

  function vatCell(r) {
    if (!r.vat) return '<span class="muted">—</span>';
    if (r.vat === 'q2') return '<span class="vatcell ok">انحسبت في الربع الثاني</span>';
    const st = S().missing[r.vat];
    if (st === 'added') return `<span class="vatcell ok">${ic('check')} في الإقرار</span>`;
    if (st === 'none') return '<span class="vatcell muted">بدون فاتورة</span>';
    return `<a class="vatcell ask" href="index.html#${esc(r.vat)}">؟ عندك فاتورتها</a>`;
  }

  function table(list) {
    if (!list.length) return '<p class="muted" style="margin:16px 0">ما فيه عمليات بهالفلتر.</p>';
    const isBank = view() === 'bank';
    let html = '';
    for (const [m, name] of MONTHS) {
      const part = list.filter(r => monthOf(r) === m);
      if (!part.length) continue;
      const sub = sum(part.filter(r => r.counted));
      html += `<tr class="month-row"><td colspan="4">${name}</td><td class="n">${A.numHTML(sub)}</td><td></td></tr>`;
      html += part.map(r => {
        const what = isBank
          ? [r.note, r.ref && !r.note ? 'مرجع ' + r.ref : ''].filter(Boolean).map(esc).join(' · ')
          : [esc(r.desc), esc(r.ref) + ' · ' + (r.method === 'bank' ? 'تحويل بنكي' : 'تسليم يدوي'), r.note ? esc(r.note) : ''].filter(Boolean).join('<br>');
        const pills = (r.counted ? '' : ' <span class="status-pill out">مو محسوب</span>') + (r.added ? ' <span class="status-pill wait">أضفتها أنت</span>' : '') + (r.fromPending ? ' <span class="status-pill ok">أكّدتها</span>' : '');
        const amount = A.numHTML(r.total) + (r.fee ? `<div class="muted" style="font-size:.75rem">منها رسوم ${fmt(r.fee)}</div>` : '');
        const del = r.added ? ` <button class="linkbtn" type="button" data-del="${esc(r.id)}">حذف</button>` : '';
        return `<tr class="${r.counted ? '' : 'dim'}">
          <td>${A.fmtDate(r.date, r.approx, false)}</td>
          <td>${esc(r.payee || '—')}${pills}${del}</td>
          <td style="font-size:.85rem;color:var(--ink-2)">${what || '<span class="muted">—</span>'}</td>
          <td style="font-size:.85rem">${esc(cats()[r.cat] || r.cat || '')}</td>
          <td class="n">${amount}</td>
          <td>${vatCell(r)}</td></tr>`;
      }).join('');
    }
    const total = sum(list.filter(r => r.counted));
    return `<div class="tablewrap"><table class="grid">
      <thead><tr><th>التاريخ</th><th>${isBank ? 'المستفيد' : 'الجهة'}</th><th>${isBank ? 'ملاحظة' : 'البيان'}</th><th>الفئة</th><th class="n">المبلغ</th><th>فاتورة ضريبية</th></tr></thead>
      <tbody>${html}</tbody>
      <tfoot><tr><td colspan="4">الإجمالي المعروض (${list.filter(r => r.counted).length})</td><td class="n">${A.numHTML(total)}</td><td></td></tr></tfoot>
    </table></div>`;
  }

  function extras() {
    const pending = A.groupRows('pending');
    const waqf = A.groupRows('waqf');
    const pre = A.groupRows('prepaid');
    const pendHTML = pending.map(p => `
      <tr><td>${A.fmtDate(p.date, false, false)}</td><td><b>${esc(p.party)}</b><div style="font-size:.85rem;color:var(--ink-2)">${esc(p.desc)}</div><div class="muted" style="font-size:.8rem">${esc(p.note || '')}</div></td>
      <td class="n">${A.numHTML(p.amount)}</td>
      <td><label class="confirm-toggle"><input type="checkbox" data-confirm="${esc(p.id)}" ${p.confirmed ? 'checked' : ''}> انصرفت</label></td></tr>`).join('');
    const simple = list => list.map(p => `<tr><td>${A.fmtDate(p.date, false, false)}</td><td>${esc(p.party)} — ${esc(p.ref)}</td><td style="font-size:.85rem;color:var(--ink-2)">${esc(p.desc)}</td><td class="n">${A.numHTML(p.amount)}</td></tr>`).join('');
    return `
      <h3 class="section-title">بانتظار تأكيدك <span class="c">خارج فترة كشف البنك</span></h3>
      <p class="group-note">${esc(D.paymentsNote.pending)}</p>
      <div class="tablewrap"><table class="grid"><tbody>${pendHTML}</tbody></table></div>
      <div class="note warn" style="margin-top:12px">${ic('info')}<span>${esc(D.paymentsNote.september)}</span></div>

      <details class="fold"><summary>${esc(D.labels.waqfTitle)} (${A.fmt0(waqf.reduce((s, p) => s + p.amount, 0))})</summary><div class="body">
        <p class="group-note" style="margin:0 0 10px">${esc(D.paymentsNote.waqf)}</p>
        <div class="tablewrap"><table class="grid"><tbody>${simple(waqf)}</tbody></table></div></div></details>
      <details class="fold"><summary>${esc(D.labels.prepaidTitle)} (${A.fmt0(pre.reduce((s, p) => s + p.amount, 0))})</summary><div class="body">
        <p class="group-note" style="margin:0 0 10px">${esc(D.paymentsNote.prepaid)}</p>
        <div class="tablewrap"><table class="grid"><tbody>${simple(pre)}</tbody></table></div></div></details>`;
  }

  // ---------------- events ----------------
  function wire() {
    const page = $('page');
    page.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { S().ui.payView = b.dataset.v; F.cat = null; A.save(); render(); });
    page.querySelectorAll('[data-month]').forEach(b => b.onclick = () => { F.month = F.month === b.dataset.month ? null : b.dataset.month; render(); });
    page.querySelectorAll('[data-cat]').forEach(b => {
      b.onclick = () => { F.cat = F.cat === b.dataset.cat ? null : b.dataset.cat; hideTip(); render(); };
      b.onpointermove = e => showTip(b, e.clientX, e.clientY);
      b.onpointerleave = hideTip;
      b.onfocus = () => { const r = b.getBoundingClientRect(); showTip(b, r.left + r.width / 2, r.top); };
      b.onblur = hideTip;
    });
    const clr = page.querySelector('[data-clear-cat]');
    if (clr) clr.onclick = () => { F.cat = null; render(); };
    const q = $('q');
    q.oninput = () => {
      F.q = q.value.trim();
      const pos = q.selectionStart;
      render();
      const nq = $('q'); nq.focus(); nq.setSelectionRange(pos, pos);
    };
    $('vatF').onchange = e => { F.vat = e.target.value; render(); };
    page.querySelector('[data-add]').onclick = openPayForm;
    page.querySelector('[data-csv]').onclick = exportCSV;
    page.querySelectorAll('[data-confirm]').forEach(c => c.onchange = () => {
      S().pay[c.dataset.confirm] = Object.assign({}, S().pay[c.dataset.confirm], { confirmed: c.checked });
      A.changed();
      A.toast(c.checked ? 'انضافت لإجمالي حساب الشركة' : 'انشالت من الإجمالي');
    });
    page.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const p = S().addedPay.find(x => x.id === b.dataset.del);
      S().addedPay = S().addedPay.filter(x => x.id !== b.dataset.del);
      A.changed();
      A.toast('انحذفت', () => { S().addedPay.push(p); A.changed(); });
    });
  }

  function showTip(el, x, y) {
    const [name, amt, n, pct] = el.dataset.tip.split('|');
    const tt = $('tt');
    tt.innerHTML = '';
    const b = document.createElement('b'); b.textContent = amt + ' ريال';
    const s = document.createElement('div'); s.textContent = name + ' · ' + n + ' عملية · ' + pct + '%';
    tt.append(b, s);
    tt.hidden = false;
    const w = tt.offsetWidth;
    tt.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
    tt.style.top = Math.max(8, y - tt.offsetHeight - 14) + 'px';
  }
  function hideTip() { $('tt').hidden = true; }

  // ---------------- add a payment by hand (e.g. from the September statement) ----------------
  function openPayForm() {
    const dlg = $('payDlg');
    const catOpts = Object.entries(D.bankCats).filter(([k]) => k !== 'internal').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    dlg.innerHTML = `<form class="dlg" id="payForm" novalidate>
      <h2 id="payDlgTitle">دفعة جديدة</h2>
      <div class="form">
        <div class="field"><label for="pDate">التاريخ</label><input id="pDate" type="date" required min="${D.meta.from}" max="${D.meta.to}"><div class="err" id="epDate"></div></div>
        <div class="field"><label for="pAmt">المبلغ</label><input id="pAmt" type="number" step="0.01" min="0" inputmode="decimal" required><div class="err" id="epAmt"></div></div>
        <div class="field full"><label for="pPayee">المستفيد</label><input id="pPayee" required><div class="err" id="epPayee"></div></div>
        <div class="field"><label for="pCat">الفئة</label><select id="pCat">${catOpts}</select></div>
        <div class="field"><label>الطريقة</label><div class="seg" role="group" aria-label="الطريقة"><button type="button" data-m="bank" aria-pressed="true">تحويل</button><button type="button" data-m="cash" aria-pressed="false">كاش</button></div></div>
        <div class="field full"><label for="pNote">ملاحظة (اختياري)</label><input id="pNote" placeholder="مثال: من كشف سبتمبر"></div>
      </div>
      <div class="dlg-actions"><button class="btn primary" type="submit">حفظ <kbd>↵</kbd></button><button class="btn quiet" type="button" data-cancel>إلغاء <kbd>Esc</kbd></button></div>
    </form>`;
    let method = 'bank';
    dlg.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { method = b.dataset.m; dlg.querySelectorAll('[data-m]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
    dlg.querySelector('#payForm').onsubmit = e => {
      e.preventDefault();
      const q = s => dlg.querySelector(s);
      const date = q('#pDate').value, amt = parseFloat(q('#pAmt').value), payee = q('#pPayee').value.trim();
      q('#epDate').textContent = date ? '' : 'اكتب التاريخ';
      q('#epAmt').textContent = amt > 0 ? '' : 'اكتب المبلغ';
      q('#epPayee').textContent = payee ? '' : 'اكتب المستفيد';
      if (!date || !(amt > 0) || !payee) return;
      const p = { id: 'ap-' + Date.now().toString(36), date, amount: A.r2(amt), payee, cat: q('#pCat').value, method, note: q('#pNote').value.trim() };
      S().addedPay.push(p);
      S().ui.payView = 'bank';
      A.changed();
      dlg.close();
      A.toast('انضافت ' + fmt(p.amount), () => { S().addedPay = S().addedPay.filter(x => x.id !== p.id); A.changed(); });
    };
    dlg.showModal();
    dlg.querySelector('#pDate').focus();
  }

  function exportCSV() {
    const head = ['التاريخ', 'المستفيد', 'ملاحظة / البيان', 'الفئة', 'المبلغ', 'منها رسوم', 'محسوب', 'فاتورة ضريبية'];
    const list = rows().filter(r => matches(r));
    const vatTxt = r => !r.vat ? '' : r.vat === 'q2' ? 'انحسبت في الربع الثاني' : S().missing[r.vat] === 'added' ? 'في الإقرار' : S().missing[r.vat] === 'none' ? 'بدون فاتورة' : 'تحتاج تأكيد';
    const out = list.map(r => [r.date, r.payee || '', [r.note, r.desc, r.ref].filter(Boolean).join(' · '), cats()[r.cat] || r.cat, A.r2(r.total).toFixed(2), r.fee ? r.fee.toFixed(2) : '', r.counted ? 'نعم' : 'لا', vatTxt(r)]);
    A.download('مدفوعات الربع الثالث 2026 - ' + (view() === 'bank' ? 'كشف البنك' : D.labels.ledgerTab) + '.csv', A.csv([head].concat(out)), 'text/csv;charset=utf-8');
  }
})();
