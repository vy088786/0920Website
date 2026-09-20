'use strict';
const { DAY, HOUR, SLA_HOURS } = require('./constants');
const kb = require('./kb');

const ago = (d, h = 0) => new Date(Date.now() - d * DAY - h * HOUR).toISOString();
const day = (d) => ago(d).slice(0, 10);

const users = [
  { id: 'S001', name: '陳志明', dept: '資訊部', title: 'IT 客服工程師（一線）', role: 'staff', ext: '1201' },
  { id: 'S002', name: '林雅婷', dept: '資訊部', title: 'IT 客服工程師（網路/資安）', role: 'staff', ext: '1202' },
  { id: 'S003', name: '王建宏', dept: '資訊部', title: 'IT 主管', role: 'staff', ext: '1200' },
  { id: 'E1001', name: '張小明', dept: '業務部', title: '業務專員', role: 'user', ext: '3105' },
  { id: 'E1002', name: '李美玲', dept: '財務部', title: '會計', role: 'user', ext: '3212' },
  { id: 'E1003', name: '黃俊傑', dept: '研發部', title: '軟體工程師', role: 'user', ext: '4018' },
  { id: 'E1004', name: '吳佩珊', dept: '人資部', title: '人資專員', role: 'user', ext: '3301' },
  { id: 'E1005', name: '劉家豪', dept: '行銷部', title: '設計師', role: 'user', ext: '3420' },
  { id: 'E1006', name: '蔡宜庭', dept: '法務部', title: '法務專員', role: 'user', ext: '3510' },
  { id: 'E1007', name: '鄭凱文', dept: '研發部', title: '資深工程師', role: 'user', ext: '4022' },
  { id: 'E1008', name: '許雅涵', dept: '業務部', title: '業務經理', role: 'user', ext: '3108' },
  { id: 'E1009', name: '楊承翰', dept: '採購部', title: '採購專員', role: 'user', ext: '3615' },
  { id: 'E1010', name: '謝淑芬', dept: '總務部', title: '總務專員', role: 'user', ext: '3701' },
].map((u) => ({ ...u, email: `${u.id.toLowerCase()}@corp.example` }));

function dev(assetTag, ownerId, type, brand, model, os, cpu, ramGB, storage, o) {
  return {
    id: assetTag, assetTag, hostname: `${type === '筆電' ? 'NB' : 'PC'}-${assetTag.slice(3)}-${ownerId}`,
    ownerId, type, brand, model, os, cpu, ramGB, storage,
    diskFreePct: o.disk, purchaseDate: day(o.purchaseAgo),
    warrantyEnd: day(o.purchaseAgo - o.warrantyYears * 365),
    lastPatchDate: day(o.patchAgo), antivirus: o.av || '正常',
    batteryHealthPct: type === '筆電' ? o.battery ?? 90 : null,
    uptimeDays: o.uptime, location: o.location, primary: !!o.primary,
  };
}

