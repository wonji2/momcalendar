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
//   30분·15분이어도 손님 화면이 늦어 보이지 않는다(월 1.1GB). 별칭은 거의 안 바뀌어 6시간.
//   🔑 급히 반영하려면 **node tools/daily/cf_api_proxy.mjs purge** (2026-10-14 신설). 배포만으로는 아래 공유 캐시단이 안 비워진다.
const CACHE_TTL = { hotdeals: 900, gonggu: 900, banners_public: 180, bot_alias: 21600, bot_alias_deny: 21600, sellers: 1800, experiences: 1800, brand_block: 21600, live_shows: 3600 };   // live_shows: 라방 편성표(6시간마다 수집, 2026-10-24)
const CACHE_RE = /^\/rest\/v1\/(hotdeals|gonggu|banners_public|bot_alias|bot_alias_deny|sellers|experiences|brand_block|live_shows)(?:\?|$)/;
// 공개 저장소 사진(배너·카드 이미지)은 파일 이름에 시각이 박혀 있어 내용이 바뀌지 않는다 → 하루 붙잡아 두고 브라우저에도 하루 물린다.
// 활성 배너 3장이 600KB 인데 손님마다 새로 받아가면 월 2GB 다(2026-09-29 실측). 비공개(object/sign·authenticated)는 건드리지 않는다.
const IMG_RE = /^\/storage\/v1\/object\/public\//;
const IMG_TTL = 86400;

// 배포 시각. cf_api_proxy.mjs 가 올릴 때마다 새 값으로 바꿔 넣는다.
// 캐시 열쇠에 섞여 있어 **배포 = 캐시 비우기** 가 된다(배너·공구를 고치고 바로 보이게 하려고, 2026-10-01).
const BUILD = '__BUILD__';

// 🤖 AI·대량 수집 금지 표지판(2026-10-27 사장님 지시 「우리 거 긁지 말라고 AI 한테 말하는 경고문」)
//   데이터 서버에는 robots.txt 가 아예 없었다(404). 막는 벽은 비공개 확장(privateGuard)이 맡고,
//   여기는 「긁지 말라」는 의사를 기계가 읽는 꼴로 밝힌다: /robots.txt + 모든 응답 머리말(cors 에서 붙임).
//   근거 조항: 이용약관 제13조(자동 수집·복제 및 AI 학습 금지). 베껴 간 쪽에 문제 삼을 때 이 표지판과 약관이 증거다.
//   사이트(momcalendar.com) 쪽 robots.txt 는 tools/seo/build.ps1 이 매일 다시 쓴다 — 거기서 같은 뜻을 밝힌다(검색은 허용·AI 학습만 금지).
const ROBOTS = [
  '# momcalendar.com data server (api.momcalendar.com)',
  '# Automated collection, scraping, and AI/ML training are prohibited.',
  '# 맘캘린더 데이터 서버입니다. 자동 수집·복제·AI 학습을 금지합니다. 이용약관 제13조: https://momcalendar.com/terms.html',
  'User-agent: *',
  'Disallow: /',
  'Content-Signal: search=no, ai-input=no, ai-train=no',
  '',
].join(String.fromCharCode(10));

function cors(req) {
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers',
    (req && req.headers.get('Access-Control-Request-Headers')) ||
    'authorization, x-client-info, apikey, content-type, prefer, range, range-unit, x-cron-secret');
  h.set('Access-Control-Expose-Headers', 'content-range, content-type, x-momcal-proxy, x-momcal-cache');
  h.set('Access-Control-Max-Age', '86400');
  // 🤖 AI 학습·자동 수집 금지 표시 — 모든 응답에(2026-10-27). X-Robots-Tag noai 는 널리 쓰는 관례, Content-Usage 는 IETF aipref 초안 꼴.
  h.set('X-Robots-Tag', 'noindex, nofollow, noai, noimageai');
  h.set('Content-Usage', 'train-ai=n, ai-input=n, search=n');
  h.set('X-Momcal-Notice', 'Automated collection and AI training prohibited. Terms: https://momcalendar.com/terms.html (art. 13)');
  h.set('tdm-reservation', '1'); h.set('tdm-policy', 'https://momcalendar.com/terms.html');   // TDM Reservation Protocol(W3C, EU DSM 4조) — 데이터 서버는 TDM 전부 유보
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
  const parts = [BUILD, url.pathname + url.search, req.headers.get('range') || '', req.headers.get('range-unit') || '', req.headers.get('prefer') || '', req.headers.get('accept') || ''];
  return new Request('https://api.momcalendar.com/__cache/' + encodeURIComponent(parts.join('|')), { method: 'GET' });
}

