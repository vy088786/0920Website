'use strict';

// 中文沒有空白斷詞，改用「單字＋雙字組」比對；英數字則以單字為單位。
const STOP = new Set('的了是我有不在就都也很會要到請一個這那們把被讓和與或及但而還又再可以能想嗎呢吧啊'.split(''));

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
}

function grams(s) {
  const t = norm(s);
  const out = new Set();
  for (const run of t.match(/[㐀-鿿]+/g) || []) {
    for (const ch of run) if (!STOP.has(ch)) out.add(ch);
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  for (const w of t.match(/[a-z0-9]+/g) || []) if (w.length > 1) out.add(w);
  return out;
}

// 依文件頻率給予權重：越少見的詞越有鑑別力
function buildIdf(docs) {
  const df = new Map();
  for (const d of docs) for (const g of d) df.set(g, (df.get(g) || 0) + 1);
  const n = docs.length + 1;
  return (g) => Math.log(1 + n / (1 + (df.get(g) || 0)));
}

function cosine(a, b, weight = () => 1) {
  let dot = 0, na = 0, nb = 0;
  for (const g of a) {
    const w = weight(g);
    na += w * w;
    if (b.has(g)) dot += w * w;
  }
  for (const g of b) {
    const w = weight(g);
    nb += w * w;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// 查詢詞被文件涵蓋的比例（長描述時，比餘弦相似度更不易被雜訊稀釋）
function coverage(query, doc, weight = () => 1) {
  let hit = 0, all = 0;
  for (const g of query) {
    const w = weight(g);
    all += w;
    if (doc.has(g)) hit += w;
  }
  return all ? hit / all : 0;
}

module.exports = { norm, grams, buildIdf, cosine, coverage };
