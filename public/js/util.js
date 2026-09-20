// 共用工具：API、安全的 HTML 樣板、圖示、格式化
export const state = {
  token: localStorage.getItem('itsc.token') || '',
  user: null,
  meta: null,
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 回應 */ }
  if (res.status === 401 && state.token) {
    // 登入已失效
    localStorage.removeItem('itsc.token');
    state.token = '';
    location.hash = '#/login';
    location.reload();
    throw new Error('登入已過期，請重新登入');
  }
  if (!res.ok) throw new Error((data && data.error) || '發生錯誤，請稍後再試');
  return data;
}

/* ── 自動跳脫的 HTML 樣板：所有插入的值都會 escape，除非包過 raw() ── */
class Raw { constructor(s) { this.s = s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(v));
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Raw(out);
}
export const mount = (el, tpl) => { el.innerHTML = tpl.s; return el; };

/* ── 圖示 ── */
const ICONS = {
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  laptop: 'M4 5h16v11H4zM2 19h20',
  book: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM4 17a3 3 0 0 1 3-3h11',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  db: 'M3 5c0-1.1 4-2 9-2s9 .9 9 2-4 2-9 2-9-.9-9-2zM3 5v14c0 1.1 4 2 9 2s9-.9 9-2V5M3 12c0 1.1 4 2 9 2s9-.9 9-2',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  bot: 'M12 8V4M8 4h8M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 14h.01M15 14h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  desktop: 'M3 4h18v12H3zM8 20h8M12 16v4',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
};
export const icon = (name) => raw(`<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`);

