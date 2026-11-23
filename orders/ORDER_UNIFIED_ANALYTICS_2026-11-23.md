# ORDER — 웹·안드로이드·애플 통합 지표 대시보드 (매일 아침 자동 수집 · 무토큰)

작성 2026-11-23 (월) 16:20 KST · 자비스 · 기준 커밋 `de157b3`(main, 2026-11-23 15:52 KST 체크아웃)
대상 저장소 `wonji2/momcalendar` · 작업자 = 클로드 코드
관련 문서 `orders/ORDER_STORE_SEO_CONVERSION_2026-11-23.md`(같은 날 15:05 — 앱 첫 실행률·인앱 리뷰·CTA), `orders/ORDER_GA4_SEO_HOTDEAL_ALERT_2026-11-22.md`(§6 GA4), `supabase/sql/ops_status_68.sql`(관리자 전용 표·RPC 선례)

길아 님 지시(2026-11-23): **"애플 갤럭시 웹 다 한눈에 매일 볼 수 있게 구현"**
→ 애플(App Store) · 안드로이드(Google Play) · 웹(GA4) 지표를 **관리자 화면 한 탭**에서 매일 아침 자동 갱신으로 본다.

> **먼저 읽어라.** 이 오더는 새 기능을 **덧붙이는** 일이다. 기존 `admin.html` 의 공구·핫딜·배너·이웃셀러·통계 기능과 라이브 `index.html` 은 **한 줄도 바꾸지 않는다.** §1 표가 "지금 실제로 무엇이 되어 있는지"이고, §4 가 "왜 구글은 Reporting API 로 안 되는지"다. **§4 를 읽지 않고 수집기를 짜면 구글 지표는 영원히 0으로 나온다.**

---

## 실행 명령 (길아 님이 클로드 코드에 붙여넣는 1줄)

```
claude "orders/ORDER_UNIFIED_ANALYTICS_2026-11-23.md 끝까지 읽고 §4(소스별 실제 제약)부터 확인한 뒤 §5 SQL → §6 수집 스크립트 → §7 워크플로 → §8 어드민 탭 → §9 시드 순서로 구현해. 키가 하나도 없어도 전부 끝까지 돌아가야 하고(§6-2 안전 폴백), 키가 없는 소스는 '미설정'으로 표시만 해. §10 검증 V1~V14 실제로 돌려 표로 보고. index.html·staff.html·기존 admin.html 기능은 절대 건드리지 말고, 커밋은 A~D로 나눠 올려. Apple analyticsReportRequest 는 ONGOING 1건만 만들고 그 외 스토어 변경은 하지 마"
```

레포 루트(`wonji2/momcalendar` 체크아웃, `C:/Users/FAMILY/...`)에서 실행한다.
`.githooks`(1중) · `deploy-pages` 게이트(2중) · `repo-guard`(3중)는 그대로 둔다. **`--no-verify` 금지.**
Node 스크립트는 **의존성 0개**(`node:` 내장 모듈만)로 쓴다 — `npm install` 이 도는 순간 이 파이프라인은 조용히 죽는다(§6-1).

---

## 0. 한 줄 요약

| # | 할 일 | 한 줄 | 커밋 |
| --- | --- | --- | --- |
| A | **DB 스키마** | `analytics_daily`·`analytics_meta`·`analytics_manual` + 관리자 전용 RPC `analytics_overview(p_days)` — 표는 anon·authenticated 전면 회수, 읽기는 `is_app_admin()` 통과한 사람만 | A |
| B | **수집 스크립트** | `tools/analytics/collect.mjs` — GA4·Play·Apple 3소스를 **각각 따로** 돌리고, 키가 없으면 `미설정` 만 남기고 exit 0. 한 소스가 죽어도 나머지는 저장된다 | B |
| C | **매일 아침 워크플로** | `.github/workflows/analytics-daily.yml` — **08:40 KST** 크론 + 수동 실행. 저장소에 **아무것도 커밋하지 않는다**(Supabase 에만 씀) → 배포·용량에 영향 0 | C |
| D | **어드민 통합 탭** | `admin.html` 에 `📊 통합 지표` 탭 1개 추가 — ①웹(GA4) ②안드로이드 ③애플 ④웹→앱 전환 ⑤데이터 신선도. 기존 탭·기능은 손대지 않고 **추가만** | D |
| E | **시드·폴백** | 키 등록 전에도 화면이 비지 않게 지금 손에 있는 값(플레이 28일 퍼널 등)을 `analytics_manual` 에 넣고 **「수동·기준일」 라벨**을 붙인다 | A 에 포함 |
| F | **사람 몫** | 서비스 계정 1개 + GA4 속성 ID + Play Console 초대 + `PLAY_BUCKET` — **애플은 이미 있는 Admin 키를 그대로 쓴다(새로 발급 금지)** | 사람 |

**비용 0원 구조**: 공개 저장소 GitHub Actions(무료 분) · GA4 Data API(무료) · Play 벌크 리포트(무료 GCS 읽기) · App Store Connect API(무료) · Supabase 는 이미 Pro(11-19 전환)로 추가 과금 없음. **토큰 안 씀**(클코·LLM 호출 없이 순수 HTTP).

---

## 1. 지금 상태 — 착수 전에 이 표부터 실제 파일과 대조하라 (2026-11-23 15:52~16:15 KST 실측)

### 1-1. 실측값

| 항목 | 실측 | 판정 |
| --- | --- | --- |
| `admin.html` | 9,358줄 · 677,449B · 헤더 `맘캘린더 관리자` | 단일 파일 SPA. 손대는 곳은 §8 의 **4곳뿐** |
| 탭 구조 | 249~275행 `.tabs` — `홈/공구(전체·대기중·승인됨·중복의심·AI등록·크롤링)/판매(핫딜·세일라방·체험단·배너)/사람(홈관리·이웃셀러·셀러승인·제보·회원·출석)/분석·도구(광고성과·인스타카드·챗봇·통계·운영현황)` | 마지막 「분석·도구」 줄 274행 `통계` 다음이 삽입 지점 |
| 탭 전환 | `switchTab(tab,el)` 8506행. 뷰 숨김 목록 8513~8514행 `['statsView','aiView',…,'homeView']`, `tab==='stats'` 분기 8527행 | **목록에 `anView` 추가 + 새 분기 1개** (기존 분기 로직 불변) |
| 어드민 RPC 호출 방식 | `adminRpc(name, body)` — `SB_URL/rest/v1/rpc/{name}` 에 `apikey:SB_KEY` + `Bearer ACCESS_TOKEN`. 실패 시 throw | 새 RPC 도 이 함수 그대로 쓴다. **새 HTTP 코드 만들지 말 것** |
| 기존 통계 탭 | `statsView`(878행) — `admin_overview`·`admin_visit_series`·`admin_referrers`… 14개 RPC 병렬. `loadVisitors()`(5188행) 가 `visitors` 표를 `count=exact` 로 직접 센다 | **이건 자체(웹) 데이터다.** GA4·스토어 지표와 섞지 않는다 — 섞으면 숫자가 두 번 세어진다 |
| GA4 측정 ID | `G-NRCP2FVRSB` (admin.html **1014행** 라벨) | **속성 ID(숫자)는 저장소에 없다** → 사람 몫(§11-2). 지금 화면의 「Google Analytics 열기」 링크는 **1008행**에 `#/p$(GA_PROP)/` 로 **치환 실패 상태**다 → §8-4 에서 같이 고친다 |
| 앱 식별 | Android `android-app/cap/capacitor.config.json` → `android.appendUserAgent:"MomcalApp/android"` · iOS `ios-app/capacitor.config.json` → `ios` 블록에 **`appendUserAgent` 없음** | GA4 에서 **안드로이드 앱만** 웹과 갈린다. iOS 앱은 사파리와 구분 불가(11-23 오더 §4-3 이 다루는 건) — **이 오더는 iOS 앱 세션을 GA4 로 만들지 않는다** |
| 앱 ID | iOS Apple ID **6826126083** · Android `com.wantsb.momcalendar` | 그대로 쓴다 |
| 애플 키(이미 있음) | GitHub Secrets `APPLE_API_KEY_ID`·`APPLE_API_ISSUER_ID`·`APPLE_API_KEY_P8` — `ios-build.yml` 205~232행 · `ios-store.yml` · `ios-review-watch.yml` 이 **지금도 사용 중**. `ios-build.yml` 209행 주석: 「역할 **Admin**」 | **새 키 발급 불필요.** Admin 역할이면 §4-3 의 분석 리포트 요청 생성까지 된다 |
| 애플 API 클라이언트 | `ios-app/ci/asc.py` — ES256 JWT(`aud=appstoreconnect-v1`) + `call(method,path,body)`. 응답을 `json.loads` 하므로 **gzip 바이너리는 못 받는다** | Node 판을 새로 쓴다(§6-5). `asc.py` 는 **건드리지 않는다**(ios CI 가 쓴다) |
| 구글 키 | GitHub Secrets 에 **GA4·Play 용 서비스 계정 키가 없다**. 있는 구글 것은 `GSC_CLIENT_ID/SECRET/REFRESH_TOKEN`(서치콘솔 OAuth)·`GOOGLE_SERVICES_JSON`(안드로이드 빌드)뿐 | GA4·Play 는 **새 서비스 계정 1개**로 둘 다 커버(§11-1) |
| Supabase 쓰기 키 | `SUPABASE_SERVICE_KEY` 가 이미 12곳 워크플로에서 쓰인다(`seo-daily`·`ios-review-watch` 등) | **새 시크릿 만들지 말고 이걸 쓴다** |
| Supabase DB 적용 방식 | `tools/daily/sb_query.mjs` → `supabase db query --linked --output-format json -f <파일>` (PC CLI `C:/Users/FAMILY/supabase-cli/supabase.exe`) | SQL 적용도 이 방식(§5-2) |
| 보관 정책 | `visits`·`visitors` 는 180일, `events` 90일 롤업·퍼지(`logs_retention_71.sql`·`retention_fix_72.sql`) | **새 표는 건드리지 않는다** — 하루 3소스 × 지표 20개 ≈ 60행/일 = 연 2만행(수 MB). 정리 불필요 |
| 배포 게이트 | `tools/deploy_gate_check.sh` — 추적 파일 ≥45,000 · 핵심 9개 존재 · `index.html` ≥500KB · 워크플로 ≥10개 · 사이트 ≤1,200MB(실측 1,049MB) | **워크플로 1개 추가는 오히려 여유를 늘린다.** 사이트 용량은 이 오더로 **+50KB 미만** |
| `verify.ps1` | 200행이 robots 에 `/admin.html`·`/staff.html`·`/register.html` Disallow 가 있는지만 본다 | admin.html **내용**은 검증 대상 아님 → 오탐 없음 |
| 오늘의 스토어 실측(다른 오더 §1-1) | Play 28일: 기기 획득 **818** · 설치 유지 **785** · 처음 실행 **431(52.7%)** · MAU **689** · 전환율 **90.99%** · 리뷰 0 / App Store 쇼핑 차트 **#194** | **이 값들은 지금 사람이 콘솔에서 본 것이다.** 자동 수집 전까지 §9 시드로 쓴다 |

