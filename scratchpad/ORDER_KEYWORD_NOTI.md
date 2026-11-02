# 맘캘린더 당근마켓식 키워드 알림 센터 & 앱 로그인 온보딩 정밀 지시서 (2026-11-02)

> **사장님 긴급 지침 (절대 원칙)**
> 1. **커뮤니티 알림 제외**: 카페 댓글 연동은 네이버 API 차단으로 불필요하므로 제외한다.
> 2. **당근마켓 키워드 알림 100% 동일 구현**:
>    - 키워드 등록 (예: 기저귀, 분유, 비판텐)
>    - 카테고리 알약 칩: `[전체]` 기본 활성화, `[공구]`, `[핫딜]`, `[세일]` 개별 선택 지원.
> 3. **버튼 터치 영역 & UI/UX 모바일 최적화**:
>    - 모바일에서 엄지손가락으로 오터치 없이 편하게 눌리도록 최소 40px 터치 타겟 보장.
>    - 스마트 토글 로직: 3개 다 켜지면 [전체] 자동 활성화, 최소 1개는 켜져 있도록 방어.
> 4. **상단 헤더 [🔔 알림함] 신설**:
>    - 헤더 우측에 종 아이콘 배치, 안 읽은 알림 시 빨간 점(뱃지) 표시.
>    - 🔔 클릭 시 '받은 알림 모아보기' 시트 열림, 우측 위 [⚙️ 설정] 누르면 키워드 관리로 연결.
> 5. **앱 첫 진입 로그인 온보딩**:
>    - 갤럭시/아이폰 앱(`_isNativeApp()`) 첫 실행 시 카카오+네이버 로그인 유도.
>    - "이 기기에만 저장돼요" 같은 웹용 팝업은 앱에서 영구 제거.

---

## 📌 1. 상단 헤더 [🔔 알림함] 아이콘 배치 (index.html / test.html)

### A. 마크업 위치: `.hd-right` (상단 헤더 우측)
- 기존: `[🔗 공유]` `[💜 내 찜]` 2개
- 개편: `[🔔 알림]` `[💜 내 찜]` (또는 알림, 공유, 찜 중 손님이 가장 많이 쓰는 구조)
```html
<button class="hd-icon-btn" id="btnNotiCenter" onclick="openNotiCenterSheet()" aria-label="알림함" style="position:relative">
  <span style="font-size:18px">🔔</span>
  <span id="notiBadge" style="display:none;position:absolute;top:2px;right:2px;width:7px;height:7px;background:#FF4545;border-radius:50%;border:1.5px solid #fff"></span>
</button>
```

---

## 📌 2. 당근식 [알림함 & 키워드 알림 센터] UI/UX 규격

### A. 알림 센터 바텀시트 (`#notiCenterSheet`)
- 헤더: `🔔 알림` 타이틀 + 우측 `[⚙️ 키워드 설정]` 버튼 + `[✕]` 닫기
- 탭 구분:
  1. **[받은 알림]**: 내가 받은 키워드 매칭 알림 및 오픈 알림 리스트 (시간순, 클릭 시 해당 카드로 스크롤)
     - 빈 화면: `받은 알림이 없어요. 관심 키워드를 등록하면 알림을 보내드려요!` + `[+ 키워드 등록하러 가기]`
  2. **[키워드 관리]**: 당근마켓 키워드 알림 설정 화면

### B. 당근마켓 스타일 키워드 등록/관리 화면 상세
1. **키워드 등록 인풋 바**:
   ```html
   <div style="display:flex;gap:8px;margin-bottom:14px">
     <input id="kwInput" type="text" placeholder="알림 받을 키워드 (예: 기저귀, 분유, 비판텐)"
            style="flex:1;height:44px;border:1px solid #E5E7EB;border-radius:12px;padding:0 14px;font-size:13.5px;outline:none"
            onkeydown="if(event.key==='Enter')addKeywordAlarm()">
     <button onclick="addKeywordAlarm()"
             style="height:44px;padding:0 16px;background:#7C54C4;color:#fff;border:none;border-radius:12px;font-size:13.5px;font-weight:700;cursor:pointer;white-space:nowrap">등록</button>
   </div>
   ```

