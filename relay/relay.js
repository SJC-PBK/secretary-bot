// [비서봇 PC 중계기] 관리자 PC에서 상주하며 비서봇(scv)과 이 PC의 Claude Code 세션을 잇는다.
// - 1분마다: 프로젝트 폴더별 최근 세션 현황(제목·마지막 지시·마지막 응답·작업 중 여부)을 서버로 보냄
// - 10초마다: 서버에 쌓인 지시를 가져와 해당 폴더의 최근 세션을 이어서 claude -p 로 실행 → 결과 보고
// 연결은 PC→서버 단방향(PC 방화벽 개방 불필요). 의존성 없음(Node 18+).
// 설정: 같은 폴더의 .env (RELAY_URL, RELAY_SECRET, PROJECTS_ROOT, CLAUDE_EXE) — .env는 커밋 금지
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HERE = __dirname;
for (const line of (() => { try { return fs.readFileSync(path.join(HERE, '.env'), 'utf8').split(/\r?\n/); } catch { return []; } })()) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const URL_BASE = (process.env.RELAY_URL || 'http://192.168.0.97:3220').replace(/\/$/, '');
const SECRET = process.env.RELAY_SECRET || '';
const ROOT = path.resolve(process.env.PROJECTS_ROOT || path.join(os.homedir(), 'projects'));
const CLAUDE = process.env.CLAUDE_EXE || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const SESS_DIR = path.join(os.homedir(), '.claude', 'projects');
const LOG = path.join(HERE, 'relay.log');
const ACTIVE_MS = 3 * 60 * 1000;      // 세션 기록이 이 안에 바뀌었으면 "사용 중"
const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 지시 하나 최대 30분
const RECENT_DAYS = 30;                // 현황에는 최근 30일 안에 쓴 세션만

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  try { fs.appendFileSync(LOG, line); } catch {}
  process.stdout.write(line);
}

