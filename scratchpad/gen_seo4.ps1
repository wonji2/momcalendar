# 카테고리 페이지 + 허브 갱신 + sitemap 재생성 (상위노출 전략 3단계)
$ErrorActionPreference='Stop'
$root="C:\Users\FAMILY\Desktop\맘캘린더\사이트\MOMCALENDAR"
$Q=[char]34
$today=(Get-Date).ToString('yyyy-MM-dd')

function HtmlEsc([string]$s){ if($null -eq $s){return ''}; return $s.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace([string][char]34,'&quot;') }

$css=@'
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#FAF8FD;color:#231C2E;line-height:1.7;padding:0 0 60px}
.hd{background:linear-gradient(135deg,#6B4A9E,#8B6ABE);color:#fff;padding:28px 18px 24px}
.hd a{color:#fff;text-decoration:none;font-size:13px;opacity:.9}
.hd h1{font-size:22px;margin:10px 0 6px;line-height:1.35}.hd p{font-size:13px;opacity:.92}
.wrap{max-width:720px;margin:0 auto;padding:0 14px}
.sec{margin-top:24px}.sec h2{font-size:16px;margin-bottom:10px;color:#5B3A8C}
.sec p{font-size:14px;color:#4A4356;margin-bottom:10px}
.card{background:#fff;border:1px solid #ECE7F3;border-radius:12px;padding:12px 14px;margin-bottom:8px}
.card b{font-size:14px;display:block;margin-bottom:3px}.card span{font-size:12.5px;color:#7A7286}
.live{border-color:#C9A8E8;background:#F8F4FD}
.cta{display:block;text-align:center;background:#602090;color:#fff;text-decoration:none;border-radius:12px;padding:15px;font-weight:800;margin-top:22px}
.rel{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.rel a{font-size:12.5px;background:#fff;border:1px solid #E3DCEF;border-radius:20px;padding:6px 12px;color:#5B3A8C;text-decoration:none}
.foot{font-size:11.5px;color:#9C93AC;margin-top:26px;text-align:center;line-height:1.8}
'@

$brands  = Import-Clixml (Join-Path $root "scratchpad\seo_made.xml")
$sellers = Import-Clixml (Join-Path $root "scratchpad\seo_seller_made.xml")
$topB = $brands  | Sort-Object cnt -Descending | Select-Object -First 40
$topS = $sellers | Sort-Object fw  -Descending | Select-Object -First 60

function WritePage($path,$title,$desc,$canon,$h1,$sub,$body){
  $tE=HtmlEsc $title; $dE=HtmlEsc $desc
  $sb=New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">')
  [void]$sb.AppendLine('<meta name="viewport" content="width=device-width,initial-scale=1">')
  [void]$sb.AppendLine("<title>$tE</title>")
  [void]$sb.AppendLine("<meta name=${Q}description${Q} content=${Q}$dE${Q}>")
  [void]$sb.AppendLine("<link rel=${Q}canonical${Q} href=${Q}https://momcalendar.com/$canon${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:title${Q} content=${Q}$tE${Q}><meta property=${Q}og:description${Q} content=${Q}$dE${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:type${Q} content=${Q}website${Q}><meta property=${Q}og:site_name${Q} content=${Q}맘캘린더${Q}>")
  [void]$sb.AppendLine("<style>$css</style></head><body>")
  [void]$sb.AppendLine("<div class=${Q}hd${Q}><div class=${Q}wrap${Q}><a href=${Q}/${Q}>← 맘캘린더</a><h1>$(HtmlEsc $h1)</h1><p>$(HtmlEsc $sub)</p></div></div>")
  [void]$sb.AppendLine("<div class=${Q}wrap${Q}>$body")
  [void]$sb.AppendLine("<a class=${Q}cta${Q} href=${Q}/${Q}>오늘 진행 중인 공구 보러 가기 →</a>")
  [void]$sb.AppendLine("<div class=${Q}foot${Q}>맘캘린더는 인스타그램 공동구매·핫딜·체험단 일정을 모아 보여주는 무료 서비스입니다.<br><a href=${Q}/${Q} style=${Q}color:#7B3FB5${Q}>momcalendar.com</a></div></div></body></html>")
  [IO.File]::WriteAllText($path,$sb.ToString(),[Text.UTF8Encoding]::new($false))
}

# ── 셀러 허브 ──
$sbH=New-Object System.Text.StringBuilder
[void]$sbH.AppendLine("<div class=${Q}sec${Q}><p>맘캘린더가 일정을 모으고 있는 <b>인스타 공구 셀러 $($sellers.Count)명</b>입니다. 이름을 누르면 그 셀러의 공구 이력을 볼 수 있습니다.</p><div class=${Q}rel${Q}>")
foreach($s in ($sellers | Sort-Object cnt -Descending)){
  [void]$sbH.AppendLine("<a href=${Q}/s/$([uri]::EscapeDataString($s.slug)).html${Q}>$(HtmlEsc $s.kor)</a>")
}
[void]$sbH.AppendLine('</div></div>')
WritePage (Join-Path $root '공구셀러.html') `
  "인스타 공구 셀러 목록 $($sellers.Count)명 | 맘캘린더" `
  "인스타그램에서 공동구매를 진행하는 셀러 $($sellers.Count)명의 목록과 공구 이력. 셀러별 진행 중인 공구를 확인하세요." `
  ([uri]::EscapeDataString('공구셀러.html')) "인스타 공구 셀러" "$($sellers.Count)명의 공구 이력" $sbH.ToString()

# ── 카테고리 페이지 ──
$cats=@(
 @{n='육아';d='육아용품·이유식·장난감·교구'},
 @{n='리빙';d='주방·수납·침구·인테리어'},
 @{n='식품';d='간편식·신선식품·간식·음료'},
 @{n='가전';d='생활가전·주방가전·계절가전'},
 @{n='뷰티';d='스킨케어·클렌징·헤어'},
 @{n='건강';d='영양제·유산균·건강식품'},
 @{n='패션';d='아동복·잡화·신발'},
 @{n='여행';d='숙소·티켓·여행용품'},
 @{n='생필품';d='세제·물티슈·화장지·위생'},
 @{n='반려동물';d='사료·간식·용품'}
)
$catDir=Join-Path $root 'c'
$madeC=New-Object System.Collections.ArrayList
foreach($c in $cats){
  $bs = $brands | Where-Object { $_.brand } | Sort-Object cnt -Descending | Select-Object -First 60
  $body="<div class=${Q}sec${Q}><p><b>$($c.n)</b> 분야 공동구매입니다. $($c.d) 등을 인스타 셀러들이 특가로 진행합니다. 맘캘린더에서 오늘 열리는 $($c.n) 공구를 확인하세요.</p></div>"
  $body+="<div class=${Q}sec${Q}><h2>인기 공구 브랜드</h2><div class=${Q}rel${Q}>"
  foreach($b in $bs){ $body+="<a href=${Q}/g/$([uri]::EscapeDataString($b.slug)).html${Q}>$(HtmlEsc $b.brand)</a>" }
  $body+='</div></div>'
  $slug="$($c.n)공구.html"
  WritePage (Join-Path $catDir $slug) `
    "$($c.n) 공구 일정 · $($c.n) 공동구매 | 맘캘린더" `
    "$($c.n) 공동구매 일정을 한눈에. $($c.d) 공구를 진행하는 인스타 셀러와 기간을 확인하세요." `
    ("c/"+[uri]::EscapeDataString($slug)) "$($c.n) 공구" $c.d $body
  [void]$madeC.Add($slug)
}

# ── sitemap 재생성 ──
$sm=New-Object System.Text.StringBuilder
[void]$sm.AppendLine('<?xml version="1.0" encoding="UTF-8"?>')
[void]$sm.AppendLine('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
function AddUrl($loc,$pri,$freq){ [void]$sm.AppendLine("<url><loc>https://momcalendar.com/$loc</loc><lastmod>$today</lastmod><changefreq>$freq</changefreq><priority>$pri</priority></url>") }
AddUrl '' '1.0' 'daily'
foreach($k in @('공구하는곳.html','공구하는법.html','공구찾는법.html','공구하는사람.html','공구브랜드.html','공구셀러.html')){ AddUrl ([uri]::EscapeDataString($k)) '0.9' 'weekly' }
foreach($k in $madeC){ AddUrl ('c/'+[uri]::EscapeDataString($k)) '0.8' 'weekly' }
foreach($b in $brands){ AddUrl ('g/'+[uri]::EscapeDataString($b.slug)+'.html') '0.6' 'weekly' }
foreach($s in $sellers){ AddUrl ('s/'+[uri]::EscapeDataString($s.slug)+'.html') '0.6' 'weekly' }
[void]$sm.AppendLine('</urlset>')
[IO.File]::WriteAllText((Join-Path $root 'sitemap.xml'),$sm.ToString(),[Text.UTF8Encoding]::new($false))

$total = 1 + 6 + $madeC.Count + $brands.Count + $sellers.Count
Write-Output "셀러허브1 + 카테고리$($madeC.Count) + sitemap $total URL 완료"
