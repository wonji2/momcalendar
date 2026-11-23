# ORDER — 스토어 첫 실행률 · 인앱 리뷰 · GA4 랜딩 CTA 보완 (검색 방어 마감 포함)

작성 2026-11-23 (월) 15:05 KST · 자비스 · 기준 커밋 `a68bd539`(main, 2026-11-23 14:20 KST)
대상 저장소 `wonji2/momcalendar` · 작업자 = 클로드 코드
교차검증 방장(@bangjang7) 비서 냠이 — 11-23 1차 오더에서 냠이가 지적한 세 가지(봇 UA 분기 = 클로킹 금지 · `verify.ps1` 가드 충돌 조정 필수 · 대표 URL 은 실측으로만)는 이번 오더에도 그대로 적용된다.

이 오더는 길아 님 지시(2026-11-23 「잘 되고 있는 건 건드리지 말고, 안 되는 부분만 순위 하락 없이 끌어올려」)를 실행 문서로 묶은 **2차 보완**이다.
**§1-2「이미 되어 있는 것」표를 먼저 읽어라. 이번 브리프의 3대 과제 중 상당 부분이 오늘 오전에 이미 코드로 들어가 있다. 그걸 다시 만들면 이번 주 빌드가 두 번 돌고, 잘 되고 있는 것을 건드려 순위를 잃는다.**

---

## 실행 명령 (길아 님이 클로드 코드에 붙여넣는 1줄)

```
claude "orders/ORDER_STORE_SEO_CONVERSION_2026-11-23.md 끝까지 읽고 §1 표로 지금 상태부터 대조해. §3(검색 방어)은 확인만 하고 파일을 한 줄도 건드리지 마. §4-2 판정 규칙에 따라 앱 진단부터 돌리고, §5-2(스토어 판 플러그인 확인)와 §6-2·6-3·6-4 만 구현해. §8 검증 V1~V16 실제로 돌려 표로 보고, 커밋은 A~D로 나눠. index.html·스토어 제목·스크린샷·스토어 키워드는 손대지 말고, 스토어 업로드·재심사는 절대 하지 마"
```

레포 루트(`wonji2/momcalendar` 체크아웃, `C:/Users/FAMILY/...`)에서 실행한다.
PowerShell 스크립트(`.ps1`)는 **UTF-8 BOM** 으로 저장한다(한글 리터럴 때문에 BOM 없이 저장하면 깨진다 — 저장소 기존 규칙).
`.githooks`(1중 방어)와 `deploy-pages` 게이트(2중 방어)는 그대로 둔다 — `--no-verify` 금지.

---

## 0. 한 줄 요약

| # | 할 일 | 한 줄 | 우선 | 누가 |
| --- | --- | --- | --- | --- |
| A | **검색 방어 마감** | GSC 「삭제」 3건은 **오늘 11-23 이미 접수됨(요청 처리 중)** — 재접수 금지, 11/26·11/30 판정 규칙만 문서화. 테스트 3종 게이트·`noindex`·GA4 제거·robots 해제는 오늘 오전 커밋으로 완료 → **손대지 않고 회귀 검사만** | P0(확인) | 클코 |
| B | **첫 실행률 52.7% 진단** | 설치는 818대인데 처음 실행이 431대. ①크래시 ②GA4 앱 세션 ③설치→미실행 중 어느 겹인지 **먼저 가른다**(§4-2 판정표). 원인이 앱 쪽일 때만 네이티브 계측(설치 리퍼러·첫 실행 비콘) 추가 | P0(진단) / P1(계측) | 클코 |
| C | **인앱 리뷰** | **이미 구현돼 있다**(11-19 00:29 KST 커밋 `3602460`). 남은 것은 ① 스토어에 실린 바이너리에 플러그인이 들어갔는지 확인 ② 다음 정기 업데이트에 싣기 ③ 상세 설명 문구 1~2줄 | P0(확인) / P1(배포) | 클코 + 사장님 |
| D | **GA4 랜딩 CTA 보완** | CTA는 11-22에 `WritePage` 한 곳으로 이미 전 페이지에 들어갔다. 남은 구멍 3개만 막는다 — ① 보존 페이지 누락(표본 39장 중 2장 = 약 5%) ② OS 구분·페이지 차원 없는 이벤트 ③ 긴 목록 허브 하단 CTA | P1 | 클코 |
| E | **사람 몫** | 주간 외부 신호 체크리스트에 「홈 + 세일정보 + 핫딜정보 + 대표 `/g/`」 넣기 · 스토어 문구 입력 · 다음 빌드 업로드 · 11/26·11/30 GSC 판정 | P0(사람) | 사장님 · 자비스 |

---

## 1. 지금 상태 — 착수 전에 이 표부터 실제 파일과 대조하라 (2026-11-23 13:30~14:30 KST 실측)

### 1-1. 실측값

