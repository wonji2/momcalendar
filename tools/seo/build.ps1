# 검색 노출용 정적 페이지 생성기 (사장님 지시 2026-08-05)
#
#   pwsh tools/seo/build.ps1                     ← DB 캐시(seo_dataset RPC)를 읽어 생성
#   pwsh tools/seo/build.ps1 -DataFile a.json    ← 받아둔 JSON 으로 생성(테스트용)
#
# 데이터는 public.seo_dataset() 이 준다. 이 RPC 는 공개 키로 읽히며 반환값은
# 전부 사이트에 그대로 공개되는 내용이다. 그래서 GitHub Secret 이 필요 없다.
param(
  [string]$Root = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [string]$DataFile = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')

# ── 데이터 확보 ────────────────────────────────
$key = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE'
# 🔴 2026-10-24: 값 안의 연속 공백(인스타 표시 이름 「유니쁘  공구마켓사장님」)을 한 칸으로 접는다 —
#   verify.ps1 이 두 칸 공백 제목을 「변수 보간 실패」로 보고 커밋을 막아 10-07~10-23 열이레 동안 검색 페이지가 한 번도 갱신되지 않았다
#   글자 사이의 공백만 접는다(앞뒤가 공백 아닌 글자) — JSON 구조·줄바꿈은 건드리지 않는다
function SquashSpaces([string]$j){ return [regex]::Replace($j, '(?<=\S)[ \t 　]{2,}(?=\S)', ' ') }
if($DataFile){
  $D = SquashSpaces ([IO.File]::ReadAllText($DataFile)) | ConvertFrom-Json
} else {
  $api = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/rpc/seo_dataset'
  $r = Invoke-WebRequest -Uri $api -Method POST -TimeoutSec 180 `
        -Headers @{ apikey=$key; Authorization="Bearer $key"; 'Content-Type'='application/json' } -Body '{}'
  $D = SquashSpaces ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())) | ConvertFrom-Json
}

# ── 활성 핫딜 (브랜드 페이지 연동 — "OO 공구 핫딜" 검색 수요, 자동완성 실측 2026-08-14) ──
# 공개 REST 만 쓴다(핫딜 목록은 어차피 사이트에 공개되는 내용). 실패해도 페이지 생성은 계속한다.
$HotDeals = @()
try{
  $hApi = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/hotdeals'
  # ⚠ PostgREST 는 값 자리의 now() 를 문자열로 취급한다(실측: 핫딜 15개가 1개로 줄었다) → 실제 시각을 넣는다
  $nowUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $hQ   = "?select=id,title,link&or=(expires_at.is.null,expires_at.gte.$nowUtc)&order=id.desc&limit=80"
  $hr = Invoke-WebRequest -Uri ($hApi + $hQ) -TimeoutSec 30 `
        -Headers @{ apikey=$key; Authorization="Bearer $key" }
  # ⚠ PS 5.1 ConvertFrom-Json 은 JSON 배열을 한 덩어리로 준다 → 파이프로 한 번 풀어야 개수가 맞는다(실측 31→1)
  $HotDeals = @(([Text.Encoding]::UTF8.GetString($hr.RawContentStream.ToArray()) | ConvertFrom-Json) | ForEach-Object { $_ })
  Write-Output "활성 핫딜 $($HotDeals.Count)개 확보"
}catch{ Write-Output "핫딜 조회 실패(무시): $($_.Exception.Message)" }

# ── 공구 캡션 (셀러 공지 원문 — 건별 상세 페이지의 고유 본문, 사장님 지시 2026-08-31 "다 수집해") ──
# 저장 단계에서 전화·이메일·계좌열은 이미 제거돼 있다(caption_attach.mjs). 렌더 때 외부 링크를 추가로 걷어낸다.
$CapMap = @{}
try{
  $cApi = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/gonggu'
  $off = 0
  while($true){
    $cq = "?select=name,open_date,caption&approved=eq.true&caption=not.is.null&order=id.asc&offset=$off&limit=1000"
    $cr = Invoke-WebRequest -Uri ($cApi + $cq) -TimeoutSec 60 -Headers @{ apikey=$key; Authorization="Bearer $key" }
    $cj = @(([Text.Encoding]::UTF8.GetString($cr.RawContentStream.ToArray()) | ConvertFrom-Json) | ForEach-Object { $_ })
    if($cj.Count -eq 0){ break }
    foreach($c0 in $cj){ $CapMap[("$($c0.name)|$($c0.open_date)").ToLower()] = "$($c0.caption)" }
    if($cj.Count -lt 1000){ break }
    $off += 1000
  }
  Write-Output "공구 캡션 $($CapMap.Count)건 확보"
}catch{ Write-Output "캡션 조회 실패(무시): $($_.Exception.Message)" }

# ── GSC 실측 보강어 (2026-08-31) ──
# 서치콘솔에서 '노출은 있는데 순위·클릭이 처지는' 검색어의 제품어를 브랜드별로 적어두면
# 그 브랜드 페이지 제목·본문·FAQ 에 "브랜드 제품어 공구" 조합으로 실린다.
# 파일: tools/seo/boost.json — { "브랜드": ["제품어", ...] }. 없어도 빌드는 계속된다.
$Boost = @{}
try{
  $bj = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'boost.json')) | ConvertFrom-Json
  foreach($pr in $bj.PSObject.Properties){ $Boost[$pr.Name] = @($pr.Value) }
  Write-Output "GSC 보강어: 브랜드 $($Boost.Count)개"
}catch{ Write-Output "boost.json 없음/읽기 실패(무시)" }
# ── 🚫 브랜드 차단 목록 (2026-09-08, 아틀리에 퀸스 측 "검색엔진·DB 전부 삭제, 수집 중단" 요청) ──
# DB `brand_block.pattern`(정규식, 대소문자 무시). DB 트리거가 새 수집을 막고, 여기서는
#   ① 오늘 집계에 남아 있어도 페이지를 안 만들고 ② 디스크에 남은 보존 페이지(g/·gg/·p/)를 지워 sitemap 에서도 뺀다.
# 못 읽으면(네트워크) 차단 없이 진행하되 로그에 남긴다 — 다음 빌드가 다시 지운다.
$BlockPats = @()
try{
  $bkr = Invoke-WebRequest -Uri 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/brand_block?select=pattern' -TimeoutSec 30 `
        -Headers @{ apikey=$key; Authorization="Bearer $key" }
  $BlockPats = @(([Text.Encoding]::UTF8.GetString($bkr.RawContentStream.ToArray()) | ConvertFrom-Json) | ForEach-Object { "$($_.pattern)" } | Where-Object { $_ })
  Write-Output "브랜드 차단 패턴 $($BlockPats.Count)개"
}catch{ Write-Output "brand_block 조회 실패(차단 없이 진행): $($_.Exception.Message)" }

# ── 내려놓은 공구(gonggu_hold)의 건별 페이지는 보존하지 않는다 (2026-10-06) ──
# 🔴 왜: 중복이라 내린 행의 페이지가 /gg/뉴욕-프리미엄-텀블러-1006.html 로 **200** 이고
#    sitemap 에도 남아 있었다. 같은 공구가 구글에 두 URL 로 뜬다(내린 것 + 남긴 것).
#    아래 KeptUrls() 의 보존 원칙은 **지난 공구**를 남기려는 것이지, 중복이라 내린 행까지 남기려는 게 아니다.
# 🔑 뷰 gonggu_hold_public 은 슬러그에 필요한 name·open_date 만 내준다(사유는 안 내준다).
#    표 자체는 anon 에게 닫혀 있다 — supabase/sql/gonggu_hold_public_79.sql
$HeldGg = @{}
try{
  $hr = Invoke-WebRequest -Uri 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/gonggu_hold_public?select=name,open_date' -TimeoutSec 30 `
        -Headers @{ apikey=$key; Authorization="Bearer $key" }
  foreach($h in ([Text.Encoding]::UTF8.GetString($hr.RawContentStream.ToArray()) | ConvertFrom-Json)){
    $hb = SlugOf "$($h.name)" $null '-gg'
    if([string]::IsNullOrWhiteSpace($hb)){ continue }
    # gg 슬러그 = 상품명 + '-' + 오픈일 MMDD (아래 건별 페이지 생성과 같은 규칙)
    $HeldGg[("$hb-" + "$($h.open_date)".Replace('-','').Substring(4)).ToLower()] = 1
  }
  Write-Output "내려놓은 공구 슬러그 $($HeldGg.Count)개 — 건별 페이지를 보존하지 않는다"
}catch{ Write-Output "gonggu_hold_public 조회 실패(보존 그대로 진행): $($_.Exception.Message)" }
$HeldRemoved = 0
# 같은 이름·같은 날 공구가 둘이면 뒤엣것에 -2, -3 이 붙는다. 그 꼬리를 떼고 본다.
function IsHeldGg([string]$base){
  if($HeldGg.Count -eq 0 -or [string]::IsNullOrWhiteSpace($base)){ return $false }
  $b = $base.ToLower()
  if($HeldGg.ContainsKey($b)){ return $true }
  if($b -match '^(.*)-\d+$'){ return $HeldGg.ContainsKey($Matches[1]) }
  return $false
}

function IsBlocked([string]$t){
  if([string]::IsNullOrWhiteSpace($t)){ return $false }
  foreach($p in $BlockPats){ if($t -imatch $p){ return $true } }
  return $false
}
$BlockedRemoved = 0

# ── 네이버 월간 검색량 (2026-08-31, momcal-kw-daily 스윕 산출) ──
# 내부 링크 자리는 한정 자원이다. '등록 건수' 가 아니라 '실제 검색량' 큰 브랜드에
# 링크 힘을 몰아준다. 파일: tools/seo/kw_volume.json — { "브랜드": 월간합계 }.
$KwVol = @{}
try{
  $kv = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'kw_volume.json')) | ConvertFrom-Json
  foreach($pr in $kv.PSObject.Properties){ $KwVol[$pr.Name] = [int]$pr.Value }
  Write-Output "검색량 지도: 브랜드 $($KwVol.Count)개"
}catch{ Write-Output "kw_volume.json 없음(무시) — 링크 서열은 건수순" }
function VolOf([string]$b){ if($KwVol.ContainsKey($b)){ return [int]$KwVol[$b] } return 0 }
$today = $D.today
if(-not $today){ throw '데이터에 today 가 없다' }
Write-Output "데이터 기준일: $today (캐시 $($D.cached_at))"

# 조용히 낡는 것을 막는 가드.
# 캐시를 만드는 pg_cron 이 멎으면 매일 '어제 페이지'를 다시 만들면서 아무 표시도 안 난다.
# 여기서 멈춰야 Actions 가 실패로 뜨고 사람이 알아챈다.
if($D.cached_at){
  try{
    $ageH = [int]((Get-Date).ToUniversalTime() - ([datetime]$D.cached_at).ToUniversalTime()).TotalHours
    Write-Output "캐시 나이: ${ageH}시간"
    if($ageH -gt 30){ throw "캐시가 ${ageH}시간째 갱신되지 않았다. pg_cron 'seo-refresh' 를 확인할 것" }
  }catch [System.Management.Automation.RuntimeException] { throw }
  catch { Write-Output "캐시 나이 계산 실패(무시): $($_.Exception.Message)" }
}
# 집계가 반쯤 깨진 채로 페이지를 통째로 날리는 사고를 막는다(실제로 0개 생성된 적 있다)
if(@($D.brands).Count -lt 100 -or @($D.sellers).Count -lt 50){
  throw "데이터가 비정상이다 (브랜드 $(@($D.brands).Count) · 셀러 $(@($D.sellers).Count)). 페이지를 만들지 않는다"
}

$N_TOTAL = [int]$D.stat.total; $N_SELLERS = [int]$D.stat.sellers
$fmtTotal = '{0:N0}' -f $N_TOTAL; $fmtSellers = '{0:N0}' -f $N_SELLERS

# ── lastmod 위생: 지우기 전에 '지금 있는 것' 을 찍어둔다 ──
# 내용이 안 바뀐 페이지까지 매일 오늘 날짜로 내보내면 크롤러가 우리 신호를 안 믿는다.
# 그래서 ① 옛 sitemap 의 lastmod 와 ② 옛 파일 해시를 먼저 모아두고,
# 새로 만든 파일이 옛것과 같으면 옛 날짜를 그대로 쓴다.
$PrevMod = @{}; $PrevHash = @{}
foreach($sm in @('sitemap-main.xml','sitemap-brand.xml','sitemap-product.xml','sitemap-seller.xml','sitemap-gonggu.xml')){
  $p = Join-Path $Root $sm
  if(-not (Test-Path $p)){ continue }
  try{
    $x = [xml][IO.File]::ReadAllText($p)
    foreach($u in $x.urlset.url){
      $rel = [uri]::UnescapeDataString(($u.loc -replace '^https://momcalendar\.com/',''))
      if($rel -ne '' -and $u.lastmod){ $PrevMod[$rel] = "$($u.lastmod)" }
    }
  }catch{ Write-Output "옛 sitemap 읽기 실패(무시): $sm" }
}
foreach($rel in @($PrevMod.Keys)){
  $fp = Join-Path $Root $rel
  if(Test-Path -LiteralPath $fp){ $PrevHash[$rel] = (Get-FileHash -LiteralPath $fp -Algorithm MD5).Hash }
}
Write-Output "옛 lastmod $($PrevMod.Count)개 · 해시 $($PrevHash.Count)개 확보"

