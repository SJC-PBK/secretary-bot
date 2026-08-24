// [사용자 등록부] Slack 사용자 ID → 캘린더 이메일 매핑

const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || './data', 'users.json');
const PFILE = path.join(process.env.DATA_DIR || './data', 'pending.json');

function fallback() {
  const id = process.env.ALLOWED_SLACK_USER_ID;
  if (!id) return {};
  return { [id]: { email: process.env.SECBOT_ADMIN_EMAIL || '' } };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return fallback();
  }
}

function isAllowed(userId) {
  return !!userId && Object.prototype.hasOwnProperty.call(load(), userId);
}

function emailFor(userId) {
  const entry = load()[userId];
  return (entry && entry.email) || null;
}

// 사용자 등록: users.json에 {userId:{email}} 추가(파일 없으면 fallback으로 시작해 pbk 유지)
function register(userId, email) {
  fs.mkdirSync(process.env.DATA_DIR || './data', { recursive: true });
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    reg = fallback();
  }
  reg[userId] = { email };
  fs.writeFileSync(FILE, JSON.stringify(reg, null, 2));
  return reg[userId];
}

function pendingList() {
  try {
    return JSON.parse(fs.readFileSync(PFILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function addPending(userId, info) {
  fs.mkdirSync(process.env.DATA_DIR || './data', { recursive: true });
  const p = pendingList();
  p[userId] = info;
  fs.writeFileSync(PFILE, JSON.stringify(p, null, 2));
}

function removePending(userId) {
  fs.mkdirSync(process.env.DATA_DIR || './data', { recursive: true });
  const p = pendingList();
  delete p[userId];
  fs.writeFileSync(PFILE, JSON.stringify(p, null, 2));
}

// 사용자 등록 해제: users.json에서 제거. 존재했으면 true.
function remove(userId) {
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    reg = fallback();
  }
  const existed = Object.prototype.hasOwnProperty.call(reg, userId);
  delete reg[userId];
  fs.writeFileSync(FILE, JSON.stringify(reg, null, 2));
  return existed;
}

module.exports = { load, isAllowed, emailFor, register, remove, pendingList, addPending, removePending };
