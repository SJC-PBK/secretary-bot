// [진입점] Slack Socket Mode 개인 비서 봇 — DM 의도 분기 + 리마인더 스케줄러
// 환경변수는 systemd EnvironmentFile 또는 export로 주입한다(dotenv 미사용).

const { App } = require('@slack/bolt');
const fs = require('fs');
const os = require('os');
const path = require('path');

const auth = require('./lib/auth');
const docgen = require('./lib/docgen');
const gdrive = require('./lib/gdrive');
const slides = require('./lib/slides');
const docedit = require('./lib/docedit');
const nas = require('./lib/nas');
const gmail = require('./lib/gmail');
const users = require('./lib/users');
const claude = require('./lib/claude');
const memory = require('./lib/memory');
const reminders = require('./lib/reminders');
const todos = require('./lib/todos');
const scheduler = require('./lib/scheduler');
const briefing = require('./lib/briefing');
const profile = require('./lib/profile');
const session = require('./lib/session');
const calendar = require('./lib/calendar');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// 현재 KST 시각을 ISO(+09:00) 문자열로 (표시·파싱 기준용)
function nowKstIso() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace('Z', '+09:00');
}

// ISO 시각을 "8월 18일 (화) 오후 2시" 형태의 한국어 표시로 (KST 고정)
function formatAt(atIso) {
  const d = new Date(new Date(atIso).getTime() + 9 * 60 * 60 * 1000); // KST 벽시계
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const miStr = mi === 0 ? '' : ` ${String(mi).padStart(2, '0')}분`;
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${wd}) ${ampm} ${h12}시${miStr}`;
}

// 캘린더 이벤트 한 줄 표시 (GAS 응답 필드가 유동적이라 여러 이름을 관용)
function formatEvent(ev) {
  const title = ev.title || ev.summary || '(제목 없음)';
  const start = ev.startISO || ev.start || ev.at;
  return start ? `${formatAt(start)} — ${title}` : title;
}

// 오늘 0시(KST)부터 N일 뒤까지의 ISO 범위 (다가오는 일정 조회·검색용)
function upcomingRange(days) {
  const from = new Date(Date.now() + 9 * 60 * 60 * 1000);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(from.getUTCDate() + days);
  return {
    fromISO: from.toISOString().replace('Z', '+09:00'),
    toISO: to.toISOString().replace('Z', '+09:00'),
  };
}

// 이벤트 시작이 KST 기준 오늘 또는 내일인가
function isTodayOrTomorrow(ev) {
  const s = ev.startISO || ev.start || ev.at;
  if (!s) return false;
  const key = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  const evK = new Date(new Date(s).getTime() + 9 * 60 * 60 * 1000);
  const nowK = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const tmrK = new Date(nowK);
  tmrK.setUTCDate(nowK.getUTCDate() + 1);
  return key(evK) === key(nowK) || key(evK) === key(tmrK);
}

// 바이트를 인코딩 자동 감지해 문자열로: UTF-8(BOM)·UTF-16·CP949(EUC-KR, 한국어 윈도우 기본) 대응.
function decodeSmart(buf) {
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf);
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf); // 유효한 UTF-8이면 그대로
  } catch (e) {
    try { return new TextDecoder('euc-kr').decode(buf); } catch (e2) { return buf.toString('utf8'); }
  }
}

// 첨부된 텍스트 파일(회의 전사본 등) 내용을 읽어 하나의 문자열로. 텍스트류만, 크기 제한.
async function readSharedTextFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return '';
  const token = process.env.SLACK_BOT_TOKEN;
  const MAX_CHARS = 200000;
  const parts = [];
  for (const f of files) {
    const mt = (f.mimetype || '').toLowerCase();
    const ft = (f.filetype || '').toLowerCase();
    const isText = mt.startsWith('text/') || ['txt', 'text', 'markdown', 'md', 'csv', 'log', 'json'].includes(ft);
    if (!isText) continue;
    const url = f.url_private_download || f.url_private;
    if (!url) continue;
    try {
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) { console.error('첨부 다운로드 실패:', f.name, res.status); continue; }
      let txt = decodeSmart(Buffer.from(await res.arrayBuffer()));
      if (txt.length > MAX_CHARS) txt = txt.slice(0, MAX_CHARS) + '\n…(이하 생략)';
      parts.push(`# ${f.name}\n${txt}`);
    } catch (e) { console.error('첨부 읽기 오류:', f && f.name, e && e.message); }
  }
  return parts.join('\n\n');
}

// 첨부 파일 중 편집 가능한 한글 문서(hwp/hwpx) 하나를 찾는다.
function findEditableDoc(files) {
  if (!Array.isArray(files)) return null;
  return files.find((f) => {
    const ft = (f.filetype || '').toLowerCase();
    const nm = (f.name || '').toLowerCase();
    return ft === 'hwp' || ft === 'hwpx' || /\.(hwp|hwpx)$/.test(nm);
  }) || null;
}

// 첨부 바이너리 파일을 임시 경로로 내려받는다. {path, dir, name} 또는 null.
async function downloadBinaryFile(f) {
  const token = process.env.SLACK_BOT_TOKEN;
  const url = f.url_private_download || f.url_private;
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secbot-in-'));
    const p = path.join(dir, (f.name || 'input.hwpx').replace(/[\\/]/g, '_'));
    fs.writeFileSync(p, buf);
    return { path: p, dir, name: f.name || 'input.hwpx' };
  } catch (e) {
    console.error('바이너리 첨부 다운로드 오류:', e && e.message);
    return null;
  }
}

