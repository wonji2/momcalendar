#!/usr/bin/env bash
# supabase CLI 대역(깃허브 Actions 전용) — 무료 Nano DB 가 접속을 잠깐 거부하면(「failed to connect as temp role」) 8·16·24·32초 쉬고 다시(합계 80초 미만 — 도구 timeout 120초 안) (2026-11-01 실측: 손 실행 5건 중 2건)
# 워크플로가 SUPABASE_CLI=tools/daily/sb_cli_retry.sh 로 넘기면 도구들(sb_query.mjs 등)이 이 파일을 CLI 로 안다. 표준출력은 그대로(JSON 파싱), 표준오류는 마지막에 함께.
err=$(mktemp)
for i in 1 2 3 4; do
  out=$(supabase "$@" 2>"$err"); rc=$?
  if [ $rc -eq 0 ] || ! { grep -qE "Failed to connect|temp role|connection refused|too many" "$err" 2>/dev/null || printf '%s' "$out" | grep -qE "Failed to connect|temp role|connection refused|too many"; }; then
    cat "$err" >&2; rm -f "$err"; printf '%s' "$out"; exit $rc
  fi
  echo "[sb_cli_retry] DB 접속 거부 — $((i*8))초 뒤 다시($i/4)" >&2   # 합계 48초(도구 timeout 120초 안)
  [ $i -lt 4 ] && sleep $((i*8))
done
cat "$err" >&2; rm -f "$err"; printf '%s' "$out"; exit $rc
