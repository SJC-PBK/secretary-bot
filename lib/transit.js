// [대중교통 길찾기] ODsay searchPubTransPath. 카카오 지오코딩으로 좌표 얻어 호출.
// 키: env SECBOT_ODSAY_KEY (URL 인코딩해서 사용).
const kakao = require('./kakao');

function odsayKey() {
  return process.env.SECBOT_ODSAY_KEY || '';
}

function configured() {
  return !!odsayKey() && kakao.configured();
}

// 출발·목적지 문자열 → {ok, origin, dest, totalMin, transfers, payment} / {ok:false,error}
async function transitTime(originQuery, destQuery) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  const o = await kakao.geocode(originQuery);
  if (!o) return { ok: false, error: 'origin_not_found' };
  const d = await kakao.geocode(destQuery);
  if (!d) return { ok: false, error: 'dest_not_found' };
  try {
    const url = `https://api.odsay.com/v1/api/searchPubTransPath?SX=${o.x}&SY=${o.y}&EX=${d.x}&EY=${d.y}&apiKey=${encodeURIComponent(odsayKey())}`;
    const r = await fetch(url);
    const j = await r.json();
    const p = j.result && j.result.path && j.result.path[0];
    if (!p) return { ok: false, error: (j.error && j.error[0] && j.error[0].message) || 'no_route' };
    const info = p.info;
    return {
      ok: true,
      origin: o,
      dest: d,
      totalMin: info.totalTime,
      transfers: (info.busTransitCount || 0) + (info.subwayTransitCount || 0),
      payment: info.payment || 0,
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

module.exports = { configured, transitTime };
