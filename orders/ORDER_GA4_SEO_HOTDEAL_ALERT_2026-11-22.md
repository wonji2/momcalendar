# ORDER — 404 유입 손실 마무리 · 앱 전환 CTA · 핫딜 대기열 완화 · 출석 9월 경보 정리

작성 2026-11-22 (일) · 자비스 · 기준 커밋 `8efff4a`(main, 2026-11-22 08:56 KST)
대상 저장소 `wonji2/momcalendar` · 작업자 = 클로드 코드
관련 문서 `orders/ORDER_SEO_AEO_GEO_RECOVERY.md`(11-16, §6 GA4 · §8-1 툼스톤), `tools/daily/winner_notify.mjs`

이 오더는 11-22 아침 브리핑 3번(냠이와 정리한 GA4·서치콘솔·마케팅 개선안)을 실행 문서 하나로 묶은 것이다.
**주의: 11-16 오더에서 ①(404)은 절반이 이미 끝나 있다.** 아래 §1 표가 "무엇이 되어 있고 무엇이 남았는지"다. 11-16 지시서의 내용을 다시 읽고 이미 되어 있는 것을 또 하지 말 것.

---

## 실행 명령 (길아 님이 클로드 코드에 붙여넣는 1줄)

```
claude "orders/ORDER_GA4_SEO_HOTDEAL_ALERT_2026-11-22.md 끝까지 읽고 §1 표부터 대조한 뒤 §3·§4·§5·§6 그대로 구현하고 §7 검증 V1~V10 실제로 돌려 표로 보고해. index.html·admin.html·staff.html 같은 라이브 파일은 절대 건드리지 말고, 커밋은 ①~④ 작업 단위로 나눠 올려"
```

레포 루트(`wonji2/momcalendar` 체크아웃, `C:/Users/FAMILY/...`)에서 실행한다.
PowerShell 스크립트(`.ps1`)는 **UTF-8 BOM** 으로 저장한다(한글 리터럴 때문에 BOM 없이 저장하면 깨진다 — 저장소 기존 규칙).

---

## 0. 한 줄 요약

| # | 할 일 | 한 줄 |
| --- | --- | --- |
| ① | 404 유입 손실 | **이미 618건 목록으로 툼스톤 33장 완료.** 남은 건 (a) 서치콘솔 최신 649건 목록으로 갱신, (b) GA4가 잡은 404 상위 주소 처리, (c) `404.html` 에 `/?q=` 검색창 1줄 |
| ② | 네이버(▲939%)·AI(▲1,865%) 유입 → 앱 전환 | 생성 페이지 템플릿(`lib.ps1` `WritePage`) **한 곳**에 앱 CTA 한 줄 → `세일정보.html`·`g/`·`gg/`·`p/`·`s/` 전부 자동 적용. 숫자는 빌드가 계산 |
| ③ | 핫딜 15분 schedule 대기열 | `hotdeal-cloud.yml` cron 을 15분 → **2시간**(`8 */2 * * *`). 체인(workflow_dispatch)은 그대로라 24시간 수집은 안 끊긴다 |
| ④ | 출석 9월 당첨자 경보 | 9월 6명은 이미 발송됨(사장님 확인 11-22) → `sent_at` 채우고 연락처 지운 뒤 `winner_notify` 재실행. 경보에 10월 7명만 남긴다 |

---

## 1. 지금 상태 — 착수 전에 이 표부터 실제 파일과 대조하라 (11-22 08:56~09:05 KST 실측)

