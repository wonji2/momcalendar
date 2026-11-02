# 🚀 [폴센트 킬러 핫딜 전면 개편] 5대 불만 해결 + 마미톡 2열 그리드 + 프리미엄 차트

## 0. 🚨 [사장님 긴급 오더] 핫딜/세일/커뮤니티 탭 진입 시 상단 공구 배너 전면 숨김!
- **사장님 말씀**: "핫딜누르면 위에 맘캘방장 공구예정등등 배너는 안보이고 바로 핫딜만 보여야지"
- **문제 원인**: 현재 `switchContent(ct)`가 아래쪽 `#gongguWrap`만 숨기고, 상단에 위치한 메인배너(`.main-banner-section`), 오픈예정스포(`#nextZone`), 이웃셀러(`#sellerZone`), 셀러배너(`#subZone`)를 숨기지 않아서 핫딜 탭을 눌러도 공구 배너들이 화면 절반을 가리고 핫딜이 밑으로 밀려남.
- **반드시 적용할 해결책**:
  1. `switchContent(ct)` 함수 실행 시 `document.body.dataset.ct = ct;` 를 지정한다.
  2. 공구(`ct === 'gonggu'`)가 아닐 때는 상단 공구 4대 영역(`.main-banner-section`, `#nextZone`, `#sellerZone`, `#subZone`)을 `display: none !important;`로 전면 숨긴다.
  3. 공구 탭으로 돌아왔을 때만 원래대로 복원한다.
  ```css
  /* 🎯 공구 외 탭(핫딜, 세일, 커뮤니티)에서는 상단 공구 배너·예고·이웃셀러 완전 숨김 */
  body[data-ct="hotdeal"] .main-banner-section,
  body[data-ct="hotdeal"] #nextZone,
  body[data-ct="hotdeal"] #sellerZone,
  body[data-ct="hotdeal"] #subZone,
  body[data-ct="sale"] .main-banner-section,
  body[data-ct="sale"] #nextZone,
  body[data-ct="sale"] #sellerZone,
  body[data-ct="sale"] #subZone,
  body[data-ct="community"] .main-banner-section,
  body[data-ct="community"] #nextZone,
  body[data-ct="community"] #sellerZone,
  body[data-ct="community"] #subZone {
    display: none !important;
  }
  ```
  ```javascript
  // switchContent(ct) 함수 최상단에 추가:
  document.body.dataset.ct = ct;
  var isGonggu = (ct === 'gonggu');
  var mb = document.querySelector('.main-banner-section'); if(mb) mb.style.display = isGonggu ? '' : 'none';
  var nz = document.getElementById('nextZone'); if(nz) nz.style.display = isGonggu ? '' : 'none';
  var sz = document.getElementById('sellerZone'); if(sz) sz.style.display = isGonggu ? '' : 'none';
  var sb = document.getElementById('subZone'); if(sb) sb.style.display = isGonggu ? '' : 'none';
  ```

---

## 1. 사장님 최종 확정 지침 및 기획 배경 (2026-11-02)
- **사장님 말씀**: "참고해서 더 디벨롭해줘 완전 따라하기보다는 너의 핫딜원칙과 섞어서 더 편하게 볼만한 방법으로... 폴센트 앱스토어나 구글플레이스토어 리뷰를 평점낮은순으로봐서 불만인것들을 해결한 방안으로 짜줘... 구조랑 디자인 잘짜서 클코에넘겨"
- **폴센트 5대 불만 전면 해결**:
  1. **쿠팡 독점 탈피**: 쿠팡뿐만 아니라 11번가, G마켓 등 멀티몰 최저가를 함께 표기 (`쿠팡`, `11번가`, `G마켓` 쇼핑몰 태그).
  2. **강제 알림 피로도 0%**: 앱 진입 시 강제 알림 팝업 차단, 당근식 스마트 키워드 알림으로 본인이 원하는 품목만 수신.
  3. **가짜 최저가 박멸 & 장기 히스토리**: 1~2개월짜리 낚시 차트 대신, 30일/90일/180일/전체 기간 토글과 90일 실제 평균가 비교 제공.
  4. **육아맘 킬러 기능 [단위 가격 자동 계산]**: 기저귀 장당 단가, 분유 100g당 단가, 영양제 스틱당 단가를 계산기 없이 바로 확인 (`장당 349원`, `100g당 1,890원`).
  5. **경유 장난 없는 0.1초 원터치 직행**: 낚시성 추천 페이지 스크롤 없이, [구매하러 가기 ➔] 터치 시 해당 쇼핑몰 상품 페이지로 다이렉트 이동.
