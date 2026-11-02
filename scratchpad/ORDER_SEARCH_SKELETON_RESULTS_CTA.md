# 🔍 [검색 UX 2·3·4번 & 폰 알림 완벽 연동 지시서] (2026-11-03)

## ⚠️ 사장님 긴급 절대 지침
1. **1번(검색창 포커스: 최근 검색어, 지금 뜨는 검색어 1~10위, 이런 공구 찾으세요)은 이미 라이브 앱에 구현되어 있으므로 절대 손대지 말고 그대로 보존할 것.**
2. **2번(스켈레톤 로딩), 3번(결과 2열 뷰 & 카테고리 탭), 4번(0건 대응 및 폰 알림 연동) 3가지만 구현할 것.**
3. **사장님 특명: "폰알림 앱에서 작동 문제없게 기능 구현해놔"** ➔ 0건 결과에서 알림 받기 버튼을 눌렀을 때, 갤럭시/아이폰 앱(Capacitor)과 웹 모두에서 폰 OS 푸시 알림 및 인앱 알림이 오류 없이 100% 동작하도록 네이티브 권한 요청과 토큰 등록 로직을 완벽히 연동할 것.

---

## 📌 과제 2: 토스쇼핑 스타일 검색 로딩 스켈레톤 (Skeleton UI)
- **문제 해결**: 검색어 입력 후 결과가 나올 때까지 3~5초간 하얗게 비어 있는 화이트아웃 현상을 제거하고 즉각적인 반응성 제공.
- **구현 내용**:
  - 검색 실행 함수(`doSearch()` 또는 `executeSearch()`) 시작 즉시 결과 컨테이너에 Shimmer 애니메이션 카드 4개 렌더링.
  - 데이터 파싱 완료 시 실제 카드 리스트로 부드럽게 교체.
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
  display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #f2f3f7;
}
.skeleton-thumb { width: 72px; height: 72px; border-radius: 10px; flex-shrink: 0; }
.skeleton-content { flex: 1; display: flex; flex-direction: column; gap: 8px; justify-content: center; }
```

---

## 📌 과제 3: 카테고리 서브 탭 & 2열 초밀착 와이드 그리드 뷰
- **결과 요약 및 카테고리 칩**:
  - `검색 결과 N개를 찾았어요`
  - 서브 탭: `[전체 N] [공구 N] [핫딜 N] [커뮤니티 N]`
  - 활성 탭: 배경 `#191F28`, 글자 흰색 (터치 시 해당 카테고리 즉시 필터링)
- **2열 초밀착 와이드 그리드**:
  - 외곽 테두리 없이 정사각형 썸네일 가득 차는 2열 그리드 (좌우 여백 10px, 카드 간격 8px)
  - 쇼핑몰명/셀러명 + 정제된 상품명 2줄 + 할인율(코랄레드) & 판매가 + 쿠팡식 괄호 단위가격 `(100g당 000원)`

---

## 📌 과제 4: 검색 결과 0건 대응 & [폰 알림] 앱 네이티브 완벽 연동
- **화면 구조**:
  - 타이틀: `‘{검색어}’에 대한 핫딜·공구가 아직 없어요`
  - 서브문구: `키워드를 등록해 두시면 최저가 특가가 뜨는 즉시 맘캘봇이 1초 만에 알림을 보내드려요!`
  - **CTA 버튼**: `[🔔 ‘{검색어}’ 특가 알림 받기]` (보라색 `#7C54C4`, 라운드 14px, 볼드)
  - 하단 추천 검색어: `[기저귀] [물티슈] [분유] [비판텐] [젤리]` 칩 노출

- **📱 폰 알림(OS 푸시 + 인앱 알림) 완벽 연동 로직 (필수 엄수)**:
  버튼 클릭 시 `registerKeywordAlertFromSearch(keyword)` 함수 실행:

```javascript
async function registerKeywordAlertFromSearch(kw) {
  if (!kw || !kw.trim()) return;
  const keyword = kw.trim();

  // 1. 앱(Capacitor 네이티브)인 경우: OS 레벨 폰 푸시 권한 요청 및 등록
  const isApp = (typeof _isNativeApp === 'function' && _isNativeApp());
  if (isApp && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) {
    try {
      const perm = await window.Capacitor.Plugins.PushNotifications.requestPermissions();
      if (perm.receive === 'granted') {
        await window.Capacitor.Plugins.PushNotifications.register();
      }
    } catch (e) {
      console.warn('Native push registration error:', e);
    }
  } else if ('Notification' in window && Notification.permission === 'default') {
    // 2. 웹 브라우저인 경우: 브라우저 알림 권한 요청
    try {
      await Notification.requestPermission();
    } catch (e) {}
  }

  // 3. 당근마켓식 키워드 알림 데이터 저장 ('mc_kw_alarms')
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem('mc_kw_alarms') || '[]');
  } catch(e) { list = []; }

  const existIdx = list.findIndex(item => item.kw === keyword);
  if (existIdx >= 0) {
    list[existIdx].on = true;
    list[existIdx].types = ['all'];
  } else {
    list.unshift({
      kw: keyword,
      types: ['all'],
      on: true,
      created_at: Date.now()
    });
  }
  localStorage.setItem('mc_kw_alarms', JSON.stringify(list));

  // 4. 상단 헤더 종 아이콘 알림 뱃지 활성화 & 안내 히스토리 등록
  if (typeof saveNotiHistory === 'function') {
    saveNotiHistory({
      type: 'system',
      kw: keyword,
      title: `[키워드 등록] '${keyword}' 특가 알림이 설정되었습니다.`,
      time: Date.now()
    });
  }
  if (typeof showNotiBadge === 'function') {
    showNotiBadge();
  }

  // 5. 손님 안내 완료 토스트 팝업 (1초 피드백)
  if (typeof mcToast === 'function') {
    mcToast(`🔔 '${keyword}' 특가 알림이 등록되었어요! 최저가가 뜨면 바로 알려드릴게요.`);
  } else {
    alert(`🔔 '${keyword}' 특가 알림이 등록되었어요!`);
  }
}
```
