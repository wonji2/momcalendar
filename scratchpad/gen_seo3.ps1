# 셀러 페이지 + 카테고리 페이지 + sitemap 갱신 (상위노출 전략 2단계)
# 경쟁사가 못 가진 것: 팔로워 수 · 인증계정 · 셀러별 공구 이력 통계 → 이걸 콘텐츠로 쓴다
$ErrorActionPreference='Stop'
$root="C:\Users\FAMILY\Desktop\맘캘린더\사이트\MOMCALENDAR"
$Q=[char]34
$today=(Get-Date).ToString('yyyy-MM-dd')
$sDir=Join-Path $root "s"
if(-not(Test-Path $sDir)){ New-Item -ItemType Directory -Path $sDir | Out-Null }
$cDir=Join-Path $root "c"
if(-not(Test-Path $cDir)){ New-Item -ItemType Directory -Path $cDir | Out-Null }

function HtmlEsc([string]$s){ if($null -eq $s){return ''}; return $s.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace([string][char]34,'&quot;') }
function SlugOf([string]$s){
  $t=$s -replace '[\\/:\*\?<>\|#%\s]',''
  $t=$t.Replace([string][char]34,'')
  if($t.Length -gt 40){$t=$t.Substring(0,40)}
  if($t -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])$'){$t=$t+'-s'}
  return $t
}
function Num([object]$n){ if($null -eq $n -or $n -eq ''){return 0}; return [int64]$n }

$css=@'
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
.stat{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.stat div{background:#fff;border:1px solid #ECE7F3;border-radius:10px;padding:9px 13px;font-size:12.5px}
.stat b{display:block;font-size:16px;color:#5B3A8C}
.cta{display:block;text-align:center;background:#602090;color:#fff;text-decoration:none;border-radius:12px;padding:15px;font-weight:800;margin-top:22px}
.rel{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.rel a{font-size:12.5px;background:#fff;border:1px solid #E3DCEF;border-radius:20px;padding:6px 12px;color:#5B3A8C;text-decoration:none}
.foot{font-size:11.5px;color:#9C93AC;margin-top:26px;text-align:center;line-height:1.8}
'@

$brands = Import-Clixml (Join-Path $root "scratchpad\seo_made.xml")
$topBrand = $brands | Sort-Object cnt -Descending | Select-Object -First 30

$sj=[IO.File]::ReadAllText((Join-Path $root "scratchpad\seo_seller.json")) | ConvertFrom-Json
$sellers=@($sj.rows)
$madeS=New-Object System.Collections.ArrayList

foreach($s in $sellers){
  $slug=SlugOf $s.insta
  if([string]::IsNullOrWhiteSpace($slug)){continue}
  $kor=HtmlEsc $s.kor
  $fw=Num $s.followers

  $live=@();$past=@()
  if($s.rows){
    foreach($r in ($s.rows -split "`n")){
      $p=$r -split "`t"
      if($p.Count -lt 3){continue}
      $o=[pscustomobject]@{name=$p[0];od=$p[1];ed=$p[2]}
      if($o.ed -ge $today){$live+=$o}else{$past+=$o}
    }
  }

  $title="$($s.kor) 공구 일정 · 인스타 공동구매 | 맘캘린더"
  $desc="$($s.kor)(@$($s.insta))의 공동구매 일정 $($s.cnt)건. 진행 중인 공구와 지난 공구를 맘캘린더에서 확인하세요."
  $tE=HtmlEsc $title; $dE=HtmlEsc $desc
  $u=[uri]::EscapeDataString($slug)

  $sb=New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">')
  [void]$sb.AppendLine('<meta name="viewport" content="width=device-width,initial-scale=1">')
  [void]$sb.AppendLine("<title>$tE</title>")
  [void]$sb.AppendLine("<meta name=${Q}description${Q} content=${Q}$dE${Q}>")
  [void]$sb.AppendLine("<link rel=${Q}canonical${Q} href=${Q}https://momcalendar.com/s/$u.html${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:title${Q} content=${Q}$tE${Q}><meta property=${Q}og:description${Q} content=${Q}$dE${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:type${Q} content=${Q}profile${Q}><meta property=${Q}og:site_name${Q} content=${Q}맘캘린더${Q}>")
  [void]$sb.AppendLine("<style>$css</style></head><body>")
  [void]$sb.AppendLine("<div class=${Q}hd${Q}><div class=${Q}wrap${Q}><a href=${Q}/${Q}>← 맘캘린더</a><h1>$kor 공구 일정</h1><p>@$(HtmlEsc $s.insta)</p></div></div>")
  [void]$sb.AppendLine("<div class=${Q}wrap${Q}>")
  [void]$sb.AppendLine("<div class=${Q}stat${Q}>")
  [void]$sb.AppendLine("<div><b>$($s.cnt)</b>진행한 공구</div>")
  if($fw -gt 0){ [void]$sb.AppendLine("<div><b>$('{0:N0}' -f $fw)</b>팔로워</div>") }
  if($s.verified -eq $true){ [void]$sb.AppendLine("<div><b>✔</b>인증계정</div>") }
  [void]$sb.AppendLine("<div><b>$(HtmlEsc $s.major)</b>주력 분야</div></div>")

  if($live.Count -gt 0){
    [void]$sb.AppendLine("<div class=${Q}sec${Q}><h2>🔥 지금 진행 중</h2>")
    foreach($x in ($live|Select-Object -First 20)){
      [void]$sb.AppendLine("<div class=${Q}card live${Q}><b>$(HtmlEsc $x.name)</b><span>$($x.od) ~ $($x.ed)</span></div>")
    }
    [void]$sb.AppendLine('</div>')
  }
  if($past.Count -gt 0){
    [void]$sb.AppendLine("<div class=${Q}sec${Q}><h2>📅 지난 공구</h2>")
    foreach($x in ($past|Select-Object -First 40)){
      [void]$sb.AppendLine("<div class=${Q}card${Q}><b>$(HtmlEsc $x.name)</b><span>$($x.od) ~ $($x.ed)</span></div>")
    }
    [void]$sb.AppendLine('</div>')
  }
  [void]$sb.AppendLine("<a class=${Q}cta${Q} href=${Q}/${Q}>오늘 진행 중인 공구 전체 보기 →</a>")
  [void]$sb.AppendLine("<div class=${Q}sec${Q}><h2>인기 공구 브랜드</h2><div class=${Q}rel${Q}>")
  foreach($b in $topBrand){ [void]$sb.AppendLine("<a href=${Q}/g/$([uri]::EscapeDataString($b.slug)).html${Q}>$(HtmlEsc $b.brand)</a>") }
  [void]$sb.AppendLine('</div></div>')
  [void]$sb.AppendLine("<div class=${Q}foot${Q}>맘캘린더는 인스타그램 공동구매 일정을 모아 보여주는 무료 서비스입니다.<br><a href=${Q}/${Q} style=${Q}color:#7B3FB5${Q}>momcalendar.com</a></div>")
  [void]$sb.AppendLine('</div></body></html>')

  [IO.File]::WriteAllText((Join-Path $sDir "$slug.html"), $sb.ToString(), [Text.UTF8Encoding]::new($false))
  [void]$madeS.Add([pscustomobject]@{slug=$slug;kor=$s.kor;cnt=$s.cnt;fw=$fw})
}

Write-Output "셀러 페이지: $($madeS.Count)개"
$madeS | Export-Clixml (Join-Path $root "scratchpad\seo_seller_made.xml")
