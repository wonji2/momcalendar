# ORDER — 테스트 페이지 완전 차단 + 구글 3위 이내 전략 (크롤 예산 · 대표 허브 · 첫 화면)

작성 2026-11-23 (월) · 자비스 · 기준 커밋 `ffc44b6b`(main, 2026-11-23 10:16 KST)
대상 저장소 `wonji2/momcalendar` · 작업자 = 클로드 코드
교차검증 방장(@bangjang7) 비서 2026-11-23 10:39 — §3-1(카톡 콜백·E2E 파라미터) · §3-4(봇 UA 분기 금지·Disallow 해제) · §4-3(verify 가드 충돌) · §5-1(대표 URL 대조)은 그 지적을 반영한 결과다.

이 오더는 길아 님 지시(2026-11-23 10:37 「테스트로는 절대 못 즐어오게 하고 구글 서치콘솔 순위 무조건 3위 이내로 높여놓는 전략 짜서 오더 내려줘」)를 실행 문서 하나로 묶은 것이다.
**§1-2「이미 되어 있는 것」표를 먼저 읽어라. 11-16·11-18·11-22 오더에서 이미 끝난 일을 다시 하면 이번 주 빌드가 두 번 돈다.**

---

## 실행 명령 (길아 님이 클로드 코드에 붙여넣는 1줄)

```
claude "orders/ORDER_TEST_BLOCK_AND_SEO_TOP3_2026-11-23.md 끝까지 읽고 §1 표로 지금 상태부터 대조해. §3(테스트 차단)은 P0로 먼저 전부 끝내고, §4·§5는 §5-1 측정값을 먼저 뽑은 뒤 §5-2 결정 규칙대로만 진행해. §8 검증 V1~V16 실제로 돌려 표로 보고, 커밋은 A~E로 나눠. index.html은 §5-5의 세 줄(제목·설명·canonical)만 + (§6-1에서 재현됐을 때만) §6-2의 가드 한 줄, test.html·test-app.html·kktest.html은 §3에 적힌 head 추가와 GA4 제거만, admin.html·bannerlive.html은 §3-6만. 그 밖의 라이브 파일은 건드리지 마"
```

레포 루트(`wonji2/momcalendar` 체크아웃, `C:/Users/FAMILY/...`)에서 실행한다.
PowerShell 스크립트(`.ps1`)는 **UTF-8 BOM** 으로 저장한다(한글 리터럴 때문에 BOM 없이 저장하면 깨진다 — 저장소 기존 규칙).
`.githooks`(1중 방어)와 `deploy-pages` 게이트(2중 방어)는 11-22 오더로 들어가 있다. 이 오더는 그 위에서 돈다 — 훅을 우회하지 않는다(`--no-verify` 금지).

---

## 0. 한 줄 요약

| # | 할 일 | 한 줄 | 우선 |
| --- | --- | --- | --- |
| A | **테스트 페이지 완전 차단** | `test.html`·`test-app.html`·`kktest.html` head 최상단에 접근 게이트(미리보기 키 없으면 홈으로) + **robots.txt 의 Disallow 2줄(`/test.html`·`/kktest.html`) 해제**(그래야 구글이 `noindex` 를 읽는다. `test-app.html` 은 원래 목록에 없다) + GA4 제거 + `verify.ps1` 로봇 검사 교체 | P0 |
| B | **크롤 예산 — `p/` 3계층** | `gg_keep_index.mjs` 를 `p/` 로 확장한 `p_keep_index.mjs` 신설 → 최근 90일 노출 1회 이상은 색인 보존, 휴면 제품(3,287장 중 일부)만 `noindex,follow` + 사이트맵 제외 | P0 |
| C | **6대 키워드 3위 이내** | 먼저 실측(6대 키워드별로 구글이 홈을 띄우는지 허브를 띄우는지) → 그 결과로 대표 URL 1개씩 확정 → 홈/허브 의도 겹침 해소·내부링크 정리·대표 URL 불일치 경보 | P0 |
| D | **첫 화면 용량** | `daily/_alert.txt` 「kb 2647 > 2631.6」 — **먼저 콜드 로드로 재현**하고, 재현될 때만 `#hotdealList` 지연 렌더. 재현 안 되면 손대지 말고 수치만 보고 | P1 |
| E | **사람 몫** | 서치콘솔 「삭제」 요청 3건 · 대표 허브 6 + 홈 색인 재요청 · Cloudflare `X-Robots-Tag`(선택) · 외부 딥링크·브랜드 언급 | P0(사람) |

---

## 1. 지금 상태 — 착수 전에 이 표부터 실제 파일과 대조하라 (2026-11-23 10:20~11:00 KST 실측)

### 1-1. 실측값 (다르면 실측값을 보고에 적고 그 값 기준으로 진행)

| 항목 | 실측 | 판정 |
| --- | --- | --- |
| `robots.txt` (24줄) | `User-agent: *` 와 `User-agent: Yeti` 두 블록 모두 `Disallow: /admin.html` `/staff.html` `/register.html` `/test.html` `/kktest.html` `/rest/` `/functions/` | **`/test.html`·`/kktest.html` 이 막혀 있어 구글이 `noindex` 메타를 못 읽는다** → §3-4 |
| `robots.txt` 에 `test-app.html` | **없다** | §3-4 에서 같이 정리(막지 않는 쪽으로) |
| `test.html` (1,080,385B) | 5~57행: 카톡 인앱 자동로그인 스크립트(진입 최상단) · 67행: `<meta name="robots" content="noindex, nofollow, noai, noimageai">` · 68행: canonical `https://momcalendar.com` · 95~103행: GA4 `G-NRCP2FVRSB` | 게이트 없음·GA4 살아 있음 → §3-1·§3-3 |
| `test-app.html` (767,514B) | 8행: `noindex, nofollow` · 12행 canonical · 39~47행 GA4 · 3행 카톡 SDK | 게이트 없음·GA4 살아 있음 → §3-2·§3-3 |
| `kktest.html` (9,275B) | **robots 메타 없음** · GA4 없음 · 96~105행 `?code` 콜백 처리 · robots.txt 가 Disallow | 게이트 없음·noindex 없음 → §3-2 |
| 테스트 페이지로 들어오는 내부 링크 | `bannerlive.html` 6·8·11행(meta refresh + `location.replace('/test.html')` + 링크) **1곳뿐**. `admin.html` 4309행 `window.open(base+'/test.html?t='+Date.now())`. `test-app.html`·`kktest.html` 을 가리키는 링크 **0건** | §3-6 에서 둘 다 고친다 |
| `index.html` (1,073,893B) | 68행 canonical `https://momcalendar.com` · `<h1>` **정확히 1개**(1981행, `sr-only`) · 제목 `맘캘린더 — 인스타 공구 모음 · 공구 일정 사이트 \| 오늘 오픈 공구일정` | **h1 은 손댈 것 없음.** canonical 슬래시 불일치·제목 겹침만 §5-5 |
| 사이트맵 | main **589** · brand **10,561** · product **3,287** · seller **3,071** · gonggu **10,930** = **28,438** | 11-23 실측 |
| 디스크 파일 수 | `g/` 10,585 · `p/` **3,287** · `s/` 3,072 · `gg/` **35,608** · `m/` 116 · `d/` 9 · `c/` 10 (총 55,314 파일) | `gg/` 35,608 중 사이트맵 10,930 → **24,678장이 이미 noindex(C 계층)** |
| `gg_keep_index.txt` | 635줄 = 명단 **634장** · `gg_window.txt` = **25**(일) · `GG_SITEMAP_MAX` 11,500(현 10,930, 여유 570) | 11-19 장치 정상 가동 중 |
| `p/` 계층 | **없다.** `p/` 페이지는 전부 `index,follow` 이고 사이트맵 product 3,287 = 파일 수 3,287 (한 장도 빠짐없이 색인 대상) | §4 의 대상 |
| 표본 `p/17곡물-미미뻥.html` | 14,998B · 본문 1,328자 · `index,follow` · canonical 자기 자신 | 얇지는 않지만 **휴면 제품이 그대로 색인** |
| 서치콘솔 (실적 11-14~11-20, 11-23 조회) | 색인 **12,086** / 미색인 **30,774** (발견됨-미색인 29,381 · 크롤링됨-미색인 659 · 404 649) · 7일 클릭 **106** · 노출 **237** · CTR 44.7% · 평균순위 **8.7** (직전 3개월 250/일 · 4.4) | 7일 노출 237은 **표본이 작다** — 판정은 `rank_weekly` 의 28일 창으로 한다(§5-9) |
| GA4 7일(11-16~22) | 활성 18,490 · 조회 44,471 · **`/test.html` 93회/54명(평균 2초)** · 제목 `404` 137회/26명 | `/test.html` 누수 실재 |
| `daily/_alert.txt` | 「첫 화면 용량 초과 `kb 2647` > 한계 `2631.6`」 (11-23 아침 브리핑 시점) — 측정 스크립트 `tools/daily/perf_probe.mjs` 는 **원격 저장소에 없다**(PC 로컬) | §6 |
| DOM 실측(11-23 06:50 스캔) | 문서 DOM 1,792KB 중 숨은 `#hotdealList` **688KB·4,862노드**(공구 140KB·1,962 · 세일 20KB·466) | **단, 이 값은 4탭을 눌러 본 뒤의 상태일 수 있다** → §6-1 에서 콜드 로드로 재확인 |