const devices = [
  dev('NB-0231', 'E1001', '筆電', 'Dell', 'Latitude 5440', 'Windows 11 23H2', 'Core i5-1345U', 16, '512GB SSD',
    { disk: 6, purchaseAgo: 520, warrantyYears: 3, patchAgo: 12, battery: 88, uptime: 27, location: '台北總部 5F', primary: true }),
  dev('NB-0118', 'E1002', '筆電', 'HP', 'EliteBook 840 G8', 'Windows 10 22H2', 'Core i5-1135G7', 8, '256GB SSD',
    { disk: 14, purchaseAgo: 1650, warrantyYears: 3, patchAgo: 95, battery: 48, uptime: 5, location: '台北總部 3F', primary: true }),
  dev('NB-0302', 'E1003', '筆電', 'Lenovo', 'ThinkPad T14 Gen 3', 'Windows 11 23H2', 'Core i7-1260P', 32, '1TB SSD',
    { disk: 55, purchaseAgo: 300, warrantyYears: 3, patchAgo: 20, av: '病毒碼過舊', battery: 92, uptime: 3, location: '研發中心 2F', primary: true }),
  dev('PC-0057', 'E1004', '桌機', 'Dell', 'OptiPlex 7090', 'Windows 11 23H2', 'Core i5-11500', 16, '512GB SSD',
    { disk: 40, purchaseAgo: 1100, warrantyYears: 3, patchAgo: 30, uptime: 9, location: '台北總部 3F', primary: true }),
  dev('NB-0277', 'E1005', '筆電', 'Apple', 'MacBook Pro 14" (M2 Pro)', 'macOS 14.5', 'Apple M2 Pro', 16, '512GB SSD',
    { disk: 35, purchaseAgo: 600, warrantyYears: 1, patchAgo: 15, battery: 91, uptime: 6, location: '台北總部 4F', primary: true }),
  dev('NB-0190', 'E1006', '筆電', 'ASUS', 'ExpertBook B5', 'Windows 11 23H2', 'Core i5-1240P', 8, '512GB SSD',
    { disk: 22, purchaseAgo: 900, warrantyYears: 3, patchAgo: 40, battery: 70, uptime: 20, location: '台北總部 6F', primary: true }),
  dev('NB-0305', 'E1007', '筆電', 'Lenovo', 'ThinkPad T14 Gen 3', 'Windows 11 23H2', 'Core i7-1260P', 16, '512GB SSD',
    { disk: 33, purchaseAgo: 280, warrantyYears: 3, patchAgo: 10, battery: 95, uptime: 2, location: '研發中心 2F', primary: true }),
  dev('PC-0112', 'E1007', '桌機', 'HP', 'ProDesk 400 G7', 'Windows 11 23H2', 'Core i5-10500', 16, '512GB SSD',
    { disk: 48, purchaseAgo: 1300, warrantyYears: 3, patchAgo: 35, uptime: 40, location: '研發中心 2F' }),
  dev('NB-0233', 'E1008', '筆電', 'Dell', 'Latitude 5440', 'Windows 11 23H2', 'Core i5-1345U', 16, '512GB SSD',
    { disk: 45, purchaseAgo: 500, warrantyYears: 3, patchAgo: 18, battery: 86, uptime: 8, location: '台北總部 5F', primary: true }),
  dev('NB-0119', 'E1009', '筆電', 'HP', 'EliteBook 840 G8', 'Windows 10 22H2', 'Core i5-1135G7', 8, '256GB SSD',
    { disk: 9, purchaseAgo: 1640, warrantyYears: 3, patchAgo: 130, battery: 55, uptime: 16, location: '台北總部 4F', primary: true }),
  dev('PC-0058', 'E1010', '桌機', 'Dell', 'OptiPlex 7090', 'Windows 11 23H2', 'Core i5-11500', 16, '512GB SSD',
    { disk: 61, purchaseAgo: 1100, warrantyYears: 3, patchAgo: 22, uptime: 12, location: '台北總部 1F', primary: true }),
];