| 항목 | 실측 | 판정 |
| --- | --- | --- |
| `robots.txt` (라이브·저장소 동일) | `User-agent: *`·`Yeti` 두 블록 모두 `Allow: /` + `Disallow: /admin.html` `/staff.html` `/register.html` `/rest/` `/functions/` — **`/test.html`·`/kktest.html` 차단 없음** | 오늘 11:30 KST 커밋 `e24f710`(A) 반영 완료. §3-4 참고 |
| `robots.txt` 생성기 | `build.ps1` **1975행** `$blockRules` — 두 블록이 이 한 줄을 함께 쓴다 | 손으로 고치면 다음 05:10 빌드에 덮인다. **이번엔 고칠 것이 없다** |
| `test.html` (1,082,414B) | 5행 접근 게이트(`mc_test_ok`) · 67행 `noindex, nofollow, noai, noimageai` · `G-NRCP2FVRSB` **0회** | 완료 |
| `test-app.html` (768,366B) | 8행 게이트 · 12행 `noindex, nofollow` · GA4 **0회** | 완료 |
| `kktest.html` (12,028B) | 5행 게이트(`OK=['code','state','error','e2e','kktest','flowtest']`) · 18행 `noindex, nofollow` · GA4 없음(원래도 없었음) | **브리프의 「noindex 누락」은 이미 해소됨** |
| `verify.ps1` | 205~210행이 테스트 3종에 대해 (a) robots 에 Disallow 있으면 실패 (b) `noindex` 없으면 실패 (c) `mc_test_ok` 게이트 없으면 실패 (d) `G-NRCP2FVRSB` 남아 있으면 실패 | 되돌아오는 것을 막는 장치가 이미 있다 |
| Google Search Console → 색인 생성 → **삭제** | **3건 접수됨**: `https://momcalendar.com/kktest.html` · `/test-app.html` · `/test.html`, 유형 「일시적으로 URL 삭제」, 요청일 **2026. 11. 23.**, 상태 **「요청 처리 중」** | **사람 몫 완료.** 재접수는 중복이고 무의미하다 |
| 앱 전환 CTA (`class="appcta"`) | `build.ps1` **426~446행**이 만들고, `lib.ps1` **330~331행**이 생성 페이지 `<div class="wrap">` 바로 아래에 넣는다. `세일정보.html`·`핫딜정보.html` 라이브에서 확인(`appcta` 1개, `seo_app_cta` 2회) | 11-22 오더 ② 완료 |
| `/g/` 10,561장 CTA 커버리지 | `sitemap-brand.xml`에서 700장 간격 표본 **39장** 중 **2장 CTA 없음**(`g/방수.html`·`g/런칭특가.html`) ≈ **5%**. `g/00PM.html`(dateModified 2026-10-01, 보존 페이지)은 CTA 0 | **보존(재생성 안 되는) 페이지가 구멍** → §6-2 |
| CTA 이벤트 | `gtag('event','seo_app_cta',{place:'seo_ios'})` / `{place:'seo_and'}` — **페이지 차원 없음**, 두 스토어 버튼이 **항상 둘 다** 보인다 | §6-3 |
| 앱 CTA 위치 | 생성 페이지 전부 **헤더 바로 아래 1곳**. `핫딜정보.html`(35,288B)·`세일정보.html`(19,487B)는 목록이 길다 | §6-4(하단 1개 추가) |
| 인앱 리뷰 | `index.html` **10962~11045행** `mcReviewMaybe` — 앱에서만 · 찜 3개째(`wish3`)·키워드 알림 등록 직후(`kw_add`) · **90일 쿨다운 · 기기당 3회 · 세션 1회** · 시트가 떠 있으면 건너뜀 · `MC_REVIEW_ON=false` 킬스위치 | **브리프의 (b)는 이미 구현됨** |
| 리뷰 플러그인 | `android-app/cap/package.json` `@capacitor-community/in-app-review: 8.0.0` · `ios-app/package.json` `6.0.0` — **둘 다 11-19 00:29 KST 커밋 `3602460`에서 추가**(커밋 메시지 「앱 리뷰 플러그인 의존성(스토어 제출 전)」) | **플러그인은 저장소에 있고, 스토어 바이너리에 들어갔는지는 별개** → §5-2 |
| Android 스토어 판 | Play 목록 「업데이트 날짜 **2026. 11. 5.**」 · 제목 `맘캘린더 - 인스타 공구 일정 공동구매 핫딜 알림` · 설명에 `공구일정`·`공동구매`·`공구모음`·`핫딜` 이미 다수, **`공구일정사이트` 없음** | 11-18 플러그인 추가 **이전** 빌드로 보인다(추론 — §5-2에서 확인) |
| iOS 스토어 판 | 버전 **1.0.2**, 릴리스 **2026-11-18 20:38 UTC**, 평점 **0건** | 11-18 15:29 UTC 커밋 뒤 빌드라면 플러그인 포함 가능(확인 필요) |
| iOS 앱 식별 | `ios-app/capacitor.config.json` `ios` 블록에 **`appendUserAgent` 없음** | **iOS 앱 트래픽이 Safari 와 구분되지 않는다** → §4-3 |
| Android 앱 식별 | `android-app/cap/capacitor.config.json` `android.appendUserAgent: "MomcalApp/android"` | Android 앱만 GA4에서 갈린다 |
| Android 앱 구조 | Capacitor 8.5.3 웹뷰 · `server.url=https://momcalendar.com` · 앱 링크(`autoVerify`) + `momcalendar://auth` · `CrashReporter`(events 표 `app_crash`) · 위젯 · 알림 채널 `momcal_default` | 딥링크·크래시 수집 장치는 이미 있다 |
| 설치→실행 퍼널 | Play 28일: 기기 획득 **818** · 설치 유지 **785** · 처음 실행 **431(52.7%)** · MAU **689** · 리뷰 **0** | §4 |
| 잘 되고 있는 것(건드리지 않는다) | Play 전환율 **90.99%** · App Store 쇼핑 차트 **#194** · `공구모음`·`육아 공구`·`맘카페 공구`·`공구캘린더`·`공동구매 일정` **iOS 1위** · Play `공구모음` **3위**·`공구일정` **4위** | §2-1 |

### 1-2. 이미 되어 있는 것 — **다시 하지 말 것**

| 이미 있는 것 | 위치 | 이번에 할 일 |
| --- | --- | --- |
| 테스트 3종 접근 게이트 + `noindex` + GA4 제거 + robots Disallow 해제 | `test.html` 5행 · `test-app.html` 8행 · `kktest.html` 5행, `build.ps1` 1975행 | **손대지 않는다.** §8 V1·V2로 회귀만 확인 |
| `verify.ps1` 테스트 3종 검사 | `verify.ps1` 205~210행 | 손대지 않는다 |
| 서치콘솔 「삭제」 3건 | GSC 「삭제」 탭, 2026-11-23 접수, 처리 중 | **재접수 금지.** 11/26·11/30에 상태만 확인(§3-3) |
| `p/` 3계층(휴면 noindex) + `p_keep_index.mjs` + 사이트맵 제외 | 커밋 `b99f92a`, `tools/seo/p_keep_index.mjs` | 손대지 않는다 |
| `$KW_FOOT` 12→8 · 홈 제목·canonical 정합 · 대표 URL 불일치 경보 | 커밋 `43ed9c7`·`051af52`, `lib.ps1` 261~268행 | 손대지 않는다 |
| 앱 전환 CTA 생성기 | `build.ps1` 426~446행 · `lib.ps1` 330~331행 | **문구·숫자 규칙 유지.** §6은 덧붙이기만 한다 |
| 인앱 리뷰 요청 | `index.html` 10962~11045행(11-19 00:29 KST 커밋 `3602460`) | **다시 만들지 않는다.** §5는 확인·배포·검증만 |
| 안드로이드 앱 링크·딥링크·크래시 수집 | `install_native.mjs`(앱 링크) · `CrashReporter.java` | 손대지 않는다. §4는 **읽기**만 |
| 붙임: `?kwadd=브랜드` 알림 유도(앱/웹 분기) | `index.html` 11045행 부근 | 손대지 않는다 |

---

## 2. 절대 하지 말 것 (먼저 읽어라)

1. **잘 되고 있는 것을 건드리지 않는다.**
   - 양대 스토어 **제목**(`맘캘린더 - 인스타 공구 일정 공동구매 핫딜 알림`)·**부제**·**스크린샷**·**키워드 필드** — 한 글자도 바꾸지 않는다. iOS 1위 키워드 5개와 Play 3~4위가 여기에 걸려 있다.
   - `index.html` 의 **SEO 메타·구조**(`<title>`·`description`·canonical·`h1`·구조화 데이터·`seolinks-row`) — 손대지 않는다. 이번 오더에서 `index.html` 은 **읽기만** 한다.
   - `lib.ps1` `WritePage` 의 기존 출력 순서(제목 → robots → GA4 → og → ld+json → CTA → 본문 → 하단 키워드)를 바꾸지 않는다. **덧붙이기만** 한다.
