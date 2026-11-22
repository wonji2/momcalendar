#!/bin/sh
# 라이브가 실제로 살아 있는지 본다. 배포 직후 CDN 반영 지연을 감안해 재시도한다.
set -u
SITE="${SITE:-https://momcalendar.com}"
TRIES="${TRIES:-8}"
SLEEP="${SLEEP:-15}"
i=1
while [ "$i" -le "$TRIES" ]; do
  A=$(curl -s -o /tmp/lv_home -w '%{http_code}' --max-time 20 "$SITE/?v=$RANDOM" || echo 000)
  B=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/test.html?v=$RANDOM" || echo 000)
  C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/sitemap.xml?v=$RANDOM" || echo 000)
  K=$(grep -c '맘캘린더' /tmp/lv_home 2>/dev/null || true)
  K=${K:-0}
  echo "[$i/$TRIES] /=$A test=$B sitemap=$C 키워드=$K"
  if [ "$A" = 200 ] && [ "$B" = 200 ] && [ "$C" = 200 ] && [ "${K:-0}" -gt 0 ]; then
    echo "=== 통과: 라이브 정상 ($SITE)"
    exit 0
  fi
  i=$((i + 1))
  [ "$i" -le "$TRIES" ] && sleep "$SLEEP"
done
echo "=== 실패: 라이브가 정상이 아니다"
exit 1
