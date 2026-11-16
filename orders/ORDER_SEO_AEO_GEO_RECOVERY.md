# ORDER — 구글 SEO·AEO·GEO 통합 복구 (크롤 예산 회수 + Thin Content 보강 + 스키마 분리)

작성 2026-11-16 (월) · 자비스 · 기준 커밋 `1b788b49`(main, 2026-11-16)
대상 저장소 `wonji2/momcalendar` · 작업자 = 클로드 코드
관련 문서 `notes/MOMCAL_SEO_AEO_GEO_PLAN_2026-11-16.md`, `notes/MOMCAL_SEO_AEO_GEO_EVIDENCE_2026-11-16.md`, `notes/google_seo_recovery_plan.md`(11-10 합의분)

이 오더는 **11-10 합의 후 미반영된 `g/`·`gg/` 상세페이지 개편안**과, 11-16 실측 진단, 그리고 방장 님(@bangjang7) 비서의 교차검증 5대 보완점을 하나로 합친 최종 실행 문서다. 클로드 코드는 이 파일만 보고 끝까지 구현할 수 있어야 한다.

---

## 실행 명령 (길아 님이 클로드 코드에 붙여넣는 1줄)

```
claude "orders/ORDER_SEO_AEO_GEO_RECOVERY.md 끝까지 읽고 §4·§5·§6·§7·§8 그대로 구현한 뒤 §9 검증 V1~V17 실제로 돌려 표로 보고해. 라이브 index.html·admin.html은 절대 건드리지 말고 커밋은 작업 단위로 나눠 올려"
```

레포 루트(`wonji2/momcalendar` 체크아웃)에서 실행한다. PowerShell 스크립트는 **UTF-8 BOM**으로 저장한다(한글 리터럴 때문에 `.ps1`이 BOM 없이 저장되면 깨진다 — 저장소 기존 규칙).

---

## 0. 한 줄 요약

구글이 우리 사이트를 **"품질이 낮아서"가 아니라 "너무 많아서 못 읽고 있다.** 11-16 실측에서 미색인 29,420건 중 28,137건(95.6%)이 `발견됨 - 현재 색인이 생성되지 않음`이었다. 크롤러가 URL은 알지만 예산이 없어 한 번도 오지 않은 상태다. 그래서 이 오더의 순서는 **① 사이트맵을 실제로 값어치 있는 페이지만 남겨 줄이고(크롤 예산 회수) → ② 남긴 페이지를 2,000자 이상 고유 문서로 채우고 → ③ 측정(GA4)과 스키마를 바로잡는** 순서다. 3번(GA4·스키마)은 지금 당장 검증을 가능하게 만드는 것이고, 1·2번이 실제 순위를 되돌리는 본체다.

---

## 1. 진단 근거 — 11-16 실측

### 1-1. 구글 서치콘솔 (길아 님 계정 직접 로그인, 11-16 실측)

일별 흐름: **8월 말 피크 = 일 150클릭 · 1,300노출 → 11월 현재 = 일 13~15클릭 · 25~81노출.** 8월 대비 클릭 1/10, 노출 1/16 수준으로 떨어진 채 유지되고 있다.

월간(서치콘솔 월간 리포트 메일 원문):

| 월 | 클릭 | 노출 | 노출 발생 페이지 | 브랜드명 비중 |
| --- | --- | --- | --- | --- |
| 8월 | 1,420 | 13,100 | 3,420 | 8.5% |
| 9월 | 948 | 10,200 | 1,580 | 17.4% |
| 10월 | 420 | 1,280 | 333 | 74.3% |

10월 클릭 420 중 312가 '맘캘린더' 브랜드 검색이다. 일반 키워드 유입은 사실상 0.

**색인 현황 (페이지 색인 생성 보고서, 11-16):**

| 사유 | 건수 | 비중 | 해석 |
| --- | --- | --- | --- |
| 색인 생성됨 | 12,185 | — | 살아 있는 자산 |
| 미색인 합계 | 29,420 | — | — |
| └ `발견됨 - 현재 색인이 생성되지 않음` | **28,137** | 미색인의 95.6% | **크롤 예산 고갈.** URL만 알고 크롤을 안 했다 |
| └ `크롤링됨 - 현재 색인이 생성되지 않음` | 656 | 2.2% | 실제로 읽고 Thin Content로 버린 페이지 |
| └ `찾을 수 없음(404)` | 619 | 2.1% | 삭제·만료 URL 방치 |
| └ `적절한 표준 태그가 포함된 대체 페이지` | 3 | 0.01% | **중복·canonical 충돌은 원인이 아니었다** |

### 1-2. GA4 (최근 28일, 11-16 실측)

사이트 전체는 오히려 폭발 중이다.

| 지표 | 값 | 증감 |
| --- | --- | --- |
| 총 사용자 | 3.7만 | +72.0% |
| 활성 사용자 | 3.6만 | +72.2% |
| 조회수 | 11만 | +60.7% |
| 세션 | 7.7만 | +75.9% |

유입 상위: 직접 1.3만 · 모바일 네이버 검색 2.4천 · 인포크링크 1.6천. **`google / organic`은 상위 유입에서 사라졌다.**
그리고 `g/`·`gg/` 상세페이지에는 GA4 태그가 없어(실측: `g/스트라이더.html` 내 `G-NRCP2FVRSB` 0건) 상세페이지 트래픽이 아예 잡히지 않는다. 지금은 개선 효과를 측정할 수조차 없는 상태다.

### 1-3. 기술 실측 (11-16, 라이브 + 저장소 대조)

