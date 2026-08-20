// [슬랙 캔버스] 봇 소유 캔버스 생성·갱신(canvases.create/edit). 봇이 만든 캔버스만 편집 가능(슬랙 정책).
const { WebClient } = require('@slack/web-api');

function configured() {
  return !!process.env.SLACK_BOT_TOKEN;
}

function web() {
  return new WebClient(process.env.SLACK_BOT_TOKEN);
}

// 캔버스 생성. {ok, canvasId, url} / {ok:false,error}
async function create({ title, markdown }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const w = web();
    const r = await w.apiCall('canvases.create', { title: title || '문서', document_content: { type: 'markdown', markdown: markdown || '' } });
    const id = r.canvas_id;
    let url = '';
    try { const info = await w.apiCall('files.info', { file: id }); url = (info.file && info.file.permalink) || ''; } catch {}
    return { ok: true, canvasId: id, url };
  } catch (e) {
    return { ok: false, error: (e.data && e.data.error) || e.message };
  }
}

// 캔버스 끝에 내용 추가(봇 소유 캔버스만). {ok} / {ok:false,error}
async function append({ canvasId, markdown }) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const w = web();
    await w.apiCall('canvases.edit', { canvas_id: canvasId, changes: [{ operation: 'insert_at_end', document_content: { type: 'markdown', markdown: '\n\n' + (markdown || '') } }] });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e.data && e.data.error) || e.message };
  }
}

module.exports = { configured, create, append };
