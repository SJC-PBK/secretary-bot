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

function add(userId, text, due) {
  const arr = readAll();
  const item = {
    id: crypto.randomUUID(),
    userId,
    text: String(text || '').trim(),
    due: due || null, // 마감일 ISO(+09:00) 또는 null
    done: false,
    createdAt: new Date().toISOString(),
  };
  arr.push(item);
  writeAll(arr);
  return item;
}

// 미완료 할 일 (마감 빠른 순 → 마감 없는 건 뒤에 등록순)
function list(userId) {
  return readAll()
    .filter((t) => t.userId === userId && !t.done)
    .sort((a, b) => {
      if (a.due && b.due) return new Date(a.due).getTime() - new Date(b.due).getTime();
      if (a.due) return -1;
      if (b.due) return 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
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

module.exports = { add, list, complete, remove, dueLabel };
