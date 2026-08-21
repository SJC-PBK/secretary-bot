// [서버 상태 + 토큰 통계] 아침 브리핑 관리자 리포트용.
// 토큰은 ccusage(구독 사용 로그)에서 집계해 data/token-stats.json에 날짜별로 누적 저장한다.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const STATS = path.join(process.env.DATA_DIR || './data', 'token-stats.json');

// os 기반 서버 상태(셸 불필요): CPU 부하·메모리·디스크·가동시간
function serverStatus() {
  const load = os.loadavg();
  const cores = os.cpus().length || 1;
  const total = os.totalmem();
  const free = os.freemem();
  let disk = null;
  try {
    const s = fs.statfsSync('/');
    const t = s.blocks * s.bsize;
    const avail = s.bavail * s.bsize;
    disk = { total: t, free: avail, used: t - avail };
  } catch {}
  return { cores, load, mem: { total, free, used: total - free }, disk, uptimeSec: os.uptime() };
}

// ccusage daily --json 실행 → 파싱. 실패 시 null. (bash -lc로 npx PATH 확보)
function ccusageDaily() {
  return new Promise((resolve) => {
    execFile('bash', ['-lc', 'npx -y ccusage@latest daily --json'], { timeout: 150000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      if (err) { console.error('ccusage 실행 실패:', err.message); return resolve(null); }
      try {
        const d = JSON.parse(stdout);
        if (!d || !Array.isArray(d.daily)) return resolve(null);
        resolve(d);
      } catch (e) { console.error('ccusage 파싱 실패:', e.message); resolve(null); }
    });
  });
}

function loadStats() {
  try {
    const o = JSON.parse(fs.readFileSync(STATS, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

// ccusage 일별 데이터를 누적 통계 파일에 병합(날짜 키). 반환: 병합된 통계 객체.
async function saveTokenStats() {
  const stats = loadStats();
  const d = await ccusageDaily();
  if (d && Array.isArray(d.daily)) {
    for (const e of d.daily) {
      if (!e.period) continue;
      stats[e.period] = {
        input: e.inputTokens || 0,
        output: e.outputTokens || 0,
        cacheCreate: e.cacheCreationTokens || 0,
        cacheRead: e.cacheReadTokens || 0,
        total: e.totalTokens || 0,
        cost: e.totalCost || 0,
        models: e.modelsUsed || [],
      };
    }
    fs.mkdirSync(process.env.DATA_DIR || './data', { recursive: true });
    fs.writeFileSync(STATS, JSON.stringify(stats, null, 2), 'utf8');
  }
  return stats;
}

function kstDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function gb(bytes) { return (bytes / 1024 ** 3).toFixed(1); }
function comma(n) { return Number(n || 0).toLocaleString('en-US'); }
function md(period) { const p = String(period).split('-'); return `${Number(p[1])}/${Number(p[2])}`; }

// 관리자 리포트 텍스트(서버 상태 + 토큰 사용량)
function formatReport(server, stats) {
  const lines = ['━━━━━━━━━━━━━━━━', '🛠️ 관리자 리포트', '', '🖥️ 서버 상태(scv)'];
  const loadPct = Math.round((server.load[0] / server.cores) * 100);
  lines.push(`· CPU 부하: ${server.load[0].toFixed(2)} / ${server.cores}코어 (약 ${loadPct}%)`);
  lines.push(`· 메모리: ${gb(server.mem.used)} / ${gb(server.mem.total)} GB (${Math.round((server.mem.used / server.mem.total) * 100)}%)`);
  if (server.disk) lines.push(`· 디스크: ${gb(server.disk.used)} / ${gb(server.disk.total)} GB (${Math.round((server.disk.used / server.disk.total) * 100)}%)`);
  const up = server.uptimeSec;
  lines.push(`· 가동: ${Math.floor(up / 86400)}일 ${Math.floor((up % 86400) / 3600)}시간`);

  lines.push('', '🔢 AI 토큰 사용량 (구독·정액 / $는 API 환산 참고용, 실제 추가과금 없음)');
  const today = kstDateStr(0);
  const yest = kstDateStr(-1);
  const fmtDay = (key, label, note) => {
    const s = stats[key];
    if (s) return `· ${label}(${md(key)}): ${comma(s.total)} 토큰 (환산 $${(s.cost || 0).toFixed(2)})${note || ''}`;
    return `· ${label}(${md(key)}): 사용 없음`;
  };
  lines.push(fmtDay(yest, '어제'));
  lines.push(fmtDay(today, '오늘', ' ※ 진행 중'));
  let cumTok = 0, cumCost = 0, days = 0;
  for (const k of Object.keys(stats)) { cumTok += stats[k].total || 0; cumCost += stats[k].cost || 0; days += 1; }
  lines.push(`· 누계(${days}일): ${comma(cumTok)} 토큰 (환산 $${cumCost.toFixed(2)})`);
  lines.push('📈 매일 저장 중 — 추후 AI 구독 필요성 근거자료로 활용');
  return lines.join('\n');
}

module.exports = { serverStatus, saveTokenStats, loadStats, formatReport };
