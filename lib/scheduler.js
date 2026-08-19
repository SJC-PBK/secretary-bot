// [스케줄러] 30초마다 ①due 리마인더 발송 ②아침 브리핑 시각이면 하루 1회 onBriefing

const reminders = require('./reminders');

function startScheduler(onDue, onBriefing) {
  let lastBriefingYmd = null;
  setInterval(async () => {
    // ① 리마인더 발송
    const items = reminders.due(Date.now());
    for (const r of items) {
      try {
        await onDue(r);
        reminders.markSent(r.id);
      } catch (e) {
        console.error('리마인더 발송 실패:', r.id, e && e.message);
      }
    }

    // ② 아침 브리핑 (하루 1회, 지정 시각 이후 60분 창)
    if (onBriefing) {
      try {
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
        const ymd = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
        const dow = now.getUTCDay(); // 0=일 … 6=토
        const [th, tm] = (process.env.SECBOT_BRIEFING_TIME || '08:30').split(':').map(Number);
        const target = (th || 0) * 60 + (tm || 0);
        const minsNow = now.getUTCHours() * 60 + now.getUTCMinutes();
        const weekdaysOnly = (process.env.SECBOT_BRIEFING_WEEKDAYS_ONLY || '1') !== '0';
        const okDay = !weekdaysOnly || (dow >= 1 && dow <= 5);
        if (okDay && ymd !== lastBriefingYmd && minsNow >= target && minsNow < target + 60) {
          lastBriefingYmd = ymd; // 먼저 표시해 중복 방지
          await onBriefing();
        }
      } catch (e) {
        console.error('브리핑 스케줄 오류:', e && e.message);
      }
    }
  }, 30 * 1000);
}

module.exports = { startScheduler };
