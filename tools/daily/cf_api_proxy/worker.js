// 맘캘린더 데이터 서버 우회로 + 손님용 목록 캐시 — api.momcalendar.com → hycaqsqeogjtbscmzrtm.supabase.co
//
// 왜(우회로, 2026-09-22): 일부 손님 망(공유기 DNS 필터·보안앱·통신사)이 *.supabase.co 를 막아 로그인·공구목록이 통째로 안 됐다.
//     우리 도메인으로도 같은 서버에 닿게 해서 사이트가 자동 우회한다.
// 왜(캐시, 2026-09-29): Supabase 무료 플랜(사장님 결정)은 전송량 월 5GB. 손님 1명 = 공구목록 53KB + 핫딜 55KB(gzip) 이라
//     하루 1,600명이면 월 5.6GB 로 한도를 넘는다. 손님용 목록(GET·anon 키)만 Cloudflare 엣지에 잠깐 붙잡아 두면
//     Supabase 는 캐시가 빌 때만 응답한다(TTL 5분·지점 2곳이면 월 2GB 아래). 개인 데이터·관리자·쓰기는 절대 캐시하지 않는다.
// 배포: node tools/daily/cf_api_proxy.mjs deploy   (Cloudflare API 로 올린다. wrangler 불필요)
// 확인: node tools/daily/cf_api_proxy.mjs check  ·  캐시: curl -sI "https://api.momcalendar.com/rest/v1/hotdeals?select=id&limit=1" -H "apikey: <anon>" 두 번 → X-Momcal-Cache: MISS 뒤 HIT
// 사이트 쪽: index.html 맨 앞 <script> 의 fetch 감싸기(mc_api_base) — 캐시 대상 GET 은 여기부터, 나머지는 supabase.co 직행이 먼저.
//
// 통과시키는 경로: /rest/v1/* /functions/v1/* /auth/v1/* /storage/v1/*  (그 외 404)
// 헤더·본문·메서드는 그대로 전달. CORS 는 여기서 확실히 붙인다(브라우저 직접 호출용).

const ORIGIN = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const ALLOW = /^\/(rest|functions|auth|storage)\/v1\//;
const ANON = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';

// 캐시 대상 = 손님 누구에게나 같은 공개 목록만. 표 이름 → 붙잡아 두는 초.
// 핫딜은 expires_at 으로 시각에 따라 빠지므로 짧게, 공구·배너는 하루 한 번 바뀌므로 길게.
// ⚠ 공구 15분·배너 3분 — 사장님이 손으로 넣고 바로 확인하신다. 30분은 "안 들어갔나" 하게 만든다(2026-10-01 우랩).
//   공구는 3쪽 126KB 라 짧게 할수록 전송량이 는다: 30분 0.54GB/월 · 15분 0.8GB/월 · 10분 1.6GB/월 → 15분으로 잡았다.
// ⚠ banners_public 만 3분이다 — 배너는 사장님이 손으로 켜고 끄고 바로 확인하신다(2026-10-01 우랩 배너가 15분 안 보였다).
//   크기가 7KB 라 자주 채워도 월 10MB 수준이다.
// 🔑 TTL 이 짧으면 손님이 아니라 **캐시를 다시 채우는 쪽**이 전송량을 먹는다. 계산: (1440/TTL분) × 지점 수(ICN·NRT·HKG 실측 3) × 그 URL 크기.
//   5분이면 공구·핫딜만 월 3.3GB(한도 5GB 의 2/3). 실제 갱신 주기에 맞춰 늘렸다 — 공구는 밤 파싱이 3시간마다, 핫딜은 크론이 하루 몇 번이라
//   30분·15분이어도 손님 화면이 늦어 보이지 않는다(월 1.1GB). 별칭은 거의 안 바뀌어 6시간. 급히 반영하려면 TTL 을 줄이고 배포한다.
const CACHE_TTL = { hotdeals: 900, gonggu: 900, banners_public: 180, bot_alias: 21600, bot_alias_deny: 21600, sellers: 1800, experiences: 1800, brand_block: 21600 };
const CACHE_RE = /^\/rest\/v1\/(hotdeals|gonggu|banners_public|bot_alias|bot_alias_deny|sellers|experiences|brand_block)(?:\?|$)/;
// 공개 저장소 사진(배너·카드 이미지)은 파일 이름에 시각이 박혀 있어 내용이 바뀌지 않는다 → 하루 붙잡아 두고 브라우저에도 하루 물린다.
// 활성 배너 3장이 600KB 인데 손님마다 새로 받아가면 월 2GB 다(2026-09-29 실측). 비공개(object/sign·authenticated)는 건드리지 않는다.
const IMG_RE = /^\/storage\/v1\/object\/public\//;
const IMG_TTL = 86400;

