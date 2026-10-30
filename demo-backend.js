/* Demo backend: the real server classes running in the browser. Not used once config.js has an API_URL. */
/*
 * Habit Grid backend: object-oriented services.
 *
 * Pure JavaScript, no Google API in this file. Everything platform-specific
 * (Sheets, Forms, Mail, Cache, Lock, crypto, clock) is injected through an
 * `adapters` object, so the exact same classes run:
 *   - in Google Apps Script (adapters in Main.gs),
 *   - in the browser demo (in-memory adapters),
 *   - in the Node test suite.
 *
 * Privacy rules enforced here:
 *   - other players only ever see username, colour, join date and statistics;
 *     never an email address, habit text or gift message;
 *   - session tokens and login codes are stored as salted SHA-256 hashes;
 *   - every write is re-validated on the server (30-day lock, 2-day window).
 */

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; this.userFacing = true; }
}

const TABLES = {
  users: ['id', 'email', 'username', 'usernameKey', 'status', 'createdAt', 'joinedAt', 'habits', 'lockedUntil', 'hue', 'emailOptIn', 'extraEmails', 'form', 'lastSeenAt'],
  sessions: ['tokenHash', 'userId', 'createdAt', 'lastUsedAt'],
  codes: ['email', 'codeHash', 'expiresAt', 'attempts', 'createdAt'],
  checkins: ['userId', 'date', 'levels', 'source', 'updatedAt'],
  gifts: ['id', 'fromId', 'toId', 'gift', 'message', 'day', 'createdAt', 'seenAt'],
  quiz: ['id', 'userId', 'date', 'level', 'startedAt', 'finishedAt', 'answers', 'correct', 'total', 'timeMs', 'perQuestionMs']
};

function parseJson(s, fallback) { if (!s) return fallback; try { return JSON.parse(s); } catch (e) { return fallback; } }

// ====================================================================== repositories

/** Base repository: loads a table once per request and keeps rows in memory. */
class Repository {
  constructor(table) { this.table = table; this.cache = null; }
  rows() { if (!this.cache) this.cache = this.table.all(); return this.cache; }
  insert(obj) { const rows = this.rows(); const row = this.table.insert(obj); rows.push(row); return row; }
  save(row) { this.table.update(row); }
  remove(row) { this.table.remove(row); this.cache = null; }
  /** Sheet rows shift when one is deleted, so delete from the bottom up. */
  removeMany(rows) {
    rows.slice().sort(function (a, b) { return (b.__row || 0) - (a.__row || 0); }).forEach(function (r) { this.table.remove(r); }, this);
    this.cache = null;
  }
}

class User {
  constructor(row) {
    this.row = row;
    this.id = row.id;
    this.email = row.email;
    this.username = row.username || '';
    this.status = row.status || 'pending';
    this.createdAt = row.createdAt;
    this.joinedAt = row.joinedAt || '';
    this.habits = parseJson(row.habits, []).map(function (h) { return new HG.Habit(h); });
    this.lockedUntil = row.lockedUntil || '';
    this.hue = Number(row.hue) || 0;
    this.emailOptIn = row.emailOptIn !== 'false';
    this.extraEmails = parseJson(row.extraEmails, []);
    this.form = parseJson(row.form, null);
    this.lastSeenAt = row.lastSeenAt || '';
  }
  isActive() { return this.status === 'active'; }
  isLocked(today) { return !!this.lockedUntil && today < this.lockedUntil; }
  activeHabits(date) { return this.habits.filter(function (h) { return h.activeOn(date); }); }
  toRow() {
    const r = this.row;
    r.email = this.email; r.username = this.username; r.usernameKey = this.username.toLowerCase(); r.status = this.status;
    r.joinedAt = this.joinedAt; r.habits = JSON.stringify(this.habits); r.lockedUntil = this.lockedUntil; r.hue = String(this.hue);
    r.emailOptIn = String(this.emailOptIn); r.extraEmails = JSON.stringify(this.extraEmails); r.form = this.form ? JSON.stringify(this.form) : '';
    r.lastSeenAt = this.lastSeenAt;
    return r;
  }
  /** What the owner sees about themselves. */
  selfView() {
    return {
      id: this.id, email: this.email, username: this.username, status: this.status, joinedAt: this.joinedAt, hue: this.hue,
      lockedUntil: this.lockedUntil, emailOptIn: this.emailOptIn, extraEmails: this.extraEmails
    };
  }
  /** What everybody else may see. */
  publicCard() { return { id: this.id, username: this.username, hue: this.hue, joinedAt: this.joinedAt }; }
}

class UserRepository extends Repository {
  all() { return this.rows().map(function (r) { return new User(r); }); }
  active() { return this.all().filter(function (u) { return u.isActive(); }); }
  byId(id) { const r = this.rows().find(function (x) { return x.id === id; }); return r ? new User(r) : null; }
  byEmail(email) { const r = this.rows().find(function (x) { return x.email === email; }); return r ? new User(r) : null; }
  byUsername(name) { const k = String(name).toLowerCase(); const r = this.rows().find(function (x) { return x.usernameKey === k; }); return r ? new User(r) : null; }
  /** Finds the owner of a Google Form, by its response sheet or by the form id. */
  byForm(ref) {
    const r = this.rows().find(function (x) {
      const f = parseJson(x.form, null);
      return f && (ref.sheetId != null && String(f.sheetId) === String(ref.sheetId) || ref.formId && f.id === ref.formId);
    });
    return r ? new User(r) : null;
  }
  create(email, id, now) {
    return new User(this.insert({ id: id, email: email, username: '', usernameKey: '', status: 'pending', createdAt: now, joinedAt: '', habits: '[]', lockedUntil: '', hue: '0', emailOptIn: 'true', extraEmails: '[]', form: '', lastSeenAt: now }));
  }
  saveUser(u) { this.save(u.toRow()); }
}

class SessionRepository extends Repository {
  constructor(table, crypto) { super(table); this.crypto = crypto; }
  create(userId, now) {
    const token = this.crypto.token();
    this.insert({ tokenHash: this.crypto.hash('session|' + token), userId: userId, createdAt: now, lastUsedAt: now });
    return token;
  }
  find(token) {
    if (!token || typeof token !== 'string' || token.length < 20) return null;
    const h = this.crypto.hash('session|' + token);
    return this.rows().find(function (r) { return r.tokenHash === h; }) || null;
  }
}