/* ── 格式化 ── */
const p2 = (n) => String(n).padStart(2, '0');
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function fmtDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`;
}
export function relTime(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '剛剛';
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return fmtDay(iso);
}
export function dueText(t) {
  if (['已解決', '已關閉'].includes(t.status)) return html`<span class="muted">—</span>`;
  const ms = new Date(t.dueAt).getTime() - Date.now();
  const h = Math.abs(ms) / 36e5;
  const txt = h >= 48 ? `${Math.round(h / 24)} 天` : h >= 1 ? `${Math.round(h)} 小時` : `${Math.max(1, Math.round(h * 60))} 分鐘`;
  return ms < 0 ? html`<span class="overdue">逾期 ${txt}</span>` : html`<span class="muted">剩 ${txt}</span>`;
}
export const statusBadge = (s) => html`<span class="badge s-${s}">${s}</span>`;
export const prioBadge = (p) => html`<span class="badge p-${p}">${p}</span>`;
export const initial = (name) => (name || '?').slice(0, 1);

export function toast(msg, type = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const loading = () => html`<div class="loading"><div class="spin" role="status" aria-label="載入中"></div></div>`;
export const empty = (text, ic = 'inbox') => html`<div class="empty">${icon(ic)}<p>${text}</p></div>`;

// 進度條：label / count
export function bars(items, { max } = {}) {
  const m = max || Math.max(1, ...items.map((i) => i.count));
  if (!items.length) return html`<p class="muted small">目前沒有資料</p>`;
  return html`<div class="bars">${items.map((i) => html`
    <div class="bar"><span class="name" title="${i.key}">${i.key}</span><div class="track"><div class="fill" style="width:${Math.round((i.count / m) * 100)}%"></div></div><span class="num">${i.count}</span></div>`)}</div>`;
}

// 電腦健康標籤
export const flagChips = (flags) => html`<div class="chips">${flags.map((f) => html`<span class="chip ${f.level === 'bad' ? 'bad' : f.level === 'warn' ? 'warn' : f.level === 'ok' ? 'ok' : 'info'}">${f.label}</span>`)}</div>`;

export function deviceCard(d, flags, { extra } = {}) {
  const disk = d.diskFreePct;
  return html`<div class="card device">
    <div class="row"><span class="name">${d.brand} ${d.model}</span><span class="badge">${d.type}</span><span class="mono small muted right">${d.assetTag}</span></div>
    <div class="specs">
      <div><span>作業系統</span><br>${d.os}</div><div><span>處理器</span><br>${d.cpu}</div>
      <div><span>記憶體／儲存</span><br>${d.ramGB}GB／${d.storage}</div><div><span>位置</span><br>${d.location}</div>
      <div><span>購買日期</span><br>${d.purchaseDate}</div><div><span>主機名稱</span><br><span class="mono">${d.hostname}</span></div>
    </div>
    ${disk != null ? html`<div class="small muted" style="margin-bottom:4px">系統磁碟剩餘空間 ${disk}%</div><div class="meter ${disk < 10 ? 'low' : disk < 20 ? 'mid' : ''}"><i style="width:${disk}%"></i></div>` : ''}
    <div style="margin-top:12px">${flagChips(flags)}</div>
    ${extra || ''}
  </div>`;
}

// 診斷結果（IT 小幫手／客服人員共用）
export function diagnosisHtml(d, { staff = false, compact = false } = {}) {
  const lvl = { high: '可能性高', mid: '可能性中', low: '可能性低' };
  return html`<div class="diag">
    ${compact ? '' : html`<section><details class="fold"><summary>${icon('sparkle')} 小幫手查詢了什麼（${d.trace.length} 個步驟）</summary>
      <ol class="trace" style="margin-top:12px">${d.trace.map((t) => html`<li><div><b>${t.title}</b><div class="d">${t.detail}</div></div></li>`)}</ol></details></section>`}
    ${d.device ? html`<section><h4>${icon('laptop')} 使用電腦${d.deviceAssumed ? '（預設）' : ''}</h4>
      <div class="row" style="margin-bottom:8px"><b>${d.device.brand} ${d.device.model}</b><span class="mono small muted">${d.device.assetTag}</span><span class="small muted">${d.device.os}</span></div>
      ${flagChips(d.deviceFlags)}</section>` : ''}
    ${d.causes.length ? html`<section><h4>${icon('search')} 可能原因與排除步驟${d.matches[0] ? html`<span class="muted" style="font-weight:400">・${d.matches[0].title}</span>` : ''}</h4>
      ${d.causes.map((c, i) => html`<details class="cause ${c.level}" ${i === 0 ? 'open' : ''}>
        <summary><span class="ct">${c.text}</span><span class="pbar" title="${lvl[c.level]}"><i style="width:${c.pct}%"></i></span><span class="pct">${c.pct}%</span></summary>
        <div class="cb">
          ${c.evidence.length ? html`<div class="chips" style="margin-bottom:10px">${c.evidence.map((e) => html`<span class="chip info">${icon('check')} ${e}</span>`)}</div>` : ''}
          <ol>${c.steps.map((s) => html`<li>${s}</li>`)}</ol>
        </div></details>`)}
      ${d.matches[0] && d.matches[0].escalateWhen ? html`<p class="small muted" style="margin-top:6px">${icon('info')} 何時該轉客服人員：${d.matches[0].escalateWhen}</p>` : ''}
    </section>` : ''}
    ${d.openRelated && d.openRelated.length ? html`<section><div class="callout warn">${icon('alert')}<div>這台電腦已有處理中的相關報修單：${d.openRelated.map((r, i) => html`${i ? '、' : ''}<a href="#/tickets/${r.id}">${r.id}（${r.status}）</a>`)}</div></div></section>` : ''}
    ${d.escalation.reasons.length || d.notes.length ? html`<section>
      ${d.escalation.reasons.map((r) => html`<div class="callout ${r.level === 'must' ? 'bad' : 'warn'}" style="margin-bottom:8px">${icon('alert')}<div>${r.text}</div></div>`)}
      ${d.notes.map((n) => html`<div class="callout" style="margin-bottom:8px">${icon('info')}<div>${n}</div></div>`)}
    </section>` : ''}
    ${compact ? '' : html`
      ${d.deviceHistory.length ? html`<section><h4>${icon('history')} 這台電腦的維修履歷（${d.deviceHistory.length}）</h4>
        ${d.deviceHistory.slice(0, 4).map((t) => html`<div class="case"><a href="#/tickets/${t.id}">${t.id}</a> ${t.title} <span class="badge s-${t.status}">${t.status}</span> <span class="muted tiny">${fmtDay(t.createdAt)}</span>
          ${t.resolution ? html`<div class="rs">處理：${t.resolution}</div>` : ''}</div>`)}</section>` : ''}
      ${d.similarCases.length ? html`<section><h4>${icon('db')} 全公司類似案例（${d.similarCases.length}）</h4>
        ${d.companyStats.topRootCauses.length ? html`<div class="chips" style="margin-bottom:10px">${d.companyStats.topRootCauses.map((r) => html`<span class="chip">${r.rc} × ${r.count}</span>`)}</div>` : ''}
        ${d.similarCases.slice(0, 4).map((s) => html`<div class="case">
          ${s.id ? html`<a href="#/tickets/${s.id}">${s.id}</a>` : ''} ${s.title}${s.own ? html` <span class="chip">您的案例</span>` : ''}${s.sameModel ? html` <span class="chip info">同機型</span>` : ''}
          ${staff && s.requesterName ? html` <span class="muted tiny">${s.requesterName}</span>` : ''}
          <div class="rs">${s.rootCause ? html`根因：${s.rootCause}；` : ''}處理：${s.resolution}</div></div>`)}</section>` : ''}`}
  </div>`;
}
