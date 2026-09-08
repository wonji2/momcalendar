#!/usr/bin/env bash
# 인스타 스윕 캡션 → 무인 등록 파이프라인 (사장님 2026-09-08 "무인으로 완성해 · 우리 검증 활용해서 공구 아닌 건 꼭 거르고 공구만")
#
#   ig_feed_sweep.mjs(30분) 가 쌓은 jsonl → ig_feed_to_table.mjs(공구 판정·상품명·날짜) → harvest_clean → harvest_to_table(분류)
#   → drop_ended → pending_dedupe → pending_check.sh(게이트: DB중복·제외셀러·사장님상품·핸들갈림) → 중복행 제거 → 한글명 채움
#   → gen_insert_gonggu → INSERT → 사후검사(_q_dup·_q_dup_sim·cat_guard) → seo_refresh → 등록완료/ 보관
#
# 무인 안전장치 (하나라도 걸리면 그 행은 등록 안 하고 보류 파일로)
#   · 게이트 excluded/own_product 가 0 이 아니면 회차 전체 중단
#   · 핸들 갈림(handle_split) 셀러의 행은 전부 보류 (사람이 프로필을 열어 판단 — 2026-09-08 오판 3건 교훈)
#   · 한글명 못 채운 행 보류 · 분류 못 한 행은 harvest_to_table 이 미분류 파일로 뺀다
#   · INSERT 뒤 _q_dup 에 새 id 가 잡히면 그 새 행을 지운다(기존 행 우선)
#
# 실행: bash tools/daily/ig_feed_pipeline.sh      (예약작업 momcal-ig-register, 매시간 xx:25)
# 로그: scratchpad/ig_feed_pipeline_log.txt · 보류: scratchpad/ig_feed/보류_<날짜>.md · 미분류: scratchpad/ig_feed/미분류_<날짜>.tsv
set -u
cd "$(dirname "$0")/../.." || exit 1
N="C:/Users/FAMILY/node-portable/node-v24.18.0-win-x64/node.exe"
SB="C:/Users/FAMILY/supabase-cli/supabase.exe"
export PATH="/c/Users/FAMILY/node-portable/node-v24.18.0-win-x64:$PATH"
LOG=scratchpad/ig_feed_pipeline_log.txt
DAY=$(date +%F); TS=$(date +%H%M)
log(){ echo "[$DAY $(date +%H:%M)] $*" | tee -a "$LOG"; }
D=scratchpad/ig_feed
CONV=$D/_conv_${DAY}_${TS}.tsv
HOLD=$D/보류_$DAY.md
UNCAT=$D/미분류_$DAY.tsv

"$N" tools/daily/ig_feed_to_table.mjs "$CONV" > $D/_conv.out 2>&1 || { log "🔴 변환 실패: $(tail -1 $D/_conv.out)"; exit 1; }
log "$(tail -1 $D/_conv.out)"
[ -s "$CONV" ] || { log "후보 0건 — 끝"; exit 0; }

"$N" scratchpad/harvest_clean.mjs "$CONV" "$CONV.clean" >/dev/null 2>&1 || { log "🔴 세척 실패"; exit 1; }
"$N" scratchpad/harvest_to_table.mjs "$CONV.clean" scratchpad/catvocab.json "$CONV.md" "$CONV.uncat" >/dev/null 2>&1 || { log "🔴 분류 실패"; exit 1; }
[ -s "$CONV.uncat" ] && cat "$CONV.uncat" >> "$UNCAT"
[ -s "$CONV.md" ] && grep -q '^| [0-9]' "$CONV.md" || { log "분류된 행 0 — 끝 (미분류 $(wc -l < "$CONV.uncat" 2>/dev/null || echo 0))"; exit 0; }

# 게이트(pending_check.sh)는 표가 scratchpad/ 바로 아래 있어야 한다(내부에서 basename 으로 경로를 다시 만든다) → 옮긴다
f="scratchpad/승인대기_igfeed_${DAY}_${TS}.md"
mv "$CONV.md" "$f"
# 한글명: DB 최빈 influencer → 없으면 스윕이 받은 full_name
H=$(grep -oE '\| [A-Za-z0-9._]+ \|$' "$f" | tr -d '| ' | sort -u | awk '{printf "'"'"'%s'"'"',", $0}' | sed 's/,$//')
"$SB" db query --linked "select insta, mode() within group (order by influencer) as nm from gonggu where insta in ($H) and influencer<>'' and influencer<>insta group by 1;" 2>/dev/null | grep -o '"insta": "[^"]*"\|"nm": "[^"]*"' | sed 's/"[a-z]*": "//; s/"$//' | paste -d'|' - - > "$CONV.names.db"
cat "$CONV.names.db" "$CONV.names" 2>/dev/null | awk -F'|' '!seen[$1]++' > "$CONV.names.all"
awk 'BEGIN{FS="|"} FILENAME==ARGV[1]{nm[$1]=$2; next} {if($0 ~ /^\| [0-9]+ \| *\|/){n=split($0,c,"|"); h=c[n-1]; gsub(/ /,"",h); num=c[2]; gsub(/ /,"",num); if(nm[h]){sub(/^\| [0-9]+ \| *\|/, "| " num " | " nm[h] " |")}} print}' "$CONV.names.all" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
# 한글명 빈 행 → 보류 (셀러 칸이 공백뿐인 행)
log "한글명 사전: DB $(wc -l < "$CONV.names.db") · 인스타 $(wc -l < "$CONV.names" 2>/dev/null || echo 0)"
grep -E '^\| [0-9]+ \| *\|' "$f" | sed "s/^/| 한글명없음 $TS /" >> "$HOLD"
sed -i -E '/^\| [0-9]+ \| *\|/d' "$f"
grep -q '^| [0-9]' "$f" || { log "한글명 있는 행 0 — 끝 (보류 $HOLD)"; exit 0; }