| 항목 | 실측 | 판정 |
| --- | --- | --- |
| `tools/seo/gsc_404.csv` | **있다.** 619줄 = 주소 618건 (서치콘솔 11-16 내보내기). 커밋 `4346c6a` | 11-16 오더의 "CSV 없음"은 **해소됨** |
| `tools/seo/tombstone.ps1` | **있다.** 커밋 `8896a38`(도구) → `4346c6a`(실행) | 11-16 21:14에 이미 실행됨 |
| 툼스톤 결과 | **33장** 생성: `g/` 22장 · `gg/` 10장 · `s/myunghee_homecook.html` 1장 — 모두 `4346c6a` 가 최종 커밋(커밋 메시지엔 32장으로 적혔으나 실제 파일 33장) | **유지되고 있다** |
| CSV 618건의 현재 분포 | 툼스톤 33건 · 지금 살아 있는 **일반 페이지 577건**(11-17~21 매일 빌드가 다시 만든 `g/`·`gg/`·`p/`·`m/`) · 트리에 없는 **8건** = 618 | 재작업 불필요 |
| 트리에 없는 8건 | (a) 대소문자 변형 6건: `g/Amoo.html`·`g/AMOO.html`·`g/am.html`·`p/Amoo-보관함.html`·`g/non-gmo.html`·`p/Non-gmo-새우.html` — 정본(`g/amoo.html`·`g/Non-gmo.html`·`g/NON-GMO.html`)이 **지금 200으로 살아 있다** (b) API 경로 2건: `functions/v1/kakao-auth`·`rest/v1/banners` | (a) 툼스톤 **만들지 않는다**(§3-4) (b) robots 로 크롤을 막는다(§3-3) |
| `404.html` | 있다. GA4 는 `page_title:'404'` 로 이미 잡고 있음. **검색창·앱 안내는 없다** | §3-5 에서 1줄 추가 |
| 서치콘솔 404 | 11-16 619 → 11-22 보고 **649건**(브리핑 기준) | 목록 갱신 필요(§3-1) |
| GA4 404 | 7일 124회 · 전일 58회(브리핑 기준) — `page_title=404` | 상위 주소 목록 필요(§3-2) |
| `daily/_alert.txt` 의 `winner` 줄 | `출석체크 당첨자 아직 안 보냈어요 — 9월 6명(연락처 받은 6명) · 10월 7명(연락처 받은 7명) · 관리자 💜 출석·추첨 에서 확인` | §6 에서 10월만 남긴다 |
| `winner` 줄을 만드는 곳 | `tools/daily/winner_notify.mjs` → `attendance_winners` 표(`month`·`sent_at`·`contact`·`approved_at`) 집계. 예약 `momcal-winner-notify` 가 매일 09:20 실행 | 코드 수정 없이 **데이터만** 고친다 |
| `hotdeal-cloud.yml` | `cron: '8,23,38,53 * * * *'`(15분) · `concurrency.cancel-in-progress: false` · 320분 루프 · 끝에 `gh workflow run` 으로 다음 회차 | §5 |
| 핫딜 실행 이력(공개 API, 최근 30건) | `workflow_dispatch` 성공 간격 **5h10 ~ 5h21**(04:42 → 09:52 → 15:13 → 20:24 KST) = 루프 길이와 같다 = **사슬 정상**. 지금 `pending` 1건(11-22 06:49 KST 발생)이 05:24 시작 실행 뒤에 대기 | "대기열이 쌓인다"보다 정확히는 **취소된 `schedule` 실행이 하루 4~5건 이력에 남는 것** (깃허브는 concurrency 그룹마다 대기 1건만 남기고 이전 대기를 취소한다) |
| 내일(11-23 월) 오픈 공구 | 공개 `gonggu` 뷰 `open_date=2026-11-23` → **387행**(고유 이름 378). 11-22 08:59 KST 실측 | 브리핑의 370과 차이는 집계 시점·중복 처리 차이. **페이지에 박지 말고 빌드가 계산**(§4-2) |
| 앱 스토어 링크 | iOS `https://apps.apple.com/kr/app/id6826126083` (1.0.2, 11-19 공개) · Android `https://play.google.com/store/apps/details?id=com.wantsb.momcalendar` — `index.html` 7866행 `APP_STORE_URL` 과 같은 값 | 그대로 쓴다 |
| 찜·알림 정책 | 11-20 부터 **웹에서는 찜·알림 불가, 앱에서만** (`index.html` `_webWishGate`·`WEB_PUSH_APP_ONLY`) | "앱에서 알림·찜하기" 문구는 지금 제품과 맞다 |

---

## 2. 절대 하지 말 것 (먼저 읽어라)

1. **라이브 파일 수정 금지** — `index.html`·`admin.html`·`staff.html`·`test.html`·`test-app.html`·`register.html`·`kktest.html`·`reelcard.html`. (11-11 사고: 라이브에 시안 막대가 그대로 노출됐다)
2. **브랜드 삭제 요청으로 지운 페이지에 툼스톤을 만들지 말 것.** `tools/daily/brand_remove.mjs` 가 지운 `g/`·`gg/`·`p/` 페이지는 **404 가 정상**이다(브랜드 측 요청). `brand_block` 표에 걸리는 이름은 §3-4 규칙과 무관하게 건너뛴다.
3. **숫자를 지어내지 말 것.** ② 의 "내일 오픈 N건"은 이 빌드가 잰 값만 쓴다. 재지 못하면 숫자를 빼고 문구만 쓴다.
4. **DB 쓰기는 §6 하나뿐.** 다른 표·다른 달은 건드리지 않는다.
5. **`tombstone.ps1` 의 기존 규칙을 느슨하게 만들지 말 것** — 지금 살아 있는 파일은 건드리지 않는다, 라이브 파일 목록(`$LIVE`)은 절대 쓰지 않는다, 브랜드·상품 이름을 쪽지에 쓰지 않는다.

