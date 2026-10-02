#!/usr/bin/env bash
# 📖 **공구톡톡 본문 수확 → 게이트 → 등록** 한 회차 (2026-10-02 신설)
#
# 🔴 왜 만들었나 — **이 체인이 스크립트로 없어서 사람이 손으로 돌렸고, 그때마다 단계가 빠졌다.**
#   · 2026-10-02 09:46 손 회차: 셀러 칸이 **핸들인 채로 6건**(myong.mommy·93_0_816) 라이브로 나갔다.
#     DB 에 묭마미 15행·축복맘 59행이 이미 있었는데도 그랬다 — **③.5 한글명 채움(DB 최빈값)을 안 돌렸고**,
#     대신 인스타 og:title 소개문을 셀러명으로 썼다. 같은 회차 **13명 43행**이 소개문으로 등록됐다
#     (「육아정보 유아식 레시피」 ← 쨔니맘 · 「현실 육아템」 ← 뽀민맘).
#   · 2026-09-30 달력 회차에서도 **같은 단계**를 빼먹어 178건이 셀러 칸 빈 채로 나왔다.
#   → 순서를 코드에 박는다. 사람이 기억해야 하는 단계는 결국 빠진다.
#
# 흐름 (ig_feed_pipeline.sh 와 같은 절차 · 다른 점은 ③.5 를 **분류 직후**에 둔 것)
#   gongtok_body.mjs 가 만든 6열 TSV → harvest_clean → harvest_to_table(분류)
#   → fix_handles_names.mjs (③.3 핸들정정+브랜드차단 · ③.5 DB 최빈 한글명)
#   → 남은 빈칸만 수확 사이드카(.names)로 채움 → 한글명 없는 행 보류
#   → drop_ended → pending_dedupe → pending_check(게이트) → 핸들갈림 보류 → DB중복 제거 → 재게이트
#   → 상품명 위생(drop_badname) → gen_insert_gonggu(--source gongtok) → 등록 → cat_guard
#
# 실행: bash tools/daily/gongtok_round.sh [수확TSV]     (없으면 아직 안 돌린 가장 최근 TSV)
# 로그: scratchpad/gongtok_round_log.txt   상태: scratchpad/gongtok_round_done.txt
# 보류: scratchpad/gongtok/보류_<날짜>.md  미분류: scratchpad/gongtok/미분류_<날짜>.tsv
set -u
cd "$(dirname "$0")/../.." || exit 1
N="C:/Users/FAMILY/node-portable/node-v24.18.0-win-x64/node.exe"
SB="C:/Users/FAMILY/supabase-cli/supabase.exe"
export PATH="/c/Users/FAMILY/node-portable/node-v24.18.0-win-x64:$PATH"
LOG=scratchpad/gongtok_round_log.txt
DONE_F=scratchpad/gongtok_round_done.txt
DAY=$(date +%F); TS=$(date +%H%M)
log(){ echo "[$DAY $(date +%H:%M)] $*" | tee -a "$LOG"; }
D=scratchpad/gongtok
HOLD=$D/보류_$DAY.md
UNCAT=$D/미분류_$DAY.tsv
touch "$DONE_F"

# ── 입력 고르기 ───────────────────────────────────────────────────────────────
TSV="${1:-}"
if [ -z "$TSV" ]; then
  for c in $(ls -t $D/_body_*.tsv 2>/dev/null); do
    grep -qxF "$(basename "$c")" "$DONE_F" || { TSV="$c"; break; }
  done
fi
[ -n "$TSV" ] || { log "돌릴 수확 TSV 가 없다 — 끝"; exit 0; }
[ -s "$TSV" ] || { log "수확 TSV 가 비었다($TSV) — 끝"; echo "$(basename "$TSV")" >> "$DONE_F"; exit 0; }
log "▶ 회차 시작 — $TSV ($(grep -c '' "$TSV") 행)"

"$N" scratchpad/harvest_clean.mjs "$TSV" "$TSV.clean" >/dev/null 2>&1 || { log "🔴 세척 실패"; exit 1; }
"$N" scratchpad/harvest_to_table.mjs "$TSV.clean" scratchpad/catvocab.json "$TSV.md" "$TSV.uncat" >/dev/null 2>&1 || { log "🔴 분류 실패"; exit 1; }
[ -s "$TSV.uncat" ] && cat "$TSV.uncat" >> "$UNCAT"
grep -q '^| [0-9]' "$TSV.md" 2>/dev/null || { log "분류된 행 0 — 끝 (미분류 $(wc -l < "$TSV.uncat" 2>/dev/null || echo 0))"; echo "$(basename "$TSV")" >> "$DONE_F"; exit 0; }

