# 🚀 [폴센트 킬러 핫딜 전면 개편] 클로드 코드 1회 완결 마스터 지시서

## 📌 사장님 최종 확정 지침 (2026-11-02 4대 특명)
1. **[특명 1] 핫딜/세일 탭 진입 시 상단 공구 배너 4종 싹 숨김**:
   - 사장님 말씀: *"핫딜누르면 위에 맘캘방장 공구예정등등 배너는 안보이고 바로 핫딜만 보여야지"*
   - 핫딜/세일/커뮤니티 탭 진입 시: `.main-banner-section`, `#nextZone`, `#sellerZone`, `#subZone` 전면 숨김(`display: none !important;`) ➔ 헤더 바로 밑에 핫딜 최상단 노출.
2. **[특명 2] 쿠팡처럼 가격 바로 밑에 괄호 단위가격 사전 표시**:
   - 사장님 말씀: *"겹치거나 잘리는거 없애고 상품을 누르기전에 개당 단위가를 쿠팡처럼 미리 보여줘"*
   - 가격 바로 밑에 `(1장당 349원)`, `(100ml당 320원)`, `(1개당 120원)` 회색 괄호 단가 상시 노출.
3. **[특명 3] 줄맞춤(수직 정렬) 칼일치**:
   - 사장님 말씀: *"줄맞춤 안맞는거 다 정렬맞춰"*
   - 제목 2줄 높이(`height: 34px; line-height: 17px;`), 가격 줄 높이(`height: 20px;`), 단위가 줄 높이(`height: 16px;`)를 엄격 고정하여 **좌우 카드의 가격·단위가가 동일한 수평선(Pixel Baseline)에 완벽 정렬**되도록 함.
4. **[특명 4] 토글 칩 이모지 영구 삭제 & 겹침·잘림 방지 2단 분리**:
   - 사장님 말씀: *"이모티콘 다 빼 토글칩에"*, *"120+찜 이런건 없애 우린"*
   - 칩에서 이모지(`👶`, `🥗`, `🏠`, `🔌`) 전면 제거 ➔ `[전체] [육아] [식품] [리빙] [가전] [패션]`.
   - 사진 위 `120+ 찜`, `무료배송` 등 가짜 뱃지 완전 삭제.
   - 쿠팡식 2단 분리: 1단 가로 스크롤 칩 / 2단 좌측 카운트 + 우측 정렬 드롭다운 (겹침 0%).
5. **[참조 목업]**: `https://momcalendar.com/mock_hotdeal_v3.html` 에 실측 반영 완료.

---

## 🛠️ 작업 대상: `index.html` 및 `test.html` (라인별 정확한 교체 코드)

### 작업 1. `switchContent(ct)` 함수 수정 (`index.html` 약 2960행, `test.html` 약 2980행)

**기존 코드 찾기:**
```javascript
  document.getElementById('gongguWrap').style.display = ct==='gonggu'?'block':'none';
  document.getElementById('hotdealView').style.display = ct==='hotdeal'?'block':'none';
  document.getElementById('expView').style.display = ct==='exp'?'block':'none';
  { const sv=document.getElementById('saleView'); if(sv) sv.style.display = ct==='sale'?'block':'none'; }
  { const cv=document.getElementById('commView'); if(cv) cv.style.display = ct==='community'?'block':'none'; if(ct==='community'){ try{ loadCommunity(); }catch(e){ console.error(e); } } }   // 💬 커뮤니티(카페 글)
```

**아래 코드로 1:1 교체:**
```javascript
  document.body.dataset.ct = ct;
  var isG = (ct === 'gonggu');
  var mb = document.querySelector('.main-banner-section'); if(mb) mb.style.display = isG ? '' : 'none';
  var nz = document.getElementById('nextZone'); if(nz) nz.style.display = isG ? '' : 'none';
  var sz = document.getElementById('sellerZone'); if(sz) sz.style.display = isG ? '' : 'none';
  var sb = document.getElementById('subZone'); if(sb) sb.style.display = isG ? '' : 'none';
  document.getElementById('gongguWrap').style.display = isG ? 'block' : 'none';
  document.getElementById('hotdealView').style.display = ct==='hotdeal'?'block':'none';
  document.getElementById('expView').style.display = ct==='exp'?'block':'none';
  { const sv=document.getElementById('saleView'); if(sv) sv.style.display = ct==='sale'?'block':'none'; }
  { const cv=document.getElementById('commView'); if(cv) cv.style.display = ct==='community'?'block':'none'; if(ct==='community'){ try{ loadCommunity(); }catch(e){ console.error(e); } } }   // 💬 커뮤니티(카페 글)
```

