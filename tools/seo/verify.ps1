# 생성 결과 역검증 (다른 사람이 만든 코드라고 보고 흠을 찾는다)
$ErrorActionPreference = 'Stop'
$root = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
$fail = New-Object System.Collections.ArrayList
function Bad([string]$m){ [void]$fail.Add($m) }

# 대상 파일 모으기
$files = New-Object System.Collections.ArrayList
foreach($d in @('g','p','s','m','d','c','gg')){
  foreach($f in (Get-ChildItem (Join-Path $root $d) -Filter *.html -File)){ [void]$files.Add($f.FullName) }
}
$kw = ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'keywords.json')) | ConvertFrom-Json).pages
foreach($k in $kw){ [void]$files.Add((Join-Path $root "$($k.slug).html")) }
foreach($h in @('공구브랜드.html','공구셀러.html','공구제품.html')){ [void]$files.Add((Join-Path $root $h)) }
Write-Output "검사 대상: $($files.Count) 파일"

# 1) 구조 · JSON-LD · 플레이스홀더
$titles = @{}
$ldCnt = 0; $ldBad = 0; $noDesc = 0; $emptyBody = 0; $mojiCnt = 0
$gaBad = 0; $noaiCnt = 0; $tombCnt = 0
$sample = 0
foreach($p in $files){
  if(-not (Test-Path -LiteralPath $p)){ Bad "없는 파일: $p"; continue }
  $t = [IO.File]::ReadAllText($p)
  if($t -match '__TOTAL__|__SELLERS__|__BRANDS__'){ Bad "치환 안 된 자리표시자: $(Split-Path $p -Leaf)" }
  # PowerShell 은 한글도 변수명으로 받는다. "$yy년" 처럼 쓰면 통째로 빈 값이 되어
  # 제목에 구멍이 뚫린다(실제로 당했다). 값이 빠진 흔적을 전수로 잡는다.
  if($t -match '<title>\s|목록\s+개|목록\s+명|<title>[^<]*\s{2,}'){ Bad "제목에 빈 값이 있다(변수 보간 실패 의심): $(Split-Path $p -Leaf)" }
  # 2026-10-24: 숫자가 빠지고 단위만 남은 자리 — 「누적 건」「최저가 핫딜 건·」(같은 함정: "$lowN건" 이 변수 「lowN건」 이 됐다)
  if($t -match '<dd>\s*(누적\s*)?(건|명|개|곳)</dd>|<title>[^<]*[가-힣] (건|명|개|곳)[·,)]'){ Bad "숫자가 빠진 단위가 있다(변수 보간 실패 의심): $(Split-Path $p -Leaf)" }
  if($t -match '<h1>\s*</h1>|<h1>\s'){ Bad "h1 이 비었다: $(Split-Path $p -Leaf)" }
  if($t -notmatch '<title>(.+?)</title>'){ Bad "title 없음: $(Split-Path $p -Leaf)" }
  else {
    $ti = [regex]::Match($t,'<title>(.*?)</title>').Groups[1].Value
    if($titles.ContainsKey($ti)){ $titles[$ti] = [int]$titles[$ti] + 1 } else { $titles[$ti] = 1 }
    if($ti.Length -lt 10){ Bad "title 너무 짧음: $(Split-Path $p -Leaf)" }
  }
  $dm = [regex]::Match($t,'name="description" content="(.*?)"')
  if(-not $dm.Success -or $dm.Groups[1].Value.Length -lt 30){ $noDesc++ }
  if($t -notmatch 'rel="canonical"'){ Bad "canonical 없음: $(Split-Path $p -Leaf)" }
  # 2026-11-16: GA4 는 페이지마다 정확히 한 번(스니펫 기준 — 측정 ID 글자는 스니펫 한 벌에 두 번 나온다). 툼스톤(바로 넘기는 쪽지)은 예외.
  #   noai 메타는 걷어냈다(AI 인용 환영 신호와 부딪힌다) — 다시 들어오면 잡는다
  $isTomb = ($t.IndexOf('http-equiv="refresh"', [StringComparison]::Ordinal) -ge 0 -and $t -match '<meta name="robots" content="[^"]*noindex')
  if($isTomb){ $tombCnt++ }
  else {
    $gaN = ([regex]::Matches($t, 'googletagmanager\.com/gtag/js\?id=G-NRCP2FVRSB')).Count
    if($gaN -ne 1){ $gaBad++; if($gaBad -le 5){ Bad "GA4 스니펫이 $gaN 번: $(Split-Path $p -Leaf)" } }
    if($t -match '<meta name="robots" content="[^"]*noai'){ $noaiCnt++; if($noaiCnt -le 5){ Bad "noai 메타가 남아 있다: $(Split-Path $p -Leaf)" } }
  }
  # 본문 실질 내용
  $bodyTxt = [regex]::Replace($t,'(?s)<script.*?</script>','')
  $bodyTxt = [regex]::Replace($bodyTxt,'(?s)<style.*?</style>','')
  $bodyTxt = [regex]::Replace($bodyTxt,'<[^>]+>',' ')
  $bodyTxt = [regex]::Replace($bodyTxt,'\s+',' ').Trim()
  if($bodyTxt.Length -lt 250){ $emptyBody++ }
  # 글자 깨짐(이중인코딩) — DB 값이 깨져 있으면 페이지에 그대로 실려 나간다.
  # 2026-08-11: DB 는 09시에 고쳤는데 캐시가 04:20 것이라 셀러 페이지에 깨진 글자가 남았고,
  #             사장님이 화면에서 발견하셨다. 그때 verify 는 통과했다 — 이 검사가 없었다.
  # ⚠ 정규식에 악센트 문자를 직접 쓰지 말 것. PowerShell 이 .ps1 을 읽을 때 깨져 항상 거짓이 된다.
  # ⚠ '연속 2자' 로 잡아도 안 된다. 깨진 글자는 0xEB 0xA6 0xAC 처럼
  #    악센트 문자(0xC0-0xFF)와 그 아래 범위(0x80-0xBF)가 번갈아 나온다. 그 쌍을 본다.
  # ⚠ 곱셈기호 ×(0xD7)·÷(0xF7) 는 정상 상품명에 쓰이므로 범위에서 뺀다.
  if($bodyTxt -cmatch '[\xC0-\xD6\xD8-\xF6\xF8-\xFF][\x80-\xBF]'){
    $mojiCnt++
    if($mojiCnt -le 5){ Bad "글자 깨짐(이중인코딩): $(Split-Path $p -Leaf)" }
  }
  # JSON-LD 파싱
  foreach($m in [regex]::Matches($t,'(?s)<script type="application/ld\+json">(.*?)</script>')){
    $ldCnt++
    try{ $null = $m.Groups[1].Value | ConvertFrom-Json }catch{ $ldBad++; if($ldBad -le 3){ Bad "JSON-LD 깨짐: $(Split-Path $p -Leaf)" } }
  }
  # div 균형 (표본만 — 전수는 느림)
  if($sample -lt 400){
    $o = ([regex]::Matches($t,'<div\b')).Count
    $c = ([regex]::Matches($t,'</div>')).Count
    if($o -ne $c){ Bad "div 불균형($o/$c): $(Split-Path $p -Leaf)" }
    $sample++
  }
}
Write-Output "JSON-LD: $ldCnt 개 중 깨진 것 $ldBad"
Write-Output "설명문 부실: $noDesc / 본문 250자 미만: $emptyBody / 글자깨짐: $mojiCnt"
Write-Output "GA4 스니펫 1회 아님: $gaBad / noai 메타 남음: $noaiCnt / 툼스톤: $tombCnt"

