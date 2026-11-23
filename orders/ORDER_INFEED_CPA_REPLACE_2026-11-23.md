# ORDER — 인피드 배너 수익 링크 교체 (베베쿡 제거 · CPA 2 + CPS 2 신규)

작성 2026-11-23 (월) 19:10 KST · 자비스 · 기준 커밋 `89b70308`(main, 2026-11-23 18:19 KST)
대상 저장소 `wonji2/momcalendar` · 작업자 = 클로드 코드
근거 실측 텐핑 로그인 세션(2026-11-23 19:00~19:10 KST, 회원 `01091732632`) 캠페인 소문정보 원문

## 길아 님 지시

> "[#85388] 다 지금 수익돠는걸로 바꿔놔" (2026-11-23)

**이 오더의 경계**: 손대는 곳은 `IN_FEED_PROMOS` 배열과 그 배열의 만료 필터 **딱 두 군데**다.
핫딜·공구·검색·캘린더·관리자·광고 배너 테이블은 **범위 밖**이다. 건드리지 않는다.

---

## 실행 명령 (길아 님이 클로드 코드에 붙여넣는 1줄)

```
claude "orders/ORDER_INFEED_CPA_REPLACE_2026-11-23.md 끝까지 읽고 §1 표를 실제 index.html·test.html과 대조한 뒤 §3 배열 교체와 §4 만료 필터만 적용해. test.html 선반영 → §5 V1~V8 실제 실행 → 통과분만 같은 패치로 index.html 승격, 커밋은 A·B로 나눠 올려. 베베쿡 잔존 0건이 확인되기 전엔 index.html 손대지 마"
```

레포 루트(`wonji2/momcalendar` 체크아웃)에서 실행한다. 배포는 11-22 확립한 3중 안전장치(`af8d43c`: 1중 pre-commit 훅 · 2중 `deploy-pages` 게이트 · 3중 `backup/last-good`) 절차를 그대로 따른다.

---

## 1. 착수 전 대조 — 지금 상태 (2026-11-23 18:57~19:05 KST 실측)

**숫자나 문구가 다르면 그 자리에서 멈추고 보고한다.** 코드가 이미 바뀌었을 수 있다.

| 위치 | 실측 |
| --- | --- |
| `index.html` `var IN_FEED_PROMOS = [` | **1724행** (배열 끝 1775행) |
| `test.html` `var IN_FEED_PROMOS = [` | **1750행** (배열 끝 1813행) |
| `index.html` 배열 항목 | **5개** — `wink_free_trial` · `elyhigh_elem_10day` · `bebecook_trial` · `dousiki_clean` · `modooisa_quote` |
| `test.html` 배열 항목 | **6개** — 위 5개 + **`miso_cleaning_helper`** (2026-11-12 삭제 확정된 임시 링크 `https://miso.kr` 가 아직 남아 있다. `index.html`에는 없다 → test가 index보다 한 세대 뒤처진 상태) |
| 기본 노출 시안 | `_infeedMode` 기본값 **'2'** (키즈노트 원형). 썸네일은 `.mc-kn-thumb` **72×54px**(480px 이하 68×50, 360px 이하 64×48) `object-fit: cover`, `contain:true`면 `object-fit: contain` + `#FFF5E8` 패딩 |
| DB 우회 여부 | 공개 REST `banners_public?active=eq.true&type=eq.infeed` → **`[]` (0건)**. 즉 지금 화면의 인피드는 **전부 코드 배열**이 그린다. (DB에 `type=infeed` 행이 1건이라도 켜지면 코드 배열은 통째로 대체된다 — §6 참조) |
| 베베쿡 카드 | `bebecook_trial` → `url: 'https://www.bebecook.com/'` **추적 파라미터 0** → 클릭이 몇 번 나도 수익 0원. 유지 이유가 없다 |
| 썸네일 자산 | `momcal-wink-device.png` · `momcal-elyhigh-thumb.png` · `momcal-dousik-thumb.png` · `momcal-modooisa-thumb.png` (모두 320×228) |

---

## 2. 교체 지시 요약

