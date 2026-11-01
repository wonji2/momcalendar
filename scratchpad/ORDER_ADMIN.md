# 맘캘린더 긴급 개선 및 관리자페이지(admin.html) 개편 오더 (2026-11-02)

사장님 지시: 비개발자 시선에서 엉성했던 관리자페이지를 프로덕션급으로 정돈하고, 손님 화면 검색에 커뮤니티 글을 즉시 연결한다.
⚠ 토큰 절약 절대 원칙: 전체 파일을 다시 쓰지 말고, 해당 함수/블록만 부분 수정한다.

---

## 1. [긴급/라이브] momcalendar.com 통합검색에 '커뮤니티 글' 섹션 추가
- **대상**: `index.html` (또는 `test.html` 선반영) 내 `renderSearchAll()` 함수
- **작업 내용**:
  1. `renderSearchAll()` 시작 부분에서 `_commData`가 없으면 `community_posts` 테이블에서 최근 30일 글을 fetch한다.
     ```javascript
     _commData ? null : fetch(`${SUPABASE_URL}/rest/v1/community_posts?select=article_id,board_id,board,title,nick,comments,views,has_image,summary,image_url,posted_at,url&order=posted_at.desc&limit=500`,
       {headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}})
       .then(r=>r.ok?r.json():[]).then(j=>{_commData=j;}).catch(()=>{_commData=[];})
     ```
  2. 검색어(q)로 제목(title), 요약(summary), 게시판(board)을 매칭:
     ```javascript
     const cm = (_commData||[]).filter(c=>hit(c.title, c.summary, c.board));
     ```
  3. 공구, 핫딜 섹션 아래에 '💬 커뮤니티' 섹션을 추가:
     - 매칭된 글 상위 5건을 기존 `.comm-post` 카드 형태로 슬림하게 노출
     - 5건 초과 시 하단에 `[💬 커뮤니티 탭에서 전체보기 (N건)]` 버튼 배치 -> 클릭 시 `switchTab('comm')` 호출
  4. test.html에서 '아기상어' 검색 시 공구 13건 아래에 커뮤니티 글이 정상 노출되는지 확인.

---

## 2. [클라우드] 핫딜 수집기 깃허브 cron 시간 변경
- **대상**: `.github/workflows/hotdeal-cloud.yml`
- **수정**: 전 세계 00분/30분 몰림으로 인한 깃허브 무료 큐 지연을 피하기 위해 분 단위를 변경
  - 기존: `- cron: '*/30 * * * *'`
  - 변경: `- cron: '17,47 * * * *'`

---

## 3. [관리자] admin.html 메인 홈(homeView) 4단 모바일 리팩토링
- **원칙**: 기존 수파베이스 RPC(`admin_home_get`, `error_radar`), `hmAck`, `inqView` 로직은 100% 유지하고, 메인 첫 화면(`homeView`)만 토스/당근형 4단 구조로 재배치.
- **4단 구조**:
  1. **🚦 1단: 통합 시스템 신호등 (한 줄 알약)**
     - `🟢 서비스 정상` / `🟢 핫딜 수집중` / `🟢 DB 용량 정상 (92MB/500MB)`
  2. **🚨 2단: 오늘 내가 처리할 일 (Action Items)**
     - `inq`(손님 제보) 중 미처리 건이 있으면 맨 위에 강조 카드 노출
     - `[즉시 마감]`, `[오픈일 수정]`, `[확인 완료]` 원클릭 버튼 부착
  3. **📊 3단: 지난 24시간 핵심 성과 (KPI 미니 그리드)**
     - 방문자(DAU), 핫딜 클릭(수익링크), 오늘 오픈 공구 건수
  4. **⚙️ 4단: 시스템 상세 & 한도 (접힘 아코디언)**
     - 기존의 `확인 필요(노랑/회색)`, `한도 게이지`, `고장 난 것`을 아코디언 `<details>`로 깔끔하게 묶어 기본 접힘 처리(빨간불 🔴이 있을 때만 기본 펼침).
- **네비게이션 탭 정리**:
  - 상단 17개 탭 중 전면 노출은 4개로 압축: `[ 🏠 홈 ]` `[ 💌 제보 ]` `[ 🛒 공구/핫딜 ]` `[ ⚙️ 더보기 ]`
  - 나머지(배너, 셀러, 회원, 출석, AI등록 등)는 `더보기` 클릭 시 바텀시트/드로어로 선택 가능하게 정리.