$dup = $titles.GetEnumerator() | Where-Object { $_.Value -gt 1 } | Sort-Object Value -Descending
Write-Output "중복 title: $($dup.Count) 종류"
foreach($d in ($dup | Select-Object -First 5)){ Write-Output "   [$($d.Value)회] $($d.Key)" }

# 2) sitemap 유효성 + 실제 파일 존재 대조
$idx = [xml][IO.File]::ReadAllText((Join-Path $root 'sitemap.xml'))
$smFiles = @($idx.sitemapindex.sitemap | ForEach-Object { ($_.loc -replace '^https://momcalendar\.com/','') })
Write-Output "sitemap index: $($smFiles.Count) 개"
$allUrl = New-Object System.Collections.ArrayList
foreach($sf in $smFiles){
  $fp = Join-Path $root $sf
  if(-not(Test-Path $fp)){ Bad "sitemap 파일 없음: $sf"; continue }
  $x = [xml][IO.File]::ReadAllText($fp)
  foreach($u in $x.urlset.url){ [void]$allUrl.Add($u.loc) }
}
Write-Output "sitemap URL 합계: $($allUrl.Count)"

$miss = 0
foreach($u in $allUrl){
  $rel = $u -replace '^https://momcalendar\.com/',''
  if($rel -eq ''){ continue }
  $dec = [uri]::UnescapeDataString($rel)
  if(-not(Test-Path -LiteralPath (Join-Path $root $dec))){
    $miss++
    if($miss -le 5){ Bad "sitemap 에 있으나 파일 없음: $dec" }
  }
}
Write-Output "sitemap→파일 누락: $miss"

