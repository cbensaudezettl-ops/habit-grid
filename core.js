/*
 * Habit Grid core. Shared, unchanged, by the iPhone app, the in-browser demo
 * and the Apps Script backend, so the rules are identical everywhere.
 * Pure logic: no DOM, no network, no Google APIs. Dates are 'YYYY-MM-DD'.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONFIG = Object.freeze({
    APP_NAME: 'Habit Grid',
    LOCK_DAYS: 30,
    EDIT_WINDOW_DAYS: 2,       // today and the 2 previous days can be logged
    GOOD_COUNT: 5,
    BAD_COUNT: 5,
    GREEN_THRESHOLD: 2 / 3,    // strictly more than 2/3 of habits kept = green day
    QUIZ_QUESTIONS: 5,
    GIFTS_PER_DAY: 10,
    MESSAGE_MAX: 140,
    HISTORY_DAYS: 400
  });

  // ------------------------------------------------------------------ dates
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  class DateUtil {
    static pad(n) { return (n < 10 ? '0' : '') + n; }
    static iso(d) { return d.getUTCFullYear() + '-' + DateUtil.pad(d.getUTCMonth() + 1) + '-' + DateUtil.pad(d.getUTCDate()); }
    static parse(s) { const p = String(s).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
    static isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && DateUtil.iso(DateUtil.parse(s)) === s; }
    static add(s, n) { const d = DateUtil.parse(s); d.setUTCDate(d.getUTCDate() + n); return DateUtil.iso(d); }
    static diff(a, b) { return Math.round((DateUtil.parse(b) - DateUtil.parse(a)) / 86400000); }
    static weekday(s) { return (DateUtil.parse(s).getUTCDay() + 6) % 7; }
    static weekStart(s) { return DateUtil.add(s, -DateUtil.weekday(s)); }
    static monthStart(s) { return s.slice(0, 8) + '01'; }
    static daysInMonth(s) { const d = DateUtil.parse(s); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); }
    static localToday(now) {
      now = now || new Date();
      return now.getFullYear() + '-' + DateUtil.pad(now.getMonth() + 1) + '-' + DateUtil.pad(now.getDate());
    }
    static format(s, style) {
      const d = DateUtil.parse(s), day = d.getUTCDate(), m = MONTHS[d.getUTCMonth()], wd = WEEKDAYS[DateUtil.weekday(s)];
      if (style === 'long') return wd + ' ' + day + ' ' + m;
      if (style === 'weekday') return wd.slice(0, 3) + ' ' + day + ' ' + m.slice(0, 3);
      if (style === 'month') return m + ' ' + d.getUTCFullYear();
      return day + ' ' + m.slice(0, 3);
    }
    static monthShort(s) { return MONTHS[DateUtil.parse(s).getUTCMonth()].slice(0, 3); }
  }

  // ------------------------------------------------------------------ seeded random
  class Rng {
    constructor(seed) {
      this.state = typeof seed === 'number' ? seed >>> 0 : Rng.hash(String(seed));
      if (!this.state) this.state = 0x9e3779b9;
    }
    static hash(str) {
      let h = 1779033703 ^ str.length;
      for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^ (h >>> 16)) >>> 0;
    }
    next() {
      this.state = (this.state + 0x6D2B79F5) >>> 0;
      let t = this.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
    nonZero(a, b) { let v; do { v = this.int(a, b); } while (v === 0); return v; }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    sign() { return this.next() < 0.5 ? -1 : 1; }
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
  }

  // ------------------------------------------------------------------ validation
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const USERNAME_RE = /^[\p{L}\p{N}_.\-]{3,20}$/u;

  class Validate {
    static email(v) {
      const e = String(v == null ? '' : v).trim().toLowerCase();
      return e.length <= 120 && EMAIL_RE.test(e) ? { ok: true, value: e } : { ok: false, error: 'Enter a valid email address.' };
    }
    static username(v) {
      const u = String(v == null ? '' : v).trim();
      if (u.length < 3) return { ok: false, error: 'At least 3 characters.' };
      if (u.length > 20) return { ok: false, error: 'At most 20 characters.' };
      if (!USERNAME_RE.test(u)) return { ok: false, error: 'Letters, numbers, dot, dash and underscore only.' };
      return { ok: true, value: u };
    }
    static code(v) {
      const c = String(v == null ? '' : v).replace(/\D/g, '');
      return c.length === 6 ? { ok: true, value: c } : { ok: false, error: 'Enter the 6-digit code.' };
    }
    static text(v, max) {
      return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    }
  }

  // ------------------------------------------------------------------ habits
  const KINDS = ['good', 'bad'];
  const PERIODS = ['day', 'week', 'month'];
  const FREQ_MAX = { good: { day: 20, week: 7, month: 31 }, bad: { day: 20, week: 6, month: 30 } };
  const LEVEL_LABELS = { good: ['Not done', 'Partly', 'Done'], bad: ['Slipped', 'Partly', 'Resisted'] };
  const FORM_CHOICES = ['✅ Respected', '🌗 Partly', '❌ Not respected']; // levels 2, 1, 0
  const FORM_DAYS = ['Today', 'Yesterday', 'The day before yesterday'];  // offsets 0, 1, 2

  class Habit {
    constructor(o) {
      o = o || {};
      this.id = o.id || null;
      this.kind = o.kind;
      this.sentence = o.sentence || '';
      this.metric = o.metric || '';
      this.frequency = o.frequency ? { times: Number(o.frequency.times), per: o.frequency.per } : null;
      this.createdAt = o.createdAt || null;
      this.archivedAt = o.archivedAt || null;
    }
    activeOn(date) { return (!this.createdAt || this.createdAt <= date) && (!this.archivedAt || date < this.archivedAt); }
    isPeriodic() { return !!this.frequency && this.frequency.per !== 'day'; }
    frequencyLabel() {
      if (!this.frequency) return 'Every day';
      const f = this.frequency;
      return (this.kind === 'good' ? '' : 'At most ') + f.times + '× per ' + f.per;
    }
    levelLabel(level) { return LEVEL_LABELS[this.kind][level]; }
    sameContent(o) {
      const a = this.frequency, b = o.frequency;
      return this.kind === o.kind && this.sentence === o.sentence && this.metric === o.metric &&
        (!a && !b || !!a && !!b && a.times === b.times && a.per === b.per);
    }
    toJSON() {
      return { id: this.id, kind: this.kind, sentence: this.sentence, metric: this.metric, frequency: this.frequency, createdAt: this.createdAt, archivedAt: this.archivedAt };
    }

    /** Validates raw input. Returns { ok, errors, value } where errors is keyed by field. */
    static validate(input, kind) {
      input = input || {};
      const errors = {};
      kind = kind || input.kind;
      if (KINDS.indexOf(kind) < 0) errors.kind = 'Choose good or bad.';
      const sentence = Validate.text(input.sentence, 200), metric = Validate.text(input.metric, 100);
      if (sentence.length < 3) errors.sentence = 'Describe the habit in a few words.';
      else if (sentence.length > 90) errors.sentence = 'Keep it under 90 characters.';
      if (metric.length < 1) errors.metric = 'How will you know it is respected?';
      else if (metric.length > 40) errors.metric = 'Keep it under 40 characters.';
      let frequency = null;
      if (input.frequency) {
        const times = Number(input.frequency.times), per = input.frequency.per;
        if (PERIODS.indexOf(per) < 0) errors.frequency = 'Choose day, week or month.';
        else if (!Number.isInteger(times) || times < 1 || times > FREQ_MAX[kind === 'bad' ? 'bad' : 'good'][per]) {
          errors.frequency = 'Between 1 and ' + FREQ_MAX[kind === 'bad' ? 'bad' : 'good'][per] + ' per ' + per + '.';
        } else frequency = { times: times, per: per };
      }
      const ok = Object.keys(errors).length === 0;
      return { ok: ok, errors: errors, value: ok ? new Habit({ kind: kind, sentence: sentence, metric: metric, frequency: frequency }) : null };
    }

    /** Exactly 5 good and 5 bad, all valid, no duplicates. */
    static validateSet(list) {
      if (!Array.isArray(list)) return { ok: false, error: 'Habits are missing.' };
      const good = [], bad = [], seen = {};
      for (let i = 0; i < list.length; i++) {
        const r = Habit.validate(list[i], list[i] && list[i].kind);
        if (!r.ok) return { ok: false, error: 'Habit ' + (i + 1) + ': ' + r.errors[Object.keys(r.errors)[0]] };
        const key = r.value.sentence.toLowerCase();
        if (seen[key]) return { ok: false, error: 'Two habits have the same sentence: "' + r.value.sentence + '".' };
        seen[key] = true;
        r.value.id = list[i].id || null;
        (r.value.kind === 'good' ? good : bad).push(r.value);
      }
      if (good.length !== CONFIG.GOOD_COUNT || bad.length !== CONFIG.BAD_COUNT) return { ok: false, error: 'You need exactly 5 good and 5 bad habits.' };
      return { ok: true, value: good.concat(bad) };
    }
  }

  // ------------------------------------------------------------------ scoring a day
  /*
   * A day is GRAY until it has been filled in (Google Form). Once filled, each
   * habit active that day scores between 0 and 1:
   *   - daily habit:   Respected = 1, Partly = 0.5, Not respected = 0
   *   - "N per week/month" good habit: 1 if you are on pace for N in the period
   *   - "at most N per week/month" bad habit: 1 while slips in the period stay <= N
   * Kept = sum of scores. GREEN if kept / habits > 2/3, otherwise RED.
   */
  class DayEvaluator {
    constructor(habits, checkins, joinedAt) {
      this.habits = (habits || []).map(function (h) { return h instanceof Habit ? h : new Habit(h); });
      this.checkins = checkins || {};
      this.joinedAt = joinedAt || null;
      this.memo = {};
    }
    activeHabits(date) { return this.habits.filter(function (h) { return h.activeOn(date); }); }
    level(date, habitId) {
      const d = this.checkins[date];
      const v = d ? d[habitId] : undefined;
      return v === undefined || v === null || v === '' ? null : Number(v);
    }
    static period(date, per) {
      return per === 'week' ? { start: DateUtil.weekStart(date), length: 7 } : { start: DateUtil.monthStart(date), length: DateUtil.daysInMonth(date) };
    }
    habitDetail(h, date) {
      const level = this.level(date, h.id);
      if (!h.isPeriodic()) return { habit: h, level: level, score: level === null ? 0 : level / 2, note: null };
      const p = DayEvaluator.period(date, h.frequency.per);
      let occ = 0, slips = 0;
      for (let d = p.start; d <= date; d = DateUtil.add(d, 1)) {
        const l = this.level(d, h.id);
        if (l === null) continue;
        occ += l / 2; slips += (2 - l) / 2;
      }
      if (h.kind === 'good') {
        // pace is prorated when the habit started in the middle of the period
        const from = h.createdAt && h.createdAt > p.start ? h.createdAt : p.start;
        const pace = Math.floor(h.frequency.times * (DateUtil.diff(from, date) + 1) / p.length);
        return { habit: h, level: level, score: occ >= pace ? 1 : 0, note: fmtNum(occ) + ' of ' + h.frequency.times + ' this ' + h.frequency.per + (occ >= pace ? ', on pace' : ', behind pace') };
      }
      return { habit: h, level: level, score: slips <= h.frequency.times ? 1 : 0, note: fmtNum(slips) + ' of ' + h.frequency.times + ' allowed slips this ' + h.frequency.per };
    }
    day(date, today) {
      if (this.memo[date]) return this.memo[date];
      let res;
      const habits = this.activeHabits(date);
      if (today && date > today) res = { date: date, status: 'future' };
      else if (this.joinedAt && date < this.joinedAt) res = { date: date, status: 'none' };
      else if (!habits.length) res = { date: date, status: 'none' };
      else if (!this.checkins[date]) res = { date: date, status: 'gray', kept: 0, total: habits.length, ratio: null };
      else {
        const self = this;
        const details = habits.map(function (h) { return self.habitDetail(h, date); });
        const kept = details.reduce(function (s, d) { return s + d.score; }, 0);
        const ratio = kept / habits.length;
        res = { date: date, status: ratio > CONFIG.GREEN_THRESHOLD + 1e-9 ? 'green' : 'red', kept: kept, total: habits.length, ratio: ratio, details: details };
      }
      this.memo[date] = res;
      return res;
    }
  }

  function fmtNum(x) { return Number.isInteger(x) ? String(x) : x.toFixed(1); }

  // ------------------------------------------------------------------ player statistics
  class Stats {
    static of(ev, today) {
      const joined = ev.joinedAt || today;
      const st = function (d) { return ev.day(d, today).status; };
      let streak = 0;
      for (let d = st(today) === 'green' ? today : DateUtil.add(today, -1); d >= joined && st(d) === 'green'; d = DateUtil.add(d, -1)) streak++;
      let best = 0, run = 0;
      for (let d = joined; d <= today; d = DateUtil.add(d, 1)) { if (st(d) === 'green') { run++; if (run > best) best = run; } else run = 0; }
      const from30 = joined > DateUtil.add(today, -29) ? joined : DateUtil.add(today, -29);
      let days = 0, completed = 0, green = 0;
      for (let d = from30; d <= today; d = DateUtil.add(d, 1)) {
        const s = st(d);
        if (s === 'green' || s === 'red') { completed++; days++; if (s === 'green') green++; }
        else if (s === 'gray' && d < today) days++;
      }
      let kept7 = 0, possible7 = 0, done7 = 0;
      for (let d = DateUtil.add(today, -6); d <= today; d = DateUtil.add(d, 1)) {
        const r = ev.day(d, today);
        if (r.status === 'green' || r.status === 'red') { kept7 += r.kept; possible7 += r.total; done7++; }
      }
      let monthGreen = 0;
      for (let d = DateUtil.monthStart(today); d <= today; d = DateUtil.add(d, 1)) if (st(d) === 'green') monthGreen++;
      const strip = [];
      for (let d = DateUtil.add(today, -13); d <= today; d = DateUtil.add(d, 1)) strip.push(st(d));
      return {
        streak: streak, best: best, monthGreen: monthGreen,
        regularity: days ? completed / days : null, greenRate: completed ? green / completed : null,
        completed30: completed, days30: days, kept7: Math.round(kept7 * 2) / 2, possible7: possible7, done7: done7,
        today: st(today), yesterday: st(DateUtil.add(today, -1)), strip: strip
      };
    }
  }

  // ------------------------------------------------------------------ motivation
  const REASSURE = [
    'A red square is a data point, not a verdict. Today is a fresh one.',
    'Progress is never a straight line. One harder day changes nothing about who you are becoming.',
    'You noticed, you logged it, you came back. That is the habit that matters most.',
    'Be as kind to yourself as you would be to a friend who had a rough day.',
    'Yesterday asked a lot of you. Today you only need the next small step.',
    'Every great streak started right after a missed day.',
    'Rest, reset, restart. Nothing grows faster because you are hard on it.',
    'The comeback is always stronger than the slip.',
    'Missing once is an accident. Showing up today turns it into a detour, not a direction.',
    'Your grid is a garden, not an exam. Water one square today.',
    'Small wins count double after a hard day.',
    'You are not starting over. You are starting again, with experience.',
    'Breathe. Pick the easiest habit on your list and win that one first.',
    'One red day does not erase the green ones before it.',
    'Self-compassion is not letting yourself off the hook. It is what gets you back on it.',
    'Hard days are part of the path, not proof that you left it.',
    'Today, aim for good enough. Good enough, repeated, becomes great.',
    'What made yesterday hard? Name it, then make today one percent easier.',
    'The best moment to get back on track is the next square, and it starts now.',
    'A plant that leans toward the light again was never lost. Lean back in.'
  ];
  const PROJECT = [
    'Imagine yourself 90 days from now with a grid full of green. Today is one of those squares.',
    'Every habit you keep today is a vote for the person you are becoming.',
    'Small steps compound: one percent better each day is about 37 times better after a year.',
    'The you who finishes this month will thank the you who shows up today.',
    'Your future self is built from ordinary days exactly like this one.',
    'Momentum is on your side. Let today make the streak a little longer.',
    'What could you achieve if you kept this rhythm until spring?',
    'Habits are the quiet engine behind every big change.',
    'Picture your grid in a year: a mosaic of days you chose yourself.',
    'Consistency beats intensity. Today, just be consistent.',
    'You are closer than you think. Keep stacking the squares.',
    'Each green square is proof that change is not a someday thing.',
    'Today is a chance to surprise your future self.',
    'The person you want to be is a few hundred small decisions away.',
    'Ten habits, one day at a time: that is how a new life gets built.',
    'Think of where a month of this rhythm could take you. Then start with today.',
    'Growth is quiet at first. Then one day everyone notices.',
    'Your streak is a story. Write the next line today.',
    'Possibility loves momentum. Keep moving.',
    'Somewhere ahead is a version of you who finds this easy. Walk toward them today.'
  ];
  class Motivation {
    /** previous = status of the previous day ('red' => reassuring, anything else => projecting). */
    static pick(previous, random) {
      random = random || Math.random;
      const pool = previous === 'red' ? REASSURE : PROJECT;
      return { text: pool[Math.floor(random() * pool.length)], tone: previous === 'red' ? 'reassure' : 'project' };
    }
    static greeting(hour) { return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; }
  }

  // ------------------------------------------------------------------ gifts
  const GIFTS = [
    { id: 'seedling', emoji: '🌱', name: 'Seedling' }, { id: 'sunflower', emoji: '🌻', name: 'Sunflower' },
    { id: 'tea', emoji: '🍵', name: 'Cup of tea' }, { id: 'star', emoji: '⭐', name: 'Gold star' },
    { id: 'balloon', emoji: '🎈', name: 'Balloon' }, { id: 'clover', emoji: '🍀', name: 'Lucky clover' },
    { id: 'cupcake', emoji: '🧁', name: 'Cupcake' }, { id: 'rainbow', emoji: '🌈', name: 'Rainbow' }
  ];
  const GIFT_MESSAGES = ["You've got this!", 'Proud of your consistency', 'One square at a time', 'Tomorrow is a fresh square', 'Your streak inspires me', 'Keep showing up'];
  function giftById(id) { for (let i = 0; i < GIFTS.length; i++) if (GIFTS[i].id === id) return GIFTS[i]; return null; }

  // ------------------------------------------------------------------ onboarding suggestions
  const SUGGESTIONS = {
    good: [
      { sentence: 'Read before bed', metric: '20 pages' },
      { sentence: 'Move my body', metric: '30 minutes', frequency: { times: 4, per: 'week' } },
      { sentence: 'Drink enough water', metric: '2 litres' },
      { sentence: 'Meditate', metric: '10 minutes' },
      { sentence: 'Sleep before midnight', metric: 'Lights off by 23:30' },
      { sentence: 'Practise a language', metric: '15 minutes' },
      { sentence: 'Cook a real meal', metric: '1 home-cooked meal' },
      { sentence: 'Walk outside', metric: '8,000 steps' },
      { sentence: 'Write in a journal', metric: '3 lines' },
      { sentence: 'Call someone I love', metric: '1 call', frequency: { times: 2, per: 'week' } }
    ],
    bad: [
      { sentence: 'Scroll social media in bed', metric: '0 minutes after 23:00' },
      { sentence: 'Snack after dinner', metric: 'Nothing after 21:00' },
      { sentence: 'Drink soda', metric: '0 cans', frequency: { times: 2, per: 'week' } },
      { sentence: 'Hit snooze', metric: 'Up at the first alarm' },
      { sentence: 'Smoke', metric: '0 cigarettes' },
      { sentence: 'Order takeaway', metric: 'At most once', frequency: { times: 1, per: 'week' } },
      { sentence: 'Doomscroll the news', metric: 'Under 15 minutes' },
      { sentence: 'Procrastinate on hard tasks', metric: 'Hardest task first' },
      { sentence: 'Skip breakfast', metric: 'Eat before 10:00' },
      { sentence: 'Buy on impulse', metric: 'Wait 24 h before buying' }
    ]
  };

  // ------------------------------------------------------------------ math quiz ("Stay awake")
  const QUIZ_LEVELS = [
    { id: 1, name: 'Algebra warm-up', topic: 'Basic algebra', emoji: '🌱' },
    { id: 2, name: 'Vector flow', topic: 'Vectors in action', emoji: '🧭' },
    { id: 3, name: 'Theorem quest', topic: 'Apply a theorem', emoji: '🏛️' }
  ];
  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  function n(x) { return x < 0 ? '−' + Math.abs(x) : String(x); }
  function p(x) { return x < 0 ? '(' + n(x) + ')' : String(x); }
  function sup(x) { return String(x).split('').map(function (c) { return SUP[c] || c; }).join(''); }
  function vec(x, y) { return '(' + (typeof x === 'number' ? n(x) : x) + ', ' + (typeof y === 'number' ? n(y) : y) + ')'; }
  function dec(x) { return String(Number(x.toFixed(4))); }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
  function lcm(a, b) { return a / gcd(a, b) * b; }
  function powmod(a, e, m) { let r = 1; a %= m; while (e > 0) { if (e & 1) r = (r * a) % m; a = (a * a) % m; e >>= 1; } return r; }
  function poly2(b, c) {
    let s = 'x²';
    if (b) s += ' ' + (b < 0 ? '−' : '+') + ' ' + (Math.abs(b) === 1 ? '' : Math.abs(b)) + 'x';
    if (c) s += ' ' + (c < 0 ? '−' : '+') + ' ' + Math.abs(c);
    return s;
  }
  function rootStr(x) { const r = Math.round(Math.sqrt(x)); return r * r === x ? String(r) : '√' + x; }

  /** Numeric answer + plausible wrong answers (common mistakes) + filler near the answer. */
  function numQ(correct, cands, fmt, positive) {
    fmt = fmt || n;
    const ok = function (v) { return typeof v === 'number' && isFinite(v) && Number.isInteger(v) && v !== correct && (!positive || v > 0); };
    return {
      answer: fmt(correct),
      wrong: cands.filter(ok).map(fmt),
      fill: function (rng, i) {
        const k = Math.ceil(i / 2);
        let v = correct + (i % 2 ? k : -k);
        if (positive && v <= 0) v = correct + k + 1;
        return fmt(v);
      }
    };
  }
  function q() { return Object.assign.apply(null, arguments); }

  const ANGLE_CASES = [
    { u: [1, 1], v: [1, -1], deg: 90, cos: '0' }, { u: [2, 0], v: [3, 3], deg: 45, cos: '√2/2' },
    { u: [1, 0], v: [-2, 2], deg: 135, cos: '−√2/2' }, { u: [3, 4], v: [-4, 3], deg: 90, cos: '0' },
    { u: [1, 2], v: [2, 4], deg: 0, cos: '1' }, { u: [1, 2], v: [-1, -2], deg: 180, cos: '−1' },
    { u: [0, 2], v: [3, 3], deg: 45, cos: '√2/2' }, { u: [2, 2], v: [-3, 0], deg: 135, cos: '−√2/2' }
  ];

  const TEMPLATES = {
    1: [
      { id: 'linear', make: function (r) {
        const a = r.int(2, 9), x = r.nonZero(-9, 9), b = r.nonZero(-15, 15), c = a * x + b;
        return q(numQ(x, [(c + b) / a, c - b, -x, x + 1], function (v) { return 'x = ' + n(v); }), {
          prompt: 'Solve ' + a + 'x ' + (b < 0 ? '−' : '+') + ' ' + Math.abs(b) + ' = ' + n(c),
          skill: 'Undo operations in reverse order: move the constant first, then divide by the coefficient.',
          explanation: a + 'x = ' + n(c) + ' ' + (b < 0 ? '+' : '−') + ' ' + Math.abs(b) + ' = ' + n(c - b) + ', so x = ' + n(c - b) + ' ÷ ' + a + ' = ' + n(x) + '.'
        });
      } },
      { id: 'expand', make: function (r) {
        const a = r.int(2, 9), s = r.sign(), sg = s > 0 ? '+' : '−', op = s > 0 ? '−' : '+';
        return {
          prompt: 'Expand (x ' + sg + ' ' + a + ')²',
          answer: 'x² ' + sg + ' ' + (2 * a) + 'x + ' + (a * a),
          wrong: ['x² + ' + (a * a), 'x² ' + sg + ' ' + a + 'x + ' + (a * a), 'x² ' + op + ' ' + (2 * a) + 'x + ' + (a * a), 'x² ' + sg + ' ' + (2 * a) + 'x + ' + (2 * a)],
          fill: function (rng, i) { return 'x² ' + sg + ' ' + (2 * a + i) + 'x + ' + (a * a); },
          skill: '(a ± b)² = a² ± 2ab + b²: the double product 2ab is the term people forget.',
          explanation: '(x ' + sg + ' ' + a + ')² = x² ' + sg + ' 2·' + a + '·x + ' + a + '² = x² ' + sg + ' ' + (2 * a) + 'x + ' + (a * a) + '.'
        };
      } },
      { id: 'squares', make: function (r) {
        const k = r.int(1, 9), base = r.pick([20, 30, 40, 50, 60, 70, 100]), A = base + k, B = base - k, ans = 4 * k * base;
        return q(numQ(ans, [2 * k * base, 4 * k * k, ans + 2 * k], null, true), {
          prompt: 'Compute ' + A + '² − ' + B + '² in your head.',
          skill: 'a² − b² = (a − b)(a + b) turns two big squares into one easy product.',
          explanation: A + '² − ' + B + '² = (' + A + ' − ' + B + ')(' + A + ' + ' + B + ') = ' + (2 * k) + ' × ' + (2 * base) + ' = ' + ans + '.'
        });
      } },
      { id: 'vieta', make: function (r) {
        const r1 = r.nonZero(-6, 8); let r2; do { r2 = r.nonZero(-6, 8); } while (r2 === r1);
        const S = r1 + r2, P = r1 * r2, b = -S, c = P, askSum = r.next() < 0.5;
        return q(askSum ? numQ(S, [-S, P, S + 1]) : numQ(P, [-P, S, P - 1]), {
          prompt: 'The equation ' + poly2(b, c) + ' = 0 has two roots. What is their ' + (askSum ? 'sum' : 'product') + '?',
          skill: 'Vieta: for x² + bx + c = 0, the roots add up to −b and multiply to c. No need to solve.',
          explanation: 'Here b = ' + n(b) + ' and c = ' + n(c) + ': sum = −b = ' + n(S) + ', product = c = ' + n(P) + ' (the roots are ' + n(r1) + ' and ' + n(r2) + ').'
        });
      } },
      { id: 'system', make: function (r) {
        const x = r.int(-8, 9), y = r.int(-8, 9), s = x + y, d = x - y;
        return q(numQ(x, [y, s + d, s - d, -x]), {
          prompt: 'x + y = ' + n(s) + ' and x − y = ' + n(d) + '. What is x?',
          skill: 'Add the two equations: y cancels and you get 2x in one move.',
          explanation: 'Adding: 2x = ' + n(s) + ' + ' + p(d) + ' = ' + n(s + d) + ', so x = ' + n(x) + '.'
        });
      } },
      { id: 'percent', make: function (r) {
        const pc = r.pick([10, 20, 25, 30, 40, 50]), loss = pc * pc / 100;
        const f = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + dec(Math.abs(v)) + '%'; };
        return {
          prompt: 'A price rises by ' + pc + '% and then falls by ' + pc + '%. What is the overall change?',
          answer: f(-loss), wrong: ['0%', f(loss), f(-2 * loss)],
          fill: function (rng, i) { return f(-(loss + i)); },
          skill: 'Successive percentages multiply: (1 + p)(1 − p) = 1 − p², so you never get back to the start.',
          explanation: '× ' + dec(1 + pc / 100) + ' then × ' + dec(1 - pc / 100) + ' gives × ' + dec(1 - loss / 100) + ': the price ends ' + dec(loss) + '% lower.'
        };
      } },
      { id: 'powers', make: function (r) {
        const a = r.int(2, 7), b = r.int(1, 4), byEight = r.next() < 0.5, k = byEight ? 3 : 2, e = a + 2 * b - k;
        return q(numQ(e, [a + b - k, a + 2 * b + k, 2 * a * b - k], function (v) { return '2' + sup(v); }, true), {
          prompt: 'Write 2' + sup(a) + ' × 4' + sup(b) + ' ÷ ' + (byEight ? 8 : 4) + ' as a power of 2.',
          skill: 'Rewrite every factor in the same base, then add or subtract the exponents.',
          explanation: '4' + sup(b) + ' = 2' + sup(2 * b) + ' and ' + (byEight ? 8 : 4) + ' = 2' + sup(k) + ', so the exponent is ' + a + ' + ' + (2 * b) + ' − ' + k + ' = ' + e + '.'
        });
      } },
      { id: 'fractions', make: function (r) {
        const pair = r.pick([[2, 3], [3, 6], [4, 12], [2, 6], [3, 4], [4, 6], [6, 12], [2, 4]]), a = pair[0], b = pair[1], L = lcm(a, b);
        const x = L * r.nonZero(-4, 5), c = x / a + x / b;
        return q(numQ(x, [c * (a + b), c * Math.min(a, b), c, x / 2]), {
          prompt: 'Solve x/' + a + ' + x/' + b + ' = ' + n(c),
          skill: 'Multiply both sides by the common denominator to clear every fraction at once.',
          explanation: 'Multiply by ' + L + ': ' + (L / a) + 'x + ' + (L / b) + 'x = ' + n(c * L) + ', so ' + (L / a + L / b) + 'x = ' + n(c * L) + ' and x = ' + n(x) + '.'
        });
      } },
      { id: 'inequality', make: function (r) {
        const a = r.int(2, 6), x0 = r.nonZero(-6, 6), b = r.nonZero(-9, 9), c = -a * x0 + b;
        return {
          prompt: 'Solve −' + a + 'x ' + (b < 0 ? '−' : '+') + ' ' + Math.abs(b) + ' > ' + n(c),
          answer: 'x < ' + n(x0), wrong: ['x > ' + n(x0), 'x < ' + n(-x0), 'x > ' + n(-x0)],
          fill: function (rng, i) { return 'x < ' + n(x0 + i); },
          skill: 'Dividing an inequality by a negative number flips its direction.',
          explanation: '−' + a + 'x > ' + n(c) + ' ' + (b < 0 ? '+' : '−') + ' ' + Math.abs(b) + ' = ' + n(c - b) + '. Divide by −' + a + ' and flip the sign: x < ' + n(x0) + '.'
        };
      } }
    ],
    2: [
      { id: 'dot', make: function (r) {
        const a = r.nonZero(-6, 6), b = r.nonZero(-6, 6), c = r.nonZero(-6, 6), d = r.nonZero(-6, 6), res = a * c + b * d;
        const o = numQ(res, [a * c - b * d, a * d + b * c]);
        o.wrong.unshift(vec(a * c, b * d));
        return q(o, {
          prompt: 'u = ' + vec(a, b) + ' and v = ' + vec(c, d) + '. Compute u · v.',
          skill: 'A dot product is a number, not a vector: multiply matching coordinates, then add.',
          explanation: 'u · v = ' + n(a) + '×' + p(c) + ' + ' + p(b) + '×' + p(d) + ' = ' + n(a * c) + ' + ' + p(b * d) + ' = ' + n(res) + '.'
        });
      } },
      { id: 'perp', make: function (r) {
        const k = r.nonZero(-6, 6), c = r.nonZero(-5, 5), t = r.pick([-2, -1, 1, 2]), a = c * t, b = -k * t;
        return q(numQ(k, [-k, 2 * k, k + c]), {
          prompt: 'For which k are u = ' + vec(a, b) + ' and v = ' + vec('k', c) + ' perpendicular?',
          skill: 'Two vectors are perpendicular exactly when their dot product is 0.',
          explanation: 'u · v = ' + n(a) + 'k + ' + p(b) + '×' + p(c) + ' = 0, so ' + n(a) + 'k = ' + n(-b * c) + ' and k = ' + n(k) + '.'
        });
      } },
      { id: 'norm', make: function (r) {
        const t = r.pick([[3, 4, 5], [5, 12, 13], [8, 15, 17], [6, 8, 10], [7, 24, 25], [9, 12, 15], [12, 16, 20]]);
        let x = t[0], y = t[1]; const c = t[2];
        if (r.next() < 0.5) { const s = x; x = y; y = s; }
        x *= r.sign(); y *= r.sign();
        return q(numQ(c, [Math.abs(x) + Math.abs(y), c * c, c + 1], String, true), {
          prompt: 'What is the length ‖v‖ of v = ' + vec(x, y) + '?',
          skill: '‖(x, y)‖ = √(x² + y²): Pythagoras applied to the coordinates. Signs never matter.',
          explanation: '‖v‖ = √(' + p(x) + '² + ' + p(y) + '²) = √(' + (x * x) + ' + ' + (y * y) + ') = √' + (c * c) + ' = ' + c + '.'
        });
      } },
      { id: 'AB', make: function (r) {
        const x1 = r.int(-7, 7), y1 = r.int(-7, 7); let x2, y2;
        do { x2 = r.int(-7, 7); y2 = r.int(-7, 7); } while (x2 === x1 || y2 === y1 || x2 - x1 === y2 - y1);
        const dx = x2 - x1, dy = y2 - y1;
        return {
          prompt: 'A = ' + vec(x1, y1) + ' and B = ' + vec(x2, y2) + '. What are the coordinates of the vector AB?',
          answer: vec(dx, dy), wrong: [vec(-dx, -dy), vec(x1 + x2, y1 + y2), vec(dy, dx)],
          fill: function (rng, i) { return vec(dx + i, dy); },
          skill: 'AB = B − A: always arrival minus departure.',
          explanation: 'AB = (' + n(x2) + ' − ' + p(x1) + ', ' + n(y2) + ' − ' + p(y1) + ') = ' + vec(dx, dy) + '.'
        };
      } },
      { id: 'work', make: function (r) {
        let a, b; do { a = r.int(-5, 10); b = r.int(-5, 10); } while (a === 0 && b === 0);
        const c = r.nonZero(-4, 8), e = r.nonZero(-4, 8), W = a * c + b * e;
        return q(numQ(W, [a * c, a * e + b * c, a * c - b * e], function (v) { return n(v) + ' J'; }), {
          prompt: 'A force F = ' + vec(a, b) + ' N moves an object by d = ' + vec(c, e) + ' m. How much work does F do?',
          skill: 'Work is a dot product, W = F · d: only the part of the force along the motion counts.',
          explanation: 'W = ' + n(a) + '×' + p(c) + ' + ' + p(b) + '×' + p(e) + ' = ' + n(W) + ' J.' + (W < 0 ? ' Negative: the force mostly works against the motion.' : '')
        });
      } },
      { id: 'collinear', make: function (r) {
        const a = r.nonZero(-5, 5), b = r.nonZero(-6, 6), t = r.pick([-3, -2, 2, 3]), c = a * t, k = b * t;
        return q(numQ(k, [-k, b + t, c * b]), {
          prompt: 'For which k are u = ' + vec(a, b) + ' and v = ' + vec(c, 'k') + ' collinear?',
          skill: 'u and v are collinear exactly when det(u, v) = x·y′ − y·x′ = 0.',
          explanation: 'det(u, v) = ' + n(a) + '·k − ' + p(b) + '·' + p(c) + ' = 0, so k = ' + n(b * c) + ' ÷ ' + p(a) + ' = ' + n(k) + '. Indeed v = ' + n(t) + '·u.'
        });
      } },
      { id: 'area', make: function (r) {
        let a, b, c, d, det;
        do { a = r.int(-5, 6); b = r.int(-5, 6); c = r.int(-5, 6); d = r.int(-5, 6); det = a * d - b * c; } while (det === 0);
        const A = Math.abs(det);
        return q(numQ(A, [a * c + b * d, A % 2 === 0 ? A / 2 : 2 * A, Math.abs(a * d) + Math.abs(b * c)], String, true), {
          prompt: 'What is the area of the parallelogram spanned by u = ' + vec(a, b) + ' and v = ' + vec(c, d) + '?',
          skill: '|det(u, v)| = |x·y′ − y·x′| is the area of the parallelogram built on u and v.',
          explanation: 'det(u, v) = ' + n(a) + '×' + p(d) + ' − ' + p(b) + '×' + p(c) + ' = ' + n(det) + ', so the area is |' + n(det) + '| = ' + A + '.'
        });
      } },
      { id: 'angle', make: function (r) {
        const cs = r.pick(ANGLE_CASES), s = r.int(1, 3), u = cs.u, v = [cs.v[0] * s, cs.v[1] * s], dot = u[0] * v[0] + u[1] * v[1];
        const others = r.shuffle([0, 45, 90, 135, 180].filter(function (x) { return x !== cs.deg; })).slice(0, 3);
        return {
          prompt: 'What is the angle between u = ' + vec(u[0], u[1]) + ' and v = ' + vec(v[0], v[1]) + '?',
          answer: cs.deg + '°', wrong: others.map(function (x) { return x + '°'; }),
          fill: function (rng, i) { return (cs.deg + 30 * i) + '°'; },
          skill: 'cos θ = (u · v) / (‖u‖·‖v‖). The sign of u · v alone tells you acute, right or obtuse.',
          explanation: 'u · v = ' + n(dot) + (dot === 0 ? ', so the vectors are perpendicular' : '') + '. cos θ = ' + cs.cos + ', so θ = ' + cs.deg + '°.'
        };
      } },
      { id: 'projection', make: function (r) {
        const v = r.pick([[3, 4], [4, 3], [0, 5], [5, 0], [-3, 4], [4, -3]]); let a, b, dot;
        do { a = r.int(-6, 8); b = r.int(-6, 8); dot = a * v[0] + b * v[1]; } while (dot === 0 || dot % 5 !== 0);
        const res = dot / 5;
        return q(numQ(res, [dot, dot / 25, -res, res + 1]), {
          prompt: 'What is the scalar projection of u = ' + vec(a, b) + ' onto v = ' + vec(v[0], v[1]) + '?',
          skill: 'The scalar projection of u on v is (u · v) / ‖v‖. Divide by the length, not by its square.',
          explanation: 'u · v = ' + n(dot) + ' and ‖v‖ = 5, so the projection is ' + n(dot) + ' ÷ 5 = ' + n(res) + '.'
        });
      } },
      { id: 'combo', make: function (r) {
        const u = [r.int(-5, 5), r.int(-5, 5)], v = [r.int(-5, 5), r.int(-5, 5)], al = r.pick([2, 3, -1, -2]), be = r.pick([2, 3, -1, -2, 4]);
        const x = al * u[0] + be * v[0], y = al * u[1] + be * v[1];
        const coef = function (k) { return k === 1 ? '' : k === -1 ? '−' : n(k); };
        return {
          prompt: 'u = ' + vec(u[0], u[1]) + ' and v = ' + vec(v[0], v[1]) + '. Compute ' + coef(al) + 'u ' + (be < 0 ? '−' : '+') + ' ' + (Math.abs(be) === 1 ? '' : Math.abs(be)) + 'v.',
          answer: vec(x, y),
          wrong: [vec(al * u[0] - be * v[0], al * u[1] - be * v[1]), vec(be * u[0] + al * v[0], be * u[1] + al * v[1]), vec(y, x)],
          fill: function (rng, i) { return vec(x + i, y); },
          skill: 'Scalars act on each coordinate separately: do the x line, then the y line.',
          explanation: 'x: ' + n(al) + '×' + p(u[0]) + ' + ' + p(be) + '×' + p(v[0]) + ' = ' + n(x) + '; y: ' + n(al) + '×' + p(u[1]) + ' + ' + p(be) + '×' + p(v[1]) + ' = ' + n(y) + '.'
        };
      } }
    ],
    3: [
      { id: 'pythagoras', make: function (r) {
        const t = r.pick([[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29]]), k = r.pick([1, 1, 2, 3]);
        const a = t[0] * k, b = t[1] * k, c = t[2] * k, skill = 'Pythagoras: in a right triangle a² + b² = c², where c is the side opposite the right angle.';
        if (r.next() < 0.5) return q(numQ(c, [a + b, c + 1, c - 1], String, true), {
          prompt: 'A right triangle has legs ' + a + ' and ' + b + '. How long is the hypotenuse?', skill: skill,
          explanation: 'c² = ' + a + '² + ' + b + '² = ' + (a * a) + ' + ' + (b * b) + ' = ' + (c * c) + ', so c = ' + c + '.'
        });
        const o = numQ(b, [c - a, b + 1, a], String, true);
        o.wrong.unshift('√' + (c * c + a * a));
        return q(o, {
          prompt: 'A right triangle has hypotenuse ' + c + ' and one leg ' + a + '. How long is the other leg?', skill: skill,
          explanation: 'b² = ' + c + '² − ' + a + '² = ' + (c * c) + ' − ' + (a * a) + ' = ' + (b * b) + ', so b = ' + b + '.'
        });
      } },
      { id: 'thales', make: function (r) {
        const a = r.int(2, 6), b = a + r.int(1, 6), unit = b / gcd(a, b), c = unit * r.int(1, 3) * (unit < 4 ? 2 : 1), mn = c * a / b;
        return q(numQ(mn, [c * b / a, c - (b - a), mn + 1, c - mn], String, true), {
          prompt: 'In triangle ABC, M is on [AB] and N on [AC] with (MN) ∥ (BC). AM = ' + a + ', AB = ' + b + ', BC = ' + c + '. Find MN.',
          skill: 'Intercept (Thales) theorem: parallel lines keep ratios, so AM/AB = AN/AC = MN/BC.',
          explanation: 'MN / BC = AM / AB, so MN = ' + c + ' × ' + a + '/' + b + ' = ' + mn + '.'
        });
      } },
      { id: 'cosines', make: function (r) {
        const cs = r.pick([[3, 8, 60, 7], [5, 8, 60, 7], [7, 15, 60, 13], [8, 15, 60, 13], [5, 21, 60, 19], [10, 16, 60, 14], [3, 5, 120, 7], [7, 8, 120, 13]]);
        const a = cs[0], b = cs[1], C = cs[2], c = cs[3], sq = a * a + b * b, other = C === 60 ? sq + a * b : sq - a * b;
        return {
          prompt: 'A triangle has sides ' + a + ' and ' + b + ' with an angle of ' + C + '° between them. How long is the third side?',
          answer: String(c), wrong: [rootStr(sq), rootStr(other), String(c + 1), String(c - 1)],
          fill: function (rng, i) { return String(c + i + 1); },
          skill: 'Law of cosines (Al-Kashi): c² = a² + b² − 2ab·cos C. With C = 90° it is just Pythagoras.',
          explanation: 'c² = ' + a + '² + ' + b + '² − 2·' + a + '·' + b + '·cos ' + C + '° = ' + (a * a) + ' + ' + (b * b) + ' ' + (C === 60 ? '−' : '+') + ' ' + (a * b) + ' = ' + (c * c) + ', so c = ' + c + '.'
        };
      } },
      { id: 'inscribed', make: function (r) {
        const al = r.pick([20, 25, 30, 35, 40, 50, 55, 65, 70]), deg = function (v) { return v + '°'; };
        const skill = 'Inscribed angle theorem: the central angle is twice any inscribed angle standing on the same arc.';
        if (r.next() < 0.5) return q(numQ(2 * al, [al, al / 2, 180 - al, 180 - 2 * al], deg, true), {
          prompt: 'On a circle with centre O, the inscribed angle ACB measures ' + al + '°. What is the central angle AOB on the same arc?', skill: skill,
          explanation: 'AOB = 2 × ACB = 2 × ' + al + '° = ' + (2 * al) + '°.'
        });
        const be = 2 * al;
        return q(numQ(al, [be, 2 * be, 180 - be, 90 - al], deg, true), {
          prompt: 'On a circle with centre O, the central angle AOB measures ' + be + '°. What is an inscribed angle ACB on the same arc?', skill: skill,
          explanation: 'ACB = AOB ÷ 2 = ' + be + '° ÷ 2 = ' + al + '°.'
        });
      } },
      { id: 'fermat', make: function (r) {
        const pr = r.pick([5, 7, 11, 13]), a = r.int(2, pr - 1), qq = r.int(8, 40), rem = r.int(1, pr - 2), e = (pr - 1) * qq + rem, ans = powmod(a, rem, pr);
        return q(numQ(ans, [1, a % pr, (ans + 1) % pr, powmod(a, e % pr, pr)], String), {
          prompt: 'What is the remainder when ' + a + sup(e) + ' is divided by ' + pr + '?',
          skill: "Fermat's little theorem: for a prime p not dividing a, a^(p−1) ≡ 1 (mod p). Reduce the exponent modulo p − 1.",
          explanation: pr + ' is prime, so ' + a + sup(pr - 1) + ' ≡ 1. Since ' + e + ' = ' + (pr - 1) + '×' + qq + ' + ' + rem + ', ' + a + sup(e) + ' ≡ ' + a + sup(rem) + ' = ' + Math.pow(a, rem) + ' ≡ ' + ans + ' (mod ' + pr + ').'
        }, { fill: function (rng, i) { return String((ans + i) % pr); } });
      } },
      { id: 'triangle', make: function (r) {
        const fmt = function (s) { s.sort(function (x, y) { return x - y; }); return s.join(', '); };
        const valid = function () { const a = r.int(2, 9), b = r.int(a, 12), c = r.int(b - a + 1, a + b - 1); return fmt([a, b, c]); };
        const a = r.int(2, 7), b = r.int(a, 9), c = a + b + r.int(0, 4);
        return {
          prompt: 'Which three lengths can NOT be the sides of a triangle?',
          answer: fmt([a, b, c]), wrong: [valid(), valid(), valid(), valid()],
          fill: function () { return valid(); },
          skill: 'Triangle inequality: the longest side must be strictly shorter than the sum of the two others.',
          explanation: a + ' + ' + b + ' = ' + (a + b) + (a + b === c ? ' = ' : ' < ') + c + ': the two short sides cannot reach each other' + (a + b === c ? ' (the triangle would be flat).' : '.')
        };
      } },
      { id: 'geometric', make: function (r) {
        const g = r.pick([2, 2, 3]), N = g === 2 ? r.int(4, 9) : r.int(3, 6), top = Math.pow(g, N + 1), ans = (top - 1) / (g - 1);
        return q(numQ(ans, [top, (Math.pow(g, N) - 1) / (g - 1), top - 1, ans + 1], String, true), {
          prompt: 'Compute 1 + ' + g + ' + ' + g + '² + … + ' + g + sup(N) + '.',
          skill: 'Geometric sum: 1 + r + … + rⁿ = (rⁿ⁺¹ − 1)/(r − 1). Multiply by r and subtract to see why.',
          explanation: '(' + g + sup(N + 1) + ' − 1)/(' + g + ' − 1) = (' + top + ' − 1)/' + (g - 1) + ' = ' + ans + '.'
        });
      } },
      { id: 'bayes', make: function (r) {
        const s = r.pick([20, 40, 60, 100]), sens = r.pick([90, 80]), fpr = r.pick([5, 10]);
        const tp = s * sens / 100, fp = (1000 - s) * fpr / 100, P = Math.round(100 * tp / (tp + fp));
        return q(numQ(P, [sens, 100 - fpr, s / 10], function (v) { return v + '%'; }, true), {
          prompt: s + ' people in 1,000 have a condition. A test catches ' + sens + '% of them but also flags ' + fpr + '% of healthy people. You test positive: about how likely is it that you have it?',
          skill: 'Bayes: count true and false positives out of 1,000 people. When a condition is rare, many positives are false.',
          explanation: 'True positives: ' + sens + '% of ' + s + ' = ' + tp + '. False positives: ' + fpr + '% of ' + (1000 - s) + ' = ' + fp + '. So ' + tp + ' / (' + tp + ' + ' + fp + ') ≈ ' + P + '%.'
        });
      } },
      { id: 'pigeonhole', make: function (r) {
        const cs = r.pick([
          { k: 12, txt: function (m) { return 'people must be in a room to be sure that at least ' + m + ' share a birth month'; } },
          { k: 7, txt: function (m) { return 'people must you gather to be sure that at least ' + m + ' were born on the same day of the week'; } },
          { k: 4, txt: function (m) { return 'socks must you pull from a drawer of 4 colours to be sure to get ' + m + ' of the same colour'; } },
          { k: 10, txt: function (m) { return 'whole numbers must you pick to be sure that at least ' + m + ' end with the same digit'; } }
        ]), m = r.pick([2, 3]), ans = cs.k * (m - 1) + 1;
        return q(numQ(ans, [cs.k * m, cs.k + m, cs.k * (m - 1)], String, true), {
          prompt: 'How many ' + cs.txt(m) + '?',
          skill: 'Pigeonhole principle: with n boxes, n·(m − 1) + 1 objects force at least m into the same box.',
          explanation: 'With ' + cs.k + ' possibilities you could have ' + (m - 1) + ' of each, ' + (cs.k * (m - 1)) + ' in total, with no ' + m + ' alike. One more forces it: ' + ans + '.'
        });
      } },
      { id: 'ivt', make: function (r) {
        const c1 = r.int(1, 3), k = r.int(0, 3), lo = k * k * k + c1 * k, hi = (k + 1) * (k + 1) * (k + 1) + c1 * (k + 1), qv = r.int(lo + 1, hi - 1);
        const f = function (x) { return x * x * x + c1 * x - qv; }, I = function (j) { return '[' + j + ', ' + (j + 1) + ']'; };
        return {
          prompt: 'f(x) = x³ + ' + (c1 === 1 ? '' : c1) + 'x − ' + qv + '. Which interval surely contains a root of f?',
          answer: I(k), wrong: [I(k + 1), I(k + 2), k >= 1 ? I(k - 1) : I(k + 3)],
          fill: function (rng, i) { return I(k + 3 + i); },
          skill: 'Intermediate value theorem: a continuous function that changes sign on [a, b] has a root in between.',
          explanation: 'f(' + k + ') = ' + n(f(k)) + ' < 0 and f(' + (k + 1) + ') = ' + n(f(k + 1)) + ' > 0, and f is continuous, so it crosses 0 in ' + I(k) + '.'
        };
      } },
      { id: 'gcd', make: function (r) {
        const g = r.int(2, 12); let m, k;
        do { m = r.int(2, 15); k = r.int(2, 15); } while (m === k || gcd(m, k) !== 1);
        const A = g * Math.max(m, k), B = g * Math.min(m, k), steps = [];
        let x = A, y = B;
        while (y) { steps.push(x + ' = ' + Math.floor(x / y) + '×' + y + ' + ' + (x % y)); const t = x % y; x = y; y = t; }
        let small = 0; for (let d = 2; d < g; d++) if (g % d === 0) { small = d; break; }
        return q(numQ(g, [2 * g, A - B, small, 1], String, true), {
          prompt: 'What is gcd(' + A + ', ' + B + ')?',
          skill: 'Euclid: gcd(a, b) = gcd(b, a mod b). Repeat until the remainder is 0: the last non-zero remainder wins.',
          explanation: steps.join('; ') + '. The last non-zero remainder is ' + g + '.'
        });
      } }
    ]
  };

  class QuizGenerator {
    static build(rng, template) {
      const raw = template.make(rng);
      const seen = {}, wrong = [];
      seen[raw.answer] = true;
      for (let i = 0; i < raw.wrong.length && wrong.length < 3; i++) {
        const w = raw.wrong[i];
        if (w != null && !seen[w]) { seen[w] = true; wrong.push(w); }
      }
      for (let i = 1; wrong.length < 3 && i < 60; i++) {
        const w = raw.fill(rng, i);
        if (!seen[w]) { seen[w] = true; wrong.push(w); }
      }
      if (wrong.length < 3) throw new Error('Quiz template ' + template.id + ' could not build 4 choices');
      const choices = rng.shuffle([raw.answer].concat(wrong));
      return { template: template.id, prompt: raw.prompt, choices: choices, answer: choices.indexOf(raw.answer), skill: raw.skill, explanation: raw.explanation };
    }
    static generate(level, seed, count) {
      const rng = new Rng(seed), list = TEMPLATES[level];
      if (!list) throw new Error('Unknown level ' + level);
      return rng.shuffle(list).slice(0, count || CONFIG.QUIZ_QUESTIONS).map(function (t, i) {
        return Object.assign({ id: i }, QuizGenerator.build(rng, t));
      });
    }
    /** Same 5 questions for every player on the same day and level. */
    static daily(date, level) { return QuizGenerator.generate(level, 'daily|' + date + '|' + level + '|v1'); }
    static publicView(qs) { return qs.map(function (x) { return { id: x.id, prompt: x.prompt, choices: x.choices }; }); }
    static grade(qs, answers) {
      let correct = 0;
      const review = qs.map(function (x, i) {
        const chosen = answers && Number.isInteger(answers[i]) ? answers[i] : null, ok = chosen === x.answer;
        if (ok) correct++;
        return { prompt: x.prompt, choices: x.choices, answer: x.answer, chosen: chosen, correct: ok, skill: x.skill, explanation: x.explanation };
      });
      return { correct: correct, total: qs.length, accuracy: qs.length ? correct / qs.length : 0, review: review };
    }
    static templates(level) { return TEMPLATES[level]; }
  }

  /** Accuracy first, then speed, then who finished first. */
  function compareResults(a, b) {
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    return String(a.finishedAt || '') < String(b.finishedAt || '') ? -1 : 1;
  }

  function hueOf(str) { return Rng.hash(String(str).toLowerCase()) % 360; }
  function fmtDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60);
    return m ? m + ':' + DateUtil.pad(s % 60) : s + ' s';
  }

  return {
    CONFIG: CONFIG, DateUtil: DateUtil, Rng: Rng, Validate: Validate, Habit: Habit, DayEvaluator: DayEvaluator, Stats: Stats,
    Motivation: Motivation, QuizGenerator: QuizGenerator, compareResults: compareResults,
    LEVEL_LABELS: LEVEL_LABELS, FORM_CHOICES: FORM_CHOICES, FORM_DAYS: FORM_DAYS, PERIODS: PERIODS, FREQ_MAX: FREQ_MAX,
    GIFTS: GIFTS, GIFT_MESSAGES: GIFT_MESSAGES, giftById: giftById, SUGGESTIONS: SUGGESTIONS, QUIZ_LEVELS: QUIZ_LEVELS,
    REASSURE: REASSURE, PROJECT: PROJECT, hueOf: hueOf, fmtDuration: fmtDuration
  };
});
