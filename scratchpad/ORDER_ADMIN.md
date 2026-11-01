# 맘캘린더 긴급 개선 및 관리자페이지(admin.html) 개편 오더 (2026-11-02)

> **사장님 지시 & 핵심 의중**
> 1. **PC와 모바일 각각 최적화 (반응형 대시보드)**:
>    - PC 화면: 넓은 모니터를 살려 2단 그리드로 시원하게 한눈에 조망.
>    - 모바일 화면: 세로 1단 스크롤, 엄지손가락으로 누르기 편한 터치 카드(최소 44px 터치 영역).
> 2. **모든 핵심 정보가 첫 화면에 다 보일 것 (숨기지 말 것)**:
>    - ① 서버/크롤러/DB 상태 (신호등)
>    - ② 손님 제보 & 오늘 처리할 일 (미처리 목록 + 해결 버튼)
>    - ③ 방문자 수 & 핫딜 클릭 수 등 성과 지표 (KPI)
>    - ④ 시스템 한도 및 리소스 (DB 용량, 워커 등)
> 3. **상품명 위생 정제 철저**: 계산기/사은품/기간어그로 문구 등록 차단 및 라이브 정제.
> 4. **토큰 절약 절대 원칙**: 파일 전체 덮어쓰기 금지! 해당 함수/파일만 부분 수정.

---

## 📌 작업 1. [긴급] momcalendar.com 통합검색에 '커뮤니티 글' 섹션 추가

- **대상 파일**: `index.html` (또는 `test.html` 선반영)
- **대상 함수**: `renderSearchAll()` 만 교체

### 구현 내용:
1. `renderSearchAll()` 시작 부분에 `_commData` 없으면 수파베이스에서 최근 30일 글 로드:
```javascript
  if(!_commData){
    try{
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const cr = await fetch(`${SUPABASE_URL}/rest/v1/community_posts?select=article_id,board_id,board,title,nick,comments,views,has_image,summary,image_url,posted_at,url&posted_at=gte.${encodeURIComponent(since)}&order=posted_at.desc&limit=500`,
        {headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}});
      _commData = cr.ok ? await cr.json() : [];
    }catch(_){ _commData = []; }
  }
```
2. 검색어 매칭 필터링:
```javascript
  const cm = (_commData||[]).filter(c => hit(c.title, c.summary, c.board, c.nick));
```
3. 공구, 핫딜 아래에 '💬 커뮤니티' 섹션 노출:
   - 상위 5건을 슬림 카드 형태로 렌더링.
   - 5건 초과 시 `[💬 커뮤니티 탭에서 전체보기 (${cm.length}건) ›]` 버튼 부착.
4. `test.html`에서 '아기상어' 검색 시 정상 작동 확인.

---

## 📌 작업 2. [클라우드] 핫딜 수집기 GitHub Actions cron 분 단위 변경

- **대상 파일**: `.github/workflows/hotdeal-cloud.yml`
- **수정**:
```yaml
on:
  schedule:
    - cron: '17,47 * * * *'
  workflow_dispatch:
```

---

## 📌 작업 3. [관리자] admin.html PC & 모바일 반응형 대시보드 개편

- **대상 파일**: `admin.html`
- **대상 함수/영역**: 상단 네비게이션 탭 CSS, `renderHome()`, `hmTodo()`, `_hmKpi()`

### 1) 반응형 그리드 구조 (CSS)
```css
/* PC (1024px 이상): 2열 대시보드 그리드 */
@media (min-width: 1024px) {
  .hm-dash-container {
    display: grid;
    grid-template-columns: 1.2fr 0.8fr;
    gap: 20px;
    align-items: start;
  }
  .hm-col-left { display: flex; flex-direction: column; gap: 20px; }
  .hm-col-right { display: flex; flex-direction: column; gap: 20px; }
}

/* 모바일 (1023px 이하): 1열 세로 스크롤 */
@media (max-width: 1023px) {
  .hm-dash-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .admin-tabs {
    display: flex;
    overflow-x: auto;
    white-space: nowrap;
    -webkit-overflow-scrolling: touch;
    gap: 6px;
    padding: 8px 12px;
  }
}
```