| 항목 | 실측 |
| --- | --- |
| 사이트맵 | main 528 · brand 9,908 · product 2,968 · seller 2,986 · **gonggu 27,454** = **43,844** |
| `gg/` 중 진행 중 | 1,122건 (4.1%) — 95.9%가 마감 페이지 |
| `gg/` 본문 길이 | 765 ~ 1,635자 (14장 표본) |
| 페이지 간 유사도 | difflib 중위 0.706 · 최대 0.879 |
| GA4 `G-NRCP2FVRSB` | `index.html` 1장에만 (98~103행) |
| 메타 robots | `index,follow,max-image-preview:large,noai,noimageai` 전 페이지 |
| JSON-LD | WebPage·Organization·FAQPage·BreadcrumbList·ItemList만. **Event·Product·Offer 0건** |
| `www.momcalendar.com` | **SSL 인증서 불일치**(no alternative certificate subject name) — apex는 200 정상 |
| `llms-full.txt` | 404 (없음) |
| 호스팅 | **GitHub Pages** (`server: GitHub.com`, apex A 185.199.108~111.153), DNS는 Cloudflare(NS gabriel/melissa) |
| 404 응답 | GitHub Pages 기본 404 (서버측 301 리다이렉트 기능 없음) |

### 1-4. 원인 사슬 (한 문단)

8~9월에 4만 3천 URL을 한꺼번에 사이트맵에 물렸고, 그중 96%가 "지금 진행 중인 공구는 없습니다"로 시작하는 마감 페이지였다. 구글은 이 4만 개를 **발견만 하고 크롤 예산이 없어 읽지 않았고(28,137)**, 겨우 읽은 656장은 내용이 얇아 버렸다. 그 사이 9월 트래픽을 만들던 브랜드·제품 롱테일 페이지(`g/`, `p/`)도 같은 사이트맵에 묻혀 크롤 순번을 얻지 못했다. 즉 **색인 붕괴의 본체는 크롤 예산이고, 두 번째가 Thin Content, 세 번째가 404 방치**다. canonical·기술 오류는 원인이 아니다(대체 페이지 3건).

---

## 2. 이 오더가 끝내야 하는 것

| # | 과제 | 우선 | 끝났다고 볼 수 있는 상태 |
| --- | --- | --- | --- |
| 1 | 사이트맵 슬림화로 크롤 예산 회수 | P0 | `sitemap-gonggu` 27,454 → 12,000 이하, 전체 28,000 이하, `verify.ps1` 통과 |
| 2 | `g/`·`gg/` Thin Content 복구(템플릿 영구 주입) | P0 | 신규 생성분 본문 중위 2,000자 이상, 유사도 중위 0.60 이하, "진행 중인 공구 없음" 문구 0건 |
| 3 | GA4 전 페이지 삽입 + `noai` 메타 제거 | P0 | `g/`·`gg/`·`p/`·`s/` 전 페이지 GA4 1건, `noai` 0건(템플릿 + 기존 4.4만 장 1회성 패치) |
| 4 | 구조화 데이터 분리(공구=Event, 핫딜=Product/Offer) | P1 | 진행중·예정 공구 페이지에 Event 1건, 핫딜 페이지에만 Product/Offer, 공구 페이지에 `price` 0건 |
| 5 | 404 619건 정리 + 재발 방지 | P1 | 삭제 경로에 툼스톤(noindex + canonical + meta refresh) 생성, GSC 404 CSV 처리 |
| 6 | `www` → apex 정리 + llms/robots/sitemap/IndexNow 정합성 | P2 | `www` 301(인프라, 사람 작업) + 정합성 체크리스트 전 항목 통과 |

**이번 오더에서 하지 않는 것**: 네이버 쪽 작업, 외부 언급(GEO) 캠페인, 새 질문형 랜딩 10장 신설(사기·환불·가격 판별 계열), `llms-full.txt` 생성. §10에 후속 후보로 적어 뒀다 — 지금 손대면 P0가 늦어진다.

---

## 3. 절대 하지 말 것 (먼저 읽어라)

1. **라이브 파일 직접 수정 금지** — `index.html`·`admin.html`·`staff.html`·`test.html`·`test-app.html`·`register.html`·`kktest.html`·`reelcard.html`은 빌드도, 이 오더도 건드리지 않는다(고정 규칙 0-A). `index.html`의 `noai` 제거는 §6-3의 별도 절차(사장님 승인 후 단독 커밋)로만.
2. **페이지 삭제 금지** — 보존 원칙. 삭제는 그대로 404가 되고, 이 사이트는 서버측 301을 못 한다(GitHub Pages). 예외는 기존 코드에 있는 `brand_block`·`gonggu_hold`·`junk_brands`뿐이며, 그마저도 §8-1의 툼스톤으로 바꾼다.
3. **공구 가격·할인율 창작 금지** — 우리는 공구 가격을 수집하지 않는다. `g/`·`gg/`·`p/`·`s/`에 금액·할인율·"최저가"를 쓰지 않는다. 11-10 계획의 "평균 할인율 35%" 항목은 **공구에는 적용 불가**이므로 제외하고, 실가격이 있는 핫딜에만 쓴다.
4. **`Product`/`Offer`를 공구 페이지에 넣지 말 것** — `price`가 없어 서치콘솔에 `price` 누락 오류가 대량 발생한다(교차검증 지적). `Offer`는 `h/`에 해당하는 **핫딜 페이지만**.
5. **종료된 이벤트를 `Event`로 마크업하지 말 것** — 구글 이벤트 가이드 위반이며 2.6만 장이 경고가 된다. `Event`는 **진행 중·예정 공구에만**.
6. **사이트 전체 집계 노출 금지 유지** — 셀러 수·누적 공구 수·사이트 전체 진행 건수는 크몽에 파는 자산이라 페이지 본문에 쓰지 않는다(2026-08-11 지시). 단 **그 브랜드·그 상품의 회차 이력과 재공구 주기**는 11-10 합의로 이번에 페이지에 싣는다(§5-1 ⑤). 이 경계를 넘지 말 것.
7. **크롤 예산과 무관한 것을 같이 배포하지 말 것** — 색인 원인은 크롤 예산이다. 배포는 §10 순서대로 나눠서.
8. **`lastmod` 거짓말 금지** — 내용이 안 바뀐 페이지에 오늘 날짜를 박지 않는다(기존 해시 대조 로직 유지).
9. **외부 서비스 계정·결제·라우팅 변경 금지** — `www` 리다이렉트는 Cloudflare 작업이라 코드로 하지 않는다(§8-2). 클로드 코드는 인프라를 건드리지 않는다.

