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
    MAX_GOOD: 5,               // up to 5 good habits to gain
    MAX_BAD: 5,                // up to 5 bad habits to lose
    MIN_HABITS: 1,             // at least one habit in total
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
  const KIND_INFO = {
    good: { emoji: '🌱', short: 'To gain', title: 'Good habits to gain', one: 'Good habit to gain', verb: 'gained' },
    bad: { emoji: '🍂', short: 'To lose', title: 'Bad habits to lose', one: 'Bad habit to lose', verb: 'resisted' }
  };
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

    /** 0 to 5 good and 0 to 5 bad (at least 1 in total), all valid, no duplicates. */
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
      if (good.length > CONFIG.MAX_GOOD) return { ok: false, error: 'At most ' + CONFIG.MAX_GOOD + ' good habits.' };
      if (bad.length > CONFIG.MAX_BAD) return { ok: false, error: 'At most ' + CONFIG.MAX_BAD + ' bad habits.' };
      if (good.length + bad.length < CONFIG.MIN_HABITS) return { ok: false, error: 'Choose at least one habit.' };
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
    /** Kept and total, separately for good habits (gained) and bad habits (resisted). */
    static split(habits, details) {
      const out = { good: { kept: 0, total: 0 }, bad: { kept: 0, total: 0 } };
      habits.forEach(function (h) { out[h.kind].total++; });
      (details || []).forEach(function (d) { out[d.habit.kind].kept += d.score; });
      return out;
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
      else if (!this.checkins[date]) res = { date: date, status: 'gray', kept: 0, total: habits.length, ratio: null, byKind: DayEvaluator.split(habits, null) };
      else {
        const self = this;
        const details = habits.map(function (h) { return self.habitDetail(h, date); });
        const kept = details.reduce(function (s, d) { return s + d.score; }, 0);
        const ratio = kept / habits.length;
        res = { date: date, status: ratio > CONFIG.GREEN_THRESHOLD + 1e-9 ? 'green' : 'red', kept: kept, total: habits.length, ratio: ratio, details: details, byKind: DayEvaluator.split(habits, details) };
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
    'A few habits, one day at a time: that is how a new life gets built.',
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
  /*
   * Three friendly levels. Every day the generator draws 5 of the templates of
   * each level at random and gives them new random numbers, from a seed made of
   * the date: the quiz changes every day, and all players get the same one.
   */
  const QUIZ_LEVELS = [
    { id: 1, name: 'Quick maths', topic: 'Mental arithmetic', emoji: '🌱' },
    { id: 2, name: 'Everyday algebra', topic: 'Equations, percentages, proportions', emoji: '🧭' },
    { id: 3, name: 'Shapes & logic', topic: 'Areas, angles, units, patterns', emoji: '🧩' }
  ];
  function n(x) { return x < 0 ? '−' + Math.abs(x) : String(x); }
  function dec(x) { return String(Number(x.toFixed(4))); }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
  function euro(cents) { return (cents / 100).toFixed(2) + ' €'; }
  function clock(min) { min = ((min % 1440) + 1440) % 1440; return DateUtilPad(Math.floor(min / 60)) + ':' + DateUtilPad(min % 60); }
  function DateUtilPad(v) { return (v < 10 ? '0' : '') + v; }
  function frac(a, b) { const g = gcd(a, b) || 1; a /= g; b /= g; return b === 1 ? String(a) : a + '/' + b; }
  function unit(u) { return function (v) { return n(v) + ' ' + u; }; }

  /**
   * Numeric answer + plausible wrong answers (common mistakes) + filler near the answer.
   * step: distance between filler answers (for example 10 cents or 5 minutes).
   */
  function numQ(correct, cands, fmt, positive, step) {
    fmt = fmt || n; step = step || 1;
    const ok = function (v) { return typeof v === 'number' && isFinite(v) && Number.isInteger(v) && v !== correct && (!positive || v > 0); };
    return {
      answer: fmt(correct),
      wrong: cands.filter(ok).map(fmt),
      fill: function (rng, i) {
        const k = Math.ceil(i / 2) * step;
        let v = correct + (i % 2 ? k : -k);
        if (positive && v <= 0) v = correct + k + step;
        return fmt(v);
      }
    };
  }
  function q() { return Object.assign.apply(null, arguments); }

  const TEMPLATES = {
    // ---------------------------------------------------------------- level 1: quick maths
    1: [
      { id: 'add', make: function (r) {
        const a = r.int(23, 89), b = r.int(14, 79), s = a + b, tb = b - b % 10;
        return q(numQ(s, [s + 10, s - 10, s - 1], String, true), {
          prompt: 'What is ' + a + ' + ' + b + '?',
          skill: 'Mental addition: add the tens first, then the units.',
          explanation: a + ' + ' + b + ' = ' + a + ' + ' + tb + ' + ' + (b % 10) + ' = ' + (a + tb) + ' + ' + (b % 10) + ' = ' + s + '.'
        });
      } },
      { id: 'sub', make: function (r) {
        const a = r.int(52, 98), b = r.int(17, a - 11), d = a - b, tb = b - b % 10;
        return q(numQ(d, [d + 10, d - 10, d + 2], String, true), {
          prompt: 'What is ' + a + ' − ' + b + '?',
          skill: 'Mental subtraction: take away the tens first, then the units.',
          explanation: a + ' − ' + tb + ' = ' + (a - tb) + ', then ' + (a - tb) + ' − ' + (b % 10) + ' = ' + d + '.'
        });
      } },
      { id: 'times', make: function (r) {
        const a = r.int(3, 9), b = r.int(4, 12), p = a * b;
        return q(numQ(p, [a * (b + 1), a * (b - 1), (a + 1) * b, a + b], String, true), {
          prompt: 'What is ' + a + ' × ' + b + '?',
          skill: 'Times tables. If you do not know one by heart, split it: 7 × 12 = 7 × 10 + 7 × 2.',
          explanation: b > 10 ? a + ' × ' + b + ' = ' + a + ' × 10 + ' + a + ' × ' + (b - 10) + ' = ' + (a * 10) + ' + ' + (a * (b - 10)) + ' = ' + p + '.'
            : a + ' × ' + b + ' = ' + a + ' × ' + (b - 1) + ' + ' + a + ' = ' + (a * (b - 1)) + ' + ' + a + ' = ' + p + '.'
        });
      } },
      { id: 'divide', make: function (r) {
        const a = r.int(3, 9), v = r.int(4, 12), N = a * v;
        return q(numQ(v, [v + 1, v - 1, v + 2, a], String, true), {
          prompt: 'What is ' + N + ' ÷ ' + a + '?',
          skill: 'Division is the reverse of multiplication: look for the number that, times ' + a + ', gives ' + N + '.',
          explanation: a + ' × ' + v + ' = ' + N + ', so ' + N + ' ÷ ' + a + ' = ' + v + '.'
        });
      } },
      { id: 'priority', make: function (r) {
        const a = r.int(2, 9), b = r.int(2, 6), c = r.int(2, 9), v = a + b * c;
        return q(numQ(v, [(a + b) * c, a * b + c, v + 1], String, true), {
          prompt: 'What is ' + a + ' + ' + b + ' × ' + c + '?',
          skill: 'Order of operations: multiply before you add.',
          explanation: 'First ' + b + ' × ' + c + ' = ' + (b * c) + ', then ' + a + ' + ' + (b * c) + ' = ' + v + '. Not (' + a + ' + ' + b + ') × ' + c + ' = ' + ((a + b) * c) + '.'
        });
      } },
      { id: 'percent', make: function (r) {
        const pc = r.pick([10, 20, 25, 50, 75]), N = r.int(2, 20) * 20, v = N * pc / 100;
        const how = { 10: 'divide by 10', 20: 'divide by 10, then double', 25: 'divide by 4', 50: 'take half', 75: 'take a quarter, then multiply by 3' }[pc];
        return q(numQ(v, [N - v, v * 2, N / 10 + pc, v + 10], String, true), {
          prompt: 'What is ' + pc + '% of ' + N + '?',
          skill: 'Easy percentages: 10% = ÷ 10, 25% = ÷ 4, 50% = half, 75% = three quarters.',
          explanation: 'For ' + pc + '%, ' + how + ': ' + pc + '% of ' + N + ' = ' + v + '.'
        });
      } },
      { id: 'square', make: function (r) {
        const k = r.int(4, 15), v = k * k;
        return q(numQ(v, [2 * k, v + k, v - k, (k + 1) * (k + 1)], String, true), {
          prompt: 'What is ' + k + '²?',
          skill: 'A square is a number times itself: k² = k × k (not 2 × k).',
          explanation: k + '² = ' + k + ' × ' + k + ' = ' + v + '.'
        });
      } },
      { id: 'fraction-of', make: function (r) {
        const d = r.pick([2, 3, 4, 5]), a = r.int(1, d - 1), N = d * r.int(3, 12), v = N / d * a;
        return q(numQ(v, [N / d, N * a, N - v, v + a], String, true), {
          prompt: 'What is ' + a + '/' + d + ' of ' + N + '?',
          skill: 'To take a fraction a/b of a number: divide by b, then multiply by a.',
          explanation: N + ' ÷ ' + d + ' = ' + (N / d) + ', then ' + (N / d) + ' × ' + a + ' = ' + v + '.'
        });
      } },
      { id: 'change', make: function (r) {
        const price = r.int(1, 6) * 100 + r.pick([0, 20, 50, 80]), qty = r.int(2, 4), total = price * qty;
        const note = [1000, 2000, 5000].filter(function (x) { return x > total; })[0], v = note - total;
        const item = r.pick(['notebooks', 'coffees', 'croissants', 'tickets', 'pens']);
        return q(numQ(v, [note - price, v + 100, v - 100, v + 50], euro, true, 10), {
          prompt: 'You buy ' + qty + ' ' + item + ' at ' + euro(price) + ' each and pay with a ' + (note / 100) + ' € note. How much change do you get?',
          skill: 'Money: work out the total first, then subtract it from what you paid.',
          explanation: 'Total: ' + qty + ' × ' + euro(price) + ' = ' + euro(total) + '. Change: ' + euro(note) + ' − ' + euro(total) + ' = ' + euro(v) + '.'
        });
      } },
      { id: 'time', make: function (r) {
        const start = r.int(13, 21) * 60 + r.pick([0, 10, 15, 20, 30, 40, 45, 50]), dur = r.int(1, 2) * 60 + r.pick([5, 15, 25, 35, 40, 50]), end = start + dur;
        const what = r.pick(['A film', 'A match', 'A train journey', 'A concert']);
        return q(numQ(end, [end + 60, end - 60, end + 10, end - 10], clock, true, 5), {
          prompt: what + ' starts at ' + clock(start) + ' and lasts ' + Math.floor(dur / 60) + ' h ' + (dur % 60) + ' min. When does it end?',
          skill: 'Durations: add the hours, then the minutes; 60 minutes make one more hour.',
          explanation: clock(start) + ' + ' + Math.floor(dur / 60) + ' h = ' + clock(start + Math.floor(dur / 60) * 60) + ', then + ' + (dur % 60) + ' min = ' + clock(end) + '.'
        });
      } }
    ],
    // ---------------------------------------------------------------- level 2: everyday algebra
    2: [
      { id: 'eq-add', make: function (r) {
        const x = r.int(3, 40), a = r.int(5, 30), b = x + a;
        return q(numQ(x, [b + a, a, x + 10], function (v) { return 'x = ' + n(v); }), {
          prompt: 'Solve: x + ' + a + ' = ' + b,
          skill: 'To undo "+ a", subtract a from both sides.',
          explanation: 'x = ' + b + ' − ' + a + ' = ' + x + '.'
        });
      } },
      { id: 'eq-mul', make: function (r) {
        const a = r.int(2, 6), x = r.int(2, 10), b = r.int(1, 15), c = a * x + b;
        return q(numQ(x, [(c + b) / a, c - b, x + 1, c / a], function (v) { return 'x = ' + n(v); }), {
          prompt: 'Solve: ' + a + 'x + ' + b + ' = ' + c,
          skill: 'Undo the operations in reverse order: first subtract, then divide.',
          explanation: a + 'x = ' + c + ' − ' + b + ' = ' + (c - b) + ', so x = ' + (c - b) + ' ÷ ' + a + ' = ' + x + '.'
        });
      } },
      { id: 'evaluate', make: function (r) {
        const a = r.int(2, 7), b = r.nonZero(-9, 9), x = r.int(2, 9), v = a * x + b;
        const expr = a + 'x ' + (b < 0 ? '− ' : '+ ') + Math.abs(b);
        return q(numQ(v, [a + x + b, a * x - b, a * (x + b)]), {
          prompt: 'What is ' + expr + ' when x = ' + x + '?',
          skill: 'Replace x by its value, then follow the order of operations.',
          explanation: a + ' × ' + x + ' ' + (b < 0 ? '− ' : '+ ') + Math.abs(b) + ' = ' + (a * x) + ' ' + (b < 0 ? '− ' : '+ ') + Math.abs(b) + ' = ' + n(v) + '.'
        });
      } },
      { id: 'proportion', make: function (r) {
        const u = r.pick([40, 50, 60, 75, 80, 120, 150]), n1 = r.int(2, 5), n2 = r.int(n1 + 1, 10), item = r.pick(['croissants', 'apples', 'bus tickets', 'postcards']);
        const v = n2 * u;
        return q(numQ(v, [n1 * u + (n2 - n1) * 100, v + u, v - u], euro, true, 10), {
          prompt: n1 + ' ' + item + ' cost ' + euro(n1 * u) + '. How much do ' + n2 + ' cost?',
          skill: 'Proportionality: find the price of one, then multiply.',
          explanation: 'One costs ' + euro(n1 * u) + ' ÷ ' + n1 + ' = ' + euro(u) + ', so ' + n2 + ' cost ' + n2 + ' × ' + euro(u) + ' = ' + euro(v) + '.'
        });
      } },
      { id: 'speed', make: function (r) {
        const v = r.pick([40, 50, 60, 70, 80, 90, 100, 120]), t = r.pick([0.5, 1.5, 2, 2.5, 3]), d = v * t;
        const tTxt = t === 0.5 ? '30 min' : Math.floor(t) + ' h' + (t % 1 ? ' 30 min' : '');
        return q(numQ(d, [v * Math.floor(t) + 30, d + v / 2, d - 10, v + 30], unit('km'), true, 5), {
          prompt: 'A car drives at ' + v + ' km/h for ' + tTxt + '. How far does it go?',
          skill: 'Distance = speed × time, with the time in hours (30 min = 0.5 h).',
          explanation: tTxt + ' = ' + dec(t) + ' h, so ' + v + ' × ' + dec(t) + ' = ' + d + ' km.'
        });
      } },
      { id: 'average', make: function (r) {
        const m = r.int(8, 15), a = m + r.int(-4, 4), b = m + r.int(-4, 4), c = m + r.int(-4, 4), d = 4 * m - a - b - c;
        return q(numQ(m, [m + 1, m - 1, Math.round((a + b + c + d) / 3)], String, true), {
          prompt: 'Your marks are ' + [a, b, c, d].join(', ') + '. What is your average?',
          skill: 'Average = sum of the values ÷ number of values.',
          explanation: '(' + [a, b, c, d].join(' + ') + ') ÷ 4 = ' + (4 * m) + ' ÷ 4 = ' + m + '.'
        });
      } },
      { id: 'discount', make: function (r) {
        const P = r.int(4, 20) * 10, pc = r.pick([10, 20, 25, 30, 50]), v = P * (100 - pc);
        return q(numQ(v, [P * pc, P * 100 - pc * 100, P * (100 + pc)], euro, true, 100), {
          prompt: 'A jacket costs ' + P + ' €. It is ' + pc + '% off. What is the new price?',
          skill: 'A discount of p%: compute p% of the price, then subtract it.',
          explanation: pc + '% of ' + P + ' € = ' + euro(P * pc) + ', so ' + P + ' € − ' + euro(P * pc) + ' = ' + euro(v) + '.'
        });
      } },
      { id: 'sequence', make: function (r) {
        const a = r.int(1, 20), d = r.pick([-5, -4, -3, -2, 2, 3, 4, 5, 6, 7]), t = [0, 1, 2, 3].map(function (i) { return a + i * d; }), v = a + 4 * d;
        return q(numQ(v, [v + 1, v + d, v - 2 * d]), {
          prompt: 'What comes next: ' + t.map(n).join(', ') + ', …?',
          skill: 'Arithmetic sequence: find the step between two terms, then add it again.',
          explanation: 'Each term ' + (d > 0 ? 'adds ' + d : 'subtracts ' + (-d)) + ', so ' + n(t[3]) + (d > 0 ? ' + ' + d : ' − ' + (-d)) + ' = ' + n(v) + '.'
        });
      } },
      { id: 'negatives', make: function (r) {
        if (r.next() < 0.5) {
          const a = r.int(-15, -2), b = r.int(3, 20), v = a + b;
          return q(numQ(v, [-v, Math.abs(a) + b, a - b]), {
            prompt: 'What is ' + n(a) + ' + ' + b + '?',
            skill: 'Adding a positive number to a negative one: move right on the number line.',
            explanation: 'Start at ' + n(a) + ' and move ' + b + ' to the right: ' + n(v) + '.'
          });
        }
        const a = r.int(-9, -2), b = r.nonZero(-9, 9), v = a * b;
        return q(numQ(v, [-v, a + b, v + 1]), {
          prompt: 'What is ' + n(a) + ' × ' + (b < 0 ? '(' + n(b) + ')' : b) + '?',
          skill: 'Signs: minus × minus = plus, minus × plus = minus.',
          explanation: Math.abs(a) + ' × ' + Math.abs(b) + ' = ' + Math.abs(v) + ', and the sign is ' + (v > 0 ? 'plus (two minus signs)' : 'minus (one minus sign)') + ': ' + n(v) + '.'
        });
      } }
    ],
    // ---------------------------------------------------------------- level 3: shapes & logic
    3: [
      { id: 'rect-area', make: function (r) {
        const L = r.int(4, 15), W = r.int(2, L - 1);
        return q(numQ(L * W, [2 * (L + W), L + W, L * W + L], unit('m²'), true), {
          prompt: 'A room is ' + L + ' m long and ' + W + ' m wide. What is its area?',
          skill: 'Area of a rectangle = length × width (in square units).',
          explanation: L + ' × ' + W + ' = ' + (L * W) + ' m².'
        });
      } },
      { id: 'perimeter', make: function (r) {
        const L = r.int(4, 15), W = r.int(2, L - 1), v = 2 * (L + W);
        return q(numQ(v, [L * W, L + W, 2 * L + W], unit('m'), true), {
          prompt: 'A garden is ' + L + ' m long and ' + W + ' m wide. How much fence goes all around it?',
          skill: 'Perimeter of a rectangle = 2 × (length + width): the distance all around.',
          explanation: '2 × (' + L + ' + ' + W + ') = 2 × ' + (L + W) + ' = ' + v + ' m.'
        });
      } },
      { id: 'triangle-area', make: function (r) {
        const b = r.int(2, 9) * 2, hh = r.int(3, 12), v = b * hh / 2;
        return q(numQ(v, [b * hh, b + hh, v + hh], unit('cm²'), true), {
          prompt: 'A triangle has a base of ' + b + ' cm and a height of ' + hh + ' cm. What is its area?',
          skill: 'Area of a triangle = base × height ÷ 2.',
          explanation: b + ' × ' + hh + ' = ' + (b * hh) + ', then ÷ 2 = ' + v + ' cm².'
        });
      } },
      { id: 'angles', make: function (r) {
        const a = r.int(25, 85), b = r.int(20, 150 - a), v = 180 - a - b;
        return q(numQ(v, [360 - a - b, 180 - a, v + 10], function (x) { return x + '°'; }, true, 5), {
          prompt: 'Two angles of a triangle measure ' + a + '° and ' + b + '°. What is the third angle?',
          skill: 'The three angles of a triangle always add up to 180°.',
          explanation: '180 − ' + a + ' − ' + b + ' = ' + v + '°.'
        });
      } },
      { id: 'pythagoras', make: function (r) {
        const t = r.pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17], [12, 16, 20]]), k = r.next() < 0.5, a = k ? t[0] : t[1], b = k ? t[1] : t[0], c = t[2];
        return q(numQ(c, [a + b, c + 1, c - 1, a * b / 2], unit('cm'), true), {
          prompt: 'A right triangle has two short sides of ' + a + ' cm and ' + b + ' cm. How long is the longest side?',
          skill: 'Pythagoras: in a right triangle, longest side² = side₁² + side₂².',
          explanation: a + '² + ' + b + '² = ' + (a * a) + ' + ' + (b * b) + ' = ' + (c * c) + ', and √' + (c * c) + ' = ' + c + ' cm.'
        });
      } },
      { id: 'cube', make: function (r) {
        const s = r.int(2, 6), v = s * s * s;
        return q(numQ(v, [3 * s, s * s, 6 * s * s], unit('cm³'), true), {
          prompt: 'What is the volume of a cube with ' + s + ' cm sides?',
          skill: 'Volume of a cube = side × side × side.',
          explanation: s + ' × ' + s + ' × ' + s + ' = ' + v + ' cm³.'
        });
      } },
      { id: 'circle', make: function (r) {
        const rad = r.int(2, 10), v = 3 * rad * rad;
        return q(numQ(v, [6 * rad, 12 * rad * rad, 3 * rad], unit('cm²'), true), {
          prompt: 'Taking π ≈ 3, what is the area of a circle of radius ' + rad + ' cm?',
          skill: 'Area of a disc = π × radius² (and its perimeter is 2 × π × radius).',
          explanation: '3 × ' + rad + '² = 3 × ' + (rad * rad) + ' = ' + v + ' cm².'
        });
      } },
      { id: 'units', make: function (r) {
        const c = r.pick([{ a: 'km', b: 'm', f: 1000 }, { a: 'm', b: 'cm', f: 100 }, { a: 'L', b: 'mL', f: 1000 }, { a: 'h', b: 'min', f: 60 }, { a: 'kg', b: 'g', f: 1000 }]);
        const x = r.int(2, 9) + r.pick([0, 0.5]), v = Math.round(x * c.f);
        return q(numQ(v, [v / 10, v * 10, Math.round(x * 100)], unit(c.b), true, c.f === 60 ? 15 : c.f / 10), {
          prompt: 'How many ' + c.b + ' are there in ' + dec(x) + ' ' + c.a + '?',
          skill: 'Unit conversion: 1 km = 1000 m, 1 m = 100 cm, 1 L = 1000 mL, 1 kg = 1000 g, 1 h = 60 min.',
          explanation: '1 ' + c.a + ' = ' + c.f + ' ' + c.b + ', so ' + dec(x) + ' × ' + c.f + ' = ' + v + ' ' + c.b + '.'
        });
      } },
      { id: 'marbles', make: function (r) {
        const cols = [['red', r.int(1, 6)], ['blue', r.int(1, 6)], ['green', r.int(1, 5)]], T = cols[0][1] + cols[1][1] + cols[2][1];
        const pick = r.int(0, 2), x = cols[pick][1], other = cols[(pick + 1) % 3][1];
        const ans = frac(x, T);
        const pool = [frac(x, T - x), frac(other, T), '1/3', frac(x + 1, T), frac(Math.max(1, x - 1), T), '1/2', '1/4'];
        return {
          prompt: 'A bag holds ' + cols.map(function (c) { return c[1] + ' ' + c[0]; }).join(', ') + ' marbles. You pick one without looking. What is the probability it is ' + cols[pick][0] + '?',
          answer: ans, wrong: pool.filter(function (s) { return s !== ans && s !== '0' && s !== '1'; }),
          fill: function (rng, i) { return frac(i, T + i); },
          skill: 'Probability = number of favourable outcomes ÷ total number of outcomes.',
          explanation: 'There are ' + x + ' ' + cols[pick][0] + ' marbles out of ' + T + ', so ' + x + '/' + T + (ans !== x + '/' + T ? ' = ' + ans : '') + '.'
        };
      } },
      { id: 'pattern', make: function (r) {
        const a = r.int(1, 5), k = r.pick([2, 3]), t = [0, 1, 2, 3].map(function (i) { return a * Math.pow(k, i); }), v = t[3] * k;
        return q(numQ(v, [t[3] + (t[3] - t[2]), v + k, t[3] + k], String, true), {
          prompt: 'What comes next: ' + t.join(', ') + ', …?',
          skill: 'Look at how you go from one term to the next: here you multiply by the same number each time.',
          explanation: 'Each term is multiplied by ' + k + ', so ' + t[3] + ' × ' + k + ' = ' + v + '.'
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
    static daily(date, level) { return QuizGenerator.generate(level, 'daily|' + date + '|' + level + '|v2'); }
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
    LEVEL_LABELS: LEVEL_LABELS, KIND_INFO: KIND_INFO, FORM_CHOICES: FORM_CHOICES, FORM_DAYS: FORM_DAYS, PERIODS: PERIODS, FREQ_MAX: FREQ_MAX,
    GIFTS: GIFTS, GIFT_MESSAGES: GIFT_MESSAGES, giftById: giftById, SUGGESTIONS: SUGGESTIONS, QUIZ_LEVELS: QUIZ_LEVELS,
    REASSURE: REASSURE, PROJECT: PROJECT, hueOf: hueOf, fmtDuration: fmtDuration
  };
});
