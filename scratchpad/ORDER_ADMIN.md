# 맘캘린더 긴급 개선 및 관리자페이지(admin.html) 개편 오더 (2026-11-02)

> **사장님 절대 원칙 & 주의사항**
> 1. **토큰 절약**: 파일 전체를 통째로 다시 쓰지 마라. 반드시 지정된 함수/CSS 블록만 부분 수정해라.
> 2. **디자인 제약**: 어제처럼 카드를 뚱뚱하게 만들거나 테두리를 임의로 지우지 마라.
>    - 카드 패딩: `8px 12px`, 마진: `0 0 6px`, 모서리: `12px`, 테두리: `1px solid #EDE8F3` (테두리 삭제 절대 금지)
>    - 메인 색상: 맘캘 라일락 `#7C54C4`, 틴트 `#F7F2FD`, 텍스트 `#191F28`, 서브 `#8A7BA0`
>    - 폰트 크기: 상품명/제목 `13.5px`(Bold), 부가정보 `11.5px`
>    - 전역 자간: `letter-spacing: -0.02em`

---

## 📌 작업 1. [긴급] momcalendar.com 통합검색에 '커뮤니티 글' 섹션 추가

- **대상 파일**: `index.html` (또는 `test.html` 선반영)
- **대상 함수**: `renderSearchAll()` 만 교체 (전체 파일 쓰기 금지!)

### 구체적 구현 내용:
1. `renderSearchAll()` 시작 부분에 `_commData`가 없으면 `community_posts` 테이블에서 fetch하는 로직을 추가한다:
```javascript
  // 커뮤니티 데이터 없으면 검색 시 1회 로드 (최근 30일 글 최대 500개)
  if(!_commData){
    try{
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const cr = await fetch(`${SUPABASE_URL}/rest/v1/community_posts?select=article_id,board_id,board,title,nick,comments,views,has_image,summary,image_url,posted_at,url&posted_at=gte.${encodeURIComponent(since)}&order=posted_at.desc&limit=500`,
        {headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}});
      _commData = cr.ok ? await cr.json() : [];
    }catch(_){ _commData = []; }
  }
```

2. 검색어 매칭(q)으로 커뮤니티 글 필터링:
```javascript
  const cm = (_commData||[]).filter(c => hit(c.title, c.summary, c.board, c.nick));
```

3. `searchAllView` HTML 빌드 시, 공구(`sec('gonggu'...)`), 핫딜(`sec('hotdeal'...)`) 아래에 '💬 커뮤니티' 섹션을 렌더링한다:
   - 매칭된 글 중 상위 5건만 노출.
   - 카드는 기존 `renderCommunity()`에서 쓰는 `.comm-post` 규격(제목, 요약, 게시판, 닉네임, 작성시간, 썸네일)을 그대로 재사용.
   - 5건 초과 시 하단에 더보기 버튼 노출:
     `<button onclick="switchTab('comm')" style="width:100%;padding:10px;margin-top:6px;background:#F7F2FD;border:1px solid #E8DEF8;border-radius:10px;color:#7C54C4;font-size:12.5px;font-weight:700;cursor:pointer">💬 커뮤니티 탭에서 전체보기 (${cm.length}건) ›</button>`

4. **검증**: `test.html`에서 '아기상어' 또는 '기저귀' 검색 시 커뮤니티 글 섹션이 공구 아래에 깔끔하게 뜨는지 확인.

---

## 📌 작업 2. [클라우드] 핫딜 수집기 GitHub Actions cron 분 단위 변경

- **대상 파일**: `.github/workflows/hotdeal-cloud.yml`
- **목적**: 전 세계 저장소가 00분, 30분 정각에 몰려 깃허브 무료 큐가 3~4시간 지연되는 현상 방지.
- **수정**:
```yaml
on:
  schedule:
    - cron: '17,47 * * * *'
  workflow_dispatch:
```

---

## 📌 작업 3. [관리자페이지] admin.html 메인 홈(homeView) 모바일 4단 리팩토링

