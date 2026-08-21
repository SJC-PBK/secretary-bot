// [장기기억] 사용자별 지속 프로필 사실을 profile-<id>.json 배열로 저장/조회/삭제

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX = 200;

function dataDir() {
  return process.env.DATA_DIR || './data';
}

function fileFor(userId) {
  return path.join(dataDir(), `profile-${userId}.json`);
}

function ensureDir() {
  fs.mkdirSync(dataDir(), { recursive: true });
}

function load(userId) {
  try {
    const raw = fs.readFileSync(fileFor(userId), 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function facts(userId) {
  return load(userId).map((f) => f.text);
}

function add(userId, text, source) {
  text = (text || '').trim();
  // 사실(fact)은 짧게 유지 — 긴 문서/회의록이 기억으로 들어가 모든 대화를 오염시키는 것 방지
  if (!text || text.length > 400) return null;
  const arr = load(userId);
  if (arr.some((f) => f.text === text)) return null;
  const fact = { id: crypto.randomUUID(), text, source, at: new Date().toISOString() };
  arr.push(fact);
  while (arr.length > MAX) arr.shift();
  ensureDir();
  fs.writeFileSync(fileFor(userId), JSON.stringify(arr, null, 2), 'utf8');
  return fact;
}

function list(userId) {
  return load(userId);
}

function forget(userId, id) {
  const arr = load(userId);
  const idx = arr.findIndex((f) => f.id === id);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  ensureDir();
  fs.writeFileSync(fileFor(userId), JSON.stringify(arr, null, 2), 'utf8');
  return true;
}

module.exports = { load, facts, add, list, forget };
