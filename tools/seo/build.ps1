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
if($DataFile){
  $D = [IO.File]::ReadAllText($DataFile) | ConvertFrom-Json
} else {
  $api = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/rpc/seo_dataset'
  $key = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE'
  $r = Invoke-WebRequest -Uri $api -Method POST -TimeoutSec 180 `
        -Headers @{ apikey=$key; Authorization="Bearer $key"; 'Content-Type'='application/json' } -Body '{}'
  $D = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
}
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

# ── 폴더 초기화 (사라진 항목의 옛 페이지가 고아로 남지 않게) ──
# ⚠ 반복 변수를 $d 로 쓰면 안 된다. PowerShell 은 대소문자를 구분하지 않아
#   데이터가 담긴 $D 를 덮어써 버린다(실제로 한 번 당했다).
foreach($dir in @('g','p','s','m','d','c')){
  $pp = Join-Path $Root $dir
  if(Test-Path $pp){ Remove-Item $pp -Recurse -Force }
  New-Item -ItemType Directory -Path $pp | Out-Null
}

$liveRows = ParseRows $D.live @('name','who','od','ed','major')
$soonRows = ParseRows $D.soon @('name','who','od','ed','major')

# ══ 제품 슬러그 먼저 (브랜드 페이지에서 링크해야 하므로) ══
$seenP = @{}; $prodMap = @{}; $prodList = New-Object System.Collections.ArrayList
foreach($x in $D.products){
  $slug = SlugOf "$($x.brand)-$($x.prod)" $seenP '-p'
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
foreach($x in $D.brands){
  $slug = SlugOf $x.brand $seenB '-g'
  if([string]::IsNullOrWhiteSpace($slug)){ continue }
  [void]$brandList.Add([pscustomobject]@{ slug=$slug; brand=$x.brand; cnt=[int]$x.cnt; sellers=[int]$x.sellers;
       major=$x.major; first=$x.first_open; last=$x.last_open; topprods=$x.topprods; raw=$x.rows })
}
$brandSlug = @{}
foreach($b in $brandList){ if(-not $brandSlug.ContainsKey($b.brand)){ $brandSlug[$b.brand] = $b.slug } }
$topBrands = $brandList | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='brand';Descending=$false} | Select-Object -First 24

# ══ 셀러 슬러그 먼저 ══
# 카드에서 셀러 페이지로 링크하려면 주소를 미리 알아야 한다.
# ⚠ insta 를 그대로 쓰면 안 된다 — 셀러 페이지 파일명은 SlugOf 를 거친 값이라 다를 수 있고,
#   셀러 목록에 없는 insta 도 있다. 그대로 링크했다가 깨진 내부링크가 327개 났다(2026-08-11).
$seenS = @{}; $SellerSlug = @{}; $korCount = @{}; $korInsta = @{}
foreach($s in $D.sellers){
  $sl = SlugOf $s.insta $seenS '-s'
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

# ══ 브랜드 페이지 ══
foreach($b in $brandList){
  $rows = ParseRows $b.raw @('who','name','od','ed','insta')
  $sp = SplitNow $rows $today
  $live = $sp.now; $soon = $sp.soon; $past = $sp.past
  $tp = @(); if($b.topprods){ $tp = @($b.topprods -split '\|' | Where-Object { $_ -and $_ -ne $b.brand }) }
  $tpTxt = ''; if($tp.Count -gt 0){ $tpTxt = ($tp | Select-Object -First 3) -join '·' }

  if($tpTxt){
    $title = "$($b.brand) 공구 일정 | $tpTxt 공동구매 진행중인 곳 - 맘캘린더"
    $desc  = "$($b.brand) 공구 일정. $tpTxt 등 $($b.brand) 공동구매를 진행하는 인스타 셀러와 오픈·마감 날짜를 확인하세요."
  } else {
    $title = "$($b.brand) 공구 일정 | 공동구매 진행중인 곳 - 맘캘린더"
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
  $ex = ExtraBody $b.brand '브랜드' $live $soon $past
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
  WritePage @{ path=(Join-Path $Root "g/$($b.slug).html"); title=$title; desc=$desc; canon=$canon;
    h1="$($b.brand) 공구 일정"; sub="인스타 공동구매 일정"; body=$body; jsonld=$ld; bcName="$($b.brand) 공구" }
}

# ══ 브랜드 × 제품 페이지 ══
foreach($p in $prodList){
  $rows = ParseRows $p.raw @('name','who','od','ed','insta')
  $sp = SplitNow $rows $today
  $live = $sp.now; $soon = $sp.soon; $past = $sp.past
  $title = "$($p.key) 공구 | 공동구매 일정·진행중인 곳 - 맘캘린더"
  $desc  = "$($p.key) 공구 일정. 진행 중인 $($p.key) 공동구매와 지난 일정, 오픈·마감 날짜를 확인하세요."
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
  $ex = ExtraBody $p.key '제품' $live $soon $past
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

  $title = "$($s.kor)(@$($s.insta)) 공구 일정 | 인스타 공동구매 - 맘캘린더"
  $desc  = "$($s.kor)(@$($s.insta))의 인스타 공구 일정. 진행 중인 공동구매와 오픈·마감 날짜를 확인하세요."
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
  $ex = ExtraBody $s.kor '셀러' $live $soon $past
  $body += $ex.html
  $body += "<div class=${Q}sec${Q}><h2>인기 브랜드 공구</h2><div class=${Q}rel${Q}>"
  foreach($b in ($brandList | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='brand';Descending=$false} | Select-Object -First 20)){
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
  $ex = ExtraBody $m.minor '소분류' $live $soon $past
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
  $desc  = "$($c.n) 공동구매 일정을 한눈에. $($c.d) 공구를 진행하는 인스타 셀러와 기간을 확인하세요."
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
$topB = $brandList  | Sort-Object @{e={[int]$_.cnt};Descending=$true}, @{e='slug';Descending=$false} | Select-Object -First 30
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
    h1=(Sub3 $k.h1); sub=(Sub3 $k.sub); body=$body; jsonld=$ld; bcName=(Sub3 $k.h1) }
  [void]$kwMade.Add($k.slug)
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

# ══ sitemap · robots ══
function WriteSitemap([string]$file, $urls, [string]$pri, [string]$freq){
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('<?xml version="1.0" encoding="UTF-8"?>')
  [void]$sb.AppendLine('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
  foreach($u in $urls){ [void]$sb.AppendLine("<url><loc>$SITE/$u</loc><lastmod>$today</lastmod><changefreq>$freq</changefreq><priority>$pri</priority></url>") }
  [void]$sb.AppendLine('</urlset>')
  [IO.File]::WriteAllText((Join-Path $Root $file), $sb.ToString(), [Text.UTF8Encoding]::new($false))
}
$uMain = New-Object System.Collections.ArrayList
[void]$uMain.Add('')
foreach($k in $kwMade){ [void]$uMain.Add("$(Enc $k).html") }
foreach($h in @('공구브랜드.html','공구셀러.html','공구제품.html')){ [void]$uMain.Add((Enc $h)) }
foreach($c in $catMade){ [void]$uMain.Add("c/$(Enc $c).html") }
foreach($m in $monthMade){ [void]$uMain.Add("d/$($m.slug).html") }
foreach($m in $minorMade){ [void]$uMain.Add("m/$(Enc $m.slug).html") }
WriteSitemap 'sitemap-main.xml' $uMain '0.9' 'daily'
$uB = @(); foreach($b in $brandList){ $uB += "g/$(Enc $b.slug).html" }
WriteSitemap 'sitemap-brand.xml' $uB '0.7' 'weekly'
$uP = @(); foreach($p in $prodList){ $uP += "p/$(Enc $p.slug).html" }
WriteSitemap 'sitemap-product.xml' $uP '0.7' 'weekly'
$uS = @(); foreach($s in $sellerMade){ $uS += "s/$(Enc $s.slug).html" }
WriteSitemap 'sitemap-seller.xml' $uS '0.7' 'weekly'

$sm = New-Object System.Text.StringBuilder
[void]$sm.AppendLine('<?xml version="1.0" encoding="UTF-8"?>')
[void]$sm.AppendLine('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
foreach($f in @('sitemap-main.xml','sitemap-brand.xml','sitemap-product.xml','sitemap-seller.xml')){
  [void]$sm.AppendLine("<sitemap><loc>$SITE/$f</loc><lastmod>$today</lastmod></sitemap>")
}
[void]$sm.AppendLine('</sitemapindex>')
[IO.File]::WriteAllText((Join-Path $Root 'sitemap.xml'), $sm.ToString(), [Text.UTF8Encoding]::new($false))

$robots = "User-agent: *`nAllow: /`nDisallow: /admin.html`nDisallow: /staff.html`nDisallow: /register.html`nDisallow: /test.html`nDisallow: /kktest.html`n`nSitemap: $SITE/sitemap.xml`n"
[IO.File]::WriteAllText((Join-Path $Root 'robots.txt'), $robots, [Text.UTF8Encoding]::new($false))

# 루트에 만든 HTML 목록을 남긴다.
# 자동 커밋이 이 목록만 add 하도록 해서 index.html 같은 라이브 파일을 절대 건드리지 않게 한다.
$genRoot = New-Object System.Collections.ArrayList
foreach($k in $kwMade){ [void]$genRoot.Add("$k.html") }
foreach($h in @('공구브랜드.html','공구셀러.html','공구제품.html')){ [void]$genRoot.Add($h) }
[IO.File]::WriteAllLines((Join-Path $PSScriptRoot 'generated.txt'), $genRoot, [Text.UTF8Encoding]::new($false))

$total = $uMain.Count + $uB.Count + $uP.Count + $uS.Count
Write-Output "브랜드 $($brandList.Count) · 제품 $($prodList.Count) · 셀러 $($sellerMade.Count) · 소분류 $($minorMade.Count) · 월별 $($monthMade.Count) · 카테고리 $($catMade.Count) · 키워드 $($kwMade.Count) · 허브 3"
Write-Output "sitemap URL 합계 = $total"
