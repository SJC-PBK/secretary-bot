// [헤드리스 Claude 래퍼] claude -p 자식 프로세스에 프롬프트를 stdin으로 넘겨 답변/리마인더 파싱

const { spawn } = require('child_process');
const rules = require('./rules');

const TIMEOUT_MS = 120 * 1000;

// 안전 기본 지침 — 전역 문서가 있어도 항상 유지된다(문서 규칙은 이 위에 "추가"됨)
const SAFETY_BASE =
  '너는 사용자의 개인 비서다. 항상 한국어로, 텍스트로만 답한다. ' +
  '파일이나 명령 실행 도구를 쓰지 말고 대화로만 응답하라. ' +
  '문서·메일 초안을 요청받으면 되묻지 말고 바로 초안을 작성하라.';

// ⚠️ 서버 테스트(T014)에서 도구 완전 차단 플래그(예: --allowedTools '')를 확정해 여기 추가할 것.
//    잘못된 플래그로 기동 실패를 막기 위해 기본은 비움.
const TOOL_RESTRICTION_ARGS = [];

// 답변 모델: 기본 Sonnet, 메시지에 -o 붙이면 Opus (app.js에서 useOpus 판단)
const MODEL_CHAT = process.env.SECBOT_MODEL_CHAT || 'claude-sonnet-5';
const MODEL_OPUS = process.env.SECBOT_MODEL_OPUS || 'claude-opus-4-8';

// claude -p 를 실행하고 stdout 문자열을 반환. 실패/타임아웃/비정상 종료 시 null.
function run(prompt, model) {
  return new Promise((resolve) => {
    const bin = process.env.CLAUDE_BIN || 'claude';
    const args = ['-p', '--output-format', 'text', ...TOOL_RESTRICTION_ARGS];
    if (model) args.push('--model', model);

    let child;
    try {
      child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    } catch {
      return resolve(null);
    }

    let out = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish(null);
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', () => {}); // stderr는 무시(실패는 종료코드로 판단)
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code === 0) finish(out.trim() ? out : null); // 빈/공백 응답은 실패 취급
      else finish(null);
    });

    child.stdin.on('error', () => {}); // 잘못된 CLAUDE_BIN의 EPIPE 무시 (child 'error'/close에서 null로 흐름)
    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch {}
  });
}

function serializeContext(context) {
  if (!Array.isArray(context) || context.length === 0) return '';
  const lines = context.map((m) => {
    const who = m.role === 'assistant' ? '비서' : '사용자';
    return `${who}: ${m.text}`;
  });
  return lines.join('\n');
}

function factsBlock(facts) {
  if (!Array.isArray(facts) || facts.length === 0) return '';
  return '\n[사용자에 대해 기억하는 것]\n' + facts.map((f) => '- ' + f).join('\n');
}

async function ask(userText, context, facts, useOpus) {
  let gr = '';
  try { gr = await rules.globalRules(); } catch { gr = ''; }
  const extra = gr && gr.trim() ? '\n\n[전역 규칙]\n' + gr.trim() : '';
  const system = SAFETY_BASE + extra + factsBlock(facts);

  const parts = [system];
  const ctx = serializeContext(context);
  if (ctx) {
    parts.push('\n이전 대화 맥락:\n' + ctx);
  }
  parts.push('\n이번 사용자 발화:\n사용자: ' + userText);

  return run(parts.join('\n'), useOpus ? MODEL_OPUS : MODEL_CHAT);
}

