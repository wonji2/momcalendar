# 📱 [디자인 교정] 웹 찜·알림 클릭 시 앱 유도 바텀시트 완결

## 1. 사장님 지침 (2026-11-02)
- **사장님 말씀**: "위에 요것처럼 이쁘게 로고붙여서 보여주면될듯"
- **적용할 디자인 표준 (상단 앱 띠 일체화)**:
  1. 클로드가 임의로 그린 둔탁한 검정 사각 박스를 **전면 폐기**.
  2. 상단 앱 설치 띠와 100% 동일한 **맘캘린더 시그니처 투톤 알약 룩앤필** 적용:
     - 핑크 캘린더 하트 앱 아이콘(`momcal-appicon.png`, 48×48px, 곡률 12px)
     - **Google Play 버튼**: 맘캘 시그니처 보라색(`background: #7C54C4; color: #ffffff;`) + 공식 컬러 SVG
     - **App Store 버튼**: 세련된 소프트 그레이(`background: #F2F4F6; color: #4E5968; border: 1px solid #E5E8EB;`) + 애플 SVG
  3. 카피: "찜·알림은 앱에서만 쓸 수 있어요" ➔ **"찜·알림은 맘캘린더 앱에서 받아보세요 💜"** 친근하고 세련되게!

---

## 2. 작업 코드 (`test.html`, `index.html`)

### ① 바텀시트 HTML 교체
```html
<!-- 📱 [웹 전용] 상단 앱 띠 스타일 일체화 바텀시트 -->
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

### ② CSS 스타일 규격
```css
/* ── 바텀시트 백드롭 및 컨테이너 ── */
.mc-sheet-wrap {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  animation: mcFadeIn 0.2s ease-out;
}
@keyframes mcFadeIn { from { opacity: 0; } to { opacity: 1; } }

.mc-sheet-box {
  width: min(480px, 100vw);
  background: #ffffff;
  border-radius: 24px 24px 0 0;
  padding: 16px 20px calc(20px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  text-align: center;
  animation: mcSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes mcSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }

.mc-sheet-handle {
  width: 36px;
  height: 4px;
  background: #E5E8EB;
  border-radius: 2px;
  margin: 0 auto 16px;
}
.mc-sheet-appicon {
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(124, 84, 196, 0.15);
  margin-bottom: 12px;
}
.mc-sheet-title {
  font-size: 19px;
  font-weight: 700;
  color: #191F28;
  line-height: 1.35;
  margin-bottom: 8px;
  letter-spacing: -0.3px;
}
.mc-sheet-desc {
  font-size: 13.5px;
  color: #6B7684;
  line-height: 1.45;
  margin-bottom: 22px;
  letter-spacing: -0.2px;
}

/* 상단 앱 띠와 100% 동일한 버튼 룩앤필 */
.mc-sheet-btns {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.sheet-store-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 46px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none !important;
  transition: transform 0.1s ease;
  box-sizing: border-box;
}
.sheet-store-btn:active {
  transform: scale(0.97);
}

/* 구글 플레이: 시그니처 보라색 */
.sheet-btn-gplay {
  background: #7C54C4;
  color: #ffffff !important;
}

/* 앱스토어: 소프트 그레이 + 테두리 */
.sheet-btn-appstore {
  background: #F2F4F6;
  color: #4E5968 !important;
  border: 1px solid #E5E8EB;
}

.mc-sheet-close {
  background: none;
  border: none;
  color: #8D95A1;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 16px;
  cursor: pointer;
}
```

### ③ JS 제어
```javascript
function showAppDownloadSheet() {
  const el = document.getElementById('appDownloadSheet');
  if(el) el.style.display = 'flex';
}
function closeAppSheet() {
  const el = document.getElementById('appDownloadSheet');
  if(el) el.style.display = 'none';
}
```

---

## 3. 검증 완료 후 index.html 즉시 배포
- 투박한 검정 상자가 사라지고, 상단 띠와 똑같은 **보라색 Google Play + 소프트 그레이 App Store** 버튼이 핑크 캘린더 아이콘과 함께 단정하게 뜨는지 확인.
