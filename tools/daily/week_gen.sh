#!/bin/bash
# 향후 7일치 카드+블로그 초안을 daily-card 워크플로로 순차 생성
# 구 PC(바탕화면)·새 PC(홈 직속) 겸용 — 존재하는 첫 경로 사용
cd "$HOME/MOMCALENDAR" 2>/dev/null || cd "$HOME/Desktop/MOMCALENDAR" || exit 1
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill | grep '^password=' | cut -d= -f2)
API="https://api.github.com/repos/wonji2/momcalendar/actions/workflows/daily-card.yml"
HDR=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")

# 날짜는 항상 오늘부터 7일 — 매주 월요일 예약작업이 그 주 세트를 자동으로 굽는다
DAYS=""
for i in 0 1 2 3 4 5 6 7; do DAYS="$DAYS $(date -d "+$i day" +%F)"; done
for DAY in $DAYS; do
  PREV=$(curl -s "${HDR[@]}" "$API/runs?per_page=1" | grep -m1 '"id"' | grep -oE '[0-9]+')
  CODE=$(curl -s -X POST "${HDR[@]}" "$API/dispatches" -d "{\"ref\":\"main\",\"inputs\":{\"day\":\"$DAY\"}}" -o /dev/null -w "%{http_code}")
  echo "[$DAY] dispatch=$CODE"
  [ "$CODE" != "204" ] && { echo "[$DAY] 발사 실패"; continue; }
  # 새 런이 나타나 완료될 때까지 대기 (최대 8분)
  for i in $(seq 1 48); do
    sleep 10
    R=$(curl -s "${HDR[@]}" "$API/runs?per_page=1")
    ID=$(echo "$R" | grep -m1 '"id"' | grep -oE '[0-9]+')
    ST=$(echo "$R" | grep -m1 '"status"' | grep -oE '(queued|in_progress|completed)')
    CN=$(echo "$R" | grep -m1 '"conclusion"' | grep -oE '(success|failure|cancelled)')
    if [ "$ID" != "$PREV" ] && [ "$ST" = "completed" ]; then echo "[$DAY] $CN"; break; fi
  done
done

# ── 마무리: week.html 갱신 + index 리다이렉트 오늘로 원복 (매번 수동으로 하던 것) ──
git pull -q --rebase 2>/dev/null
TODAY=$(date +%F)
KDAY=(일 월 화 수 목 금 토)
{
cat <<'HDR'
<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>블로그 일주일치 예약 세트 | 맘캘린더</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#F6F3FA;color:#241C2E;padding:0 0 40px}
.hd{background:linear-gradient(135deg,#4A2B7A,#7B3FB5);color:#fff;padding:20px 16px}
.hd h1{font-size:20px}.hd p{font-size:12.5px;opacity:.9;margin-top:4px}
.wrap{max-width:560px;margin:0 auto;padding:0 14px}
.guide{background:#fff;border:1px solid #E9E2F2;border-radius:14px;padding:14px 15px;margin-top:14px;font-size:13px;line-height:1.8;color:#4B4258}
.guide b{color:#5B2E8C}
a.day{display:block;background:#fff;border:1.5px solid #5B2E8C;border-radius:12px;padding:15px;margin-top:10px;color:#5B2E8C;font-weight:800;font-size:15px;text-decoration:none;text-align:center}
a.day span{display:block;font-weight:400;font-size:12px;color:#8B82A0;margin-top:3px}
</style></head><body>
HDR
FIRST=$(date +%-m/%-d); LAST=$(date -d "+7 day" +%-m/%-d)
echo "<div class=\"hd\"><div class=\"wrap\"><h1>블로그 일주일치 예약 세트</h1><p>$FIRST 오늘 + ~$LAST 예약 · 매일 1건</p></div></div>"
cat <<'GUIDE'
<div class="wrap">
  <div class="guide">
    <b>예약발행 순서</b> (한 번에 8개, 약 15분)<br>
    ① 아래 날짜를 눌러 그날 페이지를 엽니다<br>
    ② [사진 저장] → 블로그 앱 글쓰기 → 제목 붙여넣기 → 본문 전체 붙여넣기 → (여기에 카드 사진) 자리에 사진 넣기<br>
    ③ 발행 버튼 옆 <b>예약</b> 선택 → 그 날짜 <b>아침 8:00</b> → 확인<br>
    ④ 다음 날짜 반복 (오늘 글은 예약 없이 바로 발행)
  </div>
GUIDE
for i in 0 1 2 3 4 5 6 7; do
  F=$(date -d "+$i day" +%F); M=$(date -d "+$i day" +%-m); DD=$(date -d "+$i day" +%-d); W=${KDAY[$(date -d "+$i day" +%w)]}
  if [ $i -eq 0 ]; then
    echo "  <a class=\"day\" href=\"./$F.html\" style=\"background:#5B2E8C;color:#fff\">${M}월 ${DD}일 ($W) · 오늘 글 열기<span style=\"color:#D9C8F0\">예약 없이 바로 발행</span></a>"
  else
    echo "  <a class=\"day\" href=\"./$F.html\">${M}월 ${DD}일 ($W) 글 열기<span>예약: $M/$DD 오전 8:00</span></a>"
  fi
done
cat <<'FTR'
  <div class="guide" style="margin-top:14px">
    ⚠️ 뒤쪽 날짜일수록 이후 새로 등록되는 공구가 빠질 수 있어요(글 안에 "실시간 전체 일정 → 맘캘린더" 링크가 있어 보완됩니다).
  </div>
</div>
</body></html>
FTR
} > daily/week.html
printf '<!DOCTYPE html><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=./%s.html">' "$TODAY" > daily/index.html
git add daily/week.html daily/index.html
git diff --cached --quiet || { git commit -q -m "주간 블로그 세트 갱신 ($TODAY)"; git push -q; }
echo WEEK_DONE
