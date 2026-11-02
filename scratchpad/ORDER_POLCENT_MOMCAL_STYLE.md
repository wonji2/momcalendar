# 🎨 [디자인 기획] 폴센트 × 맘캘린더 시그니처 핫딜 UI/UX 전면 개편

## 1. 사장님 기획 지침 (2026-11-02)
- **사장님 말씀**: "색상이나 생김새까지 폴센트 참고해서 이쁘고 심플하게 우리브랜드색도 녹여서 너가 기획해줘"
- **디자인 컨셉: [폴센트의 심플함] × [맘캘 소프트 라벤더 `#7C54C4`]**
  1. **초미세 감각**: 둔탁한 원형 보라색 알약 뱃지(`인기수요` 등) 영구 퇴출.
  2. **폴센트 특유의 코랄 레드 틴트 + 맘캘 라벤더 틴트의 투톤 조화**:
     - 가격 하락/최저가: **`역대최저`**, **`▼ 24%`** ➔ 소프트 코랄 레드 (`#FFF0EE` 바탕 + `#FF4742` 텍스트)
     - 맘캘 추천 딜: **`맘캘PICK`** ➔ 소프트 라벤더 (`#F3EEFA` 바탕 + `#7C54C4` 텍스트)
  3. **2.3구좌 스와이프 캐러셀**: 다음 카드가 살짝(0.3구좌) 보이게 설계해 자연스러운 스와이프 유도.
  4. **모든 섹션 헤더 14px 완전 일체화**: 공구예고, 방장보증, 이웃셀러, 핫딜 헤더 크기 100% 동일.

---

## 2. 작업 지침 (`test.html`, `index.html`)

### ① 상단 추천 핫딜 캐러셀 렌더러 교체 (JS)
```javascript
// 🔥 [폴센트 × 맘캘] 상단 핫딜 캐러셀 렌더러
box.innerHTML = '<div class="hdd-h">🔥 실시간 가격급락 핫딜</div><div class="hdd-row">' + pick.map(function(h, idx){
  var img = h.img_url 
    ? '<img src="' + esc(typeof mcApiSrc === 'function' ? mcApiSrc(h.img_url) : h.img_url) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;hdd-ph&quot;>HOT</div>\'">' 
    : '<div class="hdd-ph">HOT</div>';

  // 🏷️ 스마트 뱃지 룰 (폴센트식 코랄 레드 vs 맘캘 라벤더)
  var badgeHtml = '';
  if (idx === 0) {
    badgeHtml = '<span class="hdd-b b-coral">역대최저</span>';
  } else if (idx === 1) {
    badgeHtml = '<span class="hdd-b b-lavender">맘캘PICK</span>';
  } else if (h.change && h.change.indexOf('▼') !== -1) {
    badgeHtml = '<span class="hdd-b b-coral">' + esc(h.change) + '</span>';
  } else {
    badgeHtml = '<span class="hdd-b b-coral">가격급락</span>';
  }

  return '<button class="hdd-c" type="button" onclick="mcbDemandGo(' + (+h.id || 0) + ')">' +
    badgeHtml +
    img +
    '<div class="hdd-t">' + esc(h.title) + '</div>' +
    '<div class="hdd-p">' + won(h.price) + '</div>' +
  '</button>';
}).join('') + '</div>';
```

### ② 폴센트 × 맘캘 스타일 CSS 규격 교체
```css
/* ── 🔥 폴센트형 상단 핫딜 섹션 ── */
.hdd-h {
  font-size: 14px !important; /* 공구예고와 똑같이 14px 영구 통일 */
  font-weight: 700 !important;
  color: #191F28 !important;
  margin: 14px 16px 8px !important;
  letter-spacing: -0.2px !important;
}

.hdd-row {
  display: flex !important;
  gap: 10px !important;
  overflow-x: auto !important;
  padding: 4px 16px 14px !important;
  scroll-snap-type: x mandatory !important;
  scrollbar-width: none !important;
  -webkit-overflow-scrolling: touch !important;
}
.hdd-row::-webkit-scrollbar { display: none; }

/* 2.3구좌 폴센트 카드 (다음 카드가 살짝 보여 스와이프 유도) */
.hdd-c {
  flex: 0 0 calc((100% - 24px) / 2.3) !important;
  background: #ffffff !important;
  border: 1px solid #F0F0F3 !important;
  border-radius: 14px !important;
  padding: 10px !important;
  box-sizing: border-box !important;
  text-align: left !important;
  position: relative !important;
  scroll-snap-align: start !important;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02) !important;
  cursor: pointer !important;
}

.hdd-c img, .hdd-ph {
  width: 100% !important;
  aspect-ratio: 1 / 1 !important;
  object-fit: cover !important;
  border-radius: 10px !important;
  background: #F8F9FA !important;
}

/* 🏷️ 폴센트식 스마트 뱃지 */
.hdd-b {
  position: absolute !important;
  top: 14px !important;
  left: 14px !important;
  height: auto !important;
  line-height: 1.2 !important;
  padding: 3px 6px !important;
  border-radius: 4px !important;
  font-size: 10px !important;
  font-weight: 800 !important;
  letter-spacing: -0.2px !important;
  z-index: 2 !important;
}

/* 코랄 레드: 최저가 / 가격하락 */
.hdd-b.b-coral {
  background: #FFF0EE !important;
  color: #FF4742 !important;
}

/* 소프트 라벤더: 맘캘 PICK */
.hdd-b.b-lavender {
  background: #F3EEFA !important;
  color: #7C54C4 !important;
}

/* 상품명 (2줄 말줄임) */
.hdd-t {
  display: -webkit-box !important;
  -webkit-line-clamp: 2 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  line-height: 1.35 !important;
  color: #191F28 !important;
  margin-top: 8px !important;
  min-height: 32px !important;
}

/* 가격 */
.hdd-p {
  font-size: 14px !important;
  font-weight: 800 !important;
  color: #191F28 !important;
  margin-top: 4px !important;
  letter-spacing: -0.3px !important;
}

/* ── 📏 사이트 전체 섹션 헤더 14px 영구 통일 ── */
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

## 3. 검증 체크리스트
1. 촌스러운 보라색 '인기수요' 알약이 완전히 사라졌는지 확인.
2. 상단 핫딜 카드가 폴센트처럼 **소프트 코랄 레드 `역대최저`** 와 **맘캘 시그니처 `맘캘PICK`** 투톤 뱃지로 예쁘게 얹혀졌는지 확인.
3. 카드가 2.3구좌로 나뉘어 다음 카드가 살짝 보여 손가락으로 넘기기 편한지 확인.
4. 방장보증, 공구예고, 이웃셀러, 핫딜 타이틀이 전부 **14px**로 자로 잰 듯 통일되었는지 확인.
5. 검증 완료 후 `index.html` 즉시 배포.
