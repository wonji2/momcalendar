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
$sample = 0
foreach($p in $files){
  if(-not (Test-Path -LiteralPath $p)){ Bad "없는 파일: $p"; continue }
  $t = [IO.File]::ReadAllText($p)
  if($t -match '__TOTAL__|__SELLERS__|__BRANDS__'){ Bad "치환 안 된 자리표시자: $(Split-Path $p -Leaf)" }
  # PowerShell 은 한글도 변수명으로 받는다. "$yy년" 처럼 쓰면 통째로 빈 값이 되어
  # 제목에 구멍이 뚫린다(실제로 당했다). 값이 빠진 흔적을 전수로 잡는다.
  if($t -match '<title>\s|목록\s+개|목록\s+명|<title>[^<]*\s{2,}'){ Bad "제목에 빈 값이 있다(변수 보간 실패 의심): $(Split-Path $p -Leaf)" }
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
$urlSet = @{}
foreach($u in $allUrl){ $rel2 = $u -replace '^https://momcalendar\.com/','' ; $urlSet[[uri]::UnescapeDataString($rel2)] = 1 }
$orphan = 0
foreach($p in $files){
  $rel = $p.Substring($root.Length+1).Replace('\','/')
  if(-not $urlSet.ContainsKey($rel)){ $orphan++; if($orphan -le 5){ Bad "sitemap 에 빠진 페이지: $rel" } }
}
Write-Output "sitemap 누락(고아): $orphan"

# 4) 내부 링크 무결성 (표본 300개 파일)
$brokenL = 0; $checked = 0
foreach($p in ($files | Get-Random -Count ([Math]::Min(300,$files.Count)))){
  $t = [IO.File]::ReadAllText($p)
  foreach($m in [regex]::Matches($t,'href="/([^"#]+)"')){
    $h = [uri]::UnescapeDataString($m.Groups[1].Value)
    if($h -eq ''){ continue }
    $checked++
    if(-not(Test-Path -LiteralPath (Join-Path $root $h))){
      $brokenL++
      if($brokenL -le 5){ Bad "깨진 내부링크: /$h  (in $(Split-Path $p -Leaf))" }
    }
  }
}
Write-Output "내부링크 검사 $checked 개 중 깨진 것 $brokenL"

# 5) robots
$rb = [IO.File]::ReadAllText((Join-Path $root 'robots.txt'))
if($rb -notmatch 'Sitemap: https://momcalendar\.com/sitemap\.xml'){ Bad 'robots.txt 에 sitemap 없음' }
foreach($d in @('/admin.html','/staff.html','/test.html')){
  if($rb -notmatch [regex]::Escape("Disallow: $d")){ Bad "robots.txt 에 $d 차단 없음" }
}

Write-Output ''
if($fail.Count -eq 0){ Write-Output '=== 통과: 문제 없음' }
else {
  Write-Output "=== 문제 $($fail.Count) 건"
  foreach($f in ($fail | Select-Object -First 30)){ Write-Output "  - $f" }
}