# ── 폴더 준비 — 한 번 만든 페이지는 지우지 않는다 (2026-08-25, 월별 페이지와 같은 원칙) ──
# 예전엔 매일 폴더를 비우고 그날 집계분만 다시 만들었다. 그런데 공구가 2개월 지나
# gonggu_archive 로 이관되면 그 브랜드·셀러가 집계에서 빠지고, 페이지가 삭제돼
# 하루 50~100개씩 404 가 됐다(서치콘솔 404 489건의 원인). 이제 오늘 집계에 없는
# 페이지는 그대로 두고 sitemap 에도 남긴다(아래 KeptUrls 로 합류).
# ⚠ 반복 변수를 $d 로 쓰면 안 된다. PowerShell 은 대소문자를 구분하지 않아
#   데이터가 담긴 $D 를 덮어써 버린다(실제로 한 번 당했다).
foreach($dir in @('g','p','s','m','d','c','gg')){
  $pp = Join-Path $Root $dir
  if(-not (Test-Path $pp)){ New-Item -ItemType Directory -Path $pp | Out-Null }
}

# ── 파일명 대소문자 정본 지도 (2026-08-28) ──
# DB 의 브랜드 표기가 날마다 바뀌면(VOOKS → Vooks) 리눅스(Actions)에선 케이스만 다른
# 파일이 하나 더 생긴다(실측: g/VOOKS.html + g/Vooks.html). 윈도우 로컬 체크아웃은
# 이 둘을 한 파일로 합쳐 버려 저장소가 영구 dirty 가 되고 pull·rebase 가 전부 막힌다.
# → 슬러그를 정할 때 디스크에 이미 있는 케이스를 그대로 재사용한다. 새 쌍은 생기지 않는다.
#   케이스 쌍이 이미 있으면 서수(ordinal) 정렬이 앞선 쪽을 정본으로 삼는다(결정적 선택).
$CaseCanon = @{}
foreach($dir in @('g','p','s','gg')){
  $map = @{}
  $names = @(Get-ChildItem (Join-Path $Root $dir) -Filter *.html -File | ForEach-Object { $_.BaseName })
  [Array]::Sort($names, [System.StringComparer]::Ordinal)
  foreach($n in $names){ $k = $n.ToLower(); if(-not $map.ContainsKey($k)){ $map[$k] = $n } }
  $CaseCanon[$dir] = $map
}
function CanonCase([string]$slug, [string]$dirKey){
  if([string]::IsNullOrWhiteSpace($slug)){ return $slug }
  $m = $CaseCanon[$dirKey]; $k = $slug.ToLower()
  if($m.ContainsKey($k)){ return $m[$k] }
  $m[$k] = $slug; return $slug
}

$liveRows = ParseRows $D.live @('name','who','od','ed','major')
$soonRows = ParseRows $D.soon @('name','who','od','ed','major')

# ══ 제품 슬러그 먼저 (브랜드 페이지에서 링크해야 하므로) ══
$seenP = @{}; $prodMap = @{}; $prodList = New-Object System.Collections.ArrayList
$seenPName = @{}
foreach($x in $D.products){
  if(IsBlocked "$($x.brand) $($x.prod)"){ continue }   # 🚫 차단 브랜드
  # 케이스만 다른 같은 제품이 같은 날 집계에 함께 오면 두 번째가 -2 페이지로 갈라진다
  # → 표기 하나만 남긴다(집계 정렬상 앞선 쪽 = 건수 많은 쪽)
  $nk = ("$($x.brand)-$($x.prod)").ToLower()
  if($seenPName.ContainsKey($nk)){ continue }
  $seenPName[$nk] = 1
  $slug = CanonCase (SlugOf "$($x.brand)-$($x.prod)" $seenP '-p') 'p'
  if([string]::IsNullOrWhiteSpace($slug)){ continue }
  $o = [pscustomobject]@{ slug=$slug; brand=$x.brand; prod=$x.prod; key=$x.key; cnt=[int]$x.cnt;
                          sellers=[int]$x.sellers; major=$x.major; minor=$x.minor;
                          first=$x.first_open; last=$x.last_open; raw=$x.rows }
  [void]$prodList.Add($o)
  if(-not $prodMap.ContainsKey($x.brand)){ $prodMap[$x.brand] = New-Object System.Collections.ArrayList }
  [void]$prodMap[$x.brand].Add($o)
}

# ══ 브랜드 슬러그 ══
$seenB = @{}; $brandList = New-Object System.Collections.ArrayList
$seenBName = @{}
foreach($x in $D.brands){
  if(IsBlocked "$($x.brand)"){ continue }   # 🚫 차단 브랜드 — 페이지·링크 전부 안 만든다
  # NON-GMO vs Non-gmo 처럼 케이스만 다른 같은 브랜드는 하나만 남긴다
  $nk = ("$($x.brand)").ToLower()
  if($seenBName.ContainsKey($nk)){ continue }
  $seenBName[$nk] = 1
  $slug = CanonCase (SlugOf $x.brand $seenB '-g') 'g'
  if([string]::IsNullOrWhiteSpace($slug)){ continue }
  [void]$brandList.Add([pscustomobject]@{ slug=$slug; brand=$x.brand; cnt=[int]$x.cnt; sellers=[int]$x.sellers;
       major=$x.major; first=$x.first_open; last=$x.last_open; topprods=$x.topprods; raw=$x.rows })
}
$brandSlug = @{}
foreach($b in $brandList){ if(-not $brandSlug.ContainsKey($b.brand)){ $brandSlug[$b.brand] = $b.slug } }
# 검색량 1순위 · 건수 2순위 (검색되는 브랜드에 내부 링크 힘을 몰아준다, 2026-08-31)
$topBrands = $brandList | Sort-Object @{e={VolOf $_.brand};Descending=$true}, @{e={[int]$_.cnt};Descending=$true}, @{e='brand';Descending=$false} | Select-Object -First 24

# ══ 셀러 슬러그 먼저 ══
# 카드에서 셀러 페이지로 링크하려면 주소를 미리 알아야 한다.
# ⚠ insta 를 그대로 쓰면 안 된다 — 셀러 페이지 파일명은 SlugOf 를 거친 값이라 다를 수 있고,
#   셀러 목록에 없는 insta 도 있다. 그대로 링크했다가 깨진 내부링크가 327개 났다(2026-08-11).
$seenS = @{}; $SellerSlug = @{}; $korCount = @{}; $korInsta = @{}
$seenSName = @{}
foreach($s in $D.sellers){
  # 인스타 핸들은 대소문자 구분이 없다 → 케이스만 다른 행은 같은 셀러, 하나만 남긴다
  $nk = ("$($s.insta)").ToLower()
  if($seenSName.ContainsKey($nk)){ continue }
  $seenSName[$nk] = 1
  $sl = CanonCase (SlugOf $s.insta $seenS '-s') 's'
  if([string]::IsNullOrWhiteSpace($sl)){ continue }
  if(-not $SellerSlug.ContainsKey($s.insta)){ $SellerSlug[$s.insta] = $sl }
  # 소분류·월별 페이지는 데이터에 insta 가 없고 한글명(who)만 있다.
  # 이름이 겹치지 않는 셀러에 한해 이름으로 인스타를 찾는다(겹치면 링크를 안 건다).
  if($s.kor){
    $k = "$($s.kor)"
    $korCount[$k] = 1 + $(if($korCount.ContainsKey($k)){ $korCount[$k] } else { 0 })
    $korInsta[$k] = "$($s.insta)"
  }
}
$SellerByKor = @{}
foreach($k in $korCount.Keys){ if($korCount[$k] -eq 1){ $SellerByKor[$k] = $korInsta[$k] } }

# ══ 공구 건별 상세 페이지 선계산 (2026-08-31, 지금하는공구(09now) 대응 — 사장님 지시 "동일하게 작업") ══
# 네이버 SERP 실측: 09now 는 공구 1건마다 "브랜드-제품" URL 상세 문서를 만들어
# '바크 공구'·'세이펜 공구' 같은 브랜드 검색의 웹문서 자리를 전부 가져간다.
# 우리는 브랜드당 집계 1장뿐이라 그 자리에 못 들어갔다 → 건별 문서를 만든다.
# 슬러그 = 상품명(40자) + 오픈일 MMDD — 재실행에도 결정적. 페이지는 지우지 않는다(보존 원칙).
$GgSlug = @{}; $ggSeen = @{}; $ggRows = New-Object System.Collections.ArrayList; $GgByBrand = @{}
foreach($b in $brandList){
  $rows0 = ParseRows $b.raw @('who','name','od','ed','insta')
  foreach($r in $rows0){
    if(IsBlocked "$($r.name)"){ continue }   # 🚫 차단 브랜드 건별 페이지
    $k = ("$($r.name)|$($r.od)").ToLower()
    if($GgSlug.ContainsKey($k)){ continue }
    if("$($r.od)".Length -lt 10 -or "$($r.ed)".Length -lt 10){ continue }
    $base = SlugOf "$($r.name)" $null '-gg'
    if([string]::IsNullOrWhiteSpace($base)){ continue }
    $slug = CanonCase ("$base-" + $r.od.Replace('-','').Substring(4)) 'gg'
    if($ggSeen.ContainsKey($slug.ToLower())){
      $n2 = [int]$ggSeen[$slug.ToLower()] + 1; $ggSeen[$slug.ToLower()] = $n2; $slug = "$slug-$n2"
    } else { $ggSeen[$slug.ToLower()] = 1 }
    $GgSlug[$k] = $slug
    $o2 = [pscustomobject]@{ slug=$slug; brand=$b.brand; who=$r.who; name=$r.name; od=$r.od; ed=$r.ed; insta=$r.insta }
    [void]$ggRows.Add($o2)
    if(-not $GgByBrand.ContainsKey($b.brand)){ $GgByBrand[$b.brand] = New-Object System.Collections.ArrayList }
    [void]$GgByBrand[$b.brand].Add($o2)
  }
}
Write-Output "공구 건별 상세 대상: $($ggRows.Count)건"

