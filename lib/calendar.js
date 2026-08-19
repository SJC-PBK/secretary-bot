// [캘린더 연동] 구글 서비스계정(도메인 위임)으로 각 사용자의 primary 캘린더를 impersonate

const { google } = require('googleapis');
const fs = require('fs');

const KEY_PATH = process.env.SA_KEY || './service-account.json';

function configured() {
  return fs.existsSync(KEY_PATH);
}

// 주어진 사용자 이메일을 impersonate 하는 calendar 클라이언트 생성
function calFor(userEmail) {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
    subject: userEmail,
  });
  return google.calendar({ version: 'v3', auth });
}

async function createEvent({ userEmail, title, startISO, endISO, calendarId = 'primary' }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const cal = calFor(userEmail);
    const end = endISO || new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();
    const res = await cal.events.insert({
      calendarId,
      requestBody: {
        summary: title,
        start: { dateTime: startISO },
        end: { dateTime: end },
      },
    });
    return {
      ok: true,
      event: {
        id: res.data.id,
        title: res.data.summary,
        start: res.data.start && res.data.start.dateTime,
        end: res.data.end && res.data.end.dateTime,
        htmlLink: res.data.htmlLink,
      },
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'request_failed' };
  }
}

async function listEvents({ userEmail, fromISO, toISO, calendarId = 'primary' }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const cal = calFor(userEmail);
    const res = await cal.events.list({
      calendarId,
      timeMin: fromISO,
      timeMax: toISO,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });
    const items = res.data.items || [];
    return {
      ok: true,
      events: items.map((item) => ({
        id: item.id,
        title: item.summary || '(제목 없음)',
        start: item.start && (item.start.dateTime || item.start.date),
        end: item.end && (item.end.dateTime || item.end.date),
      })),
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'request_failed' };
  }
}

async function updateEvent({ userEmail, eventId, title, startISO, endISO, calendarId = 'primary' }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const cal = calFor(userEmail);
    const requestBody = {};
    if (title !== undefined) requestBody.summary = title;
    if (startISO !== undefined) requestBody.start = { dateTime: startISO };
    if (endISO !== undefined) requestBody.end = { dateTime: endISO };
    await cal.events.patch({ calendarId, eventId, requestBody });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'request_failed' };
  }
}

async function deleteEvent({ userEmail, eventId, calendarId = 'primary' }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const cal = calFor(userEmail);
    await cal.events.delete({ calendarId, eventId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'request_failed' };
  }
}

module.exports = { configured, createEvent, listEvents, updateEvent, deleteEvent };
