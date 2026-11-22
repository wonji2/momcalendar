# ORDER — 3중 배포 안전장치 (로컬 훅 · 배포 게이트 · 정상 판 백업)

작성 2026-11-22 (일) 10:40 KST · 자비스 · 기준 커밋 `b9d5d8e`(main, 2026-11-22 10:09 KST)
대상 저장소 `wonji2/momcalendar` · 작업자 = 클로드 코드
관련 사고 커밋 `5e8e886`(09:51) · `d32c334`(09:53) → 복구 `bb3bd05`(10:01)
관련 문서 `orders/ORDER_GA4_SEO_HOTDEAL_ALERT_2026-11-22.md`(같은 날 오더), `.githooks/pre-commit`(기존 규칙)

이 오더는 **11-22 아침 사고(저장소 5만 파일 삭제 → 라이브 404)의 재발 방지·보험 대책**을 실행 문서 하나로 묶은 것이다.
냠이와 반대편에서 교차 검증해 확정한 3중 구조이며, **고칠 파일은 §3~§5 에 적힌 것뿐**이다. 라이브 파일·기존 워크플로 동작은 건드리지 않는다.

---

## 실행 명령 (길아 님이 클로드 코드에 붙여넣는 1줄)

```
claude "orders/ORDER_DEPLOY_SAFETY_GUARD_2026-11-22.md 끝까지 읽고 §1 표부터 현재 저장소와 대조한 뒤 §3·§4·§5 그대로 구현하고 §6 검증 V1~V14 실제로 돌려 표로 보고해. index.html·test.html 같은 라이브 파일은 절대 건드리지 말고, git add -A 는 쓰지 말고, 커밋은 ①~④ 작업 단위로 나눠 올려. 사이트가 1.05GB라 §4-3 Pages 전환은 dry_run 검증이 통과한 뒤에만 하고, 첫 실배포가 크기 때문에 실패하면 바로 legacy 로 되돌리고 §4-5 repo-guard 로 넘어가"
```

레포 루트(`wonji2/momcalendar` 체크아웃, `C:/Users/FAMILY/...`)에서 실행한다.
PowerShell 스크립트(`.ps1`)는 **UTF-8 BOM** 으로 저장한다(한글 리터럴 때문에 BOM 없이 저장하면 깨진다 — 저장소 기존 규칙).
`bash` 스크립트의 줄바꿈은 **LF** 로 저장한다(`.gitattributes` 가 없으므로 윈도우에서 CRLF 로 저장되면 깃허브 러너에서 `bash: $'\r': command not found` 가 난다).

---

## 0. 한 줄 요약

| 층 | 무엇을 막나 | 파일 | 사고 때 이게 있었으면 |
| --- | --- | --- | --- |
| 1중 · 로컬 | 사람·클코가 **부분 체크아웃 폴더에서 커밋**해 5만 파일을 지우는 것 | `.githooks/pre-commit` · `.githooks/pre-push` · `CLAUDE.md` · `tools/setup_hooks.*` | `d32c334` 커밋이 **차단**됐다(파일 54,825 → 1) |
| 2중 · 배포 | main 이 망가져도 **라이브가 404 로 내려가는 것** | `.github/workflows/deploy-pages.yml` · `.github/workflows/repo-guard.yml` · `tools/deploy_gate_check.sh` · `main` force-push 차단 · Cloudflare 워커 | 망가진 판이 게이트에서 **거부**되고(못 켜면 1~2분 내 자동 되돌림) 라이브는 직전 정상 판을 계속 서비스 |
| 3중 · 보험 | 이미 라이브까지 망가진 **뒤 10초 안에 되돌리는 것** | `backup/last-good` 브랜치 · `tools/emergency_restore.sh` | `git push origin <복구커밋>:main` 한 줄로 끝났다 |

---

## 1. 착수 전에 이 표부터 실제 저장소와 대조하라 (2026-11-22 10:20~10:35 KST 실측)

### 1-1. 무슨 일이 있었나

| 시각(KST) | 커밋 | 일어난 일 |
| --- | --- | --- |
| 09:51 | `5e8e886` | `.github`·`tools`·`g`·`gg`·`p`·`s`·루트 html 등 **300파일 / 4,969,647줄 삭제** |
| 09:53 | `d32c334` | `index.html`(12,733줄)까지 삭제 — main 에 **`test.html` 한 개만** 남음 |
| 09:56 | — | `https://momcalendar.com/` **404** (라이브 전면 다운) |
| 10:01 | `bb3bd05` | 앞선 정상 판 `1aa4de8` 의 트리(54,825파일)를 되살리고 `test.html` 만 `d32c334` 본 유지 → 라이브 복구 |

원인: **일부만 꺼낸 임시 작업 폴더에서 커밋**했다. 그 폴더의 인덱스에 있던 파일만 커밋 트리에 남고, 나머지는 "삭제"로 기록됐다.
→ 즉 이 사고는 `git add -A` 로도, `git commit -am` 으로도 재현된다. **"무엇을 add 했나"가 아니라 "인덱스에 무엇이 없나"** 가 사고의 본질이다(§3 훅이 그래서 파일 수를 센다).

### 1-2. 저장소 현재 상태 (전부 실측 — 다르면 실측값을 보고에 적고 그 값 기준으로 진행)

| 항목 | 실측 | 판정 |
| --- | --- | --- |
| `main` 추적 파일 수 | **54,825** (`git ls-tree -r origin/main --name-only \| wc -l`) | 이 수가 기준선. **줄면 사고**. (이 오더서가 올라가면 54,826 — 문서 1개 늘어난 것이 정상) |
| 사이트 크기(추적 파일 합) | **1,098,921,545 바이트 = 1,049MB(1.02GiB)** — 트리 API 실측 | ⚠️ GitHub Pages 「1GB」 선을 **넘는다**. 이 legacy 빌드는 되지만 Actions 배포(§4-3)는 실패할 수 있다 → §4-3 관문·§4-5 폴백 |
| `main` HEAD | `b9d5d8e` (10:09 KST) | 작업 시작 시 `git fetch origin main` 으로 최신 확인 |
| `.githooks/` | **있다 — `pre-commit` 한 개뿐** | `pre-push` 는 없다(§3-2 에서 신설) |
| 기존 `pre-commit` 의 차단 목록 | `scratchpad/*.md`·`작업규칙.md`·`references/`·`HANDOVER`·`ORDER_*.md`·`tools/vendor/`·`사업문서/`·`supabase/supabase/`·`복원된_채팅기록/`·`HANDOFF.md`·**`CLAUDE.md`** | ⚠️ **`CLAUDE.md` 와 `orders/ORDER_*.md` 가 지금 막힌다** → §3-3 에서 그 둘만 푼다 |
| `CLAUDE.md` | **없다** | §3-5 에서 신설 |
| `core.hooksPath` | 설정된 적 없음(새 클론은 훅이 **꺼진 채** 시작) | 그래서 09:51 커밋도 훅을 안 탔다 → §3-4 |
| `.github/workflows/` | **17개**, `deploy-pages.yml` 없음 | §4-2 에서 신설 |
| 워크플로의 `git add` | 17개 전부 **경로 지정**(`git add -A`·`git add .` **0건**) | 이미 안전. 단 7개는 `sparse-checkout` 을 쓴다(§4-7) |
| GitHub Pages 설정 | `build_type: legacy` · `source: main /` · `cname: momcalendar.com` · `https_enforced: true` · `custom_404: true` | 지금은 **main 에 푸시되면 자동 빌드** = 망가진 main 이 그대로 라이브가 된다 → §4-3 에서 게이트 배포로 바꾼다 |
| Pages 빌드 이력 | `b9d5d8e` built · `c3c7515` **errored** | legacy 빌드는 실패도 한다(그때는 직전 판이 남는다) |
| 브랜치 보호 | **없음** (`/rulesets` = `[]`, `/protection` 은 권한 403) | force-push·브랜치 삭제가 지금은 열려 있다 → §4-4 |
| `backup/last-good` | 없다 | §5 에서 만든다 |
| `tools/` | `daily/`·`seo/`·`gmail_intake/`·`dev_server.mjs` | §3~§5 의 새 스크립트는 여기 들어간다 |
| 라이브 상태(10:30) | `/` 200 (1,042,385B) · `/test.html` 200 (1,048,877B) · `/sitemap.xml` 200 (630B) · `/robots.txt` 200 (1,122B) · 홈에 `맘캘린더` **97회** | 정상. 이 4주소가 §6 의 기준선 |
| 공개 저장소 여부 | **공개** (private=false) | 그래서 "비밀 금지" 규칙과 "지우는 변경" 규칙이 함께 적용된다 |
| 액션 사용료 | 공개 저장소 → **분(minute) 무제한** | 54k 파일 체크아웃·아티팩트 업로드를 매일 돌려도 비용 0 |

