// [진입점] Slack Socket Mode 개인 비서 봇 — DM 의도 분기 + 리마인더 스케줄러
// 환경변수는 systemd EnvironmentFile 또는 export로 주입한다(dotenv 미사용).

const { App } = require('@slack/bolt');

const auth = require('./lib/auth');
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

// ISO 시각을 "○시" 형태의 짧은 한국어 표시로
function formatAt(atIso) {
  const d = new Date(atIso);
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

// 캘린더 이벤트 한 줄 표시 (GAS 응답 필드가 유동적이라 여러 이름을 관용)
function formatEvent(ev) {
  const title = ev.title || ev.summary || '(제목 없음)';
  const start = ev.startISO || ev.start || ev.at;
  return start ? `${formatAt(start)} — ${title}` : title;
}

// 이번 주(월~일)의 KST ISO 범위 반환
function thisWeekRange() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dow = (now.getUTCDay() + 6) % 7; // 월=0
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - dow);
  mon.setUTCHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  sun.setUTCHours(23, 59, 59, 0);
  return {
    fromISO: mon.toISOString().replace('Z', '+09:00'),
    toISO: sun.toISOString().replace('Z', '+09:00'),
  };
}

app.message(async ({ message, client }) => {
  // DM(im) + 일반 메시지(subtype 없음)만 처리. 봇 자신·수정 이벤트 무시.
  if (message.channel_type !== 'im' || message.subtype) return;
  if (!auth.isAllowed(message.user)) return;

  const user = message.user;
  const text = (message.text || '').trim();
  const reply = (t) => client.chat.postMessage({ channel: user, text: t });

  try {
    const facts = profile.facts(user);
    const ctx = memory.load(user);
    const nowIso = nowKstIso();

    const intent = await claude.interpret(text, ctx, facts, nowIso);
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
        if (!data.title || !data.startISO) {
          await reply('일정 제목과 시각을 알려주세요.');
          return;
        }
        const res = await calendar.createEvent({ title: data.title, startISO: data.startISO, endISO: data.endISO });
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
        const range = data.fromISO && data.toISO ? { fromISO: data.fromISO, toISO: data.toISO } : thisWeekRange();
        const res = await calendar.listEvents(range);
        if (!res || !res.ok) {
          await reply(`일정을 불러오지 못했어요: ${(res && res.error) || '알 수 없는 오류'}`);
          return;
        }
        const events = res.events || [];
        if (events.length === 0) {
          await reply('해당 기간에 일정이 없어요.');
          return;
        }
        session.setLast(user, 'calendar', events);
        await reply(events.map((ev, i) => `${i + 1}. ${formatEvent(ev)}`).join('\n'));
        return;
      }

      case 'calendar_delete': {
        if (!calendar.configured()) {
          await reply('캘린더 연동이 아직 설정 전이에요(관리자 설정 필요).');
          return;
        }
        const last = session.getLast(user);
        if (data.number && last && last.kind === 'calendar' && last.items[data.number - 1]) {
          const target = last.items[data.number - 1];
          const res = await calendar.deleteEvent({ eventId: target.id });
          if (res && res.ok) await reply(`삭제했어요: ${formatEvent(target)}`);
          else await reply(`삭제에 실패했어요: ${(res && res.error) || '알 수 없는 오류'}`);
          return;
        }
        if (data.query) {
          const res = await calendar.listEvents(thisWeekRange());
          const events = (res && res.ok && res.events) || [];
          const matched = events.filter((ev) => (ev.title || ev.summary || '').includes(data.query));
          if (matched.length === 1) {
            const del = await calendar.deleteEvent({ eventId: matched[0].id });
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
        const changes = data.changes || {};
        const last = session.getLast(user);
        let target = null;
        if (data.number && last && last.kind === 'calendar' && last.items[data.number - 1]) {
          target = last.items[data.number - 1];
        } else if (data.query) {
          const res = await calendar.listEvents(thisWeekRange());
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
        const ans = await claude.ask(text, ctx, facts);
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
