# [지시서] 스폰서 배너 3종(시안 A/B/C) 구현 및 노출·클릭 트래킹 & 결과보고서 체계 구축

> **수신**: 클로드 코드 (Claude Code)  
> **발신**: 맘캘린더 시니어 운영팀  
> **원칙**: **라이브(`index.html`) 직접 수정 절대 금지!** 반드시 **`test.html`**에서 먼저 구현 및 실측 검증 후 보고할 것.

---

## 1. 작업 목적 및 배경
- 맘캘린더 B2B 유료 배너 광고 상품(7일 20만 원 패키지) 도입에 따라, **이웃셀러 하단 스폰서 배너 구좌**를 정규화합니다.
- 광고주에게 제공할 **3대 배너 포맷(시안 A, B, C)**을 데이터 기반으로 유연하게 스위칭할 수 있도록 구현합니다.
- 집행 종료 후 광고주에게 전달할 **결과보고서(총 노출수, 총 클릭수, CTR, 일자별 추이)**를 객관적으로 산출할 수 있도록 **GA4 및 Supabase 기반 트래킹 & 추출 체계**를 구축합니다.

---

## 2. 배너 3종(시안 A/B/C) UI 상세 규격 (사장님 확정안)

배너는 **`#sellerZone` (이웃셀러) 바로 아래, `contentSeg` (4대 탭바) 바로 위**에 위치합니다.  
광고주가 선택한 포맷(`type: 'A' | 'B' | 'C'`)에 따라 1개의 배너가 노출됩니다.

### 공통 규격
- **컨테이너 ID**: `#sponsoredAdZone`
- **배경 및 테두리**: 모바일 320px~480px 완벽 대응, 카드 형태(반경 12px~14px)
- **공정위 AD 뱃지**: 우측 상단 또는 텍스트 옆에 작고 단정한 회색 뱃지 (`border: 1px solid #D1D6DB; color: #8B95A1; font-size: 9px; padding: 1px 4px; border-radius: 3px; font-weight: 700;`)

### 시안 A (좌측 썸네일 + 1줄 텍스트형)
- **구조**: `[좌측 사각 썸네일(52x52px)]` + `[태그: 오늘만 특가] [AD] [브랜드명 신제품 단독 할인 >]`
- **특징**: 심플하고 담백한 리스트형 배너.

### 시안 B (가로 풀와이드 통배너 이미지형)
- **구조**: 가로 폭 100%를 차지하는 와이드 그래픽 배너 (비율 약 3:1 또는 가로 836/750 규격 대응)
- **특징**: 광고주가 제작한 단독 이미지(그라데이션/일러스트/제품컷) 노출. 우측 상단에 반투명 `AD` 뱃지 오버레이.

### 시안 C (좌측 2줄 텍스트 + 우측 썸네일형)
- **구조**: `[상단: 오늘만 특가 AD] [제목: 브랜드명 신제품 단독 할인] [설명: 귀사 혜택 설명 한 줄]` + `[우측 사각 썸네일(60x60px)]`
- **특징**: 혜택 설명 문구가 풍부하게 들어가는 커머스 최적화형 카드.

---

## 3. 광고 트래킹 시스템 설계

### ① 광고 데이터 정의 객체 (Config)
```javascript
const SPONSORED_AD = {
  active: true, // 광고 온/오프
  id: "darim_202611", // 광고 식별자 (보고서 집계 키)
  type: "B", // "A" | "B" | "C"
  title: "브랜드명 신제품 단독 할인",
  desc: "귀사 혜택 설명 한 줄 (시안 C 전용)",
  badge: "오늘만 특가",
  image: "assets/ad/sample_banner.png", // 또는 이미지 URL
  landingUrl: "https://brand-store.com/product",
  startDate: "2026-11-12",
  endDate: "2026-11-19"
};
```

### ② UTM 자동 부착 및 클릭 트래킹
배너 클릭 시 광고주가 본인들 스마트스토어/자사몰 통계에서 직접 확인할 수 있도록 UTM 파라미터를 자동 조합하여 새 창으로 엽니다.

