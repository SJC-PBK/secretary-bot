// [전역 규칙 로더] 구글 문서(GLOBAL_RULES_DOC_ID)를 text/plain으로 내려받아 시스템 프롬프트용 전역 페르소나·규칙 제공(5분 캐시)

const { google } = require('googleapis');
const fs = require('fs');

const KEY_PATH = process.env.SA_KEY || './service-account.json';
const DOC_ID = process.env.GLOBAL_RULES_DOC_ID;
const TTL_MS = 300000; // 5분

const cache = { text: '', at: 0 };

async function globalRules() {
  if (!DOC_ID) return '';
  if (cache.at && Date.now() - cache.at < TTL_MS) return cache.text;
  try {
    const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
    const auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.files.export({ fileId: DOC_ID, mimeType: 'text/plain' });
    const text = String(res.data);
    cache.text = text;
    cache.at = Date.now();
    return text;
  } catch (e) {
    console.error('[rules] error', e && e.message);
    return cache.text || '';
  }
}

// [공문 규칙 정본] 팀 공용 저장소 claude-shared 의 내부공문작성/rules.md (서버 /srv/claude-shared, claudework 가 git pull 로 최신화)
// 못 읽으면 '' → 호출부가 코드 안의 예비 규칙(GONGMUN_STYLE·buildDocSpec ⑤)만 쓴다. 5분 캐시.
const GONGMUN_PATH = process.env.GONGMUN_RULES_PATH || '/srv/claude-shared/skills/내부공문작성/rules.md';
const gcache = { text: '', at: 0 };
function gongmunRules() {
  if (gcache.at && Date.now() - gcache.at < TTL_MS) return gcache.text;
  try { gcache.text = fs.readFileSync(GONGMUN_PATH, 'utf8'); } catch (e) { console.error('[rules] 공문 규칙 정본 읽기 실패:', e && e.message); }
  gcache.at = Date.now();
  return gcache.text;
}

module.exports = { globalRules, gongmunRules };
