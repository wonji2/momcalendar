#!/bin/sh
# 배포 게이트 — "이 판을 라이브에 올려도 되는가"만 판정한다. 통과 0 / 실패 1.
#   GATE_ROOT=/tmp/faketree 처럼 다른 폴더를 가리켜 시험할 수 있다(§6 V7).
set -u
ROOT="${GATE_ROOT:-.}"
cd "$ROOT" || { echo "::error::GATE_ROOT=$ROOT 없음"; exit 1; }

FLOOR=45000
FAIL=0
bad() { echo "::error::$*"; FAIL=1; }

N=$(git ls-files 2>/dev/null | wc -l | tr -d ' ')
[ "${N:-0}" -ge "$FLOOR" ] || bad "추적 파일 $N 개 — $FLOOR 미만(부분 체크아웃 사고)"

for f in index.html test.html 404.html sitemap.xml robots.txt .nojekyll CNAME CLAUDE.md .githooks/pre-commit; do
  [ -e "$f" ] || bad "$f 가 없다"
done

SZ=$(wc -c < index.html 2>/dev/null | tr -d ' ' || echo 0)
[ "${SZ:-0}" -ge 500000 ] || bad "index.html 이 ${SZ:-0} 바이트 — 껍데기/부분 파일"

W=$(ls .github/workflows/*.yml 2>/dev/null | wc -l | tr -d ' ')
[ "${W:-0}" -ge 10 ] || bad ".github/workflows 가 $W 개 — 워크플로가 지워졌다"

MB=$(du -sm --exclude=.git . 2>/dev/null | cut -f1)
[ -n "${MB:-}" ] || MB=0
MAX_MB="${MAX_MB:-1200}"     # 2026-11-22 실측 1,049MB — 1GB 선을 넘은 채로 legacy 가 돌고 있다. 그래서 '파국'만 막는다
[ "$MB" -le "$MAX_MB" ] || bad "사이트 ${MB}MB — MAX_MB($MAX_MB) 초과(아티팩트·Pages 한도 위험)"
[ "$MB" -ge 1000 ] && echo "::warning::사이트 ${MB}MB — Pages 1GB 선을 넘었다. 배포가 크기로 실패하면 §4-3 대로 legacy 로 되돌리고 §4-5 로 간다"

echo "추적 파일 $N · index.html ${SZ}B · 워크플로 $W개 · 사이트 ${MB}MB"
if [ "$FAIL" = 0 ]; then
  echo "=== 통과: 올려도 되는 판"
  exit 0
fi
echo "=== 실패: 배포를 멈춘다 (라이브는 직전 정상 판 유지)"
exit 1