# ══ 브랜드 페이지 ══
foreach($b in $brandList){
  $rows = ParseRows $b.raw @('who','name','od','ed','insta')
  $sp = SplitNow $rows $today
  $live = $sp.now; $soon = $sp.soon; $past = $sp.past
  # 가격·수량 토큰("77,000원")과 '전제품' 같은 비제품어는 제목에 싣지 않는다 (상떼 실측 2026-08-31)
  $tp = @(); if($b.topprods){ $tp = @($b.topprods -split '\|' | Where-Object { $_ -and $_ -ne $b.brand -and $_ -notmatch '^[\d,\.]+' -and $_ -notmatch '^(전제품|전상품|단하루|오늘|핫딜)$' }) }
  # GSC 보강어는 앞에 붙인다 → 제목의 상위 3개 자리에 실린다.
  # 기존 제품어 중 보강어와 겹치는 것(공백 무시 포함관계)은 걷어낸다 — "티오람 미니·미니·티오람미니" 같은 중복 방지.
  if($Boost.ContainsKey($b.brand)){
    $add = @($Boost[$b.brand] | Where-Object { $_ })
    if($add.Count -gt 0){
      $addN = @($add | ForEach-Object { "$_" -replace '\s','' })
      $tp = @($tp | Where-Object {
        $t = "$_" -replace '\s',''
        -not (@($addN | Where-Object { $_ -eq $t -or $_.Contains($t) -or $t.Contains($_) }).Count -gt 0)
      })
      $tp = @($add) + @($tp)
    }
  }
  $tpTxt = ''; if($tp.Count -gt 0){ $tpTxt = ($tp | Select-Object -First 3) -join '·' }

  if($tpTxt){
    $title = "$($b.brand) 공구 | $tpTxt 공동구매 일정·진행중인 곳 - 맘캘린더"
    $desc  = "$($b.brand) 공구 정보. $tpTxt 등 $($b.brand) 공동구매를 진행하는 인스타 셀러와 오픈·마감 날짜를 한곳에서 확인하세요."
  } else {
    $title = "$($b.brand) 공구 | 인스타 공동구매 일정·진행중인 곳 - 맘캘린더"
    $desc  = "$($b.brand) 공동구매를 진행하는 인스타 셀러와 오픈·마감 날짜. 지금 진행 중인 $($b.brand) 공구와 지난 일정을 맘캘린더에서 확인하세요."
  }
  $canon = "g/$(Enc $b.slug).html"
  # ⚠ 집계·분석 문구는 넣지 않는다. 셀러 수·진행 횟수·주력 품목 같은 값은
  #   사장님이 크몽에 팔 데이터 자산이다(사장님 지시 2026-08-11). 일정 목록만 보여준다.
  $lead = "$($b.brand) 공동구매 일정입니다. 인스타 셀러들이 진행하는 $($b.brand) 공구를 날짜순으로 모았습니다."
  if($tpTxt){ $lead += " $tpTxt 등 $($b.brand) 제품의 공구 일정을 아래에서 확인하세요." }
  if($live.Count -gt 0){ $lead += " 지금 진행 중인 공구는 맨 위에 있습니다." }
  elseif($soon.Count -gt 0){ $lead += " 지금 진행 중인 공구는 없고, 곧 열릴 일정이 아래에 있습니다." }
  else { $lead += " 지금 진행 중인 공구는 없습니다. 지난 일정을 보면 다음 공구 시기를 가늠할 수 있습니다." }

  $body = "<div class=${Q}sec${Q}><p>$(HtmlEsc $lead)</p></div>"
  if($live.Count -gt 0){
    $body += "<div class=${Q}sec${Q}><h2>지금 진행 중인 $(HtmlEsc $b.brand) 공구</h2>" + (CardsHtml $live 20 $true $true) + '</div>'
  }
  if($soon.Count -gt 0){
    $body += "<div class=${Q}sec${Q}><h2>곧 열리는 $(HtmlEsc $b.brand) 공구</h2>" + (CardsHtml $soon 20 $false $true) + '</div>'
  }
  if($prodMap.ContainsKey($b.brand)){
    $ps = @($prodMap[$b.brand] | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='key';Descending=$false})
    if($ps.Count -gt 0){
      $body += "<div class=${Q}sec${Q}><h2>$(HtmlEsc $b.brand) 제품별 공구</h2><div class=${Q}rel${Q}>"
      foreach($p in ($ps | Select-Object -First 30)){ $body += "<a href=${Q}/p/$(Enc $p.slug).html${Q}>$(HtmlEsc $p.key) 공구</a>" }
      $body += '</div></div>'
    }
  }
  if($past.Count -gt 0){
    $body += "<div class=${Q}sec${Q}><h2>지난 $(HtmlEsc $b.brand) 공구</h2>" + (CardsHtml $past 40 $false $true) + '</div>'
  }
  # 건별 상세 페이지로 가는 크롤 경로 (최근 일정 8건)
  if($GgByBrand.ContainsKey($b.brand)){
    $gl = @($GgByBrand[$b.brand] | Sort-Object @{e='od';Descending=$true}, @{e='slug';Descending=$false} | Select-Object -First 8)
    if($gl.Count -gt 0){
      $body += "<div class=${Q}sec${Q}><h2>$(HtmlEsc $b.brand) 공구 일정 상세</h2><div class=${Q}rel${Q}>"
      foreach($x2 in $gl){ $body += "<a href=${Q}/gg/$(Enc $x2.slug).html${Q}>$(HtmlEsc $x2.name) ($($x2.od.Substring(5).Replace('-','/')))</a>" }
      $body += '</div></div>'
    }
  }
  # ── 이 브랜드 상품이 핫딜에 떠 있으면 연결 ("세이펜 공구 핫딜" 류 검색 수요) ──
  $hd = @($HotDeals | Where-Object { $_.title -and ("$($_.title)").Contains($b.brand) } | Select-Object -First 3)
  if($hd.Count -gt 0){
    $body += "<div class=${Q}sec${Q}><h2>지금 진행 중인 $(HtmlEsc $b.brand) 핫딜</h2><div class=${Q}rel${Q}>"
    foreach($x in $hd){ $body += "<a href=${Q}$(HtmlEsc $x.link)${Q} rel=${Q}nofollow sponsored${Q} target=${Q}_blank${Q}>🔥 $(HtmlEsc $x.title)</a>" }
    $body += "</div><p style=${Q}margin-top:8px;font-size:11px;color:#B5AFBD${Q}>제휴 활동으로 일정액의 수수료를 받을 수 있습니다</p></div>"
  }
  $ex = ExtraBody $b.brand '브랜드' $live $soon $past $tp
  $body += $ex.html
  $body += "<div class=${Q}sec${Q}><h2>다른 브랜드 공구</h2><div class=${Q}rel${Q}>"
  foreach($t in $topBrands){ if($t.slug -ne $b.slug){ $body += "<a href=${Q}/g/$(Enc $t.slug).html${Q}>$(HtmlEsc $t.brand) 공구</a>" } }
  $body += '</div></div>'

  $ld = New-Object System.Collections.ArrayList
  $l1 = LdItemList "$($b.brand) 공구 일정" ($live + $past) 25
  if($l1){ [void]$ld.Add($l1) }
  $lf = LdFaq $ex.faq
  if($lf){ [void]$ld.Add($lf) }
  [void]$ld.Add((LdCrumb "$($b.brand) 공구" $canon))
  # 🔎 라벨-값 사실 표 (NEO — 네이버 AI 브리핑이 인용하는 형태)
  # ⚠ 위 주석대로 **집계는 넣지 않는다** — 셀러 수·진행 횟수는 사장님이 파는 데이터 자산이다.
  #   여기 적는 것은 이미 화면 카드에 보이는 값을 기계가 읽기 좋게 옮긴 것뿐이다.
  $fStatus = if($live.Count -gt 0){ '진행 중' } elseif($soon.Count -gt 0){ '예정' } else { '진행 중인 공구 없음' }
  $fRecent = ''
  $fSrc = ''
  $rcv = if($live.Count -gt 0){ $live[0] } elseif($soon.Count -gt 0){ $soon[0] } elseif($past.Count -gt 0){ $past[0] } else { $null }
  if($rcv){
    $fRecent = "$($rcv.od) ~ $($rcv.ed)"
    if($rcv.PSObject.Properties['who'] -and $rcv.who){ $fSrc = "$($rcv.who) 인스타그램 공지" }
  }
  $facts = @(
    @{ k='브랜드'; v=$b.brand },
    @{ k='공구 상태'; v=$fStatus },
    @{ k='해당 일정'; v=$fRecent },
    @{ k='정보 출처'; v=$fSrc },
    @{ k='기준일'; v=$ASOF }
  )
  WritePage @{ path=(Join-Path $Root "g/$($b.slug).html"); title=$title; desc=$desc; canon=$canon;
    h1="$($b.brand) 공구"; sub="인스타 공동구매 일정"; body=$body; jsonld=$ld; bcName="$($b.brand) 공구"; facts=$facts }
}

# ══ 브랜드 × 제품 페이지 ══
foreach($p in $prodList){
  $rows = ParseRows $p.raw @('name','who','od','ed','insta')
  $sp = SplitNow $rows $today
  $live = $sp.now; $soon = $sp.soon; $past = $sp.past
  # 상세 변형 키워드 — 실제 상품명("대나무 칫솔" 등)이 제목·설명에 실려야
  # "닥터노아 대나무 칫솔" 같은 상세 검색어에 걸린다(네이버 경쟁사 실측, 사장님 지시 2026-08-25).
  $vn = @{}
  foreach($r in $rows){
    $t2 = ("$($r.name)").Trim()
    $bLow = ("$($p.brand)").ToLower()
    if($bLow -and $t2.ToLower().StartsWith($bLow)){ $t2 = $t2.Substring($bLow.Length).Trim() }
    $t2 = ($t2 -replace '^[-·:,/]+','').Trim()
    if($t2.Length -ge 2 -and $t2.Length -le 24 -and $t2 -ne "$($p.prod)" -and $t2 -ne "$($p.key)"){
      if($vn.ContainsKey($t2)){ $vn[$t2] = [int]$vn[$t2] + 1 } else { $vn[$t2] = 1 }
    }
  }
  $vTop = @($vn.GetEnumerator() | Sort-Object @{e='Value';Descending=$true}, @{e='Name';Descending=$false} | Select-Object -First 2 | ForEach-Object { $_.Name })
  $vTxt = $vTop -join '·'
  if($vTxt){
    $title = "$($p.key) 공구 | $vTxt 공동구매 일정·진행중인 곳 - 맘캘린더"
    $desc  = "$($p.key) 공구 일정. $vTxt 등 진행 중인 $($p.key) 공동구매와 지난 일정, 오픈·마감 날짜를 확인하세요."
  } else {
    $title = "$($p.key) 공구 | 공동구매 일정·진행중인 곳 - 맘캘린더"
    $desc  = "$($p.key) 공구 일정. 진행 중인 $($p.key) 공동구매와 지난 일정, 오픈·마감 날짜를 확인하세요."
  }
  $canon = "p/$(Enc $p.slug).html"

  # ⚠ 집계·분석은 넣지 않는다(사장님 지시 2026-08-11 — 크몽에 팔 자산).
  $lead = "$($p.key) 공동구매 일정입니다. 인스타 셀러들이 진행하는 $($p.key) 공구를 날짜순으로 모았습니다."
  if($live.Count -gt 0){ $lead += " 지금 진행 중인 공구는 맨 위에 있습니다." }
  elseif($soon.Count -gt 0){ $lead += " 지금 진행 중인 공구는 없고, 곧 열릴 일정이 아래에 있습니다." }
  else { $lead += " 지금 진행 중인 공구는 없습니다. 지난 일정으로 다음 공구 시기를 가늠해 보세요." }

  $body = "<div class=${Q}sec${Q}><p>$(HtmlEsc $lead)</p></div>"
  if($live.Count -gt 0){
    $body += "<div class=${Q}sec${Q}><h2>지금 진행 중인 $(HtmlEsc $p.key) 공구</h2>" + (CardsHtml $live 20 $true $true) + '</div>'
  }
  if($soon.Count -gt 0){
    $body += "<div class=${Q}sec${Q}><h2>곧 열리는 $(HtmlEsc $p.key) 공구</h2>" + (CardsHtml $soon 20 $false $true) + '</div>'
  }
  if($past.Count -gt 0){
    $body += "<div class=${Q}sec${Q}><h2>지난 $(HtmlEsc $p.key) 공구</h2>" + (CardsHtml $past 40 $false $true) + '</div>'
  }
  $ex = ExtraBody $p.key '제품' $live $soon $past @()
  $body += $ex.html
  $body += "<div class=${Q}sec${Q}><h2>관련 공구</h2><div class=${Q}rel${Q}>"
  if($brandSlug.ContainsKey($p.brand)){ $body += "<a href=${Q}/g/$(Enc $brandSlug[$p.brand]).html${Q}>$(HtmlEsc $p.brand) 전체 공구</a>" }
  if($prodMap.ContainsKey($p.brand)){
    foreach($o in ($prodMap[$p.brand] | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='key';Descending=$false} | Select-Object -First 12)){
      if($o.slug -ne $p.slug){ $body += "<a href=${Q}/p/$(Enc $o.slug).html${Q}>$(HtmlEsc $o.key) 공구</a>" }
    }
  }
  $body += '</div></div>'

  $ld = New-Object System.Collections.ArrayList
  $l1 = LdItemList "$($p.key) 공구 일정" ($live + $past) 25
  if($l1){ [void]$ld.Add($l1) }
  $lf = LdFaq $ex.faq
  if($lf){ [void]$ld.Add($lf) }
  [void]$ld.Add((LdCrumb "$($p.key) 공구" $canon))
  WritePage @{ path=(Join-Path $Root "p/$($p.slug).html"); title=$title; desc=$desc; canon=$canon;
    h1="$($p.key) 공구"; sub="인스타 공동구매 일정"; body=$body; jsonld=$ld; bcName="$($p.key) 공구" }
}

