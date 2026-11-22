# ORDER — 카드뉴스 다운로드: staff_test → 라이브 staff.html 반영 (클로드 코드용)

작성 2026-11-16 · 자비스 · 기준 커밋 `a617e03`
저장소 편입 2026-11-16 17:34 — `orders/ORDER_CARDNEWS_PIPELINE.md` §7-4에서 이 문서를 참조하므로 같은 저장소로 옮겼다(내용은 그대로).

## 이미 되어 있는 것 (라이브 배포 완료)
- `daily/cardnews/2026-11-16/01.png~08.png` (1080×1440, 인스타 3:4) + `caption.txt` + `comment_tags.txt` + `manifest.json`
- `daily/cardnews/latest.json` — 최신 날짜 포인터
- `cardnews.html` — 카드뉴스 다운로드 화면 (미리보기 3:4, 8장 전체 저장, 캡션 복사, 첫 댓글 해시태그 복사)
- `staff_test.html` — `📰 카드뉴스` 탭 추가(iframe → cardnews.html). **검증용. 라이브 staff.html 은 아직 안 건드림.**

## 할 일 — staff.html 에 같은 탭 4곳 넣기 (staff_test.html 과 동일한 패치)

### 1) 탭 버튼 (staff.html `t-card` 바로 다음 줄)
```html
    <div class="tab" id="t-news" onclick="showTab('news')">📰 카드뉴스</div>
```

### 2) 화면(view) — `id="v-card"` div 가 닫힌 바로 뒤
```html
  <!-- ── 📰 카드뉴스 ── 매일 생성되는 인스타 카드뉴스(3:4 1080×1440) 8장 + 캡션·해시태그를
       여기서 바로 내려받고 복사한다. 화면은 cardnews.html 하나만 고치면 된다. -->
  <div class="view" id="v-news" style="display:none;padding:0">
    <iframe id="newsFrame" title="오늘의 카드뉴스"
            style="display:block;width:100%;height:calc(100vh - 96px);border:0;background:#F5F2FB"></iframe>
    <div id="newsFallback" style="display:none;padding:14px;font-size:12px;color:#666">
      화면이 안 뜨면 <a href="#" onclick="openNews();return false" style="color:var(--p);font-weight:700">새 탭에서 열기</a>를 눌러주세요.
    </div>
  </div>
```

### 3) 탭 전환 배열
```js
['gonggu','hotdeal','exp','fix','card','news','staff'].forEach(...)
```
```js
  if(t==='news') mountNews();
```

### 4) 함수 — `openReelCard()` 바로 뒤
```js
// ───────── 📰 카드뉴스 (매일 생성되는 3:4 카드뉴스 8장 다운로드) ─────────
// 데이터: daily/cardnews/YYYY-MM-DD/{manifest.json, 카드 PNG, caption.txt, comment_tags.txt}
// 최신 날짜는 daily/cardnews/latest.json 이 알려준다. 화면·저장 로직은 cardnews.html 안에만 있다.
function newsUrl(){
  const base=location.origin.indexOf('http')===0 ? location.origin : 'https://momcalendar.com';
  return base+'/cardnews.html?t='+Date.now();
}
function mountNews(){
  const f=document.getElementById('newsFrame');
  if(!f || f.dataset.on==='1') return;
  f.dataset.on='1';
  f.src=newsUrl();
  f.onerror=function(){ document.getElementById('newsFallback').style.display='block'; };
}
function openNews(){ window.open(newsUrl(),'_blank'); }
```

## 매일 운영 방법 (이후 자동화 대상)
1. 그날 카드뉴스 PNG 8장 + 캡션을 `daily/cardnews/YYYY-MM-DD/` 에 `01.png~08.png`, `caption.txt`, `comment_tags.txt`, `manifest.json` 로 넣고 커밋
2. `daily/cardnews/latest.json` 의 `latest` 를 그 날짜로 바꿔 커밋
3. 스탭 페이지 `📰 카드뉴스` 탭 → 8장 전체 저장 → 캡션 복사 → 인스타 앱에서 노래 넣고 업로드
4. 카드뉴스 생성기: `scratchpad/render_insta_week1.py` (1080×1440 출력)

> 2026-11-16 2판부터 1~2번과 3번의 업로드는 `orders/ORDER_CARDNEWS_PIPELINE.md`가 자동화한다. 이 문서(스탭 탭 패치)는 **화면을 라이브에 올리는 1회성 작업**으로 남는다.

## 확인 포인트
- staff_test.html 은 라이브 `https://momcalendar.com/staff_test.html` 에서 `📰 카드뉴스` 탭이 실제로 뜨고 8장·캡션 복사가 되는지 길아 님 확인 후 staff.html 반영.
- 데이터 파일은 손님 페이지가 아니라 스탭 전용이라 색인 걱정 없음(cardnews.html 은 `noindex`).