### 1-2. 이미 되어 있는 것 — **다시 만들지 말 것**

| 이미 있는 것 | 위치 | 이번에 할 일 |
| --- | --- | --- |
| 어드민 로그인·JWT·`adminRpc` | `admin.html` 1411~1500행 | 그대로 쓴다 |
| 관리자 판별 `is_app_admin()` · `app_admins` | `supabase/sql/admin_scope_06.sql` | 새 RPC 가 이 함수를 부른다 |
| 관리자 전용 표 패턴(`revoke all … from public, anon, authenticated` + `SECURITY DEFINER` + `is_app_admin` 예외) | `supabase/sql/ops_status_68.sql` 12~70행 | **이 패턴을 그대로 복제**한다. 새 발명 금지 |
| 자체 웹 방문 통계(방문자·체류·유입·시간대) | `statsView` + `visitors`/`visits`/`events` | 손대지 않는다. 이건 **웹 자체 계측**이고, 새 탭의 GA4 와 **출처가 다르다**(화면에 그렇게 적는다) |
| GA4 앱 CTA 계측 | `seo_app_cta` 이벤트(11-22 적용 · 위치는 11-23 오더 §1-1 실측: `build.ps1` 426~446행·`lib.ps1` 330~331행) | §8 의 전환 카드가 **읽기만** 한다 |
| 크래시 수집 | `events` 표 `app_crash` | 참고 표시만(수집 대상 아님) |
| `seo-daily`·`ios-build`·`ios-store`·`ios-review-watch` 워크플로 | `.github/workflows/` 19개 | **이름·내용 변경 금지.** 새 워크플로는 별도 파일 |

---

## 2. 절대 하지 말 것 (먼저 읽어라)

1. **`index.html` 은 읽기만 한다.** 11-11 사고(시안 막대 라이브 노출) 이후 규칙 그대로다. 이 오더는 `index.html` 을 **한 줄도** 바꾸지 않는다.
2. **`admin.html` 의 기존 기능을 건드리지 않는다.** 손대는 곳은 §8 의 네 곳(탭 1줄·`anView` div 1개·`switchTab` 목록 1개·`switchTab` 분기 1개) + 새 함수 블록 + `#anView` 스코프 CSS 뿐이다. `renderCards`·`loadAdminDash`·`loadVisitors`·`loadBannerAdmin` 등 **기존 함수 본문 수정 금지**. 전역 CSS 선택자(`.stat`, `.card` 등) **재정의 금지** — 새 스타일은 전부 `#anView` 아래로 스코프를 건다.
3. **스토어에 쓰지 않는다.** 이 오더가 App Store Connect 에 만드는 것은 `analyticsReportRequest` **ONGOING 1건**뿐이다(읽기용 리포트 생성 요청, 스토어 노출·가격·심사에 영향 0). 앱 제출·스크린샷·문구·빌드 업로드 **전부 금지**.
4. **구글 Play 를 `playdeveloperreporting.googleapis.com` 으로 짜지 마라.** 그 API 는 **vitals(크래시·ANR·메모리·시작속도)만** 준다. 설치·다운로드는 **0** 이다(§4-2 근거). 그렇게 짜면 화면이 영원히 빈칸이 된다.
5. **숫자를 지어내지 않는다.** 값이 없으면 `—` 와 사유(`미설정`/`오류`/`지연`)를 쓴다. 0 으로 채우지 않는다. 0 과 "모름"은 다르다.
6. **`npm install` 하지 않는다.** 의존성 0개(`node:crypto`·`node:zlib`·전역 `fetch`). 설치 단계가 없으면 잡이 빠르고, 공개 저장소에 공급망 위험도 안 들어온다.
7. **워크플로가 저장소에 커밋하지 않는다.** 이 워크플로에 `git commit`/`git push`/`contents: write` 를 넣지 않는다. Supabase 에만 쓴다 → 배포 게이트·`backup/last-good`·용량에 **영향 0**.
8. **커밋은 A~D 로 나눈다.** `git add -A`·`git add .` 금지(11-22 사고). 경로로 못박는다: `git add supabase/sql/analytics_daily_183.sql` 식으로.
9. **시크릿 값을 로그에 찍지 않는다.** 키가 비었는지만 `'있음/없음'` 으로 남긴다. 예외 메시지에 토큰이 섞이면 `redact()` 로 지운다(§6-6).

---

## 3. 이 오더가 만드는 것 (그림)

```
[매일 08:40 KST]
.github/workflows/analytics-daily.yml
   └ node tools/analytics/collect.mjs
        ├① GA4 Data API       (서비스 계정 GA4_SA_KEY + GA4_PROPERTY_ID)
        ├② Play 벌크 리포트   (같은 서비스 계정 + PLAY_BUCKET, GCS CSV)
        └③ App Store Connect  (기존 APPLE_API_* 3개 그대로)
             ↓ PostgREST upsert (SUPABASE_SERVICE_KEY)
        Supabase  analytics_daily / analytics_meta
             ↑ 읽기: RPC analytics_overview(p_days)  ← is_app_admin() 만
[언제든]
admin.html  📊 통합 지표 탭   → adminRpc('analytics_overview',{p_days:28})
```

**핵심은 "한 소스가 죽어도 화면이 산다"** 이다. 키 3개 중 0개만 있어도 지금 배포 가능하고, 키가 등록되는 순서대로 카드가 하나씩 살아난다.

---

## 4. 소스별 실제 제약 — 여기서 어설프게 짜면 뒤가 전부 헛일이다

### 4-1. GA4 (웹) — 서비스 계정 + **숫자 속성 ID**