class CodeRepository extends Repository {
  constructor(table, crypto) { super(table); this.crypto = crypto; }
  forEmail(email) { return this.rows().filter(function (r) { return r.email === email; }); }
  issue(email, nowMs) {
    const recent = this.forEmail(email).filter(function (r) { return Number(r.createdAt) > nowMs - 3600000; });
    if (recent.length >= 5) throw new AppError('rate_limited', 'Too many codes requested. Try again in an hour.');
    const code = this.crypto.digits(6);
    this.insert({ email: email, codeHash: this.crypto.hash('code|' + email + '|' + code), expiresAt: String(nowMs + 15 * 60000), attempts: '0', createdAt: String(nowMs) });
    return code;
  }
  verify(email, code, nowMs) {
    const live = this.forEmail(email).filter(function (r) { return Number(r.expiresAt) > nowMs; });
    if (!live.length) throw new AppError('code_expired', 'This code expired. Ask for a new one.');
    const row = live[live.length - 1];
    const attempts = Number(row.attempts) + 1;
    if (attempts > 5) throw new AppError('code_locked', 'Too many wrong attempts. Ask for a new code.');
    row.attempts = String(attempts);
    this.save(row);
    if (row.codeHash !== this.crypto.hash('code|' + email + '|' + code)) throw new AppError('code_wrong', 'Wrong code. Check the latest email.');
    this.removeMany(this.forEmail(email));
  }
  prune(nowMs) {
    this.removeMany(this.rows().filter(function (r) { return Number(r.expiresAt) < nowMs - 86400000; }));
  }
}

class CheckinRepository extends Repository {
  forUser(userId) {
    const out = {};
    this.rows().forEach(function (r) { if (r.userId === userId) out[r.date] = parseJson(r.levels, {}); });
    return out;
  }
  byUser() {
    const out = {};
    this.rows().forEach(function (r) { (out[r.userId] = out[r.userId] || {})[r.date] = parseJson(r.levels, {}); });
    return out;
  }
  upsert(userId, date, levels, source, now) {
    const row = this.rows().find(function (r) { return r.userId === userId && r.date === date; });
    if (row) {
      const merged = Object.assign(parseJson(row.levels, {}), levels);
      row.levels = JSON.stringify(merged); row.source = source; row.updatedAt = now;
      this.save(row);
      return merged;
    }
    this.insert({ userId: userId, date: date, levels: JSON.stringify(levels), source: source, updatedAt: now });
    return levels;
  }
}

class GiftRepository extends Repository {
  sentOn(fromId, date) { return this.rows().filter(function (r) { return r.fromId === fromId && r.day === date; }); }
  forRecipient(toId) { return this.rows().filter(function (r) { return r.toId === toId; }); }
  countsByRecipient() { const c = {}; this.rows().forEach(function (r) { c[r.toId] = (c[r.toId] || 0) + 1; }); return c; }
}

class QuizRepository extends Repository {
  find(userId, date, level) { return this.rows().find(function (r) { return r.userId === userId && r.date === date && String(r.level) === String(level); }) || null; }
  byId(id) { return this.rows().find(function (r) { return r.id === id; }) || null; }
  finished() { return this.rows().filter(function (r) { return !!r.finishedAt; }); }
}

// ====================================================================== services

/** Login with a 6-digit code sent by email. No passwords stored anywhere. */
class AuthService {
  constructor(app) { this.app = app; }
  requestCode(data) {
    const v = HG.Validate.email(data.email);
    if (!v.ok) throw new AppError('bad_email', v.error);
    const app = this.app, existing = app.users.byEmail(v.value);
    const invite = String(app.settings.get('INVITE_CODE') || '').trim();
    if (invite && !(existing && existing.isActive()) && String(data.invite || '').trim().toLowerCase() !== invite.toLowerCase()) {
      throw new AppError('bad_invite', 'This invite code is not valid.');
    }
    const code = app.codes.issue(v.value, app.clock.now());
    app.mailer.sendCode(v.value, code);
    return { sent: true, demoCode: app.adapters.revealCodes ? code : undefined };
  }
  verifyCode(data) {
    const v = HG.Validate.email(data.email), c = HG.Validate.code(data.code);
    if (!v.ok) throw new AppError('bad_email', v.error);
    if (!c.ok) throw new AppError('bad_code', c.error);
    const app = this.app;
    app.codes.verify(v.value, c.value, app.clock.now());
    let user = app.users.byEmail(v.value);
    if (!user) user = app.users.create(v.value, 'u' + app.crypto.token().slice(0, 12), app.clock.iso());
    const token = app.sessions.create(user.id, app.clock.iso());
    return { token: token, user: user.selfView() };
  }
  authenticate(token) {
    const s = this.app.sessions.find(token);
    if (!s) throw new AppError('auth', 'Please sign in again.');
    const user = this.app.users.byId(s.userId);
    if (!user) throw new AppError('auth', 'Please sign in again.');
    return { user: user, session: s };
  }
  logout(ctx) { this.app.sessions.remove(ctx.session); return { ok: true }; }
}

