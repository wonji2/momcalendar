# [오더] 마감 공구 TOP 20 자동 랭킹 [🔥 앵콜 투표소] 및 원터치 앵콜 요청 기능 개발

> **대원칙**:
> 1. 운영 라이브(`index.html`) 직접 수정은 절대 금지하며, `test.html`에서 먼저 완벽하게 구현 및 모바일 실측을 진행합니다.
> 2. 마감된 공구의 이탈을 막고, 엄마들이 다시 열어달라고 요청하는 **'TOP 20 앵콜 투표소'**를 상단 탭 및 마감 카드에 연동합니다.
> 3. 로그인 없이도 1초 만에 투표할 수 있는 토스형 미니멀 원터치 UX를 제공하며, 투표 상태는 `localStorage`에 영구 보존됩니다.

---

## 1. TOP 20 종목 자동 선별 및 초기 세팅 (Seeding)

### 선별 알고리즘 (`getTop20ReopenItems()`)
맘캘린더 전체 DB(`DATA`) 중 마감된 공구(`isExpired(item) === true`)를 대상으로 아래 기준으로 상위 20개를 자동 추출합니다.

1. **1순위**: 과거 찜(Wish) 수 (`wishCount`)
2. **2순위**: 국민 육아 소모품 키워드 가중치 (양말, 지퍼백, 퓨레, 주스, 손수건, 세제, 기저귀, 짤순이 등)
3. **초기 신청자 수 (소셜 프루프)**:
   - 목표: **100명** (100명 달성 시 본사 앵콜 협의 뱃지)
   - 초기 표시 인원: `Math.min(96, Math.max(52, (item.wishCount || 0) * 2 + 45))`
   - 1위~20위가 각각 50~95명 사이에서 자연스럽게 차오르는 느낌을 연출.

---

## 2. UI/UX 마크업 및 배치 (`test.html`)

### 1) 상단 상태 탭 추가
- 상태 칩 바(`stab-row`): `[오늘오픈] | [오늘마감] | [진행중] | [예정] | [🔥 앵콜투표]`
- `[🔥 앵콜투표]` 클릭 시 전용 TOP 20 랭킹 피드로 전환.

### 2) 앵콜 투표소 헤더
```html
<div class="reopen-header">
  <div class="rh-badge">🔥 앵콜 소환소</div>
  <div class="rh-title">엄마들이 다시 열어달라는 공구 <strong>TOP 20</strong></div>
  <div class="rh-desc">100명이 모이면 맘캘이 브랜드 본사에 <strong>단독 앵콜 공구</strong>를 요청해요! 🤝</div>
</div>
```

### 3) TOP 20 카드 리스트 레이아웃
각 카드는 순위 뱃지, 상품 정보, 토스형 게이지 바, 원터치 투표 버튼을 포함합니다.

```html
<div class="reopen-card" data-id="${item.id}">
  <div class="rc-rank rank-${idx + 1}">${idx + 1}</div>
  <div class="rc-thumb-wrap">
    <img src="${item.thumb || 'momcal-appicon.png'}" class="rc-thumb" alt="${item.name}">
  </div>
  <div class="rc-info">
    <div class="rc-category">${item.major} · ${item.minor}</div>
    <div class="rc-name">${item.name}</div>
    
    <!-- 토스/키즈노트형 프로그레스 바 -->
    <div class="rc-progress-wrap">
      <div class="rc-progress-bar" style="width: ${percent}%;"></div>
    </div>
    <div class="rc-meta-row">
      <span class="rc-count"><strong>${currentCount}명</strong> 요청중</span>
      <span class="rc-target">목표 100명 (${100 - currentCount}명 남음!)</span>
    </div>
  </div>

  <!-- 원터치 투표 CTA 버튼 -->
  <button class="rc-vote-btn ${isVoted ? 'voted' : ''}" onclick="toggleReopenVote(${item.id}, this)">
    ${isVoted ? '✓ 요청완료' : '🙋‍♀️ 나도 요청'}
  </button>
</div>
```

### 4) 하단 [+ 내가 찾는 공구 소환하기] 검색 버튼
- 20위 카드 하단에 배치.
- 클릭 시 검색 모달 오픈 ➔ 마감된 공구 검색 후 선택하면 투표소 리스트에 즉시 반영.

### 5) 일반 마감 공구 카드 하단 버튼 개선
- 검색 결과나 상세페이지에서 마감된 공구를 만났을 때, "마감된 공구입니다" 대신:
  `[🙋‍♀️ 앵콜 요청 84명]` 버튼을 띄워 어디서든 원클릭 투표 가능하게 지원.

---

## 3. 인터랙션 및 상태 영구 보존 로직 (JS)

```javascript
// 로컬스토리지 투표 배열 관리
function getReopenVotes() {
  try { return JSON.parse(localStorage.getItem('mc_reopen_voted') || '[]'); } catch(_) { return []; }
}

function toggleReopenVote(id, btn) {
  let votes = getReopenVotes();
  const card = btn.closest('.reopen-card');
  const countEl = card.querySelector('.rc-count strong');
  const barEl = card.querySelector('.rc-progress-bar');
  let current = parseInt(countEl.textContent, 10) || 80;

  if (votes.includes(id)) {
    // 투표 취소
    votes = votes.filter(v => v !== id);
    btn.classList.remove('voted');
    btn.innerHTML = '🙋‍♀️ 나도 요청';
    current = Math.max(0, current - 1);
  } else {
    // 신규 투표
    votes.push(id);
    btn.classList.add('voted');
    btn.innerHTML = '✓ 요청완료';
    current += 1;
    mcToast('앵콜 요청이 접수되었어요! 100명 달성 시 알려드릴게요 ✨');
  }

  localStorage.setItem('mc_reopen_voted', JSON.stringify(votes));
  countEl.textContent = current + '명';
  if (barEl) barEl.style.width = Math.min(100, current) + '%';
}
```

---

## 4. 검증 및 확인 요구사항
1. `test.html`에서 `[🔥 앵콜투표]` 탭 클릭 시 TOP 20 랭킹 카드가 매끄럽게 렌더링되는지 확인.
2. 1위~3위 뱃지(골드/실버/브론즈) 및 프로그레스 바가 정상 작동하는지 확인.
3. 원터치 투표 시 `mcToast` 팝업 및 로컬스토리지 상태 보존(새로고침 후에도 유지) 확인.
4. **320px 모바일 최소 화면**에서 순위, 썸네일, 텍스트, 버튼이 겹치거나 잘리지 않는지 실측.