// 🛟 비상 사본(2026-10-27 — DB 가 09:44~10:33 49분 멈춰 손님 화면이 빈 채였다. 사장님 「거의 1시간 먹통인데 바로 고치는 기능이 없어?」)
//   성공한 손님용 목록 응답(위 CACHE_RE)을 **24시간 따로** 보관해 두고, 원서버가 죽으면(연결 실패·20초 초과·5xx) 그 사본을 X-Momcal-Cache: STALE 로 준다.
//   손님은 빈 화면 대신 마지막 목록을 본다(날짜 상태는 화면이 다시 계산한다). 열쇠에 BUILD 를 넣지 않아 배포해도 남고,
//   날짜(YYYY-MM-DD)는 D 로 바꿔 자정이 지난 첫 요청도 어제 사본을 쓴다. 사진·쓰기·개인 요청은 해당 없음(ttl 0).
//   ⚠ 원서버 시간제한은 캐시 대상 GET 에만 건다 — 함수(kakao-skill 등)·쓰기는 원래대로 기다린다.
const STALE_TTL = 86400, ORIGIN_TIMEOUT_MS = 20000;
function staleKey(req, url) {
  const parts = [url.pathname + url.search.replace(/\d{4}-\d{2}-\d{2}/g, 'D'), req.headers.get('range') || '', req.headers.get('range-unit') || '', req.headers.get('prefer') || '', req.headers.get('accept') || ''];
  return new Request('https://api.momcalendar.com/__stale/' + encodeURIComponent(parts.join('|')), { method: 'GET' });
}
async function serveStale(req, url, why) {
  let hit = null; try { hit = await caches.default.match(staleKey(req, url)); } catch (_) {}
  if (!hit) return null;
  const out = new Headers(hit.headers); cors(req).forEach((v, k) => out.set(k, v));
  out.set('X-Momcal-Proxy', '1'); out.set('X-Momcal-Cache', 'STALE'); out.set('X-Momcal-Stale-Why', why); out.set('Cache-Control', 'no-cache, max-age=0');
  return new Response(hit.body, { status: hit.status, headers: out });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 살아있나 확인용 — 사이트가 아니라 사람·도구가 본다
    if (url.pathname === '/__ping') {
      const h = cors(req); h.set('Content-Type', 'text/plain; charset=utf-8'); h.set('Cache-Control', 'no-store');
      return new Response('ok momcal-api-proxy ' + (req.cf && req.cf.colo || '') + ' build=' + BUILD, { headers: h });
    }
    if (url.pathname === '/.well-known/tdmrep.json') {
      const h = cors(req); h.set('Content-Type', 'application/json; charset=utf-8'); h.set('Cache-Control', 'public, max-age=3600');
      return new Response('[{"location":"/","tdm-reservation":1,"tdm-policy":"https://momcalendar.com/terms.html"}]', { headers: h });
    }
    if (url.pathname === '/robots.txt') {
      const h = cors(req); h.set('Content-Type', 'text/plain; charset=utf-8'); h.set('Cache-Control', 'public, max-age=3600');
      return new Response(ROBOTS, { headers: h });
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
    // 🪣 2026-10-13 — **지점끼리 나눠 쓰는 캐시**를 하나 더 건다.
    //   caches.default(위) 는 Cloudflare 문서대로 **그 데이터센터 안에서만** 산다. 실측 10/12 엣지가 **28곳**이라
    //   같은 목록을 28번 Supabase 까지 받아왔다(미스 5,400건 · 하루 241MB). fetch 에 cf 옵션을 주면
    //   Cloudflare 자체 캐시에 올라가고, Tiered Cache 가 켜져 있으면 아랫단이 윗단에서 받아 간다.
    //   ⚠ 🔴 **Range·Prefer 가 붙은 요청엔 절대 걸지 않는다.** Cloudflare 캐시는 **URL 로만** 구분하고
    //      사용자 지정 캐시 키는 Enterprise 전용이다 → 공구 목록처럼 **URL 이 같고 Range 로 쪽을 나누는** 요청에
    //      걸면 1쪽 자리에 2쪽이 나간다.
//      ✅ 2026-10-14: 공구는 index.html 이 **limit/offset 을 URL 로** 옮겨 쪽마다 주소가 달라졌다 → 이제 여기 탄다.
//         (Range 로 오는 옛 손님·도구는 그대로 shareable=false 로 빠진다)
//   🔴 이 캐시는 **배포해도 안 비워진다** — 열쇠가 원서버 URL 이라 BUILD 가 안 들어간다.
//      비우려면 node tools/daily/cf_api_proxy.mjs purge (deploy 끝에서도 자동으로 부른다).
    //   ⚠ 오류 응답은 캐시하지 않는다(4xx·5xx TTL 0).
    const shareable = ttl && !req.headers.get('range') && !req.headers.get('prefer');
    const cfOpt = shareable
      ? { cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '300-399': 0, '400-499': 0, '500-599': 0 } } }
      : {};
    let res;
    const ac = new AbortController(); const tmr = ttl ? setTimeout(() => ac.abort(), ORIGIN_TIMEOUT_MS) : null;   // 🛟 목록 GET 만 20초 제한
    try {
      res = await fetch(ORIGIN + url.pathname + url.search, {
        method: req.method, headers: h, body: hasBody ? req.body : undefined, redirect: 'manual',
        ...cfOpt, ...(ttl ? { signal: ac.signal } : {}),
      });
    } catch (e) {
      if (ttl) { const st = await serveStale(req, url, 'unreachable'); if (st) return st; }   // 🛟 원서버 못 닿음 → 비상 사본
      const eh = cors(req); eh.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ error: 'upstream_unreachable', detail: String(e).slice(0, 200) }), { status: 502, headers: eh });
    } finally { if (tmr) clearTimeout(tmr); }
    if (ttl && res.status >= 500) { const st = await serveStale(req, url, 'origin_' + res.status); if (st) return st; }   // 🛟 5xx(522·503 등) → 비상 사본
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
      const st = new Headers(sh); st.set('Cache-Control', 'public, s-maxage=' + STALE_TTL + ', max-age=0');   // 🛟 비상 사본은 24시간
      ctx.waitUntil(Promise.all([
        caches.default.put(key, new Response(body, { status: res.status, headers: sh })),
        IMG_RE.test(url.pathname) ? Promise.resolve() : caches.default.put(staleKey(req, url), new Response(body, { status: res.status, headers: st })),
      ]));
      return new Response(body, { status: res.status, statusText: res.statusText, headers: out });
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  },
};
