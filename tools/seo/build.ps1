# 검색 노출용 정적 페이지 생성기 (사장님 지시 2026-08-05)
#
#   pwsh tools/seo/build.ps1                     ← DB 캐시(seo_dataset RPC)를 읽어 생성
#   pwsh tools/seo/build.ps1 -DataFile a.json    ← 받아둔 JSON 으로 생성(테스트용)
#
# 데이터는 public.seo_dataset() 이 준다. 이 RPC 는 2026-10-27 부터 서버 열쇠로만 부른다(SUPABASE_SERVICE_KEY). 반환값은
# 전부 사이트에 그대로 공개되는 내용이다. 그래서 GitHub Secret 이 필요 없다.
param(
  [string]$Root = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [string]$DataFile = '',
  [int]$GgKeepDays = 7,      # gg 색인 계층 B(최근 마감) 창. 2026-11-25 30→7(사장님 승인 — 끝난 공구 B 6,339 → 약 2,500 · 16개월 노출 있던 619장은 gg_keep_index 로 지킨다). 사이트맵이 상한을 넘으면 빌드가 스스로 줄인다. 되돌리기: 21(어제 창) 또는 365
  [string]$GTier = 'on',     # 2026-11-25 g(브랜드) 얇은 페이지 색인 제외. 'off' 면 전부 index 로 되돌린다
  [int]$CapMax = 300         # 2026-11-26 gg 「셀러 공지」 칸에 싣는 원문 글자 상한(전에는 2000 = 인스타 캡션 통째 복사, 대량 복사 콘텐츠 신호). 되돌리기 -CapMax 2000
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
  # 🔒 2026-10-27: seo_dataset(공개 공구 전체를 한 번에 주는 함수)은 공개 키로 못 부르게 막았다 — 서버 열쇠(GitHub Secret SUPABASE_SERVICE_KEY)로 부른다
  $sk = $env:SUPABASE_SERVICE_KEY
  if(-not $sk){ throw 'SUPABASE_SERVICE_KEY 가 없다 — GitHub Secrets(또는 로컬은 tools/daily/.env 의 SB_SERVICE_KEY 를 이 이름으로) 확인' }
  # DB 가 다른 크론과 겹쳐 잠깐 바쁘면 「statement timeout」이 난다(2026-11-16 21:14 실측) → 40초 쉬고 세 번까지 다시 부른다
  $r = $null
  for($try = 1; $try -le 3 -and -not $r; $try++){
    try{
      $r = Invoke-WebRequest -Uri $api -Method POST -TimeoutSec 180 `
            -Headers @{ apikey=$sk; Authorization="Bearer $sk"; 'Content-Type'='application/json' } -Body '{}'
    }catch{
      if($try -ge 3){ throw }
      Write-Output "seo_dataset 읽기 실패($try/3): $($_.Exception.Message) — 40초 뒤 다시"
      Start-Sleep -Seconds 40
    }
  }
  $D =SquashSpaces ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())) | ConvertFrom-Json
}

# ── 활성 핫딜 — 한 번만 읽는다 (2026-11-16 ORDER_SEO_AEO_GEO_RECOVERY §5-3) ──
#   전에는 여기서 id·title·link 80건($HotDeals)을, 아래 핫딜 페이지 자리에서 가격 포함 400건($HD2)을 따로 읽었다.
#   브랜드(g)·공구(gg) 페이지 루프가 「연관 핫딜」에 가격을 쓰려면 $HD2 가 그 루프보다 먼저 있어야 한다(아래에 두면 전 페이지 0건).
#   공개 REST 만 쓴다(핫딜 목록은 사이트에 공개되는 내용). 실패해도 페이지 생성은 계속한다.
# 🔴 2026-10-24 검증 불통과 반영 — 핫딜은 사이트 화면과 **같은 말**만 한다:
#   · 쿠팡·링크프라이스의 price_before 는 정가가 아니라 우리가 기록한 90일 평균이다(coupang-hotdeal·linkprice-hotdeal) → 「평균」 이라 부른다
#   · 할인율은 판매가·비교가로 **다시 계산**하고, 65% 를 넘으면 쓰지 않는다(index.html 「정가는 파는 쪽이 부르는 값이라 부풀려진 경우가 많다」)
#   · 몰 이름 「토스」 와 「토스쇼핑」 은 같은 몰이다(둘 다 source=toss) → 하나로 센다
#   · 가격은 이 빌드가 다시 잰 값이 아니다 — 「등록 때 확인한 가격」이라 적는다. 「오늘 핫딜」 이 아니라 「지금 노출 중」
$HotDeals = @(); $HD2 = @(); $HdByMajor = @{}; $RelOwn = $false
try{
  # ⚠ PostgREST 는 값 자리의 now() 를 문자열로 취급한다(실측: 핫딜 15개가 1개로 줄었다) → 실제 시각을 넣는다
  $nowUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $q2 = "?select=id,title,link,mall,price,price_before,discount_rate,is_lowest,deal_day,source,major,minor&or=(expires_at.is.null,expires_at.gte.$nowUtc)&price=gt.0&order=id.desc&limit=400"
  $r2 = Invoke-WebRequest -Uri ('https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/hotdeals' + $q2) -TimeoutSec 30 -Headers @{ apikey=$key; Authorization="Bearer $key" }
  # ⚠ PS 5.1 ConvertFrom-Json 은 JSON 배열을 한 덩어리로 준다 → 파이프로 한 번 풀어야 개수가 맞는다(실측 31→1)
  $HD2 = @(([Text.Encoding]::UTF8.GetString($r2.RawContentStream.ToArray()) | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { $_.title -and $_.mall -and [int]$_.price -gt 0 } | ForEach-Object {
    $m = "$($_.mall)".Trim(); if($m -eq '토스'){ $m = '토스쇼핑' }
    $pb = [int]$_.price_before; $pp = [int]$_.price
    $isAvg = ("$($_.source)" -match '^(coupang|linkprice)$')
    $rt = 0; if($pb -gt $pp -and $pb -gt 0){ $rt = [int][Math]::Round(($pb - $pp) * 100.0 / $pb) }
    if($rt -gt 65){ $rt = 0 }   # 사이트와 같은 기준 — 부풀려진 정가로 보고 할인율을 쓰지 않는다
    [pscustomobject]@{ id="$($_.id)"; title="$($_.title)"; link="$($_.link)"; mall=$m; price=$pp; ref=$(if($rt -gt 0){ $pb } else { 0 }); refLabel=$(if($isAvg){ '최근 평균' } else { '정가' }); rate=$rt; is_lowest=[bool]$_.is_lowest; major="$($_.major)"; minor="$($_.minor)" }
  } | Sort-Object @{e={$_.rate};Descending=$true}, @{e='title';Descending=$false})
  $HotDeals = $HD2
  foreach($h in $HD2){ if($h.major){ if(-not $HdByMajor.ContainsKey($h.major)){ $HdByMajor[$h.major] = New-Object System.Collections.ArrayList }; [void]$HdByMajor[$h.major].Add($h) } }
  Write-Output "활성 핫딜(가격 있음) $($HD2.Count)건 확보"
}catch{ Write-Output "핫딜 조회 실패(무시 — 연관 핫딜·핫딜 페이지 건너뜀): $($_.Exception.Message)" }

# 「연관 핫딜」 — 공구 페이지(g·gg)에 싣는 지금 노출 중인 핫딜 3건. 그 브랜드 이름이 든 딜 먼저, 모자라면 같은 분야 딜(페이지마다 다른 자리에서 시작).
#   가격은 핫딜의 실가격이다(공구 가격이 아니다 — 공구 가격은 수집하지 않는다).
function RelDeals([string]$brand, [string]$major, [string]$seed){
  $out = New-Object System.Collections.ArrayList
  if($HD2.Count -eq 0){ return @() }
  # 🔴 포함검색 금지 — 「로이」에 코듀로이, 「리스」에 매트리스, 「동원」에 다른 식품이 딸려 나왔다(검증자 2026-11-16, 「헤라에 헤라스 김」과 같은 꼴).
  #   브랜드가 제목 안에서 **독립된 낱말**일 때만 그 브랜드 딜로 본다. 브랜드 딜이 하나라도 있으면 그것만 싣고(분야 딜을 섞지 않는다), 없으면 같은 분야 딜로
  if($brand -and $brand.Length -ge 2){
    $rxB = [regex]('(?i)(^|[^가-힣A-Za-z0-9])' + [regex]::Escape($brand) + '([^가-힣A-Za-z0-9]|$)')
    foreach($h in $HD2){ if($out.Count -ge 3){ break }; if($rxB.IsMatch("$($h.title)")){ [void]$out.Add($h) } }
    if($out.Count -gt 0){ $script:RelOwn = $true; return @($out) }
  }
  $script:RelOwn = $false
  if($out.Count -lt 3 -and $major -and $HdByMajor.ContainsKey($major)){
    $pool = $HdByMajor[$major]; $n = $pool.Count
    $st = 0; foreach($ch in "$seed".ToCharArray()){ $st = ($st * 31 + [int]$ch) % 100003 }
    for($i = 0; $i -lt $n -and $out.Count -lt 3; $i++){ $h = $pool[($st + $i) % $n]; if(-not $out.Contains($h)){ [void]$out.Add($h) } }
  }
  return @($out)
}
function RelDealsHtml($deals, [string]$h2){
  $deals = @($deals)
  if($deals.Count -eq 0){ return '' }
  # <!--hd--> 표식: 핫딜은 날마다 바뀐다 — 사이트맵 lastmod 를 정할 때 이 구간은 빼고 본다(CoreHash)
  $s = "<!--hd--><div class=${Q}sec${Q}><h2>$(HtmlEsc $h2)</h2>"
  foreach($h in $deals){
    $pz = ('{0:N0}' -f [int]$h.price) + '원'
    if($h.rate -gt 0){ $pz += " ($($h.refLabel) $('{0:N0}' -f [int]$h.ref)원 대비 $($h.rate)%↓)" }
    $inner = "<b>$(HtmlEsc $h.title)</b><span>$(HtmlEsc $h.mall) · $pz</span>"
    if("$($h.link)" -match '^https?://'){ $s += "<a class=${Q}card${Q} href=${Q}$(HtmlEsc $h.link)${Q} rel=${Q}nofollow sponsored noopener${Q} target=${Q}_blank${Q}>$inner</a>" }
    else { $s += "<div class=${Q}card${Q}>$inner</div>" }
  }
  $s += "<p style=${Q}margin-top:8px;font-size:11px;color:#B5AFBD${Q}>핫딜 가격은 등록할 때 확인한 값이라 판매처에서 바뀌거나 끝날 수 있습니다. 공구 가격과는 다른 쇼핑몰 특가입니다. 제휴 활동으로 일정액의 수수료를 받을 수 있습니다</p></div><!--/hd-->"
  return $s
}

# ── 공구 캡션 (셀러 공지 원문 — 건별 상세 페이지의 고유 본문, 사장님 지시 2026-08-31 "다 수집해") ──
# 저장 단계에서 전화·이메일·계좌열은 이미 제거돼 있다(caption_attach.mjs). 렌더 때 외부 링크를 추가로 걷어낸다.
$CapMap = @{}
# 📉 2026-11-19 (전송량 절감): 전에는 매일 승인 공구의 캡션 1만 2천 건(약 23MB)을 통째로 받았다 — 월 0.7GB, 무료 한도 5GB 의 14%.
#   이제 어제 받아 둔 사본(환경변수 SEO_CAP_CACHE 가 가리키는 파일 · 깃허브에서는 actions/cache 가 회차 사이에 넘겨 준다)을 읽고,
#   DB 함수 seo_caption_sigs(행마다 「이름|오픈일|캡션」 지문, 전체 0.7MB)로 바뀐 행만 골라 그 캡션만 다시 받는다(하루 100~200건).
#   사본이 없거나(첫 회차·캐시 만료) 증분이 한 군데라도 어긋나면 예전처럼 전체를 받는다 — 결과(CapMap)는 어느 길이든 같다.
#   사본은 저장소에 올리지 않는다(생성물 add 목록 밖 · 실행기 임시 폴더).
$capCacheFile = "$($env:SEO_CAP_CACHE)"
$capApi = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/gonggu'
function CapGet([string]$uri){
  # 한 쪽이 500(무료 DB 순간 실패)이면 세 번까지 다시 받는다(2026-11-16)
  $cr = $null
  for($try = 1; $try -le 3 -and -not $cr; $try++){
    try{ $cr = Invoke-WebRequest -Uri $uri -TimeoutSec 60 -Headers @{ apikey=$key; Authorization="Bearer $key" } }
    catch{ if($try -eq 3){ throw }; Start-Sleep -Seconds (5 * $try) }
  }
  return ,@(([Text.Encoding]::UTF8.GetString($cr.RawContentStream.ToArray()) | ConvertFrom-Json) | ForEach-Object { $_ })
}
function CapSig([string]$n, [string]$o, [string]$c){
  $md5 = [Security.Cryptography.MD5]::Create()
  try{ return ([BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes("$n|$o|$c")))).Replace('-','').ToLower() } finally { $md5.Dispose() }
}
try{
  $capRows = @{}      # id(문자열) → @{ i; s(지문); n; o; c }
  $capMode = '전체'
  if($capCacheFile -and (Test-Path $capCacheFile)){
    try{
      foreach($ln in [IO.File]::ReadLines($capCacheFile, [Text.Encoding]::UTF8)){
        if(-not $ln){ continue }
        $x = $ln | ConvertFrom-Json
        $capRows["$($x.i)"] = $x
      }
    }catch{ Write-Output "캡션 사본을 못 읽음($($_.Exception.Message)) — 전체를 받는다"; $capRows = @{} }
  }
  $incrOk = $false
  if($capRows.Count -ge 1000){
    try{
      $sigs = @{}; $soff = 0
      while($true){
        $sj = CapGet ("https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/rpc/seo_caption_sigs?p_offset=$soff&p_limit=1000")
        if($sj.Count -eq 0){ break }
        foreach($s0 in $sj){ $sigs["$($s0.id)"] = "$($s0.sig)" }
        if($sj.Count -lt 1000){ break }
        $soff += 1000
      }
      if($sigs.Count -lt 1000){ throw "지문이 $($sigs.Count)건뿐" }
      $need = @($sigs.Keys | Where-Object { -not $capRows.ContainsKey($_) -or "$($capRows[$_].s)" -ne $sigs[$_] })
      if($need.Count -gt [int]($sigs.Count * 0.5)){ throw "바뀐 행이 절반을 넘는다($($need.Count)/$($sigs.Count)) — 전체로 받는 편이 낫다" }
      for($bi = 0; $bi -lt $need.Count; $bi += 150){
        $ids = ($need[$bi..([Math]::Min($bi + 149, $need.Count - 1))]) -join ','
        $bj = CapGet ($capApi + "?select=id,name,open_date,caption&approved=eq.true&caption=not.is.null&id=in.($ids)&limit=1000")
        foreach($c0 in $bj){
          $capRows["$($c0.id)"] = [pscustomobject]@{ i = $c0.id; s = (CapSig "$($c0.name)" "$($c0.open_date)" "$($c0.caption)"); n = "$($c0.name)"; o = "$($c0.open_date)"; c = "$($c0.caption)" }
        }
      }
      foreach($k in @($capRows.Keys)){ if(-not $sigs.ContainsKey($k)){ $capRows.Remove($k) } }     # 내려간 공구·캡션 지워진 행
      # 지문에 있는 행은 하나도 빠지면 안 된다 — 지문을 받은 뒤 그사이 내려가거나 캡션이 지워진 행이 하나라도 비면 그날 페이지 본문이 빠지므로 전체로 받는다
      #   (전에는 20건까지 비어도 증분을 믿고 사본까지 저장했다 — 코덱스 검사 2026-11-20)
      $miss = @($sigs.Keys | Where-Object { -not $capRows.ContainsKey($_) }).Count
      if($miss -gt 0){ throw "증분 뒤에도 $miss 건이 비어 있다" }
      $incrOk = $true
      $capMode = "증분(바뀐 $($need.Count)건만 다시 받음 · 지문 $($sigs.Count)건)"
    }catch{ Write-Output "캡션 증분 실패($($_.Exception.Message)) — 전체를 받는다"; $incrOk = $false }
  }
  if(-not $incrOk){
    $capRows = @{}
    $off = 0
    while($true){
      $cj = CapGet ($capApi + "?select=id,name,open_date,caption&approved=eq.true&caption=not.is.null&order=id.asc&offset=$off&limit=1000")
      if($cj.Count -eq 0){ break }
      foreach($c0 in $cj){
        $capRows["$($c0.id)"] = [pscustomobject]@{ i = $c0.id; s = (CapSig "$($c0.name)" "$($c0.open_date)" "$($c0.caption)"); n = "$($c0.name)"; o = "$($c0.open_date)"; c = "$($c0.caption)" }
      }
      if($cj.Count -lt 1000){ break }
      $off += 1000
    }
  }
  # 예전과 같은 순서(id 오름차순)로 채운다 — 이름·오픈일이 같은 행이 둘이면 id 가 큰 쪽이 남는다
  foreach($x in ($capRows.Values | Sort-Object { [long]$_.i })){ $CapMap[("$($x.n)|$($x.o)").ToLower()] = "$($x.c)" }
  Write-Output "공구 캡션 $($CapMap.Count)건 확보 — $capMode"
  if($capCacheFile -and $capRows.Count -ge 1000){
    try{
      $cdir = Split-Path -Parent $capCacheFile
      if($cdir -and -not (Test-Path $cdir)){ New-Item -ItemType Directory -Force -Path $cdir | Out-Null }
      $sw = New-Object IO.StreamWriter($capCacheFile, $false, (New-Object Text.UTF8Encoding($false)))
      try{ foreach($x in $capRows.Values){ $sw.WriteLine(($x | ConvertTo-Json -Compress -Depth 3)) } } finally { $sw.Dispose() }
      Write-Output "캡션 사본 저장 $($capRows.Count)건 → $capCacheFile"
    }catch{ Write-Output "캡션 사본 저장 실패(무시 — 다음 회차는 전체를 받는다): $($_.Exception.Message)" }
  }
}catch{
  # 🔴 2026-11-16: 「실패(무시)」로 넘어가면 그날 건별 페이지 1만 5천 장이 **셀러 공지 없이** 다시 써진다(본문이 절반 아래로 얇아지고 lastmod 까지 오늘로 바뀐다).
  #   캡션은 건별 페이지의 고유 본문이다 → 못 받으면 페이지를 만들지 않고 멈춘다(어제 판이 그대로 남는다 — 보존 원칙). Actions 가 실패로 떠서 사람이 안다.
  throw "공구 캡션을 못 받았다($($_.Exception.Message)) — 셀러 공지 없는 페이지로 덮어쓰지 않으려고 멈춘다"
}
if($CapMap.Count -lt 1000){ throw "공구 캡션이 $($CapMap.Count)건뿐이다 — 비정상. 셀러 공지 없는 페이지로 덮어쓰지 않으려고 멈춘다" }

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
# 🧹 브랜드가 아닌 브랜드 페이지(상품명 오류 잔해 — 「1만원대」「건조기」「매일쓰는」) — tools/seo/junk_brands.txt (2026-10-24 사장님 「정리해야지」)
#   그 이름의 g 페이지는 만들지 않고, 보존 페이지로 남아 있으면 지운다(KeptUrls). brand_block 과 달리 DB·다른 화면은 건드리지 않는다
$JunkBrands = @{}
$jf = Join-Path $PSScriptRoot 'junk_brands.txt'
if(Test-Path $jf){ foreach($l in [IO.File]::ReadAllLines($jf)){ $t = $l.Trim(); if($t -and -not $t.StartsWith('#')){ $JunkBrands[$t.ToLower()] = 1 } } }
Write-Output "브랜드 아님 목록: $($JunkBrands.Count)개"
$JunkRemoved = 0

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

# ── gg 색인 계층 (2026-11-16 크롤 예산 회수 — ORDER_SEO_AEO_GEO_RECOVERY §4) ──
# A = 진행 중·예정 : 사이트맵 등재 + index,follow + 풀 템플릿(Event 포함)
# B = 최근 마감($GG_KEEP_DAYS 일) : 사이트맵 등재 + index,follow + 풀 템플릿
# C = 그 밖(장기 마감) : 사이트맵 제외 + noindex,follow + 페이지는 200 유지(보존 원칙 — 지우지 않는다)
# 되돌리기: -GgKeepDays 365 로 한 번 돌리면 전부 B 로 돌아온다(파일을 지우는 게 아니라 사이트맵·메타만 바뀐다).
$GG_KEEP_DAYS = $GgKeepDays
$GG_SITEMAP_MAX = 11500   # 목표: sitemap-gonggu 12,000 이하 · 전체 28,000 이하(g·p·s 는 줄이지 않는다) — 여유를 두고 11,500 에 맞춘다
function GgCutOf([int]$days){ return ([DateTime]::ParseExact($today,'yyyy-MM-dd',$null)).AddDays(-$days).ToString('yyyy-MM-dd') }
$ggCutoff = GgCutOf $GG_KEEP_DAYS

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

# ── 보관분(gonggu_archive) 이력 합치기 (2026-11-16) ──
#   seo_dataset() 은 gonggu 표만 집계한다. 두 달 지나 보관 표로 간 공구(1~9월 약 1만 8천 건)는 빠져서
#   브랜드·제품·셀러·월별 페이지가 「최근 두 달 이력」만 갖거나 아예 다시 안 만들어졌다(옛 내용으로 굳음).
#   보관분은 DB 가 따로 한 번 집계해 둔다(seo_dataset_archive · supabase/sql/seo_archive_cache_152.sql, 매주 갱신).
#   여기서 열쇠(브랜드·제품·셀러·분류·달)로 합친다. 못 읽으면 합치지 않고 그대로 간다(빌드를 막지 않는다).
#   stat·live·soon 은 합치지 않는다(지금 진행 중인 것은 gonggu 표에만 있다).
function ArchMerge($live, $arch, [scriptblock]$keyOf, [int]$instaCol, [bool]$asc){
  $idx = @{}; $out = New-Object System.Collections.ArrayList
  foreach($x in @($live)){ if($null -eq $x){ continue }; $idx[(& $keyOf $x)] = $x; [void]$out.Add($x) }
  foreach($y in @($arch)){
    if($null -eq $y){ continue }
    $k = & $keyOf $y
    if(-not $k){ continue }
    if(-not $idx.ContainsKey($k)){ $idx[$k] = $y; [void]$out.Add($y); continue }
    $x = $idx[$k]
    $x.cnt = [int]$x.cnt + [int]$y.cnt
    if($y.rows){ $x.rows = $(if(-not $x.rows){ "$($y.rows)" } elseif($asc){ "$($y.rows)`n$($x.rows)" } else { "$($x.rows)`n$($y.rows)" }) }
    if($x.PSObject.Properties['first_open'] -and $y.first_open -and (-not $x.first_open -or [string]::CompareOrdinal("$($y.first_open)", "$($x.first_open)") -lt 0)){ $x.first_open = $y.first_open }
    if($x.PSObject.Properties['last_open'] -and $y.last_open -and (-not $x.last_open -or [string]::CompareOrdinal("$($y.last_open)", "$($x.last_open)") -gt 0)){ $x.last_open = $y.last_open }
    if($x.PSObject.Properties['topprods'] -and -not $x.topprods -and $y.topprods){ $x.topprods = $y.topprods }
    if($x.PSObject.Properties['sellers']){
      if($instaCol -ge 0){
        $set = @{}
        foreach($ln in ("$($x.rows)" -split "`n")){ $pp = $ln -split "`t"; if($pp.Count -gt $instaCol -and $pp[$instaCol]){ $set[$pp[$instaCol].Trim().ToLower()] = 1 } }
        if($set.Count -gt 0){ $x.sellers = $set.Count }
      } elseif([int]$y.sellers -gt [int]$x.sellers){ $x.sellers = [int]$y.sellers }
    }
  }
  return ,$out
}
$ARCH = $null
try{
  if($DataFile){
    $af = "$DataFile.archive.json"
    if(Test-Path -LiteralPath $af){ $ARCH = SquashSpaces ([IO.File]::ReadAllText($af)) | ConvertFrom-Json }
  } else {
    $ra = Invoke-WebRequest -Uri ($api + '_archive') -Method POST -TimeoutSec 180 `
          -Headers @{ apikey=$sk; Authorization="Bearer $sk"; 'Content-Type'='application/json' } -Body '{}'
    $ta = [Text.Encoding]::UTF8.GetString($ra.RawContentStream.ToArray())
    if($ta -and $ta.Trim() -ne 'null'){ $ARCH = SquashSpaces $ta | ConvertFrom-Json }
  }
}catch{ Write-Output "보관분 이력 읽기 실패(합치지 않고 계속): $($_.Exception.Message)" }
if($ARCH -and @($ARCH.brands).Count -gt 0){
  $b0 = @($D.brands).Count; $p0 = @($D.products).Count; $s0 = @($D.sellers).Count; $m0 = @($D.months).Count
  $D.brands   = (ArchMerge $D.brands   $ARCH.brands   { param($o) "$($o.brand)".ToLower() } 4 $false).ToArray()
  $D.products = (ArchMerge $D.products $ARCH.products { param($o) ("$($o.brand)|$($o.prod)").ToLower() } 4 $false).ToArray()
  $D.sellers  = (ArchMerge $D.sellers  $ARCH.sellers  { param($o) "$($o.insta)".Trim().ToLower() } -1 $false).ToArray()
  $D.minors   = (ArchMerge $D.minors   $ARCH.minors   { param($o) "$($o.major)|$($o.minor)" } -1 $false).ToArray()
  $D.months   = (ArchMerge $D.months   $ARCH.months   { param($o) "$($o.ym)" } -1 $true).ToArray()
  Write-Output "보관분 이력 합침: 브랜드 $b0 → $(@($D.brands).Count) · 제품 $p0 → $(@($D.products).Count) · 셀러 $s0 → $(@($D.sellers).Count) · 달 $m0 → $(@($D.months).Count)"
} else { Write-Output '보관분 이력 없음 — 합치지 않는다' }

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
  # 2026-11-16: 파일 통째 해시가 아니라 CoreHash — 페이지마다 박힌 기준일 한 줄 때문에 43,844 URL 중 25,904 개가 날마다 lastmod=오늘 로 나가고 있었다(내용은 그대로)
  if(Test-Path -LiteralPath $fp){ $PrevHash[$rel] = (CoreHash $fp) }
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

# ── 📲 앱 전환 CTA (2026-11-22 ORDER §4) — 모든 생성 페이지 헤더 아래 한 줄 ──
#   문구의 숫자는 이 빌드가 잰 값만 쓴다(사장님 정확도 원칙: 못 잰 숫자는 말하지 않는다).
# 두 스토어 버튼이 늘 같이 보이면 아이폰 손님에게 Play 버튼이, 안드로이드 손님에게 App Store 버튼이 같이 보인다. (2026-11-23 ORDER_STORE_SEO_CONVERSION §6-3)
#   UA 로 「표시만」 가른다 — PC·판별 불가(아이패드 데스크톱 모드 등)는 그대로 둘 다 보인다. 크롤러 본문은 안 바뀐다.
$CtaOs = "<script>(function(){try{var ua=navigator.userAgent||'';var ios=/iPhone|iPad|iPod/i.test(ua),and=/Android/i.test(ua);if(!ios&&!and)return;document.documentElement.className+=(ios?' os-ios':' os-and');}catch(e){}})();</script>"   # 2026-11-23: html 에 단다 — 하단 CTA(cta2)는 스크립트보다 뒤에 있어 .appcta 에 달면 못 잡는다(라이브 V6 에서 발견)
$AppCta = ''
try{
  $tom = ([datetime]::ParseExact($D.today, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)).AddDays(1)
  $tomS = $tom.ToString('yyyy-MM-dd')
  $tomN = 0
  try{
    # limit=1 + Prefer: count=exact → PostgREST 가 Content-Range 에 전체 건수를 넣어 준다(Range 머리말은 PS 5.1 에서 막히는 경우가 있어 안 쓴다)
    $cu = "https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/gonggu?select=id&open_date=eq.$tomS&limit=1"
    $cr = Invoke-WebRequest -UseBasicParsing -Uri $cu -TimeoutSec 20 -Headers @{ apikey=$key; Authorization="Bearer $key"; Prefer='count=exact' }
    $crv = "$($cr.Headers['Content-Range'])"
    if(-not $crv){ try{ $crv = "$($cr.Headers.GetValues('Content-Range')[0])" }catch{} }
    $cm = [regex]::Match($crv, '/(\d+)\s*$'); if($cm.Success){ $tomN = [int]$cm.Groups[1].Value }
  }catch{}
  if($tomN -le 0){ $tomN = @($soonRows | Where-Object { "$($_.od)".Length -ge 10 -and "$($_.od)".Substring(0,10) -eq $tomS }).Count }
  $dowKo = @('일','월','화','수','목','금','토')[[int]$tom.DayOfWeek]
  if($tomN -ge 100){ $hook = "내일($dowKo) 오픈 공구 ${tomN}건" } else { $hook = '공구 일정 매일 갱신' }
  $AppCta = "<div class=${Q}appcta${Q}><b>$(HtmlEsc $hook)</b><span>앱에서 알림·찜하기</span>" +
    "<a class=${Q}ap ios${Q} href=${Q}https://apps.apple.com/kr/app/id6826126083${Q} rel=${Q}nofollow noopener${Q} onclick=${Q}try{gtag('event','seo_app_cta',{place:'seo_ios',page:location.pathname})}catch(_){}${Q}>App Store</a>" +
    "<a class=${Q}ap g and${Q} href=${Q}https://play.google.com/store/apps/details?id=com.wantsb.momcalendar${Q} rel=${Q}nofollow noopener${Q} onclick=${Q}try{gtag('event','seo_app_cta',{place:'seo_and',page:location.pathname})}catch(_){}${Q}>Google Play</a></div>" + $CtaOs
  Write-Output "앱 CTA: $hook (내일 $tomS · 조회 $tomN)"
}catch{ Write-Output "앱 CTA 못 만듦($($_.Exception.Message)) — 배너 없이 빌드 계속" }

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
  if($JunkBrands.ContainsKey(("$($x.brand)").Trim().ToLower())){ continue }   # 🧹 브랜드가 아닌 이름(junk_brands.txt)
  # NON-GMO vs Non-gmo 처럼 케이스만 다른 같은 브랜드는 하나만 남긴다
  $nk = ("$($x.brand)").ToLower()
  if($seenBName.ContainsKey($nk)){ continue }
  $seenBName[$nk] = 1
  $slug = CanonCase (SlugOf $x.brand $seenB '-g') 'g'
  if([string]::IsNullOrWhiteSpace($slug)){ continue }
  if($JunkBrands.ContainsKey($slug.ToLower())){ continue }   # 🧹 목록은 파일 이름 꼴(「F/W」→ F-W)이라 슬러그로도 본다 (2026-10-24 검증: 이름으로만 보면 만들고 지워 sitemap 에 남았다)
  [void]$brandList.Add([pscustomobject]@{ slug=$slug; brand=$x.brand; cnt=[int]$x.cnt; sellers=[int]$x.sellers;
       major=$x.major; first=$x.first_open; last=$x.last_open; topprods=$x.topprods; raw=$x.rows })
}
$brandSlug = @{}
foreach($b in $brandList){ if(-not $brandSlug.ContainsKey($b.brand)){ $brandSlug[$b.brand] = $b.slug } }
# 검색량 1순위 · 건수 2순위 (검색되는 브랜드에 내부 링크 힘을 몰아준다, 2026-08-31)
$topBrands = $brandList | Sort-Object @{e={VolOf $_.brand};Descending=$true}, @{e={[int]$_.cnt};Descending=$true}, @{e='brand';Descending=$false} | Select-Object -First 24
# 🏷 인기 브랜드 상설 허브 (사장님 2026-11-18 「단기 종료 공구를 억지로 색인시키지 말고 인기 브랜드 상설 페이지를 1위용으로」)
#   검색량 1순위·건수 2순위 상위 $HubTopN 개 브랜드 페이지(/g/, 주소 그대로) 맨 위에 ① 진행 횟수·평균 간격 ② 지난 공구 기록 표 ③ 「다음 공구 오픈 알림 받기」 를 넣는다.
#   가격대 칸은 없다 — 공구 가격을 수집하지 않는다(지어내지 않는다). 기록이 3회 미만인 브랜드는 넣지 않는다(얇은 표를 만들지 않는다)
#   되돌리기: $HubTopN = 0
$HubTopN = 300
#   고르는 법: 검색량 큰 순(같으면 건수 순)으로 내려가며 「서로 다른 오픈일 3회 이상」인 브랜드만 $HubTopN 개까지. 브랜드가 아닌 흔한 낱말(검색량 표에 섞여 있다)은 뺀다
$HubTop = @{}
$HubSkip = @('오일','가성비','자전거','대구','부산','스마트','멀티','리얼','코끼리')
foreach($t in ($brandList | Sort-Object @{e={VolOf $_.brand};Descending=$true}, @{e={[int]$_.cnt};Descending=$true}, @{e='brand';Descending=$false})){
  if($HubTop.Count -ge $HubTopN){ break }
  if([int]$t.cnt -lt 3 -or $HubSkip -contains "$($t.brand)"){ continue }
  $hd0 = @(ParseRows $t.raw @('who','name','od','ed','insta') | Where-Object { "$($_.od)".Length -ge 10 -and "$($_.od)".Substring(0,10) -le $today } | ForEach-Object { "$($_.od)".Substring(0,10) } | Sort-Object -Unique)
  if($hd0.Count -ge 3){ $HubTop[$t.slug] = 1 }
}
Write-Output "인기 브랜드 상설 허브: $($HubTop.Count)개"

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
    # nk = 같은 상품의 다른 회차를 묶는 키(공백·N차·앵콜을 뗀 소문자 이름)
    $o2 = [pscustomobject]@{ slug=$slug; brand=$b.brand; who=$r.who; name=$r.name; od=$r.od; ed=$r.ed; insta=$r.insta; nk=([regex]::Replace("$($r.name)".ToLower(), '\s+|\d+\s*차|앵콜', '')) }
    [void]$ggRows.Add($o2)
    if(-not $GgByBrand.ContainsKey($b.brand)){ $GgByBrand[$b.brand] = New-Object System.Collections.ArrayList }
    [void]$GgByBrand[$b.brand].Add($o2)
  }
}
Write-Output "공구 건별 상세 대상: $($ggRows.Count)건"
# 브랜드별 회차를 최근순으로 한 번만 정렬해 둔다(건별 페이지마다 다시 정렬하지 않게)
$GgSorted = @{}
foreach($bk in @($GgByBrand.Keys)){ $GgSorted[$bk] = @($GgByBrand[$bk] | Sort-Object @{e='od';Descending=$true}, @{e='slug';Descending=$false}) }
# 보존 gg 페이지(오늘 집계에 없는 옛 페이지)의 마감일 — 파일 머리의 「오픈 ~ 마감」에서 읽는다. 계층을 정하고 사이트맵 수를 미리 센다
$ggToday = @{}; foreach($x in $ggRows){ $ggToday[("$($x.slug).html").ToLower()] = 1 }
$KeptGgEd = @{}; $keptGgUnknown = 0
$rxGgHead = [regex]'<h1>[^<]*</h1><p>(\d{4}-\d{2}-\d{2}) ~ (\d{4}-\d{2}-\d{2})'
foreach($fp in [IO.Directory]::EnumerateFiles((Join-Path $Root 'gg'), '*.html')){
  $fn = [IO.Path]::GetFileName($fp)
  if($ggToday.ContainsKey($fn.ToLower())){ continue }
  $hd = [IO.File]::ReadAllText($fp)   # 머리띠(h1)는 CSS·JSON-LD 뒤 7~8KB 쯤에 있어 파일을 통째로 읽는다
  if($hd.IndexOf('http-equiv="refresh"', [StringComparison]::Ordinal) -ge 0){ continue }   # 툼스톤
  $mh = $rxGgHead.Match($hd)
  if($mh.Success){ $KeptGgEd[$fn] = $mh.Groups[2].Value } else { $keptGgUnknown++ }
}
# 사이트맵에 남을 gg 수(오늘 집계 A·B + 보존분 중 최근 마감)가 상한을 넘으면 B 창을 스스로 줄인다(30 → 25 → 21 → 14 → 10 → 7)
#   · 흔들림 방지: 어제 쓴 창(tools/seo/gg_window.txt)보다 넓히는 것은 상한보다 800 건 넘게 여유가 있을 때만 — 경계에 걸린 1천여 장이 하루는 index, 다음 날은 noindex 로 오가지 않게
#   · 되돌리기(-GgKeepDays 365)는 이 자동 조정을 건너뛴다. 그때는 verify.ps1 의 13,000 가드도 같이 풀어야 커밋된다
# 2026-11-19 (사장님 「고쳐」 — 서치콘솔 「NOINDEX 태그에 의해 제외」 메일): 최근 90일 구글 노출이 있던 gg 페이지는 장기 마감이어도 C(noindex)로 보내지 않는다.
#   명단은 seo-daily.yml 이 빌드 전에 tools/seo/gg_keep_index.mjs 로 갱신한다(실패하면 어제 명단 그대로). GgTier(lib.ps1)와 아래 보존 gg 계층이 같이 본다.
$GgKeepIdx = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$ggKeepFile = Join-Path $PSScriptRoot 'gg_keep_index.txt'
if(Test-Path $ggKeepFile){ foreach($ln in [IO.File]::ReadAllLines($ggKeepFile)){ $ln = $ln.Trim(); if($ln -and -not $ln.StartsWith('#')){ [void]$GgKeepIdx.Add($ln) } } }
Write-Output "gg 색인 지킴 명단(구글 노출 16개월): $($GgKeepIdx.Count)장"
# ── p(제품) 색인 계층 (2026-11-23 ORDER_TEST_BLOCK_AND_SEO_TOP3 §4) — gg 와 같은 원칙, 대상만 p/ ──
$PKeepIdx = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$pKeepFile = Join-Path $PSScriptRoot 'p_keep_index.txt'
if(Test-Path $pKeepFile){ foreach($ln in [IO.File]::ReadAllLines($pKeepFile)){ $ln = $ln.Trim(); if($ln -and -not $ln.StartsWith('#')){ [void]$PKeepIdx.Add($ln) } } }
$pCut = ([DateTime]::ParseExact($today,'yyyy-MM-dd',$null)).AddDays(-90).ToString('yyyy-MM-dd')
Write-Output "p 색인 지킴 명단(구글 노출 90일): $($PKeepIdx.Count)장 · 휴면 기준 $pCut"
# K = 색인 유지 / N = 휴면(noindex,follow + 사이트맵 제외, 페이지는 200 유지)
#   K 조건: 지금·곧 열리는 공구가 있다 OR 마지막 공구가 90일 안이다 OR 최근 90일 구글 노출이 있다
function PIndexTier($p, $live, $soon, [string]$cut){
  if($live.Count -gt 0 -or $soon.Count -gt 0){ return 'K' }
  if(-not "$($p.last)"){ return 'K' }          # 마지막 공구 날짜를 모르면 내리지 않는다(추정 금지)
  if("$($p.last)" -ge $cut){ return 'K' }
  if($PKeepIdx -and $PKeepIdx.Contains("$($p.slug).html")){ return 'K' }
  return 'N'
}
# ── g(브랜드) 색인 계층 (2026-11-25 사장님 승인 「니가다하고 8월 구글 검색으로 돌려놔」 — scratchpad/handoff-log/seo_recover_2026-11-25.md) ──
#   왜: 사이트맵 2만 8천 장 중 약 80% 가 16개월 동안 구글 노출이 한 번도 없었고, g 의 63% 가 공구 기록 1건짜리 같은 틀 페이지였다.
#       구글이 사이트 전체를 낮게 본 가장 유력한 원인이라 얇은 g 를 색인에서 뺀다(페이지는 200 유지, 지우지 않는다).
#   N(noindex,follow + 사이트맵 제외) = 공구 기록 1건 이하 AND 진행·예정 공구 없음 AND 16개월 구글 노출 0 AND 네이버 검색량 0
#   K(그대로) = 그 밖 전부. 지킴 명단(g_keep_index.txt, 16개월 노출)이 없거나 500줄 미만이면 아무것도 내리지 않는다(API 이상 때 노출 있던 페이지를 내리는 11-19 사고 방지)
#   내린 목록은 날마다 tools/seo/g_noindex.txt 에 쓴다(되돌리기·비교용). 되돌리기: 빌드에 -GTier off 를 주거나 g_keep_index.txt 를 비우면 다음 빌드에서 전부 index 로 돌아온다
$GKeepIdx = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$gKeepFile = Join-Path $PSScriptRoot 'g_keep_index.txt'
if(Test-Path $gKeepFile){ foreach($ln in [IO.File]::ReadAllLines($gKeepFile)){ $ln = $ln.Trim(); if($ln -and -not $ln.StartsWith('#')){ [void]$GKeepIdx.Add($ln) } } }
$GTierOn = ($GTier -ne 'off') -and ($GKeepIdx.Count -ge 500)
Write-Output "g 색인 지킴 명단(구글 노출 16개월): $($GKeepIdx.Count)장 · g 계층 $(if($GTierOn){'켬'}else{'꺼짐(명단 부족 또는 -GTier off)'})"
function GIndexTier($b, $rows, $live, $soon){
  if(-not $GTierOn){ return 'K' }
  if($live.Count -gt 0 -or $soon.Count -gt 0){ return 'K' }
  if(@($rows).Count -ge 2 -or [int]$b.cnt -ge 2){ return 'K' }   # DB 건수와 파싱된 행 중 하나라도 2건 이상이면 지킨다
  if($GKeepIdx.Contains("$($b.slug).html")){ return 'K' }
  if((VolOf "$($b.brand)") -gt 0){ return 'K' }
  return 'N'
}
$gNoIdx = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$ggWinFile = Join-Path $PSScriptRoot 'gg_window.txt'
$prevDays = 0; try{ if(Test-Path $ggWinFile){ $prevDays = [int]([IO.File]::ReadAllText($ggWinFile).Trim()) } }catch{}
function GgKeepCount([int]$days){ $c0 = GgCutOf $days; return @($ggRows | Where-Object { (GgTier $_ $today $c0) -ne 'C' }).Count + @($KeptGgEd.Keys | Where-Object { $KeptGgEd[$_] -ge $c0 -or $GgKeepIdx.Contains($_) }).Count + $keptGgUnknown }
if($GgKeepDays -ge 365){ $nKeep = GgKeepCount $GG_KEEP_DAYS }
else {
  foreach($tryDays in @($GG_KEEP_DAYS, 25, 21, 14, 10, 7)){
    if($tryDays -gt $GG_KEEP_DAYS){ continue }
    $nKeep = GgKeepCount $tryDays
    $lim = $(if($prevDays -gt 0 -and $tryDays -gt $prevDays){ $GG_SITEMAP_MAX - 800 } else { $GG_SITEMAP_MAX })
    $GG_KEEP_DAYS = $tryDays; $ggCutoff = GgCutOf $tryDays
    if($nKeep -le $lim){ break }
  }
  [IO.File]::WriteAllText($ggWinFile, "$GG_KEEP_DAYS", [Text.UTF8Encoding]::new($false))
}
Write-Output "gg 색인 계층: 최근 마감 창 $GG_KEEP_DAYS 일(마감 $ggCutoff 이후) · 사이트맵 예정 $nKeep 건 · 보존 gg $($KeptGgEd.Count)건(날짜 못 읽음 $keptGgUnknown)"

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
  # 2026-11-16: 「지금 진행 중인 공구는 없습니다」 문장을 없앴다(검색 스니펫에 이 문장만 잡혔다) — 그 브랜드의 실제 날짜·셀러·주기로 말한다. 이력이 2회 미만이면 주기는 쓰지 않는다
  $cycB = CycleOf (@($rows | ForEach-Object { $_.od })) $today
  $pastTop = $(if($past.Count -gt 0){ @($past | Sort-Object @{e='od';Descending=$true})[0] } else { $null })
  $soonTop = $(if($soon.Count -gt 0){ @($soon | Sort-Object @{e='od';Descending=$false})[0] } else { $null })
  if($live.Count -gt 0){ $lead += " 지금 진행 중인 공구는 맨 위에 있습니다." }
  elseif($soonTop){ $lead += " 지금 열려 있는 건은 없고, 가장 가까운 일정은 $($soonTop.od) 오픈하는 $($soonTop.name)$(if($soonTop.who){ "($($soonTop.who))" })입니다." }
  else {
    $lead += " $($b.brand) 공구는 지금 열려 있는 건이 없습니다."
    if($pastTop){ $lead += " 가장 최근 공구는 $($pastTop.od)에 $(if($pastTop.who){ "$($pastTop.who) 셀러가" } else { '셀러가' }) 열었습니다." }
    if($cycB){ $lead += " 이 브랜드 공구는 맘캘린더 기록 기준 서로 다른 날짜로 $($cycB.n)회 열렸고, 보통 $($cycB.label) 간격입니다." }
  }

  $body = "<div class=${Q}sec${Q}><p>$(HtmlEsc $lead)</p></div>"
  # 🏷 인기 브랜드 상설 허브 — 맨 위: 진행 횟수·평균 간격 → 알림 받기 → 지난 공구 기록 표
  $hubShown = $false; $hubFaq = @()
  if($HubTop.ContainsKey($b.slug)){
    $hRows = @($rows | Where-Object { "$($_.od)".Length -ge 10 -and "$($_.ed)".Length -ge 10 } | Sort-Object @{e='od';Descending=$true}, @{e='name';Descending=$false})
    $hOds = @($hRows | ForEach-Object { "$($_.od)".Substring(0,10) } | Where-Object { $_ -le $today } | Sort-Object -Unique)
    $hN = $hOds.Count
    if($hN -ge 3){
      $hAvg = 0
      try{ $hAvg = [int][Math]::Round((([DateTime]::ParseExact($hOds[$hN-1],'yyyy-MM-dd',$null) - [DateTime]::ParseExact($hOds[0],'yyyy-MM-dd',$null)).TotalDays) / ($hN - 1)) }catch{}
      if($hAvg -lt 1){ $hAvg = 1 }
      $hWho = @($hRows | Where-Object { $_.who } | ForEach-Object { "$($_.who)" } | Sort-Object -Unique)
      $hubShown = $true
      $body += "<div class=${Q}sec${Q}><h2>$(HtmlEsc $b.brand) 공구 주기와 진행 횟수</h2><div class=${Q}stat${Q}>"
      $body += "<div><b>$($hN)회</b>진행 횟수</div><div><b>약 $($hAvg)일</b>평균 간격</div><div><b>$($hOds[$hN-1])</b>최근 오픈</div>"
      # 진행 셀러 수는 싣지 않는다 — 벤더용 영업 정보(판매 자산)다. 브랜드 한 곳의 횟수·간격·기록 표만 공개 (사장님 2026-11-19)
      $body += "</div><p class=${Q}asof${Q}>맘캘린더 기록 $($hOds[0]) ~ $($hOds[$hN-1]) 기준 · 서로 다른 오픈일을 1회로 셉니다 · 기준일 $today</p>"
      $body += "<a class=${Q}cta${Q} href=${Q}/?kwadd=$(Enc $b.brand)${Q}>$(HtmlEsc $b.brand) 다음 공구 오픈 알림 받기</a></div>"
      $body += "<div class=${Q}sec${Q}><h2>$(HtmlEsc $b.brand) 지난 공구 기록</h2><div class=${Q}tblw${Q}><table class=${Q}hist${Q}><thead><tr><th>오픈 ~ 마감</th><th>상품명</th><th>진행 셀러</th></tr></thead><tbody>"
      $hShow = @($hRows | Select-Object -First 30)
      foreach($hr in $hShow){
        $hTag = $(if("$($hr.od)" -gt $today){ '<br><i>예정</i>' } elseif("$($hr.ed)" -ge $today){ '<br><i>진행 중</i>' } else { '' })
        $hSel = $(if($hr.who -and $hr.insta){ "<a href=${Q}https://www.instagram.com/$($hr.insta)${Q} rel=${Q}nofollow noopener${Q}>$(HtmlEsc $hr.who)</a>" } elseif($hr.who){ HtmlEsc "$($hr.who)" } else { '-' })
        $body += "<tr><td>$("$($hr.od)".Substring(2).Replace('-','.')) ~ $("$($hr.ed)".Substring(5).Replace('-','.'))$hTag</td><td>$(HtmlEsc $hr.name)</td><td>$hSel</td></tr>"
      }
      $body += "</tbody></table></div>"
      if($hRows.Count -gt $hShow.Count){ $body += "<p class=${Q}asof${Q}>최근 $($hShow.Count)건을 실었습니다. 전체 기록은 $($hRows.Count)건입니다.</p>" }
      $body += '</div>'
      $hubFaq += @{ q="$($b.brand) 공구는 얼마나 자주 열리나요?"; a="맘캘린더 기록 기준 $($b.brand) 공구는 $($hOds[0])부터 $($hOds[$hN-1])까지 서로 다른 날짜로 $($hN)회 열렸고, 평균 약 $($hAvg)일 간격입니다. 셀러 일정에 따라 달라질 수 있습니다." }
      $hubFaq += @{ q="$($b.brand) 다음 공구 알림은 어떻게 받나요?"; a="이 페이지의 「$($b.brand) 다음 공구 오픈 알림 받기」를 누르면 맘캘린더 키워드 알림 화면이 열립니다. 「$($b.brand)」를 등록해 두면 새 공구가 올라왔을 때 맘캘린더 알림함에서 알려 드립니다." }
    }
  }
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
      # ① 이 브랜드에서 자주 열린 제품 3개 + 각 제품의 최근 오픈일 (2026-11-16)
      $p3 = @($ps | Where-Object { $_.last } | Select-Object -First 3)
      if($p3.Count -gt 0){
        $body += "<div class=${Q}sec${Q}><h2>$(HtmlEsc $b.brand) 공구에서 자주 열린 제품</h2>"
        foreach($q3 in $p3){ $body += "<a class=${Q}card${Q} href=${Q}/p/$(Enc $q3.slug).html${Q}><b>$(HtmlEsc $q3.key)</b><span>$(if("$($q3.last)" -gt $today){ '오픈 예정' } else { '최근 오픈' }) $($q3.last)$(if($q3.first -and "$($q3.first)" -ne "$($q3.last)"){ " · 첫 기록 $($q3.first)" })</span></a>" }
        $body += '</div>'
      }
    }
  }
  if($past.Count -gt 0 -and -not $hubShown){   # 허브 브랜드는 위의 기록 표가 같은 내용이다
    $body += "<div class=${Q}sec${Q}><h2>지난 $(HtmlEsc $b.brand) 공구</h2>" + (CardsHtml $past 40 $false $true) + '</div>'
  }
  # 건별 상세 페이지로 가는 크롤 경로 (최근 일정 8건) — 장기 마감(C 계층)으로는 링크하지 않는다(크롤 예산이 그쪽으로 샌다)
  if($GgSorted.ContainsKey($b.brand)){
    $gl = @($GgSorted[$b.brand] | Where-Object { (GgTier $_ $today $ggCutoff) -ne 'C' } | Select-Object -First 8)
    if($gl.Count -gt 0){
      $body += "<div class=${Q}sec${Q}><h2>$(HtmlEsc $b.brand) 공구 일정 상세</h2><div class=${Q}rel${Q}>"
      foreach($x2 in $gl){ $body += "<a href=${Q}/gg/$(Enc $x2.slug).html${Q}>$(HtmlEsc $x2.name) ($($x2.od.Substring(5).Replace('-','/')))</a>" }
      $body += '</div></div>'
    }
  }
  # ③ 연관 핫딜 3건 — 이 브랜드 이름이 든 딜 먼저, 모자라면 같은 분야 ("세이펜 공구 핫딜" 류 검색 수요)
  $rd = @(RelDeals "$($b.brand)" "$($b.major)" "$($b.slug)")
  if($rd.Count -gt 0){
    $rdOwn = $RelOwn
    $body += (RelDealsHtml $rd $(if($rdOwn){ "지금 노출 중인 $($b.brand) 핫딜" } else { "$($b.major) 분야 지금 노출 중인 핫딜" }))
  }
  # ④ 공구 이력·재공구 주기 + ⑤ 질문 더하기
  $moreFaq = @()
  if($cycB){
    $hist = "맘캘린더 기록으로 $($b.brand) 공구는 $($cycB.first)부터 $($cycB.last)까지 서로 다른 날짜로 $($cycB.n)회 열렸습니다. 오픈일 사이 간격의 중간값은 $($cycB.days)일로, 보통 $($cycB.label) 간격으로 다시 열렸습니다."
    if($soonTop){ $hist += " 다음 일정은 $($soonTop.od) 오픈입니다." }
    if(-not $hubShown){ $body += "<div class=${Q}sec${Q}><h2>$(HtmlEsc $b.brand) 공구 이력과 재공구 주기</h2><p>$(HtmlEsc $hist)</p></div>" }
    $moreFaq += @{ q="$($b.brand) 공구는 얼마 만에 다시 열리나요?"; a="맘캘린더 기록 기준 $($b.brand) 공구는 서로 다른 날짜로 $($cycB.n)회 열렸고 오픈 간격의 중간값은 $($cycB.days)일($($cycB.label))입니다. 가장 최근 오픈은 $($cycB.last)입니다. 셀러마다 일정이 달라 다음 날짜는 셀러 공지로 확정됩니다." }
  }
  if($soon.Count -eq 0 -and $live.Count -eq 0){
    $moreFaq += @{ q="$($b.brand) 다음 공구 언제예요?"; a="지금 등록된 다음 일정은 없습니다.$(if($pastTop){ " 가장 최근 공구는 $($pastTop.od) 오픈$(if($pastTop.who){ "($($pastTop.who))" })이었습니다." })$(if($cycB){ " 보통 $($cycB.label) 간격으로 다시 열렸습니다." }) 새 일정이 등록되면 이 페이지 맨 위에 표시됩니다." }
  }
  $moreFaq = @($hubFaq) + @($moreFaq)
  $ex = ExtraBody $b.brand '브랜드' $live $soon $past $tp $moreFaq
  $body += $ex.html
  # 2026-11-25 본문 보강(scratchpad/designs/2026-11-25_SEO_s_g_본문보강.md): 이 브랜드 카드에 나온 셀러의 셀러 페이지 링크 — 전 페이지 공통 「다른 브랜드」 링크(반복 18%) 말고 이 브랜드만의 내부링크.
  #   숫자는 쓰지 않는다(집계 공개 금지 원칙). 순서는 이름순 고정 — 날마다 바뀌는 기준(진행 중 우선 등)을 쓰면 본문이 매일 바뀌어 lastmod=오늘 사고가 재발한다(금붕어 검토 1번)
  #   insta → $SellerSlug(gg 상세의 「셀러의 다른 공구」 링크와 같은 표)로만 잇는다. 한글명으로 잇지 않는다(동명이인)
  $bSel = @{}
  foreach($r in $rows){ if($r.insta -and $SellerSlug.ContainsKey("$($r.insta)") -and -not $bSel.ContainsKey("$($r.insta)")){ $bSel["$($r.insta)"] = $(if($r.who){ "$($r.who)" } else { "$($r.insta)" }) } }
  if($bSel.Count -gt 0){
    $body += "<div class=${Q}sec${Q}><h2>$(HtmlEsc $b.brand) 공구를 연 셀러</h2><div class=${Q}rel${Q}>"
    foreach($ik in @($bSel.Keys | Sort-Object @{e={ $bSel[$_] }}, @{e={ $_ }} | Select-Object -First 12)){ $body += "<a href=${Q}/s/$(Enc $SellerSlug[$ik]).html${Q}>$(HtmlEsc $bSel[$ik]) 공구 일정</a>" }
    $body += '</div></div>'
  }
  $body += "<div class=${Q}sec${Q}><h2>다른 브랜드 공구</h2><div class=${Q}rel${Q}>"
  foreach($t in $topBrands){ if($t.slug -ne $b.slug){ $body += "<a href=${Q}/g/$(Enc $t.slug).html${Q}>$(HtmlEsc $t.brand) 공구</a>" } }
  $body += '</div></div>'

  $ld = New-Object System.Collections.ArrayList
  $l1 = LdItemList "$($b.brand) 공구 일정" ($live + $past) 25
  if($l1){ [void]$ld.Add($l1) }
  $lf = LdFaq $ex.faq
  if($lf){ [void]$ld.Add($lf) }
  [void]$ld.Add((LdCrumb "$($b.brand) 공구" $canon))
  # Event — 진행 중이거나 가장 가까운 예정 1건만(끝난 공구는 마크업하지 않는다). 가격·offers 없음
  $evRow = $(if($live.Count -gt 0){ $live[0] } elseif($soonTop){ $soonTop } else { $null })
  if($evRow){ $le = LdEvent $evRow $canon "$($b.brand)"; if($le){ [void]$ld.Add($le) } }
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
  $gIdxTier = GIndexTier $b $rows $live $soon   # $gTier 는 param $GTier 와 같은 변수(대소문자 무시)라 이름을 달리한다
  if($gIdxTier -eq 'N'){ [void]$gNoIdx.Add("$($b.slug).html") }   # 사이트맵(brand)이 이 표를 본다
  WritePage @{ path=(Join-Path $Root "g/$($b.slug).html"); title=$title; desc=$desc; canon=$canon;
    robots=$(if($gIdxTier -eq 'N'){ $ROBOTS_NOINDEX } else { '' });
    h1="$($b.brand) 공구"; sub="인스타 공동구매 일정"; body=$body; jsonld=$ld; bcName="$($b.brand) 공구"; facts=$facts
    # ② /?q= 는 사이트 검색 딥링크다(알림이 켜지는 길이 아니다 — 2026-11-16 확인). 그래서 「알림」이 아니라 「찾아보기」라고 쓴다
    cta="/?q=$(Enc "$($b.brand)")"; ctaText="지금 「$($b.brand)」 공구 찾아보기 →" }
}

