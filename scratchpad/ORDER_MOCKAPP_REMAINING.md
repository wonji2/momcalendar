# 💎 [사장님 원본 자산 후속 오더] 하단바 SVG 교체 & 공구 정렬 칩 & 알림함 필터

## 1. 개요 (2026-11-02)
- 핫딜 폴센트화 및 폰트 14px 통일(`ORDER_POLCENT_MOMCAL_STYLE.md`)에 이어, **`mockapp.html`에서 발굴된 사장님 원본 미적용 핵심 기능 3가지**를 추가 배포한다.

---

## 2. 작업 상세 (`index.html`, `test.html`)

### ① [하단바] 촌스러운 스마트폰 기본 이모지 ➔ 사장님 원본 SVG 4종으로 교체
스마트폰 컬러 기본 이모지(`📅`, `🔥`, `🛍️`, `💬`)를 100% 삭제하고, `mockapp.html`의 원본 단색 라인 SVG 4종으로 교체한다:
```html
<nav id="appBottomNav" class="app-bottom-nav">
  <!-- 1. 공구 -->
  <button type="button" class="abn-btn on" onclick="switchMainTab('gonggu')">
    <span class="abn-i">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>
      </svg>
    </span>
    <span class="abn-t">공구</span>
  </button>

  <!-- 2. 핫딜 -->
  <button type="button" class="abn-btn" onclick="switchMainTab('hotdeal')">
    <span class="abn-i">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5"/>
      </svg>
    </span>
    <span class="abn-t">핫딜</span>
  </button>

  <!-- 3. 세일 -->
  <button type="button" class="abn-btn" onclick="switchMainTab('sale')">
    <span class="abn-i">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/>
      </svg>
    </span>
    <span class="abn-t">세일</span>
  </button>

  <!-- 4. 커뮤니티 -->
  <button type="button" class="abn-btn" onclick="switchMainTab('comm')">
    <span class="abn-i">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
      </svg>
    </span>
    <span class="abn-t">커뮤니티</span>
  </button>
</nav>
```
- 스타일: 기본 회색 `#8D95A1` (stroke-width 1.9) ➔ 활성화 탭 `#7C54C4` 맘캘 라벤더 (stroke-width 2.3 볼드).

---

### ② [공구 탭] 사장님 원본 3대 퀵 정렬 칩 배치 (`mockapp.html` Section ③)
공구 카드 목록 상단에 사장님이 만들어 두신 3대 정렬 칩을 배치하고 정렬 JS 연동:
```html
<div class="gonggu-sort-chips">
  <button type="button" class="gs-chip on" onclick="sortGonggu('popular')">인기순</button>
  <button type="button" class="gs-chip" onclick="sortGonggu('recent')">방금 오픈순</button>
  <button type="button" class="gs-chip" onclick="sortGonggu('deadline')">마감 임박순</button>
</div>
```
- 칩 CSS: 높이 30px, 모서리 100px 둥글게, 마진 8px 16px. 기본 `#F2F4F6` 배경 + `#4E5968`, 선택 시 `#7C54C4` 배경 + `#ffffff` 글자.

---

### ③ [알림함] 사장님 원본 4대 카테고리 필터 칩 (`mockapp.html` Section ②)
헤더 🔔 알림 시트 상단에 사장님 원본 4대 필터 칩 적용:
```html
<div class="noti-filter-chips">
  <button type="button" class="nfc on" onclick="filterNoti('all')">전체</button>
  <button type="button" class="nfc" onclick="filterNoti('gonggu')">공구</button>
  <button type="button" class="nfc" onclick="filterNoti('hotdeal')">핫딜</button>
  <button type="button" class="nfc" onclick="filterNoti('sale')">세일</button>
</div>
```

---

## 3. 검증 체크리스트
1. 하단바의 알록달록 기본 이모지가 완전히 사라지고, `mockapp.html`의 단색 라인 SVG 4종으로 깔끔하게 나오는지 확인.
2. 공구 목록 위에 `[인기순]`, `[방금 오픈순]`, `[마감 임박순]` 칩이 동작하는지 확인.
3. 알림함 시트에 `[전체]`, `[공구]`, `[핫딜]`, `[세일]` 필터가 적용되는지 확인.
4. 검증 후 `index.html` 즉시 배포.
