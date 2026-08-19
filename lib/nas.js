// [NAS 접근] 읽기전용으로 마운트된 NAS 공유(/mnt/nas/*)에서 파일명 검색 + 파일 읽기.
// 원본 수정·삭제는 마운트가 ro라 불가. 사본은 상위(app)에서 구글 드라이브로 업로드한다.

const fs = require('fs');
const path = require('path');

const NAS_ROOT = process.env.SECBOT_NAS_ROOT || '/mnt/nas';
const MAX_SCAN = 100000;      // 최대 탐색 항목 수
const MAX_RESULTS = 20;       // 반환 결과 수
const TIME_BUDGET_MS = 15000; // 탐색 시간 상한
const MAX_COPY_BYTES = 60 * 1024 * 1024; // 사본 업로드 크기 상한

// Z: 보기용(심볼릭) 폴더 이름 → 실제 마운트된 원본 공유 이름
const SHARE_ALIASES = {
  '0공지': '공지사항', '공지': '공지사항', '공지사항': '공지사항',
  '1취업': '취업', '취업': '취업',
  '2특화': '특화', '특화': '특화',
  '3지원': '지원', '지원': '지원',
  '4기획': '기획', '기획': '기획',
  '5운영': '운영', '운영': '운영',
  'jobcenter': 'jobdata', 'jobdata': 'jobdata',
  'z_scanfax': 'scan', 'scan': 'scan',
  'z_사진동영상': '사진동영상', '사진동영상': '사진동영상',
};
// 대용량 미디어 공유 — 전체 탐색 시 나중에(문서 공유 우선)
const LOW_PRIORITY = new Set(['scan', '사진동영상', 'video']);

const MIME = {
  '.hwp': 'application/x-hwp',
  '.hwpx': 'application/hwp+zip',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function available() {
  try {
    return fs.existsSync(NAS_ROOT) && fs.readdirSync(NAS_ROOT).length > 0;
  } catch {
    return false;
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function mimeFor(name) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

// 하위 디렉터리 중 seg와 일치(정확 우선, 없으면 부분일치)하는 것을 반환.
function findChildDir(dir, seg) {
  const want = seg.toLowerCase();
  let partial = null;
  for (const e of safeReaddir(dir)) {
    if ((e.isSymbolicLink && e.isSymbolicLink()) || !e.isDirectory()) continue;
    const n = e.name.toLowerCase();
    if (n === want) return path.join(dir, e.name);
    if (!partial && (n.includes(want) || want.includes(n))) partial = path.join(dir, e.name);
  }
  return partial;
}

// 폴더 아래 파일들을 재귀로 나열(시간·개수 제한, 심볼릭 링크 skip).
function listFiles(root, share) {
  const start = Date.now();
  const out = [];
  let scanned = 0;
  const stack = [root];
  while (stack.length) {
    if (Date.now() - start > TIME_BUDGET_MS || scanned > MAX_SCAN) break;
    const dir = stack.pop();
    for (const e of safeReaddir(dir)) {
      scanned++;
      if (e.isSymbolicLink && e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        let st = null;
        try { st = fs.statSync(full); } catch {}
        out.push({ path: full, name: e.name, share, relPath: path.relative(NAS_ROOT, full), size: st ? st.size : 0, mtimeMs: st ? st.mtimeMs : 0 });
      }
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

// 파일 검색:
// - 경로형("0공지/1. 주간회의/0818/…", \ 또는 /)이면 첫 조각을 원본 공유로 매핑하고 폴더를 최대한
//   따라 내려간 뒤 그 폴더의 파일을 나열(정확한 파일명을 몰라도 됨).
// - 단순 키워드면 파일명·상대경로 부분일치로 전체(문서 공유 우선) 탐색.
function search(query) {
  const raw = String(query || '').trim();
  if (!raw) return { ok: false, error: 'empty_query' };
  if (!available()) return { ok: false, error: 'not_mounted' };

  const norm = raw.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  const segs = norm.split('/').filter(Boolean);

  if (segs.length > 1) {
    const alias = SHARE_ALIASES[segs[0]] || SHARE_ALIASES[segs[0].toLowerCase()];
    if (alias && fs.existsSync(path.join(NAS_ROOT, alias))) {
      let dir = path.join(NAS_ROOT, alias);
      let consumed = 0;
      for (let i = 1; i < segs.length; i++) {
        const child = findChildDir(dir, segs[i]);
        if (child) { dir = child; consumed++; } else break;
      }
      if (consumed >= 1) {
        const files = listFiles(dir, alias);
        return { ok: true, files: files.slice(0, MAX_RESULTS), truncated: files.length > MAX_RESULTS, scanned: files.length, folder: path.relative(NAS_ROOT, dir) };
      }
    }
  }

  const fileTerm = (segs.length ? segs[segs.length - 1] : norm).toLowerCase();
  const roots = safeReaddir(NAS_ROOT)
    .filter((e) => e.isDirectory())
    .map((e) => ({ dir: path.join(NAS_ROOT, e.name), share: e.name }))
    .sort((a, b) => (LOW_PRIORITY.has(a.share) ? 0 : 1) - (LOW_PRIORITY.has(b.share) ? 0 : 1));

  const start = Date.now();
  const results = [];
  let scanned = 0;
  let truncated = false;
  const stack = roots.slice();
  while (stack.length) {
    if (Date.now() - start > TIME_BUDGET_MS || scanned > MAX_SCAN) { truncated = true; break; }
    const { dir, share } = stack.pop();
    for (const ent of safeReaddir(dir)) {
      scanned++;
      if (ent.isSymbolicLink && ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { stack.push({ dir: full, share }); continue; }
      if (!ent.isFile()) continue;
      const rel = path.relative(NAS_ROOT, full).replace(/\\/g, '/').toLowerCase();
      if (ent.name.toLowerCase().includes(fileTerm) || rel.includes(fileTerm)) {
        let st = null;
        try { st = fs.statSync(full); } catch {}
        results.push({ path: full, name: ent.name, share, relPath: path.relative(NAS_ROOT, full), size: st ? st.size : 0, mtimeMs: st ? st.mtimeMs : 0 });
      }
    }
  }
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { ok: true, files: results.slice(0, MAX_RESULTS), truncated, scanned };
}

// 파일을 버퍼로 읽기 (NAS_ROOT 밖 경로 차단, 크기 제한). {ok, buffer, name, mime, size}
function readFile(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  if (resolved !== NAS_ROOT && !resolved.startsWith(NAS_ROOT + path.sep)) return { ok: false, error: 'out_of_scope' };
  let st;
  try { st = fs.statSync(resolved); } catch { return { ok: false, error: 'not_found' }; }
  if (!st.isFile()) return { ok: false, error: 'not_file' };
  if (st.size > MAX_COPY_BYTES) return { ok: false, error: 'too_large' };
  try {
    return { ok: true, buffer: fs.readFileSync(resolved), name: path.basename(resolved), mime: mimeFor(resolved), size: st.size };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'read_fail' };
  }
}

module.exports = { available, search, readFile, mimeFor, NAS_ROOT };
