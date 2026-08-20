// [구글 설문지] 서비스계정(도메인 위임)으로 사용자 계정에 구글 폼 생성.
// 활성 조건: DWD에 forms.body scope + GCP에 Forms API 사용설정.
const { google } = require('googleapis');
const fs = require('fs');

const KEY_PATH = process.env.SA_KEY || './service-account.json';

function configured() {
  return fs.existsSync(KEY_PATH);
}

function formsFor(userEmail) {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/forms.body'],
    subject: userEmail,
  });
  return google.forms({ version: 'v1', auth });
}

// spec: {title, description, questions:[{title,type,options,required,low,high,lowLabel,highLabel}]}
// 반환 {ok, formId, editUrl, responderUri} / {ok:false,error}
async function createForm({ userEmail, title, description, questions }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  if (!userEmail) return { ok: false, error: 'no_email' };
  try {
    const forms = formsFor(userEmail);
    const created = await forms.forms.create({ requestBody: { info: { title: title || '설문지', documentTitle: title || '설문지' } } });
    const formId = created.data.formId;

    const requests = [];
    if (description) requests.push({ updateFormInfo: { info: { description }, updateMask: 'description' } });
    (questions || []).forEach((q, i) => {
      const question = { required: !!q.required };
      const t = String(q.type || 'TEXT').toUpperCase();
      if (t === 'PARAGRAPH') question.textQuestion = { paragraph: true };
      else if (['RADIO', 'CHECKBOX', 'DROP_DOWN'].includes(t)) question.choiceQuestion = { type: t, options: (q.options || []).map((o) => ({ value: String(o) })) };
      else if (t === 'SCALE') question.scaleQuestion = { low: q.low || 1, high: q.high || 5, lowLabel: q.lowLabel || '', highLabel: q.highLabel || '' };
      else question.textQuestion = { paragraph: false };
      requests.push({ createItem: { item: { title: q.title || `질문 ${i + 1}`, questionItem: { question } }, location: { index: i } } });
    });
    if (requests.length) await forms.forms.batchUpdate({ formId, requestBody: { requests } });

    let responderUri = '';
    try { const info = await forms.forms.get({ formId }); responderUri = info.data.responderUri || ''; } catch {}
    return { ok: true, formId, editUrl: `https://docs.google.com/forms/d/${formId}/edit`, responderUri };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

module.exports = { configured, createForm };
