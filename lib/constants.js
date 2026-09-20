'use strict';

module.exports = {
  DAY: 864e5,
  HOUR: 36e5,
  CATEGORIES: ['硬體', '作業系統', '軟體應用', '網路/VPN', '帳號/權限', '電子郵件', '印表機/週邊', '資安', '其他'],
  PRIORITIES: ['低', '中', '高', '緊急'],
  STATUSES: ['待處理', '處理中', '等待使用者', '已解決', '已關閉'],
  OPEN_STATUSES: ['待處理', '處理中', '等待使用者'],
  DONE_STATUSES: ['已解決', '已關閉'],
  // 各優先順序的回應/處理目標（小時）
  SLA_HOURS: { 緊急: 4, 高: 8, 中: 24, 低: 72 },
};
