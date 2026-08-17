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

module.exports = { globalRules };