"$N" scratchpad/drop_ended.mjs "$f" >/dev/null 2>&1
"$N" scratchpad/pending_dedupe.mjs "$f" >/dev/null 2>&1
gate(){ bash scratchpad/pending_check.sh "$f" 2>&1; }
OUT=$(gate)
EXC=$(echo "$OUT" | grep -o 'excluded: [0-9]*' | grep -o '[0-9]*'); OWN=$(echo "$OUT" | grep -o 'own_product: [0-9]*' | grep -o '[0-9]*')
[ "${EXC:-1}" = 0 ] && [ "${OWN:-1}" = 0 ] || { log "🔴 게이트 차단 excluded=$EXC own=$OWN — 회차 중단"; cp "$f" "$HOLD.blocked_$TS.md"; exit 1; }
# 핸들 갈림 → 그 핸들 행 보류 후 재게이트
SPLIT=$(echo "$OUT" | grep -o '"승인표핸들": "[^"]*"' | sed 's/"승인표핸들": "//; s/"$//' | sort -u)
if [ -n "$SPLIT" ]; then
  for h in $SPLIT; do grep -F "| $h |" "$f" | sed "s/^/| 핸들갈림 $TS /" >> "$HOLD"; sed -i "/| $h |\$/d" "$f"; done
  log "핸들 갈림 보류: $(echo $SPLIT | tr '\n' ' ')"
  grep -q '^| [0-9]' "$f" || { log "남은 행 0 — 끝"; exit 0; }
  OUT=$(gate)
fi
# DB 중복행 제거
if echo "$OUT" | grep -q '"already_in_db": [1-9]'; then
  sed '/^select count/,$d' scratchpad/_chk.sql > scratchpad/_chk_list_ig.sql
  echo "select insta||'/'||open_date||'/'||name as row from j where insta is not null and dup order by 1;" >> scratchpad/_chk_list_ig.sql
  "$SB" db query --linked -f scratchpad/_chk_list_ig.sql 2>/dev/null | grep -o '"row": "[^"]*"' | sed 's/"row": "//; s/"$//' > "$CONV.dup"
  awk 'BEGIN{FS=" [|] "} FILENAME==ARGV[1]{split($0,a,"/"); d[a[1]"/"a[2]]=1; next} /^\| [0-9]/{h=$8; sub(/ \|$/,"",h); if(d[h"/"$4]) next} {print}' "$CONV.dup" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  grep -q '^| [0-9]' "$f" || { log "전부 DB 에 이미 있음 — 끝"; exit 0; }
  OUT=$(gate)
fi
TOT=$(echo "$OUT" | grep -o '표 총 [0-9]*' | grep -o '[0-9]*'); NEW=$(echo "$OUT" | grep -o '"is_new": [0-9]*' | grep -o '[0-9]*')
if [ -z "$TOT" ] || [ "$TOT" != "$NEW" ] || [ "$TOT" = 0 ] || ! echo "$OUT" | grep -q 'handle_split: 0'; then log "🔴 최종 게이트 불일치 총=$TOT 신규=$NEW — 등록 안 함"; cp "$f" "$HOLD.gate_$TS.md"; exit 1; fi

BEFORE=$("$SB" db query --linked "select coalesce(max(id),0) m from gonggu;" 2>/dev/null | grep -o '"m": [0-9]*' | grep -o '[0-9]*')
"$N" scratchpad/gen_insert_gonggu.mjs "$f" "$CONV.sql" >/dev/null 2>&1 || { log "🔴 SQL 생성 실패"; exit 1; }
"$SB" db query --linked -f "$CONV.sql" >/dev/null 2>&1
AFTER=$("$SB" db query --linked "select count(*) c, coalesce(max(id),0) m from gonggu where id > ${BEFORE:-0};" 2>/dev/null | grep -o '"[cm]": [0-9]*' | paste -sd' ')
log "✅ 등록 $TOT 행 (DB 증가: $AFTER)"
mkdir -p scratchpad/등록완료/무인_ig_feed && cp "$f" "scratchpad/등록완료/무인_ig_feed/${DAY}_${TS}_${TOT}건.md"

# 사후검사: 새 id 가 낀 정확일치 중복은 새 행을 지운다 · 유사중복은 로그 · 소분류 이탈은 cat_guard 경보
DUP=$("$SB" db query --linked -f scratchpad/_q_dup.sql 2>/dev/null | grep -o '"b_id": [0-9]*' | grep -o '[0-9]*' | awk -v b="${BEFORE:-0}" '$1>b' | paste -sd,)
if [ -n "$DUP" ]; then "$SB" db query --linked "delete from gonggu where id in ($DUP) and id > ${BEFORE:-0};" >/dev/null 2>&1; log "⚠ 정확일치 중복 삭제: $DUP"; fi
SIM=$("$SB" db query --linked -f scratchpad/_q_dup_sim.sql 2>/dev/null | grep -c '"a_id"'); [ "${SIM:-0}" != 0 ] && log "⚠ 유사중복 의심 $SIM 쌍 — _q_dup_sim.sql 확인 필요"
"$N" tools/daily/cat_guard.mjs 2>/dev/null | tail -1 | sed 's/^/cat_guard: /' | tee -a "$LOG"
"$SB" db query --linked "select public.seo_refresh();" >/dev/null 2>&1
exit 0