2. **키워드 리스트 & 알약 칩 인터랙션**:
   - 등록된 키워드 행 구조:
     - 윗줄: 키워드명 (볼드 14px) + 등록일 + 우측 `[✕]` 삭제 버튼 (터치 영역 36×36px)
     - 아랫줄: 4개 알약 칩 (`[전체]` `[공구]` `[핫딜]` `[세일]`)
   ```html
   <!-- 키워드 아이템 템플릿 -->
   <div class="kw-item" style="padding:12px;background:#F9F8FC;border-radius:14px;margin-bottom:10px;border:1px solid #EDE8F5">
     <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
       <span style="font-size:14px;font-weight:800;color:#232326">기저귀</span>
       <button onclick="removeKeywordAlarm('기저귀')" style="background:none;border:none;color:#9CA3AF;font-size:16px;cursor:pointer;padding:4px 8px">✕</button>
     </div>
     <div class="kw-chips" style="display:flex;gap:6px">
       <button class="kw-chip on" data-type="all" onclick="toggleKwType('기저귀','all')">전체</button>
       <button class="kw-chip" data-type="gonggu" onclick="toggleKwType('기저귀','gonggu')">공구</button>
       <button class="kw-chip" data-type="hotdeal" onclick="toggleKwType('기저귀','hotdeal')">핫딜</button>
       <button class="kw-chip" data-type="sale" onclick="toggleKwType('기저귀','sale')">세일</button>
     </div>
   </div>
   ```

3. **스마트 토글 로직 (UI/UX 결함 방지)**:
   - **`[전체]` 누르면**: `types = ['all']`. 공구/핫딜/세일 칩은 꺼지고 `[전체]`만 보라색 켜짐.
   - **`[공구]` / `[핫딜]` / `[세일]` 누르면**:
     - `[전체]` 칩은 즉시 꺼짐.
     - 누른 카테고리 토글 (ON/OFF).
     - **3개 다 켜진 경우**: 자동으로 `types = ['all']`로 합쳐지며 `[전체]`가 보라색으로 켜짐!
     - **3개 다 끈 경우**: 마지막 남은 1개는 꺼지지 않음 (`mcToast('알림받을 항목을 최소 1개 선택해 주세요')`).

4. **칩 스타일 규격**:
   - `height: 32px; padding: 0 12px; border-radius: 16px; font-size: 12px; font-weight: 700;`
   - OFF 상태: `background: #fff; color: #6B7280; border: 1px solid #E5E7EB;`
   - ON 상태: `background: #7C54C4; color: #fff; border: 1px solid #7C54C4;`

---

## 📌 3. 데이터 저장 및 키워드 푸시 매칭

### A. 로컬 데이터 구조
```javascript
// localStorage 키: 'mc_kw_alarms'
[
  {
    "kw": "기저귀",
    "types": ["all"], // 또는 ['gonggu', 'hotdeal']
    "on": true,
    "created_at": 1730520000000
  }
]
```

### B. 인앱/푸시 알림 매칭 함수:
- 새 공구/핫딜/세일 로드 시, 손님이 등록한 키워드가 제목(`title`)이나 브랜드(`brand`)에 포함되어 있는지 대조:
```javascript
function checkKeywordMatches(item, itemType){ // itemType: 'gonggu' | 'hotdeal' | 'sale'
  const list = getKwAlarms();
  list.forEach(k => {
    if(!k.on) return;
    const matchType = k.types.includes('all') || k.types.includes(itemType);
    if(matchType && (item.title.includes(k.kw) || (item.brand && item.brand.includes(k.kw)))){
      saveNotiHistory({
        type: itemType,
        kw: k.kw,
        title: `[${k.kw} 알림] ${item.title}`,
        time: Date.now(),
        target_id: item.id
      });
      showNotiBadge();
    }
  });
}
```

---

## 📌 4. 앱 첫 실행 로그인 온보딩 & "기기 저장" 팝업 영구 제거

1. **`_isNativeApp()`인 경우 (갤럭시/아이폰 Capacitor 앱)**:
   - 앱 첫 실행 시 로그인 안 되어 있으면:
     - 둘러보기 전에 **카카오 / 네이버 소셜 로그인 화면**을 띄운다.
     - 버튼: `[💛 카카오로 3초 만에 시작하기]` + `[💚 네이버로 시작하기]`
2. **"이 기기에만 저장돼요" 팝업 차단**:
   - `openLoginSheet` 호출부에서 `_isNativeApp()`인 경우 해당 문구 노출 금지.
   - 로그인된 앱 손님이 하트(찜)를 누르면 바텀시트 방해 없이 **즉시 서버 찜 완료 토스트("내 찜에 담았어요 💜")**만 띄우고 끝낸다.