2. **스토어 제출은 하지 않는다.** 이번 오더는 바이너리를 만들고 확인할 뿐, **단독 재심사·단독 업로드를 하지 않는다**(길아 님 지시). 다음 기능 업데이트 때 함께 올린다. Play Console·App Store Connect 입력은 **사람 몫**이다.
3. **봇 UA 로 갈라치기(클로킹) 금지.** CTA 의 OS 분기는 `navigator.userAgent` 로 **버튼 표시만** 가른다. `Googlebot`·`Yeti` 문자열을 조건에 넣지 않고, 크롤러에게 다른 본문을 주지 않는다(냠이 지적, 11-23 1차 오더 §2-2).
4. **`robots.txt` 에 테스트 3종 Disallow 를 되살리지 않는다.** 이유는 §3-4. 손으로 고치지도 않는다(생성기 1975행이 덮는다).
5. **숫자를 지어내지 않는다.** CTA 문구의 숫자는 `__TOTAL__`·`__LIVE__`·`__TODAY__` 처럼 **빌드가 잰 값**만 쓴다. 보존 페이지에는 **날짜·건수가 들어간 문구를 넣지 않는다**(§6-2 의 `$AppCtaStatic`).
6. **`g/`·`s/`·`m/`·`d/`·`c/` 에 `noindex` 를 붙이지 않는다.** `p/` 계층은 이미 끝났고 이번에 손대지 않는다.
7. **커밋은 A~D 로 나눈다.** `git add -A`·`git add .` 금지(11-22 사고). `.githooks/pre-push` 가 파일 수·ancestry 를 본다.
8. **앱 코드(자바·Swift)는 라이브 사이트에 영향을 주지 않는다.** 네이티브 변경은 다음 빌드 산출물에만 실리고, 사이트 파일과 섞지 않는다(커밋 분리).

---

## 3. [P0 · 확인만] A. 검색 방어 마감 — 파일을 건드리지 않는다

### 3-1. `kktest.html` 잔여 점검 결과 (브리프 1번 항목)

브리프는 「`kktest.html` 에 게이트·`noindex`·GA4 차단이 들어갔는지 점검하고 누락 시 보강」을 요구했다. **실측 결과 셋 다 이미 들어가 있다.**

| 요구 | 실측 | 조치 |
| --- | --- | --- |
| 접근 게이트 | 5~17행, `test.html`·`test-app.html` 과 **같은 본문**(`mc_test_ok` 키 통일), `OK=['code','state','error','e2e','kktest','flowtest']` | 없음 |
| `noindex` | 18행 `<meta name="robots" content="noindex, nofollow">` | 없음 |
| GA4 | `G-NRCP2FVRSB` **0회**(원래도 없었다) | 없음 |
| robots Disallow | 해제됨 | 없음 |
| 회귀 방지 | `verify.ps1` 205~210행이 4가지를 매일 검사 | 없음 |

→ **이 절에서 클코가 할 일은 §8 V1·V2 를 돌려 표로 남기는 것뿐이다.** 파일 수정 금지.

### 3-2. GSC 「삭제」 — 이미 접수됐다 (브리프 1번 항목)

2026-11-23 14:10 KST 실측, Search Console → 색인 생성 → **삭제 → 임시 삭제 항목**:

| URL | 유형 | 요청일 | 상태 |
| --- | --- | --- | --- |
| `https://momcalendar.com/kktest.html` | 일시적으로 URL 삭제 | 2026. 11. 23. | 요청 처리 중 |
| `https://momcalendar.com/test-app.html` | 일시적으로 URL 삭제 | 2026. 11. 23. | 요청 처리 중 |
| `https://momcalendar.com/test.html` | 일시적으로 URL 삭제 | 2026. 11. 23. | 요청 처리 중 |

- **재접수하지 않는다.** 같은 URL 을 다시 요청해도 대기열만 늘고 처리일은 앞당겨지지 않는다.
- 임시 삭제는 **6개월** 유효다(2027-05-23경 만료). 그 전에 `noindex` 가 확정되면 만료 후에도 색인되지 않는다.
- 「요청 처리 중」은 접수만 된 상태다. **판정은 §3-3 의 날짜에 한다.**

### 3-3. 색인 제거 확정 판정 — 11/26 · 11/30 (브리프 1번 항목의 「재측정 연동」)

| 날짜 | 할 일 | 판정 |
| --- | --- | --- |
| **11-26 (목)** | GSC → URL 검사에 3개 주소를 하나씩 넣어 「URL이 Google에 등록되어 있음/색인 생성됨」 여부 확인. 삭제 탭에서 상태가 「삭제됨」으로 바뀌었는지도 확인 | 3건 모두 「색인 생성되지 않음」 또는 「삭제됨」 → **완료** |
| **11-30 (월)** | 주간 측정(`rank_weekly`)과 함께 재확인. GSC 「페이지」 보고서에서 「noindex 태그가 포함됨」으로 분류되는지 확인 | 3건이 「noindex」로 분류 → **완료.** 하나라도 여전히 색인 → 아래 규칙 |
| 여전히 색인일 때 | ① URL 검사 → **색인 생성 요청**(noindex 를 다시 읽히게) ② 3일 뒤 재확인 ③ 그래도 남으면 삭제 요청을 **만료 전에 갱신** | **robots Disallow 는 어떤 경우에도 넣지 않는다**(§3-4) |

- 판정 결과는 `orders/` 가 아니라 **관리자 알림 줄**(`health_alerts`)이나 보고에 한 줄로 남긴다. 새 파일을 만들지 않는다.

### 3-4. `robots.txt` Disallow 재적용 — **하지 않는다** (브리프와 다르게 판단한 지점)

브리프는 「색인 제거 확정 후 `robots.txt` Disallow 재적용 시점을 명시」하라고 했다. **재적용은 하지 않는 쪽으로 확정한다.** 근거:

1. 구글은 `Disallow` 된 URL 의 본문을 읽지 않으므로 `<meta name="robots" content="noindex">` 를 **볼 수 없다**. 그래서 막으면 「색인에서 빠지는」 게 아니라 **「URL 만 남은 색인」** 이 된다 — 11-23 오전 실측이 정확히 그 상태였고, 그래서 `e24f710` 에서 Disallow 를 뺐다.
2. 이미 `noindex` 메타 + 접근 게이트 + 삭제 요청 3중이 걸려 있다. Disallow 를 더하면 **1번 때문에 오히려 되돌아간다**.
3. 이 판단은 11-23 1차 오더 §2-4(「다시 막지 않는다」)와 같은 결론이다. 두 오더가 충돌하지 않게 여기서 못 박는다.

