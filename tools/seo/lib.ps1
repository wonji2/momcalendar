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
#
# 📌 실측한 검색어(2026-08-11, 구글 자동완성 25개 브랜드)
#   · `브랜드 공구`            — 전부 존재
#   · `브랜드 제품 공구`        — **여기가 금맥**
#       무아스 디스펜서 공구 / 무아스 드라이기 공구 / 무아스 에어롤 공구
#       알텐바흐 저압냄비 공구 / 알텐바흐 티타늄 마스터 공구
#       닌자 크리스피 공구 / 닌자 블렌더 공구 / 주니 자기주도컵 공구
#   · `instagram 브랜드 공구`   — 바크·탁가온·주니·드시모네·블루래빗에서 확인
#   · ❌ `브랜드 공구 일정`      — 자동완성에 **없다**. 제목을 '공구 일정' 으로 시작하면 안 된다
#   · ❌ `브랜드 핫딜` `공구하는곳` `공구중인곳` — 제안 자체가 없다
#   · ❌ `공구 참여 방법`        — 수요 없음(자기 자신만 뜸). 예전에 넣었다가 뺐다
#   · 셀러명+공구는 수요가 거의 없다(드엘리사만) → 셀러 페이지는 가볍게 둔다
#
# $terms 에 제품명 배열을 주면 `브랜드 제품 공구` 조합을 본문에 풀어 쓴다.
# 붙어 있는 낱말에서 떼어낼 일반 명사. 긴 것부터 봐야 '무선선풍기'→'선풍기' 가 먼저 걸린다.
$script:PROD_NOUN = @(
  '물티슈','프라이팬','에어프라이어','디스펜서','드라이기','선풍기','청소기','정수기','제습기','가습기',
  '유모차','카시트','기저귀','텀블러','책장','매트','가방','의자','침대','이불','베개','수건','세제',
  '치약','칫솔','밥솥','다리미','도마','그릇','수저','스푼','포크','빨대','양말','신발','모자','인형',
  '블럭','냄비','젖병','분유','티슈','간식','사료','컵','팬','칼','책',
  # 실측으로 추가(2026-08-11) — 자동완성에 뜨는데 우리가 못 뽑던 것들
  '보호대','파우치','물병','사운드북','기피제','안전문','러닝타워','스푼포크','빨대컵','유산균',
  '오메가','비타민','영양제','효소','콜라겐','철분','마그네슘','아연','루테인','프로바이오틱스','휴지통','에어건','밧드','냄비세트','조리도구','이유식','간식세트'
) | Sort-Object -Property @{e={$_.Length};Descending=$true}

