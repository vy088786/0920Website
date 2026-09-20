// 一般使用者的頁面：首頁、IT 小幫手、報修、我的報修、我的電腦、知識庫
import { api, state, html, mount, icon, fmtDate, fmtDay, relTime, statusBadge, toast, debounce, loading, empty, flagChips, deviceCard, diagnosisHtml } from './util.js';

const OPEN = ['待處理', '處理中', '等待使用者'];

/* ───────────── 首頁 ───────────── */
export async function homePage(view) {
  mount(view, loading());
  const [devices, tickets, kb] = await Promise.all([api('/my/devices'), api('/tickets'), api('/kb')]);
  const open = tickets.filter((t) => OPEN.includes(t.status));
  const toConfirm = tickets.filter((t) => t.status === '已解決');
  mount(view, html`<div class="page stack">
    <div class="hero">
      <div style="flex:1;min-width:260px">
        <h1>${state.user.name}，需要什麼協助？</h1>
        <p>直接問 IT 小幫手：它會查您的電腦資料、維修履歷與全公司維修記錄，幫您找出原因與排除方式；解決不了再一鍵轉給客服人員。</p>
      </div>
      <div class="row">
        <a class="btn primary lg" href="#/chat">${icon('bot')} 詢問 IT 小幫手</a>
        <a class="btn ghost lg" href="#/new">${icon('wrench')} 我要報修</a>
      </div>
    </div>

    ${toConfirm.length ? html`<div class="callout"><div>${icon('check')}</div><div>有 ${toConfirm.length} 張報修單已處理完成，請確認問題是否解決：${toConfirm.map((t, i) => html`${i ? '、' : ''}<a href="#/tickets/${t.id}">${t.id}</a>`)}</div></div>` : ''}

    <div class="split even">
      <div class="card">
        <div class="card-h"><h3>${icon('list')} 處理中的報修</h3><a class="small right" href="#/tickets">全部報修 →</a></div>
        ${open.length ? html`<div class="list">${open.slice(0, 5).map((t) => html`
          <a class="trow" style="grid-template-columns:minmax(0,1fr) auto" href="#/tickets/${t.id}">
            <div class="t-title"><div class="ellip">${t.title}</div><div class="sub">${t.id}・${relTime(t.updatedAt)}更新${t.assigneeName ? '・' + t.assigneeName + ' 處理中' : '・等待分派'}</div></div>${statusBadge(t.status)}</a>`)}</div>`
          : empty('目前沒有處理中的報修單', 'check')}
      </div>
      <div class="card">
        <div class="card-h"><h3>${icon('laptop')} 我的電腦</h3><a class="small right" href="#/devices">詳細資料 →</a></div>
        ${devices.length ? html`<div class="list">${devices.map((d) => html`
          <div class="trow" style="grid-template-columns:minmax(0,1fr)">
            <div class="row"><b>${d.brand} ${d.model}</b><span class="mono small muted">${d.assetTag}</span></div>
            <div class="small muted">${d.os}・${d.location}</div>
            ${flagChips(d.flags.filter((f) => f.level !== 'ok').slice(0, 3))}
          </div>`)}</div>` : empty('您的帳號下沒有登記的電腦', 'desktop')}
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h3>${icon('book')} 常見問題</h3><a class="small right" href="#/kb">知識庫 →</a></div>
      <div class="pad chips">${kb.filter((k) => k.severity !== 'critical').slice(0, 10).map((k) => html`<a class="chip" href="#/kb?open=${k.id}">${k.title}</a>`)}</div>
    </div>
  </div>`);
}