# ══ 공구 건별 상세 페이지 (gg/) ══
foreach($x in $ggRows){
  $isLive = ($x.od -le $today -and $x.ed -ge $today)
  $isSoon = ($x.od -gt $today)
  $odK = $x.od.Substring(5).Replace('-','/'); $edK = $x.ed.Substring(5).Replace('-','/')
  $whoTxt = ''; if($x.who){ $whoTxt = "$($x.who) " }

  # 오픈일을 제목에 넣어 재공구 회차끼리도 제목이 겹치지 않게 한다 (중복 title 회피)
  $title = "$($x.name) 공구 | $($whoTxt)인스타 공동구매 · $odK 오픈 - 맘캘린더"
  if($title.Length -gt 72){ $title = "$($x.name) 공구 일정 · $odK 오픈 - 맘캘린더" }
  $desc = "$($x.name) 공구 일정 — $($x.od) 오픈, $($x.ed) 마감. $($whoTxt)인스타그램 공동구매의 날짜와 참여 방법을 확인하세요."
  $canon = "gg/$(Enc $x.slug).html"

  if($isLive){ $lead = "$($x.name) 공동구매가 지금 진행 중입니다. $odK 에 열렸고 $edK 마감입니다. 아래 카드를 누르면 진행 셀러의 인스타그램으로 이동합니다." }
  elseif($isSoon){ $lead = "$($x.name) 공동구매는 $odK 오픈 예정입니다. 마감은 $edK 입니다. 오픈일에 셀러 계정 공지로 신청할 수 있습니다." }
  else { $lead = "$($x.name) 공동구매는 $($x.od) ~ $($x.ed) 에 진행된 일정입니다. 같은 상품은 보통 몇 주~몇 달 간격으로 다시 열립니다. 브랜드 페이지에서 다음 일정을 확인하세요." }

  $item = [pscustomobject]@{ name=$x.name; who=$x.who; od=$x.od; ed=$x.ed; insta=$x.insta }
  $body = "<div class=${Q}sec${Q}><p>$(HtmlEsc $lead)</p></div>"
  $body += "<div class=${Q}sec${Q}><h2>일정</h2>" + (CardsHtml @($item) 1 $isLive $true) + '</div>'

  # 셀러 공지 원문 — 문서 고유성의 핵심 (지공이 이기던 비결). 렌더 시 외부 링크 제거·출처 명시.
  $capK = ("$($x.name)|$($x.od)").ToLower()
  if($CapMap.ContainsKey($capK)){
    $cap = [regex]::Replace($CapMap[$capK], 'https?://\S+', '')
    $cap = $cap.Trim()
    if($cap.Length -gt 60){
      if($cap.Length -gt 2000){ $cap = $cap.Substring(0,2000) + '…' }
      $d1 = ([regex]::Replace($cap, '\s+', ' ')).Trim()
      if($d1.Length -gt 140){ $d1 = $d1.Substring(0,140) + '…' }
      $desc = "$($x.name) 공구 ($($x.od) 오픈) — $d1"
      $capHtml = (HtmlEsc $cap) -replace "`n",'<br>'
      $body += "<div class=${Q}sec${Q}><h2>셀러 공지</h2><div class=${Q}faq${Q}><span>$capHtml</span></div>"
      $body += "<p style=${Q}font-size:11px;color:#B5AFBD;margin-top:6px${Q}>진행 셀러$(if($x.who){ ' ' + (HtmlEsc $x.who) })가 인스타그램에 게시한 공지 원문입니다.</p></div>"
    }
  }

  $faq = @()
  $faq += @{ q="$($x.name) 공구는 언제 하나요?"; a="이 일정은 $($x.od) 오픈, $($x.ed) 마감입니다. 기간이 지나면 정가로 돌아가므로 마감일 안에 신청해야 합니다." }
  $faq += @{ q="어디서 신청하나요?"; a=$(if($x.who){ "$($x.who) 셀러가 인스타그램 계정에서 진행합니다. 위 카드를 누르면 해당 계정으로 이동하고, 프로필 링크나 공지 게시물에서 신청할 수 있습니다." } else { "진행 셀러의 인스타그램 계정 공지에서 신청합니다. 위 카드를 누르면 이동합니다." }) }
  $faq += @{ q="$($x.name) 공구 가격은 얼마인가요?"; a="공구 가격은 오픈일에 셀러가 인스타그램 공지로 공개합니다. 구성에 따라 다를 수 있으니 셀러 계정에서 확인하세요." }
  $body += "<div class=${Q}sec${Q}><h2>자주 묻는 질문</h2>"
  foreach($f in $faq){ $body += "<div class=${Q}faq${Q}><b>$(HtmlEsc $f.q)</b><span>$(HtmlEsc $f.a)</span></div>" }
  $body += '</div>'

  $body += "<div class=${Q}sec${Q}><h2>관련 일정</h2><div class=${Q}rel${Q}>"
  if($brandSlug.ContainsKey($x.brand)){ $body += "<a href=${Q}/g/$(Enc $brandSlug[$x.brand]).html${Q}>$(HtmlEsc $x.brand) 전체 공구 일정</a>" }
  if($x.insta -and $SellerSlug.ContainsKey($x.insta)){ $body += "<a href=${Q}/s/$(Enc $SellerSlug[$x.insta]).html${Q}>$(HtmlEsc $x.who) 셀러의 다른 공구</a>" }
  if($GgByBrand.ContainsKey($x.brand)){
    foreach($o3 in (@($GgByBrand[$x.brand] | Sort-Object @{e='od';Descending=$true}, @{e='slug';Descending=$false} | Select-Object -First 6))){
      if($o3.slug -ne $x.slug){ $body += "<a href=${Q}/gg/$(Enc $o3.slug).html${Q}>$(HtmlEsc $o3.name) ($($o3.od.Substring(5).Replace('-','/')))</a>" }
    }
  }
  $body += '</div></div>'

  $ld = New-Object System.Collections.ArrayList
  $lf = LdFaq @($faq | ForEach-Object { [pscustomobject]@{ q=$_.q; a=$_.a } })
  if($lf){ [void]$ld.Add($lf) }
  [void]$ld.Add((LdCrumb "$($x.name) 공구" $canon))
  WritePage @{ path=(Join-Path $Root "gg/$($x.slug).html"); title=$title; desc=$desc; canon=$canon;
    h1="$($x.name) 공구"; sub="$($x.od) ~ $($x.ed)$(if($x.who){ ' · ' + $x.who })"; body=$body; jsonld=$ld; bcName="$($x.name) 공구" }
}

# ══ 셀러 페이지 ══
# ⚠ 슬러그를 여기서 다시 만들면 안 된다. 위에서 만든 $SellerSlug 를 그대로 써야
#   카드 링크 주소와 실제 파일명이 어긋나지 않는다.
$sellerMade = New-Object System.Collections.ArrayList
foreach($s in $D.sellers){
  $slug = $SellerSlug[$s.insta]
  if([string]::IsNullOrWhiteSpace($slug)){ continue }
  $rows = ParseRows $s.rows @('name','od','ed','major')
  $sp = SplitNow $rows $today
  $live = $sp.now; $soon = $sp.soon; $past = $sp.past
  # 셀러 페이지 카드는 그 셀러 인스타로 보낸다(메인 사이트 카드와 같은 목적지)
  $sHref = "https://www.instagram.com/$($s.insta)"
  $fw = 0; if($s.followers){ $fw = [int64]$s.followers }

  # 셀러명 검색은 노출만 되고 클릭이 없다(GSC 실측 2026-08-31: 지엠마 29·마마홈 18·지후맘 20 전부 0클릭).
  # 제목에 그 셀러가 다루는 브랜드를 실어 '누를 이유'를 만든다. 브랜드 = 상품명 첫 낱말 최빈 2개.
  $bt = @{}
  foreach($r in $rows){
    $t0 = @(("$($r.name)") -split '[\s·]+')[0]
    if($t0.Length -lt 2 -or $t0 -match '^[\d\[\(]'){ continue }
    if($t0 -match '^(국산|신상|한정|특가|정품|앵콜|단하루|오늘|인스타|공구|모음|모음전|기획전)$'){ continue }
    $bt[$t0] = 1 + $(if($bt.ContainsKey($t0)){ $bt[$t0] } else { 0 })
  }
  $btTop = @($bt.GetEnumerator() | Sort-Object @{e={$_.Value};Descending=$true}, @{e='Key';Descending=$false} | Select-Object -First 2 | ForEach-Object { $_.Key })

  $title = "$($s.kor)(@$($s.insta)) 공구 일정 | 인스타 공동구매 - 맘캘린더"
  $desc  = "$($s.kor)(@$($s.insta))의 인스타 공구 일정. 진행 중인 공동구매와 오픈·마감 날짜를 확인하세요."
  if($btTop.Count -gt 0){
    $bTxt = $btTop -join '·'
    $t2 = "$($s.kor)(@$($s.insta)) 공구 일정 | $bTxt 공동구매 - 맘캘린더"
    if($t2.Length -gt 62 -and $btTop.Count -gt 1){ $bTxt = "$($btTop[0])"; $t2 = "$($s.kor)(@$($s.insta)) 공구 일정 | $bTxt 공동구매 - 맘캘린더" }
    if($t2.Length -le 62){
      $title = $t2
      $desc  = "$($s.kor)(@$($s.insta))의 인스타 공구 일정. $bTxt 등 진행 공구와 오픈·마감 날짜, 다음 오픈 일정을 확인하세요."
    }
  }
  $canon = "s/$(Enc $slug).html"
  $lead = "$($s.kor)(@$($s.insta))의 인스타 공구 일정입니다."
  if($live.Count -gt 0){ $lead += " 지금 진행 중인 공구는 맨 위에 있습니다. 카드를 누르면 인스타그램으로 이동합니다." }
  elseif($soon.Count -gt 0){ $lead += " 지금 진행 중인 공구는 없고, 곧 열릴 일정이 아래에 있습니다." }
  else { $lead += " 지금 진행 중인 공구는 없습니다. 지난 일정으로 다음 공구 시기를 가늠해 보세요." }

  # ⚠ 통계 상자(진행 횟수·팔로워·주력 분야)는 넣지 않는다.
  #   사장님이 크몽에 팔 데이터 자산이라 공개하지 않는다(사장님 지시 2026-08-11).
  $body = "<div class=${Q}sec${Q}><p>$(HtmlEsc $lead)</p></div>"
  if($live.Count -gt 0){ $body += "<div class=${Q}sec${Q}><h2>지금 진행 중인 공구</h2>" + (CardsHtml $live 20 $true $false $sHref) + '</div>' }
  if($soon.Count -gt 0){ $body += "<div class=${Q}sec${Q}><h2>곧 열리는 공구</h2>" + (CardsHtml $soon 20 $false $false $sHref) + '</div>' }
  if($past.Count -gt 0){ $body += "<div class=${Q}sec${Q}><h2>지난 공구</h2>" + (CardsHtml $past 40 $false $false $sHref) + '</div>' }
  $ex = ExtraBody $s.kor '셀러' $live $soon $past @()
  $body += $ex.html
  $body += "<div class=${Q}sec${Q}><h2>인기 브랜드 공구</h2><div class=${Q}rel${Q}>"
  foreach($b in ($topBrands | Select-Object -First 20)){
    $body += "<a href=${Q}/g/$(Enc $b.slug).html${Q}>$(HtmlEsc $b.brand) 공구</a>"
  }
  $body += '</div></div>'

  $ld = New-Object System.Collections.ArrayList
  $l1 = LdItemList "$($s.kor) 공구 일정" ($live + $past) 25
  if($l1){ [void]$ld.Add($l1) }
  $lf = LdFaq $ex.faq
  if($lf){ [void]$ld.Add($lf) }
  [void]$ld.Add((LdCrumb "$($s.kor) 공구" $canon))
  WritePage @{ path=(Join-Path $Root "s/$slug.html"); title=$title; desc=$desc; canon=$canon;
    h1="$($s.kor) 공구 일정"; sub="@$($s.insta)"; body=$body; jsonld=$ld; bcName="$($s.kor) 공구" }
  [void]$sellerMade.Add([pscustomobject]@{ slug=$slug; kor=$s.kor; insta=$s.insta; cnt=[int]$s.cnt; fw=$fw })
}

# ══ 소분류 페이지 ══
$seenM = @{}; $minorMade = New-Object System.Collections.ArrayList; $catMap = @{}
foreach($m in $D.minors){
  $slug = SlugOf "$($m.minor)" $seenM '-m'
  if([string]::IsNullOrWhiteSpace($slug)){ continue }
  $rows = ParseRows $m.rows @("name","who","od","ed")
  $sp = SplitNow $rows $today
  $live = $sp.now; $soon = $sp.soon; $past = $sp.past
  $title = "$($m.minor) 공구 | $($m.major) 공동구매 일정 - 맘캘린더"
  $desc  = "$($m.minor) 공구 일정. 인스타 셀러들이 진행하는 $($m.minor) 공동구매를 날짜순으로 모았습니다."
  $canon = "m/$(Enc $slug).html"
  $lead = "$($m.major) 분야 중 $($m.minor) 공구 일정입니다. 인스타 셀러들이 진행하는 $($m.minor) 공동구매를 날짜순으로 모았습니다."
  if($live.Count -gt 0){ $lead += " 지금 진행 중인 공구는 맨 위에 있습니다." }
  elseif($soon.Count -gt 0){ $lead += " 지금 진행 중인 공구는 없고, 곧 열릴 일정이 아래에 있습니다." }
  else { $lead += " 지금 진행 중인 공구는 없습니다. 지난 일정을 참고하세요." }

  $body = "<div class=${Q}sec${Q}><p>$(HtmlEsc $lead)</p></div>"
  if($live.Count -gt 0){ $body += "<div class=${Q}sec${Q}><h2>지금 진행 중인 $(HtmlEsc $m.minor) 공구</h2>" + (CardsHtml $live 20 $true $true) + '</div>' }
  if($soon.Count -gt 0){ $body += "<div class=${Q}sec${Q}><h2>곧 열리는 $(HtmlEsc $m.minor) 공구</h2>" + (CardsHtml $soon 20 $false $true) + '</div>' }
  if($past.Count -gt 0){ $body += "<div class=${Q}sec${Q}><h2>지난 $(HtmlEsc $m.minor) 공구</h2>" + (CardsHtml $past 30 $false $true) + '</div>' }
  $ex = ExtraBody $m.minor '소분류' $live $soon $past @()
  $body += $ex.html

  $ld = New-Object System.Collections.ArrayList
  $l1 = LdItemList "$($m.minor) 공구" ($live + $past) 25
  if($l1){ [void]$ld.Add($l1) }
  $lf = LdFaq $ex.faq
  if($lf){ [void]$ld.Add($lf) }
  [void]$ld.Add((LdCrumb "$($m.minor) 공구" $canon))
  WritePage @{ path=(Join-Path $Root "m/$slug.html"); title=$title; desc=$desc; canon=$canon;
    h1="$($m.minor) 공구"; sub="$($m.major) 공동구매 일정"; body=$body; jsonld=$ld; bcName="$($m.minor) 공구" }

  $o = [pscustomobject]@{ slug=$slug; minor=$m.minor; major=$m.major; cnt=[int]$m.cnt }
  [void]$minorMade.Add($o)
  if(-not $catMap.ContainsKey($m.major)){ $catMap[$m.major] = New-Object System.Collections.ArrayList }
  [void]$catMap[$m.major].Add($o)
}

