#!/bin/bash
# 네이버 SERP 일일 실측 (사장님 지시 2026-08-12: "매일 체크해서 상위노출된 것도 체크")
# 추적 검색어마다 momcalendar.com / blog.naver.com/momcal / cafe.naver.com/momcal 노출 여부와
# 첫 등장 위치(바이트 오프셋 — 작을수록 위)를 기록한다. 절대 순위는 아니지만 추세 비교엔 충분.
# 로그: scratchpad/serp_log.tsv (매일 21시 ops_backup 으로 비공개 레포에 백업됨)
cd "$(dirname "$0")/../.." || exit 1
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
LOG="scratchpad/serp_log.tsv"
[ -f "$LOG" ] || printf "date\tquery\tsite_pos\tblog_pos\tcafe_pos\n" > "$LOG"
D=$(date +%F)

QUERIES=(
  "인스타 공구일정" "공구일정" "공구 일정" "인스타 공구" "인스타 공동구매"
  "오늘 공구" "공구 캘린더" "육아 공구" "공구 일정 사이트" "맘캘린더"
  "무아스 공구" "주니 공구"
)

posof() { # $1=html파일 $2=패턴 → 첫 등장 바이트 오프셋(없으면 -)
  # 주의: 네이버 HTML 은 한 줄이라 grep -o 가 매치 전부를 뱉는다 → head -1 필수
  local p
  p=$(grep -ob "$2" "$1" 2>/dev/null | head -1 | cut -d: -f1)
  echo "${p:--}"
}

for Q in "${QUERIES[@]}"; do
  ENC=$(printf '%s' "$Q" | perl -MURI::Escape -ne 'print uri_escape($_)' 2>/dev/null)
  [ -z "$ENC" ] && ENC=$(printf '%s' "$Q" | sed 's/ /%20/g')
  curl -s -A "$UA" --max-time 20 "https://search.naver.com/search.naver?query=$ENC" -o /tmp/_serp.html
  printf "%s\t%s\t%s\t%s\t%s\n" "$D" "$Q" \
    "$(posof /tmp/_serp.html 'momcalendar\.com')" \
    "$(posof /tmp/_serp.html 'blog\.naver\.com/momcal')" \
    "$(posof /tmp/_serp.html 'cafe\.naver\.com/momcal')" >> "$LOG"
  sleep 3   # 네이버에 부담 안 주기
done
echo "serp_check done: $D"

# ── 주 1회: 브랜드×공구 자동완성 실측 (사장님 지시 2026-08-14) ──
# "무아스 공구 가격" 처럼 실제로 검색되는 브랜드·꼬리말을 자동 발견해 쌓는다.
# 브랜드 명단: scratchpad/ac_brands.txt (최근 공구 빈도 상위 — 달에 한 번쯤 갱신)
ACLOG="scratchpad/ac_log.tsv"
ACBRANDS="scratchpad/ac_brands.txt"
if [ "$(date +%u)" = "1" ] && [ -f "$ACBRANDS" ]; then
  [ -f "$ACLOG" ] || printf "date\tbrand\thit\tsuggestions\n" > "$ACLOG"
  # 오늘 이미 돌렸으면 건너뛴다 (ops_backup 이 하루 여러 번 부를 수 있음)
  if ! grep -q "^$D" "$ACLOG" 2>/dev/null; then
    while IFS= read -r B; do
      [ -z "$B" ] && continue
      ENC=$(printf '%s' "$B 공구" | perl -MURI::Escape -ne 'print uri_escape($_)' 2>/dev/null)
      [ -z "$ENC" ] && continue
      R=$(curl -s --max-time 10 -A "$UA" "https://ac.search.naver.com/nx/ac?q=$ENC&st=100&frm=nv&r_format=json&r_enc=UTF-8&q_enc=UTF-8")
      HIT=$(printf '%s' "$R" | grep -c "\"$B 공구\"")
      SUG=$(printf '%s' "$R" | grep -o '\["[^"]*"\]' | tr -d '[]"' | grep -v "^$B 공구$" | head -5 | tr '\n' ';')
      printf "%s\t%s\t%s\t%s\n" "$D" "$B" "$HIT" "$SUG" >> "$ACLOG"
      sleep 1
    done < "$ACBRANDS"
    echo "ac_check done: $(grep -c "^$D" "$ACLOG") brands"
  fi
fi
