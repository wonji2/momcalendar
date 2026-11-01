# 맘캘린더 긴급 개선 및 관리자페이지(admin.html) 개편 오더 (2026-11-02)

> **사장님 지시 & 핵심 의중**
> 1. **PC와 모바일 각각 최적화 (반응형 대시보드)**:
>    - PC 화면: 넓은 모니터를 살려 2단/3단 그리드로 시원하게 한눈에 조망.
>    - 모바일 화면: 세로 1단 스크롤, 엄지손가락으로 누르기 편한 터치 카드(최소 44px 터치 영역).
> 2. **모든 핵심 정보가 첫 화면에 다 보일 것 (숨기지 말 것)**:
>    - ① 서버/크롤러/DB 상태 (신호등)
>    - ② 손님 제보 & 오늘 처리할 일 (미처리 목록 + 해결 버튼)
>    - ③ 방문자 수 & 핫딜 클릭 수 등 성과 지표 (KPI)
>    - ④ 시스템 한도 및 리소스 (DB 용량, 워커 등)
>    - 누락 없이 깔끔하고 정돈된 카드 형태로 다 보여야 함.
> 3. **토큰 절약 절대 원칙**: 파일 전체 덮어쓰기 금지! 해당 함수(`renderHome`, `hmTodo`, 관련 CSS)만 부분 수정.

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
  /* 상단 탭 바 모바일 가로 스크롤 최적화 */
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

#### [최상단 전폭] 🚦 1. 시스템 실시간 신호등 바
- 컴팩트한 알약 뱃지들을 가로 플렉스로 한눈에 배치:
  - `🟢 서비스 정상` (오류 없을 때) 또는 `🔴 고장 N건` (오류 레이더 감지 시)
  - `🟢 핫딜 수집 가동중` (최근 1시간 내 수집 성공 확인)
  - `🟢 DB 사용량: ${fr.db_mb}MB / 500MB (${Math.round(fr.db_mb/5)}%)`
  - `🟢 Cloudflare Worker API 안정`

#### [좌측 열 (모바일은 2번째 순서)]
#### 🚨 2. 오늘 내가 처리할 일 (`hmTodo`)
- 알약 카드 그리드로 즉시 확인:
  - `💌 손님 제보 (N건)` -> 누르면 제보 탭 이동
  - `🛒 공구 승인 대기 (N건)`
  - `👤 셀러 가입 승인 (N건)`
  - `🤖 챗봇 미해결 검토 (N건)`

#### 💌 3. 손님 제보 & VOC 실시간 현황 (`hmInq`)
- 제보 탭으로 굳이 들어가지 않아도 메인에서 미처리 제보 최신 3~5건을 카드 리스트로 바로 노출:
  - 제보 내용 / 보낸 시간 / 닉네임
  - `[🔍 스크린샷 보기]` 버튼 -> 누르면 캡처 모달 팝업
  - `[✅ 처리완료]` 원클릭 버튼

#### [우측 열 (모바일은 3번째 순서)]
#### 📊 4. 24시간 핵심 성과 지표 (KPI 그리드)
- 카드 4개 그리드 (PC 2x2, 모바일 2x2):
  - **방문자 (DAU)**: 숫자 + 전일 대비 `▲ N%`
  - **핫딜 수익링크 클릭**: 숫자 (실제 돈 버는 클릭)
  - **공구 카드 클릭 수**: 숫자
  - **찜(북마크) 수**: 숫자

#### ⚙️ 5. 시스템 한도 & 리소스 상태
- 게이지 바 형태로 시각화:
  - 수파베이스 DB 크기 (500MB 기준 프로그레스 바)
  - PC 여유 디스크 (GB)
  - 고장/경고 항목이 있으면 목록과 함께 `[처리함]` 버튼 제공

---

## 📌 검증 체크리스트
- [ ] PC 크롬 창에서 열었을 때 좌우 2열로 시원하게 배치되는가?
- [ ] 모바일 폰으로 열었을 때 가로 깨짐 없이 위에서 아래로 한눈에 쏙 들어오는가?
- [ ] 상단 신호등, 오늘 할 일, 손님 제보, 방문자/핫딜 클릭수, DB 용량이 전부 한 화면에서 확인되는가?
- [ ] `index.html`에서 커뮤니티 검색이 정상 작동하는가?