---

## 4. [P0-1] 사이트맵 슬림화 — 크롤 예산 회수

### 4-1. `gg/` 3계층 규칙

`tools/seo/build.ps1`의 `$ggRows` 순회(현재 481행 부근)에서 페이지를 만들 때 계층을 정하고, 계층에 따라 `robots` 메타와 사이트맵 등재를 가른다.

```powershell
# ── gg 색인 계층 (2026-11-16 크롤 예산 회수) ──
# A = 진행 중·예정 : 사이트맵 등재 + index,follow + 풀 템플릿(Event 포함)
# B = 최근 마감(30일) : 사이트맵 등재 + index,follow + 풀 템플릿
# C = 그 밖(장기 마감) : 사이트맵 제외 + noindex,follow + 페이지는 200 유지(보존 원칙)
$GG_KEEP_DAYS = 30
$ggCutoff = ([DateTime]::ParseExact($today,'yyyy-MM-dd',$null)).AddDays(-$GG_KEEP_DAYS).ToString('yyyy-MM-dd')
function GgTier($x, [string]$today, [string]$cut){
  if($x.od -gt $today){ return 'A' }                                    # 예정
  if($x.od -le $today -and $x.ed -ge $today){ return 'A' }              # 진행 중
  if("$($x.ed)" -ge $cut){ return 'B' }                                 # 최근 마감
  return 'C'
}
```

`WritePage`에 `robots` 키를 새로 받도록 lib.ps1을 고친다(§6-1). C 계층은 `robots='noindex,follow,max-image-preview:large'`.

**목표 수치**: `sitemap-gonggu.xml` **27,454 → 12,000 이하**. 실측 분포(파일명 날짜 기준 11월 6,177 · 10월 7,601)로 30일 창이면 약 10,000~11,000장이 남는다. 실행 후 실제 수를 보고하고, 12,000을 넘으면 `$GG_KEEP_DAYS`를 21로 낮춰 재실행한다.
전체 사이트맵은 43,844 → **28,000 이하**. `g/`(9,908)·`p/`(2,968)·`s/`(2,986)는 **줄이지 않는다** — 9월 롱테일이 살아 있던 자리다.

### 4-2. 사이트맵 생성부 수정 (build.ps1 1,190행 부근)

지금은 `$ggRows` 전체 + `KeptUrls`가 전부 사이트맵에 들어간다. A/B만 싣는다.

```powershell
$uGG = @()
foreach($x in $ggRows){
  if((GgTier $x $today $ggCutoff) -eq 'C'){ continue }
  [void]$uGG.Add("gg/$(Enc $x.slug).html")
}
# 보존 페이지 중 noindex(C·툼스톤)는 사이트맵에서 뺀다 (verify 는 §4-3 예외로 통과)
foreach($u in (KeptUrls 'gg' $uGG)){
  if(HasNoindex $u){ continue }
  [void]$uGG.Add($u)
}
WriteSitemap 'sitemap-gonggu.xml' $uGG '0.6' 'weekly'
```

`HasNoindex` 헬퍼(lib.ps1):

```powershell
function HasNoindex([string]$rel){
  $fp = Join-Path $Root ([uri]::UnescapeDataString($rel))
  if(-not (Test-Path -LiteralPath $fp)){ return $false }
  return ([IO.File]::ReadAllText($fp) -match '<meta name="robots" content="[^"]*noindex')
}
```
`$Root`는 build.ps1 스코프에 있으므로 lib에서 쓰려면 인자로 넘기거나 `$script:Root`를 쓴다(둘 중 하나로 통일하고 주석에 남긴다).

### 4-3. `verify.ps1` 고아 검사 충돌 방지 (필수)

지금 `verify.ps1` 102~110행은 "디스크에 있는데 사이트맵에 없으면 고아"로 보고 즉시 실패 처리한다. 이 예외가 없으면 **사이트맵을 줄이는 순간 `seo-daily.yml` 커밋이 영구히 막힌다**(교차검증 1번 지적).

```powershell
# 3) 파일 → sitemap 누락 (고아 페이지)
#    + 2026-11-16: 사이트맵에서 의도적으로 뺀 툼스톤·장기마감(noindex,follow)은 고아가 아니다.
$urlSet = @{}
foreach($u in $allUrl){ $rel2 = $u -replace '^https://momcalendar\.com/','' ; $urlSet[[uri]::UnescapeDataString($rel2)] = 1 }
$orphanIndexable = 0; $orphanNoindex = 0
foreach($p in $files){
  $rel = $p.Substring($root.Length+1).Replace('\','/')
  if($urlSet.ContainsKey($rel)){ continue }
  $t = [IO.File]::ReadAllText($p)
  if($t -match '<meta name="robots" content="[^"]*noindex'){ $orphanNoindex++ }
  else { $orphanIndexable++; if($orphanIndexable -le 5){ Bad "sitemap 에 빠진 페이지: $rel" } }
}
Write-Output "사이트맵 누락 — 의도된 제외(noindex): $orphanNoindex / 색인 대상인데 누락: $orphanIndexable"
if($orphanIndexable -gt 0){ Bad "색인 대상 페이지가 사이트맵에서 빠졌다 ($orphanIndexable 장)" }
```

**가드 2개를 같이 넣는다. 규칙이 무너지는 사고를 막는 장치다.**

```powershell
if($orphanNoindex -gt 24000){ Bad "noindex 페이지 $orphanNoindex 장 — 템플릿 사고 의심(전 페이지 noindex)" }
$ggSm = @($allUrl | Where-Object { $_ -match '/gg/' }).Count
if($ggSm -gt 13000){ Bad "sitemap-gonggu $ggSm URL — 슬림화 회귀(목표 12,000 이하)" }
if($ggSm -lt 3000){ Bad "sitemap-gonggu $ggSm URL — 과도 축소, gg 데이터 생성 실패 의심" }
```

### 4-4. 내부링크도 A/B로만

크롤 예산은 사이트맵만이 아니라 내부링크로도 샌다. C 페이지로 가는 링크를 남겨두면 크롤러가 계속 그쪽으로 간다.