/* ───────────── IT 小幫手（聊天） ───────────── */
function cardHtml(c) {
  if (c.type === 'diagnosis') return diagnosisHtml(c.data);
  if (c.type === 'tickets') {
    return html`<div class="card">${c.items.map((t) => html`<a class="trow" style="grid-template-columns:76px minmax(0,1fr) auto" href="#/tickets/${t.id}"><span class="mono small">${t.id}</span><span class="t-title ellip">${t.title}</span>${statusBadge(t.status)}</a>`)}</div>`;
  }
  if (c.type === 'devices') return html`<div class="stack">${c.items.map((x) => deviceCard(x.device, x.flags))}</div>`;
  if (c.type === 'ticket') {
    return html`<div class="callout"><div>${icon('check')}</div><div><b>${c.id}</b>・${c.title}<div class="small muted">優先順序 ${c.priority}・狀態 ${c.status}</div></div></div>`;
  }
  return '';
}

function actionsHtml(actions) {
  return html`<div class="actions-row">${actions.map((a) => {
    const cls = `btn sm ${a.primary ? 'primary' : ''} ${a.ghost ? 'ghost' : ''}`;
    return a.href
      ? html`<a class="${cls}" href="${a.href}">${a.label}</a>`
      : html`<button class="${cls}" data-action="${a.action}" data-value="${a.value ?? ''}">${a.label}</button>`;
  })}</div>`;
}

function msgHtml(m, isLast) {
  if (m.role === 'user') {
    return html`<div class="msg user"><div class="col"><div class="bubble">${m.text}</div><div class="time">${fmtDate(m.at)}</div></div></div>`;
  }
  return html`<div class="msg agent"><div class="av">${icon('bot')}</div><div class="col">
    <div class="bubble">${m.text}</div>${m.card ? cardHtml(m.card) : ''}${isLast && m.actions && m.actions.length ? actionsHtml(m.actions) : ''}
    <div class="time">IT 小幫手・${fmtDate(m.at)}</div></div></div>`;
}

export async function chatPage(view) {
  mount(view, loading());
  let conv = await api('/chat');
  let busy = false;

  mount(view, html`<div class="chat-wrap">
    <div class="chat-top"><h2>${icon('bot')} IT 小幫手</h2><span class="chip ok">線上</span>
      <span class="small muted">會查詢您的電腦資料、維修履歷與全公司維修記錄</span>
      <button class="btn sm right" id="new-chat">${icon('refresh')} 新對話</button></div>
    <div class="chat-log" id="log" aria-live="polite"></div>
    <form class="composer" id="form">
      <textarea id="input" rows="1" maxlength="1000" placeholder="描述您遇到的問題，例如：電腦變很慢、Outlook 收不到信…（Enter 送出，Shift+Enter 換行）" aria-label="訊息"></textarea>
      <button class="btn primary" id="send" type="submit">${icon('send')} 送出</button>
    </form></div>`);

  const log = view.querySelector('#log');
  const input = view.querySelector('#input');
  const sendBtn = view.querySelector('#send');

  const render = (pending = false) => {
    const n = conv.messages.length;
    mount(log, html`${conv.messages.map((m, i) => msgHtml(m, i === n - 1 && !pending))}
      ${pending ? html`<div class="msg agent"><div class="av">${icon('bot')}</div><div class="bubble typing" aria-label="小幫手正在查詢"><i></i><i></i><i></i></div></div>` : ''}`);
    log.scrollTop = log.scrollHeight;
  };

  async function send(payload) {
    if (busy) return;
    busy = true;
    sendBtn.disabled = true;
    const shown = payload.text || (payload.action === 'say' ? payload.value : '');
    if (shown) conv.messages.push({ role: 'user', text: shown, at: new Date().toISOString() });
    render(true);
    try {
      conv = await api('/chat/message', { method: 'POST', body: payload });
    } catch (e) {
      toast(e.message, 'err');
      conv = await api('/chat').catch(() => conv);
    }
    busy = false;
    sendBtn.disabled = false;
    render();
    input.focus();
  }

  view.querySelector('#form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = '';
    send({ text });
  });
  input.addEventListener('keydown', (e) => {
    // 輸入法選字時的 Enter 不送出
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      view.querySelector('#form').requestSubmit();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });

  async function newChat() {
    conv = await api('/chat/new', { method: 'POST' });
    render();
  }
  log.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b || busy) return;
    if (b.dataset.action === 'new') return newChat();
    send({ action: b.dataset.action, value: b.dataset.value });
  });
  view.querySelector('#new-chat').addEventListener('click', newChat);
  render();
  input.focus();
}