function cors(req) {
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers',
    (req && req.headers.get('Access-Control-Request-Headers')) ||
    'authorization, x-client-info, apikey, content-type, prefer, range, range-unit, x-cron-secret');
  h.set('Access-Control-Expose-Headers', 'content-range, content-type, x-momcal-proxy, x-momcal-cache');
  h.set('Access-Control-Max-Age', '86400');
  return h;
}

// 캐시해도 되는 요청인가: GET · 공개 표 · anon 키 · 관리자/회원 토큰 없음
function cacheTtl(req, url) {
  if (req.method !== 'GET') return 0;
  if (IMG_RE.test(url.pathname)) return IMG_TTL;        // 공개 사진은 키 없이도 누구나 받는 것이라 apikey 검사를 하지 않는다
  const m = url.pathname.match(CACHE_RE); if (!m) return 0;
  if ((req.headers.get('apikey') || '') !== ANON) return 0;
  const auth = req.headers.get('authorization') || '';
  if (auth && auth !== 'Bearer ' + ANON) return 0;            // 관리자 JWT·회원 토큰이면 캐시 밖
  if ((req.headers.get('prefer') || '').indexOf('count=') >= 0) return 0; // count 요청은 드물고 크기 작다 → 그냥 통과
  return CACHE_TTL[m[1]] || 0;
}
// 같은 URL 이라도 Range(페이지)·Prefer 가 다르면 다른 답 → 열쇠에 넣는다. Cache API 는 GET 요청 객체를 열쇠로 받는다
function cacheKey(req, url) {
  const parts = [url.pathname + url.search, req.headers.get('range') || '', req.headers.get('range-unit') || '', req.headers.get('prefer') || '', req.headers.get('accept') || ''];
  return new Request('https://api.momcalendar.com/__cache/' + encodeURIComponent(parts.join('|')), { method: 'GET' });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 살아있나 확인용 — 사이트가 아니라 사람·도구가 본다
    if (url.pathname === '/__ping') {
      const h = cors(req); h.set('Content-Type', 'text/plain; charset=utf-8'); h.set('Cache-Control', 'no-store');
      return new Response('ok momcal-api-proxy ' + (req.cf && req.cf.colo || ''), { headers: h });
    }
    if (!ALLOW.test(url.pathname)) return new Response('not found', { status: 404, headers: cors(req) });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });

    const ttl = cacheTtl(req, url);
    let key = null;
    if (ttl) {
      key = cacheKey(req, url);
      const hit = await caches.default.match(key);
      if (hit) {
        const out = new Headers(hit.headers); cors(req).forEach((v, k) => out.set(k, v));
        out.set('X-Momcal-Proxy', '1'); out.set('X-Momcal-Cache', 'HIT');
        // 🔴 손님 브라우저엔 물리지 않는다(2026-09-29 검증: zone 설정이 4시간을 덮어씌워 마감 핫딜이 계속 보였다).
        //    엣지는 붙잡아 두고 브라우저는 매번 물어본다 — 사진만 예외로 하루 물린다.
        if (!IMG_RE.test(url.pathname)) out.set('Cache-Control', 'no-cache, max-age=0');
        return new Response(hit.body, { status: hit.status, headers: out });
      }
    }

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
    if (ttl) out.set('X-Momcal-Cache', 'MISS');
    if (IMG_RE.test(url.pathname)) { if (res.status === 200 || res.status === 206) out.set('Cache-Control', 'public, max-age=' + IMG_TTL + ', immutable'); }
    else if (ttl) out.set('Cache-Control', 'no-cache, max-age=0');

    // 정상 답(200·206)만 붙잡아 둔다. 오류·빈 답은 다음 손님이 다시 물어본다
    if (ttl && (res.status === 200 || res.status === 206)) {
      const body = await res.arrayBuffer();
      const sh = new Headers(out);
      sh.set('Cache-Control', IMG_RE.test(url.pathname) ? 'public, max-age=' + IMG_TTL + ', immutable' : 'public, s-maxage=' + ttl + ', max-age=0');
      sh.delete('Set-Cookie'); sh.delete('X-Momcal-Cache');
      ctx.waitUntil(caches.default.put(key, new Response(body, { status: res.status, headers: sh })));
      return new Response(body, { status: res.status, statusText: res.statusText, headers: out });
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  },
};