- `g/` 브랜드 페이지의 "공구 일정 상세" 8링크(현재 375행 부근) → **A/B만** `Where-Object { (GgTier $_ $today $ggCutoff) -ne 'C' }` 후 8개.
- `gg/` 페이지의 "관련 일정" 6링크(현재 537행 부근) → 같은 필터.
- `p/`·`s/`·`m/`·`d/` 페이지는 `gg/`를 직접 링크하지 않으므로 손대지 않는다.
- C 페이지 자체는 브랜드 페이지(`/g/…`) 하나만 링크한다(막다른 페이지 방지).

### 4-5. 커밋 정합성 (`seo-daily.yml`)

`git add` 목록은 그대로 두어도 된다(`gg`, `sitemap-gonggu.xml` 포함). 다만 `tools/seo/generated.txt`는 루트 생성물만 담으므로 변경 없음. 새로 만드는 파일이 있으면(§8-1 툼스톤) 디렉터리가 기존 `g/`·`gg/` 안이라 자동 포함된다. `_redirects` 같은 루트 파일을 만들 경우에만 `.github/workflows/seo-daily.yml`의 `git add`에 한 줄 추가한다(이 사이트는 GitHub Pages라 `_redirects` 자체를 쓰지 않는다 — §8-1).

### 4-6. 되돌리기

슬림화는 **사이트맵에서 빼는 것**이지 파일을 지우는 것이 아니다. 문제가 생기면 `$GG_KEEP_DAYS`를 365로 올려 한 번 돌리면 원상복구된다. 삭제 커밋은 만들지 않는다.

---

## 5. [P0-2] `g/`·`gg/` Thin Content 복구 — 템플릿 영구 주입

11-10에 합의하고 아직 반영되지 않은 개편안을 `build.ps1`/`lib.ps1` 템플릿에 **영구히** 넣는다. 목표는 마감·예정 여부와 무관하게 모든 공구 페이지가 **그 페이지에서만 나오는 정보**를 갖는 것이다.

### 5-1. 다섯 블록 (전부 데이터에서만 생성)

| # | 블록 | 내용 | 데이터 출처 | 없을 때 |
| --- | --- | --- | --- | --- |
| ① | 고유 상품 요약 | 이 공구의 상품명에서 뽑은 제품어 + 셀러 공지 원문 요약 2~3문장 | `$CapMap`(셀러 공지), 상품명 | 블록 생략 |
| ② | 다음 공구 알림 | "‘{브랜드}’ 새 공구 알림 받기" CTA + 안내 | `/?q={브랜드}` (live 검색), 키워드 알림 | 항상 노출 |
| ③ | 연관 핫딜 3건 | 지금 노출 중인 핫딜 중 이 브랜드/카테고리 3건(상품명·몰·가격·할인율) | `$HD2`(가격 있는 핫딜) | 블록 생략 |
| ④ | 공구 이력·재공구 주기 | 같은 브랜드의 지난 회차 날짜, 재공구 간격 중위값("보통 3개월 간격") | `$rows`의 `od` | 회차 1건이면 생략 |
| ⑤ | FAQ 확장 | 지금 3문 → **6~8문**. 언제/어디서/가격은 어디서 확인/지난 일정/다음 공구/재공구 주기/셀러가 누구 | 기존 `$faq` + 신규 | 항상 |

`g/`(브랜드)에도 같은 5블록을 넣되 ①은 "이 브랜드에서 가장 많이 열린 제품 3개 + 각 제품의 최근 오픈일"로, ④는 "브랜드 재공구 주기"로 바꾼다.

### 5-2. "진행 중인 공구 없음" 문구 제거

현재 `build.ps1` 351행(`g/`)·453행(`p/`)·589행·630행에 이 문구가 있다. 검색 스니펫에 이 문장이 잡히는 것이 10월 클릭 붕괴의 얼굴이었다. **문장 자체를 없애고, 정보가 있는 문장으로 바꾼다.**

- 나쁨: `지금 진행 중인 공구는 없습니다. 지난 일정을 보면 다음 공구 시기를 가늠할 수 있습니다.`
- 좋음(`g/`): `{브랜드} 공구는 지금 열려 있는 건이 없습니다. 가장 최근 공구는 {YYYY-MM-DD}에 {셀러}가 열었고, 이 브랜드는 최근 {N}회 공구가 평균 {주기} 간격으로 열렸습니다. 다음 공구가 열리면 알림을 받아 두세요.`
- 좋음(`gg/`): `{상품명} 공구는 {오픈일} ~ {마감일}에 진행된 일정입니다. 같은 상품은 보통 {주기} 간격으로 다시 열립니다. 다음 회차가 열리면 알림을 받아 두세요.`

주기 계산은 그 브랜드(또는 상품) `od` 간격의 **중위값**을 일 단위로 내고, 30일 미만이면 "한 달 안팎", 30~89일이면 "1~3개월", 90일 이상이면 "3개월 이상"으로 말한다. 이력이 2회 미만이면 주기 문장을 **쓰지 않는다**(추정 금지).

### 5-3. 데이터 배선 — 순서 함정 (반드시 지켜라)

지금 `$HD2`(가격 포함 핫딜)는 build.ps1 **854행**에서 처음 만들어지는데, `g/` 페이지 루프는 **~300행**, `gg/` 루프는 **~481행**이다. 즉 브랜드·공구 페이지를 만들 때 `$HD2`는 아직 비어 있다. 이 상태로 ③ 연관 핫딜을 넣으면 **모든 페이지에서 0건**이 된다.

- 해결: 핫딜 조회를 위로 올려 **한 번만** 한다. 35행의 `$HotDeals`(id,title,link)와 854행의 `$HD2`(title,mall,price,price_before,discount_rate,is_lowest,deal_day,source,major,minor)를 **하나의 조회로 통합**하고, select에 `link`를 추가한다. `$HotDeals`는 `$HD2`에서 파생시킨다(`$HotDeals = $HD2 | Select id?...`가 아니라, 통합 결과에서 필요한 필드만 쓰면 된다).
- 조회 조건은 지금 것을 유지한다: `or=(expires_at.is.null,expires_at.gte.$nowUtc)&price=gt.0&order=id.desc&limit=400`, 실패 시 페이지 생성은 계속(기존 `try/catch` 유지).
- `$HD2`를 만들 때의 정규화(몰 이름 '토스'→'토스쇼핑', 할인율 65% 상한, `refLabel` 평균/정가 구분)는 **그대로 재사용**한다. 중복 구현 금지.

