# SEO 페이지 생성 공통 라이브러리 (사장님 지시 2026-08-05)
# 한글 리터럴이 있으므로 이 파일은 반드시 UTF-8 BOM 으로 저장할 것
$Q = [char]34
$SITE = 'https://momcalendar.com'
# 기준일 (KST) — 네이버 AI 브리핑은 **신선도**와 **기준일이 박힌 사실**을 인용한다 (2026-09-23 NEO 작업).
# 페이지마다 "언제 기준 데이터인가"가 없으면 기계가 최신성을 판단할 근거가 없다.
$ASOF = [DateTime]::UtcNow.AddHours(9).ToString('yyyy-MM-dd')
# 🔎 2026-10-24 GEO: 「맘캘린더」를 하나의 조직(엔터티)으로 알리는 자리 — AI 답변이 「공구일정 사이트」 질문에 이름을 붙여 인용하려면
#   이름·별칭·로고·공식 채널(sameAs)이 페이지마다 같아야 한다. sameAs 는 실제로 열리는 공식 채널만(2026-10-24 curl 200 확인). 앱은 스토어 공개 뒤에 넣는다
$ORG_LD = "{${Q}@type${Q}:${Q}Organization${Q},${Q}name${Q}:${Q}맘캘린더${Q},${Q}alternateName${Q}:[${Q}MomCalendar${Q},${Q}맘캘${Q}],${Q}url${Q}:${Q}$SITE/${Q}," +
          "${Q}logo${Q}:${Q}$SITE/momcal-appicon.png${Q}," +
          "${Q}sameAs${Q}:[${Q}https://www.instagram.com/momcal_/${Q},${Q}https://www.threads.com/@momcal_official${Q},${Q}https://cafe.naver.com/momcal${Q},${Q}https://blog.naver.com/momcal${Q}]," +
          "${Q}parentOrganization${Q}:{${Q}@type${Q}:${Q}Organization${Q},${Q}name${Q}:${Q}원츠비${Q}}}"

# ── 2026-11-16 구글 색인 복구 (orders/ORDER_SEO_AEO_GEO_RECOVERY.md) ──
# GA4: index.html 과 같은 측정 ID 를 생성 페이지 전부에 넣는다(전에는 홈 1장에만 있어 g·gg 유입이 안 잡혔다)
$GA4_ID = 'G-NRCP2FVRSB'
$GA4_SNIPPET = "<script async src=${Q}https://www.googletagmanager.com/gtag/js?id=$GA4_ID${Q}></script>`n" +
               "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','$GA4_ID');</script>"
$ROBOTS_NOINDEX = 'noindex,follow,max-image-preview:large'
$RX_ROBOTS = [regex]'<meta name="robots" content="([^"]*)">'
$RX_EVENT = [regex]'<script type="application/ld\+json">\{"@context":"https://schema\.org","@type":"Event",[^<]*?"endDate":"(\d{4}-\d{2}-\d{2})"[^<]*</script>\r?\n?'
$RX_GGPERIOD = [regex]'<h1>[^<]*</h1><p>(\d{4}-\d{2}-\d{2}) ~ (\d{4}-\d{2}-\d{2})'

# 페이지에 noindex 가 있는가 — 경로는 사이트맵 주소 꼴(퍼센트 인코딩 가능), 뿌리 폴더는 인자로 받는다(이 파일은 $Root 를 모른다)
function HasNoindex([string]$rel, [string]$root0){
  $fp = Join-Path $root0 ([uri]::UnescapeDataString($rel))
  if(-not (Test-Path -LiteralPath $fp)){ return $false }
  return ([IO.File]::ReadAllText($fp) -match '<meta name="robots" content="[^"]*noindex')
}
function TextHasNoindex([string]$t){ return ($t -match '<meta name="robots" content="[^"]*noindex') }
function IsTombstoneText([string]$t){ return ($t.IndexOf('http-equiv="refresh"', [StringComparison]::Ordinal) -ge 0 -and (TextHasNoindex $t)) }

