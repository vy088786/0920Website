'use strict';
const fs = require('fs');
const path = require('path');

// 讀取專案根目錄的 .env（不覆蓋已存在的環境變數）
function loadEnv() {
  let text;
  try {
    text = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnv();

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/rest/v1';
const KEY = process.env.SUPABASE_KEY || '';
// 資料表的 RLS 只放行帶有此密鑰的請求；改用 service_role 金鑰時可留空
const APP_SECRET = process.env.SUPABASE_APP_SECRET || '';
const enabled = !!(process.env.SUPABASE_URL && KEY);

class SupabaseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* PostgREST 篩選條件：呼叫端傳 { 欄位: eq('x') }，其中的值會經過 URL 編碼 */
const q = (v) => `"${String(v).replace(/["\\]/g, '\\$&')}"`;
const eq = (v) => 'eq.' + v;
const inList = (arr) => `in.(${arr.map(q).join(',')})`;

async function request(method, table, { params = {}, body, prefer } = {}) {
  if (!enabled) throw new SupabaseError(500, '尚未設定 SUPABASE_URL／SUPABASE_KEY');
  const qs = new URLSearchParams(params).toString();
  let res;
  try {
    res = await fetch(`${BASE}/${table}${qs ? '?' + qs : ''}`, {
      method,
      headers: {
        apikey: KEY,
        Authorization: 'Bearer ' + KEY,
        ...(APP_SECRET ? { 'x-app-secret': APP_SECRET } : {}),
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new SupabaseError(0, `無法連線到 Supabase：${e.cause?.code || e.message}`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* 非 JSON 回應 */ }
    throw new SupabaseError(res.status, `${method} ${table} 失敗（${res.status}）${detail}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const select = (table, params) => request('GET', table, { params });
const insert = (table, rows, { returning = false } = {}) => request('POST', table, { body: rows, prefer: returning ? 'return=representation' : 'return=minimal' });
const update = (table, params, patch, { returning = false } = {}) => request('PATCH', table, { params, body: patch, prefer: returning ? 'return=representation' : 'return=minimal' });
const remove = (table, params) => request('DELETE', table, { params, prefer: 'return=minimal' });

module.exports = { enabled, SupabaseError, eq, inList, select, insert, update, remove };
