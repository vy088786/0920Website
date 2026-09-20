'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/db');
const C = require('./lib/constants');
const agent = require('./lib/agent');
const { createTicket, addComment, isOpen, isOverdue } = require('./lib/tickets');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const SESSION_MS = 7 * C.DAY;
const db = store.load();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);
const forbidden = () => new HttpError(403, '沒有權限執行此操作');
const notFound = (msg = '找不到資料') => new HttpError(404, msg);

/* ───────────── 共用 ───────────── */

const userById = (id) => db.users.find((u) => u.id === id);
const publicUser = (u) => u && { id: u.id, name: u.name, dept: u.dept, title: u.title, role: u.role, email: u.email, ext: u.ext };
const nameOf = (id) => (id === 'system' ? '系統' : userById(id)?.name || '');
const str = (v, max) => String(v ?? '').trim().slice(0, max);

function ticketRow(t) {
  const dev = db.devices.find((d) => d.id === t.deviceId);
  return {
    id: t.id, title: t.title, category: t.category, priority: t.priority, status: t.status, source: t.source,
    requesterId: t.requesterId, requesterName: nameOf(t.requesterId), requesterDept: userById(t.requesterId)?.dept || '',
    deviceId: t.deviceId, deviceLabel: dev ? `${dev.assetTag} ${dev.brand} ${dev.model}` : '',
    assigneeId: t.assigneeId, assigneeName: t.assigneeId ? nameOf(t.assigneeId) : '',
    createdAt: t.createdAt, updatedAt: t.updatedAt, dueAt: t.dueAt, overdue: isOverdue(t), rootCause: t.rootCause,
  };
}

function ticketDetail(t, viewer) {
  const staff = viewer.role === 'staff';
  const dev = db.devices.find((d) => d.id === t.deviceId);
  return {
    ...ticketRow(t),
    description: t.description, resolution: t.resolution, resolvedAt: t.resolvedAt, closedAt: t.closedAt,
    device: dev ? { ...dev, flags: agent.deviceFlags(dev) } : null,
    comments: t.comments.filter((c) => staff || !c.internal).map((c) => ({ ...c, byName: nameOf(c.by), byRole: c.by === 'system' ? 'system' : userById(c.by)?.role })),
    aiSummary: staff ? t.aiSummary : null,
    transcript: staff ? t.transcript : null,
  };
}

function loadTicket(id, viewer) {
  const t = db.tickets.find((x) => x.id === id);
  if (!t) throw notFound('找不到這張報修單');
  if (viewer.role !== 'staff' && t.requesterId !== viewer.id) throw notFound('找不到這張報修單');
  return t;
}

/* ───────────── 路由表 ───────────── */

const routes = [];
function route(method, pattern, auth, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, auth, handler });
}

// ── 登入
route('GET', '/api/demo-users', false, () => db.users.map(publicUser));

route('POST', '/api/login', false, ({ body }) => {
  const u = userById(str(body.userId, 20)) || db.users.find((x) => x.id.toLowerCase() === str(body.userId, 20).toLowerCase());
  if (!u) throw new HttpError(401, '查無此員工編號');
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId: u.id, createdAt: Date.now() };
  store.save();
  return { token, user: publicUser(u) };
});

route('POST', '/api/logout', true, ({ token }) => {
  delete db.sessions[token];
  store.save();
  return { ok: true };
});

route('GET', '/api/me', true, ({ user }) => publicUser(user));

route('GET', '/api/meta', true, () => ({
  categories: C.CATEGORIES, priorities: C.PRIORITIES, statuses: C.STATUSES, sla: C.SLA_HOURS,
  staff: db.users.filter((u) => u.role === 'staff').map(publicUser),
  rootCauses: [...new Set(db.tickets.map((t) => t.rootCause).filter(Boolean))].sort(),
}));