---

## 2. 절대 하지 말 것 (먼저 읽어라)

1. **이번 오더에서 `index.html`·`test.html`·`admin.html`·`staff.html`·`test-app.html`·`register.html`·`kktest.html`·`reelcard.html` 을 고치지 않는다.** 이 오더는 "지키는 장치"만 만든다.
2. **`git add -A` · `git add .` · `git commit -a` 금지.** 올릴 파일을 경로로 못박는다. 이 문서의 모든 커밋도 그렇게 한다.
3. **커밋 전·후에 `git ls-files | wc -l` 을 찍어 보고에 남긴다.** 54,825 에서 **줄었으면 그 커밋은 잘못된 것**이다.
4. **`--no-verify` 금지.** 훅이 막으면 우회하지 말고 §6 의 시험 절차로 원인을 확인한다(막히는 게 정상 동작이다).
5. **`main` force-push·브랜치 삭제 금지.** 되돌릴 일이 있으면 §5-3 스크립트(새 커밋을 얹는 방식)를 쓴다.
6. **기존 차단 규칙을 약하게 만들지 말 것.** §3-3 에서 푸는 것은 `CLAUDE.md`(비밀 없음 확인 후)와 `orders/ORDER_*.md` **두 가지뿐**이고, 나머지 목록은 글자 그대로 유지한다.
7. **Pages 설정을 손으로 두 번 바꾸지 말 것.** §4-3 순서(검증 → 전환 → 실배포 → 확인)를 지키고, 실패하면 **한 번만** 되돌린다.
8. **비밀을 커밋하지 말 것.** 이 저장소는 공개다. Cloudflare·텔레그램 열쇠는 `wrangler secret`/GitHub Secret 으로만 넣고, 문서·코드에 값이 남지 않게 한다.
9. **`.ps1` 은 UTF-8 BOM, `.sh` 는 LF.** 이 둘을 틀리면 러너에서 조용히 깨진다.

---

## 3. 1중 방어 — 로컬 Git 훅 + `CLAUDE.md`

> 목표: **사람이(또는 클코가) 커밋하는 순간** 5만 파일 삭제를 막는다. 자동 커밋(깃허브 액션)은 훅을 타지 않으므로 그쪽은 §4 가 맡는다.

### 3-1. `.githooks/pre-commit` — 기존 파일을 아래 내용으로 **교체**

기존 파일의 "공개 저장소 누출 차단" 규칙은 **그대로 살리고**, 그 뒤에 ① 보호 경로 삭제 차단 ② 파일 수 급감 차단을 붙인다.

```sh
#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# .githooks/pre-commit — 2026-11-22 저장소 대량 삭제 사고(5e8e886·d32c334) 뒤 1중 방어선
#   적용:     git config core.hooksPath .githooks     (tools/setup_hooks.sh · .ps1)
#   끄기:     git config --unset core.hooksPath
#   되돌리기 어려운 것만 막는다. 정상 삭제(툼스톤·브랜드 페이지 정리)는 그대로 통과시킨다.
#   ※ 깃허브 액션의 자동 커밋은 이 훅을 타지 않는다 → 라이브 보호는 deploy-pages.yml(2중)이 맡는다.
# ─────────────────────────────────────────────────────────────────────────────
set -u

FLOOR=45000     # 2026-11-22 기준 추적 파일 54,825. 이 아래면 '부분 체크아웃 폴더'로 본다
DROP_MIN=1000   # 직전 커밋보다 1,000개 넘게 줄면 차단(툼스톤 수십 장은 통과)

stop() {
  echo ""
  echo "🔴 $1"
  echo ""
  shift
  for line in "$@"; do echo "   $line  "; done
  echo ""
  echo "   되돌리기 어려운 변경이라 커밋을 멈췄습니다. 우회(--no-verify)하지 말고 원인을 확인하세요."
  echo ""
  exit 1
}

# ── 1) 공개 저장소에 올리면 안 되는 파일 (2026-09-18 · 2026-11-13 규칙 그대로)
#    2026-11-22 예외 두 가지:
#      · CLAUDE.md      — 저장소 안전 규칙 문서(비밀 없음). 아래에서 내용을 따로 검사한다.
#      · orders/ORDER_*.md — 사장님이 클코에 주는 지시서(이미 공개 저장소의 작업 흐름이다)
BLOCKED='^(scratchpad/[^/]+\.md$|작업규칙\.md$|references/|(.*/)?[^/]*(HANDOVER|ORDER_)[^/]*\.md$|tools/vendor/|사업문서/|supabase/supabase/|복원된_채팅기록/|HANDOFF\.md)'
HIT=$(git diff --cached --name-only --diff-filter=ACMR -z | tr '\0' '\n' \
      | grep -E "$BLOCKED" | grep -vE '^orders/ORDER_[A-Za-z0-9_-]+\.md$')
if [ -n "$HIT" ]; then
  echo ""
  echo "🔴 공개 저장소에 올리면 안 되는 파일이 올라가려 합니다 — 커밋을 멈췄습니다."
  echo "$HIT" | sed 's/^/   · /'
  echo ""
  echo "   이 파일들은 비공개 백업(work-backup)에만 둡니다."
  echo ""
  exit 1
fi

# ── 1-b) CLAUDE.md 는 허용하되, 비밀값이 들어가면 막는다
if git diff --cached --name-only | grep -qx 'CLAUDE.md'; then
  if git show :CLAUDE.md 2>/dev/null | grep -qEi '(password|passwd|비밀번호|secret|api[_-]?key|private key)[[:space:]]*[:=][[:space:]]*[^[:space:]]'; then
    stop "CLAUDE.md 에 비밀값처럼 보이는 줄이 있습니다" \
         "공개 저장소입니다. 계정·서버·키 값은 GitHub Secret 으로 옮기세요."
  fi
fi

# ── 2) 핵심 보호 경로 삭제 차단 (삭제는 어떤 이유로도 사람이 확인해야 한다)
PROTECTED='^(index\.html|test\.html|404\.html|sitemap\.xml|robots\.txt|CLAUDE\.md)$|^\.github/workflows/|^\.githooks/|^tools/'
DEL=$(git diff --cached --name-status --no-renames --diff-filter=D | cut -f2 | grep -E "$PROTECTED")
if [ -n "$DEL" ]; then
  stop "핵심 파일이 커밋에서 삭제됩니다" "$(echo "$DEL" | sed 's/^/· /')" \
       "이 파일들은 라이브·배포·안전장치의 뼈대입니다. 정말 지워야 하면 사장님 확인을 받고 --no-verify 대신 훅의 PROTECTED 목록을 고치세요."
fi

# ── 3) 전체 추적 파일 수 급감 차단 (이 사고의 본질)
HEAD_N=$(git ls-tree -r --name-only HEAD 2>/dev/null | wc -l | tr -d ' ')
IDX_N=$(git ls-files | wc -l | tr -d ' ')
echo "   추적 파일: HEAD ${HEAD_N:-0} → 이번 커밋 ${IDX_N}"
if [ "${HEAD_N:-0}" -gt 0 ]; then
  if [ "$IDX_N" -lt "$FLOOR" ]; then
    stop "이 작업 폴더에 파일이 $IDX_N 개뿐입니다 (기준 54,825 · 하한 $FLOOR)" \
         "일부만 꺼낸 폴더(sparse checkout)입니다. 그대로 커밋하면 저장소가 지워집니다." \
         "고치기: git sparse-checkout disable  또는 전체를 다시 클론"
  fi
  if [ $((HEAD_N - IDX_N)) -gt "$DROP_MIN" ]; then
    stop "이번 커밋에서 파일이 $((HEAD_N - IDX_N)) 개 사라집니다" \
         "5만 파일 삭제 사고(5e8e886·d32c334)와 같은 모양입니다. 삭제 목록을 먼저 확인하세요."
  fi
  if [ "$IDX_N" -lt $((HEAD_N * 9 / 10)) ]; then
    stop "파일이 직전 커밋의 90% 아래로 줄었습니다 ($HEAD_N → $IDX_N)"
  fi
fi

exit 0
```