/** Username, the 10 habits, the 30-day lock, preferences. */
class ProfileService {
  constructor(app) { this.app = app; }
  checkUsername(user, data) {
    const v = HG.Validate.username(data.username);
    if (!v.ok) return { available: false, error: v.error };
    const other = this.app.users.byUsername(v.value);
    return other && other.id !== user.id ? { available: false, error: 'This name is taken.' } : { available: true };
  }
  completeOnboarding(user, data) {
    const app = this.app, today = app.clock.today();
    if (user.isActive()) throw new AppError('already_active', 'Your account is already set up.');
    const name = this.checkUsername(user, data);
    if (!name.available) throw new AppError('bad_username', name.error);
    const set = HG.Habit.validateSet(data.habits);
    if (!set.ok) throw new AppError('bad_habits', set.error);
    user.username = HG.Validate.username(data.username).value;
    user.habits = set.value.map(function (h, i) { h.id = 'h' + (i + 1); h.createdAt = today; return h; });
    user.joinedAt = today;
    user.lockedUntil = HG.DateUtil.add(today, HG.CONFIG.LOCK_DAYS);
    user.hue = HG.hueOf(user.username);
    user.status = 'active';
    user.form = app.forms.createForUser(user, user.activeHabits(today));
    app.users.saveUser(user);
    app.community.invalidate();
    return app.dashboard.me(user);
  }
  updateHabits(user, data) {
    const app = this.app, today = app.clock.today();
    if (!user.isActive()) throw new AppError('not_active', 'Finish your setup first.');
    if (user.isLocked(today)) throw new AppError('locked', 'Your habits are locked until ' + HG.DateUtil.format(user.lockedUntil, 'long') + '. That was the deal.');
    const set = HG.Habit.validateSet(data.habits);
    if (!set.ok) throw new AppError('bad_habits', set.error);
    const current = user.activeHabits(today);
    let next = user.habits.length + 1;
    const kept = [];
    set.value.forEach(function (h) {
      const same = current.find(function (c) { return c.id === h.id && c.sameContent(h); });
      if (same) { kept.push(same.id); return; }
      h.id = 'h' + (next++); h.createdAt = today;
      user.habits.push(h);
    });
    current.forEach(function (c) { if (kept.indexOf(c.id) < 0) c.archivedAt = today; });
    user.lockedUntil = HG.DateUtil.add(today, HG.CONFIG.LOCK_DAYS);
    user.form = app.forms.rebuild(user, user.activeHabits(today));
    app.users.saveUser(user);
    app.community.invalidate();
    return app.dashboard.me(user);
  }
  updatePrefs(user, data) {
    if (typeof data.emailOptIn === 'boolean') user.emailOptIn = data.emailOptIn;
    if (Array.isArray(data.extraEmails)) {
      const list = [];
      data.extraEmails.slice(0, 3).forEach(function (e) {
        if (!String(e || '').trim()) return;
        const v = HG.Validate.email(e);
        if (!v.ok) throw new AppError('bad_email', '"' + e + '" is not a valid email.');
        if (list.indexOf(v.value) < 0 && v.value !== user.email) list.push(v.value);
      });
      user.extraEmails = list;
    }
    this.app.users.saveUser(user);
    return { user: user.selfView() };
  }
}

/** Google Form submissions become check-ins here (and the demo's simulated form). */
class CheckinService {
  constructor(app) { this.app = app; }
  /** levelsByHabit: { habitId: 0|1|2 }. offset: 0 today, 1 yesterday, 2 the day before. */
  apply(user, offset, levelsByHabit, source) {
    const app = this.app, today = app.clock.today();
    if (!user.isActive()) throw new AppError('not_active', 'Finish your setup first.');
    if (!(offset >= 0 && offset <= HG.CONFIG.EDIT_WINDOW_DAYS)) throw new AppError('bad_day', 'Only today and the 2 previous days can be logged.');
    const date = HG.DateUtil.add(today, -offset);
    if (date < user.joinedAt) throw new AppError('bad_day', 'You had not started yet on that day.');
    const allowed = {};
    user.activeHabits(date).forEach(function (h) { allowed[h.id] = true; });
    const clean = {};
    Object.keys(levelsByHabit || {}).forEach(function (id) {
      const l = Number(levelsByHabit[id]);
      if (allowed[id] && (l === 0 || l === 1 || l === 2)) clean[id] = l;
    });
    if (!Object.keys(clean).length) throw new AppError('empty', 'Nothing to log.');
    const levels = app.checkins.upsert(user.id, date, clean, source, app.clock.iso());
    app.community.invalidate();
    return { date: date, levels: levels };
  }
  /** Called by the Apps Script trigger with the form's answers keyed by question title. */
  applyFormResponse(ref, namedValues) {
    const app = this.app, user = app.users.byForm(ref);
    if (!user || !user.form) return { ignored: 'unknown form' };
    const get = function (title) { const v = namedValues[title]; return Array.isArray(v) ? String(v[0] || '') : String(v || ''); };
    if (get(user.form.keyTitle).trim() !== user.form.key) return { ignored: 'wrong key' };
    const offset = HG.FORM_DAYS.indexOf(get(user.form.dayTitle));
    const levels = {};
    Object.keys(user.form.map).forEach(function (title) {
      const idx = HG.FORM_CHOICES.indexOf(get(title));
      if (idx >= 0) levels[user.form.map[title]] = 2 - idx;
    });
    return this.apply(user, offset, levels, 'form');
  }
}

/** Everything the owner's dashboard needs. The phone computes colours with the shared core. */
class DashboardService {
  constructor(app) { this.app = app; }
  me(user) {
    const app = this.app, today = app.clock.today();
    if (!user.isActive()) return { user: user.selfView(), today: today };
    const from = HG.DateUtil.add(today, -HG.CONFIG.HISTORY_DAYS);
    const all = app.checkins.forUser(user.id), checkins = {};
    Object.keys(all).forEach(function (d) { if (d >= from) checkins[d] = all[d]; });
    const gifts = app.gifts.forRecipient(user.id).slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    const people = {};
    const card = function (id) { if (!people[id]) { const u = app.users.byId(id); people[id] = u ? u.publicCard() : { id: id, username: 'Someone', hue: 0 }; } return people[id]; };
    const view = function (g) { return { id: g.id, gift: g.gift, message: g.message, createdAt: g.createdAt, seen: !!g.seenAt, from: card(g.fromId) }; };
    if (!user.lastSeenAt || app.clock.now() - Date.parse(user.lastSeenAt) > 3600000) { user.lastSeenAt = app.clock.iso(); app.users.saveUser(user); }
    return {
      user: user.selfView(), today: today, habits: user.habits.map(function (h) { return h.toJSON(); }), checkins: checkins,
      gifts: { unseen: gifts.filter(function (g) { return !g.seenAt; }).map(view), recent: gifts.slice(0, 12).map(view), total: gifts.length },
      form: user.form ? { links: user.form.links, url: user.form.url } : null
    };
  }
}

