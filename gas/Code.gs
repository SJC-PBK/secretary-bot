/**
 * secretary-bot 캘린더 웹앱 (Google Apps Script)
 * 비서봇이 이 웹앱을 POST로 호출해 "내 기본 구글 캘린더"에 일정을 등록/조회/수정/삭제한다.
 *
 * 배포 전 준비:
 *  1) 스크립트 속성에 SHARED_SECRET 설정
 *     (프로젝트 설정 ⚙ → 스크립트 속성 → 속성 추가: 이름 SHARED_SECRET, 값 = 임의의 긴 비밀문자열)
 *  2) 배포 → 새 배포 → 유형 "웹 앱"
 *     - 실행: 나(내 계정)  /  액세스 권한: 모든 사용자
 *     - 배포하면 나오는 웹앱 URL을 봇 서버 .env의 GAS_WEBHOOK_URL 에, SHARED_SECRET 값을 GAS_SHARED_SECRET 에 넣는다.
 *
 * 요청 본문(JSON): { secret, action, ... }
 *   action='create' : { title, startISO, endISO? }
 *   action='list'   : { fromISO, toISO }
 *   action='update' : { eventId, title?, startISO?, endISO? }
 *   action='delete' : { eventId }
 * 응답(JSON): 성공 { ok:true, ... } / 실패 { ok:false, error:"..." }
 */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!secret || body.secret !== secret) {
      return json({ ok: false, error: 'unauthorized' });
    }

    var cal = CalendarApp.getDefaultCalendar();

    switch (body.action) {
      case 'create': return json(createEvent(cal, body));
      case 'list':   return json(listEvents(cal, body));
      case 'update': return json(updateEvent(cal, body));
      case 'delete': return json(deleteEvent(cal, body));
      default:       return json({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function createEvent(cal, body) {
  if (!body.title || !body.startISO) return { ok: false, error: 'missing_title_or_start' };
  var start = new Date(body.startISO);
  var end = body.endISO ? new Date(body.endISO) : new Date(start.getTime() + 60 * 60 * 1000); // 기본 1시간
  var ev = cal.createEvent(body.title, start, end);
  return { ok: true, event: serialize(ev) };
}

function listEvents(cal, body) {
  if (!body.fromISO || !body.toISO) return { ok: false, error: 'missing_range' };
  var evs = cal.getEvents(new Date(body.fromISO), new Date(body.toISO));
  return { ok: true, events: evs.map(serialize) };
}

function updateEvent(cal, body) {
  if (!body.eventId) return { ok: false, error: 'missing_event_id' };
  var ev = cal.getEventById(body.eventId);
  if (!ev) return { ok: false, error: 'event_not_found' };
  if (body.title) ev.setTitle(body.title);
  if (body.startISO && body.endISO) {
    ev.setTime(new Date(body.startISO), new Date(body.endISO));
  } else if (body.startISO) {
    var cur = ev.getEndTime();
    ev.setTime(new Date(body.startISO), cur);
  }
  return { ok: true, event: serialize(ev) };
}

function deleteEvent(cal, body) {
  if (!body.eventId) return { ok: false, error: 'missing_event_id' };
  var ev = cal.getEventById(body.eventId);
  if (!ev) return { ok: false, error: 'event_not_found' };
  ev.deleteEvent();
  return { ok: true };
}

// 봇 app.js가 기대하는 키로 직렬화: id, title, start(ISO), end(ISO)
function serialize(ev) {
  return {
    id: ev.getId(),
    title: ev.getTitle(),
    start: ev.getStartTime().toISOString(),
    end: ev.getEndTime().toISOString(),
  };
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
