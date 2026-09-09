#!/usr/bin/env bash
# 공구줍줍 데일리 → 승인표 → 게이트 → 등록 (예약작업 momcal-jupjup, 매일 07:40·21:40)
# 분류는 harvest_to_table 이 붙이고, 게이트·등록·사후검사는 ig_feed_pipeline 과 같은 절차를 쓴다.
set -u
cd "$(dirname "$0")/../.." || exit 1
N="C:/Users/FAMILY/node-portable/node-v24.18.0-win-x64/node.exe"
SB="C:/Users/FAMILY/supabase-cli/supabase.exe"
LOG=scratchpad/jupjup_log.txt
DAY=$(date +%F); TS=$(date +%H%M)
log(){ echo "[$DAY $(date +%H:%M)] $*" | tee -a "$LOG"; }
RAW=scratchpad/_jup_${DAY}_${TS}.md
"$N" tools/daily/jupjup_parse.mjs "$RAW" > scratchpad/_jup.out 2>&1 || { log "🔴 파싱 실패: $(tail -1 scratchpad/_jup.out)"; exit 1; }
log "$(grep -E '^✅|^처리할|^조각|^핸들' scratchpad/_jup.out | head -1)"
[ -s "$RAW" ] && grep -q '^| [0-9]' "$RAW" || { log "후보 0건 — 끝"; exit 0; }
# 분류 채우기: 표 → TSV → harvest_to_table
awk 'BEGIN{FS=" *\| *"} /^\| [0-9]/{print $9"\t"$9"\t"$4"\t"$5"\t"$6"\t"}' "$RAW" > "$RAW.tsv"
"$N" scratchpad/harvest_to_table.mjs "$RAW.tsv" scratchpad/catvocab.json "$RAW.cat" "$RAW.uncat" >/dev/null 2>&1
# 분류 결과(핸들 기준)를 원표에 합친다
f="scratchpad/승인대기_jupjup_${DAY}_${TS}.md"
awk 'BEGIN{FS=" *\| *"} FILENAME==ARGV[1] && /^\| [0-9]/{key=$9"|"$4; maj[key]=$7; min[key]=$8; next}
     /^\| [0-9]/{key=$9"|"$4; if(maj[key]!=""){printf "| %s | %s | %s | %s | %s | %s | %s | %s |\n",$2,$3,$4,$5,$6,maj[key],min[key],$9; next}}
     {print}' "$RAW.cat" "$RAW" > "$f"
grep -q '^| [0-9]' "$f" || { log "분류 합치기 실패"; exit 1; }
# 분류 못 채운 행은 보류
mkdir -p scratchpad/jupjup
grep -E '^\| [0-9]+ \|[^|]*\|[^|]*\|[^|]*\|[^|]*\| *\|' "$f" >> "scratchpad/jupjup/보류_$DAY.md" 2>/dev/null
sed -i -E '/^\| [0-9]+ \|[^|]*\|[^|]*\|[^|]*\|[^|]*\| *\|/d' "$f"
grep -q '^| [0-9]' "$f" || { log "분류된 행 0 — 끝 (보류 scratchpad/jupjup/보류_$DAY.md)"; exit 0; }
"$N" scratchpad/drop_ended.mjs "$f" >/dev/null 2>&1
"$N" scratchpad/pending_dedupe.mjs "$f" >/dev/null 2>&1
gate(){ bash scratchpad/pending_check.sh "$f" 2>&1; }
OUT=$(gate)
EXC=$(echo "$OUT" | grep -o 'excluded: [0-9]*' | grep -o '[0-9]*'); OWN=$(echo "$OUT" | grep -o 'own_product: [0-9]*' | grep -o '[0-9]*')
[ "${EXC:-1}" = 0 ] && [ "${OWN:-1}" = 0 ] || { log "🔴 게이트 차단 excluded=$EXC own=$OWN"; exit 1; }
SPLIT=$(echo "$OUT" | grep -o '"승인표핸들": "[^"]*"' | sed 's/.*: "//; s/"$//' | sort -u)
if [ -n "$SPLIT" ]; then for h in $SPLIT; do grep -F "| $h |" "$f" >> "scratchpad/jupjup/보류_$DAY.md"; sed -i "/| $h |\$/d" "$f"; done; log "핸들갈림 보류: $SPLIT"; grep -q '^| [0-9]' "$f" || exit 0; OUT=$(gate); fi
if echo "$OUT" | grep -q '"already_in_db": [1-9]'; then
  sed '/^select count/,$d' scratchpad/_chk.sql > scratchpad/_chk_list_jup.sql
  echo "select insta||'/'||open_date||'/'||name as row from j where insta is not null and dup order by 1;" >> scratchpad/_chk_list_jup.sql
  "$SB" db query --linked --output-format json -f scratchpad/_chk_list_jup.sql 2>/dev/null | grep -o '"row": "[^"]*"' | sed 's/"row": "//; s/"$//' > "$RAW.dup"
  awk 'BEGIN{FS=" [|] "} FILENAME==ARGV[1]{split($0,a,"/"); d[a[1]"/"a[2]]=1; next} /^\| [0-9]/{h=$8; sub(/ \|$/,"",h); if(d[h"/"$4]) next} {print}' "$RAW.dup" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  grep -q '^| [0-9]' "$f" || { log "전부 DB 에 있음 — 끝"; exit 0; }
  OUT=$(gate)
fi
TOT=$(echo "$OUT" | grep -o '표 총 [0-9]*' | grep -o '[0-9]*'); NEW=$(echo "$OUT" | grep -o '"is_new": [0-9]*' | grep -o '[0-9]*')
[ -n "$TOT" ] && [ "$TOT" = "$NEW" ] && [ "$TOT" -gt 0 ] && echo "$OUT" | grep -q 'handle_split: 0' || { log "🔴 게이트 불일치 총=$TOT 신규=$NEW"; exit 1; }
BEFORE=$("$SB" db query --linked --output-format json "select coalesce(max(id),0) m from gonggu;" 2>/dev/null | grep -o '"m": [0-9]*' | grep -o '[0-9]*')
"$N" scratchpad/gen_insert_gonggu.mjs "$f" "$RAW.sql" >/dev/null 2>&1 && "$SB" db query --linked --output-format json -f "$RAW.sql" >/dev/null 2>&1
log "✅ 등록 $TOT 행"
mkdir -p scratchpad/등록완료/무인_공구줍줍 && cp "$f" "scratchpad/등록완료/무인_공구줍줍/${DAY}_${TS}_${TOT}건.md"
DUP=$("$SB" db query --linked --output-format json -f scratchpad/_q_dup.sql 2>/dev/null | grep -o '"b_id": [0-9]*' | grep -o '[0-9]*' | awk -v b="${BEFORE:-0}" '$1>b' | paste -sd,)
[ -n "$DUP" ] && { "$SB" db query --linked --output-format json "delete from gonggu where id in ($DUP) and id > ${BEFORE:-0};" >/dev/null 2>&1; log "⚠ 중복 삭제: $DUP"; }
"$N" tools/daily/cat_guard.mjs 2>/dev/null | tail -1 | sed 's/^/cat_guard: /' | tee -a "$LOG"
"$SB" db query --linked --output-format json "select public.seo_refresh();" >/dev/null 2>&1
exit 0
