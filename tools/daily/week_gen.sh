#!/bin/bash
# 향후 7일치 카드+블로그 초안을 daily-card 워크플로로 순차 생성
cd "C:/Users/FAMILY/Desktop/맘캘린더/사이트/MOMCALENDAR" || exit 1
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill | grep '^password=' | cut -d= -f2)
API="https://api.github.com/repos/wonji2/momcalendar/actions/workflows/daily-card.yml"
HDR=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")

for DAY in 2026-08-12 2026-08-13 2026-08-14 2026-08-15 2026-08-16 2026-08-17 2026-08-18 2026-08-19; do
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
echo WEEK_DONE
