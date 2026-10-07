// [PC 세션 중계] 관리자 PC의 Claude Code 세션을 비서봇이 중간 관리한다.
// PC 중계기(relay/relay.js)가 이 서버로 접속해(PC→서버 단방향) 지시를 가져가고, 결과·세션 현황을 보낸다.
// 저장: data/relay-jobs.json(지시 대기열), data/relay-status.json(최근 세션 현황 스냅샷)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = process.env.DATA_DIR || './data';
const JOBS = path.join(DATA, 'relay-jobs.json');
const STATUS = path.join(DATA, 'relay-status.json');
const PORT = Number(process.env.RELAY_PORT || 3220);
const STALE_MS = 10 * 60 * 1000; // 현황 갱신이 이보다 오래되면 "PC 연결 끊김"

function configured() { return !!process.env.RELAY_SECRET; }

function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }
function writeJson(p, v) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); }
function loadJobs() { const j = readJson(JOBS, []); return Array.isArray(j) ? j : []; }
function saveJobs(jobs) { writeJson(JOBS, jobs.slice(-200)); } // 오래된 기록은 200건만 유지
function loadStatus() { return readJson(STATUS, null); }

// 지시 등록. job = { project, cwd, prompt, sessionId?, approve?: [명령], force?, channel, threadTs }
function addJob(job) {
  const jobs = loadJobs();
  const j = { id: crypto.randomBytes(6).toString('hex'), state: 'queued', createdAt: new Date().toISOString(), ...job };
  jobs.push(j);
  saveJobs(jobs);
  return j;
}
function getJob(id) { return loadJobs().find((j) => j.id === id) || null; }
function updateJob(id, patch) {
  const jobs = loadJobs();
  const j = jobs.find((x) => x.id === id);
  if (!j) return null;
  Object.assign(j, patch, { updatedAt: new Date().toISOString() });
  saveJobs(jobs);
  return j;
}

// 이름으로 프로젝트 찾기(현황 스냅샷 기준). 반환: { match } | { candidates }
function norm(s) { return String(s || '').toLowerCase().replace(/[\s_\-./\\]/g, ''); }
function findProject(name) {
  const st = loadStatus();
  const list = (st && st.projects) || [];
  const n = norm(name);
  if (!n) return { candidates: list };
  const exact = list.filter((p) => norm(p.name) === n);
  if (exact.length === 1) return { match: exact[0] };
  const part = list.filter((p) => norm(p.name).includes(n) || n.includes(norm(p.name)));
  if (part.length === 1) return { match: part[0] };
  return { candidates: part.length ? part : list };
}

// 응답에서 "[승인요청] 명령" 줄 추출
function parseApprovals(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/\[승인요청\]\s*`?(.+?)`?\s*$/);
    if (m) out.push(m[1].trim());
  }
  return out.slice(0, 5);
}

function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return '?';
  const m = Math.round(ms / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}
function cut(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }

// 현황 텍스트. recentHours를 주면 그 시간 안에 활동한 프로젝트만(브리핑용).
function formatStatus(opts = {}) {
  const st = loadStatus();
  if (!st) return '🧑‍💻 아직 PC 중계기에서 받은 세션 현황이 없어요. (PC에서 중계기가 실행 중인지 확인해 주세요)';
  let list = st.projects || [];
  if (opts.recentHours) list = list.filter((p) => Date.now() - new Date(p.lastActivity).getTime() < opts.recentHours * 3600000);
  const lines = [`🧑‍💻 Claude Code 세션 현황 (PC 기준, ${ago(st.at)} 갱신)`];
  if (Date.now() - new Date(st.at).getTime() > STALE_MS) lines.push('⚠️ PC 중계기와 연결이 끊겼어요 — PC가 꺼져 있거나 중계기가 멈췄을 수 있어요. 아래는 마지막으로 받은 현황이에요.');
  if (!list.length) lines.push(opts.recentHours ? `· 최근 ${opts.recentHours}시간 동안 활동한 세션이 없어요.` : '· 세션이 없어요.');
  for (const p of list) lines.push(`${p.active ? '🟢' : '⚪'} *${p.name}* · ${ago(p.lastActivity)}${p.title ? ` · ${cut(p.title, 30)}` : ''}`);
  if (list.length) lines.push('_자세히 보려면: "cafe-pos 세션 자세히"_');
  const pending = loadJobs().filter((j) => j.state === 'queued' || j.state === 'running' || j.state === 'busy');
  if (pending.length) {
    lines.push('', `📨 전달 중인 지시 ${pending.length}건`);
    for (const j of pending) lines.push(`· ${j.project}: ${j.state === 'running' ? '실행 중' : j.state === 'busy' ? '세션 사용 중이라 대기' : '대기열'} — ${cut(j.prompt, 50)}`);
  }
  return lines.join('\n');
}