// 已結案的歷史維修記錄：[標題, 描述, 分類, 使用者, 設備, 幾天前, 處理小時, 根因, 處理方式, 優先順序, 處理人]
const HISTORY = [
  ['電腦開機和開啟程式都變得很慢', '最近開機要 5 分鐘，開 Excel 也要等很久。', '作業系統', 'E1001', 'NB-0231', 75, 5, '磁碟空間不足', '清除暫存檔與 Windows.old 釋出 60GB，並停用 3 個開機啟動項，速度恢復。', '中', 'S001'],
  ['電腦又變得很慢，Excel 開很久', '上次清理後沒多久又慢了，OneDrive 一直在同步。', '作業系統', 'E1001', 'NB-0231', 25, 8, '磁碟空間不足', '再次清理下載資料夾與 OneDrive 快取。同一台電腦已反覆發生，建議評估更換 1TB SSD。', '中', 'S001'],
  ['VPN 連不上，一直顯示驗證失敗', '在家無法連公司 VPN。', '網路/VPN', 'E1001', 'NB-0231', 200, 3, 'VPN 用戶端版本過舊', '更新 GlobalProtect 至 6.2 並重新設定入口網址。', '中', 'S002'],
  ['筆電電池只能用 40 分鐘', '外出開會電池很快就沒電。', '硬體', 'E1002', 'NB-0118', 320, 48, '電池老化', '電池健康度僅剩 55%，於保固內更換原廠電池。', '中', 'S001'],
  ['Windows 更新後卡在更新畫面無法進入系統', '重新開機後一直顯示「正在設定 Windows 更新」。', '作業系統', 'E1002', 'NB-0118', 500, 10, 'Windows 更新未完成', '進入復原環境解除安裝最新更新，重新安裝後正常。', '高', 'S001'],
  ['沒有權限開啟財務共用資料夾', '新專案需要存取 \\\\fs01\\finance\\2026。', '帳號/權限', 'E1002', 'NB-0118', 180, 4, '權限未授權', '取得主管核准後，將帳號加入資料夾存取群組。', '低', 'S002'],
  ['Outlook 無法收信，一直顯示離線', 'Outlook 右下角顯示中斷連線，手機可以收信。', '電子郵件', 'E1003', 'NB-0302', 150, 2, 'Outlook 信箱容量已滿', '封存舊郵件並清空刪除的郵件，容量降至 60%。', '中', 'S002'],
  ['外接螢幕沒有訊號', '用 USB-C 接螢幕，螢幕顯示無訊號。', '硬體', 'E1003', 'NB-0302', 90, 4, '轉接線/排線故障', '更換 USB-C 轉 HDMI 轉接線後正常。', '低', 'S001'],
  ['電腦開機很久，桌面出現後還是很卡', '開機後要等 3 分鐘才能使用。', '作業系統', 'E1003', 'NB-0302', 240, 3, '開機啟動項過多', '停用 8 個非必要的開機啟動項，開機時間從 4 分鐘降到 40 秒。', '低', 'S001'],
  ['印表機無法列印，一直顯示錯誤', '3 樓的共用印表機只有我印不出來。', '印表機/週邊', 'E1004', 'PC-0057', 60, 2, '印表機驅動程式錯誤', '移除舊驅動，安裝新版 PCL6 驅動並重設預設印表機。', '中', 'S002'],
  ['忘記密碼，無法登入電腦', '放完長假後忘記密碼。', '帳號/權限', 'E1004', 'PC-0057', 30, 1, '密碼過期', '協助重設密碼，並教導使用自助重設入口。', '低', 'S001'],
  ['螢幕偶爾出現條紋', '開機一段時間後螢幕出現橫向條紋。', '硬體', 'E1004', 'PC-0057', 350, 6, '顯示卡驅動程式異常', '更新顯示卡驅動程式後不再出現。', '中', 'S001'],
  ['Wi-Fi 常常斷線，視訊會議會中斷', '在會議室連 Wi-Fi 每隔幾分鐘就斷線。', '網路/VPN', 'E1005', 'NB-0277', 120, 6, 'DNS 快取異常', '清除 DNS 快取並重設網路設定，改用 5GHz SSID，之後穩定。', '中', 'S002'],
  ['電腦很慢，同時開幾個 Chrome 就當掉', '打開設計軟體加瀏覽器就卡到不能動。', '作業系統', 'E1006', 'NB-0190', 200, 6, '記憶體不足', '記憶體由 8GB 加裝至 16GB，並教導關閉多餘分頁。', '中', 'S001'],
  ['無法安裝 Adobe Acrobat', '安裝時顯示需要授權。', '軟體應用', 'E1006', 'NB-0190', 45, 3, '軟體授權未指派', '於授權系統指派 Acrobat Pro 授權後重新安裝。', '低', 'S002'],
  ['桌機一直藍屏後自動重開機', '一天發生好幾次，藍屏字樣是 MEMORY_MANAGEMENT。', '硬體', 'E1007', 'PC-0112', 210, 30, '記憶體模組故障', '以記憶體診斷發現錯誤，更換記憶體模組後穩定。', '高', 'S001'],
  ['無法連到網路磁碟機', '出現「拒絕存取」，但同事可以開。', '網路/VPN', 'E1007', 'PC-0112', 100, 2, '網路磁碟機憑證過期', '清除認證管理員中的舊憑證並重新輸入。', '中', 'S002'],
  ['在家無法連 VPN', '連線一直逾時。', '網路/VPN', 'E1007', 'NB-0305', 60, 2, 'VPN 用戶端版本過舊', '更新 VPN 用戶端後即可連線。', '中', 'S002'],
  ['收到可疑郵件，已經點了連結', '郵件自稱是物流通知，點進去要求登入。', '資安', 'E1008', 'NB-0233', 180, 12, '釣魚郵件誤點連結', '隔離電腦、重設密碼並全機掃描，未發現惡意程式；已對部門加強宣導。', '高', 'S002'],
  ['Zoom 開會時麥克風沒有聲音', '別人聽不到我說話。', '軟體應用', 'E1008', 'NB-0233', 70, 1, '相機/麥克風隱私權設定被關閉', '開啟 Windows 隱私權設定中的麥克風存取後恢復。', '低', 'S001'],
  ['電腦變很慢，Teams 一開就卡', '這一週特別慢。', '作業系統', 'E1008', 'NB-0233', 330, 3, '開機啟動項過多', '停用啟動項並清理 Teams 快取。', '低', 'S001'],
  ['帳號被鎖定，無法登入', '早上輸入了幾次都失敗就被鎖住。', '帳號/權限', 'E1009', 'NB-0119', 14, 0.5, '帳號多次輸入錯誤被鎖定', '於 AD 解鎖，並提醒同步更新手機上儲存的舊密碼。', '低', 'S001'],
  ['筆電插著電源也不充電', '電源燈不亮。', '硬體', 'E1009', 'NB-0119', 260, 24, '電源供應器故障', '更換原廠變壓器後恢復充電。', '中', 'S001'],
  ['電腦很慢，硬碟快滿了', '系統一直提示空間不足。', '作業系統', 'E1009', 'NB-0119', 40, 4, '磁碟空間不足', '清理暫存檔並將舊資料移轉至網路磁碟。', '中', 'S001'],
  ['開機後螢幕一片黑', '主機有運轉但螢幕沒有畫面。', '硬體', 'E1010', 'PC-0058', 300, 20, '轉接線/排線故障', '更換 DisplayPort 線材後正常。', '中', 'S001'],
  ['電腦一直跳更新，卡在 30%', '更新好幾天都沒成功。', '作業系統', 'E1010', 'PC-0058', 55, 3, 'Windows 更新未完成', '執行 Windows 更新疑難排解並重設更新元件後完成更新。', '中', 'S001'],
  ['筆電風扇很吵而且會自己當機', '玩不到一小時就變很燙然後重開機。', '硬體', 'E1003', 'NB-0302', 160, 7, '散熱不良', '清潔散熱風扇與更換散熱膏。', '中', 'S001'],
  ['會議室投影機接不上', '接上筆電後投影機顯示無訊號。', '硬體', 'E1001', 'NB-0231', 110, 1, '轉接線/排線故障', '會議室 HDMI 線材損壞，已更換。', '低', 'S001'],
  ['無法使用網路印表機掃描到信箱', '掃描後收不到信。', '印表機/週邊', 'E1006', 'NB-0190', 130, 2, '印表機離線或佇列卡住', '重新設定掃描目的地並重新啟動印表機。', '低', 'S002'],
];

