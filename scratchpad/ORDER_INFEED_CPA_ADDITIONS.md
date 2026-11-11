# [기획 지시서] 맘캘린더 네이티브 인피드 CPA 2종 슬롯 추가 (test.html 선반영 및 검증용)

> 사장님(원길아 님) 2026-11-11 최종 확정 지침:
> "태아보험이랑 미소청소연구소"
> "라이브 니멋대로 올리지말고 테스트에만 올려 넌, 넌 기획만해서 넘겨 클로드코드가 검증하게"

---

## 🔴 철칙: index.html(라이브) 절대 직접 수정 금지
- 작업 대상: `test.html` 에만 추가.
- 클로드 코드가 `test.html`에서 360px 모바일 1줄 가독성 및 회전 로직 전수 검증 후, 사장님 승인 시 라이브 승격.

---

## 1. 추가할 CPA 슬롯 2종 스펙 (IN_FEED_PROMOS 배열 추가)

### ① 👶 태아·어린이보험 실시간 비교
```javascript
{
  id: "baby_insurance_compare",
  badge: "🎁 상담혜택",
  title: "태아·어린이보험 3곳 실시간 비교 견적",
  desc: "현대해상·KB 1:1 맞춤 견적+상담 시 사은품 증정",
  tag: "보험비교",
  cta: "비교하기",
  thumb: "https://images.unsplash.com/photo-1555252333-9f8e92e65df9?w=320&h=228&fit=crop&q=80",
  contain: false,
  url: "https://momcalendar.com" // 제휴 링크 발급 전 임시 랜딩
}
```

### ② 🧹 미소 / 청소연구소 가사도우미
```javascript
{
  id: "miso_cleaning_helper",
  badge: "🎁 3만원쿠폰",
  title: "가사도우미 첫 이용 시 3만 원 할인쿠폰",
  desc: "전문 매니저 안심 가사청소+세탁 0원 견적",
  tag: "가사청소",
  cta: "쿠폰받기",
  thumb: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=320&h=228&fit=crop&q=80",
  contain: false,
  url: "https://momcalendar.com" // 제휴 링크 발급 전 임시 랜딩
}
```

---

## 2. 검증 체크리스트 (클로드 코드 실행)
1. `test.html` 내 `IN_FEED_PROMOS` 총 개수가 기존 5개에서 7개로 정상 확장되었는지 확인.
2. 360px 좁은 모바일 화면에서 제목(20~21자)과 설명(23~26자)이 말줄임표(...) 없이 1줄로 완벽히 떨어지는지 실측.
3. 새로고침 시 `_promoRandomSeed`에 의해 7개 슬롯이 골고루 첫 배너로 순환 노출되는지 확인.
4. 검증 완료 후 `test.html` 배포 및 사장님께 테스트 링크 보고.
