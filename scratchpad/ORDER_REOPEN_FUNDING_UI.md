# [오더] 키즈노트·와디즈형 [맘캘 앵콜 펀딩 & 사전 페이백] UI 컴포넌트 개발

> **벤치마킹 분석 (키즈노트 2027 캘린더 공구 실측)**:
> 1. 목표 인원(예: 1,000명 / 10,000명) 달성 시 전원 2,000~5,000원 추가 페이백/사은품을 약속하여 유저 스스로 단톡방에 링크를 공유하게 만드는 **'자발적 바이럴 펀딩 게이지 바'**.
> 2. 마감된 공구에는 **'앵콜 요청 펀딩'**, 오픈 예정 공구에는 **'얼리버드 페이백 펀딩'**으로 양방향 확장 가능한 모바일 최적화 컴포넌트.
> 3. 라이브(`index.html`) 직접 수정은 절대 금지하며, `test.html`에서 320px 모바일 완벽 반응형으로 구현 및 인터랙션 실측.

---

## 1. 컴포넌트 마크업 구조 (`test.html`)

```html
<!-- 맘캘 앵콜 펀딩 카드 컴포넌트 -->
<div class="funding-card" id="fundingCardExample">
  <!-- 상단 대표 이미지 및 뱃지 -->
  <div class="fc-thumb-wrap">
    <img src="downloads/shark_card_1.png" alt="상품 이미지" class="fc-thumb" onerror="this.src='momcal-appicon.png'">
    <div class="fc-badge-circle">맘캘<br>펀딩</div>
  </div>

  <!-- 상품 정보 -->
  <div class="fc-body">
    <div class="fc-title">★맘캘펀딩★ 놓친 공구 앵콜 요청 1위, 슈메르 논슬립 실내 양말 5족 세트</div>
    
    <div class="fc-bullets">
      <div class="fc-bullet-item">■ 마감 후 앵콜 요청 1,000명 돌파 시 본사 특가 오픈!</div>
      <div class="fc-bullet-item">■ 목표 인원 전원 2,000원 즉시 페이백 쿠폰 지급</div>
      <div class="fc-bullet-item">■ 2세트 이상 펀딩 참여 시 전원 무료배송 혜택</div>
    </div>

    <!-- 가격 라인 -->
    <div class="fc-price-row">
      <div class="fc-price-old">25,000원</div>
      <div class="fc-price-main">
        <span class="fc-discount-tag">32% ↓</span>
        <span class="fc-price-now">16,800원~</span>
        <span class="fc-price-info">앵콜공구가 안내 ⓘ</span>
      </div>
    </div>

    <!-- 와디즈/키즈노트형 펀딩 프로그레스 바 -->
    <div class="fc-progress-section">
      <div class="fc-progress-track">
        <div class="fc-progress-bar" style="width: 100%;"></div>
      </div>
      
      <div class="fc-meta-row">
        <div class="fc-avatars-wrap">
          <span class="fc-av av1">엄</span>
          <span class="fc-av av2">마</span>
          <span class="fc-av av3">맘</span>
          <span class="fc-count-txt"><strong>1,284명</strong> 신청중</span>
        </div>
        <div class="fc-target-txt">목표 1,000명</div>
      </div>

      <!-- 페이백/달성 혜택 말풍선 툴팁 -->
      <div class="fc-tooltip-bubble">
        <span class="fc-tooltip-icon">🪙</span> 달성 완료! <strong>2,000원 페이백 확정</strong>
      </div>
    </div>

    <!-- 하단 액션 & 카운트다운 타이머 -->
    <div class="fc-action-section">
      <div class="fc-status-txt">공구 알림 신청 완료 ✓</div>
      <button class="fc-timer-btn" onclick="toggleFundingJoin(this)">
        <span id="fcTimerCountdown">14 : 15 : 01 후 상품 오픈</span>
      </button>
      <div class="fc-share-nudge" onclick="copyFundingShareLink()">
        📢 친구/단톡방에 공유하면 오픈이 더 빨라져요! (링크 복사)
      </div>
    </div>
  </div>
</div>
```

---

## 2. 스타일링 가이드 (CSS)

- **컬러 팔레트**:
  - 메인 테마: 맘캘 퍼플(`#7C54C4`) & 활력 코랄 오렌지(`#FF6B4A`)
  - 게이지 바: `#FF6B4A` (진행 시 선명한 오렌지/퍼플)
  - 툴팁 말풍선: 다크 차콜(`#221F28`) + 골드 옐로우(`#FFE600`)
  - 타이머 버튼: 소프트 스카이블루(`#85C1E9`) 또는 맘캘 소프트 퍼플(`#8E68D9`)
- **반응형**:
  - 320px 최소 너비 모바일 화면에서도 아바타와 텍스트가 줄바꿈 겹침 없이 유연하게 축소되도록 `flex-wrap: wrap` 및 적응형 폰트 크기 적용.

---

## 3. 인터랙션 동작 요구사항
1. **버튼 토글**: 클릭 시 `[알림 신청 완료 ✓]` 상태와 카운트다운 타이머 인터랙션.
2. **카운트다운 스크립트**: 실제 남은 시간 초 단위 실시간 차감 애니메이션.
3. **공유하기**: 누르면 현재 페이지 URL + 추천 문구가 클립보드에 복사되고 토스트 안내(`mcToast`).