/* ───────────── 報修 ───────────── */
export async function newTicketPage(view, _params, query) {
  mount(view, loading());
  const [devices, meta] = await Promise.all([api('/my/devices'), api('/meta')]);
  const preset = devices.find((d) => d.id === query.device) || devices.find((d) => d.primary) || devices[0];

  mount(view, html`<div class="page">
    <div class="page-head"><div><h1>我要報修</h1><p>描述問題後，IT 小幫手會即時提供可能的原因與自助排除方式，也許不用報修就能解決。</p></div></div>
    <div class="split">
      <form class="card pad" id="form" novalidate>
        <div class="grid g2">
          <div class="field"><label for="device">有問題的電腦</label>
            <select id="device"><option value="">不指定／非公司設備</option>${devices.map((d) => html`<option value="${d.id}" ${preset && preset.id === d.id ? 'selected' : ''}>${d.assetTag}｜${d.brand} ${d.model}</option>`)}</select></div>
          <div class="field"><label for="category">問題分類</label>
            <select id="category">${meta.categories.map((c) => html`<option ${c === '其他' ? 'selected' : ''}>${c}</option>`)}</select>
            <span class="hint" id="cat-hint">輸入內容後，小幫手會建議分類</span></div>
        </div>
        <div class="field"><label for="title">問題標題</label><input id="title" maxlength="100" placeholder="一句話說明，例如：Outlook 打不開" autocomplete="off"></div>
        <div class="field"><label for="desc">問題描述</label>
          <textarea id="desc" maxlength="4000" placeholder="請說明：發生什麼事？什麼時候開始？有出現錯誤訊息嗎？您已經試過什麼方法？"></textarea></div>
        <div class="field"><label for="priority">緊急程度</label>
          <select id="priority">${meta.priorities.map((p) => html`<option value="${p}" ${p === '中' ? 'selected' : ''}>${p}（目標 ${meta.sla[p] >= 24 ? meta.sla[p] / 24 + ' 天' : meta.sla[p] + ' 小時'}內處理）</option>`)}</select>
          <span class="hint">影響整個部門或完全無法工作時，才選「高」或「緊急」。</span></div>
        <div class="err" id="err" role="alert"></div>
        <div class="row" style="margin-top:8px"><button class="btn primary" type="submit" id="submit">${icon('send')} 送出報修</button><a class="btn ghost" href="#/home">取消</a></div>
      </form>

      <aside class="card sticky" aria-live="polite">
        <div class="card-h"><h3>${icon('bot')} IT 小幫手建議</h3></div>
        <div class="pad" id="suggest"><p class="muted small">在左邊輸入問題後，這裡會顯示可能原因與排除步驟。</p></div>
      </aside>
    </div>
  </div>`);

  const $ = (id) => view.querySelector('#' + id);
  let touched = { category: false, priority: false };
  let seq = 0;
  $('category').addEventListener('change', () => { touched.category = true; });
  $('priority').addEventListener('change', () => { touched.priority = true; });

  const suggest = debounce(async () => {
    const my = ++seq;
    const title = $('title').value, description = $('desc').value;
    if ((title + description).trim().length < 4) return;
    let d;
    try {
      d = await api('/agent/suggest', { method: 'POST', body: { title, description, deviceId: $('device').value || undefined, category: touched.category ? $('category').value : undefined } });
    } catch { return; }
    if (my !== seq || !d) return;
    if (!touched.category && d.matches.length) { $('category').value = d.category; $('cat-hint').textContent = '已依內容建議分類，可自行調整'; }
    if (!touched.priority && d.priority !== '中' && d.matches.length) $('priority').value = d.priority;
    mount($('suggest'), d.matches.length
      ? html`${diagnosisHtml(d, { compact: true })}
        ${d.similarCases.length ? html`<p class="small muted" style="margin-top:10px">${icon('db')} 全公司有 ${d.similarCases.length} 件類似案例；最常見的處理方式：${d.similarCases[0].resolution}</p>` : ''}
        <div class="row" style="margin-top:12px"><a class="btn sm" href="#/chat">${icon('chat')} 改問小幫手</a><button class="btn sm ghost" type="button" id="solved">我自己解決了，不用報修</button></div>`
      : html`<p class="muted small">找不到明確對應的解法，請直接送出報修，客服人員會協助您。</p>`);
    const s = $('solved');
    if (s) s.onclick = () => { toast('太好了！問題解決就不用報修。'); location.hash = '#/home'; };
  }, 700);
  for (const id of ['title', 'desc', 'device']) $(id).addEventListener('input', suggest);

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('err').textContent = '';
    const btn = $('submit');
    btn.disabled = true;
    try {
      const t = await api('/tickets', { method: 'POST', body: {
        title: $('title').value, description: $('desc').value, category: $('category').value, priority: $('priority').value, deviceId: $('device').value || null,
      } });
      toast(`已建立報修單 ${t.id}，資料已同步儲存到資料庫`, 'ok');
      location.hash = '#/tickets/' + t.id;
    } catch (err) {
      $('err').textContent = err.message;
      btn.disabled = false;
    }
  });
}