### 3-2. `.githooks/pre-push` — **신설**

커밋은 정상인데 **원격에 다른 판을 덮어쓰는** 경우(force-push)와 `main` 삭제를 막는다. 푸시될 **트리 자체**를 세므로, 복구 스크립트처럼 정상 판을 얹는 푸시는 통과한다.

```sh
#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# .githooks/pre-push — main 으로 나가는 force-push · 브랜치 삭제 · 파일 수 급감 차단
#   git 이 stdin 으로 주는 줄: <지역 ref> <지역 sha> <원격 ref> <원격 sha>
#   main 이 아닌 브랜치(backup/last-good · 실험 브랜치)는 통과시킨다.
# ─────────────────────────────────────────────────────────────────────────────
set -u

FLOOR=45000
DROP_MIN=1000
ZERO=0000000000000000000000000000000000000000

stop() {
  echo ""
  echo "🔴 $1"
  echo "   $2"
  echo "   되돌리기 어려운 변경이라 푸시를 멈췄습니다. 복구가 필요하면 tools/emergency_restore.sh 를 쓰세요."
  echo ""
  exit 1
}

while read -r lref lsha rref rsha; do
  [ "$rref" = "refs/heads/main" ] || continue

  if [ "$lsha" = "$ZERO" ]; then
    stop "main 브랜치를 지우려 합니다" "main 은 저장소의 기준선입니다. 지우지 않습니다."
  fi

  if [ "$rsha" != "$ZERO" ]; then
    if ! git merge-base --is-ancestor "$rsha" "$lsha" 2>/dev/null; then
      stop "main 에 force-push(이전 판 덮어쓰기)입니다" "이력이 사라지면 무엇이 지워졌는지 다시 알 수 없습니다."
    fi
  fi

  N=$(git ls-tree -r --name-only "$lsha" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$N" -lt "$FLOOR" ]; then
    stop "푸시할 판의 파일이 $N 개뿐입니다 (기준 54,825)" "부분 체크아웃에서 만든 판으로 보입니다."
  fi

  if [ "$rsha" != "$ZERO" ]; then
    M=$(git ls-tree -r --name-only "$rsha" 2>/dev/null | wc -l | tr -d ' ')
    if [ $((M - N)) -gt "$DROP_MIN" ]; then
      stop "푸시하면 파일이 $((M - N)) 개 사라집니다 ($M → $N)" "5만 파일 삭제 사고와 같은 모양입니다."
    fi
    echo "   main 푸시 확인: 파일 $N 개 (원격 $M)"
  else
    echo "   main 첫 푸시 확인: 파일 $N 개"
  fi
done

exit 0
```

### 3-3. 기존 차단 목록과의 충돌 정리 (이 두 줄이 핵심)

| 파일 | 지금 | 바꾼 뒤 | 근거 |
| --- | --- | --- | --- |
| `CLAUDE.md` | `BLOCKED` 에 있어 **커밋 불가** | 목록에서 빼고 **내용 검사**(§3-1 1-b)로 대체 | 비밀 없는 안전 규칙 문서다. 비밀이 들어가면 훅이 막는다 |
| `orders/ORDER_*.md` | `ORDER_` 규칙에 걸려 **커밋 불가** | `grep -vE '^orders/ORDER_[A-Za-z0-9_-]+\.md$'` 로 **orders/ 만** 예외 | 사장님→클코 지시서는 이미 공개 저장소의 작업 흐름이다(11-16·11-22 오더 모두 `orders/`) |

**손대지 않는 것**: `scratchpad/*.md` · `작업규칙.md` · `references/` · `HANDOVER*` · `tools/vendor/` · `사업문서/` · `supabase/supabase/` · `복원된_채팅기록/` · `HANDOFF.md`.
→ `orders/` 밖의 `ORDER_*.md`(예: 루트에 흩어진 옛 지시서)는 **계속 막힌다**. 그게 맞다.

### 3-4. `tools/setup_hooks.sh` · `tools/setup_hooks.ps1` — 한 번에 켜기

`.sh` (LF):

```sh
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
```

`.ps1` (UTF-8 BOM, 로직은 git 명령 몇 줄이라 그대로 구현):

```powershell
# 훅 켜기 (윈도우) — pwsh tools/setup_hooks.ps1
$ErrorActionPreference = 'Stop'
Set-Location (git rev-parse --show-toplevel)
git config core.hooksPath .githooks
Write-Host "OK core.hooksPath =" (git config core.hooksPath)
Write-Host "  hooks:" ((Get-ChildItem .githooks).Name -join ' ')
$n = (git ls-files | Measure-Object -Line).Lines
Write-Host "  tracked files: $n  (2026-11-22 baseline 54825)"
```

### 3-5. `CLAUDE.md` — 루트에 신설 (전문)

클로드 코드가 이 저장소에서 **자동으로 읽는** 파일이다. 비밀은 한 줄도 넣지 않는다(공개 저장소).

```markdown
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
```

### 3-6. 이 층의 한계 (그래서 2중이 필요하다)