- 엔드포인트: `POST https://analyticsdata.googleapis.com/v1beta/properties/{PROPERTY_ID}:runReport`
- 인증: 서비스 계정 JSON → JWT(RS256, `aud=https://oauth2.googleapis.com/token`, scope `https://www.googleapis.com/auth/analytics.readonly`) → 토큰 교환 → `Authorization: Bearer`
- **`G-NRCP2FVRSB` 는 측정 ID다. API 는 숫자 속성 ID 를 요구한다** — 바꿔 넣으면 400 이다. 속성 ID 는 GA4 → 관리 → 속성 설정에 있고 **길아 님만 볼 수 있다**(§11-2).
- 서비스 계정 이메일을 **GA4 속성 액세스 관리에 「뷰어」로 추가**해야 한다. 빠지면 `403 PERMISSION_DENIED`.
- 근거: <https://developers.google.com/analytics/devguides/reporting/data/v1/property-id> · <https://developers.google.com/analytics/devguides/reporting/data/v1/basics>

**가져올 것(이 5개만, 더 늘리지 않는다 — 쿼터·시간 낭비)**

| # | 지표 키 | dimensions | metrics | 기간 | 화면 |
| --- | --- | --- | --- | --- | --- |
| G1 | `active_users` | `date` | `activeUsers, totalUsers, sessions, screenPageViews` | 28일 | ④·① 그래프 |
| G2 | `sessions` (dim `channel:…`) | `sessionDefaultChannelGroup` | `sessions, activeUsers` | 28일 | ① 유입 채널 |
| G3 | `sessions` (dim `source:…`) | `sessionSource` | `sessions` | 28일 | ① AI·검색 유입(아래 필터) |
| G4 | `app_cta` (dim `place:…`) | `eventName, date` | `eventCount` | 28일 | ④ 웹→앱 전환 |
| G5 | `platform_mix` (dim `os:…`,`browser:…`) | `operatingSystem, browser` | `activeUsers` | 28일 | ① 참고(앱 분리 판정용) |

- G3 필터: 받은 `sessionSource` 중 아래만 남긴다(소문자 비교) — `chatgpt.com`, `perplexity.ai`, `gemini.google.com`, `claude.ai`, `copilot.microsoft.com`, `naver.com`, `search.naver.com`, `m.search.naver.com`, `google`, `daum.net`.
  **나머지는 버린다** — source 는 수백 개라 다 저장하면 표가 쓰레기가 된다.
- G4 는 `dimensionFilter` 로 `eventName == 'seo_app_cta'` 를 걸고, `place` 는 `eventName` 이 아니라 **이벤트 파라미터**라 Data API 로 못 뽑는다 → `place` 구분 없이 **합계만** 저장한다(`dim='place:all'`). 구분이 필요해지면 그때 별도 오더.
- G5 는 **1회차 실행 뒤 실제 값 분포를 보고** 앱/웹 분리 규칙을 정한다. 지금 `browser` 값에 `MomcalApp` 토큰이 남는지 **확인되지 않았다** → 확인 전에는 카드에 「웹 방문자 OS 비중」으로만 쓴다. **추측으로 '앱 사용자'라고 라벨 붙이지 않는다.**

### 4-2. Google Play (안드로이드) — **Reporting API 로는 안 된다. 벌크 리포트 CSV 다**

- `playdeveloperreporting.googleapis.com` 의 metric set 은 `vitals.crashrate`·`vitals.anrrate`·`vitals.slowstartrate`·메모리·LMK 뿐이다. **설치·다운로드·전환 지표가 없다.**
  근거: <https://developers.google.com/play/developer/reporting/metricset-intro>
- 설치 데이터는 **Play Console > 앱 보고서 > 통계**의 **월별 CSV**(비공개 GCS 버킷 `pubsite_prod_rev_…`)에만 있다.
  - 경로: `gs://{BUCKET}/stats/installs/installs_{패키지}_{YYYYMM}_{차원}.csv` (차원 없음 = overview)
  - 컬럼: `Date, Package Name, <차원>, Current Device Installs, Installs on active devices, Daily Device Installs, Daily Device Uninstalls, Daily Device Upgrades, Current User Installs, Total User Installs, Daily User Installs, Daily User Uninstalls`
  - **UTF-16 인코딩** · 데이터는 **일 단위로 잡히지만 파일은 월이 끝난 뒤 3~7일 뒤** 올라온다.
  - 근거: <https://support.google.com/googleplay/android-developer/answer/6135870>
- **그래서 안드로이드 카드는 "어제 하루"가 아니라 "최근 완료월의 일별"이다.** 이 사실을 화면에 반드시 적는다(§8-2 ②). 이걸 숨기고 "오늘 다운로드 0"으로 보이면 사장님이 잘못 판단한다.
- 스토어 방문자·전환율(90.99% 같은 값)은 **CSV 에 없다** → 자동 수집 대상이 아니다. §9 수동 입력으로 두고 `수동` 라벨을 붙인다.
- 접근 권한: 서비스 계정을 Play Console > **사용자 및 권한 > 새 사용자 초대**에 넣고 **「앱 정보 보기」= 전체** 로 준다(재무 권한 불필요). 버킷 주소는 Play Console > 앱 보고서 > 통계의 **「Cloud Storage URI 복사」** 로 얻는다(§11-3).
- 구현: Storage REST 로 목록·다운로드(`https://storage.googleapis.com/storage/v1/b/{BUCKET}/o?prefix=stats/installs/` → `…/o/{urlencoded}?alt=media`), scope `https://www.googleapis.com/auth/devstorage.read_only`.
  **`stats/` 아래 실제 폴더 목록을 1회차에 로그로 찍어라** — `stats/installs`·`stats/retained_installers`·`stats/crashes` 등이 실제로 있는지 확인하고, **없는 것을 코드에 가정하지 않는다.**

### 4-3. App Store Connect (애플) — 기존 키로 되고, **요청을 먼저 만들어야** 데이터가 온다

- 엔드포인트: `https://api.appstoreconnect.apple.com/v1`, 인증은 `ios-app/ci/asc.py` 와 같은 ES256 JWT(`kid=APPLE_API_KEY_ID`, `iss=APPLE_API_ISSUER_ID`, `aud=appstoreconnect-v1`).
- **순서(계층)**: `analyticsReportRequests` → `reports` → `instances`(granularity=DAILY, processingDate) → `segments` → `download URL` → **`.txt.gz`** 파싱.
- **ONGOING 요청이 없으면 데이터가 아예 안 온다.** 생성은 **Admin 역할 키**가 필요하고, 지금 키가 Admin 이다(§1-1). 첫 리포트는 **24~48시간** 뒤.
- **ONGOING 은 과거를 채우지 않는다.** 과거가 필요하면 `ONE_TIME_SNAPSHOT` 요청을 따로 만든다(2024-01-01 부터 제공).
- 리포트 이름은 **응답의 `attributes.name` 을 읽어 매칭**한다(추측 문자열 하드코딩 금지). 이번에 쓰는 두 가지:
  - **App Downloads** — `Download Type`(First-time Download / Redownload / Manual update / Auto-update / Restore) × `Counts` → **최초 다운로드·재다운로드**
  - **App Store Discovery and Engagement** — `Event`(Impression / Page view / Tap) × `Counts`·`Unique Counts` → **노출·제품 페이지 조회·전환율**
  - 전환율 정의(애플 공식): **총 다운로드 ÷ 순 고유노출(Unique impressions)**. 근거: <https://developer.apple.com/help/app-store-connect-analytics/reference/metrics-definitions/>
- 첫 리포트 지연·기본 2일 완성 지연이 있어 **애플 카드도 "오늘"이 아니라 "그제까지"** 다. 화면에 「완성 기준 D-2」 표기.
- **차트 순위는 API 에 없다.** 대신 iTunes RSS(장르 6024=쇼핑, 한국)로 **상위 100위 안에 있으면 실측 순위**, 없으면 `100위 밖` 으로 표시한다.
  실측: 이 피드를 오늘 받아 보니 **100개까지만** 돌려준다(`limit=200` 을 줘도 100). 사장님이 본 **쇼핑 #194** 는 이 피드로 확인 불가 → **`수동` 값으로 두고 RSS 는 교차 확인용**으로만 쓴다.
  근거: <https://itunes.apple.com/kr/rss/topfreeapplications/limit=100/genre=6024/json>