### 5-4. 분량·유사도 목표

| 지표 | 현재 | 목표 |
| --- | --- | --- |
| `gg/` 본문 길이(중위, 14장 표본) | 765~1,635자 | **2,000자 이상** |
| 페이지 간 유사도(difflib 중위) | 0.706 | **0.60 이하** (가능하면 0.55) |
| `g/` 본문 | 목록 + FAQ 수준 | 2,500자 이상 |

분량은 **문장 늘리기로 채우지 않는다**. 위 5블록의 데이터가 부족하면 그 블록을 빼고, 대신 ④(이력)·⑤(FAQ)를 채운다. 같은 문장을 페이지마다 반복하면 유사도가 오르므로, 상품명·셀러명·날짜·제품어가 문장마다 실제로 달라야 한다.

### 5-5. 문구 규칙

- 공구에는 **금액·할인율·최저가 금지**(§3-3). "가격은 오픈일에 셀러 공지로 공개됩니다"까지만.
- 핫딜 가격은 "등록할 때 확인한 가격 · 판매처에서 바뀔 수 있음" 문구를 붙인다(기존 `$priceNote` 재사용).
- ② 알림 CTA 문구는 **실제 동작과 일치해야 한다**. `/?q={브랜드}`는 live `index.html`이 처리하는 검색 파라미터다(3,105행 `q` 파싱 확인). "알림"이라고 쓰려면 키워드 알림이 실제로 켜지는 경로여야 하므로, 구현 후 **live 화면에서 직접 눌러 확인**하고, 확인되지 않으면 문구를 `지금 ‘{브랜드}’ 공구·핫딜 보기`로 낮춘다. 확인 결과를 보고에 적는다(교차검증 3번 취지).

---

## 6. [P0-3] GA4 전 페이지 + `noai` 메타 제거

### 6-1. 템플릿 수정 (`lib.ps1` 97~117행)

두 가지를 바꾼다.

1. **robots 메타를 인자로 받는다** (§4-1의 noindex 지원):
```powershell
# 2026-11-16: 계층별 robots — noindex 는 gg C 계층·툼스톤에만 붙는다
$rb = $(if($o.robots){ $o.robots } else { 'index,follow,max-image-preview:large' })
[void]$sb.AppendLine("<meta name=${Q}robots${Q} content=${Q}$rb${Q}>")
```
`noai,noimageai`는 **뺀다**. AI 학습 차단은 `robots.txt`의 `Content-Signal: ai-train=no`와 학습봇 24종 Disallow가 이미 하고 있고, `noai` 메타는 AI 인용을 환영한다는 신호와 충돌한다.

2. **GA4 삽입**. `index.html` 97~104행과 같은 스니펫을 `<head>`의 robots 메타 다음에 넣는다. 측정 ID는 **`G-NRCP2FVRSB`**(`index.html`에서 확인).

```powershell
[void]$sb.AppendLine("<script async src=${Q}https://www.googletagmanager.com/gtag/js?id=G-NRCP2FVRSB${Q}></script>")
[void]$sb.AppendLine("<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-NRCP2FVRSB');</script>")
```

`<head>`에서 동기 스크립트로 넣지 말 것(`async` 유지 — LCP 보호). 그리고 `verify.ps1`에 검사를 하나 추가한다: 모든 생성 페이지에 `G-NRCP2FVRSB`가 정확히 1회 있는지.

### 6-2. 기존 4.4만 장 1회성 패치 (`tools/seo/patch_kept_once.ps1` 신규)

`g/`·`p/`·`s/`·`m/`·`d/`·`c/`·`gg/`의 **보존 페이지**는 다시 생성되지 않으므로 템플릿만 고쳐서는 GA4가 안 붙는다. 한 번에 훑는 스크립트가 필요하다(교차검증 2번 지적).

요구 사양:

```powershell
# pwsh tools/seo/patch_kept_once.ps1                 # 전체 1회 실행
# pwsh tools/seo/patch_kept_once.ps1 -Dir gg         # 디렉터리 단위(배치)
# pwsh tools/seo/patch_kept_once.ps1 -DryRun         # 변경 예정 수만 센다
param([string]$Root = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
      [string]$Dir = '', [switch]$DryRun)
```

- 대상: `g p s m d c gg` + `tools/seo/generated.txt`에 적힌 루트 생성물(키워드 랜딩·허브 3종). **`index.html`·`admin.html`·`staff.html`·`test*.html`·`register.html`·`kktest.html`·`reelcard.html`은 목록에서 명시적으로 제외.**
- 동작: ① `G-NRCP2FVRSB` 없으면 `</head>` 앞에 gtag 2줄 삽입 → ② `noai,noimageai` 및 `,noai`·`, noai` 잔여 콤마 정리 → ③ 아무것도 바뀌지 않은 파일은 쓰지 않는다(멱등).
- `robots` 메타 문자열이 `index,follow,max-image-preview:large,noai,noimageai`인 경우 `index,follow,max-image-preview:large`로 정확히 치환. `noindex`가 이미 있는 페이지는 robots를 건드리지 않는다.
- 결과 출력: `패치 N / 건너뜀 M / 실패 K`, 실패 파일 5개까지 경로 출력.
- **커밋은 배치로 나눈다.** 사이트는 GitHub Pages이고 Pages 빌드는 10분 한도가 있다. `-Dir g` → `-Dir p` → `-Dir s` → `-Dir gg` 네 번에 나눠 돌리고, `gg`는 27,454장이라 한 번 더 쪼갤 수 있게 `-Limit` 파라미터(기본 0=전체)를 둔다. 각 배치 후 커밋 메시지는 `GA4 태그·noai 메타 일괄 패치 (g/, N개)`.
- 실행 시점: `seo-daily`(05:10 KST)와 겹치지 않게 **02:00~04:00 KST**에 `workflow_dispatch`로 돌린다. 새 워크플로 `seo-once-patch.yml`(수동 전용, `dry_run` 입력)을 만들어 두면 다음에도 쓴다.

