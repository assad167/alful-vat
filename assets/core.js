/* Shared core for both pages: unlock (decrypt), local state, money/date helpers,
   the VAT model (docs -> ZATCA boxes), focus timer, parking-lot memo, toast, theme. */
'use strict';

const App = (() => {
  const K_STATE = 'alfulvat.q3.v1';
  const K_KEY = 'alfulvat.q3.key';
  const K_THEME = 'alfulvat.theme';
  const K_TIMER = 'alfulvat.timer';
  let DATA = null;
  let state = null;
  const listeners = [];

  // ---------- storage (every call guarded: private mode / blocked storage) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  function blankState() {
    return {
      v: 1, docs: {}, added: [], decisions: {}, missing: {}, missingLink: {},
      portal: {}, checklist: {}, box14extra: 0, carry: null, notes: '', plan: '',
      pay: {}, addedPay: [], ui: { step: 'sales', view: 'focus', cur: {} }
    };
  }
  function loadState() {
    const s = blankState();
    try { Object.assign(s, JSON.parse(store.get(K_STATE)) || {}); } catch (e) { /* keep blank */ }
    s.ui = Object.assign(blankState().ui, s.ui || {});
    return s;
  }
  function save() {
    if (!store.set(K_STATE, JSON.stringify(state))) toast('ما قدرت أحفظ في المتصفح — صدّر نسخة احتياطية');
  }
  function onChange(fn) { listeners.push(fn); }
  function changed() { save(); listeners.forEach(fn => fn()); }
  // another tab (the other page) changed the shared state
  window.addEventListener('storage', e => {
    if (e.key === K_STATE && state) { state = loadState(); listeners.forEach(fn => fn()); }
  });

  // ---------- money (sums in halalas so 0.1 + 0.2 never shows up) ----------
  const hal = x => Math.round((Number(x) || 0) * 100);
  const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
  function fmt(x) {
    const n = r2(x);
    const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '−' : '') + s;
  }
  function fmt0(x) {
    const n = Math.round(Number(x) || 0);
    return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-US');
  }
  const numHTML = x => `<span class="num">${fmt(x)}</span>`;

  // ---------- dates ----------
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  function fmtDate(iso, approx, withYear = true) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    const mm = MONTHS[+m - 1] || '';
    const yy = withYear ? ' ' + y : '';
    if (!d) return mm + yy + (approx ? ' (اليوم مو مكتوب)' : '');
    return (approx ? '≈ ' : '') + (+d) + ' ' + mm + yy;
  }
  function todayISO() {
    const t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }
  function deadline() {
    const due = DATA.meta.due;
    const end = new Date(due + 'T23:59:59');
    const now = new Date();
    const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((startOf(end) - startOf(now)) / 86400000);
    const dueDate = new Date(due + 'T12:00:00');
    const label = DAYS[dueDate.getDay()] + ' ' + fmtDate(due, false, false);
    return { days, label, past: now > end };
  }

  // ---------- escaping (labels come from files: never trust them as HTML) ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- crypto: PBKDF2-SHA256 -> AES-256-GCM (same parameters as private/build.py) ----------
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const normalizePw = pw => pw.toLowerCase().replace(/[\s-]/g, '');

  async function deriveKey(pw) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalizePw(pw)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(window.ENC.salt), iterations: window.ENC.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function decryptWith(key) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(window.ENC.iv) }, key, b64(window.ENC.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function tryStoredKey() {
    const raw = store.get(K_KEY);
    if (!raw) return null;
    try {
      const key = await crypto.subtle.importKey('raw', b64(raw), { name: 'AES-GCM' }, true, ['decrypt']);
      return await decryptWith(key);
    } catch (e) { store.del(K_KEY); return null; }
  }

  // ---------- boot: lock screen until the data decrypts ----------
  function lockHTML() {
    return `
    <main class="lock">
      <div class="card">
        ${logoSVG(40)}
        <h1>ضريبة الربع الثالث — شركة الفل</h1>
        <p>الصفحة عامة على الإنترنت، فبيانات الشركة مشفّرة. اكتب كلمة المرور مرة وحدة على هذا الجهاز.</p>
        <form id="lockForm" autocomplete="off">
          <label class="sr-only" for="pw">كلمة المرور</label>
          <input id="pw" type="password" inputmode="text" autocapitalize="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx" required>
          <label class="remember"><input id="remember" type="checkbox" checked> تذكرني على هذا الجهاز</label>
          <button class="btn primary" type="submit" style="justify-content:center">افتح</button>
          <div class="err" id="lockErr" role="alert"></div>
        </form>
        <div class="fine">${icon('lock')}<span>تشفير AES‑256. بدون كلمة المرور الملف المنشور ما ينقرا.</span></div>
      </div>
    </main>`;
  }

  async function boot(onReady) {
    applyTheme(store.get(K_THEME));
    const lock = document.getElementById('lock');
    const app = document.getElementById('app');
    if (!window.crypto || !crypto.subtle) {
      lock.innerHTML = '<main class="lock"><div class="card"><h1>المتصفح ما يدعم التشفير</h1><p>افتح الرابط من كروم أو سفاري أو إيدج (بعنوان https).</p></div></main>';
      return;
    }
    const ready = data => {
      DATA = data;
      state = loadState();
      lock.innerHTML = '';
      lock.hidden = true;
      app.hidden = false;
      initChrome();
      onReady(DATA);
    };
    const cached = await tryStoredKey();
    if (cached) return ready(cached);

    lock.innerHTML = lockHTML();
    const form = document.getElementById('lockForm');
    const pw = document.getElementById('pw');
    const err = document.getElementById('lockErr');
    pw.focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      err.textContent = 'لحظة…';
      try {
        const key = await deriveKey(pw.value);
        const data = await decryptWith(key);
        if (document.getElementById('remember').checked) store.set(K_KEY, toB64(await crypto.subtle.exportKey('raw', key)));
        ready(data);
      } catch (ex) {
        err.textContent = 'كلمة المرور غلط — جرّب مرة ثانية.';
        pw.select();
      }
    });
  }
  function forget() { store.del(K_KEY); location.reload(); }
  // restore a backup (object) or wipe this device's work (null)
  function replaceState(obj) {
    if (obj) store.set(K_STATE, JSON.stringify(obj)); else store.del(K_STATE);
    location.reload();
  }

  // ---------- the VAT model ----------
  const decisionById = id => DATA.decisions.find(d => d.id === id);
  function decisionValue(id) {
    if (state.decisions[id] != null) return state.decisions[id];
    const d = decisionById(id);
    return d ? d.default : null;
  }
  // a row (doc or payment) tied to a decision only exists for the options listed in its variants
  function applyVariant(row) {
    if (!row.decision) return row;
    const v = decisionValue(row.decision);
    if (!row.variants || !(v in row.variants)) return null;
    return Object.assign({}, row, row.variants[v]);
  }
  function normalizeDoc(d) {
    const x = Object.assign({ rate: 15 }, d);
    if (x.gross != null && x.base == null) {
      x.base = r2(x.gross / (1 + x.rate / 100));
      x.vat = r2(x.gross - x.base);
    }
    return x;
  }
  function effDocs() {
    const out = [];
    for (const d0 of DATA.docs) {
      const d1 = applyVariant(d0);
      if (!d1) continue;
      const x = normalizeDoc(d1);
      const ov = state.docs[d0.id] || {};
      if (ov.edits) Object.assign(x, ov.edits);
      x.status = ov.status || null;
      out.push(x);
    }
    for (const a of state.added) {
      const ov = state.docs[a.id] || {};
      out.push(Object.assign({ rate: 15 }, a, { added: true, status: ov.status || 'ok' }));
    }
    return out.sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.id).localeCompare(String(b.id)));
  }
  const included = d => d.status !== 'out';

  function box14() {
    let t = hal(state.box14extra);
    for (const d of DATA.decisions) {
      const v = decisionValue(d.id);
      const opt = d.options.find(o => o.id === v);
      if (opt && opt.box14) t += hal(opt.box14);
    }
    return t / 100;
  }
  function carry() { return state.carry != null ? Number(state.carry) : DATA.meta.carry; }

  function totals(docs) {
    const T = { s15: 0, s15adj: 0, s15vat: 0, s0: 0, s0adj: 0, p15: 0, p15adj: 0, p15vat: 0, p0: 0, p0adj: 0, nS: 0, nP: 0 };
    for (const d of (docs || effDocs())) {
      if (!included(d)) continue;
      const credit = d.kind === 'credit';
      const zero = Number(d.rate) === 0;
      if (d.type === 'sales') {
        T.nS++;
        if (zero) T[credit ? 's0adj' : 's0'] += hal(d.base);
        else { T[credit ? 's15adj' : 's15'] += hal(d.base); T.s15vat += hal(d.vat); }
      } else {
        T.nP++;
        if (zero) T[credit ? 'p0adj' : 'p0'] += hal(d.base);
        else { T[credit ? 'p15adj' : 'p15'] += hal(d.base); T.p15vat += hal(d.vat); }
      }
    }
    const R = {};
    for (const k in T) R[k] = k.startsWith('n') ? T[k] : T[k] / 100;
    R.box13 = (T.s15vat - T.p15vat) / 100;
    R.box14 = box14();
    R.box15 = carry();
    R.box16 = (hal(R.box13) + hal(R.box14) - hal(R.box15)) / 100;
    return R;
  }

  // ---------- payments model ----------
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || String(a.id).localeCompare(String(b.id));
  // money that left the company account: the bank statement + what the user added by hand + confirmed pending items
  function bankRows() {
    const out = DATA.bank.map(b => Object.assign({ method: 'bank' }, b, { total: r2(b.amount + (b.fee || 0)), counted: b.cat !== 'internal' }));
    for (const a of state.addedPay) out.push(Object.assign({ added: true, counted: true }, a, { total: r2(a.amount) }));
    for (const p of groupRows('pending')) if (p.confirmed) out.push(Object.assign({}, p, { total: r2(p.amount), counted: true, fromPending: true }));
    return out.sort(byDate);
  }
  // project disbursement statements (صرف 18–25); rows tied to a decision follow it
  function groupRows(group) {
    const out = [];
    for (const p0 of DATA.payments) {
      if (p0.group !== group) continue;
      const p = applyVariant(p0);
      if (!p) continue;
      out.push(Object.assign({}, p, { confirmed: group !== 'pending' || !!(state.pay[p.id] || {}).confirmed }));
    }
    return out.sort(byDate);
  }
  function missingStatus(id) { return state.missing[id] || null; }

  // ---------- UI helpers ----------
  function icon(name) {
    const P = {
      check: '<path d="M5 12.5l4.2 4.2L19 7" />',
      x: '<path d="M6 6l12 12M18 6L6 18" />',
      edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M14 6l4 4" />',
      info: '<circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" />',
      warn: '<path d="M12 3l9.5 17h-19L12 3z" /><path d="M12 10v4.5M12 17.5v.5" />',
      file: '<path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" />',
      lock: '<rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />',
      timer: '<circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9.5 2.5h5" />',
      moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />',
      sun: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />',
      note: '<path d="M5 4h14v12l-4 4H5z" /><path d="M15 20v-4h4M8 9h8M8 13h5" />',
      plus: '<path d="M12 5v14M5 12h14" />',
      copy: '<rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />',
      print: '<path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" />',
      download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />',
      arrowL: '<path d="M15 6l-6 6 6 6" />',
      arrowR: '<path d="M9 6l6 6-6 6" />'
    };
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  }
  function logoSVG(size = 30) {
    // the company mark is a triangle (navy / gold / red)
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 4 L37 34 H3 Z" fill="#1d395e"/><path d="M20 15 L29.5 31 H10.5 Z" fill="#f0a500"/><path d="M20 23 L24.5 31 H15.5 Z" fill="#8b2331"/></svg>`;
  }

  let toastTimer = null;
  function toast(msg, undo) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button type="button">تراجع <kbd>Z</kbd></button>' : '');
    if (undo) t.querySelector('button').onclick = () => { undo(); hideToast(); };
    t.classList.add('show');
    App._undo = undo || null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 6000 : 2600);
  }
  function hideToast() { const t = document.getElementById('toast'); if (t) t.classList.remove('show'); App._undo = null; }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove(); return ok;
    }
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csv(rows) {
    return '﻿' + rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  }
  const isTyping = el => el && (el.closest('input, textarea, select, [contenteditable="true"]') || el.closest('dialog[open]'));

  // ---------- theme ----------
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function toggleTheme() {
    const next = isDark() ? 'light' : 'dark';
    store.set(K_THEME, next); applyTheme(next); paintThemeBtn();
  }
  function paintThemeBtn() {
    const b = document.getElementById('themeBtn');
    if (b) { b.innerHTML = icon(isDark() ? 'sun' : 'moon'); b.title = isDark() ? 'الوضع الفاتح' : 'الوضع الداكن'; }
  }

  // ---------- focus timer (Pomodoro-style; minutes only so it doesn't tick at you) ----------
  function timerState() { try { return JSON.parse(store.get(K_TIMER)) || null; } catch (e) { return null; } }
  function setTimer(t) { if (t) store.set(K_TIMER, JSON.stringify(t)); else store.del(K_TIMER); paintTimer(); }
  function timerLeft(t) { return Math.max(0, t.start + t.mins * 60000 - Date.now()); }
  let chimed = false;
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.28].forEach((d, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = i ? 784 : 659;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + d + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.9);
        o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 1);
      });
    } catch (e) { /* no audio, fine */ }
  }
  function paintTimer() {
    const b = document.getElementById('timerBtn');
    if (!b) return;
    const t = timerState();
    if (!t) { b.innerHTML = icon('timer') + '<span>تركيز</span>'; b.setAttribute('aria-pressed', 'false'); return; }
    const left = timerLeft(t);
    if (left <= 0) {
      b.innerHTML = icon('timer') + `<span>${t.kind === 'focus' ? 'خلصت الجلسة' : 'خلصت الاستراحة'}</span>`;
      b.setAttribute('aria-pressed', 'true');
      if (!chimed) { chimed = true; chime(); openTimer(); }
      return;
    }
    chimed = false;
    const m = Math.ceil(left / 60000);
    b.innerHTML = icon('timer') + `<span>${t.kind === 'focus' ? 'تركيز' : 'استراحة'} · ${m} د</span>`;
    b.setAttribute('aria-pressed', 'true');
  }
  function closeTimer() { const p = document.getElementById('timerPop'); if (p) p.remove(); }
  function openTimer() {
    closeTimer();
    const t = timerState();
    const pop = document.createElement('div');
    pop.id = 'timerPop'; pop.className = 'timer-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'مؤقت التركيز');
    const preset = (store.get(K_TIMER + '.preset') || '25');
    if (!t) {
      pop.innerHTML = `
        <h3>جلسة تركيز</h3>
        <p>شغل متواصل بدون مقاطعة، بعدها استراحة قصيرة بعيد عن الشاشة. قبل تبدأ:</p>
        <ul class="checklist" style="margin-top:8px">
          <li><label><input type="checkbox"><span>الجوال على «عدم الإزعاج» وبعيد عنك</span></label></li>
          <li><label><input type="checkbox"><span>سكّرت الواتساب والتبويبات اللي ما لها داعي</span></label></li>
          <li><label><input type="checkbox"><span>مجلد الفواتير وكشف البنك مفتوحين</span></label></li>
        </ul>
        <div class="seg" style="margin-top:10px" role="group" aria-label="مدة الجلسة">
          <button type="button" data-p="25" aria-pressed="${preset === '25'}">25 د + 5 راحة</button>
          <button type="button" data-p="50" aria-pressed="${preset === '50'}">50 د + 10 راحة</button>
        </div>
        <div class="row"><button class="btn primary small" id="tStart">ابدأ</button><button class="btn quiet small" id="tClose">إغلاق</button></div>`;
    } else {
      const left = timerLeft(t);
      const mm = Math.floor(left / 60000), ss = Math.floor(left % 60000 / 1000);
      const over = left <= 0;
      const isFocus = t.kind === 'focus';
      pop.innerHTML = over ? `
        <h3>${isFocus ? 'خلصت جلسة التركيز 👏' : 'خلصت الاستراحة'}</h3>
        <p>${isFocus ? `قوم ${t.brk} دقايق: امشِ، اشرب موية، وخلّ عيونك بعيد عن الشاشة. الاستراحة القصيرة ترجّع التركيز.` : 'يلا نرجع — كمّل من نفس البطاقة.'}</p>
        <div class="row">${isFocus ? '<button class="btn primary small" id="tBreak">ابدأ الاستراحة</button>' : '<button class="btn primary small" id="tAgain">جلسة جديدة</button>'}<button class="btn quiet small" id="tStop">إنهاء</button></div>`
        : `
        <h3>${isFocus ? 'جلسة تركيز شغالة' : 'استراحة'}</h3>
        <p class="num" style="font-size:2rem;color:var(--ink);text-align:center;margin:6px 0">${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}</p>
        <p>${isFocus ? 'لو جاك خاطر مشتت، اكتبه في «خاطر؟» تحت وارجع للبطاقة.' : 'بعيد عن الشاشة لو تقدر.'}</p>
        <div class="row"><button class="btn small" id="tStop">إيقاف</button><button class="btn quiet small" id="tClose">إغلاق</button></div>`;
    }
    document.querySelector('.topbar').appendChild(pop);
    const $ = s => pop.querySelector(s);
    pop.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
      store.set(K_TIMER + '.preset', b.dataset.p);
      pop.querySelectorAll('[data-p]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    if ($('#tStart')) $('#tStart').onclick = () => {
      const p = store.get(K_TIMER + '.preset') || '25';
      setTimer({ kind: 'focus', start: Date.now(), mins: +p, brk: p === '50' ? 10 : 5 }); closeTimer();
      toast('بدأت الجلسة — ' + p + ' دقيقة. ركّز على البطاقة اللي قدامك بس.');
    };
    if ($('#tBreak')) $('#tBreak').onclick = () => { setTimer({ kind: 'break', start: Date.now(), mins: t.brk, brk: t.brk }); closeTimer(); };
    if ($('#tAgain')) $('#tAgain').onclick = () => { setTimer(null); openTimer(); };
    if ($('#tStop')) $('#tStop').onclick = () => { setTimer(null); closeTimer(); };
    if ($('#tClose')) $('#tClose').onclick = closeTimer;
    (pop.querySelector('button.primary') || pop.querySelector('button')).focus();
  }

  // ---------- parking-lot memo ----------
  function paintMemoCount() {
    const c = document.getElementById('memoCount');
    if (!c) return;
    const n = (state.notes || '').split('\n').filter(l => l.trim()).length;
    c.textContent = n; c.hidden = !n;
  }
  function toggleMemo(force) {
    const m = document.getElementById('memo');
    const open = force != null ? force : m.hidden;
    m.hidden = !open;
    document.getElementById('memoFab').setAttribute('aria-expanded', String(open));
    if (open) { const ta = m.querySelector('textarea'); ta.value = state.notes || ''; ta.focus(); ta.selectionStart = ta.value.length; }
  }

  // ---------- "why it's designed this way" ----------
  const WHY = `
    <ol>
      <li><b>شي واحد قدامك كل مرة.</b> بطاقة وحدة وخطوات منفصلة بدل جدول كبير: التنقّل بين المهام يخلّي «بقايا انتباه» على المهمة اللي قبل وينزّل الأداء. <span class="ref">— Leroy (2009)</span></li>
      <li><b>أقل حمل على الذاكرة.</b> كل بطاقة فيها 3–4 أرقام بس، والباقي مخفي لين تحتاجه، لأن الذاكرة العاملة تمسك تقريباً 4 أشياء. <span class="ref">— Sweller (1988)، Cowan (2001)</span></li>
      <li><b>خيارات قليلة وواضحة.</b> 2–3 أزرار كبيرة لكل قرار: وقت القرار يزيد مع عدد الخيارات، والهدف الكبير أسرع وأدق. <span class="ref">— Hick (1952)، Fitts (1954)</span></li>
      <li><b>تشوف تقدّمك.</b> شريط «تم كذا · باقي كذا»: كل ما قربت من النهاية يزيد الدافع. <span class="ref">— Kivetz وزملاؤه (2006)</span></li>
      <li><b>جلسات تركيز واستراحات قصيرة.</b> 25 أو 50 دقيقة ثم استراحة: الاستراحات المنظمة تقلل التعب وتحافظ على التركيز. <span class="ref">— Ariga & Lleras (2011)، Biwer وزملاؤه (2023)</span></li>
      <li><b>«خاطر؟» للأفكار المشتتة.</b> لما تكتب الشي اللي ببالك مع نية ترجع له، يخف إلحاحه وترجع للمهمة. <span class="ref">— Masicampo & Baumeister (2011)</span></li>
      <li><b>المقاطعات مكلفة.</b> لذلك قائمة «قبل تبدأ» (الجوال، الواتساب) قبل كل جلسة. <span class="ref">— Mark وزملاؤه (2008)</span></li>
      <li><b>حدد متى بتسويها.</b> خانة «متى بتخلّصه؟»: ربط المهمة بوقت ومكان محدد يرفع احتمال التنفيذ. <span class="ref">— Gollwitzer (1999)</span></li>
      <li><b>قائمة تحقق عند التقديم.</b> علامة ✓ جنب كل مربع تنقله للبوابة: قوائم التحقق تقلل الأخطاء في الشغل الحساس. <span class="ref">— Haynes وزملاؤه (2009)</span></li>
      <li><b>قراءة مريحة.</b> خط بحجم 17px، تباين نص ≥ 4.5:1، أسطر قصيرة، نص غامق على خلفية فاتحة بشكل افتراضي، بدون حركات، ودعم كامل للكيبورد. <span class="ref">— WCAG 2.2، Piepenbrock وزملاؤه (2013)، ISO 9241‑110</span></li>
      <li><b>منع الأخطاء والتراجع.</b> الضريبة تنحسب تلقائي، تنبيه على التاريخ والرقم المكرر، وكل خطوة لها «تراجع». <span class="ref">— Nielsen (1994)</span></li>
    </ol>`;

  // ---------- shared chrome: top bar, memo, why dialog, keyboard ----------
  function initChrome() {
    paintThemeBtn();
    paintTimer();
    setInterval(paintTimer, 15000);
    document.getElementById('themeBtn').onclick = toggleTheme;
    document.getElementById('timerBtn').onclick = () => (document.getElementById('timerPop') ? closeTimer() : openTimer());
    document.addEventListener('click', e => {
      const pop = document.getElementById('timerPop');
      if (pop && !pop.contains(e.target) && !e.target.closest('#timerBtn')) closeTimer();
    });

    const memo = document.getElementById('memo');
    memo.querySelector('textarea').addEventListener('input', e => { state.notes = e.target.value; save(); paintMemoCount(); });
    document.getElementById('memoFab').onclick = () => toggleMemo();
    memo.querySelector('[data-close]').onclick = () => toggleMemo(false);
    paintMemoCount();

    const why = document.getElementById('whyDlg');
    why.querySelector('.why').innerHTML = WHY;
    document.querySelectorAll('[data-why]').forEach(b => b.onclick = () => why.showModal());
    why.querySelector('[data-close]').onclick = () => why.close();
    const fb = document.getElementById('forgetBtn');
    if (fb) fb.onclick = () => { if (confirm('تبغى تقفل الصفحة وتمسح كلمة المرور المحفوظة من هذا الجهاز؟ (شغلك المحفوظ ما ينمسح)')) forget(); };

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeTimer(); if (!memo.hidden) toggleMemo(false); }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyM') { e.preventDefault(); toggleMemo(); }
      if (e.code === 'KeyZ' && App._undo) { e.preventDefault(); const u = App._undo; hideToast(); u(); }
    });
  }

  return {
    boot, onChange, changed, save, get state() { return state; }, get DATA() { return DATA; },
    hal, r2, fmt, fmt0, numHTML, fmtDate, todayISO, deadline, esc, MONTHS,
    decisionById, decisionValue, effDocs, included, totals, box14, carry, bankRows, groupRows, missingStatus, replaceState,
    icon, logoSVG, toast, copyText, download, csv, isTyping, normalizeDoc, _undo: null
  };
})();
