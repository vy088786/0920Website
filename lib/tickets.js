'use strict';
const { OPEN_STATUSES } = require('./constants');

// 組出一則留言（尚未寫入；由 repo.saveTicket / repo.addComment 存進資料庫）
const makeComment = (by, body, { internal = false, type = 'comment' } = {}) => ({ by, type, body, internal, at: new Date().toISOString() });

const isOpen = (t) => OPEN_STATUSES.includes(t.status);
const isOverdue = (t) => isOpen(t) && Date.now() > new Date(t.dueAt).getTime();

module.exports = { makeComment, isOpen, isOverdue };