/** Public, privacy-safe view of all players. Cached because every phone asks for it. */
class CommunityService {
  constructor(app) { this.app = app; }
  invalidate() { this.app.cache.remove('community:v1'); }
  snapshot() {
    const app = this.app, today = app.clock.today();
    const cached = app.cache.get('community:v1');
    if (cached) { const c = JSON.parse(cached); if (c.today === today) return c; }
    const checkins = app.checkins.byUser(), giftCounts = app.gifts.countsByRecipient();
    const players = app.users.active().map(function (u) {
      const ev = new HG.DayEvaluator(u.habits, checkins[u.id] || {}, u.joinedAt);
      const s = HG.Stats.of(ev, today);
      const grid = [];
      for (let d = HG.DateUtil.add(today, -83); d <= today; d = HG.DateUtil.add(d, 1)) grid.push(ev.day(d, today).status);
      return Object.assign(u.publicCard(), {
        streak: s.streak, best: s.best, regularity: s.regularity, greenRate: s.greenRate, monthGreen: s.monthGreen,
        kept7: s.kept7, possible7: s.possible7, todayStatus: s.today, strip: s.strip, grid: grid, gifts: giftCounts[u.id] || 0
      });
    });
    const snap = { today: today, players: players };
    app.cache.put('community:v1', JSON.stringify(snap), 300);
    return snap;
  }
  list(user) {
    const snap = this.snapshot(), sentToday = this.app.gifts.sentOn(user.id, snap.today).map(function (g) { return g.toId; });
    return {
      today: snap.today,
      players: snap.players.map(function (p) {
        const o = Object.assign({}, p, { isYou: p.id === user.id, giftedToday: sentToday.indexOf(p.id) >= 0 });
        delete o.grid;
        return o;
      })
    };
  }
  player(user, data) {
    const snap = this.snapshot(), p = snap.players.find(function (x) { return x.id === data.id; });
    if (!p) throw new AppError('not_found', 'This player does not exist.');
    const sentToday = this.app.gifts.sentOn(user.id, snap.today).some(function (g) { return g.toId === p.id; });
    return Object.assign({}, p, { isYou: p.id === user.id, giftedToday: sentToday, today: snap.today });
  }
}

/** Encouragements with a little gift. */
class GiftService {
  constructor(app) { this.app = app; }
  send(user, data) {
    const app = this.app, today = app.clock.today();
    if (!user.isActive()) throw new AppError('not_active', 'Finish your setup first.');
    const to = app.users.byId(data.toId);
    if (!to || !to.isActive()) throw new AppError('not_found', 'This player does not exist.');
    if (to.id === user.id) throw new AppError('self', 'Gifts are for the others. You are doing great, though.');
    if (!HG.giftById(data.gift)) throw new AppError('bad_gift', 'Pick a gift.');
    const message = HG.Validate.text(data.message, HG.CONFIG.MESSAGE_MAX);
    const sent = app.gifts.sentOn(user.id, today);
    if (sent.some(function (g) { return g.toId === to.id; })) throw new AppError('already', 'You already sent ' + to.username + ' a gift today. Come back tomorrow.');
    if (sent.length >= HG.CONFIG.GIFTS_PER_DAY) throw new AppError('limit', 'That is ' + HG.CONFIG.GIFTS_PER_DAY + ' gifts today. Generous! More tomorrow.');
    app.gifts.insert({ id: 'g' + app.crypto.token().slice(0, 12), fromId: user.id, toId: to.id, gift: data.gift, message: message, day: today, createdAt: app.clock.iso(), seenAt: '' });
    app.community.invalidate();
    return { sent: true, to: to.publicCard() };
  }
  markSeen(user, data) {
    const ids = Array.isArray(data.ids) ? data.ids : [], now = this.app.clock.iso(), app = this.app;
    app.gifts.forRecipient(user.id).forEach(function (g) {
      if (ids.indexOf(g.id) >= 0 && !g.seenAt) { g.seenAt = now; app.gifts.save(g); }
    });
    return { ok: true };
  }
}

