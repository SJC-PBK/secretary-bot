// [구글 Tasks 연동] 서비스계정(도메인 위임)으로 각 사용자의 기본 할일목록(@default)을 CRUD.
// 완전 연동: 구글 Tasks가 원본. 슬랙/폰 어디서 바꿔도 같은 데이터.
const { google } = require('googleapis');
const fs = require('fs');

const KEY_PATH = process.env.SA_KEY || './service-account.json';
const LIST = '@default'; // 폰 기본 "내 할일" 목록

function configured() {
  return fs.existsSync(KEY_PATH);
}

function tasksFor(userEmail) {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/tasks'],
    subject: userEmail,
  });
  return google.tasks({ version: 'v1', auth });
}

function normalize(t) {
  return { id: t.id, text: t.title || '', due: t.due || null, position: t.position || '' };
}

// 미완료 할 일 목록(position 순). {ok, items} / {ok:false,error}
async function list(userEmail) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const svc = tasksFor(userEmail);
    const res = await svc.tasks.list({ tasklist: LIST, showCompleted: false, showHidden: false, maxResults: 100 });
    const items = (res.data.items || [])
      .filter((t) => t.status !== 'completed')
      .map(normalize)
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

function toDue(dueISO) {
  if (!dueISO) return undefined;
  const d = new Date(dueISO);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString(); // 구글 Tasks는 날짜만 사용(시간 무시)
}

// 목록 끝에 추가. {ok, item} / {ok:false,error}
async function add(userEmail, title, dueISO, previousId) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const svc = tasksFor(userEmail);
    const requestBody = { title: String(title || '').trim() };
    const due = toDue(dueISO);
    if (due) requestBody.due = due;
    // previousId 미지정 시 마지막 항목 뒤에 붙여 "끝에 추가"
    let prev = previousId;
    if (prev === undefined) {
      const cur = await list(userEmail);
      if (cur.ok && cur.items.length) prev = cur.items[cur.items.length - 1].id;
    }
    const res = await svc.tasks.insert({ tasklist: LIST, previous: prev || undefined, requestBody });
    return { ok: true, item: normalize(res.data) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

// 완료 처리(목록에서 사라짐). {ok} / {ok:false,error}
async function complete(userEmail, taskId) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const svc = tasksFor(userEmail);
    await svc.tasks.patch({ tasklist: LIST, task: taskId, requestBody: { status: 'completed' } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

// 문구 수정. {ok} / {ok:false,error}
async function patchTitle(userEmail, taskId, title) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const svc = tasksFor(userEmail);
    await svc.tasks.patch({ tasklist: LIST, task: taskId, requestBody: { title: String(title || '').trim() } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

// 순서 이동: taskId를 previousId 바로 뒤로(previousId=null이면 맨 위). {ok} / {ok:false,error}
async function move(userEmail, taskId, previousId) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const svc = tasksFor(userEmail);
    await svc.tasks.move({ tasklist: LIST, task: taskId, previous: previousId || undefined });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

module.exports = { configured, list, add, complete, patchTitle, move };
