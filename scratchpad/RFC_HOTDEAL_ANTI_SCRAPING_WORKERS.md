# [RFC / 개발 명세서] 맘캘린더 핫딜 무단 크롤링 방어 L7/L4 엔지니어링 구현 가이드

이 문서는 `r.momcalendar.com` 단축 프록시 엔드포인트를 무단 스크래핑하여 최종 제휴 링크를 탈취하는 자동화 봇을 L7(애플리케이션) 및 WAF(인프라) 계층에서 안전하게 차단하기 위한 개발 구현 명세서입니다.

---

## 1. 핵심 원칙 및 제약조건 (헌법)

1. **정상 메신저/검색 봇 절대 차단 금지 (화이트리스트 필수)**:
   - 카카오톡 단톡방 링크 공유 시 썸네일을 긁어가는 `kakaotalk-scrap`, 페이스북/인스타의 `facebookexternalhit`, 네이버봇, 구글봇은 절대 차단하면 안 됩니다 (단톡방 썸네일 액박 참사 방지).
2. **쿠팡 파트너스 약관 100% 준수**:
   - 쿠팡 홈 강제 튕김이나 Referer 인위적 변조 등 어뷰징 의심 행위는 전면 배제합니다.
   - 정상 유저의 브라우저 클릭은 0.1초 만에 온전한 제휴 상품 페이지로 302 리다이렉트합니다.
3. **Cloudflare 무료 티어 쿼터(일 10만 회) 보존**:
   - 단축 URL 해석 결과에 Cloudflare Edge Cache(`s-maxage=86400`)를 적용하여 봇 유입 시 Supabase DB 과부하 및 Workers CPU 타임 소진을 방어합니다.

---

## 2. Cloudflare Workers (`r.momcalendar.com`) L7 봇 차단 로직

### 2.1 구현 코드 스펙 (`worker.js` / TypeScript)

```javascript
// 1. 화이트리스트: 정상 메신저 미리보기 및 검색엔진 로봇 (절대 차단 금지)
const WHITELIST_BOTS = [
  'kakaotalk-scrap',
  'facebookexternalhit',
  'twitterbot',
  'naverbot',
  'googlebot',
  'bingbot',
  'daumoa'
];

// 2. 블랙리스트: 자동화 크롤러 / 헤드리스 스크래퍼 시그니처
const BLOCKED_SCRAPERS = [
  'python-requests',
  'aiohttp',
  'httpx',
  'scrapy',
  'curl/',
  'wget/',
  'go-http-client',
  'java/',
  'postmanruntime',
  'headlesschrome',
  'puppeteer',
  'selenium'
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ua = (request.headers.get('user-agent') || '').toLowerCase();

    // /hd/ 또는 /deal/ 경로 대상 봇 검증
    if (url.pathname.startsWith('/hd') || url.pathname.startsWith('/deal')) {
      const isWhitelisted = WHITELIST_BOTS.some(bot => ua.includes(bot));

      if (!isWhitelisted) {
        // [1] User-Agent 블랙리스트 탐지
        const isBlocked = BLOCKED_SCRAPERS.some(bot => ua.includes(bot));
        if (isBlocked) {
          return new Response(
            JSON.stringify({ error: 'Forbidden', message: 'Automated scraping is strictly prohibited.' }),
            {
              status: 403,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }
          );
        }

        // [2] 빈 User-Agent 차단
        if (!ua || ua.length < 5) {
          return new Response('Invalid Request Header', { status: 400 });
        }
      }
    }

    // [3] Supabase 단축 URL 조회 및 302 토스 (Edge Cache 적용)
    // 캐시 키를 활용하여 동일 단축 URL에 대해 24시간 엣지 캐싱 적용
    const cache = caches.default;
    let response = await cache.match(request);
    if (!response) {
      // Supabase hotdeals DB 조회 로직 실행...
      // const targetUrl = await getTargetUrlFromSupabase(dealId);
      
      response = Response.redirect(targetUrl, 302);
      response.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      ctx.waitUntil(cache.put(request, response.clone()));
    }

    return response;
  }
};
```

---

## 3. Cloudflare WAF 인프라 설정 가이드 (콘솔 설정)

코드 수정 없이 Cloudflare 대시보드에서 활성화해야 하는 2가지 인프라 보안:

1. **Bot Fight Mode 활성화**:
   - 경로: Cloudflare Dashboard ➔ `Security` ➔ `Bots` ➔ `Bot Fight Mode` [ON]
   - 효과: 알려진 악성 스크래핑 봇 대역 자동 챌린지/차단.
2. **Rate Limiting Rule 생성 (L4 쓰로틀링)**:
   - 경로: Cloudflare Dashboard ➔ `Security` ➔ `WAF` ➔ `Rate limiting rules`
   - 규칙 조건: `URI Path starts with "/hd"`
   - 제한 기준: `단일 IP 기준 1분당 30회 초과 요청 시`
   - 액션: `Block (HTTP 429)` 또는 `Managed Challenge`

---

## 4. 프론트엔드 및 DB 계층 핫딜 데이터 보호

1. **프론트엔드 (`index.html`)**:
   - 모든 핫딜 아웃링크는 `https://r.momcalendar.com/hd_{id}` 프록시 주소로 단일화 유지.
   - DOM상에 원본 쇼핑몰 `productId`, `itemId`, raw URL 직접 바인딩 금지.
2. **Supabase PostgREST API**:
   - `hotdeals` 테이블 조회 시 단일 요청당 `limit(50)` 상한 강제.
   - `link` 컬럼은 클라이언트 페칭 대상에서 제외하거나 이미 단축된 URL만 저장되도록 뷰(View) 분리 고려.
