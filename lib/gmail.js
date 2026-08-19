// [메일] 서비스계정으로 위임 메일함(SECBOT_MAIL_ACCOUNT)을 impersonate 해서 읽기/발송.
// 활성 조건: SA 키 + env SECBOT_MAIL_ACCOUNT + 도메인위임에 gmail.readonly·gmail.send 추가.
// 발송은 app 계층에서 "초안→확인" 2단계 후에만 호출된다.

const { google } = require('googleapis');
const fs = require('fs');

const KEY_PATH = process.env.SA_KEY || './service-account.json';

function account() {
  return process.env.SECBOT_MAIL_ACCOUNT || '';
}

function configured() {
  return fs.existsSync(KEY_PATH) && !!account();
}

function gmailFor() {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
    subject: account(),
  });
  return google.gmail({ version: 'v1', auth });
}

function header(payload, name) {
  const h = ((payload && payload.headers) || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  for (const p of payload.parts || []) {
    const t = extractBody(p);
    if (t) return t;
  }
  return '';
}

// 최근/검색 메일 목록. query 예: 'in:inbox', 'is:unread', 'from:홍길동'. {ok, messages:[{id,from,subject,date,snippet,unread}]}
async function listRecent({ query, max = 10 } = {}) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const g = gmailFor();
    const res = await g.users.messages.list({ userId: 'me', q: query || 'in:inbox', maxResults: Math.min(max || 10, 20) });
    const msgs = res.data.messages || [];
    const out = [];
    for (const m of msgs) {
      const d = await g.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
      out.push({
        id: m.id,
        from: header(d.data.payload, 'From'),
        subject: header(d.data.payload, 'Subject') || '(제목 없음)',
        date: header(d.data.payload, 'Date'),
        snippet: d.data.snippet || '',
        unread: (d.data.labelIds || []).includes('UNREAD'),
      });
    }
    return { ok: true, messages: out };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

// 메일 1건 본문. {ok, message:{id,from,to,subject,date,body,messageId}}
async function getMessage(id) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const g = gmailFor();
    const d = await g.users.messages.get({ userId: 'me', id, format: 'full' });
    const p = d.data.payload;
    return {
      ok: true,
      message: {
        id,
        from: header(p, 'From'),
        to: header(p, 'To'),
        subject: header(p, 'Subject') || '(제목 없음)',
        date: header(p, 'Date'),
        body: (extractBody(p) || d.data.snippet || '').slice(0, 20000),
        messageId: header(p, 'Message-Id'),
      },
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

function b64url(s) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 메일 발송 (위임 메일함 명의). {ok, id} / {ok:false,error}
async function sendMessage({ to, subject, body, inReplyTo, references }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  if (!to || !subject) return { ok: false, error: 'missing_fields' };
  try {
    const g = gmailFor();
    const headers = [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
    ];
    if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
    if (references) headers.push(`References: ${references}`);
    const raw = headers.join('\r\n') + '\r\n\r\n' + Buffer.from(body || '', 'utf8').toString('base64');
    const res = await g.users.messages.send({ userId: 'me', requestBody: { raw: b64url(raw) } });
    return { ok: true, id: res.data.id };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

module.exports = { configured, account, listRecent, getMessage, sendMessage };