function ExtraBody([string]$name, [string]$kind, $live, $soon, $past, $terms){
  $nearest = ''
  if($live.Count -gt 0){ $nearest = "$($live[0].od)" }
  elseif($soon.Count -gt 0){ $nearest = "$($soon[0].od)" }
  # 제품어 뽑기 — 상품명에서 브랜드를 떼고 앞 낱말을 쓴다.
  # '무아스 에어롤 프로' → '에어롤',  '무아스 2 in 1 핸디 스팀 다리미' → '핸디'
  # ⚠ topprods 만 쓰면 3개뿐이라 '무아스 드라이기 공구' 같은 실검색어를 놓친다(2026-08-11 실측).
  #   실제 상품명에서 뽑아야 자동완성과 맞는다.
  $freq = @{}
  foreach($r in (@($live) + @($soon) + @($past))){
    $nm = "$($r.name)"
    if(-not $nm.StartsWith($name)){ continue }
    $rest = $nm.Substring($name.Length)
    $rest = [regex]::Replace($rest, '^[\s·,&/\-\+\(\)\[\]]+', '')
    if($rest -eq ''){ continue }
    # ⚠ 앞 낱말을 잡으면 수식어가 나온다('무아스 마그넷선풍기' → 마그넷, '2 in 1' → in).
    #   한국어 상품명은 **뒷말이 제품 이름**이다('… 스팀 다리미' → 다리미). 뒤에서부터 찾는다.
    $tk = @([regex]::Split($rest, '[\s·,&/\+\(\)\[\]]+') | Where-Object { $_ -ne '' })
    for($i = $tk.Count - 1; $i -ge 0; $i--){
      $t = $tk[$i]
      if($t.Length -lt 2){ continue }
      if($t -match '^\d'){ continue }
      if($t -match '^(프로|세트|모음|모음전|기획전|특가|초특가|앵콜|국산|신상|한정|공구|전체|단품|구성|정품|골라담기|최초|런칭|버전|시리즈|에디션)$'){ continue }
      if($t -match '^[A-Za-z]{1,2}$'){ continue }
      if($t -cmatch '^[A-Z]+$'){ continue }          # BEST · NEW · HOT 같은 잡음
      if($t -match '^(종|개|팩|박스|차수|기획|할인|증정|무료|배송|리뉴얼|앵콜전|사은품)$'){ continue }
      $freq[$t] = 1 + $(if($freq.ContainsKey($t)){ $freq[$t] } else { 0 })
      # '자기주도컵' → '컵', '마그넷선풍기' → '선풍기' 처럼 낱말이 붙어 있으면 일반 명사도 같이 뽑는다.
      # 사람들은 '주니 컵 공구' 로 검색하지 '주니 자기주도컵 공구' 로는 덜 친다(자동완성 실측).
      foreach($sfx in $script:PROD_NOUN){
        if($t.Length -gt $sfx.Length -and $t.Contains($sfx)){
          $freq[$sfx] = 1 + $(if($freq.ContainsKey($sfx)){ $freq[$sfx] } else { 0 })
          break
        }
      }
      break                                   # 상품명당 하나만
    }
  }
  $tArr = @($freq.GetEnumerator() | Sort-Object -Property @{e={$_.Value};Descending=$true}, @{e='Key'} | ForEach-Object { $_.Key })
  if($terms){ foreach($t in $terms){ if($t -and "$t" -ne $name -and $tArr -notcontains "$t"){ $tArr += "$t" } } }
  $top = ''; if($tArr.Count -gt 0){ $top = "$($tArr[0])" }

  $h = ''
  # ── 검색어 조합을 문장으로 푼다 (브랜드 페이지에서 가장 크게 먹힌다)
  if($tArr.Count -gt 0){
    # ⚠ 상위 8개만 쓰면 '주니 자기주도스푼'·'주니 모서리보호대' 처럼 빈도가 낮은 실검색어가 잘린다.
    #   (사장님 지적 2026-08-11 — DB 에 이미 있는데 페이지에 안 나온다)
    #   앞 12개는 문장으로, 나머지는 한 줄 더 붙여 최대 30개까지 싣는다.
    $head = @($tArr | Select-Object -First 12)
    $tail = @($tArr | Select-Object -Skip 12 -First 18)
    $combo = ($head | ForEach-Object { "$name $_ 공구" }) -join ', '
    $h += "<div class=${Q}sec${Q}><h2>$(HtmlEsc $name) 공구, 어떤 제품이 열리나요</h2>"
    $h += "<p>맘캘린더에 기록된 $(HtmlEsc $name) 공동구매는 $(HtmlEsc $combo) 등입니다. "
    $h += "인스타그램 셀러들이 각자 계정에서 열며, 오픈일과 마감일은 위 목록에서 확인할 수 있습니다.</p>"
    if($tail.Count -gt 0){
      $combo2 = ($tail | ForEach-Object { "$name $_ 공구" }) -join ', '
      $h += "<p>이 밖에 $(HtmlEsc $combo2) 도 진행된 적이 있습니다. "
      $h += "찾는 제품이 목록에 없으면 지난 일정을 보면 대략 어느 간격으로 다시 열리는지 가늠할 수 있습니다.</p>"
    } else {
      $h += "<p>찾는 제품이 목록에 없으면 지난 일정을 보면 대략 어느 간격으로 다시 열리는지 가늠할 수 있습니다.</p>"
    }
    $h += '</div>'
  }

  $faq = @()
  if($top){
    $faq += @{ q="$name $top 공구는 지금 진행 중인가요?";
               a=$(if($live.Count -gt 0){ "이 페이지 맨 위 '지금 진행 중인 $name 공구' 에 열려 있는 건이 있습니다. 마감일을 확인하고 기간 안에 신청하세요." } elseif($soon.Count -gt 0){ "지금 열려 있는 건은 없고, 가장 가까운 $name 공구는 $nearest 오픈입니다." } else { "지금 열려 있는 $name $top 공구는 없습니다. 아래 지난 일정에서 언제 진행됐는지 확인하면 다음 시기를 가늠할 수 있습니다." }) }
  }
  $faq += @{ q="$name 공구는 어디서 하나요?";
             a="인스타그램 셀러들이 각자 계정에서 진행합니다. 이 페이지 목록에서 셀러를 고르고 카드를 누르면 그 셀러의 인스타그램 계정으로 바로 이동합니다." }
  $faq += @{ q="인스타그램 $name 공구는 어떻게 찾나요?";
             a="셀러마다 계정이 달라 하나씩 찾기 어렵습니다. 맘캘린더는 여러 셀러의 $name 공구를 한곳에 모아 오픈일·마감일과 함께 보여줍니다. 매일 갱신됩니다." }
  if($live.Count -eq 0 -and $soon.Count -gt 0){
    $faq += @{ q="$name 공구는 언제 열리나요?"; a="가장 가까운 일정은 $nearest 오픈입니다. 오픈일에 맞춰 해당 셀러 계정을 확인하시면 됩니다." }
  }
  if($past.Count -gt 0){
    $faq += @{ q="지난 $name 공구도 볼 수 있나요?";
               a="네, 이 페이지 아래에 지난 일정이 날짜순으로 남아 있습니다. 어느 셀러가 언제 진행했는지 확인할 수 있습니다." }
  }

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