→ **대신 지킬 것**: `build.ps1` 1975행 `$blockRules` 에서 `/test.html`·`/kktest.html` 조각이 **다시 들어오지 않게** `verify.ps1` 206행이 매일 검사한다(이미 있음). 이번 오더는 그 검사가 살아 있는지만 확인한다(V2).

### 3-5. 회귀 확인 명령 (클코가 §8에서 그대로 실행)

```
curl -s https://momcalendar.com/robots.txt | grep -c "Disallow: /test.html"      # 0 이어야 함
curl -s https://momcalendar.com/robots.txt | grep -c "Disallow: /kktest.html"    # 0 이어야 함
curl -s https://momcalendar.com/kktest.html | grep -c 'content="noindex'         # 1 이상
curl -s https://momcalendar.com/kktest.html | grep -c "G-NRCP2FVRSB"             # 0
```

---

## 4. [P0 진단 / P1 계측] B. Play 첫 실행률 52.7% — 원인을 먼저 가른다

### 4-1. 숫자를 세 겹으로 나눠 읽는다

Play 28일 실측: 기기 획득 **818** · 설치 유지 **785** · 처음 실행 **431** · MAU **689**.

| 겹 | 계산 | 뜻 | 우리가 할 수 있는 일 |
| --- | --- | --- | --- |
| ① 설치 실패 | 818 − 785 = **33대(4.0%)** | 설치 도중 이탈·기기 미지원 | 거의 없음(정상 범위) |
| ② 설치했는데 한 번도 안 열었다 | 785 − 431 = **354대(45.1%)** | **여기가 문제** | 스토어 문구·첫 화면·설치 직후 유도 |
| ③ 열었는데 남지 않았다 | MAU 689 vs 첫 실행 431 | MAU가 더 크다 = **재방문은 활발** | 손대지 않는다 |

- ③이 431보다 크다는 것은 **한 번이라도 연 사람은 계속 쓴다**는 뜻이다. 즉 병목은 **「설치 → 첫 실행」 한 칸**이다. 이 칸만 좁히면 된다(첫 화면·온보딩·리뷰는 이미 잘 되고 있는 쪽이라 건드리지 않는다).
- ②의 원인 후보는 네 가지다. **추측으로 고치지 말고 §4-2 로 가른다.**
  1. 설치만 하고 나중에 열려던 사람(가장 흔함 — 마케팅 문제가 아니라 습관 문제)
  2. 앱이 켜지다 죽는다(크래시·흰 화면·네트워크 실패)
  3. 켜지긴 했는데 GA4 가 못 잡는다(계측 구멍 — iOS UA 없음, §4-3)
  4. 설치 후 「열기」를 안 누르고 웹으로 계속 쓴다(웹이 충분히 좋아서)

### 4-2. 진단 순서 — 이 표를 채우기 전에는 아무것도 고치지 않는다

**(a) 앱 크래시 집계** — `CrashReporter.java` 가 `events` 표에 `event_type='app_crash'` 로 쌓는다. PC 의 `tools/daily/.env` 서비스 키로 최근 28일을 센다(읽기 전용).

```
# Supabase REST — service_role 키(로컬 .env). 세기만 한다
GET {SUPABASE_URL}/rest/v1/events?event_type=eq.app_crash&created_at=gte.2026-10-26&select=event_data
```
- 세는 것: 총 건수 · `ver` 분포 · `sdk` 분포 · `model` 상위 5개 · `trace` 앞 80자 상위 5종.
- **32건 이상이면** 앱 실행 실패가 실제 원인이다 → §4-2(c) 로.

**(b) GA4 앱 세션 대조** — 브리핑 도구(사장님 PC)로 GA4 28일:

| 볼 것 | 방법 |
| --- | --- |
| 앱(안드로이드) 사용자·세션 | 잠재고객/필터: 사용자 에이전트에 `MomcalApp/android` 포함 |
| 앱(iOS) 사용자 | **지금은 못 가른다** → §4-3-1 로 먼저 구멍을 막고 나서 4주 뒤 잰다 |
| 웹 사용자 | 전체 − 앱 |

**(c) 판정 규칙 — 이 규칙 밖으로 나가지 않는다**

| (a) 크래시 | (b) GA4 앱 사용자 | 판정 | 다음 행동 |
| --- | --- | --- | --- |
| 32건 이상 | 무엇이든 | **앱이 죽는다** | 크래시 `trace` 상위 3종을 고치는 것이 이번 작업의 P0. 크래시 고치기 전에 리퍼러·비콘을 넣지 않는다(죽는 앱에 계측을 더하면 죽는 지점만 는다) |
| 32건 미만 | ≥ 400 | **거의 다 열린다 — ②는 「안 열었다」가 아니라 「늦게 열었다」** | 고칠 것이 없다. §4-3 계측(리퍼러)만 넣고 4주 뒤 「설치 후 7일 내 첫 실행」으로 다시 본다 |
| 32건 미만 | 250~400 | **일부는 열리는데 GA4 가 놓친다** | §4-3-1(iOS UA) 먼저 넣고 4주 재측정. 그 전에는 어떤 결론도 내리지 않는다 |
| 32건 미만 | < 250 | **켜지다 조용히 실패한다**(흰 화면·네트워크·스플래시 정지) | 안드로이드 에뮬레이터에서 콜드 스타트 3회 재현: ① 비행기모드로 켜기 ② 첫 실행 직후 10초 관찰 ③ `adb logcat` 에서 `chromium`·`Capacitor` 오류 수집. 재현되면 그 원인 1개만 고친다 |

- **판정 기준을 왜 이렇게 잡았나**: 크래시 32건 = 설치 유지 785대의 4%다. 4%면 「가끔 죽는 앱」이 아니라 **구조적으로 죽는 앱**으로 보고 원인을 먼저 고친다. GA4 앱 사용자 400 = 처음 실행 431의 93%다. 93% 이상이면 Play 가 센 실행이 거의 다 우리 화면에 닿았다는 뜻이므로, 남는 차이는 **앱 문제가 아니라 사람이 안 연 것**으로 본다.
- **측정값이 없으면 「고쳤다」고 쓰지 않는다.** (b)를 못 뽑는 상황이면 보고에 「GA4 앱 세그먼트 미확인」이라고 적고 (a)·(c)만 한다.

### 4-3. 계측 구멍 2개 (P1 — 위 판정에서 「계측 문제」로 갈렸을 때만)

**4-3-1. iOS 앱이 GA4에서 Safari 와 구분되지 않는다**

`ios-app/capacitor.config.json` 의 `ios` 블록에 `appendUserAgent` 가 없다. 안드로이드는 `"MomcalApp/android"` 를 붙이고 있어 앱 세션을 가를 수 있는데 iOS 는 불가능하다.