/* ───────────── 我的報修 ───────────── */
export async function myTicketsPage(view, _p, query) {
  mount(view, loading());
  const all = await api('/tickets');
  const tabs = [['open', '處理中', (t) => OPEN.includes(t.status)], ['resolved', '待我確認', (t) => t.status === '已解決'], ['closed', '已關閉', (t) => t.status === '已關閉'], ['all', '全部', () => true]];
  let cur = query.tab || (all.some((t) => OPEN.includes(t.status)) ? 'open' : 'all');
  const draw = () => {
    const f = tabs.find((t) => t[0] === cur)[2];
    const list = all.filter(f);
    mount(view, html`<div class="page">
      <div class="page-head"><div><h1>我的報修</h1><p>追蹤您提出的所有報修單與處理進度。</p></div><div class="actions"><a class="btn primary" href="#/new">${icon('plus')} 新增報修</a></div></div>
      <div class="tabs" role="tablist">${tabs.map(([k, label, fn]) => html`<button class="tab ${k === cur ? 'on' : ''}" data-tab="${k}" role="tab">${label}（${all.filter(fn).length}）</button>`)}</div>
      <div class="card">${list.length ? html`<div class="list">
        <div class="trow head tk-user"><span>編號</span><span>問題</span><span>分類</span><span>狀態</span><span>更新</span></div>
        ${list.map((t) => html`<a class="trow tk-user" href="#/tickets/${t.id}"><span class="mono small">${t.id}</span>
          <span class="t-title"><div class="ellip">${t.title}</div><div class="sub">${t.deviceLabel || '未指定電腦'}</div></span>
          <span class="small">${t.category}</span><span>${statusBadge(t.status)}</span><span class="small muted">${relTime(t.updatedAt)}</span></a>`)}</div>`
        : empty('這個分類目前沒有報修單')}</div></div>`);
    view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.tab; draw(); }));
  };
  draw();
}

