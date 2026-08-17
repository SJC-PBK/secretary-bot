// [진입점] Slack Socket Mode 개인 비서 봇 — DM 의도 분기 + 리마인더 스케줄러
// 환경변수는 systemd EnvironmentFile 또는 export로 주입한다(dotenv 미사용).

const { App } = require('@slack/bolt');

const auth = require('./lib/auth');
const users = require('./lib/users');
const claude = require('./lib/claude');
const memory = require('./lib/memory');
const reminders = require('./lib/reminders');
const scheduler = require('./lib/scheduler');
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

app.message(async ({ message, client }) => {
  // DM(im) + 일반 메시지(subtype 없음)만 처리. 봇 자신·수정 이벤트 무시.
  if (message.channel_type !== 'im' || message.subtype) return;

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

  // 관리자 명령 (관리자 & 정확한 패턴일 때만): 승인 목록 / 승인 U… / 사용자 목록 / 해제 U…
  {
    const t = (message.text || '').trim();
    const isAdminCmd = message.user === ADMIN && (
      t === '승인 목록' || t === '사용자 목록' ||
      /^승인\s+U[A-Z0-9]{6,}$/.test(t) || /^해제\s+U[A-Z0-9]{6,}$/.test(t)
    );
    if (isAdminCmd) {
      if (t === '승인 목록') {
        const p = users.pendingList(); const ids = Object.keys(p);
        await client.chat.postMessage({ channel: message.user, text: ids.length ? ids.map((id) => `- ${p[id].name || id} ${p[id].email || ''} → 승인 ${id}`).join('\n') : '대기 중인 요청이 없어요.' });
        return;
      }
      if (t === '사용자 목록') {
        const reg = users.load(); const ids = Object.keys(reg);
        await client.chat.postMessage({ channel: message.user, text: ids.length ? '등록된 사용자:\n' + ids.map((id) => `- ${reg[id].email || '(이메일 없음)'} (${id})${id === ADMIN ? ' [관리자]' : ''} → 해제 ${id}`).join('\n') : '등록된 사용자가 없어요.' });
        return;
      }
      if (/^해제\s+U[A-Z0-9]{6,}$/.test(t)) {
        const target = t.split(/\s+/)[1];
        if (target === ADMIN) { await client.chat.postMessage({ channel: message.user, text: '관리자 본인은 해제할 수 없어요.' }); return; }
        const ok = users.remove(target);
        users.removePending(target);
        await client.chat.postMessage({ channel: message.user, text: ok ? `해제 완료: ${target} — 이제 이 사용자는 봇을 쓸 수 없어요(데이터는 서버에 남음).` : '그 사용자를 못 찾았어요. ("사용자 목록"으로 확인)' });
        if (ok) { try { await client.chat.postMessage({ channel: target, text: '비서봇 사용이 해제되었습니다. 문의는 관리자에게 해주세요.' }); } catch {} }
        return;
      }
      const target = t.split(/\s+/)[1];
      const p = users.pendingList();
      if (!p[target]) { await client.chat.postMessage({ channel: message.user, text: '그 요청을 찾지 못했어요. ("승인 목록"으로 확인)' }); return; }
      users.register(target, p[target].email || '');
      users.removePending(target);
      await client.chat.postMessage({ channel: message.user, text: `승인 완료: ${p[target].name || target} (${p[target].email || '이메일 없음'})` });
      try { await client.chat.postMessage({ channel: target, text: '사용 승인되었습니다! 이제 저에게 편하게 말 걸어보세요 🙂' }); } catch {}
      return;
    }
  }

  const user = message.user;
  const email = users.emailFor(user);
  const rawText = (message.text || '').trim();
  const useOpus = /(^|\s)-o(?=\s|$)/i.test(rawText); // 메시지에 -o 있으면 이 답변만 Opus
  const text = rawText.replace(/(^|\s)-o(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
  const reply = (t) => client.chat.postMessage({ channel: user, text: t });

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
        const res = await calendar.createEvent({ userEmail: email, title: data.title, startISO: data.startISO, endISO: data.endISO });
        if (res && res.ok) {
          const link = res.event && res.event.htmlLink ? '\n' + res.event.htmlLink : '';
          await reply(`캘린더에 등록했어요: ${data.title} (${formatAt(data.startISO)})${link}`);
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
        const explicit = data.fromISO && data.toISO;
        const range = explicit ? { fromISO: data.fromISO, toISO: data.toISO } : upcomingRange(90);
        const res = await calendar.listEvents({ userEmail: email, ...range });
        if (!res || !res.ok) {
          await reply(`일정을 불러오지 못했어요: ${(res && res.error) || '알 수 없는 오류'}`);
          return;
        }
        const events = res.events || [];
        if (events.length === 0) {
          await reply(explicit ? '해당 기간에 일정이 없어요.' : '다가오는 일정이 없어요.');
          return;
        }
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
          const res = await calendar.deleteEvent({ userEmail: email, eventId: target.id });
          if (res && res.ok) await reply(`삭제했어요: ${formatEvent(target)}`);
          else await reply(`삭제에 실패했어요: ${(res && res.error) || '알 수 없는 오류'}`);
          return;
        }
        if (data.query) {
          const res = await calendar.listEvents({ userEmail: email, ...upcomingRange(90) });
          const events = (res && res.ok && res.events) || [];
          const matched = events.filter((ev) => (ev.title || ev.summary || '').includes(data.query));
          if (matched.length === 1) {
            const del = await calendar.deleteEvent({ userEmail: email, eventId: matched[0].id });
            if (del && del.ok) await reply(`삭제했어요: ${formatEvent(matched[0])}`);
            else await reply(`삭제에 실패했어요: ${(del && del.error) || '알 수 없는 오류'}`);
            return;
          }
          if (matched.length > 1) {
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
          const res = await calendar.listEvents({ userEmail: email, ...upcomingRange(90) });
          const events = (res && res.ok && res.events) || [];
          const matched = events.filter((ev) => (ev.title || ev.summary || '').includes(data.query));
          if (matched.length === 1) {
            target = matched[0];
          } else if (matched.length > 1) {
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
        });
        if (res && res.ok) await reply('일정을 수정했어요.');
        else await reply(`수정에 실패했어요: ${(res && res.error) || '알 수 없는 오류'}`);
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

      case 'draft':
      case 'chat':
      default: {
        const q = data.text || text;
        const ans = await claude.ask(q, ctx, facts, useOpus);
        if (ans === null) {
          await reply('지금 답변 생성에 문제가 있어요. 잠시 후 다시 시도해 주세요.');
          return;
        }
        await reply(ans);
        memory.append(user, 'user', q);
        memory.append(user, 'assistant', ans);
        // 프로필 자동 축적: 응답 전송 뒤 백그라운드로(응답 지연 방지)
        claude
          .extractFacts(q, ans, facts)
          .then((listed) => listed.forEach((f) => profile.add(user, f, 'auto')))
          .catch(() => {});
        return;
      }
    }
    };

    const actions = await claude.interpret(text, ctx, facts, nowIso);
    const list = Array.isArray(actions) ? actions : [actions];
    for (const intent of list) {
      await handleIntent(intent);
    }
  } catch (e) {
    console.error('핸들러 오류:', e && e.message);
    await reply('처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  }
});

// 리마인더 발송: 해당 사용자 DM으로 전송
async function onDue(reminder) {
  await app.client.chat.postMessage({
    channel: reminder.userId,
    text: '⏰ ' + reminder.message,
  });
}

(async () => {
  await app.start();
  scheduler.startScheduler(onDue);
  console.log('secretary-bot 기동');
})();
