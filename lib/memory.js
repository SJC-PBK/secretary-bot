// [대화 맥락] 사용자별 최근 대화를 파일 JSON으로 저장/로드 (상한 12개)

const fs = require('fs');
const path = require('path');

const MAX = 12;

function dataDir() {
  return process.env.DATA_DIR || './data';
}

function fileFor(userId) {
  return path.join(dataDir(), `memory-${userId}.json`);
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

function append(userId, role, text) {
  ensureDir();
  const arr = load(userId);
  arr.push({ role, text });
  while (arr.length > MAX) arr.shift();
  fs.writeFileSync(fileFor(userId), JSON.stringify(arr, null, 2), 'utf8');
}

module.exports = { load, append };
