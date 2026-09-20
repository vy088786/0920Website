'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sb = require('./lib/supabase');
const repo = require('./lib/repo');
const C = require('./lib/constants');
const agent = require('./lib/agent');
const { makeComment, isOpen, isOverdue } = require('./lib/tickets');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const SESSION_MS = 7 * C.DAY;

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

const publicUser = (u) => u && { id: u.id, name: u.name, dept: u.dept, title: u.title, role: u.role, email: u.email, ext: u.ext };
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const { eq, inList } = sb;

// 報修單列表用的欄位（requesterName 等由 repo 從關聯資料帶出）
function ticketRow(t) {
  return {
    id: t.id, title: t.title, category: t.category, priority: t.priority, status: t.status, source: t.source,
    requesterId: t.requesterId, requesterName: t.requesterName, requesterDept: t.requesterDept,
    deviceId: t.deviceId, deviceLabel: t.deviceLabel,
    assigneeId: t.assigneeId, assigneeName: t.assigneeName,
    createdAt: t.createdAt, updatedAt: t.updatedAt, dueAt: t.dueAt, overdue: isOverdue(t), rootCause: t.rootCause,
  };
}

async function ticketDetail(t, viewer) {
  const staff = viewer.role === 'staff';
  const [dev, all] = await Promise.all([t.deviceId ? repo.getDevice(t.deviceId) : null, repo.getComments(t.id)]);
  const comments = all.filter((c) => staff || !c.internal);
  const people = new Map((await repo.usersByIds([...new Set(comments.map((c) => c.by).filter((id) => id !== 'system'))])).map((u) => [u.id, u]));
  return {
    ...ticketRow(t),
    description: t.description, resolution: t.resolution, resolvedAt: t.resolvedAt, closedAt: t.closedAt,
    device: dev ? { ...dev, flags: agent.deviceFlags(dev) } : null,
    comments: comments.map((c) => ({ ...c, byName: c.by === 'system' ? '系統' : people.get(c.by)?.name || '', byRole: c.by === 'system' ? 'system' : people.get(c.by)?.role })),
    aiSummary: staff ? t.aiSummary : null,
    transcript: staff ? t.transcript : null,
  };
}

