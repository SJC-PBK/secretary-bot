// [문서 생성] kordoc CLI로 마크다운 → HWPX 공문서 생성 + 구조 검증(한컴독스 거부요인 사전차단)
// 대화두뇌(claude)는 사양(spec)만 만들고, 실제 파일 변환은 여기서 결정론적으로 처리한다(도구 미부여 유지).

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// kordoc 실행 파일: 봇 프로젝트에 설치된 로컬 바이너리 우선(버전 고정). 환경변수로 재정의 가능.
const KORDOC_BIN = process.env.KORDOC_BIN || path.join(__dirname, '..', 'node_modules', '.bin', 'kordoc');

const PRESETS = ['기안문', '시행문', '보고서', '계획서', '통지', '회의록', '개조식', '보도자료'];

// 기관 기본 서식(환경변수로 재정의 — 기관마다 다르게). 서울시장애인일자리센터 기본 = 굴림체 13pt.
const DEFAULT_FONT = process.env.SECBOT_DOC_FONT || '굴림체';
const DEFAULT_PT = Number(process.env.SECBOT_DOC_PT || 13);
const FONT_ROLES = ['body', 'heading', 'ref', 'table']; // 프리셋에 따라 kordoc이 해당되는 역할만 적용

// spec: {preset, filename, markdown, doc_head?, doc_foot?, approval?, body_pt?, org?, date?}
// 반환: {ok, path?, filename?, dir?, error?}
function generate(spec) {
  if (!spec || !spec.markdown || !String(spec.markdown).trim()) {
    return { ok: false, error: '문서 본문이 비어 있어요.' };
  }
  const preset = PRESETS.includes(spec.preset) ? spec.preset : '기안문';
  const base = sanitizeName(spec.filename || '문서');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secbot-doc-'));
  const mdPath = path.join(dir, 'input.md');
  const outPath = path.join(dir, base + '.hwpx');
  fs.writeFileSync(mdPath, String(spec.markdown), 'utf8');

  const args = ['generate', mdPath, '-o', outPath, '--preset', preset, '--silent'];
  // 기관 기본 서식: 글자 크기·글꼴(spec에 명시가 있으면 그것을 우선)
  const pt = spec.body_pt || DEFAULT_PT;
  if (pt) args.push('--pt', String(pt));
  const font = spec.font_name || DEFAULT_FONT;
  if (font) args.push('--fonts', FONT_ROLES.map((r) => r + '=' + font).join(','));
  if (spec.org) args.push('--org', String(spec.org));
  if (spec.date) args.push('--date', String(spec.date));
  if (Array.isArray(spec.approval) && spec.approval.length) {
    args.push('--approval', spec.approval.slice(0, 6).map(cleanVal).join(','));
  }
  const head = kvSpec(spec.doc_head, ['org', 'to', 'via', 'title']);
  if (head) args.push('--doc-head', head);
  const foot = kvSpec(spec.doc_foot, ['sender', 'drafter', 'reviewer', 'approver', 'docNum', 'phone', 'email', 'disclosure', 'receive']);
  if (foot) args.push('--doc-foot', foot);

  const gen = run(args);
  if (gen.code !== 0) {
    cleanup(dir);
    return { ok: false, error: 'kordoc 생성 실패: ' + (gen.err || gen.out || 'exit ' + gen.code) };
  }
  const val = run(['validate', outPath]);
  if (val.code !== 0) {
    cleanup(dir);
    return { ok: false, error: '생성물 구조 검증 실패: ' + (val.err || val.out || 'exit ' + val.code) };
  }
  return { ok: true, path: outPath, filename: base + '.hwpx', dir };
}

// {key:value} → "key=value,key=value" (kordoc --doc-head/--doc-foot 형식). 값의 콤마·개행은 정리.
function kvSpec(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  const parts = [];
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) parts.push(k + '=' + cleanVal(v));
  }
  return parts.join(',');
}

function cleanVal(v) {
  return String(v).replace(/[,\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeName(name) {
  return String(name)
    .replace(/\.(hwpx|hwp|docx?|xlsx?|pptx?)$/i, '')
    .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || '문서';
}

function run(args) {
  const r = spawnSync(KORDOC_BIN, args, { encoding: 'utf8', timeout: 90 * 1000, maxBuffer: 16 * 1024 * 1024 });
  return {
    code: r.status == null ? -1 : r.status,
    out: (r.stdout || '').trim(),
    err: (r.stderr || (r.error && r.error.message) || '').trim(),
  };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

module.exports = { generate, cleanup };
