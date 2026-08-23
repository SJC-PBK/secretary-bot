// [내 기억 문서] 사용자 본인 구글 드라이브에 폴더+문서를 만들어 페르소나·장기기억·최근 메모리를 보여준다.
// 서버 JSON이 원본(런타임 빠름). 문서에서 ①페르소나 ②장기기억을 고치면 "반영"으로 서버에 동기화한다.
const fs = require('fs');
const path = require('path');
const gdrive = require('./gdrive');
const profile = require('./profile');
const persona = require('./persona');
const memory = require('./memory');
const claude = require('./claude');

const MAP = path.join(process.env.DATA_DIR || './data', 'memdocs.json');
const MARK_P = '### 페르소나 (응대 지침)';
const MARK_F = '### 장기기억 (프로필 사실)';
const MARK_M = '### 최근 대화 메모리 (보기 전용)';
const PERSONA_PLACEHOLDER = '(아직 설정된 페르소나가 없어요. 원하는 응대 방식을 여기에 적어주세요.)';
const FACTS_PLACEHOLDER = '(아직 기억한 사실이 없어요)';

function loadMap() {
  try { const o = JSON.parse(fs.readFileSync(MAP, 'utf8')); return o && typeof o === 'object' ? o : {}; }
  catch { return {}; }
}
function saveMap(m) {
  fs.mkdirSync(process.env.DATA_DIR || './data', { recursive: true });
  fs.writeFileSync(MAP, JSON.stringify(m, null, 2), 'utf8');
}

// 서버 데이터로 문서 본문 텍스트를 구성
async function buildDocText(userId) {
  const p = persona.get(userId);
  const facts = profile.list(userId).map((f) => f.text);
  let summary = '';
  try { summary = await claude.summarizeMemory(memory.load(userId)); } catch {}
  if (!summary) {
    const ctx = (memory.load(userId) || []).slice(-12);
    summary = ctx.length
      ? ctx.map((m) => `- ${m.role === 'assistant' ? '비서' : '나'}: ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')
      : '- (최근 대화 없음)';
  }
  return [
    '📌 장 비서 — 내 기억 문서',
    '이 문서는 내 구글 드라이브에만 있어요(나만 열람 가능). ①②를 고친 뒤 슬랙에서 "내 기억 문서 반영해줘"라고 하면 서버에 저장됩니다.',
    '',
    MARK_P,
    '› 봇이 나를 대하는 말투·역할·선호를 자유롭게 적으세요. (예: 존댓말로, 결론부터 간결하게)',
    p || PERSONA_PLACEHOLDER,
    '',
    MARK_F,
    '› 한 줄에 하나씩, 앞에 "- "를 붙여 적으세요. 줄을 지우면 그 기억이 삭제됩니다.',
    ...(facts.length ? facts.map((f) => `- ${f}`) : [`- ${FACTS_PLACEHOLDER}`]),
    '',
    MARK_M,
    '› 이 구역 수정은 반영되지 않습니다(대화로 쌓이는 기록).',
    summary,
    '',
    '──────────',
    '명령: "내 기억 문서 갱신해줘"(서버→문서 새로고침) · "내 기억 문서 반영해줘"(문서→서버 저장)',
  ].join('\n');
}

// 문서(폴더 포함)를 보장. {ok, folderId, docId, link, created?}
async function ensureDoc(userId, email) {
  if (!email) return { ok: false, error: 'no_email' };
  const map = loadMap();
  const rec = map[userId];
  if (rec && rec.docId) {
    const ex = await gdrive.exists({ userEmail: email, fileId: rec.docId });
    if (ex.ok && ex.exists) return { ok: true, ...rec };
  }
  const folder = await gdrive.createFolder({ userEmail: email, name: '장 비서' });
  if (!folder.ok) return { ok: false, error: folder.error };
  const text = await buildDocText(userId);
  const doc = await gdrive.createDocText({ userEmail: email, name: '장 비서 — 내 기억', text, parents: [folder.id] });
  if (!doc.ok) return { ok: false, error: doc.error };
  const next = { folderId: folder.id, docId: doc.id, link: doc.link };
  map[userId] = next;
  saveMap(map);
  return { ok: true, ...next, created: true };
}

// 서버 → 문서 새로고침. {ok, link}
async function refresh(userId, email) {
  const e = await ensureDoc(userId, email);
  if (!e.ok) return e;
  if (e.created) return { ok: true, link: e.link, created: true };
  const text = await buildDocText(userId);
  const u = await gdrive.updateDocText({ userEmail: email, fileId: e.docId, text });
  return u.ok ? { ok: true, link: e.link } : { ok: false, error: u.error };
}

function sliceBetween(lines, startMark, endMark) {
  const s = lines.findIndex((l) => l.trim() === startMark);
  if (s === -1) return null;
  let e = lines.findIndex((l, i) => i > s && l.trim() === endMark);
  if (e === -1) e = lines.length;
  return lines.slice(s + 1, e);
}

// 문서 → 서버 반영. {ok, personaSet, factsCount} / {ok:false, error}
async function syncBack(userId, email) {
  const map = loadMap();
  const rec = map[userId];
  if (!rec || !rec.docId) return { ok: false, error: 'no_doc' };
  const ex = await gdrive.exportDocText({ userEmail: email, fileId: rec.docId });
  if (!ex.ok) return { ok: false, error: ex.error };
  const lines = String(ex.text || '').split(/\r?\n/);
  const pLines = sliceBetween(lines, MARK_P, MARK_F);
  const fLines = sliceBetween(lines, MARK_F, MARK_M);
  if (!pLines || !fLines) return { ok: false, error: 'markers' }; // 구분선이 지워짐

  let personaText = pLines
    .filter((l) => !l.trim().startsWith('›'))
    .join('\n')
    .trim();
  if (personaText.startsWith('(아직')) personaText = '';

  const facts = fLines
    .filter((l) => l.trim().startsWith('- '))
    .map((l) => l.trim().slice(2).trim())
    .filter((t) => t && !t.startsWith('(아직'));

  persona.set(userId, personaText);
  const factsCount = profile.replace(userId, facts);
  // 반영 후 문서를 재생성해 형식·삭제분 정규화
  try { await gdrive.updateDocText({ userEmail: email, fileId: rec.docId, text: await buildDocText(userId) }); } catch {}
  return { ok: true, personaSet: !!personaText, factsCount };
}

module.exports = { ensureDoc, refresh, syncBack, loadMap };
