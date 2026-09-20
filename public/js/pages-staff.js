// 客服人員的頁面：儀表板、工單佇列、使用者查詢、維修記錄
import { api, state, html, mount, icon, fmtDay, statusBadge, prioBadge, debounce, loading, empty, bars, deviceCard, dueText, initial } from './util.js';

/* ───────────── 儀表板 ───────────── */
export async function dashboardPage(view) {
  mount(view, loading());
  const s = await api('/staff/stats');
  const stat = (n, l, cls = '', href = '') => (href
    ? html`<a class="card stat ${cls}" href="${href}" style="color:inherit;text-decoration:none"><div class="n">${n}</div><div class="l">${l}</div></a>`
    : html`<div class="card stat ${cls}"><div class="n">${n}</div><div class="l">${l}</div></div>`);
  mount(view, html`<div class="page stack">
    <div class="page-head"><div><h1>客服工作台</h1><p>${state.user.name}，這是目前的工單概況。</p></div>
      <div class="actions"><a class="btn primary" href="#/staff/tickets?assignee=none">${icon('inbox')} 認領未指派工單</a></div></div>
    <div class="grid g4">
      ${stat(s.counts.open, '處理中工單', '', '#/staff/tickets')}
      ${stat(s.counts.unassigned, '尚未指派', s.counts.unassigned ? 'warn' : '', '#/staff/tickets?assignee=none')}
      ${stat(s.counts.overdue, '已逾期', s.counts.overdue ? 'bad' : '', '#/staff/tickets?overdue=1')}
      ${stat(s.counts.waiting, '等待使用者回覆', '', '#/staff/tickets?status=等待使用者')}
    </div>
    <div class="grid g3">
      ${stat(s.counts.awaitingClose, '已解決・待使用者確認')}
      ${stat(s.avgResolveHours + ' 小時', '近 90 天平均處理時間')}
      ${stat(s.agent.rate == null ? '—' : s.agent.rate + '%', `小幫手自助解決率（${s.agent.aiResolved} 解決／${s.agent.escalated} 轉人工）`)}
    </div>
    <div class="card"><div class="card-h"><h3>${icon('list')} 優先處理佇列</h3><a class="small right" href="#/staff/tickets">全部工單 →</a></div>
      ${s.queue.length ? html`<div class="list"><div class="trow head tk-staff"><span>編號</span><span>問題</span><span>分類</span><span>優先</span><span>狀態</span><span>負責人</span><span>期限</span></div>
        ${s.queue.map(ticketRowHtml)}</div>` : empty('目前沒有待處理的工單', 'check')}</div>
    <div class="grid g3">
      <div class="card"><div class="card-h"><h3>處理中工單分類</h3></div><div class="pad">${bars(s.byCategory)}</div></div>
      <div class="card"><div class="card-h"><h3>近 90 天常見根因</h3></div><div class="pad">${bars(s.topRootCauses)}</div></div>
      <div class="card"><div class="card-h"><h3>各人處理中工單</h3></div><div class="pad">${bars(s.workload.map((w) => ({ key: w.name, count: w.open })), { max: Math.max(5, ...s.workload.map((w) => w.open)) })}</div></div>
    </div></div>`);
}

function ticketRowHtml(t) {
  return html`<a class="trow tk-staff" href="#/tickets/${t.id}"><span class="mono small">${t.id}</span>
    <span class="t-title"><div class="ellip">${t.title}${t.source === 'chat' ? html` <span class="chip info" title="由 IT 小幫手轉來">${icon('bot')}</span>` : ''}</div><div class="sub">${t.requesterName}・${t.requesterDept}</div></span>
    <span class="small">${t.category}</span><span>${prioBadge(t.priority)}</span><span>${statusBadge(t.status)}</span>
    <span class="small">${t.assigneeName || html`<span class="muted">未指派</span>`}</span><span class="small nowrap">${dueText(t)}</span></a>`;
}