### 1-2. 이미 되어 있는 것 — **다시 하지 말 것** (11-16·11-18·11-22 오더 완료분)

| 이미 있는 것 | 위치 | 이번에 할 일 |
| --- | --- | --- |
| 홈 → 대표 허브 앵커 링크(정확한 검색어 문구) | `index.html` 10211~10237 `seolinks-row` — 인스타공구모음·인스타 공구 사이트·공동구매 사이트·공동구매하는곳·공구일정사이트·공구모음사이트 등 **6대 타겟 전부 1회씩** | 손대지 않는다 |
| 생성 페이지 18,000+ → 허브 12개 앵커 | `tools/seo/lib.ps1` 261~266 `$KW_FOOT`, 363행에서 모든 `WritePage` 하단에 삽입 | §5-4 에서 **줄이는 방향으로만** 조정 |
| 대표 허브 6장 자체 | `공구일정사이트·인스타공구사이트·공구모음사이트·공동구매사이트·공동구매하는곳·인스타공구모음`.html — 제목·H1 에 대표 키워드, `keywords.json` 의 `show` 블록이 페이지마다 다름(opentoday/top20soon/month ↔ hubseller/livesellers ↔ bycat/livebrands ↔ endsoon/endbrands) | §5-3 은 **측정 결과가 시킬 때만** 고친다 |
| 구조화 데이터 | `Event`(gg A만)·`FAQPage`·`ItemList`·`Breadcrumb`·`WebPage.dateModified` — `lib.ps1` `WritePage` | 손대지 않는다 |
| `gg/` 3계층 + 색인 지킴 명단 | `lib.ps1` 93행 `GgTier`, `build.ps1` 577~580 `$GgKeepIdx`, 1886~1913 사이트맵 계층, 11-19 `gg_keep_index.mjs` | **`p/` 에 같은 장치를 복제**(§4). `gg` 쪽은 건드리지 않는다 |
| 툼스톤 33장 + `404.html` 검색창 | 11-22 오더 ① | 손대지 않는다 |
| 앱 전환 CTA | `lib.ps1` `.appcta` (11-22 오더 ②) | 손대지 않는다 |
| 6대 키워드 주간 측정 | `tools/seo/rank_weekly.mjs` (28일 창, 매주 월 07:10) | §5-8 에서 경보 1줄만 추가 |

---

## 2. 절대 하지 말 것 (먼저 읽어라)

1. **라이브 파일은 이 오더에 적힌 자리만 고친다.**
   - `test.html` · `test-app.html` · `kktest.html` = §3-1·§3-2 의 `<head>` 게이트 + §3-3 GA4 제거. **그 밖의 줄은 한 글자도 바꾸지 않는다.**
   - `index.html` = §5-5 의 세 줄(제목·설명·canonical). 그 밖은 손대지 않는다.
   - `admin.html` = §3-6 의 한 줄. `bannerlive.html` = §3-6 의 세 줄.
   - `staff.html`·`register.html`·`reelcard.html`·`staff_test.html`·`register-plan-test.html` = **손대지 않는다.**
2. **봇 UA 로 갈라치기(클로킹) 금지.** 게이트 JS 안에 `Googlebot`·`Yeti` 문자열을 넣지 않는다. 크롤러에게 다른 응답을 주면 클로킹·소프트 404 로 오판된다(냠이 지적). 색인 제거는 `noindex` 메타와 서치콘솔 「삭제」 요청으로만 한다.
3. **서버 리다이렉트(301/302) 금지.** `tools/live_verify.sh` 10행이 `/test.html` **200** 을 요구하고, `deploy-pages` 게이트가 그 스크립트를 돌린다. 게이트는 **JS `location.replace`** 로만 만들고 HTTP 상태는 200 을 유지한다.
4. **`robots.txt` 에서 `/test.html`·`/test-app.html`·`/kktest.html` 을 다시 막지 않는다.** Disallow 가 있으면 구글이 `noindex` 를 못 읽어 **URL 만 색인**된다(지금이 그 상태다). 막는 일은 `noindex` 메타 + 접근 게이트가 한다.
5. **`g/`·`s/`·`m/`·`d/`·`c/` 에 noindex 를 붙이지 않는다.** 이번 3계층은 `p/` 에만 적용한다.
6. **숫자를 지어내지 말 것.** `keywords.json` 의 `__TOTAL__`·`__LIVE__`·`__TODAY__` 처럼 빌드가 채우는 자리표시자만 쓴다. 손으로 센 수치를 제목에 박지 않는다.
7. **`gg_keep_index.mjs`·`GgTier`·`gg_window.txt` 의 규칙을 바꾸지 않는다.** `p/` 는 **복제**로 만든다.
8. **커밋은 A~E 로 나눈다.** `git add -A`·`git add .` 금지(11-22 사고). `.githooks/pre-push` 가 파일 수·ancestry 를 본다.

---

## 3. [P0] A. 테스트 페이지 완전 차단

목표는 두 가지다. ① **사람**은 `/test.html` 로 못 들어온다 ② **구글**은 그 URL 을 색인에서 뺀다. 두 목표는 도구가 다르다 — 사람은 JS 게이트, 구글은 `noindex`(+ 서치콘솔 삭제 요청)다.

### 3-1. `test.html` — `<head>` 최상단 접근 게이트

**위치**: `test.html` 4행 `<meta charset="UTF-8">` 바로 아래, **5행 카톡 자동로그인 `<script>` 보다 먼저.** (냠이 지적: 카톡 스크립트가 `?code=`·`?state=`·`?e2e=`·`?kktest=` 를 처리하므로, 게이트가 그 파라미터를 예외로 두지 않으면 카톡 로그인 복귀가 홈으로 튕겨 OAuth 검증이 깨진다.)

```html
<!-- 🚧 2026-11-23 접근 게이트 (ORDER_TEST_BLOCK_AND_SEO_TOP3 §3-1) — head 최상단. 미리보기 키·OAuth 콜백·E2E 쿼리만 통과, 나머지는 홈으로 -->
<script>
(function(){
  var HOME='https://momcalendar.com/';
  try{
    var P=new URLSearchParams(location.search);
    if(P.get('preview')==='1'){ try{ sessionStorage.setItem('mc_test_ok','1'); }catch(_){} return; }   // ?preview=1 로 한 번 들어오면 그 탭 안에서는 계속 열린다
    try{ if(sessionStorage.getItem('mc_test_ok')==='1') return; }catch(_){}
    try{ if(localStorage.getItem('mc_test_ok')==='1') return; }catch(_){}   // 사장님·클코가 개발자도구로 직접 켜 둘 수 있는 칸
    // 아래는 test.html 이 스스로 쓰는 파라미터다 — 없애면 카톡 로그인 복귀·위시 딥링크·E2E 가 깨진다
    var OK=['code','state','error','e2e','flowtest','kktest','nxbell','wdid','wlink','mycal','by'];
    for(var i=0;i<OK.length;i++){ if(P.has(OK[i])) return; }
    location.replace(HOME);
  }catch(_){ try{ location.replace(HOME); }catch(__){} }
})();
</script>
```

- `?mycal=` 은 **찜한 공구 공유 링크**다(`test.html` 6618·6630행). 링크를 받은 사람이 열 수 있어야 하므로 예외에 둔다.
- `?adtest=1`·`?commad=1`·`?apponly`·`?hddemo` 같은 시험 스위치는 **예외에 넣지 않는다.** 쓸 때는 `?preview=1&adtest=1` 처럼 앞에 미리보기 키를 붙인다.
- 게이트는 `catch` 에서도 홈으로 보낸다 — 어떤 이유로든 예외가 나면 열어주는 쪽으로 실패하지 않는다.

### 3-2. `test-app.html` · `kktest.html` — 같은 게이트, 파라미터만 다르게

두 파일 모두 **게이트 본문은 §3-1 과 같은 코드**다(`sessionStorage` 키도 `mc_test_ok` 로 통일). 바뀌는 것은 `OK` 배열 하나뿐이다.