# 보존 페이지(다시 안 만들어지는 옛 페이지)의 <head> 고치기 — GA4 넣기 + noai 메타 걷기. 바뀐 게 없으면 원문 그대로 돌려준다(멱등)
#   · noindex 가 이미 있는 페이지의 robots 는 건드리지 않는다(툼스톤·장기 마감)
#   · 툼스톤(바로 넘기는 페이지)에는 GA4 를 넣지 않는다
function PatchHeadText([string]$t){
  if(IsTombstoneText $t){ return $t }
  $o = $t
  if(-not (TextHasNoindex $o)){
    $o = $RX_ROBOTS.Replace($o, [Text.RegularExpressions.MatchEvaluator]{ param($m)
      $parts = @($m.Groups[1].Value -split '\s*,\s*' | Where-Object { $_ -and $_ -notmatch '^(noai|noimageai)$' })
      return "<meta name=${Q}robots${Q} content=${Q}$($parts -join ',')${Q}>" }, 1)
  }
  # 옛 페이지에 남은 「지금 진행 중인 공구는 없습니다 …」 문장(검색 스니펫에 이 문장이 잡혔다)을 사실 문장으로 바꾼다
  if($o.IndexOf('지금 진행 중인 공구는 없습니다', [StringComparison]::Ordinal) -ge 0){
    $o = [regex]::Replace($o, '지금 진행 중인 공구는 없습니다\.( 지난 일정[^.<"]*\.)?', '아래는 맘캘린더에 남아 있는 지난 일정 기록입니다.')
  }
  # 끝난 공구의 Event 마크업을 걷는다 — 진행·예정 때 만든 페이지가 집계에서 빠져 굳으면 Event 를 단 채 남는다(끝난 이벤트 마크업은 구글 가이드 위반)
  if($o.IndexOf('"@type":"Event"', [StringComparison]::Ordinal) -ge 0){
    $o = $RX_EVENT.Replace($o, [Text.RegularExpressions.MatchEvaluator]{ param($m) if($m.Groups[1].Value -lt $ASOF){ return '' } return $m.Value })
  }
  # 끝난 공구인데 「지금 진행 중입니다」「오픈 예정입니다」로 굳은 옛 공구 상세(gg) — 머리의 기간(오픈 ~ 마감)으로 끝났는지 보고 지난 일로 고쳐 쓴다(2026-11-16 검증자 지적 531장)
  if($o.IndexOf('공동구매가 지금 진행 중입니다', [StringComparison]::Ordinal) -ge 0 -or $o.IndexOf('오픈 예정입니다. 마감은', [StringComparison]::Ordinal) -ge 0){
    $mp = $RX_GGPERIOD.Match($o)
    if($mp.Success -and $mp.Groups[2].Value -lt $ASOF){
      $o = [regex]::Replace($o, '공동구매가 지금 진행 중입니다\. (\d{2}/\d{2}) 에 열렸고 (\d{2}/\d{2}) 마감입니다\.( 아래 카드를 누르면 진행 셀러의 인스타그램으로 이동합니다\.)?', '공동구매는 $1 에 열려 $2 에 마감되었습니다. 아래는 그때의 일정 기록입니다.')
      $o = [regex]::Replace($o, '공동구매는 (\d{2}/\d{2}) 오픈 예정입니다\. 마감은 (\d{2}/\d{2}) 입니다\.( 오픈일에 셀러 계정 공지로 신청할 수 있습니다\.)?', '공동구매는 $1 에 열려 $2 에 마감되었습니다. 아래는 그때의 일정 기록입니다.')
      $o = $o.Replace('<a class="card live" ', '<a class="card" ')
    }
  }
  $kfNow = KwFootHtml
  if($o.IndexOf($kfNow, [StringComparison]::Ordinal) -lt 0){
    $mk = $RX_KWFOOT.Match($o)
    if($mk.Success){ $o = $o.Substring(0, $mk.Index) + $kfNow + $o.Substring($mk.Index + $mk.Length) }
    else {
      # 키워드 줄이 아예 없는 옛 틀(2026-09-07 이전에 만든 페이지) — 하단 안내(.foot) 끝에 줄을 붙인다. .foot 안에는 div 가 없다
      $fx = $o.IndexOf("<div class=${Q}foot${Q}>", [StringComparison]::Ordinal)
      if($fx -ge 0){ $fe = $o.IndexOf('</div>', $fx, [StringComparison]::Ordinal); if($fe -gt $fx){ $o = $o.Substring(0, $fe) + '<br>' + $kfNow + $o.Substring($fe) } }
    }
  }
  if($o.IndexOf($GA4_ID, [StringComparison]::Ordinal) -lt 0){
    $ix = $o.IndexOf('</head>', [StringComparison]::OrdinalIgnoreCase)
    if($ix -ge 0){ $o = $o.Substring(0,$ix) + $GA4_SNIPPET + "`n" + $o.Substring($ix) }
  }
  return $o
}
# robots 메타만 바꾼다(보존 gg 페이지를 장기 마감 = noindex 로, 또는 되돌릴 때). 메타가 없으면 그대로
function SetRobotsText([string]$t, [string]$val){
  return $RX_ROBOTS.Replace($t, "<meta name=${Q}robots${Q} content=${Q}$val${Q}>", 1)
}