app.message(async ({ message, client }) => {
  // DM(im)만 처리. 봇 자신·수정 이벤트는 무시하되, 파일 첨부(file_share)는 처리한다.
  if (message.channel_type !== 'im') return;
  if (message.subtype && message.subtype !== 'file_share') return;

  const ADMIN = process.env.SECBOT_ADMIN_SLACK_ID || process.env.ALLOWED_SLACK_USER_ID;

  // 미등록자 → 승인 요청 접수
  if (!users.isAllowed(message.user)) {
    try {
      let email = '', name = message.user;
      try {
        const info = await client.users.info({ user: message.user });
        email = (info.user && info.user.profile && info.user.profile.email) || '';
        name = (info.user && (info.user.real_name || info.user.name)) || message.user;
      } catch (e) { console.error('users.info 실패(권한 필요?):', e && e.message); }
      users.addPending(message.user, { email, name });
      await client.chat.postMessage({ channel: message.user, text: '사용 승인 대기 중입니다. 관리자 승인 후 이용하실 수 있어요.' });
      if (ADMIN) {
        await client.chat.postMessage({ channel: ADMIN, text: `🔔 비서봇 사용 요청: ${name}${email ? ' (' + email + ')' : ''}\n승인하려면: 승인 ${message.user}` });
      }
    } catch (e) { console.error('온보딩 오류:', e && e.message); }
    return;
  }

  // 관리자 명령 (관리자에 한함). 위험 동작(승인/해제)은 U-ID 동반 필수,
  // 목록 조회(읽기 전용)는 자연어 허용하되 메시지 전체가 그 명령일 때만 발동(긴 요청은 대화로).
  if (message.user === ADMIN) {
    const t = (message.text || '').trim();
    const approveM = t.match(/(?:^|\s)승인\s+(U[A-Z0-9]{6,})(?:\s|$)/);
    const removeM = t.match(/(?:^|\s)(?:해제|삭제|제거)\s+(U[A-Z0-9]{6,})(?:\s|$)/);
    // 공백 제거 + 뒤쪽 조사/맺음말 제거 후 표준형과 비교
    const core = t.replace(/\s+/g, '').replace(/(?:알려줘|알려|보여줘|보여|해줘|해주세요|주세요|봐줘|봐|확인해줘|확인|리스트|좀|을|를|은|는|줘|요|해)+$/, '');
    const USERLIST = ['사용자목록', '사용자명단', '사용자리스트', '등록사용자', '등록된사용자', '등록사용자목록', '등록된사용자목록', '유저목록', '회원목록', '가입자목록', '전체사용자', '사용자현황'];
    const PENDLIST = ['승인목록', '승인대기', '승인대기목록', '대기목록', '대기자목록', '승인요청', '승인요청목록'];

    if (approveM) {
      const target = approveM[1];
      const p = users.pendingList();
      if (!p[target]) { await client.chat.postMessage({ channel: message.user, text: '그 요청을 찾지 못했어요. ("승인 목록"으로 확인)' }); return; }
      users.register(target, p[target].email || '');
      users.removePending(target);
      await client.chat.postMessage({ channel: message.user, text: `승인 완료: ${p[target].name || target} (${p[target].email || '이메일 없음'})` });
      try { await client.chat.postMessage({ channel: target, text: '사용 승인되었습니다! 이제 저에게 편하게 말 걸어보세요 🙂' }); } catch {}
      return;
    }
    if (removeM) {
      const target = removeM[1];
      if (target === ADMIN) { await client.chat.postMessage({ channel: message.user, text: '관리자 본인은 해제할 수 없어요.' }); return; }
      const ok = users.remove(target);
      users.removePending(target);
      await client.chat.postMessage({ channel: message.user, text: ok ? `해제 완료: ${target} — 이제 이 사용자는 봇을 쓸 수 없어요(데이터는 서버에 남음).` : '그 사용자를 못 찾았어요. ("사용자 목록"으로 확인)' });
      if (ok) { try { await client.chat.postMessage({ channel: target, text: '비서봇 사용이 해제되었습니다. 문의는 관리자에게 해주세요.' }); } catch {} }
      return;
    }
    if (PENDLIST.includes(core)) {
      const p = users.pendingList(); const ids = Object.keys(p);
      await client.chat.postMessage({ channel: message.user, text: ids.length ? ids.map((id) => `- ${p[id].name || id} ${p[id].email || ''} → 승인 ${id}`).join('\n') : '대기 중인 요청이 없어요.' });
      return;
    }
    if (USERLIST.includes(core)) {
      const reg = users.load(); const ids = Object.keys(reg);
      await client.chat.postMessage({ channel: message.user, text: ids.length ? '등록된 사용자:\n' + ids.map((id) => `- ${reg[id].email || '(이메일 없음)'} (${id})${id === ADMIN ? ' [관리자]' : ''} → 해제 ${id}`).join('\n') : '등록된 사용자가 없어요.' });
      return;
    }
  }

  const user = message.user;
  const email = users.emailFor(user);
  const rawText = (message.text || '').trim();
  const useOpus = /(^|\s)-o(?=\s|$)/i.test(rawText); // 메시지에 -o 있으면 이 답변만 Opus
  const text = rawText.replace(/(^|\s)-o(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
  const reply = (t) => client.chat.postMessage({ channel: message.channel, thread_ts: message.ts, text: t });

  // 진행 표시: 지시 메시지의 스레드에 상태 메시지 하나를 두고 단계별로 갱신, 작업이 끝나면 삭제한다.
  let statusTs = null;
  let statusCh = null;
  const setStatus = async (t) => {
    try {
      if (!statusTs) {
        const r = await client.chat.postMessage({ channel: message.channel, thread_ts: message.ts, text: t });
        statusTs = r.ts; statusCh = r.channel;
      } else {
        await client.chat.update({ channel: statusCh, ts: statusTs, text: t });
      }
    } catch (e) { /* 상태표시 실패는 본작업에 영향 없음 */ }
  };
  const clearStatus = async () => {
    try { if (statusTs) await client.chat.delete({ channel: statusCh, ts: statusTs }); } catch (e) {}
    statusTs = null;
  };

  let attachedText = await readSharedTextFiles(message.files); // 첨부된 텍스트 파일(전사본 등) 내용
  const editableDoc = findEditableDoc(message.files); // 첨부된 hwp/hwpx (수정 대상)

  // 슬랙 스레드로 hwpx 파일 전송(수정·채우기 결과 회신)
  const uploadHwpx = async (res, comment) => {
    await client.files.uploadV2({
      channel_id: message.channel,
      thread_ts: message.ts,
      file: fs.createReadStream(res.path),
      filename: res.filename,
      title: res.filename,
      initial_comment: `${comment}: ${res.filename}\n※ 자동 처리 결과이니 내용을 확인해 주세요.`,
    });
  };

  try {
    const facts = profile.facts(user);
    const ctx = memory.load(user);
    const nowIso = nowKstIso();

    const handleIntent = async (intent) => {
    const data = intent.data || {};

    switch (intent.type) {
      case 'reminder_create': {
        if (data.at) {
          reminders.add({ userId: user, at: data.at, message: data.message || '' });
          await reply(`${formatAt(data.at)}에 알려드릴게요.`);
        } else {
          await reply('언제 알려드릴까요? 시각을 알려주세요.');
        }
        return;
      }

      case 'reminder_list': {
        const items = reminders.list(user);
        if (items.length === 0) {
          await reply('등록된 리마인더가 없어요.');
          return;
        }
        await reply(items.map((r, i) => `${i + 1}. ${formatAt(r.at)} — ${r.message}`).join('\n'));
        return;
      }

      case 'reminder_cancel': {
        const items = reminders.list(user);
        if (items.length === 0) {
          await reply('취소할 리마인더가 없어요.');
          return;
        }
        if (!data.number) {
          await reply('몇 번 리마인더를 취소할까요? 번호를 알려주세요.');
          return;
        }
        const target = items[data.number - 1];
        if (!target) {
          await reply('그 번호의 리마인더가 없어요.');
          return;
        }
        const ok = reminders.cancel(user, target.id);
        await reply(ok ? '취소했어요.' : '취소하지 못했어요.');
        return;
      }

      case 'briefing': {
        const text = await briefing.buildForUser({ userId: user, email, greeting: false });
        await reply(text);
        return;
      }

      case 'todo_add': {
        if (!data.text) { await reply('어떤 일을 목록에 넣을까요?'); return; }
        const item = todos.add(user, data.text, data.due || null);
        const count = todos.list(user).length;
        const dl = todos.dueLabel(item.due);
        await reply(`할 일에 추가했어요 (${count}개): ${item.text}${dl ? ` — ${dl}` : ''}`);
        return;
      }

      case 'todo_list': {
        const items = todos.list(user);
        if (items.length === 0) { await reply('할 일 목록이 비어 있어요.'); return; }
        await reply('할 일 목록:\n' + items.map((t, i) => { const dl = todos.dueLabel(t.due); return `${i + 1}. ${t.text}${dl ? ` (${dl})` : ''}`; }).join('\n'));
        return;
      }

      case 'action_items_extract': {
        const source = attachedText ? (text + '\n\n[첨부 내용]\n' + attachedText) : text;
        await setStatus('📝 회의 내용에서 할 일을 뽑고 있어요…');
        const items = await claude.extractActionItems(source, nowIso);
        if (!items || items.length === 0) { await reply('회의 내용에서 뽑아낼 할 일을 찾지 못했어요.'); return; }
        const added = items.map((it) => todos.add(user, it.owner ? `[${it.owner}] ${it.text}` : it.text, it.due || null));
        const lines = added.map((t, i) => { const dl = todos.dueLabel(t.due); return `  ${i + 1}. ${t.text}${dl ? ` (${dl})` : ''}`; });
        await reply(`회의에서 할 일 ${added.length}건을 목록에 추가했어요:\n${lines.join('\n')}`);
        memory.append(user, 'user', text);
        memory.append(user, 'assistant', `[회의 실행항목 ${added.length}건 등록]`);
        return;
      }

      case 'todo_done': {
        const items = todos.list(user);
        if (items.length === 0) { await reply('완료할 할 일이 없어요.'); return; }
        if (!data.number) { await reply('몇 번을 완료할까요? 번호를 알려주세요.'); return; }
        const target = items[data.number - 1];
        if (!target) { await reply('그 번호의 할 일이 없어요.'); return; }
        const done = todos.complete(user, target.id);
        await reply(done ? `완료했어요: ${target.text}` : '완료하지 못했어요.');
        return;
      }

      case 'calendar_create': {
        if (!calendar.configured()) {
          await reply('캘린더 연동이 아직 설정 전이에요(관리자 설정 필요).');
          return;
        }
        if (!email) {
          await reply('캘린더 이메일이 등록되지 않았어요(관리자에게 문의).');
          return;
        }
        if (!data.title || !data.startISO) {
          await reply('일정 제목과 시각을 알려주세요.');
          return;
        }
        const calendarId = data.shared ? process.env.SECBOT_SHARED_CALENDAR_ID : undefined;
        if (data.shared && !calendarId) { await reply('센터 공유 캘린더가 설정되지 않았어요(관리자 설정 필요).'); return; }
        const res = await calendar.createEvent({ userEmail: email, title: data.title, startISO: data.startISO, endISO: data.endISO, calendarId });
        if (res && res.ok) {
          const link = res.event && res.event.htmlLink ? '\n' + res.event.htmlLink : '';
          await reply(`${data.shared ? '센터 공유 캘린더' : '캘린더'}에 등록했어요: ${data.title} (${formatAt(data.startISO)})${link}`);
        } else {
          await reply(`캘린더 등록에 실패했어요: ${(res && res.error) || '알 수 없는 오류'}`);
        }
        return;
      }

      case 'calendar_list': {
        if (!calendar.configured()) {
          await reply('캘린더 연동이 아직 설정 전이에요(관리자 설정 필요).');
          return;
        }
        if (!email) {
          await reply('캘린더 이메일이 등록되지 않았어요(관리자에게 문의).');
          return;
        }
        const calendarId = data.shared ? process.env.SECBOT_SHARED_CALENDAR_ID : undefined;
        if (data.shared && !calendarId) { await reply('센터 공유 캘린더가 설정되지 않았어요(관리자 설정 필요).'); return; }
        const explicit = data.fromISO && data.toISO;
        const range = explicit ? { fromISO: data.fromISO, toISO: data.toISO } : upcomingRange(90);
        const res = await calendar.listEvents({ userEmail: email, ...range, calendarId });
        if (!res || !res.ok) {
          await reply(`일정을 불러오지 못했어요: ${(res && res.error) || '알 수 없는 오류'}`);
          return;
        }
        const events = res.events || [];
        if (events.length === 0) {
          await reply(explicit ? '해당 기간에 일정이 없어요.' : (data.shared ? '센터 공유 캘린더에 다가오는 일정이 없어요.' : '다가오는 일정이 없어요.'));
          return;
        }
        events.forEach((e) => { e.__calId = calendarId; }); // 삭제·수정 시 어느 캘린더인지 기억
        session.setLast(user, 'calendar', events);
        const lines = events.map((ev, i) => `${i + 1}. ${formatEvent(ev)}`).join('\n');
        if (!explicit && !isTodayOrTomorrow(events[0])) {
          await reply(`오늘·내일은 일정이 없어요. 가장 가까운 일정은 ${formatEvent(events[0])} 입니다.\n\n다가오는 일정:\n${lines}`);
        } else {
          await reply(lines);
        }
        return;
      }

      case 'calendar_delete': {
        if (!calendar.configured()) {
          await reply('캘린더 연동이 아직 설정 전이에요(관리자 설정 필요).');
          return;
        }
        if (!email) {
          await reply('캘린더 이메일이 등록되지 않았어요(관리자에게 문의).');
          return;
        }
        const last = session.getLast(user);
        if (data.number && last && last.kind === 'calendar' && last.items[data.number - 1]) {
          const target = last.items[data.number - 1];
          const res = await calendar.deleteEvent({ userEmail: email, eventId: target.id, calendarId: target.__calId });
          if (res && res.ok) await reply(`삭제했어요: ${formatEvent(target)}`);
          else await reply(`삭제에 실패했어요: ${(res && res.error) || '알 수 없는 오류'}`);
          return;
        }
        if (data.query) {
          const calId = data.shared ? process.env.SECBOT_SHARED_CALENDAR_ID : undefined;
          if (data.shared && !calId) { await reply('센터 공유 캘린더가 설정되지 않았어요(관리자 설정 필요).'); return; }
          const res = await calendar.listEvents({ userEmail: email, ...upcomingRange(90), calendarId: calId });
          const events = (res && res.ok && res.events) || [];
          const matched = events.filter((ev) => (ev.title || ev.summary || '').includes(data.query));
          if (matched.length === 1) {
            const del = await calendar.deleteEvent({ userEmail: email, eventId: matched[0].id, calendarId: calId });
            if (del && del.ok) await reply(`삭제했어요: ${formatEvent(matched[0])}`);
            else await reply(`삭제에 실패했어요: ${(del && del.error) || '알 수 없는 오류'}`);
            return;
          }
          if (matched.length > 1) {
            matched.forEach((e) => { e.__calId = calId; });
            session.setLast(user, 'calendar', matched);
            await reply(matched.map((ev, i) => `${i + 1}. ${formatEvent(ev)}`).join('\n') + '\n몇 번을 지울까요?');
            return;
          }
          await reply('그런 일정을 찾지 못했어요.');
          return;
        }
        await reply("먼저 '내 일정'으로 목록을 보고 번호로 말씀해 주세요.");
        return;
      }

      case 'calendar_update': {
        if (!calendar.configured()) {
          await reply('캘린더 연동이 아직 설정 전이에요(관리자 설정 필요).');
          return;
        }
        if (!email) {
          await reply('캘린더 이메일이 등록되지 않았어요(관리자에게 문의).');
          return;
        }
        const changes = data.changes || {};
        const last = session.getLast(user);
        let target = null;
        if (data.number && last && last.kind === 'calendar' && last.items[data.number - 1]) {
          target = last.items[data.number - 1];
        } else if (data.query) {
          const calId = data.shared ? process.env.SECBOT_SHARED_CALENDAR_ID : undefined;
          if (data.shared && !calId) { await reply('센터 공유 캘린더가 설정되지 않았어요(관리자 설정 필요).'); return; }
          const res = await calendar.listEvents({ userEmail: email, ...upcomingRange(90), calendarId: calId });
          const events = (res && res.ok && res.events) || [];
          const matched = events.filter((ev) => (ev.title || ev.summary || '').includes(data.query));
          if (matched.length === 1) {
            target = matched[0];
            target.__calId = calId;
          } else if (matched.length > 1) {
            matched.forEach((e) => { e.__calId = calId; });
            session.setLast(user, 'calendar', matched);
            await reply(matched.map((ev, i) => `${i + 1}. ${formatEvent(ev)}`).join('\n') + '\n몇 번을 수정할까요?');
            return;
          }
        }
        if (!target) {
          await reply("먼저 '내 일정'으로 목록을 보고 번호로 말씀해 주세요.");
          return;
        }
        const res = await calendar.updateEvent({
          userEmail: email,
          eventId: target.id,
          title: changes.title,
          startISO: changes.startISO,
          endISO: changes.endISO,
          calendarId: target.__calId,
        });
        if (res && res.ok) await reply('일정을 수정했어요.');
        else await reply(`수정에 실패했어요: ${(res && res.error) || '알 수 없는 오류'}`);
        return;
      }

      case 'mail_check':
      case 'mail_read':
      case 'mail_write':
      case 'mail_send': {
        // 위임 메일함은 관리자만, 설정(메일함·권한) 있어야 동작
        if (user !== ADMIN) { await reply('메일 기능은 관리자만 사용할 수 있어요.'); return; }
        if (!gmail.configured()) { await reply('메일 기능이 아직 설정 전이에요(관리자: 메일함 주소 + Gmail 권한 설정 필요).'); return; }

        if (intent.type === 'mail_check') {
          await setStatus('📬 메일함을 확인하고 있어요…');
          const res = await gmail.listRecent({ query: data.query || 'in:inbox', max: 10 });
          if (!res.ok) { console.error('메일 조회 실패:', res.error); await reply('메일을 불러오지 못했어요.'); return; }
          const msgs = res.messages || [];
          if (msgs.length === 0) { await reply('해당 조건의 메일이 없어요.'); return; }
          session.setLast(user, 'mail', msgs);
          const lines = msgs.map((m, i) => `${i + 1}. ${m.unread ? '🔵 ' : ''}${m.subject}\n    — ${m.from}`).join('\n');
          await reply(`메일함 (${gmail.account()}) 최근 ${msgs.length}건:\n${lines}\n\n"N번 읽어줘"로 본문을 볼 수 있어요.`);
          return;
        }

        if (intent.type === 'mail_read') {
          const last = session.getLast(user);
          const item = data.number && last && last.kind === 'mail' ? last.items[data.number - 1] : null;
          if (!item) { await reply('먼저 "메일 확인해줘"로 목록을 본 뒤 번호를 말해주세요.'); return; }
          await setStatus('📖 메일을 읽고 있어요…');
          const res = await gmail.getMessage(item.id);
          if (!res.ok) { await reply('메일을 읽지 못했어요.'); return; }
          const m = res.message;
          await reply(`✉️ ${m.subject}\n보낸사람: ${m.from}\n날짜: ${m.date}\n\n${m.body.slice(0, 3500)}`);
          return;
        }

        if (intent.type === 'mail_write') {
          await setStatus('✍️ 메일 초안을 작성하고 있어요…');
          let orig = null;
          if (data.number) {
            const last = session.getLast(user);
            const item = last && last.kind === 'mail' ? last.items[data.number - 1] : null;
            if (item) { const r = await gmail.getMessage(item.id); if (r.ok) orig = r.message; }
          }
          const contextText = orig ? `[답장 대상 메일]\nFrom: ${orig.from}\nSubject: ${orig.subject}\n\n${orig.body}` : '';
          const draft = await claude.buildEmail(data.instruction || text, { to: data.to, contextText }, facts, useOpus);
          if (!draft) { await reply('메일 초안을 만들지 못했어요. 누구에게, 무슨 내용인지 조금 더 알려주세요.'); return; }
          const to = draft.to || data.to || (orig && orig.from) || '';
          session.setLast(user, 'mail_pending', [{ to, subject: draft.subject || '(제목 없음)', body: draft.body, inReplyTo: orig ? orig.messageId : undefined, references: orig ? orig.messageId : undefined }]);
          await reply(`✉️ 메일 초안입니다 (아직 발송 안 함)\n받는사람: ${to || '[미정 — 누구에게 보낼지 알려주세요]'}\n제목: ${draft.subject || ''}\n\n${draft.body}\n\n보내려면 "메일 보내기 확인", 고칠 게 있으면 어떻게 바꿀지 말씀해 주세요.`);
          return;
        }

        // mail_send: 직전 초안을 실제 발송
        const last = session.getLast(user);
        const d = last && last.kind === 'mail_pending' ? last.items[0] : null;
        if (!d) { await reply('보낼 메일 초안이 없어요. 먼저 메일을 작성해 주세요.'); return; }
        if (!d.to) { await reply('받는사람이 정해지지 않았어요. "○○에게 보내줘"처럼 알려주세요.'); return; }
        await setStatus('📨 메일을 보내고 있어요…');
        const sent = await gmail.sendMessage(d);
        if (!sent.ok) { console.error('메일 발송 실패:', sent.error); await reply('메일 발송에 실패했어요. 잠시 후 다시 시도해 주세요.'); return; }
        session.setLast(user, 'mail_pending', []); // 초안 소진
        await reply(`✅ 메일을 보냈어요: ${d.to} — ${d.subject}`);
        memory.append(user, 'user', text);
        memory.append(user, 'assistant', `[메일 발송: ${d.to} / ${d.subject}]`);
        return;
      }

      case 'memory_remember': {
        if (!data.fact) {
          await reply('무엇을 기억할까요?');
          return;
        }
        const added = profile.add(user, data.fact, 'explicit');
        await reply(added ? `기억할게요: ${data.fact}` : '이미 기억하고 있어요.');
        return;
      }

      case 'memory_show': {
        const items = profile.list(user);
        if (items.length === 0) {
          await reply('아직 기억한 게 없어요.');
          return;
        }
        await reply(items.map((f, i) => `${i + 1}. ${f.text}`).join('\n'));
        return;
      }

      case 'memory_forget': {
        const items = profile.list(user);
        if (!data.number) {
          await reply('몇 번을 잊을까요? 번호를 알려주세요.');
          return;
        }
        const target = items[data.number - 1];
        if (!target) {
          await reply('그 번호의 기억이 없어요.');
          return;
        }
        const ok = profile.forget(user, target.id);
        await reply(ok ? '잊었어요.' : '잊지 못했어요.');
        return;
      }

      case 'document_create': {
        const instruction = attachedText ? (text + '\n\n[첨부 파일 내용]\n' + attachedText) : text; // 첨부 텍스트가 있으면 함께 전달
        await setStatus('📝 문서 내용을 구성하고 있어요…');
        const spec = await claude.buildDocSpec(instruction, ctx, facts, useOpus);
        if (!spec) {
          await reply('문서 사양을 만들지 못했어요. 어떤 문서를(공문/보고서 등), 무슨 내용으로 만들지 조금 더 구체적으로 알려주세요.');
          return;
        }
        await setStatus('📄 한글 파일을 생성·검증하고 있어요…');
        const res = docgen.generate(spec);
        if (!res.ok) {
          console.error('문서 생성 실패:', res.error);
          await reply('문서 생성에 실패했어요. 잠시 후 다시 시도해 주세요.');
          return;
        }
        await setStatus('📎 파일을 올리고 있어요…');
        try {
          await client.files.uploadV2({
            channel_id: message.channel,
            thread_ts: message.ts,
            file: fs.createReadStream(res.path),
            filename: res.filename,
            title: res.filename,
            initial_comment: `요청하신 문서예요: ${res.filename}\n※ 자동 생성 초안이니 발송 전 내용을 확인해 주세요.`,
          });
          memory.append(user, 'user', text);
          memory.append(user, 'assistant', `[문서 생성: ${res.filename}]`);
        } catch (e) {
          console.error('파일 업로드 오류:', e && e.message);
          await reply('문서는 만들었는데 전송에 실패했어요. 잠시 후 다시 시도해 주세요.');
        } finally {
          docgen.cleanup(res.dir);
        }
        return;
      }

      case 'gdoc_create':
      case 'gsheet_create': {
        if (!gdrive.configured()) {
          await reply('구글 드라이브 연동이 아직 설정 전이에요(관리자 설정 필요).');
          return;
        }
        if (!email) {
          await reply('드라이브 저장용 이메일이 등록되지 않았어요(관리자에게 문의).');
          return;
        }
        const kind = intent.type === 'gsheet_create' ? 'sheet' : 'doc';
        const instruction = attachedText ? (text + '\n\n[첨부 파일 내용]\n' + attachedText) : text; // 첨부 텍스트가 있으면 함께 전달
        await setStatus(kind === 'sheet' ? '📊 시트 데이터를 구성하고 있어요…' : '📄 문서 내용을 구성하고 있어요…');
        const spec = await claude.buildDriveDoc(kind, instruction, ctx, facts, useOpus);
        if (!spec) {
          await reply('문서 사양을 만들지 못했어요. 무슨 내용으로 만들지 조금 더 구체적으로 알려주세요.');
          return;
        }
        await setStatus('☁️ 구글 드라이브에 저장하고 있어요…');
        const res = kind === 'sheet'
          ? await gdrive.createSheet({ userEmail: email, name: spec.name, rows: spec.rows })
          : await gdrive.createDoc({ userEmail: email, name: spec.name, html: spec.html });
        if (!res.ok) {
          console.error('드라이브 생성 실패:', res.error);
          await reply('드라이브 저장에 실패했어요. 잠시 후 다시 시도해 주세요.');
          return;
        }
        await reply(`✅ 만들었어요: ${res.name}\n${res.link}`);
        memory.append(user, 'user', text);
        memory.append(user, 'assistant', `[${kind === 'sheet' ? '구글시트' : '구글문서'} 생성: ${res.name}] ${res.link}`);
        return;
      }

      case 'gslide_create': {
        if (!gdrive.configured()) {
          await reply('구글 드라이브 연동이 아직 설정 전이에요(관리자 설정 필요).');
          return;
        }
        if (!email) {
          await reply('드라이브 저장용 이메일이 등록되지 않았어요(관리자에게 문의).');
          return;
        }
        const instruction = attachedText ? (text + '\n\n[첨부 파일 내용]\n' + attachedText) : text;
        await setStatus('🖼️ 슬라이드 구성을 짜고 있어요…');
        const spec = await claude.buildSlides(instruction, ctx, facts, useOpus);
        if (!spec) {
          await reply('슬라이드 사양을 만들지 못했어요. 무슨 내용으로 만들지 조금 더 구체적으로 알려주세요.');
          return;
        }
        await setStatus('🖼️ 슬라이드를 만들어 드라이브에 저장하고 있어요…');
        let buffer;
        try {
          buffer = await slides.buildPptx(spec);
        } catch (e) {
          console.error('슬라이드 생성 실패:', e && e.message);
          await reply('슬라이드 생성에 실패했어요. 잠시 후 다시 시도해 주세요.');
          return;
        }
        const res = await gdrive.createSlides({ userEmail: email, name: spec.name, buffer });
        if (!res.ok) {
          console.error('슬라이드 저장 실패:', res.error);
          await reply('드라이브 저장에 실패했어요. 잠시 후 다시 시도해 주세요.');
          return;
        }
        await reply(`✅ 만들었어요: ${res.name}\n${res.link}`);
        memory.append(user, 'user', text);
        memory.append(user, 'assistant', `[구글슬라이드 생성: ${res.name}] ${res.link}`);
        return;
      }

      case 'drive_search': {
        if (!gdrive.configured()) { await reply('구글 드라이브 연동이 아직 설정 전이에요(관리자 설정 필요).'); return; }
        if (!email) { await reply('드라이브 이메일이 등록되지 않았어요(관리자에게 문의).'); return; }
        if (!data.query) { await reply('무엇을 찾을까요? 검색어를 알려주세요.'); return; }
        await setStatus('🔎 드라이브에서 찾고 있어요…');
        const res = await gdrive.search({ userEmail: email, query: data.query, sharedDriveId: process.env.SECBOT_SHARED_DRIVE_ID });
        if (!res.ok) { console.error('드라이브 검색 실패:', res.error); await reply('드라이브 검색에 실패했어요. 잠시 후 다시 시도해 주세요.'); return; }
        const files = res.files || [];
        if (files.length === 0) { await reply(`'${data.query}'(으)로 찾은 파일이 없어요.`); return; }
        session.setLast(user, 'drive', files);
        const lines = files.map((f, i) => `${i + 1}. [${f.where}] ${f.name}\n${f.webViewLink}`).join('\n');
        await reply(`찾았어요 (${files.length}개):\n${lines}\n\n사본을 만들려면 "N번 사본 만들어줘"라고 하세요.`);
        return;
      }

      case 'drive_copy': {
        if (!gdrive.configured()) { await reply('구글 드라이브 연동이 아직 설정 전이에요(관리자 설정 필요).'); return; }
        if (!email) { await reply('드라이브 이메일이 등록되지 않았어요(관리자에게 문의).'); return; }
        let target = null;
        const last = session.getLast(user);
        if (data.number && last && last.kind === 'drive' && last.items[data.number - 1]) {
          target = last.items[data.number - 1];
        } else if (data.query) {
          const found = await gdrive.search({ userEmail: email, query: data.query, sharedDriveId: process.env.SECBOT_SHARED_DRIVE_ID });
          const files = (found && found.ok && found.files) || [];
          if (files.length === 1) target = files[0];
          else if (files.length > 1) {
            session.setLast(user, 'drive', files);
            await reply(files.map((f, i) => `${i + 1}. [${f.where}] ${f.name}`).join('\n') + '\n몇 번을 사본으로 만들까요?');
            return;
          }
        }
        if (!target) { await reply('어떤 파일을 복제할지 못 찾았어요. 먼저 "드라이브에서 ~ 찾아줘"로 검색해 주세요.'); return; }
        await setStatus('📑 사본을 만들고 있어요…');
        const newName = data.newName || (target.name + ' (사본)');
        const res = await gdrive.copy({ userEmail: email, fileId: target.id, newName });
        if (!res.ok) { console.error('사본 생성 실패:', res.error); await reply('사본 생성에 실패했어요. 잠시 후 다시 시도해 주세요.'); return; }
        await reply(`✅ 사본을 만들었어요 (원본은 그대로예요): ${res.name}\n${res.link}`);
        memory.append(user, 'user', text);
        memory.append(user, 'assistant', `[사본 생성: ${res.name}] ${res.link}`);
        return;
      }

      case 'nas_search': {
        if (!nas.available()) { await reply('NAS 연결이 아직 준비되지 않았어요(관리자 설정 필요).'); return; }
        if (!data.query) { await reply('NAS에서 무엇을 찾을까요? 검색어를 알려주세요.'); return; }
        await setStatus('🔎 NAS에서 찾고 있어요… (파일이 많으면 조금 걸려요)');
        const res = nas.search(data.query);
        if (!res.ok) { console.error('NAS 검색 실패:', res.error); await reply('NAS 검색에 실패했어요. 잠시 후 다시 시도해 주세요.'); return; }
        const files = res.files || [];
        if (files.length === 0) { await reply(`'${data.query}'(으)로 찾은 NAS 파일이 없어요.${res.truncated ? ' (파일이 많아 일부만 탐색했어요 — 검색어를 더 구체적으로 해보세요)' : ''}`); return; }
        session.setLast(user, 'nas', files);
        const lines = files.map((f, i) => `${i + 1}. [${f.share}] ${f.name}\n    ${f.relPath}`).join('\n');
        await reply(`NAS에서 찾았어요 (${files.length}개${res.truncated ? '+, 일부만 탐색' : ''}):\n${lines}\n\n원하는 항목의 번호나 이름으로 말하면 사본을 구글 드라이브에 올려드려요 — 예: "5번 드라이브에 올려줘" 또는 "운영지원팀 파일 드라이브에 올려줘" (원본은 그대로).`);
        return;
      }

      case 'nas_copy': {
        if (!nas.available()) { await reply('NAS 연결이 아직 준비되지 않았어요(관리자 설정 필요).'); return; }
        if (!gdrive.configured()) { await reply('구글 드라이브 연동이 아직 설정 전이에요.'); return; }
        if (!email) { await reply('드라이브 이메일이 등록되지 않았어요(관리자에게 문의).'); return; }
        let target = null;
        const last = session.getLast(user);
        if (data.number && last && last.kind === 'nas' && last.items[data.number - 1]) {
          target = last.items[data.number - 1];
        } else if (data.query) {
          // 1) 직전 NAS 목록에서 이름으로 먼저 매칭 (예: "운영지원팀 파일 올려줘")
          const q = data.query.toLowerCase();
          let files = (last && last.kind === 'nas' ? last.items : []).filter((f) => (f.name || '').toLowerCase().includes(q) || (f.relPath || '').toLowerCase().includes(q));
          // 2) 없으면 새로 검색
          if (files.length === 0) {
            const found = nas.search(data.query);
            files = (found && found.ok && found.files) || [];
          }
          if (files.length === 1) target = files[0];
          else if (files.length > 1) {
            session.setLast(user, 'nas', files);
            await reply(files.map((f, i) => `${i + 1}. [${f.share}] ${f.name}`).join('\n') + '\n몇 번을 가져올까요?');
            return;
          }
        }
        if (!target) { await reply('어떤 NAS 파일을 가져올지 못 찾았어요. 먼저 "NAS에서 ~ 찾아줘"로 검색해 주세요.'); return; }
        await setStatus('📥 NAS에서 파일을 읽고 있어요…');
        const rd = nas.readFile(target.path);
        if (!rd.ok) {
          console.error('NAS 읽기 실패:', rd.error);
          await reply(rd.error === 'too_large' ? '파일이 너무 커서(60MB 초과) 가져올 수 없어요.' : 'NAS 파일을 읽지 못했어요.');
          return;
        }
        await setStatus('☁️ 사본을 구글 드라이브에 올리고 있어요…');
        const up = await gdrive.uploadRaw({ userEmail: email, name: rd.name, buffer: rd.buffer, mimeType: rd.mime });
        if (!up.ok) { console.error('드라이브 업로드 실패:', up.error); await reply('드라이브 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.'); return; }
        await reply(`✅ NAS 원본은 그대로 두고, 사본을 드라이브에 올렸어요: ${up.name}\n${up.link}`);
        memory.append(user, 'user', text);
        memory.append(user, 'assistant', `[NAS→드라이브 사본: ${up.name}] ${up.link}`);
        return;
      }

      case 'draft':
      case 'chat':
      default: {
        const q = (data.text || text) + (attachedText ? '\n\n[첨부 파일 내용]\n' + attachedText : '');
        await setStatus('⏳ 답변을 작성하고 있어요…');
        const ans = await claude.ask(q, ctx, facts, useOpus);
        if (ans === null) {
          await reply('지금 답변 생성에 문제가 있어요. 잠시 후 다시 시도해 주세요.');
          return;
        }
        await reply(ans);
        memory.append(user, 'user', text);
        memory.append(user, 'assistant', ans);
        // 프로필 자동 축적: 응답 전송 뒤 백그라운드로(응답 지연 방지)
        claude
          .extractFacts(text, ans, facts)
          .then((listed) => listed.forEach((f) => profile.add(user, f, 'auto')))
          .catch(() => {});
        return;
      }
    }
    };

    // 첨부된 한글 문서(hwp/hwpx) 처리: 수정(patch)·서식 채우기(fill)·읽어서 대화
    if (editableDoc) {
      const dl = await downloadBinaryFile(editableDoc);
      if (!dl) { await reply('첨부한 문서를 내려받지 못했어요. 다시 시도해 주세요.'); return; }
      try {
        const wantsFill = /(빈칸|서식|양식|누름틀).{0,8}(채워|작성|기입)|채워\s*줘|기입해/.test(text);
        const wantsEdit = /(수정|바꿔|바꾸|변경|고쳐|고치|교체|추가|삭제|넣어|빼|반영|갱신|업데이트|채워)/.test(text);
        const baseName = (editableDoc.name || '수정문서').replace(/\.[^.]+$/, '') + '_수정';

        if (wantsFill) {
          await setStatus('🔎 서식의 빈칸을 확인하고 있어요…');
          const dump = docedit.listFormFields(dl.path);
          const fields = await claude.mapFormFields(dump, text, useOpus);
          if (!fields || Object.keys(fields).length === 0) {
            await reply('채울 값을 알아내지 못했어요. 예: "성명=홍길동, 전화=010-0000-0000" 처럼 알려주세요.');
            return;
          }
          await setStatus('✍️ 서식을 채우고 있어요…');
          const res = docedit.fill(dl.path, fields, baseName);
          if (!res.ok) { console.error('fill 실패:', res.error); await reply('서식 채우기에 실패했어요. 이 문서가 빈칸 서식(누름틀)이 아닐 수 있어요.'); return; }
          await uploadHwpx(res, '요청하신 서식을 채웠어요');
          docedit.cleanup(res.dir);
          return;
        }

        if (wantsEdit) {
          await setStatus('📖 문서를 읽고 있어요…');
          const md = docedit.parseToMarkdown(dl.path);
          if (!md) { await reply('문서를 읽지 못했어요(형식 문제일 수 있어요).'); return; }
          await setStatus('✏️ 요청하신 대로 수정하고 있어요…');
          const edited = await claude.editDocMarkdown(md, text, useOpus);
          if (!edited) { await reply('수정 내용을 만들지 못했어요. 무엇을 어떻게 바꿀지 조금 더 구체적으로 알려주세요.'); return; }
          await setStatus('📄 원본 서식에 반영하고 있어요…');
          const res = docedit.patch(dl.path, edited, baseName);
          if (!res.ok) { console.error('patch 실패:', res.error); await reply('수정 반영에 실패했어요. 잠시 후 다시 시도해 주세요.'); return; }
          const note = res.skipped ? '\n※ 일부 수정은 원본 구조상 반영되지 않았을 수 있어요. 결과를 꼭 확인해 주세요.' : '';
          await uploadHwpx(res, '요청하신 대로 수정했어요' + note);
          docedit.cleanup(res.dir);
          return;
        }

        // 수정·채우기 요청이 아니면: 문서 내용을 읽어 일반 대화(요약·질의)로 넘긴다.
        const md = docedit.parseToMarkdown(dl.path);
        if (md) attachedText = (attachedText ? attachedText + '\n\n' : '') + '# ' + editableDoc.name + '\n' + md;
      } finally {
        docedit.cleanup(dl.dir);
      }
    }

    await setStatus('⏳ 확인하고 있어요…');
    const actions = await claude.interpret(text, ctx, facts, nowIso);
    const list = Array.isArray(actions) ? actions : [actions];
    for (const intent of list) {
      await handleIntent(intent);
    }
  } catch (e) {
    console.error('핸들러 오류:', e && e.message);
    await reply('처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  } finally {
    await clearStatus();
  }
});

// 리마인더 발송: 해당 사용자 DM으로 전송
async function onDue(reminder) {
  await app.client.chat.postMessage({
    channel: reminder.userId,
    text: '⏰ ' + reminder.message,
  });
}

// 아침 브리핑: 등록된 각 사용자에게 오늘 일정·할일·알림 요약 DM
async function onBriefing() {
  const reg = users.load();
  for (const userId of Object.keys(reg)) {
    try {
      const email = users.emailFor(userId);
      const text = await briefing.buildForUser({ userId, email, greeting: true });
      if (text) await app.client.chat.postMessage({ channel: userId, text });
    } catch (e) {
      console.error('브리핑 발송 실패:', userId, e && e.message);
    }
  }
}

(async () => {
  await app.start();
  scheduler.startScheduler(onDue, onBriefing);
  console.log('secretary-bot 기동');
})();
