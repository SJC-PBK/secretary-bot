// [리마인더 발송] 30초마다 due 항목을 onDue로 발송하고 성공 시 markSent

const reminders = require('./reminders');

function startScheduler(onDue) {
  setInterval(async () => {
    const items = reminders.due(Date.now());
    for (const r of items) {
      try {
        await onDue(r);
        reminders.markSent(r.id);
      } catch (e) {
        // 발송 실패 시 markSent 하지 않음 → 다음 틱에 재시도
        console.error('리마인더 발송 실패:', r.id, e && e.message);
      }
    }
  }, 30 * 1000);
}

module.exports = { startScheduler };
