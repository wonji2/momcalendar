#!/bin/sh
# 비상 복구 — backup/last-good 의 트리를 main 위에 새 커밋으로 얹는다(force-push 아님).
#   미리보기:    bash tools/emergency_restore.sh
#   실제 복구:   bash tools/emergency_restore.sh --yes
#   연습(안전):  DST_REF=refs/heads/restore-rehearsal bash tools/emergency_restore.sh --yes
set -u

GOOD_REF="${GOOD_REF:-refs/heads/backup/last-good}"
DST_REF="${DST_REF:-refs/heads/main}"
MIN_FILES="${MIN_FILES:-45000}"      # 이보다 적은 판은 백업으로 인정하지 않는다(기준 54,825)
MODE="${1:-}"

git fetch -q origin main || { echo "main 을 못 받았다"; exit 1; }
CUR=$(git rev-parse origin/main)

git fetch -q origin "$GOOD_REF" || { echo "$GOOD_REF 를 못 받았다 — 백업 브랜치가 없다(§5-2)"; exit 1; }
GOOD=$(git rev-parse FETCH_HEAD)
GTREE=$(git rev-parse "$GOOD^{tree}")
GN=$(git ls-tree -r --name-only "$GOOD" | wc -l | tr -d ' ')
CN=$(git ls-tree -r --name-only "$CUR" | wc -l | tr -d ' ')

echo "정상 판 (backup/last-good): $GOOD  ·  파일 $GN 개  ·  $(git log -1 --format='%h %s' "$GOOD")"
echo "지금 main              : $CUR  ·  파일 $CN 개"

if [ "$GN" -lt "$MIN_FILES" ]; then
  echo "🔴 백업 판의 파일이 $GN 개뿐입니다 — 복구하지 않습니다(백업이 잘못됐다)"
  exit 1
fi

if [ "$MODE" != "--yes" ]; then
  echo ""
  echo "(미리보기) 실제로 되돌리려면:  bash tools/emergency_restore.sh --yes"
  [ "$DST_REF" != "refs/heads/main" ] && echo "  · 연습 모드 대상: $DST_REF"
  exit 0
fi

NEW=$(GIT_AUTHOR_NAME="momcal-bot" GIT_AUTHOR_EMAIL="noreply@momcalendar.com" \
      GIT_COMMITTER_NAME="momcal-bot" GIT_COMMITTER_EMAIL="noreply@momcalendar.com" \
      git commit-tree "$GTREE" -p "$CUR" -m "🔴 복구: backup/last-good($GOOD) 트리로 되돌림 — 새 커밋으로 얹음(이력 보존)")

echo "복구 커밋: $NEW"
git push origin "$NEW:$DST_REF" || { echo "🔴 푸시 실패 — 원격 상태를 확인하세요"; exit 1; }

if [ "$DST_REF" = "refs/heads/main" ]; then
  echo "푸시 완료. 라이브 반영을 확인한다…"
  SLEEP=5 TRIES=12 bash tools/live_verify.sh || echo "⚠️ 라이브 확인 실패 — 몇 분 뒤 다시 확인하세요(배포 파이프라인이 있으면 §4-2 가 올린다)"
fi