# 게이트(pending_check.sh)는 표가 scratchpad/ 바로 아래 있어야 한다(내부에서 basename 으로 경로를 다시 만든다)
f="scratchpad/승인대기_gongtok_${DAY}_${TS}.md"
mv "$TSV.md" "$f"

# ── ③.3 핸들정정 + 브랜드차단 + ③.5 DB 최빈 한글명 ───────────────────────────
#   🔑 **분류 직후·사이드카보다 먼저** 돌린다. DB 최빈값이 소개문보다 이긴다(위 사고의 핵심).
#   brand_block 을 못 읽으면 이 도구가 스스로 멈춘다(fail-closed) → 회차도 멈춘다.
FIX=$("$N" scratchpad/fix_handles_names.mjs "$f" 2>&1) || { log "🔴 핸들정정·한글명 단계 실패 — 등록 안 함: $FIX"; cp "$f" "$HOLD.fix_$TS.md"; exit 1; }
log "$(echo "$FIX" | tr '\n' ' ')"

# ── 남은 빈칸만 수확 사이드카(.names)로 채운다 ────────────────────────────────
#   사이드카는 인스타 og:title 에서 뽑은 것이라 **소개문이 섞인다** → DB 최빈값이 없을 때만 쓴다.
#   한글이 없는 이름은 쓰지 않는다(핸들·로마자가 셀러명으로 나가는 걸 막는다 — 메모리 no-seller-no-show).
if [ -s "$TSV.names" ]; then
  awk -F'|' '$2 ~ /[가-힣]/ && !seen[$1]++' "$TSV.names" > "$TSV.names.use"
  awk 'BEGIN{FS="|"} FILENAME==ARGV[1]{nm[$1]=$2; next} {if($0 ~ /^\| [0-9]+ \| *\|/){n=split($0,c,"|"); h=c[n-1]; gsub(/ /,"",h); num=c[2]; gsub(/ /,"",num); if(nm[h]){sub(/^\| [0-9]+ \| *\|/, "| " num " | " nm[h] " |")}} print}' "$TSV.names.use" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  log "사이드카 한글명 ${TSV##*/}.names: 쓸 수 있는 셀러 $(wc -l < "$TSV.names.use")명"
fi

# 한글명 못 채운 행 → 보류 (셀러 없으면 사이트에 안 띄운다)
grep -E '^\| [0-9]+ \| *\|' "$f" | sed "s/^/| 한글명없음 $TS /" >> "$HOLD"
sed -i -E '/^\| [0-9]+ \| *\|/d' "$f"
grep -q '^| [0-9]' "$f" || { log "한글명 있는 행 0 — 끝 (보류 $HOLD)"; echo "$(basename "$TSV")" >> "$DONE_F"; exit 0; }

"$N" scratchpad/drop_ended.mjs "$f" >/dev/null 2>&1
"$N" scratchpad/pending_dedupe.mjs "$f" >/dev/null 2>&1
gate(){ bash scratchpad/pending_check.sh "$f" 2>&1; }
OUT=$(gate)
EXC=$(echo "$OUT" | grep -o 'excluded: [0-9]*' | grep -o '[0-9]*'); OWN=$(echo "$OUT" | grep -o 'own_product: [0-9]*' | grep -o '[0-9]*')
[ "${EXC:-1}" = 0 ] && [ "${OWN:-1}" = 0 ] || { log "🔴 게이트 차단 excluded=$EXC own=$OWN — 회차 중단"; cp "$f" "$HOLD.blocked_$TS.md"; exit 1; }
# 🔴 슬러그가 핸들 칸에 들어온 행은 등록하지 않는다 (gongtok_body 가 표를 못 찾으면 이렇게 나온다)
SLUG=$(echo "$OUT" | grep -o 'slug_as_handle: [0-9]*' | grep -o '[0-9]*')
[ "${SLUG:-0}" = 0 ] || { log "🔴 슬러그가 핸들 칸 ${SLUG}건 — 회차 중단(seller_inpock 에 매핑을 넣고 다시 돌린다)"; cp "$f" "$HOLD.slug_$TS.md"; exit 1; }
# 핸들 갈림 → 그 핸들 행 보류 후 재게이트
SPLIT=$(echo "$OUT" | grep -o '"승인표핸들": "[^"]*"' | sed 's/"승인표핸들": "//; s/"$//' | sort -u)
if [ -n "$SPLIT" ]; then
  for h in $SPLIT; do grep -F "| $h |" "$f" | sed "s/^/| 핸들갈림 $TS /" >> "$HOLD"; sed -i "/| $h |\$/d" "$f"; done
  log "핸들 갈림 보류: $(echo $SPLIT | tr '\n' ' ')"
  grep -q '^| [0-9]' "$f" || { log "남은 행 0 — 끝"; echo "$(basename "$TSV")" >> "$DONE_F"; exit 0; }
  OUT=$(gate)