**`test-app.html`**: 4행 `<meta charset="UTF-8">` 아래(3행 토스페이스 link 보다 먼저).
`OK` 배열을 아래로 바꾼다 — 이 페이지가 직접 읽는 값들이다(`app` 1102·3681행, `ct` 9116행, `flowtest` 8634행, `nxbell` 7434행, 그 밖 `from`·`mvt`·`sale`·`src`·`week`·`wish`·`q`·`wdid`·`wlink`·`code`·`state`·`error`).

```
var OK=['code','state','error','e2e','flowtest','nxbell','app','ct','from','mvt','sale','src','week','wish','q','wdid','wlink'];
```

- 이 페이지를 가리키는 링크는 저장소 안에 **0건**이다(§1-1). 그래도 앱 웹뷰·수동 시험 경로를 살리기 위해 위 파라미터는 남긴다.

**`kktest.html`**: 4행 `<meta charset="utf-8">` 아래. 이 페이지는 카톡 콜백만 처리하므로 더 좁게.

```
var OK=['code','state','error','e2e','kktest','flowtest'];
```

**`kktest.html` 에는 `noindex` 메타가 아예 없다.** 6행 `<title>` 위에 한 줄 추가한다(이게 없으면 Disallow 를 풀어도 색인에서 안 빠진다):

```html
<meta name="robots" content="noindex, nofollow">
```

### 3-3. GA4 제거 — 테스트 트래픽으로 실사용 지표를 오염시키지 않는다

| 파일 | 지울 줄 | 남길 것 |
| --- | --- | --- |
| `test.html` | 95행 주석 · **97~103행**(`googletagmanager` script + `gtag` 4줄) | 96행 `<link rel="preconnect" href="https://api.momcalendar.com">` 는 **남긴다** |
| `test-app.html` | 39행 주석 · **41~47행** | 40행 preconnect 남긴다 |

- 지운 뒤 `gtag(` 호출이 남아도 안전한지 확인했다: `test.html` 2562·2705행은 `typeof gtag==='function'` 로 감싸여 있고, `trackEvent`(9478행)는 **Supabase `events` 테이블**로 보낸다(GA4 와 무관). 즉 스니펫만 빼면 된다.
- `verify.ps1` 은 루트 `test*.html` 을 검사 대상에 넣지 않으므로 「GA4 1회」 검사와 충돌하지 않는다. 대신 §3-5 에서 **테스트 3종에 GA4 가 없어야 한다**는 검사를 새로 넣는다(되돌아오는 것을 막는다).

### 3-4. `robots.txt` — Disallow 2줄 해제가 이번 축의 핵심

`build.ps1` 1965행이 `robots.txt` 를 **생성**한다. 손으로 고치면 다음 05:10 빌드에 덮인다 → **생성기에서 고친다.**

`build.ps1` **1955행 한 줄**이 두 `User-agent` 블록이 함께 쓰는 차단 목록이다:

```powershell
$blockRules = "Allow: /`nDisallow: /admin.html`nDisallow: /staff.html`nDisallow: /register.html`nDisallow: /test.html`nDisallow: /kktest.html`nDisallow: /rest/`nDisallow: /functions/"
```

여기서 **`` `nDisallow: /test.html `` 와 `` `nDisallow: /kktest.html `` 두 조각만 지운다**(줄 전체를 지우지 말 것 — 한 줄 문자열이다):

```powershell
$blockRules = "Allow: /`nDisallow: /admin.html`nDisallow: /staff.html`nDisallow: /register.html`nDisallow: /rest/`nDisallow: /functions/"   # 2026-11-23 ORDER §3-4: 테스트 3종은 Disallow 해제 — noindex 를 읽히게 한다
```

- `test-app.html` 은 원래 목록에 없으므로 **추가하지 않는다.**
- 결과 `robots.txt` 의 두 `User-agent` 블록은 `Disallow: /admin.html` `/staff.html` `/register.html` `/rest/` `/functions/` 만 남는다.
- **`admin.html` 은 계속 막아 둔다** — 로그인 화면이고 사이트맵에 없다. (원하면 §부록2 의 후속 후보로 `admin.html` 에도 `noindex` 메타를 넣을 수 있지만, 이번엔 하지 않는다.)
- 왜 해제가 맞나: 구글은 `Disallow` 된 URL 의 본문을 읽지 않으므로 `<meta name="robots" content="noindex">` 를 볼 수 없다. 그래서 **막으면 오히려 URL 만 색인**된다. 막을 것은 게이트(사람)와 `noindex`(검색)로 나눈다.

### 3-5. `verify.ps1` 로봇 검사 교체 (이걸 안 하면 매일 빌드 커밋이 막힌다)

지금 `verify.ps1` 177~182행:

```powershell
$rb = [IO.File]::ReadAllText((Join-Path $root 'robots.txt'))
if($rb -notmatch 'Sitemap: https://momcalendar\.com/sitemap\.xml'){ Bad 'robots.txt 에 sitemap 없음' }
foreach($d in @('/admin.html','/staff.html','/test.html')){
  if($rb -notmatch [regex]::Escape("Disallow: $d")){ Bad "robots.txt 에 $d 차단 없음" }
}
```

아래로 **교체**한다(냠이 지적: 가드가 옛 규칙을 붙들고 있으면 §3-4 와 정면 충돌한다):

```powershell
# 5) robots + 테스트 페이지 색인 차단 (2026-11-23 ORDER §3)
$rb = [IO.File]::ReadAllText((Join-Path $root 'robots.txt'))
if($rb -notmatch 'Sitemap: https://momcalendar\.com/sitemap\.xml'){ Bad 'robots.txt 에 sitemap 없음' }
foreach($d in @('/admin.html','/staff.html','/register.html')){
  if($rb -notmatch [regex]::Escape("Disallow: $d")){ Bad "robots.txt 에 $d 차단 없음" }
}
# 테스트 3종은 Disallow 대신 (게이트 + noindex + GA4 없음)으로 막는다.
#   Disallow 가 있으면 구글이 noindex 를 못 읽어 URL 만 색인된다(2026-11-23 실측 상태).
foreach($d in @('test.html','test-app.html','kktest.html')){
  if($rb -match [regex]::Escape("Disallow: /$d")){ Bad "robots.txt 가 /$d 를 막고 있다 — noindex 를 못 읽는다" }
  $tp = Join-Path $root $d
  if(-not (Test-Path -LiteralPath $tp)){ Bad "테스트 페이지가 없다: $d"; continue }
  $tt = [IO.File]::ReadAllText($tp)
  if($tt -notmatch '<meta name="robots" content="[^"]*noindex'){ Bad "$d 에 noindex 메타가 없다" }
  if($tt -notmatch 'mc_test_ok'){ Bad "$d 에 접근 게이트가 없다" }
  if($tt -match 'G-NRCP2FVRSB'){ Bad "$d 에 GA4 가 남아 있다" }
}
```

### 3-6. 게이트가 깨뜨리는 두 곳을 같이 고친다

| 파일 | 지금 | 바꿀 것 |
| --- | --- | --- |
| `admin.html` 4309행 | `window.open(base+'/test.html?t='+Date.now(),'_blank')` | `window.open(base+'/test.html?preview=1&t='+Date.now(),'_blank')` — 관리자 「테스트 페이지 열기」 버튼이 계속 열려야 한다 |
| `bannerlive.html` 6·8·11행 | `<meta http-equiv="refresh" content="0; url=/test.html">` · `location.replace('/test.html'+location.search)` · 문구 「테스트 페이지가 momcalendar.com/test.html 로 통합됐어요」 | `url=/` · `location.replace('/'+location.search)` · 문구 「맘캘린더 본 사이트로 이동합니다」 로 바꾼다. `noindex,nofollow`(5행)는 그대로 둔다 |

### 3-7. 카톡 로그인 경로가 살아 있는지 (읽고 확인만 — 수정 금지)

- `index.html` 6993행 `KKO_OK_PATHS = ['/', '/test.html', '/kktest.html']` — 카카오 개발자 콘솔에 등록된 되돌아오기 주소다. 세 경로 모두 **게이트 예외(`code`/`state`)** 로 통과하므로 로그인은 계속 된다.
- `test.html` 52행은 `redirect_uri = location.origin + (onTest ? '/test.html' : '/')` 로 **test.html 자신**에게 돌려준다. 게이트가 `code`·`state` 를 예외로 두는 한 문제없다.
- **검증(V3)에서 실제로 확인할 것**: `/test.html?code=abc&state=k.test123` 로 열면 **홈으로 튕기지 않아야** 한다.

### 3-8. 사람 몫 (클코가 못 한다 — §7-1 에 합쳐 보고)

1. 서치콘솔 → 색인 생성 → 페이지 → 「삭제 요청」에 `https://momcalendar.com/test.html` · `/test-app.html` · `/kktest.html` 3건(임시 삭제, 6개월).
2. (선택) Cloudflare Transform Rule 로 `/test*.html`·`/kktest.html` 응답에 `X-Robots-Tag: noindex, nofollow` 를 붙이면 색인 제거가 더 확실해진다. Cloudflare 접근이 없으면 **건너뛴다**(코드만으로도 `noindex` 는 동작한다).