- **실측 라이브 목업**: `https://momcalendar.com/mock_hotdeal_v3.html` 완벽 구현 완료.

---

## 2. 화면 UI 구성 (위에서 아래로)

### ① 상단 섹션: 🔥 [지금이 타이밍] 폴센트식 2.3구좌 스와이프 캐러셀
- 90일 대비 역대 최저가 또는 20% 이상 급락한 핫딜 5~8건을 가로 스와이프로 노출.
- 사진 위에 거대 뱃지 절대 금지! 좌측 상단 초미니 직사각 마이크로 뱃지 (`역대최저`, `▼24%`, `맘캘PICK`)만 7px 패딩으로 부착.

### ② 중단 섹션: ⏰ [한정 특가] 폴센트 골드박스형 카운트다운 타이머 바
- "오늘 자정 마감 한정 특가" 또는 "실시간 가격급락" 알림 바.
- 우측에 `11:42:05` 실시간 카운트다운 타이머 배치.

### ③ 카테고리 칩 바
- `[전체]` `[기저귀/분유]` `[물티슈]` `[이유식/간식]` `[키즈패션]` `[가전/생활]` 슬라이드 칩.

### ④ 메인 핫딜: 🛍️ [마미톡식 2열 큰 사진 그리드]
- 1:1 정사각 썸네일, 사진 가림 없는 우측 상단 `♡` 찜 버튼.
- 쇼핑몰 뱃지 (`쿠팡`, `11번가`, `G마켓`) + 간결한 2줄 상품명.
- 할인율(레드 볼드) + 판매가(블랙 15px 볼드).
- **단위가격 녹색 텍스트**: `장당 349원`, `100g당 1,890원` 자동 노출.

### ⑤ 상세 분석: 📊 [폴센트 캡처 2번 완벽 벤치마킹 바텀시트] (카드 터치 시 오픈)
- 상단: 상품 썸네일(58px) + 쇼핑몰 + 상품명 + 🏆 역대 최저가 배너.
- **기간 토글 탭**: `[30일]` `[90일]` `[180일]` `[전체]` (터치 시 차트 실시간 재계산).
- **가격 차트**:
  - 최고가 점선 (그린 `#12B886` 또는 그레이) + 라벨
  - 최저가 점선 (레드 `#FF4742`) + 라벨
  - 가격 변동 보라색 그라데이션 영역 차트 (`#7C54C4`) + 호버/터치 포인트 인터랙션
- **3대 가격 비교 지표**:
  - 현재가: `41,900원`
  - 90일 평균가: `44,632원` (`▼2,732원 저렴`)
  - 역대 최저가: `41,900원`
- **단위 가격 분석 카드**: "이 상품은 120매 구성으로 **1장당 349원**입니다. 최근 3개월 평균(372원)보다 장당 23원 저렴해요!"
- **하단 구매 버튼**: `[구매하러 가기 ➔]` (사장님 파트너스 수익링크 0.1초 다이렉트 직행).

---

## 3. 핵심 자바스크립트 로직