/** "Stay awake": daily math puzzles. Questions and timing live on the server, so no peeking. */
class QuizService {
  constructor(app) { this.app = app; }
  result(row) {
    const total = Number(row.total) || HG.CONFIG.QUIZ_QUESTIONS, correct = Number(row.correct) || 0;
    return { correct: correct, total: total, accuracy: correct / total, timeMs: Number(row.timeMs) || 0, finishedAt: row.finishedAt };
  }
  checkLevel(level) {
    const l = Number(level);
    if (!(l === 1 || l === 2 || l === 3)) throw new AppError('bad_level', 'Unknown level.');
    return l;
  }
  today(user) {
    const app = this.app, today = app.clock.today(), self = this;
    return {
      today: today,
      levels: HG.QUIZ_LEVELS.map(function (L) {
        const row = app.quiz.find(user.id, today, L.id);
        const players = app.quiz.finished().filter(function (r) { return r.date === today && String(r.level) === String(L.id); }).length;
        return Object.assign({}, L, { status: !row ? 'new' : row.finishedAt ? 'done' : 'started', result: row && row.finishedAt ? self.result(row) : null, players: players });
      })
    };
  }
  start(user, data) {
    const app = this.app, today = app.clock.today(), level = this.checkLevel(data.level);
    if (!user.isActive()) throw new AppError('not_active', 'Finish your setup first.');
    let row = app.quiz.find(user.id, today, level);
    if (row && row.finishedAt) throw new AppError('done', 'You already played this level today. New puzzles tomorrow!');
    if (!row) row = app.quiz.insert({ id: 'q' + app.crypto.token().slice(0, 12), userId: user.id, date: today, level: String(level), startedAt: String(app.clock.now()), finishedAt: '', answers: '', correct: '', total: '', timeMs: '', perQuestionMs: '' });
    return { attemptId: row.id, level: level, date: today, startedAt: Number(row.startedAt), serverNow: app.clock.now(), questions: HG.QuizGenerator.publicView(HG.QuizGenerator.daily(today, level)) };
  }
  submit(user, data) {
    const app = this.app, row = app.quiz.byId(data.attemptId);
    if (!row || row.userId !== user.id) throw new AppError('not_found', 'Quiz not found.');
    if (row.finishedAt) throw new AppError('done', 'Already submitted.');
    const qs = HG.QuizGenerator.daily(row.date, Number(row.level));
    const answers = (Array.isArray(data.answers) ? data.answers : []).slice(0, qs.length).map(function (a) { return Number.isInteger(a) && a >= 0 && a < 4 ? a : null; });
    const per = (Array.isArray(data.perQuestionMs) ? data.perQuestionMs : []).slice(0, qs.length).map(function (x) { return Math.max(0, Math.min(3600000, Math.round(Number(x) || 0))); });
    const g = HG.QuizGenerator.grade(qs, answers);
    row.finishedAt = app.clock.iso(); row.answers = JSON.stringify(answers); row.correct = String(g.correct); row.total = String(g.total);
    row.timeMs = String(Math.max(1000, Math.min(3600000, app.clock.now() - Number(row.startedAt))));
    row.perQuestionMs = JSON.stringify(per);
    app.quiz.save(row);
    const board = this.leaderboard(user, { level: row.level, scope: 'today' });
    return Object.assign(this.result(row), { review: g.review, rank: board.yourRank, players: board.entries.length, level: Number(row.level) });
  }
  leaderboard(user, data) {
    const app = this.app, level = this.checkLevel(data.level), today = app.clock.today(), self = this;
    const rows = app.quiz.finished().filter(function (r) { return String(r.level) === String(level) && (data.scope === 'all' || r.date === today); });
    let entries;
    if (data.scope === 'all') {
      const agg = {};
      rows.forEach(function (r) {
        const a = agg[r.userId] = agg[r.userId] || { userId: r.userId, correct: 0, total: 0, timeMs: 0, attempts: 0, finishedAt: r.finishedAt };
        a.correct += Number(r.correct); a.total += Number(r.total); a.timeMs += Number(r.timeMs); a.attempts++;
      });
      entries = Object.keys(agg).map(function (k) { const a = agg[k]; return { userId: a.userId, accuracy: a.correct / a.total, timeMs: Math.round(a.timeMs / a.attempts), attempts: a.attempts, finishedAt: a.finishedAt }; });
    } else {
      entries = rows.map(function (r) { return Object.assign({ userId: r.userId, attempts: 1 }, self.result(r)); });
    }
    entries = entries.map(function (e) { const u = app.users.byId(e.userId); return u && u.isActive() ? Object.assign(e, u.publicCard(), { isYou: u.id === user.id }) : null; })
      .filter(Boolean).sort(HG.compareResults);
    entries.forEach(function (e, i) { e.rank = i + 1; delete e.userId; });
    const you = entries.find(function (e) { return e.isYou; });
    return { level: level, scope: data.scope === 'all' ? 'all' : 'today', today: today, entries: entries.slice(0, 50), yourRank: you ? you.rank : null };
  }
  stats(user) {
    const app = this.app, today = app.clock.today(), self = this;
    const mine = app.quiz.finished().filter(function (r) { return r.userId === user.id; }).sort(function (a, b) { return a.finishedAt < b.finishedAt ? -1 : 1; });
    const levels = HG.QUIZ_LEVELS.map(function (L) {
      const rows = mine.filter(function (r) { return String(r.level) === String(L.id); }).map(function (r) { return self.result(r); });
      const sum = function (k) { return rows.reduce(function (s, r) { return s + r[k]; }, 0); };
      return { id: L.id, name: L.name, attempts: rows.length, accuracy: rows.length ? sum('correct') / sum('total') : null, avgTimeMs: rows.length ? Math.round(sum('timeMs') / rows.length) : null, bestTimeMs: rows.length ? Math.min.apply(null, rows.map(function (r) { return r.timeMs; })) : null };
    });
    const days = {};
    mine.forEach(function (r) { (days[r.date] = days[r.date] || []).push(self.result(r)); });
    let streak = 0;
    for (let d = days[today] ? today : HG.DateUtil.add(today, -1); days[d]; d = HG.DateUtil.add(d, -1)) streak++;
    const history = [];
    for (let d = HG.DateUtil.add(today, -13); d <= today; d = HG.DateUtil.add(d, 1)) {
      const list = days[d] || [];
      history.push({ date: d, played: list.length, accuracy: list.length ? list.reduce(function (s, r) { return s + r.correct; }, 0) / list.reduce(function (s, r) { return s + r.total; }, 0) : null });
    }
    return { levels: levels, streak: streak, history: history, total: mine.length };
  }
}

