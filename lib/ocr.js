// [문서·이미지 → 텍스트] kordoc로 이미지 OCR + PDF/XLSX/DOCX 변환. 온프렘(PP-OCRv5 한국어).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KORDOC_BIN = process.env.KORDOC_BIN || path.join(__dirname, '..', 'node_modules', '.bin', 'kordoc');

// 버퍼를 임시파일로 저장 후 kordoc로 마크다운 변환. 실패 시 ''.
// extraArgs: 문서(PDF)는 스캔본 대비 --ocr(필요한 페이지만 OCR) 추가.
function runKordoc(buffer, name, defaultExt, timeoutMs, extraArgs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secbot-kordoc-'));
  const ext = path.extname(name || '') || defaultExt;
  const p = path.join(dir, 'f' + ext);
  try {
    fs.writeFileSync(p, buffer);
    const r = spawnSync(KORDOC_BIN, [p, '--format', 'markdown', '--silent', ...(extraArgs || [])], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    if (r.status !== 0) { console.error('kordoc 실패:', name, (r.stderr || '').slice(0, 200)); return ''; }
    return (r.stdout || '').trim();
  } catch (e) {
    console.error('kordoc 오류:', name, e && e.message);
    return '';
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// 이미지 버퍼 → OCR 텍스트(마크다운). 실패 시 ''.
function ocrBuffer(buffer, name) {
  return runKordoc(buffer, name, '.png', 120 * 1000);
}

// PDF/XLSX/DOCX 버퍼 → 텍스트(마크다운). 실패 시 ''. 스캔 PDF 대비 --ocr(필요 페이지만) 적용, 넉넉한 타임아웃.
function convertDoc(buffer, name) {
  return runKordoc(buffer, name, '.pdf', 300 * 1000, ['--ocr']);
}

function isImage(mimetype, filetype) {
  const mt = (mimetype || '').toLowerCase();
  const ft = (filetype || '').toLowerCase();
  return mt.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ft);
}

// kordoc가 텍스트로 변환할 수 있는 문서(hwp/hwpx는 별도 편집 경로에서 처리하므로 제외).
function isConvertibleDoc(mimetype, filetype) {
  const mt = (mimetype || '').toLowerCase();
  const ft = (filetype || '').toLowerCase();
  return mt === 'application/pdf' || ft === 'pdf'
    || /spreadsheetml|ms-excel/.test(mt) || ['xlsx', 'xls'].includes(ft)
    || /wordprocessingml|msword/.test(mt) || ['docx', 'doc'].includes(ft);
}

module.exports = { ocrBuffer, convertDoc, isImage, isConvertibleDoc };