/* ───────────── 工單佇列 ───────────── */
export async function ticketsPage(view, _p, query) {
  mount(view, loading());
  const meta = await api('/meta');
  const f = { q: '', status: query.status || (query.overdue || query.assignee ? '' : 'open'), category: '', priority: '', assignee: query.assignee || '', overdue: query.overdue === '1' ? '1' : '' };
  mount(view, html`<div class="page">
    <div class="page-head"><div><h1>工單佇列</h1><p>所有使用者提出的報修單。</p></div></div>
    <div class="card pad" style="margin-bottom:16px"><div class="row">
      <input type="search" id="f-q" placeholder="搜尋編號、標題、內容、姓名" style="max-width:280px" aria-label="搜尋">
      <select id="f-status" style="width:auto" aria-label="狀態"><option value="open">處理中（未結案）</option><option value="">全部狀態</option>${meta.statuses.map((s) => html`<option>${s}</option>`)}</select>
      <select id="f-category" style="width:auto" aria-label="分類"><option value="">全部分類</option>${meta.categories.map((s) => html`<option>${s}</option>`)}</select>
      <select id="f-priority" style="width:auto" aria-label="優先順序"><option value="">全部優先順序</option>${meta.priorities.map((s) => html`<option>${s}</option>`)}</select>
      <select id="f-assignee" style="width:auto" aria-label="負責人"><option value="">全部負責人</option><option value="me">我的工單</option><option value="none">未指派</option>${meta.staff.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select>
      <label class="row small" style="gap:6px"><input type="checkbox" id="f-overdue"> 只看逾期</label>
    </div></div>
    <div class="card" id="result"></div></div>`);
  const $ = (id) => view.querySelector('#' + id);
  $('f-status').value = f.status;
  $('f-assignee').value = f.assignee;
  $('f-overdue').checked = !!f.overdue;

  const run = async () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    const list = await api('/tickets?' + p);
    mount($('result'), list.length ? html`<div class="list"><div class="trow head tk-staff"><span>編號</span><span>問題</span><span>分類</span><span>優先</span><span>狀態</span><span>負責人</span><span>期限</span></div>${list.map(ticketRowHtml)}</div>
      <div class="pad small muted" style="border-top:1px solid var(--line)">共 ${list.length} 張</div>` : empty('沒有符合條件的工單', 'search'));
  };
  const runD = debounce(() => run().catch(() => {}), 250);
  $('f-q').addEventListener('input', (e) => { f.q = e.target.value; runD(); });
  for (const [id, key] of [['f-status', 'status'], ['f-category', 'category'], ['f-priority', 'priority'], ['f-assignee', 'assignee']]) {
    $(id).addEventListener('change', (e) => { f[key] = e.target.value; run(); });
  }
  $('f-overdue').addEventListener('change', (e) => { f.overdue = e.target.checked ? '1' : ''; run(); });
  await run();
}

/* ───────────── 使用者查詢 ───────────── */
export async function usersPage(view) {
  mount(view, loading());
  mount(view, html`<div class="page">
    <div class="page-head"><div><h1>使用者查詢</h1><p>用姓名、部門或設備編號找出使用者，查看他的電腦資料與完整維修履歷。</p></div></div>
    <input type="search" id="uq" placeholder="搜尋姓名、部門、設備編號或型號，例如：張小明、NB-0231、ThinkPad" style="max-width:480px;margin-bottom:16px" aria-label="搜尋使用者" autofocus>
    <div class="grid g3" id="ulist"></div></div>`);
  const run = async (q = '') => {
    const list = await api('/staff/users?q=' + encodeURIComponent(q));
    mount(view.querySelector('#ulist'), list.length ? html`${list.map((u) => html`<a class="card pad" href="#/staff/users/${u.id}" style="color:inherit">
      <div class="row"><div class="avatar">${initial(u.name)}</div><div><b>${u.name}</b><div class="small muted">${u.dept}・${u.title}</div></div></div>
      <div class="small" style="margin-top:12px">${u.devices.map((d) => html`<div class="ellip">${icon('laptop')} ${d.label}</div>`)}</div>
      <div class="row small muted" style="margin-top:10px"><span>報修 ${u.ticketCount} 筆</span>${u.openCount ? html`<span class="chip info">處理中 ${u.openCount}</span>` : ''}</div></a>`)}` : html`<div class="card" style="grid-column:1/-1">${empty('找不到符合的使用者', 'search')}</div>`);
  };
  view.querySelector('#uq').addEventListener('input', debounce((e) => run(e.target.value).catch(() => {}), 250));
  await run();
}

