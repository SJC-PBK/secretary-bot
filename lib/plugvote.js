// [Plugvote 연동] 사내 투표봇(scv:/opt/vote-bot)의 내부 HTTP API를 호출해 투표·룰렛을 대신 게시.
// 같은 서버라 127.0.0.1로 호출(공유 시크릿 x-bot-secret 인증).

function base() { return process.env.PLUGVOTE_URL; }
function secret() { return process.env.PLUGVOTE_SECRET; }
function configured() { return !!(process.env.PLUGVOTE_URL && process.env.PLUGVOTE_SECRET); }

async function post(path, body) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const r = await fetch(base() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': secret() },
      body: JSON.stringify(body),
    });
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok || !j.ok) return { ok: false, error: (j && j.error) || ('http ' + r.status) };
    return { ok: true, channel: j.channel, ts: j.ts };
  } catch (e) { return { ok: false, error: (e && e.message) || 'unknown' }; }
}

// {channel, question, options[], multi, anonymous, shuffle, closeMinutes, creatorId}
function createPoll(p) { return post('/api/poll', p); }
// {channel, candidates[], creatorId}
function createRoulette(p) { return post('/api/roulette', p); }

module.exports = { configured, createPoll, createRoulette };
