// [헤드리스 Claude 래퍼] claude -p 자식 프로세스에 프롬프트를 stdin으로 넘겨 답변/리마인더 파싱

const { spawn } = require('child_process');
const rules = require('./rules');

const TIMEOUT_MS = 120 * 1000;

// 답변(ask) 경로에서만 허용할 도구. 기본 WebSearch(웹 검색). 끄려면 env SECBOT_WEB_TOOLS=off.
const WEB_TOOLS = (() => {
  const v = process.env.SECBOT_WEB_TOOLS;
  if (v === undefined) return ['WebSearch'];
  if (!v.trim() || v.trim().toLowerCase() === 'off') return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
})();

// 안전 기본 지침 — 답변 경로에만 쓰인다. 전역 문서가 있어도 항상 유지(문서 규칙은 이 위에 "추가"됨).
const SAFETY_BASE =
  '너는 사용자의 개인 비서다. 항상 한국어로, 텍스트로만 답한다. ' +
  (WEB_TOOLS.length ? '최신 정보나 사실 확인이 필요하면 인터넷 검색을 사용할 수 있다. ' : '') +
  '이 비서 시스템은 문서 생성·수정(hwpx/구글 문서·시트·슬라이드), NAS·구글 드라이브 파일 검색과 사본 만들기, 구글 캘린더, 리마인더 기능을 갖추고 있다(그 작업들은 시스템이 자동 처리한다). ' +
  '그러니 파일·문서·드라이브·캘린더 관련 요청에 "권한이 없다/못 한다"고 단정하지 말고, 필요한 정보(파일명·위치·목록 번호 등)를 한 번 더 구체적으로 물어라. ' +
  '다만 너 스스로 임의로 파일을 쓰거나 시스템 명령을 실행하지는 않는다. ' +
  '문서·메일 초안을 요청받으면 되묻지 말고 바로 초안을 작성하라.';

// ⚠️ 서버 테스트(T014)에서 도구 완전 차단 플래그(예: --allowedTools '')를 확정해 여기 추가할 것.
//    잘못된 플래그로 기동 실패를 막기 위해 기본은 비움.
const TOOL_RESTRICTION_ARGS = [];

// 답변 모델: 기본 Sonnet, 메시지에 -o 붙이면 Opus (app.js에서 useOpus 판단)
const MODEL_CHAT = process.env.SECBOT_MODEL_CHAT || 'claude-sonnet-5';
const MODEL_OPUS = process.env.SECBOT_MODEL_OPUS || 'claude-opus-4-8';

