# 📱 [최종 마스터 오더] 웹 둘러보기 정리 & 카드 찜 앱 유도 & 앱 전용 4단 하단바 통합 구현

## 1. 사장님 최종 방침 총정리 (2026-11-02)
- **사장님 말씀**:
  1. "누를때마다 앱으로 오라하면 그것도 피곤하니까 웹에선 굳이 못쓰는 기능은 빼버려 오른쪽 위 알람표시처럼. 카드 찜은 냄겨두고"
  2. "위에 요것처럼(상단 앱 띠) 이쁘게 로고붙여서 보여주면될듯"
  3. "앱전용이야 하단바는, 맘맘 마미톡 토스 당근처럼 중복되는거 없이 심플하게"
  4. "웹에선 로그인 자체를 못하게하고 앱으로 오게해줘, 기존 찜/웹 사용자 자연스럽게 앱으로 오게"

---

## 2. 통합 3대 구현 명세

### [PART 1] 웹(Web): 화면 대청소 & 100% 비로그인 둘러보기
일반 브라우저(`!_isNativeApp()`) 접속 시:
1. **불필요 버튼 전면 숨김 (`display: none !important;`)**:
   - 상단 우측 종(🔔) 알림함 아이콘
   - 출석체크 플로팅 버튼(FAB) 및 사이드 메뉴 내 출석체크
   - 사이드 메뉴 내 '내 폰 캘린더 저장', '오픈 알림 설정' 등 웹 미지원 항목
2. **웹 로그인 시트 원천 차단**:
   - 웹에서는 카카오 로그인 시트를 띄우지 않으며, 로그인 없이 **공구 캘린더, 핫딜 특가, 세일 일정, 브랜드/상품명 검색, 링크 클릭**을 100% 자유롭게 이용.
3. **기존 찜/회원 자연스러운 이관 띠**:
   - 웹에 기존 찜(`mc_wishes`)이나 로그인 기록이 있는 손님에게만 1줄 보라색 안내 띠 노출:
     `💜 맘캘린더 앱 출시! 앱에서 로그인하시면 지금 찜한 공구가 그대로 이어져요. [앱 다운로드 ›]`

---

### [PART 2] 웹 ➔ 앱 전환: 「카드 찜(하트 ♡)」 단일 스마트 바텀시트
- 웹에서 이것저것 누를 때마다 사사건건 팝업이 뜨는 피로도를 **0%로 차단**.
- 오직 손님이 공구 상품을 탐색하다가 진짜 사고 싶어서 **카드의 하트(♡)를 누르는 결정적 순간에만**, 상단 앱 띠와 100% 동일한 **시그니처 투톤 바텀시트**가 올라옴:

#### ① 바텀시트 마크업 (`index.html`, `test.html`의 `</body>` 직전)
```html
<div id="appDownloadSheet" class="mc-sheet-wrap" style="display:none;" onclick="if(event.target===this)closeAppSheet()">
  <div class="mc-sheet-box">
    <div class="mc-sheet-handle"></div>
    <img src="momcal-appicon.png" width="48" height="48" class="mc-sheet-appicon" alt="맘캘린더 앱">
    <div class="mc-sheet-title">찜 · 오픈 알림은<br>맘캘린더 앱에서 받아보세요!</div>
    <div class="mc-sheet-desc">오픈일 아침 9시 알림부터 키워드 알림까지,<br>앱에서 놓치지 않고 챙겨드려요 💜</div>

    <div class="mc-sheet-btns">
      <a href="https://play.google.com/store/apps/details?id=com.wantsb.momcalendar" target="_blank" class="sheet-store-btn sheet-btn-gplay">
        <svg viewBox="0 0 512 512" width="18" height="18" style="vertical-align:middle;margin-right:6px">
          <path fill="#4285F4" d="M47.1 24.3l233.1 231.7L47.1 487.7c-5.7-4.4-9.3-11.4-9.3-19.4V43.7c0-8 3.6-15 9.3-19.4z"/>
          <path fill="#FBBC04" d="M344.2 192.4l-64 63.6 64 63.6 75.3-43.5c15.4-8.9 15.4-23.4 0-32.3l-75.3-51.4z"/>
          <path fill="#EA4335" d="M47.1 24.3l233.1 231.7 64-63.6L102.3 8.9c-20.9-12-38.3-2-55.2 15.4z"/>
          <path fill="#34A853" d="M47.1 487.7l297.1-168.1-64-63.6L47.1 487.7c16.9 17.4 34.3 27.4 55.2 15.4l241.9-183.5z"/>
        </svg>Google Play
      </a>
      <a href="https://apps.apple.com/kr/app/id6826126083" target="_blank" class="sheet-store-btn sheet-btn-appstore">
        <svg viewBox="0 0 170 170" width="16" height="16" fill="currentColor" style="vertical-align:middle;margin-right:6px">
          <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.6-7.77-11.73-14.19-6.3-9.88-11.16-20.99-14.58-33.34-3.42-12.35-5.13-23.75-5.13-34.2 0-14.57 3.59-26.37 10.77-35.41 7.18-9.04 16.32-13.67 27.42-13.89 5.34 0 11.22 1.41 17.65 4.23 6.43 2.83 10.3 4.24 11.62 4.24 1.1 0 5.25-1.52 12.48-4.56 7.23-3.04 13.54-4.35 18.94-3.92 14.14 1.1 25.13 6.64 32.96 16.65-12.41 7.51-18.49 17.74-18.24 30.68.25 10.23 4.23 18.72 11.95 25.46 7.72 6.75 16.87 10.56 27.45 11.43-2.07 6.42-4.56 12.63-7.47 18.63zM119.22 33.06c0-7.39 2.66-14.24 7.98-20.54 5.32-6.3 11.97-10.42 19.95-12.35.25 1.1.37 2.08.37 2.94 0 7.39-2.78 14.37-8.35 20.94-5.57 6.57-12.28 10.59-20.13 12.06-.13-.98-.19-1.99-.19-3.05z"/>
        </svg>App Store
      </a>
    </div>

    <button type="button" class="mc-sheet-close" onclick="closeAppSheet()">닫기</button>
  </div>
</div>
```