/** Daily digest and login codes. */
class MailService {
  constructor(app) { this.app = app; }
  sendDigests() {
    const app = this.app, today = app.clock.today(), yesterday = HG.DateUtil.add(today, -1), appUrl = app.settings.get('APP_URL') || '';
    const checkins = app.checkins.byUser();
    let sent = 0;
    app.users.active().forEach(function (u) {
      if (!u.emailOptIn) return;
      const ev = new HG.DayEvaluator(u.habits, checkins[u.id] || {}, u.joinedAt), s = HG.Stats.of(ev, today);
      const m = HG.Motivation.pick(s.yesterday);
      const mail = MailService.render(u, s, m, ev, today, appUrl);
      app.mailer.send({ to: [u.email].concat(u.extraEmails), subject: mail.subject, html: mail.html, text: mail.text });
      sent++;
    });
    app.codes.prune(app.clock.now());
    return { sent: sent, day: yesterday };
  }
  static esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  static render(u, s, m, ev, today, appUrl) {
    const esc = MailService.esc, yStatus = s.yesterday;
    const colors = { green: '#2f8a63', red: '#f08a7c', gray: '#e9e3da', none: '#f4efe8', future: '#ffffff' };
    const word = { green: 'a green day 🌿', red: 'a red day', gray: 'not filled in yet', none: 'before you started' }[yStatus] || '';
    const subject = '🌱 ' + u.username + ', yesterday was ' + word.replace(' 🌿', '') + (s.streak ? ' · streak ' + s.streak : '');
    const links = u.form && u.form.links ? u.form.links : {};
    const btn = function (href, label, bg) { return '<a href="' + esc(href) + '" style="display:inline-block;margin:4px 6px 4px 0;padding:12px 18px;border-radius:999px;background:' + bg + ';color:#fff;text-decoration:none;font-weight:600">' + esc(label) + '</a>'; };
    let strip = '';
    for (let d = HG.DateUtil.add(today, -13); d <= today; d = HG.DateUtil.add(d, 1)) {
      const st = ev.day(d, today).status;
      strip += '<td style="width:22px;height:22px;border-radius:6px;background:' + colors[st] + ';text-align:center;font-size:10px;color:' + (st === 'green' ? '#fff' : '#6e6878') + '">' + Number(d.slice(8)) + '</td>';
    }
    const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#26232e;background:#fbf6ef;padding:24px;border-radius:24px">' +
      '<div style="font-size:13px;color:#6e6878">' + esc(HG.DateUtil.format(today, 'long')) + '</div>' +
      '<h1 style="font-family:Georgia,serif;font-weight:600;font-size:26px;margin:6px 0 14px">Hello ' + esc(u.username) + '</h1>' +
      '<div style="background:linear-gradient(135deg,#ffd9c2,#f8c6e0 50%,#c9c2ff);border-radius:20px;padding:18px 20px;font-family:Georgia,serif;font-size:18px;line-height:1.4">“' + esc(m.text) + '”</div>' +
      '<p style="margin:18px 0 6px">Yesterday was <b>' + esc(word) + '</b>' + (s.streak ? ', and your streak is <b>' + s.streak + ' day' + (s.streak > 1 ? 's' : '') + '</b>.' : '.') + '</p>' +
      '<table role="presentation" cellspacing="3" cellpadding="0" style="border-collapse:separate;margin:6px 0 14px"><tr>' + strip + '</tr></table>' +
      (yStatus === 'gray' && links.yesterday ? btn(links.yesterday, 'Fill in yesterday', '#2f8a63') : '') +
      (links.today ? btn(links.today, 'Fill in today', yStatus === 'gray' ? '#8e7cf0' : '#2f8a63') : '') +
      (appUrl ? '<p style="margin-top:16px"><a href="' + esc(appUrl) + '" style="color:#6f5ce0">Open Habit Grid</a></p>' : '') +
      '<p style="font-size:12px;color:#a39daa;margin-top:20px">You can turn this email off in the app, under your profile.</p></div>';
    const text = 'Hello ' + u.username + '\n\n"' + m.text + '"\n\nYesterday was ' + word + '. Streak: ' + s.streak + '.\n' +
      (links.yesterday ? '\nFill in yesterday: ' + links.yesterday : '') + (links.today ? '\nFill in today: ' + links.today : '') + (appUrl ? '\nApp: ' + appUrl : '');
    return { subject: subject, html: html, text: text };
  }
}

/** Describes a player's personal Google Form. The Apps Script adapter turns it into a real form. */
class FormSpec {
  static build(user, habits) {
    const items = [], map = {};
    ['good', 'bad'].forEach(function (kind) {
      habits.filter(function (h) { return h.kind === kind; }).forEach(function (h, i) {
        const title = (kind === 'good' ? '🌱 ' : '🍂 ') + (i + 1) + '. ' + h.sentence;
        items.push({ kind: kind, habitId: h.id, title: title, help: 'Respected means: ' + h.metric + ' · ' + h.frequencyLabel() });
        map[title] = h.id;
      });
    });
    return {
      title: 'Habit Grid · ' + user.username,
      description: 'Your daily check-in. Be honest, nobody else sees these answers: the community only sees your colours.',
      confirmation: 'Logged 🌿 Go back to the app to see your square.',
      dayTitle: 'Which day are you filling in?',
      keyTitle: 'Private key (filled in for you, do not change it)',
      goodHeader: '🌱 Habits to pick up', badHeader: '🍂 Habits to give up',
      items: items, map: map
    };
  }
}

// ====================================================================== composition root + API

class HabitGridApp {
  constructor(adapters) {
    this.adapters = adapters;
    this.clock = adapters.clock; this.crypto = adapters.crypto; this.mailer = adapters.mailer; this.forms = adapters.forms;
    this.cache = adapters.cache; this.settings = adapters.settings; this.lock = adapters.lock;
    this.users = new UserRepository(adapters.table('users'));
    this.sessions = new SessionRepository(adapters.table('sessions'), this.crypto);
    this.codes = new CodeRepository(adapters.table('codes'), this.crypto);
    this.checkins = new CheckinRepository(adapters.table('checkins'));
    this.gifts = new GiftRepository(adapters.table('gifts'));
    this.quiz = new QuizRepository(adapters.table('quiz'));
    this.auth = new AuthService(this);
    this.profile = new ProfileService(this);
    this.checkin = new CheckinService(this);
    this.dashboard = new DashboardService(this);
    this.community = new CommunityService(this);
    this.giftService = new GiftService(this);
    this.quizService = new QuizService(this);
    this.mail = new MailService(this);
    this.api = new Api(this);
  }
}

