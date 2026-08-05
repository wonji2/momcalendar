# 키워드 페이지 + 브랜드 허브 + sitemap + robots (사장님 지시 2026-08-05)
$ErrorActionPreference='Stop'
$root="C:\Users\FAMILY\Desktop\맘캘린더\사이트\MOMCALENDAR"
$Q=[char]34
$today=(Get-Date).ToString('yyyy-MM-dd')

function HtmlEsc([string]$s){ if($null -eq $s){return ''}; return $s.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace([string][char]34,'&quot;') }

$made = Import-Clixml (Join-Path $root "scratchpad\seo_made.xml")
$top  = $made | Sort-Object cnt -Descending | Select-Object -First 300

$css=@'
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#FAF8FD;color:#231C2E;line-height:1.7;padding:0 0 60px}
.hd{background:linear-gradient(135deg,#6B4A9E,#8B6ABE);color:#fff;padding:30px 18px 26px}
.hd a{color:#fff;text-decoration:none;font-size:13px;opacity:.9}
.hd h1{font-size:23px;margin:10px 0 8px;line-height:1.35}
.hd p{font-size:13.5px;opacity:.93}
.wrap{max-width:720px;margin:0 auto;padding:0 14px}
.sec{margin-top:26px}
.sec h2{font-size:17px;margin-bottom:12px;color:#5B3A8C}
.sec h3{font-size:14.5px;margin:16px 0 6px;color:#3A3345}
.sec p{font-size:14px;color:#4A4356;margin-bottom:10px}
.box{background:#fff;border:1px solid #ECE7F3;border-radius:13px;padding:16px 16px 14px;margin-bottom:10px}
.cta{display:block;text-align:center;background:#602090;color:#fff;text-decoration:none;border-radius:12px;padding:16px;font-weight:800;margin-top:24px;font-size:15px}
.rel{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
.rel a{font-size:12.5px;background:#fff;border:1px solid #E3DCEF;border-radius:20px;padding:6px 12px;color:#5B3A8C;text-decoration:none}
.foot{font-size:11.5px;color:#9C93AC;margin-top:30px;text-align:center;line-height:1.9}
ol,ul{margin:0 0 10px 20px}li{font-size:14px;color:#4A4356;margin-bottom:6px}
'@

function MakePage($slug,$title,$desc,$h1,$sub,$bodyHtml,$relCount){
  $t=HtmlEsc $title; $d=HtmlEsc $desc
  $sb=New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">')
  [void]$sb.AppendLine('<meta name="viewport" content="width=device-width,initial-scale=1">')
  [void]$sb.AppendLine("<title>$t</title>")
  [void]$sb.AppendLine("<meta name=${Q}description${Q} content=${Q}$d${Q}>")
  [void]$sb.AppendLine("<link rel=${Q}canonical${Q} href=${Q}https://momcalendar.com/$slug${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:title${Q} content=${Q}$t${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:description${Q} content=${Q}$d${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:type${Q} content=${Q}article${Q}><meta property=${Q}og:site_name${Q} content=${Q}맘캘린더${Q}>")
  [void]$sb.AppendLine("<style>$css</style></head><body>")
  [void]$sb.AppendLine("<div class=${Q}hd${Q}><div class=${Q}wrap${Q}><a href=${Q}/${Q}>← 맘캘린더</a><h1>$(HtmlEsc $h1)</h1><p>$(HtmlEsc $sub)</p></div></div>")
  [void]$sb.AppendLine("<div class=${Q}wrap${Q}>")
  [void]$sb.AppendLine($bodyHtml)
  [void]$sb.AppendLine("<a class=${Q}cta${Q} href=${Q}/${Q}>오늘 진행 중인 공구 보러 가기 →</a>")
  if($relCount -gt 0){
    [void]$sb.AppendLine("<div class=${Q}sec${Q}><h2>인기 공구 브랜드</h2><div class=${Q}rel${Q}>")
    foreach($b in ($top | Select-Object -First $relCount)){
      $u=[uri]::EscapeDataString($b.slug)
      [void]$sb.AppendLine("<a href=${Q}/g/$u.html${Q}>$(HtmlEsc $b.brand)</a>")
    }
    [void]$sb.AppendLine('</div></div>')
  }
  [void]$sb.AppendLine("<div class=${Q}foot${Q}>맘캘린더는 인스타그램 공동구매·핫딜·체험단 일정을 모아 보여주는 무료 서비스입니다.<br><a href=${Q}/${Q} style=${Q}color:#7B3FB5${Q}>momcalendar.com</a></div>")
  [void]$sb.AppendLine('</div></body></html>')
  [IO.File]::WriteAllText((Join-Path $root $slug), $sb.ToString(), [Text.UTF8Encoding]::new($false))
}

# ── 1. 공구하는곳 ──
$body1=@"
<div class="sec">
<div class="box"><p><b>인스타 공동구매는 셀러(인플루언서) 계정에서 각자 열립니다.</b> 한곳에 모여 있지 않아 일정을 놓치기 쉽습니다.
맘캘린더는 <b>인스타 공구 셀러 1,300여 명</b>의 일정을 매일 모아 한 화면에서 보여드립니다.</p></div>
<h2>공구하는 곳, 이렇게 찾으세요</h2>
<h3>1. 날짜별로 보기</h3><p>오늘 오픈하는 공구, 오늘 마감하는 공구를 달력에서 바로 확인할 수 있습니다.</p>
<h3>2. 상품·브랜드로 찾기</h3><p>찾는 상품 이름을 검색하면 그 상품을 진행하는 셀러가 모두 나옵니다.</p>
<h3>3. 카테고리로 좁히기</h3><p>육아·리빙·식품·가전·뷰티·건강·패션·여행 등으로 나눠 볼 수 있습니다.</p>
<h3>4. 찜하고 알림 받기</h3><p>관심 공구를 찜해두면 오픈하는 날 아침에 알려드립니다. 내 폰 캘린더로 내보낼 수도 있습니다.</p>
</div>
"@
MakePage '공구하는곳.html' '공구하는 곳 - 인스타 공동구매 일정 한눈에 | 맘캘린더' '인스타 공동구매를 어디서 하는지 찾고 계신가요? 셀러 1,300여 명의 공구 일정을 매일 모아 보여드립니다. 오늘 오픈·마감 공구를 무료로 확인하세요.' '공구하는 곳' '인스타 공동구매 일정을 한곳에서' $body1 40

# ── 2. 공구하는법 ──
$body2=@"
<div class="sec">
<div class="box"><p><b>인스타 공동구매(공구)</b>는 인플루언서가 브랜드와 협의해 일정 기간 특가로 판매하는 방식입니다. 정가보다 저렴하고, 사은품이 붙는 경우가 많습니다.</p></div>
<h2>공구 참여하는 법</h2>
<ol>
<li><b>일정을 먼저 확인합니다.</b> 공구는 대개 3~7일만 열립니다. 놓치면 다음 차수를 기다려야 합니다.</li>
<li><b>셀러 계정에 들어갑니다.</b> 프로필 링크(링크인바이오)에 구매 페이지가 있습니다.</li>
<li><b>댓글·DM으로 링크를 받습니다.</b> 많은 셀러가 댓글을 남기면 최저가 링크를 보내줍니다.</li>
<li><b>기간 안에 결제합니다.</b> 마감 후에는 같은 가격으로 살 수 없습니다.</li>
</ol>
<h2>공구할 때 확인할 것</h2>
<ul>
<li>같은 상품을 여러 셀러가 동시에 진행하기도 합니다. 구성과 사은품을 비교해 보세요.</li>
<li>배송 예정일을 확인하세요. 공구는 주문을 모아 보내기 때문에 일반 배송보다 늦을 수 있습니다.</li>
<li>일정은 판매자 사정으로 바뀌거나 조기 마감될 수 있습니다.</li>
</ul>
</div>
"@
MakePage '공구하는법.html' '공구하는 법 - 인스타 공동구매 참여 방법 | 맘캘린더' '인스타 공동구매 참여 방법을 정리했습니다. 일정 확인부터 링크 받는 법, 구매 시 확인할 점까지. 공구 일정은 맘캘린더에서 매일 확인하세요.' '공구하는 법' '인스타 공동구매, 처음이어도 어렵지 않아요' $body2 30

# ── 3. 공구 찾는 법 ──
$body3=@"
<div class="sec">
<div class="box"><p>찾는 상품이 정해져 있다면 <b>상품 이름으로 검색</b>하는 것이 가장 빠릅니다. 맘캘린더에서는 공구·핫딜·체험단을 한 번에 검색할 수 있습니다.</p></div>
<h2>원하는 공구를 찾는 방법</h2>
<h3>상품 이름으로 검색</h3><p>브랜드명이나 상품명을 넣으면 그 상품을 진행하는 셀러와 기간이 나옵니다.</p>
<h3>셀러 이름으로 찾기</h3><p>즐겨 보는 셀러 이름으로도 검색할 수 있습니다.</p>
<h3>오늘 오픈·오늘 마감</h3><p>상단 탭에서 오늘 열리는 공구와 오늘 끝나는 공구만 따로 볼 수 있습니다.</p>
<h3>찜해두고 알림 받기</h3><p>아직 열리지 않은 공구는 찜해두면 오픈 당일 아침에 알림이 옵니다.</p>
</div>
"@
MakePage '공구찾는법.html' '공구 찾는 법 - 원하는 공동구매 검색하기 | 맘캘린더' '원하는 공구를 찾는 방법. 상품명·셀러명으로 검색하고, 오늘 오픈·마감 공구를 확인하고, 찜해두면 알림까지 받을 수 있습니다.' '공구 찾는 법' '원하는 상품의 공동구매를 빠르게' $body3 30

# ── 4. 공구하는 사람 ──
$body4=@"
<div class="sec">
<div class="box"><p>인스타에서 공동구매를 진행하는 분들을 흔히 <b>공구 셀러</b>라고 부릅니다. 육아·살림·식품 등 각자 잘 아는 분야의 상품을 골라 소개합니다.</p></div>
<h2>공구하는 사람 찾는 법</h2>
<h3>상품으로 거슬러 찾기</h3><p>사고 싶은 상품 이름을 검색하면 그 상품을 진행한 셀러가 모두 나옵니다.</p>
<h3>분야로 찾기</h3><p>육아용품·이유식·살림템·주방·건강식품 등 분야별로 활발한 셀러가 다릅니다.</p>
<h3>일정으로 확인하기</h3><p>맘캘린더에는 셀러별 공구 이력이 남아 있어, 어떤 상품을 얼마나 자주 진행하는지 볼 수 있습니다.</p>
</div>
"@
MakePage '공구하는사람.html' '공구하는 사람 찾는 법 - 인스타 공구 셀러 | 맘캘린더' '인스타 공동구매를 진행하는 셀러를 찾는 방법. 상품·분야·일정으로 공구 셀러를 찾고, 진행 중인 공구를 확인하세요.' '공구하는 사람 찾기' '인스타 공구 셀러를 분야별로' $body4 30

# ── 5. 브랜드 허브 ──
$sbHub=New-Object System.Text.StringBuilder
[void]$sbHub.AppendLine('<div class="sec"><div class="box"><p>맘캘린더가 모은 <b>공구 브랜드 '+$made.Count+'개</b>입니다. 브랜드를 누르면 그 상품을 진행한 셀러와 기간을 볼 수 있습니다.</p></div>')
[void]$sbHub.AppendLine('<div class="rel">')
foreach($b in ($made | Sort-Object cnt -Descending)){
  $u=[uri]::EscapeDataString($b.slug)
  [void]$sbHub.AppendLine("<a href=${Q}/g/$u.html${Q}>$(HtmlEsc $b.brand)</a>")
}
[void]$sbHub.AppendLine('</div></div>')
MakePage '공구브랜드.html' '공구 브랜드 전체 목록 - 인스타 공동구매 | 맘캘린더' ('인스타 공동구매로 진행된 브랜드 '+$made.Count+'개 전체 목록. 브랜드별 공구 일정과 셀러를 확인하세요.') '공구 브랜드 목록' ($made.Count.ToString()+'개 브랜드의 공구 이력') $sbHub.ToString() 0

# ── sitemap ──
$sm=New-Object System.Text.StringBuilder
[void]$sm.AppendLine('<?xml version="1.0" encoding="UTF-8"?>')
[void]$sm.AppendLine('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
function AddUrl($loc,$pri,$freq){
  [void]$sm.AppendLine("<url><loc>https://momcalendar.com/$loc</loc><lastmod>$today</lastmod><changefreq>$freq</changefreq><priority>$pri</priority></url>")
}
AddUrl '' '1.0' 'daily'
foreach($k in @('공구하는곳.html','공구하는법.html','공구찾는법.html','공구하는사람.html','공구브랜드.html')){
  AddUrl ([uri]::EscapeDataString($k)) '0.8' 'weekly'
}
foreach($b in $made){ AddUrl ('g/'+[uri]::EscapeDataString($b.slug)+'.html') '0.6' 'weekly' }
[void]$sm.AppendLine('</urlset>')
[IO.File]::WriteAllText((Join-Path $root 'sitemap.xml'), $sm.ToString(), [Text.UTF8Encoding]::new($false))

# ── robots ──
$rb=@"
User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /staff.html
Disallow: /test.html
Disallow: /kktest.html
Disallow: /reelcard.html

Sitemap: https://momcalendar.com/sitemap.xml
"@
[IO.File]::WriteAllText((Join-Path $root 'robots.txt'), $rb, [Text.UTF8Encoding]::new($false))

Write-Output ("키워드 페이지 5개 + 허브 1개 + sitemap(" + ($made.Count+6) + " URL) + robots.txt 완료")
