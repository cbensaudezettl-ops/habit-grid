/*
 * Habit Grid, iPhone app (installable web app). UI layer, object-oriented.
 * Talks to the Apps Script backend (or to the in-browser demo backend) through one Api object.
 */
(function () {
  'use strict';
  const D = HG.DateUtil;
  const CFG = window.HG_CONFIG || {};
  const DEMO = !CFG.API_URL || /[?&]demo\b/.test(location.search);
  const KEYS = { token: DEMO ? 'hg.demo.token' : 'hg.token', me: DEMO ? 'hg.demo.me' : 'hg.me', ob: DEMO ? 'hg.demo.ob' : 'hg.ob', quiz: 'hg.quiz.' };

  // ================================================================ small helpers
  function h(tag, props) {
    const el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      const v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // static, trusted markup only (icons)
      else if (k === 'style') Object.keys(v).forEach(function (s) { el.style.setProperty(s, v[s]); });
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function pct(v) { return v == null ? '–' : Math.round(v * 100) + '%'; }
  function fmtN(x) { return Number.isInteger(x) ? String(x) : x.toFixed(1); }
  /** 3.5 -> "3½": compact enough for a calendar square. */
  function fmtHalf(x) { const w = Math.floor(x + 1e-9); return (w || x < 0.5 ? String(w) : '') + (x - w > 0.25 ? '½' : ''); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  const LocalStore = {
    get: function (k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } }
  };

  const LINE = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  const ICON = {
    close: LINE('<path d="M6 6l12 12M18 6L6 18"/>'),
    back: LINE('<path d="M15 5l-7 7 7 7"/>'),
    arrow: LINE('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    shuffle: LINE('<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
    check: LINE('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    pencil: LINE('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    lock: LINE('<rect x="4" y="11" width="16" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5l10.5 6.5L8 18.5z" fill="currentColor"/></svg>',
    community: '<svg viewBox="0 0 32 32"><circle cx="12" cy="10.5" r="5" fill="#8e7cf0"/><circle cx="22.5" cy="12.5" r="4" fill="#f59ab5"/><path d="M2.5 27c0-5.4 4.2-9 9.5-9s9.5 3.6 9.5 9z" fill="#8e7cf0"/><path d="M18.4 27c.4-4.2 2.5-7.2 5.6-7.2 3.6 0 6 2.9 6 7.2z" fill="#f59ab5"/></svg>',
    grid: '<svg viewBox="0 0 32 32"><rect x="3" y="3" width="7.5" height="7.5" rx="2.2" fill="#46ad80"/><rect x="12.25" y="3" width="7.5" height="7.5" rx="2.2" fill="#46ad80"/><rect x="21.5" y="3" width="7.5" height="7.5" rx="2.2" fill="#f08a7c"/><rect x="3" y="12.25" width="7.5" height="7.5" rx="2.2" fill="#46ad80"/><rect x="12.25" y="12.25" width="7.5" height="7.5" rx="2.2" fill="#2f8a63"/><rect x="21.5" y="12.25" width="7.5" height="7.5" rx="2.2" fill="#46ad80"/><rect x="3" y="21.5" width="7.5" height="7.5" rx="2.2" fill="#f08a7c"/><rect x="12.25" y="21.5" width="7.5" height="7.5" rx="2.2" fill="#46ad80"/><rect x="21.5" y="21.5" width="7.5" height="7.5" rx="2.2" fill="#cfc8bd"/></svg>',
    bulb: '<svg viewBox="0 0 32 32"><path d="M16 6.5a8 8 0 0 0-4.7 14.5c.8.6 1.2 1.5 1.2 2.4V24h7v-.6c0-.9.4-1.8 1.2-2.4A8 8 0 0 0 16 6.5z" fill="#ffcf5c"/><rect x="12.5" y="25.3" width="7" height="3.2" rx="1.6" fill="#f2a33a"/><path d="M16 1.5v2.2M3.5 14.5H1.5M30.5 14.5h-2M6.2 4.8l1.6 1.6M25.8 4.8l-1.6 1.6" stroke="#f2a33a" stroke-width="2.2" stroke-linecap="round"/><path d="M13.5 15.5l2.5-3 2.5 3-2.5 3z" fill="#fff" opacity=".85"/></svg>',
    swirl: '<svg viewBox="0 0 100 100"><path d="M50 10c22 0 40 18 40 40S72 90 50 90 10 72 10 50s14-30 30-30 26 12 26 26-10 20-20 20-14-8-14-14 6-10 10-10" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>'
  };
  function ic(name) { return h('span', { html: ICON[name], 'aria-hidden': 'true', style: { display: 'inline-grid', width: '22px', height: '22px' } }); }

  function avatar(card, size) {
    const hue = Number(card.hue) || 0;
    return h('div', {
      class: 'avatar', 'aria-hidden': 'true',
      style: { width: size + 'px', height: size + 'px', 'font-size': Math.round(size * 0.44) + 'px', background: 'linear-gradient(135deg, hsl(' + hue + ' 82% 74%), hsl(' + ((hue + 48) % 360) + ' 72% 60%))' }
    }, (card.username || '?').slice(0, 1).toUpperCase());
  }

  function ring(ratio, size, color, label) {
    const r = 26, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, ratio || 0));
    const el = h('div', { class: 'ring', style: { width: size + 'px', height: size + 'px' } });
    el.innerHTML = '<svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="' + r + '" fill="none" stroke-width="7"/><circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (c * v) + ' ' + c + '"/></svg>';
    el.appendChild(h('b', null, label));
    return el;
  }

  // ================================================================ feedback widgets
  const Toast = {
    show: function (msg, err) {
      document.querySelectorAll('.toast').forEach(function (t) { t.remove(); });
      const t = h('div', { class: 'toast' + (err ? ' err' : ''), role: 'status' }, msg);
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, err ? 4500 : 2800);
    }
  };

  const Confetti = {
    burst: function (opts) {
      if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      opts = opts || {};
      const c = h('canvas', { class: 'confetti' });
      document.body.appendChild(c);
      const dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
      c.width = W * dpr; c.height = H * dpr;
      const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
      const colors = ['#46ad80', '#8e7cf0', '#ffb48a', '#ffcf5c', '#f59ab5', '#76c3e6'];
      const ox = opts.x || W / 2, oy = opts.y || H / 3, n = opts.count || 130;
      const parts = [];
      for (let i = 0; i < n; i++) parts.push({ x: ox, y: oy, vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 12 - 4, s: 5 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[i % colors.length], round: Math.random() < 0.3 });
      let last = performance.now();
      const step = function (t) {
        const dt = Math.min(32, t - last) / 16; last = t;
        ctx.clearRect(0, 0, W, H);
        let alive = 0;
        parts.forEach(function (p) {
          p.vy += 0.33 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
          if (p.y < H + 20) alive++;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
          if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, 7); ctx.fill(); } else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
          ctx.restore();
        });
        if (alive) requestAnimationFrame(step); else c.remove();
      };
      requestAnimationFrame(step);
    }
  };

  /** Bottom sheet with drag-to-dismiss. */
  class Sheet {
    constructor(title, opts) {
      this.opts = opts || {};
      this.titleEl = h('h2', null, title);
      this.body = h('div', { class: 'sheet-body' });
    }
    setTitle(t) { this.titleEl.textContent = t; }
    open() {
      const self = this;
      this.backdrop = h('div', { class: 'sheet-backdrop', onclick: function () { self.close(); } });
      const grab = h('div', { class: 'grab', 'aria-hidden': 'true' }, h('i'));
      this.el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, grab,
        h('div', { class: 'sheet-head' }, this.titleEl, h('button', { class: 'icon-btn', 'aria-label': 'Close', html: ICON.close, onclick: function () { self.close(); } })),
        this.body);
      document.body.append(this.backdrop, this.el);
      let y0 = null, dy = 0;
      grab.addEventListener('pointerdown', function (e) { y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); self.el.style.transition = 'none'; });
      grab.addEventListener('pointermove', function (e) { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); self.el.style.transform = 'translateY(' + dy + 'px)'; });
      const end = function () { if (y0 === null) return; y0 = null; self.el.style.transition = 'transform .25s'; if (dy > 100) self.close(); else self.el.style.transform = ''; };
      grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
      this.keyHandler = function (e) { if (e.key === 'Escape') self.close(); };
      document.addEventListener('keydown', this.keyHandler);
      return this;
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      const el = this.el, bd = this.backdrop;
      el.style.transition = 'transform .25s'; el.style.transform = 'translateY(100%)';
      bd.style.transition = 'opacity .25s'; bd.style.opacity = '0';
      document.removeEventListener('keydown', this.keyHandler);
      setTimeout(function () { el.remove(); bd.remove(); }, 260);
      if (this.opts.onClose) this.opts.onClose();
    }
    static confirm(title, text, okLabel, okClass) {
      return new Promise(function (resolve) {
        let answered = false;
        const s = new Sheet(title, { onClose: function () { if (!answered) resolve(false); } });
        s.body.append(h('p', { class: 'muted', style: { margin: '4px 0 18px' } }, text),
          h('button', { class: 'btn block ' + (okClass || 'green'), onclick: function () { answered = true; resolve(true); s.close(); } }, okLabel),
          h('button', { class: 'btn ghost block', style: { 'margin-top': '6px' }, onclick: function () { s.close(); } }, 'Cancel'));
        s.open();
      });
    }
  }

  // ================================================================ API
  class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }

  class RemoteApi {
    constructor(url) { this.url = url; this.token = LocalStore.get(KEYS.token, null); }
    setToken(t) { this.token = t; if (t) LocalStore.set(KEYS.token, t); else LocalStore.del(KEYS.token); }
    async call(action, data) {
      let res, json;
      try {
        res = await fetch(this.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, token: this.token, data: data || {} }) });
      } catch (e) { throw new ApiError('offline', 'No connection. Check your internet and try again.'); }
      try { json = await res.json(); } catch (e) { throw new ApiError('server', 'The server did not answer properly. Is the Apps Script deployed with access "Anyone"?'); }
      if (!json.ok) throw new ApiError(json.error.code, json.error.message);
      return json.data;
    }
  }

  /** Runs the real backend classes in the browser, with made-up players. */
  class DemoApi extends RemoteApi {
    constructor() { super(''); this.backend = window.HabitGridDemo.createBackend(); }
    async call(action, data) {
      await sleep(120 + Math.random() * 200);
      const r = JSON.parse(JSON.stringify(this.backend.handle({ action: action, token: this.token, data: data || {} })));
      if (!r.ok) throw new ApiError(r.error.code, r.error.message);
      return r.data;
    }
    async submitForm(offset, levels) {
      await sleep(250);
      const r = this.backend.submitForm(this.token, offset, levels);
      if (!r.ok) throw new ApiError(r.error.code, r.error.message);
      return r.data;
    }
    reset() { this.backend.reset(); }
  }

  // ================================================================ state
  class AppState {
    constructor(api) {
      this.api = api;
      this.me = LocalStore.get(KEYS.me, null);
      this.community = null; this.quizToday = null; this.quizStats = null; this.boards = {};
      this.loadedAt = {}; this.listeners = [];
    }
    on(fn) { this.listeners.push(fn); }
    emit(what) { this.listeners.forEach(function (fn) { fn(what); }); }
    get today() { return (this.me && this.me.today) || D.localToday(); }
    evaluator() {
      if (!this.ev || this.evFor !== this.me) { this.ev = new HG.DayEvaluator(this.me.habits, this.me.checkins, this.me.user.joinedAt); this.evFor = this.me; }
      return this.ev;
    }
    stale(key, ms) { return !this.loadedAt[key] || Date.now() - this.loadedAt[key] > ms; }
    async loadMe() { this.me = await this.api.call('me'); this.loadedAt.me = Date.now(); LocalStore.set(KEYS.me, this.me); this.emit('me'); return this.me; }
    async loadCommunity() { this.community = await this.api.call('community.list'); this.loadedAt.community = Date.now(); this.emit('community'); }
    async loadQuiz() {
      const r = await Promise.all([this.api.call('quiz.today'), this.api.call('quiz.stats')]);
      this.quizToday = r[0]; this.quizStats = r[1]; this.loadedAt.quiz = Date.now(); this.emit('quiz');
    }
    async loadBoard(level, scope) {
      this.boards[level + ':' + scope] = await this.api.call('quiz.leaderboard', { level: level, scope: scope });
      this.loadedAt['board' + level + scope] = Date.now();
      this.emit('board');
    }
  }

  // ================================================================ calendar (GitHub style)
  /**
   * opts: { today, statusOf(date), onTap(date), width, weeks?, countOf?(date) }
   * With countOf, each filled-in square shows how many habits were kept that day
   * (big number) and its day of the month (small number in the corner).
   */
  function buildCalendar(opts) {
    const gap = 4, W = Math.max(240, opts.width - 22), counts = !!opts.countOf;
    let cell = counts ? Math.min(38, Math.max(29, (W - 8 * gap) / 9)) : Math.min(30, Math.max(19, (W - 11 * gap) / 12));
    const weeks = opts.weeks || Math.max(counts ? 6 : 8, Math.floor((W + gap) / (cell + gap)));
    if (opts.weeks) cell = Math.min(30, (W - (weeks - 1) * gap) / weeks);
    const start = D.add(D.weekStart(opts.today), -(weeks - 1) * 7);
    const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': 'Calendar of your days' });
    const months = h('div', { class: 'cal-months', 'aria-hidden': 'true' });
    let lastLabelCol = -9;
    for (let w = 0; w < weeks; w++) {
      let label = null;
      for (let d = 0; d < 7; d++) {
        const date = D.add(start, w * 7 + d), status = opts.statusOf(date), dom = Number(date.slice(8));
        if (dom === 1 || (w === 0 && d === 0)) label = D.monthShort(date);
        const kept = counts && (status === 'green' || status === 'red') ? opts.countOf(date) : null;
        const cls = 'day ' + status + (date === opts.today ? ' today' : '') + (counts ? ' counts' : '');
        const words = { green: 'green day', red: 'red day', gray: 'not filled in', none: 'before start', future: 'upcoming' }[status];
        const aria = D.format(date, 'long') + ', ' + words + (kept ? ', ' + fmtN(kept.kept) + ' of ' + kept.total + ' habits kept' : '');
        grid.appendChild(h('button', {
          class: cls, type: 'button', 'aria-label': aria, tabindex: status === 'future' ? '-1' : null, 'data-date': date,
          onclick: status === 'future' || !opts.onTap ? null : function () { opts.onTap(date); }
        }, counts ? [h('span', { class: 'dn' }, String(dom)), kept ? h('span', { class: 'kc' }, fmtHalf(kept.kept)) : null] : dom));
      }
      if (label && w - lastLabelCol >= 3) { months.appendChild(h('span', { style: { left: (w * (cell + gap)) + 'px' } }, label)); lastLabelCol = w; }
    }
    const wd = h('div', { class: 'cal-wd', 'aria-hidden': 'true' }, ['M', '', 'W', '', 'F', '', 'S'].map(function (t) { return h('span', null, t); }));
    return h('div', { class: 'cal', style: { '--cell': cell.toFixed(2) + 'px', '--gap': gap + 'px' } }, h('div'), months, wd, grid);
  }
  function legend(total) {
    return h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'green' }), 'More than 2/3 kept'),
      h('span', null, h('i', { class: 'red' }), '2/3 or less'),
      h('span', null, h('i', { class: 'gray' }), 'Not filled in yet'),
      total ? h('span', { class: 'legend-count' }, h('i', { class: 'sample' }, h('span', { class: 'dn' }, '12'), h('span', { class: 'kc' }, '5')),
        'Big number: habits kept that day, out of ' + total + '. Small number: the date.') : null);
  }
  /** "7 habits · 🌱 4 to gain · 🍂 3 to lose" */
  function habitTotals(habits) {
    const g = habits.filter(function (x) { return x.kind === 'good'; }).length, b = habits.length - g;
    return h('div', { class: 'totals' },
      h('span', { class: 'pill total' }, plural(habits.length, 'habit') + ' in total'),
      h('span', { class: 'pill gain' }, HG.KIND_INFO.good.emoji + ' ' + g + ' to gain'),
      h('span', { class: 'pill lose' }, HG.KIND_INFO.bad.emoji + ' ' + b + ' to lose'));
  }
  /** Two small bars: good habits gained and bad habits resisted on one day. */
  function kindBreakdown(byKind) {
    return h('div', { class: 'breakdown' }, ['good', 'bad'].filter(function (k) { return byKind[k].total; }).map(function (k) {
      const x = byKind[k], info = HG.KIND_INFO[k];
      return h('div', { class: 'bd ' + k },
        h('div', { class: 'bd-top' }, h('span', null, info.emoji + ' ' + info.short), h('b', null, fmtN(x.kept) + '/' + x.total + ' ' + info.verb)),
        h('div', { class: 'bar' }, h('i', { style: { width: Math.round(x.kept / x.total * 100) + '%' } })));
    }));
  }

  // ================================================================ onboarding (and habit editing)
  class Onboarding {
    constructor(app, opts) {
      this.app = app; this.mode = (opts && opts.mode) || 'signup';
      const blank = function () { return { sentence: '', metric: '', freqOn: false, times: 3, per: 'week' }; };
      const fresh = { email: '', invite: '', code: '', username: '', nGood: 3, nBad: 2, good: [0, 1, 2, 3, 4].map(blank), bad: [0, 1, 2, 3, 4].map(blank) };
      if (this.mode === 'edit') {
        const today = app.state.today;
        const active = app.state.me.habits.map(function (x) { return new HG.Habit(x); }).filter(function (x) { return x.activeOn(today); });
        const conv = function (x) { return { id: x.id, sentence: x.sentence, metric: x.metric, freqOn: !!x.frequency, times: x.frequency ? x.frequency.times : 3, per: x.frequency ? x.frequency.per : 'week' }; };
        ['good', 'bad'].forEach(function (kind) {
          const mine = active.filter(function (x) { return x.kind === kind; }).map(conv);
          fresh[kind === 'good' ? 'nGood' : 'nBad'] = mine.length;
          while (mine.length < HG.CONFIG.MAX_GOOD) mine.push(blank());
          fresh[kind] = mine;
        });
        this.data = fresh;
      } else {
        this.data = Object.assign(fresh, LocalStore.get(KEYS.ob, {}), { code: '' });
      }
      this.buildSteps();
      this.i = 0;
      if (opts && opts.resume) this.i = Math.max(0, this.steps.findIndex(function (s) { return s.id === opts.resume; }));
      this.touched = {};
      this.returnTo = null;
    }
    open() {
      this.el = h('div', { class: 'ob' + (this.mode === 'edit' ? ' solid' : '') });
      if (this.mode === 'edit') this.el.style.setProperty('background', 'var(--bg)');
      document.body.appendChild(this.el);
      this.render();
      return this;
    }
    close() { this.el.remove(); }
    count(kind) { return Math.max(0, Math.min(5, Number(this.data[kind === 'good' ? 'nGood' : 'nBad']) || 0)); }
    /** The habit steps depend on how many habits the player chose, so the list is rebuilt after the "plan" step. */
    buildSteps() {
      const self = this;
      this.steps = [];
      if (this.mode === 'signup') this.steps.push({ id: 'welcome' }, { id: 'email' }, { id: 'code' }, { id: 'username' });
      this.steps.push({ id: 'plan' });
      ['good', 'bad'].forEach(function (kind) { for (let k = 0; k < self.count(kind); k++) self.steps.push({ id: 'habit', kind: kind, k: k }); });
      this.steps.push({ id: 'review' });
      if (this.mode === 'signup') this.steps.push({ id: 'done' });
    }
    persist() { if (this.mode === 'signup') LocalStore.set(KEYS.ob, Object.assign({}, this.data, { code: '' })); }
    go(i) { this.i = i; this.touched = {}; this.render(); const s = this.el.querySelector('.ob-scroll'); if (s) s.scrollTop = 0; }
    habitList() {
      const d = this.data, out = [];
      const self = this;
      ['good', 'bad'].forEach(function (kind) {
        d[kind].slice(0, self.count(kind)).forEach(function (x) { out.push({ id: x.id, kind: kind, sentence: x.sentence, metric: x.metric, frequency: x.freqOn ? { times: x.times, per: x.per } : null }); });
      });
      return out;
    }
    habitCheck(kind, k) {
      const x = this.data[kind][k];
      const r = HG.Habit.validate({ sentence: x.sentence, metric: x.metric, frequency: x.freqOn ? { times: x.times, per: x.per } : null }, kind);
      if (r.ok) {
        const key = r.value.sentence.toLowerCase(), self = this;
        const dup = ['good', 'bad'].some(function (kk) { return self.data[kk].slice(0, self.count(kk)).some(function (o, j) { return !(kk === kind && j === k) && HG.Validate.text(o.sentence, 200).toLowerCase() === key; }); });
        if (dup) return { ok: false, errors: { sentence: 'You already have this habit.' } };
      }
      return r;
    }

    // ---------- step definitions
    stepWelcome() {
      const feat = function (e, t, s) { return h('div', { class: 'row', style: { 'margin-top': '14px', 'align-items': 'flex-start' } }, h('div', { style: { 'font-size': '26px', width: '38px', 'text-align': 'center' } }, e), h('div', null, h('b', null, t), h('div', { class: 'tiny' }, s))); };
      return {
        emoji: '🌿', colors: ['#bfe9d6', '#ffd9c2'], title: 'Grow one square at a time',
        lead: 'Choose a few good habits to gain and bad habits to lose (up to 5 of each), and watch your days turn green.',
        body: h('div', null, feat('🗓️', 'Your grid', 'A GitHub-style calendar of your days: green when you keep more than 2/3 of your habits.'),
          feat('🤝', 'A kind community', 'See how friends are doing and send them a little gift.'),
          feat('🧠', 'Stay awake', 'Three daily math puzzles with a podium.')),
        next: 'Start', valid: function () { return true; }
      };
    }
    stepEmail() {
      const self = this, d = this.data, invite = this.app.config && this.app.config.inviteRequired;
      const email = h('input', { class: 'input', type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false', placeholder: 'you@example.com', value: d.email });
      const hint = h('div', { class: 'hint' }, 'New here or coming back: same door.');
      email.addEventListener('input', function () { d.email = email.value; self.persist(); self.validate(); });
      email.addEventListener('blur', function () { self.touched.email = true; self.validate(); });
      const body = h('div', null, h('label', { class: 'field' }, h('span', null, 'Email'), email), hint);
      let inv = null;
      if (invite) {
        inv = h('input', { class: 'input', autocomplete: 'off', autocapitalize: 'off', placeholder: 'Ask the person who invited you', value: d.invite });
        inv.addEventListener('input', function () { d.invite = inv.value; self.persist(); self.validate(); });
        body.append(h('label', { class: 'field' }, h('span', null, 'Invite code (new players only)'), inv));
      }
      return {
        emoji: '✉️', colors: ['#cfe8ff', '#e9ddff'], title: 'What is your email?',
        lead: 'We send you a 6-digit code to sign in. No password to remember, and your email stays private.',
        body: body, focus: email, next: 'Send my code',
        valid: function () {
          const v = HG.Validate.email(d.email);
          hint.textContent = !v.ok && self.touched.email && d.email ? v.error : 'New here or coming back: same door.';
          hint.className = 'hint' + (!v.ok && self.touched.email && d.email ? ' err' : '');
          return v.ok;
        },
        action: async function () {
          const r = await self.app.api.call('auth.requestCode', { email: d.email, invite: d.invite });
          self.data.email = HG.Validate.email(d.email).value;
          if (r.demoCode) { self.data.code = r.demoCode; Toast.show('Demo mode: your code is ' + r.demoCode); }
        }
      };
    }
    stepCode() {
      const self = this, d = this.data;
      const code = h('input', { class: 'input code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*', placeholder: '••••••', value: d.code, 'aria-label': '6-digit code' });
      code.addEventListener('input', function () { code.value = code.value.replace(/\D/g, '').slice(0, 6); d.code = code.value; self.validate(); if (d.code.length === 6) self.onNext(); });
      const resend = h('button', { class: 'btn ghost small', onclick: async function () {
        resend.disabled = true;
        try { const r = await self.app.api.call('auth.requestCode', { email: d.email, invite: d.invite }); Toast.show(r.demoCode ? 'Demo code: ' + r.demoCode : 'New code sent'); if (r.demoCode) { d.code = r.demoCode; code.value = r.demoCode; self.validate(); } }
        catch (e) { Toast.show(e.message, true); }
        setTimeout(function () { resend.disabled = false; }, 30000);
      } }, 'Send a new code');
      return {
        emoji: '🔑', colors: ['#fff3d1', '#ffd9c2'], title: 'Check your inbox',
        lead: 'Type the 6-digit code we sent to ' + d.email + '. It expires in 15 minutes.',
        body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Code'), code), h('div', { class: 'row', style: { 'margin-top': '8px' } }, resend)),
        focus: code, next: 'Verify',
        valid: function () { return HG.Validate.code(d.code).ok; },
        action: async function () {
          const r = await self.app.api.call('auth.verifyCode', { email: d.email, code: d.code });
          self.app.api.setToken(r.token);
          if (r.user.status === 'active') { LocalStore.del(KEYS.ob); self.close(); await self.app.afterAuth(); return 'stop'; }
          if (r.user.username) d.username = r.user.username;
        }
      };
    }
    stepUsername() {
      const self = this, d = this.data;
      const name = h('input', { class: 'input', autocomplete: 'nickname', autocapitalize: 'words', maxlength: '20', placeholder: 'e.g. Clemens', value: d.username });
      const hint = h('div', { class: 'hint' });
      name.addEventListener('input', function () { d.username = name.value; self.touched.name = true; self.persist(); self.validate(); });
      return {
        emoji: '🪴', colors: ['#d7f3e5', '#cfe8ff'], title: 'How should we call you?',
        lead: 'This is the only thing other players see, with your colours and statistics.',
        body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Username'), name), hint),
        focus: name, next: 'Next',
        valid: function () {
          const v = HG.Validate.username(d.username);
          hint.textContent = v.ok ? 'Looks good.' : (self.touched.name && d.username ? v.error : '3 to 20 letters or numbers.');
          hint.className = 'hint' + (!v.ok && self.touched.name && d.username ? ' err' : '');
          return v.ok;
        },
        action: async function () {
          const r = await self.app.api.call('user.checkUsername', { username: d.username });
          if (!r.available) throw new Error(r.error || 'This name is taken.');
        }
      };
    }
    stepPlan() {
      const self = this, d = this.data, total = h('div', { class: 'plan-total' });
      const counter = function (kind) {
        const key = kind === 'good' ? 'nGood' : 'nBad', info = HG.KIND_INFO[kind], max = kind === 'good' ? HG.CONFIG.MAX_GOOD : HG.CONFIG.MAX_BAD;
        const val = h('b', null, String(self.count(kind)));
        const step = function (dlt) { return function () { d[key] = Math.max(0, Math.min(max, self.count(kind) + dlt)); val.textContent = String(d[key]); self.persist(); self.validate(); }; };
        return h('div', { class: 'plan-row ' + kind },
          h('div', { class: 'em', 'aria-hidden': 'true' }, info.emoji),
          h('div', { class: 'grow' }, h('b', null, info.title), h('div', { class: 'tiny' }, kind === 'good' ? 'Things you want to start doing' : 'Things you want to stop doing')),
          h('div', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': 'One less ' + info.short.toLowerCase(), onclick: step(-1) }, '−'), val, h('button', { type: 'button', 'aria-label': 'One more ' + info.short.toLowerCase(), onclick: step(1) }, '+')));
      };
      return {
        emoji: '🧺', colors: ['#d7f3e5', '#ffe2cf'], title: 'How many habits?',
        lead: 'Start small: two or three habits you really keep beat ten you forget. From 0 to 5 of each kind, at least one in total.',
        body: h('div', null, h('div', { class: 'card', style: { 'margin-top': '0' } }, counter('good'), counter('bad')), total),
        next: 'Next',
        valid: function () {
          const t = self.count('good') + self.count('bad');
          total.textContent = t ? 'Total: ' + plural(t, 'habit') + ' to track each day.' : 'Choose at least one habit.';
          total.className = 'plan-total' + (t ? '' : ' err');
          return t >= HG.CONFIG.MIN_HABITS;
        },
        action: async function () { self.buildSteps(); }
      };
    }
    stepHabit(kind, k) {
      const self = this, x = this.data[kind][k], good = kind === 'good';
      const errs = {};
      const fieldHint = function (key) { errs[key] = h('div', { class: 'hint' }); return errs[key]; };
      const sentence = h('textarea', { class: 'input', rows: '2', maxlength: '90', placeholder: good ? 'Read before bed' : 'Scroll social media in bed', 'aria-label': 'Habit' });
      sentence.value = x.sentence;
      const metric = h('input', { class: 'input', maxlength: '40', placeholder: good ? '20 pages' : '0 minutes after 23:00', value: x.metric });
      const count = h('span', null, x.sentence.length + '/90');
      sentence.addEventListener('input', function () { x.sentence = sentence.value.replace(/\n/g, ' '); count.textContent = x.sentence.length + '/90'; self.touched.sentence = true; self.persist(); self.validate(); });
      metric.addEventListener('input', function () { x.metric = metric.value; self.touched.metric = true; self.persist(); self.validate(); });

      const freqBox = h('div');
      const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!x.freqOn), 'aria-label': 'Add a frequency', onclick: function () { x.freqOn = !x.freqOn; sw.setAttribute('aria-checked', String(x.freqOn)); drawFreq(); self.persist(); self.validate(); } });
      const drawFreq = function () {
        clear(freqBox);
        if (!x.freqOn) return;
        const max = HG.FREQ_MAX[kind][x.per];
        if (x.times > max) x.times = max;
        const val = h('b', null, String(x.times));
        const step = function (dlt) { return function () { x.times = Math.max(1, Math.min(HG.FREQ_MAX[kind][x.per], x.times + dlt)); val.textContent = String(x.times); self.persist(); self.validate(); }; };
        const seg = h('div', { class: 'seg' }, HG.PERIODS.map(function (p) {
          return h('button', { type: 'button', 'aria-pressed': String(x.per === p), onclick: function () { x.per = p; drawFreq(); self.persist(); self.validate(); } }, p);
        }));
        freqBox.append(h('div', { class: 'freq' },
          h('div', { class: 'row wrap' }, h('span', { class: 'muted' }, good ? 'Target' : 'At most'),
            h('div', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': 'Less', onclick: step(-1) }, '−'), val, h('button', { type: 'button', 'aria-label': 'More', onclick: step(1) }, '+')),
            h('span', { class: 'muted' }, 'times per')),
          h('div', { style: { 'margin-top': '10px' } }, seg),
          h('div', { class: 'tiny', style: { 'margin-top': '8px' } }, good ? 'Each day counts as respected while you are on pace for this target.' : 'Each day counts as respected while your slips stay within this limit.')));
      };
      drawFreq();

      const used = {}, self2 = this;
      ['good', 'bad'].forEach(function (kk) { self2.data[kk].slice(0, self2.count(kk)).forEach(function (o) { used[o.sentence.toLowerCase()] = true; }); });
      const sugg = HG.SUGGESTIONS[kind].filter(function (s) { return !used[s.sentence.toLowerCase()]; }).slice(0, 7);
      const chips = h('div', { class: 'chips' }, sugg.map(function (s) {
        return h('button', { class: 'chip', type: 'button', onclick: function () {
          x.sentence = s.sentence; x.metric = s.metric; x.freqOn = !!s.frequency;
          if (s.frequency) { x.times = s.frequency.times; x.per = s.frequency.per; }
          self.persist(); self.render();
        } }, (good ? '🌱 ' : '🍂 ') + s.sentence);
      }));

      return {
        emoji: good ? '🌱' : '🍂', colors: good ? ['#bfe9d6', '#cfe8ff'] : ['#ffd9c2', '#f8c6e0'],
        title: HG.KIND_INFO[kind].one + ' · ' + (k + 1) + ' of ' + this.count(kind),
        lead: good ? 'Something you want to gain: a habit to start. Keep it concrete and kind.' : 'Something you want to lose: a habit to stop. Say what "respected" looks like.',
        body: h('div', null,
          h('div', { class: 'tiny', style: { 'margin-left': '4px' } }, 'Ideas'), chips,
          h('label', { class: 'field' }, h('span', null, good ? 'The habit to gain' : 'The habit to lose', count), sentence), fieldHint('sentence'),
          h('label', { class: 'field' }, h('span', null, good ? 'Success looks like' : 'Respected means'), metric), fieldHint('metric'),
          h('div', { class: 'switch-row' }, h('div', { class: 'grow' }, h('b', null, 'Add a frequency'), h('div', { class: 'tiny' }, 'Optional. Without it, the habit is daily.')), sw),
          freqBox, fieldHint('frequency')),
        focus: x.sentence ? null : sentence,
        next: this.returnTo != null ? 'Back to review' : 'Next',
        valid: function () {
          const r = self.habitCheck(kind, k);
          ['sentence', 'metric', 'frequency'].forEach(function (f) {
            const show = !r.ok && r.errors[f] && (self.touched[f] || f === 'frequency' || (f === 'sentence' && r.errors[f] === 'You already have this habit.'));
            errs[f].textContent = show ? r.errors[f] : '';
            errs[f].className = 'hint' + (show ? ' err' : '');
          });
          return r.ok;
        }
      };
    }
    stepReview() {
      const self = this, list = h('div', { class: 'review-list' });
      let idx = this.steps.findIndex(function (s) { return s.id === 'habit'; });
      const planIndex = this.steps.findIndex(function (s) { return s.id === 'plan'; });
      ['good', 'bad'].forEach(function (kind) {
        if (!self.count(kind)) return;
        list.append(h('div', { class: 'eyebrow kind-' + kind, style: { margin: '18px 0 4px' } }, HG.KIND_INFO[kind].emoji + ' ' + HG.KIND_INFO[kind].title + ' (' + self.count(kind) + ')'));
        self.data[kind].slice(0, self.count(kind)).forEach(function (x, k) {
          const stepIndex = idx + (kind === 'bad' ? self.count('good') : 0) + k;
          const fr = x.freqOn ? (kind === 'good' ? x.times + '× per ' + x.per : 'At most ' + x.times + '× per ' + x.per) : 'Every day';
          list.append(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', null, x.sentence || '(empty)'), h('div', { class: 'tiny' }, '🎯 ' + x.metric + ' · ' + fr)),
            h('button', { class: 'edit', 'aria-label': 'Edit', html: ICON.pencil, onclick: function () { self.returnTo = self.i; self.go(stepIndex); } })));
        });
      });
      const lockDate = D.format(D.add(this.app.state.today || D.localToday(), HG.CONFIG.LOCK_DAYS), 'long');
      const total = this.count('good') + this.count('bad');
      return {
        emoji: '🔒', colors: ['#e9ddff', '#d7f3e5'], title: total === 1 ? 'Your commitment' : 'Your ' + total + ' commitments',
        lead: 'Once locked in, they cannot be changed until ' + lockDate + '. That is what makes them work.',
        body: h('div', null, h('div', { class: 'card', style: { 'margin-top': '0' } }, list),
          h('button', { class: 'btn ghost small', style: { 'margin-top': '10px' }, onclick: function () { self.returnTo = null; self.go(planIndex); } }, 'Change the number of habits')),
        next: this.mode === 'edit' ? 'Save and lock 30 days' : 'Lock in for 30 days',
        valid: function () { return HG.Habit.validateSet(self.habitList()).ok; },
        action: async function () {
          if (self.mode === 'edit') {
            const me = await self.app.api.call('user.updateHabits', { habits: self.habitList() });
            self.app.state.me = me; LocalStore.set(KEYS.me, me); self.app.state.emit('me');
            self.close(); Toast.show('Saved. Locked for 30 days 🔒');
            return 'stop';
          }
          const me = await self.app.api.call('user.completeOnboarding', { username: self.data.username, habits: self.habitList() });
          self.app.state.me = me; LocalStore.set(KEYS.me, me);
          LocalStore.del(KEYS.ob);
          Confetti.burst();
        }
      };
    }
    stepDone() {
      const self = this;
      return {
        emoji: '🌻', colors: ['#fff3d1', '#bfe9d6'], title: 'Your garden is planted',
        lead: 'Your first square is waiting. Each day, fill in your check-in and watch the grid grow. Swipe left for the community, right to stay awake.',
        body: h('div', { class: 'card quote', style: { 'margin-top': '6px' } }, h('div', { class: 'tag' }, '✨ Imagine this'), h('blockquote', null, HG.PROJECT[0])),
        next: 'Enter Habit Grid', valid: function () { return true; },
        action: async function () { self.close(); await self.app.afterAuth(); return 'stop'; }
      };
    }

    render() {
      const st = this.steps[this.i], self = this;
      const def = st.id === 'welcome' ? this.stepWelcome() : st.id === 'email' ? this.stepEmail() : st.id === 'code' ? this.stepCode() :
        st.id === 'username' ? this.stepUsername() : st.id === 'plan' ? this.stepPlan() : st.id === 'habit' ? this.stepHabit(st.kind, st.k) : st.id === 'review' ? this.stepReview() : this.stepDone();
      this.cur = def;
      clear(this.el);
      this.nextBtn = h('button', { class: 'btn next', disabled: true, onclick: function () { self.onNext(); } }, def.next);
      this.errorEl = h('div', { class: 'hint err', role: 'alert' });
      const canBack = this.i > 0 && st.id !== 'done' && !(this.mode === 'signup' && st.id === 'username');
      const top = h('div', { class: 'ob-top' },
        canBack ? h('button', { class: 'icon-btn', 'aria-label': 'Back', html: ICON.back, onclick: function () { self.returnTo = null; self.go(self.i - 1); } }) : null,
        h('div', { class: 'ob-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(this.steps.length - 1), 'aria-valuenow': String(this.i) }, h('i', { style: { width: Math.round(this.i / (this.steps.length - 1) * 100) + '%' } })),
        this.mode === 'edit' ? h('button', { class: 'icon-btn', 'aria-label': 'Close', html: ICON.close, onclick: function () { self.close(); } }) : null);
      const art = h('div', { class: 'ob-art', 'aria-hidden': 'true' },
        h('div', { class: 'blob', style: { background: def.colors[0] } }), h('div', { class: 'blob b2', style: { background: def.colors[1] } }), h('div', { class: 'e' }, def.emoji));
      const scroll = h('div', { class: 'ob-scroll' }, h('div', { class: 'ob-inner' }, top, art, h('h1', null, def.title), h('p', { class: 'lead' }, def.lead), h('div', { class: 'ob-body' }, def.body), this.errorEl));
      const foot = h('div', { class: 'ob-foot' }, this.nextBtn);
      this.el.append(scroll, foot);
      this.el.querySelectorAll('input').forEach(function (inp) {
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); self.onNext(); } });
      });
      this.validate();
      if (def.focus && window.matchMedia('(pointer: fine)').matches) setTimeout(function () { def.focus.focus(); }, 50);
    }
    validate() {
      const ok = !!this.cur.valid();
      this.nextBtn.disabled = !ok || this.busy;
      this.nextBtn.className = 'btn next' + (ok ? ' green' : '');
      return ok;
    }
    async onNext() {
      if (this.busy || !this.validate()) return;
      this.busy = true;
      const label = this.nextBtn.textContent;
      this.nextBtn.disabled = true;
      clear(this.nextBtn).append(h('span', { class: 'spinner' }));
      this.errorEl.textContent = '';
      try {
        const r = this.cur.action ? await this.cur.action() : null;
        this.busy = false;
        if (r === 'stop') return;
        if (this.returnTo != null && this.steps[this.i].id === 'habit') { const t = this.returnTo; this.returnTo = null; this.go(t); return; }
        this.go(this.i + 1);
      } catch (e) {
        this.busy = false;
        this.nextBtn.textContent = label;
        if (!(e instanceof ApiError)) console.error(e);
        this.errorEl.textContent = e.message || 'Something went wrong.';
        this.validate();
      }
    }
  }

  // ================================================================ pager + bottom bar
  class Pager {
    constructor(pages) {
      const self = this;
      this.pages = pages; this.index = 1;
      this.el = h('main', { class: 'pager' });
      pages.forEach(function (p) {
        p.scroller = h('section', { class: 'page', 'aria-label': p.label });
        p.inner = h('div', { class: 'page-inner' });
        p.scroller.appendChild(p.inner);
        self.el.appendChild(p.scroller);
      });
      this.indicator = h('div', { class: 'tab-indicator', 'aria-hidden': 'true' });
      this.tabs = pages.map(function (p, i) {
        return h('button', { class: 'tab', role: 'tab', 'aria-selected': String(i === 1), onclick: function () { self.go(i, true); } }, h('span', { class: 'ic', html: p.icon }), p.label);
      });
      this.bar = h('nav', { class: 'tabbar', role: 'tablist', 'aria-label': 'Sections' }, this.indicator, this.tabs);
      this.el.addEventListener('scroll', function () { self.onScroll(); }, { passive: true });
      window.addEventListener('resize', function () { self.go(self.index, false); });
      document.addEventListener('keydown', function (e) {
        if (document.querySelector('.overlay, .sheet, .ob, .reveal') || /input|textarea/i.test((e.target || {}).tagName || '')) return;
        if (e.key === 'ArrowLeft' && self.index > 0) self.go(self.index - 1, true);
        if (e.key === 'ArrowRight' && self.index < pages.length - 1) self.go(self.index + 1, true);
      });
    }
    attach(root) {
      const self = this;
      root.append(this.el, this.bar);
      this.pages.forEach(function (p) { p.view.mount(p.inner, p.scroller); });
      requestAnimationFrame(function () { self.go(1, false); });
    }
    go(i, smooth) {
      this.index = i;
      this.el.scrollTo({ left: i * this.el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
      this.move(i); this.select(i);
    }
    onScroll() {
      const pos = this.el.scrollLeft / (this.el.clientWidth || 1);
      this.move(pos);
      const i = Math.round(pos);
      if (i !== this.index) { this.index = i; this.select(i); }
    }
    move(pos) { this.indicator.style.transform = 'translateX(' + (pos * 100) + '%)'; }
    select(i) {
      this.tabs.forEach(function (t, j) { t.setAttribute('aria-selected', String(j === i)); });
      const v = this.pages[i].view;
      if (v.onShow) v.onShow();
    }
    dot(i, on) {
      const t = this.tabs[i], d = t.querySelector('.dot');
      if (on && !d) t.appendChild(h('span', { class: 'dot', 'aria-hidden': 'true' }));
      if (!on && d) d.remove();
    }
  }

  // ================================================================ dashboard (center)
  class DashboardPage {
    constructor(app) {
      this.app = app; this.st = app.state; this.kind = 'good';
      const self = this;
      this.st.on(function (w) { if (w === 'me') self.render(); });
      window.addEventListener('resize', function () { clearTimeout(self.rt); self.rt = setTimeout(function () { self.render(); }, 150); });
    }
    mount(inner) { this.inner = inner; this.render(); }
    onShow() { if (this.st.stale('me', 60000)) this.app.refreshMe(true); }
    render() {
      const me = this.st.me;
      if (!this.inner || !me || !me.user || me.user.status !== 'active') return;
      const today = this.st.today, ev = this.st.evaluator(), s = HG.Stats.of(ev, today), self = this;
      if (!this.st.motivation || this.st.motivationFor !== s.yesterday) { this.st.motivation = HG.Motivation.pick(s.yesterday); this.st.motivationFor = s.yesterday; }
      clear(this.inner).append(
        h('header', { class: 'head' },
          h('div', null, h('div', { class: 'eyebrow' }, 'My dashboard · ' + D.format(today, 'long')),
            h('h1', { class: 'display' }, 'Welcome, ', h('em', null, me.user.username)),
            h('p', { class: 'lead' }, HG.Motivation.greeting(new Date().getHours()) + '. Here is your garden.')),
          h('button', { class: 'icon-btn', style: { 'border-radius': '50%', padding: '0', border: '0' }, 'aria-label': 'Profile and settings', onclick: function () { self.app.openProfile(); } }, avatar(me.user, 44))),
        this.quote(s), this.checkin(ev, s, today), this.tiles(s),
        h('h2', { class: 'section-title' }, 'Your grid', h('small', null, plural(s.monthGreen, 'green day') + ' in ' + D.format(today, 'month').split(' ')[0])),
        h('div', { class: 'card' },
          habitTotals(ev.activeHabits(today)),
          buildCalendar({ today: today, width: (this.inner.clientWidth || 358) - 32 - 36, statusOf: function (d) { return ev.day(d, today).status; }, countOf: function (d) { return ev.day(d, today); }, onTap: function (d) { self.app.openDay(d); } }),
          legend(ev.activeHabits(today).length)),
        h('h2', { class: 'section-title' }, 'Your habits', h('small', null, me.user.lockedUntil > today ? '🔒 until ' + D.format(me.user.lockedUntil) : 'Unlocked')),
        this.habits(ev, today),
        this.gifts(me));
    }
    quote(s) {
      const self = this, m = this.st.motivation;
      return h('div', { class: 'card quote ' + m.tone },
        h('div', { class: 'tag' }, m.tone === 'reassure' ? '🌿 A gentle reminder' : '✨ Imagine this'),
        h('blockquote', null, m.text),
        h('span', { class: 'swirl', html: ICON.swirl, 'aria-hidden': 'true' }),
        h('button', { class: 'shuffle', 'aria-label': 'Another phrase', html: ICON.shuffle, onclick: function () {
          let n = m;
          for (let i = 0; i < 6 && n.text === m.text; i++) n = HG.Motivation.pick(s.yesterday);
          self.st.motivation = n; self.render();
        } }));
    }
    checkin(ev, s, today) {
      const app = this.app, d = ev.day(today, today), y = D.add(today, -1), yDay = ev.day(y, today);
      const yesterday = yDay.status === 'gray' ? h('button', { class: 'btn outline small', style: { 'margin-top': '10px' }, onclick: function () { app.openForm(1); } }, 'Yesterday is still gray: fill it in') : null;
      if (d.status === 'gray') {
        return h('div', { class: 'card' },
          h('div', { class: 'checkin' }, h('div', { class: 'blank-square', 'aria-hidden': 'true' }, String(Number(today.slice(8)))),
            h('div', { class: 'grow' }, h('h3', null, 'Today is still a blank square'), h('p', { class: 'sub' }, 'Fill in your Google Form check-in. It takes 30 seconds.'))),
          h('button', { class: 'btn green block', style: { 'margin-top': '14px' }, onclick: function () { app.openForm(0); } }, 'Fill in today’s check-in', ic('arrow')),
          yesterday);
      }
      const green = d.status === 'green';
      return h('div', { class: 'card' },
        h('div', { class: 'checkin' }, ring(d.ratio, 64, green ? 'var(--green)' : 'var(--red)', fmtN(d.kept)),
          h('div', { class: 'grow' }, h('h3', null, green ? 'Today is a green day 🌿' : 'Today is a red day'),
            h('p', { class: 'sub' }, fmtN(d.kept) + ' of ' + d.total + ' habits kept' + (green ? '. Lovely.' : '. Tomorrow is a fresh square.'))),
          h('button', { class: 'btn ghost small', onclick: function () { app.openForm(0); } }, 'Update')),
        kindBreakdown(d.byKind),
        yesterday);
    }
    tiles(s) {
      const t = function (k, v, unit, sub) { return h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, unit ? h('small', null, unit) : null), h('div', { class: 's' }, sub)); };
      return h('div', { class: 'tiles' },
        t('🔥 Streak', String(s.streak), s.streak === 1 ? 'day' : 'days', 'green days in a row'),
        t('🏆 Best', String(s.best), s.best === 1 ? 'day' : 'days', 'longest streak'),
        t('🌿 Green rate', pct(s.greenRate), '', 'of filled-in days, 30 d'),
        t('📅 Regularity', pct(s.regularity), '', 'days filled in, 30 d'));
    }
    habits(ev, today) {
      const self = this, me = this.st.me, day = ev.day(today, today);
      const levels = (me.checkins[today] || {});
      const active = ev.activeHabits(today), countOf = function (k) { return active.filter(function (x) { return x.kind === k; }).length; };
      if (!countOf(this.kind) && countOf(this.kind === 'good' ? 'bad' : 'good')) this.kind = this.kind === 'good' ? 'bad' : 'good';
      const list = active.filter(function (x) { return x.kind === self.kind; });
      const seg = h('div', { class: 'seg kinds' }, ['good', 'bad'].map(function (k) {
        const info = HG.KIND_INFO[k];
        return h('button', { class: k, 'aria-pressed': String(self.kind === k), disabled: !countOf(k), onclick: function () { self.kind = k; self.render(); } }, info.emoji + ' ' + info.short + ' (' + countOf(k) + ')');
      }));
      return h('div', { class: 'card' }, seg,
        h('p', { class: 'tiny', style: { margin: '10px 2px 0' } }, self.kind === 'good' ? 'Good habits to gain: a day counts when you did it.' : 'Bad habits to lose: a day counts when you resisted.'),
        h('div', { style: { 'margin-top': '6px' } }, list.map(function (x) {
        const lv = levels[x.id];
        const lvPill = lv == null ? null : h('span', { class: 'pill ' + (lv === 2 ? 'green' : lv === 1 ? 'butter' : 'red') }, x.levelLabel(lv) + ' today');
        return h('div', { class: 'habit ' + x.kind }, h('div', { class: 'em', 'aria-hidden': 'true' }, x.kind === 'good' ? '🌱' : '🍂'),
          h('div', { class: 'grow' }, h('div', { class: 't' }, x.sentence),
            h('div', { class: 'm' }, h('span', { class: 'pill ' + (x.kind === 'good' ? 'gain' : 'lose') }, HG.KIND_INFO[x.kind].short), h('span', { class: 'pill' }, '🎯 ' + x.metric), h('span', { class: 'pill lav' }, x.frequencyLabel()), lvPill)));
      })));
    }
    gifts(me) {
      const g = me.gifts || { recent: [], total: 0 };
      if (!g.total) return h('div', { class: 'card' }, h('h3', null, '🎁 Kindness received'), h('p', { class: 'sub' }, 'When other players send you encouragement, their little gifts land here.'));
      return h('div', { class: 'card' }, h('h3', null, '🎁 Kindness received'), h('p', { class: 'sub' }, plural(g.total, 'gift') + ' from the community'),
        h('div', { class: 'gifts-row' }, g.recent.map(function (x) {
          const gift = HG.giftById(x.gift) || { emoji: '🎁' };
          return h('div', { class: 'gift-bubble' }, h('div', { class: 'e' }, gift.emoji), h('div', { class: 'f' }, x.from.username), x.message ? h('div', { class: 'msg' }, x.message) : h('div', { class: 'msg' }, D.format(x.createdAt.slice(0, 10))));
        })));
    }
  }

  // ================================================================ community (left)
  class CommunityPage {
    constructor(app) {
      this.app = app; this.st = app.state; this.sort = 'streak';
      const self = this;
      this.st.on(function (w) { if (w === 'community') self.render(); });
    }
    mount(inner) { this.inner = inner; this.render(); }
    onShow() { if (this.st.stale('community', 60000)) this.app.refreshCommunity(); }
    render() {
      if (!this.inner) return;
      const c = this.st.community, self = this;
      clear(this.inner).append(h('header', null, h('div', { class: 'eyebrow' }, 'Growing together'), h('h1', { class: 'display' }, 'Community'),
        h('p', { class: 'lead' }, c ? plural(c.players.length, 'player') + ' building better days. Be kind, send a gift.' : 'Loading the garden…')));
      if (!c) { for (let i = 0; i < 4; i++) this.inner.append(h('div', { class: 'skeleton' })); return; }
      const done = c.players.filter(function (p) { return p.todayStatus === 'green' || p.todayStatus === 'red'; });
      this.inner.append(h('div', { class: 'card' },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h3', null, done.length + ' of ' + c.players.length + ' filled in today'),
          h('p', { class: 'sub' }, done.filter(function (p) { return p.todayStatus === 'green'; }).length + ' green squares so far')),
          h('div', { class: 'row', style: { gap: '0' } }, done.slice(0, 5).map(function (p, i) { const a = avatar(p, 34); a.style.marginLeft = i ? '-10px' : '0'; a.style.boxShadow = '0 0 0 2px var(--surface-solid)'; return a; })))));
      const sorters = { streak: function (p) { return p.streak * 1000 + (p.best || 0); }, regularity: function (p) { return p.regularity || 0; }, kept: function (p) { return p.possible7 ? p.kept7 / p.possible7 : 0; } };
      this.inner.append(h('div', { class: 'row', style: { 'margin-top': '22px', 'justify-content': 'space-between' } },
        h('div', { class: 'section-title', style: { margin: '0 4px' } }, 'Players'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Sort players' }, [['streak', 'Streak'], ['regularity', 'Regular'], ['kept', 'Kept 7d']].map(function (o) {
          return h('button', { 'aria-pressed': String(self.sort === o[0]), onclick: function () { self.sort = o[0]; self.render(); } }, o[1]);
        }))));
      const sorted = c.players.slice().sort(function (a, b) { return sorters[self.sort](b) - sorters[self.sort](a); });
      sorted.forEach(function (p) { self.inner.append(self.card(p)); });
    }
    card(p) {
      const app = this.app;
      const strip = h('div', { class: 'strip', 'aria-hidden': 'true', style: { 'margin-top': '6px' } }, p.strip.map(function (s) { return h('i', { class: s }); }));
      const giftBtn = h('button', { class: 'gift-btn', 'aria-label': p.isYou ? 'That is you' : 'Send ' + p.username + ' a gift', disabled: p.isYou || p.giftedToday, onclick: function (e) { e.stopPropagation(); app.openGiftComposer(p); } }, p.giftedToday ? '💛' : '🎁');
      return h('div', { class: 'player' + (p.isYou ? ' you' : ''), role: 'button', tabindex: '0', onclick: function () { app.openPlayer(p.id); }, onkeydown: function (e) { if (e.key === 'Enter') app.openPlayer(p.id); } },
        avatar(p, 48),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, p.username, p.isYou ? h('span', { class: 'pill green' }, 'You') : null), strip,
          h('div', { class: 'metrics' }, h('span', null, '🔥 ', h('b', null, String(p.streak)), ' streak'), h('span', null, 'Regular ', h('b', null, pct(p.regularity))),
            h('span', null, 'Kept 7d ', h('b', null, fmtN(p.kept7) + '/' + p.possible7)), h('span', null, '🎁 ', h('b', null, String(p.gifts))))),
        giftBtn);
    }
  }

  // ================================================================ stay awake (right)
  class StayAwakePage {
    constructor(app) {
      this.app = app; this.st = app.state; this.level = 1; this.scope = 'today';
      const self = this;
      this.st.on(function (w) { if (w === 'quiz' || w === 'board') self.render(); });
    }
    mount(inner) { this.inner = inner; this.render(); }
    onShow() {
      if (this.st.stale('quiz', 60000)) this.app.refreshQuiz();
      if (this.st.stale('board' + this.level + this.scope, 60000)) this.app.refreshBoard(this.level, this.scope);
    }
    render() {
      if (!this.inner) return;
      const self = this, q = this.st.quizToday, stats = this.st.quizStats;
      clear(this.inner).append(h('header', null, h('div', { class: 'eyebrow' }, 'Daily brain teasers'), h('h1', { class: 'display' }, 'Stay awake'),
        h('p', { class: 'lead' }, 'Three puzzles a day, the same for everyone. Accuracy wins, speed breaks ties.')));
      const levels = q ? q.levels : HG.QUIZ_LEVELS.map(function (L) { return Object.assign({ status: 'loading', players: 0 }, L); });
      levels.forEach(function (L) { self.inner.append(self.levelCard(L)); });

      this.inner.append(h('div', { class: 'row', style: { 'margin-top': '26px', 'justify-content': 'space-between', 'flex-wrap': 'wrap' } },
        h('div', { class: 'section-title', style: { margin: '0 4px' } }, 'Podium'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Period' }, [['today', 'Today'], ['all', 'All time']].map(function (o) {
          return h('button', { 'aria-pressed': String(self.scope === o[0]), onclick: function () { self.scope = o[0]; self.render(); self.onShow(); } }, o[1]);
        }))));
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Level', style: { 'margin-top': '10px' } }, HG.QUIZ_LEVELS.map(function (L) {
        return h('button', { 'aria-pressed': String(self.level === L.id), onclick: function () { self.level = L.id; self.render(); self.onShow(); } }, L.emoji + ' Level ' + L.id);
      }));
      this.inner.append(seg, this.podium(this.st.boards[this.level + ':' + this.scope]));

      this.inner.append(h('h2', { class: 'section-title' }, 'Your brain stats', stats ? h('small', null, plural(stats.total, 'puzzle') + ' solved') : null));
      if (!stats) { this.inner.append(h('div', { class: 'skeleton' })); return; }
      const best = stats.levels.reduce(function (b, l) { return l.accuracy != null && (b == null || l.accuracy > b) ? l.accuracy : b; }, null);
      this.inner.append(h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'k' }, '⚡ Puzzle streak'), h('div', { class: 'v' }, String(stats.streak), h('small', null, stats.streak === 1 ? 'day' : 'days')), h('div', { class: 's' }, 'days with a puzzle')),
        h('div', { class: 'tile' }, h('div', { class: 'k' }, '🎯 Best accuracy'), h('div', { class: 'v' }, pct(best)), h('div', { class: 's' }, 'average, best level'))));
      this.inner.append(h('div', { class: 'card' }, h('h3', null, 'Accuracy and time per level'), h('p', { class: 'sub' }, 'Accuracy is what counts. Time is the tie-breaker.'),
        h('div', { style: { display: 'grid', 'grid-template-columns': 'repeat(3, 1fr)', gap: '8px', 'margin-top': '14px' } }, stats.levels.map(function (l, i) {
          const L = HG.QUIZ_LEVELS[i];
          return h('div', { class: 'mini-ring' }, ring(l.accuracy || 0, 70, ['#46ad80', '#8e7cf0', '#f2a33a'][i], l.accuracy == null ? '–' : pct(l.accuracy)),
            h('b', null, L.emoji + ' ' + L.name), h('span', { class: 'muted' }, l.attempts ? 'avg ' + HG.fmtDuration(l.avgTimeMs) + ' · best ' + HG.fmtDuration(l.bestTimeMs) : 'not played yet'));
        })),
        h('div', { class: 'tiny', style: { 'margin-top': '18px' } }, 'Last 14 days, accuracy'),
        h('div', { class: 'bars', role: 'img', 'aria-label': 'Accuracy over the last 14 days' }, stats.history.map(function (d) {
          return h('i', { class: d.accuracy == null ? 'nil' : '', title: D.format(d.date) + ': ' + (d.accuracy == null ? 'no puzzle' : pct(d.accuracy)), style: d.accuracy == null ? null : { height: Math.max(6, Math.round(d.accuracy * 100)) + '%' } });
        }))));
      this.inner.append(h('div', { class: 'card' }, h('h3', null, '🧪 Practice mode'), h('p', { class: 'sub' }, 'Fresh questions with instant feedback. Not ranked, play as much as you like.'),
        h('div', { class: 'row wrap', style: { 'margin-top': '12px' } }, HG.QUIZ_LEVELS.map(function (L) {
          return h('button', { class: 'chip', onclick: function () { self.app.startPractice(L.id); } }, L.emoji + ' ' + L.name);
        }))));
    }
    levelCard(L) {
      const app = this.app, self = this;
      const status = [];
      if (L.status === 'new') status.push('Play now', '5 questions');
      else if (L.status === 'started') status.push('Resume', 'timer running');
      else if (L.status === 'done') status.push(L.result.correct + '/' + L.result.total + ' correct', HG.fmtDuration(L.result.timeMs));
      if (L.players) status.push(plural(L.players, 'player') + ' today');
      const dots = h('span', { class: 'dots', 'aria-label': 'Difficulty ' + L.id + ' of 3' }, [1, 2, 3].map(function (n) { return h('i', { class: n <= L.id ? 'on' : '' }); }));
      return h('button', { class: 'level-card l' + L.id, disabled: L.status === 'loading', onclick: function () {
        if (L.status === 'done') { self.level = L.id; self.scope = 'today'; self.render(); self.onShow(); Toast.show('Already played today. Here is the podium.'); }
        else app.introQuiz(L);
      } },
        h('div', { class: 'e', 'aria-hidden': 'true' }, L.emoji),
        h('div', { class: 'grow' }, h('div', { class: 'n' }, L.name), h('div', { class: 'd' }, L.topic + ' · ', dots), h('div', { class: 'st' }, status.map(function (s) { return h('span', null, s); }))),
        h('div', { class: 'go', html: L.status === 'done' ? ICON.check : ICON.play, 'aria-hidden': 'true' }));
    }
    podium(board) {
      if (!board) return h('div', { class: 'skeleton', style: { height: '200px' } });
      const e = board.entries;
      if (!e.length) return h('div', { class: 'card empty' }, h('div', { class: 'e' }, '🏁'), h('p', null, board.scope === 'today' ? 'No one has played this level today. Be the first on the podium!' : 'No results yet.'));
      const spot = function (x, cls, size) {
        if (!x) return h('div', { class: 'spot ' + cls });
        return h('div', { class: 'spot ' + cls }, h('div', { class: 'crown' }, cls === 'p1' ? '👑' : ''), avatar(x, size),
          h('div', { class: 'who' }, x.username + (x.isYou ? ' (you)' : '')), h('div', { class: 'score' }, pct(x.accuracy) + ' · ' + HG.fmtDuration(x.timeMs)),
          h('div', { class: 'block' }, String(x.rank)));
      };
      const card = h('div', { class: 'card' }, h('div', { class: 'podium' }, spot(e[1], 'p2', 52), spot(e[0], 'p1', 64), spot(e[2], 'p3', 48)));
      const rest = e.slice(3, 10);
      const you = e.find(function (x) { return x.isYou; });
      if (you && you.rank > 10) rest.push(you);
      if (rest.length) card.append(h('div', { style: { 'margin-top': '14px' } }, rest.map(function (x) {
        return h('div', { class: 'rank-row' + (x.isYou ? ' you' : '') }, h('span', { class: 'r' }, String(x.rank)), avatar(x, 30),
          h('span', { class: 'grow' }, x.username + (x.isYou ? ' (you)' : '')), h('b', null, pct(x.accuracy)), h('span', { class: 'muted' }, HG.fmtDuration(x.timeMs)));
      })));
      if (board.scope === 'all') card.append(h('div', { class: 'tiny', style: { 'margin-top': '10px' } }, 'All time: average accuracy and average time over every daily puzzle.'));
      return card;
    }
  }

  // ================================================================ quiz player
  class QuizPlayer {
    constructor(app, opts) {
      this.app = app; Object.assign(this, opts);
      this.L = HG.QUIZ_LEVELS[this.level - 1];
      this.i = 0; this.answers = []; this.per = [];
      this.offset = this.serverNow ? this.serverNow - Date.now() : 0;
      if (this.mode === 'daily') {
        const draft = LocalStore.get(KEYS.quiz + this.attemptId, null);
        if (draft) { this.answers = draft.answers || []; this.per = draft.per || []; this.i = Math.min(this.answers.length, this.questions.length - 1); }
      }
    }
    open() {
      const self = this;
      this.timerEl = h('span', { class: 'timer', 'aria-live': 'off' }, '0 s');
      this.content = h('div', { class: 'content' });
      this.el = h('div', { class: 'overlay', role: 'dialog', 'aria-label': this.L.name },
        h('div', { class: 'bar' }, h('button', { class: 'icon-btn', 'aria-label': 'Close', html: ICON.close, onclick: function () { self.tryClose(); } }),
          h('div', { class: 'grow' }, h('b', null, this.L.emoji + ' ' + this.L.name), h('div', { class: 'tiny' }, this.mode === 'daily' ? 'Daily puzzle · one try' : 'Practice · not ranked')),
          this.timerEl),
        this.content);
      document.body.appendChild(this.el);
      this.tick = setInterval(function () { self.updateTimer(); }, 250);
      this.updateTimer();
      this.question();
    }
    elapsed() { return Date.now() + this.offset - this.startedAt; }
    updateTimer() { if (!this.finished) this.timerEl.textContent = HG.fmtDuration(this.elapsed()); }
    async tryClose() {
      if (this.finished || this.mode === 'practice') return this.close();
      const ok = await Sheet.confirm('Leave the puzzle?', 'The timer keeps running on the server. Your answers so far are kept on this phone.', 'Leave', 'outline');
      if (ok) this.close();
    }
    close() { clearInterval(this.tick); this.el.remove(); this.app.refreshQuiz(); }
    question() {
      const self = this, q = this.questions[this.i], start = Date.now();
      this.locked = false;
      const opts = q.choices.map(function (c, k) {
        return h('button', { class: 'option', onclick: function () { self.pick(k, b, opts, start); } }, h('span', { class: 'L' }, 'ABCD'[k]), h('span', { class: 'grow' }, c));
      });
      const b = h('div', null);
      clear(this.content).append(
        h('div', { class: 'progress-seg', 'aria-hidden': 'true' }, this.questions.map(function (x, j) { return h('i', { class: j < self.i ? 'done' : j === self.i ? 'now' : '' }); })),
        h('div', { class: 'tiny' }, 'Question ' + (this.i + 1) + ' of ' + this.questions.length),
        h('div', { class: 'q-prompt' }, q.prompt),
        h('div', { role: 'group', 'aria-label': 'Answers' }, opts), b);
      this.content.scrollTop = 0;
    }
    pick(k, below, opts, start) {
      if (this.locked) return;
      this.locked = true;
      const self = this, q = this.questions[this.i];
      this.answers[this.i] = k; this.per[this.i] = Date.now() - start;
      if (this.mode === 'daily') {
        opts[k].classList.add('picked');
        LocalStore.set(KEYS.quiz + this.attemptId, { answers: this.answers, per: this.per });
        setTimeout(function () { self.advance(); }, 320);
        return;
      }
      const right = k === q.answer;
      opts[q.answer].classList.add('right');
      if (!right) opts[k].classList.add('wrong');
      below.append(h('div', { class: 'skill' }, h('b', null, right ? '✨ Nice. The skill' : '💡 The skill'), q.skill, h('div', { class: 'tiny', style: { 'margin-top': '6px' } }, q.explanation)),
        h('button', { class: 'btn lav block', style: { 'margin-top': '14px' }, onclick: function () { self.advance(); } }, this.i < this.questions.length - 1 ? 'Next question' : 'See my score'));
    }
    advance() { if (this.i < this.questions.length - 1) { this.i++; this.question(); } else this.finish(); }
    async finish() {
      this.finished = true;
      clearInterval(this.tick);
      if (this.mode === 'practice') {
        const g = HG.QuizGenerator.grade(this.questions, this.answers);
        return this.results(Object.assign(g, { timeMs: this.elapsed() }));
      }
      clear(this.content).append(h('div', { class: 'empty' }, h('div', { class: 'e' }, '🧮'), h('p', null, 'Grading your answers…')));
      try {
        const r = await this.app.api.call('quiz.submit', { attemptId: this.attemptId, answers: this.answers, perQuestionMs: this.per });
        LocalStore.del(KEYS.quiz + this.attemptId);
        this.timerEl.textContent = HG.fmtDuration(r.timeMs);
        this.results(r);
        this.app.refreshQuiz(); this.app.refreshBoard(this.level, 'today'); this.app.refreshBoard(this.level, 'all');
      } catch (e) {
        this.finished = false;
        clear(this.content).append(h('div', { class: 'empty' }, h('p', null, e.message), h('button', { class: 'btn lav', onclick: () => this.finish() }, 'Try again')));
      }
    }
    results(r) {
      const self = this, perfect = r.correct === r.total;
      if (perfect || (r.rank && r.rank <= 3)) setTimeout(function () { Confetti.burst(); }, 250);
      const head = h('div', { style: { 'text-align': 'center', padding: '10px 0 6px' } },
        h('div', { style: { display: 'grid', 'place-items': 'center' } }, ring(r.accuracy, 132, r.accuracy >= 0.8 ? 'var(--green)' : r.accuracy >= 0.6 ? '#f2a33a' : 'var(--red)', r.correct + '/' + r.total)),
        h('h2', { style: { 'font-family': 'var(--font-display)', 'font-size': '28px', margin: '14px 0 4px' } }, perfect ? 'Flawless!' : r.accuracy >= 0.6 ? 'Well played' : 'Good effort'),
        h('p', { class: 'muted', style: { margin: '0' } }, pct(r.accuracy) + ' accuracy · ' + HG.fmtDuration(r.timeMs) + (r.rank ? ' · #' + r.rank + ' of ' + r.players + ' today' : '')));
      const review = r.review.map(function (x, j) {
        const ok = x.correct;
        return h('div', { class: 'review' }, h('div', { class: 'p' }, (ok ? '✅ ' : '❌ ') + (j + 1) + '. ' + x.prompt),
          h('div', { class: 'a' }, x.chosen == null ? h('span', { class: 'pill' }, 'No answer') : h('span', { class: 'pill ' + (ok ? 'green' : 'red') }, 'You: ' + x.choices[x.chosen]),
            ok ? null : h('span', { class: 'pill green' }, 'Answer: ' + x.choices[x.answer])),
          h('div', { class: 'skill' }, h('b', null, '💡 Skill'), x.skill, h('div', { class: 'tiny', style: { 'margin-top': '6px' } }, x.explanation)));
      });
      add(clear(this.content), [head, h('h3', { style: { margin: '18px 0 0' } }, 'What each question trains'), review,
        h('div', { class: 'stack', style: { 'margin-top': '18px' } },
          this.mode === 'daily' ? h('button', { class: 'btn lav block', onclick: function () { self.close(); self.app.showPodium(self.level); } }, 'See the podium 🏆') : h('button', { class: 'btn lav block', onclick: function () { self.close(); self.app.startPractice(self.level); } }, 'Practice again'),
          h('button', { class: 'btn ghost block', onclick: function () { self.close(); } }, 'Done'))]);
      this.content.scrollTop = 0;
    }
  }

  // ================================================================ gift reveal
  class GiftReveal {
    constructor(app, gifts, done) { this.app = app; this.gifts = gifts; this.i = 0; this.done = done; }
    open() { this.el = h('div', { class: 'reveal', role: 'dialog', 'aria-label': 'You received a gift' }); document.body.appendChild(this.el); this.show(); }
    show() {
      const self = this, g = this.gifts[this.i], gift = HG.giftById(g.gift) || { emoji: '🎁', name: 'Gift' }, el = this.el;
      clear(el); el.classList.remove('open');
      const txt = h('div', { class: 'txt' }, h('h3', null, g.from.username + ' sent you something'), h('p', null, 'Tap the box to open it'));
      const box = h('button', { class: 'box', 'aria-label': 'Open the gift' }, h('div', { class: 'lid' }), h('div', { class: 'body' }), h('div', { class: 'ribbon' }), h('div', { class: 'bow' }, '🎀'));
      box.addEventListener('click', function () {
        if (el.classList.contains('open')) return;
        el.classList.add('open');
        Confetti.burst({ y: innerHeight * 0.38 });
        clear(txt).append(h('h3', null, 'A ' + gift.name.toLowerCase() + ' from ' + g.from.username), g.message ? h('p', null, '“' + g.message + '”') : h('p', null, 'Keep going, they are cheering for you.'),
          h('button', { class: 'btn green', style: { 'margin-top': '20px' }, onclick: function () { self.next(); } }, self.i < self.gifts.length - 1 ? 'Next gift' : 'Thank you 💛'));
      });
      el.append(box, h('div', { class: 'prize', 'aria-hidden': 'true' }, gift.emoji), txt);
    }
    next() {
      this.i++;
      if (this.i < this.gifts.length) return this.show();
      this.el.remove();
      const app = this.app;
      app.api.call('gifts.markSeen', { ids: this.gifts.map(function (g) { return g.id; }) }).then(function () { return app.state.loadMe(); }).catch(function () {}).then(this.done);
    }
  }

  // ================================================================ application
  class App {
    constructor() {
      this.api = DEMO ? new DemoApi() : new RemoteApi(CFG.API_URL);
      this.state = new AppState(this.api);
      this.root = document.getElementById('app');
      this.lastRefresh = 0;
    }
    async boot() {
      clear(this.root);
      document.body.prepend(h('div', { class: 'bg-art', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
      if (DEMO) document.body.appendChild(h('div', { class: 'demo-ribbon' }, 'Demo · made-up players'));
      if (!this.api.token) return this.startOnboarding();
      const cached = this.state.me;
      if (cached && cached.user && cached.user.status === 'active') this.enterMain();
      try { await this.state.loadMe(); }
      catch (e) {
        if (e.code === 'auth') return this.signOut(true);
        if (!cached) { this.root.append(h('div', { class: 'empty', style: { 'padding-top': '30vh' } }, h('div', { class: 'e' }, '🌧️'), h('p', null, e.message), h('button', { class: 'btn green', onclick: function () { location.reload(); } }, 'Try again'))); return; }
        Toast.show(e.message, true);
        return;
      }
      if (this.state.me.user.status !== 'active') return this.startOnboarding('username');
      await this.afterAuth();
    }
    async startOnboarding(resume) {
      try { this.config = await this.api.call('config'); } catch (e) { this.config = { inviteRequired: false }; }
      new Onboarding(this, { mode: 'signup', resume: resume }).open();
    }
    async afterAuth() {
      if (!this.state.me || this.state.me.user.status !== 'active') await this.state.loadMe();
      if (!this.pager) this.enterMain();
      this.state.emit('me');
      this.refreshCommunity(); this.refreshQuiz(); this.refreshBoard(1, 'today');
      this.checkGifts();
      this.lastRefresh = Date.now();
      if (!this.visBound) {
        this.visBound = true;
        const self = this;
        document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() - self.lastRefresh > 4000) self.refreshAll(); });
      }
    }
    enterMain() {
      if (this.pager) return;
      this.dashboard = new DashboardPage(this); this.community = new CommunityPage(this); this.awake = new StayAwakePage(this);
      this.pager = new Pager([
        { label: 'Community', icon: ICON.community, view: this.community },
        { label: 'Dashboard', icon: ICON.grid, view: this.dashboard },
        { label: 'Stay awake', icon: ICON.bulb, view: this.awake }
      ]);
      this.pager.attach(this.root);
      const self = this;
      this.state.on(function (w) {
        if (w === 'quiz' && self.state.quizToday) self.pager.dot(2, self.state.quizToday.levels.some(function (l) { return l.status !== 'done'; }));
      });
    }
    async refreshAll() {
      this.lastRefresh = Date.now();
      await this.refreshMe(true);
      this.refreshCommunity(); this.refreshQuiz();
      this.checkGifts();
    }
    async refreshMe(silent) {
      const before = this.state.me, today = this.state.today;
      const was = before && before.habits ? this.state.evaluator().day(today, today).status : null;
      try { await this.state.loadMe(); }
      catch (e) { if (e.code === 'auth') return this.signOut(true); if (!silent) Toast.show(e.message, true); return; }
      const now = this.state.evaluator().day(today, today).status;
      if (was === 'gray' && (now === 'green' || now === 'red')) this.celebrate(today, now);
    }
    celebrate(date, status) {
      const cell = document.querySelector('.day[data-date="' + date + '"]');
      if (cell) { cell.classList.add('pop'); const r = cell.getBoundingClientRect(); if (status === 'green') Confetti.burst({ x: r.left + r.width / 2, y: r.top }); }
      else if (status === 'green') Confetti.burst();
      Toast.show(status === 'green' ? 'A new green square 🌿' : 'Logged. Tomorrow is a fresh square.');
    }
    refreshCommunity() { const self = this; return this.state.loadCommunity().catch(function (e) { if (e.code === 'auth') self.signOut(true); }); }
    refreshQuiz() { return this.state.loadQuiz().catch(function () {}); }
    refreshBoard(level, scope) { return this.state.loadBoard(level, scope).catch(function () {}); }
    checkGifts() {
      const me = this.state.me, self = this;
      if (this.revealing || !me || !me.gifts || !me.gifts.unseen.length) return;
      this.revealing = true;
      setTimeout(function () { new GiftReveal(self, me.gifts.unseen, function () { self.revealing = false; }).open(); }, 700);
    }
    openForm(offset) {
      const me = this.state.me;
      if (DEMO) return this.openDemoForm(offset);
      const key = ['today', 'yesterday', 'before'][offset];
      if (!me.form || !me.form.links || !me.form.links[key]) return Toast.show('Your form is not ready yet. Try again in a minute.', true);
      window.open(me.form.links[key], '_blank', 'noopener');
      Toast.show('Opening your Google Form. Come back here when it is sent.');
    }
    openDemoForm(offset) {
      const self = this, today = this.state.today, date = D.add(today, -offset);
      const habits = this.state.evaluator().activeHabits(date), levels = {};
      const s = new Sheet('Daily check-in');
      const send = h('button', { class: 'btn block', disabled: true, style: { 'margin-top': '18px' }, onclick: async function () {
        send.disabled = true;
        try { await self.api.submitForm(offset, levels); s.close(); await self.refreshMe(true); self.lastRefresh = Date.now(); }
        catch (e) { Toast.show(e.message, true); send.disabled = false; }
      } }, 'Submit');
      const check = function () { const ok = habits.every(function (x) { return levels[x.id] != null; }); send.disabled = !ok; send.className = 'btn block' + (ok ? ' green' : ''); };
      add(s.body, [h('p', { class: 'tiny', style: { margin: '0 0 12px' } }, 'Demo stand-in for your personal Google Form. In the real app this button opens the form in Safari, pre-filled with the day and your private key.'),
        h('div', { class: 'pill lav' }, D.format(date, 'long')),
        habits.map(function (x, idx) {
          const header = idx === 0 || habits[idx - 1].kind !== x.kind ? h('div', { class: 'eyebrow kind-' + x.kind, style: { margin: '20px 0 0' } }, HG.KIND_INFO[x.kind].emoji + ' ' + HG.KIND_INFO[x.kind].title) : null;
          const btns = [2, 1, 0].map(function (lv, i) {
            return h('button', { class: 'chip', 'aria-pressed': 'false', onclick: function () {
              levels[x.id] = lv; btns.forEach(function (b, j) { b.setAttribute('aria-pressed', String(i === j)); }); check();
            } }, HG.FORM_CHOICES[i]);
          });
          return h('div', null, header, h('div', { style: { 'margin-top': '12px' } }, h('b', null, x.sentence), h('div', { class: 'tiny' }, 'Respected means: ' + x.metric), h('div', { class: 'row wrap', style: { 'margin-top': '8px', gap: '6px' } }, btns)));
        }), send]);
      s.open();
    }
    openDay(date) {
      const self = this, today = this.state.today, ev = this.state.evaluator(), d = ev.day(date, today);
      const s = new Sheet(D.format(date, 'long'));
      const offset = D.diff(date, today);
      const words = { green: ['green', 'Green day 🌿'], red: ['red', 'Red day'], gray: ['', 'Not filled in yet'], none: ['', 'Before you started'] }[d.status] || ['', ''];
      s.body.append(h('span', { class: 'pill ' + words[0] }, words[1]));
      if (d.details) {
        s.body.append(h('div', { style: { margin: '14px 0 4px' } }, h('b', null, fmtN(d.kept) + ' of ' + d.total + ' habits kept'), h('span', { class: 'muted' }, ' (' + pct(d.ratio) + ', green above 67%)')),
          kindBreakdown(d.byKind),
          h('div', { class: 'card', style: { 'margin-top': '10px' } }, d.details.map(function (x, idx) {
            const lv = x.level, k = x.habit.kind, sub = d.byKind[k];
            const header = idx === 0 || d.details[idx - 1].habit.kind !== k ? h('div', { class: 'eyebrow kind-' + k, style: { margin: idx ? '16px 0 2px' : '0 0 2px' } }, HG.KIND_INFO[k].emoji + ' ' + HG.KIND_INFO[k].title + ' · ' + fmtN(sub.kept) + '/' + sub.total) : null;
            return h('div', null, header, h('div', { class: 'habit ' + k }, h('div', { class: 'em' }, HG.KIND_INFO[k].emoji),
              h('div', { class: 'grow' }, h('div', { class: 't' }, x.habit.sentence),
                h('div', { class: 'm' }, h('span', { class: 'pill ' + (lv === 2 ? 'green' : lv === 1 ? 'butter' : lv === 0 ? 'red' : '') }, lv == null ? 'No answer' : x.habit.levelLabel(lv)),
                  h('span', { class: 'pill' }, 'Counts ' + fmtN(x.score)), x.note ? h('span', { class: 'tiny' }, x.note) : null))));
          })));
      }
      if (offset >= 0 && offset <= HG.CONFIG.EDIT_WINDOW_DAYS && d.status !== 'none') {
        s.body.append(h('button', { class: 'btn green block', style: { 'margin-top': '16px' }, onclick: function () { s.close(); self.openForm(offset); } }, d.status === 'gray' ? 'Fill in this day' : 'Update this day'));
      } else if (d.status === 'gray') {
        s.body.append(h('p', { class: 'tiny', style: { 'margin-top': '14px' } }, 'Only today and the 2 previous days can be filled in. Older days stay as they are.'));
      }
      s.open();
    }
    async openPlayer(id) {
      const self = this, s = new Sheet('Player').open();
      s.body.append(h('div', { class: 'skeleton' }), h('div', { class: 'skeleton', style: { height: '160px' } }));
      let p;
      try { p = await this.api.call('community.player', { id: id }); } catch (e) { s.close(); return Toast.show(e.message, true); }
      s.setTitle(p.username);
      const start = D.add(p.today, -83);
      const statusOf = function (d) { return d < start ? 'none' : d > p.today ? 'future' : p.grid[D.diff(start, d)]; };
      const t = function (k, v, sub) { return h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), h('div', { class: 's' }, sub)); };
      add(clear(s.body), [
        h('div', { class: 'row' }, avatar(p, 64), h('div', null, h('b', { style: { 'font-size': '18px' } }, p.username + (p.isYou ? ' (you)' : '')), h('div', { class: 'tiny' }, 'Growing since ' + D.format(p.joinedAt, 'long')))),
        h('div', { class: 'tiles' }, t('🔥 Streak', String(p.streak), 'best ' + p.best), t('📅 Regularity', pct(p.regularity), 'last 30 days'),
          t('🌿 Green rate', pct(p.greenRate), 'of filled-in days'), t('✅ Kept 7 days', fmtN(p.kept7) + '/' + p.possible7, 'habits respected')),
        h('div', { class: 'card' }, h('h3', null, 'Last 12 weeks'), buildCalendar({ today: p.today, weeks: 12, width: Math.min(560, innerWidth) - 36 - 36, statusOf: statusOf }), legend()),
        h('p', { class: 'tiny', style: { margin: '12px 4px 0' } }, 'Only colours and numbers are shared. Habits and answers stay private.'),
        p.isYou ? null : p.giftedToday ? h('div', { class: 'card empty' }, '💛 You already sent ' + p.username + ' a gift today.') :
          h('button', { class: 'btn lav block', style: { 'margin-top': '16px' }, onclick: function () { s.close(); self.openGiftComposer(p); } }, 'Send encouragement 🎁')]);
    }
    openGiftComposer(p) {
      const self = this, s = new Sheet('Encourage ' + p.username);
      let chosen = null;
      const msg = h('textarea', { class: 'input', rows: '2', maxlength: String(HG.CONFIG.MESSAGE_MAX), placeholder: 'A kind word (optional)' });
      const count = h('span', null, '0/' + HG.CONFIG.MESSAGE_MAX);
      msg.addEventListener('input', function () { count.textContent = msg.value.length + '/' + HG.CONFIG.MESSAGE_MAX; });
      const send = h('button', { class: 'btn block', disabled: true, style: { 'margin-top': '18px' }, onclick: async function () {
        send.disabled = true; clear(send).append(h('span', { class: 'spinner' }));
        try {
          await self.api.call('gifts.send', { toId: p.id, gift: chosen.id, message: msg.value });
          s.close(); Confetti.burst({ count: 70 }); Toast.show('Your ' + chosen.emoji + ' is on its way to ' + p.username);
          self.refreshCommunity();
        } catch (e) { Toast.show(e.message, true); send.textContent = 'Send'; send.disabled = false; }
      } }, 'Send');
      const opts = HG.GIFTS.map(function (g) {
        const b = h('button', { class: 'gift-opt', 'aria-pressed': 'false', onclick: function () {
          chosen = g; opts.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
          send.disabled = false; send.className = 'btn block green'; send.textContent = 'Send the ' + g.name.toLowerCase() + ' ' + g.emoji;
        } }, h('span', { class: 'e' }, g.emoji), g.name);
        return b;
      });
      s.body.append(h('p', { class: 'muted', style: { margin: '0 0 12px' } }, 'Pick a little gift. It pops up on ' + p.username + '’s phone next time they open the app.'),
        h('div', { class: 'gift-grid' }, opts),
        h('div', { class: 'chips', style: { margin: '14px -18px 0', padding: '4px 18px' } }, HG.GIFT_MESSAGES.map(function (m) { return h('button', { class: 'chip', onclick: function () { msg.value = m; count.textContent = m.length + '/' + HG.CONFIG.MESSAGE_MAX; } }, m); })),
        h('label', { class: 'field' }, h('span', null, 'Message', count), msg), send);
      s.open();
    }
    async introQuiz(L) {
      const self = this;
      if (L.status === 'started') return this.startQuiz(L.id);
      const ok = await Sheet.confirm(L.emoji + ' ' + L.name, '5 multiple-choice questions on ' + L.topic.toLowerCase() + '. One try per day, the timer starts now and runs on the server. Accuracy decides the podium, time breaks ties. After the last answer you see the skill behind each question.', 'Start the timer', 'lav');
      if (ok) self.startQuiz(L.id);
    }
    async startQuiz(level) {
      try {
        const s = await this.api.call('quiz.start', { level: level });
        new QuizPlayer(this, { mode: 'daily', level: level, attemptId: s.attemptId, questions: s.questions, startedAt: s.startedAt, serverNow: s.serverNow }).open();
      } catch (e) { Toast.show(e.message, true); this.refreshQuiz(); }
    }
    startPractice(level) {
      const qs = HG.QuizGenerator.generate(level, 'practice|' + Date.now() + '|' + Math.random(), HG.CONFIG.QUIZ_QUESTIONS);
      new QuizPlayer(this, { mode: 'practice', level: level, questions: qs, startedAt: Date.now() }).open();
    }
    showPodium(level) {
      this.awake.level = level; this.awake.scope = 'today'; this.awake.render(); this.pager.go(2, true);
      this.refreshBoard(level, 'today');
    }
    openProfile() {
      const self = this, me = this.state.me, today = this.state.today, s = new Sheet('Profile');
      const locked = me.user.lockedUntil > today;
      const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(me.user.emailOptIn), 'aria-label': 'Daily email', onclick: async function () {
        const v = sw.getAttribute('aria-checked') !== 'true';
        sw.setAttribute('aria-checked', String(v));
        try { await self.api.call('user.updatePrefs', { emailOptIn: v }); await self.state.loadMe(); Toast.show(v ? 'Daily email on' : 'Daily email off'); }
        catch (e) { sw.setAttribute('aria-checked', String(!v)); Toast.show(e.message, true); }
      } });
      const extra = h('input', { class: 'input', type: 'text', inputmode: 'email', autocapitalize: 'off', placeholder: 'work@example.com, other@example.com', value: (me.user.extraEmails || []).join(', ') });
      s.body.append(
        h('div', { class: 'row' }, avatar(me.user, 60), h('div', null, h('b', { style: { 'font-size': '18px' } }, me.user.username), h('div', { class: 'tiny' }, me.user.email), h('div', { class: 'tiny' }, 'Growing since ' + D.format(me.user.joinedAt, 'long')))),
        h('div', { class: 'switch-row' }, h('div', { class: 'grow' }, h('b', null, 'Daily email'), h('div', { class: 'tiny' }, 'Motivation, your last squares and one-tap links to your form.')), sw),
        h('label', { class: 'field' }, h('span', null, 'Extra inboxes for the daily email (up to 3)'), extra),
        h('button', { class: 'btn outline small', style: { 'margin-top': '8px' }, onclick: async function () {
          try { await self.api.call('user.updatePrefs', { extraEmails: extra.value.split(/[,;\s]+/) }); await self.state.loadMe(); Toast.show('Inboxes saved'); }
          catch (e) { Toast.show(e.message, true); }
        } }, 'Save inboxes'),
        h('div', { class: 'card' }, h('h3', null, locked ? '🔒 Habits locked' : '🔓 Habits unlocked'),
          h('p', { class: 'sub' }, locked ? 'You committed until ' + D.format(me.user.lockedUntil, 'long') + '. ' + plural(D.diff(today, me.user.lockedUntil), 'day') + ' to go.' : 'Your 30 days are done. Keep them, or change them and lock for 30 more days.'),
          h('button', { class: 'btn block ' + (locked ? '' : 'green'), disabled: locked, style: { 'margin-top': '12px' }, onclick: function () { s.close(); new Onboarding(self, { mode: 'edit' }).open(); } }, locked ? 'Edit available on ' + D.format(me.user.lockedUntil) : 'Edit my habits')),
        h('p', { class: 'tiny', style: { margin: '16px 4px 0' } }, DEMO ? 'Demo mode: everything stays in this browser.' : 'Your data lives in a private Google Sheet. Other players only see your username, colours and statistics.'),
        h('div', { class: 'stack', style: { 'margin-top': '14px' } },
          DEMO ? h('button', { class: 'btn outline block', onclick: function () { self.api.reset(); LocalStore.del(KEYS.token); LocalStore.del(KEYS.me); LocalStore.del(KEYS.ob); location.reload(); } }, 'Reset the demo') : null,
          h('button', { class: 'btn ghost block danger', onclick: function () { self.signOut(false); } }, 'Sign out')));
      s.open();
    }
    async signOut(expired) {
      if (!expired) { try { await this.api.call('auth.logout'); } catch (e) { /* already gone */ } }
      this.api.setToken(null);
      LocalStore.del(KEYS.me);
      location.reload();
    }
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  window.habitGridApp = new App();
  window.habitGridApp.boot();
})();