### 2) 메인 홈(`homeView`) 구성 요소 배치 (모든 정보 노출)
- **최상단 전폭**: 🚦 1. 시스템 실시간 신호등 바 (서비스 정상, 핫딜 수집 가동중, DB 용량 게이지)
- **좌측 열 (모바일 2번째)**:
  - 🚨 2. 오늘 내가 처리할 일 (`hmTodo`: 공구 대기, 제보, 셀러 승인 등)
  - 💌 3. 손님 제보 & VOC 실시간 현황 (`hmInq`: 스크린샷 보기, 처리완료 버튼)
- **우측 열 (모바일 3번째)**:
  - 📊 4. 24시간 핵심 성과 지표 (방문자 DAU, 핫딜 클릭수, 공구 클릭수, 찜수)
  - ⚙️ 5. 시스템 한도 & 리소스 상태 (DB 500MB 바, 디스크 여유)

---

## 📌 작업 4. [긴급/품질] 상품명 위생 정제 및 오염 차단 규칙

- **배경**: 인스타 크롤러가 링크트리 버튼명이나 셀러 판촉 문구를 상품명으로 긁어와 라이브가 오염됨 (사장님 지적: 「매트 장 수 계산기」, 「베르베린 공구특가 4박스 구매 2만원상당...」, 「2주간 펼쳐지는 아비노 베이비」).
- **대상 파일**:
  1. `tools/daily/drop_badname.mjs` (크롤러 등록 전 차단 및 라이브 오딧 기준)
  2. 라이브 Supabase DB `gonggu` 테이블 데이터 정제

### 1) `drop_badname.mjs` 정규식 보강:

```javascript
// A. [완전 제외 (BAD - 공구아님)] 링크트리 도구/서식/계산기
[/(계산기|계산법|자가진단|사이즈표|견적서|배송조회|상담신청|후기작성|문의하기)$/u, '도구링크'],

// B. [머리말 판촉/어그로 자동 깎아내기 (JUNK)]
// 1) 기간 어그로: 「2주간 펼쳐지는 아비노 베이비」 -> 「아비노 베이비」
[/^\s*\d+\s*[주일월]간\s*(펼쳐지는|진행되는|열리는|만나는|시작하는)\s+/u, ''],
[/^\s*(단\s*\d+일간?|역대급\s*특가|파격\s*세일|놓치면\s*후회할?|소문난)\s+/u, ''],
// 2) 공구/특가 머리말: 「공구특가」, 「단독특가」, 「오픈특가」
[/^\s*(공구특가|단독특가|오픈특가|기획특가|핫딜특가|초특가공구)\s+/u, ''],

// C. [꼬리표 사은품/프로모션 문구 자동 깎아내기 (stripTail 또는 cleanJunk)]
// 「... 4박스 구매 2만원상당의 루테인지아잔틴」 -> 「...」
[/\s+(\d+박스|\d+세트|\d+개|\d+병)\s*(구매|이상)?\s*.*(원\s*상당|증정|사은품|무료증정|선물|페이백).*$/u, ''],
// 꼬리 어그로 세일어: 「넾다세일」, 「창고대방출」, 「폭풍할인」
[/\s+(넾다세일|창고대방출|폭풍할인|역대급할인)\s*$/u, ''],
```

### 2) 라이브 DB 즉시 정제:
1. `name`이 `매트 장 수 계산기`인 행: `url`이 슈슈비 매트 공구이므로 `name`을 `슈슈비 셀프시공매트`로 UPDATE하거나, 순수 계산기 링크면 DELETE.
2. `name`에 `4박스 구매 2만원`이 들어간 행: `베르베린`으로 상품명 정제 UPDATE.
3. `name`에 `2주간 펼쳐지는`이 들어간 행: `아비노 베이비`로 상품명 정제 UPDATE.
4. 그 외 위 정규식을 통과시켜 기존 DB의 오염된 공구명 일괄 클렌징.
