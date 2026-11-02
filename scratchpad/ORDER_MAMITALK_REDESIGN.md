# 🎀 [마미톡 벤치마킹] 맘캘린더 타이포그래피 & 카드 & 버튼 전면 리팩토링

## 1. 사장님 지침 및 캡처 전수 분석 (2026-11-02)
- **사장님 말씀**: "마미톡 참고해서 글자크기랑 버튼이나 카드형식 이런거 디벨롭해줘 글자크기 우리가 너무 큰거같애 아직도 방장이 보증하는공구 이거 제목글씨 봐봐"
- **마미톡(MamiTalk) 캡처 6장 핵심 분석**:
  1. **헤더 타이포그래피**:
     - 촌스러운 중앙 정렬 + 양쪽 하트 이모지(`💜 맘캘 방장이 보증하는 공구 💜`) 전면 배제.
     - **좌측 정렬(Left-align) + 16px 볼드 메인 타이틀 + 우측 `더보기 ›`(12.5px)**의 세련된 이커머스 규격.
  2. **화면 중간 중복 버튼 청소**:
     - 이미 하단 탭바(Bottom Nav)가 생겼는데도, 화면 중간에 거대한 `[공구] [핫딜] [세일] [커뮤니티]` 알약 4개가 떡하니 중복 노출되어 화면을 과도하게 차지함. ➔ **중간 4개 탭 영구 제거**.
     - 마미톡처럼 슬림한 **1줄 카테고리 칩**(`[전체]`, `[💜 내 찜]`, `[마감임박]`, `[오픈예정]`)만 가로 스크롤로 유지.
  3. **카드(Card) 규격**:
     - 브랜드/셀러명: 11px 연회색 (`#8B95A1`)
     - 상품명: 13px 미디엄, 2줄 말줄임 (`#191F28`, line-height 1.35)
     - 가격: 할인율(14px 볼드 레드 `#FF4742`) + 판매가(15px 볼드 `#191F28`)
     - 마이크로 뱃지: 10px 파스텔 칩 (`무료배송`, `맘캘특가`)

---

## 2. 작업 지침 (`index.html`, `test.html`)

### ① 헤더 타이틀 마미톡 스타일 전면 교체 (HTML & CSS)
중앙 정렬과 양쪽 이모지를 떼어내고, 마미톡식 좌측 정렬 모던 헤더로 변경:

```css
/* 🏷️ 마미톡식 좌측 정렬 모던 섹션 헤더 */
.main-banner-header,
.seller-header,
.nx-header,
#nextZone .nx-header {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  padding: 16px 16px 8px !important;
  text-align: left !important;
}

.main-banner-title,
.seller-title,
.nx-title,
#nextZone .nx-title {
  font-size: 16px !important; /* 마미톡 표준 16px 볼드 */
  font-weight: 700 !important;
  color: #191F28 !important;
  letter-spacing: -0.3px !important;
  margin: 0 !important;
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
}

/* 우측 '더보기 ›' 링크 */
.main-banner-more,
.seller-more,
.nx-more {
  font-size: 12.5px !important;
  font-weight: 500 !important;
  color: #8B95A1 !important;
  text-decoration: none !important;
}
```

- HTML 텍스트 변경:
  - 기존: `💜 맘캘 방장이 보증하는 공구 💜` ➔ **`맘캘 방장 보증 공구`** (양쪽 보라색 하트 영구 삭제)
  - 기존: `⭐ 맘캘린더 이웃셀러` ➔ **`이웃셀러 인기 공구`**
  - 기존: `🔔 오픈 예정 스포` ➔ **`오픈 예정 라이브/공구`** (우측 `전체일정 ›`)

---

### ② 화면 중간 중복 알약 버튼 영구 숨김 & 마미톡식 슬림 필터 칩 통일
하단바가 있으므로 화면 중간의 거대 4단 버튼은 숨기고, 공구 분류 칩을 마미톡 규격으로 정제:

```css
/* 🛑 화면 중간 거대 중복 버튼 숨김 (하단바로 이관 완료) */
.content-seg,
.nav-pills-mid,
.main-cat-segment {
  display: none !important;
}

/* 🏷️ 마미톡식 단정한 1줄 필터 칩 (가로 스크롤) */
.filter-chip-row {
  display: flex !important;
  gap: 6px !important;
  overflow-x: auto !important;
  padding: 8px 16px 12px !important;
  scrollbar-width: none !important;
  -webkit-overflow-scrolling: touch !important;
}
.filter-chip-row::-webkit-scrollbar { display: none; }

.f-chip {
  flex: 0 0 auto !important;
  height: 32px !important;
  padding: 0 13px !important;
  border-radius: 20px !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  border: 1px solid #E5E8EB !important;
  background: #ffffff !important;
  color: #4E5968 !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
}

/* 선택된 칩: 마미톡 다크 차콜 or 맘캘 라벤더 */
.f-chip.on {
  background: #191F28 !important;
  color: #ffffff !important;
  border-color: #191F28 !important;
  font-weight: 600 !important;
}
```

---

### ③ 카드(Card) 마미톡 고도화 규격 적용
공구 카드 및 핫딜 카드의 글자 크기, 행간, 가격 레이아웃을 마미톡처럼 슬림화:

```css
/* 📦 마미톡 2열 그리드 및 카드 타이포그래피 */
.card-sellerline {
  font-size: 11px !important;
  font-weight: 500 !important;
  color: #8B95A1 !important;
  margin-bottom: 2px !important;
}

.card-name {
  font-size: 13px !important;
  font-weight: 500 !important;
  color: #191F28 !important;
  line-height: 1.35 !important;
  letter-spacing: -0.2px !important;
  display: -webkit-box !important;
  -webkit-line-clamp: 2 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
}

/* 가격 영역 (할인율 빨간색 볼드 + 가격) */
.card-price-row {
  display: flex !important;
  align-items: baseline !important;
  gap: 5px !important;
  margin-top: 5px !important;
}

.card-discount {
  font-size: 14px !important;
  font-weight: 700 !important;
  color: #FF4742 !important; /* 마미톡 코랄 레드 */
}

.card-price {
  font-size: 15px !important;
  font-weight: 700 !important;
  color: #191F28 !important;
}

/* 마이크로 태그 (무료배송, 쿠폰할인) */
.card-badge-row {
  display: flex !important;
  gap: 4px !important;
  margin-top: 4px !important;
}
.card-mini-tag {
  font-size: 10px !important;
  font-weight: 600 !important;
  padding: 1px 4px !important;
  border-radius: 3px !important;
  background: #F2F4F6 !important;
  color: #4E5968 !important;
}
```

---

## 3. 검증 체크리스트
1. `💜 맘캘 방장이 보증하는 공구 💜`의 촌스러운 양쪽 하트가 사라지고, 마미톡처럼 **좌측 정렬 `맘캘 방장 보증 공구` (16px 볼드)**로 세련되게 들어갔는지 확인.
2. 화면 중간을 어지럽히던 거대 4단 버튼이 숨겨지고, 마미톡식 **슬림 1줄 칩(32px 알약)**만 깔끔하게 남았는지 확인.
3. 카드 내 셀러명(11px) ➔ 상품명(13px) ➔ 가격(15px) + 할인율(14px 레드) 계층이 마미톡과 똑같이 정갈해졌는지 확인.
4. 검증 후 `index.html` 즉시 배포.
