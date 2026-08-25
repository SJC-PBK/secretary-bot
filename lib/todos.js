// [할 일 목록] 구글 Tasks(@default)가 원본 — 설정+이메일 있으면 Tasks, 없으면 로컬 JSON 폴백.
// 첫 사용 시 로컬 할 일을 구글 Tasks로 1회 이관(gt-migrated.json으로 중복 방지).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gtasks = require('./gtasks');

function dataDir() {
  return process.env.DATA_DIR || './data';
}
function file() {
  return path.join(dataDir(), 'todos.json');
}

function readAll() {
  try {
    const arr = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function writeAll(arr) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(arr, null, 2), 'utf8');
}

// ── 로컬(JSON) 구현 ──────────────────────────────────────────────
function localNormalize(userId) {
  const arr = readAll();
  const mine = arr.filter((t) => t.userId === userId);
  if (mine.length === 0 || mine.every((t) => typeof t.order === 'number')) return;
  const active = mine
    .filter((t) => !t.done)
    .sort((a, b) => {
      if (a.due && b.due) return new Date(a.due).getTime() - new Date(b.due).getTime();
      if (a.due) return -1;
      if (b.due) return 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  const done = mine.filter((t) => t.done).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let i = 0;
  for (const t of active) t.order = i++;
  for (const t of done) t.order = i++;
  writeAll(arr);
}
function localList(userId) {
  localNormalize(userId);
  return readAll()
    .filter((t) => t.userId === userId && !t.done)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((t) => ({ id: t.id, text: t.text, due: t.due }));
}
function localAdd(userId, text, due) {
  localNormalize(userId);
  const arr = readAll();
  const maxOrder = arr.filter((t) => t.userId === userId && typeof t.order === 'number').reduce((m, t) => Math.max(m, t.order), -1);
  const item = { id: crypto.randomUUID(), userId, text: String(text || '').trim(), due: due || null, done: false, order: maxOrder + 1, createdAt: new Date().toISOString() };
  arr.push(item);
  writeAll(arr);
  return { id: item.id, text: item.text, due: item.due };
}
function localMove(userId, from, to) {
  const items = localList(userId);
  const n = items.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from > n || to < 1 || to > n) return null;
  const [moved] = items.splice(from - 1, 1);
  items.splice(to - 1, 0, moved);
  const arr = readAll();
  items.forEach((it, idx) => { const ref = arr.find((t) => t.id === it.id); if (ref) ref.order = idx; });
  writeAll(arr);
  return moved;
}
function localEdit(userId, { number, match, text }) {
  const t = String(text || '').trim();
  if (!t) return null;
  const items = localList(userId);
  let target = null;
  if (Number.isInteger(number) && number >= 1 && number <= items.length) target = items[number - 1];
  else if (match) target = items.find((x) => x.text.includes(String(match).trim())) || null;
  if (!target) return null;
  const arr = readAll();
  const ref = arr.find((x) => x.id === target.id);
  if (!ref) return null;
  const old = ref.text;
  ref.text = t;
  writeAll(arr);
  return { old, text: t };
}
function localComplete(userId, id) {
  const arr = readAll();
  const item = arr.find((t) => t.id === id && t.userId === userId);
  if (!item) return null;
  item.done = true;
  item.doneAt = new Date().toISOString();
  writeAll(arr);
  return { id };
}

// ── 구글 Tasks 이관(1회) ──────────────────────────────────────────
function migFile() { return path.join(dataDir(), 'gt-migrated.json'); }
function migList() { try { const a = JSON.parse(fs.readFileSync(migFile(), 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } }
function markMigrated(userId) {
  const l = migList();
  if (!l.includes(userId)) { l.push(userId); fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(migFile(), JSON.stringify(l, null, 2), 'utf8'); }
}
async function ensureMigrated(userId, email) {
  if (migList().includes(userId)) return;
  const local = localList(userId);
  let prev;
  for (const t of local) {
    try { const r = await gtasks.add(email, t.text, t.due, prev); if (r.ok) prev = r.item.id; } catch (e) { console.error('todo 이관 실패:', e && e.message); }
  }
  markMigrated(userId);
  if (local.length) console.log(`[todo] ${userId} 로컬 ${local.length}건 → 구글 Tasks 이관`);
}

// ── 파사드 ───────────────────────────────────────────────────────
function useGT(email) { return gtasks.configured() && !!email; }

async function list(userId, email) {
  if (useGT(email)) { await ensureMigrated(userId, email); const r = await gtasks.list(email); if (!r.ok) throw new Error('gtasks_list: ' + r.error); return r.items; }
  return localList(userId);
}
async function add(userId, email, text, due) {
  if (useGT(email)) { await ensureMigrated(userId, email); const r = await gtasks.add(email, text, due); if (!r.ok) throw new Error('gtasks_add: ' + r.error); return r.item; }
  return localAdd(userId, text, due);
}
async function move(userId, email, from, to) {
  if (useGT(email)) {
    await ensureMigrated(userId, email);
    const r = await gtasks.list(email); if (!r.ok) throw new Error('gtasks_list: ' + r.error);
    const items = r.items; const n = items.length;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from > n || to < 1 || to > n) return null;
    const arr = items.slice();
    const [moved] = arr.splice(from - 1, 1);
    arr.splice(to - 1, 0, moved);
    const idx = arr.findIndex((x) => x.id === moved.id);
    const prevId = idx === 0 ? null : arr[idx - 1].id;
    const mv = await gtasks.move(email, moved.id, prevId); if (!mv.ok) throw new Error('gtasks_move: ' + mv.error);
    return moved;
  }
  return localMove(userId, from, to);
}
async function edit(userId, email, spec) {
  const t = String((spec && spec.text) || '').trim();
  if (!t) return null;
  if (useGT(email)) {
    await ensureMigrated(userId, email);
    const r = await gtasks.list(email); if (!r.ok) throw new Error('gtasks_list: ' + r.error);
    const items = r.items;
    let target = null;
    if (Number.isInteger(spec.number) && spec.number >= 1 && spec.number <= items.length) target = items[spec.number - 1];
    else if (spec.match) target = items.find((x) => x.text.includes(String(spec.match).trim())) || null;
    if (!target) return null;
    const p = await gtasks.patchTitle(email, target.id, t); if (!p.ok) throw new Error('gtasks_patch: ' + p.error);
    return { old: target.text, text: t };
  }
  return localEdit(userId, spec);
}
async function complete(userId, email, id) {
  if (useGT(email)) { const r = await gtasks.complete(email, id); if (!r.ok) throw new Error('gtasks_complete: ' + r.error); return { id }; }
  return localComplete(userId, id);
}

// 마감 표시: '오늘 마감' / '내일 마감' / 'D-3' / '2일 지남' / '' (KST 날짜 기준)
function dueLabel(iso) {
  if (!iso) return '';
  const due = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dd = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const nd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((dd - nd) / 86400000);
  if (days < 0) return `${-days}일 지남`;
  if (days === 0) return '오늘 마감';
  if (days === 1) return '내일 마감';
  return `D-${days}`;
}

module.exports = { list, add, move, edit, complete, dueLabel };