- 깃허브 액션이 `GITHUB_TOKEN` 으로 만드는 커밋은 **훅을 타지 않는다**. 그래서 액션 쪽 자동 커밋이 사고를 낼 가능성은 §4 의 배포 게이트가 막는다.
- 훅은 **로컬 설정**이라 새로 클론한 폴더에서는 꺼져 있다(09:51 커밋이 그랬다). 그래서 `CLAUDE.md`(모델이 읽는 규칙)와 `setup_hooks`(켜는 도구)를 함께 둔다.

---

## 4. 2중 방어 — 배포 게이트 + 원격 보호 + 즉시 되돌림 + 외부 감시

> 목표: **main 이 망가져도 라이브는 내려가지 않는다.** 게이트를 통과한 판만 라이브에 올라가고, 실패하면 직전 배포가 그대로 서비스된다.
>
> 이 층은 네 조각이다. 순서대로 **A 배포 게이트(§4-2·§4-3)** · **B 즉시 되돌림(§4-5)** · **C 원격 보호(§4-4)** · **D 외부 감시(§4-6)**.
> A 는 "망가진 판을 올리지 않는다", B 는 "A 를 못 쓸 때(legacy Pages) main 을 스스로 되돌린다", C 는 "이력을 지우지 못하게 한다", D 는 "깃허브가 통째로 죽어도 운다".
> **A 는 조건부다** — 사이트가 1,049MB 라 Pages 1GB 선을 넘는다(§1-2). 실배포가 크기로 실패하면 legacy 로 돌아가고, 그때 라이브를 지키는 것은 **B** 다.

### 4-1. `tools/deploy_gate_check.sh` — 게이트 판정 로직(따로 떼어 시험 가능하게)

```sh
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

MB=$(du -sm --exclude=.git . 2>/dev/null | cut -f1)
[ -n "${MB:-}" ] || MB=0
MAX_MB="${MAX_MB:-1200}"     # 2026-11-22 실측 1,049MB — 1GB 선을 넘은 채로 legacy 가 돌고 있다. 그래서 '파국'만 막는다
[ "$MB" -le "$MAX_MB" ] || bad "사이트 ${MB}MB — MAX_MB($MAX_MB) 초과(아티팩트·Pages 한도 위험)"
[ "$MB" -ge 1000 ] && echo "::warning::사이트 ${MB}MB — Pages 1GB 선을 넘었다. 배포가 크기로 실패하면 §4-3 대로 legacy 로 되돌리고 §4-5 로 간다"

echo "추적 파일 $N · index.html ${SZ}B · 워크플로 $W개 · 사이트 ${MB}MB"
if [ "$FAIL" = 0 ]; then
  echo "=== 통과: 올려도 되는 판"
  exit 0
fi
echo "=== 실패: 배포를 멈춘다 (라이브는 직전 정상 판 유지)"
exit 1
```

### 4-2. `.github/workflows/deploy-pages.yml` — **신설**

```yaml
# 라이브 배포의 유일한 길 — 2중 방어선 (2026-11-22 사고 뒤)
#   main 이 망가져도 게이트(tools/deploy_gate_check.sh)를 못 넘으면 배포하지 않는다
#   → 라이브는 '마지막으로 성공한 배포'를 계속 서비스한다(404 로 내려가지 않는다).
#   ⚠ Pages 설정의 Source 가 「GitHub Actions」 여야 이 워크플로가 라이브를 올린다(§4-3).
#   ⚠ GITHUB_TOKEN 으로 만든 푸시는 다른 워크플로를 깨우지 못한다. 그래서 자동 작업이 올린 판은
#      workflow_run 으로 받는다. 아래 이름을 바꾸면 그 자동 작업의 배포가 끊긴다 → 이름 바꿀 땐 여기도 같이.
name: 라이브 배포 (안전 게이트)

on:
  push:
    branches: [main]
  workflow_run:
    workflows:
      - 검색 노출 페이지 매일 갱신
      - PC 작업 클라우드 실행
      - 아침 인스타 카드 만들기
      - 손님 화면 실시간 검사
      - 제보 자동 코드 수정
      - 고장 자동 수리
      - 손님 제보 클라우드 처리
      - 핫딜 24시간 무인 자동 수집
      - befe-sale-auto
      - 검색 페이지 1회성 손질 (GA4·noai)
      - 구글 순위 주간 측정
    types: [completed]
  schedule:
    - cron: '35 20 * * *'      # UTC 20:35 = KST 05:35 — 05:10 빌드 뒤 하루 한 번 보정(위 목록이 끊겨도 하루 안에 반영)
  workflow_dispatch:
    inputs:
      dry_run:
        description: '검증만 하고 배포는 건너뛴다'
        type: boolean
        default: false

permissions:
  contents: write      # backup/last-good 갱신(§5-2)
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 40
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    outputs:
      sha: ${{ steps.meta.outputs.sha }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main          # 트리거와 무관하게 '지금 main' 을 올린다
          fetch-depth: 1

      - id: meta
        name: 올릴 판 기록
        run: |
          echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
          git log -1 --format='판: %h %s'

      - name: 게이트 검증 (망가진 판이면 여기서 멈춘다)
        run: bash tools/deploy_gate_check.sh

      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .

      - id: deployment
        name: 배포
        if: ${{ github.event.inputs.dry_run != 'true' }}
        uses: actions/deploy-pages@v4

      - name: 배포 직후 라이브 확인 (실패해도 배포 자체는 유지 — 백업은 다음 잡이 판단)
        if: ${{ github.event.inputs.dry_run != 'true' }}
        continue-on-error: true
        run: bash tools/live_verify.sh

  backup:
    needs: deploy
    if: ${{ github.event.inputs.dry_run != 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.deploy.outputs.sha }}
          fetch-depth: 1

      - name: 라이브 재확인 — 여기서 통과해야만 '정상 판'으로 인정한다
        run: bash tools/live_verify.sh

      - name: backup/last-good 갱신 (고정 브랜치 1개만 유지)
        run: |
          SHA=$(git rev-parse HEAD)
          N=$(git ls-files | wc -l)
          echo "정상 판: $SHA · 파일 $N 개"
          [ "$N" -ge 45000 ] || { echo "::error::파일 $N 개 — 백업하지 않는다"; exit 1; }
          git push --force origin "$SHA:refs/heads/backup/last-good"
          echo "✅ backup/last-good → $SHA"
```

`tools/live_verify.sh` — 배포 확인용(두 잡이 같이 쓴다):

```sh
#!/bin/sh
# 라이브가 실제로 살아 있는지 본다. 배포 직후 CDN 반영 지연을 감안해 재시도한다.
set -u
SITE="${SITE:-https://momcalendar.com}"
TRIES="${TRIES:-8}"
SLEEP="${SLEEP:-15}"
i=1
while [ "$i" -le "$TRIES" ]; do
  A=$(curl -s -o /tmp/lv_home -w '%{http_code}' --max-time 20 "$SITE/?v=$RANDOM" || echo 000)
  B=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/test.html?v=$RANDOM" || echo 000)
  C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/sitemap.xml?v=$RANDOM" || echo 000)
  K=$(grep -c '맘캘린더' /tmp/lv_home 2>/dev/null || true)
  K=${K:-0}
  echo "[$i/$TRIES] /=$A test=$B sitemap=$C 키워드=$K"
  if [ "$A" = 200 ] && [ "$B" = 200 ] && [ "$C" = 200 ] && [ "${K:-0}" -gt 0 ]; then
    echo "=== 통과: 라이브 정상 ($SITE)"
    exit 0
  fi
  i=$((i + 1))
  [ "$i" -le "$TRIES" ] && sleep "$SLEEP"
done
echo "=== 실패: 라이브가 정상이 아니다"
exit 1
```