| 구분 | id | 처리 |
| --- | --- | --- |
| 유지 | `wink_free_trial` | 그대로 (윙크 고유 추천링크, 정회원 전환 시 수익) |
| 유지 | `elyhigh_elem_10day` | 그대로 (`iryan.kr/t8hcvn4oui`, 38,500원) |
| **삭제** | `bebecook_trial` | **완전 삭제** (수익 0원 일반 링크) |
| **삭제** | `miso_cleaning_helper` | **test.html에만 있는 잔재.** `https://miso.kr` 임시 주소(제휴 링크 없음, 2026-11-12 삭제 확정). §3 블록으로 통째 교체하면 자동 제거된다 |
| 유지 | `dousiki_clean` | 그대로 (`iryan.kr/t8hcvo5rp4`, 16,500원) |
| 유지 | `modooisa_quote` | 그대로 (`iryan.kr/t8hcvn4ouh`, 16,800원) |
| **신규** | `daegu_babyfair` | CPA 2,475원 (12월 대구 베이비&키즈페어) |
| **신규** | `suwon_covex` | CPA 2,475원 (11월 수원 코베) — **2026-11-25 23:59 자동 종료** |
| **신규** | `momq_cps` | CPS 최대 3.6% (맘큐) |
| **신규** | `pulmuone_cps` | CPS 3.5% (풀무원) |

**최종 8개.** 인피드 슬롯은 `(slotIdx + _promoRandomSeed) % 길이`로 돌아가므로, 8개 전부가 수익 링크면 슬롯마다 반드시 수익 링크가 걸린다.

### 2-1. 신규 4종 실측 근거 (텐핑 소문정보 원문, 2026-11-23 19:00 KST)

| 캠페인 | CampaignID | 단가·적립률 | 기간·잔여 | 트래킹 URL | 공식 이미지(원본) | 지켜야 할 것 |
| --- | --- | --- | --- | --- | --- | --- |
| 12월 대구 베이비&키즈페어 무료입장 (참여/CPA) | `2026110416070001` | **2,475원** | 2026.11.06~**2026.12.05 23:59** · 잔여 412 | `https://iryan.kr/t8hdfn2ool` | `https://img.tenping.kr/Content/Upload/Images/2026110416070001_Dis_20261106095738.png` | **'베페' 금지**(반드시 "베이비페어"), 모바일 전용, AI 이미지 금지, 현장사진 인물 모자이크, 소문 목적 = **사전등록 완료**(클릭만으로는 수익 0) |
| 11월 수원 코베 베이비페어&유아교육 (참여/CPA) | `2026102023200001` | **2,475원** | 2026.10.21~**2026.11.25 23:59** · 잔여 285 | `https://iryan.kr/t8hdfn11i9` | `https://img.tenping.kr/Content/Upload/Images/2026102023200001_Dis_20261020232051.png` | 동일 + **D-2 마감**. 행사 11/26~29 수원메쎄 |
| 맘큐 (제휴몰/CPS) | `2024122415340001` | **최대 3.6%** | 2024.12.24~종료일 없음 · 클릭 유효 20일 | `https://iryan.kr/t8hdfn2wel` | `https://img.tenping.kr/Content/Upload/Images/2024122415340001_Dis_20241224153417.png` | 네이버페이 결제 적립 없음, **앱 설치 시 제휴링크 재경유 필요**, 부가세·배송비 제외 금액 적립, 구매확정 당일 검증(최대 255영업일) |
| 풀무원 (제휴몰/CPS) | `2023020809320001` | **3.5%** | 2023.02.08~종료일 없음 · 클릭 유효 20일 | `https://iryan.kr/t8hdfn2wem` | `https://img.tenping.kr/Content/Upload/Images/2023020809320001_Dis_20230208093225.jpg` | 베이비밀·디자인밀·녹즙 **미인정**, 정기배송 미인정, 연예인·모델 이미지 사용 금지, 커미션 익익월 지급 |

확인만 하고 **넣지 않은 후보 2종**(이유를 남긴다):
- **보리보리** (`2022012716480001`, 최대 2.1%, `https://iryan.kr/t8hdfn3bty`, 적립금·장바구니쿠폰 사용 불가): 적립률이 맘큐보다 낮고 카테고리(유아동복)가 맘큐와 겹치며, "보리보리 아동복 최대 2.1% 적립"이 18자로 360px 한 줄에 걸린다. **필요하면 이 링크로 바로 추가 가능.**
- **모두클린 / 서경석의 이사방**: 이미 라이브에 청소(`dousiki_clean`)·이사(`modooisa_quote`) CPA가 있어 같은 카테고리 중복이다. 이번 교체에서는 제외.