class Api {
  constructor(app) {
    this.app = app;
    const a = app;
    // auth: none | any (signed in, setup may be unfinished) | active (setup finished)
    this.routes = {
      'config': { auth: 'none', fn: function () { return { appName: HG.CONFIG.APP_NAME, inviteRequired: !!String(a.settings.get('INVITE_CODE') || '').trim(), today: a.clock.today() }; } },
      'auth.requestCode': { auth: 'none', write: true, fn: function (c, d) { return a.auth.requestCode(d); } },
      'auth.verifyCode': { auth: 'none', write: true, fn: function (c, d) { return a.auth.verifyCode(d); } },
      'auth.logout': { auth: 'any', write: true, fn: function (c) { return a.auth.logout(c); } },
      'user.checkUsername': { auth: 'any', fn: function (c, d) { return a.profile.checkUsername(c.user, d); } },
      'user.completeOnboarding': { auth: 'any', write: true, fn: function (c, d) { return a.profile.completeOnboarding(c.user, d); } },
      'user.updateHabits': { auth: 'active', write: true, fn: function (c, d) { return a.profile.updateHabits(c.user, d); } },
      'user.updatePrefs': { auth: 'active', write: true, fn: function (c, d) { return a.profile.updatePrefs(c.user, d); } },
      'me': { auth: 'any', write: true, fn: function (c) { return a.dashboard.me(c.user); } },
      'community.list': { auth: 'active', fn: function (c) { return a.community.list(c.user); } },
      'community.player': { auth: 'active', fn: function (c, d) { return a.community.player(c.user, d); } },
      'gifts.send': { auth: 'active', write: true, fn: function (c, d) { return a.giftService.send(c.user, d); } },
      'gifts.markSeen': { auth: 'active', write: true, fn: function (c, d) { return a.giftService.markSeen(c.user, d); } },
      'quiz.today': { auth: 'active', fn: function (c) { return a.quizService.today(c.user); } },
      'quiz.start': { auth: 'active', write: true, fn: function (c, d) { return a.quizService.start(c.user, d); } },
      'quiz.submit': { auth: 'active', write: true, fn: function (c, d) { return a.quizService.submit(c.user, d); } },
      'quiz.leaderboard': { auth: 'active', fn: function (c, d) { return a.quizService.leaderboard(c.user, d); } },
      'quiz.stats': { auth: 'active', fn: function (c) { return a.quizService.stats(c.user); } }
    };
  }
  handle(req) {
    try {
      req = req || {};
      const route = this.routes[req.action];
      if (!route) throw new AppError('unknown_action', 'Unknown action.');
      const app = this.app, data = req.data && typeof req.data === 'object' ? req.data : {};
      const run = function () {
        let ctx = {};
        if (route.auth !== 'none') {
          ctx = app.auth.authenticate(req.token);
          if (route.auth === 'active' && !ctx.user.isActive()) throw new AppError('not_active', 'Finish your setup first.');
        }
        return route.fn(ctx, data);
      };
      return { ok: true, data: route.write ? app.lock.run(run) : run() };
    } catch (e) {
      if (e && e.userFacing) return { ok: false, error: { code: e.code, message: e.message } };
      if (this.app.adapters.log) this.app.adapters.log(e);
      return { ok: false, error: { code: 'server', message: 'Something went wrong on the server. Try again in a moment.' } };
    }
  }
}

if (typeof module === 'object' && module.exports) {
  module.exports = { AppError: AppError, HabitGridApp: HabitGridApp, TABLES: TABLES, MailService: MailService, FormSpec: FormSpec };
}

/*
 * In-memory adapters: the same backend classes run in the browser demo and in tests.
 * Rows are plain objects of strings, like cells in a Google Sheet.
 */
class MemoryTable {
  constructor(name, columns, store, onChange) {
    this.name = name; this.columns = columns; this.store = store; this.onChange = onChange || function () {};
    if (!store[name]) store[name] = [];
  }
  all() { return this.store[this.name].slice(); }
  insert(obj) {
    const row = {};
    this.columns.forEach(function (c) { row[c] = obj[c] == null ? '' : String(obj[c]); });
    this.store[this.name].push(row);
    this.onChange();
    return row;
  }
  update() { this.onChange(); }
  remove(row) { const a = this.store[this.name], i = a.indexOf(row); if (i >= 0) a.splice(i, 1); this.onChange(); }
}

class MemoryCache {
  constructor() { this.map = {}; }
  get(k) { const e = this.map[k]; return e && e.until > Date.now() ? e.v : null; }
  put(k, v, ttl) { this.map[k] = { v: v, until: Date.now() + (ttl || 300) * 1000 }; }
  remove(k) { delete this.map[k]; }
}

function demoHash(str) {
  // Not cryptographic: fine for a demo that never leaves the browser. Apps Script uses HMAC-SHA256.
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ str.length;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507) ^ (h2 >>> 13); }
  return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, '0');
}
function randomChars(n) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = '';
  const g = typeof crypto !== 'undefined' && crypto.getRandomValues ? function () { return crypto.getRandomValues(new Uint32Array(1))[0]; } : function () { return Math.floor(Math.random() * 4294967296); };
  for (let i = 0; i < n; i++) s += abc[g() % abc.length];
  return s;
}

function createMemoryAdapters(opts) {
  opts = opts || {};
  const store = opts.store || {};
  const outbox = [];
  const clock = opts.clock || {
    today: function () { return HG.DateUtil.localToday(); },
    now: function () { return Date.now(); },
    iso: function () { return new Date().toISOString(); }
  };
  const settings = opts.settings || {};
  return {
    store: store, outbox: outbox, revealCodes: opts.revealCodes !== false,
    table: function (name) { return new MemoryTable(name, TABLES[name], store, opts.onChange); },
    clock: clock,
    crypto: opts.crypto || {
      hash: function (s) { return demoHash(s); },
      token: function () { return randomChars(32); },
      digits: function (n) { let s = ''; for (let i = 0; i < n; i++) s += String(Math.floor(Math.random() * 10)); return s; }
    },
    mailer: {
      sendCode: function (email, code) { outbox.push({ to: [email], subject: 'Your code', code: code }); },
      send: function (m) { outbox.push(m); }
    },
    forms: {
      createForUser: function (user, habits) {
        const spec = FormSpec.build(user, habits), key = randomChars(16);
        return { id: 'demo-form-' + user.id, url: '#demo-form', sheetId: 'demo-sheet-' + user.id, key: key, keyTitle: spec.keyTitle, dayTitle: spec.dayTitle, map: spec.map,
          links: { today: '#demo-form?day=0', yesterday: '#demo-form?day=1', before: '#demo-form?day=2' } };
      },
      rebuild: function (user, habits) { return this.createForUser(user, habits); }
    },
    cache: new MemoryCache(),
    settings: { get: function (k) { return settings[k] || ''; } },
    lock: { run: function (fn) { return fn(); } },
    log: opts.log || function () {}
  };
}

if (typeof module === 'object' && module.exports) module.exports = { createMemoryAdapters: createMemoryAdapters, MemoryTable: MemoryTable };

/*
 * Demo mode: the real backend classes (services.js) run in the browser with
 * in-memory tables and a few made-up players. Used when config.js has no API_URL.
 */