// 進行中的單：[標題, 描述, 分類, 使用者, 設備, 幾天前, 優先, 狀態, 處理人, 留言[]]
const OPEN = [
  ['螢幕偶爾閃爍，移動螢幕角度時特別明顯', '這兩天螢幕會突然閃一下，蓋上再打開有時候會好。', '硬體', 'E1002', 'NB-0118', 2, '中', '處理中', 'S001',
    [['S001', '您好，我先看過設備資料，這台已超過保固。想請您方便時帶來 IT 櫃台，我們檢查螢幕排線。', false]]],
  ['VPN 一直斷線，每 10 分鐘就中斷', '在家上班時連上 VPN 大約 10 分鐘就會掉線。', '網路/VPN', 'E1003', 'NB-0302', 1, '中', '處理中', 'S002',
    [['S002', '已檢查您的帳號，VPN 權限正常。請先更新 GlobalProtect 至 6.2 再回報。', false], ['S002', '（內部）防毒病毒碼過舊，順便請他更新。', true]]],
  ['Outlook 開啟很慢，要等 2 分鐘', '每天早上打開 Outlook 都轉很久。', '電子郵件', 'E1006', 'NB-0190', 0.3, '中', '待處理', null, []],
  ['Teams 視訊會議沒有畫面', '對方看不到我的影像，相機燈也沒亮。', '軟體應用', 'E1008', 'NB-0233', 2, '中', '等待使用者', 'S002',
    [['S002', '請問除了 Teams，用 Windows「相機」App 也看不到畫面嗎？請回覆結果，我再繼續協助。', false]]],
  ['印表機列印出來是亂碼', '列印 Word 檔案，出來一堆符號。', '印表機/週邊', 'E1004', 'PC-0057', 0.5, '低', '待處理', null, []],
  ['電腦一直藍屏然後重開機', '今天上午已經發生兩次。', '硬體', 'E1007', 'PC-0112', 0.2, '高', '待處理', null, []],
];

