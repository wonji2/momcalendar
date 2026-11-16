# 보존 페이지 1회성 손질 — GA4 넣기 + noai 메타 걷기 (2026-11-16, orders/ORDER_SEO_AEO_GEO_RECOVERY.md §6-2)
#
#   pwsh tools/seo/patch_kept_once.ps1                 ← 전체 1회 실행
#   pwsh tools/seo/patch_kept_once.ps1 -Dir gg         ← 폴더 하나만(g p s m d c gg root)
#   pwsh tools/seo/patch_kept_once.ps1 -Dir gg -Limit 14000   ← 그 폴더에서 N 장까지만(큰 폴더를 나눠 올릴 때)
#   pwsh tools/seo/patch_kept_once.ps1 -DryRun         ← 바뀔 파일 수만 센다(쓰지 않는다)
#
# 왜: 한 번 만든 페이지는 지우지 않는다(보존 원칙). 오늘 집계에 없는 옛 페이지는 다시 만들어지지 않아서 템플릿만 고쳐서는 GA4 가 안 붙는다.
# 무엇을: ① 구글 애널리틱스(G-NRCP2FVRSB) 스니펫이 없으면 </head> 앞에 넣는다 ② robots 메타의 noai·noimageai 를 뗀다.
#         noindex 가 이미 있는 페이지의 robots 는 건드리지 않는다. 툼스톤(바로 넘기는 쪽지)은 건드리지 않는다. 바뀐 게 없으면 쓰지 않는다(여러 번 돌려도 같다).
# 손질 규칙은 lib.ps1 의 PatchHeadText 한 곳에 있다 — 매일 빌드(build.ps1)도 같은 함수를 쓴다(이 도구를 안 돌려도 다음 빌드가 마저 한다).
# 🔴 라이브 파일(index·admin·staff·test·test-app·register·kktest·reelcard)은 대상에서 뺀다(고정 규칙 0-A).
# 한글 리터럴이 있으므로 이 파일은 UTF-8 BOM 으로 저장한다.
param(
  [string]$Root = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [string]$Dir = '',
  [switch]$DryRun,
  [int]$Limit = 0
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')

$LIVE = @('index.html','admin.html','staff.html','test.html','test-app.html','register.html','kktest.html','reelcard.html')
$ALL  = @('g','p','s','m','d','c','gg','root')
$want = $(if($Dir){ @($Dir.Trim().ToLower()) } else { $ALL })
foreach($w in $want){ if($ALL -notcontains $w){ throw "모르는 폴더: $w (쓸 수 있는 값: $($ALL -join ' '))" } }

$targets = New-Object System.Collections.ArrayList
foreach($w in $want){
  if($w -eq 'root'){
    # 루트의 생성물(키워드 랜딩·허브 3종 등)은 tools/seo/generated.txt 에 적힌 것만
    $gf = Join-Path $PSScriptRoot 'generated.txt'
    if(Test-Path $gf){
      foreach($l in [IO.File]::ReadAllLines($gf)){
        $n = $l.Trim()
        if(-not $n -or $n -notmatch '\.html$' -or $n.Contains('/') -or $n.Contains('\') -or $n.Contains('..')){ continue }
        if($LIVE -contains $n.ToLower()){ continue }
        $fp = Join-Path $Root $n
        if(Test-Path -LiteralPath $fp){ [void]$targets.Add($fp) }
      }
    }
  } else {
    $dp = Join-Path $Root $w
    if(Test-Path $dp){ foreach($fp in [IO.Directory]::EnumerateFiles($dp, '*.html')){ [void]$targets.Add($fp) } }
  }
}

$patched = 0; $skipped = 0; $failed = 0; $failList = New-Object System.Collections.ArrayList
foreach($fp in $targets){
  if($Limit -gt 0 -and $patched -ge $Limit){ break }
  try{
    $t = [IO.File]::ReadAllText($fp)
    $t2 = PatchHeadText $t
    if($t2 -eq $t){ $skipped++; continue }
    if(-not $DryRun){ [IO.File]::WriteAllText($fp, $t2, [Text.UTF8Encoding]::new($false)) }
    $patched++
  }catch{
    $failed++
    if($failList.Count -lt 5){ [void]$failList.Add("$fp — $($_.Exception.Message)") }
  }
}
Write-Output "대상 $($targets.Count) 파일 ($($want -join ' '))$(if($DryRun){ ' · 세기만 함(쓰지 않음)' })"
Write-Output "패치 $patched / 건너뜀 $skipped / 실패 $failed"
foreach($f in $failList){ Write-Output "  실패: $f" }
if($failed -gt 0){ exit 1 }