### 3-9. 되돌리기

게이트를 지우고 `build.ps1` 의 Disallow 두 줄을 되살리고 `verify.ps1` 을 예전 블록으로 돌리면 끝난다. 파일은 하나도 삭제하지 않으므로 라이브에 404 가 생기지 않는다.

---

## 4. [P0] B. 크롤 예산 — `p/` 3계층 (gg 에서 검증된 장치를 그대로 복제)

왜: 사이트맵 28,438장 중 색인 12,086 / 미색인 30,774. `gg/` 는 이미 24,678장을 noindex 로 내려 예산을 회수했지만, **`p/` 3,287장은 한 장도 빠짐없이 색인 대상**이다. 그중 오래된 휴면 제품이 구글 크롤 큐를 차지한다. 11-19 에 `gg` 에서 검증한 방식(최근 90일 노출 1회 이상은 색인 보존)을 `p` 에 그대로 적용한다. **단계적으로** 한다 — 한 번에 3,000장을 내리지 않는다.

### 4-1. `tools/seo/p_keep_index.mjs` 신설 (gg 판 복제)

`tools/seo/gg_keep_index.mjs`(43줄)를 아래만 바꿔 새 파일로 만든다. **`gg_keep_index.mjs` 는 손대지 않는다.**

| 항목 | gg 판 | p 판 |
| --- | --- | --- |
| 출력 파일 | `tools/seo/gg_keep_index.txt` | `tools/seo/p_keep_index.txt` |
| GSC 필터 | `expression: '/gg/'` | `expression: '/p/'` |
| 정규식 | `/^\/gg\/[^/]+\.html$/` | `/^\/p\/[^/]+\.html$/` |
| 파일명 자르기 | `p.slice(4)` | `p.slice(3)` |
| 안전장치 | `if (names.length < 50) keep(...)` | `if (names.length < 30) keep(...)` |
| 머리 주석 | 장기 마감 공구 | 휴면 제품 페이지 — 최근 90일 노출 1회 이상은 noindex 로 내리지 않는다 |

- 창은 gg 와 같다: `start = now-92일`, `end = now-2일`(자료가 2~3일 늦다). 열쇠 이름도 같다(`GSC_CLIENT_ID`·`GSC_CLIENT_SECRET`·`GSC_REFRESH_TOKEN`).
- API 가 실패하거나 명단이 30줄 미만이면 **기존 명단을 그대로 두고 끝난다**(빌드는 계속) — gg 판과 같은 원칙.

```
node tools/seo/p_keep_index.mjs        # → ✅ p 색인 지킴 명단 N줄 (YYYY-MM-DD~YYYY-MM-DD)
```

### 4-2. `build.ps1` — `p/` 계층 (KEEP / NOIDX)

**(a) 명단 읽기** — 577~580행 `$GgKeepIdx` 블록 바로 아래에 같은 꼴로 추가:

```powershell
# ── p(제품) 색인 계층 (2026-11-23 ORDER §4) — gg 와 같은 원칙, 대상만 p/ ──
$PKeepIdx = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$pKeepFile = Join-Path $PSScriptRoot 'p_keep_index.txt'
if(Test-Path $pKeepFile){ foreach($ln in [IO.File]::ReadAllLines($pKeepFile)){ $ln = $ln.Trim(); if($ln -and -not $ln.StartsWith('#')){ [void]$PKeepIdx.Add($ln) } } }
$pCut = ([DateTime]::ParseExact($today,'yyyy-MM-dd',$null)).AddDays(-90).ToString('yyyy-MM-dd')
Write-Output "p 색인 지킴 명단(구글 노출 90일): $($PKeepIdx.Count)장 · 휴면 기준 $pCut"
```

**(b) 계층 함수** — `$pCut` 정의 아래에:

```powershell
# K = 색인 유지 / N = 휴면(noindex,follow + 사이트맵 제외, 페이지는 200 유지)
#   K 조건: 지금·곧 열리는 공구가 있다 OR 마지막 공구가 90일 안이다 OR 최근 90일 구글 노출이 있다
function PIndexTier($p, $live, $soon, [string]$cut){
  if($live.Count -gt 0 -or $soon.Count -gt 0){ return 'K' }
  if(-not "$($p.last)"){ return 'K' }          # 마지막 공구 날짜를 모르면 내리지 않는다(추정 금지)
  if("$($p.last)" -ge $cut){ return 'K' }
  if($PKeepIdx -and $PKeepIdx.Contains("$($p.slug).html")){ return 'K' }
  return 'N'
}
```

`$p.last` 는 `prodList` 항목의 `last`(=`last_open`)다(449~463행에서 `$o = [pscustomobject]@{ ... first=$x.first_open; last=$x.last_open ... }`). **오늘 날짜·건수를 코드에 박지 않는다.**

**(c) 생성 시 robots** — `p/` 를 쓰는 `WritePage`(832행) 호출에 한 줄 추가. `gg` 가 958행에서 쓰는 방식과 같다:

```powershell
$pTier = PIndexTier $p $live $soon $pCut
if($pTier -eq 'N'){ [void]$pNoIdx.Add("$($p.slug).html") }   # 다음 (d) 사이트맵·(4-4) 허브 링크가 이 표를 본다
WritePage @{ path=(Join-Path $Root "p/$($p.slug).html"); title=$title; desc=$desc; canon=$canon;
  robots=$(if($pTier -eq 'N'){ $ROBOTS_NOINDEX } else { '' });
  h1="$($p.key) 공구"; sub="인스타 공동구매 일정"; body=$body; jsonld=$ld; bcName="$($p.key) 공구" }
```

- `$pNoIdx` 는 p 생성 루프 **바로 앞**에서 한 번 만든다: `$pNoIdx = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)`
- `h1`·`sub`·`body`·`jsonld` 는 지금 값 그대로다(바꾸는 것은 `robots` 한 칸뿐).

(`$ROBOTS_NOINDEX` = `lib.ps1` 20행 `'noindex,follow,max-image-preview:large'`. `noindex,follow` 라서 내부링크 가치는 회수된다.)

**(d) 사이트맵에서 제외** — 1880행 두 줄을 아래로 바꾼다. 판정은 (c) 에서 만든 `$pNoIdx` 표를 그대로 본다(같은 판정을 두 번 하지 않는다):

```powershell
# 지금 (1880~1881행)
$uP = @(); foreach($p in $prodList){ $uP += "p/$(Enc $p.slug).html" }
$uP = @($uP) + @(KeptUrls 'p' $uP)

# 바꿀 것 (2026-11-23)
$uP = @(); foreach($p in $prodList){ if(-not $pNoIdx.Contains("$($p.slug).html")){ $uP += "p/$(Enc $p.slug).html" } }
$uP = @($uP) + @((KeptUrls 'p' $uP) | Where-Object { -not (HasNoindex ([uri]::UnescapeDataString("$_")) $Root) })
```

`HasNoindex` 는 `lib.ps1` 26행 함수다(경로+루트를 받는다). 보존 `p/` 중 이미 noindex 인 것은 싣지 않는다 — 안 그러면 `verify.ps1` 129행 「noindex 페이지가 사이트맵에 있다」에 걸린다.

**(e) 마지막 출력** — 2118행 근처에 한 줄 추가:

```powershell
Write-Output "p 계층: 색인 $($prodList.Count - $pNoIdx.Count) · 휴면(noindex) $($pNoIdx.Count) · 사이트맵 product $($uP.Count)"
```

### 4-3. `verify.ps1` 가드 조정 (냠이 지적 — 이걸 빼면 매일 커밋이 막힌다)

`verify.ps1` 139~147행은 **`gg` 말고 모든 폴더의 noindex 가 5% 를 넘으면 실패**시킨다. `p` 에 계층을 넣으면 정상 상태에서도 걸린다. 아래로 바꾼다:

