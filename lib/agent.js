'use strict';
const { DAY, OPEN_STATUSES, DONE_STATUSES, SLA_HOURS } = require('./constants');
const { grams, buildIdf, cosine, coverage } = require('./text');
const { makeComment } = require('./tickets');
const repo = require('./repo');

// 本檔的 db 參數是 repo.diagnosisData() 取得的資料快照：{ users, devices, kb, tickets }，
// tickets 包含此使用者的全部報修單與全公司已結案的報修單。

/* ───────────── 電腦狀態檢查（供知識庫 causes[].check 使用） ───────────── */

const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
const ageYears = (iso) => daysSince(iso) / 365.25;

const CHECKS = {
  disk_low: (d) => d.diskFreePct != null && d.diskFreePct < 10,
  ram_low: (d) => d.ramGB != null && d.ramGB <= 8,
  old_device: (d) => ageYears(d.purchaseDate) >= 4,
  patch_old: (d) => daysSince(d.lastPatchDate) > 60,
  av_bad: (d) => d.antivirus !== '正常',
  battery_worn: (d) => d.batteryHealthPct != null && d.batteryHealthPct < 60,
  uptime_long: (d) => d.uptimeDays >= 14,
};

const EVIDENCE = {
  disk_low: (d) => `系統磁碟剩餘空間僅 ${d.diskFreePct}%`,
  ram_low: (d) => `記憶體只有 ${d.ramGB}GB`,
  old_device: (d) => `設備已使用 ${ageYears(d.purchaseDate).toFixed(1)} 年`,
  patch_old: (d) => `已 ${daysSince(d.lastPatchDate)} 天未安裝系統更新`,
  av_bad: (d) => `防毒狀態：${d.antivirus}`,
  battery_worn: (d) => `電池健康度僅 ${d.batteryHealthPct}%`,
  uptime_long: (d) => `已連續 ${d.uptimeDays} 天未重新開機`,
};

// 顯示給人看的設備健康摘要
function deviceFlags(d) {
  const flags = [];
  if (d.diskFreePct != null) {
    if (d.diskFreePct < 10) flags.push({ key: 'disk_low', level: 'bad', label: EVIDENCE.disk_low(d) });
    else if (d.diskFreePct < 20) flags.push({ key: 'disk_warn', level: 'warn', label: `系統磁碟剩餘空間 ${d.diskFreePct}%（偏低）` });
  }
  if (CHECKS.ram_low(d)) flags.push({ key: 'ram_low', level: 'warn', label: EVIDENCE.ram_low(d) });
  if (CHECKS.old_device(d)) flags.push({ key: 'old_device', level: 'warn', label: EVIDENCE.old_device(d) });
  if (CHECKS.patch_old(d)) flags.push({ key: 'patch_old', level: 'warn', label: EVIDENCE.patch_old(d) });
  if (CHECKS.av_bad(d)) flags.push({ key: 'av_bad', level: 'bad', label: EVIDENCE.av_bad(d) });
  if (CHECKS.battery_worn(d)) flags.push({ key: 'battery_worn', level: 'warn', label: EVIDENCE.battery_worn(d) });
  if (CHECKS.uptime_long(d)) flags.push({ key: 'uptime_long', level: 'warn', label: EVIDENCE.uptime_long(d) });
  if (/^Windows 10/.test(d.os)) flags.push({ key: 'os_eol', level: 'warn', label: 'Windows 10 已結束一般支援，僅能透過延伸安全更新取得修補' });
  const expired = new Date(d.warrantyEnd).getTime() < Date.now();
  flags.push({ key: 'warranty', level: expired ? 'info' : 'ok', label: expired ? `保固已於 ${d.warrantyEnd} 到期` : `保固至 ${d.warrantyEnd}` });
  return flags;
}

function pickDevice(devices, text, deviceId) {
  if (!devices.length) return { device: null, assumed: false };
  if (deviceId) {
    const d = devices.find((x) => x.id === deviceId);
    if (d) return { device: d, assumed: false };
  }
  const t = String(text).toLowerCase();
  const byTag = devices.find((d) => t.includes(d.assetTag.toLowerCase()) || t.includes(d.hostname.toLowerCase()));
  if (byTag) return { device: byTag, assumed: false };
  if (devices.length > 1) {
    if (/桌機|桌上型|主機/.test(t)) {
      const d = devices.find((x) => x.type === '桌機');
      if (d) return { device: d, assumed: false };
    }
    if (/筆電|筆記型/.test(t)) {
      const d = devices.find((x) => x.type === '筆電');
      if (d) return { device: d, assumed: false };
    }
  }
  return { device: devices.find((d) => d.primary) || devices[0], assumed: devices.length > 1 };
}

