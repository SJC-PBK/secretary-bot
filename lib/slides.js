// [슬라이드 생성] pptxgenjs로 pptx 버퍼 생성 → 드라이브 업로드 시 구글 슬라이드로 변환.
const pptxgen = require('pptxgenjs');

const FONT = process.env.SECBOT_DOC_FONT || '굴림체';

// spec: {name, slides:[{type?, title, subtitle?, bullets?}]}
//   bullets 항목 = 문자열 또는 {text, level(0~2)}
async function buildPptx(spec) {
  const slides = Array.isArray(spec && spec.slides) ? spec.slides : [];
  if (slides.length === 0) throw new Error('빈 슬라이드');

  const p = new pptxgen();
  p.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in (16:9)

  for (const sl of slides) {
    const s = p.addSlide();
    if (sl.type === 'title') {
      s.addText(String(sl.title || ''), { x: 0.6, y: 2.6, w: 12.1, h: 1.6, fontFace: FONT, fontSize: 40, bold: true, align: 'center', color: '1F3864' });
      if (sl.subtitle) {
        s.addText(String(sl.subtitle), { x: 0.6, y: 4.2, w: 12.1, h: 0.9, fontFace: FONT, fontSize: 20, align: 'center', color: '595959' });
      }
    } else {
      s.addText(String(sl.title || ''), { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontFace: FONT, fontSize: 28, bold: true, color: '1F3864' });
      const items = normalizeBullets(sl.bullets);
      if (items.length) {
        s.addText(items, { x: 0.8, y: 1.5, w: 11.7, h: 5.4, fontFace: FONT, color: '333333', valign: 'top', lineSpacingMultiple: 1.25 });
      }
    }
  }
  return await p.write({ outputType: 'nodebuffer' });
}

function normalizeBullets(bullets) {
  if (!Array.isArray(bullets)) return [];
  return bullets
    .map((b) => {
      const text = typeof b === 'string' ? b : String((b && b.text) || '');
      if (!text.trim()) return null;
      const level = typeof b === 'object' && b && Number(b.level) ? Math.min(2, Math.max(0, Number(b.level))) : 0;
      return { text, options: { bullet: true, indentLevel: level, fontSize: level > 0 ? 16 : 18, paraSpaceAfter: 6 } };
    })
    .filter(Boolean);
}

module.exports = { buildPptx };