```json
"ios": {
  "contentInset": "never",
  "limitsNavigationsToAppBoundDomains": false,
  "scrollEnabled": true,
  "appendUserAgent": "MomcalApp/ios",
  "webContentsDebuggingEnabled": false
}
```
- `ios-app/capacitor.config.json` **한 파일, 한 줄**. 사이트 코드는 UA 로 분기하지 않으므로(카톡·인스타 문자열만 본다) 부작용이 없다.
- 이 변경은 **다음 iOS 빌드에만** 실린다. 지금 스토어 판(1.0.2)에는 영향이 없다.

**4-3-2. 설치 경로(어느 랜딩에서 설치했나)가 남지 않는다**

지금 CTA 의 Play 링크는 `https://play.google.com/store/apps/details?id=com.wantsb.momcalendar` 뿐이라, 설치가 우리 어느 페이지에서 왔는지 알 수 없다. **Play 설치 리퍼러**를 붙이면 콘솔의 「획득 → 소스/캠페인」에서 페이지별 설치가 갈린다.

| 할 일 | 파일 | 내용 |
| --- | --- | --- |
| CTA 의 Play 링크에 리퍼러 | `build.ps1` 444행 | `...?id=com.wantsb.momcalendar&referrer=utm_source%3Dseo%26utm_medium%3Dcta%26utm_campaign%3D<페이지 구분>` |
| 페이지 구분 값 | 같음 | `/g/` = `brand`, `핫딜정보` = `hotdeal`, `세일정보`·`최저가정보` = `sale`, `라방일정` = `live`, 그 밖 생성 페이지 = `page` |
| 앱이 리퍼러를 읽는 코드 | `install_native.mjs` + 새 클래스 (아래) | **P1-후순위.** 위 (a)(b) 판정이 「설치→미실행이 습관 문제」일 때만 넣는다 |

- 앱 쪽 구현(넣기로 결정됐을 때만): `build.gradle` 에 `implementation "com.android.installreferrer:installreferrer:2.2"` 를 `install_native.mjs` 4)절에서 추가, `MainActivity.onCreate` 에서 `InstallReferrerClient` 로 1회 읽어 `events` 표에 `event_type='app_install_ref'`(`utm_campaign`·`utm_source`·`utm_medium`·`ver`·`model`)로 남긴다. `CrashReporter.java` 의 전송 코드를 그대로 본뜬다(같은 공개 키·같은 표·insert 만).
- **리퍼러는 「어디서 설치했나」만 남긴다.** 첫 화면을 특정 페이지로 보내는 라우팅은 하지 않는다(그건 `index.html` 을 건드려야 하고, 잘 되고 있는 첫 화면을 바꾸는 일이다).

### 4-4. 하지 말 것

- 스토어 **제목·부제·스크린샷·키워드 필드**를 「첫 실행률」 때문에 바꾸지 않는다(§2-1).
- 「설치 33% 떨어졌다」 같은 **원인 모를 수치를 보고서에 쓰지 않는다.** §4-2 표에 실측값을 그대로 옮긴다.
- 앱 진단 때문에 **단독 업데이트를 올리지 않는다**(§2-2).

---

## 5. [P0 확인 / P1 배포] C. 인앱 리뷰 — 코드는 이미 있다

### 5-1. 이미 구현된 사양 (다시 만들지 말 것)

`index.html` 10962~11045행(`mc-kw-js` 블록) 실측:

| 항목 | 실측 |
| --- | --- |
| 부르는 때 | ① 찜이 3개 이상이 된 순간(`wish3`, 6940행) ② 키워드 알림 등록 직후(`kw_add`) |
| 쉬는 기간 | **90일** · 기기당 **3회** · 세션당 **1회** |
| 안 부르는 때 | 웹·카톡 인앱·옛 버전 앱(플러그인 없음) · 화면 숨김 · 로그인/알림 시트가 떠 있을 때(그때는 쿨다운을 쓰지 않음) |
| 기록 | `localStorage.mc_review {last, n, why}` — 기록을 못 남기면 부르지 않는다 |
| 이벤트 | `trackEvent('review_ask', reason)` · `review_err` |
| 킬스위치 | `MC_REVIEW_ON=false` 한 줄 |
| 점검 함수 | `window.mcReviewCheck()` → `'ok' | 'off' | 'no_plugin' | 'cooldown' | 'max' | 'session'` |

**브리프의 설계(찜 3건 또는 알림 설정 직후 · 90일 쿨다운)와 정확히 같다.** 새 코드를 쓰지 않는다.

### 5-2. 스토어에 실린 바이너리에 플러그인이 들어갔나 (이게 진짜 남은 일)

`@capacitor-community/in-app-review` 는 11-19 00:29 KST 커밋 `3602460` 에서 `package.json` 에 추가됐고 커밋 메시지도 「스토어 제출 전」이다. 그런데 **Play 목록의 업데이트 날짜는 2026-11-05** 다 → 지금 사용자가 받는 안드로이드 앱에는 플러그인이 **없을 가능성이 높다**(추론). 플러그인이 없으면 `mcReviewCheck()` 가 `'no_plugin'` 을 돌려주고 **리뷰 창은 한 번도 뜨지 않는다**(코드가 안전하게 막는다).

**확인 방법 (클코, 20분)**

| # | 할 일 | 합격 기준 |
| --- | --- | --- |
| 1 | 에뮬레이터에 **현재 스토어 판 APK**(또는 그 versionCode 로 빌드한 산출물) 설치 → `test-app.html?preview=1&e2e=selftest` 열기 | — |
| 2 | 웹뷰 원격 디버깅으로 콘솔에서 `mcReviewCheck()` 실행 | 스토어 판이면 `'no_plugin'` 예상(그게 사실이면 그대로 보고) |
| 3 | 새 빌드(`versionCode` +1, 플러그인 포함) 설치 후 같은 명령 | `'ok'` 또는 `'cooldown'` |
| 4 | 3번에서 `mcReviewMaybe('test')` 를 **직접 한 번** 불러 창이 뜨는지 눈으로 확인 | 구글 리뷰 창이 뜬다. 안 뜨면 `adb logcat | grep -i review` 로 원인 |
| 5 | iOS: 다음 TestFlight 빌드에서 같은 확인(`ios-app/ci/testflight.sh` 경로) | 같음 |

- **결과를 정직하게 보고한다.** 「스토어 판에는 없다 → 다음 업데이트에 실린다」가 정상적인 결론이고, 그게 길아 님이 원한 「다음 기능 업데이트 때만」과 맞는다.
- **앱을 지금 올리지 않는다.** 산출물(.aab·ipa)만 만들고 업로드는 사장님 몫(§7).

### 5-3. 다음 업데이트에 함께 실을 것 (스토어 문구 1~2줄)

Play 설명은 이미 `공구일정`·`공동구매`·`공구모음`·`핫딜` 이 모두 들어가 있다(실측). **없는 것은 `공구일정사이트` 한 구절**이다. 설명 **맨 아래 안내 문단 앞**에 자연스러운 1~2줄만 더한다.

