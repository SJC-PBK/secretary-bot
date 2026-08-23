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

// 사용자의 사실 전체를 주어진 텍스트 목록으로 교체(구글 문서 편집 반영용). 반환: 저장된 개수.
function replace(userId, texts) {
  const seen = new Set();
  const next = [];
  for (const t0 of Array.isArray(texts) ? texts : []) {
    const text = String(t0 || '').trim();
    if (!text || text.length > 400) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    next.push({ id: crypto.randomUUID(), text, source: 'doc', at: new Date().toISOString() });
  }
  ensureDir();
  fs.writeFileSync(fileFor(userId), JSON.stringify(next, null, 2), 'utf8');
  return next.length;
}

module.exports = { load, facts, add, list, forget, replace };
