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
.card{background:#fff;border:1px solid #ECE7F3;border-radius:12px;padding:12px 14px;margin-bottom:8px;
  display:block;text-decoration:none;color:inherit}
.card b{font-size:14px;display:block;margin-bottom:3px}
.card span{font-size:12.5px;color:#7A7286}
a.card:active{background:#F7F3FD}
a.card::after{content:" ›";color:#B3A8C4;font-size:13px}
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

# 오늘 기준 3분류
# ⚠ 예전엔 '마감 >= 오늘' 을 전부 진행중으로 셌다. 그래서 8/11 에 8/28 오픈 건이
#   "오늘 기준 2건 진행 중" 으로 나왔다(사장님 지적 2026-08-11). 오픈일도 같이 봐야 한다.
function SplitNow($items, [string]$today){
  return @{
    now  = @($items | Where-Object { $_.od -le $today -and $_.ed -ge $today })
    soon = @($items | Where-Object { $_.od -gt $today })
    past = @($items | Where-Object { $_.ed -lt $today })
  }
}

# 공구 목록 카드 HTML
# ⚠ 예전엔 그냥 <div> 라 눌러도 아무 반응이 없었다(사장님 지적 2026-08-11).
# ⚠ 목적지는 **셀러 인스타**다. 처음엔 우리 셀러 페이지로 보냈는데,
#   사장님 지시(2026-08-11) — 집계 정보는 크몽에 팔 자산이라 굳이 보여주지 말고
#   카드는 바로 인스타로 보낼 것. 그래서 내부 순환을 끊고 인스타로 직행시킨다.
function CardsHtml($items, [int]$max, [bool]$isLive, [bool]$withWho, [string]$fixedHref = ''){
  $s = ''
  $n = 0
  foreach($x in $items){
    if($n -ge $max){ break }
    $cls = if($isLive){ 'card live' } else { 'card' }
    $meta = "$($x.od) ~ $($x.ed)"
    if($withWho -and $x.who){ $meta = "$(HtmlEsc $x.who) · $meta" }
    $inner = "<b>$(HtmlEsc $x.name)</b><span>$meta</span>"
    $href = ''
    if($fixedHref){ $href = $fixedHref }
    elseif($x.PSObject.Properties['insta'] -and $x.insta){
      $href = "https://www.instagram.com/$($x.insta)"
    }
    elseif($x.PSObject.Properties['who'] -and $x.who -and
           $SellerByKor -and $SellerByKor.ContainsKey("$($x.who)")){
      # 소분류·월별 페이지는 insta 가 없다. 이름이 겹치지 않는 셀러만 이름으로 찾아간다.
      $href = "https://www.instagram.com/$($SellerByKor["$($x.who)"])"
    }
    if($href){ $s += "<a class=${Q}$cls${Q} href=${Q}$href${Q} rel=${Q}nofollow noopener${Q}>$inner</a>" }
    else     { $s += "<div class=${Q}$cls${Q}>$inner</div>" }
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

# 본문 보강 — 참여 방법 + 자주 묻는 질문 (2026-08-11)
#
# 왜: 집계 문구를 걷어내니 본문이 얇아져 검색 순위가 위태로워졌다.
#     집계는 사장님이 크몽에 팔 자산이라 못 쓴다 → **자산이 아닌 내용**으로 분량을 채운다.
# 쓰는 것: 화면에 이미 보이는 날짜, 참여 방법 안내, 자주 묻는 질문.
# ⚠ 안 쓰는 것: 셀러 수 · 진행 횟수 · 팔로워 수 · 첫/최근 공구일 · 품목 랭킹.
#   이건 '이 시장이 어떻게 돌아가는가' 를 알려주는 값이라 곧 상품이다.
# ⚠ 4,500개 페이지에 같은 글이 깔리면 중복으로 취급된다 →
#   이름을 넣고, 진행중/곧열림/없음 상태에 따라 문장을 갈라 쓴다.
function ExtraBody([string]$name, [string]$kind, $live, $soon, $past){
  $q = [char]34
  $nearest = ''
  if($live.Count -gt 0){ $nearest = "$($live[0].od)" }
  elseif($soon.Count -gt 0){ $nearest = "$($soon[0].od)" }

  $steps = @()
  if($live.Count -gt 0){
    $steps += @{ t="1. 진행 중인 $name 공구를 고른다"; d="위 목록 맨 위가 지금 열려 있는 공구입니다. 상품명 아래에 셀러 이름과 마감일이 적혀 있습니다." }
  } elseif($soon.Count -gt 0){
    $steps += @{ t="1. 곧 열리는 $name 공구를 확인한다"; d="가장 가까운 일정은 $nearest 오픈입니다. 오픈일 전에 셀러 계정을 팔로우해 두면 알림을 놓치지 않습니다." }
  } else {
    $steps += @{ t="1. 지난 $name 공구 주기를 본다"; d="아래 지난 일정을 보면 이 브랜드가 대략 어느 간격으로 열리는지 가늠할 수 있습니다." }
  }
  $steps += @{ t='2. 카드를 눌러 셀러 인스타그램으로 간다'; d='공구는 셀러가 각자 인스타그램 계정에서 진행합니다. 카드를 누르면 해당 셀러 계정으로 바로 이동합니다.' }
  $steps += @{ t='3. 마감일 전에 신청한다'; d='공구는 기간이 짧습니다. 대부분 3~7일이고, 마감이 지나면 정가로 돌아갑니다.' }

  $faq = @()
  $faq += @{ q="$name 공구는 어디서 하나요?";
             a="인스타그램 셀러들이 각자 계정에서 진행합니다. 이 페이지 목록에서 셀러를 고르고 카드를 누르면 그 셀러의 인스타그램으로 이동합니다." }
  $faq += @{ q="$name 공구 일정은 어떻게 확인하나요?";
             a="이 페이지에서 오픈일과 마감일을 볼 수 있습니다. 맘캘린더는 매일 갱신되므로 새 일정이 잡히면 여기에 함께 올라옵니다." }
  if($live.Count -gt 0){
    $faq += @{ q="지금 $name 공구가 진행 중인가요?";
               a="네, 지금 열려 있는 공구가 이 페이지 맨 위에 있습니다. 마감일을 확인하고 기간 안에 신청하세요." }
  } elseif($soon.Count -gt 0){
    $faq += @{ q="$name 공구는 언제 열리나요?";
               a="가장 가까운 일정은 $nearest 오픈입니다. 오픈일에 맞춰 셀러 계정을 확인하시면 됩니다." }
  } else {
    $faq += @{ q="지금 진행 중인 $name 공구가 없으면 어떻게 하나요?";
               a="아래 지난 일정을 보면 대략 어느 간격으로 열리는지 알 수 있습니다. 한 셀러가 끝내면 다른 셀러가 이어서 여는 경우도 많으니 며칠 뒤 다시 확인해 보세요." }
  }
  if($past.Count -gt 0){
    $faq += @{ q="지난 $name 공구도 볼 수 있나요?";
               a="네, 이 페이지 아래에 지난 일정이 날짜순으로 남아 있습니다. 어느 셀러가 언제 진행했는지 확인할 수 있습니다." }
  }

  $h = "<div class=${Q}sec${Q}><h2>$(HtmlEsc $name) 공구 참여 방법</h2>"
  foreach($s in $steps){ $h += "<div class=${Q}stp${Q}><b>$(HtmlEsc $s.t)</b><span>$(HtmlEsc $s.d)</span></div>" }
  $h += '</div>'
  $h += "<div class=${Q}sec${Q}><h2>자주 묻는 질문</h2>"
  foreach($f in $faq){ $h += "<div class=${Q}faq${Q}><b>$(HtmlEsc $f.q)</b><span>$(HtmlEsc $f.a)</span></div>" }
  $h += '</div>'
  return @{ html=$h; faq=@($faq | ForEach-Object { [pscustomobject]@{ q=$_.q; a=$_.a } }) }
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
