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

# 2026-11-22 사장님 승인: 디스크 블록이 아니라 실제 바이트로 잰다(블록으로 재면 1,156MB, 실제 1,099MB — 작은 파일 5만 개가 블록마다 부풀려졌다)
MB=$(du -sm --apparent-size --exclude=.git . 2>/dev/null | cut -f1)
[ -n "${MB:-}" ] || MB=0
MAX_MB="${MAX_MB:-1200}"     # 2026-11-22 실측 1,049MB — 1GB 선을 넘은 채로 legacy 가 돌고 있다. 그래서 '파국'만 막는다
[ "$MB" -le "$MAX_MB" ] || bad "사이트 ${MB}MB — MAX_MB($MAX_MB) 초과(아티팩트·Pages 한도 위험)"
[ "$MB" -ge 1000 ] && echo "::warning::사이트 ${MB}MB — Pages 1GB 선을 넘었다. 배포가 크기로 실패하면 §4-3 대로 legacy 로 되돌리고 §4-5 로 간다"

# 2026-11-25 주문서 A: 배너 이미지 상한 — 막지 않고 경고만(라이브를 세우면 안 된다). 화면은 banners/v/<이름>-420.webp 파생본을 쓴다
for f in $(find banners -maxdepth 1 -type f \( -iname 'banner_*.jpg' -o -iname 'banner_*.jpeg' -o -iname 'banner_*.png' \) -size +150k 2>/dev/null); do
  b=$(basename "$f"); b="${b%.*}"
  if [ -f "banners/v/${b}-420.webp" ]; then echo "배너 원본 150KB 초과(파생본 있음, 화면은 파생본): $f"; else echo "::warning::150KB 넘는 배너에 파생본이 없다: $f — node tools/img/make_banner_variants.mjs (깃허브 banner-variants.yml 이 자동으로 만든다)"; fi
done

# 2026-11-26 사장님 「수집프로그램 서버설정 비공개로」: 수집·자동화·서버 설정 코드는 비공개 저장소(wonji2/momcal-code)로 옮기는 중이다.
#   공개 저장소에 새로 올라오면 막는다 — supabase/ 는 한 파일도 안 되고, tools/·scripts/ 는 tools/public_allowlist.txt(옮기는 동안 남은 목록)에 없는 파일이 있으면 실패.
#   이미 올라간 파일을 줄이는 것(목록 안의 파일 삭제)은 늘 통과한다. 옮기는 방법 = 메모리 code-private-repo / 결과 문서 public_repo_slim_2026-11-26.md
if [ -f tools/public_allowlist.txt ]; then
  LEAK=$(git ls-files supabase scripts tools 2>/dev/null | grep -v -x -F -f tools/public_allowlist.txt || true)
  if [ -n "$LEAK" ]; then
    echo "::error::수집·자동화·서버 설정 파일이 공개 저장소에 새로 올라왔다(비공개 momcal-code 로 가야 한다):"
    echo "$LEAK" | head -20 | sed 's/^/   · /'
    FAIL=1
  fi
else
  bad "tools/public_allowlist.txt 가 없다 — 공개 저장소 누출 검사를 못 한다"
fi

echo "추적 파일 $N · index.html ${SZ}B · 워크플로 $W개 · 사이트 ${MB}MB"
if [ "$FAIL" = 0 ]; then
  echo "=== 통과: 올려도 되는 판"
  exit 0
fi
echo "=== 실패: 배포를 멈춘다 (라이브는 직전 정상 판 유지)"
exit 1