async function loadTicket(id, viewer) {
  const t = await repo.getTicket(id);
  if (!t || (viewer.role !== 'staff' && t.requesterId !== viewer.id)) throw notFound('找不到這張報修單');
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
route('GET', '/api/demo-users', false, async () => (await repo.listUsers()).map(publicUser));

route('POST', '/api/login', false, async ({ body }) => {
  const id = str(body.userId, 20);
  const u = /^[A-Za-z0-9-]+$/.test(id) ? await repo.findUser(id) : null;
  if (!u) throw new HttpError(401, '查無此員工編號');
  const token = crypto.randomBytes(24).toString('hex');
  await repo.createSession(token, u.id);
  repo.purgeSessions(new Date(Date.now() - SESSION_MS).toISOString()).catch((e) => console.error('[supabase]', e.message));
  return { token, user: publicUser(u) };
});

route('POST', '/api/logout', true, async ({ token }) => {
  await repo.deleteSession(token);
  return { ok: true };
});

route('GET', '/api/me', true, ({ user }) => publicUser(user));

route('GET', '/api/meta', true, async () => {
  const [staff, rootCauses] = await Promise.all([repo.listUsers({ role: eq('staff') }), repo.distinctRootCauses()]);
  return { categories: C.CATEGORIES, priorities: C.PRIORITIES, statuses: C.STATUSES, sla: C.SLA_HOURS, staff: staff.map(publicUser), rootCauses };
});

// ── 電腦與履歷
route('GET', '/api/my/devices', true, async ({ user }) => {
  const devices = await repo.devicesByOwner(user.id);
  const tickets = devices.length ? await repo.listTickets({ device_id: inList(devices.map((d) => d.id)) }) : [];
  return devices.map((d) => ({ ...d, flags: agent.deviceFlags(d), history: tickets.filter((t) => t.deviceId === d.id).map(ticketRow) }));
});

// ── 報修單
route('GET', '/api/tickets', true, async ({ user, query }) => {
  const staff = user.role === 'staff';
  const f = {};
  if (!staff || query.mine === '1') f.requester_id = eq(user.id);
  if (query.status === 'open') f.status = inList(C.OPEN_STATUSES);
  else if (query.status) f.status = eq(query.status);
  if (query.category) f.category = eq(query.category);
  if (query.priority) f.priority = eq(query.priority);
  if (staff) {
    if (query.assignee === 'none') f.assignee_id = 'is.null';
    else if (query.assignee === 'me') f.assignee_id = eq(user.id);
    else if (query.assignee) f.assignee_id = eq(query.assignee);
  }
  let list = await repo.listTickets(f);
  if (staff && query.overdue === '1') list = list.filter(isOverdue);
  if (query.q) {
    const q = query.q.toLowerCase();
    list = list.filter((t) => `${t.id} ${t.title} ${t.description} ${t.requesterName}`.toLowerCase().includes(q));
  }
  const weight = { 緊急: 0, 高: 1, 中: 2, 低: 3 };
  list = [...list].sort((a, b) => {
    const oa = isOpen(a), ob = isOpen(b);
    if (oa !== ob) return oa ? -1 : 1;
    if (oa && staff && weight[a.priority] !== weight[b.priority]) return weight[a.priority] - weight[b.priority];
    return b.createdAt.localeCompare(a.createdAt);
  });
  return list.slice(0, 300).map(ticketRow);
});

route('POST', '/api/tickets', true, async ({ user, body }) => {
  const title = str(body.title, 100);
  const description = str(body.description, 4000);
  if (!title) throw bad('請填寫問題標題');
  if (!description) throw bad('請描述問題發生的狀況');
  const category = C.CATEGORIES.includes(body.category) ? body.category : '其他';
  const priority = C.PRIORITIES.includes(body.priority) ? body.priority : '中';
  let deviceId = null;
  if (body.deviceId) {
    const d = await repo.getDevice(str(body.deviceId, 40));
    if (!d || d.ownerId !== user.id) throw bad('找不到這台電腦');
    deviceId = d.id;
  }
  const t = await repo.createTicket({ title, description, category, priority, requesterId: user.id, deviceId, source: 'form' });
  return ticketDetail(t, user);
});

route('GET', '/api/tickets/:id', true, async ({ user, params }) => ticketDetail(await loadTicket(params.id, user), user));

route('POST', '/api/tickets/:id/comments', true, async ({ user, params, body }) => {
  const n = { ...(await loadTicket(params.id, user)) };
  const text = str(body.body, 4000);
  if (!text) throw bad('留言不可為空白');
  const staff = user.role === 'staff';
  const internal = staff && !!body.internal;
  const notes = [makeComment(user.id, text, { internal })];
  if (staff && !internal) {
    if (!n.assigneeId) [n.assigneeId, n.assigneeName] = [user.id, user.name];
    if (n.status === '待處理') {
      n.status = '處理中';
      notes.push(makeComment('system', '狀態變更：待處理 → 處理中', { type: 'system' }));
    }
  } else if (!staff) {
    if (n.status === '等待使用者') {
      n.status = '處理中';
      notes.push(makeComment('system', '使用者已回覆，狀態變更：等待使用者 → 處理中', { type: 'system' }));
    } else if (n.status === '已解決' || n.status === '已關閉') {
      n.status = '處理中';
      n.resolvedAt = n.closedAt = null;
      notes.push(makeComment('system', '使用者回覆後重新開啟報修單', { type: 'system' }));
    }
  }
  n.updatedAt = notes[notes.length - 1].at;
  await repo.saveTicket(n, notes);
  return ticketDetail(n, user);
});

route('PATCH', '/api/tickets/:id', true, async ({ user, params, body }) => {
  const n = { ...(await loadTicket(params.id, user)) };
  const staff = user.role === 'staff';
  const notes = [];
  if (!staff) {
    // 使用者只能確認結案或重新開啟自己的單
    if (body.action === 'confirm' && n.status === '已解決') {
      n.status = '已關閉';
      n.closedAt = new Date().toISOString();
      notes.push(makeComment('system', '使用者確認問題已解決，報修單已關閉', { type: 'system' }));
    } else if (body.action === 'reopen' && (n.status === '已解決' || n.status === '已關閉')) {
      n.status = '處理中';
      n.resolvedAt = n.closedAt = null;
      notes.push(makeComment('system', `使用者表示問題尚未解決，重新開啟${body.reason ? '：' + str(body.reason, 500) : ''}`, { type: 'system' }));
    } else throw forbidden();
    n.updatedAt = notes[0].at;
    await repo.saveTicket(n, notes);
    return ticketDetail(n, user);
  }

  const log = [];
  if (body.status && body.status !== n.status) {
    if (!C.STATUSES.includes(body.status)) throw bad('不正確的狀態');
    const resolution = body.resolution !== undefined ? str(body.resolution, 4000) : n.resolution;
    if (body.status === '已解決' && !resolution) throw bad('標示為「已解決」時，請填寫處理方式，之後 IT 小幫手會用它來協助其他同仁');
    log.push(`狀態：${n.status} → ${body.status}`);
    n.status = body.status;
    if (body.status === '已解決') n.resolvedAt = new Date().toISOString();
    if (body.status === '已關閉') n.closedAt = new Date().toISOString();
    if (isOpen(n)) n.resolvedAt = n.closedAt = null;
  }
  if (body.priority && body.priority !== n.priority) {
    if (!C.PRIORITIES.includes(body.priority)) throw bad('不正確的優先順序');
    log.push(`優先順序：${n.priority} → ${body.priority}`);
    n.priority = body.priority;
    n.dueAt = new Date(new Date(n.createdAt).getTime() + C.SLA_HOURS[n.priority] * C.HOUR).toISOString();
  }
  if (body.category && body.category !== n.category) {
    if (!C.CATEGORIES.includes(body.category)) throw bad('不正確的分類');
    log.push(`分類：${n.category} → ${body.category}`);
    n.category = body.category;
  }
  if (body.assigneeId !== undefined && (body.assigneeId || null) !== n.assigneeId) {
    const a = body.assigneeId ? await repo.getUser(str(body.assigneeId, 20)) : null;
    if (body.assigneeId && (!a || a.role !== 'staff')) throw bad('找不到這位客服人員');
    log.push(`負責人：${n.assigneeName || '未指派'} → ${a ? a.name : '未指派'}`);
    n.assigneeId = a ? a.id : null;
    n.assigneeName = a ? a.name : '';
  }
  if (body.resolution !== undefined) n.resolution = str(body.resolution, 4000);
  if (body.rootCause !== undefined) n.rootCause = str(body.rootCause, 60);
  if (log.length) notes.push(makeComment('system', `${user.name} 變更 ${log.join('；')}`, { type: 'system' }));
  n.updatedAt = new Date().toISOString();
  await repo.saveTicket(n, notes);
  return ticketDetail(n, user);
});

// ── 知識庫
route('GET', '/api/kb', true, async ({ query }) => {
  const q = (query.q || '').toLowerCase();
  let list = await repo.listKb();
  if (query.category) list = list.filter((k) => k.category === query.category);
  if (q) list = list.filter((k) => `${k.title} ${k.symptoms} ${k.keywords.join(' ')} ${k.causes.map((c) => c.text).join(' ')}`.toLowerCase().includes(q));
  return list.map((k) => ({
    id: k.id, title: k.title, category: k.category, symptoms: k.symptoms, escalateWhen: k.escalateWhen, severity: k.severity || 'normal',
    causes: k.causes.map((c) => ({ text: c.text, steps: c.steps })),
  }));
});

// ── IT 小幫手
route('POST', '/api/agent/suggest', true, async ({ user, body }) => {
  const text = `${str(body.title, 100)} ${str(body.description, 2000)}`.trim();
  if (text.length < 2) return null;
  const data = await repo.diagnosisData(user.id);
  const d = agent.diagnose(data, { user, text, deviceId: body.deviceId, category: C.CATEGORIES.includes(body.category) ? body.category : undefined });
  return agent.sanitizeForUser(d);
});

async function newConversation(user) {
  const c = agent.newConversation({ devices: await repo.devicesByOwner(user.id) }, user);
  await repo.insertConversation(c);
  return c;
}

async function activeConversation(user) {
  // 只沿用該使用者「最近一次」的對話；已解決、已關閉，或轉人工後報修單已結案的就開新的
  const conv = await repo.latestConversation(user.id);
  let usable = false;
  if (conv && conv.status === 'open') usable = true;
  else if (conv && conv.status === 'escalated' && conv.ticketId) {
    const [t] = await repo.listTickets({ id: eq(conv.ticketId), limit: 1 });
    usable = !!t && isOpen(t);
  }
  return usable ? conv : newConversation(user);
}
const chatView = (c) => ({ id: c.id, status: c.status, ticketId: c.ticketId, messages: c.messages });

route('GET', '/api/chat', true, async ({ user }) => chatView(await activeConversation(user)));

route('POST', '/api/chat/message', true, async ({ user, body }) => {
  const c = await activeConversation(user);
  const data = await repo.diagnosisData(user.id);
  try {
    await agent.handleChat(data, user, c, { text: str(body.text, 1000), action: str(body.action, 30), value: str(body.value, 1000) });
  } finally {
    // 即使中途出錯也要存下已發生的部分（例如已建立的報修單編號），避免對話與報修單脫鉤
    await repo.saveConversation(c).catch((e) => console.error('[supabase]', e.message));
  }
  return chatView(c);
});

route('POST', '/api/chat/new', true, async ({ user }) => {
  const cur = await repo.latestConversation(user.id);
  if (cur && cur.status === 'open') {
    cur.status = 'closed';
    await repo.saveConversation(cur);
  }
  return chatView(await newConversation(user));
});

// ── 客服人員專用
route('GET', '/api/staff/stats', 'staff', async () => {
  const [tickets, convStatuses, staff] = await Promise.all([repo.listTickets(), repo.conversationStatuses(), repo.listUsers({ role: eq('staff') })]);
  const now = Date.now();
  const open = tickets.filter(isOpen);
  const done90 = tickets.filter((t) => t.resolvedAt && now - new Date(t.resolvedAt).getTime() < 90 * C.DAY);
  const avgHours = done90.length ? done90.reduce((s, t) => s + (new Date(t.resolvedAt) - new Date(t.createdAt)) / C.HOUR, 0) / done90.length : 0;
  const count = (arr, key) => Object.entries(arr.reduce((m, t) => ((m[t[key]] = (m[t[key]] || 0) + 1), m), {})).map(([k, n]) => ({ key: k, count: n })).sort((a, b) => b.count - a.count);
  const rc = {};
  for (const t of done90) if (t.rootCause) rc[t.rootCause] = (rc[t.rootCause] || 0) + 1;
  const aiResolved = convStatuses.filter((s) => s === 'resolved').length;
  const escalated = convStatuses.filter((s) => s === 'escalated').length;
  const decided = aiResolved + escalated;
  const weight = { 緊急: 0, 高: 1, 中: 2, 低: 3 };
  return {
    counts: {
      open: open.length, unassigned: open.filter((t) => !t.assigneeId).length, overdue: open.filter(isOverdue).length,
      waiting: open.filter((t) => t.status === '等待使用者').length, awaitingClose: tickets.filter((t) => t.status === '已解決').length,
    },
    avgResolveHours: Math.round(avgHours * 10) / 10,
    byCategory: count(open, 'category'), byStatus: C.STATUSES.map((s) => ({ key: s, count: tickets.filter((t) => t.status === s).length })),
    topRootCauses: Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => ({ key: k, count: n })),
    agent: { conversations: convStatuses.length, aiResolved, escalated, rate: decided ? Math.round((aiResolved / decided) * 100) : null },
    workload: staff.map((u) => ({ id: u.id, name: u.name, open: open.filter((t) => t.assigneeId === u.id).length })),
    queue: open.sort((a, b) => weight[a.priority] - weight[b.priority] || new Date(a.dueAt) - new Date(b.dueAt)).slice(0, 8).map(ticketRow),
  };
});

