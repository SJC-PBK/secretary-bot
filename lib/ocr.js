// [이미지 OCR] kordoc 내장 OCR로 이미지(명함 등) → 텍스트. 온프렘(PP-OCRv5 한국어).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KORDOC_BIN = process.env.KORDOC_BIN || path.join(__dirname, '..', 'node_modules', '.bin', 'kordoc');

// 이미지 버퍼 → OCR 텍스트(마크다운). 실패 시 ''.
function ocrBuffer(buffer, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secbot-ocr-'));
  const ext = path.extname(name || '') || '.png';
  const p = path.join(dir, 'img' + ext);
  try {
    fs.writeFileSync(p, buffer);
    const r = spawnSync(KORDOC_BIN, [p, '--format', 'markdown', '--silent'], { encoding: 'utf8', timeout: 120 * 1000, maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) { console.error('OCR 실패:', name, (r.stderr || '').slice(0, 200)); return ''; }
    return (r.stdout || '').trim();
  } catch (e) {
    console.error('OCR 오류:', name, e && e.message);
    return '';
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function isImage(mimetype, filetype) {
  const mt = (mimetype || '').toLowerCase();
  const ft = (filetype || '').toLowerCase();
  return mt.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ft);
}

module.exports = { ocrBuffer, isImage };
