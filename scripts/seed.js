'use strict';
// 把範例資料（lib/seed.js）寫進 Supabase。
//   node scripts/seed.js           只在資料庫是空的時候執行
//   node scripts/seed.js --force   先清空所有資料表再重建（npm run reseed）
const sb = require('../lib/supabase');
const { toRow } = require('../lib/repo');
const { build } = require('../lib/seed');

// 由子表到父表，清空時才不會違反外鍵
const TABLES = [['conversations', 'id'], ['sessions', 'token'], ['ticket_comments', 'id'], ['tickets', 'id'], ['devices', 'id'], ['kb_articles', 'id'], ['users', 'id']];

async function main() {
  if (!sb.enabled) throw new Error('缺少 Supabase 設定：請先在 .env 設定 SUPABASE_URL、SUPABASE_KEY、SUPABASE_APP_SECRET');
  const force = process.argv.includes('--force');

  const existing = [];
  for (const [table, key] of TABLES) if ((await sb.select(table, { select: key, limit: 1 })).length) existing.push(table);
  if (existing.length && !force) {
    throw new Error(`資料庫已有資料（${existing.join('、')}），為避免覆蓋不執行。若要清空並重建範例資料，請執行 npm run reseed`);
  }
  if (existing.length) {
    console.log('清空現有資料…');
    for (const [table, key] of TABLES) await sb.remove(table, { [key]: key === 'id' && table === 'ticket_comments' ? 'gt.0' : 'not.is.null' });
  }

  const db = build();
  console.log('寫入範例資料…');
  await sb.insert('users', db.users.map(toRow.user));
  await sb.insert('devices', db.devices.map(toRow.device));
  await sb.insert('kb_articles', db.kb.map(toRow.kb));
  await sb.insert('tickets', db.tickets.map(toRow.ticket));
  await sb.insert('ticket_comments', db.tickets.flatMap((t) => t.comments.map((c) => toRow.comment(t.id, c))));
  console.log(`完成：${db.users.length} 位使用者、${db.devices.length} 台電腦、${db.kb.length} 篇知識庫、${db.tickets.length} 張報修單`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
