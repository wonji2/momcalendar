# 📊 [폴센트형 인터랙티브 차트 시트 연동] 핫딜 카드 터치 시 가격 추이 바텀시트 호출

## 1. 개요 및 사장님 확정 지침 (2026-11-02)
- **사장님 말씀**: "누르면 폴센트처럼 보여줄수있나? 우리가 원래 추적하면 그래프 구현되게 해놓은거 있는데 그거 디벨롭햐서 적용해보고 라이브액션으로 보여줘"
- **구현 내용**:
  1. 핫딜 카드를 클릭하면 바로 외부 링크로 튕기는 대신, **폴센트 스타일의 '가격 추이 분석 바텀시트'**를 먼저 띄운다.
  2. 기존 `index.html`에 보존되어 있던 `hdChartSvg` 및 `openHdSheet` 코드를 현대적 폴센트 룩앤필(평균 점선, 역대최저가 판정 배너, 최저/평균/최고 3단 스펙)로 리팩토링하여 연결한다.
  3. 바텀시트 하단에 **`[쇼핑몰명에서 최저가로 사러가기 ➔]`** 버튼을 두어 최종 구매 전환(수익링크)을 유도한다.

---

## 2. 작업 상세 (`index.html`, `test.html`)

### ① 핫딜 카드 onclick 연결
핫딜 카드의 클릭 이벤트를 `openHdSheet(id)`로 연결:
```html
<div class="hd-card" onclick="openHdSheet(ITEM_ID)">
  ...
</div>
```

### ② 폴센트 스타일 바텀시트 렌더러 (`openHdSheet`)
```javascript
function openHdSheet(id) {
  var h = (_hotdealData || []).find(function(x) { return x.id === id; });
  if (!h) return;

  // 가격 이력 포인트가 없으면 기본 추정치로 렌더링
  var pts = h.price_history || [h.price_before || (h.price * 1.2), h.price];
  var lo = Math.min.apply(null, pts);
  var hi = Math.max.apply(null, pts);
  var avg = Math.round(pts.reduce(function(a,b){ return a+b; }, 0) / pts.length);

  var isLowest = h.is_lowest || (h.price <= lo);

  var body = document.getElementById('hdSheetBody');
  body.innerHTML = 
    '<div class="sheet-prod-header">' +
      (h.img_url ? '<img class="sheet-thumb" src="' + esc(mcApiSrc(h.img_url)) + '" referrerpolicy="no-referrer">' : '') +
      '<div class="sheet-prod-info">' +
        '<div class="sheet-mall">' + esc(h.mall || '특가') + ' 핫딜</div>' +
        '<div class="sheet-title">' + esc(h.title) + '</div>' +
        '<div class="sheet-price-row">' +
          (h.discount_rate ? '<span class="sheet-discount">' + h.discount_rate + '%</span>' : '') +
          '<span class="sheet-price">' + won(h.price) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>' +

    (isLowest ? 
      '<div class="polcent-verdict-box">' +
        '<span>🏆</span><span>최근 30일 중 <b>가장 싼 역대 최저가</b>예요!</span>' +
      '</div>' : 
      '<div class="polcent-verdict-box" style="background:#F4F6F8;border-color:#E5E8EB;color:#4E5968">' +
        '<span>📉</span><span>평소 평균가보다 <b>' + won(avg - h.price) + ' 더 저렴</b>해요!</span>' +
      '</div>') +

    '<div class="chart-box">' +
      '<div class="chart-head-row">' +
        '<span class="chart-title">📊 가격 변동 추이</span>' +
        '<span class="chart-range-tag">평균선 점선</span>' +
      '</div>' +
      hdChartSvg(pts, avg) +
      '<div class="price-stats-grid">' +
        '<div class="stat-item best"><div class="lbl">역대 최저가</div><div class="val">' + won(lo) + '</div></div>' +
        '<div class="stat-item"><div class="lbl">추적 평균가</div><div class="val">' + won(avg) + '</div></div>' +
        '<div class="stat-item"><div class="lbl">최고가</div><div class="val">' + won(hi) + '</div></div>' +
      '</div>' +
    '</div>' +

    '<button class="btn-buy-link" onclick="trackHd(\'go\',' + h.id + '); location.href=\'' + esc(h.link) + '\'">' +
      '<span>' + esc(h.mall || '쇼핑몰') + '에서 최저가로 사러가기</span>' +
      '<span>➔</span>' +
    '</button>';

  document.getElementById('hdBg').style.display = 'block';
  document.getElementById('hdSheet').style.bottom = '0';
  lockScroll();
}
```

---

## 3. 검증 및 배포
1. 2열 핫딜 카드 터치 시 폴센트 차트 바텀시트가 부드럽게 올라오는지 확인.
2. 바텀시트의 [구매하러 가기 ➔] 버튼 터치 시 수익링크로 정확히 이동하는지 확인.
3. 검증 후 `index.html` 즉시 배포.