# ══ 월별 페이지 ══
# 지난 달 페이지도 지우지 않는다(사장님 승인 2026-08-05).
# "6월 공구" 같은 검색어는 매년 돌아오는데 페이지를 버리면 색인이 날아간다.
# 대신 지난 달이라는 것을 사람이 바로 알 수 있게 맨 위에 안내를 넣는다.
$thisYm = $today.Substring(0,7)
$ymAll = @($D.months | ForEach-Object { $_.ym } | Sort-Object)
$monthMade = New-Object System.Collections.ArrayList
foreach($mm in $D.months){
  $ym = $mm.ym; $yy = $ym.Substring(0,4); $mo = [int]$ym.Substring(5,2)
  $rows = ParseRows $mm.rows @("name","who","od","ed","major")
  $sp = SplitNow $rows $today
  $live = $sp.now; $soon = $sp.soon
  $isPast = ($ym -lt $thisYm)
  $canon = "d/$ym.html"

  if($isPast){
    $title = "${yy}년 ${mo}월 공구 일정 (지난 일정) | 인스타 공동구매 - 맘캘린더"
    $desc  = "${yy}년 ${mo}월에 진행된 인스타 공구 일정 기록. 지난 공동구매 일정을 보고 다음 공구 시기를 가늠해 보세요."
    $lead  = "${yy}년 ${mo}월에 진행된 인스타 공구 일정 기록입니다."
  } else {
    $title = "${yy}년 ${mo}월 공구 일정 | 인스타 공동구매 - 맘캘린더"
    $desc  = "${yy}년 ${mo}월 인스타 공구 일정. 오픈·마감 날짜를 날짜순으로 확인하세요."
    $lead  = "${yy}년 ${mo}월 인스타 공구 일정입니다. 날짜순으로 모았습니다."
  }
  if($live.Count -gt 0){ $lead += " 오늘도 진행 중인 공구는 맨 위에 있습니다." }

  $body = ''
  if($isPast){
    $cur = ''
    if($ymAll -contains $thisYm){ $cur = "<a href=${Q}/d/$thisYm.html${Q}>이번 달 공구 일정 보기</a> · " }
    $body += "<div class=${Q}sec${Q}><div class=${Q}note${Q}><b>지난 일정입니다</b>"
    $body += "<span>${yy}년 ${mo}월은 이미 지났습니다. 지금 진행 중인 공구를 찾으신다면 아래로 가세요.</span>"
    $body += "<span class=${Q}lnk${Q}>$cur<a href=${Q}/${Q}>오늘 진행 중인 공구</a></span></div></div>"
  }
  $body += "<div class=${Q}sec${Q}><p>$(HtmlEsc $lead)</p></div>"
  if($live.Count -gt 0){ $body += "<div class=${Q}sec${Q}><h2>아직 진행 중인 공구</h2>" + (CardsHtml $live 20 $true $true) + '</div>' }
  $body += "<div class=${Q}sec${Q}><h2>${yy}년 ${mo}월 전체 일정</h2>" + (CardsHtml $rows 60 $false $true) + '</div>'

  # 앞뒤 달로 이어지는 링크 (크롤러가 월별 페이지를 타고 다니게)
  $ix = [Array]::IndexOf($ymAll, $ym)
  $nav = ''
  if($ix -gt 0){ $pv = $ymAll[$ix-1]; $nav += "<a href=${Q}/d/$pv.html${Q}>← $([int]$pv.Substring(5,2))월 공구</a>" }
  if($ix -ge 0 -and $ix -lt ($ymAll.Count-1)){ $nx = $ymAll[$ix+1]; $nav += "<a href=${Q}/d/$nx.html${Q}>$([int]$nx.Substring(5,2))월 공구 →</a>" }
  foreach($o in $ymAll){ if($o -ne $ym){ $nav += "<a href=${Q}/d/$o.html${Q}>$($o.Substring(0,4))년 $([int]$o.Substring(5,2))월</a>" } }
  $body += "<div class=${Q}sec${Q}><h2>다른 달 공구 일정</h2><div class=${Q}rel${Q}>$nav</div></div>"

  $ld = New-Object System.Collections.ArrayList
  $l1 = LdItemList "${yy}년 ${mo}월 공구 일정" $rows 25
  if($l1){ [void]$ld.Add($l1) }
  [void]$ld.Add((LdCrumb "${yy}년 ${mo}월 공구" $canon))
  WritePage @{ path=(Join-Path $Root "d/$ym.html"); title=$title; desc=$desc; canon=$canon;
    h1="${yy}년 ${mo}월 공구 일정"; sub="인스타 공동구매 일정"; body=$body; jsonld=$ld; bcName="${mo}월 공구" }
  [void]$monthMade.Add([pscustomobject]@{ slug=$ym; label="${mo}월"; cnt=[int]$mm.cnt })
}

# ══ 카테고리 페이지 ══
$cats = @(
 @{n='육아';d='육아용품·이유식·장난감·교구'}, @{n='리빙';d='주방·수납·침구·인테리어'},
 @{n='식품';d='간편식·신선식품·간식·음료'}, @{n='가전';d='생활가전·주방가전·계절가전'},
 @{n='뷰티';d='스킨케어·클렌징·헤어'},     @{n='건강';d='영양제·유산균·건강식품'},
 @{n='패션';d='아동복·잡화·신발'},         @{n='여행';d='숙소·티켓·여행용품'},
 @{n='생필품';d='세제·물티슈·화장지·위생'}, @{n='반려동물';d='사료·간식·용품'}
)
$catMade = New-Object System.Collections.ArrayList
foreach($c in $cats){
  $slug = "$($c.n)공구"; $canon = "c/$(Enc $slug).html"
  $mine = @($liveRows | Where-Object { $_.major -eq $c.n })
  $mineSoon = @($soonRows | Where-Object { $_.major -eq $c.n })
  $subs = @(); if($catMap.ContainsKey($c.n)){ $subs = @($catMap[$c.n] | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='minor';Descending=$false}) }
  $title = "$($c.n) 공구 일정 | $($c.n) 공동구매 진행중인 곳 - 맘캘린더"
  $desc  = "$($c.n) 공동구매 일정 총정리. $($c.d) 공구를 진행하는 인스타 셀러와 기간을 확인하세요."
  $lead = "$($c.n) 분야 공구입니다. $($c.d) 등을 인스타 셀러들이 기간을 정해 특가로 진행합니다."
  if($mine.Count -gt 0){ $lead += " 오늘 기준 $($mine.Count)건이 진행 중입니다." }

  $body = "<div class=${Q}sec${Q}><p>$(HtmlEsc $lead)</p></div>"
  if($mine.Count -gt 0){ $body += "<div class=${Q}sec${Q}><h2>지금 진행 중인 $($c.n) 공구</h2>" + (CardsHtml $mine 20 $true $true) + '</div>' }
  if($mineSoon.Count -gt 0){ $body += "<div class=${Q}sec${Q}><h2>곧 열리는 $($c.n) 공구</h2>" + (CardsHtml $mineSoon 15 $false $true) + '</div>' }
  if($subs.Count -gt 0){
    $body += "<div class=${Q}sec${Q}><h2>$($c.n) 세부 분야</h2><div class=${Q}rel${Q}>"
    foreach($x in $subs){ $body += "<a href=${Q}/m/$(Enc $x.slug).html${Q}>$(HtmlEsc $x.minor) 공구</a>" }
    $body += '</div></div>'
  }
  $body += "<div class=${Q}sec${Q}><h2>다른 분야</h2><div class=${Q}rel${Q}>"
  foreach($o in $cats){ if($o.n -ne $c.n){ $body += "<a href=${Q}/c/$(Enc ($o.n+'공구')).html${Q}>$($o.n) 공구</a>" } }
  $body += '</div></div>'

  $ld = New-Object System.Collections.ArrayList
  $l1 = LdItemList "$($c.n) 공구" ($mine + $mineSoon) 25
  if($l1){ [void]$ld.Add($l1) }
  [void]$ld.Add((LdCrumb "$($c.n) 공구" $canon))
  WritePage @{ path=(Join-Path $Root "c/$slug.html"); title=$title; desc=$desc; canon=$canon;
    h1="$($c.n) 공구"; sub=$c.d; body=$body; jsonld=$ld; bcName="$($c.n) 공구" }
  [void]$catMade.Add($slug)
}

# ══ 키워드 페이지 ══
$kw = ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'keywords.json')) | ConvertFrom-Json).pages
$fmtBrands = '{0:N0}' -f $brandList.Count
function Sub3([string]$s){
  if($null -eq $s){ return '' }
  return $s.Replace('__TOTAL__',$fmtTotal).Replace('__SELLERS__',$fmtSellers).Replace('__BRANDS__',$fmtBrands)
}
$topB = $brandList  | Sort-Object @{e={VolOf $_.brand};Descending=$true}, @{e={[int]$_.cnt};Descending=$true}, @{e='slug';Descending=$false} | Select-Object -First 30
$topP = $prodList   | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='key';Descending=$false} | Select-Object -First 30
$topS = $sellerMade | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='slug';Descending=$false} | Select-Object -First 40
$topM = $minorMade  | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='minor';Descending=$false} | Select-Object -First 30

function ShowSection([string]$k){
  $h = ''
  switch($k){
    'live'  { if($liveRows.Count -gt 0){ $h = "<div class=${Q}sec${Q}><h2>오늘 진행 중인 공구</h2>" + (CardsHtml $liveRows 15 $true $true) + '</div>' } }
    'soon'  { if($soonRows.Count -gt 0){ $h = "<div class=${Q}sec${Q}><h2>곧 열리는 공구</h2>" + (CardsHtml $soonRows 12 $false $true) + '</div>' } }
    'brand' { $h = "<div class=${Q}sec${Q}><h2>인기 공구 브랜드</h2><div class=${Q}rel${Q}>"
              foreach($b in $topB){ $h += "<a href=${Q}/g/$(Enc $b.slug).html${Q}>$(HtmlEsc $b.brand) 공구</a>" }; $h += '</div></div>' }
    'prod'  { $h = "<div class=${Q}sec${Q}><h2>많이 찾는 제품 공구</h2><div class=${Q}rel${Q}>"
              foreach($p in $topP){ $h += "<a href=${Q}/p/$(Enc $p.slug).html${Q}>$(HtmlEsc $p.key) 공구</a>" }; $h += '</div></div>' }
    'seller'{ $h = "<div class=${Q}sec${Q}><h2>공구 셀러</h2><div class=${Q}rel${Q}>"
              foreach($s in $topS){ $h += "<a href=${Q}/s/$(Enc $s.slug).html${Q}>$(HtmlEsc $s.kor)</a>" }
              $h += "</div><p style=${Q}margin-top:10px;font-size:13px${Q}><a href=${Q}/$(Enc '공구셀러.html')${Q} style=${Q}color:#7B3FB5${Q}>셀러 전체 목록 보기 →</a></p></div>" }
    'cat'   { $h = "<div class=${Q}sec${Q}><h2>분야별 공구</h2><div class=${Q}rel${Q}>"
              foreach($c in $catMade){ $h += "<a href=${Q}/c/$(Enc $c).html${Q}>$(HtmlEsc ($c -replace '공구$','')) 공구</a>" }
              foreach($m in $topM){ $h += "<a href=${Q}/m/$(Enc $m.slug).html${Q}>$(HtmlEsc $m.minor) 공구</a>" }; $h += '</div></div>' }
    'month' { $h = "<div class=${Q}sec${Q}><h2>월별 공구 일정</h2><div class=${Q}rel${Q}>"
              foreach($m in $monthMade){ $h += "<a href=${Q}/d/$($m.slug).html${Q}>$($m.label) 공구 일정</a>" }; $h += '</div></div>' }
  }
  return $h
}