### ① 단위가격 정규식 자동 계산 함수
```javascript
// 🍼 [육아맘 전용 단위가격 자동 계산기]
function getUnitPriceText(title, price) {
  if (!title || !price) return '';
  
  // 1. 매수 (기저귀, 물티슈 등) : 120매, 120p, 100장, 10팩 등
  var mSheets = title.match(/(\d+)\s*(매|장|p|P|피스)/);
  if (mSheets) {
    var count = parseInt(mSheets[1], 10);
    if (count > 0 && price / count >= 10 && price / count <= 5000) {
      return '장당 ' + Math.round(price / count).toLocaleString() + '원';
    }
  }

  // 2. 팩/박스/개 : 3박스, 4개, 10팩, 8입 등
  var mPack = title.match(/(\d+)\s*(팩|박스|개|입|병|캔|봉)/);
  if (mPack) {
    var pCount = parseInt(mPack[1], 10);
    if (pCount > 1 && pCount <= 100) {
      return mPack[2] + '당 ' + Math.round(price / pCount).toLocaleString() + '원';
    }
  }

  // 3. g/ml (분유, 이유식, 세제 등)
  var mWeight = title.match(/(\d+)\s*(g|ml|kg|L)/i);
  if (mWeight) {
    var val = parseFloat(mWeight[1]);
    var unit = mWeight[2].toLowerCase();
    if (unit === 'kg' || unit === 'l') val = val * 1000;
    if (val >= 100) {
      var per100 = Math.round((price / val) * 100);
      return '100' + (unit === 'l' || unit === 'ml' ? 'ml' : 'g') + '당 ' + per100.toLocaleString() + '원';
    }
  }

  return '';
}
```

### ② 폴센트형 정밀 SVG 가격 그래프 생성 함수
```javascript
// 📊 [폴센트 캡처 2번 실측 그래프 생성기]
function buildPolcentSvg(history, days) {
  if (!history || history.length < 2) return '';
  
  var now = Date.now();
  var cutoff = now - (days * 24 * 60 * 60 * 1000);
  var filtered = history.filter(function(d) { return new Date(d.date).getTime() >= cutoff; });
  if (filtered.length < 2) filtered = history.slice(-5); // 최소 5점 유지

  var prices = filtered.map(function(d) { return d.price; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var range = (maxP - minP) || 1;

  var W = 360, H = 140, padT = 24, padB = 24, padL = 10, padR = 10;
  var drawW = W - padL - padR;
  var drawH = H - padT - padB;

  var pts = filtered.map(function(d, i) {
    var x = padL + (i / (filtered.length - 1)) * drawW;
    var y = padT + drawH - ((d.price - minP) / range) * drawH;
    return { x: x, y: y, price: d.price, date: d.date };
  });

  var linePath = 'M ' + pts.map(function(p) { return p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' L ');
  var areaPath = linePath + ' L ' + pts[pts.length - 1].x.toFixed(1) + ' ' + (H - padB) + ' L ' + pts[0].x.toFixed(1) + ' ' + (H - padB) + ' Z';

  var minY = padT + drawH;
  var maxY = padT;

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="polcent-svg" style="width:100%; height:auto; overflow:visible;">' +
    '<defs>' +
      '<linearGradient id="pGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#7C54C4" stop-opacity="0.28"/>' +
        '<stop offset="100%" stop-color="#7C54C4" stop-opacity="0.0"/>' +
      '</linearGradient>' +
    '</defs>' +
    // 최고가 점선 (그린)
    '<line x1="' + padL + '" y1="' + maxY + '" x2="' + (W - padR) + '" y2="' + maxY + '" stroke="#12B886" stroke-dasharray="3,3" stroke-width="1.2"/>' +
    '<text x="' + padL + '" y="' + (maxY - 6) + '" fill="#12B886" font-size="10" font-weight="700">최고 ' + won(maxP) + '</text>' +
    // 최저가 점선 (레드)
    '<line x1="' + padL + '" y1="' + minY + '" x2="' + (W - padR) + '" y2="' + minY + '" stroke="#FF4742" stroke-dasharray="3,3" stroke-width="1.2"/>' +
    '<text x="' + padL + '" y="' + (minY + 14) + '" fill="#FF4742" font-size="10" font-weight="700">최저 ' + won(minP) + '</text>' +
    // 영역 채우기
    '<path d="' + areaPath + '" fill="url(#pGrad)"/>' +
    // 가격 곡선
    '<path d="' + linePath + '" fill="none" stroke="#7C54C4" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    // 포인트 점
    pts.map(function(p, idx) {
      var isLast = idx === pts.length - 1;
      return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (isLast ? '4.5' : '3') + '" fill="' + (isLast ? '#FF4742' : '#7C54C4') + '" stroke="#fff" stroke-width="1.8"/>';
    }).join('') +
  '</svg>';
}
```

