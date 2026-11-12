# [오더] 키즈노트·마미톡형 맘캘린더 4대 광고 상품 목업 구현 및 테스트 연동

> **절대 원칙**: 
> 1. 운영 라이브(`index.html`)는 절대 수정하지 마십시오. 오직 **`test.html`**에서만 작업 및 검증합니다.
> 2. 320px ~ 430px 모바일 화면에서 요소 잘림, 겹침, 스크롤 이상이 없어야 합니다.
> 3. 사장님이 모바일 브라우저로 `test.html`에 접속해 4가지 광고 형태를 즉시 눌러보고 시연할 수 있도록 **플로팅 테스트 컨트롤러**를 제공합니다.

---

## 1. 벤치마킹 개요 (키즈노트·마미톡 4대 광고 상품)

| 상품명 | 지면 및 노출 방식 | 노출 시점 및 특징 | 규격 권장치 | 맘캘린더 단가 (14일 기준) |
|---|---|---|---|---|
| **① 스플래시 광고 (Splash)** | 앱 실행 시 화면 전체(전면) 독점 노출 | 앱 구동 2~3초간 시선 100% 독점. 우측 상단 건너뛰기(✕) 및 하단 '오늘 하루 보지 않기' | 1080×1920 (9:16 세로형) | **40만 원** |
| **② 첫 진입 모달 팝업 (Popup)** | 홈 진입 직후 화면 중앙 레이어 팝업 | 홈 첫 진입 시 모달 팝업 노출. 닫기 및 '오늘 하루 보지 않기' | 1:1 정사각 (800×800) 또는 4:5 (800×1000) | **30만 원** |
| **③ 상단 메인 롤링 배너 (Banner)** | 앱/웹 최상단 메인 롤링 배너 | 공구 일정 상단 고정 롤링 노출. 네이버 카페 836px 대문 배너 동시 송출 | 1:1 정사각 썸네일형 또는 와이드 배너형 | **25만 원** (확정) |
| **④ 피드 인피드 카드 (In-feed)** | 공구 목록 피드 중간(15번째 등) 삽입 | 피드 콘텐츠 속에 자연스럽게 녹아드는 네이티브 혜택 카드 (AD 뱃지 포함) | 반응형 카드 (가로 100% × 높이 110~120px) | **15만 원** |

---

## 2. `test.html` 구현 명세

### ① 스플래시 광고 컴포넌트 (`#adSplashModal`)
- **구조**:
  - `position: fixed; inset: 0; z-index: 99999; background: #000; display: flex; flex-direction: column; justify-content: space-between;`
  - 배경: 브랜드 고화질 전면 포스터 이미지 (`background-size: cover; background-position: center;`)
  - 상단 헤더 바:
    - 좌측: `맘캘린더` 미니 로고
    - 우측: 타이머 및 스킵 버튼 (`<button id="splashSkipBtn" class="splash-skip">3초 후 자동 닫힘 ✕</button>`)
      - 3초 카운트다운 후 '건너뛰기 ✕'로 텍스트 변경
      - 5초 후 아무 조작 없으면 자동으로 페이드아웃 닫힘
  - 하단 푸터 바:
    - 반투명 블랙 그라데이션 오버레이
    - 좌측: `[오늘 하루 보지 않기]` 체크박스/버튼
    - 우측: `[자세히 보기 >]` CTA 버튼 (클릭 시 광고주 랜딩 이동)

### ② 첫 진입 모달 팝업 컴포넌트 (`#adCenterModal`)
- **구조**:
  - 반투명 딤드 배경 (`rgba(0, 0, 0, 0.6)`)
  - 중앙 카드: `width: 88%; max-width: 320px; border-radius: 16px; overflow: hidden; background: #fff;`
  - 상단 이미지: 1:1 비율 브랜드 프로모션 이미지
  - 본문:
    - 뱃지: `[단독 혜택]`
    - 제목: `팀버토츠 프리미엄 원목 가구 기획전`
    - 설명: `맘캘린더 회원 단독 최대 45% 할인 + 본품 1명 증정`
  - 하단 액션 버튼 바 (2열 그리드):
    - 좌측: `[오늘 하루 보지 않기]` (회색 텍스트, 클릭 시 24시간 localStorage 쿠키 저장 후 닫힘)
    - 우측: `[닫기]` (진회색 텍스트, 클릭 시 즉시 닫힘)

### ③ 상단 메인 롤링 배너 (`#sponsoredTopBanner`)
- 기존 `scratchpad/ORDER_SPONSORED_BANNER_AND_TRACKING.md`에 정의된 A/B/C 시안 연동 유지.

### ④ 피드 인피드 네이티브 카드 (`#infeedNativeAd`)
- 공구 목록 15번째 슬롯에 자연스럽게 삽입되는 웜버터 골드 카드 연동 유지 (공정위 9px `AD` 뱃지 필수).

---

## 3. 사장님 시연용 플로팅 테스트 컨트롤러 구현

`test.html` 우측 하단(하단바 위쪽, `bottom: 80px; right: 16px; z-index: 99990;`)에 작은 테스트 패널을 추가하여, 사장님이 모바일에서 클릭 한 번으로 각 광고를 즉시 띄워보고 테스트할 수 있도록 합니다.

```html
<!-- 사장님 검증용 플로팅 패널 -->
<div id="adTestController" style="position:fixed; bottom:75px; right:12px; z-index:99990; display:flex; flex-direction:column; gap:6px;">
  <button onclick="previewAd('splash')" style="padding:6px 10px; font-size:11px; font-weight:700; background:#111; color:#fff; border-radius:14px; border:none; box-shadow:0 2px 8px rgba(0,0,0,0.2);">
    📱 스플래시 보기
  </button>
  <button onclick="previewAd('popup')" style="padding:6px 10px; font-size:11px; font-weight:700; background:#ff4d4f; color:#fff; border-radius:14px; border:none; box-shadow:0 2px 8px rgba(0,0,0,0.2);">
    🖼️ 팝업 보기
  </button>
</div>
```

---

## 4. 검증 및 보고 요구사항
1. **모바일 반응형 실측**: 320px(아이폰 SE) 및 390px 폭에서 스플래시/팝업 요소가 화면을 벗어나거나 스크롤이 생기지 않는지 확인.
2. **콘솔 에러 0건**: localStorage 접근 및 이벤트 리스너 동작 시 에러가 없어야 함.
3. 작업 완료 후 `test.html` 브라우저 스크린샷 캡처 및 사장님 테스트 링크를 보고할 것.
