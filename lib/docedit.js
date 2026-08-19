// [기존 문서 수정] 업로드된 hwp/hwpx를 kordoc으로 서식 보존 수정(patch)하거나 서식 빈칸 채우기(fill).
// 대화두뇌는 "무엇을 어떻게" 판단만 하고, 실제 변환은 여기서 결정론적으로 처리(도구 미부여 유지).

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KORDOC_BIN = process.env.KORDOC_BIN || path.join(__dirname, '..', 'node_modules', '.bin', 'kordoc');

function run(args) {
  const r = spawnSync(KORDOC_BIN, args, { encoding: 'utf8', timeout: 120 * 1000, maxBuffer: 32 * 1024 * 1024 });
  return {
    code: r.status == null ? -1 : r.status,
    out: (r.stdout || '').trim(),
    err: (r.stderr || (r.error && r.error.message) || '').trim(),
  };
}

// hwp/hwpx → 마크다운 문자열 (실패 시 null)
function parseToMarkdown(filePath) {
  const r = run([filePath, '--format', 'markdown', '--silent']);
  if (r.code !== 0 || !r.out) return null;
  return r.out;
}

// 편집된 마크다운을 원본에 서식 보존 반영. {ok, path, filename, dir, skipped, error}
function patch(originalPath, editedMarkdown, baseName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secbot-edit-'));
  const mdPath = path.join(dir, 'edited.md');
  const outPath = path.join(dir, sanitize(baseName) + '.hwpx');
  fs.writeFileSync(mdPath, String(editedMarkdown), 'utf8');
  const r = run(['patch', originalPath, mdPath, '-o', outPath, '--silent']);
  // exit 0=정상, 2=일부 편집 미적용(파일은 생성됨)
  if (r.code !== 0 && r.code !== 2) { cleanup(dir); return { ok: false, error: r.err || r.out || 'exit ' + r.code }; }
  if (!fs.existsSync(outPath)) { cleanup(dir); return { ok: false, error: '출력 파일 없음' }; }
  return { ok: true, path: outPath, filename: sanitize(baseName) + '.hwpx', dir, skipped: r.code === 2 };
}

// 서식 빈칸(누름틀) 목록을 dry-run으로 (원문 텍스트 반환 — 매핑은 대화두뇌가 함)
function listFormFields(filePath) {
  const r = run(['fill', filePath, '--dry-run', '--silent']);
  if (r.code !== 0) return '';
  return r.out;
}

// 서식 채우기. fields={라벨:값}. {ok, path, filename, dir, error}
function fill(filePath, fields, baseName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secbot-fill-'));
  const jsonPath = path.join(dir, 'fields.json');
  const outPath = path.join(dir, sanitize(baseName) + '.hwpx');
  fs.writeFileSync(jsonPath, JSON.stringify(fields || {}), 'utf8');
  const r = run(['fill', filePath, '-j', jsonPath, '-o', outPath, '--silent']);
  if (r.code !== 0) { cleanup(dir); return { ok: false, error: r.err || r.out || 'exit ' + r.code }; }
  if (!fs.existsSync(outPath)) { cleanup(dir); return { ok: false, error: '출력 파일 없음' }; }
  return { ok: true, path: outPath, filename: sanitize(baseName) + '.hwpx', dir };
}

function sanitize(name) {
  return String(name || '수정문서')
    .replace(/\.(hwpx?|docx?|xlsx?|pptx?)$/i, '')
    .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || '수정문서';
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

module.exports = { parseToMarkdown, patch, listFormFields, fill, cleanup };
