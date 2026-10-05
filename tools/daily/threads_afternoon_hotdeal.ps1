# 오후 핫딜 1건 — 사장님 지시 2026-10-05 "핫딜 지금 올리는 작업중이니 오후에 하나 확인해서 가격 핫딜 맞는거 올려"
#   하는 일: 핫딜 카드 글을 만들고(가격 검증을 통과한 딜만 본문에 들어간다) → 바로 발행 대상으로 승인한다.
#   발행은 momcal-threads-due(10분마다)가 맡는다.
#
# 🔴 2026-10-05 첫 실행이 **결과 코드 1 로 죽고 로그도 안 남았다**. 고친 것:
#   ① node 가 실패해도 **승인 단계는 돌게** try/catch 로 감쌌다 (창 작업이 이미 만들어 둔 글이 있을 수 있다)
#   ② 승인 대상을 "15분 안에 만든 글" → **오늘 만든 글 전체**로 넓혔다
#      (실측: 14:49 에 w3 창이 이미 #24 를 만들어 둬서, 16:00 에 --force 로 또 만들려 하자 "같은 글이 이미 있다"로 끝나고
#       15분 윈도우엔 아무것도 안 걸려 **아무 일도 일어나지 않았다**)
#   ③ 로그를 **먼저** 남긴다 — 중간에 죽어도 돌았다는 건 남는다
$ErrorActionPreference = 'Continue'
$node = 'C:\Users\FAMILY\node-portable\node-v24.18.0-win-x64\node.exe'
$repo = 'C:\Users\FAMILY\Desktop\MOMCALENDAR'
$cli  = 'C:\Users\FAMILY\supabase-cli\supabase.exe'
$log  = "$repo\scratchpad\threads_log.txt"
function Say($m) { Add-Content -Path $log -Value ("[" + (Get-Date).ToString('yyyy-MM-dd HH:mm') + "] 오후 핫딜: " + $m) -Encoding UTF8 }

Say "시작"
try {
  Set-Location "$repo\sns-automation"
  $out = & $node src/threads-publish.js hotdeal_list --force 2>&1 | Out-String
  Write-Output $out
  if ($out -match '대기줄로 보냄') { Say "새 글을 만들어 대기줄에 넣었다" }
  elseif ($out -match '이미 대기줄에') { Say "이미 만들어 둔 글이 있다 — 그걸 올린다" }
  elseif ($out -match '가격이 확인된') { Say "가격 확인된 딜이 없다 — 안 올린다" }
} catch { Say ("글 만들기 실패: " + $_.Exception.Message) }

# 오늘 만든 핫딜 글을 승인 + 즉시 발행 대상으로 (사장님이 오후 발행을 위임하셨다)
try {
  $sqlRel = 'scratchpad/_afternoon_hotdeal.sql'
  $sql = @'
update threads_queue
   set status = 'approved', publish_at = now(), updated_at = now()
 where status = 'pending'
   and variant like '%hotdeal%'
   and (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
returning id;
'@
  $sql | Out-File -FilePath "$repo\$sqlRel" -Encoding ascii
  Push-Location $repo
  $r = & $cli db query --file $sqlRel --linked 2>&1 | Out-String
  Pop-Location
  Remove-Item "$repo\$sqlRel" -ErrorAction SilentlyContinue
  if ($r -match '"id"') { Say "승인 완료 — 곧 나간다" } else { Say "승인할 글이 없다" }
  Write-Output $r
} catch { Say ("승인 실패: " + $_.Exception.Message) }
exit 0