---

### 작업 2. `renderHotdeals()` 및 `hdCardHtml(h, opt)` 2열 그리드 교체 (`index.html` 약 3366~3475행, `test.html` 약 3380~3490행)

**기존 `renderHotdeals()` 찾기:**
```javascript
function renderHotdeals(){
  const el=document.getElementById('hotdealList');
  const live=(_hotdealData||[]).filter(h=>!hdExpired(h));
  if(!live.length){
    el.innerHTML=emptyBox('hotdeal');
    return;
  }
  _hdIdx=0;                                   // 위쪽 8장은 즉시 로드하려고 매 렌더마다 초기화
  el.innerHTML=hdOrder(hdDedupe(live)).map(h=>hdCardHtml(h)).join('');
}
```

**아래 코드로 교체 (`.hotdeal-grid` 래퍼 추가):**
```javascript
function renderHotdeals(){
  const el=document.getElementById('hotdealList');
  const live=(_hotdealData||[]).filter(h=>!hdExpired(h));
  if(!live.length){
    el.innerHTML=emptyBox('hotdeal');
    return;
  }
  _hdIdx=0;
  el.innerHTML='<div class="hotdeal-grid">' + hdOrder(hdDedupe(live)).map(h=>hdCardHtml(h)).join('') + '</div>';
}
```

**기존 `hdCardHtml(h, opt)` 찾기 및 교체:**
기존 `function hdCardHtml(h,opt){ ... return ... }` 함수 전체를 아래의 **칼정렬 2열 카드 렌더러**로 교체:
```javascript
function hdCardHtml(h,opt){
  const mall=h.mall || ((h.source==='coupang'||h.source==='goldbox')?'쿠팡':'');
  
  // 쿠팡식 괄호 단위가격 (기존 hcUnitPrice 활용)
  const unit=hcUnitPrice(h);
  var unitTxt='&nbsp;';
  if(unit) unitTxt='(1개당 '+wonFmt(unit)+')';
  else if(h.change && String(h.change).indexOf('▼')!==-1) unitTxt='('+esc(h.change)+')';

  const HD_HAS_HISTORY={toss:1,coupang:1,goldbox:1,adpick:1};
  const tracked=!!h.product_id && !!h.price && (HD_HAS_HISTORY[h.source] || !!h.price_before);
  const eager = (_hdIdx++ < 8);
  const imgUrl = h.img_url ? (typeof mcApiSrc==='function'?mcApiSrc(h.img_url):h.img_url) : '';
  const thumb = imgUrl
    ? '<img class="hd-thumb" src="'+esc(imgUrl)+'" alt="" loading="'+(eager?'eager':'lazy')+'" decoding="async" referrerpolicy="no-referrer" onerror="this.outerHTML=\'<div class=&quot;hd-ph&quot;>🔥</div>\'">'
    : '<div class="hd-ph">🔥</div>';

  var bHtml = '';
  if(h.is_lowest) bHtml = '<span class="c-micro-badge badge-red">역대최저</span>';

  const clickAction = tracked
    ? 'onclick="trackHd(\'open\','+h.id+');openHdSheet('+h.id+')"'
    : 'onclick="trackHd(\'go\','+h.id+');openLink(\''+esc(h.link||'#')+'\')"';

  return '<div class="hd-card" '+clickAction+'>' +
    '<div class="hd-thumb-wrap">' +
      thumb +
      bHtml +
      '<div class="hd-wish-heart">♡</div>' +
    '</div>' +
    '<div class="hd-info">' +
      '<div class="hd-meta">' +
        (mall ? '<span class="hd-mall-tag">'+esc(mall)+'</span>' : '') +
        '<span>'+esc(h.major||'')+'</span>' +
      '</div>' +
      '<div class="hd-title-txt">'+esc(h.title)+'</div>' +
      '<div class="hd-price-row">' +
        (h.discount_rate && h.discount_rate<=65 ? '<span class="hd-discount">▼ '+h.discount_rate+'%</span>' : '') +
        '<span class="hd-price-val">'+wonFmt(h.price)+'</span>' +
      '</div>' +
      '<div class="hd-unit-line">' + unitTxt + '</div>' +
    '</div>' +
  '</div>';
}
```