$kwMade = New-Object System.Collections.ArrayList
# 🔎 2026-10-24 GEO: 질문형 랜딩마다 같은 「사이트 사실 표」 — 답변 엔진이 「맘캘린더는 셀러 몇 명·공구 몇 건」을 그대로 인용할 수 있게 숫자를 항목-값으로
$SiteFacts = @(
  @{ k='서비스'; v='인스타그램 공동구매(공구) 일정·핫딜·브랜드 세일 일정 모음' },
  @{ k='등록 셀러'; v="${fmtSellers}명" },
  @{ k='공구 일정'; v="누적 ${fmtTotal}건" },
  @{ k='공구 브랜드'; v="${fmtBrands}개" },
  @{ k='오늘 진행'; v=$(if($liveRows.Count -gt 0){ "$($liveRows.Count)건 이상" } else { '' }) },
  @{ k='갱신'; v='매일 새벽 자동 갱신' },
  @{ k='운영'; v='원츠비 (momcalendar.com)' }
)
foreach($k in $kw){
  $canon = "$(Enc $k.slug).html"
  $body = ''
  if($k.intro){ $body += "<div class=${Q}sec${Q}>"; foreach($p in $k.intro){ $body += "<p>$(HtmlEsc (Sub3 $p))</p>" }; $body += '</div>' }
  if($k.steps){
    $body += "<div class=${Q}sec${Q}>"
    foreach($s in $k.steps){ $body += "<div class=${Q}stp${Q}><b>$(HtmlEsc (Sub3 $s.t))</b><span>$(HtmlEsc (Sub3 $s.d))</span></div>" }
    $body += '</div>'
  }
  foreach($sh in $k.show){ $body += (ShowSection $sh) }
  if($k.faq){
    $body += "<div class=${Q}sec${Q}><h2>자주 묻는 질문</h2>"
    foreach($f in $k.faq){ $body += "<div class=${Q}faq${Q}><b>$(HtmlEsc (Sub3 $f.q))</b><span>$(HtmlEsc (Sub3 $f.a))</span></div>" }
    $body += '</div>'
  }
  if($k.rel){
    $body += "<div class=${Q}sec${Q}><h2>함께 보면 좋은 글</h2><div class=${Q}rel${Q}>"
    foreach($r in $k.rel){ $body += "<a href=${Q}/$(Enc $r).html${Q}>$(HtmlEsc $r)</a>" }
    $body += '</div></div>'
  }
  $ld = New-Object System.Collections.ArrayList
  $faqSub = $null
  if($k.faq){ $faqSub = @($k.faq | ForEach-Object { [pscustomobject]@{ q=(Sub3 $_.q); a=(Sub3 $_.a) } }) }
  $lf = LdFaq $faqSub
  if($lf){ [void]$ld.Add($lf) }
  [void]$ld.Add((LdCrumb (Sub3 $k.h1) $canon))
  WritePage @{ path=(Join-Path $Root "$($k.slug).html"); title=(Sub3 $k.title); desc=(Sub3 $k.desc); canon=$canon;
    h1=(Sub3 $k.h1); sub=(Sub3 $k.sub); body=$body; jsonld=$ld; bcName=(Sub3 $k.h1); answer=(Sub3 $k.answer); facts=$SiteFacts }
  [void]$kwMade.Add($k.slug)
}