/* ───────────── 診斷：電腦資料 → 個人履歷 → 全部維修記錄 → 知識庫 ───────────── */

const RECUR_DAYS = 120;
const BASE_WEIGHT = [0.34, 0.24, 0.17, 0.12, 0.08, 0.05];

function scoreKb(kb, text, qGrams, category) {
  const t = text.toLowerCase();
  let kw = 0;
  const hit = [];
  for (const k of kb.keywords) {
    if (t.includes(k.toLowerCase())) {
      kw += k.length === 1 ? 2 : k.length >= 4 ? 4 : 3;
      hit.push(k);
    }
  }
  const sim = cosine(qGrams, grams(kb.title + ' ' + kb.symptoms));
  let score = kw + sim * 10;
  if (category && category === kb.category && (kw > 0 || sim > 0.05)) score += 2;
  return { score, hit };
}

function diagnose(db, { user, text = '', deviceId, category, excludeId }) {
  const trace = [];
  const devices = db.devices.filter((d) => d.ownerId === user.id);
  const { device, assumed } = pickDevice(devices, text, deviceId);

  // 1. 電腦資料
  const flags = device ? deviceFlags(device) : [];
  const facts = {};
  if (device) for (const k of Object.keys(CHECKS)) facts[k] = CHECKS[k](device);
  trace.push({
    tool: 'device', title: '查詢使用者的電腦資料',
    detail: device
      ? `${device.assetTag}｜${device.brand} ${device.model}｜${device.os}` + (assumed ? '（未指定，預設為主要使用的電腦）' : '')
      : '查無登記在此帳號下的電腦',
  });

  // 2. 知識庫比對
  const q = grams(text);
  const scored = db.kb
    .map((kb) => ({ kb, ...scoreKb(kb, text, q, category) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);
  const top = scored[0] || null;
  const hits = top ? scored.filter((x) => x.score >= top.score * 0.45).slice(0, 3) : [];
  const confidence = !top ? 'none' : top.score >= 8 ? 'high' : top.score >= 4 ? 'medium' : 'low';
  const topCategory = top ? top.kb.category : category || null;

  // 3. 此電腦 / 此使用者的維修履歷
  const mine = db.tickets.filter((t) => t.requesterId === user.id && t.id !== excludeId);
  const deviceTickets = (device ? mine.filter((t) => t.deviceId === device.id) : mine)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // 反覆發生：只計已結案的同類報修；尚在處理中的同類單另外提示，避免重複開單
  const recurList = deviceTickets.filter((t) => DONE_STATUSES.includes(t.status) && t.category === topCategory && daysSince(t.createdAt) <= RECUR_DAYS);
  const recurring = !!topCategory && recurList.length >= 2;
  const openRelated = deviceTickets.filter((t) => OPEN_STATUSES.includes(t.status) && t.category === topCategory).map((t) => ({ id: t.id, title: t.title, status: t.status }));
  trace.push({
    tool: 'history', title: '查詢個人維修履歷',
    detail: device
      ? `${device.assetTag} 共 ${deviceTickets.length} 筆報修` + (topCategory ? `，其中「${topCategory}」類近 ${RECUR_DAYS} 天內 ${recurList.length} 筆` : '')
      : `此帳號共 ${mine.length} 筆報修`,
  });

  // 4. 全部維修記錄（已結案、有處理方式者）
  const pool = db.tickets.filter((t) => t.id !== excludeId && t.resolution && DONE_STATUSES.includes(t.status));
  const docs = pool.map((t) => grams(t.title + ' ' + t.description + ' ' + t.rootCause));
  const idf = buildIdf(docs);
  const similar = pool
    .map((t, i) => {
      const sim = 0.5 * cosine(q, docs[i], idf) + 0.5 * coverage(q, docs[i], idf) * Math.min(1, q.size / 6);
      let score = sim * 10;
      if (sim > 0.12) {
        if (topCategory && t.category === topCategory) score += 2.5;
        const td = db.devices.find((d) => d.id === t.deviceId);
        if (device && td && td.model === device.model) score += 1.5;
        if (device && td && td.os === device.os) score += 0.5;
      }
      return { t, sim, score };
    })
    .filter((x) => x.sim > 0.12 && x.score >= 2.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ t, score }) => {
      const td = db.devices.find((d) => d.id === t.deviceId);
      const requester = db.users.find((u) => u.id === t.requesterId);
      return {
        id: t.id, title: t.title, category: t.category, rootCause: t.rootCause, resolution: t.resolution,
        model: td ? `${td.brand} ${td.model}` : '', sameModel: !!(device && td && td.model === device.model),
        own: t.requesterId === user.id, requesterId: t.requesterId, requesterName: requester ? requester.name : '',
        date: t.createdAt, hours: Math.max(1, Math.round((new Date(t.resolvedAt) - new Date(t.createdAt)) / 36e5)),
        score: Math.round(score * 10) / 10,
      };
    });
  const rcCount = {};
  for (const s of similar) if (s.rootCause) rcCount[s.rootCause] = (rcCount[s.rootCause] || 0) + 1;
  trace.push({
    tool: 'records', title: '比對全公司維修記錄',
    detail: similar.length
      ? `找到 ${similar.length} 筆類似案例` + (Object.keys(rcCount).length ? `，最常見根因：${Object.entries(rcCount).sort((a, b) => b[1] - a[1])[0][0]}` : '')
      : '沒有找到足夠相似的案例',
  });
  trace.push({
    tool: 'kb', title: '搜尋知識庫',
    detail: top ? `最相關：${top.kb.id}「${top.kb.title}」（比對度${{ high: '高', medium: '中', low: '低' }[confidence]}）` : '沒有符合的知識庫文章',
  });

  // 5. 綜合排序可能原因
  const seen = new Set();
  const rows = [];
  hits.forEach((hit, hi) => {
    hit.kb.causes.forEach((c, i) => {
      if (seen.has(c.text)) return;
      seen.add(c.text);
      let w = BASE_WEIGHT[i] ?? 0.04;
      const evidence = [];
      if (c.check && facts[c.check]) {
        w += 0.35;
        evidence.push(EVIDENCE[c.check](device));
      }
      const n = c.rc ? rcCount[c.rc] || 0 : 0;
      if (n) {
        w += Math.min(n, 3) * 0.08;
        evidence.push(`全公司類似案例中有 ${n} 件的根因是這一項`);
      }
      const ownHit = c.rc && deviceTickets.some((t) => t.rootCause === c.rc);
      if (ownHit) {
        w += 0.1;
        evidence.push('這台電腦過去曾因同樣原因報修');
      }
      rows.push({ text: c.text, steps: c.steps, kbId: hit.kb.id, kbTitle: hit.kb.title, evidence, w: w * (hi === 0 ? 1 : 0.5) });
    });
  });
  rows.sort((a, b) => b.w - a.w);
  const causes = rows.slice(0, 5);
  const total = causes.reduce((s, r) => s + r.w, 0) || 1;
  for (const c of causes) {
    c.pct = Math.round((c.w / total) * 100);
    c.level = c.pct >= 40 ? 'high' : c.pct >= 22 ? 'mid' : 'low';
    delete c.w;
  }

  // 6. 是否建議轉人工
  const reasons = [];
  if (top && top.kb.escalateAlways) reasons.push({ level: 'must', text: top.kb.escalateNote || '此類問題需由客服人員即時處理' });
  if (recurring) reasons.push({ level: 'suggest', text: `這台電腦近 ${RECUR_DAYS} 天內已有 ${recurList.length} 次「${topCategory}」類報修，建議由客服人員評估根本原因（例如更換硬體）` });
  if (!top) reasons.push({ level: 'suggest', text: '知識庫與歷史維修記錄中找不到足夠相似的案例' });
  else if (confidence === 'low') reasons.push({ level: 'suggest', text: '目前的描述與知識庫的比對度不高，建議由客服人員進一步確認' });
  const notes = [];
  if (device && topCategory === '硬體') {
    notes.push(new Date(device.warrantyEnd).getTime() >= Date.now()
      ? `此電腦仍在保固期內（至 ${device.warrantyEnd}），硬體故障可由客服人員協助原廠送修`
      : `此電腦已過保固（${device.warrantyEnd}），維修需走內部預算流程`);
  }
  if (device && /^Windows 10/.test(device.os)) notes.push('此電腦仍是 Windows 10，建議一併詢問客服人員升級 Windows 11 的時程');

  const priority = top && top.kb.priority ? top.kb.priority : recurring ? '高' : '中';

  return {
    device, deviceAssumed: assumed, deviceFlags: flags,
    allDevices: devices.map((d) => ({ id: d.id, assetTag: d.assetTag, brand: d.brand, model: d.model, type: d.type })),
    confidence, category: topCategory || '其他', priority,
    matches: hits.map((h) => ({ id: h.kb.id, title: h.kb.title, category: h.kb.category, score: Math.round(h.score * 10) / 10, escalateWhen: h.kb.escalateWhen })),
    causes,
    deviceHistory: deviceTickets.slice(0, 8).map((t) => ({
      id: t.id, title: t.title, category: t.category, status: t.status, createdAt: t.createdAt, rootCause: t.rootCause, resolution: t.resolution,
    })),
    recurring, recurCount: recurList.length, openRelated,
    similarCases: similar,
    companyStats: { similarCount: similar.length, topRootCauses: Object.entries(rcCount).sort((a, b) => b[1] - a[1]).map(([rc, count]) => ({ rc, count })) },
    escalation: { recommended: reasons.length > 0, must: reasons.some((r) => r.level === 'must'), reasons },
    notes, trace,
  };
}