export async function userDetailPage(view, params) {
  mount(view, loading());
  let d;
  try { d = await api('/staff/users/' + encodeURIComponent(params.id)); } catch (e) {
    mount(view, html`<div class="page"><div class="card pad"><h2>${e.message}</h2><p style="margin-top:12px"><a class="btn" href="#/staff/users">返回</a></p></div></div>`);
    return;
  }
  const u = d.user;
  mount(view, html`<div class="page stack">
    <div><div class="crumb"><a href="#/staff/users">← 使用者查詢</a></div>
      <div class="row"><div class="avatar" style="width:52px;height:52px;font-size:22px">${initial(u.name)}</div>
        <div><h1>${u.name}</h1><p class="muted">${u.dept}・${u.title}・分機 ${u.ext}・${u.email}</p></div></div></div>

    <div><h2 style="margin-bottom:12px">電腦資料與維修履歷</h2>
      ${d.devices.length ? html`<div class="stack">${d.devices.map((dv) => html`<div class="split even">
        ${deviceCard(dv, dv.flags)}
        <div class="card"><div class="card-h"><h3>${icon('history')} ${dv.assetTag} 維修履歷（${dv.history.length}）</h3></div>
          ${dv.history.length ? html`<div class="list">${dv.history.map((t) => html`<a class="trow" style="grid-template-columns:minmax(0,1fr) auto" href="#/tickets/${t.id}">
            <div class="t-title"><div class="ellip">${t.title}</div><div class="sub">${t.id}・${fmtDay(t.createdAt)}・${t.category}${t.rootCause ? '・根因：' + t.rootCause : ''}</div></div>${statusBadge(t.status)}</a>`)}</div>` : empty('沒有維修記錄', 'check')}</div>
      </div>`)}</div>` : html`<div class="card">${empty('此使用者名下沒有登記的電腦', 'desktop')}</div>`}</div>

    <div class="grid g21">
      <div class="card"><div class="card-h"><h3>${icon('list')} 全部報修單（${d.tickets.length}）</h3></div>
        ${d.tickets.length ? html`<div class="list">${d.tickets.map((t) => html`<a class="trow" style="grid-template-columns:76px minmax(0,1fr) auto auto" href="#/tickets/${t.id}"><span class="mono small">${t.id}</span>
          <span class="t-title ellip">${t.title}<span class="sub"> ・${fmtDay(t.createdAt)}</span></span><span class="small muted">${t.category}</span>${statusBadge(t.status)}</a>`)}</div>` : empty('沒有報修單')}</div>
      <div class="card"><div class="card-h"><h3>問題類型分佈</h3></div><div class="pad">${bars(d.byCategory)}</div></div>
    </div></div>`);
}

/* ───────────── 全部維修記錄 ───────────── */
export async function recordsPage(view) {
  mount(view, loading());
  const meta = await api('/meta');
  const f = { q: '', category: '', rootCause: '' };
  mount(view, html`<div class="page">
    <div class="page-head"><div><h1>維修記錄</h1><p>全公司已結案的維修記錄。這些根因與處理方式，也是 IT 小幫手判斷問題的依據。</p></div></div>
    <div class="card pad" style="margin-bottom:16px"><div class="row">
      <input type="search" id="r-q" placeholder="搜尋症狀、處理方式、設備型號、姓名" style="max-width:320px" aria-label="搜尋維修記錄">
      <select id="r-cat" style="width:auto" aria-label="分類"><option value="">全部分類</option>${meta.categories.map((c) => html`<option>${c}</option>`)}</select>
      <select id="r-rc" style="width:auto" aria-label="根因"><option value="">全部根因</option>${meta.rootCauses.map((c) => html`<option>${c}</option>`)}</select></div></div>
    <div id="r-sum" style="margin-bottom:16px"></div>
    <div class="card" id="r-list"></div></div>`);
  const $ = (id) => view.querySelector('#' + id);
  const run = async () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    const r = await api('/staff/records?' + p);
    mount($('r-sum'), html`<div class="row"><b>${r.total} 筆</b><span class="muted small">最常見根因：</span><div class="chips">${r.topRootCauses.map((x) => html`<button class="chip" data-rc="${x.key}">${x.key} × ${x.count}</button>`)}</div></div>`);
    mount($('r-list'), r.items.length ? html`<div class="list"><div class="trow head rec"><span>編號</span><span>問題</span><span>根因與處理方式</span><span>處理人・日期</span></div>
      ${r.items.map((t) => html`<a class="trow rec" href="#/tickets/${t.id}"><span class="mono small">${t.id}</span>
        <span class="t-title">${t.title}<div class="sub">${t.requesterName}・${t.deviceLabel}</div></span>
        <span class="small">${t.rootCause ? html`<b>${t.rootCause}</b><br>` : ''}${t.resolution}</span>
        <span class="small muted">${t.assigneeName}<br>${fmtDay(t.resolvedAt)}</span></a>`)}</div>` : empty('沒有符合的記錄', 'search'));
    view.querySelectorAll('[data-rc]').forEach((b) => b.addEventListener('click', () => { f.rootCause = b.dataset.rc; $('r-rc').value = f.rootCause; run(); }));
  };
  $('r-q').addEventListener('input', debounce((e) => { f.q = e.target.value; run().catch(() => {}); }, 250));
  $('r-cat').addEventListener('change', (e) => { f.category = e.target.value; run(); });
  $('r-rc').addEventListener('change', (e) => { f.rootCause = e.target.value; run(); });
  await run();
}