# 사이트맵 lastmod 용 「본문 해시」 — 날마다 저절로 바뀌는 것(기준일 도장·dateModified·GA4 스니펫·noai 메타·핫딜 구간·줄바꿈 꼴)을 빼고 잰다.
#   이 값이 어제와 같으면 lastmod 는 옛 날짜 그대로다. 내용이 안 바뀐 페이지를 날마다 「오늘 수정」이라고 하면 크롤러가 lastmod 를 안 믿는다(구글·빙 공통)
$RX_CORE = [regex]'(?s)"dateModified":"\d{4}-\d{2}-\d{2}"|<p class="asof">\d{4}-\d{2}-\d{2}|<dt>기준일</dt><dd>[^<]*</dd>|<script async src="https://www\.googletagmanager\.com/gtag/js[^<]*</script>\s*<script>window\.dataLayer[^<]*</script>\s*|,\s*noai,\s*noimageai|<!--hd-->.*?<!--/hd-->|<div class="foot">.*?</div>|\r'
function CoreHash([string]$path){
  $t = $RX_CORE.Replace([IO.File]::ReadAllText($path), '')
  $md5 = [Security.Cryptography.MD5]::Create()
  try{ return [BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($t))) } finally { $md5.Dispose() }
}

# gg 색인 계층 — A 진행 중·예정 / B 최근 마감($cut 이후 마감) / C 그 밖(사이트맵 제외 + noindex,follow, 페이지는 200 유지)
function GgTier($x, [string]$today, [string]$cut){
  if("$($x.od)" -gt $today){ return 'A' }
  if("$($x.od)" -le $today -and "$($x.ed)" -ge $today){ return 'A' }
  if("$($x.ed)" -ge $cut){ return 'B' }
  # 2026-11-19: 최근 90일 구글 노출이 있던 페이지는 색인을 지킨다(명단 tools/seo/gg_keep_index.txt — build.ps1 이 $GgKeepIdx 로 읽는다)
  if($GgKeepIdx -and $GgKeepIdx.Contains("$($x.slug).html")){ return 'B' }
  return 'C'
}

# 재공구 주기 — 오픈일(yyyy-MM-dd) 목록의 서로 다른 날짜 간격 중위값. 이력이 2회 미만이면 $null(추정하지 않는다)
#   $upto(오늘)를 주면 그 뒤 날짜(예정)는 빼고 잰다 — 아직 안 열린 공구를 「열렸습니다」로 세지 않는다
function CycleOf($ods, [string]$upto = ''){
  $ds = @($ods | Where-Object { "$_".Length -ge 10 } | ForEach-Object { "$_".Substring(0,10) } | Where-Object { -not $upto -or $_ -le $upto } | Sort-Object -Unique)
  if($ds.Count -lt 2){ return $null }
  $gaps = New-Object System.Collections.ArrayList
  for($i = 1; $i -lt $ds.Count; $i++){
    try{ [void]$gaps.Add([int]([DateTime]::ParseExact($ds[$i],'yyyy-MM-dd',$null) - [DateTime]::ParseExact($ds[$i-1],'yyyy-MM-dd',$null)).TotalDays) }catch{}
  }
  if($gaps.Count -eq 0){ return $null }
  $g = @($gaps | Sort-Object)
  $med = $(if($g.Count % 2 -eq 1){ [int]$g[($g.Count-1)/2] } else { [int][Math]::Round(($g[$g.Count/2-1] + $g[$g.Count/2]) / 2.0) })
  # 여러 셀러가 번갈아 여는 브랜드는 간격이 며칠이다 — 그걸 「한 달 안팎」이라고 뭉개지 않는다
  $lab = $(if($med -le 3){ '며칠' } elseif($med -le 10){ '일주일 안팎' } elseif($med -lt 30){ '2~4주' } elseif($med -lt 90){ '1~3개월' } else { '3개월 이상' })
  return [pscustomobject]@{ n=$ds.Count; days=$med; label=$lab; first=$ds[0]; last=$ds[$ds.Count-1] }
}

# Event JSON-LD — 진행 중·예정 공구에만(끝난 이벤트 마크업은 구글 가이드 위반). offers·price 는 넣지 않는다(공구 가격을 수집하지 않는다)
#   location = 셀러 인스타(온라인), organizer = 셀러(없으면 브랜드). 맘캘린더는 주최자가 아니다. 시각은 지어내지 않는다(날짜만)
function LdEvent($x, [string]$canon, [string]$brand){
  if("$($x.od)".Length -lt 10 -or "$($x.ed)".Length -lt 10){ return $null }
  $md = "$([int]"$($x.od)".Substring(5,2))/$([int]"$($x.od)".Substring(8,2))"
  $ig = $(if($x.PSObject.Properties['insta'] -and $x.insta){ "https://www.instagram.com/$($x.insta)" } else { '' })
  $who = $(if($x.PSObject.Properties['who'] -and $x.who){ "$($x.who)" } else { '' })
  $loc = $(if($ig){ "{${Q}@type${Q}:${Q}VirtualLocation${Q},${Q}name${Q}:${Q}인스타그램 @$(JsonEsc "$($x.insta)")${Q},${Q}url${Q}:${Q}$ig${Q}}" } else { "{${Q}@type${Q}:${Q}VirtualLocation${Q},${Q}name${Q}:${Q}인스타그램${Q}}" })
  $orgName = $(if($who){ $who } else { $brand })
  $org = "{${Q}@type${Q}:${Q}Organization${Q},${Q}name${Q}:${Q}$(JsonEsc $orgName)${Q}$(if($ig){ ",${Q}url${Q}:${Q}$ig${Q}" })}"
  $desc = "$($x.name) 인스타 공동구매. $($x.od) 오픈, $($x.ed) 마감.$(if($who){ " 진행 셀러 $who." })"
  return "{${Q}@context${Q}:${Q}https://schema.org${Q},${Q}@type${Q}:${Q}Event${Q}," +
    "${Q}name${Q}:${Q}$(JsonEsc "$($x.name) 공구 ($md 오픈)")${Q}," +
    "${Q}startDate${Q}:${Q}$($x.od)${Q},${Q}endDate${Q}:${Q}$($x.ed)${Q}," +
    "${Q}eventStatus${Q}:${Q}https://schema.org/EventScheduled${Q}," +
    "${Q}eventAttendanceMode${Q}:${Q}https://schema.org/OnlineEventAttendanceMode${Q}," +
    "${Q}location${Q}:$loc,${Q}organizer${Q}:$org,${Q}isAccessibleForFree${Q}:true," +
    "${Q}url${Q}:${Q}$SITE/$canon${Q},${Q}image${Q}:${Q}$SITE/og-image.png${Q}," +
    "${Q}description${Q}:${Q}$(JsonEsc $desc)${Q}}"
}

