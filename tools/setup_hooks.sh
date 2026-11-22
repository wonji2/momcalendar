#!/bin/sh
# 훅 켜기 — 새로 클론했거나 훅이 꺼진 PC 에서 한 번 실행한다.
set -e
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push 2>/dev/null || true
echo "✅ core.hooksPath = $(git config core.hooksPath)"
echo "   훅: $(ls .githooks | tr '\n' ' ')"
echo "   추적 파일: $(git ls-files | wc -l)  (2026-11-22 기준 54,825)"
echo "   시험: git commit --allow-empty -m test  →  '추적 파일: …' 줄이 보이면 켜진 것"