fi
# DB 중복행 제거 → 재게이트 (ig_feed_pipeline 과 같은 방식)
if echo "$OUT" | grep -q '"already_in_db": [1-9]'; then
  bash scratchpad/gate_filter.sh "$f" "$f.new" >/dev/null 2>&1 && [ -s "$f.new" ] && mv "$f.new" "$f"
  grep -q '^| [0-9]' "$f" || { log "전부 DB 에 이미 있음 — 끝"; echo "$(basename "$TSV")" >> "$DONE_F"; exit 0; }
  OUT=$(gate)
fi
TOT=$(echo "$OUT" | grep -o '표 총 [0-9]*' | grep -o '[0-9]*'); NEW=$(echo "$OUT" | grep -o '"is_new": [0-9]*' | grep -o '[0-9]*')
if [ -z "$TOT" ] || [ "$TOT" != "$NEW" ] || [ "$TOT" = 0 ] || ! echo "$OUT" | grep -q 'handle_split: 0'; then
  log "🔴 최종 게이트 불일치 총=${TOT:-?} 신규=${NEW:-?} — 등록 안 함"; cp "$f" "$HOLD.gate_$TS.md"; exit 1
fi

mkdir -p scratchpad/승인대기_보관
cp "$f" "scratchpad/승인대기_보관/${DAY}_${TS}_gongtok_${TOT}건.md"

# 상품명 위생 — 게이트는 상품명이 상품명인지 안 본다 (메모리 my-check-sees-only-what-it-checks)
BADOUT=$("$N" tools/daily/drop_badname.mjs "$f" "$HOLD" 2>&1 || true)
BADN=$(echo "$BADOUT" | grep -o 'badname: -\?[0-9]*' | grep -o '\-\?[0-9]*$')
if [ -z "${BADN:-}" ] || [ "$BADN" = "-1" ]; then
  log "🟡 상품명 검사가 못 돌았다 — 등록하지 않고 보류: $f"; exit 0
fi
if [ "$BADN" -gt 0 ]; then
  log "🧹 상품명이 아닌 행 ${BADN}건 보류로 뺌"
  grep -q '^| [0-9]' "$f" || { log "남은 행 0 — 끝"; echo "$(basename "$TSV")" >> "$DONE_F"; exit 0; }
  TOT=$(grep -c '^| [0-9]' "$f")
fi

cnt_all(){ "$SB" db query --linked --output-format json "select count(*) as n from public.gonggu" 2>/dev/null \
  | grep -o '"n": *"\?[0-9]*' | grep -o '[0-9]*$' | head -1; }
BEFORE=$(cnt_all)
"$N" scratchpad/gen_insert_gonggu.mjs "$f" "$f.sql" --source gongtok >/dev/null 2>&1 \
  || { log "🔴 INSERT 생성 실패 — 보류: $f"; exit 1; }
"$N" scratchpad/_split_insert.mjs "$f.sql" scratchpad/_gt_ins_ 120 >/dev/null 2>&1 || true
PARTS=$(ls scratchpad/_gt_ins_*.sql 2>/dev/null | sort)
[ -n "$PARTS" ] || PARTS="$f.sql"
for p in $PARTS; do "$SB" db query --linked --file "$p" --output-format json >/dev/null 2>&1; done
rm -f scratchpad/_gt_ins_*.sql
AFTER=$(cnt_all)
if [ -n "${BEFORE:-}" ] && [ -n "${AFTER:-}" ]; then DONE=$((AFTER-BEFORE)); else DONE=-1; fi
log "✅ 등록 ${DONE}건 (게이트 통과 $TOT · DB ${BEFORE:-?} → ${AFTER:-?})"
echo "$(basename "$TSV")" >> "$DONE_F"

"$N" tools/daily/cat_guard.mjs >/dev/null 2>&1 || true
exit 0