# 핫딜 목록 JSON-LD — 핫딜 페이지에만(실가격이 있는 것). Product + Offer, price 는 문자열·원 단위 정수. image·review·aggregateRating 은 넣지 않는다(없는 것을 만들지 않는다)
function LdDealList([string]$name, $deals, [string]$canon){
  $el = New-Object System.Collections.ArrayList; $i = 0
  foreach($h in $deals){
    if([int]$h.price -le 0 -or -not $h.title){ continue }
    $i++
    $offer = "{${Q}@type${Q}:${Q}Offer${Q},${Q}price${Q}:${Q}$([int]$h.price)${Q},${Q}priceCurrency${Q}:${Q}KRW${Q}" +   # 재고(availability)는 적지 않는다 — 이 빌드는 품절을 다시 재지 않는다(단정 금지)
             $(if("$($h.link)" -match '^https?://'){ ",${Q}url${Q}:${Q}$(JsonEsc "$($h.link)")${Q}" }) +
             ",${Q}seller${Q}:{${Q}@type${Q}:${Q}Organization${Q},${Q}name${Q}:${Q}$(JsonEsc "$($h.mall)")${Q}}}"
    [void]$el.Add("{${Q}@type${Q}:${Q}ListItem${Q},${Q}position${Q}:$i,${Q}item${Q}:{${Q}@type${Q}:${Q}Product${Q},${Q}name${Q}:${Q}$(JsonEsc "$($h.title)")${Q},${Q}offers${Q}:$offer}}")
  }
  if($el.Count -eq 0){ return $null }
  return "{${Q}@context${Q}:${Q}https://schema.org${Q},${Q}@type${Q}:${Q}ItemList${Q},${Q}name${Q}:${Q}$(JsonEsc $name)${Q},${Q}url${Q}:${Q}$SITE/$canon${Q},${Q}numberOfItems${Q}:$($el.Count),${Q}itemListElement${Q}:[$($el -join ',')]}"
}