### 4-4. 세 소스의 신선도는 서로 다르다 — 화면이 이걸 숨기면 안 된다

| 소스 | 실제 갱신 | 카드에 쓸 문구 |
| --- | --- | --- |
| GA4 | 어제까지(D-1), 아침 수집 시점에 확정 | `D-1까지` |
| Play | **월 마감 +3~7일** | `최근 완료월 · 월마감+3~7일` |
| Apple | 요청 후 24~48h, 데이터 완성 D-2 | `D-2 완성` |

---

## 5. [A] DB 스키마 — `supabase/sql/analytics_daily_183.sql`

### 5-1. 파일 전문 (그대로 넣는다)

```sql
-- ══════════════════════════════════════════════════════════════════
--  통합 지표 저장소 — 웹(GA4) · 안드로이드(Play) · 애플(App Store) (2026-11-23)
--  지시: 길아 님 「애플 갤럭시 웹 다 한눈에 매일 볼 수 있게」
--
--  왜 표 3개인가
--    analytics_daily  : 날짜·소스·지표·차원 한 줄. 증감·추이는 RPC 가 계산한다(원본만 쌓는다)
--    analytics_meta   : 소스별 마지막 수집 상태(ok/stale/미설정/오류). **키가 없어도 화면이 깨지지 않게** 하는 장치
--    analytics_manual : 손으로 넣는 값(플레이 전환율·처음 실행률·쇼핑 차트 순위). 자동값이 없을 때만 쓴다
--
--  쓰기: GitHub Actions 가 서비스 키로 PostgREST upsert (RLS 우회 — service_role)
--  읽기: 관리자만 — analytics_overview() SECURITY DEFINER + is_app_admin()
--  ⚠ anon·authenticated 는 표도 함수도 못 본다(손님용 아님). ops_status_68.sql 과 같은 규칙.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.analytics_daily (
  day        date        not null,
  source     text        not null,              -- ga4 | play | apple
  metric     text        not null,              -- active_users, sessions, device_installs, downloads …
  dim        text        not null default '',   -- channel:네이버 / source:chatgpt.com / type:first …
  value      numeric     not null,
  updated_at timestamptz not null default now(),
  primary key (day, source, metric, dim)
);
create index if not exists analytics_daily_day_idx on public.analytics_daily (day desc);

create table if not exists public.analytics_meta (
  source     text primary key,                  -- ga4 | play | apple
  status     text not null default '미설정',     -- ok | stale | 미설정 | 오류
  note       text,
  last_ok_at timestamptz,
  last_try_at timestamptz,
  detail     jsonb not null default '{}'::jsonb   -- 마지막 실행에서 얻은 부가 정보(리포트 이름·버킷 목록 등)
);

create table if not exists public.analytics_manual (
  id         text primary key,                  -- play_console | app_store | web_note
  as_of      date,                              -- 그 값이 어느 날 기준인지(반드시 화면에 찍는다)
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.analytics_daily  enable row level security;
alter table public.analytics_meta   enable row level security;
alter table public.analytics_manual enable row level security;
revoke all on public.analytics_daily, public.analytics_meta, public.analytics_manual from public, anon, authenticated;

-- ── 관리자용 한 방 조회 ─────────────────────────────────────────────
--   admin.html 은 이 함수 하나만 부른다(카드 5블록 + 신선도). 실패해도 예외를 던지지 않고
--   빈 구조를 돌려준다 → 화면이 '—' 로 뜨고 사유는 meta 에 남는다.
create or replace function public.analytics_overview(p_days integer default 28)
returns jsonb
language plpgsql stable security definer set search_path = 'public' as $$
declare
  d0 date := (now() at time zone 'Asia/Seoul')::date;
  p  integer := greatest(1, least(coalesce(p_days, 28), 120));
  v_web jsonb; v_and jsonb; v_ios jsonb; v_cvr jsonb;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;

  -- ① 웹 (GA4)
  select jsonb_build_object(
    'd1',       coalesce((select value from analytics_daily where source='ga4' and metric='active_users' and dim='' and day = d0 - 1), 0),
    'd2',       coalesce((select value from analytics_daily where source='ga4' and metric='active_users' and dim='' and day = d0 - 2), 0),
    'users7',   coalesce((select sum(value) from analytics_daily where source='ga4' and metric='active_users' and dim='' and day > d0 - 8 and day <= d0 - 1), 0),
    'views7',   coalesce((select sum(value) from analytics_daily where source='ga4' and metric='page_views'  and dim='' and day > d0 - 8 and day <= d0 - 1), 0),
    'series',   coalesce((select jsonb_agg(jsonb_build_object('day', day, 'v', value) order by day)
                            from analytics_daily where source='ga4' and metric='active_users' and dim='' and day > d0 - p), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('dim', replace(dim,'channel:',''), 'v', v) order by v desc)
                            from (select dim, sum(value) v from analytics_daily
                                   where source='ga4' and metric='sessions' and dim like 'channel:%' and day > d0 - p
                                   group by dim order by 2 desc limit 6) t), '[]'::jsonb),
    'ai',       coalesce((select jsonb_agg(jsonb_build_object('dim', replace(dim,'source:',''), 'v', v) order by v desc)
                            from (select dim, sum(value) v from analytics_daily
                                   where source='ga4' and metric='sessions' and dim like 'source:%' and day > d0 - p
                                   group by dim order by 2 desc limit 6) t), '[]'::jsonb)
  ) into v_web;

  -- ② 안드로이드 (Play 벌크)
  select jsonb_build_object(
    'installs28', coalesce((select sum(value) from analytics_daily where source='play' and metric='device_installs'   and dim='' and day > d0 - p), 0),
    'uninst28',   coalesce((select sum(value) from analytics_daily where source='play' and metric='device_uninstalls' and dim='' and day > d0 - p), 0),
    'last_day',   (select max(day) from analytics_daily where source='play'),
    'last_active',(select value from analytics_daily where source='play' and metric='active_device_installs' and dim=''
                    order by day desc limit 1),
    'series',     coalesce((select jsonb_agg(jsonb_build_object('day', day, 'v', value) order by day)
                              from analytics_daily where source='play' and metric='device_installs' and dim='' and day > d0 - 62), '[]'::jsonb)
  ) into v_and;

  -- ③ 애플 (App Store Connect)
  select jsonb_build_object(
    'first28', coalesce((select sum(value) from analytics_daily where source='apple' and metric='downloads' and dim='type:first'      and day > d0 - p), 0),
    'redl28',  coalesce((select sum(value) from analytics_daily where source='apple' and metric='downloads' and dim='type:redownload' and day > d0 - p), 0),
    'imp28',   coalesce((select sum(value) from analytics_daily where source='apple' and metric='impressions' and dim='' and day > d0 - p), 0),
    'ppv28',   coalesce((select sum(value) from analytics_daily where source='apple' and metric='page_views'  and dim='' and day > d0 - p), 0),
    'last_day',(select max(day) from analytics_daily where source='apple'),
    'series',  coalesce((select jsonb_agg(jsonb_build_object('day', day, 'v', value) order by day)
                           from analytics_daily where source='apple' and metric='downloads' and dim='type:first' and day > d0 - p), '[]'::jsonb),
    'rank',    (select payload -> 'chart_rank' from analytics_manual where id='app_store')
  ) into v_ios;

  -- ④ 웹→앱 전환 (참고치 — 정확한 퍼널이 아니다. 화면에도 그렇게 적는다)
  select jsonb_build_object(
    'cta28',    coalesce((select sum(value) from analytics_daily where source='ga4' and metric='app_cta' and day > d0 - p), 0),
    'dl28',     coalesce((select sum(value) from analytics_daily where source='apple' and metric='downloads' and dim='type:first' and day > d0 - p), 0)
              + coalesce((select sum(value) from analytics_daily where source='play'  and metric='device_installs' and day > d0 - p), 0)
  ) into v_cvr;

  return jsonb_build_object(
    'ok', true, 'today', d0, 'days', p,
    'web', v_web, 'android', v_and, 'apple', v_ios, 'cvr', v_cvr,
    'manual', coalesce((select jsonb_object_agg(id, jsonb_build_object('as_of', as_of, 'payload', payload)) from analytics_manual), '{}'::jsonb),
    'meta', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'status', status, 'note', note,
                                                          'last_ok_at', to_char(last_ok_at at time zone 'Asia/Seoul','MM-DD HH24:MI'),
                                                          'last_try_at', to_char(last_try_at at time zone 'Asia/Seoul','MM-DD HH24:MI'))
                            order by source) from analytics_meta), '[]'::jsonb),
    'served_at', to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI')
  );
end $$;
revoke all on function public.analytics_overview(integer) from public, anon;
grant execute on function public.analytics_overview(integer) to authenticated;
-- ↑ 관리자 화면은 로그인한 사용자(authenticated) JWT 로 부른다. 권한 판정은 함수 안의 is_app_admin() 이 한다.
--   (ops_status_68.sql 과 같은 규칙 — "명시 grant 는 authenticated 에만". 손님은 로그인 자체를 못 한다)
```