### 6-3. 라이브 루트 파일 (`index.html`)

`index.html`에도 `noai,noimageai`(68행)가 있고 `google-site-verification` 자리표시자가 **주석 처리된 채**(73행) 남아 있다. 라이브 파일은 이 오더에서 건드리지 않는다. 대신 보고에 다음을 적어 사장님 판단을 받는다.

- `noai` 제거는 1줄 변경이지만 라이브 파일이므로 **단독 커밋 + 배포 후 육안 확인**이 필요하다.
- `google-site-verification`은 지금 주석이라 무해하다. 실제 코드가 있으면 넣고, 없으면 주석 줄을 지운다(둘 다 라이브 수정).

---

## 7. [P1] 구조화 데이터 분리

### 7-1. 공구 페이지 = `Event` + `FAQPage` (진행 중·예정만 Event)

- `g/`(브랜드): 그 브랜드의 **진행 중 또는 가장 가까운 예정** 공구 1건만 `Event`로. 없으면 Event 없음.
- `gg/`(건별): A 계층(진행 중·예정)만 `Event`. B·C는 `WebPage + FAQPage + BreadcrumbList` 유지.
- 이유: 구글 이벤트 가이드는 **이미 끝난 이벤트 마크업을 금지**한다. 2.6만 장에 과거 Event를 붙이면 경고가 쌓여 오히려 손해다. 이 판단은 교차검증 4번("공구=Event")의 취지를 지키면서 정확성을 높인 것이다.
- `offers`·`price`는 **넣지 않는다**(가격 비공개 원칙, `price` 없으면 `offers` 자체를 생략).
- `FAQPage`는 A/B/C 모두 유지(리치결과는 아니고 AI 인용용 — 2023-08 정책).

검증된 형태(그대로 쓸 것):

```json
{"@context":"https://schema.org","@type":"Event",
 "name":"스트라이더 공구 (11/18 오픈)",
 "startDate":"2026-11-18","endDate":"2026-11-24",
 "eventStatus":"https://schema.org/EventScheduled",
 "eventAttendanceMode":"https://schema.org/OnlineEventAttendanceMode",
 "location":{"@type":"VirtualLocation","name":"인스타그램 @seller","url":"https://www.instagram.com/seller"},
 "organizer":{"@type":"Organization","name":"셀러명","url":"https://www.instagram.com/seller"},
 "isAccessibleForFree":true,
 "url":"https://momcalendar.com/gg/스트라이더-1118.html",
 "image":"https://momcalendar.com/og-image.png",
 "description":"{상품명} 인스타 공동구매. 2026-11-18 오픈, 2026-11-24 마감. 진행 셀러 {셀러명}."}
```

- `location`은 셀러 인스타 URL이 있으면 그 주소, 없으면 `{"@type":"VirtualLocation","name":"인스타그램"}`(url 생략). **`Place`+주소를 만들지 말 것**(오프라인 장소가 아니다).
- `organizer`는 셀러(없으면 브랜드). 맘캘린더를 organizer로 쓰지 않는다(주최자가 아니다).
- `startDate`/`endDate`는 `yyyy-MM-dd`. 시각을 지어내지 않는다.

### 7-2. `p/`(브랜드×제품)·`s/`(셀러)·`m/`·`d/`·`c/`

`ItemList`·`FAQPage`·`BreadcrumbList` 현행 유지. 여기에 `Event`를 넣지 않는다(집계 페이지이지 한 건의 이벤트가 아니다).

### 7-3. 핫딜 페이지에만 `Product`/`Offer`

대상: `핫딜정보.html`, `최저가정보.html`, `{몰}핫딜.html`, `{분야}핫딜.html`, `{품목}핫딜.html` (모두 `$dealPages` 중 `list`를 가진 페이지).

```json
{"@context":"https://schema.org","@type":"ItemList","name":"핫딜 정보",
 "url":"https://momcalendar.com/핫딜정보.html","numberOfItems":1,
 "itemListElement":[{"@type":"ListItem","position":1,"item":{"@type":"Product","name":"상품명",
   "offers":{"@type":"Offer","price":"12900","priceCurrency":"KRW",
             "availability":"https://schema.org/InStock","url":"{핫딜 링크}",
             "seller":{"@type":"Organization","name":"쿠팡"}}}}]}
```

- `price`는 **문자열**, 원 단위 정수(콤마·원 표기 없이). `price > 0`인 것만.
- `image`는 넣지 않는다(실물 이미지가 없다. 아무 이미지나 넣으면 리치결과 위반).
- `review`·`aggregateRating` 금지(없는 평가 창작).
- 기존 `LdNames`(이름만 있는 ItemList)는 이 페이지들에서 이 구조로 교체한다. `세일정보.html`·`라방일정.html`은 가격이 없으므로 `LdNames` 유지.

---

## 8. [P1] 404 정리 + `www` + 정합성

### 8-1. 404 619건 — 이 사이트는 301을 못 한다

실측: `server: GitHub.com` = **GitHub Pages**. GitHub Pages에는 서버측 리다이렉트(`_redirects`, `netlify.toml` 류)가 없다. 그래서 "301로 넘긴다"는 코드로 불가능하고, 대신 **툼스톤 페이지**를 쓴다(200 응답 + `noindex` + `canonical` + `meta refresh`). 구글은 `meta refresh 0`을 리다이렉트로 따라간다.

```html
<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="https://momcalendar.com/공구브랜드.html">
<meta http-equiv="refresh" content="0; url=https://momcalendar.com/공구브랜드.html">
<title>정리된 일정 · 맘캘린더</title></head>
<body><p>이 일정은 정리되었습니다. <a href="/공구브랜드.html">최근 공구 일정 보기</a></p></body></html>
```

