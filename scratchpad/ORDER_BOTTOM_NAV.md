# 📱 [긴급 오더] 앱 전용 하단 네비게이션 바(공구·핫딜·세일·커뮤니티) 구현

## 1. 사장님 절대 원칙 (2026-11-02)
- **사장님 말씀**: "앱전용이야 하단바는", "맘맘 마미톡 토스 당근처럼 너가보고 중복되는거 없이 심플하게 지시해줘"
- **엄격한 웹/앱 분리 원칙**:
  1. **모바일 웹 (브라우저 접속 손님)**:
     - 하단 바가 뜨지 않습니다 (`display: none`).
     - 기존 상단 세그먼트 버튼(`.content-seg`)이 그대로 정상 유지됩니다.
  2. **앱 (`body.native-app`, 스토어 설치 앱)**:
     - 맘맘·마미톡·당근 스타일의 **하단 고정 4대 탭바(`📅 공구`, `🔥 핫딜`, `🛍️ 세일`, `💬 커뮤니티`)가 활성화**됩니다.
     - 화면 중간의 기존 보라색 4대 탭 세그먼트(`.content-seg`)는 **100% 숨겨서 중복을 완전 제거**합니다.
     - 상단 배너 바로 아래에 서브 필터(전체, 내 찜, 카테고리 칩)가 시원하게 연결됩니다.

---

## 2. 작업 지침 (`test.html`, `index.html`)

### ① HTML 마크업 추가 (`</body>` 직전, 플로팅 버튼 아래)
```html
<!-- 📱 [앱 전용] 맘맘·마미톡형 하단 고정 탭바 (웹에서는 숨김, 앱에서만 표시) -->
<nav class="bnav" id="appBottomNav" aria-label="하단 네비게이션">
  <button class="bni on" type="button" data-ct="gonggu" onclick="switchContent('gonggu')">
    <span class="bni-ico">📅</span>
    <span class="bni-lbl">공구</span>
  </button>
  <button class="bni" type="button" data-ct="hotdeal" onclick="switchContent('hotdeal')">
    <span class="bni-ico">🔥</span>
    <span class="bni-lbl">핫딜</span>
  </button>
  <button class="bni" type="button" data-ct="sale" onclick="switchContent('sale')">
    <span class="bni-ico">🛍️</span>
    <span class="bni-lbl">세일/라방</span>
  </button>
  <button class="bni" type="button" data-ct="community" onclick="switchContent('community')">
    <span class="bni-ico">💬</span>
    <span class="bni-lbl">커뮤니티</span>
  </button>
</nav>
```

### ② CSS 스타일 규격 (웹 숨김 / 앱 전용 표시)
```css
/* ── 📱 하단 탭바: 웹에서는 기본 숨김, 앱(native-app)에서만 표시 ── */
.bnav {
  display: none; /* 🔴 웹에서는 원천 숨김 */
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: min(480px, 100vw);
  background: #ffffff;
  border-top: 1px solid #F2F4F6;
  padding: 5px 0 calc(6px + env(safe-area-inset-bottom, 0px));
  z-index: 900;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.03);
}

.bni {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: none;
  border: none;
  padding: 4px 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.bni-ico {
  font-size: 20px;
  line-height: 1.2;
}

.bni-lbl {
  font-size: 11px;
  font-weight: 500;
  color: #8D95A1;
  transition: color 0.15s ease, font-weight 0.15s ease;
}

/* 활성화 탭: 맘캘 시그니처 소프트 딥 라벤더 (#7C54C4) */
.bni.on .bni-lbl {
  color: #7C54C4;
  font-weight: 700;
}

/* ── 📱 [앱(native-app) 전용 활성화 및 중복 제거] ── */
body.native-app .bnav {
  display: flex !important; /* 앱에서만 하단 바 노출 */
}

/* 앱에서는 화면 중간의 4대 탭 세그먼트를 100% 숨겨서 중복 제거 */
body.native-app #contentSeg {
  display: none !important;
}

/* 앱 바닥 안전 패딩 (카드가 하단바에 가려지지 않게 방어) */
body.native-app {
  padding-bottom: calc(65px + env(safe-area-inset-bottom, 0px)) !important;
}

/* 앱 플로팅 카톡 버튼(FAB)을 하단 탭바 위로 띄워 겹침 방지 */
body.native-app .chat-fab-wrap {
  bottom: calc(75px + env(safe-area-inset-bottom, 0px)) !important;
}
```

### ③ JS 상태 동기화 (`switchContent` 함수 내부)
`switchContent(ct)` 함수 안에서 하단 탭바 버튼 활성화 상태를 함께 업데이트:
```javascript
// 하단 네비게이션 탭 상태 실시간 동기화
document.querySelectorAll('#appBottomNav .bni').forEach(b => {
  const on = b.dataset.ct === ct;
  b.classList.toggle('on', on);
});
```

---

## 3. 완료 검증
1. 일반 브라우저(크롬·사파리)로 `test.html` 접속 시 하단바가 전혀 보이지 않고 기존 화면 유지되는지 확인.
2. `body`에 `native-app` 클래스가 붙었을 때(또는 앱 환경)만 하단 고정 탭바가 뜨고 중간 보라색 4대 버튼이 사라지는지 확인.
3. 탭 터치 시 `📅 공구` · `🔥 핫딜` · `🛍️ 세일/라방` · `💬 커뮤니티` 전환이 매끄럽게 동작하는지 확인.
4. 검증 완료 후 `index.html`에 즉시 반영 배포.