// claude -p 한 번으로 사용자 발화의 의도를 분류·추출해 [{type, data}, ...] 배열로 반환.
// 파싱 실패 시 [{type:'chat', data:{text}}] 폴백.
async function interpret(text, context, facts, nowIsoKST) {
  const system =
    `현재 시각(KST)=${nowIsoKST}. 너는 개인 비서의 의도 분류기다. ` +
    '사용자 메시지에 여러 요청이 있으면 각각을 배열의 개별 원소로 분리하라. ' +
    'JSON 배열만 출력하라(설명·코드블록 금지). 요청이 하나면 원소 1개짜리 배열로 출력하라. ' +
    '각 원소는 아래 스키마의 {type, data} 형태다. ' +
    'chat/draft 타입일 때는 data.text에 그 요청에 해당하는 부분만 담아라' +
    '(예: "일정 등록하고 슬로건 3개 만들어줘" → ' +
    '[{"type":"calendar_create","data":{...}},{"type":"draft","data":{"text":"장애인 일자리센터 슬로건 3개 만들어줘"}}]). ' +
    '리마인더(예: "알려줘")는 슬랙으로 알림을 보내는 것이고, ' +
    '캘린더(예: "일정 등록해줘")는 구글 캘린더에 일정을 넣는 것이다. 둘을 반드시 구분하라.\n' +
    '스키마:\n' +
    '{"type":"chat"} — 일반 대화/질문\n' +
    '{"type":"draft"} — 문서·메일 초안 작성 요청\n' +
    '{"type":"reminder_create","data":{"at":"YYYY-MM-DDTHH:mm:ss+09:00"|null,"message":"..."}}\n' +
    '{"type":"reminder_list"}\n' +
    '{"type":"reminder_cancel","data":{"number":정수|null}}\n' +
    '{"type":"calendar_create","data":{"title":"...","startISO":"...+09:00","endISO":"...+09:00"|null}}\n' +
    '{"type":"calendar_list","data":{"fromISO":"...+09:00"|null,"toISO":"...+09:00"|null}}\n' +
    '{"type":"calendar_delete","data":{"number":정수|null,"query":"검색어"|null}}\n' +
    '{"type":"calendar_update","data":{"number":정수|null,"query":"검색어"|null,"changes":{"title":"..."|null,"startISO":"...+09:00"|null,"endISO":"...+09:00"|null}}}\n' +
    '{"type":"memory_remember","data":{"fact":"기억할 내용"}}\n' +
    '{"type":"memory_show"}\n' +
    '{"type":"memory_forget","data":{"number":정수|null}}\n' +
    'number는 직전에 보여준 목록의 번호다. 시각이 불명확하면 해당 필드를 null로 두라.';

  const parts = [system + factsBlock(facts)];
  const ctx = serializeContext(context);
  if (ctx) {
    parts.push('\n이전 대화 맥락:\n' + ctx);
  }
  parts.push('\n이번 사용자 발화:\n사용자: ' + text);

  const out = await run(parts.join('\n'));
  const fallback = [{ type: 'chat', data: { text } }];
  if (!out) return fallback;
  try {
    const match = out.match(/\[[\s\S]*\]/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    if (!parsed.every((el) => el && typeof el.type === 'string')) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

// 이번 대화에서 장기적으로 기억할 가치가 있는 사용자 사실·취향만 추출(최대 3개).
async function extractFacts(userText, assistantText, existingFacts) {
  const prompt =
    '아래 대화에서 앞으로도 오래 기억할 가치가 있는 사용자의 사실·취향만 뽑아 ' +
    'JSON 배열 ["사실1","사실2"] 하나만 출력하라(설명 금지). ' +
    '일회성 요청·잡담·그때만 유효한 내용은 제외한다. ' +
    '이미 기억 중인 것과 중복되면 제외한다. 없으면 [] 를 출력. 최대 3개.\n' +
    factsBlock(existingFacts) + '\n' +
    '\n사용자: ' + userText +
    '\n비서: ' + assistantText;

  const out = await run(prompt);
  if (!out) return [];
  try {
    const match = out.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => typeof x === 'string' && x.trim()).slice(0, 3);
  } catch {
    return [];
  }
}

async function parseReminder(text, nowIsoKST) {
  const prompt =
    `현재 시각(KST)=${nowIsoKST} 를 기준으로, 아래 문장에서 리마인더 시각과 메시지를 뽑아 JSON만 출력하라. ` +
    '형식 {"at":"YYYY-MM-DDTHH:mm:ss+09:00","message":"..."}. ' +
    '시각을 특정할 수 없으면 {"at":null} 만 출력.\n\n' +
    '문장: ' + text;

  const out = await run(prompt);
  if (!out) return null;

  try {
    const match = out.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed || !parsed.at) return null;
    if (isNaN(new Date(parsed.at).getTime())) return null;
    return { at: parsed.at, message: parsed.message || '' };
  } catch {
    return null;
  }
}

module.exports = { ask, parseReminder, interpret, extractFacts };
