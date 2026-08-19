// [구글 드라이브 저장] 서비스계정(도메인 위임)으로 각 사용자 드라이브에
// 구글 문서(Docs)/시트(Sheets)를 생성한다. drive.file scope(자기가 만든 파일만) 최소권한.
// 내용 → 구글 형식 변환은 Drive 업로드 시 자동 변환(text/html→Docs, text/csv→Sheets)으로 처리.

const { google } = require('googleapis');
const fs = require('fs');
const { Readable } = require('stream');

const KEY_PATH = process.env.SA_KEY || './service-account.json';

function configured() {
  return fs.existsSync(KEY_PATH);
}

function driveFor(userEmail) {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    subject: userEmail,
  });
  return google.drive({ version: 'v3', auth });
}

// 검색·복제용 클라이언트: 전체 읽기(drive.readonly) + 자기 생성물 쓰기(drive.file).
// → 원본은 읽기만, 사본만 수정 가능(원본 수정·삭제는 권한 자체가 없어 불가).
function driveRW(userEmail) {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'],
    subject: userEmail,
  });
  return google.drive({ version: 'v3', auth });
}

function escapeQ(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// 파일명 검색: 개인 드라이브 + (설정된) 특정 공유 드라이브. {ok, files:[{id,name,mimeType,webViewLink,where}]}
async function search({ userEmail, query, sharedDriveId }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  if (!userEmail) return { ok: false, error: 'no_email' };
  if (!query || !String(query).trim()) return { ok: false, error: 'empty_query' };
  try {
    const drive = driveRW(userEmail);
    const q = `name contains '${escapeQ(query.trim())}' and trashed = false`;
    const fields = 'files(id,name,mimeType,modifiedTime,webViewLink)';
    const out = [];
    const personal = await drive.files.list({ q, fields, pageSize: 10, orderBy: 'modifiedTime desc', corpora: 'user', spaces: 'drive' });
    for (const f of personal.data.files || []) out.push({ ...f, where: '내 드라이브' });
    if (sharedDriveId) {
      const shared = await drive.files.list({ q, fields, pageSize: 10, orderBy: 'modifiedTime desc', corpora: 'drive', driveId: sharedDriveId, includeItemsFromAllDrives: true, supportsAllDrives: true });
      for (const f of shared.data.files || []) out.push({ ...f, where: '공유 드라이브' });
    }
    return { ok: true, files: out.slice(0, 20) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

// 사본 생성: 원본을 사용자 '내 드라이브' 루트로 복제(원본 불변). {ok, id, name, link}
async function copy({ userEmail, fileId, newName }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  if (!userEmail) return { ok: false, error: 'no_email' };
  try {
    const drive = driveRW(userEmail);
    const requestBody = { parents: ['root'] };
    if (newName) requestBody.name = newName;
    const res = await drive.files.copy({ fileId, requestBody, supportsAllDrives: true, fields: 'id,name,webViewLink' });
    return { ok: true, id: res.data.id, name: res.data.name, link: res.data.webViewLink };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

function bufToStream(buf) {
  const r = new Readable();
  r.push(buf);
  r.push(null);
  return r;
}

// 공통: 소스(html/csv)를 업로드하며 구글 형식으로 변환 생성. 반환 {ok, id?, name?, link?, error?}
async function createConverted({ userEmail, name, googleMime, sourceMime, body }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  if (!userEmail) return { ok: false, error: 'no_email' };
  try {
    const drive = driveFor(userEmail);
    const res = await drive.files.create({
      requestBody: { name: safeName(name), mimeType: googleMime },
      media: { mimeType: sourceMime, body: typeof body === 'string' ? body : bufToStream(body) },
      fields: 'id,name,webViewLink',
    });
    return { ok: true, id: res.data.id, name: res.data.name, link: res.data.webViewLink };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

// 구글 문서(Docs) — HTML 본문에서 생성
function createDoc({ userEmail, name, html }) {
  return createConverted({
    userEmail,
    name,
    googleMime: 'application/vnd.google-apps.document',
    sourceMime: 'text/html',
    body: '﻿' + String(html || ''), // BOM으로 UTF-8 한글 보존
  });
}

// 구글 시트(Sheets) — 행 배열(rows)에서 CSV 생성
function createSheet({ userEmail, name, rows }) {
  return createConverted({
    userEmail,
    name,
    googleMime: 'application/vnd.google-apps.spreadsheet',
    sourceMime: 'text/csv',
    body: '﻿' + toCsv(rows), // BOM으로 UTF-8 한글 보존
  });
}

function toCsv(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => (Array.isArray(row) ? row : [row])
      .map((cell) => {
        const s = cell == null ? '' : String(cell);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      })
      .join(','))
    .join('\n');
}

function safeName(name) {
  const s = String(name || '문서').replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 80) || '문서';
}

// 원본 형식 그대로 드라이브에 업로드(변환 없음) — NAS 사본 등. {ok, id, name, link}
async function uploadRaw({ userEmail, name, buffer, mimeType }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  if (!userEmail) return { ok: false, error: 'no_email' };
  try {
    const drive = driveFor(userEmail); // drive.file: 앱이 만든 파일만
    const res = await drive.files.create({
      requestBody: { name: safeName(name), parents: ['root'] },
      media: { mimeType: mimeType || 'application/octet-stream', body: bufToStream(buffer) },
      fields: 'id,name,webViewLink',
    });
    return { ok: true, id: res.data.id, name: res.data.name, link: res.data.webViewLink };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

// 구글 슬라이드(Slides) — pptx 버퍼에서 변환 생성
function createSlides({ userEmail, name, buffer }) {
  return createConverted({
    userEmail,
    name,
    googleMime: 'application/vnd.google-apps.presentation',
    sourceMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    body: buffer,
  });
}

module.exports = { configured, createDoc, createSheet, createSlides, search, copy, uploadRaw };