### 4-3. Pages 소스 전환 절차 (**순서를 지킬 것 — 라이브가 걸린 작업이다**)

⚠️ **선행 사실**: 2026-11-22 실측으로 이 저장소가 서비스하는 파일은 **1,049MB**다. GitHub Pages 는 1GB 를 넘기지 말라고 권고하고, legacy 빌드는 지금도 되지만 **Actions 배포(`deploy-pages`)는 아티팩트 크기 때문에 거절될 수 있다.** 그래서 이 절차는 "되는지 실제로 해 보고, 안 되면 1클릭으로 돌아온다"로 짠다.

| 단계 | 하는 일 | 확인 |
| --- | --- | --- |
| ① | 위 파일들(워크플로 2개 + 스크립트 2개)을 커밋·푸시(**아직 Pages 는 legacy 그대로** — 이 시점엔 라이브가 그대로다) | 푸시 후 legacy 빌드가 정상 통과(`gh api repos/wonji2/momcalendar/pages/builds?per_page=1` → `built`) |
| ② | `gh workflow run "라이브 배포 (안전 게이트)" -f dry_run=true` | 게이트 로그에 `=== 통과` + `추적 파일 5xxxx · index.html …B · 사이트 …MB` · deploy 스텝은 **건너뜀** |
| ③ | Pages Source 를 **GitHub Actions** 로 전환 (§ 아래 명령) | `gh api repos/wonji2/momcalendar/pages` → `"build_type": "workflow"`, `cname` 이 여전히 `momcalendar.com` |
| ④ | `gh workflow run "라이브 배포 (안전 게이트)"` (실배포) | run 성공 · `deploy`·`backup` 두 잡 통과 · `gh api repos/wonji2/momcalendar/pages/deployments?per_page=1` 의 sha == `git rev-parse origin/main` |
| ⑤ | 커스텀 도메인·HTTPS 재확인 | `curl -sI https://momcalendar.com/` 200 + `gh api …/pages` 의 `cname`·`https_enforced: true`·`https_certificate.state: approved` |

③ 명령(둘 중 하나):
```
gh api -X PUT repos/wonji2/momcalendar/pages -f build_type=workflow
```
안 되면 화면에서: Settings → Pages → Build and deployment → Source: **GitHub Actions**.

**④ 에서 실패하면**(대개 아티팩트/게시 크기 초과 — 이 저장소는 1,049MB): **한 번만** 되돌리고 B(§4-5)로 넘어간다.
```
gh api -X PUT repos/wonji2/momcalendar/pages -f build_type=legacy -f source[branch]=main -f source[path]=/
```
(또는 Settings → Pages → Source: *Deploy from a branch* → `main` / `/`.) 라이브는 그동안 직전 배포를 계속 서비스하므로 **내려가지 않는다**. 되돌린 뒤 `run` 로그의 마지막 오류 30줄을 §8 보고에 그대로 붙이고, **§4-5 를 켠 채로** 마무리한다(그게 legacy 모드의 라이브 보호다).

> 크기를 줄여 A 를 되살리는 길은 **낡은 생성 페이지 정리**(툼스톤·브랜드 아카이브)다 — 지금 진행 중인 SEO 작업과 같은 방향이니 부록 B 에 남겼다. 이 오더에서는 페이지를 지우지 않는다.

> ③~④ 사이에 사장님이 라이브를 보실 수 있다. 전환은 되돌리기 쉬운 조작이지만 **라이브가 걸려 있으니 ②가 통과한 뒤에만**, 그리고 ⑤까지 마치고 바로 보고한다.

### 4-4. `main` force-push·브랜치 삭제 차단 (원격 보호)

개인 저장소라도 **공개 저장소**에서는 브랜치 보호가 무료다. PR 필수는 걸지 않는다 — 05:10 자동 빌드가 `main` 에 직푸시하므로 그게 막히면 사이트가 굳는다. **딱 두 가지만** 켠다.

```
gh api -X PUT repos/wonji2/momcalendar/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```
PowerShell 은 같은 JSON 을 `@' … '@ | gh api -X PUT … --input -` 로 넘긴다.

- `403 Resource not accessible by integration` 이 나오면 **권한 문제**다(자비스 쪽 토큰은 관리자 권한이 없어 이 호출이 403 이었다). 그때는 화면에서: Settings → Branches → Add branch protection rule → `main` → ✅ **Block force pushes** ✅ **Do not allow deleting this branch** (나머지는 비워 둔다).
- 확인: `gh api repos/wonji2/momcalendar/branches/main/protection` → `"allow_force_pushes": {"enabled": false}`, `"allow_deletions": {"enabled": false}`.
- 되돌리기: 같은 API 에 `true` 로 바꾸거나 화면에서 규칙 삭제.

### 4-5. **B. 즉시 되돌림** — `.github/workflows/repo-guard.yml` (legacy Pages 에서도 작동)

A(게이트 배포)를 못 켜는 경우에도 main 이 파국 상태면 **1~2분 안에 스스로 되돌린다**. `live-watch` 의 `watch_autofix`(화면 고장 시 `index.html` 자동 되돌림)와 같은 방식이고, 대상이 저장소 전체다.

- 판정은 **명백한 파국만**: 파일 45,000 미만 · `index.html` 없음/500KB 미만 · 워크플로 10개 미만. 정상 정리(툼스톤·브랜드 페이지 수백 장)는 건드리지 않는다.
- 되돌릴 때는 `backup/last-good` 트리를 **지금 main 위에 새 커밋으로** 얹는다(force 아님 → 브랜치 보호와 훅을 정상 통과).
- 블롭 없이 돌게(`filter: blob:none`) 해서 54k 파일 체크아웃을 하지 않는다 — 10분마다 도는 작업이라 가볍게 둔다.

