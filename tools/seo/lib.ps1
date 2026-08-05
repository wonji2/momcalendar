# SEO 페이지 생성 공통 라이브러리 (사장님 지시 2026-08-05)
# 한글 리터럴이 있으므로 이 파일은 반드시 UTF-8 BOM 으로 저장할 것
$Q = [char]34
$SITE = 'https://momcalendar.com'

function HtmlEsc([string]$s){
  if($null -eq $s){ return '' }
  return $s.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace([string][char]34,'&quot;')
}
function JsonEsc([string]$s){
  if($null -eq $s){ return '' }
  $t = $s.Replace('\','\\').Replace([string][char]34,'\"')
  $t = $t.Replace("`r",'').Replace("`n",' ').Replace("`t",' ')
  return $t
}
# 파일명으로 못 쓰는 문자 제거 + 윈도우 예약어 회피 + 중복 슬러그 자동 분기
function SlugOf([string]$s, [hashtable]$seen, [string]$sfx){
  # 한글·영숫자·마침표·하이픈만 남긴다. 나머지는 전부 하이픈으로.
  # (대괄호·따옴표·& 등이 파일명과 URL 양쪽에서 사고를 낸다)
  $t = $s -replace '[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9\.\-]','-'
  $t = $t -replace '-+','-'
  $t = $t.Trim('-').Trim('.')
  if($t.Length -gt 40){ $t = $t.Substring(0,40).Trim('-') }
  if($t -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])$'){ $t = $t + $sfx }
  if([string]::IsNullOrWhiteSpace($t)){ return '' }
  if($null -ne $seen){
    $k = $t.ToLower()
    if($seen.ContainsKey($k)){
      $n = [int]$seen[$k] + 1
      $seen[$k] = $n
      $t = "$t-$n"
    } else { $seen[$k] = 1 }
  }
  return $t
}
function Enc([string]$s){ return [uri]::EscapeDataString($s) }

