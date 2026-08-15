#!/bin/bash
# 파싱 제외 셀러가 승인표에 섞였는지 검사한다.
#   사고 2026-08-14: 승인표 261건에 강둥맘·건후맘·유누유노맘 33건이 섞여 사장님께 지적받음.
#   pending_check.sh 가 DB 중복만 보고 제외명단은 안 봤던 게 원인.
# 사용: bash scratchpad/excluded_check.sh            (pending_check 가 만든 _chk_rows.tsv 를 본다)
#       bash scratchpad/excluded_check.sh <TSV>      (셀러<TAB>상품<TAB>날짜<TAB>핸들 형식 파일)
# 출력: excluded: N   (N 이 0 이어야 발송 가능)
cd "$(dirname "$0")/.." || exit 1
EXFILE="scratchpad/parsing_excluded.txt"
ROWS="${1:-scratchpad/_chk_rows.tsv}"
[ -f "$EXFILE" ] || { echo "excluded: 0 (명단파일 없음)"; exit 0; }
[ -f "$ROWS" ]   || { echo "excluded: 0 (검사대상 없음)"; exit 0; }

awk -F'\t' '
  NR==FNR {
    if ($0 ~ /^#/ || $0 == "") next
    if ($1 != "") handle[tolower($1)] = 1
    if ($2 != "") kor[$2] = 1
    next
  }
  {
    h = tolower($4); s = $1
    if ((h != "" && (h in handle)) || (s != "" && (s in kor))) {
      hit++
      list = list "   ⛔ " s " | " $2 " | " $4 "\n"
    }
  }
  END {
    printf "excluded: %d\n", hit + 0
    if (hit > 0) {
      print "── 아래 행을 표에서 빼고 다시 돌릴 것 ──"
      printf "%s", list
    }
  }
' "$EXFILE" "$ROWS"
