'use strict';
// 資料存取層：所有資料都在 Supabase。這裡負責「資料表欄位（snake_case）↔ 應用程式物件（camelCase）」的轉換，
// 轉出來的形狀與原本 JSON 儲存時完全相同，所以診斷引擎與前端不需要改。
const sb = require('./supabase');
const { eq, inList } = sb;
const { HOUR, SLA_HOURS, DONE_STATUSES } = require('./constants');

const iso = (v) => (v ? new Date(v).toISOString() : null);

/* ───────────── 轉換：資料列 → 物件 ───────────── */

const userOut = (r) => r && ({ id: r.id, name: r.name, dept: r.dept, title: r.title, role: r.role, email: r.email, ext: r.ext });

const deviceOut = (r) => ({
  id: r.id, assetTag: r.asset_tag, hostname: r.hostname, ownerId: r.owner_id, type: r.type, brand: r.brand, model: r.model, os: r.os, cpu: r.cpu,
  ramGB: r.ram_gb, storage: r.storage, diskFreePct: r.disk_free_pct, purchaseDate: r.purchase_date, warrantyEnd: r.warranty_end,
  lastPatchDate: r.last_patch_date, antivirus: r.antivirus, batteryHealthPct: r.battery_health_pct, uptimeDays: r.uptime_days,
  location: r.location, primary: r.is_primary,
});

const kbOut = (r) => ({
  id: r.id, title: r.title, category: r.category, keywords: r.keywords, symptoms: r.symptoms, escalateWhen: r.escalate_when,
  severity: r.severity || undefined, priority: r.priority || undefined, escalateAlways: r.escalate_always || undefined,
  escalateNote: r.escalate_note || undefined, causes: r.causes,
});

const ticketOut = (r) => ({
  id: r.id, title: r.title, description: r.description, category: r.category, priority: r.priority, status: r.status, source: r.source,
  requesterId: r.requester_id, deviceId: r.device_id, assigneeId: r.assignee_id,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), dueAt: iso(r.due_at), resolvedAt: iso(r.resolved_at), closedAt: iso(r.closed_at),
  rootCause: r.root_cause, resolution: r.resolution, aiSummary: r.ai_summary ?? null, transcript: r.transcript ?? null,
  // 由關聯欄位帶出（沒有 select 這些關聯時為空）
  requesterName: r.requester?.name || '', requesterDept: r.requester?.dept || '',
  deviceLabel: r.device ? `${r.device.asset_tag} ${r.device.brand} ${r.device.model}` : '',
  assigneeName: r.assignee?.name || '',
});

const commentOut = (r) => ({ by: r.by_id, type: r.type, body: r.body, internal: r.internal, at: iso(r.created_at) });