**브랜드명을 쓰지 않는다** — `brand_block`으로 삭제 요청한 브랜드의 흔적을 남기면 안 된다(아틀리에 퀸스 건).

작업 두 갈래:

1. **재발 방지(코드)**: `build.ps1`의 `KeptUrls`가 파일을 지우는 세 자리(`IsBlocked`, `JunkBrands`, `IsHeldGg`)에서, 지우기 전에 같은 경로에 위 툼스톤을 쓴다. 목적지 규칙: `g/X.html` → 브랜드가 살아 있으면 `/g/<brand>.html`, 아니면 `/공구브랜드.html`; `gg/…` → `/g/<brand>.html` 또는 `/지금공구.html`; `p/…` → `/공구제품.html`; 그 밖 → `/`. 삭제 대신 200을 유지하므로 보존 원칙과도 맞는다.
2. **기존 619건(데이터)**: 서치콘솔 404 목록 CSV가 필요하다. 자비스가 `tools/seo/gsc_404.csv`(경로, 유형)로 커밋하면 `tools/seo/tombstone.ps1 -Csv tools/seo/gsc_404.csv`가 위 규칙으로 채운다. CSV가 아직 없으면 **패턴으로 확실한 것만** 처리하고(끝 슬래시, 대문자 확장자, 6개월 이전 날짜 슬러그), 나머지는 보고에 건수로 남긴다. CSV 없이 추측으로 619건을 채우지 말 것.

### 8-2. `www.momcalendar.com` → apex (인프라, 코드 아님)

실측: DNS는 Cloudflare(NS `gabriel/melissa.ns.cloudflare.com`), apex A는 GitHub Pages IP 4개, `www`는 `CNAME → momcalendar.com`. `www`는 **SSL 인증서 불일치**로 브라우저 경고가 뜬다(이 상태로 유입되면 이탈).

절차(길아 님 또는 냠이, Cloudflare 대시보드):

1. DNS → `www` 레코드를 **Proxied(주황 구름)** 로 변경한다. (지금은 DNS only라 GitHub 인증서가 내려와 경고가 난다. 프록시를 켜면 Cloudflare Universal SSL이 `www`를 커버한다.)
2. SSL/TLS → Edge Certificates → Universal SSL 상태가 Active인지 확인(커버 호스트에 `www.momcalendar.com` 포함).
3. Rules → Redirect Rules → 새 규칙: 조건 `http.host eq "www.momcalendar.com"`, 동작 **Dynamic redirect** `concat("https://momcalendar.com", http.request.uri.path)` · 상태 **301** · **Preserve query string ON**.
4. 검증: `curl -sSI https://www.momcalendar.com/공구일정.html` → `301` + `location: https://momcalendar.com/공구일정.html`. 브라우저에서 자물쇠 정상.
5. apex 레코드는 **DNS only 그대로 둔다**(지금 정상 동작 중인 경로를 프록시로 바꾸면 캐시·TTFB가 달라진다. 필요하면 별도 판단).

코드로 할 수 있는 것: 없음. 이 항목은 **오더가 끝난 뒤 사람이 처리**하고, 클로드 코드는 보고에 "인프라 미처리"로 남긴다.

### 8-3. 정합성 체크리스트

| 항목 | 확인 |
| --- | --- |
| `sitemap.xml` | 5개 index, 각 `lastmod` = 오늘. 슬림화 후 URL 수와 llms.txt 숫자가 일치 |
| `llms.txt` | "사이트맵 총 N개 URL"·"공구 건별 상세 N개"가 실제 사이트맵 수와 일치(빌드가 매일 다시 씀 → 자동). 슬림화로 gg 숫자가 줄어드는 것이 의도임을 주석으로 남긴다 |
| `robots.txt` | `Sitemap:` 1줄 유지, 학습봇 24종 Disallow 유지, `Content-Signal: search=yes, ai-input=yes, ai-train=no` 유지. **손으로 고치지 않는다**(매일 빌드가 다시 씀) |
| IndexNow | 사이트맵 기준 제출이므로 슬림화가 자동 반영. 500개 배치, 성공/실패 로그를 보고에 표로 |
| 구글 sitemap 핑 | **넣지 않는다**(2023-06 폐지). 서치콘솔 재제출은 사람이 1회 |
| `llms-full.txt` | 이번엔 만들지 않는다(404 유지). 후속 후보 |

---

## 9. 검증 체크리스트 (V1~V17 — 실제로 돌리고 표로 보고)

| # | 검증 | 방법 | 합격 기준 |
| --- | --- | --- | --- |
| V1 | 빌드 정상 | `seo-daily` `workflow_dispatch` + `dry_run=true` | 에러 0, "브랜드 … 제품 … 공구 …" 요약 출력 |
| V2 | 역검증 통과 | `pwsh tools/seo/verify.ps1` | `=== 통과: 문제 없음`, 신규 카운터 2줄 출력 |
| V3 | 사이트맵 슬림화 | 5개 사이트맵 URL 수 집계 | gonggu ≤ 12,000 · 전체 ≤ 28,000, 전후 표 |
| V4 | C 계층 메타 | `gg/` C 페이지 1장 `curl -sI` + 본문 grep | HTTP 200, `noindex` 있음, 사이트맵에 없음 |
| V5 | GA4 템플릿 | 새로 생성된 `g/`·`p/`·`s/` 각 1장 grep | `G-NRCP2FVRSB` 정확히 1회, `noai` 0회 |
| V6 | GA4 보존 페이지 | `patch_kept_once -DryRun` 후 표본 5장 실측 | 변경 대상 수 = 미패치 파일 수, 패치 후 5장 모두 GA4 1회 |
| V7 | 본문 두께 | `gg/` 14장 텍스트 추출 길이 | 중위 ≥ 2,000자 |
| V8 | 유사도 | 14장 91쌍 difflib | 중위 ≤ 0.60, 최대 < 0.85 |
| V9 | 옛 문구 제거 | `grep -rl "지금 진행 중인 공구는 없습니다" g gg` | 0건(신규 생성분) |
| V10 | 5블록 존재 | `g/` 1장, `gg/` A 1장, B 1장 육안·grep | ①~⑤ 중 데이터 있는 블록 전부, ②는 항상 |
| V11 | Event 분리 | A 1장·C 1장 JSON-LD 파싱 | A: Event 1건, C: Event 0건, 전 페이지 JSON-LD 파싱 100% |
| V12 | 가격 누출 | 공구 페이지 전체 grep `"price"`·`할인율`·`최저가` | 0건 |
| V13 | 핫딜 Product | `핫딜정보.html` JSON-LD | `Product`+`Offer`+`price`(문자열), `image`·`review` 없음 |
| V14 | 툼스톤 | 표본 5장 | `meta refresh`+`canonical`+`noindex`, 브랜드명 0건 |
| V15 | 내부링크 | verify 출력 | 깨진 내부링크 0 |
| V16 | 라이브 확인 | 배포 후 `https://momcalendar.com/g/<기존>.html` | 200 + GA4 1회 + 새 5블록, `gg/` C 200 + noindex |
| V17 | 라이브 파일 무변경 | `git log --stat` | `index.html`·`admin.html`·`staff.html`·`test*.html` 변경 0 |

