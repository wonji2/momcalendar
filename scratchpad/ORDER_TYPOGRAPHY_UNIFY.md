# 📏 [디자인 헌법 교정] 섹션 타이틀 14px 완전 통일 지시서

## 1. 사장님 지적 사항 (2026-11-02)
- **사장님 말씀**: "맘캘방장보증공구랑 이웃셀러 글자가 너무커 공구예고처럼 줄여줘 모든페이지 통일되게", "너가 어제 글자수 짜줬는데 왜이렇게 들쑥날쑫한겨"
- **원인 분석**:
  - `index.html` 하단(line 498750)에 `.main-banner-title, .seller-title, .promo-head { font-size: 17px; }` 라는 17px 오버라이드가 박혀 있었음.
  - 이로 인해 `오픈 예정 스포`(`.nx-title`)는 **14px**인데, `맘캘 방장 보증 공구`와 `이웃셀러`는 **17px**로 툭 튀어나와 화면 전체가 들쑥날쑥하고 언밸런스해졌음.

---

## 2. 작업 지침 (`test.html`, `index.html`)

### ① 3대 메인 섹션 타이틀 14px로 100% 일체화 (CSS)
기존 17px 오버라이드를 완전히 삭제하고, 모든 섹션 제목을 공구예고(`.nx-title`)와 동일한 **14px / 700 bold**로 대못을 박습니다:

```css
/* ── 📏 모든 섹션 헤더 타이틀 규격 14px 영구 통일 ── */
.main-banner-title,
.seller-title,
.nx-title,
#nextZone .nx-title,
.promo-head {
  font-size: 14px !important;
  font-weight: 700 !important;
  color: #191F28 !important;
  letter-spacing: -0.2px !important;
  line-height: 1.4 !important;
}

/* 상하 여백도 공구예고와 똑같이 단정하게 정렬 */
.main-banner-header {
  padding: 12px 16px 8px !important;
}
.seller-title {
  padding: 0 16px !important;
  margin-bottom: 8px !important;
}
#nextZone .nx-head {
  padding: 0 16px !important;
  margin: 12px 0 8px !important;
}
```

---

## 3. 검증 체크리스트
1. `💜 맘캘 방장이 보증하는 공구 💜` 글자 크기가 공구예고와 똑같은 **14px**로 줄어들었는지 확인.
2. `⭐ 맘캘린더 이웃셀러` 글자 크기도 **14px**로 동일하게 맞아떨어지는지 확인.
3. 세 섹션(`방장 보증`, `오픈 예정 스포`, `이웃셀러`)의 타이틀 크기와 여백이 자로 잰 듯 완벽하게 일체화되었는지 확인.
4. 검증 완료 후 `index.html` 즉시 배포.