(function () {
  'use strict';
  const D = HG.DateUtil, KEY = 'hg.demo.store.v1';
  const PEOPLE = [
    { name: 'Maya', days: 110, reg: .96, p: .84, quiz: .92, play: .9 },
    { name: 'Theo', days: 95, reg: .85, p: .72, quiz: .74, play: .7 },
    { name: 'Lina', days: 80, reg: .78, p: .66, quiz: .84, play: .6 },
    { name: 'Hugo', days: 120, reg: .9, p: .79, quiz: .66, play: .8 },
    { name: 'Sofia', days: 60, reg: .7, p: .6, quiz: .88, play: .55 },
    { name: 'Noah', days: 45, reg: .82, p: .7, quiz: .6, play: .7 },
    { name: 'Emma', days: 130, reg: .97, p: .88, quiz: .8, play: .85 },
    { name: 'Yanis', days: 30, reg: .62, p: .55, quiz: .72, play: .5 }
  ];
  const MESSAGES = ['Welcome to the garden!', 'Your first week is the hardest, you have got this', 'Proud of your consistency', 'One square at a time'];

  function levelsFor(rng, habits, p) {
    const out = {};
    habits.forEach(function (h) { const r = rng.next(); out[h.id] = r < p ? 2 : r < p + 0.12 ? 1 : 0; });
    return out;
  }
  function stamp(date, hour) { return date + 'T' + (hour < 10 ? '0' : '') + hour + ':00:00.000Z'; }

  function seed(app) {
    const today = D.localToday(), rng = new HG.Rng('habit-grid-demo|' + today);
    PEOPLE.forEach(function (p, idx) {
      const u = app.users.create(p.name.toLowerCase() + '@demo.local', 'udemo' + idx, stamp(today, 6));
      u.username = p.name; u.status = 'active'; u.joinedAt = D.add(today, -p.days); u.hue = HG.hueOf(p.name);
      u.lockedUntil = D.add(u.joinedAt, 30 * Math.ceil(p.days / 30 + 0.01));
      const good = rng.shuffle(HG.SUGGESTIONS.good).slice(0, 5), bad = rng.shuffle(HG.SUGGESTIONS.bad).slice(0, 5);
      u.habits = good.map(function (h) { return Object.assign({ kind: 'good' }, h); }).concat(bad.map(function (h) { return Object.assign({ kind: 'bad' }, h); }))
        .map(function (h, i) { return new HG.Habit(Object.assign({}, h, { id: 'h' + (i + 1), createdAt: u.joinedAt })); });
      u.form = app.forms.createForUser(u, u.habits);
      app.users.saveUser(u);
      for (let d = u.joinedAt; d <= today; d = D.add(d, 1)) {
        if (d === today ? rng.next() > 0.55 : rng.next() > p.reg) continue;
        app.checkins.upsert(u.id, d, levelsFor(rng, u.habits, p.p), 'form', stamp(d, 20));
      }
      for (let back = 0; back < 12; back++) {
        const d = D.add(today, -back);
        [1, 2, 3].forEach(function (level) {
          if (rng.next() > p.play) return;
          let correct = 0;
          for (let i = 0; i < 5; i++) if (rng.next() < p.quiz - (level - 1) * 0.07) correct++;
          const timeMs = Math.round((35 + rng.next() * 110 + level * 30) * 1000);
          app.quiz.insert({ id: 'qd' + idx + '_' + back + '_' + level, userId: u.id, date: d, level: String(level), startedAt: String(Date.parse(stamp(d, 12))), finishedAt: stamp(d, 12 + level), answers: '[]', correct: String(correct), total: '5', timeMs: String(timeMs), perQuestionMs: '[]' });
        });
      }
    });
    for (let i = 0; i < 18; i++) {
      const a = rng.int(0, PEOPLE.length - 1), b = rng.int(0, PEOPLE.length - 1);
      if (a === b) continue;
      app.gifts.insert({ id: 'gd' + i, fromId: 'udemo' + a, toId: 'udemo' + b, gift: rng.pick(HG.GIFTS).id, message: rng.pick(MESSAGES), day: D.add(today, -rng.int(1, 20)), createdAt: stamp(today, 7), seenAt: stamp(today, 8) });
    }
  }

  /** After the visitor finishes onboarding: give them 9 weeks of history and two welcome gifts. */
  function backfill(app, userId) {
    const today = D.localToday(), rng = new HG.Rng('you|' + userId), u = app.users.byId(userId);
    u.joinedAt = D.add(today, -63);
    u.habits.forEach(function (h) { h.createdAt = u.joinedAt; });
    app.users.saveUser(u);
    for (let d = u.joinedAt; d < today; d = D.add(d, 1)) {
      if (rng.next() > 0.88) continue;
      const p = 0.62 + 0.25 * D.diff(u.joinedAt, d) / 63;
      app.checkins.upsert(u.id, d, levelsFor(rng, u.habits, p), 'form', stamp(d, 21));
    }
    [['udemo0', 'sunflower', 'Welcome to the garden! Your first green square is the best one.'], ['udemo6', 'tea', 'Proud of you for starting 🍵']].forEach(function (g, i) {
      app.gifts.insert({ id: 'gw' + i + userId, fromId: g[0], toId: userId, gift: g[1], message: g[2], day: today, createdAt: new Date().toISOString(), seenAt: '' });
    });
    app.community.invalidate();
  }

  function createBackend() {
    let store = null;
    try { store = JSON.parse(localStorage.getItem(KEY)); } catch (e) { store = null; }
    const fresh = !store;
    store = store || {};
    let timer = null;
    const save = function () {
      clearTimeout(timer);
      timer = setTimeout(function () { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* private mode */ } }, 150);
    };
    const adapters = createMemoryAdapters({ store: store, onChange: save });
    const app = new HabitGridApp(adapters);
    if (fresh) seed(app);
    return {
      app: app,
      handle: function (req) {
        const res = app.api.handle(req);
        if (req.action === 'user.completeOnboarding' && res.ok) {
          backfill(app, res.data.user.id);
          res.data = app.dashboard.me(app.users.byId(res.data.user.id));
        }
        return res;
      },
      submitForm: function (token, offset, levels) {
        try {
          const ctx = app.auth.authenticate(token);
          return { ok: true, data: app.checkin.apply(ctx.user, offset, levels, 'form') };
        } catch (e) { return { ok: false, error: { code: e.code || 'server', message: e.message } }; }
      },
      reset: function () { clearTimeout(timer); try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
    };
  }

  window.HabitGridDemo = { createBackend: createBackend };
})();