- **대상 파일**: `admin.html`
- **원칙**:
  - 기존 백엔드 연동(`admin_home_get`, `error_radar`, `hmAck`, `site_watch_recent`, `inqView` 모달)은 100% 보존.
  - 상단 탭 네비게이션과 메인 홈(`renderHome()`, `hmTodo()`)의 레이아웃만 모바일 최적화 4단 구조로 재배치.

### 세부 레이아웃 및 스타일 규격:

### 1) 상단 네비게이션 탭 정리 (모바일 최적화)
- 기존 17개 탭이 모바일에서 여러 줄로 지저분하게 꺾이는 문제를 해결:
- 전면 노출 4개 탭: `[ 🏠 홈 ]` `[ 💌 제보 ]` `[ 🛒 공구/핫딜 ]` `[ ⚙️ 더보기 ]`
- `더보기` 버튼 클릭 시 기존 나머지 탭(배너, 셀러, 회원, 출석, 통계, 챗봇)을 선택할 수 있는 깔끔한 드롭다운 또는 그리드 메뉴 노출.

### 2) 메인 홈(`homeView`) 4단 레이아웃

#### [1단] 🚦 시스템 신호등 (한 줄 알약 헤더)
- 기존의 거대한 텍스트 띠(`hm-band`) 대신 상단에 컴팩트한 알약 뱃지 3개 가로 배치:
  - `🟢 서비스 정상` (오류 0건 시) 또는 `🔴 고장 N건` (오류 있을 시)
  - `🟢 핫딜 수집 정상` (최근 1시간 내 수집 기록 확인)
  - `🟢 DB 용량: ${fr.db_mb}MB / 500MB`
- 배경: `#fff`, 테두리: `1px solid #E5E8EB`, 패딩: `10px 14px`, 둥근 모서리 `12px`

#### [2단] 🚨 오늘 할 일 (`hmTodo`) 카드 강조
- 운영자가 지금 당장 처리해야 할 건수를 알약 카드로 상단 전면 배치:
  - `💌 손님 제보 (N건)` -> 누르면 제보 탭으로 이동
  - `🛒 공구 승인 대기 (N건)` -> 누르면 대기 탭으로 이동
  - `👤 셀러 가입 승인 (N건)` -> 누르면 셀러 탭으로 이동
  - `🤖 챗봇 검토 (N건)`
- 할 일이 0건이면 `"🎉 오늘 처리할 할 일이 모두 끝났어요!"` 녹색 뱃지 노출.

#### [3단] 💌 손님 제보 미처리 건 인라인 카드
- `hmInq` 섹션을 오늘 할 일 바로 아래에 배치.
- 미처리 제보가 있으면 제목/내용 요약과 함께 원클릭 액션 버튼 노출:
  - `[상세 보기]` (기존 스크린샷 뷰어 모달 호출)
  - `[해결 완료]`

#### [4단] 📊 24시간 핵심 성과 (KPI) & ⚙️ 시스템 상세 접기
- `지난 24시간 핵심 KPI`(`_hmKpi`): 방문자, 공구 카드 클릭, 핫딜 이동, 찜 건수를 2x2 그리드 카드로 깔끔하게 배치.
- **가장 중요 (화면 다이어트)**:
  - 기존에 20줄씩 길게 늘어져 화면을 어지럽히던 `확인 필요(노랑/회색)`, `한도 게이지`, `처리한 것` 목록을 `<details style="background:#fff;border:1px solid #E5E8EB;border-radius:12px;padding:12px;margin-top:14px">` 태그로 감싸서 **기본 접힘(collapsed)** 상태로 둘 것!
  - 요약 타이틀: `<summary style="font-size:13px;font-weight:700;color:#6B7684;cursor:pointer">⚙️ 시스템 한도 및 경고 상세 (${chk.length}건) ▽</summary>`
  - 이렇게 접어두면 모바일 첫 화면이 3초 안에 스캔되는 토스/당근형 대시보드가 완성됨.

---

## 📌 작업 순서
1. `index.html` (또는 `test.html`)에 커뮤니티 검색 함수 반영 후 브라우저 확인.
2. `.github/workflows/hotdeal-cloud.yml` cron 수정.
3. `admin.html`의 탭 축소 및 `renderHome()` 4단 구조 + `<details>` 접기 적용.
4. 작업 완료 후 `git status` 확인 및 테스트 결과 보고.
