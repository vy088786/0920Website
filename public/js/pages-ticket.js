// 報修單詳情：使用者與客服人員共用，客服人員會多出處理面板與小幫手診斷
import { api, state, html, mount, icon, fmtDate, statusBadge, prioBadge, toast, loading, flagChips, diagnosisHtml, dueText, initial } from './util.js';

function commentHtml(c) {
  if (c.type === 'system') {
    return html`<div class="comment system"><div class="avatar">${icon('info')}</div><div>${c.body}<span class="tiny"> ・${fmtDate(c.at)}</span></div></div>`;
  }
  return html`<div class="comment ${c.internal ? 'internal' : ''}"><div class="avatar">${initial(c.byName)}</div><div>
    <div class="row small"><b>${c.byName}</b>${c.byRole === 'staff' ? html`<span class="badge s-處理中">客服人員</span>` : ''}${c.internal ? html`<span class="chip warn">內部備註・使用者看不到</span>` : ''}<span class="muted">${fmtDate(c.at)}</span></div>
    <div class="body">${c.body}</div></div></div>`;
}

export async function ticketPage(view, params) {
  mount(view, loading());
  const staff = state.user.role === 'staff';
  const meta = staff ? await api('/meta') : null;
  let diagCache = null;

  async function load() {
    let t;
    try { t = await api('/tickets/' + encodeURIComponent(params.id)); } catch (e) {
      mount(view, html`<div class="page"><div class="card pad"><h2>找不到這張報修單</h2><p class="muted" style="margin:8px 0 16px">${e.message}</p><a class="btn" href="${staff ? '#/staff/tickets' : '#/tickets'}">返回列表</a></div></div>`);
      return;
    }
    const isDone = ['已解決', '已關閉'].includes(t.status);
    const back = staff ? '#/staff/tickets' : '#/tickets';

    mount(view, html`<div class="page">
      <div class="crumb"><a href="${back}">← ${staff ? '工單佇列' : '我的報修'}</a></div>
      <div class="page-head"><div><div class="row" style="margin-bottom:6px"><span class="mono muted">${t.id}</span>${statusBadge(t.status)}${prioBadge(t.priority)}<span class="badge">${t.category}</span>${t.source === 'chat' ? html`<span class="chip info">${icon('bot')} 由小幫手轉來</span>` : ''}</div>
        <h1>${t.title}</h1></div></div>
      <div class="split">
        <div class="stack">
          <div class="card"><div class="card-h"><h3>問題描述</h3></div><div class="pad pre">${t.description}</div></div>

          ${isDone && t.resolution ? html`<div class="card" style="border-color:var(--ok)"><div class="card-h"><h3>${icon('check')} 處理結果</h3><span class="muted small right">${fmtDate(t.resolvedAt)}</span></div>
            <div class="pad">${t.rootCause ? html`<p class="small muted">根因</p><p style="margin-bottom:10px"><b>${t.rootCause}</b></p>` : ''}<p class="small muted">處理方式</p><p class="pre">${t.resolution}</p>
            ${!staff && t.status === '已解決' ? html`<div class="row" style="margin-top:16px"><button class="btn primary" id="confirm">${icon('check')} 問題已解決，關閉報修單</button><button class="btn" id="reopen-toggle">問題還沒解決</button></div>
              <div id="reopen-box" class="hidden" style="margin-top:12px"><textarea id="reopen-reason" placeholder="請簡述目前的狀況（選填）" style="min-height:70px"></textarea><div class="row" style="margin-top:8px"><button class="btn danger sm" id="reopen">重新開啟</button></div></div>` : ''}</div></div>` : ''}

          ${staff && t.aiSummary ? html`<div class="card"><div class="card-h"><h3>${icon('bot')} 小幫手交接摘要</h3><span class="muted small right">使用者已嘗試過的步驟與診斷都在這裡</span></div>
            <div class="pad"><ul style="display:grid;gap:4px">${t.aiSummary.lines.map((l) => html`<li>${l}</li>`)}</ul>
            ${t.transcript && t.transcript.length ? html`<details class="fold" style="margin-top:14px"><summary>與小幫手的對話（${t.transcript.length} 則）</summary>
              <div style="margin-top:10px;display:grid;gap:8px">${t.transcript.map((m) => html`<div class="small"><b>${m.role === 'user' ? t.requesterName : 'IT 小幫手'}</b><span class="muted tiny"> ${fmtDate(m.at)}</span><div class="pre">${m.text}</div></div>`)}</div></details>` : ''}</div></div>` : ''}

          ${staff ? html`<div class="card"><div class="card-h"><h3>${icon('sparkle')} 小幫手診斷</h3><span class="muted small right">依電腦資料、個人履歷與全公司維修記錄</span></div>
            <div class="pad" id="diag"><div class="loading" style="padding:24px"><div class="spin"></div></div></div></div>` : ''}

          <div class="card"><div class="card-h"><h3>處理紀錄</h3></div>
            <div class="pad">${t.comments.map(commentHtml)}
              <form id="reply" style="margin-top:14px">
                <textarea id="reply-body" maxlength="4000" placeholder="${staff ? '回覆使用者，或寫內部備註…' : t.status === '等待使用者' ? '客服人員正在等您的回覆…' : '補充說明或回覆客服人員…'}" style="min-height:90px"></textarea>
                <div class="row" style="margin-top:10px">
                  ${staff ? html`<label class="row small" style="gap:6px"><input type="checkbox" id="internal"> 內部備註（使用者看不到）</label>` : ''}
                  ${!staff && isDone ? html`<span class="small muted">送出回覆會重新開啟這張報修單</span>` : ''}
                  <button class="btn primary right" type="submit" id="reply-send">${icon('send')} 送出</button></div>
              </form></div></div>
        </div>

        <div class="stack">
          ${staff ? html`<form class="card" id="panel"><div class="card-h"><h3>${icon('wrench')} 處理面板</h3></div><div class="pad">
            <div class="grid g2">
              <div class="field"><label for="p-status">狀態</label><select id="p-status">${meta.statuses.map((s) => html`<option ${s === t.status ? 'selected' : ''}>${s}</option>`)}</select></div>
              <div class="field"><label for="p-prio">優先順序</label><select id="p-prio">${meta.priorities.map((s) => html`<option ${s === t.priority ? 'selected' : ''}>${s}</option>`)}</select></div>
            </div>
            <div class="field"><label for="p-cat">分類</label><select id="p-cat">${meta.categories.map((s) => html`<option ${s === t.category ? 'selected' : ''}>${s}</option>`)}</select></div>
            <div class="field"><label for="p-asg">負責人</label><select id="p-asg"><option value="">未指派</option>${meta.staff.map((s) => html`<option value="${s.id}" ${s.id === t.assigneeId ? 'selected' : ''}>${s.name}</option>`)}</select></div>
            <div class="field"><label for="p-rc">根因</label><input id="p-rc" list="rc-list" maxlength="60" value="${t.rootCause}" placeholder="例如：磁碟空間不足"><datalist id="rc-list">${meta.rootCauses.map((r) => html`<option value="${r}">`)}</datalist></div>
            <div class="field"><label for="p-res">處理方式</label><textarea id="p-res" maxlength="4000" style="min-height:90px" placeholder="標示為「已解決」時必填">${t.resolution}</textarea>
              <span class="hint">根因與處理方式會成為全公司維修記錄，IT 小幫手之後會拿來協助其他同仁。</span></div>
            <div class="err" id="p-err" role="alert"></div>
            <div class="row"><button class="btn primary" type="submit">儲存變更</button>${t.assigneeId !== state.user.id ? html`<button class="btn" type="button" id="take">指派給我</button>` : ''}</div></div></form>` : ''}

          <div class="card"><div class="card-h"><h3>基本資訊</h3></div><div class="pad"><dl class="kv">
            ${staff ? html`<dt>提出者</dt><dd><a href="#/staff/users/${t.requesterId}">${t.requesterName}</a>（${t.requesterDept}）</dd>` : ''}
            <dt>建立時間</dt><dd>${fmtDate(t.createdAt)}</dd><dt>最後更新</dt><dd>${fmtDate(t.updatedAt)}</dd>
            <dt>處理期限</dt><dd>${dueText(t)}</dd><dt>負責人</dt><dd>${t.assigneeName || html`<span class="muted">尚未指派</span>`}</dd>
          </dl></div></div>

          ${t.device ? html`<div class="card"><div class="card-h"><h3>${icon('laptop')} 電腦資料</h3></div><div class="pad">
            <div class="row" style="margin-bottom:8px"><b>${t.device.brand} ${t.device.model}</b><span class="mono small muted">${t.device.assetTag}</span></div>
            <dl class="kv" style="margin-bottom:12px"><dt>作業系統</dt><dd>${t.device.os}</dd><dt>規格</dt><dd>${t.device.cpu}／${t.device.ramGB}GB／${t.device.storage}</dd><dt>位置</dt><dd>${t.device.location}</dd><dt>主機名稱</dt><dd class="mono">${t.device.hostname}</dd></dl>
            ${flagChips(t.device.flags)}</div></div>` : ''}
        </div>
      </div></div>`);

    const $ = (id) => view.querySelector('#' + id);
    const act = async (fn, okMsg) => {
      try { await fn(); if (okMsg) toast(okMsg); await load(); } catch (e) { toast(e.message, 'err'); }
    };

    $('reply').addEventListener('submit', (e) => {
      e.preventDefault();
      const body = $('reply-body').value.trim();
      if (!body) return;
      $('reply-send').disabled = true;
      act(() => api(`/tickets/${t.id}/comments`, { method: 'POST', body: { body, internal: staff && $('internal').checked } }), '已送出');
    });

    if (!staff) {
      if ($('confirm')) $('confirm').onclick = () => act(() => api('/tickets/' + t.id, { method: 'PATCH', body: { action: 'confirm' } }), '感謝您的確認，報修單已關閉');
      if ($('reopen-toggle')) $('reopen-toggle').onclick = () => $('reopen-box').classList.toggle('hidden');
      if ($('reopen')) $('reopen').onclick = () => act(() => api('/tickets/' + t.id, { method: 'PATCH', body: { action: 'reopen', reason: $('reopen-reason').value } }), '已重新開啟');
      return;
    }

    $('panel').addEventListener('submit', (e) => {
      e.preventDefault();
      $('p-err').textContent = '';
      api('/tickets/' + t.id, { method: 'PATCH', body: {
        status: $('p-status').value, priority: $('p-prio').value, category: $('p-cat').value, assigneeId: $('p-asg').value || null,
        rootCause: $('p-rc').value, resolution: $('p-res').value,
      } }).then(() => { toast('已儲存'); load(); }).catch((err) => { $('p-err').textContent = err.message; });
    });
    if ($('take')) $('take').onclick = () => act(() => api('/tickets/' + t.id, { method: 'PATCH', body: { assigneeId: state.user.id, ...(t.status === '待處理' ? { status: '處理中' } : {}) } }), '已指派給您');

    // 診斷只算一次；儲存後重新載入時沿用
    const showDiag = (d) => {
      mount($('diag'), html`${diagnosisHtml(d, { staff: true })}
        ${d.causes.length ? html`<div class="row" style="margin-top:12px"><button class="btn sm" type="button" id="use-steps">${icon('send')} 把建議步驟帶入回覆</button><span class="hint">帶入後可再修改，不會自動送出</span></div>` : ''}`);
      const b = $('use-steps');
      if (b) b.onclick = () => {
        const c = d.causes[0];
        $('reply-body').value = `您好，依照您的電腦狀況，建議先嘗試以下步驟（可能原因：${c.text}）：\n` + c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') + '\n\n若處理後仍未改善，請回覆我，我再進一步協助。';
        $('reply-body').focus();
        $('reply-body').scrollIntoView({ block: 'center', behavior: 'smooth' });
      };
    };
    if (diagCache) showDiag(diagCache);
    else api(`/staff/tickets/${t.id}/diagnosis`).then((d) => { diagCache = d; showDiag(d); }).catch((e) => { $('diag').textContent = e.message; });
  }
  await load();
}