```powershell
#   ① 템플릿 사고(전 페이지 noindex): p·gg 는 계층을 쓰므로 폴더별 5% 가드에서 뺀다 → 각자 상한으로 본다.
foreach($dk in @($filesByDir.Keys)){
  if($dk -eq 'gg' -or $dk -eq 'p'){ continue }
  $nn = [int]$noidxByDir[$dk]; $tt = [int]$filesByDir[$dk]
  if($nn -gt [Math]::Max(30, [int]($tt * 0.05))){ Bad "noindex 페이지가 $dk 폴더에 $nn / $tt 장 — 템플릿 사고 의심(전 페이지 noindex)" }
}
#   p 3계층 상한 — 휴면이 70% 를 넘으면 데이터·판정 사고로 본다
$pAll2 = [int]$filesByDir['p']; $pNo2 = [int]$noidxByDir['p']
if($pAll2 -gt 0 -and $pNo2 -gt [int]($pAll2 * 0.70)){ Bad "p 폴더 noindex $pNo2 / $pAll2 — 계층 판정 사고 의심" }
Write-Output "p noindex $pNo2 / $pAll2 장"
#   🔴 색인 지킴 명단 위반 = 11-19 사고의 재발. 명단에 있는 페이지가 noindex 면 실패
foreach($kf in @(@{f='p_keep_index.txt'; d='p'}, @{f='gg_keep_index.txt'; d='gg'})){
  $kp = Join-Path $PSScriptRoot $kf.f
  if(-not (Test-Path $kp)){ continue }
  $bad = 0
  foreach($ln in [IO.File]::ReadAllLines($kp)){
    $ln = $ln.Trim(); if(-not $ln -or $ln.StartsWith('#')){ continue }
    $fp2 = Join-Path $root "$($kf.d)/$ln"
    if((Test-Path -LiteralPath $fp2) -and ([IO.File]::ReadAllText($fp2) -match '<meta name="robots" content="[^"]*noindex')){ $bad++; if($bad -le 3){ Bad "색인 지킴 명단인데 noindex: $($kf.d)/$ln" } }
  }
  Write-Output "$($kf.f) 위반: $bad"
}
```

### 4-4. `공구제품.html` 이 noindex `p/` 로 링크하지 않게

`build.ps1` 1743행이 **모든 `p/` 3,287장을 한 페이지에 링크**한다. 휴면 `p/` 를 noindex 로 내리면서 허브가 계속 링크하면 발견 압력이 그대로다.

```powershell
# 지금 (1743행)
foreach($p in ($prodList | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='key';Descending=$false})){ $lk += "<a href=${Q}/p/$(Enc $p.slug).html${Q}>$(HtmlEsc $p.key)</a>" }
# 바꿀 것 — 휴면(noindex) 제외
foreach($p in ($prodList | Where-Object { -not $pNoIdx.Contains("$($p.slug).html") } | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='key';Descending=$false})){ $lk += "<a href=${Q}/p/$(Enc $p.slug).html${Q}>$(HtmlEsc $p.key)</a>" }
```

`공구제품.html` 의 제목·설명에 들어가는 개수도 같은 수로 맞춘다(1744~1747행 `$($prodList.Count)` → 색인 대상 수). **개수를 손으로 고치지 말고 변수로 넘긴다.**

### 4-5. `seo-daily.yml` — 명단 갱신 단계 추가

42~49행 `gg 색인 지킴 명단` 단계 **아래**에 같은 꼴로 추가:

```yaml
      - name: p 색인 지킴 명단
        continue-on-error: true
        run: node tools/seo/p_keep_index.mjs
        env:
          GSC_CLIENT_ID: ${{ secrets.GSC_CLIENT_ID }}
          GSC_CLIENT_SECRET: ${{ secrets.GSC_CLIENT_SECRET }}
          GSC_REFRESH_TOKEN: ${{ secrets.GSC_REFRESH_TOKEN }}
```

그리고 `build.ps1` 2111행 근처 `$genRoot` 에 한 줄 추가(자동 커밋 대상):

```powershell
[void]$genRoot.Add('tools/seo/p_keep_index.txt')
```

### 4-6. 첫 실행 안전장치 · 단계 적용 · 되돌리기

- **첫 실행(dry_run)에서 `p 계층` 줄의 휴면 수를 먼저 본다.**
  - 휴면 **≤ 800장** → 그대로 적용.
  - 휴면 **> 800장** → `$pCut` 을 `-90` → `-60` 으로 좁혀 다시 빌드(첫 주에 3,000장을 한꺼번에 내리지 않는다). 좁힌 값과 이유를 보고에 적는다.
- 2주차에 `-90` 으로 되돌려 넓힌다(별도 커밋). 단계 적용 기록을 커밋 메시지에 남긴다.
- 되돌리기: `$pCut` 을 `-3650` 으로 두고 한 번 빌드하면 전부 색인으로 돌아온다(파일은 지우지 않으므로 404 가 없다). `verify.ps1` 의 p 상한도 그대로 통과한다.
- **`할 일`**: `p/` 에서 noindex 가 붙는 것은 **삭제가 아니다.** 페이지는 200 으로 남고 canonical·내부링크도 그대로다.

---

## 5. [P0] C. 6대 키워드 3위 이내 전략

전제: 구글 순위는 우리가 직접 정할 수 없다. 우리가 정할 수 있는 것은 **① 어느 URL 이 어느 검색어를 노리는가 ② 그 URL 의 최신성·구조 ③ 색인 상태 ④ 내부링크의 방향** 넷이다. 이 넷을 측정값으로 확정하는 것이 이 절이다. **측정 없이 제목을 고치지 않는다.**

### 5-1. 먼저 측정 (이 표를 채우기 전에는 §5-3 을 시작하지 말 것)

**(a) 6대 키워드 — 구글이 어느 URL 을 띄우는가**

```
node tools/seo/rank_weekly.mjs --dry
```

출력의 `잡힌 쪽` 값을 그대로 옮겨 적는다(이 스크립트는 28일 창·붙여쓰기/띄어쓰기 묶음으로 이미 재도록 되어 있다 — `rank_weekly.mjs` 73~77·107행).

| 키워드 | 노린 쪽(`TARGETS.page`) | **잡힌 쪽(실측)** | 현재 순위 | 노출 |
| --- | --- | --- | --- | --- |
| 공구일정사이트 | `/공구일정사이트.html` |  |  |  |
| 인스타 공구 사이트 | `/인스타공구사이트.html` |  |  |  |
| 공구모음사이트 | `/공구모음사이트.html` |  |  |  |
| 공동구매 사이트 | `/공동구매사이트.html` |  |  |  |
| 공동구매하는곳 | `/공동구매하는곳.html` |  |  |  |
| 인스타공구모음 | `/인스타공구모음.html` |  |  |  |

**(b) 페이지 단위 리포트 — `tools/seo/gsc_pages.mjs` 신설 (작다)**

`rank_weekly.mjs` 의 토큰 갱신부(84~85행)와 `SITE` 상수를 그대로 쓰고, 아래만 한다.

- 질의: `dimensions: ['page']`, 기간 **최근 28일**(끝은 3일 전), `rowLimit: 25000`, `startRow` 페이지네이션.
- 출력: `tools/seo/gsc_pages.json`(저장만, **커밋하지 않는다**) + 콘솔 표 3개
  - ① **잡음**: 노출 ≥ 20 이고 평균순위 > 30 인 페이지 상위 30개
  - ② **자산**: 노출 ≥ 5 이고 평균순위 ≤ 10 인 페이지 상위 30개
  - ③ **합계**: 사이트 전체 클릭·노출·평균순위(28일)
- 열쇠가 없으면 gg 판처럼 `기존 파일 그대로 두고 끝난다`.

이 리포트는 §5-7(잡음 페이지)과 §5-2(대표 확정)의 근거다. **GSC 열쇠는 PC 의 `tools/daily/.env` 에 있으니 클코가 직접 돌릴 수 있다.**

### 5-2. 대표 URL 결정 규칙 (측정값 → 행동)

| 5-1(a) 의 `잡힌 쪽` | 대표 URL | 그때 할 일 |
| --- | --- | --- |
| 노린 대표 허브 (예: `/공구일정사이트.html`) | 그 허브 | 내부링크 앵커를 그 허브로 몰고(§5-4), **홈 제목에서 그 검색어를 뺀다**(§5-5). 허브 본문은 손대지 않는다 |
| 홈 `/` | **홈** | 홈이 대표다. 대표 허브의 제목·H1 을 「심화형 의도」로 바꿔 겹침을 줄인다(예: `공구일정사이트 — 오늘 오픈·오늘 마감만 날짜별로`). 허브 → 홈 맥락 링크 1개만 남긴다 |
| 다른 허브 (예: `/공구사이트.html`) | **그 허브를 대표로 승격** | `TARGETS.page` 를 그 파일로 고치고(rank_weekly 24~31행), `keywords.json` 에서 원래 대표였던 페이지의 제목·H1 을 다른 의도로 바꾼다. `$KW_FOOT` 앵커도 승격 페이지로 |
| 노출 없음(`null`) | 노린 대표 허브(기본값) | 대표 허브에 최신성·내부링크를 보강하고 **4주 뒤 재측정**. 없는 노출을 만들어내지 않는다 |