// claude -p 를 실행하고 stdout 문자열을 반환. 실패/타임아웃/비정상 종료 시 null.
function run(prompt, model, tools) {
  return new Promise((resolve) => {
    const bin = process.env.CLAUDE_BIN || 'claude';
    const args = ['-p', '--output-format', 'text', ...TOOL_RESTRICTION_ARGS];
    if (model) args.push('--model', model);
    if (Array.isArray(tools) && tools.length) args.push('--allowedTools', ...tools);

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

  return run(parts.join('\n'), useOpus ? MODEL_OPUS : MODEL_CHAT, WEB_TOOLS);
}

// 문서 생성 사양 만들기: 사용자 요청 → kordoc generate 파라미터(JSON) 하나.
// 반환 {preset, filename, markdown, doc_head?, doc_foot?, approval?} 또는 null(실패).
async function buildDocSpec(instruction, context, facts, useOpus) {
  let gr = '';
  try { gr = await rules.globalRules(); } catch { gr = ''; }
  const grBlock = gr && gr.trim() ? '\n\n[기관 전역 규칙 — 기관명·발신명의 등 참고]\n' + gr.trim() : '';

  const system =
    '너는 한국 행정 공문서 작성기다. 사용자 요청을 받아 한글(HWPX) 문서 생성에 필요한 사양을 JSON 하나로만 출력하라(설명·코드블록 금지).\n' +
    '스키마:\n' +
    '{"preset":"기안문|시행문|보고서|계획서|통지|회의록|개조식|보도자료",' +
    '"filename":"확장자 없는 파일명(내용 요약 20자 이내)",' +
    '"doc_head":{"org":"기관명","to":"수신","title":"제목"},' +
    '"doc_foot":{"sender":"발신명의","drafter":"기안자","docNum":"시행번호","phone":"전화"},' +
    '"approval":["담당","팀장","관장"],' +
    '"markdown":"본문"}\n' +
    'doc_head/doc_foot/approval은 기안문·시행문에서 아는 값만 넣고, 모르면 생략하라.\n' +
    '프리셋: 기안문·시행문·알림공문=기안문, 1페이지 요약=보고서, 추진계획=계획서, 안내·공고=통지, 회의록=회의록, 표지·목차 있는 정부 표준보고서=개조식, 보도자료=보도자료.\n' +
    '본문(markdown) 규칙(kordoc): ' +
    '①기안문 본문은 "1. 2. 3." 항목으로 시작하고 하위는 "- " 리스트로(부호는 자동으로 □ ○ - 변환). ' +
    '②"## 제목"=장(보고서·개조식에서 I II III 자동), "# 제목"=표지 제목. ' +
    '③표는 GFM(| 머리 | ... |). "※"로 시작하는 문단=참고. ' +
    '④doc_head.title을 쓰면 본문에 제목을 반복하지 말라.\n' +
    '중요: 사실을 지어내지 말라. 날짜·장소·수치·연락처 등 모르는 값은 [일시] [장소] 처럼 대괄호로 비워 두라. 기관명·발신명의를 모르면 생략하거나 "○○기관"으로 두라.';

  const parts = [system + grBlock + factsBlock(facts)];
  const ctx = serializeContext(context);
  if (ctx) parts.push('\n참고 맥락:\n' + ctx);
  parts.push('\n문서 요청:\n' + instruction);

  const out = await run(parts.join('\n'), useOpus ? MODEL_OPUS : MODEL_CHAT);
  if (!out) return null;
  try {
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const spec = JSON.parse(m[0]);
    if (!spec || !spec.markdown || !String(spec.markdown).trim()) return null;
    return spec;
  } catch {
    return null;
  }
}

// 구글 드라이브 문서 사양 만들기: 요청 → {name, html}(doc) 또는 {name, rows}(sheet). 실패 시 null.
async function buildDriveDoc(kind, instruction, context, facts, useOpus) {
  let gr = '';
  try { gr = await rules.globalRules(); } catch { gr = ''; }
  const grBlock = gr && gr.trim() ? '\n\n[기관 전역 규칙 참고]\n' + gr.trim() : '';

  const schema = kind === 'sheet'
    ? '구글 시트(스프레드시트)용. JSON 하나만 출력: {"name":"파일명(20자 이내)","rows":[["헤더1","헤더2"],["값","값"]]}. 첫 행은 머리글, 숫자도 문자열로. 모르는 값은 빈칸("").'
    : '구글 문서(Docs)용. JSON 하나만 출력: {"name":"파일명(20자 이내)","html":"<h1>제목</h1><p>...</p>"}. html은 본문 조각(제목 h1/h2, 문단 p, 목록 ul/li, 표 table). 인라인 스타일은 최소화. 모르는 값은 [ ]로 비운다.';

  const system =
    '너는 한국 행정문서 작성기다. 아래 요청을 ' + (kind === 'sheet' ? '구글 시트' : '구글 문서') + ' 데이터로 변환하라. ' +
    schema + ' 설명·코드블록 금지, JSON만 출력. 사실을 지어내지 말 것.';

  const parts = [system + grBlock + factsBlock(facts)];
  const ctx = serializeContext(context);
  if (ctx) parts.push('\n참고 맥락:\n' + ctx);
  parts.push('\n요청:\n' + instruction);

  const out = await run(parts.join('\n'), useOpus ? MODEL_OPUS : MODEL_CHAT);
  if (!out) return null;
  try {
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const spec = JSON.parse(m[0]);
    if (kind === 'sheet') {
      if (!Array.isArray(spec.rows) || spec.rows.length === 0) return null;
    } else if (!spec.html || !String(spec.html).trim()) {
      return null;
    }
    return spec;
  } catch {
    return null;
  }
}

// 구글 슬라이드 사양 만들기: 요청 → {name, slides:[{type?,title,subtitle?,bullets?}]}. 실패 시 null.
async function buildSlides(instruction, context, facts, useOpus) {
  let gr = '';
  try { gr = await rules.globalRules(); } catch { gr = ''; }
  const grBlock = gr && gr.trim() ? '\n\n[기관 전역 규칙 참고]\n' + gr.trim() : '';

  const system =
    '너는 발표 슬라이드 기획자다. 요청을 구글 슬라이드용 JSON 하나로만 출력하라(설명·코드블록 금지).\n' +
    '스키마: {"name":"파일명(20자 이내)","slides":[' +
    '{"type":"title","title":"제목","subtitle":"부제 또는 기관·날짜"},' +
    '{"title":"슬라이드 제목","bullets":["핵심 항목",{"text":"상위 항목","level":0},{"text":"하위 설명","level":1}]}]}\n' +
    '규칙: 첫 슬라이드는 type=title 표지. 이후 슬라이드는 title+bullets. 한 슬라이드 bullets는 3~6개, 각 항목은 한 줄로 간결히(개조식). level은 0(기본)~2. 전체 5~12장 내. 사실을 지어내지 말고 모르는 값은 [ ]로 비운다.';

  const parts = [system + grBlock + factsBlock(facts)];
  const ctx = serializeContext(context);
  if (ctx) parts.push('\n참고 맥락:\n' + ctx);
  parts.push('\n요청:\n' + instruction);

  const out = await run(parts.join('\n'), useOpus ? MODEL_OPUS : MODEL_CHAT);
  if (!out) return null;
  try {
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const spec = JSON.parse(m[0]);
    if (!Array.isArray(spec.slides) || spec.slides.length === 0) return null;
    return spec;
  } catch {
    return null;
  }
}

function stripFence(s) {
  let t = String(s).trim();
  t = t.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  return t.trim();
}

// 기존 문서 수정: 원본 마크다운 + 요청 → 수정된 "전체 마크다운"(kordoc patch용). 실패 시 null.
async function editDocMarkdown(originalMd, instruction, useOpus) {
  const system =
    '아래는 한글 문서를 마크다운으로 변환한 원본이다. 사용자 요청에 따라 수정한 "전체 마크다운"을 그대로 출력하라. ' +
    '규칙: 문서의 구조·표·항목·머리말·문단 순서를 그대로 유지하고, 요청과 직접 관련된 부분만 최소한으로 바꾼다. ' +
    '없던 내용을 임의로 지어내지 말고, 설명·인사말·코드블록 없이 수정된 마크다운 본문만 출력하라.';
  const prompt = system + '\n\n[원본 마크다운]\n' + originalMd + '\n\n[수정 요청]\n' + instruction + '\n\n[수정된 전체 마크다운]';
  const out = await run(prompt, useOpus ? MODEL_OPUS : MODEL_CHAT);
  if (!out) return null;
  return stripFence(out);
}

// 서식 빈칸 채우기: 필드 목록 + 요청 → {라벨:값} JSON. 실패 시 null.
async function mapFormFields(fieldsDump, instruction, useOpus) {
  const system =
    '아래는 한글 서식 문서의 빈칸(필드) 목록이다. 사용자 요청에서 각 필드에 채울 값을 뽑아 JSON 하나로만 출력하라(설명 금지). ' +
    '형식 {"필드라벨":"값"}. 목록에 있는 라벨만 사용하고, 값을 알 수 없는 필드는 생략하라.';
  const prompt = system + '\n\n[필드 목록]\n' + fieldsDump + '\n\n[요청]\n' + instruction + '\n\n[JSON]';
  const out = await run(prompt, useOpus ? MODEL_OPUS : MODEL_CHAT);
  if (!out) return null;
  try {
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
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
    '{"type":"draft"} — 문서·메일 초안을 "텍스트로" 원할 때(채팅으로 답)\n' +
    '{"type":"document_create","data":{"instruction":"문서로 만들 요청 전체(형식·제목·내용 포함)"}} — 공문·기안문·보고서·계획서·통지·회의록 등을 한글(hwpx) "파일"로 만들어달라는 요청. "한글로/hwpx로/공문서로/기안문으로 만들어·작성해·뽑아줘"처럼 한글 파일 산출을 원하면 이것. 단순 텍스트 초안은 draft.\n' +
    '{"type":"gdoc_create","data":{"instruction":"..."}} — "구글 문서/구글 닥스/드라이브에 문서로" 만들어달라는 요청(브라우저 편집용). 한글·공문 요청은 document_create 로.\n' +
    '{"type":"gsheet_create","data":{"instruction":"..."}} — "구글 시트/스프레드시트로/표로 정리해서" 만들어달라는 요청(드라이브 저장).\n' +
    '{"type":"gslide_create","data":{"instruction":"..."}} — "구글 슬라이드/발표자료/PPT로" 만들어달라는 요청(드라이브 저장).\n' +
    '{"type":"drive_search","data":{"query":"검색어(핵심 키워드)"}} — "드라이브에서 ~ 찾아줘/검색해줘"처럼 드라이브 파일을 찾는 요청.\n' +
    '{"type":"drive_copy","data":{"number":정수|null,"query":"검색어"|null,"newName":"새 파일명"|null}} — "그거/N번 사본 만들어줘/복제해줘"처럼 찾은 파일의 사본을 만드는 요청. 직전 검색목록의 번호는 number.\n' +
    '{"type":"nas_search","data":{"query":"검색어(핵심 키워드)"}} — "NAS/나스/공유폴더/네트워크드라이브에서 ~ 찾아줘"처럼 NAS 파일을 찾는 요청.\n' +
    '{"type":"nas_copy","data":{"number":정수|null,"query":"검색어"|null}} — 직전 NAS 검색 결과의 파일을 사본으로 구글 드라이브에 올리는 요청. "N번/그거/○○ 파일을 (구글)드라이브에 올려줘·가져와줘·복사해줘·업로드해줘" 등. 목록 번호를 말하면 number, 파일명 일부(예: 운영지원팀)를 말하면 query. **직전에 NAS 파일 목록을 보여준 뒤 "~을 드라이브에 올려줘"류 발화는 chat이 아니라 nas_copy로 분류하라.**\n' +
    '{"type":"reminder_create","data":{"at":"YYYY-MM-DDTHH:mm:ss+09:00"|null,"message":"..."}}\n' +
    '{"type":"reminder_list"}\n' +
    '{"type":"reminder_cancel","data":{"number":정수|null}}\n' +
    '{"type":"todo_add","data":{"text":"할 일 내용","due":"YYYY-MM-DDTHH:mm:ss+09:00"|null}} — "해야 할 일/할 일 목록에 넣어줘·추가해줘". 마감·기한이 언급되면 due를 채우고(예:"금요일까지"→그날 18:00), 없으면 null. 리마인더와 달리 정시 알림은 아니다.\n' +
    '{"type":"todo_list"} — "할 일 목록/해야 할 일 보여줘"\n' +
    '{"type":"briefing"} — "오늘 브리핑/오늘 뭐 있어/오늘 일정과 할 일 정리해줘"처럼 오늘 일정+할일+알림 요약 요청.\n' +
    '{"type":"action_items_extract"} — "이 회의(록)에서 할 일/실행항목 뽑아 목록에 넣어줘, 회의 내용 정리해서 할 일 등록"처럼 회의 내용에서 후속 할 일을 추출해 등록하는 요청. (단순히 회의록 문서를 만드는 것은 document_create)\n' +
    '{"type":"todo_done","data":{"number":정수|null}} — "N번 완료/했어/끝냈어/목록에서 지워"\n' +
    '구분: "목록에 넣어줘/할 일 추가"처럼 시각 없이 적어두면 todo_add. "언제 알려줘/리마인드/정시에 알림"처럼 특정 시각 알림이면 reminder_create.\n' +
    '{"type":"calendar_create","data":{"title":"...","startISO":"...+09:00","endISO":"...+09:00"|null,"shared":true|false}}\n' +
    '{"type":"calendar_list","data":{"fromISO":"...+09:00"|null,"toISO":"...+09:00"|null,"shared":true|false}}\n' +
    '{"type":"calendar_delete","data":{"number":정수|null,"query":"검색어"|null,"shared":true|false}}\n' +
    '{"type":"calendar_update","data":{"number":정수|null,"query":"검색어"|null,"shared":true|false,"changes":{"title":"..."|null,"startISO":"...+09:00"|null,"endISO":"...+09:00"|null}}}\n' +
    'shared: "센터/공유/전체/공지/센터 캘린더" 일정을 뜻하면 true, 개인 일정이면 false(기본).\n' +
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

// 회의 내용/회의록에서 후속 실행 항목을 뽑아 [{text, due, owner}] 배열로. 최대 15개, 없으면 [].
async function extractActionItems(sourceText, nowIsoKST) {
  const prompt =
    `현재 시각(KST)=${nowIsoKST}. 아래는 회의 내용(또는 회의록)이다. 후속으로 처리해야 할 실행 항목(action item)만 뽑아 JSON 배열로만 출력하라(설명·코드블록 금지). ` +
    '형식 [{"text":"할 일 내용(간결히, 한 줄)","due":"YYYY-MM-DDTHH:mm:ss+09:00"|null,"owner":"담당자(있으면)"|null}]. ' +
    '기한이 언급되면 due를 채우고 없으면 null. 단순 논의·정보 공유는 제외하고 "해야 할 일"만. 없으면 [] 출력. 최대 15개.\n\n' +
    sourceText;

  const out = await run(prompt);
  if (!out) return [];
  try {
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.text === 'string' && x.text.trim())
      .slice(0, 15)
      .map((x) => ({ text: x.text.trim(), due: x.due || null, owner: (x.owner && String(x.owner).trim()) || null }));
  } catch {
    return [];
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

module.exports = { ask, parseReminder, interpret, extractFacts, buildDocSpec, buildDriveDoc, buildSlides, editDocMarkdown, mapFormFields, extractActionItems };