const convOut = (r) => ({
  id: r.id, userId: r.user_id, status: r.status, ticketId: r.ticket_id, messages: r.messages, ctx: r.ctx,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

/* ───────────── 轉換：物件 → 資料列 ───────────── */

const toRow = {
  user: (u) => ({ id: u.id, name: u.name, dept: u.dept, title: u.title, role: u.role, email: u.email, ext: u.ext }),
  device: (d) => ({
    id: d.id, asset_tag: d.assetTag, hostname: d.hostname, owner_id: d.ownerId, type: d.type, brand: d.brand, model: d.model, os: d.os, cpu: d.cpu,
    ram_gb: d.ramGB, storage: d.storage, disk_free_pct: d.diskFreePct, purchase_date: d.purchaseDate, warranty_end: d.warrantyEnd,
    last_patch_date: d.lastPatchDate, antivirus: d.antivirus, battery_health_pct: d.batteryHealthPct, uptime_days: d.uptimeDays,
    location: d.location, is_primary: !!d.primary,
  }),
  kb: (k) => ({
    id: k.id, title: k.title, category: k.category, keywords: k.keywords, symptoms: k.symptoms, escalate_when: k.escalateWhen,
    severity: k.severity || null, priority: k.priority || null, escalate_always: !!k.escalateAlways, escalate_note: k.escalateNote || null, causes: k.causes,
  }),
  ticket: (t) => ({
    id: t.id, title: t.title, description: t.description, category: t.category, priority: t.priority, status: t.status, source: t.source,
    requester_id: t.requesterId, device_id: t.deviceId, assignee_id: t.assigneeId, created_at: t.createdAt, updated_at: t.updatedAt,
    due_at: t.dueAt, resolved_at: t.resolvedAt, closed_at: t.closedAt, root_cause: t.rootCause, resolution: t.resolution,
    ai_summary: t.aiSummary, transcript: t.transcript,
  }),
  comment: (ticketId, c) => ({ ticket_id: ticketId, by_id: c.by, type: c.type, body: c.body, internal: !!c.internal, created_at: c.at }),
  conversation: (c) => ({
    id: c.id, user_id: c.userId, status: c.status, ticket_id: c.ticketId, messages: c.messages, ctx: c.ctx, created_at: c.createdAt, updated_at: c.updatedAt,
  }),
};

/* ───────────── 使用者、登入 ───────────── */

const USER_COLS = 'id,name,dept,title,role,email,ext';

const listUsers = async (filter = {}) => (await sb.select('users', { select: USER_COLS, order: 'id', ...filter })).map(userOut);
const getUser = async (id) => userOut((await sb.select('users', { select: USER_COLS, id: eq(id), limit: 1 }))[0]);
// 員工編號不分大小寫；呼叫端需先確認 id 只含英數與連字號（ilike 的萬用字元不能混進來）
const findUser = async (id) => userOut((await sb.select('users', { select: USER_COLS, id: 'ilike.' + id, limit: 1 }))[0]);
const usersByIds = async (ids) => (ids.length ? (await listUsers({ id: inList(ids) })) : []);

const createSession = (token, userId) => sb.insert('sessions', { token, user_id: userId });
const deleteSession = (token) => sb.remove('sessions', { token: eq(token) });
const purgeSessions = (olderThanIso) => sb.remove('sessions', { created_at: 'lt.' + olderThanIso });
async function getSession(token) {
  const r = (await sb.select('sessions', { select: `created_at,user:users(${USER_COLS})`, token: eq(token), limit: 1 }))[0];
  return r && { createdAt: new Date(r.created_at).getTime(), user: userOut(r.user) };
}

/* ───────────── 電腦、知識庫 ───────────── */

const listDevices = async (filter = {}) => (await sb.select('devices', { select: '*', order: 'id', ...filter })).map(deviceOut);
const devicesByOwner = (ownerId) => listDevices({ owner_id: eq(ownerId) });
const getDevice = async (id) => (await listDevices({ id: eq(id), limit: 1 }))[0] || null;
const listKb = async () => (await sb.select('kb_articles', { select: '*', order: 'id' })).map(kbOut);

/* ───────────── 報修單 ───────────── */

const T_COLS = 'id,title,description,category,priority,status,source,requester_id,device_id,assignee_id,created_at,updated_at,due_at,resolved_at,closed_at,root_cause,resolution';
const T_EMBED = 'requester:users!requester_id(name,dept),device:devices(asset_tag,brand,model),assignee:users!assignee_id(name)';
const T_LIST = `${T_COLS},${T_EMBED}`;
const T_FULL = `${T_LIST},ai_summary,transcript`;

// 列表用（不含診斷摘要與對話逐字稿，內容較大）
const listTickets = async (filter = {}) => (await sb.select('tickets', { select: T_LIST, order: 'created_at.desc', ...filter })).map(ticketOut);
const getTicket = async (id) => {
  const r = (await sb.select('tickets', { select: T_FULL, id: eq(id), limit: 1 }))[0];
  return r ? ticketOut(r) : null;
};

async function createTicket(o) {
  const now = new Date().toISOString();
  const priority = SLA_HOURS[o.priority] ? o.priority : '中';
  const [row] = await sb.insert('tickets', {
    title: o.title, description: o.description, category: o.category, priority, status: '待處理', source: o.source || 'form',
    requester_id: o.requesterId, device_id: o.deviceId || null, assignee_id: null,
    created_at: now, updated_at: now, due_at: new Date(Date.now() + SLA_HOURS[priority] * HOUR).toISOString(),
    ai_summary: o.aiSummary || null, transcript: o.transcript || null,
  }, { returning: true });
  const first = { by: 'system', type: 'system', internal: false, at: now, body: o.source === 'chat' ? '由 IT 小幫手轉交客服人員，已附上電腦資料、診斷紀錄與對話' : '報修單已建立' };
  try {
    await sb.insert('ticket_comments', toRow.comment(row.id, first));
  } catch (e) {
    await sb.remove('tickets', { id: eq(row.id) }).catch(() => {});
    throw e;
  }
  return getTicket(row.id);
}

// 這幾個欄位可由處理流程修改；其餘（標題、描述、報修人…）建立後不變
const MUTABLE = { status: 'status', priority: 'priority', category: 'category', assigneeId: 'assignee_id', dueAt: 'due_at', resolvedAt: 'resolved_at', closedAt: 'closed_at', rootCause: 'root_cause', resolution: 'resolution', updatedAt: 'updated_at' };

// 存回報修單的可變欄位，並一併新增這次產生的留言
async function saveTicket(t, comments = []) {
  const patch = Object.fromEntries(Object.entries(MUTABLE).map(([k, col]) => [col, t[k] ?? null]));
  const jobs = [sb.update('tickets', { id: eq(t.id) }, patch)];
  if (comments.length) jobs.push(sb.insert('ticket_comments', comments.map((c) => toRow.comment(t.id, c))));
  await Promise.all(jobs);
}

const addComment = (ticketId, c) => Promise.all([
  sb.insert('ticket_comments', toRow.comment(ticketId, c)),
  sb.update('tickets', { id: eq(ticketId) }, { updated_at: c.at }),
]);

// 只取「誰的、什麼狀態」，給使用者查詢頁統計筆數用
const ticketBriefs = async () => (await sb.select('tickets', { select: 'requester_id,status' })).map((r) => ({ requesterId: r.requester_id, status: r.status }));

const getComments = async (ticketId) => (await sb.select('ticket_comments', { select: 'by_id,type,body,internal,created_at', ticket_id: eq(ticketId), order: 'created_at,id' })).map(commentOut);

async function distinctRootCauses() {
  const rows = await sb.select('tickets', { select: 'root_cause', root_cause: 'neq.' });
  return [...new Set(rows.map((r) => r.root_cause).filter(Boolean))].sort();
}

/* ───────────── 小幫手對話 ───────────── */

const latestConversation = async (userId) => {
  const r = (await sb.select('conversations', { select: '*', user_id: eq(userId), order: 'created_at.desc', limit: 1 }))[0];
  return r ? convOut(r) : null;
};
const insertConversation = (c) => sb.insert('conversations', toRow.conversation(c));
const saveConversation = (c) => sb.update('conversations', { id: eq(c.id) }, {
  status: c.status, ticket_id: c.ticketId, messages: c.messages, ctx: c.ctx, updated_at: c.updatedAt,
});
const conversationStatuses = async () => (await sb.select('conversations', { select: 'status' })).map((r) => r.status);

/* ───────────── 診斷引擎需要的資料 ───────────── */

// 診斷引擎（lib/agent.js 的 diagnose）只讀一份 { users, devices, kb, tickets }：
// tickets = 此使用者的全部報修單 ＋ 全公司已結案且有處理方式的報修單（相似案例比對的來源）
async function diagnosisData(userId) {
  const [users, devices, kb, mine, pool] = await Promise.all([
    listUsers(), listDevices(), listKb(),
    sb.select('tickets', { select: T_COLS, requester_id: eq(userId) }),
    sb.select('tickets', { select: T_COLS, status: inList(DONE_STATUSES), resolution: 'neq.' }),
  ]);
  const byId = new Map();
  for (const r of [...mine, ...pool]) byId.set(r.id, ticketOut(r));
  return { users, devices, kb, tickets: [...byId.values()] };
}

// 回傳讀到的使用者筆數（RLS 密鑰不符時不會報錯，只是讀不到資料）
const ping = async () => (await sb.select('users', { select: 'id', limit: 1 })).length;

module.exports = {
  toRow,
  listUsers, getUser, findUser, usersByIds, createSession, deleteSession, purgeSessions, getSession,
  listDevices, devicesByOwner, getDevice, listKb,
  listTickets, getTicket, createTicket, saveTicket, addComment, ticketBriefs, getComments, distinctRootCauses,
  latestConversation, insertConversation, saveConversation, conversationStatuses,
  diagnosisData, ping,
};