---

## 3. 배열 교체 (index.html 1724~1775행 / test.html 1750~1813행)

두 파일 모두 아래 블록으로 **배열 전체를 바꾼다**(test.html은 이 교체로 `miso_cleaning_helper`도 함께 사라진다). 기존 4개 유지 항목의 `id`·`url`·`thumb`은 **한 글자도 바꾸지 않는다**(추적 링크가 바뀌면 지금까지 쌓인 실적 집계가 끊긴다).

```js
// 인피드 혜택 카드 — 수익이 검증된 링크만 둔다 (길아 님 2026-11-23 "다 지금 수익나는 걸로 바꿔놔")
// 손대지 말 것: 유지 4종의 id·url·thumb. 수익 0원이던 베베쿡(bebecook_trial)과 임시주소 미소(miso_cleaning_helper, test 전용)는 2026-11-23 삭제.
var _IN_FEED_ALL = [
  {
    id: 'wink_free_trial',
    badge: '🎁 0원체험',
    title: '윙크 0원 체험! 플리츠마마백 증정',
    desc: '한글·수학 학습기 7일+교재 4권 무료배송',
    tag: '유아학습',
    thumb: 'momcal-wink-device.png',
    contain: true,
    url: 'https://m.wink.co.kr/client/mobile/acquaintance/?teacher=12533406&recommender=12358368&recType=parent'
  },
  {
    id: 'elyhigh_elem_10day',
    badge: '🎁 무료체험',
    title: '초등 엘리하이 0원+학습팩 증정',
    desc: '예비초~초6 전과목 강좌+전용 탭 무료배송',
    tag: '초등인강',
    thumb: 'momcal-elyhigh-thumb.png',
    contain: false,
    url: 'https://iryan.kr/t8hcvn4oui'
  },
  {
    id: 'daegu_babyfair',
    badge: '🎁 무료입장',
    title: '12월 대구 베이비페어 무료입장',
    desc: '12월 3일 엑스코, 사전등록 0원',
    tag: '베이비페어',
    thumb: 'momcal-daegu-fair-thumb.png',
    contain: false,
    url: 'https://iryan.kr/t8hdfn2ool'
  },
  {
    id: 'suwon_covex',
    badge: '🎁 무료입장',
    title: '수원 코베 베이비페어 무료입장',
    desc: '11월 26일 수원메쎄, 사전등록 0원',
    tag: '베이비페어',
    thumb: 'momcal-suwon-fair-thumb.png',
    contain: false,
    until: '2026-11-25T23:59:59+09:00',
    url: 'https://iryan.kr/t8hdfn11i9'
  },
  {
    id: 'momq_cps',
    badge: '🎁 3.6% 적립',
    title: '기저귀 맘큐에서 3.6% 적립',
    desc: '하기스 대용량 기획전도 결제금액 적립',
    tag: '육아쇼핑',
    thumb: 'momcal-momq-thumb.png',
    contain: true,
    url: 'https://iryan.kr/t8hdfn2wel'
  },
  {
    id: 'pulmuone_cps',
    badge: '🎁 3.5% 적립',
    title: '풀무원 장보면 3.5% 적립',
    desc: '콩나물 두부 살 때 결제금액 그대로 적립',
    tag: '식품적립',
    thumb: 'momcal-pulmuone-thumb.png',
    contain: true,
    url: 'https://iryan.kr/t8hdfn2wem'
  },
  {
    id: 'dousiki_clean',
    badge: '🎁 0원견적',
    title: '이사청소 시 피톤치드 살균케어 무료',
    desc: '전문가 신축 하자체크+친환경 세제 0원 견적',
    tag: '청소특가',
    thumb: 'momcal-dousik-thumb.png',
    contain: false,
    url: 'https://iryan.kr/t8hcvo5rp4'
  },
  {
    id: 'modooisa_quote',
    badge: '🎁 최저가비교',
    title: '포장이사 3곳 비교, 최대 30만 절감',
    desc: '평점 4.8 우수업체 실시간 방문견적 0원',
    tag: '이사특가',
    thumb: 'momcal-modooisa-thumb.png',
    contain: false,
    url: 'https://iryan.kr/t8hcvn4ouh'
  }
];
var IN_FEED_PROMOS = _IN_FEED_ALL.filter(function(p){
  if (!p || !p.until) return true;
  var t = new Date(p.until).getTime();
  return isNaN(t) || Date.now() < t;
});
if (!IN_FEED_PROMOS.length) IN_FEED_PROMOS = _IN_FEED_ALL.slice();   // 전부 만료돼도 카드·클릭이 죽지 않게
```