// 프로젝트 하나의 자세한 현황(마지막 지시·응답)
function plain(s) { return String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#*`|>]/g, '').replace(/\s+/g, ' ').trim(); }
function formatDetail(p) {
  const lines = [`${p.active ? '🟢 작업 중' : '⚪ 대기'} *${p.name}* · ${ago(p.lastActivity)}${p.title ? ` · ${p.title}` : ''}`];
  if (p.lastPrompt) lines.push('', `*마지막 지시*\n${cut(plain(p.lastPrompt), 300)}`);
  if (p.lastReply) lines.push('', `*마지막 응답*\n${cut(plain(p.lastReply), 600)}`);
  return lines.join('\n');
}

// PC 중계기용 HTTP API. onEvent(job, event)로 상태 변화를 알린다(event: running|busy|done|error).
// onNotify(text): POST /notify (헤더 x-notify-secret = NOTIFY_SECRET) — 서버 작업(claudework) 보고를 관리자 DM으로.
function start(onEvent, onNotify) {
  if (!configured()) { console.log('[relay] RELAY_SECRET 미설정 — PC 중계 비활성'); return; }
  const secret = Buffer.from(process.env.RELAY_SECRET);
  const notifySecret = process.env.NOTIFY_SECRET ? Buffer.from(process.env.NOTIFY_SECRET) : null;
  const matches = (req, header, key) => {
    const got = Buffer.from(String(req.headers[header] || ''));
    return !!key && got.length === key.length && crypto.timingSafeEqual(got, key);
  };
  const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const server = http.createServer((req, res) => {
    const isNotify = req.method === 'POST' && req.url === '/notify';
    if (isNotify ? !matches(req, 'x-notify-secret', notifySecret) : !matches(req, 'x-relay-secret', secret)) return send(res, 401, { error: 'unauthorized' });
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
    req.on('end', async () => {
      let data = {};
      try { data = body ? JSON.parse(body) : {}; } catch { return send(res, 400, { error: 'bad json' }); }
      try {
        if (isNotify) {
          const text = String(data.text || '').trim().slice(0, 3500);
          if (!text) return send(res, 400, { error: 'empty text' });
          await onNotify(text);
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' && req.url === '/relay/jobs') {
          const jobs = loadJobs().filter((j) => j.state === 'queued' || j.state === 'busy')
            .map(({ id, project, cwd, prompt, sessionId, approve, force }) => ({ id, project, cwd, prompt, sessionId, approve, force }));
          return send(res, 200, { jobs });
        }
        if (req.method === 'POST' && req.url === '/relay/status') {
          writeJson(STATUS, { at: new Date().toISOString(), projects: Array.isArray(data.projects) ? data.projects : [] });
          return send(res, 200, { ok: true });
        }
        if (req.method === 'POST' && req.url === '/relay/event') {
          const prev = getJob(data.id);
          if (!prev) return send(res, 404, { error: 'no job' });
          const patch = { state: data.state };
          if (data.sessionId) patch.sessionId = data.sessionId;
          if (data.text != null) patch.result = String(data.text).slice(0, 20000);
          const job = updateJob(data.id, patch);
          send(res, 200, { ok: true });
          // busy는 처음 한 번만 알린다
          if (data.state === 'busy' && prev.state === 'busy') return;
          try { await onEvent(job, data.state); } catch (e) { console.error('[relay] 알림 오류:', e && e.message); }
          return;
        }
        send(res, 404, { error: 'not found' });
      } catch (e) {
        console.error('[relay] 처리 오류:', e && e.message);
        send(res, 500, { error: 'server error' });
      }
    });
  });
  server.listen(PORT, '0.0.0.0', () => console.log(`[relay] PC 중계 API 대기: ${PORT}`));
}

module.exports = { configured, start, addJob, getJob, updateJob, findProject, parseApprovals, formatStatus, formatDetail, cut };
