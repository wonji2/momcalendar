// 맘캘린더 데이터 서버 우회로 — api.momcalendar.com → hycaqsqeogjtbscmzrtm.supabase.co
//
// 왜: 일부 손님 망(공유기 DNS 필터·보안앱·통신사)이 *.supabase.co 를 막아 로그인·공구목록이 통째로 안 됐다
//     (2026-09-22 회원 제보, 9/2 같은 회원). 우리 도메인으로도 같은 서버에 닿게 해서 사이트가 자동 우회한다.
// 배포: node tools/daily/cf_api_proxy.mjs deploy   (Cloudflare API 로 올린다. wrangler 불필요)
// 확인: node tools/daily/cf_api_proxy.mjs check
// 사이트 쪽: index.html 맨 앞 <script> 의 fetch 감싸기(mc_api_base) 가 supabase.co 실패 시 이 주소로 다시 보낸다.
//
// 통과시키는 경로: /rest/v1/* /functions/v1/* /auth/v1/* /storage/v1/*  (그 외 404)
// 헤더·본문·메서드는 그대로 전달. CORS 는 여기서 확실히 붙인다(브라우저 직접 호출용).

const ORIGIN = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const ALLOW = /^\/(rest|functions|auth|storage)\/v1\//;

function cors(req) {
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers',
    (req && req.headers.get('Access-Control-Request-Headers')) ||
    'authorization, x-client-info, apikey, content-type, prefer, range, x-cron-secret');
  h.set('Access-Control-Expose-Headers', 'content-range, content-type, x-momcal-proxy');
  h.set('Access-Control-Max-Age', '86400');
  return h;
}

export default {
  async fetch(req) {
    const url = new URL(req.url);

    // 살아있나 확인용 — 사이트가 아니라 사람·도구가 본다
    if (url.pathname === '/__ping') {
      const h = cors(req); h.set('Content-Type', 'text/plain; charset=utf-8'); h.set('Cache-Control', 'no-store');
      return new Response('ok momcal-api-proxy ' + (req.cf && req.cf.colo || ''), { headers: h });
    }
    if (!ALLOW.test(url.pathname)) return new Response('not found', { status: 404, headers: cors(req) });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });

    const h = new Headers(req.headers);
    h.delete('host');                       // 원서버 이름은 fetch 가 알아서 넣는다
    h.set('X-Momcal-Proxy', '1');
    const hasBody = !(req.method === 'GET' || req.method === 'HEAD');
    let res;
    try {
      res = await fetch(ORIGIN + url.pathname + url.search, {
        method: req.method, headers: h, body: hasBody ? req.body : undefined, redirect: 'manual',
      });
    } catch (e) {
      const eh = cors(req); eh.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ error: 'upstream_unreachable', detail: String(e).slice(0, 200) }), { status: 502, headers: eh });
    }
    const out = new Headers(res.headers);
    const c = cors(req); c.forEach((v, k) => out.set(k, v));
    out.set('X-Momcal-Proxy', '1');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  },
};