### 3-1. 손대지 말아야 할 것
- `IN_FEED_PROMOS`를 **참조하는 코드는 이름 그대로** 쓴다: `_promoRandomSeed`(1826행) · `getInFeedPromo()`(1830행) · `handleInFeedPromoClick()`(1834행) · 관리자 DB 주입부(1786~1791행 `IN_FEED_PROMOS.splice...`). 관리자 DB 주입은 `_IN_FEED_ALL`이 아니라 `IN_FEED_PROMOS`에 splice하므로 그대로 동작해야 한다.
- `cleaninglab_30k` 분기(1834행 이후)는 이미 배열에 없는 죽은 분기다. **이번에 지우지 않는다**(범위 밖).
- `_klookPool`·`_todayKlook`도 건드리지 않는다.

---

## 4. 썸네일 자산 (이미 main에 커밋됨 — 새로 만들지 말고 그대로 참조)

자비스가 텐핑 공식 배너 원본에서 **320×228(기존 썸네일과 동일 규격)** 로 가공해 커밋했다. 스톡 사진·생성 이미지 없다.

| 파일 | 원본(텐핑 공식) | 가공 |
| --- | --- | --- |
| `momcal-daegu-fair-thumb.png` | `2026110416070001_Dis_20261106095738.png` (1200×628) | 배너 전체를 320폭으로 축소, 좌우 잘림 없이 상하 여백은 배너 배경색(진녹색)으로 채움 |
| `momcal-suwon-fair-thumb.png` | `2026102023200001_Dis_20261020232051.png` (1200×628) | 동일(민트녹색) |
| `momcal-momq-thumb.png` | `2024122415340001_Dis_20241224153417.png` (600×600) | 중앙 4:3 크롭 |
| `momcal-pulmuone-thumb.png` | `2023020809320001_Dis_20230208093225.jpg` (1200×628) | 로고 영역만 크롭해 흰 배경 320×228 중앙 배치 |

`contain` 지정: 페어 2종은 `false`(꽉 채움), 로고형 2종은 `true`(로고가 잘리지 않게 여백 유지).

---

## 5. 검증 (V1~V8) — test.html에서 실제로 돌린 뒤 표로 보고

`test.html`은 11-23 다른 오더로 차단·robots 정리가 진행 중이다. **공개 URL이 아니라 클코 로컬 서버**(`python -m http.server` 등)로 띄워 검증하고, 라이브 노출 여부와 섞지 않는다. 기기 폭은 **390px · 360px · 320px** 3종, 브라우저는 모바일 에뮬레이션 기준.

| 번호 | 무엇을 | 통과 기준 | 방법 |
| --- | --- | --- | --- |
| V1 | 베베쿡·미소 제거 | `grep -c "bebecook" index.html test.html` → **0 0**, `grep -c "miso\.kr" test.html` → **0** | grep |
| V2 | 배열 정합 | `IN_FEED_PROMOS.length === 8`, id 8개가 §3과 일치, `_IN_FEED_ALL.length === 8` | 콘솔 |
| V3 | 타이틀 말줄임 0 | `.mc-kn-title` 전 카드에서 `scrollWidth <= clientWidth` (390·360·320px) | 콘솔 `[...document.querySelectorAll('.mc-kn-title')].filter(e=>e.scrollWidth>e.clientWidth)` → `[]` |
| V4 | 썸네일 표시 | 4개 신규 카드 모두 `naturalWidth > 0`, 404 없음(네트워크 탭) | 콘솔 `img.complete && img.naturalWidth` |
| V5 | 클릭 이동 | 카드 클릭 → `openLink` → `iryan.kr` 4개 URL 도달(모바일 웹뷰 포함). 팝업 차단 0 | 실기기 또는 에뮬 |
| V6 | 만료 필터 | `new Date('2026-11-25T23:59:59+09:00')` 경계에서 `suwon_covex`만 빠지고 7개 유지. 시계를 11-26으로 돌려 확인 | 콘솔에서 `Date.now` 스텁 또는 `until` 임시 변경 후 원복 |
| V7 | DB 주입 회귀 | 관리자에서 `type=infeed` 배너 1건을 test로 켰을 때 코드 8개가 그 1건으로 대체되고, 끄면 8개 복귀 | 관리자 또는 REST `banners_public` 확인 후 원복 |
| V8 | 콘솔 무에러 | 공구 피드 15번째 뒤 첫 인피드 + 60장 간격, 핫딜 40개 간격, 검색 1개 — 전 구간 콘솔 에러 0 | 콘솔 |