route('GET', '/api/staff/users', 'staff', async ({ query }) => {
  const q = (query.q || '').toLowerCase();
  const [users, devices, briefs] = await Promise.all([repo.listUsers({ role: eq('user') }), repo.listDevices(), repo.ticketBriefs()]);
  return users.map((u) => {
    const devs = devices.filter((d) => d.ownerId === u.id);
    const mine = briefs.filter((t) => t.requesterId === u.id);
    return { ...publicUser(u), devices: devs.map((d) => ({ id: d.id, label: `${d.assetTag} ${d.brand} ${d.model}` })), ticketCount: mine.length, openCount: mine.filter(isOpen).length };
  }).filter((u) => !q || `${u.id} ${u.name} ${u.dept} ${u.devices.map((d) => d.label).join(' ')}`.toLowerCase().includes(q));
});

route('GET', '/api/staff/users/:id', 'staff', async ({ params }) => {
  const u = await repo.getUser(params.id);
  if (!u || u.role !== 'user') throw notFound('找不到這位使用者');
  const [ownDevices, tickets] = await Promise.all([repo.devicesByOwner(u.id), repo.listTickets({ requester_id: eq(u.id) })]);
  const devices = ownDevices.map((d) => ({ ...d, flags: agent.deviceFlags(d), history: tickets.filter((t) => t.deviceId === d.id).map(ticketRow) }));
  const cats = {};
  for (const t of tickets) cats[t.category] = (cats[t.category] || 0) + 1;
  return { user: publicUser(u), devices, tickets: tickets.map(ticketRow), byCategory: Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, count: n })) };
});

