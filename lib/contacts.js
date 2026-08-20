// [연락처] 명함에서 정리한 연락처를 vCard(.vcf)로 만들거나 구글 주소록(People API)에 저장.
const { google } = require('googleapis');
const fs = require('fs');

const KEY_PATH = process.env.SA_KEY || './service-account.json';

function configured() {
  return fs.existsSync(KEY_PATH);
}

function peopleFor(userEmail) {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/contacts'],
    subject: userEmail,
  });
  return google.people({ version: 'v1', auth });
}

// contact: {name,title,org,mobiles:[],phones:[],emails:[],address,memo}
function buildVcf(c) {
  const esc = (s) => String(s || '').replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push('FN:' + esc(c.name || ''));
  lines.push('N:' + esc(c.name || '') + ';;;;');
  if (c.org) lines.push('ORG:' + esc(c.org));
  if (c.title) lines.push('TITLE:' + esc(c.title));
  (c.mobiles || []).forEach((p) => lines.push('TEL;TYPE=CELL:' + esc(p)));
  (c.phones || []).forEach((p) => lines.push('TEL;TYPE=WORK,VOICE:' + esc(p)));
  (c.emails || []).forEach((e) => lines.push('EMAIL;TYPE=WORK:' + esc(e)));
  if (c.address) lines.push('ADR;TYPE=WORK:;;' + esc(c.address) + ';;;;');
  if (c.memo) lines.push('NOTE:' + esc(c.memo));
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

async function saveGoogle(userEmail, c) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  if (!userEmail) return { ok: false, error: 'no_email' };
  try {
    const people = peopleFor(userEmail);
    const body = { names: [{ givenName: c.name || '연락처' }] };
    if (c.org || c.title) body.organizations = [{ name: c.org || '', title: c.title || '' }];
    const phones = [
      ...(c.mobiles || []).map((v) => ({ value: v, type: 'mobile' })),
      ...(c.phones || []).map((v) => ({ value: v, type: 'work' })),
    ];
    if (phones.length) body.phoneNumbers = phones;
    if ((c.emails || []).length) body.emailAddresses = c.emails.map((v) => ({ value: v, type: 'work' }));
    if (c.address) body.addresses = [{ formattedValue: c.address, type: 'work' }];
    if (c.memo) body.biographies = [{ value: c.memo, contentType: 'TEXT_PLAIN' }];
    const res = await people.people.createContact({ requestBody: body });
    return { ok: true, resourceName: res.data.resourceName };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

module.exports = { configured, buildVcf, saveGoogle };
