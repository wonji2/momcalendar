# IndexNow 로 색인 요청 (빙·네이버·야덱스 등이 받는다. 구글은 안 받는다)
#
#   pwsh tools/seo/indexnow.ps1              ← 사이트맵에서 **오늘 바뀐 주소만** 제출 (lastmod = 오늘)
#   pwsh tools/seo/indexnow.ps1 -All         ← sitemap 전체 제출(처음 한 번·크게 바꾼 날만)
#   pwsh tools/seo/indexnow.ps1 -Changed a,b ← 바뀐 URL 만 제출
#
# 키는 비밀이 아니다. 사이트 루트에 같은 이름의 .txt 로 올려 소유를 증명하는 방식이다.
param(
  [string]$Root = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [string[]]$Changed = @(),
  [switch]$All
)
$ErrorActionPreference = 'Stop'
$SITE = 'https://momcalendar.com'
$key  = ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'indexnow-key.txt'))).Trim()

$urls = New-Object System.Collections.ArrayList
$todayKst = [DateTime]::UtcNow.AddHours(9).ToString('yyyy-MM-dd')
if($Changed.Count -gt 0){
  foreach($u in $Changed){ if($u){ [void]$urls.Add($u) } }
} else {
  $idx = [xml][IO.File]::ReadAllText((Join-Path $Root 'sitemap.xml'))
  foreach($sm in $idx.sitemapindex.sitemap){
    $f = $sm.loc -replace '^https://momcalendar\.com/',''
    $p = Join-Path $Root $f
    if(-not(Test-Path -LiteralPath $p)){ continue }
    $x = [xml][IO.File]::ReadAllText($p)
    # 2026-11-16: 날마다 4만 주소를 통째로 보내고 있었다 — IndexNow 는 「바뀐 주소」를 알리는 규약이라 안 바뀐 주소를 계속 보내면 신호가 묽어진다(빙·네이버).
    #   사이트맵 lastmod 가 오늘인 주소만 보낸다(lastmod 는 build.ps1 이 본문이 실제로 바뀐 날로만 적는다).
    foreach($u in $x.urlset.url){ if($All -or "$($u.lastmod)" -eq $todayKst){ [void]$urls.Add($u.loc) } }
  }
}
Write-Output "제출 대상 $($urls.Count) URL$(if(-not $All -and $Changed.Count -eq 0){ " (오늘 $todayKst 바뀐 주소만)" })"
if($urls.Count -eq 0){ Write-Output '바뀐 주소 없음 — 제출 생략'; exit 0 }

# 규격상 10,000개까지지만 실측하니 큰 묶음은 403 이 났다. 500개씩 나눠 보낸다.
$batch = 500
$sent = 0; $okB = 0; $failB = 0
for($i=0; $i -lt $urls.Count; $i += $batch){
  $slice = @($urls[$i..([Math]::Min($i+$batch-1, $urls.Count-1))])
  $body = @{ host='momcalendar.com'; key=$key; keyLocation="$SITE/$key.txt"; urlList=$slice } | ConvertTo-Json -Depth 4 -Compress
  try{
    $r = Invoke-WebRequest -Uri 'https://api.indexnow.org/indexnow' -Method POST -TimeoutSec 120 `
          -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
    Write-Output "  $($slice.Count)건 → HTTP $($r.StatusCode)"
    $sent += $slice.Count; $okB++
  }catch{
    $sc = $null
    if($_.Exception.Response){ $sc = $_.Exception.Response.StatusCode.value__ }
    Write-Output "  $($slice.Count)건 → 실패 HTTP $sc"; $failB++
  }
  Start-Sleep -Milliseconds 700
}
Write-Output "제출 완료: $sent / $($urls.Count) (묶음 성공 $okB · 실패 $failB)"