---

### 작업 3. 상단 특가 문구 교정 (`index.html` 약 8230행, `test.html` 약 8250행)

**기존 코드 찾기:**
```javascript
box.innerHTML='<div class="hdd-h">🔥 맘캘러가 지금 많이 찾는 특가</div><div class="hdd-row">'+pick.map(function(h){
```

**아래 코드로 1:1 교체:**
```javascript
box.innerHTML='<div class="hdd-h">🔥 가격 뚝! 쟁여둘 핫딜 <span class="hdd-sub">평소보다 훅 내려갔을 때 쟁여두세요</span></div><div class="hdd-row">'+pick.map(function(h){
```

---

### 작업 4. CSS 칼정렬 규격 추가 (`<style id="mc-polcent">` 안쪽 맨 아래 추가)

```css
/* 🎯 공구 외 탭(핫딜, 세일, 커뮤니티)에서는 상단 공구 배너·스포·이웃셀러 완전 숨김 */
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

/* 상단 메인 탭바 1줄 고정 */
.content-seg .cseg {
  white-space: nowrap !important;
  font-size: 12.5px !important;
  padding: 8px 2px !important;
}

/* 🛍️ 마미톡식 2열 핫딜 그리드 (수직 라인 칼정렬) */
.hotdeal-grid {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 14px 11px !important;
  padding: 4px 0 24px !important;
}
.hd-card {
  background: #fff !important;
  border-radius: 12px !important;
  overflow: hidden !important;
  cursor: pointer !important;
  display: flex !important;
  flex-direction: column !important;
  position: relative !important;
}
.hd-thumb-wrap {
  width: 100% !important;
  aspect-ratio: 1/1 !important;
  border-radius: 12px !important;
  overflow: hidden !important;
  position: relative !important;
  background: #F8F9FA !important;
  border: 1px solid #F0F0F3 !important;
}
.hd-thumb {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
}
.hd-wish-heart {
  position: absolute !important;
  top: 7px !important;
  right: 7px !important;
  color: #fff !important;
  font-size: 15px !important;
  text-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
  z-index: 2 !important;
}
.c-micro-badge {
  position: absolute !important;
  top: 7px !important;
  left: 7px !important;
  font-size: 9.5px !important;
  font-weight: 700 !important;
  padding: 2px 5px !important;
  border-radius: 4px !important;
  letter-spacing: -0.2px !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08) !important;
  z-index: 2 !important;
}
.badge-red { background: #FFF0EE !important; color: #FF4742 !important; }

/* 📏 줄맞춤 칼정렬: 높이 엄격 고정 */
.hd-info { padding: 7px 2px 2px !important; }
.hd-meta {
  font-size: 10.5px !important;
  color: #8B95A1 !important;
  font-weight: 500 !important;
  margin-bottom: 2px !important;
  height: 18px !important;
  display: flex !important;
  gap: 4px !important;
  align-items: center !important;
}
.hd-mall-tag {
  background: #F2F4F6 !important;
  color: #4E5968 !important;
  padding: 1px 4px !important;
  border-radius: 3px !important;
  font-size: 10px !important;
  font-weight: 600 !important;
}
.hd-title-txt {
  font-size: 12px !important;
  font-weight: 600 !important;
  color: #191F28 !important;
  line-height: 17px !important;
  height: 34px !important;
  display: -webkit-box !important;
  -webkit-line-clamp: 2 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
}
.hd-price-row {
  display: flex !important;
  align-items: baseline !important;
  gap: 4px !important;
  margin-top: 3px !important;
  height: 20px !important;
}
.hd-discount {
  font-size: 13px !important;
  font-weight: 800 !important;
  color: #FF4742 !important;
}
.hd-price-val {
  font-size: 14.5px !important;
  font-weight: 800 !important;
  color: #191F28 !important;
}

/* 🏷️ 쿠팡식 회색 괄호 단위가격 (고정 높이로 좌우 수평선 일치) */
.hd-unit-line {
  font-size: 11.5px !important;
  color: #767676 !important;
  font-weight: 500 !important;
  margin-top: 2px !important;
  height: 16px !important;
  line-height: 16px !important;
}
.hdd-sub {
  font-size: 11.5px !important;
  font-weight: 400 !important;
  color: #8B95A1 !important;
  margin-left: 6px !important;
}
```
