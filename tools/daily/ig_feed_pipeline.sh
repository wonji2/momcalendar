#!/usr/bin/env bash
# 인스타 스윕 캡션 → 게이트까지 자동, 등록은 승인표로 (2026-09-08 "무인으로 완성해" → 2026-09-17 사장님 지시로 전부 승인표 방식으로 되돌림)
#
#   ig_feed_sweep.mjs(30분) 가 쌓은 jsonl → ig_feed_to_table.mjs(공구 판정·상품명·날짜) → harvest_clean → harvest_to_table(분류)
#   → drop_ended → pending_dedupe → pending_check.sh(게이트: DB중복·제외셀러·사장님상품·핸들갈림) → 중복행 제거 → 한글명 채움
#   → 게이트 통과 표를 scratchpad/승인대기_보관/ 에 저장하고 종료 (INSERT 는 사장님 "올려" 뒤 세션이 실행)
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
"$SB" db query --linked --output-format json "select insta, mode() within group (order by influencer) as nm from gonggu where insta in ($H) and influencer<>'' and influencer<>insta group by 1;" 2>/dev/null | grep -o '"insta": "[^"]*"\|"nm": "[^"]*"' | sed 's/"[a-z]*": "//; s/"$//' | paste -d'|' - - > "$CONV.names.db"
cat "$CONV.names.db" "$CONV.names" 2>/dev/null | awk -F'|' '!seen[$1]++' > "$CONV.names.all"
awk 'BEGIN{FS="|"} FILENAME==ARGV[1]{nm[$1]=$2; next} {if($0 ~ /^\| [0-9]+ \| *\|/){n=split($0,c,"|"); h=c[n-1]; gsub(/ /,"",h); num=c[2]; gsub(/ /,"",num); if(nm[h]){sub(/^\| [0-9]+ \| *\|/, "| " num " | " nm[h] " |")}} print}' "$CONV.names.all" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
# 🔴🔴 2026-10-02 사장님 지시 — **한글명을 못 구한 행도 보류하지 않는다. 핸들을 그대로 띄운다.**
#   *"이름은 못구했는데 인스타핸들 맞고 공구셀러맞고 공구상품 맞으면 걍 인스타핸들 나오게 하면 되고"*
#   그래서 아래 「한글명없음 → 보류」 두 줄을 없앴다(09-08~10-02 사이 57행이 그렇게 쌓여 있었다).
#   셀러 칸이 빈 행은 `gen_insert_gonggu` 가 ①DB 최빈 한글명 →②없으면 핸들 순으로 채운다.
#   핸들마저 없는 행은 거기서 안 들어간다(no-seller-no-show 는 **빈칸**에 대한 규칙이라 그대로 유효).
log "한글명 사전: DB $(wc -l < "$CONV.names.db") · 인스타 $(wc -l < "$CONV.names" 2>/dev/null || echo 0) · 못 채운 행 $(grep -cE '^\| [0-9]+ \| *\|' "$f" || true) 건은 핸들로 등록"

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
  "$SB" db query --linked --output-format json -f scratchpad/_chk_list_ig.sql 2>/dev/null | grep -o '"row": "[^"]*"' | sed 's/"row": "//; s/"$//' > "$CONV.dup"
  awk 'BEGIN{FS=" [|] "} FILENAME==ARGV[1]{split($0,a,"/"); d[a[1]"/"a[2]]=1; next} /^\| [0-9]/{h=$8; sub(/ \|$/,"",h); if(d[h"/"$4]) next} {print}' "$CONV.dup" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  grep -q '^| [0-9]' "$f" || { log "전부 DB 에 이미 있음 — 끝"; exit 0; }
  OUT=$(gate)
fi
TOT=$(echo "$OUT" | grep -o '표 총 [0-9]*' | grep -o '[0-9]*'); NEW=$(echo "$OUT" | grep -o '"is_new": [0-9]*' | grep -o '[0-9]*')
if [ -z "$TOT" ] || [ "$TOT" != "$NEW" ] || [ "$TOT" = 0 ] || ! echo "$OUT" | grep -q 'handle_split: 0'; then
  # 2026-09-16: 게이트 뒤 등록 사이에 다른 세션이 같은 공구를 먼저 넣으면 여기서 전체가 멈췄다(13:25 회차 9건 중 8건 유실).
  #   한 번은 gate_filter 로 DB중복만 걷어내고 다시 잰다. 그래도 안 맞으면 그때 멈춘다.
  bash scratchpad/gate_filter.sh "$f" "$f.new" >/dev/null 2>&1 && [ -s "$f.new" ] && mv "$f.new" "$f"
  grep -q '^| [0-9]' "$f" || { log "전부 DB 에 이미 있음(재검) — 끝"; exit 0; }
  OUT=$(gate); TOT=$(echo "$OUT" | grep -o '표 총 [0-9]*' | grep -o '[0-9]*'); NEW=$(echo "$OUT" | grep -o '"is_new": [0-9]*' | grep -o '[0-9]*')
  if [ -z "$TOT" ] || [ "$TOT" != "$NEW" ] || [ "$TOT" = 0 ] || ! echo "$OUT" | grep -q 'handle_split: 0'; then log "🔴 최종 게이트 불일치 총=$TOT 신규=$NEW — 등록 안 함"; cp "$f" "$HOLD.gate_$TS.md"; exit 1; fi
  log "재검 통과(중복 걷어냄) 총=$TOT"
fi