`android-app/STORE_LISTING.md` §2 에 추가(파일만 고친다, 콘솔 입력은 사람):

```
공구일정사이트를 찾고 있다면, 맘캘린더에서 인스타 공구와 공동구매 일정을 날짜별로 확인해 보세요.
```

- **금지**: 기존 문단 순서 바꾸기 · 키워드 나열식 문장(「공구일정사이트 공동구매 공구모음…」) · 이모지 · 숫자 추가.
- iOS `ios-app/STORE_LISTING.md` 도 같은 한 줄(애플은 키워드 필드가 따로 있으니 설명만).
- **콘솔에 실제로 입력하는 것은 사장님**이다(§7).

---

## 6. [P1] D. GA4 랜딩 CTA — 이미 있는 것 위에 구멍 3개만 막는다

### 6-1. 이미 되어 있는 것 (유지)

- 생성 페이지 **전부**에 CTA 1개: `build.ps1` 426~446행이 `$AppCta` 를 만들고 `lib.ps1` 330~331행이 `<div class="wrap">` 아래에 넣는다. `noindex` 페이지에는 넣지 않는다.
- 문구의 숫자는 빌드가 실측한 「내일(N) 오픈 공구 M건」(100건 이상일 때만, 아니면 「공구 일정 매일 갱신」).
- 두 스토어 링크가 모두 있고 `gtag('event','seo_app_cta',{place:'seo_ios'|'seo_and'})` 가 걸려 있다.
- 라이브 확인: `세일정보.html`(19,487B)·`핫딜정보.html`(35,288B) 에 `appcta` 1개 · 이벤트 2개.

**바꾸지 않는다**: 클래스 이름(`appcta`) · 문구 규칙 · 위치(헤더 아래 1곳) · 스토어 URL의 기본형.

### 6-2. 구멍 1 — 보존 페이지에 CTA 가 없다 (약 5%)

`g/` 10,561장 중 **매일 다시 만들어지는 페이지만** CTA 를 받는다. 오늘 집계에 없는 옛 브랜드 페이지는 「보존 페이지」로 남아 옛 HTML 그대로다(예: `g/00PM.html`, dateModified 2026-10-01, CTA 0). 표본 39장 중 2장 = **약 5%(≈500장)**.

이미 같은 자리에 GA4·noai 를 넣는 **멱등 손질 루프**가 있다 — `build.ps1` **1944~1964행**이 `g·p·s·gg·m·d·c` 를 훑으며 `PatchHeadText`(lib.ps1 37행)를 부른다. 여기에 CTA 주입을 **한 겹 더** 붙인다.

**(a) 날짜·숫자 없는 고정 CTA 를 하나 더 만든다** — `build.ps1` 446행(`}catch{...}`) 바로 아래:

```powershell
# 보존 페이지용 — 날짜·건수를 넣지 않는다(그 페이지는 다시 만들어지지 않아 숫자가 굳는다. 「못 잰 숫자는 말하지 않는다」 규칙)
$AppCtaStatic = "<div class=${Q}appcta${Q}><b>공구 일정 매일 갱신</b><span>앱에서 알림·찜하기</span>" +
  "<a class=${Q}ap ios${Q} href=${Q}https://apps.apple.com/kr/app/id6826126083${Q} rel=${Q}nofollow noopener${Q} onclick=${Q}try{gtag('event','seo_app_cta',{place:'seo_ios',page:location.pathname})}catch(_){}${Q}>App Store</a>" +
  "<a class=${Q}ap g and${Q} href=${Q}https://play.google.com/store/apps/details?id=com.wantsb.momcalendar${Q} rel=${Q}nofollow noopener${Q} onclick=${Q}try{gtag('event','seo_app_cta',{place:'seo_and',page:location.pathname})}catch(_){}${Q}>Google Play</a></div>" + $CtaOs
```

- **클래스 이름 규칙**: App Store 버튼 = `ap ios`, Google Play 버튼 = `ap g and`. 기존 `ap`·`ap g` 의 **모양(보라 채움 / 흰 테두리)을 그대로 두고** 이름만 더한다(`.ap.g` 스타일이 깨지면 안 된다).
- `$CtaOs` 는 §6-3(b)에서 만드는 한 줄짜리 스크립트다. **`$AppCta` 와 `$AppCtaStatic` 둘 다** 끝에 `+ $CtaOs` 를 붙인다.

**(b) 주입 함수** — `lib.ps1` 의 `PatchHeadText`(37행) **아래**에 추가한다. 생성 페이지와 **똑같은 마크업**(`<div class="wrap">` 바로 뒤)에 넣어 CSS 가 그대로 먹는다:

```powershell
# 보존 페이지에 앱 CTA 를 한 번 넣는다 (2026-11-23 ORDER §6-2). 멱등 — 이미 있으면 그대로 둔다
function PatchCtaText([string]$t){
  if(-not $AppCtaStatic){ return $t }
  if(IsTombstoneText $t){ return $t }
  if(TextHasNoindex $t){ return $t }
  if($t.IndexOf('class="appcta"', [StringComparison]::Ordinal) -ge 0){ return $t }
  $i = $t.IndexOf('<div class="wrap">', [StringComparison]::Ordinal)
  if($i -lt 0){ return $t }                       # 옛 틀(감싸는 div 가 없음) — 억지로 넣지 않는다
  $j = $i + '<div class="wrap">'.Length
  return $t.Substring(0, $j) + $AppCtaStatic + $t.Substring($j)
}
```

**(c) 루프에 연결** — `build.ps1` 1960행 `$t3 = PatchHeadText $t2` 바로 아래:

```powershell
    $t4 = PatchCtaText $t3
```
그리고 같은 블록의 쓰기·비교(`if($deadFixed -ne $n0 -or $t3 -ne $t2)` … `[IO.File]::WriteAllText($fp, $t3, …)`)를 `$t3` → `$t4` 로 바꾸고, 세는 변수 `$ctaPatched` 를 하나 더 둔다. 마지막 출력 줄(1965행)에 `· 앱 CTA $ctaPatched 쪽` 을 덧붙인다.

- 첫 실행에서 **몇 장에 붙었는지 출력으로 확인**한다(예상 400~600장). 1,000장을 넘으면 `$t.IndexOf('<div class="wrap">')` 조건이 너무 넓은 것이니 **멈추고 보고**한다(옛 틀 비중이 큰 것 = 다른 사고).
- 되돌리기: `PatchCtaText` 호출 한 줄을 지우면 끝. 파일은 지우지 않는다.

**주의**: `$AppCtaStatic` 은 `$AppCta` 와 **같은 CSS 클래스**를 쓴다. CSS(`lib.ps1` 254~257행)는 손대지 않는다.

### 6-3. 구멍 2 — OS 를 안 가리고, 이벤트에 페이지 차원이 없다

