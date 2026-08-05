# 검색 노출용 정적 페이지 생성기 (사장님 지시 2026-08-05)
$ErrorActionPreference = 'Stop'
$root = "C:\Users\FAMILY\Desktop\맘캘린더\사이트\MOMCALENDAR"
$outDir = Join-Path $root "g"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$json = [IO.File]::ReadAllText((Join-Path $root "scratchpad\seo_brand.json"))
$data = $json | ConvertFrom-Json
$today = (Get-Date).ToString('yyyy-MM-dd')
$Q = [char]34

function HtmlEsc([string]$s){
  if ($null -eq $s) { return '' }
  return $s.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace([string][char]34,'&quot;')
}
function SlugOf([string]$s){
  $t = $s -replace '[\\/:\*\?<>\|#%\s]', ''
  $t = $t.Replace([string][char]34,'')
  if ($t.Length -gt 40) { $t = $t.Substring(0,40) }
  # 윈도우 예약 이름(con, nul, com1 ...)은 파일로 만들 수 없다 → 뒤에 표시를 붙인다
  if ($t -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])$') { $t = $t + '-g' }
  return $t
}

$css = @'
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#FAF8FD;color:#231C2E;line-height:1.6;padding:0 0 60px}
.hd{background:linear-gradient(135deg,#6B4A9E,#8B6ABE);color:#fff;padding:26px 18px 22px}
.hd a{color:#fff;text-decoration:none;font-size:13px;opacity:.9}
.hd h1{font-size:22px;margin:10px 0 6px;line-height:1.35}
.hd p{font-size:13px;opacity:.92}
.wrap{max-width:720px;margin:0 auto;padding:0 14px}
.sec{margin-top:22px}.sec h2{font-size:16px;margin-bottom:10px;color:#5B3A8C}
.card{background:#fff;border:1px solid #ECE7F3;border-radius:12px;padding:12px 14px;margin-bottom:8px}
.card b{font-size:14px;display:block;margin-bottom:3px}
.card span{font-size:12.5px;color:#7A7286}
.live{border-color:#C9A8E8;background:#F8F4FD}
.cta{display:block;text-align:center;background:#602090;color:#fff;text-decoration:none;border-radius:12px;padding:15px;font-weight:800;margin-top:22px}
.rel{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.rel a{font-size:12.5px;background:#fff;border:1px solid #E3DCEF;border-radius:20px;padding:6px 12px;color:#5B3A8C;text-decoration:none}
.foot{font-size:11.5px;color:#9C93AC;margin-top:26px;text-align:center;line-height:1.8}
'@

$made = New-Object System.Collections.ArrayList
$all  = @($data.rows)

foreach ($b in $all) {
  $slug = SlugOf $b.brand
  if ([string]::IsNullOrWhiteSpace($slug)) { continue }
  $brandE = HtmlEsc $b.brand

  $live = @(); $past = @()
  if ($b.rows) {
    foreach ($r in ($b.rows -split "`n")) {
      $p = $r -split "`t"
      if ($p.Count -lt 4) { continue }
      $o = [pscustomobject]@{ seller=$p[0]; name=$p[1]; od=$p[2]; ed=$p[3] }
      if ($o.ed -ge $today) { $live += $o } else { $past += $o }
    }
  }

  $title = "$($b.brand) 공구 일정 · 공동구매 모음 | 맘캘린더"
  $desc  = "$($b.brand) 공동구매를 진행한 인스타 셀러 $($b.sellers)명, 공구 $($b.cnt)건. 진행 중인 $($b.brand) 공구와 지난 일정을 맘캘린더에서 확인하세요."
  $titleE = HtmlEsc $title
  $descE  = HtmlEsc $desc
  $urlEnc = [uri]::EscapeDataString($slug)

  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">')
  [void]$sb.AppendLine('<meta name="viewport" content="width=device-width,initial-scale=1">')
  [void]$sb.AppendLine("<title>$titleE</title>")
  [void]$sb.AppendLine("<meta name=${Q}description${Q} content=${Q}$descE${Q}>")
  [void]$sb.AppendLine("<link rel=${Q}canonical${Q} href=${Q}https://momcalendar.com/g/$urlEnc.html${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:title${Q} content=${Q}$titleE${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:description${Q} content=${Q}$descE${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:type${Q} content=${Q}website${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:site_name${Q} content=${Q}맘캘린더${Q}>")
  [void]$sb.AppendLine("<style>$css</style></head><body>")
  [void]$sb.AppendLine('<div class="hd"><div class="wrap"><a href="/">← 맘캘린더</a>')
  [void]$sb.AppendLine("<h1>$brandE 공구 일정</h1>")
  [void]$sb.AppendLine("<p>셀러 $($b.sellers)명 · 공구 $($b.cnt)건 기록</p></div></div>")
  [void]$sb.AppendLine('<div class="wrap">')

  if ($live.Count -gt 0) {
    [void]$sb.AppendLine("<div class=${Q}sec${Q}><h2>🔥 지금 진행 중인 $brandE 공구</h2>")
    foreach ($x in ($live | Select-Object -First 20)) {
      [void]$sb.AppendLine("<div class=${Q}card live${Q}><b>$(HtmlEsc $x.name)</b><span>$(HtmlEsc $x.seller) · $($x.od) ~ $($x.ed)</span></div>")
    }
    [void]$sb.AppendLine('</div>')
  }
  if ($past.Count -gt 0) {
    [void]$sb.AppendLine("<div class=${Q}sec${Q}><h2>📅 지난 $brandE 공구</h2>")
    foreach ($x in ($past | Select-Object -First 40)) {
      [void]$sb.AppendLine("<div class=${Q}card${Q}><b>$(HtmlEsc $x.name)</b><span>$(HtmlEsc $x.seller) · $($x.od) ~ $($x.ed)</span></div>")
    }
    [void]$sb.AppendLine('</div>')
  }

  [void]$sb.AppendLine("<a class=${Q}cta${Q} href=${Q}/${Q}>오늘 진행 중인 공구 전체 보기 →</a>")
  [void]$sb.AppendLine("<div class=${Q}sec${Q}><h2>이런 공구도 있어요</h2><div class=${Q}rel${Q}>__REL__</div></div>")
  [void]$sb.AppendLine("<div class=${Q}foot${Q}>맘캘린더는 인스타그램 공동구매 일정을 모아 보여주는 무료 서비스입니다.<br>")
  [void]$sb.AppendLine("공구·핫딜·체험단 일정을 매일 업데이트합니다.<br><a href=${Q}/${Q} style=${Q}color:#7B3FB5${Q}>momcalendar.com</a></div>")
  [void]$sb.AppendLine('</div></body></html>')

  $path = Join-Path $outDir "$slug.html"
  [IO.File]::WriteAllText($path, $sb.ToString(), [Text.UTF8Encoding]::new($false))
  [void]$made.Add([pscustomobject]@{ slug=$slug; brand=$b.brand; cnt=$b.cnt; live=$live.Count })
}

Write-Output "생성한 브랜드 페이지: $($made.Count)개"
$made | Export-Clixml (Join-Path $root "scratchpad\seo_made.xml")