---

## 10. 배포 순서와 시점

1. **커밋 분리** (리뷰·롤백이 쉬워야 한다)
   ① `lib.ps1` + `build.ps1` 템플릿(GA4·noai·5블록·계층·Event) + `verify.ps1` 예외
   ② 툼스톤(`build.ps1` KeptUrls 수정 + `tombstone.ps1`)
   ③ 핫딜 스키마(Product/Offer)
   ④ 1회성 패치 스크립트 + `seo-once-patch.yml`
   ⑤ 이 오더 문서·체크리스트 갱신
2. **시점**: `seo-daily`(매일 05:10 KST) 실행 중에 머지하면 충돌한다. **02:00~04:00 KST**에 머지·수동 실행한다.
3. **첫 배포 후 24시간 관측**: ① Actions 성공 ② 사이트맵 수 ③ GA4 실시간 보고서에 `g/`·`gg/` 유입 등장 ④ `site:momcalendar.com` 스니펫에 "지금 진행 중인 공구는 없습니다"가 사라지는지(재크롤까지 1~2주).
4. **서치콘솔(사람)**: `sitemap.xml` 재제출 1회 + V10 통과 페이지 상위 20장 URL 검사 → 색인 요청.
5. **4주 관측 지표**: `발견됨 - 색인 안 됨` 감소, `색인 생성됨` 증가, 일 클릭 13→? / 노출 25~81→? 를 주 단위로 기록. GA4 `google / organic` 세션이 상위 유입에 재등장하는지.
6. **롤백**: 사이트맵은 `$GG_KEEP_DAYS` 조정으로, 템플릿은 커밋 revert로 되돌린다. 파일 삭제가 없으므로 URL 손실은 발생하지 않는다.

---

## 11. 파일 변경 지도

| 파일 | 변경 |
| --- | --- |
| `tools/seo/lib.ps1` | `WritePage`에 robots 인자·GA4 삽입, `noai` 제거, `HasNoindex` 추가 |
| `tools/seo/build.ps1` | 핫딜 조회 1회 통합(`$HD2` 선행), gg 계층·사이트맵 필터, g/gg 5블록, 옛 문구 교체, 내부링크 A/B 필터, Event, 툼스톤 |
| `tools/seo/verify.ps1` | 고아 검사 noindex 예외 + 가드 3개, GA4 존재 검사 |
| `tools/seo/patch_kept_once.ps1` | 신규 — 4.4만 장 1회성 패치(배치·멱등) |
| `tools/seo/tombstone.ps1` | 신규 — 404 CSV → 툼스톤 |
| `tools/seo/gsc_404.csv` | (자비스가 커밋) 404 목록 |
| `.github/workflows/seo-once-patch.yml` | 신규 — 수동 전용 패치 워크플로 |
| `g/` `gg/` 페이지 | 재생성(템플릿) + 보존분 1회성 패치 |
| `sitemap-gonggu.xml` | 27,454 → ~10,000 |
| `orders/ORDER_SEO_AEO_GEO_RECOVERY.md` | 이 문서(완료 후 검증 결과 부록 추가) |

---

## 12. 부록 — 실측 원본과 계산

- 서치콘솔 월간 원문·명령 응답 기록: `notes/MOMCAL_SEO_AEO_GEO_EVIDENCE_2026-11-16.md` (§A·§C·§D)
- 색인 사유별 수치·GA4 28일 수치: 2026-11-16 길아 님 계정 직접 로그인 실측(이 문서 §1)
- 사이트맵 실측: `sitemap-*.xml` 응답 크기·URL 수·lastmod 범위 (§C)
- 본문 두께·유사도 측정 방법: 14장 무작위, script/style 제거 후 텍스트 추출, `difflib.SequenceMatcher` 91쌍 (§D-1)
- `g/` 저장소 파일 9,909장 vs `sitemap-brand.xml` 9,908 URL — **1장 차이의 정체를 확인해 보고할 것**(고아 1장이거나 사이트맵 생성 누락).
- `Event`·`Product` 0건 근거: `grep -c "Event" tools/seo/build.ps1` → 0 (§D-2)

### 다음 오더 후보 (이번에는 하지 않는다)

1. "믿어도 되나" 계열 질문형 랜딩 10장 — 인스타 공구 사기 예방, 환불·분쟁 처리, 공구 가격 적정성 판별, 셀러 신뢰도 보는 법 (현재 0장, 검색량 크고 AI 인용 빈도 높음)
2. GEO — 외부 언급 쌓기(나무위키 등재, 네이버 카페·블로그, 육아 커뮤니티). 구글 AI 개요가 아직 우리를 인스타 계정으로만 소개한다
3. `llms-full.txt` — 상위 브랜드 200개의 공구 이력
4. 셀러 페이지(`s/`) 2,986장 재평가 — GSC에서 노출은 있는데 클릭 0 (지엠마·마마홈·지후맘 실측)