# ══ 브랜드 × 제품 페이지 ══
$pNoIdx = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)   # 2026-11-23 ORDER §4: 휴면 p(noindex) — 사이트맵·공구제품 허브가 이 표를 본다
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
  else {
    $lead += " $($p.key) 공구는 지금 열려 있는 건이 없습니다."
    $pt = $(if($past.Count -gt 0){ @($past | Sort-Object @{e='od';Descending=$true})[0] } else { $null })
    if($pt){ $lead += " 가장 최근 공구는 $($pt.od)에 $(if($pt.who){ "$($pt.who) 셀러가" } else { '셀러가' }) 열었습니다." }
    $cy = CycleOf (@($rows | ForEach-Object { $_.od })) $today
    if($cy){ $lead += " 맘캘린더 기록 기준 서로 다른 날짜로 $($cy.n)회 열렸고, 보통 $($cy.label) 간격입니다." }
  }

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
  $pTier = PIndexTier $p $live $soon $pCut
  if($pTier -eq 'N'){ [void]$pNoIdx.Add("$($p.slug).html") }   # 사이트맵(d)·공구제품 허브(4-4)가 이 표를 본다
  WritePage @{ path=(Join-Path $Root "p/$($p.slug).html"); title=$title; desc=$desc; canon=$canon;
    robots=$(if($pTier -eq 'N'){ $ROBOTS_NOINDEX } else { '' });
    h1="$($p.key) 공구"; sub="인스타 공동구매 일정"; body=$body; jsonld=$ld; bcName="$($p.key) 공구" }
}

