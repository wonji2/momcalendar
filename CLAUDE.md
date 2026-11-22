# 맘캘린더 — 작업 안전 규칙

이 저장소는 **공개**이고, 여기 있는 것이 곧 라이브(momcalendar.com)다.
2026-11-22 09:51~09:53 KST 에 `5e8e886`·`d32c334` 커밋이 저장소 파일 5만여 개를 지워
라이브가 404 로 내려갔다. 원인은 **일부만 꺼낸 작업 폴더에서 커밋한 것**이다.
아래 네 가지는 예외 없이 지킨다.

## 1. `git add -A` · `git add .` · `git commit -a` 금지
- 올릴 파일을 경로로 못박는다: `git add tools/daily/xxx.mjs`
- 생성 페이지는 `git add g p s m d c gg` + `git add --pathspec-from-file=tools/seo/generated.txt`
  (`.github/workflows/seo-daily.yml` 과 같은 목록)

## 2. 커밋 전에 파일 수를 센다
    git ls-files | wc -l
- 2026-11-22 기준 **54,825**. 늘어나는 것은 정상, **줄었으면 멈추고 사장님께 보고한다.**
- 45,000 미만이면 그 폴더는 부분 체크아웃이다. 커밋하지 말고 `git sparse-checkout disable`
  또는 전체를 다시 클론한다.

## 3. `--no-verify` 금지
- `.githooks/pre-commit`·`pre-push` 가 막으면 그건 **사고 신호**다. 우회하지 말고 원인부터 본다.
- 훅이 안 걸려 있으면 켠다: `bash tools/setup_hooks.sh` (윈도우 `pwsh tools/setup_hooks.ps1`)

## 4. `main` 에 force-push · 브랜치 삭제 금지
- 되돌려야 하면 새 커밋을 얹는 `tools/emergency_restore.sh` 를 쓴다(이력 보존).

## 5. 라이브 파일
- `index.html` 은 사장님의 명시적 승인 없이 고치지 않는다. `test.html` 에서 검증 → 승인 → 반영.
- 배포는 `.github/workflows/deploy-pages.yml` 게이트를 통해서만. Pages 설정을 손으로 바꾸지 않는다.

## 6. 공개 저장소에 비밀 금지
- 계정 비밀·서버 접속 정보·키·`.env` 를 커밋하지 않는다. 필요한 값은 GitHub Secret 을 쓴다.
- `scratchpad/`·`작업규칙.md`·`references/`·`HANDOVER*`·`tools/vendor/` 는 훅이 막는다. 그게 정상이다.