# 툼스톤 — 지워야 하는 페이지 자리에 남기는 「넘김 쪽지」. GitHub Pages 는 서버 301 을 못 해서 200 + noindex + canonical + meta refresh 로 대신한다.
#   🔴 브랜드·상품 이름을 쓰지 않는다(brand_block 으로 지워 달라고 한 브랜드의 흔적을 남기지 않는다). $dest 는 사이트 안 경로(퍼센트 인코딩된 꼴, 앞 슬래시 없이)
function TombstoneHtml([string]$dest){
  $u = "$SITE/$dest"
  return "<!DOCTYPE html><html lang=${Q}ko${Q}><head><meta charset=${Q}UTF-8${Q}>`n" +
         "<meta name=${Q}robots${Q} content=${Q}noindex,follow${Q}>`n" +
         "<link rel=${Q}canonical${Q} href=${Q}$u${Q}>`n" +
         "<meta http-equiv=${Q}refresh${Q} content=${Q}0; url=$u${Q}>`n" +
         "<title>정리된 일정 · 맘캘린더</title></head>`n" +
         "<body><p>이 일정은 정리되었습니다. <a href=${Q}/$dest${Q}>최근 공구 일정 보기</a></p></body></html>`n"
}

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
.tblw{overflow-x:auto;background:#fff;border:1px solid #ECE7F3;border-radius:12px}
.hist{width:100%;border-collapse:collapse;font-size:13px}
.hist th,.hist td{padding:9px 11px;border-bottom:1px solid #F4F0F9;text-align:left;vertical-align:top}
.hist tr:last-child td{border-bottom:none}
.hist th{font-size:12px;color:#7A7286;font-weight:700;white-space:nowrap}
.hist td:first-child{white-space:nowrap;color:#4A4356;font-size:12.5px;width:1%}
.hist td:last-child{width:28%;word-break:break-all}
.hist td a{color:#5B3A8C;text-decoration:none}
.hist i{font-style:normal;font-size:11px;color:#7C54C4;font-weight:700}
.cta{display:block;text-align:center;background:#602090;color:#fff;text-decoration:none;border-radius:12px;padding:15px;font-weight:800;margin-top:22px}
.rel{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.rel a{font-size:12.5px;background:#fff;border:1px solid #E3DCEF;border-radius:20px;padding:6px 12px;color:#5B3A8C;text-decoration:none}
.asof{font-size:11.5px;color:#8E85A0;margin-top:12px}
.ans{font-size:15.5px;line-height:1.65;color:#2F2840;font-weight:600;margin:14px 0 4px}
.facts{background:#fff;border:1px solid #ECE7F3;border-radius:12px;padding:4px 15px;margin:13px 0}
.facts div{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #F4F0F9;font-size:13.5px}
.facts div:last-child{border-bottom:0}
.facts dt{flex:0 0 92px;color:#7A7286;font-weight:600}
.facts dd{flex:1;color:#2F2840;margin:0}
.foot{font-size:11.5px;color:#9C93AC;margin-top:28px;text-align:center;line-height:1.9}
.foot a{color:#7B3FB5}
.note{background:#FFF6E5;border:1px solid #F0DCB4;border-radius:12px;padding:13px 15px}
.note b{display:block;font-size:14.5px;color:#8A5A12;margin-bottom:4px}
.note span{display:block;font-size:13.5px;color:#6B5533}
.note .lnk{margin-top:7px}
.note a{color:#7B3FB5;font-weight:700;text-decoration:none}
.appcta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #DCCBF2;border-left:4px solid #7C54C4;border-radius:12px;padding:10px 12px;margin-top:14px;font-size:12.5px;line-height:1.4;color:#4A4356}
.appcta b{font-size:13.5px;color:#5B3A8C}
.appcta .ap{margin-left:auto;padding:6px 10px;border-radius:8px;font-size:11.5px;font-weight:800;text-decoration:none;background:#602090;color:#fff;white-space:nowrap}
.appcta .ap.g{margin-left:0;background:#fff;color:#4A35A0;border:1px solid #DCCBF2}
.appcta.os-ios .ap.and{display:none}
.appcta.os-and .ap.ios{display:none}
.appcta.os-and .ap.and{margin-left:auto;background:#602090;color:#fff;border:0}
'@

# 하단 키워드 내부 링크 (모든 생성 페이지 + 보존 페이지 공통). 앵커 문구 = 노리는 검색어 그대로 (사장님 2026-09-07 · 2026-11-18 정확한 키워드로)
#   2026-11-23 ORDER_TEST_BLOCK_AND_SEO_TOP3 §5-4: 12 → 8 (대표 허브 6 + 오늘공구·인스타 공구). 뺀 4장(공구일정·공구사이트·공구하는곳·인스타공구어플)은 삭제·noindex 하지 않고 사이트맵·홈 링크에 그대로 둔다
$KW_FOOT = @(
  @('공구일정사이트.html','공구일정사이트'), @('인스타공구모음.html','인스타공구모음'), @('인스타공구사이트.html','인스타 공구 사이트'),
  @('공구모음사이트.html','공구모음사이트'), @('공동구매사이트.html','공동구매 사이트'), @('공동구매하는곳.html','공동구매하는곳'),
  @('오늘공구.html','오늘 공구'), @('인스타공구.html','인스타 공구')
)
$script:KwFootCache = ''
function KwFootHtml(){
  if(-not $script:KwFootCache){
    $kl = @(); foreach($kf in $KW_FOOT){ $kl += "<a href=${Q}/$(Enc($kf[0]))${Q}>$(HtmlEsc $kf[1])</a>" }
    $script:KwFootCache = ($kl -join ' · ')
  }
  return $script:KwFootCache
}
# 보존 페이지(다시 안 만드는 옛 g·p·s·gg)의 하단 키워드 줄 — 옛 앵커(「공구 일정 사이트」 등)를 지금 줄로 바꾼다. 줄이 없는 아주 옛 페이지는 그대로 둔다
$RX_KWFOOT = [regex]'<a href="/%EC%9D%B8%EC%8A%A4%ED%83%80%EA%B3%B5%EA%B5%AC\.html">인스타 공구</a> · <a href="/[^<]*</a>(?: · <a href="/[^<]*</a>)*(?=</div>)'

# 페이지 하나를 쓴다. $o 는 해시테이블:
#   path title desc canon h1 sub body(html) jsonld(문자열배열) bcName
function WritePage([hashtable]$o){
  $tE = HtmlEsc $o.title
  # 2026-10-27 빙 웹마스터 권고 「설명 문구가 너무 짧은 페이지가 많다」 — 80자 미만이면 사이트 소개를 덧붙인다(160자 안쪽)
  $d0 = "$($o.desc)"
  if($d0.Length -lt 80){ $d0 = "$d0 맘캘린더(momcalendar.com)는 인스타 공동구매 일정·핫딜·세일 정보 공유 사이트입니다.".Trim() }
  if($d0.Length -gt 160){ $d0 = $d0.Substring(0,158).TrimEnd() + '…' }
  $dE = HtmlEsc $d0
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">')
  [void]$sb.AppendLine('<meta name="viewport" content="width=device-width,initial-scale=1">')
  [void]$sb.AppendLine("<title>$tE</title>")
  [void]$sb.AppendLine("<meta name=${Q}description${Q} content=${Q}$dE${Q}>")
  [void]$sb.AppendLine("<link rel=${Q}canonical${Q} href=${Q}$SITE/$($o.canon)${Q}>")
  # 파비콘 — 없으면 네이버·구글 검색결과에 지구본 아이콘이 뜬다(사장님 지적 2026-08-25).
  # 반드시 절대경로(/)로. 상대경로면 g/·p/ 하위 페이지에서 깨진다.
  [void]$sb.AppendLine("<link rel=${Q}icon${Q} href=${Q}/favicon.ico${Q} sizes=${Q}any${Q}>")
  [void]$sb.AppendLine("<link rel=${Q}icon${Q} type=${Q}image/png${Q} sizes=${Q}512x512${Q} href=${Q}/momcal-appicon.png${Q}>")
  [void]$sb.AppendLine("<link rel=${Q}apple-touch-icon${Q} href=${Q}/momcal-appicon.png${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:image${Q} content=${Q}$SITE/og-image.png${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:image:width${Q} content=${Q}1200${Q}><meta property=${Q}og:image:height${Q} content=${Q}630${Q}>")   # 2026-10-27 AI 답·메신저 링크 미리보기를 크게(홈과 같은 그림)
  # 2026-11-16 (ORDER_SEO_AEO_GEO_RECOVERY §6-1): 계층별 robots — noindex 는 gg C 계층(장기 마감)·툼스톤에만 붙는다.
  #   noai·noimageai 는 뺐다 — AI 학습 차단은 robots.txt 의 Content-Signal: ai-train=no 와 학습봇 Disallow 가 하고 있고, 이 메타는 「AI 인용 환영」 신호와 부딪힌다
  $rb = $(if($o.robots){ "$($o.robots)" } else { 'index,follow,max-image-preview:large' })
  [void]$sb.AppendLine("<meta name=${Q}robots${Q} content=${Q}$rb${Q}>")
  # GA4 — index.html 과 같은 측정 ID. async 유지(LCP 보호). verify.ps1 이 「페이지마다 정확히 1회」를 본다
  [void]$sb.AppendLine($GA4_SNIPPET)
  [void]$sb.AppendLine("<meta property=${Q}og:title${Q} content=${Q}$tE${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:description${Q} content=${Q}$dE${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:type${Q} content=${Q}website${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:url${Q} content=${Q}$SITE/$($o.canon)${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:site_name${Q} content=${Q}맘캘린더${Q}>")
  [void]$sb.AppendLine("<meta property=${Q}og:locale${Q} content=${Q}ko_KR${Q}>")
  [void]$sb.AppendLine("<meta name=${Q}twitter:card${Q} content=${Q}summary_large_image${Q}><meta name=${Q}twitter:image${Q} content=${Q}$SITE/og-image.png${Q}>")
  # 🔎 dateModified — 기계가 "언제 기준 데이터인가"를 읽는 자리 (NEO/AI 브리핑 신선도 신호).
  #   화면의 "$ASOF 기준" 줄과 **같은 날짜**여야 한다. 둘이 어긋나면 거짓 신호가 된다.
  $wp = "{${Q}@context${Q}:${Q}https://schema.org${Q},${Q}@type${Q}:${Q}WebPage${Q}," +
        "${Q}name${Q}:${Q}$(JsonEsc $o.title)${Q},${Q}url${Q}:${Q}$SITE/$($o.canon)${Q}," +
        "${Q}inLanguage${Q}:${Q}ko-KR${Q},${Q}dateModified${Q}:${Q}$ASOF${Q}," +
        "${Q}isPartOf${Q}:{${Q}@type${Q}:${Q}WebSite${Q},${Q}name${Q}:${Q}맘캘린더${Q},${Q}alternateName${Q}:[${Q}MomCalendar${Q},${Q}맘캘${Q}],${Q}url${Q}:${Q}$SITE/${Q}}," +
        "${Q}publisher${Q}:$ORG_LD}"
  [void]$sb.AppendLine("<script type=${Q}application/ld+json${Q}>$wp</script>")
  if($o.jsonld){
    foreach($j in $o.jsonld){
      [void]$sb.AppendLine("<script type=${Q}application/ld+json${Q}>$j</script>")
    }
  }
  [void]$sb.AppendLine("<style>$CSS</style></head><body>")
  [void]$sb.AppendLine("<div class=${Q}hd${Q}><div class=${Q}wrap${Q}><a class=${Q}bk${Q} href=${Q}/${Q}>← 맘캘린더</a>")
  [void]$sb.AppendLine("<h1>$(HtmlEsc $o.h1)</h1><p>$(HtmlEsc $o.sub)</p></div></div>")
  [void]$sb.AppendLine("<div class=${Q}wrap${Q}>")
  # 📲 앱 전환 배너 (2026-11-22 ORDER §4) — 문구·숫자는 build.ps1 이 계산한 $AppCta (noindex 페이지엔 넣지 않는다)
  if($AppCta -and (("$($o.robots)") -notmatch 'noindex')){ [void]$sb.AppendLine($AppCta) }
  if($o.bcName){
    [void]$sb.AppendLine("<div class=${Q}bc${Q}><a href=${Q}/${Q}>맘캘린더</a> › $(HtmlEsc $o.bcName)</div>")
  }
  # 🔎 라벨-값 사실 표 (NEO/AI 브리핑) — 네이버 AI 브리핑은 산문 덩어리가 아니라
  #   **항목-값 구조**를 인용한다. 카드 목록만 있던 페이지에 기계가 읽을 요약을 하나 둔다.
  #   ⚠ 값이 없는 항목은 아예 그리지 않는다 — 빈칸이 보이면 사실이 아닌 것을 말하는 셈이다.
  # 🔎 직답 문단 (AEO/GEO, 2026-10-24) — 답변 엔진은 질문 바로 아래 **첫 문장**을 인용한다. 배경 설명보다 결론을 먼저 둔다
  if($o.answer){ [void]$sb.AppendLine("<p class=${Q}ans${Q}>$(HtmlEsc $o.answer)</p>") }
  if($o.facts){
    $fr = @()
    foreach($f in $o.facts){
      if($f -and $f.v -and -not [string]::IsNullOrWhiteSpace([string]$f.v)){
        $fr += "<div><dt>$(HtmlEsc $f.k)</dt><dd>$(HtmlEsc([string]$f.v))</dd></div>"
      }
    }
    if($fr.Count -gt 0){
      [void]$sb.AppendLine("<dl class=${Q}facts${Q}>" + ($fr -join '') + "</dl>")
    }
  }
  $asT = $(if($o.asofText){ $o.asofText } else { '기준 · 공구 일정은 매일 자동 갱신됩니다' })
  [void]$sb.AppendLine("<p class=${Q}asof${Q}>$ASOF $(HtmlEsc $asT)</p>")
  [void]$sb.AppendLine($o.body)
  if($o.cta2){ [void]$sb.AppendLine($o.cta2) }   # 긴 목록 페이지의 하단 앱 CTA (2026-11-23 ORDER_STORE_SEO_CONVERSION §6-4)
  $ctaH = $(if($o.cta){ $o.cta } else { '/' }); $ctaT = $(if($o.ctaText){ $o.ctaText } else { '오늘 진행 중인 공구 보러 가기 →' })
  [void]$sb.AppendLine("<a class=${Q}cta${Q} href=${Q}$ctaH${Q}>$(HtmlEsc $ctaT)</a>")
  [void]$sb.AppendLine("<div class=${Q}foot${Q}>맘캘린더는 인스타그램 공동구매 일정을 모아 보여주는 무료 서비스입니다.<br>")
  [void]$sb.AppendLine("공구 일정은 매일 갱신됩니다.<br>")
  [void]$sb.AppendLine("<a href=${Q}/${Q}>momcalendar.com</a> · <a href=${Q}/$(Enc('공구브랜드.html'))${Q}>브랜드</a> · <a href=${Q}/$(Enc('공구셀러.html'))${Q}>셀러</a> · <a href=${Q}/$(Enc('공구제품.html'))${Q}>제품</a><br>")
  # 검색 유입 키워드 페이지로 가는 내부 링크 (2026-09-07 사장님 지시 "관련 검색어 다 1위로").
  # 실측: 키워드 랜딩 28장을 링크하는 곳이 홈의 2개뿐이라(나머지는 사이트맵만) 구글·네이버가 '중요하지 않은 페이지'로 본다.
  # 생성 페이지 1.8만 장이 전부 이 줄을 달면 내부 링크가 생긴다. 앵커 문구 = 노리는 검색어 그대로.
  # 2026-11-18: 앵커 = 노리는 검색어 글자 그대로(공구일정사이트·공구모음사이트·공동구매 사이트·공동구매하는곳·인스타 공구 사이트·인스타공구모음). 목록은 위 $KW_FOOT 한 곳
  [void]$sb.AppendLine((KwFootHtml) + '</div>')
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

function ExtraBody([string]$name, [string]$kind, $live, $soon, $past, $terms, $moreFaq = @()){
  # 2026-11-16 검증자: 예정이 2건 이상이면 더 먼 날짜를 「다음 공구」라고 답하고 있었다 → 예정은 가까운 날부터, 지난 것은 최근부터 본다
  $soon = @($soon | Sort-Object @{e='od';Descending=$false}); $past = @($past | Sort-Object @{e='od';Descending=$true})
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
  # 🔎 2026-10-27 AEO: 「○○ 공구 어디서 해요?」「누가 해요?」「다음 공구 언제예요?」에 이 페이지의 실제 일정으로 답한다(사장님 「모든 db를」)
  $md = { param($d) $d = "$d"; if($d.Length -ge 10){ return "$([int]$d.Substring(5,2))/$([int]$d.Substring(8,2))" } return $d }
  $it = { param($r) "$($r.name)$(if($kind -ne '셀러' -and $r.who){ "($($r.who))" })" }
  $whoList = @(@($live) + @($soon) + @($past) | Where-Object { $_.who } | ForEach-Object { "$($_.who)" } | Select-Object -Unique)
  $now = $(if($live.Count -gt 0){ "지금 $($live.Count)건이 진행 중입니다. " + ((@($live | Select-Object -First 3) | ForEach-Object { "$(& $it $_) $(& $md $_.ed) 마감" }) -join ', ') + '.' } elseif($soon.Count -gt 0){ "다음 공구는 $(& $it $soon[0]) $(& $md $soon[0].od) 오픈입니다." } elseif($past.Count -gt 0){ "가장 최근 공구는 $(& $it $past[0]) ($(& $md $past[0].od)~$(& $md $past[0].ed))였습니다." } else { '' })
  if($kind -eq '셀러'){
    $faq += @{ q="$name 공구 어디서 해요?"; a="$name 셀러의 인스타그램 계정에서 진행하고, 일정은 맘캘린더(momcalendar.com) 셀러 페이지에 모여 있습니다. $now" }
  } else {
    $faq += @{ q="$name 공구 어디서 해요?"; a="$name 공구는 인스타그램 셀러들이 각자 계정에서 엽니다. 맘캘린더(momcalendar.com)에 $name 공구를 진행한 셀러 $($whoList.Count)명의 일정이 모여 있습니다. $now" }
    if($whoList.Count -gt 0){ $faq += @{ q="$name 공구 누가 해요?"; a="맘캘린더에 기록된 $name 공구 셀러는 $(($whoList | Select-Object -First 6) -join ', ')$(if($whoList.Count -gt 6){ ' 등' }) $($whoList.Count)명입니다. 셀러를 누르면 그 셀러의 다른 공구도 볼 수 있습니다." } }
  }
  if($soon.Count -gt 0){ $faq += @{ q="$name 다음 공구 언제예요?"; a="$(& $md $soon[0].od) 오픈하는 $(& $it $soon[0])입니다.$(if($soon.Count -gt 1){ " 그다음은 $(& $md $soon[1].od) 오픈 $(& $it $soon[1])입니다." })" } }

  # '가격' 은 자동완성 실측 1위 꼬리말이다("무아스 공구 가격" 등 15개 브랜드, 2026-08-14).
  # 우리는 공구 가격을 수집하지 않으므로 낚시가 되지 않게 '어디서 확인하는지' 를 정직하게 안내한다.
  $faq += @{ q="$name 공구 가격은 어디서 확인하나요?";
             a="공구 가격은 오픈일에 각 셀러가 인스타그램 공지로 공개합니다. 같은 제품이라도 셀러와 구성에 따라 가격이 다를 수 있으니, 위 목록에서 진행 중인 셀러 카드를 눌러 그 계정의 공지에서 가격과 구매 링크를 확인하세요." }
  $faq += @{ q="인스타그램 $name 공구는 어떻게 찾나요?";
             a="셀러마다 계정이 달라 하나씩 찾기 어렵습니다. 맘캘린더는 여러 셀러의 $name 공구를 한곳에 모아 오픈일·마감일과 함께 보여줍니다. 매일 갱신됩니다." }
  if($past.Count -gt 0){
    $faq += @{ q="지난 $name 공구도 볼 수 있나요?";
               a="네, 이 페이지 아래에 지난 일정이 날짜순으로 남아 있습니다. 어느 셀러가 언제 진행했는지 확인할 수 있습니다." }
  }

  # 2026-11-16: 페이지마다 다른 질문(재공구 주기·다음 공구 등)을 부르는 쪽에서 더 얹는다 — 같은 질문은 한 번만
  foreach($mf in @($moreFaq)){ if($mf -and $mf.q -and $mf.a -and @($faq | Where-Object { $_.q -eq $mf.q }).Count -eq 0){ $faq += @{ q="$($mf.q)"; a="$($mf.a)" } } }

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
