# [동의어/별칭 사전 대폭 확장: 맘캘봇 및 통합검색 0토큰 고도화 오더]

## 1. 목적
- 손님이 영문/한글/줄임말 중 어떤 방식으로 검색하거나 맘캘봇에 물어보아도 토큰 소모 없이 즉각 0.01초 만에 찰떡같이 찾아내도록 동의어 사전을 확장합니다.
- `index.html` 및 `test.html`의 `BRAND_ALIAS` 상수에 아래 50대 핵심 육아/패션/리빙 한-영 동의어를 기본 탑재하고, `expandQuery()` 및 맘캘봇 검색 쿼리에서 양방향 확장(`nike ↔ 나이키`)을 적용합니다.

## 2. BRAND_ALIAS 확장 목록 (50종)
```javascript
const BRAND_ALIAS = [
  // 1. 스포츠 / 패션 / 신발
  ['nike', '나이키'],
  ['adidas', '아디다스'],
  ['new balance', '뉴발란스'],
  ['뉴발', '뉴발란스'],
  ['crocs', '크록스'],
  ['ugg', '어그'],
  ['zara', '자라'],
  ['uniqlo', '유니클로'],
  ['mlb', '엠엘비'],

  // 2. 가전 / 디지털 / 리빙
  ['apple', '애플'],
  ['airpods', '에어팟'],
  ['iphone', '아이폰'],
  ['ipad', '아이패드'],
  ['samsung', '삼성'],
  ['galaxy', '갤럭시'],
  ['buds', '버즈'],
  ['dyson', '다이슨'],
  ['philips', '필립스'],
  ['braun', '브라운'],
  ['vornado', '보네이도'],
  ['balmuda', '발뮤다'],

  // 3. 기저귀 / 분유 / 물티슈 / 수유용품
  ['huggies', '하기스'],
  ['pampers', '팸퍼스'],
  ['libero', '리베로'],
  ['aptamil', '압타밀'],
  ['novalac', '노발락'],
  ['bebesup', '베베숲'],
  ['penelope', '페넬로페'],
  ['mother-k', '마더케이'],
  ['hegen', '헤겐'],
  ['doubleheart', '더블하트'],
  ['umee', '유미'],
  ['upang', '유팡'],
  ['spectra', '스펙트라'],
  ['relive', '릴리브'],

  // 4. 스킨케어 / 의약외품 / 영양제
  ['bepanthen', '비판텐'],
  ['physiogel', '피지오겔'],
  ['atopalm', '아토팜'],
  ['illiyoon', '일리윤'],
  ['mongdies', '몽디에스'],
  ['mustela', '무스텔라'],
  ['primage', '쁘리마쥬'],
  ['lactofit', '락토핏'],
  ['orthomol', '오쏘몰'],

  // 5. 유모차 / 가구 / 카시트 / 매트
  ['stokke', '스토케'],
  ['tripp trapp', '트립트랩'],
  ['bugaboo', '부가부'],
  ['butterfly', '버터플라이'],
  ['ergobaby', '에르고베이비'],
  ['pognae', '포그내'],
  ['sidiz', '시디즈'],
  ['iloom', '일룸'],
  ['alzipmat', '알집매트'],
  ['creamhaus', '크림하우스'],

  // 6. 기존 별칭 유지
  ['kret', '크렛'],
  ['bas', '바스'],
  ['weck', '웩'],
  ['레꼴드', '레꼴뜨']
];
```

## 3. 적용 지침
1. `index.html`과 `test.html`의 `BRAND_ALIAS`에 위 배열을 병합 교체할 것.
2. 맘캘봇의 `mcbSend()` 내부 검색 로직에서도 `expandQuery()`를 거쳐 영문/한글 모두 검색 후보로 처리할 것.
3. 작업 완료 후 `test.html`에서 "nike", "나이키", "압타밀", "aptamil" 검색 시 동일한 결과가 0.01초 만에 정상 출력되는지 검증할 것.
