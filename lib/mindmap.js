// [마인드맵 연동] 사내 마인드맵 앱(scv:3000) API 호출. 봇 전용 계정(JWT)으로 맵 생성.
// Claude는 계층 구조(root/branches)만 만들고, 좌표(x/y)는 여기서 방사형으로 계산한다.

const ROOT_COLOR = '#58a6ff';
const PALETTE = ['#56d364', '#e3b341', '#f78166', '#d2a8ff', '#58a6ff', '#79c0ff', '#ffa657'];
const STEP = 280; // 깊이 1단계당 반경(px)

function base() { return process.env.MINDMAP_URL; }
function configured() {
  return !!(process.env.MINDMAP_URL && process.env.MINDMAP_BOT_EMAIL && process.env.MINDMAP_BOT_PASSWORD);
}

let cachedToken = null;
async function login() {
  const r = await fetch(base() + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.MINDMAP_BOT_EMAIL, password: process.env.MINDMAP_BOT_PASSWORD }),
  });
  if (!r.ok) throw new Error('login ' + r.status);
  const j = await r.json();
  cachedToken = j.token;
  return cachedToken;
}
async function tokenGet() { return cachedToken || login(); }

// 401이면 재로그인 후 1회 재시도
async function apiFetch(path, opts) {
  let t = await tokenGet();
  const build = (tok) => fetch(base() + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + tok } });
  let res = await build(t);
  if (res.status === 401) { t = await login(); res = await build(t); }
  return res;
}

function leaves(n) {
  const ch = (n && n.children) || [];
  if (!ch.length) return 1;
  return ch.reduce((s, c) => s + leaves(c), 0);
}

// 중첩 트리 spec {root, branches:[{text, children:[...]}]} → 앱 data JSON(방사형 좌표)
function buildData(spec) {
  const nodes = [];
  let id = 1;
  const rootId = id++;
  nodes.push({ id: rootId, type: 'mindmap', text: String(spec.root || spec.title || '주제').slice(0, 200), x: 0, y: 0, color: ROOT_COLOR, parentId: null, layout: 'radial', memos: [''] });

  const branches = Array.isArray(spec.branches) ? spec.branches : [];
  const totalLeaves = branches.reduce((s, b) => s + leaves(b), 0) || 1;
  const TAU = Math.PI * 2;
  let angle = -Math.PI / 2; // 12시 방향부터 시계방향

  function place(node, parentId, depth, a0, a1, color) {
    const mid = (a0 + a1) / 2;
    const r = depth * STEP;
    const nid = id++;
    nodes.push({ id: nid, type: 'mindmap', text: String(node.text || '').slice(0, 200), x: Math.round(r * Math.cos(mid)), y: Math.round(r * Math.sin(mid)), color, parentId, layout: 'inherit', memos: [''] });
    const ch = node.children || [];
    if (ch.length) {
      const tl = ch.reduce((s, c) => s + leaves(c), 0) || 1;
      let cur = a0;
      for (const c of ch) { const cs = (leaves(c) / tl) * (a1 - a0); place(c, nid, depth + 1, cur, cur + cs, color); cur += cs; }
    }
  }

  branches.forEach((b, i) => {
    const color = PALETTE[i % PALETTE.length];
    const span = (leaves(b) / totalLeaves) * TAU;
    place(b, rootId, 1, angle, angle + span, color);
    angle += span;
  });

  return { v: 2, nextId: id, nextRelId: 1, vp: { x: 0, y: 0, s: 1 }, nodes, relationships: [], shortcutConfig: {}, edgeStyle: 'bezier' };
}

// 맵 생성. {ok, id, link} / {ok:false, error}
async function createMap(title, data) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const res = await apiFetch('/api/maps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: String(title || '마인드맵').slice(0, 200), data }) });
    if (!res.ok) return { ok: false, error: 'http ' + res.status };
    const j = await res.json();
    return { ok: true, id: j.id, link: base() + '/?map=' + j.id };
  } catch (e) { return { ok: false, error: (e && e.message) || 'unknown' }; }
}

// 맵 삭제(봇 소유 맵만). 테스트 정리용.
async function deleteMap(id) {
  try { const res = await apiFetch('/api/maps/' + id, { method: 'DELETE' }); return { ok: res.ok }; }
  catch (e) { return { ok: false, error: (e && e.message) || 'unknown' }; }
}

module.exports = { configured, buildData, createMap, deleteMap };