// ── 電腦與履歷
route('GET', '/api/my/devices', true, ({ user }) => {
  return db.devices.filter((d) => d.ownerId === user.id).map((d) => ({
    ...d, flags: agent.deviceFlags(d),
    history: db.tickets.filter((t) => t.deviceId === d.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(ticketRow),
  }));
});

// ── 報修單
route('GET', '/api/tickets', true, ({ user, query }) => {
  let list = db.tickets;
  if (user.role !== 'staff' || query.mine === '1') list = list.filter((t) => t.requesterId === user.id);
  if (query.status === 'open') list = list.filter(isOpen);
  else if (query.status) list = list.filter((t) => t.status === query.status);
  if (query.category) list = list.filter((t) => t.category === query.category);
  if (query.priority) list = list.filter((t) => t.priority === query.priority);
  if (user.role === 'staff') {
    if (query.assignee === 'none') list = list.filter((t) => !t.assigneeId);
    else if (query.assignee === 'me') list = list.filter((t) => t.assigneeId === user.id);
    else if (query.assignee) list = list.filter((t) => t.assigneeId === query.assignee);
    if (query.overdue === '1') list = list.filter(isOverdue);
  }
  if (query.q) {
    const q = query.q.toLowerCase();
    list = list.filter((t) => `${t.id} ${t.title} ${t.description} ${nameOf(t.requesterId)}`.toLowerCase().includes(q));
  }
  const weight = { 緊急: 0, 高: 1, 中: 2, 低: 3 };
  list = [...list].sort((a, b) => {
    const oa = isOpen(a), ob = isOpen(b);
    if (oa !== ob) return oa ? -1 : 1;
    if (oa && user.role === 'staff' && weight[a.priority] !== weight[b.priority]) return weight[a.priority] - weight[b.priority];
    return b.createdAt.localeCompare(a.createdAt);
  });
  return list.slice(0, 300).map(ticketRow);
});

route('POST', '/api/tickets', true, ({ user, body }) => {
  const title = str(body.title, 100);
  const description = str(body.description, 4000);
  if (!title) throw bad('請填寫問題標題');
  if (!description) throw bad('請描述問題發生的狀況');
  const category = C.CATEGORIES.includes(body.category) ? body.category : '其他';
  const priority = C.PRIORITIES.includes(body.priority) ? body.priority : '中';
  let deviceId = null;
  if (body.deviceId) {
    const d = db.devices.find((x) => x.id === body.deviceId && x.ownerId === user.id);
    if (!d) throw bad('找不到這台電腦');
    deviceId = d.id;
  }
  const t = createTicket(db, { title, description, category, priority, requesterId: user.id, deviceId, source: 'form' });
  store.save();
  return ticketDetail(t, user);
});

route('GET', '/api/tickets/:id', true, ({ user, params }) => ticketDetail(loadTicket(params.id, user), user));

route('POST', '/api/tickets/:id/comments', true, ({ user, params, body }) => {
  const t = loadTicket(params.id, user);
  const text = str(body.body, 4000);
  if (!text) throw bad('留言不可為空白');
  const staff = user.role === 'staff';
  const internal = staff && !!body.internal;
  addComment(t, user.id, text, { internal });
  if (staff && !internal) {
    if (!t.assigneeId) t.assigneeId = user.id;
    if (t.status === '待處理') {
      t.status = '處理中';
      addComment(t, 'system', '狀態變更：待處理 → 處理中', { type: 'system' });
    }
  } else if (!staff) {
    if (t.status === '等待使用者') {
      t.status = '處理中';
      addComment(t, 'system', '使用者已回覆，狀態變更：等待使用者 → 處理中', { type: 'system' });
    } else if (t.status === '已解決' || t.status === '已關閉') {
      t.status = '處理中';
      t.resolvedAt = t.closedAt = null;
      addComment(t, 'system', '使用者回覆後重新開啟報修單', { type: 'system' });
    }
  }
  store.save();
  return ticketDetail(t, user);
});

route('PATCH', '/api/tickets/:id', true, ({ user, params, body }) => {
  const t = loadTicket(params.id, user);
  const staff = user.role === 'staff';
  if (!staff) {
    // 使用者只能確認結案或重新開啟自己的單
    if (body.action === 'confirm' && t.status === '已解決') {
      t.status = '已關閉';
      t.closedAt = new Date().toISOString();
      addComment(t, 'system', '使用者確認問題已解決，報修單已關閉', { type: 'system' });
    } else if (body.action === 'reopen' && (t.status === '已解決' || t.status === '已關閉')) {
      t.status = '處理中';
      t.resolvedAt = t.closedAt = null;
      addComment(t, 'system', `使用者表示問題尚未解決，重新開啟${body.reason ? '：' + str(body.reason, 500) : ''}`, { type: 'system' });
    } else throw forbidden();
    store.save();
    return ticketDetail(t, user);
  }

  const log = [];
  if (body.status && body.status !== t.status) {
    if (!C.STATUSES.includes(body.status)) throw bad('不正確的狀態');
    const resolution = body.resolution !== undefined ? str(body.resolution, 4000) : t.resolution;
    if (body.status === '已解決' && !resolution) throw bad('標示為「已解決」時，請填寫處理方式，之後 IT 小幫手會用它來協助其他同仁');
    log.push(`狀態：${t.status} → ${body.status}`);
    t.status = body.status;
    if (body.status === '已解決') t.resolvedAt = new Date().toISOString();
    if (body.status === '已關閉') t.closedAt = new Date().toISOString();
    if (isOpen(t)) t.resolvedAt = t.closedAt = null;
  }
  if (body.priority && body.priority !== t.priority) {
    if (!C.PRIORITIES.includes(body.priority)) throw bad('不正確的優先順序');
    log.push(`優先順序：${t.priority} → ${body.priority}`);
    t.priority = body.priority;
    t.dueAt = new Date(new Date(t.createdAt).getTime() + C.SLA_HOURS[t.priority] * C.HOUR).toISOString();
  }
  if (body.category && body.category !== t.category) {
    if (!C.CATEGORIES.includes(body.category)) throw bad('不正確的分類');
    log.push(`分類：${t.category} → ${body.category}`);
    t.category = body.category;
  }
  if (body.assigneeId !== undefined && (body.assigneeId || null) !== t.assigneeId) {
    const a = body.assigneeId ? userById(body.assigneeId) : null;
    if (body.assigneeId && (!a || a.role !== 'staff')) throw bad('找不到這位客服人員');
    log.push(`負責人：${t.assigneeId ? nameOf(t.assigneeId) : '未指派'} → ${a ? a.name : '未指派'}`);
    t.assigneeId = a ? a.id : null;
  }
  if (body.resolution !== undefined) t.resolution = str(body.resolution, 4000);
  if (body.rootCause !== undefined) t.rootCause = str(body.rootCause, 60);
  if (log.length) addComment(t, 'system', `${user.name} 變更 ${log.join('；')}`, { type: 'system' });
  t.updatedAt = new Date().toISOString();
  store.save();
  return ticketDetail(t, user);
});

// ── 知識庫
route('GET', '/api/kb', true, ({ query }) => {
  const q = (query.q || '').toLowerCase();
  let list = db.kb;
  if (query.category) list = list.filter((k) => k.category === query.category);
  if (q) list = list.filter((k) => `${k.title} ${k.symptoms} ${k.keywords.join(' ')} ${k.causes.map((c) => c.text).join(' ')}`.toLowerCase().includes(q));
  return list.map((k) => ({
    id: k.id, title: k.title, category: k.category, symptoms: k.symptoms, escalateWhen: k.escalateWhen, severity: k.severity || 'normal',
    causes: k.causes.map((c) => ({ text: c.text, steps: c.steps })),
  }));
});

// ── IT 小幫手
route('POST', '/api/agent/suggest', true, ({ user, body }) => {
  const text = `${str(body.title, 100)} ${str(body.description, 2000)}`.trim();
  if (text.length < 2) return null;
  const d = agent.diagnose(db, { user, text, deviceId: body.deviceId, category: C.CATEGORIES.includes(body.category) ? body.category : undefined });
  return agent.sanitizeForUser(d);
});

function activeConversation(user) {
  // 只沿用該使用者「最近一次」的對話；已解決、已關閉，或轉人工後報修單已結案的就開新的
  const conv = [...db.conversations].reverse().find((c) => c.userId === user.id);
  const usable = conv && (conv.status === 'open' || (conv.status === 'escalated' && isOpen(db.tickets.find((t) => t.id === conv.ticketId) || {})));
  return usable ? conv : agent.newConversation(db, user);
}
const chatView = (c) => ({ id: c.id, status: c.status, ticketId: c.ticketId, messages: c.messages });

route('GET', '/api/chat', true, ({ user }) => {
  const c = activeConversation(user);
  store.save();
  return chatView(c);
});

route('POST', '/api/chat/message', true, ({ user, body }) => {
  const c = activeConversation(user);
  agent.handleChat(db, user, c, { text: str(body.text, 1000), action: str(body.action, 30), value: str(body.value, 1000) });
  store.save();
  return chatView(c);
});

route('POST', '/api/chat/new', true, ({ user }) => {
  const cur = [...db.conversations].reverse().find((c) => c.userId === user.id);
  if (cur && cur.status === 'open') cur.status = 'closed';
  const c = agent.newConversation(db, user);
  store.save();
  return chatView(c);
});

// ── 客服人員專用
route('GET', '/api/staff/stats', 'staff', () => {
  const now = Date.now();
  const open = db.tickets.filter(isOpen);
  const done90 = db.tickets.filter((t) => t.resolvedAt && now - new Date(t.resolvedAt).getTime() < 90 * C.DAY);
  const avgHours = done90.length ? done90.reduce((s, t) => s + (new Date(t.resolvedAt) - new Date(t.createdAt)) / C.HOUR, 0) / done90.length : 0;
  const count = (arr, key) => Object.entries(arr.reduce((m, t) => ((m[t[key]] = (m[t[key]] || 0) + 1), m), {})).map(([k, n]) => ({ key: k, count: n })).sort((a, b) => b.count - a.count);
  const rc = {};
  for (const t of done90) if (t.rootCause) rc[t.rootCause] = (rc[t.rootCause] || 0) + 1;
  const convs = db.conversations;
  const aiResolved = convs.filter((c) => c.status === 'resolved').length;
  const escalated = convs.filter((c) => c.status === 'escalated').length;
  const decided = aiResolved + escalated;
  const weight = { 緊急: 0, 高: 1, 中: 2, 低: 3 };
  return {
    counts: {
      open: open.length, unassigned: open.filter((t) => !t.assigneeId).length, overdue: open.filter(isOverdue).length,
      waiting: open.filter((t) => t.status === '等待使用者').length, awaitingClose: db.tickets.filter((t) => t.status === '已解決').length,
    },
    avgResolveHours: Math.round(avgHours * 10) / 10,
    byCategory: count(open, 'category'), byStatus: C.STATUSES.map((s) => ({ key: s, count: db.tickets.filter((t) => t.status === s).length })),
    topRootCauses: Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => ({ key: k, count: n })),
    agent: { conversations: convs.length, aiResolved, escalated, rate: decided ? Math.round((aiResolved / decided) * 100) : null },
    workload: db.users.filter((u) => u.role === 'staff').map((u) => ({ id: u.id, name: u.name, open: open.filter((t) => t.assigneeId === u.id).length })),
    queue: open.sort((a, b) => weight[a.priority] - weight[b.priority] || new Date(a.dueAt) - new Date(b.dueAt)).slice(0, 8).map(ticketRow),
  };
});