지금은 아이폰 손님에게도 「Google Play」 버튼이 같이 보이고, GA4 는 `place`(스토어)만 안다. **클릭이 어느 페이지에서 일어났는지**를 모르면 랜딩별 전환을 비교할 수 없다.

**(a) 이벤트에 `page` 추가** — `build.ps1` 443·444행의 `gtag` 인자에 `page:location.pathname` 만 더한다(이벤트 이름·`place` 값은 그대로 → 기존 GA4 보고서가 끊기지 않는다).

```
gtag('event','seo_app_cta',{place:'seo_ios',page:location.pathname})
gtag('event','seo_app_cta',{place:'seo_and',page:location.pathname})
```

**(b) OS 에 맞는 버튼만 보이게** — 두 버튼에 `ios`·`and` 클래스를 주고(`ap ios` / `ap g and`), `$CtaOs` 를 만든다. **크롤러에게 다른 본문을 주는 것이 아니라 사람 화면의 버튼 표시만 가른다**(§2-3).

기존 `$AppCta`(443·444행)는 클래스 이름만 더한다 — 그 밖은 한 글자도 바꾸지 않는다:

| 줄 | 지금 | 바꿀 것 |
| --- | --- | --- |
| 443 | `class=${Q}ap${Q}` (App Store) | `class=${Q}ap ios${Q}` |
| 444 | `class=${Q}ap g${Q}` (Google Play) | `class=${Q}ap g and${Q}` |

`$CtaOs` 는 **`$AppCta = ''`(426행)보다 위**에 둔다(아래에서 쓰므로 먼저 정의):

```powershell
# 두 스토어 버튼이 늘 같이 보이면 아이폰 손님에게 Play 버튼이, 안드로이드 손님에게 App Store 버튼이 같이 보인다.
#   UA 로 「표시만」 가른다 — PC·판별 불가(아이패드 데스크톱 모드 등)는 그대로 둘 다 보인다. 크롤러 본문은 안 바뀐다.
$CtaOs = "<script>(function(){try{var ua=navigator.userAgent||'';var ios=/iPhone|iPad|iPod/i.test(ua),and=/Android/i.test(ua);if(!ios&&!and)return;var d=document.querySelectorAll('.appcta');for(var i=0;i<d.length;i++)d[i].className+=(ios?' os-ios':' os-and');}catch(e){}})();</script>"
```

CSS 는 `lib.ps1` 257행 아래에 세 줄(`.ap.g` 가 남의 버튼을 흰 테두리로 칠하므로, Play 만 남을 때는 채움으로 되돌린다):

```css
.appcta.os-ios .ap.and{display:none}
.appcta.os-and .ap.ios{display:none}
.appcta.os-and .ap.and{margin-left:auto;background:#602090;color:#fff;border:0}
```

- **PC·판별 불가 기기에서는 두 버튼이 그대로 보인다**(`return`). 그래서 데스크톱 유입 전환을 잃지 않는다.
- `$AppCta`(생성 페이지)와 `$AppCtaStatic`(보존 페이지) **둘 다** 끝에 `+ $CtaOs` 를 붙인다. 스크립트는 페이지마다 1회만 들어간다(CTA 도 페이지마다 1개).
- **V6 에서 실제 화면을 눈으로 확인**한다: iPhone UA → Play 버튼 없음 · Android UA → App Store 없음 · PC → 둘 다 · 버튼이 왼쪽에 붙어 어색하지 않은지(위 세 번째 줄).

### 6-4. 구멍 3 — 긴 목록 허브에는 하단 CTA 가 없다

`핫딜정보.html`(35KB)·`세일정보.html`(19KB)·`최저가정보.html`·`라방일정.html` 은 목록이 길어 CTA 가 첫 화면 위로 올라간다. **이 4장에만** 본문 끝 CTA 를 하나 더 둔다.

**(a) `WritePage` 에 선택 필드 하나** — `lib.ps1` 353행 `[void]$sb.AppendLine($o.body)` 바로 아래:

```powershell
  if($o.cta2){ [void]$sb.AppendLine($o.cta2) }   # 긴 목록 페이지의 하단 앱 CTA (2026-11-23 ORDER §6-4)
```

**(b) 핫딜·세일 페이지 루프에서만 넘긴다** — `build.ps1` 1735~1740행 `WritePage @{ ... }` 에 `cta2=$AppCta` 한 칸 추가.
- 이 4장은 **매일 다시 만들어지므로** `$AppCta`(숫자 포함)를 써도 된다. 보존 페이지에는 절대 `$AppCta` 를 쓰지 않는다(§6-2).
- `g/`·`p/`·`s/`·`gg/` 에는 하단 CTA 를 넣지 않는다(짧은 페이지에 두 번은 광고로 읽힌다).

### 6-5. 외부 신호 주간 루틴에 허브 링크 넣기 (사람 몫 — 클코는 하지 않는다)

지금 주간 외부 신호(블로그·맘카페·인스타)는 대부분 **홈(`/`)** 만 가리킨다. 아래 4개를 **매주 월요일 체크리스트**에 고정한다(자비스가 사장님께 확인).

| 채널 | 넣을 링크 | 문구 예 |
| --- | --- | --- |
| 블로그 본문 | `https://momcalendar.com/세일정보.html` | 「이번 주 브랜드 세일 일정은 여기서 날짜로 봐요」 |
| 맘카페 | `https://momcalendar.com/핫딜정보.html` | 「오늘 핫딜만 모아 둔 페이지」 |
| 인스타 프로필/스토리 | 대표 `/g/` 1장(그 주 인기 브랜드) | 브랜드 이름 그대로 |
| 카톡 공구방 공지 | `https://momcalendar.com/공구일정사이트.html` | 「오늘 오픈·마감 전체 일정」 |

- 링크는 **그 주 실제로 열려 있는 페이지**로만 건다(죽은 링크 금지). `/g/` 는 `sitemap-brand.xml` 에 있는 것으로 고른다.

---

## 7. 사람 몫 (클코가 못 한다 — 보고에 그대로 적는다)

1. **GSC 판정**: 11-26·11-30 에 3개 주소의 색인 상태 확인(§3-3). 접수는 이미 됐으니 **새로 요청하지 않는다**.
2. **스토어 문구 입력**: `STORE_LISTING.md` 에 넣은 1~2줄을 Play Console·App Store Connect 설명란에 반영.
3. **다음 정기 업데이트 업로드**: 안드로이드 `versionCode` +1 빌드 산출물(.aab) · iOS TestFlight → 심사. **이번에 단독으로 올리지 않는다.**
4. **외부 신호 주간 루틴**(§6-5).
5. (선택) Cloudflare Transform Rule 로 `/test*.html`·`/kktest.html` 에 `X-Robots-Tag: noindex, nofollow` — 접근 권한이 없으면 **건너뛴다**(코드만으로도 충분하다).

---