```yaml
name: 저장소 즉시 되돌림 (repo-guard)

# 2중 방어 B — main 이 '통째로 망가진' 판이면 backup/last-good 트리로 새 커밋을 얹어 즉시 되돌린다.
#   · deploy-pages 게이트(§4-2)를 켜지 못한 legacy 모드에서도 라이브 404 를 1~2분으로 줄인다.
#   · 판정은 명백한 파국만(파일 45,000 미만 / index.html 없음·500KB 미만 / 워크플로 10개 미만).
#   · 정상 정리(툼스톤·브랜드 페이지 수백 장)는 건드리지 않는다.
on:
  push:
    branches: [main]
  schedule:
    - cron: '*/10 * * * *'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: repo-guard
  cancel-in-progress: false

jobs:
  guard:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 1
          filter: blob:none          # 트리만 받는다(파일 수를 세려고 54k 파일을 꺼내지 않는다)

      - id: chk
        name: 파국인가
        run: |
          N=$(git ls-tree -r --name-only HEAD | wc -l | tr -d ' ')
          SZ=$(git cat-file -s HEAD:index.html 2>/dev/null || echo 0)
          W=$(git ls-tree -r --name-only HEAD -- .github/workflows | grep -c '\.yml$' || true)
          W=${W:-0}
          echo "파일 $N · index.html ${SZ}B · 워크플로 $W개"
          bad=0
          [ "${N:-0}" -ge 45000 ] || bad=1
          [ "${SZ:-0}" -ge 500000 ] || bad=1
          [ "$W" -ge 10 ] || bad=1
          echo "bad=$bad" >> "$GITHUB_OUTPUT"

      - name: 되돌리기
        if: ${{ steps.chk.outputs.bad == '1' }}
        run: |
          set -e
          git fetch -q --filter=blob:none origin refs/heads/backup/last-good
          GOOD=$(git rev-parse FETCH_HEAD)
          GT=$(git rev-parse "$GOOD^{tree}")
          GN=$(git ls-tree -r --name-only "$GOOD" | wc -l | tr -d ' ')
          echo "정상 판 $GOOD · 파일 $GN개"
          [ "$GN" -ge 45000 ] || { echo "::error::백업 판이 $GN개 — 되돌리지 않는다(사장님 확인 필요)"; exit 1; }
          for i in 1 2 3; do
            CUR=$(git ls-remote origin refs/heads/main | cut -f1)
            NEW=$(GIT_AUTHOR_NAME=momcal-bot GIT_AUTHOR_EMAIL=noreply@momcalendar.com \
                  GIT_COMMITTER_NAME=momcal-bot GIT_COMMITTER_EMAIL=noreply@momcalendar.com \
                  git commit-tree "$GT" -p "$CUR" -m "🔴 자동 되돌림: main 이 파국 상태(파일 45,000 미만 또는 핵심 파일 없음) — backup/last-good($GOOD) 트리로 복구 (repo-guard)")
            if git push origin "$NEW:refs/heads/main"; then
              echo "✅ 되돌림 완료: $NEW"
              exit 0
            fi
            echo "푸시 거절 — 다시 (${i}/3)"; sleep 5
          done
          echo "::error::자동 되돌림 실패 — 사람이 tools/emergency_restore.sh --yes 로 처리해야 한다"
          exit 1
```

### 4-6. 외부 감시 — Cloudflare Workers 무료 크론 (`tools/cf-healthcheck-worker/`)  (D)

깃허브가 통째로 망가져도(워크플로 삭제·액션 정지) 라이브를 보는 마지막 그물. **파일만 만들고, 배포는 사람이 한다**(Cloudflare 로그인·시크릿).

`tools/cf-healthcheck-worker/worker.js`:

```js
// 맘캘린더 외부 감시 — 5분마다 홈·test.html·sitemap 을 두드려 200 + '맘캘린더' 를 확인한다.
// 깃허브와 무관하게 돈다(깃허브 액션·Pages 가 같이 망가진 경우의 마지막 그물).
// 상태는 KV(STATE)에 두고 '바뀔 때만' 알린다 — 5분마다 같은 경보가 쏟아지지 않게.
const SITE = 'https://momcalendar.com';
const TARGETS = [
  { name: '/', url: SITE + '/', keyword: '맘캘린더' },
  { name: '/test.html', url: SITE + '/test.html' },
  { name: '/sitemap.xml', url: SITE + '/sitemap.xml' },
];

async function probe() {
  const bad = [];
  for (const t of TARGETS) {
    try {
      const r = await fetch(t.url + '?hc=' + Date.now(), { cf: { cacheTtl: 0 } });
      let ok = r.status === 200;
      if (ok && t.keyword) {
        const body = await r.text();
        ok = body.includes(t.keyword);
      }
      if (!ok) bad.push(`${t.name} ${r.status}${r.status === 200 ? ' (키워드 없음)' : ''}`);
    } catch (e) {
      bad.push(`${t.name} ${e.message}`);
    }
  }
  return bad;
}

async function notify(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
}

async function check(env) {
  const bad = await probe();
  const prev = await env.STATE.get('state');
  if (bad.length === 0) {
    if (prev === 'down') await notify(env, '🟢 라이브 회복 — momcalendar.com 다시 정상');
    await env.STATE.put('state', 'up');
  } else {
    if (prev !== 'down') {
      await notify(env, `🔴 라이브 이상 — ${bad.join(' · ')}\n복구: bash tools/emergency_restore.sh --yes`);
    }
    await env.STATE.put('state', 'down');
  }
  return { bad, prev: prev || 'up' };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(check(env));
  },
  async fetch(req, env) {
    const bad = await probe();
    return new Response(JSON.stringify({ site: SITE, ok: bad.length === 0, bad }, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
```

`tools/cf-healthcheck-worker/wrangler.toml`:

```toml
name = "momcal-healthcheck"
main = "worker.js"
compatibility_date = "2026-11-22"

[triggers]
crons = ["*/5 * * * *"]

[vars]
# 값은 여기에 쓰지 않는다. 시크릿은 wrangler secret put 으로 넣는다.

[[kv_namespaces]]
binding = "STATE"
id = "여기에_wrangler_kv_namespace_create_STATE_결과_id"
```

`tools/cf-healthcheck-worker/README.md` — 사람이 한 번만 하는 순서:

```markdown
# 맘캘린더 외부 감시 워커

깃허브와 무관하게 5분마다 라이브를 확인하고, 이상하면 텔레그램으로 알린다.

## 한 번만 (Cloudflare 로그인 필요 — 자비스는 대신 못 한다)
    npm i -g wrangler
    wrangler login
    cd tools/cf-healthcheck-worker
    wrangler kv namespace create STATE      # 나온 id 를 wrangler.toml 에 붙인다
    wrangler secret put TELEGRAM_BOT_TOKEN  # 봇 토큰
    wrangler secret put TELEGRAM_CHAT_ID    # 받을 방/대화 id
    wrangler deploy

## 확인
    curl https://momcal-healthcheck.<서브도메인>.workers.dev/   # {"ok": true, "bad": []} 면 정상
    wrangler tail                                              # 예약 실행 로그

## 끄기
    wrangler delete
```

### 4-7. 왜 자동 커밋 워크플로는 그대로 두는가 (점검 결과)

17개 워크플로를 전수 확인했다 — **`git add -A`·`git add .`·`git commit -a` 는 0건**이고, 모두 경로를 지정한다(`seo-daily.yml` 은 `git add g p s m d c gg …` + `git reset -- index.html …`, `daily-card.yml` 은 `git add daily`). `watch_autofix.mjs` 도 `git add index.html` 한 줄이다.
`sparse-checkout` 을 쓰는 워크플로는 7개(`bugfix-cloud`·`hotdeal-cloud`·`inquiry-cloud`·`live-watch`·`pc-jobs-cloud`·`red-autofix-cloud`·`seo-rank-weekly`)인데, 이들은 **커밋하지 않고** 읽기만 하거나(핫딜·제보) 자기 경로만 add 한다.
→ **고칠 필요 없다.** 다만 이 목록은 "지금 안전"이라는 뜻이지 "구조적으로 안전"은 아니다. 그래서 배포 게이트가 뒤를 받친다. (액션 쪽에 새 자동 커밋을 만들 때는 반드시 경로 지정 + `tools/deploy_gate_check.sh` 를 먼저 돌린다.)

---

## 5. 3중 보험 — `backup/last-good` + 10초 복구

> 목표: **이미 라이브까지 망가진 뒤** 되돌린다. 저장소가 1.65GB 라 날짜별 백업 브랜치를 쌓으면 안 되고, **고정 브랜치 1개**만 유지한다.

### 5-1. 규칙

