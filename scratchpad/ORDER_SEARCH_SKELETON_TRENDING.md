# 🔍 [검색 UX 전면 개편] 로딩 스켈레톤 UI + 최근 검색어 & 실시간 인기 검색어 레이어 연동

## 1. 개요 및 배경 (2026-11-03)
- **현황 문제**: 맘캘린더 검색창에 키워드(예: '젤리') 입력 후 결과 표시까지 **3~5초간 완전한 빈 화면(화이트아웃)**이 지속되어 손님 이탈률이 급증함. 또한 검색창 포커스 시 아무런 안내가 없어 탐색 편의성이 낮음.
- **벤치마킹 레퍼런스**:
  - **토스쇼핑 / 쿠팡**: 검색 즉시 부드러운 shimmer 애니메이션의 카드형 스켈레톤 로더 노출.
  - **당근 / 지그재그**: 검색창 포커스 시 '최근 검색어(로컬 저장)' + '실시간 인기 검색어 TOP 10' 바텀 레이어 노출로 원터치 검색 지원.
- **목표 파일**: `index.html`, `test.html` (검색 모듈)

---

## 2. 작업 상세 스펙

### ① 검색 결과 로딩 스켈레톤 (Skeleton UI)
- 검색 실행 즉시 기존 결과 영역에 4개의 스켈레톤 카드를 즉시 렌더링.
- CSS Shimmer 애니메이션:
```css
@keyframes skeleton-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton-box {
  background: linear-gradient(90deg, #f0f2f5 25%, #e6e8eb 50%, #f0f2f5 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: 8px;
}
.skeleton-card {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #f2f3f7;
}
.skeleton-thumb { width: 72px; height: 72px; border-radius: 8px; flex-shrink: 0; }
.skeleton-content { flex: 1; display: flex; flex-direction: column; gap: 8px; justify-content: center; }
.skeleton-line-title { height: 16px; width: 85%; }
.skeleton-line-sub { height: 13px; width: 50%; }
.skeleton-line-price { height: 18px; width: 40%; }
```
- JS 연동:
  - `doSearch()` 함수 시작 시 `searchResultContainer.innerHTML = renderSearchSkeletons(4);`
  - 데이터 파싱 완료 시 실제 카드로 교체.

---

### ② 검색창 포커스 시: 최근 검색어 & 실시간 인기 검색어 오버레이
검색창(`input[type="search"]` 또는 `#searchInput`) 포커스 시 결과 컨테이너 상단에 검색 도우미 레이어 노출:

1. **최근 검색어 (Recent Searches)**:
   - `localStorage.getItem('mc_recent_searches')` (최대 10개 보관, 중복 제거).
   - 태그 칩 형태: `[#젤리 ✕] [#기저귀 ✕] [#레날파우치 ✕]`
   - 우측 상단 `[전체삭제]` 버튼.
   - 칩 터치 시 해당 키워드로 즉시 검색 실행.
   - `✕` 클릭 시 해당 검색어만 로컬스토리지에서 삭제.

2. **실시간 인기 검색어 TOP 10 (육아맘 핫키워드)**:
   - 2열 5행 리스트로 깔끔하게 노출:
     1. 기저귀 2. 물티슈 3. 분유 4. 젤리 5. 핫딜
     6. 비판텐 7. 유산균 8. 레고 9. 고양이사료 10. 롱패딩
   - 순위 뱃지: 1~3위 볼드 코랄레드(`#FF3B30`), 4~10위 다크그레이(`#6B7684`).
   - 클릭 시 검색창에 자동 입력 후 바로 검색 결과 호출.

---

### ③ 검색창 디테일 UX 보강
1. **검색어 1초 삭제 (Clear) 버튼**:
   - 텍스트 입력 시 검색창 우측에 원형 `✕` 버튼 노출, 클릭 시 즉시 빈칸 처리 및 포커스 유지.
2. **검색 결과 카운트 & 카테고리 탭**:
   - `총 19개의 결과를 찾았어요`
   - 서브 필터 탭: `[전체 19] [공구 17] [핫딜 1] [커뮤니티 1]` 클릭 시 즉시 필터링.
3. **검색 결과 없음 화면 (Empty State)**:
   - 검색 결과가 0건일 때 썰렁한 빈 화면 대신:
     `🔍 '{검색어}'에 대한 검색 결과가 없어요`
     `요청하신 키워드로 핫딜 알림을 등록해 드릴까요?` ➔ 키워드 알림 바텀시트 호출 유도.

---

## 3. 클로드 코드(Claude Code) 실행 프롬프트
```text
index.html과 test.html의 검색 UX를 토스쇼핑 및 당근마켓 수준으로 대폭 개선해줘.

1. 검색 로딩 스켈레톤(Skeleton UI) 구현:
   - 검색 실행 즉시 결과 컨테이너에 4개의 스켈레톤 카드(shimmer 애니메이션)를 먼저 렌더링하고, 데이터 파싱 완료 시 실제 결과로 교체해줘. 3~5초간 빈 화면이 나오는 현상을 완전히 제거할 것.
2. 최근 검색어 & 인기 검색어 레이어 구현:
   - 검색창 클릭(focus) 시 검색어 입력 전까지 최근 검색어(localStorage 기반, 최대 10개, 개별/전체 삭제 가능)와 육아맘 실시간 인기 검색어 TOP 10(1. 기저귀, 2. 물티슈, 3. 분유, 4. 젤리, 5. 핫딜, 6. 비판텐, 7. 유산균, 8. 레고, 9. 고양이사료, 10. 롱패딩) 칩을 띄워줘.
   - 키워드 칩 터치 시 해당 단어로 즉시 검색이 실행되어야 함.
3. 검색 편의 기능:
   - 검색창 우측 원터치 텍스트 삭제(✕) 버튼 부착.
   - 검색 결과 상단에 '총 N개 결과 (공구 N · 핫딜 N · 커뮤니티 N)' 서브 필터 탭 연결.
   - 0건 결과 시 '키워드 알림 받기' 바텀시트 연결 버튼 제공.
모바일 웹뷰에서 터치 반응이 즉각적이고 끊김 없도록 순수 바닐라 JS와 CSS로 가볍고 깔끔하게 작성해줘.
```