## 8. 검증 — 실제로 돌려 표로 보고 (V1~V16)

| # | 검증 | 방법 | 합격 기준 |
| --- | --- | --- | --- |
| V1 | robots 에 테스트 3종 차단이 없다 | `curl -s https://momcalendar.com/robots.txt` | `Disallow: /test.html`·`/kktest.html` **0회** |
| V2 | 테스트 3종 게이트·noindex·GA4 없음 | `curl` 3장 + `grep` | `mc_test_ok` 1+ · `content="noindex` 1+ · `G-NRCP2FVRSB` 0 |
| V3 | `/test.html` 이 여전히 200 (배포 게이트) | `bash tools/live_verify.sh` | 통과 · `/test.html` 200 |
| V4 | 세일정보·핫딜정보에 CTA | `curl` + `grep -c appcta` | 각 **2개**(상단+하단) |
| V5 | 보존 페이지 CTA | `g/00PM.html`·`g/방수.html`·`g/런칭특가.html` `grep` | `appcta` 1개 이상 · 문구에 **날짜·건수 없음** |
| V6 | OS 분기 표시 | 라이브 `세일정보.html` 을 ① iPhone UA ② Android UA ③ PC 로 열어 스크린샷 | ① Play 버튼 안 보임 ② App Store 안 보임 ③ 둘 다 보임 · 레이아웃 안 깨짐 |
| V7 | 이벤트에 page 차원 | 페이지 소스 `grep seo_app_cta` | `page:location.pathname` 포함 2회 |
| V8 | GA4 실시간 확인(선택) | 스테이징 PC 브라우저로 CTA 클릭 1회 | GA4 실시간에 `seo_app_cta` + `page` 표시 |
| V9 | 보존 주입 수 | 빌드 출력 | 「앱 CTA N쪽」 400~600 · **1,000 초과면 중단·보고** |
| V10 | 사이트맵·페이지 수 불변 | 빌드 출력 | `g` 10,585 · `p` 3,287 · 사이트맵 main/brand/product/seller/gonggu 값이 직전 빌드와 동일(±0) |
| V11 | `verify.ps1` 전체 | `pwsh tools/seo/verify.ps1` | 실패 0 · 「p noindex N / M」 출력 |
| V12 | `live_verify.sh` | 실행 | 통과 |
| V13 | 앱 크래시 집계 | §4-2(a) 쿼리 | 건수·ver·sdk·trace 상위 3종 표로 |
| V14 | GA4 앱 세션 대조 | §4-2(b) | 표로 · 못 뽑으면 「미확인」으로 |
| V15 | 앱 리뷰 플러그인 | §5-2 1~4 | 스토어 판/신규 빌드 각각의 `mcReviewCheck()` 값 |
| V16 | iOS UA | `ios-app/capacitor.config.json` 파싱 | `appendUserAgent` 존재 · JSON 유효 |

- V1~V3·V11·V12 는 **라이브 파일을 건드리지 않았는데도 실패하면** 그건 이번 작업이 깬 것이 아니다 — 직전 커밋 `a68bd539` 에서 같은 검사를 돌려 비교하고, 다르면 **멈추고 보고**한다.

---

## 9. 되돌리기

| 바꾼 것 | 되돌리기 |
| --- | --- |
| `$AppCtaStatic`·`PatchCtaText`·루프 호출(§6-2) | 호출 한 줄(`$t4 = ...`)을 지우고 `$t3` 로 되돌린다. 이미 붙은 CTA 는 **지우지 않는다**(해가 없다) |
| OS 분기 스크립트·CSS 두 줄(§6-3) | 스크립트 붙이는 한 줄과 CSS 두 줄 삭제. 클래스(`ios`·`and`)는 남아도 무해 |
| `page` 인자(§6-3) | `,page:location.pathname` 삭제 |
| `cta2`(§6-4) | `WritePage` 의 `if($o.cta2)` 한 줄과 호출부 `cta2=$AppCta` 삭제 |
| iOS `appendUserAgent`(§4-3-1) | 그 한 줄 삭제 후 `npx cap sync ios` |
| 설치 리퍼러(§4-3-2) | CTA 의 `&referrer=` 삭제 · 네이티브는 그 커밋만 revert |
| 스토어 문구(§5-3) | `STORE_LISTING.md` 한 줄 되돌리기(콘솔은 사람이 되돌린다) |

파일을 **하나도 삭제하지 않는다**(404 없음).

---

## 10. 보고 형식 · 커밋 분할

**커밋 4개로 나눈다.**

| 커밋 | 내용 |
| --- | --- |
| A | `$AppCtaStatic` + `PatchCtaText` + 보존 페이지 루프 연결 (`lib.ps1`·`build.ps1`) |
| B | CTA 이벤트 `page` + OS 분기 (CSS 두 줄 + 스크립트 한 줄) |
| C | `cta2` 하단 CTA (핫딜·세일 4장) |
| D | iOS `appendUserAgent` (+ 설치 리퍼러를 넣기로 했으면 별도 커밋 E) |

**보고에 반드시 넣을 것**
1. §1 표와 다른 실측값(다르면 그 값이 기준).
2. V1~V16 표(실행 결과 그대로, 실패는 실패로).
3. §4-2 판정 결과와 **어느 줄을 골랐는지**(그 줄 밖의 조치는 하지 않았음을 명시).
4. §5-2 에서 확인한 `mcReviewCheck()` 값(스토어 판·신규 빌드).
5. 보존 페이지 CTA 주입 수.
6. 사람 몫 5개(§7) 중 남은 것.

---

## 부록 — 이번 오더가 브리프와 다르게 판단한 두 가지 (근거)

1. **「색인 제거 후 robots Disallow 재적용」은 하지 않는다**(§3-4). Disallow 가 있으면 구글이 `noindex` 메타를 읽지 못해 「URL 만 색인」이 된다 — 11-23 오전의 실측 상태가 그것이었고, 그래서 같은 날 `e24f710` 에서 뺐다. 검색 방어는 `noindex` 메타 + 접근 게이트 + 삭제 요청 3중으로 유지하고, 11/26·11/30 에 **판정만** 한다.
2. **인앱 리뷰(브리프 2-b)는 이미 구현돼 있다**(11-19 00:29 KST 커밋 `3602460`, `index.html` 10962~11045행). 새로 만들면 잘 도는 코드를 덮어쓴다. 남은 일은 **스토어 바이너리에 플러그인이 들어갔는지 확인**(Play 목록 11-05 업데이트 → 없을 가능성)과 **다음 정기 업데이트에 싣기** 두 가지다.
3. **첫 실행률은 진단 없이 고치지 않는다**(§4-2). 785대 중 354대가 「한 번도 안 열었다」인데, 원인이 크래시인지 습관인지 계측 구멍인지에 따라 처방이 정반대다. 표를 채운 뒤 한 줄만 고른다.