// 給一般使用者看的版本：其他同仁的案例去識別化
function sanitizeForUser(d) {
  return {
    ...d,
    similarCases: d.similarCases.map((s) => {
      const { requesterId, requesterName, ...rest } = s;
      return s.own ? rest : { ...rest, id: undefined };
    }),
  };
}

/* ───────────── 對話 ───────────── */

const QUICK_STARTS = ['電腦變很慢', '無法連上 Wi-Fi', '忘記密碼', '印表機無法列印', '查詢我的報修進度'];

const RE = {
  human: /(轉|找|要|請).{0,4}(客服|真人|人員|工程師|人工)|真人|人工客服|客服人員/,
  status: /(進度|工單|報修單|處理到哪|處理狀況|處理得怎)/,
  history: /(維修|報修)(履歷|記錄|紀錄)|修過|歷史/,
  device: /(電腦資料|電腦型號|設備資訊|資產編號|我的設備|查(詢)?我的電腦|保固(到|期|還有))/,
  greet: /^(嗨|你好|您好|哈囉|hi|hello|hey)[!！。 ]*$/i,
  resolved: /(解決了|好了|可以了|正常了|沒問題了|搞定|恢復了|謝謝|感謝)/,
  failed: /(沒用|沒有用|沒效|沒有效|還是不行|還是一樣|還是很|依然|仍然|無法解決|試過了|沒改善|沒有改善)/,
  repair: /(報修|要修|送修|建立工單|開單)/,
};

