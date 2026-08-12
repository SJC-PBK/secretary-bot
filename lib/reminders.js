// [리마인더 저장] reminders.json 배열로 등록/조회/취소/발송대상/발송표시

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function dataDir() {
  return process.env.DATA_DIR || './data';
}

function file() {
  return path.join(dataDir(), 'reminders.json');
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

function add({ userId, at, message }) {
  const arr = readAll();
  const reminder = {
    id: crypto.randomUUID(),
    userId,
    at,
    message,
    sent: false,
    createdAt: new Date().toISOString(),
  };
  arr.push(reminder);
  writeAll(arr);
  return reminder;
}

function list(userId) {
  return readAll()
    .filter((r) => r.userId === userId && !r.sent)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function cancel(userId, id) {
  const arr = readAll();
  const idx = arr.findIndex((r) => r.id === id && r.userId === userId);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  writeAll(arr);
  return true;
}

function due(nowMs) {
  return readAll().filter(
    (r) => !r.sent && new Date(r.at).getTime() <= nowMs
  );
}

function markSent(id) {
  const arr = readAll();
  const r = arr.find((x) => x.id === id);
  if (!r) return;
  r.sent = true;
  writeAll(arr);
}

module.exports = { add, list, cancel, due, markSent };
