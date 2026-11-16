# 404 주소에 툼스톤(넘김 쪽지) 놓기 (2026-11-16, orders/ORDER_SEO_AEO_GEO_RECOVERY.md §8-1)
#
#   pwsh tools/seo/tombstone.ps1 -Csv tools/seo/gsc_404.csv            ← 서치콘솔 「찾을 수 없음(404)」 목록으로 채운다
#   pwsh tools/seo/tombstone.ps1 -Csv tools/seo/gsc_404.csv -DryRun    ← 만들 수만 센다
#
# 왜: 이 사이트는 GitHub Pages 라 서버 301 을 못 한다. 없어진 주소에는 200 + noindex + canonical + meta refresh 쪽지를 둔다(구글은 meta refresh 0 을 넘김으로 따라간다).
# CSV: 첫 칸이 주소(https://momcalendar.com/… 또는 /g/….html 꼴). 머리줄·둘째 칸(유형)은 있어도 없어도 된다.
# 규칙:
#   · 지금 파일이 살아 있으면(툼스톤 아님) 건드리지 않는다 — 404 가 아니다.
#   · g/…  → /공구브랜드.html   · gg/… → /지금공구.html   · p/… → /공구제품.html   · s/… → /공구셀러.html   · m·d·c·루트 .html → /
#   · 쪽지에는 브랜드·상품 이름을 쓰지 않는다(지워 달라고 한 브랜드의 흔적을 남기지 않는다).
#   · .html 로 끝나는 사이트 안 주소만. 끝 슬래시·쿼리·대문자 확장자·폴더 밖(..)은 건너뛰고 건수만 알린다(추측으로 채우지 않는다).
#   · 라이브 파일(index·admin·staff·test·test-app·register·kktest·reelcard)은 절대 쓰지 않는다.
# CSV 가 없으면 아무것도 하지 않는다(서치콘솔 목록 없이 404 를 추측하지 않는다).
# ⚠ 루트(.html)에 만든 쪽지는 매일 자동 커밋 목록(g p s m d c gg)에 없으니 손으로 커밋한다.
# 한글 리터럴이 있으므로 이 파일은 UTF-8 BOM 으로 저장한다.
param(
  [string]$Root = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [string]$Csv = '',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')

if(-not $Csv -or -not (Test-Path -LiteralPath $Csv)){
  Write-Output "404 목록(CSV)이 없다 — 아무것도 하지 않는다. 서치콘솔 「찾을 수 없음(404)」 목록을 tools/seo/gsc_404.csv 로 받아 -Csv 로 넘긴다."
  exit 0
}
$LIVE = @('index.html','admin.html','staff.html','test.html','test-app.html','register.html','kktest.html','reelcard.html')
$DESTMAP = @{ g=(Enc '공구브랜드.html'); gg=(Enc '지금공구.html'); p=(Enc '공구제품.html'); s=(Enc '공구셀러.html') }

$made = 0; $alive = 0; $already = 0; $skip = 0; $skipList = New-Object System.Collections.ArrayList
foreach($line in [IO.File]::ReadAllLines($Csv)){
  $cell = ("$line" -split ',')[0].Trim().Trim('"')
  if(-not $cell -or $cell -notmatch 'momcalendar\.com/|^/'){ continue }      # 머리줄·빈 줄
  $rel = $cell -replace '^https?://(www\.)?momcalendar\.com/','' -replace '^/',''
  $rel = ($rel -split '[?#]')[0]
  try{ $rel = [uri]::UnescapeDataString($rel) }catch{}
  $rel = $rel.Replace('\','/')
  $parts = @($rel -split '/')
  $ok = ($rel -cmatch '\.html$') -and (-not $rel.Contains('..')) -and ($parts.Count -le 2) -and ($rel -notmatch '[<>:"|*]')
  if($ok -and $parts.Count -eq 2 -and @('g','gg','p','s','m','d','c') -notcontains $parts[0]){ $ok = $false }
  if($ok -and $parts.Count -eq 1 -and $LIVE -contains $parts[0].ToLower()){ $ok = $false }
  if(-not $ok){ $skip++; if($skipList.Count -lt 8){ [void]$skipList.Add($cell) }; continue }
  $fp = Join-Path $Root $rel
  if(Test-Path -LiteralPath $fp){
    if(IsTombstoneText ([IO.File]::ReadAllText($fp))){ $already++ } else { $alive++ }
    continue
  }
  $dest = $(if($parts.Count -eq 2 -and $DESTMAP.ContainsKey($parts[0])){ $DESTMAP[$parts[0]] } else { '' })
  if($dest -and -not (Test-Path -LiteralPath (Join-Path $Root ([uri]::UnescapeDataString($dest))))){ $dest = '' }
  if(-not $DryRun){
    $dir = Split-Path $fp -Parent
    if(-not (Test-Path -LiteralPath $dir)){ $skip++; continue }
    [IO.File]::WriteAllText($fp, (TombstoneHtml $dest), [Text.UTF8Encoding]::new($false))
  }
  $made++
}
Write-Output "툼스톤 $(if($DryRun){ '만들 예정' } else { '만듦' }) $made / 이미 툼스톤 $already / 살아 있는 페이지라 그대로 둠 $alive / 규칙 밖이라 건너뜀 $skip"
foreach($s0 in $skipList){ Write-Output "  건너뜀: $s0" }
