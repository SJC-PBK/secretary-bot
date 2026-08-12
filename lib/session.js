// [세션] 직전에 보여준 목록(번호 지목용)을 session-<id>.json에 저장/조회

const fs = require('fs');
const path = require('path');

function dataDir() {
  return process.env.DATA_DIR || './data';
}

function fileFor(userId) {
  return path.join(dataDir(), `session-${userId}.json`);
}

function ensureDir() {
  fs.mkdirSync(dataDir(), { recursive: true });
}

function setLast(userId, kind, items) {
  ensureDir();
  fs.writeFileSync(fileFor(userId), JSON.stringify({ kind, items }, null, 2), 'utf8');
}

function getLast(userId) {
  try {
    const raw = fs.readFileSync(fileFor(userId), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj.kind === 'string' && Array.isArray(obj.items)) return obj;
    return null;
  } catch {
    return null;
  }
}

module.exports = { setLast, getLast };