### 5-3. 대표 허브 6장 — 고정할 것 / 바꿀 것

**고정(손대지 않는다)**: 각 페이지의 `show` 블록이 이미 서로 다르다 — 이게 복제 페이지가 아니라는 증거다.

| 대표 | 지금 제목 | show 블록(고유) | FAQ |
| --- | --- | --- | --- |
| `/공구일정사이트.html` | 공구일정사이트 맘캘린더 \| 오늘 오픈·마감 공구 일정 사이트 | week · top20soon · soonbrands · **month** | 5 |
| `/인스타공구사이트.html` | 인스타 공구 사이트 맘캘린더 \| 인스타공구사이트 일정 `__TOTAL__`건 | **newlive · top20new · newbrands** · cat | 5 |
| `/공구모음사이트.html` | 공구모음사이트 맘캘린더 \| 인스타 공구 모음 사이트 `__TOTAL__`건 | **bycat · top20 · livebrands** | 4 |
| `/공동구매사이트.html` | 공동구매 사이트 맘캘린더 \| 오늘 열린 공동구매사이트 일정 `__LIVE__`건 | **endsoon · top20end · endbrands** | 4 |
| `/공동구매하는곳.html` | 공동구매하는곳 총정리 \| 인스타·블로그·유튜브 공동구매 하는 곳 | **hubseller · top20cat** + steps 4 | 5 |
| `/인스타공구모음.html` | 인스타공구모음 \| 오늘 오픈·마감 인스타 공구 모음 | **hubseller · top20live · prod** | 4 |

**바꿀 것 — §5-2 규칙이 시킬 때만, `keywords.json` 에서만** (생성 페이지라 HTML 을 직접 고치면 다음 05:10 빌드에 덮인다):

- 지킬 규칙: ① 제목 앞 15자 안에 대표 키워드(붙여쓰기·띄어쓰기 두 꼴) ② `맘캘린더` 유지 ③ 30~34자 ④ 숫자는 `__TOTAL__`·`__LIVE__`·`__TODAY__` 만 ⑤ `desc` 첫 문장에 대표 키워드 + 「무료·가입 없이」 중 하나.
- 이미 되어 있는 것: 여섯 장 모두 제목 앞부분에 대표 키워드가 있다. **그래서 이 단계는 대개 「홈과 겹치는 키워드」만 건드리는 소규모 수정이 된다.**

### 5-4. 내부링크 재배치 — `$KW_FOOT` 12 → 8

`lib.ps1` 261~266행(`$KW_FOOT`)은 생성 페이지 **전부**(18,000장 이상)에 허브 12개를 같은 앵커로 건다(실제 삽입은 363행). 12개는 의도가 겹치는 것이 섞여 있어 힘이 분산된다(예: `공구사이트` ↔ `공구일정사이트`, `공구하는곳` ↔ `공동구매하는곳`).

```powershell
# 지금 (12개)
@('인스타공구.html','인스타 공구'), @('인스타공구모음.html','인스타공구모음'), @('인스타공구사이트.html','인스타 공구 사이트'),
@('공구일정.html','공구 일정'), @('공구일정사이트.html','공구일정사이트'), @('공구사이트.html','공구 사이트'),
@('공구모음사이트.html','공구모음사이트'), @('공동구매사이트.html','공동구매 사이트'), @('공동구매하는곳.html','공동구매하는곳'),
@('공구하는곳.html','공구하는 곳'), @('오늘공구.html','오늘 공구'), @('인스타공구어플.html','인스타 공구 어플')

# 바꿀 것 (8개 — 대표 6 + 오늘공구·인스타 공구)
@('공구일정사이트.html','공구일정사이트'), @('인스타공구모음.html','인스타공구모음'), @('인스타공구사이트.html','인스타 공구 사이트'),
@('공구모음사이트.html','공구모음사이트'), @('공동구매사이트.html','공동구매 사이트'), @('공동구매하는곳.html','공동구매하는곳'),
@('오늘공구.html','오늘 공구'), @('인스타공구.html','인스타 공구')
```

- **§5-1(a) 결과가 「홈이 대표」인 키워드가 있으면 그 허브는 목록에서 빼고 7개로 만든다**(대표가 아닌 페이지에 앵커를 몰면 그 페이지가 홈과 경쟁한다).
- 뺀 페이지(`공구사이트.html`·`공구일정.html`·`인스타공구어플.html`·`공구하는곳.html` 등)는 **삭제·noindex 하지 않는다.** 사이트맵·홈 링크(10211~10237행)에 그대로 두고, 본문 의도만 `keywords.json` 에서 차별화한다.
- `$KW_FOOT` 를 줄이면 「고아 페이지」 검사(verify.ps1 113~137행)는 사이트맵 기준이라 영향 없다.

### 5-5. 홈 온페이지 — `index.html` 세 줄만

| 줄 | 지금 | 바꿀 것 | 왜 |
| --- | --- | --- | --- |
| 68행 canonical | `https://momcalendar.com` | `https://momcalendar.com/` | `sitemap-main.xml` 첫 `<loc>` 이 `https://momcalendar.com/`(슬래시 있음)이다. 같은 URL 의 두 표기를 없앤다 |
| 64행 `<title>` | `맘캘린더 — 인스타 공구 모음 · 공구 일정 사이트 \| 오늘 오픈 공구일정` | §5-2 결과에 따라 **겹치는 검색어만** 뺀다. 예(홈이 두 키워드의 대표가 **아닐** 때): `맘캘린더 — 인스타 공구 일정 \| 오늘 오픈·마감 공구 한눈에` | 홈 제목이 `공구 일정 사이트`·`인스타 공구 모음` 을 그대로 담고 있어 대표 허브 2장과 **같은 검색어를 두고 경쟁**한다 |
| 65행 `description` | `오늘 오픈·마감하는 인스타 공구일정을 한곳에서…` | 제목에서 뺀 검색어를 설명에서도 뺀다. 브랜드+주제+혜택 구조 유지 | 같은 이유 |

- **브랜드 `맘캘린더` 는 제목 맨 앞에 남긴다**(브랜드 검색 CTR 88% — `test.html` 62행 주석의 실측).
- 이 세 줄은 **라이브 파일 수정**이다. 커밋 A 와 섞지 말고 **단독 커밋(E)** 으로 올리고, 올린 직후 `tools/live_verify.sh` 와 `curl -s https://momcalendar.com/ | grep -o '<link rel="canonical"[^>]*>'` 로 확인한다.
- `home_guard.mjs` 는 표식(`<!--seo-today-->`) **밖**이 HEAD 와 같은지만 본다(20행). 커밋으로 HEAD 가 바뀌면 이후 자동 커밋은 정상 통과한다.

### 5-6. 비대표 허브 차별화 — 실측이 시킬 때만

지금 25장이 같은 클러스터에 있다(제목 실측):

| 파일 | 지금 H1 | 겹침 위험 |
| --- | --- | --- |
| `공구사이트.html` | 공구 사이트 | `공구일정사이트` 와 「사이트」 의도 중복 |
| `공구일정.html` | 공구 일정 (인스타 공구 일정) | `공구일정사이트` 와 중복 |
| `인스타공구.html` | 인스타 공구 | `인스타공구모음`·`인스타공구사이트` 와 중복 |
| `공동구매일정.html` | 공동구매 일정 | `공동구매사이트`·`공동구매하는곳` 과 중복 |
| `공구하는곳.html` | 공구하는 곳 (공구하는곳) | `공동구매하는곳` 과 중복 |
| `공구찾는법.html` / `공구찾는방법.html` | 공구 찾는 법 / 공구 찾는 방법 | 서로 중복(같은 파일이 두 검색어를 노림) |

- **하는 일**: §5-1(b) ①(잡음) 또는 ②(자산)에 이 파일들이 나오면, 그 페이지만 `keywords.json` 에서 **의도를 하나로 좁힌다**(예: `공구일정.html` → 「공구 일정 달력·날짜별」, `공구사이트.html` → 「공구 사이트 고르는 기준」). 나오지 않으면 **아무것도 하지 않는다** — 지금 잘 되고 있는 페이지를 건드려 순위를 잃는 것이 가장 흔한 사고다.
- 두 파일(`공구찾는법`/`공구찾는방법`)이 같은 의도인 것은 사실이므로, 둘 중 하나만 §5-1 결과에서 잡힌 쪽을 남기고 다른 쪽 제목을 「찾는 순서·체크리스트」로 바꾼다.

### 5-7. 잡음 페이지 정리 (측정 기반, 최대 100장)