function newConversation(db, user) {
  const conv = {
    id: 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: user.id, status: 'open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ticketId: null, messages: [],
    ctx: { problemText: '', deviceId: null, triedKb: [], pendingEscalate: false, shown: [] },
  };
  const devices = db.devices.filter((d) => d.ownerId === user.id);
  const primary = devices.find((d) => d.primary) || devices[0];
  say(conv, `您好，${user.name}！我是 IT 小幫手。` +
    (primary ? `我已經找到登記在您名下的電腦（${primary.assetTag}，${primary.brand} ${primary.model}）。` : '') +
    '請直接描述您遇到的狀況，我會查詢您的電腦資料、維修履歷與全公司的維修記錄，幫您找出可能的原因與排除方式；若需要，我也可以幫您轉給客服人員。',
  { actions: QUICK_STARTS.map((s) => ({ label: s, action: 'say', value: s })) });
  return conv;
}

function say(conv, text, extra = {}) {
  conv.messages.push({ role: 'agent', text, at: new Date().toISOString(), ...extra });
  conv.updatedAt = new Date().toISOString();
}

function userSay(conv, text) {
  conv.messages.push({ role: 'user', text, at: new Date().toISOString() });
  conv.updatedAt = new Date().toISOString();
}

function slaText(priority) {
  const h = SLA_HOURS[priority] || 24;
  return h >= 24 ? `${h / 24} 個工作天` : `${h} 小時`;
}