# ══ 공구 건별 상세 페이지 (gg/) ══
# 2026-11-16 (ORDER_SEO_AEO_GEO_RECOVERY §4·§5·§7): 계층(A·B·C) + 다섯 블록(① 요약 ② 찾아보기 ③ 연관 핫딜 ④ 이력·주기 ⑤ 질문 6~8개) + Event(A 만)
#   블록은 전부 데이터에서만 만든다 — 데이터가 없으면 그 블록을 뺀다(문장으로 분량을 채우지 않는다). 공구 금액·깎아 준 폭은 쓰지 않는다(수집하지 않는 값)
$brandMajor = @{}; foreach($b in $brandList){ $brandMajor["$($b.brand)"] = "$($b.major)" }
$ggTierN = @{ A=0; B=0; C=0 }
foreach($x in $ggRows){
  $tier = GgTier $x $today $ggCutoff
  $ggTierN[$tier] = [int]$ggTierN[$tier] + 1
  $isLive = ($x.od -le $today -and $x.ed -ge $today)
  $isSoon = ($x.od -gt $today)
  $odK = $x.od.Substring(5).Replace('-','/'); $edK = $x.ed.Substring(5).Replace('-','/')
  $whoTxt = ''; if($x.who){ $whoTxt = "$($x.who) " }

  # 오픈일을 제목에 넣어 재공구 회차끼리도 제목이 겹치지 않게 한다 (중복 title 회피)
  $title = "$($x.name) 공구 | $($whoTxt)인스타 공동구매 · $odK 오픈 - 맘캘린더"
  if($title.Length -gt 72){ $title = "$($x.name) 공구 일정 · $odK 오픈 - 맘캘린더" }
  $desc = "$($x.name) 공구 일정 — $($x.od) 오픈, $($x.ed) 마감. $($whoTxt)인스타그램 공동구매의 날짜와 참여 방법을 확인하세요."
  $canon = "gg/$(Enc $x.slug).html"

  # 같은 브랜드의 회차(최근순) · 같은 상품의 회차 · 재공구 주기(이력 2회 미만이면 쓰지 않는다)
  $bro = @(); if($GgSorted.ContainsKey($x.brand)){ $bro = @($GgSorted[$x.brand]) }
  $others = @($bro | Where-Object { $_.slug -ne $x.slug })
  $othersPast = @($others | Where-Object { $_.od -le $today })   # 이미 열린 회차만(이력·「있었습니다」 문장용 — 예정 건은 「다음 공구」로 따로 말한다)
  $same = @($bro | Where-Object { $_.nk -eq $x.nk })
  $cyc = CycleOf (@($same | ForEach-Object { $_.od })) $today; $cycSame = $true
  if(-not $cyc){ $cyc = CycleOf (@($bro | ForEach-Object { $_.od })) $today; $cycSame = $false }
  $cycTxt = ''
  if($cyc){ $cycTxt = "$(if($cycSame){ '같은 상품은' } else { "$($x.brand) 공구는" }) 맘캘린더 기록 기준 보통 $($cyc.label) 간격으로 다시 열렸습니다(오픈 간격 중간값 $($cyc.days)일)." }
  $nextB = @($others | Where-Object { $_.od -gt $today } | Sort-Object @{e='od';Descending=$false} | Select-Object -First 1)
  $nextTxt = ''
  if($nextB.Count -gt 0){ $nextTxt = "다음 $($x.brand) 공구는 $($nextB[0].od) 오픈 예정인 $($nextB[0].name)$(if($nextB[0].who){ "($($nextB[0].who))" })입니다." }

  if($isLive){ $lead = "$($x.name) 공동구매가 지금 진행 중입니다. $odK 에 열렸고 $edK 마감입니다. 아래 카드를 누르면 진행 셀러의 인스타그램으로 이동합니다." }
  elseif($isSoon){ $lead = "$($x.name) 공동구매는 $odK 오픈 예정입니다. 마감은 $edK 입니다. 오픈일에 셀러 계정 공지로 신청할 수 있습니다." }
  else {
    $lead = "$($x.name) 공구는 $($x.od) ~ $($x.ed)에 $(if($x.who){ "$($x.who) 셀러가 " })진행한 일정입니다."
    if($cycTxt){ $lead += " $cycTxt" }
    if($nextTxt){ $lead += " $nextTxt" } else { $lead += " 다음 회차가 등록되면 $($x.brand) 브랜드 페이지에 표시됩니다." }
  }

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
      # ① 이 공구 요약 — 상품명에서 브랜드를 뗀 제품어 + 셀러 공지의 첫 대목 2~3문장(공지가 없으면 이 블록은 없다)
      $rest = "$($x.name)"; if($rest.ToLower().StartsWith("$($x.brand)".ToLower())){ $rest = $rest.Substring("$($x.brand)".Length) }
      $rest = ([regex]::Replace($rest, '^[\s·,&/\-\+\(\)\[\]]+', '')).Trim()
      $sents = @([regex]::Split($cap, '[\r\n]+|(?<=[.!?])\s+') | ForEach-Object { ([regex]::Replace("$_", '\s+', ' ')).Trim() } | Where-Object { $_.Length -ge 12 -and $_.Length -le 110 -and $_ -notmatch '[@#]|www\.' -and $_ -notmatch '[0-9][0-9,\.]*\s*(원|만원|천원|%|프로)|최저가|할인|특가|가격|세일|쿠폰|적립|포인트|증정|이벤트|페이' } | Select-Object -First 3)
      # 🔴 공지가 이 상품 글이 아닐 수 있다(월간 일정·이벤트 글이 같은 날 붙는다) → 공지 안에 이 브랜드 이름이 있을 때만 요약에 쓴다. 금액·최저가·이벤트 문장은 요약에 쓰지 않는다(공구 가격 금지)
      if($sents.Count -gt 0 -and $cap.IndexOf("$($x.brand)", [StringComparison]::OrdinalIgnoreCase) -ge 0){
        $sum = "$(if($x.who){ "$($x.who) 셀러가 " })$($x.od)에 $(if($isSoon){ '여는' } else { '연' }) $($x.brand)$(if($rest){ " $rest" }) 공동구매입니다. 셀러 공지의 첫 대목: " + (($sents | ForEach-Object { "「$_」" }) -join ' ')
        $body += "<div class=${Q}sec${Q}><h2>이 공구 요약</h2><p>$(HtmlEsc $sum)</p></div>"
      }
      # 2026-11-26: 원문 통째(최대 2000자) 대신 앞부분 발췌만 — 인스타에 이미 있는 글을 그대로 옮긴 대량 복사 본문이 8월 급감 원인 1순위(seo_recover_2026-11-25). 전체는 셀러 인스타로
      $capShow = $cap; $capCut = $false
      if($capShow.Length -gt $CapMax){ $cut0 = $capShow.LastIndexOf("`n", [Math]::Min($CapMax, $capShow.Length - 1)); if($cut0 -lt [int]($CapMax * 0.5)){ $cut0 = $CapMax }; $capShow = $capShow.Substring(0, $cut0).TrimEnd() + '…'; $capCut = $true }
      $capHtml = (HtmlEsc $capShow) -replace "`n",'<br>'
      $body += "<div class=${Q}sec${Q}><h2>셀러 공지</h2><div class=${Q}faq${Q}><span>$capHtml</span></div>"
      $igA = if($x.insta){ " <a href=${Q}https://www.instagram.com/$(HtmlEsc $x.insta)${Q} rel=${Q}nofollow noopener${Q} target=${Q}_blank${Q}>전체 공지는 셀러 인스타그램에서</a>" } else { '' }
      $body += "<p style=${Q}font-size:11px;color:#B5AFBD;margin-top:6px${Q}>진행 셀러$(if($x.who){ ' ' + (HtmlEsc $x.who) })가 인스타그램에 게시한 공지$(if($capCut){ '의 앞부분' })입니다.$(if($capCut){ $igA })</p></div>"
    }
  }

  # ④ 공구 이력 — 같은 브랜드의 다른 회차(이 건뿐이면 블록 없음). 여기 줄에는 링크를 걸지 않는다(링크는 아래 「관련 일정」에서 A·B 계층만)
  if($othersPast.Count -gt 0){
    $body += "<div class=${Q}sec${Q}><h2>$(HtmlEsc $x.brand) 공구 이력</h2>"
    foreach($o4 in @($othersPast | Select-Object -First 8)){ $body += "<div class=${Q}card${Q}><b>$(HtmlEsc $o4.name)</b><span>$(if($o4.who){ (HtmlEsc $o4.who) + ' · ' })$($o4.od) ~ $($o4.ed)</span></div>" }
    if($cycTxt){ $body += "<p style=${Q}margin-top:8px${Q}>$(HtmlEsc $cycTxt)</p>" }
    $body += '</div>'
  }

  # ③ 연관 핫딜 3건 (핫딜의 실가격 — 공구 가격이 아니다)
  $bmj = $(if($brandMajor.ContainsKey("$($x.brand)")){ $brandMajor["$($x.brand)"] } else { '' })
  $rd = @(RelDeals "$($x.brand)" $bmj "$($x.slug)")
  if($rd.Count -gt 0){
    $rdOwn = $RelOwn
    $body += (RelDealsHtml $rd $(if($rdOwn){ "지금 노출 중인 $($x.brand) 핫딜" } else { "$bmj 분야 지금 노출 중인 핫딜" }))
  }

  # ⑤ 질문 — 데이터가 있는 것만(언제·어디서·가격·셀러·다음 공구·재공구 주기·지난 일정)
  $faq = @()
  $faq += @{ q="$($x.name) 공구는 언제 하나요?"; a="이 일정은 $($x.od) 오픈, $($x.ed) 마감입니다. 기간이 지나면 정가로 돌아가므로 마감일 안에 신청해야 합니다." }
  $faq += @{ q="어디서 신청하나요?"; a=$(if($x.who){ "$($x.who) 셀러가 인스타그램 계정에서 진행합니다. 위 카드를 누르면 해당 계정으로 이동하고, 프로필 링크나 공지 게시물에서 신청할 수 있습니다." } else { "진행 셀러의 인스타그램 계정 공지에서 신청합니다. 위 카드를 누르면 이동합니다." }) }
  $faq += @{ q="$($x.name) 공구 가격은 얼마인가요?"; a="공구 가격은 오픈일에 셀러가 인스타그램 공지로 공개합니다. 구성에 따라 다를 수 있으니 셀러 계정에서 확인하세요." }
  if($x.who){ $faq += @{ q="$($x.name) 공구 셀러는 누구인가요?"; a="$($x.who)$(if($x.insta){ "(인스타그램 @$($x.insta))" }) 셀러가 $($x.od)에 $(if($isSoon){ '여는' } else { '연' }) 공구입니다.$(if($tier -ne 'C' -and $x.insta -and $SellerSlug.ContainsKey($x.insta)){ " 이 셀러의 다른 공구는 아래 「관련 일정」에서 볼 수 있습니다." })" } }
  $faq += @{ q="$($x.brand) 다음 공구는 언제인가요?"; a=$(if($isSoon){ "이 일정이 $($x.od) 오픈 예정입니다($($x.name)$(if($x.who){ ", $($x.who)" })).$(if($nextTxt){ " $nextTxt" })" } elseif($nextTxt){ $nextTxt } else { "지금 등록된 다음 $($x.brand) 공구 일정은 없습니다.$(if($cyc){ " $cycTxt" }) 새 일정이 등록되면 $($x.brand) 브랜드 페이지에 표시됩니다." }) }
  if($cyc){
    $ds4 = @($(if($cycSame){ $same } else { $bro }) | ForEach-Object { "$($_.od)" } | Where-Object { $_ -le $today } | Sort-Object -Unique -Descending | Select-Object -First 4)
    $faq += @{ q="$(if($cycSame){ "$($x.name)" } else { "$($x.brand)" }) 공구는 다시 열리나요?"; a="맘캘린더 기록으로 $(if($cycSame){ '이 상품은' } else { "$($x.brand) 공구는" }) 서로 다른 날짜로 $($cyc.n)회 열렸습니다(최근 오픈 $($ds4 -join ', ')). 오픈 간격의 중간값은 $($cyc.days)일($($cyc.label))입니다. 다음 날짜는 셀러 공지로 확정됩니다." }
  }
  if($othersPast.Count -gt 0){
    $faq += @{ q="지난 $($x.brand) 공구 일정도 볼 수 있나요?"; a="네. 이 페이지의 「$($x.brand) 공구 이력」과 $($x.brand) 브랜드 페이지에 날짜순으로 남아 있습니다. 최근에는 " + ((@($othersPast | Select-Object -First 3) | ForEach-Object { "$($_.od) $($_.name)" }) -join ', ') + " 일정이 있었습니다." }
  }
  $body += "<div class=${Q}sec${Q}><h2>자주 묻는 질문</h2>"
  foreach($f in $faq){ $body += "<div class=${Q}faq${Q}><b>$(HtmlEsc $f.q)</b><span>$(HtmlEsc $f.a)</span></div>" }
  $body += '</div>'

  # 관련 일정 — 장기 마감(C) 페이지로는 링크하지 않는다. C 페이지 자신은 브랜드 페이지 하나만 링크한다(막다른 페이지 방지 + 크롤 예산)
  $body += "<div class=${Q}sec${Q}><h2>관련 일정</h2><div class=${Q}rel${Q}>"
  if($brandSlug.ContainsKey($x.brand)){ $body += "<a href=${Q}/g/$(Enc $brandSlug[$x.brand]).html${Q}>$(HtmlEsc $x.brand) 전체 공구 일정</a>" }
  if($tier -ne 'C'){
    if($x.insta -and $SellerSlug.ContainsKey($x.insta)){ $body += "<a href=${Q}/s/$(Enc $SellerSlug[$x.insta]).html${Q}>$(HtmlEsc $x.who) 셀러의 다른 공구</a>" }
    foreach($o3 in @($others | Where-Object { (GgTier $_ $today $ggCutoff) -ne 'C' } | Select-Object -First 6)){
      $body += "<a href=${Q}/gg/$(Enc $o3.slug).html${Q}>$(HtmlEsc $o3.name) ($($o3.od.Substring(5).Replace('-','/')))</a>"
    }
  }
  $body += '</div></div>'

  $ld = New-Object System.Collections.ArrayList
  $lf = LdFaq @($faq | ForEach-Object { [pscustomobject]@{ q=$_.q; a=$_.a } })
  if($lf){ [void]$ld.Add($lf) }
  [void]$ld.Add((LdCrumb "$($x.name) 공구" $canon))
  # Event 는 진행 중·예정(A 계층)에만. 끝난 공구(B·C)는 WebPage + FAQPage + BreadcrumbList 만
  if($isLive -or $isSoon){ $le = LdEvent $item $canon "$($x.brand)"; if($le){ [void]$ld.Add($le) } }
  WritePage @{ path=(Join-Path $Root "gg/$($x.slug).html"); title=$title; desc=$desc; canon=$canon;
    h1="$($x.name) 공구"; sub="$($x.od) ~ $($x.ed)$(if($x.who){ ' · ' + $x.who })"; body=$body; jsonld=$ld; bcName="$($x.name) 공구"
    robots=$(if($tier -eq 'C'){ $ROBOTS_NOINDEX } else { '' })
    cta="/?q=$(Enc "$($x.brand)")"; ctaText="지금 「$($x.brand)」 공구 찾아보기 →" }
}
Write-Output "gg 계층: A(진행·예정) $($ggTierN.A) · B(최근 마감) $($ggTierN.B) · C(장기 마감, noindex) $($ggTierN.C)"

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
  else {
    $lead += " $($s.kor) 셀러가 지금 열어 둔 공구는 없습니다."
    $pt = $(if($past.Count -gt 0){ @($past | Sort-Object @{e='od';Descending=$true})[0] } else { $null })
    if($pt){ $lead += " 가장 최근 공구는 $($pt.od)에 연 $($pt.name)입니다." }
  }

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
  else {
    $lead += " $($m.minor) 공구는 지금 열려 있는 건이 없습니다."
    $pt = $(if($past.Count -gt 0){ @($past | Sort-Object @{e='od';Descending=$true})[0] } else { $null })
    if($pt){ $lead += " 가장 최근에는 $($pt.od)에 $($pt.name) 공구가 열렸습니다." }
  }

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
# __LIVE__ = 지금 진행 중인 공구 수(seo_dataset stat.live). 「오늘·지금」 제목에는 누적(__TOTAL__)이 아니라 이것을 쓴다 (2026-10-24 검증)
$fmtLive = $(if($D.stat.PSObject.Properties['live'] -and [int]$D.stat.live -gt 0){ '{0:N0}' -f [int]$D.stat.live } else { '' })
# 🔎 2026-10-27 AEO: 답 문장에 오늘 실제 데이터를 넣는다. AI 가 인용할 때 「맘캘린더에서 보세요」가 아니라
#   오늘 열린 공구·지금 공구 중인 셀러·곧 열리는 공구를 그대로 말하게 한다(사장님 「우리 정보로 답변하도록 촘촘히」)
$todayKo = $(try { $td = [datetime]::ParseExact("$today",'yyyy-MM-dd',$null); "$($td.Month)월 $($td.Day)일" } catch { "$today" })
$openToday = @($liveRows | Where-Object { "$($_.od)" -eq "$today" })
$pickOpen = @($(if($openToday.Count -ge 3){ $openToday } else { $liveRows }) | Select-Object -First 5)
$fmtOpenTop = (@($pickOpen | ForEach-Object { if($_.who){ "$($_.name)($($_.who))" } else { "$($_.name)" } }) -join ', ')
$liveSellerGroups = @($liveRows | Where-Object { $_.who } | Group-Object who | Sort-Object @{e={$_.Count};Descending=$true}, @{e='Name';Descending=$false})
$fmtLiveSellers = (@($liveSellerGroups | Select-Object -First 8 | ForEach-Object { $_.Name }) -join ', ')
function MonDay([string]$d){ if($d.Length -ge 10){ return "$([int]$d.Substring(5,2))/$([int]$d.Substring(8,2))" } return $d }
$fmtSoonTop = (@($soonRows | Select-Object -First 5 | ForEach-Object { if($_.who){ "$($_.name)($($_.who), $(MonDay "$($_.od)") 오픈)" } else { "$($_.name)($(MonDay "$($_.od)") 오픈)" } }) -join ', ')
if(-not $fmtOpenTop){ $fmtOpenTop = '오늘 열린 공구' }
if(-not $fmtLiveSellers){ $fmtLiveSellers = '여러 셀러' }
if(-not $fmtSoonTop){ $fmtSoonTop = '곧 열리는 공구' }
$top3 = ''; $saleLine = ''
# 2026-11-20: 「함께 보면 좋은 글」 한 칸 — 'slug' 또는 'c/육아공구|육아 공구 일정'(폴더/파일|표시 글자). 경로 마디마다 따로 인코딩한다(/ 를 %2F 로 만들면 깨진 링크)
function RelLink([string]$r){
  $pp = $r -split '\|', 2
  $path = (@($pp[0] -split '/') | ForEach-Object { Enc $_ }) -join '/'
  $lab = $(if($pp.Count -gt 1 -and $pp[1]){ $pp[1] } else { $pp[0] })
  return "<a href=${Q}/$path.html${Q}>$(HtmlEsc $lab)</a>"
}
function Sub3([string]$s){
  if($null -eq $s){ return '' }
  return $s.Replace('__TOTAL__',$fmtTotal).Replace('__SELLERS__',$fmtSellers).Replace('__BRANDS__',$fmtBrands).Replace('__LIVE__',$fmtLive).Replace('__TODAY__',$todayKo).Replace('__OPEN_TOP__',$fmtOpenTop).Replace('__LIVE_SELLERS__',$fmtLiveSellers).Replace('__SOON_TOP__',$fmtSoonTop)
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
    'liveseller' { if($liveSellerGroups.Count -gt 0){
                $h = "<div class=${Q}sec${Q}><h2>지금 공구 중인 셀러</h2>"
                foreach($g in @($liveSellerGroups | Select-Object -First 30)){
                  $sl = @($sellerMade | Where-Object { $_.kor -eq $g.Name } | Select-Object -First 1)
                  $nm = $(if($sl.Count){ "<a href=${Q}/s/$(Enc $sl[0].slug).html${Q}>$(HtmlEsc $g.Name)</a>" } else { HtmlEsc $g.Name })
                  $items = (@($g.Group | Select-Object -First 3 | ForEach-Object { "$(HtmlEsc $_.name)$(if("$($_.ed)".Length -ge 10){ ' (' + (MonDay "$($_.ed)") + ' 마감)' })" }) -join ' · ')
                  $h += "<div class=${Q}stp${Q}><b>$nm</b><span>$items</span></div>"
                }
                $h += '</div>' } }
    'cat'   { $h = "<div class=${Q}sec${Q}><h2>분야별 공구</h2><div class=${Q}rel${Q}>"
              foreach($c in $catMade){ $h += "<a href=${Q}/c/$(Enc $c).html${Q}>$(HtmlEsc ($c -replace '공구$','')) 공구</a>" }
              foreach($m in $topM){ $h += "<a href=${Q}/m/$(Enc $m.slug).html${Q}>$(HtmlEsc $m.minor) 공구</a>" }; $h += '</div></div>' }
    'month' { $h = "<div class=${Q}sec${Q}><h2>월별 공구 일정</h2><div class=${Q}rel${Q}>"
              foreach($m in $monthMade){ $h += "<a href=${Q}/d/$($m.slug).html${Q}>$($m.label) 공구 일정</a>" }; $h += '</div></div>' }
  }
  return $h
}


