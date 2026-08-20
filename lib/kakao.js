// [길찾기] 카카오 REST API로 주소→좌표(로컬 키워드검색) + 자동차 길찾기(소요시간·거리).
// 키: env SECBOT_KAKAO_REST_KEY (REST API 키). 무료 quota 범위.

function key() {
  return process.env.SECBOT_KAKAO_REST_KEY || '';
}

function configured() {
  return !!key();
}

// 장소/주소 → {name, x(lng), y(lat), address} 또는 null
async function geocode(q) {
  if (!configured() || !q) return null;
  try {
    const url = 'https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query=' + encodeURIComponent(q);
    const r = await fetch(url, { headers: { Authorization: 'KakaoAK ' + key() } });
    if (!r.ok) return null;
    const j = await r.json();
    const d = (j.documents || [])[0];
    return d ? { name: d.place_name, x: d.x, y: d.y, address: d.road_address_name || d.address_name || '' } : null;
  } catch {
    return null;
  }
}

// 출발지·목적지 문자열 → {ok, origin, dest, durationMin, distanceKm} / {ok:false,error}
async function travelTime(originQuery, destQuery) {
  if (!configured()) return { ok: false, error: 'not_configured' };
  try {
    const o = await geocode(originQuery);
    if (!o) return { ok: false, error: 'origin_not_found' };
    const d = await geocode(destQuery);
    if (!d) return { ok: false, error: 'dest_not_found' };
    const url = 'https://apis-navi.kakaomobility.com/v1/directions?origin=' + o.x + ',' + o.y + '&destination=' + d.x + ',' + d.y;
    const r = await fetch(url, { headers: { Authorization: 'KakaoAK ' + key() } });
    if (!r.ok) return { ok: false, error: 'directions_http_' + r.status };
    const j = await r.json();
    const s = j.routes && j.routes[0] && j.routes[0].summary;
    if (!s) return { ok: false, error: 'no_route' };
    return { ok: true, origin: o, dest: d, durationMin: Math.round(s.duration / 60), distanceKm: +(s.distance / 1000).toFixed(1) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'unknown' };
  }
}

module.exports = { configured, geocode, travelTime };