# 3) 파일 → sitemap 누락 (고아 페이지)
#    + 2026-11-16 (ORDER_SEO_AEO_GEO_RECOVERY §4-3): 사이트맵에서 **일부러 뺀** 페이지는 고아가 아니다 —
#      장기 마감 공구(gg C 계층)와 툼스톤은 noindex,follow 를 달고 사이트맵에서 빠진다. 이 예외가 없으면 사이트맵을 줄이는 순간 매일 커밋이 막힌다.
#      색인 대상(noindex 없음)인데 사이트맵에 없는 페이지만 문제로 본다.
$urlSet = @{}
foreach($u in $allUrl){ $rel2 = $u -replace '^https://momcalendar\.com/','' ; $urlSet[[uri]::UnescapeDataString($rel2)] = 1 }
$orphanIndexable = 0; $orphanNoindex = 0; $noindexInSitemap = 0
$noidxByDir = @{}; $filesByDir = @{}
foreach($p in $files){
  $rel = $p.Substring($root.Length+1).Replace('\','/')
  $dir0 = $(if($rel.Contains('/')){ $rel.Split('/')[0] } else { '(루트)' })
  $filesByDir[$dir0] = 1 + [int]$filesByDir[$dir0]
  if(-not (Test-Path -LiteralPath $p)){ continue }
  $isNo = ([IO.File]::ReadAllText($p) -match '<meta name="robots" content="[^"]*noindex')
  if($isNo){ $noidxByDir[$dir0] = 1 + [int]$noidxByDir[$dir0] }
  if($urlSet.ContainsKey($rel)){
    if($isNo){ $noindexInSitemap++; if($noindexInSitemap -le 5){ Bad "noindex 페이지가 사이트맵에 있다: $rel" } }
    continue
  }
  if($isNo){ $orphanNoindex++ }
  else { $orphanIndexable++; if($orphanIndexable -le 5){ Bad "sitemap 에 빠진 페이지: $rel" } }
}
Write-Output "사이트맵 누락 — 의도된 제외(noindex): $orphanNoindex / 색인 대상인데 누락: $orphanIndexable"
if($orphanIndexable -gt 0){ Bad "색인 대상 페이지가 사이트맵에서 빠졌다 ($orphanIndexable 장)" }
if($noindexInSitemap -gt 0){ Bad "noindex 페이지가 사이트맵에 실렸다 ($noindexInSitemap 장)" }
# 가드 — 규칙이 무너지는 사고를 막는다.
#   ① 템플릿 사고(전 페이지 noindex): gg 말고 다른 폴더는 툼스톤 몇 장 말고는 noindex 가 없어야 한다 → 폴더마다 5% 를 넘으면 실패.
#      (지시서 초안은 「noindex 합계 24,000 초과」였는데, gg 가 달마다 7천 장씩 늘어 한두 달 뒤 정상 상태에서도 걸려 매일 커밋이 막힌다 → 비율로 바꿨다)
#   ② 슬림화 회귀: sitemap-gonggu 가 13,000 을 넘으면 실패(빌드가 12,000 에 맞춰 창을 스스로 줄이므로 정상이면 안 넘는다)
#   ③ 과도 축소: 3,000 미만이면 gg 데이터 생성 실패로 본다
foreach($dk in @($filesByDir.Keys)){
  if($dk -eq 'gg'){ continue }
  $nn = [int]$noidxByDir[$dk]; $tt = [int]$filesByDir[$dk]
  if($nn -gt [Math]::Max(30, [int]($tt * 0.05))){ Bad "noindex 페이지가 $dk 폴더에 $nn / $tt 장 — 템플릿 사고 의심(전 페이지 noindex)" }
}
$ggSm = @($allUrl | Where-Object { $_ -match '/gg/' }).Count
Write-Output "sitemap-gonggu: $ggSm URL · gg noindex $([int]$noidxByDir['gg']) / $([int]$filesByDir['gg']) 장"
if($ggSm -gt 13000){ Bad "sitemap-gonggu $ggSm URL — 슬림화 회귀(목표 12,000 이하)" }
if($ggSm -lt 3000){ Bad "sitemap-gonggu $ggSm URL — 과도 축소, gg 데이터 생성 실패 의심" }

# 4) 내부 링크 무결성 (전수 — 2026-10-01 사장님 지시 "다 고쳐놔")
#    🔴 여기는 표본 300장이었다. 깨진 링크 22건이 남아 있어도 **걸리는 날과 아닌 날이 갈렸고**(실측 22.7%),
#       걸린 날은 그날 갱신이 통째로 막혔다(9/23·9/26·9/30). 사장님이 로슬러 페이지가 9/29 에 굳은 걸
#       발견하실 때까지 아무도 몰랐다. 하루치 갱신을 주사위에 맡기지 않는다 → 전수로 본다.
#    같은 주소는 한 번만 확인한다(링크가 60만 개라 매번 Test-Path 하면 느리다).
$pathSeen = @{}
$brokenL = 0; $checked = 0
foreach($p in $files){
  $t = [IO.File]::ReadAllText($p)
  foreach($m in [regex]::Matches($t,'href="/([^"#]+)"')){
    $h = [uri]::UnescapeDataString($m.Groups[1].Value)
    # 2026-11-16: /?q=브랜드 (사이트 검색 딥링크 — 페이지 아래 「찾아보기」 버튼)는 파일이 아니라 홈의 쿼리다 → 쿼리는 떼고 본다
    $h = ($h -split '\?')[0]
    if($h -eq ''){ continue }
    $checked++
    if(-not $pathSeen.ContainsKey($h)){ $pathSeen[$h] = (Test-Path -LiteralPath (Join-Path $root $h)) }
    if(-not $pathSeen[$h]){
      $brokenL++
      if($brokenL -le 5){ Bad "깨진 내부링크: /$h  (in $(Split-Path $p -Leaf))" }
    }
  }
}
Write-Output "내부링크 검사 $checked 개 중 깨진 것 $brokenL"

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

Write-Output ''
if($fail.Count -eq 0){ Write-Output '=== 통과: 문제 없음' }
else {
  Write-Output "=== 문제 $($fail.Count) 건"
  foreach($f in ($fail | Select-Object -First 30)){ Write-Output "  - $f" }
}
