# 🛑 [긴급] 하단 탭바 엉터리 이모지 즉시 철거 ➔ 사장님 원본 SVG 아이콘 복원

## 1. 사장님 날카로운 지적 (2026-11-02)
- **사장님 말씀**: "내가 예전에 심플한 이모티콘으로 짜놓은거 있는데 하단탭바 이렇게 나오는건 아니겠지? 아님 진짜 저렇게 짠거야? 내가 저번에 짜둔거 있는뎅"
- **문제점 진단 (실측)**:
  - 클로드 코드가 사장님이 `mockapp.html`에 정갈하게 만들어 두신 **단색 미니멀 라인 SVG 아이콘**을 안 보고, 촌스러운 스마트폰 기본 컬러 이모지(`📅`, `🔥`, `🛍️`, `💬`)를 박아 넣어 화면을 조잡하게 만들었음.
  - 당장 저 흉물스러운 기본 이모지 싹 걷어내고, 사장님이 `mockapp.html`에 짜두신 **보석 같은 정품 SVG 4종**으로 즉각 교체할 것.

---

## 2. 사장님 원본 SVG 하단바 규격 (`mockapp.html` 발굴 원본)

### ① HTML 구조 (기본 이모지 삭제 ➔ 사장님 SVG 4종 장착)
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

### ② CSS 스타일 (`mockapp.html` 디자인 100% 복원)
```css
/* 📱 사장님 원본 앱 전용 고정 하단 네비게이션바 */
.app-bottom-nav {
  display: none; /* 웹 브라우저에서는 숨김 */
}

/* ⚠️ 앱 환경에서만 하단바 고정 노출 */
body.native-app .app-bottom-nav {
  display: flex !important;
  position: fixed !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  height: 56px !important;
  background: #ffffff !important;
  border-top: 1px solid #E6EBF1 !important;
  padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px)) !important;
  z-index: 1000 !important;
  box-sizing: border-box !important;
}

body.native-app {
  padding-bottom: calc(60px + env(safe-area-inset-bottom, 0px)) !important;
}

/* 개별 탭 버튼 */
.abn-btn {
  flex: 1 !important;
  border: 0 !important;
  background: none !important;
  padding: 4px 0 !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 3px !important;
  cursor: pointer !important;
  color: #8D95A1 !important; /* 기본 회색 라인 */
  transition: color 0.15s ease !important;
  -webkit-tap-highlight-color: transparent !important;
}

.abn-i {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  line-height: 1 !important;
}

.abn-i svg {
  stroke-width: 1.9 !important;
}

.abn-t {
  font-size: 10.5px !important;
  font-weight: 600 !important;
  line-height: 1 !important;
}

/* 💜 활성 탭 (맘캘 딥 라벤더) */
.abn-btn.on {
  color: #7C54C4 !important;
}

.abn-btn.on .abn-i svg {
  stroke-width: 2.3 !important; /* 활성화 시 굵기 강조 */
}

.abn-btn.on .abn-t {
  font-weight: 700 !important;
}
```

---

## 3. 검증 체크리스트
1. 알록달록 유치한 기본 이모지(`📅`, `🔥`, `🛍️`, `💬`)가 **100% 삭제**되었는지 확인.
2. `mockapp.html`에 있던 사장님의 **미니멀 라인 SVG 아이콘 4종**이 선명하게 노출되는지 확인.
3. 탭 클릭 시 해당 탭이 맘캘 라벤더(`#7C54C4`)로 진해지고 라인이 굵어지는지 확인.
4. 검증 후 `index.html` 즉시 배포.