route('GET', '/api/staff/users', 'staff', ({ query }) => {
  const q = (query.q || '').toLowerCase();
  return db.users.filter((u) => u.role === 'user').map((u) => {
    const devs = db.devices.filter((d) => d.ownerId === u.id);
    const mine = db.tickets.filter((t) => t.requesterId === u.id);
    return { ...publicUser(u), devices: devs.map((d) => ({ id: d.id, label: `${d.assetTag} ${d.brand} ${d.model}` })), ticketCount: mine.length, openCount: mine.filter(isOpen).length };
  }).filter((u) => !q || `${u.id} ${u.name} ${u.dept} ${u.devices.map((d) => d.label).join(' ')}`.toLowerCase().includes(q));
});

route('GET', '/api/staff/users/:id', 'staff', ({ params }) => {
  const u = userById(params.id);
  if (!u || u.role !== 'user') throw notFound('找不到這位使用者');
  const tickets = db.tickets.filter((t) => t.requesterId === u.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const devices = db.devices.filter((d) => d.ownerId === u.id).map((d) => ({ ...d, flags: agent.deviceFlags(d), history: tickets.filter((t) => t.deviceId === d.id).map(ticketRow) }));
  const cats = {};
  for (const t of tickets) cats[t.category] = (cats[t.category] || 0) + 1;
  return { user: publicUser(u), devices, tickets: tickets.map(ticketRow), byCategory: Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, count: n })) };
});