# ══ 핫딜·최저가·세일 정보 페이지 (2026-10-24 사장님 「공동구매 일정·핫딜정보·어디가 최저가인지·세일정보 이런거 다 우리 맘캘린더가 뜨게」) ══
#   데이터 페이지다 — 매일 새벽 그 시각에 사이트에 노출 중인 핫딜·세일만 싣는다. 값은 사이트에 이미 공개된 것뿐(공개 키 REST).
#   🔴 「최저가」는 사이트(index.html 「추적 기간 중 가장 싼 가격」)와 같은 뜻으로만 쓴다 = hotdeals.is_lowest. 「최저가 보장」 같은 말은 쓰지 않는다.
#   🔴 가격은 수집 시각 기준이다 — 화면·FAQ 에 「판매처에서 바뀔 수 있다」를 같이 적는다(바뀐 가격을 사실처럼 인용당하지 않게).
#   데이터를 못 받으면 페이지를 만들지 않는다(빈 페이지·0건 사실표 금지) → 보존 원칙상 어제 판이 남는다.
$HD2 = @(); $SALE = @()
try{
  $q2 = "?select=title,mall,price,price_before,discount_rate,is_lowest,deal_day&or=(expires_at.is.null,expires_at.gte.$nowUtc)&price=gt.0&order=discount_rate.desc.nullslast,id.desc&limit=400"
  $r2 = Invoke-WebRequest -Uri ('https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/hotdeals' + $q2) -TimeoutSec 30 -Headers @{ apikey=$key; Authorization="Bearer $key" }
  $HD2 = @(([Text.Encoding]::UTF8.GetString($r2.RawContentStream.ToArray()) | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { $_.title -and $_.mall -and [int]$_.price -gt 0 })
  Write-Output "핫딜 정보 페이지: 노출 중 $($HD2.Count)건"
}catch{ Write-Output "핫딜 정보 데이터 실패(페이지 건너뜀): $($_.Exception.Message)" }
try{
  $r3 = Invoke-WebRequest -Uri 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/sale_events?select=brand,title,tag,start_date,end_date,url&approved=eq.true&order=start_date.asc,id.asc&limit=300' -TimeoutSec 30 -Headers @{ apikey=$key; Authorization="Bearer $key" }
  $soonEdge = ([DateTime]::ParseExact($today,'yyyy-MM-dd',$null)).AddDays(30).ToString('yyyy-MM-dd')
  $SALE = @(([Text.Encoding]::UTF8.GetString($r3.RawContentStream.ToArray()) | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object {
    $_.brand -and $_.start_date -and ("$($_.start_date)" -le $soonEdge) -and ([string]::IsNullOrWhiteSpace("$($_.end_date)") -or "$($_.end_date)" -ge $today) })
  Write-Output "세일 정보 페이지: 진행·예정 $($SALE.Count)건"
}catch{ Write-Output "세일 정보 데이터 실패(페이지 건너뜀): $($_.Exception.Message)" }
function Won($n){ return ('{0:N0}' -f [int]$n) + '원' }
function DealLine($h){
  $p = Won $h.price
  if([int]$h.price_before -gt [int]$h.price){ $p += " (정가 $(Won $h.price_before)$(if([int]$h.discount_rate -gt 0){ ", $([int]$h.discount_rate)%↓" }))" }
  $low = $(if($h.is_lowest){ ' · 🏆 추적 기간 최저가' } else { '' })
  return "<div class=${Q}stp${Q}><b>$(HtmlEsc $h.title)</b><span>$(HtmlEsc $h.mall) · $p$low</span></div>"
}
function LdNames([string]$name, $names, [string]$canon){
  $el = New-Object System.Collections.ArrayList; $i = 0
  foreach($n in $names){ $i++; [void]$el.Add("{${Q}@type${Q}:${Q}ListItem${Q},${Q}position${Q}:$i,${Q}name${Q}:${Q}$(JsonEsc $n)${Q}}") }
  return "{${Q}@context${Q}:${Q}https://schema.org${Q},${Q}@type${Q}:${Q}ItemList${Q},${Q}name${Q}:${Q}$(JsonEsc $name)${Q},${Q}url${Q}:${Q}$SITE/$canon${Q},${Q}numberOfItems${Q}:$($el.Count),${Q}itemListElement${Q}:[$($el -join ',')]}"
}
function MallTable($deals){
  # 「어디가 최저가인가」에 답하는 표 — 쇼핑몰별 오늘 핫딜 수·최대 할인율·최저가 표시 수 (할인율 높은 순)
  $g = @($deals | Group-Object mall | ForEach-Object {
    $mx = ($_.Group | Measure-Object -Property discount_rate -Maximum).Maximum
    [pscustomobject]@{ mall=$_.Name; n=$_.Count; mx=[int]$mx; low=@($_.Group | Where-Object { $_.is_lowest }).Count } } |
    Sort-Object @{e={$_.mx};Descending=$true}, @{e={$_.n};Descending=$true}, @{e='mall';Descending=$false})
  $h = "<div class=${Q}sec${Q}><h2>쇼핑몰별 오늘 핫딜</h2><dl class=${Q}facts${Q}>"
  foreach($m in $g){ $h += "<div><dt>$(HtmlEsc $m.mall)</dt><dd>$($m.n)건 · 최대 $($m.mx)% 할인$(if($m.low -gt 0){ " · 추적 기간 최저가 $($m.low)건" })</dd></div>" }
  return $h + '</dl></div>'
}
$dealPages = @()
if($HD2.Count -ge 5){
  $malls = @($HD2 | ForEach-Object { $_.mall } | Sort-Object -Unique)
  $lowN = @($HD2 | Where-Object { $_.is_lowest }).Count
  $top = $HD2[0]
  $mxD = [int]$top.discount_rate
  $dealPages += @{ slug='핫딜정보'; h1='오늘 핫딜 정보'; sub='쇼핑몰 특가를 날마다 모아'
    title="오늘 핫딜 정보 | 쇼핑몰 특가 $($HD2.Count)건 모음 ($ASOF) - 맘캘린더"
    desc="$ASOF 기준 $($malls.Count)개 쇼핑몰의 오늘 핫딜 $($HD2.Count)건. 할인율 높은 순으로 상품명·판매가·정가·할인율을 정리했습니다. 맘캘린더 핫딜 탭에서 매일 갱신됩니다."
    answer="오늘의 핫딜은 맘캘린더(momcalendar.com) 핫딜 탭에 모여 있습니다. $ASOF 기준 $($malls.Count)개 쇼핑몰($(($malls | Select-Object -First 5) -join '·')$(if($malls.Count -gt 5){' 등'}))의 특가 $($HD2.Count)건이 있고, 할인율이 가장 큰 딜은 $mxD%입니다."
    facts=@( @{k='오늘 핫딜';v="$($HD2.Count)건"}, @{k='쇼핑몰';v="$($malls.Count)곳"}, @{k='최대 할인';v="$mxD% ($($top.mall))"}, @{k='추적 최저가';v=$(if($lowN){"${lowN}건"}else{''})}, @{k='가격 기준';v="$ASOF 새벽 수집 · 판매처에서 바뀔 수 있음"} )
    list=@($HD2 | Select-Object -First 60); h2='할인율 높은 순 오늘 핫딜'; mall=$true
    faq=@( @{q='핫딜 정보는 어디서 보나요?'; a="맘캘린더(momcalendar.com) 핫딜 탭에서 봅니다. $(($malls | Select-Object -First 4) -join '·') 등 쇼핑몰 특가를 매일 모아 할인율·판매가와 함께 보여줍니다. $ASOF 기준 $($HD2.Count)건입니다."},
           @{q='핫딜 가격은 언제 기준인가요?'; a="이 페이지는 $ASOF 새벽에 수집한 가격입니다. 핫딜은 수량·시간 한정이 많아 판매처에서 가격이 바뀌거나 끝날 수 있으니, 구매 전에 판매처 가격을 확인하세요."} )
    rel=@('최저가정보','세일정보','공동구매일정') }
  if($lowN -ge 3){
    $lows = @($HD2 | Where-Object { $_.is_lowest })
    $dealPages += @{ slug='최저가정보'; h1='최저가 정보'; sub='추적 기간 중 가장 싼 가격이 된 상품'
      title="최저가 정보 | 오늘 최저가 핫딜 ${lowN}건·쇼핑몰별 할인 ($ASOF) - 맘캘린더"
      desc="맘캘린더가 가격을 추적한 기간 중 가장 싼 가격이 된 핫딜 ${lowN}건과, 쇼핑몰별 오늘 할인율 비교. $ASOF 기준, 매일 갱신."
      answer="어디가 최저가인지는 맘캘린더(momcalendar.com) 핫딜 탭의 「최저」 표시로 확인할 수 있습니다. 맘캘린더가 가격을 추적한 기간 중 가장 싼 가격이 된 상품에 붙이며, $ASOF 기준 ${lowN}건입니다. 쇼핑몰별 할인율 비교는 아래 표에 있습니다."
      facts=@( @{k='최저가 표시';v="${lowN}건"}, @{k='오늘 핫딜';v="$($HD2.Count)건"}, @{k='쇼핑몰';v="$($malls.Count)곳"}, @{k='최저가 뜻';v='맘캘린더가 가격을 추적한 기간 중 가장 싼 가격'}, @{k='가격 기준';v="$ASOF 새벽 수집 · 판매처에서 바뀔 수 있음"} )
      list=@($lows | Select-Object -First 60); h2='추적 기간 최저가 핫딜'; mall=$true
      faq=@( @{q='최저가 표시는 무슨 뜻인가요?'; a='맘캘린더가 그 상품의 가격을 기록해 온 기간 중 가장 싼 가격이라는 뜻입니다. 모든 쇼핑몰을 통틀은 최저가를 보장하는 표시는 아닙니다.'},
             @{q='어느 쇼핑몰이 제일 싼가요?'; a="상품마다 다릅니다. 이 페이지의 「쇼핑몰별 오늘 핫딜」 표에 쇼핑몰마다 오늘 핫딜 수와 최대 할인율을 $ASOF 기준으로 정리했습니다."} )
      rel=@('핫딜정보','세일정보','공동구매일정') }
  }
}
if($SALE.Count -ge 3){
  $sNow = @($SALE | Where-Object { "$($_.start_date)" -le $today }); $sSoon = @($SALE | Where-Object { "$($_.start_date)" -gt $today })
  $sBody = ''
  foreach($grp in @(@{t='지금 진행 중인 세일'; r=$sNow}, @{t='30일 안에 시작하는 세일'; r=$sSoon})){
    if($grp.r.Count -eq 0){ continue }
    $sBody += "<div class=${Q}sec${Q}><h2>$($grp.t)</h2>"
    foreach($s in $grp.r){
      $per = "$($s.start_date)" + $(if("$($s.end_date)"){ " ~ $($s.end_date)" } else { ' ~ (종료일 미정)' })
      $nm = "$($s.brand) $($s.title)".Trim()
      $lk = $(if("$($s.url)" -match '^https?://'){ " · <a href=${Q}$(HtmlEsc $s.url)${Q} rel=${Q}nofollow${Q} target=${Q}_blank${Q}>공식 페이지</a>" } else { '' })
      $sBody += "<div class=${Q}stp${Q}><b>$(HtmlEsc $nm)</b><span>$per$(if($s.tag){ ' · ' + (HtmlEsc $s.tag) })$lk</span></div>"
    }
    $sBody += '</div>'
  }
  $dealPages += @{ slug='세일정보'; h1='브랜드 세일 정보'; sub='진행 중인 세일과 곧 시작하는 세일 일정'
    title="브랜드 세일 정보 | 세일 일정 $($SALE.Count)건 ($ASOF) - 맘캘린더"
    desc="$ASOF 기준 진행 중인 브랜드 세일 $($sNow.Count)건과 30일 안에 시작하는 세일 $($sSoon.Count)건의 기간을 날짜순으로 정리했습니다. 맘캘린더 세일 탭에서 매일 갱신됩니다."
    answer="브랜드 세일 일정은 맘캘린더(momcalendar.com) 세일 탭에 날짜순으로 정리돼 있습니다. $ASOF 기준 진행 중인 세일 $($sNow.Count)건, 30일 안에 시작하는 세일 $($sSoon.Count)건입니다."
    facts=@( @{k='진행 중';v="$($sNow.Count)건"}, @{k='30일 내 시작';v="$($sSoon.Count)건"}, @{k='기준일';v=$ASOF} )
    body=$sBody; cta='/#sale'
    faq=@( @{q='브랜드 세일 일정은 어디서 보나요?'; a="맘캘린더(momcalendar.com) 세일 탭(momcalendar.com/#sale)에서 봅니다. 브랜드별 세일 이름과 시작일·종료일을 날짜순으로 정리하고, 찜하면 시작 알림을 받을 수 있습니다."} )
    rel=@('핫딜정보','최저가정보','공동구매일정') }
}
foreach($dp in $dealPages){
  $canon = "$(Enc $dp.slug).html"
  $body = ''
  if($dp.mall){ $body += (MallTable $HD2) }
  if($dp.list){ $body += "<div class=${Q}sec${Q}><h2>$($dp.h2)</h2>"; foreach($h in $dp.list){ $body += (DealLine $h) }; $body += '</div>' }
  if($dp.body){ $body += $dp.body }
  $body += "<div class=${Q}sec${Q}><h2>자주 묻는 질문</h2>"
  foreach($f in $dp.faq){ $body += "<div class=${Q}faq${Q}><b>$(HtmlEsc $f.q)</b><span>$(HtmlEsc $f.a)</span></div>" }
  $body += '</div>'
  $body += "<div class=${Q}sec${Q}><h2>함께 보면 좋은 글</h2><div class=${Q}rel${Q}>"
  foreach($r in $dp.rel){ $body += "<a href=${Q}/$(Enc $r).html${Q}>$(HtmlEsc $r)</a>" }
  $body += '</div></div>'
  $ld = New-Object System.Collections.ArrayList
  [void]$ld.Add((LdFaq @($dp.faq | ForEach-Object { [pscustomobject]@{ q=$_.q; a=$_.a } })))
  [void]$ld.Add((LdCrumb $dp.h1 $canon))
  if($dp.list){ [void]$ld.Add((LdNames $dp.h1 @($dp.list | Select-Object -First 30 | ForEach-Object { "$($_.title)" }) $canon)) }
  WritePage @{ path=(Join-Path $Root "$($dp.slug).html"); title=$dp.title; desc=$dp.desc; canon=$canon;
    h1=$dp.h1; sub=$dp.sub; body=$body; jsonld=$ld; bcName=$dp.h1; answer=$dp.answer; facts=$dp.facts
    cta=$(if($dp.cta){ $dp.cta } else { '/' }); ctaText=$(if($dp.cta){ '세일 탭 보러 가기 →' } else { '맘캘린더 핫딜 보러 가기 →' }) }
  [void]$kwMade.Add($dp.slug)
}

# ══ 허브 3종 ══
function Hub([string]$file,[string]$title,[string]$desc,[string]$h1,[string]$sub,[string]$intro,[string]$links,[string]$bc){
  $b = "<div class=${Q}sec${Q}><p>$(HtmlEsc $intro)</p><div class=${Q}rel${Q}>$links</div></div>"
  $canon = "$(Enc $file)"
  WritePage @{ path=(Join-Path $Root $file); title=$title; desc=$desc; canon=$canon; h1=$h1; sub=$sub; body=$b;
    jsonld=@((LdCrumb $bc $canon)); bcName=$bc }
}
$lk = ''
foreach($b in ($brandList | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='brand';Descending=$false})){ $lk += "<a href=${Q}/g/$(Enc $b.slug).html${Q}>$(HtmlEsc $b.brand)</a>" }
Hub '공구브랜드.html' "공구 브랜드 목록 ${fmtBrands}개 | 인스타 공동구매 - 맘캘린더" `
  "인스타 공구로 진행된 브랜드 ${fmtBrands}개 목록. 브랜드를 누르면 그 브랜드의 공구 일정과 진행 셀러를 볼 수 있습니다." `
  "공구 브랜드" "${fmtBrands}개 브랜드의 공구 이력" `
  "맘캘린더에 기록된 공구 브랜드 ${fmtBrands}개입니다. 브랜드를 누르면 그 브랜드를 공구한 셀러와 지난 일정, 진행 중인 공구를 볼 수 있습니다." $lk '공구 브랜드'
$lk = ''
foreach($s in ($sellerMade | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='slug';Descending=$false})){ $lk += "<a href=${Q}/s/$(Enc $s.slug).html${Q}>$(HtmlEsc $s.kor)</a>" }
Hub '공구셀러.html' "인스타 공구 셀러 목록 ${fmtSellers}명 | 맘캘린더" `
  "인스타그램에서 공동구매를 진행하는 셀러 ${fmtSellers}명의 목록과 공구 이력. 셀러별 진행 중인 공구를 확인하세요." `
  "인스타 공구 셀러" "${fmtSellers}명의 공구 이력" `
  "인스타에서 공동구매를 진행하는 셀러 ${fmtSellers}명입니다. 이름을 누르면 그 셀러의 공구 건수, 주력 분야, 진행 중인 공구를 볼 수 있습니다." $lk '공구 셀러'
$lk = ''
foreach($p in ($prodList | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='key';Descending=$false})){ $lk += "<a href=${Q}/p/$(Enc $p.slug).html${Q}>$(HtmlEsc $p.key)</a>" }
Hub '공구제품.html' "공구 제품 목록 $($prodList.Count)개 | 브랜드별 공동구매 - 맘캘린더" `
  "인스타 공구로 여러 번 진행된 제품 $($prodList.Count)개. 제품을 누르면 진행한 셀러와 공구 이력, 다음 공구 시기를 가늠할 수 있습니다." `
  "공구 제품" "여러 번 진행된 제품 $($prodList.Count)개" `
  "두 번 이상 공구로 나온 제품 $($prodList.Count)개입니다. 같은 제품이 얼마 만에 다시 나오는지 이력으로 확인할 수 있습니다." $lk '공구 제품'

# ── 케이스 쌍 blob 동기화 (2026-08-28) ──
# 과거에 이미 생긴 케이스 쌍(g/VOOKS.html·g/Vooks.html 등)은 지우면 그 URL 이 404 가 된다
# (페이지 보존 원칙). 대신 비정본 쪽 내용을 정본과 바이트 단위로 똑같이 만든다.
# blob 이 같으면 윈도우 체크아웃이 더 이상 dirty 해지지 않고,
# 비정본의 canonical 태그도 정본을 가리키게 되어 검색엔진 중복도 함께 정리된다.
# 두 파일 모두 sitemap 에 남는다(KeptUrls) — 빼면 verify 의 고아 검사에 걸린다.
# 윈도우에선 애초에 한 파일이라 이 블록은 할 일이 없다(리눅스 Actions 전용).
foreach($dir in @('g','p','s','gg')){
  $dp2 = Join-Path $Root $dir
  $grps = Get-ChildItem $dp2 -Filter *.html -File | Group-Object { $_.Name.ToLower() } | Where-Object { $_.Count -gt 1 }
  foreach($g2 in $grps){
    $nn = @($g2.Group | ForEach-Object { $_.Name }); [Array]::Sort($nn, [System.StringComparer]::Ordinal)
    $src = Join-Path $dp2 $nn[0]
    foreach($n2 in ($nn | Select-Object -Skip 1)){
      [IO.File]::WriteAllBytes((Join-Path $dp2 $n2), [IO.File]::ReadAllBytes($src))
      Write-Output "케이스 쌍 동기화: $dir/$($nn[0]) → $dir/$n2"
    }
  }
}

# ══ sitemap · robots ══
function WriteSitemap([string]$file, $urls, [string]$pri, [string]$freq){
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('<?xml version="1.0" encoding="UTF-8"?>')
  [void]$sb.AppendLine('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
  foreach($u in $urls){
    # lastmod 는 **내용이 실제로 바뀐 날**이어야 한다.
    # 예전엔 6,900개 전부에 오늘 날짜를 박았다. 내용이 그대로인데 매일 "수정됨" 이라고 하면
    # 크롤러가 우리 신호를 안 믿게 되고 크롤링 우선순위가 밀린다.
    # → 파일이 이번 실행에서 정말 바뀌었는지 보고, 안 바뀌었으면 옛 날짜를 그대로 쓴다.
    $lm = $today
    $rel = [uri]::UnescapeDataString($u)
    if($PrevMod.ContainsKey($rel) -and $PrevHash.ContainsKey($rel)){
      $fp = Join-Path $Root $rel
      if(Test-Path -LiteralPath $fp){
        $h = (Get-FileHash -LiteralPath $fp -Algorithm MD5).Hash
        if($h -eq $PrevHash[$rel]){ $lm = $PrevMod[$rel] }   # 내용 그대로 → 옛 날짜 유지
      }
    }
    [void]$sb.AppendLine("<url><loc>$SITE/$u</loc><lastmod>$lm</lastmod><changefreq>$freq</changefreq><priority>$pri</priority></url>")
  }
  [void]$sb.AppendLine('</urlset>')
  [IO.File]::WriteAllText((Join-Path $Root $file), $sb.ToString(), [Text.UTF8Encoding]::new($false))
}
# 오늘 집계에 없지만 디스크에 남아 있는 보존 페이지를 sitemap 에 합류시킨다.
# 빼먹으면 verify 의 "sitemap 에 빠진 페이지(고아)" 검사에 걸리고,
# sitemap 에서 사라진 URL 은 색인 자산이 깎인다. lastmod 는 WriteSitemap 이
# 해시 대조로 옛 날짜를 유지해 준다(내용이 안 바뀐 보존 페이지는 안 바뀐 날짜 그대로).
function KeptUrls([string]$dir2, $todayUrls){
  $have = @{}
  foreach($u in $todayUrls){ $have[[uri]::UnescapeDataString("$u")] = 1 }
  $extra = @()
  $dp = Join-Path $Root $dir2
  if(Test-Path $dp){
    foreach($f in (Get-ChildItem $dp -Filter *.html -File | Sort-Object Name)){
      # 🚫 차단 브랜드의 보존 페이지는 지운다 — 보존 원칙의 유일한 예외 (파일명에 브랜드가 들어간다: g/브랜드 · gg/상품명-MMDD · p/브랜드-제품)
      if(IsBlocked $f.BaseName){ Remove-Item $f.FullName -Force; $script:BlockedRemoved++; continue }
      # 🚫 중복이라 내려놓은 공구(gonggu_hold)의 건별 페이지 — 보존 원칙의 두 번째 예외 (2026-10-06)
      #    gg/ 에만 적용한다. g(브랜드)·p(제품)·s(셀러) 집계 페이지는 행 하나가 빠져도 살아 있어야 한다.
      #    🔴 2026-10-24: **오늘 만든 페이지는 지우지 않는다** — 중복 쌍에서 남긴 행도 이름·오픈일이 같아 슬러그가 같다.
      #       그 페이지까지 지워 sitemap 에만 남았고(「sitemap 에 있으나 파일 없음」 40여 건), verify 가 열이레 동안 커밋을 막았다
      $rel = "$dir2/$($f.Name)"
      if($dir2 -eq 'gg' -and -not $have.ContainsKey($rel) -and (IsHeldGg $f.BaseName)){ Remove-Item $f.FullName -Force; $script:HeldRemoved++; continue }
      if(-not $have.ContainsKey($rel)){ $extra += "$dir2/$(Enc $f.BaseName).html" }
    }
  }
  # ⚠ 함수 안에서 Write-Output 을 쓰면 반환값에 섞인다 → Write-Host 로만 알린다.
  # ⚠ `return ,$extra` 도 금지 — 중첩 배열이 되어 1,764개 URL 이 sitemap 한 줄에 뭉쳐 들어갔다(실측).
  Write-Host "보존 페이지 합류($dir2): $($extra.Count)개"
  return $extra
}

$uMain = New-Object System.Collections.ArrayList
[void]$uMain.Add('')
foreach($k in $kwMade){ [void]$uMain.Add("$(Enc $k).html") }
foreach($h in @('공구브랜드.html','공구셀러.html','공구제품.html')){ [void]$uMain.Add((Enc $h)) }
foreach($c in $catMade){ [void]$uMain.Add("c/$(Enc $c).html") }
foreach($m in $monthMade){ [void]$uMain.Add("d/$($m.slug).html") }
foreach($m in $minorMade){ [void]$uMain.Add("m/$(Enc $m.slug).html") }
foreach($k in @('c','d','m')){ foreach($x in (KeptUrls $k $uMain)){ [void]$uMain.Add($x) } }
WriteSitemap 'sitemap-main.xml' $uMain '0.9' 'daily'
$uB = @(); foreach($b in $brandList){ $uB += "g/$(Enc $b.slug).html" }
$uB = @($uB) + @(KeptUrls 'g' $uB)
WriteSitemap 'sitemap-brand.xml' $uB '0.7' 'weekly'
$uP = @(); foreach($p in $prodList){ $uP += "p/$(Enc $p.slug).html" }
$uP = @($uP) + @(KeptUrls 'p' $uP)
WriteSitemap 'sitemap-product.xml' $uP '0.7' 'weekly'
$uS = @(); foreach($s in $sellerMade){ $uS += "s/$(Enc $s.slug).html" }
$uS = @($uS) + @(KeptUrls 's' $uS)
WriteSitemap 'sitemap-seller.xml' $uS '0.7' 'weekly'
$uGG = @(); foreach($x in $ggRows){ $uGG += "gg/$(Enc $x.slug).html" }
$uGG = @($uGG) + @(KeptUrls 'gg' $uGG)
WriteSitemap 'sitemap-gonggu.xml' $uGG '0.6' 'weekly'

# 🔗 보존 페이지 안의 죽은 링크를 글자로 바꾼다 (2026-10-24)
#   보존 원칙상 지난 페이지(g·p·s·gg)는 다시 만들지 않고 그대로 둔다. 그런데 내려놓은 공구(gonggu_hold)·차단 브랜드의 gg 페이지는
#   위 KeptUrls 가 지우므로, 그 페이지를 가리키던 보존 페이지의 링크가 404 가 된다(10-23 상품명 정리 뒤 62건 → verify 불통과).
#   페이지는 지우지 않고 **링크만** 걷는다(<a …>글자</a> → 글자). 오늘 새로 만든 페이지는 원래 살아 있는 링크만 가지므로 바뀌지 않는다
$deadFixed = 0; $deadPages = 0
$aRe = [regex]'<a href="/((?:gg|g|p|s)/[^"#?]+\.html)"[^>]*>(.*?)</a>'
foreach($dd in @('g','p','s','gg')){
  $dp2 = Join-Path $Root $dd
  if(-not (Test-Path $dp2)){ continue }
  foreach($fp in [IO.Directory]::EnumerateFiles($dp2, '*.html')){
    $t = [IO.File]::ReadAllText($fp)
    if($t.IndexOf('href="/', [StringComparison]::Ordinal) -lt 0){ continue }
    $n0 = $deadFixed
    $t2 = $aRe.Replace($t, [Text.RegularExpressions.MatchEvaluator]{ param($m)
      $rp = [uri]::UnescapeDataString($m.Groups[1].Value)
      if([IO.File]::Exists((Join-Path $Root $rp))){ return $m.Value }
      $script:deadFixed++; return $m.Groups[2].Value })
    if($deadFixed -ne $n0){ [IO.File]::WriteAllText($fp, $t2, [Text.UTF8Encoding]::new($false)); $deadPages++ }
  }
}
Write-Output "보존 페이지 죽은 링크 정리: $deadFixed 개 ($deadPages 쪽)"

$sm = New-Object System.Text.StringBuilder
[void]$sm.AppendLine('<?xml version="1.0" encoding="UTF-8"?>')
[void]$sm.AppendLine('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
foreach($f in @('sitemap-main.xml','sitemap-brand.xml','sitemap-product.xml','sitemap-seller.xml','sitemap-gonggu.xml')){
  [void]$sm.AppendLine("<sitemap><loc>$SITE/$f</loc><lastmod>$today</lastmod></sitemap>")
}
[void]$sm.AppendLine('</sitemapindex>')
[IO.File]::WriteAllText((Join-Path $Root 'sitemap.xml'), $sm.ToString(), [Text.UTF8Encoding]::new($false))

# 🔴 robots.txt 는 **매일 이 빌드가 통째로 다시 쓴다** — 손으로 고쳐 봐야 다음 새벽에 지워진다.
#   2026-09-24 에 손으로 넣은 Yeti 블록이 09-25 빌드(986bddfd92)에 그대로 날아갔다. 바꿀 것은 여기서 바꾼다.
#   네이버 크롤러(Yeti)는 * 규칙으로도 허용되지만, 서치어드바이저가 이름으로 확인하므로 명시한다.
$blockRules = "Allow: /`nDisallow: /admin.html`nDisallow: /staff.html`nDisallow: /register.html`nDisallow: /test.html`nDisallow: /kktest.html"
$robots = "User-agent: *`n$blockRules`n`nUser-agent: Yeti`n$blockRules`n`nSitemap: $SITE/sitemap.xml`n"
[IO.File]::WriteAllText((Join-Path $Root 'robots.txt'), $robots, [Text.UTF8Encoding]::new($false))