async function api(method, p, body) {
  const res = await fetch(URL_BASE + p, {
    method,
    headers: { 'x-relay-secret': SECRET, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}`);
  return res.json();
}

// ── 세션 기록 읽기 ──────────────────────────────────────────
function readSlice(file, fromEnd, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, fromEnd ? size - len : 0);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}
function parseLines(s) {
  const out = [];
  for (const l of s.split('\n')) { try { out.push(JSON.parse(l)); } catch {} } // 잘린 첫/끝 줄은 건너뜀
  return out;
}
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
  return '';
}
function under(dir) { const r = path.relative(ROOT, dir); return r && !r.startsWith('..') && !path.isAbsolute(r); }

const cache = new Map(); // file → { mtimeMs, info }
function sessionInfo(file, mtimeMs) {
  const c = cache.get(file);
  if (c && c.mtimeMs === mtimeMs) return c.info;
  let cwd = null;
  for (const e of parseLines(readSlice(file, false, 256 * 1024))) { if (e.cwd) { cwd = e.cwd; break; } }
  const tail = parseLines(readSlice(file, true, 512 * 1024));
  if (!cwd) for (const e of tail) if (e.cwd) { cwd = e.cwd; break; }
  let title = '', lastPrompt = '', lastReply = '';
  for (const e of tail) {
    if (e.type === 'custom-title' && e.customTitle) title = e.customTitle;
    else if (e.type === 'ai-title' && e.aiTitle && !title) title = e.aiTitle;
    else if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
    else if (e.type === 'assistant' && !e.isSidechain && e.message) { const t = textOf(e.message.content); if (t.trim()) lastReply = t; }
  }
  const info = { cwd, title, lastPrompt, lastReply, sessionId: path.basename(file, '.jsonl') };
  cache.set(file, { mtimeMs, info });
  return info;
}

// 프로젝트 폴더(cwd)별 최신 세션 하나씩
function scan() {
  const byCwd = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(SESS_DIR); } catch { return []; }
  for (const d of dirs) {
    const full = path.join(SESS_DIR, d);
    let files = [];
    try { files = fs.readdirSync(full).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const fp = path.join(full, f);
      let st; try { st = fs.statSync(fp); } catch { continue; }
      if (Date.now() - st.mtimeMs > RECENT_DAYS * 86400000) continue;
      let info; try { info = sessionInfo(fp, st.mtimeMs); } catch { continue; }
      if (!info.cwd || !under(path.resolve(info.cwd)) || !fs.existsSync(info.cwd)) continue; // 지금 있는 프로젝트 폴더만
      const key = path.resolve(info.cwd).toLowerCase();
      const prev = byCwd.get(key);
      if (!prev || prev.mtimeMs < st.mtimeMs) byCwd.set(key, { ...info, mtimeMs: st.mtimeMs });
    }
  }
  return [...byCwd.values()].sort((a, b) => b.mtimeMs - a.mtimeMs).map((s) => ({
    name: path.relative(ROOT, path.resolve(s.cwd)).replace(/\\/g, '/'),
    cwd: s.cwd,
    sessionId: s.sessionId,
    title: s.title,
    lastPrompt: s.lastPrompt.slice(0, 300),
    lastReply: s.lastReply.slice(0, 600),
    lastActivity: new Date(s.mtimeMs).toISOString(),
    active: Date.now() - s.mtimeMs < ACTIVE_MS,
  }));
}

// ── 지시 실행 ───────────────────────────────────────────────
const RULES = [
  '[비서봇 원격 지시] 이 지시는 관리자가 슬랙으로 원격 전달한 것이고, 관리자는 지금 화면 앞에 없다.',
  '질문하려고 멈추지 말고 합리적으로 가정해 진행하되, 가정은 보고에 적어라.',
  '파일 읽기·수정은 해도 된다. git commit/push, 배포, 파일·폴더 삭제, 서버 접속, 외부 전송, 그리고 허용되지 않아 거부된 명령은 실행하지 말고',
  '응답 맨 끝에 한 줄에 하나씩 "[승인요청] <실행할 정확한 명령>" 형식으로 적어라(관리자가 슬랙 버튼으로 승인하면 이어서 실행된다).',
  '마지막에 한국어로 간결히 보고하라: 무엇을 바꿨는지, 확인 방법, 남은 일.',
].join(' ');
// 기본 허용: 편집 + 조회성 명령. 그 밖의 명령은 -p 모드에서 자동 거부된다.
const ALLOW = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'WebSearch', 'WebFetch',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git show*)', 'Bash(ls*)', 'Bash(node --check *)', 'Bash(npm test*)',
  'PowerShell(git status*)', 'PowerShell(git diff*)', 'PowerShell(git log*)', 'PowerShell(Get-ChildItem*)'];
// 사용자 설정(settings.json)의 허용 규칙이 있어도 막을 것(거부가 허용보다 우선)
const DENY = ['git commit', 'git push', 'git reset', 'git clean', 'rm', 'rmdir', 'del', 'Remove-Item', 'ssh', 'scp', 'sftp', 'curl', 'Invoke-WebRequest']
  .flatMap((c) => [`Bash(${c})`, `Bash(${c} *)`, `PowerShell(${c})`, `PowerShell(${c} *)`]);

// 승인된 명령 → 첫 두 단어 기준 허용 규칙
function approveRules(cmds) {
  const out = [];
  for (const c of cmds || []) {
    const head = c.trim().split(/\s+/).slice(0, 2).join(' ');
    if (head) out.push(`Bash(${head})`, `Bash(${head} *)`, `PowerShell(${head})`, `PowerShell(${head} *)`);
  }
  return out;
}

function latestSessionFor(cwd) {
  const key = path.resolve(cwd).toLowerCase();
  return scan().find((s) => path.resolve(s.cwd).toLowerCase() === key) || null;
}

function runClaude(cwd, args, prompt) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, JOB_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(prompt);
  });
}

let busyJob = null;
async function handle(job) {
  const cwd = path.resolve(job.cwd || '');
  if (!under(cwd) || !fs.existsSync(cwd)) {
    await api('POST', '/relay/event', { id: job.id, state: 'error', text: `허용된 프로젝트 폴더가 아니에요: ${job.cwd}` });
    return;
  }
  const latest = latestSessionFor(cwd);
  if (!job.force && latest && latest.active) {
    await api('POST', '/relay/event', { id: job.id, state: 'busy' });
    return; // 다음 폴링 때 다시 시도
  }
  const sessionId = job.sessionId || (latest && latest.sessionId);
  await api('POST', '/relay/event', { id: job.id, state: 'running', sessionId });
  const approved = approveRules(job.approve);
  const deny = DENY.filter((d) => !approved.includes(d));
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits',
    ...(sessionId ? ['--resume', sessionId] : []),
    '--append-system-prompt', RULES,
    '--allowedTools', ...ALLOW, ...approved,
    '--disallowedTools', ...deny];
  log('실행', job.id, job.project, sessionId || '(새 세션)', approved.length ? '승인:' + job.approve.join(' | ') : '');
  const r = await runClaude(cwd, args, job.prompt);
  let parsed = null;
  try { parsed = JSON.parse(r.out); } catch {}
  if (parsed && !parsed.is_error && parsed.result) {
    await api('POST', '/relay/event', { id: job.id, state: 'done', sessionId: parsed.session_id || sessionId, text: parsed.result });
    log('완료', job.id);
  } else {
    const why = (parsed && parsed.result) || r.err || r.out || `종료코드 ${r.code}`;
    await api('POST', '/relay/event', { id: job.id, state: 'error', sessionId, text: String(why).slice(0, 3000) });
    log('실패', job.id, String(why).slice(0, 300));
  }
}

async function pollJobs() {
  if (busyJob) return; // 한 번에 하나씩
  let jobs = [];
  try { jobs = (await api('GET', '/relay/jobs')).jobs || []; } catch (e) { log('지시 조회 실패:', e.message); return; }
  for (const job of jobs) {
    busyJob = job.id;
    try { await handle(job); } catch (e) { log('처리 오류:', job.id, e.message); }
    finally { busyJob = null; }
  }
}

async function pushStatus() {
  try { await api('POST', '/relay/status', { projects: scan() }); }
  catch (e) { log('현황 전송 실패:', e.message); }
}

if (!SECRET) { log('RELAY_SECRET 미설정 — relay/.env 확인'); process.exit(1); }
if (process.argv.includes('--scan')) { console.log(JSON.stringify(scan(), null, 2)); process.exit(0); }
log(`중계기 시작 — 서버 ${URL_BASE}, 대상 ${ROOT}`);
pushStatus();
setInterval(pushStatus, 60 * 1000);
setInterval(pollJobs, 10 * 1000);