- `gsc_pages.json` ①(노출 ≥ 20 · 순위 > 30) 상위 **100장까지만** 손댄다.
- 페이지 종류별 처방:
  - 생성 페이지(`g/`·`p/`·`gg/`·`m/`·`d/`·`c/`) → **`p/` 는 §4 계층이 처리**하고, 나머지는 손대지 않는다(빌드가 매일 다시 만든다).
  - 루트 질문·허브 페이지(`핫딜*`·`세일*`·`라방*`·`*핫딜*`) → 그 페이지가 노리는 검색어가 **실제로 있는지** `tools/seo/kw_volume.json` 으로 확인하고, 없으면 `keywords.json` 의 `show` 를 줄여 내용을 알차게 만든다(noindex 는 마지막 수단).
  - 그래도 100장을 넘으면 **넘은 것은 보고만 하고 하지 않는다.**
- 이 단계는 `gsc_pages.json` 이 없으면 **건너뛴다**(보고에 「건너뜀 — GSC 열쇠 없음」).

### 5-8. 측정·경보 — 대표 URL 이 바뀌면 그날 알게 한다

`rank_weekly.mjs` 122~125행은 「떨어졌을 때」만 알린다. **대표가 아닌 URL 이 잡히는 것**도 같이 알린다(§5-2 가 흔들리면 3위 전략 전체가 흔들린다).

```javascript
// 122행 if (drops.length) { ... } 바로 앞에 추가
const wrong = rows.filter((r) => r.now && r.now.page !== r.want && r.now.page !== '/' && r.now.imp >= 3)
  .map((r) => `${r.key}: 노린 쪽 ${r.want} 인데 잡힌 쪽 ${r.now.page} (${r.now.imp}회 노출)`);
if (wrong.length) {
  await alertSet('seo:대표URL', `대표 URL 불일치(${ymd(end)} 주): ${wrong.join(' / ')}. 허브 제목·첫 문단·내부링크 앵커가 노린 쪽을 가리키는지 보고, 아니면 대표를 잡힌 쪽으로 바꾼다(오더 §5-2)`);
} else { await alertSet('seo:대표URL', ''); }
```

- 경보는 관리자 홈 「고장 난 것」에 뜬다(`health_alerts` kind `seo:대표URL`).
- 6대 키워드가 전부 `노출 없음` 이면 경보를 내지 않는다(표본 0으로 소란 피우지 않는다).

### 5-9. 목표와 판정

| 시점 | 6대 키워드 평균순위 | 사이트 전체 평균순위 | 판정 방법 |
| --- | --- | --- | --- |
| 지금 | 미확인(§5-1 에서 채운다) | 8.7(7일) | — |
| 4주 뒤 | ≤ 6.0 | ≤ 7.5 | `rank_weekly` 28일 창 |
| 8주 뒤 | ≤ 4.5 | ≤ 6.0 | 같음 |
| 12주 뒤 | **≤ 3.0(길아 님 지시)** | ≤ 5.0 | 같음 |

- 주간 값은 표본이 작아(노출 수십) **4주 이동평균으로 판정**한다. 한 주 반등·하락으로 제목을 다시 고치지 않는다.
- 12주 안에 3.0 에 못 들어가면 그때는 온페이지가 아니라 **외부 신호(§7-3)** 와 **경쟁사 대비 콘텐츠 분량**을 다시 본다. 이 오더는 그 판단에 필요한 측정을 남기는 것까지 한다.

---

## 6. [P1] D. 첫 화면 용량 — 측정 먼저, 그다음 최소 변경

### 6-1. 먼저 재현하라 (여기서 갈린다)

`daily/_alert.txt` 는 「`kb 2647` > `2631.6`」이라고만 적는다. 06:50 스캔의 `#hotdealList` 688KB·4,862노드는 **4탭을 눌러 본 뒤의 DOM**일 수 있다(코드상 `loadHotdeals()` 는 `switchContent('hotdeal')` 에서만 불린다 — `index.html` 4541행. 기본 탭은 `gonggu` 6331행). 숨겨진 탭의 노드는 지워지지 않고 남기 때문이다.

측정 절차(클코):
1. 캐시·세션을 지운 새 창(시크릿)으로 `https://momcalendar.com/` 를 열고 **아무 탭도 누르지 않은 상태**에서
   `document.querySelectorAll('#hotdealList *').length` 와 `document.getElementById('hotdealList').innerHTML.length` 를 잰다.
2. 이어서 「핫딜」 탭을 누른 뒤 같은 값을 다시 잰다.
3. 두 값이 **다르면**(콜드 로드에서 0에 가깝다면) → **`#hotdealList` 는 첫 화면 용량의 원인이 아니다.** 이 항목은 손대지 말고, 잰 값 3개(콜드 노드 수·탭 후 노드 수·문서 전체 바이트)를 보고에 적는다.
4. 콜드 로드에서도 4,000노드 이상이면 → 아래 6-2 를 적용한다.

### 6-2. 재현될 때만 — 지연 렌더 가드

`renderHotdeals()`(5164행) 첫 줄에 숨은 탭 가드를 넣고, 탭이 열릴 때 다시 그린다(이미 4541행이 부른다):

```javascript
function renderHotdeals(){
  const el=document.getElementById('hotdealList');
  const hv=document.getElementById('hotdealView');
  if(hv && hv.style.display==='none') return;   // 2026-11-23: 숨은 탭은 그리지 않는다 (첫 화면 DOM 절감)
  ...
```

- 인피드 광고 갱신 쪽 두 곳(1792행 `#hotdealList .mc-infeed-kidsnote` 조건, 1811행 `setInfeedMode`)은 이미 「그려져 있으면 다시」 조건이라 그대로 둔다.
- **하지 말 것**: 핫딜 데이터 요청 자체를 없애지 않는다(탭을 열면 즉시 보여야 한다). 무한스크롤·가상스크롤 도입도 이번엔 하지 않는다(라이브 JS 대수술은 11-22 사고 뒤에 맞지 않는다).
- 적용 뒤 1번 절차로 다시 재서 **문서 전체 바이트가 2,631.6KB 아래**인지 확인한다. 측정 스크립트는 PC 로컬 `tools/daily/perf_probe.mjs` 다(`Select-String -Path tools/daily/*.mjs -Pattern '2631'` 로 찾아 같은 값으로 잰다).

---

## 7. [P0] E. 사람 몫 (클코가 못 한다 — 길아 님/자비스가 한다)

### 7-1. 서치콘솔 (하루 1회, 10분)

- [ ] 「삭제」 → 임시 삭제 요청 3건: `/test.html` · `/test-app.html` · `/kktest.html`
- [ ] 대표 허브 6 + 홈 `/` 에 URL 검사 → 「색인 생성 요청」 7건
- [ ] 「페이지 색인 생성」 리포트에서 `p/` 의 「NOINDEX 태그에 의해 제외」 수가 **늘었는지** 확인(§4 적용 후 2~3일 뒤)
- [ ] 6대 키워드의 현재 순위를 캡처해 §5-1(a) 표를 채운다(자비스가 대신 채워도 된다 — GSC API 로 뽑힌다)

### 7-2. Cloudflare (선택)

- [ ] Transform Rule: host = `momcalendar.com`, path in (`/test.html`, `/test-app.html`, `/kktest.html`) → `X-Robots-Tag: noindex, nofollow` 응답 헤더 추가. **접근 권한이 없으면 건너뛴다.**

### 7-3. 외부 신호 (주 1회, 30분 — 3위 벽은 온페이지만으로 안 뚫린다)

- [ ] 네이버 블로그 글 1편에 대표 허브 2개 딥링크 + `맘캘린더` 브랜드명 본문 언급
- [ ] 맘카페(가입된 곳) 댓글·정보글에 `공구일정사이트` 맥락 링크 1회
- [ ] 인스타 `@momcal_official` 프로필 링크·게시물에 대표 허브 링크(리틀리 대신 직접 URL 1개)
- [ ] 앱 스토어 설명·스크린샷에 `공구일정사이트` 문구가 있는지 확인

---

## 8. 검증 체크리스트 (V1~V16 — 실제로 돌리고 표로 보고)