# ══ 허브 페이지 실데이터 목록 (사장님 지시 2026-11-18 「공통 설명문 위주면 구글이 중복 페이지로 본다 · 실제 목록 30건 이상을 정적 HTML 에」) ══
#   keywords.json 의 show 에 opentoday · endtoday · top20 · week · endsoon · newlive · bycat · hubseller 를 적으면 그 페이지 본문에
#   공구 건별 행(상품명 → /gg/ 상세 · 셀러 → /s/ · 기간 · 셀러 인스타)을 그린다. 전부 그날 집계($ggRows)에서만 만든다 — 문장으로 분량을 채우지 않는다.
#   · 한 페이지 안에서 같은 공구를 두 번 싣지 않는다($script:hubUsed) · 페이지마다 시작 자리를 달리해(seed) 허브끼리 목록이 같아지지 않게 한다
#   · show 에 허브 구간이 하나라도 있는 페이지는 행이 30건이 될 때까지 「진행 중인 공구」로 채운다(HubFill)
$hubSellerSlug = @{}; foreach($hsm in $sellerMade){ if(-not $hubSellerSlug.ContainsKey("$($hsm.kor)")){ $hubSellerSlug["$($hsm.kor)"] = "$($hsm.slug)" } }
$hubDay0 = [DateTime]::ParseExact("$today",'yyyy-MM-dd',$null)
$hubPlus2 = $hubDay0.AddDays(2).ToString('yyyy-MM-dd'); $hubPlus7 = $hubDay0.AddDays(7).ToString('yyyy-MM-dd'); $hubMinus3 = $hubDay0.AddDays(-3).ToString('yyyy-MM-dd')
#   · 셀러 칸이 빈 공구는 싣지 않는다(셀러 없으면 노출 제외)
$hubLive = @($ggRows | Where-Object { $_.who -and "$($_.od)" -le "$today" -and "$($_.ed)" -ge "$today" } | Sort-Object @{e='od';Descending=$true}, @{e='name';Descending=$false}, @{e='slug';Descending=$false})
$hubOpen = @($hubLive | Where-Object { "$($_.od)" -eq "$today" })
$hubEnd  = @($hubLive | Where-Object { "$($_.ed)" -eq "$today" } | Sort-Object @{e='name';Descending=$false}, @{e='slug';Descending=$false})
$hubEndSoon = @($hubLive | Where-Object { "$($_.ed)" -gt "$today" -and "$($_.ed)" -le $hubPlus2 } | Sort-Object @{e='ed';Descending=$false}, @{e='name';Descending=$false}, @{e='slug';Descending=$false})
$hubNew  = @($hubLive | Where-Object { "$($_.od)" -lt "$today" -and "$($_.od)" -ge $hubMinus3 })
$hubWeek = @($ggRows | Where-Object { $_.who -and "$($_.od)" -gt "$today" -and "$($_.od)" -le $hubPlus7 } | Sort-Object @{e='od';Descending=$false}, @{e='name';Descending=$false}, @{e='slug';Descending=$false})
$hubTop20 = @($brandList | Where-Object { @('가성비','인기','신상','특가','최저가','국내산','무료배송') -notcontains "$($_.brand)" } | Sort-Object @{e={VolOf $_.brand};Descending=$true}, @{e={[int]$_.cnt};Descending=$true}, @{e='slug';Descending=$false} | Select-Object -First 20)
Write-Output "허브 목록 재료: 오늘 오픈 $($hubOpen.Count) · 오늘 마감 $($hubEnd.Count) · 진행 중 $($hubLive.Count) · 7일 안 오픈 $($hubWeek.Count)"
# TOP 20 은 페이지마다 다른 기준으로 뽑는다(같은 20줄이 7장에 깔리면 그 구간이 통째로 중복이 된다 — 사장님 2026-11-18)
#   pop 검색 많은 순 · cnt 자주 열린 순 · live 진행 건수 순 · new 최근 오픈 순 · end 마감 빠른 순 · soon 오픈 빠른 순 · cat 분야별 대표
#   각 줄에 적는 공구도 그 기준에 맞는 한 건(곧 열리는 것 / 마감이 가장 빠른 것 / 가장 최근에 열린 것)
$HUB_NOT_BRAND = @('가성비','인기','신상','특가','최저가','국내산','무료배송')   # 꾸밈말이 브랜드로 잡힌 것 — 허브의 TOP 20·전체 목록에는 올리지 않는다(브랜드 페이지는 그대로)
$hubBrandObj = @{}; foreach($hb in $brandList){ if($HUB_NOT_BRAND -notcontains "$($hb.brand)"){ $hubBrandObj["$($hb.brand)"] = $hb } }
function HubBrandRank($rows, [scriptblock]$keyOf, [bool]$desc){
  # 브랜드마다 대표 공구 한 건(정렬 기준에서 맨 앞)을 고르고, 그 값으로 브랜드를 줄 세운다. 이력이 3번 이상인 브랜드를 먼저, 모자라면 나머지로 채운다
  $best = @{}
  foreach($r0 in $rows){
    $bk0 = "$($r0.brand)"; if(-not $hubBrandObj.ContainsKey($bk0)){ continue }
    $kv = & $keyOf $r0
    if(-not $best.ContainsKey($bk0)){ $best[$bk0] = $r0 }
    else { $cv = & $keyOf $best[$bk0]; if(($desc -and "$kv" -gt "$cv") -or (-not $desc -and "$kv" -lt "$cv")){ $best[$bk0] = $r0 } }
  }
  $all = @($best.Keys | ForEach-Object { [pscustomobject]@{ b=$hubBrandObj[$_]; g=$best[$_]; k=("" + (& $keyOf $best[$_])); big=$(if([int]$hubBrandObj[$_].cnt -ge 3){ 0 } else { 1 }) } })
  return @($all | Sort-Object @{e='big';Descending=$false}, @{e='k';Descending=$desc}, @{e={[int]$_.b.cnt};Descending=$true}, @{e={"$($_.b.slug)"};Descending=$false} | Select-Object -First 20)
}
function HubBrandLatest($brands){
  return @($brands | ForEach-Object { $g0 = $null; if($GgSorted.ContainsKey("$($_.brand)") -and $GgSorted["$($_.brand)"].Count -gt 0){ $g0 = $GgSorted["$($_.brand)"][0] }; [pscustomobject]@{ b=$_; g=$g0 } })
}
$hubSoonAll = @($ggRows | Where-Object { $_.who -and "$($_.od)" -gt "$today" })
$hubLiveCnt = @{}; foreach($r1 in $hubLive){ $hubLiveCnt["$($r1.brand)"] = [int]$hubLiveCnt["$($r1.brand)"] + 1 }
$hubCatTop = New-Object System.Collections.ArrayList
foreach($cg in @($brandList | Where-Object { $_.major -and $hubBrandObj.ContainsKey("$($_.brand)") } | Group-Object major | Sort-Object @{e={$_.Count};Descending=$true}, @{e='Name';Descending=$false} | Select-Object -First 10)){
  foreach($cb in @($cg.Group | Sort-Object @{e={VolOf $_.brand};Descending=$true}, @{e={[int]$_.cnt};Descending=$true}, @{e='slug';Descending=$false} | Select-Object -First 2)){ [void]$hubCatTop.Add($cb) }
}
$HUB_TOP = @{
  'top20'     = @{ h2='인기 공구 브랜드 TOP 20 (많이 찾는 순)'; p='사람들이 많이 검색하는 공구 브랜드 순서입니다. 브랜드마다 가장 최근 공구를 함께 적었습니다.'; rows=@(HubBrandLatest @($hubTop20 | Where-Object { $hubBrandObj.ContainsKey("$($_.brand)") })) }
  'top20cnt'  = @{ h2='자주 공구하는 브랜드 TOP 20 (공구가 자주 열린 순)'; p='공구가 자주 열리는 브랜드 순서입니다. 한 번 놓쳐도 다시 열릴 가능성이 높은 곳들입니다.'; rows=@(HubBrandLatest @($brandList | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='slug';Descending=$false} | Select-Object -First 20)) }
  'top20live' = @{ h2='지금 공구가 많은 브랜드 TOP 20 (진행 건수 순)'; p="$todayKo 기준으로 여러 셀러가 동시에 공구 중인 브랜드 순서입니다."; rows=@(HubBrandLatest @($brandList | Where-Object { $hubLiveCnt.ContainsKey("$($_.brand)") } | Sort-Object @{e={[int]$hubLiveCnt["$($_.brand)"]};Descending=$true}, @{e={[int]$_.cnt};Descending=$true}, @{e='slug';Descending=$false} | Select-Object -First 20)) }
  'top20new'  = @{ h2='새로 열린 공구 브랜드 TOP 20 (최근 오픈 순)'; p='가장 최근에 공구가 열린 브랜드 순서입니다. 브랜드마다 방금 열린 공구를 적었습니다.'; rows=@(HubBrandRank $hubLive { param($r) "$($r.od)" } $true) }
  'top20end'  = @{ h2='마감 임박 공동구매 브랜드 TOP 20 (마감 빠른 순)'; p='진행 중인 공동구매 가운데 마감이 가까운 브랜드 순서입니다. 브랜드마다 가장 먼저 닫히는 공구를 적었습니다.'; rows=@(HubBrandRank $hubLive { param($r) "$($r.ed)" } $false) }
  'top20soon' = @{ h2='곧 열리는 공구 브랜드 TOP 20 (오픈일 빠른 순)'; p='앞으로 공구 일정이 잡힌 브랜드를 오픈일이 가까운 순서로 적었습니다.'; rows=@(HubBrandRank $hubSoonAll { param($r) "$($r.od)" } $false) }
  'top20cat'  = @{ h2='분야별 인기 공동구매 브랜드 TOP 20'; p='공구가 많이 열리는 분야 10곳에서 많이 찾는 브랜드를 두 곳씩 골랐습니다.'; rows=@(HubBrandLatest @($hubCatTop | Select-Object -First 20)) }
}
# 「전체」 링크 구간 — TOP 20 아래에 그 기준의 브랜드(셀러)를 빠짐없이 싣는다. 페이지마다 기준이 달라 목록이 겹치지 않는다. 한 구간 최대 600개
$hubPlus7b = $hubDay0.AddDays(7).ToString('yyyy-MM-dd'); $hubMinus7 = $hubDay0.AddDays(-7).ToString('yyyy-MM-dd')
function HubBrandsOf($rows){
  $seenB = @{}; $outB = New-Object System.Collections.ArrayList
  foreach($r2 in $rows){ $bk2 = "$($r2.brand)"; if($bk2 -and -not $seenB.ContainsKey($bk2) -and $hubBrandObj.ContainsKey($bk2)){ $seenB[$bk2] = 1; [void]$outB.Add($hubBrandObj[$bk2]) } }
  return @($outB)
}
$HUB_ALL = @{
  'livebrands' = @{ h2='지금 공구 중인 브랜드 전체'; kind='g'; items=@(HubBrandsOf $hubLive | Sort-Object @{e={"$($_.brand)"};Descending=$false}, @{e={"$($_.slug)"};Descending=$false}) }
  'soonbrands' = @{ h2='오픈 예정 공구 브랜드 전체 (오픈일 빠른 순)'; kind='g'; items=@(HubBrandsOf @($hubSoonAll | Sort-Object @{e='od';Descending=$false}, @{e='name';Descending=$false}, @{e='slug';Descending=$false})) }
  'endbrands'  = @{ h2='이번 주 마감하는 공동구매 브랜드 전체 (마감 빠른 순)'; kind='g'; items=@(HubBrandsOf @($hubLive | Where-Object { "$($_.ed)" -le $hubPlus7b } | Sort-Object @{e='ed';Descending=$false}, @{e='name';Descending=$false}, @{e='slug';Descending=$false})) }
  'newbrands'  = @{ h2='최근 일주일 새 공구가 열린 브랜드 전체 (최근 오픈 순)'; kind='g'; items=@(HubBrandsOf @($hubLive | Where-Object { "$($_.od)" -ge $hubMinus7 })) }
  'livesellers'= @{ h2='지금 공구하는 셀러 전체'; kind='s'; items=@($hubLive | Group-Object who | Where-Object { $hubSellerSlug.ContainsKey("$($_.Name)") } | Sort-Object @{e={$_.Count};Descending=$true}, @{e='Name';Descending=$false} | ForEach-Object { [pscustomobject]@{ brand="$($_.Name)"; slug=$hubSellerSlug["$($_.Name)"] } }) }
}
function HubAllSection([string]$kind){
  $ha = $HUB_ALL[$kind]; $its = @($ha.items | Select-Object -First 600)
  if($its.Count -lt 5){ return '' }
  $hx = "<div class=${Q}sec${Q}><h2>$($ha.h2) ($(if(@($ha.items).Count -gt $its.Count){ "$(@($ha.items).Count)곳 중 $($its.Count)곳" } else { "$($its.Count)곳" }))</h2><div class=${Q}rel${Q}>"
  foreach($it in $its){ $hx += "<a href=${Q}/$($ha.kind)/$(Enc $it.slug).html${Q}>$(HtmlEsc $it.brand)$(if($ha.kind -eq 'g'){ ' 공구' })</a>" }
  return $hx + '</div></div>'
}
$HUB_KINDS = @('opentoday','endtoday','week','endsoon','newlive','bycat','hubseller') + @($HUB_TOP.Keys) + @($HUB_ALL.Keys)
$HUB_A = "style=${Q}color:#5B3A8C;text-decoration:none${Q}"
$script:hubUsed = @{}; $script:hubCount = 0; $script:hubItems = New-Object System.Collections.ArrayList
function HubReset(){ $script:hubUsed = @{}; $script:hubCount = 0; $script:hubItems = New-Object System.Collections.ArrayList }
function WeekDayKo([string]$ymd){ try { return '일월화수목금토'.Substring([int]([DateTime]::ParseExact($ymd,'yyyy-MM-dd',$null).DayOfWeek),1) } catch { return '' } }
# 공구 한 줄: 상품명(상세 페이지) / 셀러(셀러 페이지) · 기간 · 셀러 인스타
function HubRow($gx){
  $per = "$(MonDay "$($gx.od)") ~ $(MonDay "$($gx.ed)")"
  $whoH = ''
  if($gx.who){
    if($hubSellerSlug.ContainsKey("$($gx.who)")){ $whoH = "<a $HUB_A href=${Q}/s/$(Enc $hubSellerSlug["$($gx.who)"]).html${Q}>$(HtmlEsc $gx.who)</a> · " } else { $whoH = "$(HtmlEsc $gx.who) · " }
  }
  $igH = ''
  if($gx.insta){ $igH = " · <a $HUB_A href=${Q}https://www.instagram.com/$($gx.insta)${Q} rel=${Q}nofollow noopener${Q}>셀러 인스타</a>" }
  $script:hubUsed["$($gx.slug)"] = 1; $script:hubCount++
  [void]$script:hubItems.Add($gx)
  return "<div class=${Q}stp${Q}><b><a $HUB_A href=${Q}/gg/$(Enc $gx.slug).html${Q}>$(HtmlEsc $gx.name)</a></b><span>${whoH}기간 $per$igH</span></div>"
}
# 목록에서 아직 안 실린 것만, seed 만큼 돌려서 max 건
function HubPick($rows, [int]$max, [int]$seed){
  $arr = @($rows | Where-Object { -not $script:hubUsed.ContainsKey("$($_.slug)") })
  if($arr.Count -gt $max -and $seed -gt 0){
    $st = ($seed * $max) % $arr.Count   # 회전 폭 = 뽑는 수 — 이웃 허브(seed 가 1 차이)가 같은 목록을 내지 않게
    if($st -gt 0){ $arr = @($arr[$st..($arr.Count - 1)]) + @($arr[0..($st - 1)]) }
  }
  return @($arr | Select-Object -First $max)
}
function HubSection([string]$kind, [int]$seed){
  $hh = ''
  if($HUB_ALL.ContainsKey($kind)){ return (HubAllSection $kind) }
  if($HUB_TOP.ContainsKey($kind)){
    $tp = $HUB_TOP[$kind]; $trs = @($tp.rows | Where-Object { $_ -and $_.b })
    if($trs.Count -lt 10){ $tp = $HUB_TOP['top20']; $trs = @($tp.rows | Where-Object { $_ -and $_.b }) }   # 재료가 모자란 날은 기본(많이 찾는 순)으로
    if($trs.Count -eq 0){ return '' }
    $hh = "<div class=${Q}sec${Q}><h2>$($tp.h2)</h2><p>$(HtmlEsc $tp.p)</p>"
    $rk = 0
    foreach($tr in $trs){
      $rk++; $tb = $tr.b; $lg = $tr.g; $lastH = ''
      if($lg){
        $stT = $(if("$($lg.od)" -gt "$today"){ '오픈 예정' } elseif("$($lg.ed)" -ge "$today"){ '진행 중' } else { '최근 공구' })
        # 장기 마감(C 계층 = noindex) 상세로는 링크를 걸지 않는다 — 이름만 적는다
        $lgA = $(if((GgTier $lg $today $ggCutoff) -ne 'C'){ "<a $HUB_A href=${Q}/gg/$(Enc $lg.slug).html${Q}>$(HtmlEsc $lg.name)</a>" } else { HtmlEsc $lg.name })
        $lastH = "${stT}: $lgA$(if($lg.who){ ' · ' + (HtmlEsc $lg.who) }) · 기간 $(MonDay "$($lg.od)") ~ $(MonDay "$($lg.ed)")"
      }
      $hh += "<div class=${Q}stp${Q}><b>${rk}. <a $HUB_A href=${Q}/g/$(Enc $tb.slug).html${Q}>$(HtmlEsc $tb.brand) 공구</a></b><span>$lastH</span></div>"
    }
    return $hh + '</div>'
  }
  switch($kind){
    'opentoday' {
      $pk = @(HubPick $hubOpen 30 $seed)
      if($pk.Count -gt 0){
        $hh = "<div class=${Q}sec${Q}><h2>오늘 오픈 공구 ($todayKo)</h2><p>$todayKo 오늘 열린 공구 $($hubOpen.Count)건 가운데 $($pk.Count)건입니다. 상품명을 누르면 그 공구의 일정 상세로 이동합니다.</p>"
        foreach($gx in $pk){ $hh += (HubRow $gx) }
        $hh += '</div>'
      } }
    'endtoday' {
      $pk = @(HubPick $hubEnd 20 $seed)
      if($pk.Count -gt 0){
        $hh = "<div class=${Q}sec${Q}><h2>오늘 마감 공구 ($todayKo)</h2><p>$todayKo 오늘 닫히는 공구 $($hubEnd.Count)건 가운데 $($pk.Count)건입니다.</p>"
        foreach($gx in $pk){ $hh += (HubRow $gx) }
        $hh += '</div>'
      } }
    'endsoon' {
      $pk = @(HubPick $hubEndSoon 15 $seed)
      if($pk.Count -gt 0){
        $hh = "<div class=${Q}sec${Q}><h2>마감 임박 공동구매 (이틀 안)</h2>"
        foreach($gx in $pk){ $hh += (HubRow $gx) }
        $hh += '</div>'
      } }
    'newlive' {
      $pk = @(HubPick $hubNew 15 $seed)
      if($pk.Count -gt 0){
        $hh = "<div class=${Q}sec${Q}><h2>최근 사흘 사이 열린 인스타 공구</h2>"
        foreach($gx in $pk){ $hh += (HubRow $gx) }
        $hh += '</div>'
      } }
    'week' {
      $wk = @($hubWeek | Where-Object { -not $script:hubUsed.ContainsKey("$($_.slug)") })
      if($wk.Count -gt 0){
        $hh = "<div class=${Q}sec${Q}><h2>이번 주 오픈 예정 공구 일정</h2>"
        $wn = 0
        foreach($wg in @($wk | Group-Object od | Sort-Object Name)){
          if($wn -ge 25){ break }
          $hh += "<p><b>$(MonDay "$($wg.Name)")($(WeekDayKo "$($wg.Name)")) 오픈 $($wg.Count)건</b></p>"
          foreach($gx in @($wg.Group | Select-Object -First 5)){ if($wn -ge 25){ break }; $hh += (HubRow $gx); $wn++ }
        }
        $hh += '</div>'
      } }
    'bycat' {
      $bc2 = @($hubLive | Where-Object { -not $script:hubUsed.ContainsKey("$($_.slug)") -and $brandMajor["$($_.brand)"] })
      if($bc2.Count -gt 0){
        $hh = "<div class=${Q}sec${Q}><h2>분야별 진행 중인 공구</h2>"
        $bn = 0
        foreach($bg in @($bc2 | Group-Object { $brandMajor["$($_.brand)"] } | Sort-Object @{e={$_.Count};Descending=$true}, @{e='Name';Descending=$false})){
          if($bn -ge 24){ break }
          $hh += "<p><b>$(HtmlEsc $bg.Name) 공구 $($bg.Count)건</b></p>"
          foreach($gx in @($bg.Group | Select-Object -First 4)){ if($bn -ge 24){ break }; $hh += (HubRow $gx); $bn++ }
        }
        $hh += '</div>'
      } }
    'hubseller' {
      $sg = @($hubLive | Where-Object { $_.who } | Group-Object who | Sort-Object @{e={$_.Count};Descending=$true}, @{e='Name';Descending=$false})
      if($sg.Count -gt 0){
        if($sg.Count -gt 20 -and $seed -gt 0){ $st2 = ($seed * 20) % $sg.Count; if($st2 -gt 0){ $sg = @($sg[$st2..($sg.Count - 1)]) + @($sg[0..($st2 - 1)]) } }
        $hh = "<div class=${Q}sec${Q}><h2>지금 공구하는 곳 (셀러별)</h2>"
        foreach($g2s in @($sg | Select-Object -First 20)){
          $nmH = $(if($hubSellerSlug.ContainsKey("$($g2s.Name)")){ "<a $HUB_A href=${Q}/s/$(Enc $hubSellerSlug["$($g2s.Name)"]).html${Q}>$(HtmlEsc $g2s.Name)</a>" } else { HtmlEsc $g2s.Name })
          $itH = (@($g2s.Group | Select-Object -First 3 | ForEach-Object { "<a $HUB_A href=${Q}/gg/$(Enc $_.slug).html${Q}>$(HtmlEsc $_.name)</a> ($(MonDay "$($_.ed)") 마감)" }) -join ' · ')
          $hh += "<div class=${Q}stp${Q}><b>$nmH · 진행 중 $($g2s.Count)건</b><span>$itH</span></div>"
        }
        $hh += '</div>'
      } }
  }
  return $hh
}
# 30건이 안 되면 진행 중인 공구로 채운다
function HubFill([int]$seed){
  if($script:hubCount -ge 30){ return '' }
  $pk = @(HubPick $hubLive (30 - $script:hubCount) $seed)
  if($pk.Count -eq 0){ return '' }
  $hh = "<div class=${Q}sec${Q}><h2>지금 진행 중인 공구</h2>"
  foreach($gx in $pk){ $hh += (HubRow $gx) }
  return $hh + '</div>'
}
function LdHubList([string]$nm){
  $el = New-Object System.Collections.ArrayList; $ix = 1
  foreach($gx in $script:hubItems){ [void]$el.Add("{${Q}@type${Q}:${Q}ListItem${Q},${Q}position${Q}:$ix,${Q}name${Q}:${Q}$(JsonEsc $gx.name)${Q},${Q}url${Q}:${Q}$SITE/gg/$(Enc $gx.slug).html${Q}}"); $ix++ }
  if($el.Count -eq 0){ return $null }
  return "{${Q}@context${Q}:${Q}https://schema.org${Q},${Q}@type${Q}:${Q}ItemList${Q},${Q}name${Q}:${Q}$(JsonEsc $nm)${Q},${Q}numberOfItems${Q}:$($el.Count),${Q}itemListElement${Q}:[$($el -join ',')]}"
}