**승격 조건**: V1~V8 전부 통과 → 같은 패치로 `index.html` 적용 → 라이브(`momcalendar.com`)에서 V1·V3·V4를 한 번 더 확인 → 보고.

---

## 6. 함정 (실제로 당한 것들)

1. **관리자 DB 인피드가 켜지면 코드 배열은 안 돈다.** 2026-11-23 19:05 기준 `banners_public`의 `type=infeed` 활성 행은 **0건**이라 지금은 코드가 노출원이다. 오더 실행 전후로 이 0건을 다시 확인하고, 1건이라도 켜져 있으면 **코드만 고쳐서는 화면이 안 바뀐다** — 그 사실을 보고할 것.
2. **가운뎃점(`·`) 금지.** 기존 베베쿡 desc의 `초기·중기`처럼 남아 있는 `·`도 카드 문구에 넣지 않는다. §3 블록은 이미 없음.
3. **'베페' 금지**(코베 캠페인 규정). 베이비페어는 반드시 풀 명칭.
4. **스톡·생성 이미지 금지**(2026-11-11 질책). §4 파일 외 다른 이미지 쓰지 말 것.
5. **추적 URL은 iryan.kr 정본만.** `www.bebecook.com` 같은 일반 홈페이지 주소로 때우면 수익 0원이다(이번 교체의 원인).
6. **`until`을 지우지 말 것.** 수원 코베는 11/25 23:59에 캠페인 자체가 끝난다. 필터를 빼면 끝난 행사 카드가 계속 돈다.
7. **유지 4종 id·url 변경 금지.** 실적 집계 키가 id다.
8. **test.html은 index.html과 배열이 다르다(6 vs 5).** test에만 `miso_cleaning_helper`(`https://miso.kr`)가 남아 있다. test만 8개로 바꾸고 index를 5개 그대로 두면 두 파일이 더 벌어진다 — **반드시 두 파일 모두 §3의 8개 블록으로 통일**한다. `miso-cleaning-thumb.jpg`·`thumbFb` 참조도 배열에서 사라져야 한다.

---

## 7. 커밋 (A·B 2개로 나눠 올린다)

| 커밋 | 대상 | 메시지 |
| --- | --- | --- |
| A | `test.html` | `test: 인피드 CPA 슬롯 교체 — 베베쿡 제거, 텐핑 실링크 4종(대구·수원 코베, 맘큐, 풀무원) 추가` |
| B | `index.html` | `feat: 인피드 수익 링크 교체 — 베베쿡(수익 0) 제거, CPA·CPS 실링크 4종 반영 (V1~V8 통과)` |

`git add -A` 금지. 커밋 후 각 SHA와 V1~V8 결과표를 노션 `🤖 클로드 코드(클코) 오더 · 소통 보드` 소통란에 남긴다.

---

## 8. 보고 양식

```
[인피드 교체] A=<sha> B=<sha>
V1 베베쿡 잔존: 0 / 0
V2 배열: 8 / 8
V3 말줄임: 390 OK, 360 OK, 320 OK (넘친 카드: 없음)
V4 썸네일: 4/4 로드
V5 클릭: 4/4 iryan 도달
V6 만료 필터: 11-25 이후 7개 유지 확인
V7 DB 주입 회귀: 확인
V8 콘솔 에러: 0
라이브 확인: momcalendar.com 공구 피드 15번째 뒤 카드 = <id>
이슈: (없으면 없음)
```
