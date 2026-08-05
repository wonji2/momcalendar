# IndexNow 로 색인 요청 (빙·네이버·야덱스 등이 받는다. 구글은 안 받는다)
#
#   pwsh tools/seo/indexnow.ps1              ← sitemap 전체 제출
#   pwsh tools/seo/indexnow.ps1 -Changed a,b ← 바뀐 URL 만 제출
#
# 키는 비밀이 아니다. 사이트 루트에 같은 이름의 .txt 로 올려 소유를 증명하는 방식이다.
param(
  [string]$Root = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [string[]]$Changed = @()
)
$ErrorActionPreference = 'Stop'
$SITE = 'https://momcalendar.com'
$key  = ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'indexnow-key.txt'))).Trim()

$urls = New-Object System.Collections.ArrayList
if($Changed.Count -gt 0){
  foreach($u in $Changed){ if($u){ [void]$urls.Add($u) } }
} else {
  $idx = [xml][IO.File]::ReadAllText((Join-Path $Root 'sitemap.xml'))
  foreach($sm in $idx.sitemapindex.sitemap){
    $f = $sm.loc -replace '^https://momcalendar\.com/',''
    $p = Join-Path $Root $f
    if(-not(Test-Path -LiteralPath $p)){ continue }
    $x = [xml][IO.File]::ReadAllText($p)
    foreach($u in $x.urlset.url){ [void]$urls.Add($u.loc) }
  }
}
Write-Output "제출 대상 $($urls.Count) URL"

# 한 번에 10,000개까지. 넉넉히 나눠 보낸다.
$batch = 8000
$sent = 0
for($i=0; $i -lt $urls.Count; $i += $batch){
  $slice = @($urls[$i..([Math]::Min($i+$batch-1, $urls.Count-1))])
  $body = @{ host='momcalendar.com'; key=$key; keyLocation="$SITE/$key.txt"; urlList=$slice } | ConvertTo-Json -Depth 4 -Compress
  try{
    $r = Invoke-WebRequest -Uri 'https://api.indexnow.org/indexnow' -Method POST -TimeoutSec 120 `
          -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
    Write-Output "  $($slice.Count)건 → HTTP $($r.StatusCode)"
    $sent += $slice.Count
  }catch{
    $sc = $null
    if($_.Exception.Response){ $sc = $_.Exception.Response.StatusCode.value__ }
    Write-Output "  $($slice.Count)건 → 실패 HTTP $sc"
  }
}
Write-Output "제출 완료: $sent / $($urls.Count)"