- 브랜치 이름은 **`backup/last-good`** 하나. 항상 "라이브 검증을 통과한 마지막 커밋"을 가리킨다.
- **"배포 성공"이 아니라 "라이브 200 + 키워드 통과" 뒤에만** 갱신한다(망가진 판으로 백업을 덮으면 보험이 사라진다). §4-2 의 `backup` 잡이 `tools/live_verify.sh` 를 통과한 뒤에만 `--force` 로 갱신한다.
- 이 브랜치는 같은 커밋을 가리키므로 **추가 용량이 거의 0**이다(이미 main 이력에 있는 객체).

### 5-2. 지금 한 번 손으로 만들기 (**② 커밋 직후, dry-run 전에** — repo-guard 가 되돌릴 곳이 있어야 한다)

배포 게이트가 아직 안 돌았으므로, **현재 라이브(= `b9d5d8e`, 10:30 기준 200 확인)** 를 첫 정상 판으로 못박는다.

```sh
git fetch origin main
bash tools/live_verify.sh || { echo "라이브가 정상이 아니면 백업을 만들지 않는다"; exit 1; }
git ls-tree -r --name-only origin/main | wc -l     # 54,825 확인
git push origin origin/main:refs/heads/backup/last-good
git ls-remote origin refs/heads/backup/last-good   # sha 확인
```

### 5-3. `tools/emergency_restore.sh` — 10초 복구 (신설)

`backup/last-good` 의 **트리**를 지금 `main` 위에 **새 커밋으로** 얹는다(fast-forward). force-push 가 차단돼 있어도 되고, 이력도 남는다.

```sh
#!/bin/sh
# 비상 복구 — backup/last-good 의 트리를 main 위에 새 커밋으로 얹는다(force-push 아님).
#   미리보기:    bash tools/emergency_restore.sh
#   실제 복구:   bash tools/emergency_restore.sh --yes
#   연습(안전):  DST_REF=refs/heads/restore-rehearsal bash tools/emergency_restore.sh --yes
set -u

GOOD_REF="${GOOD_REF:-refs/heads/backup/last-good}"
DST_REF="${DST_REF:-refs/heads/main}"
MIN_FILES="${MIN_FILES:-45000}"      # 이보다 적은 판은 백업으로 인정하지 않는다(기준 54,825)
MODE="${1:-}"

git fetch -q origin main || { echo "main 을 못 받았다"; exit 1; }
CUR=$(git rev-parse origin/main)

git fetch -q origin "$GOOD_REF" || { echo "$GOOD_REF 를 못 받았다 — 백업 브랜치가 없다(§5-2)"; exit 1; }
GOOD=$(git rev-parse FETCH_HEAD)
GTREE=$(git rev-parse "$GOOD^{tree}")
GN=$(git ls-tree -r --name-only "$GOOD" | wc -l | tr -d ' ')
CN=$(git ls-tree -r --name-only "$CUR" | wc -l | tr -d ' ')

echo "정상 판 (backup/last-good): $GOOD  ·  파일 $GN 개  ·  $(git log -1 --format='%h %s' "$GOOD")"
echo "지금 main              : $CUR  ·  파일 $CN 개"

if [ "$GN" -lt "$MIN_FILES" ]; then
  echo "🔴 백업 판의 파일이 $GN 개뿐입니다 — 복구하지 않습니다(백업이 잘못됐다)"
  exit 1
fi

if [ "$MODE" != "--yes" ]; then
  echo ""
  echo "(미리보기) 실제로 되돌리려면:  bash tools/emergency_restore.sh --yes"
  [ "$DST_REF" != "refs/heads/main" ] && echo "  · 연습 모드 대상: $DST_REF"
  exit 0
fi

NEW=$(GIT_AUTHOR_NAME="momcal-bot" GIT_AUTHOR_EMAIL="noreply@momcalendar.com" \
      GIT_COMMITTER_NAME="momcal-bot" GIT_COMMITTER_EMAIL="noreply@momcalendar.com" \
      git commit-tree "$GTREE" -p "$CUR" -m "🔴 복구: backup/last-good($GOOD) 트리로 되돌림 — 새 커밋으로 얹음(이력 보존)")

echo "복구 커밋: $NEW"
git push origin "$NEW:$DST_REF" || { echo "🔴 푸시 실패 — 원격 상태를 확인하세요"; exit 1; }

if [ "$DST_REF" = "refs/heads/main" ]; then
  echo "푸시 완료. 라이브 반영을 확인한다…"
  SLEEP=5 TRIES=12 bash tools/live_verify.sh || echo "⚠️ 라이브 확인 실패 — 몇 분 뒤 다시 확인하세요(배포 파이프라인이 있으면 §4-2 가 올린다)"
fi
```

`tools/emergency_restore.ps1` (UTF-8 BOM · 얇은 껍데기):

```powershell
# 윈도우에서 부르기 — 로직은 tools/emergency_restore.sh 한 곳에만 둔다
param([switch]$Yes, [string]$Dst = "")
if ($Dst -ne "") { $env:DST_REF = $Dst }
$mode = if ($Yes) { "--yes" } else { "" }
bash tools/emergency_restore.sh $mode
exit $LASTEXITCODE
```

### 5-4. 왜 force-push 없이 복구되나

`git commit-tree <백업트리> -p <지금 main>` 은 **부모가 지금 main 인 새 커밋**을 만든다. 그래서 원격 입장에서는 fast-forward 이고, §4-4 의 force-push 차단과 §3-2 의 pre-push 훅(ancestry·파일 수)을 **정상 통과**한다. `--no-verify` 를 쓸 일이 없다.

---

## 6. 검증 체크리스트 (V1~V14 — 실제로 돌리고 표로 보고)