---

## 3. [P0] ① 404 유입 손실 — 남은 것만

### 3-1. 서치콘솔 최신 목록(649건)으로 갱신

`tools/seo/gsc_404.csv` 는 11-16 판(618건)이다. 최신 목록은 길아 님/자비스가 서치콘솔 「페이지 색인 생성 → 찾을 수 없음(404)」 에서 CSV 로 내려 `tools/seo/gsc_404.csv` 를 교체해 둔다(형식 동일: 첫 칸 주소, 둘째 칸 최종 크롤링).

- **파일이 618건 그대로면 이 단계는 건너뛰고** §3-2·§3-5 로 간다. 없는 목록을 추측으로 채우지 않는다.
- 교체돼 있으면(행 수가 618보다 많으면) 아래 순서로:

```
pwsh tools/seo/tombstone.ps1 -Csv tools/seo/gsc_404.csv -DryRun     # 몇 장 만들지 세기만
pwsh tools/seo/tombstone.ps1 -Csv tools/seo/gsc_404.csv             # 실제로 만들기
git status --short g gg p s                                          # 툼스톤만 늘었는지 확인
```

- 새로 생긴 `g/`·`gg/`·`p/`·`s/` 툼스톤은 다음 05:10 빌드가 자동 커밋하지만, 지금 올리려면 `git add` 로 경로를 못박아 넣는다(`git add -A` 금지 — 이 저장소는 공개 사이트다).
- 루트에 생긴 `.html` 툼스톤은 자동 커밋 목록(`g p s m d c gg`) 밖이라 **손으로 add** 한다(없으면 0건).
- 결과 줄(`툼스톤 N / 이미 툼스톤 M / 살아 있는 페이지라 그대로 둠 K / 규칙 밖이라 건너뜀 J`)을 보고에 그대로 옮긴다.

### 3-2. GA4 가 잡은 404 상위 주소 (`page_title = 404`, 7일 124회)

서치콘솔 목록에 없는 **새 404** 는 GA4 에만 있다. 목록이 오면 같이 처리한다.

1. 입력 파일: `tools/seo/ga4_404.csv` — GA4 「보고서 → 참여도 → 페이지 및 화면」에서 `페이지 제목` 이 `404` 인 행을 CSV 로 내려받은 것(자비스가 준비한다).
2. `tools/seo/tombstone.ps1` 에 **GA4 형식 수용**을 추가한다(기존 `-Csv` 동작은 그대로):
   - 지금은 `,` 로 자른 **첫 칸**만 주소로 본다. GA4 내보내기는 첫 칸이 `페이지 제목`·`페이지 경로` 라 순서가 다르다.
   - 각 줄의 **모든 칸**을 훑어, `https://momcalendar.com/…` 또는 `/` 로 시작하고 `.html` 로 끝나는 첫 값을 주소로 삼는다(경로 칸이 `/g/…html` 꼴).
   - 나머지 규칙(살아 있는 파일은 그대로, 대소문자·끝 슬래시·쿼리 제외, `..` 금지, 라이브 파일 금지, 브랜드명 금지)은 **한 줄도 바꾸지 않는다**.
3. `-DryRun` → 실제 실행 → 커밋은 §3-1 과 같은 커밋에 묶어도 된다.
4. **파일이 없으면 이 단계는 건너뛰고** 보고에 "GA4 목록 미수집 — 다음 회차"로 남긴다.

### 3-3. API 경로가 404 로 잡힌 2건 — robots 생성기에 두 줄

`functions/v1/kakao-auth`·`rest/v1/banners` 는 구글이 링크를 따라 들어온 **API 주소**다. 페이지가 아니므로 툼스톤 대상이 아니다. 대신 크롤 예산을 아끼도록 생성되는 robots 에 두 줄을 넣는다(11-16 오더 규칙: robots.txt 는 **손으로 고치지 않고 생성기를 고친다**).