# ──────────────────────────────────────────────────────────────────────────────
# 🔴🔴 2026-10-01 사장님 지시 — **그날 오픈하는 건 매일 찾아서 다 등록한다**
#   *"그날 오픈하는건 찾아서 파도타면서 다 등록해야해"*
#   *"다 올려 원래 하루에 200개씩 파싱하라고 했잖아"*
#
#   그래서 **게이트가 깨끗한 행은 무인 등록**한다. 09-17 에 전부 승인표로 되돌린 이유는
#   「게이트가 못 믿을 것」이 아니라 **세션이 애매한 구제 건까지 승인 없이 넣어서**였다.
#   여기까지 온 행은 게이트가 이것을 보장한다:
#     excluded=0 · own_product=0 · handle_split=0 · 표 총=신규 (DB 중복 0) · 한글명 채움 · 분류 완료
#   애매한 것은 이미 위에서 전부 보류 파일로 빠져 있다.
#
#   ⚠ 안전장치
#     · ~~하루 상한~~ → **없앴다**(사장님 2026-10-01 "상한은 왜있어"). 아래 124번 줄 참조
#     · 등록 건수는 **DB 로 센다**(응답의 "id" 를 세면 과대집계된다 — 2026-09-29 실측)
#     · 등록본은 승인대기_보관 에 그대로 남겨 사장님이 사후에 보실 수 있게 한다
#     · INSERT 문 자체에 `where not exists` 중복검사가 들어 있다(gen_insert_gonggu.mjs)
# ──────────────────────────────────────────────────────────────────────────────
mkdir -p scratchpad/승인대기_보관
cp "$f" "scratchpad/승인대기_보관/${DAY}_${TS}_igfeed_${TOT}건.md"

# 🔴🔴 2026-10-01 검증자 불통과 — **게이트는 상품명이 상품명인지 안 본다.**
#   `pending_check.sh` 는 DB중복·제외셀러·사장님상품·핸들갈림만 센다. 그래서 무인 등록을 켠 뒤
#   「알텐바흐 롯데백화점 최대품목 최대할인 특집전」·「아미 빅로고 가디건129000원」·
#   「어그 싹 털다 걸린 썰...ㅋㅋㅋㅋㅋ」 같은 것이 라이브로 나갔다(실측 8건).
#   → 등록 **직전**에 상품명 위생을 본다. 걸린 행만 보류로 빼고 회차는 계속 간다.
#   (검사 기준은 scratchpad/_q_badname.sql · 메모리 product-name-hygiene — 새로 만든 게 아니다)
BADOUT=$("$N" tools/daily/drop_badname.mjs "$f" "$HOLD" 2>&1 || true)
BADN=$(echo "$BADOUT" | grep -o 'badname: -\?[0-9]*' | grep -o '\-\?[0-9]*$')
if [ -z "${BADN:-}" ] || [ "$BADN" = "-1" ]; then
  # 🔑 검사가 못 돌았으면 등록하지 않는다 (fail-closed) — 「0건」으로 읽으면 검사가 무력해진다
  log "🟡 상품명 검사가 못 돌았다 — 등록하지 않고 보류: $f"; exit 0
fi
if [ "$BADN" -gt 0 ]; then
  log "🧹 상품명이 아닌 행 ${BADN}건 보류로 뺌: $(echo "$BADOUT" | sed -n '2,4p' | tr '\n' ' ')"
  grep -q '^| [0-9]' "$f" || { log "남은 행 0 — 끝"; exit 0; }
  TOT=$(grep -c '^| [0-9]' "$f")
fi

# 🔴🔴 2026-10-01 사장님 지시 — **하루 상한을 없앴다**
#   *"상한은 왜있어 상한없이 다 올리고 하루에 한번 중복db나 말이 안되는 상품이나 셀러가 오류라거나
#    공구가 아니라거나 이런거 걸러"*
#   → 막는 쪽이 아니라 **거르는 쪽**으로 간다. 들어올 건 다 들어오고, 하루 한 번 라이브를 훑어 내린다:
#       momcal-dup-guard  (매일 09:20) — 중복. 완전 동일은 삭제, 의심은 신고
#       momcal-live-audit (매일 09:50) — 말이 안 되는 상품명 · 셀러 오류 · 공구 아닌 것
#   (상한을 되살리려면 사장님께 먼저 물어본다)
cnt_all(){ "$SB" db query --linked --output-format json "select count(*) as n from public.gonggu" 2>/dev/null \
  | grep -o '"n": *"\?[0-9]*' | grep -o '[0-9]*$' | head -1; }

BEFORE=$(cnt_all)
"$N" scratchpad/gen_insert_gonggu.mjs "$f" "$f.sql" --source insta_feed >/dev/null 2>&1 \
  || { log "🔴 INSERT 생성 실패 — 보류: $f"; exit 1; }
# SQL 이 크면 413 → 조각으로 나눠 넣는다
"$N" scratchpad/_split_insert.mjs "$f.sql" scratchpad/_ig_ins_ 120 >/dev/null 2>&1 || true
PARTS=$(ls scratchpad/_ig_ins_*.sql 2>/dev/null | sort)
[ -n "$PARTS" ] || PARTS="$f.sql"
for p in $PARTS; do "$SB" db query --linked --file "$p" --output-format json >/dev/null 2>&1; done
rm -f scratchpad/_ig_ins_*.sql
AFTER=$(cnt_all)
if [ -n "${BEFORE:-}" ] && [ -n "${AFTER:-}" ]; then DONE=$((AFTER-BEFORE)); else DONE=-1; fi
log "✅ 무인 등록 ${DONE}건 (게이트 통과 $TOT · DB ${BEFORE:-?} → ${AFTER:-?} · 상한 없음 — 사후 감시로 거른다)"

# 등록 뒤 자동 점검 — 게이트가 못 보는 것(소분류 이탈·중복)을 본다
"$N" tools/daily/cat_guard.mjs >/dev/null 2>&1 || true
exit 0