async function handleChat(db, user, conv, input) {
  const ctx = conv.ctx;
  const action = input.action;
  let text = String(input.text || input.value || '').trim().slice(0, 1000);

  if (action === 'switch_device') {
    const d = db.devices.find((x) => x.id === input.value && x.ownerId === user.id);
    if (!d) return;
    ctx.deviceId = d.id;
    userSay(conv, `改用 ${d.assetTag}（${d.brand} ${d.model}）`);
    ctx.triedKb = [];
    return respondDiagnosis(db, user, conv, ctx.problemText);
  }
  if (action === 'resolved') { userSay(conv, '問題解決了'); return markResolved(conv); }
  if (action === 'escalate') { userSay(conv, '請轉給客服人員'); return escalate(db, user, conv, '使用者要求轉客服人員'); }
  if (action === 'more') { userSay(conv, '再試試其他方法'); return respondDiagnosis(db, user, conv, ctx.problemText, { next: true }); }
  if (action === 'not_helpful') {
    userSay(conv, '這些方法沒有幫助');
    return say(conv, '了解，那我們不再重複嘗試。您可以讓我試試其他方向，或直接轉給客服人員——我會把已經試過的步驟一起交給他們，不用重新說明。', {
      actions: [
        { label: '轉客服人員處理', action: 'escalate', primary: true },
        { label: '再試試其他方法', action: 'more' },
      ],
    });
  }

  if (!text) return;
  userSay(conv, text);

  // 已轉人工：後續訊息補充到工單
  if (conv.status === 'escalated' && conv.ticketId) {
    const t = db.tickets.find((x) => x.id === conv.ticketId);
    if (t && OPEN_STATUSES.includes(t.status)) {
      await repo.addComment(t.id, makeComment(user.id, `（來自聊天室的補充）${text}`));
      return say(conv, `已把您的補充加到報修單 ${t.id}，客服人員會看到。`, { actions: [{ label: `查看 ${t.id}`, href: `#/tickets/${t.id}` }, { label: '開始新的對話', action: 'new' }] });
    }
  }

  if (ctx.pendingEscalate) {
    ctx.pendingEscalate = false;
    ctx.problemText = (ctx.problemText + ' ' + text).trim();
    return escalate(db, user, conv, '使用者要求轉客服人員');
  }

  if (RE.human.test(text)) {
    if (ctx.problemText) return escalate(db, user, conv, '使用者要求轉客服人員');
    ctx.pendingEscalate = true;
    return say(conv, '沒問題，我來幫您轉給客服人員。請先用一兩句話描述問題，我會連同您的電腦資料一起交給他們，就不用重複說明了。');
  }
  if (RE.status.test(text) && text.length < 30) return showTickets(db, user, conv);
  if (RE.history.test(text) && text.length < 30) return showHistory(db, user, conv);
  if (RE.device.test(text) && text.length < 30) return showDevice(db, user, conv);
  if (RE.greet.test(text)) return say(conv, '您好！請描述您遇到的問題，或點選下方常見問題：', { actions: QUICK_STARTS.map((s) => ({ label: s, action: 'say', value: s })) });
  if (ctx.shown.length && text.length <= 20 && RE.resolved.test(text) && !RE.failed.test(text)) return markResolved(conv);
  if (ctx.shown.length && RE.failed.test(text) && text.length <= 40) {
    return say(conv, '了解，看起來剛才的方法沒有解決。我建議直接轉給客服人員，並附上您已試過的步驟；或者我也可以再試試其他方向。', {
      actions: [
        { label: '轉客服人員處理', action: 'escalate', primary: true },
        { label: '再試試其他方法', action: 'more' },
      ],
    });
  }
  if (RE.repair.test(text) && text.length <= 12) {
    if (ctx.problemText) return escalate(db, user, conv, '使用者要求報修');
    ctx.pendingEscalate = true;
    return say(conv, '好的，我來幫您建立報修單。請簡單描述遇到的問題，我會自動帶入您的電腦資料。');
  }

  // 一般問題：若新描述比對度低，且先前已有描述，就合併前後文再判斷
  let problem = text;
  if (ctx.problemText && ctx.shown.length) {
    const alone = diagnose(db, { user, text, deviceId: ctx.deviceId });
    if (alone.confidence === 'low' || alone.confidence === 'none') problem = ctx.problemText + ' ' + text;
  }
  ctx.problemText = problem;
  ctx.triedKb = [];
  ctx.shown = [];
  await respondDiagnosis(db, user, conv, problem);
}

