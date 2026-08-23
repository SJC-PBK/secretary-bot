// [페르소나] 사용자별 응대 지침(말투·역할·선호). ask() 시스템 프롬프트에 더해진다.
// 서버 JSON이 원본(런타임 빠름), 구글 문서 편집분은 여기로 동기화된다.
const fs = require('fs');
const path = require('path');

const MAX = 1000;

function dataDir() { return process.env.DATA_DIR || './data'; }
function fileFor(userId) { return path.join(dataDir(), `persona-${userId}.json`); }

function get(userId) {
  try {
    const o = JSON.parse(fs.readFileSync(fileFor(userId), 'utf8'));
    return (o && typeof o.text === 'string') ? o.text : '';
  } catch { return ''; }
}

function set(userId, text) {
  const t = String(text || '').trim().slice(0, MAX);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(fileFor(userId), JSON.stringify({ text: t, at: new Date().toISOString() }, null, 2), 'utf8');
  return t;
}

module.exports = { get, set };
