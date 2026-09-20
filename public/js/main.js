import { api, state, html, mount, icon, loading, initial } from './util.js';
import { homePage, chatPage, newTicketPage, myTicketsPage, devicesPage, kbPage } from './pages-user.js';
import { ticketPage } from './pages-ticket.js';
import { dashboardPage, ticketsPage, usersPage, userDetailPage, recordsPage } from './pages-staff.js';

const NAV = {
  user: [['/home', 'home', '首頁'], ['/chat', 'bot', 'IT 小幫手'], ['/new', 'wrench', '我要報修'], ['/tickets', 'list', '我的報修'], ['/devices', 'laptop', '我的電腦'], ['/kb', 'book', '知識庫']],
  staff: [['/staff', 'chart', '儀表板'], ['/staff/tickets', 'list', '工單佇列'], ['/staff/users', 'users', '使用者查詢'], ['/staff/records', 'db', '維修記錄'], ['/kb', 'book', '知識庫']],
};

// [路徑, 可用角色, 頁面]
const ROUTES = [
  ['/home', ['user'], homePage], ['/chat', ['user'], chatPage], ['/new', ['user'], newTicketPage],
  ['/tickets', ['user'], myTicketsPage], ['/devices', ['user'], devicesPage],
  ['/tickets/:id', ['user', 'staff'], ticketPage], ['/kb', ['user', 'staff'], kbPage],
  ['/staff', ['staff'], dashboardPage], ['/staff/tickets', ['staff'], ticketsPage],
  ['/staff/users', ['staff'], usersPage], ['/staff/users/:id', ['staff'], userDetailPage], ['/staff/records', ['staff'], recordsPage],
];

const app = document.getElementById('app');
const home = () => (state.user.role === 'staff' ? '/staff' : '/home');

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path.replace(/\/+$/, '') || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

function match(path) {
  for (const [pattern, roles, page] of ROUTES) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    const m = re.exec(path);
    if (m) return { roles, page, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

/* ───────────── 登入 ───────────── */
async function loginPage() {
  document.title = '登入｜IT 客服中心';
  let users = [];
  try { users = await api('/demo-users'); } catch { /* 伺服器未啟動 */ }
  const card = (u) => html`<button class="acct" data-id="${u.id}"><div class="avatar">${initial(u.name)}</div><div><div class="n">${u.name}</div><div class="s">${u.dept}・${u.title}</div></div></button>`;
  mount(app, html`<div class="login">
    <section class="login-hero">
      <div class="brand" style="color:#fff"><span class="brand-mark" style="background:rgba(255,255,255,.2)">${icon('shield')}</span> IT 客服中心</div>
      <div><h1>電腦出問題？<br>先問 IT 小幫手。</h1><p style="margin-top:14px">報修、提問、追蹤進度都在這裡。小幫手會查您的電腦資料、維修履歷與全公司的維修記錄，幫您找出原因與解法。</p></div>
      <div class="feat">
        <div>${icon('bot')}<span>依您的電腦狀況診斷，而不只是制式回答</span></div>
        <div>${icon('history')}<span>參考您的維修履歷，發現反覆發生的問題</span></div>
        <div>${icon('users')}<span>解決不了，一鍵轉客服人員並附上完整交接資料</span></div>
      </div>
    </section>
    <section class="login-form">
      <div><h2>登入</h2><p class="muted small" style="margin-top:4px">示範版：點選帳號即可登入（正式環境請改接公司 SSO／AD）。</p></div>
      <div><p class="lbl" style="margin-bottom:8px">使用者（提出報修）</p><div class="acct-grid">${users.filter((u) => u.role === 'user').map(card)}</div></div>
      <div><p class="lbl" style="margin-bottom:8px">客服人員（處理工單）</p><div class="acct-grid">${users.filter((u) => u.role === 'staff').map(card)}</div></div>
      ${users.length ? '' : html`<p class="err">無法連線到伺服器，請確認已執行 node server.js</p>`}
      <form id="manual" class="row"><input id="empid" placeholder="或輸入員工編號，例如 E1001" style="max-width:260px" aria-label="員工編號" autocomplete="off"><button class="btn" type="submit">登入</button></form>
      <div class="err" id="login-err" role="alert"></div>
    </section></div>`);

  const login = async (id) => {
    try {
      const r = await api('/login', { method: 'POST', body: { userId: id } });
      state.token = r.token;
      localStorage.setItem('itsc.token', r.token);
      state.user = r.user;
      // 網址若已經是首頁就不會觸發 hashchange，直接渲染
      if (location.hash === '#' + home()) render();
      else location.hash = '#' + home();
    } catch (e) { app.querySelector('#login-err').textContent = e.message; }
  };
  app.querySelectorAll('.acct').forEach((b) => b.addEventListener('click', () => login(b.dataset.id)));
  app.querySelector('#manual').addEventListener('submit', (e) => { e.preventDefault(); const v = app.querySelector('#empid').value.trim(); if (v) login(v); });
}

/* ───────────── 主版面 ───────────── */
function shell() {
  const u = state.user;
  const staff = u.role === 'staff';
  mount(app, html`<div class="shell">
    <header class="topbar">
      <a class="brand" href="#${home()}"><span class="brand-mark">${icon('shield')}</span> IT 客服中心</a>
      <span class="role-tag">${staff ? '客服人員' : '使用者'}</span>
      <div class="userchip right"><div class="avatar">${initial(u.name)}</div><div class="who"><div style="font-weight:600;line-height:1.2">${u.name}</div><div class="tiny muted">${u.dept}</div></div>
        <button class="btn sm ghost" id="logout" title="登出">${icon('logout')}<span class="who"> 登出</span></button></div>
    </header>
    <nav class="side" aria-label="主選單">${NAV[u.role].map(([p, ic, label]) => html`<a class="nav-item" href="#${p}" data-nav="${p}">${icon(ic)} ${label}</a>`)}</nav>
    <main id="view"></main></div>`);
  app.querySelector('#logout').addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch { /* 忽略 */ }
    localStorage.removeItem('itsc.token');
    state.token = '';
    state.user = null;
    location.hash = '#/login';
    render();
  });
}

let seq = 0;
async function render() {
  const { path, query } = parseHash();
  if (!state.token) return loginPage();
  if (!state.user) {
    try { state.user = await api('/me'); } catch { return loginPage(); }
  }
  if (!app.querySelector('#view')) shell();

  const m = match(path);
  if (!m || !m.roles.includes(state.user.role)) {
    location.replace('#' + home());
    return;
  }
  // 選單反白：客服人員的報修單詳情屬於「工單佇列」
  const navPath = state.user.role === 'staff' && path.startsWith('/tickets/') ? '/staff/tickets' : path.startsWith('/staff/users') ? '/staff/users' : path.startsWith('/tickets/') ? '/tickets' : path;
  app.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.nav === navPath));

  const my = ++seq;
  const view = app.querySelector('#view');
  // 每次換頁都用新容器，避免上一頁較慢的請求晚回來後蓋掉目前的畫面
  const box = document.createElement('div');
  view.replaceChildren(box);
  mount(box, loading());
  window.scrollTo(0, 0);
  document.title = 'IT 客服中心';
  try {
    await m.page(box, m.params, query);
  } catch (e) {
    if (my === seq) mount(box, html`<div class="page"><div class="card pad"><h2>載入失敗</h2><p class="muted" style="margin:8px 0 16px">${e.message}</p><button class="btn" onclick="location.reload()">重新整理</button></div></div>`);
  }
}

window.addEventListener('hashchange', render);
if (!location.hash) location.hash = '#/';
render();