```javascript
function onSponsoredAdClick() {
  if (!SPONSORED_AD || !SPONSORED_AD.active) return;
  
  const adId = SPONSORED_AD.id;
  const adType = SPONSORED_AD.type;
  
  // 1. GA4 클릭 이벤트 전송
  if (typeof gtag === 'function') {
    gtag('event', 'sponsored_ad_click', {
      ad_id: adId,
      ad_type: adType,
      placement: 'sub_seller'
    });
  }
  
  // 2. Supabase events 테이블 기록
  if (typeof trackEvent === 'function') {
    trackEvent('sponsored_ad_click', `${adId}:${adType}`);
  }
  
  // 3. UTM 파라미터 조합 후 새 창 이동
  const base = SPONSORED_AD.landingUrl;
  const separator = base.includes('?') ? '&' : '?';
  const utm = `utm_source=momcalendar&utm_medium=banner&utm_campaign=${encodeURIComponent(adId)}&utm_content=sian_${adType}`;
  window.open(base + separator + utm, '_blank', 'noopener,noreferrer');
}
```

### ③ 노출(Impression) 트래킹 (IntersectionObserver)
배너가 사용자 뷰포트에 50% 이상 진입했을 때 1회만 노출로 판정합니다. (단순 로딩이 아닌 실 노출 기준)

```javascript
function initSponsoredAdImpression() {
  const el = document.getElementById('sponsoredAdZone');
  if (!el || !SPONSORED_AD.active) return;
  
  let observed = false;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !observed) {
        observed = true;
        // GA4 노출 이벤트 전송
        if (typeof gtag === 'function') {
          gtag('event', 'sponsored_ad_impression', {
            ad_id: SPONSORED_AD.id,
            ad_type: SPONSORED_AD.type,
            placement: 'sub_seller'
          });
        }
        // Supabase events 로깅
        if (typeof trackEvent === 'function') {
          trackEvent('sponsored_ad_impression', `${SPONSORED_AD.id}:${SPONSORED_AD.type}`);
        }
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  
  observer.observe(el);
}
```

---

## 4. 광고주 결과보고서 추출 스크립트 구축

집행 종료 후 사장님/운영자가 터미널에서 명령어 한 줄로 결과보고서 텍스트를 바로 뽑을 수 있도록 Node.js 스크립트를 작성합니다.

- **스크립트 경로**: `scripts/get_ad_report.mjs`
- **실행 방식**: `node scripts/get_ad_report.mjs --ad darim_202611`
- **로직**:
  1. Supabase `events` 테이블에서 `event_type IN ('sponsored_ad_impression', 'sponsored_ad_click')` 조회
  2. `event_data` 내 `ad_id` 필터링
  3. 총 노출수, 총 클릭수, CTR(클릭률 %) 계산
  4. 일자별(YYYY-MM-DD) 노출/클릭/CTR breakdown 산출
  5. 광고주 전달용 포맷(Markdown 테이블)으로 터미널 콘솔 출력

---

## 5. 단계별 실행 지침
1. **`test.html`에서 3종 시안 및 트래킹 함수 구현**:
   - 상단 및 이웃셀러 아래에 `#sponsoredAdZone` 렌더링.
   - 테스트용 토글(버튼으로 시안 A, B, C 스위칭 가능)을 달아 모바일 화면(320px, 375px, 412px)에서 깨짐 및 말줄임 검증.
2. **트래킹 로직 테스트**:
   - `test.html`에서 배너 클릭 시 UTM 붙은 링크 정상 오픈 및 콘솔/이벤트 발송 검증.
   - 스크롤 시 IntersectionObserver 1회 발송 검증.
3. **`scripts/get_ad_report.mjs` 구현 및 mock 데이터 테스트**.
4. **결과 보고**:
   - 실측 테스트 완료 후 사장님께 스크린샷 및 검증 결과 보고.
   - **라이브 배포는 사장님 최종 컨펌 후에만 진행할 것.**