| # | 검증 | 방법 | 합격 기준 |
| --- | --- | --- | --- |
| V1 | 훅 켜짐 | `bash tools/setup_hooks.sh` → `git config core.hooksPath` | `.githooks` · 두 번 돌려도 같은 결과 |
| V2 | 보호 경로 삭제 차단 | 실험 브랜치에서 `git rm --cached index.html` → `git commit -m t` → `git reset` → `git checkout -- index.html` | 커밋 **차단**(exit 1) · `README` 대신 "핵심 파일이 커밋에서 삭제됩니다" 문구 · 되돌린 뒤 `git ls-files \| wc -l` = 54,825 |
| V3 | 파일 수 급감 차단 | `git rm --cached -r g` → `git commit -m t` → `git reset` → `git status --short` | **차단** · 문구에 `이번 커밋에서 파일이 N 개 사라집니다` · 되돌린 뒤 파일 수 원복 |
| V4 | 정상 커밋은 통과 | `git commit --allow-empty -m "훅 시험"` | **통과** · 로그에 `추적 파일: HEAD 54825 → 이번 커밋 54825` · 커밋은 `git reset --soft HEAD~1` 로 되돌린다 |
| V5 | pre-push: force·삭제 차단 | `git init --bare /tmp/hooktest.git` → `git remote add hooktest /tmp/hooktest.git` → ① `git push hooktest HEAD:refs/heads/main` ② `git push --force hooktest HEAD~1:refs/heads/main` ③ `git push hooktest :refs/heads/main` → `git remote remove hooktest` | ① 통과 ② **차단**(force-push) ③ **차단**(브랜치 삭제). `/tmp/hooktest.git` 는 지운다 |
| V6 | 게이트 스크립트 정상 판 | `bash tools/deploy_gate_check.sh` | `=== 통과` + `추적 파일 548xx · index.html 1,0xx,xxxB · 워크플로 17개 · 사이트 NMB` · N ≥ 1000이면 `::warning::` 한 줄(실측 ~1,049 — 정상) |
| V7 | 게이트 스크립트 망가진 판 | `mkdir -p /tmp/fake && cp index.html /tmp/fake/ && (cd /tmp/fake && git init -q) && GATE_ROOT=/tmp/fake bash tools/deploy_gate_check.sh` (실패하면 exit 1 이므로 `; echo "exit=$?"` 로 확인) | `=== 실패` + `test.html 가 없다`·`추적 파일 0 개` 둘 다 나옴 · 라이브는 그대로 200 |
| V8 | 배포 게이트 dry_run | `gh workflow run "라이브 배포 (안전 게이트)" -f dry_run=true` → `gh run watch` | 게이트 통과 · `배포` 스텝 **skipped** · 라이브 주소 4개 여전히 200 |
| V9 | Pages 전환·실배포 | §4-3 ③④ | `build_type: workflow` · run 성공 · `pages/deployments?per_page=1` sha == `origin/main` · `/` 200 |
| V10 | 백업 자동 갱신 | V9 직후 `git ls-remote origin refs/heads/backup/last-good` | sha == 배포한 판 · `git ls-tree -r <sha> \| wc -l` = 54,825+ |
| V11 | 복구 미리보기 | `bash tools/emergency_restore.sh` | 정상 판/지금 main 두 줄 + `(미리보기)` · **푸시 없음**(`git ls-remote origin refs/heads/main` 변화 없음) |
| V12 | 복구 연습 | `DST_REF=refs/heads/restore-rehearsal bash tools/emergency_restore.sh --yes` → 확인 → `git push origin --delete restore-rehearsal` | 연습 브랜치 생성 · 파일 수 54,825 · **main 무변경** · 연습 브랜치 삭제 확인 |
| V13 | 워커 문법·문서 | `node --check tools/cf-healthcheck-worker/worker.js` · `ls tools/cf-healthcheck-worker/` | 오류 0 · `worker.js`·`wrangler.toml`·`README.md` 세 개 |
| V14 | repo-guard 판정 | `gh workflow run "저장소 즉시 되돌림 (repo-guard)"` (정상 main) | 로그 `파일 54825 · index.html 1,0xxxxxxB · 워크플로 17개` + `bad=0` · **되돌리기 스텝 skipped** · main sha 무변경 |

추가로 매 커밋 전후에 남길 것: `git ls-files | wc -l` 값(작업 전·①·②·③·④ 후).
라이브 무변경 확인: `git log --stat -- index.html test.html admin.html staff.html | head` → 이번 오더의 커밋이 **0건**.

---

## 7. 커밋 나누기 (한 커밋에 섞지 말 것 · 경로 지정 add)

| 커밋 | 내용 | add 할 경로 |
| --- | --- | --- |
| ① 1중 | 훅 2개 + 켜는 도구 + `CLAUDE.md` | `git add .githooks/pre-commit .githooks/pre-push tools/setup_hooks.sh tools/setup_hooks.ps1 CLAUDE.md` |
| ② 2중(게이트) | 배포 워크플로 + 즉시 되돌림 워크플로 + 판정·확인 스크립트 | `git add .github/workflows/deploy-pages.yml .github/workflows/repo-guard.yml tools/deploy_gate_check.sh tools/live_verify.sh` |
| ③ 3중(보험) | 복구 스크립트 2개 | `git add tools/emergency_restore.sh tools/emergency_restore.ps1` |
| ④ 외부 감시 | 워커 3파일 | `git add tools/cf-healthcheck-worker/worker.js tools/cf-healthcheck-worker/wrangler.toml tools/cf-healthcheck-worker/README.md` |

- 커밋 메시지 예: `안전장치① 로컬 훅·CLAUDE.md — 부분 체크아웃 대량 삭제 차단 (2026-11-22 사고)`
- ①②③④ 는 **각각 따로 푸시**해도 되고 한 번에 밀어도 된다. 단 ①과 ②가 같은 판에 올라가야 §4-3 ②(dry_run)를 바로 할 수 있다.
- `.githooks/*` 는 ①에서만 건드린다. 이후 커밋에서 훅이 자기 자신을 막지 않도록 §3-1 의 `PROTECTED` 는 **삭제만** 막는다(수정은 통과).

---

## 8. 보고 형식

- 커밋 해시 4개 + GitHub 파일 URL(`.githooks/pre-commit`·`deploy-pages.yml`·`emergency_restore.sh`·`CLAUDE.md`)
- §6 V1~V14 표 — **실측값 그대로**, 못 한 것은 "못 함 + 이유"
- 각 커밋 전후 `git ls-files | wc -l` 값(기준 54,825 · 이 문서가 올라간 뒤에는 54,826)
- §4-3 전환 결과: `build_type` 전후 값 · 첫 실배포 run id · `pages/deployments` sha · 라이브 4주소 코드
- §4-4 결과: `allow_force_pushes`·`allow_deletions` 값 (403 이면 그 사실 + 화면 절차를 남겼다는 말)
- `backup/last-good` sha · 파일 수
- 지시서와 다르게 한 것 / 못 한 것 / **사람이 해야 하는 것**: ① Pages Source 전환(권한 없으면) ② Cloudflare `wrangler login`·`kv namespace create`·`secret put`·`deploy` ③ 텔레그램 봇 토큰·대화 id

---

## 부록 A. 사람이 해야 하는 것 (클코가 못 하는 것)

| # | 일 | 누가 | 왜 |
| --- | --- | --- | --- |
| A1 | Pages Source 전환(§4-3 ③) 이 403 이면 Settings 에서 직접 | 사장님/관리자 | 저장소 관리자 권한 |
| A2 | Cloudflare 로그인 · 워커 배포(`README.md` 그대로) | 사장님 | Cloudflare 계정 로그인 |
| A3 | 텔레그램 봇 토큰·받을 방 id | 사장님 | 알림 받을 곳 |
| A4 | 브랜치 보호가 403 이면 Settings → Branches | 사장님/관리자 | 관리자 권한 |

## 부록 B. 이번에 하지 않는 것 (다음 오더 후보)

- **액션 쪽 자동 커밋에 같은 훅 규칙 걸기** — 액션은 로컬 훅을 안 탄다. 서버측 강제는 배포 게이트 + 브랜치 보호로 이미 막았고, 워크플로마다 검증 스텝을 넣는 건 다음 단계.
- **날짜별 백업 태그** — 저장소 1.65GB 라 쓰지 않는다(고정 브랜치 1개 유지).
- **`www.momcalendar.com` 301 · 서치콘솔 자동 수집** — 11-16 오더 §8 에서 이월된 그대로.
- **live-watch 에 "사이트가 낡았는지" 감시 추가** — 배포가 조용히 멈추면 200 이라 안 잡힌다. 지금은 §4-2 의 05:35 하루 1회 배포가 보정한다.
- **`backup/last-good` 의 서명·검증 강화**(예: 배포 후 스모크 통과 시에만 태그) — 지금은 live_verify 3주소 확인으로 충분.
- **사이트를 1GB 아래로 줄이기** — 지금 1,049MB 라 Actions 배포(A)가 막힐 수 있다. 낡은 `g/`·`gg/`·`p/` 페이지 툼스톤·아카이브로 900MB 아래로 내리면 A 를 안전하게 켤 수 있다(진행 중인 SEO 툼스톤 작업과 같은 방향).