route('GET', '/api/staff/tickets/:id/diagnosis', 'staff', ({ params }) => {
  const t = db.tickets.find((x) => x.id === params.id);
  if (!t) throw notFound('找不到這張報修單');
  const requester = userById(t.requesterId);
  // 小幫手轉來的單，標題是知識庫文章名稱而非使用者的話，只用使用者原文才不會拿自己的診斷結果再去比對
  const text = t.source === 'chat' ? t.description : `${t.title} ${t.description}`;
  return agent.diagnose(db, { user: requester, text, deviceId: t.deviceId, category: t.category, excludeId: t.id });
});

route('GET', '/api/staff/records', 'staff', ({ query }) => {
  const q = (query.q || '').toLowerCase();
  let list = db.tickets.filter((t) => t.resolution && C.DONE_STATUSES.includes(t.status));
  if (query.category) list = list.filter((t) => t.category === query.category);
  if (query.rootCause) list = list.filter((t) => t.rootCause === query.rootCause);
  if (q) {
    list = list.filter((t) => {
      const d = db.devices.find((x) => x.id === t.deviceId);
      return `${t.id} ${t.title} ${t.description} ${t.rootCause} ${t.resolution} ${nameOf(t.requesterId)} ${d ? d.assetTag + ' ' + d.brand + ' ' + d.model : ''}`.toLowerCase().includes(q);
    });
  }
  list = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rc = {};
  for (const t of list) if (t.rootCause) rc[t.rootCause] = (rc[t.rootCause] || 0) + 1;
  return {
    total: list.length,
    topRootCauses: Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ key: k, count: n })),
    items: list.slice(0, 100).map((t) => ({ ...ticketRow(t), resolution: t.resolution, resolvedAt: t.resolvedAt, assigneeName: nameOf(t.assigneeId) })),
  };
});

