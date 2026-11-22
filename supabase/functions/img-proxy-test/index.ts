// 핫딜 사진 중계 — 카드 뽑기(cards.html)가 브라우저 캔버스에 다른 몰 사진을 실을 수 있게 (2026-11-01)
//
// 왜: 11번가·쿠팡·오늘의집 사진은 CORS 머리말이 없어 html2canvas 가 못 그린다(캔버스 오염) → 핫딜카드 사진 칸이 비었다(11-01 실측 26건 중 절반).
//     서버가 대신 받아 `Access-Control-Allow-Origin: *` 를 붙여 돌려주면 브라우저가 캔버스에 실을 수 있다.
// 호출: GET /functions/v1/img-proxy?u=<사진 주소(encodeURIComponent)>
// 지킬 것: ① 허용 호스트만(핫딜 사진이 실제로 오는 몰 CDN — hotdeals.img_url 실측 17개, 열린 중계기가 되지 않게)
//         ② 응답이 image/* 일 때만 ③ 5MB 상한 ④ 하루 캐시(브라우저·CDN) ⑤ 전송량: 카드 한 번에 약 30KB×26 ≈ 1MB, 하루 몇 번이라 무료 한도(5GB/월)에 영향 없음
// 배포: supabase functions deploy img-proxy --no-verify-jwt
const ALLOW = /(^|\.)(coupang\.com|coupangcdn\.com|toss\.im|011st\.com|gmarket\.co\.kr|lotteon\.com|ohousecdn\.com|bbhd\.kr|boribori\.co\.kr|pstatic\.net|kakaocdn\.net|ssgcdn\.com|momcalendar\.com|supabase\.co|auction\.co\.kr|lotteimall\.com|ssg\.com|kurly\.com|wemakeprice\.com|tmon\.kr|oliveyoung\.co\.kr|musinsa\.com|29cm\.co\.kr|naver\.com|pstatic\.net)$/i;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const MAX = 5 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const u = new URL(req.url).searchParams.get('u') || '';
  let target: URL;
  try { target = new URL(u); } catch { return new Response('bad url', { status: 400, headers: CORS }); }
  if (!/^https?:$/.test(target.protocol) || !ALLOW.test(target.hostname)) return new Response('host not allowed', { status: 403, headers: CORS });
  try {
    // 리다이렉트는 직접 따라가며 매번 프로토콜·호스트를 허용 목록으로 다시 확인한다 — redirect:'follow' 는 허용 안 된 주소까지 서버가 대신 요청해 주는 구멍이었다(2026-11-02 코덱스 지적)
    let cur = target, r: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      r = await fetch(cur.toString(), { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', Accept: 'image/*,*/*;q=0.8', Referer: cur.origin + '/' }, redirect: 'manual' });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        if (!loc) return new Response('bad redirect', { status: 502, headers: CORS });
        let next: URL;
        try { next = new URL(loc, cur); } catch { return new Response('bad redirect', { status: 502, headers: CORS }); }
        if (!/^https?:$/.test(next.protocol) || !ALLOW.test(next.hostname)) return new Response('redirect host not allowed', { status: 403, headers: CORS });
        cur = next; r = null; continue;
      }
      break;
    }
    if (!r) return new Response('too many redirects', { status: 502, headers: CORS });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//i.test(ct)) return new Response('not image', { status: 502, headers: CORS });
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX) return new Response('too big', { status: 413, headers: CORS });
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX) return new Response('too big', { status: 413, headers: CORS });
    return new Response(buf, { status: 200, headers: { ...CORS, 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400', 'X-Robots-Tag': 'noindex' } });
  } catch (e) {
    return new Response('fetch failed: ' + String(e).slice(0, 80), { status: 502, headers: CORS });
  }
});