---

## 4. CSS 스타일 규격 (모바일 최적화)

```css
/* 🛍️ 마미톡식 2열 핫딜 그리드 규격 */
.hotdeal-grid {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 14px 11px !important;
  padding: 0 16px 24px !important;
}
.hd-card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  flex-direction: column;
}
.hd-thumb-wrap {
  width: 100%;
  aspect-ratio: 1/1;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  background: #F8F9FA;
  border: 1px solid #F0F0F3;
}
.hd-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hd-info {
  padding: 7px 2px 2px;
}
.hd-meta {
  font-size: 10.5px;
  color: #8B95A1;
  font-weight: 500;
  margin-bottom: 2px;
  display: flex;
  gap: 4px;
}
.hd-mall-tag {
  background: #F2F4F6;
  color: #4E5968;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
}
.hd-title-txt {
  font-size: 12.5px;
  font-weight: 500;
  color: #191F28;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 34px;
}
.hd-price-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 3px;
}
.hd-discount {
  font-size: 14px;
  font-weight: 800;
  color: #FF4742;
}
.hd-price-val {
  font-size: 14.5px;
  font-weight: 800;
  color: #191F28;
}
.hd-unit-line {
  font-size: 10.5px;
  color: #00875A;
  font-weight: 600;
  margin-top: 2px;
}

/* 📊 폴센트식 가격 분석 바텀시트 규격 */
#hdBg {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(20, 10, 30, 0.55);
  z-index: 9994;
  backdrop-filter: blur(2px);
}
#hdSheet {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 412px;
  bottom: -110%;
  max-height: 88vh;
  overflow-y: auto;
  background: #ffffff;
  border-radius: 20px 20px 0 0;
  padding: 10px 16px calc(16px + env(safe-area-inset-bottom));
  z-index: 9995;
  transition: bottom 0.32s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
}
.sheet-handle {
  width: 32px;
  height: 4px;
  border-radius: 4px;
  background: #E3E0E8;
  margin: 0 auto 12px;
}

/* 차트 기간 탭 */
.chart-period-tabs {
  display: flex;
  background: #F2F4F6;
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
  margin-bottom: 12px;
}
.p-tab {
  flex: 1;
  border: 0;
  background: none;
  font-size: 11px;
  font-weight: 600;
  color: #8B95A1;
  padding: 5px 0;
  border-radius: 6px;
  cursor: pointer;
}
.p-tab.on {
  background: #fff;
  color: #191F28;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

/* 가격 비교 스펙 바 */
.price-stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  background: #F8F9FA;
  border-radius: 10px;
  padding: 10px 8px;
  margin-top: 12px;
  text-align: center;
}
.stat-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-lbl {
  font-size: 10.5px;
  color: #8B95A1;
}
.stat-val {
  font-size: 13.5px;
  font-weight: 700;
  color: #191F28;
}
.stat-val.red { color: #FF4742; }

/* 구매하러 가기 버튼 */
.btn-buy-direct {
  width: 100%;
  height: 48px;
  border-radius: 12px;
  background: #7C54C4;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  border: 0;
  cursor: pointer;
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
```

---

## 5. 클로드 코드 작업 요약 지시
1. `mock_hotdeal_v3.html`을 참고하여, 현재 `index.html`과 `test.html`의 핫딜 렌더링 로직을 본 규격으로 교체한다.
2. 기존에 단일 쿠팡만 보여주던 것에서 `h.mall`(`쿠팡`, `11번가`, `G마켓`) 태그를 붙인다.
3. `getUnitPriceText(title, price)` 함수를 통해 상품 제목에서 수량을 파싱해 `장당 349원`, `100g당 1,890원` 단위가격을 자동 표기한다.
4. 핫딜 카드 터치 시 열리는 바텀시트에 `[30일] [90일] [180일] [전체]` 기간 토글 및 최고가(녹색)/최저가(빨간색) 점선이 포함된 정밀 SVG 차트를 탑재한다.
5. `[구매하러 가기 ➔]` 버튼 클릭 시 0.1초 만에 해당 상품 수익링크(`h.link`)로 다이렉트 이동하도록 연결한다.
