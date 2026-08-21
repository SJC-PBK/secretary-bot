// [관리자 그룹] data/admins.json (이메일 배열). 브리핑에서 토큰·서버 리포트 대상 판정에 사용.
const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || './data', 'admins.json');

function load() {
  try {
    const a = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function save(list) {
  fs.mkdirSync(process.env.DATA_DIR || './data', { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
}

function norm(e) {
  return String(e || '').trim().toLowerCase();
}

function isAdmin(email) {
  if (!email) return false;
  return load().some((x) => norm(x) === norm(email));
}

function add(email) {
  const list = load();
  if (!email || list.some((x) => norm(x) === norm(email))) return false;
  list.push(email.trim());
  save(list);
  return true;
}

function remove(email) {
  const list = load();
  const next = list.filter((x) => norm(x) !== norm(email));
  if (next.length === list.length) return false;
  save(next);
  return true;
}

module.exports = { load, isAdmin, add, remove };