### 5-2. 적용 방법 (PC)

```powershell
$CLI = "C:/Users/FAMILY/supabase-cli/supabase.exe"
& $CLI db query --linked --output-format json -f supabase/sql/analytics_daily_183.sql
# 확인
& $CLI db query --linked --output-format json -f tools/analytics/check_schema.sql
```

`tools/analytics/check_schema.sql` 을 새로 만든다(검증 V1 이 쓴다):

```sql
select 'analytics_daily' t, count(*) n from information_schema.columns where table_schema='public' and table_name='analytics_daily'
union all select 'analytics_meta', count(*) from information_schema.columns where table_schema='public' and table_name='analytics_meta'
union all select 'analytics_manual', count(*) from information_schema.columns where table_schema='public' and table_name='analytics_manual'
union all select 'rpc', count(*) from pg_proc where proname='analytics_overview';
-- 기대: 5 / 6 / 4 / 1
```

- **반복 실행 안전**: 전부 `if not exists` / `create or replace` 다. 두 번 돌려도 같다.
- **되돌리기**: `drop function if exists public.analytics_overview(integer); drop table if exists public.analytics_daily, public.analytics_meta, public.analytics_manual;` — 기존 표를 참조하지 않으므로 다른 기능에 영향 0.

---

## 6. [B] 수집 스크립트 — `tools/analytics/collect.mjs` (+ `lib.mjs`, `apple.mjs`, `play.mjs`)

### 6-1. 공통 규칙

- **의존성 0**: `node:crypto`·`node:zlib`·`node:fs`·`node:path` + 전역 `fetch`(Node 20+).
- 실행 인자: `node tools/analytics/collect.mjs [--only ga4|play|apple] [--days 28] [--dry]`
  - `--dry`: API 를 부르지 않고 **환경변수 점검표만** 출력(키 있음/없음, 버킷·속성ID 형식). 종료코드 0.
- 종료코드: **항상 0** (부분 실패 포함). 실패는 `analytics_meta.status='오류'` + `note` 에 남긴다 — 워크플로가 빨간 X 로 죽으면 사장님이 "또 고장"으로 읽는다. 단 `--strict` 를 주면 하나라도 실패 시 1(검증용).
- 저장: PostgREST upsert.
  ```
  POST {SB_URL}/rest/v1/analytics_daily?on_conflict=day,source,metric,dim
  headers: apikey/Authorization: SB_SERVICE_KEY, Prefer: resolution=merge-duplicates,return=minimal
  body: [{day,source,metric,dim,value}, …]
  ```
  `analytics_meta` 도 `on_conflict=source` 로 upsert.
- 배치: 한 번에 500행 이하로 나눈다.
- 오늘 날짜 계산은 **KST**로: `new Date(Date.now()+9*3600e3).toISOString().slice(0,10)`.
- 로그: 소스마다 `✅/⏭️/🔴 소스 · 행 N개 · 사유` 한 줄. **키 값은 절대 출력 금지.**

### 6-2. 안전 폴백 (이 오더의 핵심 요구)

소스마다 아래 순서로 판단한다:

| 상황 | 할 일 | `analytics_meta` |
| --- | --- | --- |
| 환경변수 없음 | 그 소스 **건너뜀**(다른 소스는 계속) | `status='미설정'`, note=`GA4_SA_KEY 없음` |
| 인증 실패(401/403) | 건너뜀 | `status='오류'`, note=`403 PERMISSION_DENIED — GA4 속성에 뷰어 추가 필요` |
| 응답은 왔는데 0행 | 정상으로 본다 | `status='ok'`, note=`0행(신규 데이터 없음)` |
| 성공 | upsert | `status='ok'`, `last_ok_at=now()` |
| 마지막 성공이 36시간 초과 | 건드리지 않음(화면이 판단) | `status='stale'` (RPC 가 계산하거나 스크립트가 표기) |

**키가 0개인 오늘 상태에서 `node tools/analytics/collect.mjs` 를 돌리면**: `미설정` 3줄이 `analytics_meta` 에 남고 exit 0 → 어드민 탭은 「미설정」 칩 + 수동 입력값으로 **정상 렌더**된다. 이게 V3 이다.

### 6-3. GA4 (`ga4.mjs`)

```js
// ① 서비스 계정 JSON → 액세스 토큰 (RS256, 의존성 0)
const sa = JSON.parse(Buffer.from(process.env.GA4_SA_KEY, 'base64').toString('utf8'));
// base64 가 아니면 원문 JSON 으로 한 번 더 시도(붙여넣기 사고 대비)
const now = Math.floor(Date.now()/1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsigned = b64({alg:'RS256',typ:'JWT'}) + '.' + b64({
  iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/devstorage.read_only',
  aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
// POST https://oauth2.googleapis.com/token  grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<unsigned.sig>
```

- 토큰은 **GA4 와 Play 가 같이 쓴다**(scope 두 개를 한 토큰에). 함수 `googleToken()` 을 `lib.mjs` 에 두고 두 소스가 부른다.
- G1~G5 는 §4-1 표 그대로 `runReport` 로 호출. `dimensionValues[0].value`·`metricValues[i].value` 는 **문자열**이므로 `Number()` 로 바꾼다.
- G1 저장: `metric='active_users'`(activeUsers)·`'total_users'`·`'sessions'`·`'page_views'`, `dim=''`, 날짜별.
- G2: `metric='sessions'`, `dim='channel:'+sessionDefaultChannelGroup`.
- G3: `metric='sessions'`, `dim='source:'+sessionSource`, §4-1 허용 목록만.
- G4: `metric='app_cta'`, `dim='place:all'`, 날짜별 eventCount 합.
- G5: `metric='os_mix'`, `dim='os:'+operatingSystem` / `'browser:'+browser` — **로그에 상위 10개를 찍어** 앱 분리 가능성을 사람이 판단하게 한다(카드에는 쓰지 않는다).
- `date` 응답은 `YYYYMMDD` → `YYYY-MM-DD` 로 바꿔 저장.

### 6-4. Play (`play.mjs`)

1. `GET https://storage.googleapis.com/storage/v1/b/{PLAY_BUCKET}/o?prefix=stats/&fields=items(name,updated)&maxResults=1000` (Bearer 토큰)
   - 로그: `stats/` 아래 **폴더 목록**을 그대로 출력(1회차 확인용).
2. 대상 파일: `stats/installs/installs_{pkg}_` 로 시작하고 최근 **2개월** 것. `_overview.csv` 가 있으면 그것만, 없으면 `_country.csv` 등 **차원 파일을 날짜별로 합산**(중복 합산 주의 — 차원 파일 여러 개를 동시에 더하면 두 배가 된다. overview 우선, 없을 때만 **한 차원**(country)만).
3. 다운로드: `GET .../o/{encodeURIComponent(name)}?alt=media` → `Buffer` → **`buf.toString('utf16le')`** 후 선두 BOM(`\uFEFF`) 제거.
4. CSV 파싱: 따옴표 처리하는 간단 파서(쉼표 포함 필드 대비). 헤더 이름으로 컬럼을 찾는다(**순서 가정 금지**).
   - `Date`(YYYY-MM-DD) · `Daily Device Installs` · `Daily Device Uninstalls` · `Installs on active devices`(또는 `Active Device Installs`) · `Current Device Installs` · `Daily User Installs` · `Total User Installs`
   - **없는 헤더는 그 지표를 건너뛰고 로그에 남긴다**(구글이 컬럼을 바꿀 수 있다).
5. 저장: `metric='device_installs'/'device_uninstalls'/'active_device_installs'/'current_device_installs'/'user_installs'`, `dim=''`, 날짜별.
6. `stats/retained_installers` 가 **실제로 있으면** 같은 방식으로 `metric='retained_installers'` 저장. **없으면 만들지 말고 로그만.**