#### ② 바텀시트 CSS 스타일
```css
.mc-sheet-wrap {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  z-index: 1000; display: flex; align-items: flex-end; justify-content: center; animation: mcFadeIn 0.2s ease-out;
}
@keyframes mcFadeIn { from { opacity: 0; } to { opacity: 1; } }
.mc-sheet-box {
  width: min(480px, 100vw); background: #ffffff; border-radius: 24px 24px 0 0;
  padding: 16px 20px calc(20px + env(safe-area-inset-bottom, 0px)); box-sizing: border-box; text-align: center;
  animation: mcSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes mcSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
.mc-sheet-handle { width: 36px; height: 4px; background: #E5E8EB; border-radius: 2px; margin: 0 auto 16px; }
.mc-sheet-appicon { border-radius: 12px; box-shadow: 0 4px 12px rgba(124, 84, 196, 0.15); margin-bottom: 12px; }
.mc-sheet-title { font-size: 19px; font-weight: 700; color: #191F28; line-height: 1.35; margin-bottom: 8px; letter-spacing: -0.3px; }
.mc-sheet-desc { font-size: 13.5px; color: #6B7684; line-height: 1.45; margin-bottom: 22px; letter-spacing: -0.2px; }

.mc-sheet-btns { display: flex; gap: 10px; margin-bottom: 12px; }
.sheet-store-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; height: 46px; border-radius: 12px;
  font-size: 14px; font-weight: 700; text-decoration: none !important; transition: transform 0.1s ease; box-sizing: border-box;
}
.sheet-store-btn:active { transform: scale(0.97); }
.sheet-btn-gplay { background: #7C54C4; color: #ffffff !important; }
.sheet-btn-appstore { background: #F2F4F6; color: #4E5968 !important; border: 1px solid #E5E8EB; }
.mc-sheet-close { background: none; border: none; color: #8D95A1; font-size: 14px; font-weight: 600; padding: 10px 16px; cursor: pointer; }
```

#### ③ JS 제어
```javascript
function showAppDownloadSheet() {
  const el = document.getElementById('appDownloadSheet');
  if(el) el.style.display = 'flex';
}
function closeAppSheet() {
  const el = document.getElementById('appDownloadSheet');
  if(el) el.style.display = 'none';
}

// 웹에서 카드 찜(하트) 클릭 시 앱 다운로드 바텀시트 호출
function onWishClick(e) {
  if (typeof _isNativeApp === 'function' && _isNativeApp()) {
    return false; // 앱에서는 기존 찜 로직 정상 수행
  }
  if (e) { e.preventDefault(); e.stopPropagation(); }
  showAppDownloadSheet();
  return true;
}
```

---

### [PART 3] 앱(App): 맘맘·마미톡·당근 스타일 4단 하단 고정 탭바
앱 환경(`body.native-app`) 접속 시:

#### ① 하단 네비게이션 마크업
```html
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

#### ② CSS 스타일 (웹 숨김 / 앱 전용 활성화 & 중복 제거)
```css
/* 웹에서는 기본 숨김 */
.bnav {
  display: none;
  position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
  width: min(480px, 100vw); background: #ffffff; border-top: 1px solid #F2F4F6;
  padding: 5px 0 calc(6px + env(safe-area-inset-bottom, 0px)); z-index: 900;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.03);
}
.bni {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; background: none; border: none; padding: 4px 0; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.bni-ico { font-size: 20px; line-height: 1.2; }
.bni-lbl { font-size: 11px; font-weight: 500; color: #8D95A1; transition: color 0.15s ease; }
.bni.on .bni-lbl { color: #7C54C4; font-weight: 700; }

/* 📱 [앱 환경 최적화] */
body.native-app .bnav { display: flex !important; }
body.native-app #contentSeg { display: none !important; } /* 화면 중간 4개 버튼 숨겨서 중복 제거 */
body.native-app { padding-bottom: calc(65px + env(safe-area-inset-bottom, 0px)) !important; }
body.native-app .chat-fab-wrap { bottom: calc(75px + env(safe-area-inset-bottom, 0px)) !important; }
```

#### ③ JS 동기화 (`switchContent` 내부)
```javascript
document.querySelectorAll('#appBottomNav .bni').forEach(b => {
  const on = b.dataset.ct === ct;
  b.classList.toggle('on', on);
});
```

---

## 3. 검증 체크리스트
1. **웹 브라우저**: 상단 종, 출석체크, 잡다한 버튼 싹 사라지고 검색/공구/핫딜이 시원하게 둘러봐지는지 확인.
2. **웹에서 하트(♡) 클릭**: 상단 배너와 똑같은 예쁜 투톤 바텀시트가 뜨는지 확인.
3. **앱 브라우저(`native-app`)**: 하단에 4단 탭바(`📅 공구`, `🔥 핫딜`, `🛍️ 세일`, `💬 커뮤니티`)가 딱 붙고, 화면 중간 보라색 4개 버튼은 사라져 중복 없는지 확인.
4. 검증 완료 후 `index.html` 즉시 배포.