/* ───────────── HTTP ───────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new HttpError(413, '內容過大'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(bad('內容格式不正確'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data === undefined ? null : data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sessionUser(req) {
  const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  if (!m) return {};
  const s = db.sessions[m[1]];
  if (!s || Date.now() - s.createdAt > SESSION_MS) return {};
  const user = userById(s.userId);
  return user ? { user, token: m[1] } : {};
}

async function handleApi(req, res, url) {
  const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
  if (!r) {
    if (routes.some((x) => x.re.test(url.pathname))) throw new HttpError(405, '不支援的請求方法');
    throw notFound('找不到 API');
  }
  const m = r.re.exec(url.pathname);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const { user, token } = sessionUser(req);
  if (r.auth && !user) throw new HttpError(401, '請先登入');
  if (r.auth === 'staff' && user.role !== 'staff') throw forbidden();
  const body = req.method === 'GET' ? {} : await readBody(req);
  const result = await r.handler({ req, user, token, params, query: Object.fromEntries(url.searchParams), body });
  sendJson(res, 200, result);
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 找不到頁面');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.status ? e.message : '伺服器發生錯誤，請稍後再試' });
  }
});

server.listen(PORT, () => {
  console.log(`IT 客服中心已啟動：http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    store.flush();
    process.exit(0);
  });
}