$CSS = @'
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#FAF8FD;color:#231C2E;line-height:1.7;padding:0 0 60px;-webkit-text-size-adjust:100%}
.hd{background:linear-gradient(135deg,#6B4A9E,#8B6ABE);color:#fff;padding:24px 0 22px}
.hd a.bk{color:#fff;text-decoration:none;font-size:13px;opacity:.9}
.hd h1{font-size:22px;margin:9px 0 5px;line-height:1.35}
.hd p{font-size:13px;opacity:.92}
.wrap{max-width:720px;margin:0 auto;padding:0 14px}
.bc{font-size:11.5px;color:#9C93AC;margin-top:14px}
.bc a{color:#8B7BA8;text-decoration:none}
.sec{margin-top:24px}
.sec h2{font-size:16.5px;margin-bottom:10px;color:#5B3A8C}
.sec p{font-size:14.5px;color:#3E374C;margin-bottom:11px}
.card{background:#fff;border:1px solid #ECE7F3;border-radius:12px;padding:12px 14px;margin-bottom:8px}
.card b{font-size:14px;display:block;margin-bottom:3px}
.card span{font-size:12.5px;color:#7A7286}
.live{border-color:#C9A8E8;background:#F8F4FD}
.stp{background:#fff;border:1px solid #ECE7F3;border-radius:12px;padding:13px 15px;margin-bottom:9px}
.stp b{display:block;font-size:14.5px;color:#5B3A8C;margin-bottom:4px}
.stp span{font-size:13.5px;color:#4A4356}
.faq{background:#fff;border:1px solid #ECE7F3;border-radius:12px;padding:13px 15px;margin-bottom:9px}
.faq b{display:block;font-size:14.5px;margin-bottom:5px}
.faq span{font-size:13.5px;color:#4A4356}
.stat{display:flex;gap:8px;flex-wrap:wrap;margin:13px 0}
.stat div{background:#fff;border:1px solid #ECE7F3;border-radius:10px;padding:9px 13px;font-size:12.5px}
.stat b{display:block;font-size:16px;color:#5B3A8C}
.cta{display:block;text-align:center;background:#602090;color:#fff;text-decoration:none;border-radius:12px;padding:15px;font-weight:800;margin-top:22px}
.rel{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.rel a{font-size:12.5px;background:#fff;border:1px solid #E3DCEF;border-radius:20px;padding:6px 12px;color:#5B3A8C;text-decoration:none}
.foot{font-size:11.5px;color:#9C93AC;margin-top:28px;text-align:center;line-height:1.9}
.foot a{color:#7B3FB5}
.note{background:#FFF6E5;border:1px solid #F0DCB4;border-radius:12px;padding:13px 15px}
.note b{display:block;font-size:14.5px;color:#8A5A12;margin-bottom:4px}
.note span{display:block;font-size:13.5px;color:#6B5533}
.note .lnk{margin-top:7px}
.note a{color:#7B3FB5;font-weight:700;text-decoration:none}
'@

# 페이지 하나를 쓴다. $o 는 해시테이블:
#   path title desc canon h1 sub body(html) jsonld(문자열배열) bcName
function WritePage([hashtable]$o){
  $tE = HtmlEsc $o.title
  $dE = HtmlEsc $o.desc
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">')
  [void]$sb.AppendLine('<meta name="viewport" content="width=device-width,initial-scale=1">')
  [void]$sb.AppendLine("<title>$tE</title>")
  [void]$sb.AppendLine("<meta name=${Q}description${Q} content=${Q}$dE${Q}>")
  [void]$sb.AppendLine("<link rel=${Q}canonical${Q} href=${Q}$SITE/$($o.canon)${Q}>")
  [void]$sb.AppendLine("<meta name=${Q}robots${Q} content=${Q}index,follow,max-image-preview:large${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:title${Q} content=${Q}$tE${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:description${Q} content=${Q}$dE${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:type${Q} content=${Q}website${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:url${Q} content=${Q}$SITE/$($o.canon)${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:site_name${Q} content=${Q}맘캘린더${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:locale${Q} content=${Q}ko_KR${Q}>")
  [void]$sb.AppendLine("<meta name=${Q}twitter:card${Q} content=${Q}summary${Q}>")
  if($o.jsonld){
    foreach($j in $o.jsonld){
      [void]$sb.AppendLine("<script type=${Q}application/ld+json${Q}>$j</script>")
    }
  }
  [void]$sb.AppendLine("<style>$CSS</style></head><body>")
  [void]$sb.AppendLine("<div class=${Q}hd${Q}><div class=${Q}wrap${Q}><a class=${Q}bk${Q} href=${Q}/${Q}>← 맘캘린더</a>")
  [void]$sb.AppendLine("<h1>$(HtmlEsc $o.h1)</h1><p>$(HtmlEsc $o.sub)</p></div></div>")
  [void]$sb.AppendLine("<div class=${Q}wrap${Q}>")
  if($o.bcName){
    [void]$sb.AppendLine("<div class=${Q}bc${Q}><a href=${Q}/${Q}>맘캘린더</a> › $(HtmlEsc $o.bcName)</div>")
  }
  [void]$sb.AppendLine($o.body)
  [void]$sb.AppendLine("<a class=${Q}cta${Q} href=${Q}/${Q}>오늘 진행 중인 공구 보러 가기 →</a>")
  [void]$sb.AppendLine("<div class=${Q}foot${Q}>맘캘린더는 인스타그램 공동구매 일정을 모아 보여주는 무료 서비스입니다.<br>")
  [void]$sb.AppendLine("공구 일정은 매일 갱신됩니다.<br>")
  [void]$sb.AppendLine("<a href=${Q}/${Q}>momcalendar.com</a> · <a href=${Q}/$(Enc('공구브랜드.html'))${Q}>브랜드</a> · <a href=${Q}/$(Enc('공구셀러.html'))${Q}>셀러</a> · <a href=${Q}/$(Enc('공구제품.html'))${Q}>제품</a></div>")
  [void]$sb.AppendLine('</div></body></html>')
  [IO.File]::WriteAllText($o.path, $sb.ToString(), [Text.UTF8Encoding]::new($false))
}

# 공구 목록 카드 HTML
function CardsHtml($items, [int]$max, [bool]$isLive, [bool]$withWho){
  $s = ''
  $n = 0
  foreach($x in $items){
    if($n -ge $max){ break }
    $cls = if($isLive){ 'card live' } else { 'card' }
    $meta = "$($x.od) ~ $($x.ed)"
    if($withWho -and $x.who){ $meta = "$(HtmlEsc $x.who) · $meta" }
    $s += "<div class=${Q}$cls${Q}><b>$(HtmlEsc $x.name)</b><span>$meta</span></div>"
    $n++
  }
  return $s
}

# rows 문자열(탭구분)을 객체로. $order 는 컬럼 순서 배열
function ParseRows([string]$raw, [string[]]$cols){
  $out = New-Object System.Collections.ArrayList
  if([string]::IsNullOrWhiteSpace($raw)){ return $out }
  foreach($r in ($raw -split "`n")){
    $p = $r -split "`t"
    if($p.Count -lt $cols.Count){ continue }
    $h = @{}
    for($i=0; $i -lt $cols.Count; $i++){ $h[$cols[$i]] = $p[$i] }
    [void]$out.Add([pscustomobject]$h)
  }
  return $out
}

# ItemList JSON-LD
function LdItemList([string]$name, $items, [int]$max){
  $el = New-Object System.Collections.ArrayList
  $i = 1
  foreach($x in $items){
    if($i -gt $max){ break }
    [void]$el.Add("{${Q}@type${Q}:${Q}ListItem${Q},${Q}position${Q}:$i,${Q}name${Q}:${Q}$(JsonEsc $x.name)${Q}}")
    $i++
  }
  if($el.Count -eq 0){ return $null }
  return "{${Q}@context${Q}:${Q}https://schema.org${Q},${Q}@type${Q}:${Q}ItemList${Q},${Q}name${Q}:${Q}$(JsonEsc $name)${Q},${Q}numberOfItems${Q}:$($el.Count),${Q}itemListElement${Q}:[$($el -join ',')]}"
}

# FAQPage JSON-LD
function LdFaq($faq){
  if(-not $faq -or $faq.Count -eq 0){ return $null }
  $el = New-Object System.Collections.ArrayList
  foreach($f in $faq){
    [void]$el.Add("{${Q}@type${Q}:${Q}Question${Q},${Q}name${Q}:${Q}$(JsonEsc $f.q)${Q},${Q}acceptedAnswer${Q}:{${Q}@type${Q}:${Q}Answer${Q},${Q}text${Q}:${Q}$(JsonEsc $f.a)${Q}}}")
  }
  return "{${Q}@context${Q}:${Q}https://schema.org${Q},${Q}@type${Q}:${Q}FAQPage${Q},${Q}mainEntity${Q}:[$($el -join ',')]}"
}

# BreadcrumbList JSON-LD
function LdCrumb([string]$name, [string]$canon){
  return "{${Q}@context${Q}:${Q}https://schema.org${Q},${Q}@type${Q}:${Q}BreadcrumbList${Q},${Q}itemListElement${Q}:[{${Q}@type${Q}:${Q}ListItem${Q},${Q}position${Q}:1,${Q}name${Q}:${Q}맘캘린더${Q},${Q}item${Q}:${Q}$SITE/${Q}},{${Q}@type${Q}:${Q}ListItem${Q},${Q}position${Q}:2,${Q}name${Q}:${Q}$(JsonEsc $name)${Q},${Q}item${Q}:${Q}$SITE/$canon${Q}}]}"
}