| # | 검증 | 방법 | 합격 기준 |
| --- | --- | --- | --- |
| V1 | 게이트 동작 | 라이브(또는 로컬 서버)에서 `/test.html` 열기 | 주소가 `/` 로 바뀐다. GA4 요청 0건 |
| V2 | 미리보기 통과 | `/test.html?preview=1` | 그대로 열리고, 같은 탭에서 새로고침해도 열린다 |
| V3 | 카톡 콜백 보존 | `/test.html?code=abc&state=k.test123` | 홈으로 튕기지 **않는다** |
| V4 | E2E·딥링크 보존 | `/test.html?e2e=1` · `?mycal=1a.2b` | 열린다 |
| V5 | 다른 테스트 페이지 | `/test-app.html` · `/kktest.html` (파라미터 없이) | 둘 다 홈으로. `kktest.html` 소스에 `noindex` 메타 있음 |
| V6 | 크롤러 동일 응답 | `curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" -s https://momcalendar.com/test.html \| grep -c 'noindex'` | **1 이상**(UA 로 갈라치기 없음 — 같은 HTML). 게이트 스크립트에 `Googlebot`·`Yeti` 문자열 **0건** |
| V7 | HTTP 상태 | `curl -o /dev/null -w '%{http_code}' https://momcalendar.com/test.html` · `sh tools/live_verify.sh` | **200**(301/302 아님) · live_verify 통과 |
| V8 | robots.txt | `curl -s https://momcalendar.com/robots.txt` | `Disallow: /test.html`·`/kktest.html`·`/test-app.html` **0줄**, `Disallow: /admin.html` 있음, `Sitemap:` 있음 |
| V9 | 역검증 | `pwsh tools/seo/verify.ps1` | `=== 통과: 문제 없음` |
| V10 | GA4 제거 | `grep -c 'G-NRCP2FVRSB' test.html test-app.html` | 둘 다 **0** |
| V11 | p 명단 | `node tools/seo/p_keep_index.mjs` | `✅ p 색인 지킴 명단 N줄` (N ≥ 30). 실패하면 기존 파일 유지 |
| V12 | p 계층 | `seo-daily` `dry_run=true` 실행 | 출력에 `p 계층: 색인 N · 휴면(noindex) M` · `sitemap: ... product P` (P = N) · 에러 0 |
| V13 | p 색인 보존 | `p_keep_index.txt` 의 표본 5장 grep | 5장 모두 `index,follow` (noindex **0장**) |
| V14 | 공구제품 허브 | `공구제품.html` grep `<a href="/p/` | 개수 = p 색인 수. 휴면 p 슬러그 1개를 grep 해 **0건** |
| V15 | 6대 키워드 실측 | `node tools/seo/rank_weekly.mjs --dry` | 6줄 출력. §5-1(a) 표를 채워 보고에 붙인다(순위 자체는 합격 기준이 아니다) |
| V16 | 라이브 파일 범위 | `git log --stat` (A~E 커밋) | 바뀐 라이브 파일 = `test.html`·`test-app.html`·`kktest.html`·`admin.html`·`bannerlive.html`·`index.html` **6개뿐**. `staff.html`·`register.html`·`reelcard.html` 변경 0 |

추가(V17, §6-1 을 했을 때만): 콜드 로드 `#hotdealList` 노드 수 · 탭 후 노드 수 · 문서 전체 바이트 3개를 그대로 적는다.

---

## 9. 커밋 나누기 (한 커밋에 섞지 말 것)

| 커밋 | 내용 | 라이브 위험 |
| --- | --- | --- |
| **A. 테스트 차단** | `test.html`·`test-app.html`·`kktest.html`(게이트·noindex·GA4 제거) · `admin.html` 1줄 · `bannerlive.html` 3줄 · `tools/seo/build.ps1`(robots 두 줄 제거) · `tools/seo/verify.ps1`(로봇 검사 교체) | 낮음. 단 A 푸시 직후 라이브에서 V1~V10 을 **실제로** 확인 |
| **B. p 3계층** | `tools/seo/p_keep_index.mjs` 신설 · `tools/seo/p_keep_index.txt`(첫 실행본) · `tools/seo/build.ps1`(명단·계층·사이트맵·공구제품 링크) · `tools/seo/verify.ps1`(p 상한·명단 위반) · `.github/workflows/seo-daily.yml`(명단 단계) | 중간. 첫 실행은 `dry_run=true` 로 수치만 |
| **C. 대표 허브·내부링크** | `tools/seo/keywords.json`(측정이 시킨 페이지만) · `tools/seo/lib.ps1`(`$KW_FOOT`) · `tools/seo/rank_weekly.mjs`(대표 URL 경보) | 낮음 |
| **D. 성능** | `index.html` `renderHotdeals` 가드 (§6-1 재현 시에만) | 중간. 단독 커밋·단독 확인 |
| **E. 홈 온페이지** | `index.html` 제목·설명·canonical 세 줄 | 중간. 커밋 직후 `live_verify.sh` + canonical grep |

- 생성 페이지(`g/`·`p/`·`gg/`·사이트맵)는 **커밋하지 않는다.** 다음 05:10 `seo-daily` 가 만든다.
- B 는 `dry_run=true` 로 한 번, 실제 반영은 그 다음 정규 실행에서.

---

## 10. 보고 형식

- 커밋 해시 5개(A~E) + GitHub 파일 URL(오더서·바뀐 파일)
- §8 V1~V17 표(실측값 그대로, 못 한 것은 「못 함 + 이유」)
- **A**: 게이트 3종 파라미터 목록, robots.txt 최종 내용, `verify.ps1` 통과 출력, `test.html` 로 열었을 때 실제 이동 결과
- **B**: `p 계층: 색인 N · 휴면 M` 숫자, `p_keep_index.txt` 줄 수, 사이트맵 product 전후(3,287 → ?), 단계 적용 여부(90일/60일)
- **C**: §5-1(a) 표(잡힌 쪽·순위), §5-2 에서 내린 결정과 근거, 바꾼 `keywords.json` 항목 목록, `$KW_FOOT` 최종 개수
- **D**: V17 세 수치와 「재현됨/안 됨」 판정
- **E**: 라이브 canonical·제목 grep 결과
- 지시서와 다르게 한 것 / 못 한 것 / **사람이 해야 하는 것**(§7 체크리스트 중 남은 것)

---

## 11. 배포 순서와 시점

1. **A 를 먼저 단독으로** 올리고 10분 뒤 V1~V10 확인. 이상하면 A 만 `git revert`(파일 삭제가 없으니 안전).
2. A 확인 후 **B 를 `dry_run=true`** 로 한 번 → 수치 확인 → 정규 실행.
3. **C** 는 §5-1 측정이 끝난 뒤. 측정을 못 했으면 C 를 보류하고 그 사실을 보고(측정 없이 제목을 고치지 않는다).
4. **E** 는 A 와 같은 날(색인 제거는 빨리 시작할수록 좋다). **D** 는 6-1 재현 여부에 따라.
5. 서치콘솔 색인 변화는 **3~7일** 걸린다. 11-26(목)·11-30(월)에 `rank_weekly` 와 색인 리포트를 다시 본다.

---

## 부록 1. 선행·연계 오더와의 경계 (겹치지 않게)

| 문서 | 다루는 것 | 이번 오더와의 관계 |
| --- | --- | --- |
| `orders/ORDER_SEO_AEO_GEO_RECOVERY.md` (11-16) | `gg/` 3계층 · Thin Content · GA4 전 페이지 · 스키마 | **선행.** §4 는 그 §4(gg 계층)를 `p/` 에 복제하는 것. gg 규칙은 건드리지 않는다 |
| `orders/ORDER_GA4_SEO_HOTDEAL_ALERT_2026-11-22.md` (11-22) | 404 툼스톤 마무리 · 앱 CTA · 핫딜 대기열 · 출석 경보 | **선행.** 툼스톤·CTA 는 이미 완료로 보고 손대지 않는다. 이번 §5-7 은 404 가 아니라 「잡음 페이지」다 |
| `orders/ORDER_DEPLOY_SAFETY_GUARD_2026-11-22.md` (11-22) | 로컬 훅 · 배포 게이트 · 백업 브랜치 | **전제.** 이 오더의 모든 커밋은 그 훅·게이트를 통과해야 한다. 우회 금지 |
| `orders/ORDER_CARDNEWS_PIPELINE.md` | 인스타 카드 파이프라인 | 무관. 건드리지 않는다 |

## 부록 2. 이번에 **하지 않는** 것 (다음 오더 후보)

- `admin.html` 에 `noindex` 메타 추가 — 지금은 robots `Disallow` 로만 막혀 있다(URL 만 색인될 여지). 이번엔 손대지 않고 후보로 남긴다.
- `g/` 10,585장 분량 상향(11-16 오더 「남은 것」: 중위 2,056자) — 별도 오더.
- `www.momcalendar.com` → apex 301 — 인프라(Cloudflare) 작업.
- 핫딜 리스트 무한스크롤·가상스크롤 — 라이브 JS 대수술이라 11-22 사고 뒤에는 하지 않는다.
- `gg/` 35,608장 중 휴면 24,678장의 추가 회수(디스크가 아니라 크롤 큐 문제) — `Disallow` 로는 개별 선별이 안 되고, 삭제는 404 를 만든다. 다음 오더에서 `gg` 창(`-GgKeepDays`)으로 다룬다.
- 서치콘솔 「발견됨-미색인」 29,381건의 개별 정리 — 위 `gg`·`p` 계층이 줄이는지 2주 관찰 뒤 판단.