### 6-5. Apple (`apple.mjs`)

```js
// ES256 JWT (asc.py 와 동일 규격, 의존성 0)
const key = process.env.APPLE_API_KEY_P8;           // BEGIN/END 사이만 잘라 쓴다
const now = Math.floor(Date.now()/1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsigned = b64({alg:'ES256',kid:process.env.APPLE_API_KEY_ID,typ:'JWT'}) + '.' + b64({
  iss: process.env.APPLE_API_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
const sig = crypto.createSign('SHA256').update(unsigned).sign({key, dsaEncoding:'ieee-p1363'}, 'base64url');
```

1. `GET /v1/apps/6826126083/analyticsReportRequests` — 로그에 각 요청의 `accessType`·`stoppedDueToInactivity` 출력.
2. `ONGOING` 이 없으면 **1건만 생성**: `POST /v1/analyticsReportRequests` body
   `{"data":{"type":"analyticsReportRequests","attributes":{"accessType":"ONGOING"},"relationships":{"app":{"data":{"type":"apps","id":"6826126083"}}}}}` → 201 이면 `미설정 → ok(요청 생성, 첫 리포트 24~48h)` 로 meta 에 남기고 **오늘은 종료**.
3. `GET /v1/analyticsReportRequests/{id}/reports` → `attributes.name` 을 **전부 로그로 출력**하고, `App Downloads`·`App Store Discovery and Engagement` 를 이름으로 매칭. **이름이 다르면 가장 비슷한 것을 로그에 적고 사람에게 넘긴다**(추측 하드코딩 금지).
4. 각 리포트: `GET …/reports/{rid}/instances?filter[granularity]=DAILY&filter[processingDate]={최근 3일}` (첫 회차는 `--days 28` 만큼). 인스턴스가 없으면 로그만.
5. `GET …/instances/{iid}/segments` → `attributes.url` 다운로드 → `zlib.gunzipSync` → TSV 파싱(탭 구분, 첫 줄 헤더).
6. 집계:
   - App Downloads: `Download Type` 별 `Counts` 합 → `metric='downloads', dim='type:first'|'type:redownload'`
   - Discovery/Engagement: `Event=Impression` 인 `Counts` → `metric='impressions', dim=''` / `Unique Counts` → `metric='impressions_unique', dim=''` / `Event=Page view` `Counts` → `metric='page_views'`
   - 전환율은 **저장하지 않고 RPC 계산식**으로 화면에서 낸다(원본만 쌓는다).
