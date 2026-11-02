# 📱 [긴급 오더] 앱 하단 네비게이션 바(공구·핫딜·세일·커뮤니티) 구현

## 1. 사장님 제보 및 결함 진단
- **사장님 말씀**: "앱에서는 공구 핫딜 세일 커뮤니티 이런거를 아래쪽 버튼으로 만들어놨었는데 그게 구현이 안됐어 봐봐"
- **원인 분석**:
  - `mockapp.html` 및 CSS에는 `.bnav`, `.bni` 하단 탭 규격이 작성되어 있었으나, `index.html` 및 `test.html`의 DOM에는 실제 하단 네비게이션 태그(`<nav class="bnav">`)가 누락되어 있었음.
  - 이로 인해 갤럭시/아이폰 앱에서도 웹처럼 상단 칩(`.content-seg`)만 보이고, 앱 필수 요소인 하단 4대 탭바가 완전히 실종된 상태임.

---

## 2. 작업 지침

### ① HTML 추가 (`index.html`, `test.html`)
`</body>` 직전(플로팅 카톡 버튼 아래)에 다음 하단 네비게이션 마크업 추가:

```html
<!-- 📱 앱 전용 하단 고정 네비게이션 바 (공구·핫딜·세일·커뮤니티) -->
<nav class="bnav" id="appBottomNav">
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

### ② CSS 보강 (`index.html`, `test.html`)
```css
/* 📱 하단 탭바 기본 및 앱 전용 스타일 */
.bnav {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: min(480px, 100vw);
  background: #ffffff;
  border-top: 1px solid #E6EBF1;
  display: flex;
  padding: 6px 0 calc(6px + env(safe-area-inset-bottom, 0px));
  z-index: 900;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
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
  font-weight: 600;
  color: #8D95A1;
  transition: color 0.15s ease;
}
.bni.on .bni-lbl {
  color: #7C54C4;
  font-weight: 700;
}

/* 앱(native-app) 환경 최적화 */
body.native-app {
  padding-bottom: calc(65px + env(safe-area-inset-bottom, 0px)) !important;
}
body.native-app .chat-fab-wrap {
  bottom: calc(75px + env(safe-area-inset-bottom, 0px)) !important;
}
/* 앱에서는 상단 세그먼트 중복 노출 방지 또는 슬림화 */
body.native-app #contentSeg {
  display: none !important;
}
```

### ③ JS 동기화 (`switchContent` 함수 보강)
`switchContent(ct)` 함수 내에 하단 네비게이션 상태 동기화 코드 추가:
```javascript
// 하단 네비게이션 탭 상태 동기화
document.querySelectorAll('#appBottomNav .bni').forEach(b => {
  const on = b.dataset.ct === ct;
  b.classList.toggle('on', on);
});
```

---

## 3. 검증 기준
1. `test.html`에서 하단 탭 4개(공구, 핫딜, 세일/라방, 커뮤니티)가 하단에 고정 노출되는지 확인.
2. 각 탭 클릭 시 해당 화면으로 부드럽게 전환되고, 보라색 활성화 상태가 정확히 토글되는지 확인.
3. 바닥 스크롤 시 마지막 상품 카드나 텍스트가 하단 바에 가려지지 않는지(padding-bottom) 확인.
4. 카톡 상담 플로팅 버튼이 하단 바 위로 적절히 떠 있는지 확인.
5. 검증 완료 후 `index.html`에 즉시 반영 배포.