async function respondDiagnosis(db, user, conv, problem, { next = false } = {}) {
  const ctx = conv.ctx;
  let d = diagnose(db, { user, text: problem, deviceId: ctx.deviceId });
  if (next) {
    const untried = d.matches.filter((m) => !ctx.triedKb.includes(m.id));
    if (!untried.length) {
      return say(conv, '我目前找到的方法都已經提供給您了。建議轉給客服人員，讓他們進一步檢查——我會附上這次的診斷記錄。', {
        actions: [{ label: '轉客服人員處理', action: 'escalate', primary: true }],
      });
    }
    d = { ...d, causes: d.causes.filter((c) => c.kbId === untried[0].id), matches: untried.slice(0, 1) };
  } else if (d.causes.length) {
    // 以最相關的一篇為主，其他文章當備選
    const firstKb = d.matches[0].id;
    d = { ...d, causes: d.causes.filter((c) => c.kbId === firstKb || d.causes.length <= 3).slice(0, 4) };
  }
  ctx.triedKb.push(...d.matches.map((m) => m.id));
  ctx.shown.push(...d.causes.map((c) => c.text));

  const actions = [];
  let lead;
  if (!d.matches.length) {
    lead = '我查了您的電腦資料、維修履歷與全公司的維修記錄，但沒有找到足夠相似的案例。為了不耽誤您，建議直接轉給客服人員，我會把剛才查到的資料一併附上。您也可以換個方式描述問題。';
    actions.push({ label: '轉客服人員處理', action: 'escalate', primary: true });
  } else {
    const c0 = d.causes[0];
    lead = `我查完了您的電腦資料、維修履歷與全公司維修記錄。最可能的原因是「${c0.text}」` +
      (c0.evidence.length ? `（${c0.evidence[0]}）` : '') + '。請依序試試下面的步驟：';
    if (d.escalation.must) {
      lead = `這類問題（${d.matches[0].title}）涉及資安或人身安全，請先照下面的緊急步驟處理。因為需要即時處置，我已同步為您轉給客服人員。`;
    } else if (d.recurring) {
      lead += `\n另外要提醒：這台電腦近 ${RECUR_DAYS} 天內已有 ${d.recurCount} 次同類報修。如果照著做還是沒改善，建議直接轉客服人員評估根本原因。`;
    }
    if (d.openRelated.length && !d.escalation.must) {
      const r = d.openRelated[0];
      lead += `\n您在這台電腦上已有一張相關的處理中報修單（${r.id}「${r.title}」，${r.status}），若是同一個問題，可以直接到那張單補充說明。`;
      actions.push({ label: `查看 ${r.id}`, href: `#/tickets/${r.id}`, ghost: true });
    }
    if (!d.escalation.must) {
      actions.push({ label: '問題解決了', action: 'resolved', primary: true });
      actions.push({ label: '沒有幫助', action: 'not_helpful' });
    }
    if (d.matches.length > 1 || !next) actions.push({ label: '再試試其他方法', action: 'more', ghost: true });
  }
  if (d.allDevices.length > 1) {
    for (const x of d.allDevices) if (!d.device || x.id !== d.device.id) actions.push({ label: `改用 ${x.assetTag}（${x.brand} ${x.model}）`, action: 'switch_device', value: x.id, ghost: true });
  }

  say(conv, lead, { card: { type: 'diagnosis', data: sanitizeForUser(d) }, actions });
  if (d.escalation.must) await escalate(db, user, conv, d.escalation.reasons[0].text, { silentIntro: true });
}

function markResolved(conv) {
  conv.status = 'resolved';
  say(conv, '太好了，很高興問題解決！如果之後又出現狀況，隨時再來找我。這次的對話已記錄為「小幫手自助解決」。', {
    actions: [{ label: '開始新的對話', action: 'new' }],
  });
}