7. **차트 순위**: `https://itunes.apple.com/kr/rss/topfreeapplications/limit=100/genre=6024/json` 을 받아 `6826126083` 의 1-based 위치를 찾는다. 있으면 `analytics_manual(id='app_store')` 의 `chart_rank` 를 `{rss_rank, checked_at, source:'rss'}` 로 덮어쓴다. 없으면 `{rss_rank:null}`. **기존 수동 `chart_rank`(사람이 본 #194)는 지우지 말고 `manual_rank` 필드로 보존**한다.

### 6-6. 로그 위생

```js
const redact = (s) => String(s||'').replace(/eyJ[A-Za-z0-9._-]{20,}/g,'<jwt>')
  .replace(/-----BEGIN[\s\S]*?-----END[^-]*/g,'<key>').replace(/[A-Za-z0-9_-]{40,}/g,'<token>');
```
`catch(e)` 마다 `redact(e.message).slice(0,300)` 만 남긴다.

---

## 7. [C] 워크플로 — `.github/workflows/analytics-daily.yml`

### 7-1. 파일 전문

```yaml
# 웹(GA4)·안드로이드(Play)·애플(App Store) 통합 지표 수집 — 매일 아침 (2026-11-23)
#   · 저장소에 아무것도 커밋하지 않는다(Supabase 에만 쓴다) → 배포·용량·backup/last-good 에 영향 0
#   · 키가 없어도 잡은 성공한다(각 소스 '미설정' 으로 남김) → 화면은 수동값으로 계속 뜬다
#   · 비용 0원: 공개 저장소 Actions + 각 API 무료 범위
#   · 시크릿: GA4_SA_KEY(base64 또는 JSON 원문) · GA4_PROPERTY_ID · PLAY_BUCKET · SUPABASE_SERVICE_KEY
#             APPLE_API_KEY_ID · APPLE_API_ISSUER_ID · APPLE_API_KEY_P8  ← 이미 등록돼 있음
name: 통합 지표 수집 (웹·앱)

on:
  schedule:
    - cron: '40 23 * * *'      # UTC 23:40 = KST 08:40 (사장님 아침 확인 시각 앞)
  workflow_dispatch:
    inputs:
      only:
        description: 'ga4 | play | apple (비우면 셋 다)'
        required: false
        default: ''
      days:
        description: '며칠치'
        required: false
        default: '28'

permissions:
  contents: read          # ⚠ write 아님 — 커밋하지 않는다

concurrency:
  group: analytics-daily
  cancel-in-progress: false

jobs:
  collect:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      # 의존성 설치 단계가 없다 — 스크립트는 node: 내장 모듈만 쓴다(§6-1)

      - name: 키 점검 (값은 절대 출력하지 않는다)
        run: node tools/analytics/collect.mjs --dry

      - name: 수집
        env:
          SB_URL: https://hycaqsqeogjtbscmzrtm.supabase.co
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          GA4_SA_KEY: ${{ secrets.GA4_SA_KEY }}
          GA4_PROPERTY_ID: ${{ secrets.GA4_PROPERTY_ID }}
          PLAY_BUCKET: ${{ secrets.PLAY_BUCKET }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER_ID: ${{ secrets.APPLE_API_ISSUER_ID }}
          APPLE_API_KEY_P8: ${{ secrets.APPLE_API_KEY_P8 }}
        run: |
          ARGS="--days ${{ inputs.days || '28' }}"
          if [ -n "${{ inputs.only }}" ]; then ARGS="$ARGS --only ${{ inputs.only }}"; fi
          node tools/analytics/collect.mjs $ARGS

      - name: 결과 요약
        if: always()
        run: node tools/analytics/collect.mjs --report
```

- `--report`: Supabase 에서 `analytics_meta` 를 읽어 **표로** 출력(`GITHUB_STEP_SUMMARY`). 사장님이 액션 화면만 열어도 어느 소스가 살아 있는지 보이게.
- **워크플로 이름을 바꾸지 않는다** — 나중에 `deploy-pages.yml` 의 `workflow_run` 목록에 넣을 수 있게 이름을 고정한다(이번엔 넣지 않는다: 커밋을 안 하므로 배포 재트리거가 무의미).
- `schedule` 은 UTC 기준이다. **`40 23`** 을 `40 8` 로 바꾸지 말 것(그건 KST 17:40 이다).

### 7-2. 수동 실행

```bash
gh workflow run "통합 지표 수집 (웹·앱)" -f only=ga4 -f days=28
gh run watch
```

---

## 8. [D] `admin.html` — `📊 통합 지표` 탭 (덧붙이기만)

### 8-1. 삽입 지점 4곳 (앵커 문자열로 찾는다 — 행번호는 밀린다)

| # | 위치(앵커) | 넣을 것 |
| --- | --- | --- |
| 1 | `<div class="tab" onclick="switchTab('stats',this)">통계</div>` **바로 뒤** | `<div class="tab" onclick="switchTab('an',this)">📊 통합 지표</div>` |
| 2 | `<div id="statsView" style="display:none;padding-bottom:80px">` **바로 앞** | `<div id="anView" style="display:none;padding-bottom:80px"> … </div>` (§8-2) |
| 3 | `switchTab` 안 뷰 숨김 배열 `'inqView','memberView','adperfView','attendView','homeView']` | `… ,'attendView','homeView','anView']` |
| 4 | `switchTab` 의 `if(tab==='stats'){` **바로 앞** | `if(tab==='an'){ document.getElementById('anView').style.display='block'; loadAnalytics(); return; }` |

**그 외 `switchTab` 본문·다른 분기는 손대지 않는다.**

### 8-2. `#anView` 구조 (카드 5블록)

모든 스타일은 `#anView` 하위로 스코프(예: `#anView .anc{…}`). 전역 클래스 재정의 금지.

```
[헤더 줄]  📊 통합 지표   ·  「자동 갱신: 매일 08:40 KST · 지금 볼 값: 마지막 수집 11-23 08:41」
           [🔄 새로고침] [⚙️ 지금 수집(GitHub Actions 열기)]

[신선도 줄]  소스 3칩:  GA4 ●ok(11-23 08:41)   PLAY ●ok(11-20)   APPLE ●미설정
             상태색: ok=초록 / stale=주황 / 미설정·오류=회색·빨강. 눌러서 사유(note) 툴팁.

① 웹 (GA4)                          ← adminRpc('analytics_overview')
   [어제 활성 사용자][전일 대비 %][7일 활성 합][7일 조회수]
   · 28일 활성 사용자 막대그래프(작게)
   · 유입 채널 상위 6 (가로 막대) — 네이버·직접·검색·AI 구분해서 강조
   · AI·검색 유입 상위 6 (source: chatgpt.com·perplexity.ai …)
   · 각주: 「웹 방문자 기준 · D-1까지 · 자체 방문 통계(통계 탭)와 출처가 다름」

② 안드로이드 (Google Play)
   [최근 28일 기기 획득][28일 삭제][최근 활성 설치][처음 실행률*]
   · 최근 완료월 일별 설치 막대(최대 62일)
   · 각주: 「플레이 콘솔 벌크 리포트 · 월마감 +3~7일 지연 · 마지막 데이터 {last_day}」
   · *처음 실행률·전환율은 콘솔에만 있어요 → 수동 입력값(기준일 표기)

③ 애플 (App Store)
   [28일 최초 다운로드][재다운로드][노출][제품 페이지 조회]
   · 전환율 = (최초+재다운로드) ÷ 고유노출 → 2자리 %
   · 28일 최초 다운로드 막대
   · 쇼핑 차트 순위: 수동값(기준일) / RSS 100위 안이면 「RSS 확인: N위」
   · 각주: 「App Store Connect Analytics · 데이터 완성 D-2」

④ 웹→앱 전환 (참고)
   [앱 CTA 클릭 28일][다운로드 합 28일][클릭→설치 비율]
   · 각주: 「정확한 퍼널이 아니에요 — CTA 는 웹에서만, 다운로드는 스토어 집계라 시점·중복이 다름」

⑤ 데이터 신선도 표
   소스 | 상태 | 마지막 성공 | 마지막 시도 | 사유
```

### 8-3. JS 명세

```js
let _anBusy = false;
async function loadAnalytics(force){
  if(_anBusy && !force) return; _anBusy = true;
  const box = document.getElementById('anView'); if(!box) return;
  box.querySelector('#anBody').innerHTML = '<div class="anmuted">불러오는 중…</div>';
  try{
    const d = await adminRpc('analytics_overview', { p_days: 28 });
    renderAnalytics(d || {});
  }catch(e){
    // 카드 전체를 지우지 않는다 — 수동값은 살아 있어야 한다(§6-2 폴백)
    box.querySelector('#anBody').innerHTML =
      '<div class="anerr">지표를 불러오지 못했어요 (' + String(e.message||e).slice(0,80) + ')<br>관리자 로그인이 풀렸을 수 있어요. 새로고침 해 주세요.</div>';
  }
  _anBusy = false;
}
function _anNum(v){ const n = Number(v); return isFinite(n) ? (n>=10000 ? (n/10000).toFixed(1)+'만' : n.toLocaleString('ko-KR')) : '—'; }
function _anPct(cur, prev){ if(!prev) return '—'; const d = Math.round((cur-prev)/prev*100); return (d>=0?'▲':'▼')+Math.abs(d)+'%'; }
function _anChip(m){ /* status → {txt,color} */ }
function renderAnalytics(d){ /* ①~⑤ 렌더. 값이 없으면 '—' + 사유 */ }
```

- **`adminRpc` 말고 다른 통신을 만들지 않는다** (§1-1).
- 갱신된 값이 없으면(오늘 아직 수집 전) **어제 값 + 「기준 11-22」** 로 보여준다. 빈 화면 금지.
- 탭을 다시 누르면 `loadAnalytics()` 가 재조회한다(캐시 없음 — RPC 가 가볍다).
- 「⚙️ 지금 수집」 은 `https://github.com/wonji2/momcalendar/actions/workflows/analytics-daily.yml` 을 새 창으로 연다(GitHub 토큰을 admin.html 에 넣지 않는다 — 공개 저장소다).

### 8-4. 같이 고치는 1줄 (깨진 링크)

`admin.html` **1008행**:
`https://analytics.google.com/analytics/web/#/p$(GA_PROP)/reports/reportinghub`
→ 속성 ID 를 **모르면 지금 고치지 말고**, `onclick="this.href='https://analytics.google.com/analytics/web/'"` 로 **깨진 경로만 제거**한다. 속성 ID 를 알게 되면(§11-2) 그때 `#/p{숫자}/` 로 채운다. **추측 숫자를 넣지 않는다.**

---

## 9. [E] 시드·폴백 — 키가 0개인 지금도 화면이 의미 있게

SQL 적용 직후 아래를 한 번 넣는다(`supabase/sql/analytics_seed_184.sql` 로 커밋, A 커밋에 함께):

```sql
insert into public.analytics_manual(id, as_of, payload) values
 ('play_console', '2026-11-23', '{"window":"28d","device_installs":818,"retained_installs":785,"first_open":431,
   "first_open_rate":52.7,"mau":689,"store_cvr":90.99,"review_count":0,
   "source":"플레이 콘솔 직접 확인(자비스 2026-11-23)","note":"벌크 CSV 자동수집 전까지 이 값을 쓴다"}'::jsonb),
 ('app_store', '2026-11-23', '{"chart_rank":194,"chart":"쇼핑","source":"App Store 차트 직접 확인(2026-11-23)",
   "note":"iTunes RSS 는 100위까지만 준다 — 194위는 RSS 로 확인 불가"}'::jsonb),
 ('seed_web', '2026-11-22', '{"window":"7d(11/15~21)","total_users":19000,"active_users":17000,"views":42000,
   "naver_mobile":7200,"chatgpt":624,"source":"11-22 아침 브리핑 GA4 화면"}'::jsonb)
on conflict (id) do update set as_of=excluded.as_of, payload=excluded.payload, updated_at=now();
```

- 화면 규칙: 자동값(`analytics_daily`)이 있으면 **자동값 + 「자동 · D-1」**. 없으면 **수동값 + 「수동 · 기준 11-23」**.
- **수동값을 자동값처럼 보이게 하지 않는다.** 라벨은 회색 작은 글씨가 아니라 **값 옆에 붙는 칩**으로.
- 자동 수집이 살아난 뒤에도 `analytics_manual` 은 지우지 않는다(비교·추세 확인용).

---

## 10. 검증 — V1~V14 를 실제로 돌리고 결과를 표로 보고한다

| # | 검증 | 명령 | 통과 기준 |
| --- | --- | --- | --- |
| V1 | 스키마 | `supabase db query --linked --output-format json -f tools/analytics/check_schema.sql` | 5 / 6 / 4 / 1 |
| V2 | 권한(손님 차단) | `curl -s -o /dev/null -w "%{http_code}" "$SB/rest/v1/analytics_daily?select=day&limit=1" -H "apikey: <공개키>"` | **401/403/404** (200 이면 실패) |
| V3 | 권한(관리자) | 어드민 로그인 후 콘솔 `await adminRpc('analytics_overview',{p_days:28})` | `ok:true` + `meta` 3줄 |
| V4 | 키 0개 폴백 | `node tools/analytics/collect.mjs` (키 환경변수 비운 채) | **exit 0** · `미설정` 3줄 · 예외 없음 |
| V5 | GA4 단위 | `node tools/analytics/collect.mjs --only ga4 --dry` | 속성ID 형식·키 유무만 출력, 값 노출 0 |
| V6 | Play CSV 파서 | `node --test tools/analytics/test_play_parse.mjs` (UTF-16 fixture) | 표본 3행의 날짜·설치 수가 기대와 일치 |
| V7 | Apple JWT | `node tools/analytics/apple.mjs --check` (기존 키로 `GET /v1/apps/6826126083`) | 200 · 앱 이름 출력 |
| V8 | Apple 리포트 요청 | 위 `--check` 뒤 `analytics_meta.apple` | `ok(요청 생성, 첫 리포트 24~48h)` 또는 `ok(기존 요청 사용)` |
| V9 | 워크플로 문법 | `node -e "require('fs').readFileSync('.github/workflows/analytics-daily.yml','utf8')"` + `gh workflow list \| grep 통합` | 목록에 보이고 **비활성/오류 아님** |
| V10 | 어드민 회귀 | 로그인 후 8개 탭(홈·전체·핫딜·배너·이웃셀러·출석·통계·**통합 지표**) 클릭 | 콘솔 에러 0 · 기존 탭 데이터 그대로 |
| V11 | 기존 기능 불변 | `git diff --stat` 로 admin.html | **추가 줄만**(삭제 줄 0~2, §8-4 1줄 외) |
| V12 | 크기 | `wc -c admin.html` | 677,449 → **+40KB 이내** |
| V13 | 배포 게이트 | `bash tools/deploy_gate_check.sh` | 통과 · 사이트 MB ≤1,200 |
| V14 | 파일 수 | `git ls-files \| wc -l` | **54,825 이상**(줄지 않으면 실패로 보고) |

추가(V14 뒤): 라이브 `https://momcalendar.com/admin.html` **200** · 로그인 후 통합 지표 탭 노출 · 첫 값 또는 `미설정` 이 보임.

---

## 11. 사람 몫 — 길아 님이 직접 해야 하는 것 (순서대로)

> 이 4개만 하면 자동 수집이 살아난다. **애플은 이미 되어 있어서 할 게 없다.**

### 11-1. 구글 서비스 계정 1개 (GA4 + Play 공용)

1. <https://console.cloud.google.com/> → 상단 프로젝트 선택 → **새 프로젝트** `momcal-analytics`
2. **API 및 서비스 > 라이브러리** →
   - `Google Analytics Data API` → **사용 설정**
   - `Cloud Storage` → **사용 설정**
3. **IAM 및 관리 > 서비스 계정 > 서비스 계정 만들기**
   - 이름 `momcal-analytics` → 만들기 → 역할은 **비워 둔다**(GA4·Play 권한은 각 제품에서 준다)
4. 그 계정 → **키 > 키 추가 > 새 키 만들기 > JSON** → 파일이 내려받아진다
5. 그 JSON 을 GitHub Secret 에 넣는다:
   - `wonji2/momcalendar` → Settings > Secrets and variables > Actions > New repository secret
   - 이름 **`GA4_SA_KEY`** · 값 = **JSON 파일 내용 전체**(또는 `base64 -w0 키.json`)
   - ⚠ 파일을 작업 폴더·저장소에 두지 않는다(공개 저장소다)

### 11-2. GA4 속성 ID + 서비스 계정 초대 (2분)

1. <https://analytics.google.com/> → 좌하단 **관리(톱니)** → **속성 설정** → **속성 ID**(숫자 9~10자리) 복사
2. GitHub Secret **`GA4_PROPERTY_ID`** = 그 숫자 (예: `123456789`)
   - ⚠ `G-NRCP2FVRSB`(측정 ID)를 넣으면 **400** 이다
3. GA4 **관리 > 속성 액세스 관리 > 사용자 추가** → 서비스 계정 이메일(`momcal-analytics@….iam.gserviceaccount.com`) → 역할 **뷰어** → 추가
4. (덤) 그 숫자를 자비스에게 알려 주면 admin.html 의 「Google Analytics 열기」 **깨진 링크**도 같이 고친다(§8-4)

### 11-3. Play Console 초대 + 버킷 주소

1. <https://play.google.com/console> → **사용자 및 권한 > 새 사용자 초대** → 서비스 계정 이메일 입력
2. 앱 권한: **앱 정보 보기 = 전체(Global)** · 재무 데이터는 **주지 않는다**
3. **앱 보고서 > 통계(다운로드 보고서)** 화면에서 **「Cloud Storage URI 복사」** → `pubsite_prod_rev_...` 형태
4. GitHub Secret **`PLAY_BUCKET`** = 그 URI 의 **버킷 이름만**(`gs://`·경로 제외)

### 11-4. 애플 — **할 것 없음(확인만)**

1. App Store Connect > **사용자 및 액세스 > 통합(Integrations) > App Store Connect API** 에서 지금 쓰는 키(`APPLE_API_KEY_ID`)의 역할이 **Admin** 인지 확인
   - Admin 이면: **아무것도 만들지 않는다.** 수집기가 ONGOING 요청을 스스로 만들고 24~48시간 뒤 데이터가 뜬다
   - Admin 이 아니면(403): 그때만 Admin 키를 새로 만들어 `APPLE_API_KEY_ID`·`APPLE_API_ISSUER_ID`·`APPLE_API_KEY_P8` 세 개를 갱신 — **이건 ios 빌드도 같이 쓰는 키라 반드시 자비스에게 먼저 알린다**
2. (선택) 2024-01-01 부터 과거 데이터: 수집기에 `--snapshot` 을 주면 `ONE_TIME_SNAPSHOT` 요청을 1건 만든다. 안 해도 앞으로는 쌓인다

### 11-5. 등록 확인 (자비스가 대신 확인 가능)

```bash
gh secret list -R wonji2/momcalendar | grep -E "GA4_|PLAY_BUCKET|APPLE_|SUPABASE_SERVICE"
```

---

## 12. 되돌리기

| 무엇을 | 어떻게 | 영향 |
| --- | --- | --- |
| 어드민 탭(D) | 그 커밋만 revert | 다른 관리 기능·라이브 손님 화면 **영향 0** |
| 워크플로(C) | 파일 삭제 커밋 | 수집 중단. 표는 그대로 |
| 표·RPC(A) | `drop function/table` (§5-2) | 이 기능만 사라짐. 다른 표 참조 없음 |
| 애플 리포트 요청 | App Store Connect API 로 `DELETE /v1/analyticsReportRequests/{id}` | 읽기용 요청이라 스토어에 영향 없음 |

**절대 하지 않는 되돌리기**: `git reset --hard`·force-push·`backup/last-good` 조작. 되돌릴 땐 새 커밋을 얹는다(`tools/emergency_restore.sh` 원칙).

---

## 13. 커밋 나누기 · 보고 양식

```
A) supabase/sql/analytics_daily_183.sql · analytics_seed_184.sql · tools/analytics/check_schema.sql
B) tools/analytics/collect.mjs · lib.mjs · ga4.mjs · play.mjs · apple.mjs · test_play_parse.mjs · fixtures/
C) .github/workflows/analytics-daily.yml
D) admin.html (탭 1줄 + anView + switchTab 2곳 + JS 블록 + 스코프 CSS)
```
- D 는 **V9~V12 를 통과한 뒤에만** 올린다(라이브 파일이다).
- 커밋 메시지 예: `📊 통합 지표 A: analytics_daily/meta/manual 표 + analytics_overview RPC`
- 각 커밋 뒤 `git ls-files | wc -l` 이 줄지 않았는지 확인(§CLAUDE.md 규칙 2).

**보고는 이 표로** (노션 「💬 자비스 ↔ 클코 소통란」에 그대로 붙여도 된다):

| 항목 | 결과 |
| --- | --- |
| 커밋 SHA (A/B/C/D) | |
| V1~V14 | 각 줄 통과/실패 + 실제 출력값 |
| `analytics_meta` 현재 상태 | ga4 / play / apple 각각 |
| 첫 화면에서 보이는 값 | 웹 · 안드로이드 · 애플 카드에 실제로 뜬 숫자(또는 `미설정`·`—`) |
| 사람 몫에서 막힌 것 | 어떤 키가 없어서 어느 카드가 비었는지 |
| 손대지 않은 것 확인 | `index.html` diff 0 · 기존 탭 8개 정상 |

---

## 14. 다음 오더로 넘길 것(이번에 하지 않는다)

1. **iOS 앱 세션 분리** — `ios-app/capacitor.config.json` 에 `appendUserAgent` 추가는 **바이너리 재빌드**가 필요하다(11-23 오더 §4-3 이 판정 중). 그때 GA4 로 iOS 앱 사용자가 갈리면 이 탭 ①에 「앱 사용자」 카드를 추가한다.
2. **플레이 스토어 방문자·전환율 자동화** — CSV 에 없다. 필요하면 Play Console 통계의 수동 CSV 내려받기를 `data/play_manual.csv` 로 두고 수집기가 읽게 한다(사람이 월 1회).
3. **알림 연동** — 수집이 3일 연속 실패하면 아침 브리핑 `daily/_alert.txt` 에 한 줄. 지금은 어드민 카드의 빨간 칩으로만 보인다.