$kwMade = New-Object System.Collections.ArrayList
# 🔎 2026-10-24 GEO: 질문형 랜딩마다 같은 「사이트 사실 표」 — 답변 엔진이 「맘캘린더는 셀러 몇 명·공구 몇 건」을 그대로 인용할 수 있게 숫자를 항목-값으로
$SiteFacts = @(
  @{ k='서비스'; v='인스타그램 공동구매(공구) 일정·핫딜·브랜드 세일 일정 모음' },
  @{ k='공구 진행 셀러'; v="${fmtSellers}명 (인스타 계정)" },
  @{ k='공구 일정'; v="누적 ${fmtTotal}건" },
  @{ k='공구 브랜드'; v="${fmtBrands}개" },
  @{ k='진행 중 공구'; v=$(if($fmtLive){ "${fmtLive}건" } else { '' }) },
  @{ k='갱신'; v='매일 새벽 자동 갱신' },
  @{ k='운영'; v='원츠비 (momcalendar.com)' }
)
# 오늘 오픈·오늘 마감이 둘 다 0건인 날 — 목록 구간은 저절로 빠진다(HubSection). 제목·설명에 「오늘 오픈·마감」만 남지 않게 그 문구도 걷는다
$hubQuiet = ($hubOpen.Count -eq 0 -and $hubEnd.Count -eq 0)
function HubQuietText([string]$s){
  if(-not $s){ return $s }
  $q2 = [regex]::Replace($s, '(\d+월 \d+일 )?오늘 오픈·(오늘 )?마감(·(마감 임박|최근 열린|셀러별로))?', '진행 중인')
  $q2 = $q2.Replace('오늘 열린 공동구매사이트 일정', '공동구매사이트 일정').Replace('오늘 열린 공동구매와 마감 임박 공동구매', '진행 중인 공동구매').Replace('진행 중인 인스타 공구 모음과', '진행 중인 인스타 공구 모음과')
  return [regex]::Replace($q2, ' {2,}', ' ')
}
$kwIx = 0
foreach($k in $kw){
  $canon = "$(Enc $k.slug).html"
  $body = ''
  if($k.intro){ $body += "<div class=${Q}sec${Q}>"; foreach($p in $k.intro){ $body += "<p>$(HtmlEsc (Sub3 $p))</p>" }; $body += '</div>' }
  if($k.steps){
    $body += "<div class=${Q}sec${Q}>"
    foreach($s in $k.steps){ $body += "<div class=${Q}stp${Q}><b>$(HtmlEsc (Sub3 $s.t))</b><span>$(HtmlEsc (Sub3 $s.d))</span></div>" }
    $body += '</div>'
  }
  HubReset; $kwIx++; $hubOn = $false
  foreach($sh in $k.show){
    if($HUB_KINDS -contains "$sh"){ $hubOn = $true; $body += (HubSection "$sh" $kwIx) } else { $body += (ShowSection $sh) }
  }
  if($hubOn){ $body += (HubFill $kwIx) }
  if($k.faq){
    $body += "<div class=${Q}sec${Q}><h2>자주 묻는 질문</h2>"
    foreach($f in $k.faq){ $body += "<div class=${Q}faq${Q}><b>$(HtmlEsc (Sub3 $f.q))</b><span>$(HtmlEsc (Sub3 $f.a))</span></div>" }
    $body += '</div>'
  }
  if($k.rel){
    $body += "<div class=${Q}sec${Q}><h2>함께 보면 좋은 글</h2><div class=${Q}rel${Q}>"
    foreach($r in $k.rel){ $body += (RelLink $r) }
    $body += '</div></div>'
  }
  $ld = New-Object System.Collections.ArrayList
  $faqSub = $null
  if($k.faq){ $faqSub = @($k.faq | ForEach-Object { [pscustomobject]@{ q=(Sub3 $_.q); a=(Sub3 $_.a) } }) }
  $lf = LdFaq $faqSub
  if($lf){ [void]$ld.Add($lf) }
  if($hubOn){ $lh = LdHubList "$(Sub3 $k.h1) $todayKo 공구 목록"; if($lh){ [void]$ld.Add($lh) }; Write-Output "허브 $($k.slug): 공구 행 $($script:hubCount)건" }
  [void]$ld.Add((LdCrumb (Sub3 $k.h1) $canon))
  $kT = (Sub3 $k.title); $kD = (Sub3 $k.desc); $kS = (Sub3 $k.sub); $kA = (Sub3 $k.answer)
  if($hubOn -and $hubQuiet){ $kT = HubQuietText $kT; $kD = HubQuietText $kD; $kS = HubQuietText $kS; $kA = HubQuietText $kA }
  WritePage @{ path=(Join-Path $Root "$($k.slug).html"); title=$kT; desc=$kD; canon=$canon;
    h1=(Sub3 $k.h1); sub=$kS; body=$body; jsonld=$ld; bcName=(Sub3 $k.h1); answer=$kA; facts=$SiteFacts }
  [void]$kwMade.Add($k.slug)
}

