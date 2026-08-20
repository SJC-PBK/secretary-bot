// [브리핑] 오늘 일정 + 할 일 + 오늘 알림을 요약. 아침 자동 발송·"오늘 브리핑" 요청 공용.

const calendar = require('./calendar');
const todos = require('./todos');
const reminders = require('./reminders');

function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function todayRangeKst() {
  const from = new Date(Date.now() + 9 * 60 * 60 * 1000);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(from.getUTCDate() + 1);
  return { fromISO: from.toISOString().replace('Z', '+09:00'), toISO: to.toISOString().replace('Z', '+09:00') };
}

function fmtTime(iso) {
  if (!iso) return '';
  if (!String(iso).includes('T')) return '종일';
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}시${mi ? ' ' + String(mi).padStart(2, '0') + '분' : ''}`;
}

function isSameKstDay(iso) {
  if (!iso) return false;
  const a = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const n = kstNow();
  return a.getUTCFullYear() === n.getUTCFullYear() && a.getUTCMonth() === n.getUTCMonth() && a.getUTCDate() === n.getUTCDate();
}

// 사용자 1명치 브리핑 텍스트. greeting=false면 인사말 없이(요청형).
async function buildForUser({ userId, email, greeting = true, weather = '' }) {
  const d = kstNow();
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  const lines = [];
  if (greeting) lines.push(`☀️ 좋은 아침이에요! ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${wd}) 브리핑입니다.`);
  else lines.push(`🗒️ ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${wd}) 브리핑`);

  if (weather) lines.push(`\n🌤️ 오늘 날씨: ${weather}`);

  // 오늘 일정
  if (calendar.configured() && email) {
    try {
      const r = await calendar.listEvents({ userEmail: email, ...todayRangeKst() });
      const evs = (r && r.ok && r.events) || [];
      if (evs.length) {
        lines.push(`\n📅 오늘 일정 ${evs.length}건`);
        evs.forEach((e) => lines.push(`  · ${fmtTime(e.start)} ${e.title}`));
      } else {
        lines.push('\n📅 오늘 등록된 일정은 없어요.');
      }
    } catch (e) {
      lines.push('\n📅 오늘 일정을 불러오지 못했어요.');
    }
  }

  // 할 일
  const td = todos.list(userId);
  if (td.length) {
    lines.push(`\n✅ 할 일 ${td.length}건`);
    td.slice(0, 10).forEach((t, i) => {
      const dl = todos.dueLabel(t.due);
      lines.push(`  ${i + 1}. ${t.text}${dl ? ` (${dl})` : ''}`);
    });
    if (td.length > 10) lines.push(`  … 외 ${td.length - 10}건`);
  } else {
    lines.push('\n✅ 할 일 목록은 비어 있어요.');
  }

  // 오늘 예정된 알림(리마인더)
  const rem = reminders.list(userId).filter((r) => isSameKstDay(r.at));
  if (rem.length) {
    lines.push(`\n⏰ 오늘 알림 ${rem.length}건`);
    rem.forEach((r) => lines.push(`  · ${fmtTime(r.at)} ${r.message}`));
  }

  return lines.join('\n');
}

module.exports = { buildForUser };