route('GET', '/api/staff/tickets/:id/diagnosis', 'staff', async ({ params }) => {
  const [t] = await repo.listTickets({ id: eq(params.id), limit: 1 });
  if (!t) throw notFound('找不到這張報修單');
  const [requester, data] = await Promise.all([repo.getUser(t.requesterId), repo.diagnosisData(t.requesterId)]);
  // 小幫手轉來的單，標題是知識庫文章名稱而非使用者的話，只用使用者原文才不會拿自己的診斷結果再去比對
  const text = t.source === 'chat' ? t.description : `${t.title} ${t.description}`;
  return agent.diagnose(data, { user: requester, text, deviceId: t.deviceId, category: t.category, excludeId: t.id });
});

route('GET', '/api/staff/records', 'staff', async ({ query }) => {
  const q = (query.q || '').toLowerCase();
  const f = { status: inList(C.DONE_STATUSES), resolution: 'neq.' };
  if (query.category) f.category = eq(query.category);
  if (query.rootCause) f.root_cause = eq(query.rootCause);
  let list = await repo.listTickets(f);
  if (q) list = list.filter((t) => `${t.id} ${t.title} ${t.description} ${t.rootCause} ${t.resolution} ${t.requesterName} ${t.deviceLabel}`.toLowerCase().includes(q));
  const rc = {};
  for (const t of list) if (t.rootCause) rc[t.rootCause] = (rc[t.rootCause] || 0) + 1;
  return {
    total: list.length,
    topRootCauses: Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ key: k, count: n })),
    items: list.slice(0, 100).map((t) => ({ ...ticketRow(t), resolution: t.resolution, resolvedAt: t.resolvedAt })),
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