/* ───────────── 我的電腦 ───────────── */
export async function devicesPage(view) {
  mount(view, loading());
  const devices = await api('/my/devices');
  mount(view, html`<div class="page">
    <div class="page-head"><div><h1>我的電腦</h1><p>登記在您名下的設備與維修履歷。IT 小幫手診斷時會參考這些資料。</p></div></div>
    ${devices.length ? html`<div class="stack">${devices.map((d) => html`<div class="split even">
      ${deviceCard(d, d.flags, { extra: html`<div class="row" style="margin-top:14px"><a class="btn sm primary" href="#/new?device=${d.id}">${icon('wrench')} 報修這台電腦</a><a class="btn sm" href="#/chat">${icon('bot')} 問小幫手</a></div>` })}
      <div class="card"><div class="card-h"><h3>${icon('history')} 維修履歷（${d.history.length}）</h3></div>
        ${d.history.length ? html`<div class="list">${d.history.map((t) => html`<a class="trow" style="grid-template-columns:minmax(0,1fr) auto" href="#/tickets/${t.id}">
          <div class="t-title"><div class="ellip">${t.title}</div><div class="sub">${t.id}・${fmtDay(t.createdAt)}・${t.category}${t.rootCause ? '・根因：' + t.rootCause : ''}</div></div>${statusBadge(t.status)}</a>`)}</div>`
          : empty('這台電腦沒有維修記錄', 'check')}</div>
    </div>`)}</div>` : html`<div class="card">${empty('您的帳號下沒有登記的電腦，請聯絡 IT 確認資產登記。', 'desktop')}</div>`}
  </div>`);
}

/* ───────────── 知識庫 ───────────── */
export async function kbPage(view, _p, query) {
  mount(view, loading());
  const [all, meta] = await Promise.all([api('/kb'), api('/meta')]);
  let q = '', cat = '';
  const draw = () => {
    const ql = q.trim().toLowerCase();
    const list = all.filter((k) => (!cat || k.category === cat) && (!ql || `${k.title} ${k.symptoms} ${k.causes.map((c) => c.text).join(' ')}`.toLowerCase().includes(ql)));
    mount(view.querySelector('#kb-list'), list.length ? html`${list.map((k) => html`<details class="kbitem" id="${k.id}" ${query.open === k.id ? 'open' : ''}>
      <summary><span>${k.title}</span><span class="badge">${k.category}</span>${k.severity === 'critical' ? html`<span class="badge p-緊急">緊急</span>` : ''}</summary>
      <div class="kbb"><p class="muted small" style="margin-bottom:12px">常見狀況：${k.symptoms}</p>
        ${k.causes.map((c) => html`<div style="margin-bottom:12px"><b>可能原因：${c.text}</b><ol style="margin-top:4px">${c.steps.map((s) => html`<li>${s}</li>`)}</ol></div>`)}
        <div class="callout warn">${icon('alert')}<div>${k.escalateWhen}</div></div>
        <div class="row" style="margin-top:12px"><a class="btn sm" href="#/chat">${icon('bot')} 問小幫手</a><a class="btn sm ghost" href="#/new">${icon('wrench')} 直接報修</a></div>
      </div></details>`)}` : empty('找不到符合的文章，試試其他關鍵字，或直接問小幫手。', 'search'));
  };
  mount(view, html`<div class="page">
    <div class="page-head"><div><h1>知識庫</h1><p>自助排除常見問題的步驟。</p></div></div>
    <div class="row" style="margin-bottom:14px"><input type="search" id="kb-q" placeholder="搜尋，例如：VPN、印表機、密碼" style="max-width:340px" aria-label="搜尋知識庫">
      <div class="chips" id="kb-cats"><button class="chip on" data-cat="">全部</button>${meta.categories.filter((c) => all.some((k) => k.category === c)).map((c) => html`<button class="chip" data-cat="${c}">${c}</button>`)}</div></div>
    <div class="card" id="kb-list"></div></div>`);
  view.querySelector('#kb-q').addEventListener('input', (e) => { q = e.target.value; draw(); });
  view.querySelector('#kb-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat;
    view.querySelectorAll('#kb-cats .chip').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  draw();
  if (query.open) view.querySelector('#' + CSS.escape(query.open))?.scrollIntoView({ block: 'center' });
}