function showTickets(db, user, conv) {
  const items = db.tickets.filter((t) => t.requesterId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  if (!items.length) return say(conv, '您目前沒有任何報修單。');
  const open = items.filter((t) => OPEN_STATUSES.includes(t.status)).length;
  say(conv, open ? `您目前有 ${open} 張處理中的報修單，最近 ${items.length} 張如下：` : '您目前沒有處理中的報修單，最近的紀錄如下：', {
    card: { type: 'tickets', items: items.map((t) => ({ id: t.id, title: t.title, status: t.status, updatedAt: t.updatedAt })) },
  });
}

function showHistory(db, user, conv) {
  const d = diagnose(db, { user, text: conv.ctx.problemText || '', deviceId: conv.ctx.deviceId });
  if (!d.device) return say(conv, '您的帳號下沒有登記的電腦，因此查不到維修履歷。');
  say(conv, `這是 ${d.device.assetTag}（${d.device.brand} ${d.device.model}）的維修履歷，共 ${d.deviceHistory.length} 筆：`, {
    card: { type: 'tickets', items: d.deviceHistory.map((t) => ({ id: t.id, title: t.title, status: t.status, updatedAt: t.createdAt })) },
  });
}

function showDevice(db, user, conv) {
  const devices = db.devices.filter((d) => d.ownerId === user.id);
  if (!devices.length) return say(conv, '您的帳號下沒有登記的電腦，請聯絡客服人員確認資產登記。');
  say(conv, `您名下共有 ${devices.length} 台電腦：`, { card: { type: 'devices', items: devices.map((d) => ({ device: d, flags: deviceFlags(d) })) } });
}

/* ───────────── 轉客服人員：建立附診斷摘要的報修單 ───────────── */

async function escalate(db, user, conv, reason, { silentIntro = false } = {}) {
  const ctx = conv.ctx;
  if (conv.ticketId) {
    const existing = db.tickets.find((t) => t.id === conv.ticketId);
    if (existing && OPEN_STATUSES.includes(existing.status)) {
      return say(conv, `這次對話已轉給客服人員，報修單是 ${existing.id}，不需要重複建立。`, { actions: [{ label: `查看 ${existing.id}`, href: `#/tickets/${existing.id}` }] });
    }
  }
  const lastUserTexts = conv.messages.filter((m) => m.role === 'user' && !/^(改用|請轉給|問題解決|這些方法|再試試)/.test(m.text)).map((m) => m.text);
  const problem = ctx.problemText || lastUserTexts.join('；') || '（使用者未提供描述）';
  const d = diagnose(db, { user, text: problem, deviceId: ctx.deviceId });

  const summaryLines = [
    d.device ? `使用電腦：${d.device.assetTag}｜${d.device.brand} ${d.device.model}｜${d.device.os}` : '使用電腦：查無登記',
    ...d.deviceFlags.filter((f) => f.level === 'bad' || f.level === 'warn').map((f) => `設備狀態：${f.label}`),
    d.causes.length ? `小幫手判斷的可能原因：${d.causes.slice(0, 3).map((c) => `${c.text}（${c.pct}%）`).join('、')}` : '小幫手判斷：找不到明確的原因',
    ctx.shown.length ? `已請使用者嘗試：${ctx.shown.join('、')}` : '尚未請使用者嘗試任何步驟',
    `轉交原因：${reason}`,
    ...d.escalation.reasons.map((r) => `建議：${r.text}`),
  ];
  const title = (d.matches[0] ? d.matches[0].title : problem).slice(0, 40);
  const ticket = await repo.createTicket({
    title, category: d.category, priority: d.priority, requesterId: user.id, deviceId: d.device ? d.device.id : null, source: 'chat',
    // 描述只放使用者原文；小幫手的判斷放在 aiSummary，只有客服人員看得到
    description: problem,
    aiSummary: {
      reason, confidence: d.confidence, causes: d.causes.slice(0, 3).map((c) => ({ text: c.text, pct: c.pct })),
      tried: ctx.shown.slice(), similarCount: d.similarCases.length, recurring: d.recurring, lines: summaryLines,
    },
    transcript: conv.messages.slice(-30).map((m) => ({ role: m.role, text: m.text, at: m.at })),
  });
  conv.status = 'escalated';
  conv.ticketId = ticket.id;
  say(conv,
    (silentIntro ? '' : '好的，我已經轉給客服人員。') +
    `報修單 ${ticket.id} 已建立（優先順序：${ticket.priority}），已附上您的電腦資料、剛才的診斷紀錄與這段對話，客服人員預計 ${slaText(ticket.priority)}內回覆。之後的補充可直接在這裡輸入，我會加到報修單。`,
    { card: { type: 'ticket', id: ticket.id, title: ticket.title, priority: ticket.priority, status: ticket.status }, actions: [{ label: `查看 ${ticket.id}`, href: `#/tickets/${ticket.id}`, primary: true }, { label: '開始新的對話', action: 'new' }] });
}

module.exports = { diagnose, sanitizeForUser, deviceFlags, newConversation, handleChat, pickDevice };