function build() {
  const meta = { seq: { ticket: 0 } };
  const tickets = [];
  const nextId = () => 'INC-' + String(++meta.seq.ticket).padStart(4, '0');

  // 先產生歷史單（由舊到新），編號才會依時間遞增
  const hist = HISTORY.map((h) => ({ h, at: h[5] })).sort((a, b) => b.at - a.at);
  for (const { h } of hist) {
    const [title, description, category, requesterId, deviceId, daysAgo, hours, rootCause, resolution, priority, staff] = h;
    const created = ago(daysAgo, 0);
    const resolvedAt = new Date(new Date(created).getTime() + hours * HOUR).toISOString();
    const closed = daysAgo > 7;
    tickets.push({
      id: nextId(), title, description, category, priority, status: closed ? '已關閉' : '已解決',
      requesterId, deviceId, assigneeId: staff, source: 'form',
      createdAt: created, updatedAt: resolvedAt,
      dueAt: new Date(new Date(created).getTime() + SLA_HOURS[priority] * HOUR).toISOString(),
      resolvedAt, closedAt: closed ? resolvedAt : null, rootCause, resolution,
      comments: [
        { by: 'system', type: 'system', body: '報修單已建立', internal: false, at: created },
        { by: staff, type: 'comment', body: `已處理完成：${resolution}`, internal: false, at: resolvedAt },
        { by: 'system', type: 'system', body: closed ? '使用者確認後已關閉' : '狀態變更：處理中 → 已解決', internal: false, at: resolvedAt },
      ],
      aiSummary: null, transcript: null,
    });
  }

  // 一張剛解決、等使用者確認的單
  tickets.push({
    id: nextId(), title: 'Wi-Fi 連不上，顯示已連線但無法上網', description: '今天早上到公司後，筆電一直上不了網。',
    category: '網路/VPN', priority: '中', status: '已解決', requesterId: 'E1005', deviceId: 'NB-0277', assigneeId: 'S002', source: 'form',
    createdAt: ago(3), updatedAt: ago(2, 20), dueAt: ago(2), resolvedAt: ago(2, 20), closedAt: null,
    rootCause: 'DNS 快取異常', resolution: '清除 DNS 快取並重新加入 Wi-Fi，已可正常上網。',
    comments: [
      { by: 'system', type: 'system', body: '報修單已建立', internal: false, at: ago(3) },
      { by: 'S002', type: 'comment', body: '已清除 DNS 快取並重新加入 Wi-Fi，請您確認是否恢復正常。', internal: false, at: ago(2, 20) },
    ],
    aiSummary: null, transcript: null,
  });

  for (const [title, description, category, requesterId, deviceId, daysAgo, priority, status, staff, notes] of OPEN) {
    const created = ago(daysAgo);
    const comments = [{ by: 'system', type: 'system', body: '報修單已建立', internal: false, at: created }];
    notes.forEach(([by, body, internal], i) => comments.push({
      by, type: 'comment', body, internal, at: new Date(new Date(created).getTime() + (i + 1) * 3 * HOUR).toISOString(),
    }));
    tickets.push({
      id: nextId(), title, description, category, priority, status, requesterId, deviceId, assigneeId: staff, source: 'form',
      createdAt: created, updatedAt: comments[comments.length - 1].at,
      dueAt: new Date(new Date(created).getTime() + SLA_HOURS[priority] * HOUR).toISOString(),
      resolvedAt: null, closedAt: null, rootCause: '', resolution: '', comments, aiSummary: null, transcript: null,
    });
  }

  return { meta, users, devices, kb, tickets, conversations: [], sessions: {} };
}

module.exports = { build };