# ══ 핫딜·최저가·세일 정보 페이지 (2026-10-24 사장님 「공동구매 일정·핫딜정보·어디가 최저가인지·세일정보 이런거 다 우리 맘캘린더가 뜨게」) ══
#   데이터 페이지다 — 매일 새벽 그 시각에 사이트에 노출 중인 핫딜·세일만 싣는다. 값은 사이트에 이미 공개된 것뿐(공개 키 REST).
#   🔴 「최저가」는 사이트(index.html 「추적 기간 중 가장 싼 가격」)와 같은 뜻으로만 쓴다 = hotdeals.is_lowest. 「최저가 보장」 같은 말은 쓰지 않는다.
#   🔴 가격은 수집 시각 기준이다 — 화면·FAQ 에 「판매처에서 바뀔 수 있다」를 같이 적는다(바뀐 가격을 사실처럼 인용당하지 않게).
#   데이터를 못 받으면 페이지를 만들지 않는다(빈 페이지·0건 사실표 금지) → 보존 원칙상 어제 판이 남는다.
$SALE = @(); $CLASS = @()   # $HD2 는 맨 위에서 한 번만 읽는다(2026-11-16)
#   · 세일 표의 문화센터 학기 접수(tag 문센)는 세일이 아니다 → 따로 묶고 세일 건수에서 뺀다
Write-Output "핫딜 정보 페이지: 노출 중 $($HD2.Count)건"
try{
  $r3 = Invoke-WebRequest -Uri 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/sale_events?select=brand,title,tag,start_date,end_date,url&approved=eq.true&order=start_date.asc,id.asc&limit=300' -TimeoutSec 30 -Headers @{ apikey=$key; Authorization="Bearer $key" }
  $soonEdge = ([DateTime]::ParseExact($today,'yyyy-MM-dd',$null)).AddDays(30).ToString('yyyy-MM-dd')
  $allS = @(([Text.Encoding]::UTF8.GetString($r3.RawContentStream.ToArray()) | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object {
    $_.brand -and $_.start_date -and ("$($_.start_date)" -le $soonEdge) -and ([string]::IsNullOrWhiteSpace("$($_.end_date)") -or "$($_.end_date)" -ge $today) })
  $SALE  = @($allS | Where-Object { "$($_.tag)" -ne '문센' -and "$($_.title)" -notmatch '문화센터|아카데미.*(접수|학기)' })
  $CLASS = @($allS | Where-Object { "$($_.tag)" -eq '문센' -or "$($_.title)" -match '문화센터|아카데미.*(접수|학기)' })
  Write-Output "세일 정보 페이지: 세일 $($SALE.Count)건 · 문화센터 접수 $($CLASS.Count)건"
}catch{ Write-Output "세일 정보 데이터 실패(페이지 건너뜀): $($_.Exception.Message)" }
function Won($n){ return ('{0:N0}' -f [int]$n) + '원' }
function DealLine($h){
  $p = Won $h.price
  if($h.rate -gt 0){ $p += " ($($h.refLabel) $(Won $h.ref) 대비 $($h.rate)%↓)" }
  $low = $(if($h.is_lowest){ ' · 🏆 추적 기간 최저가' } else { '' })
  return "<div class=${Q}stp${Q}><b>$(HtmlEsc $h.title)</b><span>$(HtmlEsc $h.mall) · $p$low</span></div>"
}
function LdNames([string]$name, $names, [string]$canon){
  $el = New-Object System.Collections.ArrayList; $i = 0
  foreach($n in $names){ $i++; [void]$el.Add("{${Q}@type${Q}:${Q}ListItem${Q},${Q}position${Q}:$i,${Q}name${Q}:${Q}$(JsonEsc $n)${Q}}") }
  return "{${Q}@context${Q}:${Q}https://schema.org${Q},${Q}@type${Q}:${Q}ItemList${Q},${Q}name${Q}:${Q}$(JsonEsc $name)${Q},${Q}url${Q}:${Q}$SITE/$canon${Q},${Q}numberOfItems${Q}:$($el.Count),${Q}itemListElement${Q}:[$($el -join ',')]}"
}
function MallTable($deals){
  # 「어디가 싼가」에 답하는 표 — 쇼핑몰별 지금 노출 중인 핫딜 수·최대 할인율(65% 이하만)·추적 기간 최저가 수
  $g = @($deals | Group-Object mall | ForEach-Object {
    $mx = [int](($_.Group | Measure-Object -Property rate -Maximum).Maximum)
    [pscustomobject]@{ mall=$_.Name; n=$_.Count; mx=$mx; low=@($_.Group | Where-Object { $_.is_lowest }).Count } } |
    Sort-Object @{e={$_.n};Descending=$true}, @{e={$_.mx};Descending=$true}, @{e='mall';Descending=$false})
  $h = "<div class=${Q}sec${Q}><h2>쇼핑몰별 지금 노출 중인 핫딜</h2><dl class=${Q}facts${Q}>"
  foreach($m in $g){ $h += "<div><dt>$(HtmlEsc $m.mall)</dt><dd>$($m.n)건$(if($m.mx -gt 0){ " · 최대 $($m.mx)% 할인" })$(if($m.low -gt 0){ " · 추적 기간 최저가 $($m.low)건" })</dd></div>" }
  return $h + '</dl></div>'
}
$priceNote = '등록할 때 확인한 가격 · 판매처에서 바뀌거나 끝날 수 있음'
$dealPages = @()
if($HD2.Count -ge 5){
  $malls = @($HD2 | ForEach-Object { $_.mall } | Sort-Object -Unique)
  $lowN = @($HD2 | Where-Object { $_.is_lowest }).Count
  $top = $HD2[0]; $mxD = [int]$top.rate
  $mallTop = @($HD2 | Group-Object mall | Sort-Object @{e={$_.Count};Descending=$true}, @{e='Name';Descending=$false} | Select-Object -First 5 | ForEach-Object { $_.Name })
  $dealPages += @{ slug='핫딜정보'; h1='핫딜 정보 (핫딜 사이트)'; sub='지금 노출 중인 쇼핑몰 특가'
    title="핫딜 정보 · 핫딜 사이트 | 지금 노출 중인 쇼핑몰 특가 $($HD2.Count)건 ($ASOF) - 맘캘린더"
    desc="핫딜 사이트 맘캘린더. $ASOF 기준 노출 중인 $($malls.Count)개 쇼핑몰의 핫딜 $($HD2.Count)건을 할인율 높은 순으로 상품명·판매가·할인율과 함께 정리했습니다."
    answer="핫딜 정보는 핫딜 사이트 맘캘린더(momcalendar.com) 핫딜 탭에 모여 있습니다. $ASOF 기준 $($malls.Count)개 쇼핑몰($($mallTop -join '·')$(if($malls.Count -gt 5){' 등'}))의 특가 $($HD2.Count)건이 노출 중$(if($mxD -gt 0){ "이고, 할인율이 가장 큰 딜은 $mxD%입니다." } else { '입니다.' })"
    facts=@( @{k='노출 중 핫딜';v="$($HD2.Count)건"}, @{k='쇼핑몰';v="$($malls.Count)곳"}, @{k='최대 할인';v=$(if($mxD -gt 0){ "$mxD% ($($top.mall))" } else { '' })}, @{k='추적 최저가';v=$(if($lowN){"${lowN}건"}else{''})}, @{k='가격';v=$priceNote} )
    list=@($HD2 | Select-Object -First 60); h2='할인율 높은 순 핫딜'; mall=$true
    faq=@( @{q='핫딜 사이트 어디서 봐요?'; a="맘캘린더(momcalendar.com)는 쇼핑몰 특가를 모아 판매가·할인율과 함께 보여주는 핫딜 사이트입니다. $ASOF 기준 $($malls.Count)개 쇼핑몰 핫딜 $($HD2.Count)건이 노출 중이고, 육아 핫딜은 육아 핫딜 페이지에 따로 모았습니다."},
           @{q='핫딜 정보는 어디서 보나요?'; a="맘캘린더(momcalendar.com) 핫딜 탭에서 봅니다. $(($mallTop | Select-Object -First 4) -join '·') 등 쇼핑몰 특가를 모아 판매가·할인율과 함께 보여줍니다. $ASOF 기준 $($HD2.Count)건이 노출 중입니다."},
           @{q='핫딜 가격은 언제 기준인가요?'; a='맘캘린더에 등록할 때 확인한 가격입니다. 핫딜은 수량·시간 한정이 많아 판매처에서 가격이 바뀌거나 끝날 수 있으니, 구매 전에 판매처 가격을 확인하세요. 할인율이 65%를 넘는 정가는 부풀려진 경우가 많아 할인율을 표시하지 않습니다.'} )
    rel=@('육아핫딜','최저가정보','세일정보','공동구매일정') }
  if($lowN -ge 3){
    $lows = @($HD2 | Where-Object { $_.is_lowest })
    $dealPages += @{ slug='최저가정보'; h1='최저가 정보'; sub='맘캘린더가 가격을 기록한 기간 중 가장 싼 상품'
      title="최저가 정보 | 추적 기간 최저가 핫딜 ${lowN}건 ($ASOF) - 맘캘린더"
      desc="맘캘린더가 가격을 기록해 온 기간 중 가장 싼 가격이 된 핫딜 ${lowN}건과 쇼핑몰별 핫딜 수. $ASOF 기준."
      answer="맘캘린더(momcalendar.com) 핫딜 탭의 「최저」 표시는 맘캘린더가 그 상품의 가격을 기록해 온 기간 중 가장 싼 가격이라는 뜻입니다. 모든 쇼핑몰을 통틀은 최저가를 보장하지는 않으며, $ASOF 기준 ${lowN}건입니다."
      facts=@( @{k='최저가 표시';v="${lowN}건"}, @{k='최저가 뜻';v='맘캘린더가 가격을 기록한 기간 중 가장 싼 가격(보장 아님)'}, @{k='노출 중 핫딜';v="$($HD2.Count)건"}, @{k='쇼핑몰';v="$($malls.Count)곳"}, @{k='가격';v=$priceNote} )
      list=@($lows | Select-Object -First 60); h2='추적 기간 최저가 핫딜'; mall=$true
      faq=@( @{q='최저가 표시는 무슨 뜻인가요?'; a='맘캘린더가 그 상품의 가격을 기록해 온 기간 중 가장 싼 가격이라는 뜻입니다. 모든 쇼핑몰을 통틀은 최저가를 보장하는 표시는 아닙니다.'},
             @{q='어느 쇼핑몰이 제일 싼가요?'; a="상품마다 다릅니다. 이 페이지의 「쇼핑몰별 지금 노출 중인 핫딜」 표에 쇼핑몰마다 핫딜 수와 최대 할인율을 $ASOF 기준으로 정리했습니다."} )
      rel=@('핫딜정보','세일정보','공동구매일정') }
  }
}
if($SALE.Count -ge 3){
  $sNow = @($SALE | Where-Object { "$($_.start_date)" -le $today }); $sSoon = @($SALE | Where-Object { "$($_.start_date)" -gt $today })
  $sBody = ''
  foreach($grp in @(@{t='지금 진행 중인 세일'; r=$sNow}, @{t='30일 안에 시작하는 세일'; r=$sSoon}, @{t='문화센터 학기 접수 (세일 아님)'; r=$CLASS})){
    if($grp.r.Count -eq 0){ continue }
    $sBody += "<div class=${Q}sec${Q}><h2>$($grp.t)</h2>"
    foreach($s in $grp.r){
      $per = "$($s.start_date)" + $(if("$($s.end_date)"){ " ~ $($s.end_date)" } else { ' ~ (종료일 미정)' })
      $nm = "$($s.brand) $($s.title)".Trim()
      $lk = $(if("$($s.url)" -match '^https?://'){ " · <a href=${Q}$(HtmlEsc $s.url)${Q} rel=${Q}nofollow${Q} target=${Q}_blank${Q}>공식 페이지</a>" } else { '' })
      $sBody += "<div class=${Q}stp${Q}><b>$(HtmlEsc $nm)</b><span>$per$(if($s.tag -and $s.tag -ne '문센'){ ' · ' + (HtmlEsc $s.tag) })$lk</span></div>"
    }
    $sBody += '</div>'
  }
  $dealPages += @{ slug='세일정보'; h1='브랜드 세일 정보 (세일 일정 사이트)'; sub='진행 중인 세일과 곧 시작하는 세일 일정'
    title="브랜드 세일 정보 · 세일 정보 사이트 | 세일 일정 $($SALE.Count)건 ($ASOF) - 맘캘린더"
    desc="세일 정보 사이트 맘캘린더. $ASOF 기준 진행 중인 브랜드 세일 $($sNow.Count)건과 30일 안에 시작하는 세일 $($sSoon.Count)건의 기간을 날짜순으로 정리한 세일 일정 사이트입니다."
    answer="브랜드 세일 일정은 세일 정보 사이트 맘캘린더(momcalendar.com) 세일 탭에 날짜순으로 정리돼 있습니다. $ASOF 기준 진행 중인 세일 $($sNow.Count)건, 30일 안에 시작하는 세일 $($sSoon.Count)건입니다."
    facts=@( @{k='진행 중 세일';v="$($sNow.Count)건"}, @{k='30일 내 시작';v="$($sSoon.Count)건"}, @{k='문화센터 접수';v=$(if($CLASS.Count){ "$($CLASS.Count)건 (따로 정리)" } else { '' })}, @{k='기준일';v=$ASOF} )
    body=$sBody; cta='/#sale'
    faq=@( @{q='세일 정보 사이트·세일 일정 사이트 어디 있어요?'; a="맘캘린더(momcalendar.com) 세일 탭이 브랜드 세일 일정을 모아 둔 세일 정보 사이트입니다. $ASOF 기준 진행 중인 세일 $($sNow.Count)건, 30일 안에 시작하는 세일 $($sSoon.Count)건을 시작일 순으로 정리했고, 쇼핑몰 핫딜은 핫딜 정보에 따로 있습니다."},
           @{q='브랜드 세일 일정은 어디서 보나요?'; a="맘캘린더(momcalendar.com) 세일 탭(momcalendar.com/#sale)에서 봅니다. 브랜드별 세일 이름과 시작일·종료일을 날짜순으로 정리하고, 찜하면 시작 알림을 받을 수 있습니다."} )
    rel=@('핫딜정보','최저가정보','공동구매일정') }
}
# 🔎 2026-10-27 AEO: 「지그재그 세일 언제해?」「○○ 라방 언제해?」 — 브랜드·채널마다 질문 페이지(사장님 「세일일정 라방일정 이런 모든것도 다 넣어둬」)
#   세일은 세일 표에 있는 모든 브랜드(지난 세일 포함)를 매일 다시 쓴다 → 진행 중·다음·가장 최근 세일로 답한다
try{
  $r5 = Invoke-WebRequest -Uri 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/sale_events?select=brand,title,tag,start_date,end_date,url&approved=eq.true&order=start_date.desc,id.desc&limit=1000' -TimeoutSec 30 -Headers @{ apikey=$key; Authorization="Bearer $key" }
  $SH = @(([Text.Encoding]::UTF8.GetString($r5.RawContentStream.ToArray()) | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { $_.brand -and $_.start_date -and "$($_.tag)" -ne '문센' -and "$($_.title)" -notmatch '문화센터|아카데미.*(접수|학기)' })
  $seenSale = @{}; $nSale = 0
  $per = { param($x) "$(MonDay "$($x.start_date)")$(if("$($x.end_date)"){ '~' + (MonDay "$($x.end_date)") })" }
  foreach($g in @($SH | Group-Object brand | Sort-Object Name)){
    $b = "$($g.Name)".Trim(); if(-not $b){ continue }
    $slug0 = SlugOf $b $seenSale '-s'; if(-not $slug0){ continue }
    $rows = @($g.Group | Sort-Object @{e={"$($_.start_date)"};Descending=$true})
    $cur = @($rows | Where-Object { "$($_.start_date)" -le "$today" -and ([string]::IsNullOrWhiteSpace("$($_.end_date)") -or "$($_.end_date)" -ge "$today") })
    $nxt = @($rows | Where-Object { "$($_.start_date)" -gt "$today" } | Sort-Object @{e={"$($_.start_date)"};Descending=$false})
    $ans = $(if($cur.Count){ "$b 세일은 지금 진행 중입니다. $($cur[0].title) $(& $per $cur[0])$(if($nxt.Count){ ", 다음은 $($nxt[0].title) $(MonDay "$($nxt[0].start_date)") 시작" })." } elseif($nxt.Count){ "다음 $b 세일은 $($nxt[0].title), $(& $per $nxt[0])입니다." } else { "가장 최근 $b 세일은 $($rows[0].title) $(& $per $rows[0])였습니다. 다음 일정이 올라오면 맘캘린더 세일 탭에 표시됩니다." })
    $ans = "$ans ($ASOF 기준, 맘캘린더 momcalendar.com 세일 일정)"
    $body = "<div class=${Q}sec${Q}><h2>$(HtmlEsc $b) 세일 일정</h2>"
    foreach($x in @($rows | Select-Object -First 20)){ $lk = $(if("$($x.url)" -match '^https?://'){ " · <a href=${Q}$(HtmlEsc $x.url)${Q} rel=${Q}nofollow${Q} target=${Q}_blank${Q}>공식 페이지</a>" } else { '' }); $body += "<div class=${Q}stp${Q}><b>$(HtmlEsc "$($x.title)")</b><span>$($x.start_date)$(if("$($x.end_date)"){ ' ~ ' + $x.end_date })$lk</span></div>" }
    $body += '</div>'
    $dealPages += @{ slug="${slug0}세일"; h1="$b 세일 언제해요?"; sub="$b 세일 일정"; title="$b 세일 언제해요? | $b 세일 일정 ($ASOF) - 맘캘린더"
      desc="$b 세일 기간을 날짜순으로 정리했습니다. $ASOF 기준 진행 중·예정 세일과 지난 세일 일정."
      answer=$ans; facts=@( @{k='브랜드';v=$b}, @{k='기록된 세일';v="$($rows.Count)건"}, @{k='기준일';v=$ASOF} )
      body=$body; cta='/#sale'
      faq=@( @{q="$b 세일 언제해요?"; a=$ans}, @{q="$b 세일 알림 받을 수 있어요?"; a="맘캘린더(momcalendar.com) 세일 탭에서 $b 세일을 찜하면 시작할 때 알림을 받을 수 있습니다."} )
      rel=@('세일정보','라방일정','핫딜정보') }
    $nSale++
  }
  Write-Output "브랜드 세일 질문 페이지: ${nSale}개"
}catch{ Write-Output "브랜드 세일 질문 페이지 실패(건너뜀): $($_.Exception.Message)" }
#   라방: 앞으로 방송이 잡힌 채널마다 + 라방 일정 모음
try{
  $lvFrom = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss')
  $r6 = Invoke-WebRequest -Uri ("https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/live_shows?select=title,channel_name,category,start_at,link_url&start_at=gte.$lvFrom&order=start_at.asc&limit=600") -TimeoutSec 30 -Headers @{ apikey=$key; Authorization="Bearer $key" }
  $LV = @(([Text.Encoding]::UTF8.GetString($r6.RawContentStream.ToArray()) | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { $_.channel_name -and $_.start_at -and $_.title })
  $kt = { param($t) $d = [DateTimeOffset]::Parse("$t").ToOffset([TimeSpan]::FromHours(9)); "$($d.Month)/$($d.Day) $($d.ToString('HH:mm'))" }
  $lvLine = { param($x) $lk = $(if("$($x.link_url)" -match '^https?://'){ " · <a href=${Q}$(HtmlEsc $x.link_url)${Q} rel=${Q}nofollow${Q} target=${Q}_blank${Q}>방송 페이지</a>" } else { '' }); "<div class=${Q}stp${Q}><b>$(HtmlEsc "$($x.title)".Trim())</b><span>$(HtmlEsc "$($x.channel_name)") · $(& $kt $x.start_at)$lk</span></div>" }
  if($LV.Count -gt 0){
    $t5 = (@($LV | Select-Object -First 5 | ForEach-Object { "$($_.channel_name) $(& $kt $_.start_at)" }) -join ', ')
    $lans = "$ASOF 기준 맘캘린더(momcalendar.com)에 올라 있는 앞으로의 라방(네이버 쇼핑라이브)은 $($LV.Count)건입니다. 가까운 방송은 $t5 입니다."
    $lbody = "<div class=${Q}sec${Q}><h2>다가오는 라방</h2>"; foreach($x in @($LV | Select-Object -First 60)){ $lbody += (& $lvLine $x) }; $lbody += '</div>'
    $dealPages += @{ slug='라방일정'; h1='라방 일정'; sub='다가오는 쇼핑라이브 방송'; title="라방 일정 | 다가오는 쇼핑라이브 $($LV.Count)건 ($ASOF) - 맘캘린더"
      desc="$ASOF 기준 다가오는 네이버 쇼핑라이브(라방) 방송 $($LV.Count)건을 시간순으로 정리했습니다. 육아·리빙 브랜드 라방 일정."
      answer=$lans; facts=@( @{k='다가오는 라방';v="$($LV.Count)건"}, @{k='기준일';v=$ASOF} ); body=$lbody; cta='/#sale'
      faq=@( @{q='라방 일정 어디서 봐요? 오늘 라방 뭐 있어?'; a=$lans} ); rel=@('세일정보','핫딜정보','공동구매일정') }
    $seenLv = @{}; $nLv = 0
    foreach($g in @($LV | Group-Object channel_name | Sort-Object Name)){
      $c = "$($g.Name)".Trim(); if(-not $c){ continue }
      $slug1 = SlugOf $c $seenLv '-l'; if(-not $slug1){ continue }
      $rows = @($g.Group)
      $cans = "다음 $c 라방은 $(& $kt $rows[0].start_at) 「$("$($rows[0].title)".Trim())」입니다.$(if($rows.Count -gt 1){ " 그다음은 $(& $kt $rows[1].start_at) 방송입니다." }) ($ASOF 기준, 맘캘린더 momcalendar.com 라방 일정)"
      $cbody = "<div class=${Q}sec${Q}><h2>$(HtmlEsc $c) 라방 일정</h2>"; foreach($x in $rows){ $cbody += (& $lvLine $x) }; $cbody += '</div>'
      $dealPages += @{ slug="${slug1}라방"; h1="$c 라방 언제해요?"; sub="$c 쇼핑라이브 일정"; title="$c 라방 언제해요? | $c 라이브 일정 ($ASOF) - 맘캘린더"
        desc="$c 네이버 쇼핑라이브(라방) 방송 시간과 혜택 제목을 정리했습니다. $ASOF 기준 다가오는 방송 $($rows.Count)건."
        answer=$cans; facts=@( @{k='채널';v=$c}, @{k='다가오는 라방';v="$($rows.Count)건"}, @{k='기준일';v=$ASOF} ); body=$cbody; cta='/#sale'
        faq=@( @{q="$c 라방 언제해요?"; a=$cans} ); rel=@('라방일정','세일정보','핫딜정보') }
      $nLv++
    }
    Write-Output "라방 질문 페이지: 채널 ${nLv}개 + 라방 일정"
  }
}catch{ Write-Output "라방 질문 페이지 실패(건너뜀): $($_.Exception.Message)" }
# 🔎 2026-10-27 AEO: 「쿠팡 핫딜 있어?」「육아 핫딜」「기저귀 핫딜」 같은 질문 페이지 — 정해진 목록이라 매일 같은 페이지를 다시 쓴다(0건이면 0건이라고 쓴다, 옛 딜이 남지 않게)
if($HD2.Count -gt 0){
  $hdTopics = @()
  foreach($m in @('쿠팡','11번가','지마켓','롯데온','오늘의집','토스쇼핑')){ $hdTopics += @{ slug="${m}핫딜"; label="$m 핫딜"; rows=@($HD2 | Where-Object { $_.mall -eq $m }) } }
  foreach($c in @('육아','식품','리빙','가전','뷰티','건강','패션')){ $hdTopics += @{ slug="${c}핫딜"; label="$c 핫딜"; rows=@($HD2 | Where-Object { $_.major -eq $c }) } }
  foreach($w in @('기저귀','물티슈','분유','이유식','장난감','유산균','영양제','세제')){ $hdTopics += @{ slug="${w}핫딜"; label="$w 핫딜"; rows=@($HD2 | Where-Object { $_.title -like "*$w*" -or $_.minor -like "*$w*" }) } }
  foreach($t in $hdTopics){
    $n = $t.rows.Count
    $t3 = (@($t.rows | Select-Object -First 3 | ForEach-Object { "$($_.title)($($_.mall) $(Won $_.price)$(if($_.rate -gt 0){ ", $($_.rate)% 할인" }))" }) -join ', ')
    $ans = $(if($n -gt 0){ "$ASOF 기준 맘캘린더(momcalendar.com)에 노출 중인 $($t.label)은 ${n}건입니다. 할인율이 큰 딜은 $t3 입니다." } else { "$ASOF 기준 맘캘린더(momcalendar.com)에 노출 중인 $($t.label)은 없습니다. 다른 쇼핑몰·분야 핫딜 $($HD2.Count)건은 핫딜 정보에서 볼 수 있습니다." })
    $dealPages += @{ slug=$t.slug; h1="$($t.label) 있어요?"; sub="$ASOF 기준 노출 중인 $($t.label)"
      title="$($t.label) 있어요? | 지금 노출 중 ${n}건 ($ASOF) - 맘캘린더"
      desc="$ASOF 기준 맘캘린더에 노출 중인 $($t.label) ${n}건. 할인율 높은 순으로 상품명·쇼핑몰·판매가를 정리했습니다."
      answer=$ans
      facts=@( @{k="노출 중 $($t.label)";v="${n}건"}, @{k='전체 핫딜';v="$($HD2.Count)건"}, @{k='가격';v=$priceNote} )
      list=@($t.rows | Select-Object -First 40); h2="$($t.label) (할인율 높은 순)"
      faq=@( @{q="$($t.label) 있어요?"; a=$ans}, @{q='핫딜 가격은 언제 기준인가요?'; a='맘캘린더에 등록할 때 확인한 가격입니다. 판매처에서 가격이 바뀌거나 끝날 수 있으니 구매 전에 판매처 가격을 확인하세요.'} )
      rel=@('핫딜정보','최저가정보','세일정보','공동구매일정') }
    if($t.slug -eq '육아핫딜'){
      $yd = $dealPages[-1]
      $yd.h1 = '육아 핫딜 (육아 핫딜 사이트)'
      $yd.title = "육아 핫딜 사이트 | 지금 노출 중인 육아 핫딜 ${n}건 ($ASOF) - 맘캘린더"
      $yd.desc = "육아 핫딜 사이트 맘캘린더. $ASOF 기준 노출 중인 육아 핫딜 ${n}건을 할인율 높은 순으로 상품명·쇼핑몰·판매가와 함께 정리했습니다."
      $yd.answer = "육아 핫딜은 육아 핫딜 사이트 맘캘린더(momcalendar.com) 핫딜 탭에서 육아 분류로 볼 수 있습니다. $ans"
      $yd.faq = @(@{q='육아 핫딜 사이트 어디예요?'; a="맘캘린더(momcalendar.com) 핫딜 탭에 쇼핑몰 육아 핫딜을 모아 판매가·할인율과 함께 보여줍니다. $ans"}) + @($yd.faq)
      $yd.rel = @('핫딜정보','기저귀핫딜','분유핫딜','장난감핫딜','세일정보','공구일정')
    }
  }
}
# 🔎 2026-10-27 AEO: 「핫딜 알아봐 줘」「세일 언제야?」에 오늘 데이터로 답하게
if($HD2.Count -gt 0){ $top3 = (@($HD2 | Select-Object -First 3 | ForEach-Object { "$($_.title)($($_.mall) $(Won $_.price)$(if($_.rate -gt 0){ ", $($_.rate)% 할인" }))" }) -join ', ') }
if($SALE.Count -gt 0){
  $sN = @($SALE | Where-Object { "$($_.start_date)" -le "$today" } | Select-Object -First 3 | ForEach-Object { "$("$($_.brand) $($_.title)".Trim())$(if("$($_.end_date)"){ "(" + (MonDay "$($_.end_date)") + "까지)" })" })
  $sS = @($SALE | Where-Object { "$($_.start_date)" -gt "$today" } | Select-Object -First 3 | ForEach-Object { "$("$($_.brand) $($_.title)".Trim())(" + (MonDay "$($_.start_date)") + " 시작)" })
  $saleLine = (@($(if($sN.Count){ "진행 중 " + ($sN -join ', ') }), $(if($sS.Count){ "곧 시작 " + ($sS -join ', ') }) | Where-Object { $_ }) -join ' / ')
}
foreach($dp in $dealPages){
  if($dp.slug -eq '핫딜정보' -and $top3){
    $dp.answer = "$($dp.answer) 지금 할인율이 큰 딜은 $top3 입니다."
    $dp.faq = @(@{q='핫딜 있어요? 지금 핫딜 있어?'; a="네, $ASOF 기준 맘캘린더(momcalendar.com)에 핫딜 $($HD2.Count)건이 노출 중입니다. 할인율이 큰 딜은 $top3 입니다."}) + @($dp.faq)
    $dp.faq = @(@{q='핫딜 알아봐 줘. 오늘 핫딜 뭐 있어?'; a="$ASOF 기준 맘캘린더(momcalendar.com)에 노출 중인 핫딜 $($HD2.Count)건 가운데 할인율이 큰 딜은 $top3 입니다. 가격은 등록할 때 확인한 값이라 판매처에서 바뀔 수 있습니다."}) + @($dp.faq)
  }
  if($dp.slug -eq '세일정보' -and $saleLine){
    $dp.answer = "$($dp.answer) $saleLine."
    $dp.faq = @(@{q='세일 언제야? 브랜드 세일 언제 해요?'; a="$ASOF 기준 맘캘린더(momcalendar.com) 세일 탭에 올라 있는 세일은 $saleLine 입니다. 브랜드별 시작일·종료일과 공식 페이지는 세일 탭에서 봅니다."}) + @($dp.faq)
  }
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
  foreach($r in $dp.rel){ $body += (RelLink $r) }
  $body += '</div></div>'
  $ld = New-Object System.Collections.ArrayList
  [void]$ld.Add((LdFaq @($dp.faq | ForEach-Object { [pscustomobject]@{ q=$_.q; a=$_.a } })))
  [void]$ld.Add((LdCrumb $dp.h1 $canon))
  # 2026-11-16: 핫딜 목록은 Product + Offer(실가격) 로 — 가격이 있는 핫딜 페이지에만. 세일·라방 페이지는 list 가 없어 해당 없음. 공구 페이지에는 넣지 않는다
  if($dp.list){ $ldl = LdDealList $dp.h1 @($dp.list | Select-Object -First 30) $canon; if($ldl){ [void]$ld.Add($ldl) } }
  WritePage @{ path=(Join-Path $Root "$($dp.slug).html"); title=$dp.title; desc=$dp.desc; canon=$canon;
    h1=$dp.h1; sub=$dp.sub; body=$body; jsonld=$ld; bcName=$dp.h1; answer=$dp.answer; facts=$dp.facts
    cta=$(if($dp.cta){ $dp.cta } else { '/' }); ctaText=$(if($dp.cta){ '세일 탭 보러 가기 →' } else { '맘캘린더 핫딜 보러 가기 →' })
    asofText=$(if($dp.cta){ '기준 · 맘캘린더 세일 탭에 올라 있는 세일' } else { '기준 · 맘캘린더에 지금 노출 중인 핫딜' })
    cta2=$(if(@('핫딜정보','세일정보','최저가정보','라방일정') -contains "$($dp.slug)"){ $AppCta.Replace($CtaOs, '') } else { '' }) }   # 2026-11-23 ORDER §6-4: 목록이 긴 4장만 하단 앱 CTA(매일 다시 만들어지는 페이지라 숫자 판 $AppCta)
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
# 2026-11-25: 얇은 g(noindex) 는 브랜드 목록 허브에서 뺀다(p 휴면과 같은 원칙) — 허브 개수도 색인 대상 수로
$nBIdx = 0
foreach($b in ($brandList | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='brand';Descending=$false})){ if($gNoIdx.Contains("$($b.slug).html")){ continue }; $nBIdx++; $lk += "<a href=${Q}/g/$(Enc $b.slug).html${Q}>$(HtmlEsc $b.brand)</a>" }
$fmtBrandsIdx = '{0:N0}' -f $nBIdx
Hub '공구브랜드.html' "공구 브랜드 목록 ${fmtBrandsIdx}개 | 인스타 공동구매 - 맘캘린더" `
  "인스타 공구로 진행된 브랜드 ${fmtBrandsIdx}개 목록. 브랜드를 누르면 그 브랜드의 공구 일정과 진행 셀러를 볼 수 있습니다." `
  "공구 브랜드" "${fmtBrandsIdx}개 브랜드의 공구 이력" `
  "맘캘린더에 기록된 공구 브랜드 ${fmtBrandsIdx}개입니다. 브랜드를 누르면 그 브랜드를 공구한 셀러와 지난 일정, 진행 중인 공구를 볼 수 있습니다." $lk '공구 브랜드'
$lk = ''
foreach($s in ($sellerMade | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='slug';Descending=$false})){ $lk += "<a href=${Q}/s/$(Enc $s.slug).html${Q}>$(HtmlEsc $s.kor)</a>" }
Hub '공구셀러.html' "인스타 공구 셀러 목록 ${fmtSellers}명 | 맘캘린더" `
  "인스타그램에서 공동구매를 진행하는 셀러 ${fmtSellers}명의 목록과 공구 이력. 셀러별 진행 중인 공구를 확인하세요." `
  "인스타 공구 셀러" "${fmtSellers}명의 공구 이력" `
  "인스타에서 공동구매를 진행하는 셀러 ${fmtSellers}명입니다. 이름을 누르면 그 셀러의 공구 건수, 주력 분야, 진행 중인 공구를 볼 수 있습니다." $lk '공구 셀러'
$lk = ''
$pIdxCnt = $prodList.Count - $pNoIdx.Count   # 2026-11-23 ORDER §4-4: 휴면(noindex) p 는 허브에서 빼고 개수도 색인 대상 수로
foreach($p in ($prodList | Where-Object { -not $pNoIdx.Contains("$($_.slug).html") } | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='key';Descending=$false})){ $lk += "<a href=${Q}/p/$(Enc $p.slug).html${Q}>$(HtmlEsc $p.key)</a>" }
Hub '공구제품.html' "공구 제품 목록 $($pIdxCnt)개 | 브랜드별 공동구매 - 맘캘린더" `
  "인스타 공구로 여러 번 진행된 제품 $($pIdxCnt)개. 제품을 누르면 진행한 셀러와 공구 이력, 다음 공구 시기를 가늠할 수 있습니다." `
  "공구 제품" "여러 번 진행된 제품 $($pIdxCnt)개" `
  "두 번 이상 공구로 나온 제품 $($pIdxCnt)개입니다. 같은 제품이 얼마 만에 다시 나오는지 이력으로 확인할 수 있습니다." $lk '공구 제품'

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
        $h = (CoreHash $fp)
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
# 2026-11-16 (ORDER §8-1): 지워야 하는 보존 페이지(차단 브랜드·브랜드 아님·내려놓은 공구)는 **지우지 않고 툼스톤으로 바꾼다**.
#   지우면 그 주소가 404 가 되고(서치콘솔 404 619건), 이 사이트는 GitHub Pages 라 서버 301 을 못 한다.
#   툼스톤 = 200 + noindex + canonical + meta refresh. 브랜드·상품 이름은 한 글자도 남기지 않는다. 사이트맵에는 싣지 않는다.
$TombSet = @{}        # 이번 실행에서 확인한 툼스톤 경로(dir/파일명) — 사이트맵 제외·내부 링크 걷기에 쓴다
$TombNew = 0
$DEST_BRANDS = (Enc '공구브랜드.html'); $DEST_PRODS = (Enc '공구제품.html'); $DEST_NOW = (Enc '지금공구.html')
function PutTombstone($f, [string]$dir2, [string]$dest){
  $html = TombstoneHtml $dest
  $old = ''
  try{ if($f.Length -lt 4000){ $old = [IO.File]::ReadAllText($f.FullName) } }catch{}
  if($old -ne $html){ [IO.File]::WriteAllText($f.FullName, $html, [Text.UTF8Encoding]::new($false)); if(-not (IsTombstoneText $old)){ $script:TombNew++ } }
  $script:TombSet["$dir2/$($f.Name)"] = 1
}
function TombDestFor([string]$dir2, $f, [bool]$brandSafe){
  if($dir2 -eq 'g'){ return $DEST_BRANDS }
  if($dir2 -eq 'p'){ return $DEST_PRODS }
  if($dir2 -eq 'gg'){
    # 내려놓은 공구(중복 등)는 그 브랜드 페이지로 — 옛 파일에 남아 있는 「○○ 전체 공구 일정」 링크에서 읽는다. 차단 브랜드는 브랜드 페이지로 보내지 않는다
    if($brandSafe){
      try{
        $t0 = [IO.File]::ReadAllText($f.FullName)
        $m0 = [regex]::Match($t0, '<a href="/(g/[^"#?]+\.html)"[^>]*>[^<]*전체 공구 일정</a>')
        if($m0.Success){
          $rp = [uri]::UnescapeDataString($m0.Groups[1].Value)
          $bn = [IO.Path]::GetFileNameWithoutExtension($rp)
          if([IO.File]::Exists((Join-Path $Root $rp)) -and -not (IsBlocked $bn) -and -not $JunkBrands.ContainsKey($bn.ToLower()) -and -not $TombSet.ContainsKey($rp)){ return $m0.Groups[1].Value }
        }
      }catch{}
    }
    return $(if([IO.File]::Exists((Join-Path $Root '지금공구.html'))){ $DEST_NOW } else { $DEST_BRANDS })
  }
  return ''
}
function KeptUrls([string]$dir2, $todayUrls){
  $have = @{}
  foreach($u in $todayUrls){ $have[[uri]::UnescapeDataString("$u")] = 1 }
  $extra = New-Object System.Collections.ArrayList
  $dp = Join-Path $Root $dir2
  if(Test-Path $dp){
    foreach($f in (Get-ChildItem $dp -Filter *.html -File | Sort-Object Name)){
      $rel = "$dir2/$($f.Name)"
      # 🚫 차단 브랜드의 보존 페이지 — 보존 원칙의 예외였던 자리. 이제 지우지 않고 툼스톤으로(파일명에 브랜드가 들어간다: g/브랜드 · gg/상품명-MMDD · p/브랜드-제품)
      if(IsBlocked $f.BaseName){ $wasT = ($f.Length -lt 4000 -and (IsTombstoneText ([IO.File]::ReadAllText($f.FullName)))); PutTombstone $f $dir2 (TombDestFor $dir2 $f $false); if(-not $wasT){ $script:BlockedRemoved++ }; continue }
      if($dir2 -eq 'g' -and $JunkBrands.ContainsKey(([uri]::UnescapeDataString($f.BaseName)).ToLower())){ $wasT = ($f.Length -lt 4000 -and (IsTombstoneText ([IO.File]::ReadAllText($f.FullName)))); PutTombstone $f $dir2 $DEST_BRANDS; if(-not $wasT){ $script:JunkRemoved++ }; continue }
      # 🚫 중복이라 내려놓은 공구(gonggu_hold)의 건별 페이지 (2026-10-06)
      #    gg/ 에만 적용한다. g(브랜드)·p(제품)·s(셀러) 집계 페이지는 행 하나가 빠져도 살아 있어야 한다.
      #    🔴 2026-10-24: **오늘 만든 페이지는 건드리지 않는다** — 중복 쌍에서 남긴 행도 이름·오픈일이 같아 슬러그가 같다.
      if($dir2 -eq 'gg' -and -not $have.ContainsKey($rel) -and (IsHeldGg $f.BaseName)){ $wasT = ($f.Length -lt 4000 -and (IsTombstoneText ([IO.File]::ReadAllText($f.FullName)))); if(-not $wasT){ PutTombstone $f $dir2 (TombDestFor $dir2 $f $true); $script:HeldRemoved++ } else { $script:TombSet[$rel] = 1 }; continue }
      # 다른 길로 만들어진 툼스톤(tombstone.ps1 — 서치콘솔 404 목록)도 사이트맵에 싣지 않는다. 툼스톤은 1KB 가 안 되므로 작은 파일만 열어 본다
      if(-not $have.ContainsKey($rel) -and $f.Length -lt 1500 -and (IsTombstoneText ([IO.File]::ReadAllText($f.FullName)))){ $script:TombSet[$rel] = 1; continue }
      if(-not $have.ContainsKey($rel)){ [void]$extra.Add("$dir2/$(Enc $f.BaseName).html") }
    }
  }
  # ⚠ 함수 안에서 Write-Output 을 쓰면 반환값에 섞인다 → Write-Host 로만 알린다.
  # ⚠ `return ,$extra` 도 금지 — 중첩 배열이 되어 1,764개 URL 이 sitemap 한 줄에 뭉쳐 들어갔다(실측).
  Write-Host "보존 페이지 합류($dir2): $($extra.Count)개"
  return @($extra)
}

# 2026-11-16 검증자: 보존 페이지 손질(옛 문장 치환·끝난 Event 걷기·GA4·noai)을 사이트맵 쓰기보다 **먼저** 한다 —
#   나중에 하면 본문이 바뀌었는데 lastmod 는 옛 날짜로 굳고, 「오늘 바뀐 주소만」 보내는 IndexNow 에서도 빠진다. (GA4·noai 만 바뀐 것은 CoreHash 가 같아 lastmod 가 안 바뀐다 — 의도)
$headPatched0 = 0
foreach($dd in @('g','p','s','gg','m','d','c')){
  $dp2 = Join-Path $Root $dd
  if(-not (Test-Path $dp2)){ continue }
  foreach($fp in [IO.Directory]::EnumerateFiles($dp2, '*.html')){
    $t = [IO.File]::ReadAllText($fp); $t3 = PatchHeadText $t
    if($t3 -ne $t){ [IO.File]::WriteAllText($fp, $t3, [Text.UTF8Encoding]::new($false)); $headPatched0++ }
  }
}
Write-Output "보존 페이지 손질(옛 문장·끝난 Event·GA4·noai): $headPatched0 쪽"
$uMain = New-Object System.Collections.ArrayList
[void]$uMain.Add('')
foreach($k in $kwMade){ [void]$uMain.Add("$(Enc $k).html") }
foreach($h in @('공구브랜드.html','공구셀러.html','공구제품.html')){ [void]$uMain.Add((Enc $h)) }
foreach($c in $catMade){ [void]$uMain.Add("c/$(Enc $c).html") }
foreach($m in $monthMade){ [void]$uMain.Add("d/$($m.slug).html") }
foreach($m in $minorMade){ [void]$uMain.Add("m/$(Enc $m.slug).html") }
foreach($k in @('c','d','m')){ foreach($x in (KeptUrls $k $uMain)){ [void]$uMain.Add($x) } }
WriteSitemap 'sitemap-main.xml' $uMain '0.9' 'daily'
$uB = @(); $uBAll = @(); foreach($b in $brandList){ $uBAll += "g/$(Enc $b.slug).html"; if(-not $gNoIdx.Contains("$($b.slug).html")){ $uB += "g/$(Enc $b.slug).html" } }   # 2026-11-25: 얇은 g(N) 는 사이트맵 제외
# 보존 g 페이지(오늘 집계에 없는 옛 브랜드)도 같은 규칙 — 파일의 공구 카드 수·상태를 읽는다. 진행·예정이 있거나 카드 2장 이상이거나 명단·검색량이 있으면 index 로(되돌리기 포함)
$keptGNo = 0; $keptGFlip = 0
foreach($u in (KeptUrls 'g' $uBAll)){
  $fn = [IO.Path]::GetFileName([uri]::UnescapeDataString("$u")); $fp = Join-Path $Root "g/$fn"
  if(-not (Test-Path -LiteralPath $fp)){ continue }
  $t = [IO.File]::ReadAllText($fp)
  $wantNo = $false
  if($GTierOn){
    $hd2 = $t.Split(@('<!--hd-->'), 2, [StringSplitOptions]::None)[0]
    $cards = ([regex]::Matches($hd2, 'class="card"')).Count
    $idle = ($t.IndexOf('<dd>진행 중인 공구 없음</dd>', [StringComparison]::Ordinal) -ge 0)
    $bn = [IO.Path]::GetFileNameWithoutExtension($fn)
    $wantNo = $idle -and ($cards -le 1) -and -not $GKeepIdx.Contains($fn) -and ((VolOf $bn) -le 0)
  }
  $isNo = TextHasNoindex $t
  if($wantNo -ne $isNo){
    $t = SetRobotsText $t $(if($wantNo){ $ROBOTS_NOINDEX } else { 'index,follow,max-image-preview:large' })
    [IO.File]::WriteAllText($fp, $t, [Text.UTF8Encoding]::new($false)); $keptGFlip++
  }
  if($wantNo){ $keptGNo++; [void]$gNoIdx.Add($fn) } else { $uB += $u }
}
Write-Output "g 계층: 색인 $($uB.Count) · 얇은 페이지 noindex $($gNoIdx.Count)(보존 페이지 $keptGNo · 이번에 메타 바꾼 보존 $keptGFlip)"
WriteSitemap 'sitemap-brand.xml' $uB '0.7' 'weekly'
# 내린 g 목록 — 되돌리기·날마다 비교용(생성물, 커밋된다)
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'g_noindex.txt'), "# g(브랜드) 얇은 페이지 noindex 목록 — build.ps1 이 매일 쓴다. 기준일 $today · $($gNoIdx.Count)장`n" + ((@($gNoIdx) | Sort-Object) -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
$uP = @(); foreach($p in $prodList){ if(-not $pNoIdx.Contains("$($p.slug).html")){ $uP += "p/$(Enc $p.slug).html" } }   # 2026-11-23 ORDER §4-2(d): 휴면 p 는 사이트맵 제외
$uP = @($uP) + @((KeptUrls 'p' $uP) | Where-Object { -not (HasNoindex ([uri]::UnescapeDataString("$_")) $Root) })
WriteSitemap 'sitemap-product.xml' $uP '0.7' 'weekly'
$uS = @(); foreach($s in $sellerMade){ $uS += "s/$(Enc $s.slug).html" }
$uS = @($uS) + @(KeptUrls 's' $uS)
WriteSitemap 'sitemap-seller.xml' $uS '0.7' 'weekly'
# 2026-11-16 (ORDER §4-2): gg 는 A·B 계층만 사이트맵에 싣는다. 페이지는 지우지 않는다(C 는 200 + noindex,follow 로 남는다).
#   llms.txt 의 「공구 건별 상세 N개」「사이트맵 총 N개」가 이만큼 줄어드는 것은 의도한 것이다.
$uGG = New-Object System.Collections.ArrayList
$ggAll = New-Object System.Collections.ArrayList      # 오늘 만든 gg 전부(C 포함) — KeptUrls 가 「오늘 만든 것」을 가리는 데 쓴다
foreach($x in $ggRows){
  [void]$ggAll.Add("gg/$(Enc $x.slug).html")
  if((GgTier $x $today $ggCutoff) -eq 'C'){ continue }
  [void]$uGG.Add("gg/$(Enc $x.slug).html")
}
# 보존 gg 페이지(오늘 집계에 없는 옛 페이지)도 같은 계층 규칙으로 — 마감일은 파일 머리에서 읽어 둔 값($KeptGgEd).
#   마감이 창 밖이면 robots 메타를 noindex,follow 로 바꾸고 사이트맵에서 뺀다. 창 안이면(되돌리기 포함) index 로 되돌리고 싣는다. 날짜를 못 읽은 페이지는 그대로 둔다
$keptC = 0; $keptB = 0; $keptFlip = 0
foreach($u in (KeptUrls 'gg' $ggAll)){
  $fn = [uri]::UnescapeDataString(("$u" -replace '^gg/',''))
  $fp = Join-Path $Root "gg/$fn"
  $wantNo = $false
  if($KeptGgEd.ContainsKey($fn)){ $wantNo = ("$($KeptGgEd[$fn])" -lt $ggCutoff) -and -not $GgKeepIdx.Contains($fn) }
  else { if(HasNoindex $u $Root){ $keptC++; continue } else { $keptB++; [void]$uGG.Add($u); continue } }
  $t = [IO.File]::ReadAllText($fp)
  $isNo = (TextHasNoindex $t)
  if($wantNo -ne $isNo){
    $t = SetRobotsText $t $(if($wantNo){ $ROBOTS_NOINDEX } else { 'index,follow,max-image-preview:large' })
    [IO.File]::WriteAllText($fp, $t, [Text.UTF8Encoding]::new($false)); $keptFlip++
  }
  if($wantNo){ $keptC++ } else { $keptB++; [void]$uGG.Add($u) }
}
Write-Output "보존 gg 계층: 사이트맵 유지 $keptB · 장기 마감(noindex) $keptC · 이번에 메타 바꾼 것 $keptFlip"
WriteSitemap 'sitemap-gonggu.xml' $uGG '0.6' 'weekly'

# 🔗 보존 페이지 안의 죽은 링크를 글자로 바꾼다 (2026-10-24)
#   보존 원칙상 지난 페이지(g·p·s·gg)는 다시 만들지 않고 그대로 둔다. 그런데 내려놓은 공구(gonggu_hold)·차단 브랜드의 gg 페이지는
#   위 KeptUrls 가 지우므로, 그 페이지를 가리키던 보존 페이지의 링크가 404 가 된다(10-23 상품명 정리 뒤 62건 → verify 불통과).
#   페이지는 지우지 않고 **링크만** 걷는다(<a …>글자</a> → 글자). 오늘 새로 만든 페이지는 원래 살아 있는 링크만 가지므로 바뀌지 않는다
#   2026-11-16: ① 툼스톤으로 바뀐 페이지를 가리키는 링크도 같이 걷는다(차단 브랜드 이름이 링크로 남지 않게 — 글자는 원래도 남는다)
#               ② 보존 페이지 <head> 에 GA4 를 넣고 noai 메타를 걷는다(PatchHeadText — 이미 된 파일은 그대로, 멱등). 1회성 도구 patch_kept_once.ps1 과 같은 함수
$deadFixed = 0; $deadPages = 0; $headPatched = 0
$aRe = [regex]'<a href="/((?:gg|g|p|s)/[^"#?]+\.html)"[^>]*>(.*?)</a>'
foreach($dd in @('g','p','s','gg','m','d','c')){
  $dp2 = Join-Path $Root $dd
  if(-not (Test-Path $dp2)){ continue }
  foreach($fp in [IO.Directory]::EnumerateFiles($dp2, '*.html')){
    $t = [IO.File]::ReadAllText($fp)
    $t2 = $t
    $n0 = $deadFixed
    if($t.IndexOf('href="/', [StringComparison]::Ordinal) -ge 0 -and -not (IsTombstoneText $t)){
      $t2 = $aRe.Replace($t, [Text.RegularExpressions.MatchEvaluator]{ param($m)
        $rp = [uri]::UnescapeDataString($m.Groups[1].Value)
        if([IO.File]::Exists((Join-Path $Root $rp)) -and -not $TombSet.ContainsKey($rp)){ return $m.Value }
        $script:deadFixed++; return $m.Groups[2].Value })
    }
    $t3 = PatchHeadText $t2
    if($t3 -ne $t2){ $headPatched++ }
    if($deadFixed -ne $n0 -or $t3 -ne $t2){ [IO.File]::WriteAllText($fp, $t3, [Text.UTF8Encoding]::new($false)); if($deadFixed -ne $n0){ $deadPages++ } }
  }
}
Write-Output "보존 페이지 죽은 링크 정리: $deadFixed 개 ($deadPages 쪽) · GA4·noai 머리 손질 $headPatched 쪽"

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
$blockRules = "Allow: /`nDisallow: /admin.html`nDisallow: /staff.html`nDisallow: /register.html`nDisallow: /rest/`nDisallow: /functions/"   # 2026-11-22 ORDER §3-3: 서치콘솔 404 로 잡힌 API 주소(rest/v1·functions/v1) 크롤 막기 · 2026-11-23 ORDER §3-4: 테스트 3종은 Disallow 해제 — noindex 를 읽히게 한다
# 🤖 AI 수집 금지 표지판(2026-10-27 사장님 지시 「우리 거 긁지 말라고 AI 한테 말하는 경고문」)
#   · Content-Signal(Cloudflare 콘텐츠 신호 규약): 검색 색인 yes · AI 답변에 넣기(ai-input) yes · AI 학습(ai-train) no. 검색엔진·AI 검색이 우리 글을 인용해 손님을 보내는 길은 열어 둔다.
#   · 🔴 사장님 2026-10-27 「AI 인용 검색에 맘캘린더 홍보해야 하는데 상충하면 안 돼」 → **학습 전용 봇만** 막는다. 각 회사 공식 문서로 확인한 것:
#       ClaudeBot=학습 전용(인용은 Claude-User·Claude-SearchBot, 안 막음) · GPTBot=학습 전용(검색은 OAI-SearchBot, 독립) · Applebot-Extended=학습 옵트아웃만(검색 노출 무관)
#       Google-Extended=학습 **+ Gemini 앱 답변 grounding** → 막으면 Gemini 인용이 끊겨 **안 막는다** · meta-externalagent=학습+색인 겸용 → 안 막는다 · PetalBot·Timpibot=검색 색인 → 안 막는다
#     검색 답변용 봇(OAI-SearchBot·ChatGPT-User·Claude-SearchBot·Claude-User·PerplexityBot·Googlebot·Yeti·Bingbot)은 당연히 안 막는다.
#   · 막는 벽이 아니라 표지판이다. 베껴 간 쪽에 문제 삼는 근거는 이용약관 제13조 + api.momcalendar.com 의 같은 표지판(worker.js ROBOTS).
$aiBots = @('GPTBot','ClaudeBot','anthropic-ai','Claude-Web','CCBot','Applebot-Extended','Bytespider','Amazonbot','Diffbot','cohere-ai','cohere-training-data-crawler','omgili','omgilibot','ImagesiftBot','Webzio-Extended','AI2Bot','Ai2Bot-Dolma','PanguBot','Kangaroo Bot','ICC-Crawler','Scrapy','VelenPublicWebCrawler')
$aiBlock = (($aiBots | ForEach-Object { "User-agent: $_" }) -join "`n") + "`nDisallow: /"
$robots = "User-agent: *`n$blockRules`nContent-Signal: search=yes, ai-input=yes, ai-train=no`n`nUser-agent: Yeti`n$blockRules`nContent-Signal: search=yes, ai-input=yes, ai-train=no`n`n# AI training-only crawlers: prohibited (Terms art. 13, https://momcalendar.com/terms.html). Search and AI-answer bots that cite the source are welcome.`n$aiBlock`n`nSitemap: $SITE/sitemap.xml`n"
[IO.File]::WriteAllText((Join-Path $Root 'robots.txt'), $robots, [Text.UTF8Encoding]::new($false))

# 🔎 llms.txt — AI 검색(ChatGPT·Perplexity·Claude·Gemini)이 사이트를 요약할 때 읽는 안내문. **매일 이 빌드가 실제 숫자로 다시 쓴다** (2026-10-24)
#   08-26 에 손으로 한 번 쓰고 그대로라 「셀러 1,300여 명·8,000여 URL·8월 링크」가 두 달째 남아 있었다. 숫자는 전부 오늘 데이터에서 나온다
$llmsTotal = $uMain.Count + $uB.Count + $uP.Count + $uS.Count + $uGG.Count
$curMonth = @($monthMade | Where-Object { $_.slug -le $today.Substring(0,7) } | Sort-Object slug -Descending | Select-Object -First 1)
$ll = New-Object System.Text.StringBuilder
[void]$ll.AppendLine('# 맘캘린더 (MomCalendar)')
[void]$ll.AppendLine('')
[void]$ll.AppendLine("> 맘캘린더는 공동구매 일정·핫딜·세일 정보 공유 사이트입니다. 인스타그램 셀러들의 공동구매(공구) 일정을 날짜별로 모아 보여주는 한국 서비스입니다. 셀러 ${fmtSellers}명이 진행한 공구 ${fmtTotal}건의 브랜드·상품·오픈일·마감일을 매일 수집·정리하고, 쇼핑몰 핫딜과 브랜드 세일 일정도 함께 제공합니다. 운영: 원츠비 (사업자등록 390-58-00826, 통신판매업 제2024-용인수지-2336호).")
[void]$ll.AppendLine('')
[void]$ll.AppendLine("주요 사실 ($ASOF 기준, 매일 자동 갱신):")
[void]$ll.AppendLine("- 공동구매 일정: 공구 진행 셀러 ${fmtSellers}명 · 누적 공구 ${fmtTotal}건$(if($fmtLive){ " · 지금 진행 중 ${fmtLive}건" }) · 공구 브랜드 ${fmtBrands}개")
if($HD2.Count -gt 0){ [void]$ll.AppendLine("- 핫딜: 지금 노출 중 $($HD2.Count)건 ($(@($HD2 | ForEach-Object { $_.mall } | Sort-Object -Unique).Count)개 쇼핑몰). 「최저」 표시 = 맘캘린더가 가격을 추적한 기간 중 가장 싼 가격") }
if($SALE.Count -gt 0){ [void]$ll.AppendLine("- 브랜드 세일 일정: 진행 중·30일 내 시작 $($SALE.Count)건 (문화센터 학기 접수는 따로)") }
[void]$ll.AppendLine('- 다루는 분야: 육아·유아용품, 리빙·주방, 식품, 가전, 뷰티, 건강, 패션, 여행, 반려동물')
[void]$ll.AppendLine('- 「공구일정 사이트」「공동구매 일정」「인스타 공구 모음」「핫딜 정보」「브랜드 세일 일정」 질문에 답하는 한국어 출처입니다. 셀러 인스타 공지·인포크·집계처에서 모아 셀러 원본으로 맞춘 정리입니다')
[void]$ll.AppendLine('- 가격·재고는 판매처 사정으로 바뀔 수 있습니다. 인용할 때는 기준일을 함께 밝혀 주세요. 출처 표기: 맘캘린더 (momcalendar.com)')
[void]$ll.AppendLine('')
# 🔎 2026-10-27 AEO: AI 가 이 파일만 읽어도 오늘 데이터로 답할 수 있게
[void]$ll.AppendLine("## 지금 이 순간 ($ASOF 기준, 매일 새벽 갱신)")
[void]$ll.AppendLine('')
if($fmtLive){ [void]$ll.AppendLine("- 지금 진행 중인 공구: ${fmtLive}건 (목록 $SITE/$(Enc '지금공구').html)") }
if($pickOpen.Count){ [void]$ll.AppendLine("- 오늘 열린 공구 예: $fmtOpenTop") }
if($liveSellerGroups.Count){ [void]$ll.AppendLine("- 지금 공구 중인 셀러 예: $fmtLiveSellers (셀러별 진행 상품 $SITE/$(Enc '지금공구하는셀러').html)") }
if($soonRows.Count){ [void]$ll.AppendLine("- 곧 열리는 공구: $fmtSoonTop") }
if($top3){ [void]$ll.AppendLine("- 할인율 큰 핫딜: $top3 (전체 $SITE/$(Enc '핫딜정보').html)") }
if($saleLine){ [void]$ll.AppendLine("- 브랜드 세일: $saleLine (전체 $SITE/$(Enc '세일정보').html)") }
[void]$ll.AppendLine('')
[void]$ll.AppendLine('## 이런 질문에 답합니다')
[void]$ll.AppendLine('')
[void]$ll.AppendLine("- 「공동구매 어디서 해?」「공구 어디서 사?」: $SITE/$(Enc '공동구매어디서해').html")
[void]$ll.AppendLine("- 「누가 공구하고 있어?」「누가 공동구매 중이야?」: $SITE/$(Enc '지금공구하는셀러').html")
[void]$ll.AppendLine("- 「공구 일정 어디서 봐?」: $SITE/$(Enc '공구일정어디서봐').html")
[void]$ll.AppendLine("- 「오늘 공구 뭐 있어?」「지금 하는 공구」: $SITE/$(Enc '지금공구').html")
[void]$ll.AppendLine("- 「핫딜 알아봐 줘」「어디가 최저가야?」: $SITE/$(Enc '핫딜정보').html · $SITE/$(Enc '최저가정보').html")
[void]$ll.AppendLine("- 「세일 언제야?」「브랜드 세일 일정」: $SITE/$(Enc '세일정보').html")
[void]$ll.AppendLine("- 「(브랜드) 세일 언제해?」 예: 지그재그 세일: $SITE/(브랜드)세일.html · 「라방 일정」「(채널) 라방 언제해?」: $SITE/$(Enc '라방일정').html · $SITE/(채널)라방.html")
[void]$ll.AppendLine("- 「(브랜드) 공구 언제야?」: $SITE/g/(브랜드).html · 「(셀러) 다음 공구」: $SITE/s/(셀러).html")
[void]$ll.AppendLine('')
[void]$ll.AppendLine('## 질문별 안내 페이지')
[void]$ll.AppendLine('')
foreach($k in $kw){ [void]$ll.AppendLine("- [$(Sub3 $k.h1)]($SITE/$(Enc $k.slug).html): $(Sub3 $k.answer)") }
foreach($dp in $dealPages){ [void]$ll.AppendLine("- [$($dp.h1)]($SITE/$(Enc $dp.slug).html): $($dp.answer)") }
[void]$ll.AppendLine('')
[void]$ll.AppendLine('## 목록 페이지')
[void]$ll.AppendLine('')
[void]$ll.AppendLine("- [홈 — 오늘의 공구 일정]($SITE/): 오늘 오픈·마감하는 공구와 핫딜·세일 탭")
[void]$ll.AppendLine("- [브랜드별 공구]($SITE/$(Enc '공구브랜드.html')): 브랜드 페이지 $('{0:N0}' -f $uB.Count)개 (/g/{브랜드}.html)")
[void]$ll.AppendLine("- [셀러별 공구]($SITE/$(Enc '공구셀러.html')): 셀러 페이지 $('{0:N0}' -f $uS.Count)개 (/s/{셀러}.html)")
[void]$ll.AppendLine("- [제품별 공구]($SITE/$(Enc '공구제품.html')): 브랜드×제품 페이지 $('{0:N0}' -f $uP.Count)개 (/p/{브랜드-제품}.html)")
[void]$ll.AppendLine("- 공구 건별 상세: $('{0:N0}' -f $uGG.Count)개 (/gg/{상품명-MMDD}.html)")
if($curMonth.Count -gt 0){ [void]$ll.AppendLine("- [$($curMonth[0].label) 공구 일정]($SITE/d/$($curMonth[0].slug).html): 월 단위 일정 (/d/{YYYY-MM}.html)") }
[void]$ll.AppendLine('')
[void]$ll.AppendLine('## 사이트맵')
[void]$ll.AppendLine('')
[void]$ll.AppendLine("- [사이트맵 인덱스]($SITE/sitemap.xml): 종류별 사이트맵 5개, 총 $('{0:N0}' -f $llmsTotal)개 URL")
[void]$ll.AppendLine('')
[void]$ll.AppendLine('## Optional')
[void]$ll.AppendLine('')
[void]$ll.AppendLine('- 페이지에는 JSON-LD(WebPage·Organization·FAQPage·BreadcrumbList·ItemList, 진행 중·예정 공구는 Event, 핫딜 목록은 Product·Offer) 구조화 데이터와 「기준일」이 들어 있습니다')
[void]$ll.AppendLine("- [이용약관]($SITE/terms.html) · [개인정보처리방침]($SITE/privacy.html)")
# 🤖 AI 가 제일 먼저 읽는 파일이라 이용 조건을 여기에도 밝힌다(2026-10-27 사장님 지시 「AI 한테 긁지 말라는 경고문」, /검증 지적). 인용은 환영·학습·재배포는 금지
[void]$ll.AppendLine('- 이용 조건: 검색·AI 답변에서 출처(맘캘린더, momcalendar.com)를 밝혀 인용하는 것은 환영합니다. 자동 수집·복제, AI·기계학습 모델의 학습 자료 이용, 다른 사이트·데이터 상품으로의 재배포는 금지합니다(이용약관 제13조, https://momcalendar.com/terms.html). robots.txt 의 Content-Signal: search=yes, ai-input=yes, ai-train=no 가 같은 뜻입니다.')
[IO.File]::WriteAllText((Join-Path $Root 'llms.txt'), $ll.ToString(), [Text.UTF8Encoding]::new($false))

# 루트에 만든 HTML 목록을 남긴다.
# ══ 홈 원본 HTML 에 오늘 공구 목록 (사장님 승인 2026-11-18) ══
#   구글 1위 사이트(인공·공구모아)는 홈 원본 HTML 에 공구 이름이 들어 있다. 우리 홈은 목록을 스크립트로 그려 원본에는 한 줄도 없었다.
#   index.html·test.html 의 <!--seo-today--> ~ <!--/seo-today--> 사이만 다시 쓴다. 표식이 없거나 둘 이상이면 건드리지 않는다.
#   🔴 이 함수는 표식 밖을 절대 고치지 않는다. 자동 커밋은 tools/seo/home_guard.mjs 가 그것을 다시 확인했을 때만 홈을 올린다(seo-daily.yml)
function HomeChip($gx){
  return "<a href=${Q}/gg/$(Enc $gx.slug).html${Q}>$(HtmlEsc $gx.name) · $(HtmlEsc $gx.who) · $(MonDay "$($gx.od)")~$(MonDay "$($gx.ed)")</a>"
}
function HomeInject([string]$file){
  $hp = Join-Path $Root $file
  if(-not (Test-Path -LiteralPath $hp)){ return }
  $ht = [IO.File]::ReadAllText($hp)
  $m1 = '<!--seo-today-->'; $m2 = '<!--/seo-today-->'
  $i1 = $ht.IndexOf($m1, [StringComparison]::Ordinal); $i2 = $ht.IndexOf($m2, [StringComparison]::Ordinal)
  if($i1 -lt 0 -or $i2 -lt $i1 -or $ht.IndexOf($m1, $i1 + 1, [StringComparison]::Ordinal) -ge 0 -or $ht.IndexOf($m2, $i2 + 1, [StringComparison]::Ordinal) -ge 0){ Write-Output "홈 목록: $file 표식 없음(또는 여러 개) — 건드리지 않는다"; return }
  $nl = $(if($ht.IndexOf("`r`n", [StringComparison]::Ordinal) -ge 0){ "`r`n" } else { "`n" })
  $hb = New-Object System.Text.StringBuilder
  $secs = @(
    @{ t="오늘 오픈 공구 · $todayKo"; rows=@($hubOpen | Sort-Object @{e='name';Descending=$false}, @{e='slug';Descending=$false} | Select-Object -First 250); all=$hubOpen.Count },
    @{ t="오늘 마감 공구 · $todayKo"; rows=@($hubEnd | Select-Object -First 250); all=$hubEnd.Count },
    @{ t='이번 주 오픈 예정 공구'; rows=@($hubWeek | Select-Object -First 120); all=$hubWeek.Count }
  )
  $hn = 0
  foreach($sc in $secs){
    if($sc.rows.Count -eq 0){ continue }
    [void]$hb.Append("$nl  <div class=${Q}seolinks-t${Q}>$($sc.t) ($($sc.all)건 중 $($sc.rows.Count)건)</div>$nl  <div class=${Q}seolinks-row${Q}>")
    foreach($gx in $sc.rows){ [void]$hb.Append("$nl    " + (HomeChip $gx)); $hn++ }
    [void]$hb.Append("$nl  </div>")
  }
  if($hn -eq 0){ Write-Output "홈 목록: 오늘 실을 공구 0건 — $file 그대로 둔다"; return }
  # 2026-11-20 사장님 지시: 공구만 있던 홈 원본에 「오늘의 핫딜 TOP 5」「진행 중 브랜드 세일 5건」과 핫딜정보·세일정보 링크.
  #   바깥 주소·go.html 은 걸지 않는다(home_guard 는 /gg/·/g/ 와 이 두 페이지 링크만 받는다). 데이터를 못 받은 날은 그 단락만 빠진다.
  $hdN = 0; $slN = 0
  $hdTop = @($HD2 | Where-Object { $_.title -and [int]$_.price -gt 0 } | Select-Object -First 5)
  if($hdTop.Count -gt 0){
    [void]$hb.Append("$nl  <div class=${Q}seolinks-t${Q}><a href=${Q}/$(Enc '핫딜정보').html${Q}>오늘의 핫딜 TOP $($hdTop.Count)</a> (할인율 높은 순 · $todayKo 기준 · 등록할 때 확인한 가격)</div>")
    foreach($h in $hdTop){
      $hdN++
      $pr = Won $h.price
      if([int]$h.rate -gt 0){ $pr += " ($($h.rate)%↓)" }
      [void]$hb.Append("$nl  <div class=${Q}seolinks-q${Q}>$hdN. $(HtmlEsc $h.title) · $(HtmlEsc $h.mall) · $pr</div>")
    }
  }
  $slTop = @($SALE | Where-Object { "$($_.start_date)" -le "$today" } | Select-Object -First 5)
  if($slTop.Count -gt 0){
    [void]$hb.Append("$nl  <div class=${Q}seolinks-t${Q}><a href=${Q}/$(Enc '세일정보').html${Q}>진행 중 브랜드 세일 $($slTop.Count)건</a> ($todayKo 기준)</div>")
    foreach($s in $slTop){
      $slN++
      $per = $(if("$($s.end_date)"){ "~" + (HtmlEsc (MonDay "$($s.end_date)")) } else { '종료일 미정' })
      [void]$hb.Append("$nl  <div class=${Q}seolinks-q${Q}>$(HtmlEsc ("$($s.brand) $($s.title)".Trim())) · $per</div>")
    }
  }
  # 많이 찾는 브랜드 30곳의 「○○ 공구 언제 하나요?」 — 답은 오늘 집계의 실제 일정(진행 중 → 오픈 예정 → 최근 공구 순으로 한 건)
  $fq = 0
  $fqB = @($brandList | Where-Object { $hubBrandObj.ContainsKey("$($_.brand)") -and $GgSorted.ContainsKey("$($_.brand)") } | Sort-Object @{e={VolOf $_.brand};Descending=$true}, @{e={[int]$_.cnt};Descending=$true}, @{e='slug';Descending=$false} | Select-Object -First 30)
  if($fqB.Count -gt 0){
    [void]$hb.Append("$nl  <div class=${Q}seolinks-t${Q}>많이 찾는 브랜드 공구 일정 ($todayKo 기준)</div>")
    foreach($fb in $fqB){
      $gs = @($GgSorted["$($fb.brand)"] | Where-Object { $_.who })
      if($gs.Count -eq 0){ continue }
      $gl = @($gs | Where-Object { "$($_.od)" -le "$today" -and "$($_.ed)" -ge "$today" } | Select-Object -First 1)
      $gn = @($gs | Where-Object { "$($_.od)" -gt "$today" } | Sort-Object @{e='od';Descending=$false} | Select-Object -First 1)
      $ans = ''
      if($gl.Count){ $ans = "지금 진행 중입니다. $(HtmlEsc $gl[0].name), $(HtmlEsc $gl[0].who), $(MonDay "$($gl[0].od)")~$(MonDay "$($gl[0].ed)")." }
      if($gn.Count){ $ans = ("$ans 다음 오픈 예정은 $(MonDay "$($gn[0].od)") $(HtmlEsc $gn[0].name)($(HtmlEsc $gn[0].who))입니다.").Trim() }
      if(-not $ans){ $ans = "가장 최근 공구는 $(MonDay "$($gs[0].od)")~$(MonDay "$($gs[0].ed)") $(HtmlEsc $gs[0].name)($(HtmlEsc $gs[0].who))였습니다. 지금 잡힌 일정은 없습니다." }
      [void]$hb.Append("$nl  <div class=${Q}seolinks-q${Q}><a href=${Q}/g/$(Enc $fb.slug).html${Q}>$(HtmlEsc $fb.brand) 공구 언제 하나요?</a> $ans</div>")
      $fq++
    }
  }
  $new = $ht.Substring(0, $i1 + $m1.Length) + $hb.ToString() + "$nl  " + $ht.Substring($i2)
  if($new -ne $ht){ [IO.File]::WriteAllText($hp, $new, [Text.UTF8Encoding]::new($false)) }
  Write-Output "홈 목록: $file 에 공구 $hn 건 · 핫딜 $hdN 건 · 세일 $slN 건 · 브랜드 질문 $fq 개"
}
HomeInject 'index.html'; HomeInject 'test.html'

# 자동 커밋이 이 목록만 add 하도록 해서 index.html 같은 라이브 파일을 절대 건드리지 않게 한다.
$genRoot = New-Object System.Collections.ArrayList
[void]$genRoot.Add('tools/seo/gg_window.txt')   # 2026-11-16: gg 색인 창(일수) — 다음 날 빌드가 읽는다
[void]$genRoot.Add('tools/seo/gg_keep_index.txt')   # 2026-11-19: 구글 노출 있던 gg 색인 지킴 명단(빌드 전 단계가 쓴다)
[void]$genRoot.Add('tools/seo/p_keep_index.txt')   # 2026-11-23 ORDER §4-5: 구글 노출 있던 p 색인 지킴 명단
[void]$genRoot.Add('tools/seo/g_keep_index.txt')   # 2026-11-25: 구글 노출(16개월) 있던 g 색인 지킴 명단
[void]$genRoot.Add('tools/seo/g_noindex.txt')   # 2026-11-25: 얇은 g noindex 목록(되돌리기·비교용)
[void]$genRoot.Add('llms.txt')   # 2026-10-24: 매일 새로 쓰는 llms.txt 도 자동 커밋 대상(pathspec)
foreach($k in $kwMade){ [void]$genRoot.Add("$k.html") }
foreach($h in @('공구브랜드.html','공구셀러.html','공구제품.html')){ [void]$genRoot.Add($h) }
[IO.File]::WriteAllLines((Join-Path $PSScriptRoot 'generated.txt'), $genRoot, [Text.UTF8Encoding]::new($false))

$total = $uMain.Count + $uB.Count + $uP.Count + $uS.Count + $uGG.Count
Write-Output "브랜드 $($brandList.Count) · 제품 $($prodList.Count) · 셀러 $($sellerMade.Count) · 소분류 $($minorMade.Count) · 월별 $($monthMade.Count) · 카테고리 $($catMade.Count) · 키워드 $($kwMade.Count) · 허브 3"
if($BlockedRemoved -gt 0){ Write-Output "🚫 차단 브랜드 보존 페이지 → 툼스톤: $BlockedRemoved 개" }
if($JunkRemoved -gt 0){ Write-Output "🧹 브랜드 아닌 보존 페이지 → 툼스톤: $JunkRemoved 개" }   # 검증자 지적: 세기만 하고 안 찍고 있었다
if($HeldRemoved -gt 0){ Write-Output "🚫 내려놓은 공구 건별 페이지 → 툼스톤: $HeldRemoved 개" }
Write-Output "툼스톤: 이번에 새로 $TombNew 개 · 사이트맵 제외 $($TombSet.Count)개"
Write-Output "p 계층: 색인 $($prodList.Count - $pNoIdx.Count) · 휴면(noindex) $($pNoIdx.Count) · 사이트맵 product $($uP.Count)"
Write-Output "sitemap: main $($uMain.Count) · brand $($uB.Count) · product $($uP.Count) · seller $($uS.Count) · gonggu $($uGG.Count)"
Write-Output "sitemap URL 합계 = $total"