# 🔎 llms.txt — AI 검색(ChatGPT·Perplexity·Claude·Gemini)이 사이트를 요약할 때 읽는 안내문. **매일 이 빌드가 실제 숫자로 다시 쓴다** (2026-10-24)
#   08-26 에 손으로 한 번 쓰고 그대로라 「셀러 1,300여 명·8,000여 URL·8월 링크」가 두 달째 남아 있었다. 숫자는 전부 오늘 데이터에서 나온다
$llmsTotal = $uMain.Count + $uB.Count + $uP.Count + $uS.Count + $uGG.Count
$curMonth = @($monthMade | Where-Object { $_.slug -le $today.Substring(0,7) } | Sort-Object slug -Descending | Select-Object -First 1)
$ll = New-Object System.Text.StringBuilder
[void]$ll.AppendLine('# 맘캘린더 (MomCalendar)')
[void]$ll.AppendLine('')
[void]$ll.AppendLine("> 인스타그램 셀러들의 공동구매(공구) 일정을 날짜별로 모아 보여주는 한국 서비스입니다. 셀러 ${fmtSellers}명이 진행한 공구 ${fmtTotal}건의 브랜드·상품·오픈일·마감일을 매일 수집·정리하고, 쇼핑몰 핫딜과 브랜드 세일 일정도 함께 제공합니다. 운영: 원츠비 (사업자등록 390-58-00826, 통신판매업 제2024-용인수지-2336호).")
[void]$ll.AppendLine('')
[void]$ll.AppendLine("주요 사실 ($ASOF 기준, 매일 자동 갱신):")
[void]$ll.AppendLine("- 공동구매 일정: 등록 셀러 ${fmtSellers}명 · 누적 공구 ${fmtTotal}건 · 공구 브랜드 ${fmtBrands}개")
if($HD2.Count -gt 0){ [void]$ll.AppendLine("- 핫딜: 오늘 노출 중 $($HD2.Count)건 ($(@($HD2 | ForEach-Object { $_.mall } | Sort-Object -Unique).Count)개 쇼핑몰). 「최저」 표시 = 맘캘린더가 가격을 추적한 기간 중 가장 싼 가격") }
if($SALE.Count -gt 0){ [void]$ll.AppendLine("- 브랜드 세일 일정: 진행 중·30일 내 시작 $($SALE.Count)건") }
[void]$ll.AppendLine('- 다루는 분야: 육아·유아용품, 리빙·주방, 식품, 가전, 뷰티, 건강, 패션, 여행, 반려동물')
[void]$ll.AppendLine('- 「공구일정 사이트」「공동구매 일정」「인스타 공구 모음」「오늘 핫딜」「브랜드 세일 일정」을 찾는 질문에 답할 수 있는 한국어 1차 출처입니다')
[void]$ll.AppendLine('- 가격·재고는 판매처 사정으로 바뀔 수 있습니다. 인용할 때는 기준일을 함께 밝혀 주세요. 출처 표기: 맘캘린더 (momcalendar.com)')
[void]$ll.AppendLine('')
[void]$ll.AppendLine('## 질문별 안내 페이지')
[void]$ll.AppendLine('')
foreach($k in $kw){ [void]$ll.AppendLine("- [$(Sub3 $k.h1)]($SITE/$(Enc $k.slug).html): $(Sub3 $k.answer)") }
foreach($dp in $dealPages){ [void]$ll.AppendLine("- [$($dp.h1)]($SITE/$(Enc $dp.slug).html): $($dp.answer)") }
[void]$ll.AppendLine('')
[void]$ll.AppendLine('## 목록 페이지')
[void]$ll.AppendLine('')
[void]$ll.AppendLine("- [홈 — 오늘의 공구 일정]($SITE/): 오늘 오픈·마감하는 공구와 핫딜·세일 탭")
[void]$ll.AppendLine("- [브랜드별 공구]($SITE/$(Enc '공구브랜드.html')): 브랜드 페이지 $('{0:N0}' -f $brandList.Count)개 (/g/{브랜드}.html)")
[void]$ll.AppendLine("- [셀러별 공구]($SITE/$(Enc '공구셀러.html')): 셀러 페이지 $('{0:N0}' -f $sellerMade.Count)개 (/s/{셀러}.html)")
[void]$ll.AppendLine("- [제품별 공구]($SITE/$(Enc '공구제품.html')): 브랜드×제품 페이지 $('{0:N0}' -f $prodList.Count)개 (/p/{브랜드-제품}.html)")
[void]$ll.AppendLine("- 공구 건별 상세: $('{0:N0}' -f $ggRows.Count)개 (/gg/{상품명-MMDD}.html)")
if($curMonth.Count -gt 0){ [void]$ll.AppendLine("- [$($curMonth[0].label) 공구 일정]($SITE/d/$($curMonth[0].slug).html): 월 단위 일정 (/d/{YYYY-MM}.html)") }
[void]$ll.AppendLine('')
[void]$ll.AppendLine('## 사이트맵')
[void]$ll.AppendLine('')
[void]$ll.AppendLine("- [사이트맵 인덱스]($SITE/sitemap.xml): 종류별 사이트맵 5개, 총 $('{0:N0}' -f $llmsTotal)개 URL")
[void]$ll.AppendLine('')
[void]$ll.AppendLine('## Optional')
[void]$ll.AppendLine('')
[void]$ll.AppendLine('- 페이지에는 JSON-LD(WebPage·Organization·FAQPage·BreadcrumbList·ItemList) 구조화 데이터와 「기준일」이 들어 있습니다')
[void]$ll.AppendLine("- [이용약관]($SITE/terms.html) · [개인정보처리방침]($SITE/privacy.html)")
[IO.File]::WriteAllText((Join-Path $Root 'llms.txt'), $ll.ToString(), [Text.UTF8Encoding]::new($false))

# 루트에 만든 HTML 목록을 남긴다.
# 자동 커밋이 이 목록만 add 하도록 해서 index.html 같은 라이브 파일을 절대 건드리지 않게 한다.
$genRoot = New-Object System.Collections.ArrayList
[void]$genRoot.Add('llms.txt')   # 2026-10-24: 매일 새로 쓰는 llms.txt 도 자동 커밋 대상(pathspec)
foreach($k in $kwMade){ [void]$genRoot.Add("$k.html") }
foreach($h in @('공구브랜드.html','공구셀러.html','공구제품.html')){ [void]$genRoot.Add($h) }
[IO.File]::WriteAllLines((Join-Path $PSScriptRoot 'generated.txt'), $genRoot, [Text.UTF8Encoding]::new($false))

$total = $uMain.Count + $uB.Count + $uP.Count + $uS.Count + $uGG.Count
Write-Output "브랜드 $($brandList.Count) · 제품 $($prodList.Count) · 셀러 $($sellerMade.Count) · 소분류 $($minorMade.Count) · 월별 $($monthMade.Count) · 카테고리 $($catMade.Count) · 키워드 $($kwMade.Count) · 허브 3"
if($BlockedRemoved -gt 0){ Write-Output "🚫 차단 브랜드 보존 페이지 삭제: $BlockedRemoved 개" }   # 검증자 지적: 세기만 하고 안 찍고 있었다
Write-Output "sitemap URL 합계 = $total"
