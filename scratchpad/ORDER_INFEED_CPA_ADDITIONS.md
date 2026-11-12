# [기획 지시서] 맘캘린더 인피드 CPA 혜택 카드 교정 (100% 정식 제휴 링크만 탑재)

> 사장님(길아 님) 2026-11-12 확정 지침:
> "제휴링크 있는것만 넣어야지 뭔 개소리임.. 땜빵질해 뒤에서?"
> "제휴링크 없는건 빼는것도 하고 제휴링크 찾아서 집어넣을거를 말하라고"

---

## 🔴 원칙
1. **임시 링크 절대 금지**: `miso.kr`이나 `momcalendar.com` 등 실제 수익이 발생하지 않는 임시 URL은 100% 전면 삭제.
2. **실수익 검증 링크만 탑재**: 텐핑에서 정식 트래킹 키가 발급된 고단가(2.7만~3.8만 원) 캠페인만 등록.
3. **test.html 선반영**: index.html(라이브)은 절대 직접 수정하지 않고 test.html에서 먼저 검증.

---

## 1. 슬롯 조정 내용

### ① 제휴 링크 없는 미소(miso_cleaning_helper) 즉시 삭제
- 제휴 링크 미발급 상태인 미소 가사도우미 카드는 `test.html`에서 즉시 전면 삭제합니다.

### ② 텐핑 정식 트래킹 링크 발급 완료 2종 신규 투입 (총 7종 체제)

#### [신규 1] 엘리하이 키즈 0원 무료체험 (오늘 단가 27,500원)
- **id**: `elihigh_kids_trial`
- **배지**: `🎁 0원체험`
- **태그**: `유아학습`
- **제목**: `엘리하이 키즈 0원 무료체험` (14자)
- **설명**: `유아 탭 7일 무료배송+학습팩 증정` (17자)
- **CTA**: `신청하기`
- **썸네일**: `downloads/elihigh-icon.png` (로컬 fallback: `momcal-wink-device.png`)
- **url**: `https://iryan.kr/t8hcvn4g4q` (텐핑 정식 트래킹 링크)

```javascript
{
  id: "elihigh_kids_trial",
  badge: "🎁 0원체험",
  title: "엘리하이 키즈 0원 무료체험",
  desc: "유아 탭 7일 무료배송+학습팩 증정",
  tag: "유아학습",
  cta: "신청하기",
  thumb: "https://jrimg1s.mbest.co.kr/main/2026/260325k_cho_freeband.png",
  contain: true,
  url: "https://iryan.kr/t8hcvn4g4q"
}
```

#### [신규 2] 중등 엠베스트 7일 무료체험 (오늘 단가 33,000원)
- **id**: `mbest_middle_trial`
- **배지**: `🎁 0원체험`
- **태그**: `중등인강`
- **제목**: `중등 엠베스트 7일 무료체험` (14자)
- **설명**: `전과목 스타강사 유료강좌+전용 탭` (17자)
- **CTA**: `체험하기`
- **썸네일**: `http://img.tenping.kr/Content/Upload/Images/2019101116220001_Dis_20260825164422.jpg`
- **url**: `https://iryan.kr/t8hcxb9gxx` (텐핑 정식 트래킹 링크)

```javascript
{
  id: "mbest_middle_trial",
  badge: "🎁 0원체험",
  title: "중등 엠베스트 7일 무료체험",
  desc: "전과목 스타강사 유료강좌+전용 탭",
  tag: "중등인강",
  cta: "체험하기",
  thumb: "http://img.tenping.kr/Content/Upload/Images/2019101116220001_Dis_20260825164422.jpg",
  contain: true,
  url: "https://iryan.kr/t8hcxb9gxx"
}
```

---

## 2. 확정 7대 정예 슬롯 구성 (전수 실링크)

| 구분 | 캠페인 | 단가 | 트래킹 URL |
| :--- | :--- | :--- | :--- |
| **유아** | 윙크 0원 무료체험 | 파트너스 | `https://m.wink.co.kr/client/mobile/acquaintance/?teacher=12533406&recommender=12358368&recType=parent` |
| **유아** | **엘리하이 키즈 (신규)** | **27,500원** | `https://iryan.kr/t8hcvn4g4q` |
| **초등** | 초등 엘리하이 | **38,500원** | `https://iryan.kr/t8hcvn4oui` |
| **중등** | **중등 엠베스트 (신규)** | **33,000원** | `https://iryan.kr/t8hcxb9gxx` |
| **이유식** | 베베쿡 첫 이유식 | 공식 | `https://www.bebecook.com/` |
| **청소** | 청소대장 두식이 | **16,500원** | `https://iryan.kr/t8hcvo5rp4` |
| **이사** | 모두이사 최저가 비교 | **16,800원** | `https://iryan.kr/t8hcvn4ouh` |

- 전 카드 우측 상단 `AD` 뱃지(9px, 연한 회색) 유지.
- 320px 모바일 화면 기준 제목·설명 말줄임 없이 1줄 노출 확인.
