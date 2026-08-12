// [캘린더 연동] GAS 웹앱을 POST 호출해 구글 캘린더 일정 생성/조회/수정/삭제

const TIMEOUT_MS = 20 * 1000;

function configured() {
  return !!process.env.GAS_WEBHOOK_URL;
}

async function post(action, payload) {
  if (!configured()) return { ok: false, error: 'not_configured' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(process.env.GAS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.GAS_SHARED_SECRET, action, ...payload }),
      signal: controller.signal,
    });
    const json = await res.json();
    return json;
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'request_failed' };
  } finally {
    clearTimeout(timer);
  }
}

function createEvent({ title, startISO, endISO }) {
  return post('create', { title, startISO, endISO });
}

function listEvents({ fromISO, toISO }) {
  return post('list', { fromISO, toISO });
}

function updateEvent({ eventId, title, startISO, endISO }) {
  return post('update', { eventId, title, startISO, endISO });
}

function deleteEvent({ eventId }) {
  return post('delete', { eventId });
}

module.exports = { configured, createEvent, listEvents, updateEvent, deleteEvent };