async function sessionUser(req) {
  const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  if (!m) return {};
  const s = await repo.getSession(m[1]);
  if (!s || !s.user || Date.now() - s.createdAt > SESSION_MS) return {};
  return { user: s.user, token: m[1] };
}

async function handleApi(req, res, url) {
  const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
  if (!r) {
    if (routes.some((x) => x.re.test(url.pathname))) throw new HttpError(405, '不支援的請求方法');
    throw notFound('找不到 API');
  }
  const m = r.re.exec(url.pathname);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const { user, token } = r.auth ? await sessionUser(req) : {};
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
    let status = e.status || 500;
    let message = e.status ? e.message : '伺服器發生錯誤，請稍後再試';
    if (e instanceof sb.SupabaseError) {
      console.error('[supabase]', e.message);
      status = 502;
      message = '資料庫暫時無法使用，請稍後再試';
    } else if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) sendJson(res, status, { error: message });
  }
});

if (!sb.enabled) {
  console.error('缺少 Supabase 設定：請在 .env 設定 SUPABASE_URL、SUPABASE_KEY（與 SUPABASE_APP_SECRET），可參考 .env.example');
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`IT 客服中心已啟動：http://localhost:${PORT}`);
  repo.ping().then(
    (n) => console.log(n ? '已連線到 Supabase' : '已連線到 Supabase，但讀不到任何資料：請確認 SUPABASE_APP_SECRET 正確，且已執行過 npm run seed'),
    (e) => console.error('無法讀取 Supabase：' + e.message),
  );
});