`build.ps1` 1931행 `$blockRules` 에 붙인다:

```powershell
Disallow: /rest/`nDisallow: /functions/
```

→ 다음 빌드가 만드는 `robots.txt` 에 반영된다(`Disallow: /admin.html` 줄들과 같은 묶음). 이 오더에서는 **이 두 줄만** — 학습봇 차단 목록·`Content-Signal`·`Sitemap:` 줄은 건드리지 않는다.

### 3-4. 지금도 없는 6건(대소문자 변형) — 툼스톤을 만들지 않는다

`g/Amoo.html`·`g/AMOO.html`·`g/am.html`·`p/Amoo-보관함.html`·`g/non-gmo.html`·`p/Non-gmo-새우.html`
→ 같은 페이지의 정본(`g/amoo.html`·`g/Non-gmo.html`·`g/NON-GMO.html`)이 **지금 200으로 살아 있다.** 구글이 8월에 대소문자만 다른 주소를 긁고 404 를 기록한 것이다.
여기에 200 툼스톤을 놓으면 같은 내용의 URL 만 하나 더 생겨 중복이 늘어난다. **그대로 둔다**(보고에 6건·사유 한 줄).

### 3-5. `404.html` — `/?q=` 바로 검색창 1줄 (+ 앱 안내 1줄)

`index.html` 은 `?q=` 를 이미 받는다(3196행: `new URLSearchParams(location.search).get("q")` → 검색 실행). 그러니 404 에서 검색으로 바로 보내면 된다.

**넣는 자리**: `<p>주소가 바뀌었거나 끝난 공구일 수 있어요.</p>` 바로 뒤, `<div class="go">` 앞.

```html
<form class="srch" action="/" method="get" role="search">
<input class="srch-i" type="search" name="q" placeholder="공구·브랜드 검색" aria-label="공구·브랜드 검색" enterkeyhint="search">
<button class="srch-b" type="submit">찾기</button>
</form>
<p class="srch-n">앱에서 찜·알림 받기 → <a href="https://apps.apple.com/kr/app/id6826126083" rel="noopener">App Store</a> · <a href="https://play.google.com/store/apps/details?id=com.wantsb.momcalendar" rel="noopener">Google Play</a></p>
```

**`<style>` 안에 추가**(기존 색·모서리 규칙과 맞춘다):

```css
.srch{display:flex;gap:6px;margin:0 0 12px}
.srch-i{flex:1;min-width:0;height:48px;padding:0 14px;border:1px solid #EDE8F3;border-radius:12px;font-size:15px;font-family:inherit;color:#191F28;background:#fff}
.srch-i:focus{outline:none;border-color:#7C54C4}
.srch-b{height:48px;padding:0 16px;border:0;border-radius:12px;background:#7C54C4;color:#fff;font-size:14px;font-weight:800;font-family:inherit;cursor:pointer}
.srch-n{font-size:12px;color:#8B95A1;margin:0 0 24px}
.srch-n a{color:#7C54C4;font-weight:700;text-decoration:none}
```

- `404.html` 은 **`noindex,follow` 유지**(색인 대상 아님). GA4 스니펫도 그대로 1회.
- 이 파일은 `tools/seo/verify.ps1` 검사 폴더(g p s m d c gg)와 자동 커밋 목록 **밖**이다 → 손으로 커밋한다.
- 배포 후 라이브 확인: `https://momcalendar.com/없는주소.html` → 폼이 보이고, 검색어를 넣으면 `/?q=…` 로 넘어가 결과가 뜬다.

### 3-6. 재발 방지 — 코드는 손대지 않는다(확인만)

- `build.ps1` 의 `PutTombstone`(1779행)/`KeptUrls`(1806행)가 차단 브랜드·브랜드 아님·내려놓은 공구 페이지를 **지우지 않고 툼스톤으로 바꾸는** 처리를 이미 한다. 변경 없음.
- 확인 한 가지만: 다음 빌드 뒤 `git diff --stat g/` 에서 **11-16 툼스톤 33장이 다시 살아 있는 페이지로 덮이지 않았는지**(지금까지 유지되고 있다).

---

## 4. [P0] ② 앱 전환 CTA — 템플릿 한 곳 + `세일정보.html` 자동 적용

### 4-1. 왜 `WritePage` 한 곳인가

`세일정보.html`·`핫딜정보.html`·`g/`·`gg/`·`p/`·`s/`·`m/`·`d/`·`c/` 는 **전부** `tools/seo/lib.ps1` 의 `WritePage`(276행)를 지나 만들어진다. 그래서 파일을 직접 고치면 다음 05:10 빌드가 되돌린다. **템플릿만 고친다.**

- 넣는 자리: `lib.ps1` 325행 `[void]$sb.AppendLine("<div class=${Q}wrap${Q}>")` **바로 뒤** (보라 헤더 아래·빵가루 위 → 모바일에서 스크롤 없이 보인다).
- `noindex` 페이지(장기 마감 `gg` C계층 등)에는 넣지 않는다 — 크롤러에게 "무시해"라고 한 페이지에 무게를 더할 이유가 없다. `$o.robots` 에 `noindex` 가 있으면 건너뛴다.
- 툼스톤은 `TombstoneHtml` 로 따로 만들어지므로 배너가 붙지 않는다(정상).

### 4-2. 문구 — 숫자는 빌드가 계산한다

- 훅: `내일(월) 오픈 공구 387건` 처럼 **요일 + 건수**. 요일·건수 모두 그날 빌드가 계산한다.
- 계산: `$D.today`(데이터 기준일)에 하루 더한 날짜 = 내일. 건수는 공개 `gonggu` 뷰를 `open_date=eq.<내일>` 로 `count=exact` 조회(11-22 실측 387). 실패하면 `$soonRows`(od = 내일) 로 대체.
- **100건 미만이거나 계산 실패면 숫자를 빼고** `공구 일정 매일 갱신` 으로만 쓴다. 0건·어제 날짜가 찍히는 사고를 막는다.
- 11-22 브리핑의 "370건"은 그때 집계값이다. **코드에 박지 않는다.**

`build.ps1` 422행(`$soonRows = ParseRows …`) **바로 뒤**에 넣는다(첫 `WritePage` 호출은 735행이라 그 전에 준비된다):

```powershell
# ── 📲 앱 전환 CTA (2026-11-22 ORDER §4) — 모든 생성 페이지 헤더 아래 한 줄 ──
#   문구의 숫자는 이 빌드가 잰 값만 쓴다(사장님 정확도 원칙: 못 잰 숫자는 말하지 않는다).
$AppCta = ''
try{
  $tom = ([datetime]::ParseExact($D.today, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)).AddDays(1)
  $tomS = $tom.ToString('yyyy-MM-dd')
  $tomN = 0
  try{
    # limit=1 + Prefer: count=exact → PostgREST 가 Content-Range 에 전체 건수를 넣어 준다(Range 머리말은 PS 5.1 에서 막히는 경우가 있어 안 쓴다)
    $cu = "https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/gonggu?select=id&open_date=eq.$tomS&limit=1"
    $cr = Invoke-WebRequest -Uri $cu -TimeoutSec 20 -Headers @{ apikey=$key; Authorization="Bearer $key"; Prefer='count=exact' }
    $crv = "$($cr.Headers['Content-Range'])"
    if(-not $crv){ try{ $crv = "$($cr.Headers.GetValues('Content-Range')[0])" }catch{} }
    $cm = [regex]::Match($crv, '/(\d+)\s*$'); if($cm.Success){ $tomN = [int]$cm.Groups[1].Value }
  }catch{}
  if($tomN -le 0){ $tomN = @($soonRows | Where-Object { "$($_.od)".Length -ge 10 -and "$($_.od)".Substring(0,10) -eq $tomS }).Count }
  $dowKo = @('일','월','화','수','목','금','토')[[int]$tom.DayOfWeek]
  if($tomN -ge 100){ $hook = "내일($dowKo) 오픈 공구 ${tomN}건" } else { $hook = '공구 일정 매일 갱신' }
  $AppCta = "<div class=${Q}appcta${Q}><b>$(HtmlEsc $hook)</b><span>앱에서 알림·찜하기</span>" +
    "<a class=${Q}ap${Q} href=${Q}https://apps.apple.com/kr/app/id6826126083${Q} rel=${Q}nofollow noopener${Q} onclick=${Q}try{gtag('event','seo_app_cta',{place:'seo_ios'})}catch(_){}${Q}>App Store</a>" +
    "<a class=${Q}ap g${Q} href=${Q}https://play.google.com/store/apps/details?id=com.wantsb.momcalendar${Q} rel=${Q}nofollow noopener${Q} onclick=${Q}try{gtag('event','seo_app_cta',{place:'seo_and'})}catch(_){}${Q}>Google Play</a></div>"
  Write-Output "앱 CTA: $hook (내일 $tomS · 조회 $tomN)"
}catch{ Write-Output "앱 CTA 못 만듦($($_.Exception.Message)) — 배너 없이 빌드 계속" }
```

`lib.ps1` `$CSS` 문자열(199~254행) 끝, `.note a{…}`(253행) 다음 줄에 추가:

```css
.appcta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #DCCBF2;border-left:4px solid #7C54C4;border-radius:12px;padding:10px 12px;margin-top:14px;font-size:12.5px;line-height:1.4;color:#4A4356}
.appcta b{font-size:13.5px;color:#5B3A8C}
.appcta .ap{margin-left:auto;padding:6px 10px;border-radius:8px;font-size:11.5px;font-weight:800;text-decoration:none;background:#602090;color:#fff;white-space:nowrap}
.appcta .ap.g{margin-left:0;background:#fff;color:#4A35A0;border:1px solid #DCCBF2}
```

`WritePage` 325행 아래에 삽입:

```powershell
  # 📲 앱 전환 배너 — 문구·숫자는 build.ps1 이 계산한 $AppCta (noindex 페이지엔 넣지 않는다)
  if($AppCta -and (("$($o.robots)") -notmatch 'noindex')){ [void]$sb.AppendLine($AppCta) }
```

> `$AppCta` 는 `build.ps1` 스코프 변수다. `WritePage` 는 같은 세션에서 불리므로 그대로 보인다. `patch_kept_once.ps1` 처럼 `$AppCta` 가 없는 쪽에서 불리면 `$null` 이라 배너가 안 붙는다(그게 맞다).

### 4-3. 측정

- 이벤트 이름 `seo_app_cta`, 파라미터 `place`(`seo_ios` / `seo_and`). GA4 에서 "네이버 유입 → 앱 스토어 클릭" 전환을 주 단위로 비교한다.
- 배너 자체는 GA4 페이지뷰에 이미 잡히므로, ①의 GA4 404 와 같은 보고서에서 같이 본다.

### 4-4. 하지 말 것

- `index.html` 의 `appBn` 코드를 복사하지 말 것 — 앱 안 판별·`localStorage` 7일 닫기가 붙어 있어 정적 랜딩에 안 맞는다. 필요한 건 **두 스토어 링크와 문구**뿐이다.
- `intent://`·`itms-apps://` 스킴 금지 — 크롤러·PC 에서 깨진 링크가 된다.
- `rel="nofollow noopener"` 유지. 추가 `gtag` 스니펫 금지(페이지마다 정확히 1회 규칙).

---

## 5. [P1] ③ `hotdeal-cloud.yml` — 15분 schedule 을 2시간으로

### 5-1. 지금

```yaml
on:
  schedule:
    - cron: '8,23,38,53 * * * *'   # 15분
concurrency:
  group: hotdeal-cloud
  cancel-in-progress: false
```
320분 루프 + 끝에 `gh workflow run`(사슬). `pending` 이 쌓이는 게 아니라 **깃허브가 그룹당 대기 1건만 남기고 이전 대기를 취소**한다 → 하루 4~5건의 `cancelled` 실행이 이력에 남고, 대시보드·오류 레이더에서 "취소/실패"로 읽힌다(11-22 실측).

### 5-2. 변경

```yaml
on:
  schedule:
    - cron: '8 */2 * * *'          # 2026-11-22 사장님 지시: 320분 루프와 겹쳐 15분마다 대기·취소가 쌓였다
```

- 위쪽 주석 블록(11-12 설명 끝)에 한 줄 덧붙인다: `# 2026-11-22: schedule 15분 → 2시간. 24시간 유지는 사슬(workflow_dispatch)이 하고, schedule 은 사슬이 끊겼을 때의 예비다(복구 상한 2시간 < 서버 크론 hotdeal-stall-watch 3시간 경보).`
- **그대로 두는 것**: `concurrency`(group·`cancel-in-progress: false`), 320분 루프, `timeout-minutes: 345`, 마지막 `gh workflow run` 사슬, `permissions`.

### 5-3. 왜 안전한가

사슬은 `schedule` 이 아니라 **마지막 스텝의 `workflow_dispatch`** 가 잇는다(11-22 이력: 04:42 → 09:52 → 15:13 → 20:24, 간격 5h10~5h21 = 루프 길이). `schedule` 은 그 사슬이 끊겼을 때만 쓰이는 예비라 2시간 간격이어도 수집이 멈추지 않는다. 최악의 경우(사슬 끊김) 복구까지 2시간인데, 서버 크론 `hotdeal-stall-watch` 가 3시간 무등록에서 경보하므로 **경보 전에 복구된다**.

### 5-4. 확인

1. 커밋·푸시하면 이 파일을 고친 `push` 트리거로 **즉시 1회 실행**된다(정상). 그 실행이 320분 도는 동안 대기 실행이 1건 생기는 것은 정상 동작이다.
2. 수집 상태: `select max(created_at) from hotdeals;` → 최근 60분 안. (급하면 사이트 `핫딜정보.html` 최신 등록 시각으로 봐도 된다)
3. 3일 뒤 실행 이력(`/actions/workflows/hotdeal-cloud.yml`): `workflow_dispatch` 간격이 계속 5h 내외, `schedule` 실행 **3건/일 이하**, 3시간 넘는 공백 **0건**.
4. 공백이 3시간을 넘으면 `cron: '8,38 * * * *'`(30분)로 한 단계만 되돌린다.

### 5-5. 되돌리기

cron 한 줄을 `'8,23,38,53 * * * *'` 로 되돌리면 끝.

---

## 6. [P0] ④ 출석 9월 당첨자 6명 발송 완료 처리 (DB 1회)

**사장님 확인(2026-11-22)**: 9월 당첨자 6명은 **이미 다 보냈다.** 지금 경보는 9월·10월을 함께 말하고 있어 매일 아침 틀린 알림이 뜬다. 9월만 정리하고 10월 7명은 **그대로 미발송**으로 남긴다.

경보 출처: `tools/daily/winner_notify.mjs` → `attendance_winners`(`month`·`sent_at`·`contact`·`approved_at`). 관리자 화면의 `markSent`(`admin_winner_sent` RPC)가 발송 표시할 때 **연락처를 지운다**(개인정보). SQL 로 처리할 때도 같은 결과를 내야 한다.

### 6-1. 조회 → 건수 확인 (쓰기 전)

```sql
select to_char(month,'YYYY-MM') as m, id, nickname, prize, sent_at, approved_at,
       (coalesce(contact,'') <> '') as has_contact
from attendance_winners
where to_char(month,'YYYY-MM') in ('2026-09','2026-10')
order by month, id;
```

- 위 결과를 `scratchpad/attendance_2026-09_sent_backup.json` 으로 먼저 남긴다(되돌리기용).
- **9월 미발송(`sent_at is null`)이 정확히 6건일 때만** 다음으로 간다. 6이 아니면 (5·7·0 등) **아무것도 쓰지 말고** 실제 건수를 보고한다 — 사장님이 확인한 수와 다르면 그 자체가 알아야 할 사실이다.

### 6-2. 9월만 발송 완료로

```sql
update attendance_winners
   set sent_at = now(), contact = null
 where to_char(month,'YYYY-MM') = '2026-09'
   and sent_at is null;
```

- `contact = null` 은 관리자 화면 `markSent` 와 같은 동작(발송하면 연락처를 지운다). 개인정보를 남기지 않는다.
- **10월(`2026-10`)·11월은 절대 건드리지 않는다.** `where` 절의 `'2026-09'` 를 바꾸지 말 것.

### 6-3. 경보 갱신

```
node tools/daily/winner_notify.mjs        # --dry 로 먼저 보면 더 좋다
```

- 기대 결과: `daily/_alert.txt` 의 `winner` 줄이 `출석체크 당첨자 아직 안 보냈어요 — 10월 7명(연락처 받은 7명) · 관리자 💜 출석·추첨 에서 확인` — **9월이 사라진다.**
- 이 줄은 스크립트가 git 배관으로 **자기 파일만** 커밋·푸시한다(다른 작업 커밋은 안 실린다). 손으로 커밋하지 않는다.
- 조회가 실패하면 스크립트는 알림을 지우지 않고 끝난다(설계). 그 경우 "조회 실패로 그대로 둠"을 보고에 남긴다.
- 관리자 화면에서 눈으로 확인: `admin.html` → 💜 출석·추첨 → 월별 추첨 현황 → 9월이 `✅ 발송 완료`, 10월이 `🟡 발송 0/7`.

---

## 7. 검증 체크리스트 (V1~V10 — 실제로 돌리고 표로 보고)

| # | 검증 | 방법 | 합격 기준 |
| --- | --- | --- | --- |
| V1 | 빌드 정상 | `seo-daily` `workflow_dispatch` + `dry_run=true` | 에러 0, 출력에 `앱 CTA: …` 한 줄 |
| V2 | 역검증 통과 | `pwsh tools/seo/verify.ps1` | `=== 통과: 문제 없음` |
| V3 | 배너 존재 | 새로 생성된 `g/` 1장 · `p/` 1장 · `세일정보.html` grep `class="appcta"` | 각 **정확히 1회**, `noindex` 페이지 1장은 **0회** |
| V4 | 숫자 = 실측 | 같은 날 공개 `gonggu` `open_date=내일` count 와 페이지 표기 대조 | 일치(또는 100건 미만이라 숫자 없음) |
| V5 | 링크 정확 | 배너 HTML 확인 | 두 스토어 URL 정확, `rel="nofollow noopener"`, `intent://`·`itms-apps://` **0건**, `gtag` 스니펫 여전히 1회 |
| V6 | 404 검색창 | 라이브 `https://momcalendar.com/없는주소.html` | 폼 `action="/"` `name="q"` 보임, `/?q=기저귀` 로 검색 결과 뜸, `noindex` 유지 |
| V7 | 툼스톤 | `git log --stat` + 표본 5장 | 11-16 33장 유지, 신규는 실행 보고 수와 일치, 쪽지에 브랜드·상품명 0건 |
| V8 | 라이브 파일 무변경 | `git log --stat -- index.html admin.html staff.html test.html test-app.html register.html kktest.html reelcard.html` | 변경 **0** |
| V9 | 핫딜 | 파일 cron 값 + 24시간 뒤 `max(created_at)` | cron `8 */2 * * *`, 마지막 수집 **60분 이내** |
| V10 | 출석 경보 | `daily/_alert.txt` `winner` 줄, 관리자 화면 9·10월 | 9월 없음 · 10월 7명 유지 · 9월 카드 `✅ 발송 완료` |

---

## 8. 커밋 나누기 (한 커밋에 섞지 말 것)

| 커밋 | 내용 |
| --- | --- |
| ① 404 | `tools/seo/gsc_404.csv`(교체된 경우) · `tools/seo/tombstone.ps1`(GA4 형식) · 새 툼스톤 파일들 · `404.html` · `tools/seo/build.ps1`(robots 두 줄) |
| ② 앱 CTA | `tools/seo/lib.ps1` · `tools/seo/build.ps1` (+ 다음 날 05:10 자동 커밋이 생성 페이지에 반영) |
| ③ 핫딜 | `.github/workflows/hotdeal-cloud.yml` 한 파일 |
| ④ 출석 | 코드 커밋 없음(DB 쓰기 + `daily/_alert.txt` 는 `winner_notify` 가 스스로 올림) |

## 9. 보고 형식

- 커밋 해시 + GitHub 파일 URL(오더서·바뀐 파일)
- §7 V1~V10 표(실측값 그대로, 못 한 것은 "못 함 + 이유")
- ①: 툼스톤 신규 N장 / 유지 33장 / 건너뜀 J장, GA4 목록 처리 여부, robots 두 줄 반영
- ②: 배너 문구에 실제로 찍힌 숫자와 그날 실측값
- ③: 바꾼 cron, 배포 직후 실행 1건 확인, 24시간 뒤 첫 점검 예정
- ④: 9월 처리 전·후 건수, 갱신된 경보 문장 그대로
- 지시서와 다르게 한 것 / 못 한 것 / 사람이 해야 하는 것(서치콘솔 CSV 내보내기, GA4 CSV 내보내기)

---

## 부록. 이번에 **하지 않는** 것 (다음 오더 후보)

- `www.momcalendar.com` Cloudflare 301 — 인프라 작업(11-16 오더 §8-2 그대로 미처리)
- 서치콘솔 649건을 코드로 자동 수집 — GSC API 에 "404 목록" 엔드포인트가 없다(색인 리포트는 UI 전용). CSV 내보내기가 유일한 길이다
- `g/` 본문 분량 상향(11-16 오더 "남은 것": 중위 2,056자)
- `seo_dataset` 이 `gonggu_archive` 를 안 읽어 브랜드 4,155장이 굳은 문제
