// [할 일 목록] todos.json 배열로 사용자별 할 일 추가/조회/완료. 시각이 필요 없는 단순 목록.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// 최초 1회 마이그레이션: order 없는 항목에 현재 표시순(마감→등록순) 기준으로 order 부여.
// 한 번 부여되면 이후엔 수동 순서(order)가 위치를 결정한다.
function normalize(userId) {
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

function add(userId, text, due) {
  normalize(userId);
  const arr = readAll();
  const maxOrder = arr
    .filter((t) => t.userId === userId && typeof t.order === 'number')
    .reduce((m, t) => Math.max(m, t.order), -1);
  const item = {
    id: crypto.randomUUID(),
    userId,
    text: String(text || '').trim(),
    due: due || null, // 마감일 ISO(+09:00) 또는 null
    done: false,
    order: maxOrder + 1, // 목록 끝에 추가
    createdAt: new Date().toISOString(),
  };
  arr.push(item);
  writeAll(arr);
  return item;
}

// 미완료 할 일 (수동 순서 order 기준). 마감일은 라벨로만 표시.
function list(userId) {
  normalize(userId);
  return readAll()
    .filter((t) => t.userId === userId && !t.done)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

// 순서 이동: from번째 항목을 to번째 위치로(1-based). 나머지는 자동으로 밀린다. 이동한 항목 반환/실패 null.
function move(userId, from, to) {
  const items = list(userId);
  const n = items.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from > n || to < 1 || to > n) return null;
  const [moved] = items.splice(from - 1, 1);
  items.splice(to - 1, 0, moved);
  const arr = readAll();
  items.forEach((it, idx) => { const ref = arr.find((t) => t.id === it.id); if (ref) ref.order = idx; });
  writeAll(arr);
  return moved;
}

// 문구 수정: 번호(number) 또는 기존 문구 일부(match)로 항목을 찾아 text로 교체. {..., old} 반환/실패 null.
function edit(userId, { number, match, text }) {
  const t = String(text || '').trim();
  if (!t) return null;
  const items = list(userId);
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
  return { ...ref, old };
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

// 완료 처리(목록에서 감춤). 성공 시 완료된 항목 반환, 없으면 null.
function complete(userId, id) {
  const arr = readAll();
  const item = arr.find((t) => t.id === id && t.userId === userId);
  if (!item) return null;
  item.done = true;
  item.doneAt = new Date().toISOString();
  writeAll(arr);
  return item;
}

// 완전 삭제. 존재했으면 true.
function remove(userId, id) {
  const arr = readAll();
  const idx = arr.findIndex((t) => t.id === id && t.userId === userId);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  writeAll(arr);
  return true;
}

module.exports = { add, list, move, edit, complete, remove, dueLabel };
