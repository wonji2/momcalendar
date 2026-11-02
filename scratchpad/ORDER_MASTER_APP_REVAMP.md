# 💎 [사장님 원본 자산 100% 복원] 맘캘 앱 통합 마스터 개편 지시서

## 1. 개요 및 사장님 지침 (2026-11-02)
- **사장님 말씀**: "너가 그럼 내가 더 짜놨던 내용들 다 발굴해서 지금 이거랑 한번에 던지게 찾아줘"
- **발굴 출처**: `mockapp.html`, `calmock.html` 내 사장님이 직접 설계해 두신 원본 코드 및 UX 전수 복원.
- **클로드 코드가 임의로 날조한 코드(알록달록 스마트폰 이모지, 촌스러운 보라색 '인기수요' 뱃지 등)를 전면 파기하고, 사장님 원본 에셋과 폴센트 룩앤필로 100% 일체화할 것.**

---

## 2. 사장님 원본 5대 핵심 구현 사항

### ① [하단바] 사장님 원본 단색 라인 SVG 4종 장착 (`mockapp.html` 발굴)
스마트폰 기본 이모지(`📅`, `🔥`, `🛍️`, `💬`) 영구 삭제 후, 아래 사장님 원본 SVG 코드로 전면 교체:
```html
<nav id="appBottomNav" class="app-bottom-nav">
  <button type="button" class="abn-btn on" onclick="switchMainTab('gonggu')">
    <span class="abn-i"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg></span>
    <span class="abn-t">공구</span>
  </button>
  <button type="button" class="abn-btn" onclick="switchMainTab('hotdeal')">
    <span class="abn-i"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5"/></svg></span>
    <span class="abn-t">핫딜</span>
  </button>
  <button type="button" class="abn-btn" onclick="switchMainTab('sale')">
    <span class="abn-i"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/></svg></span>
    <span class="abn-t">세일</span>
  </button>
  <button type="button" class="abn-btn" onclick="switchMainTab('comm')">
    <span class="abn-i"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg></span>
    <span class="abn-t">커뮤니티</span>
  </button>
</nav>
```
- 스타일: 기본 `#8D95A1` 1.9pt ➔ 활성화 시 `#7C54C4` 2.3pt 볼드.

---

### ② [핫딜] 폴센트 × 맘캘린더 시그니처 2.3구좌 캐러셀 및 스마트 뱃지
- 상단 타이틀: `🔥 실시간 가격급락 핫딜` (14px 볼드)
- 카드 폭: `calc((100% - 24px) / 2.3)` (다음 카드가 살짝 삐져나와 자연스러운 스와이프 유도)
- 스마트 뱃지 규격:
  - '인기수요' 영구 삭제.
  - 최저가/하락: **`역대최저`**, **`▼ 20%`** ➔ 폴센트 코랄 레드 (`#FFF0EE` 바탕 + `#FF4742` 텍스트)
  - 맘캘 추천: **`맘캘PICK`** ➔ 맘캘 라벤더 (`#F3EEFA` 바탕 + `#7C54C4` 텍스트)

---

### ③ [공구 탭] 사장님 원본 3대 퀵 정렬 칩 (`mockapp.html` Section ③)
공구 카드 목록 상단에 사장님이 만들어 두신 3대 정렬 칩 배치:
```html
<div class="gonggu-sort-chips">
  <button type="button" class="gs-chip on" onclick="sortGonggu('popular')">인기순</button>
  <button type="button" class="gs-chip" onclick="sortGonggu('recent')">방금 오픈순</button>
  <button type="button" class="gs-chip" onclick="sortGonggu('deadline')">마감 임박순</button>
</div>
```
- 칩 CSS: 높이 30px, 라운딩 100px, 기본 연회색 테두리 `#E6EBF1`, 활성 시 맘캘 보라 `#7C54C4` 배경 + 흰 글자.

---

### ④ [알림함] 사장님 원본 4대 카테고리 필터 칩 (`mockapp.html` Section ②)
헤더 🔔 클릭 시 열리는 시트 상단에 사장님의 원본 4대 필터 칩 적용:
- `[전체]` `[공구]` `[핫딜]` `[세일]`
- 찜한 공구 오픈일/마감일 알림, 키워드 알림이 카테고리별로 깔끔하게 필터링됨.

---

### ⑤ [폰트] 사이트 전 섹션 타이틀 14px 영구 통일
`index.html` 하단 17px 오버라이드 삭제 후 14px 통일:
```css
.main-banner-title,
.seller-title,
.nx-title,
#nextZone .nx-title,
.promo-head,
.hdd-h {
  font-size: 14px !important;
  font-weight: 700 !important;
  color: #191F28 !important;
  letter-spacing: -0.2px !important;
  line-height: 1.4 !important;
}
```

---

## 3. 작업 순서 및 원터치 실행
- 파일: `index.html`, `test.html`
- 위 5대 사항을 한 번에 적용 후 배포 완료할 것.
