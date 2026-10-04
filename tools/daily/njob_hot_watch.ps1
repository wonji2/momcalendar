# 핫이슈 감시 → 터졌으면 바로 한 편 쓰고 올린다 (2026-10-02 사용자 지시)
#   "내가 명령을 안해도 니가 1시간에 한번씩이든 핫이슈 터진거 있는지 보고 있으면 바로 글 올리는거 자동화해"
# 한 시간에 한 번 윈도우 작업이 이것을 부른다.
#   1) njob-hot-watch.mjs 로 지금 터진 것이 있는지 본다 (종료코드 10 = 있다)
#   2) 있으면 claude CLI 를 불러 원고 1편을 쓰고 사진을 모아 검수한 뒤 예약 발행한다
#   3) 없으면 아무것도 하지 않고 끝낸다 (로그만 남긴다)
# 끄는 법: schtasks /Change /TN njob-hot-watch /DISABLE
$ErrorActionPreference = 'Continue'
$node = 'C:\Users\FAMILY\node-portable\node-v24.18.0-win-x64\node.exe'
$claude = 'C:\Users\FAMILY\.local\bin\claude.exe'
$sns = 'C:\Users\FAMILY\Desktop\MOMCALENDAR\sns-automation'
$draft = 'C:\Users\FAMILY\Desktop\블로그원고'
$log = Join-Path $PSScriptRoot 'njob_hot_watch.log'
function Say($m) { $l = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m; Add-Content -Path $log -Value $l -Encoding utf8; Write-Output $l }

$today = Get-Date -Format 'yyyy-MM-dd'

# 1) 감시
Push-Location $sns
& $node 'src/njob-hot-watch.mjs' | Out-Null
$code = $LASTEXITCODE
Pop-Location

if ($code -eq 1) { Say '감시 실패 — 이번 회차는 넘어갑니다'; exit 0 }
if ($code -ne 10) { Say '터진 것 없음'; exit 0 }

$jsonPath = Join-Path $draft "$today\핫이슈_감지.json"
if (-not (Test-Path $jsonPath)) { Say '지시 파일이 없습니다 — 넘어갑니다'; exit 0 }
$j = Get-Content $jsonPath -Raw -Encoding utf8 | ConvertFrom-Json
Say ("터짐: {0} (조회수 {1}, {2}위) → 원고 {3}번으로 씁니다" -f $j.제목, $j.조회수, $j.순위, $j.번호)

# 2) 글쓰기 — claude 를 사람 없이 돌린다. 규칙은 전부 파일에 있으니 "읽고 그대로 하라"고만 시킨다
$prompt = @"
너는 네이버 블로그 blog.naver.com/bboommee(엔잡방장) 방송연예 원고 작성자다.
방금 터진 기사 한 건을 지금 바로 1편 써서 예약 발행까지 끝내는 것이 이번 일이다. 사람은 지켜보지 않는다.

[터진 것]
제목: $($j.제목)
네이버 연예 많이 본 기사 $($j.순위)위 · 조회수 $($j.조회수) · 감지 $($j.감지시각)
사유: $($j.사유)
원고 번호: $($j.번호)

[먼저 읽어라 — 한 줄도 건너뛰지 마라]
1. $draft\00_작업전_체크리스트.txt
2. $draft\00_기본규칙_고정_2026-09-29.txt   (최우선. 다른 파일과 다르면 이 파일이 이긴다)
3. $draft\00_지침_최종본_이것만따름.txt
4. $draft\케넨_제목_연예60_2026-09-29.txt
5. $draft\$today\오늘의_기준.txt 와 연관키워드_확장.txt (있으면)
6. 형식 견본: $draft\$today 폴더에서 가장 최근에 만들어진 NN_*.txt 한 편을 통째로 읽어라

[이번 글에만 해당하는 것]
· 파일은 $draft\$today\$($j.번호)_분류_키워드.txt 로 저장한다 (분류는 스타이슈 또는 방송예능)
· 사진은 $draft\$today\사진_$($j.번호)\ 에 9~11장. 00부터 빈 번호 없이 1씩
· **사진 검수를 반드시 한다 (기본규칙 6-10 / 지침 C18).**
  node src/njob-photo-sheet.mjs $today "--only=$($j.번호)" 로 시트를 만들고 Read 로 직접 열어 한 장씩 눈으로 본다.
  광고·검정화면·플레이어 포커스 빨간 테두리·유튜브 쇼핑 배너·추천 영상 카드·구독 그래픽·쿠키 배너·
  글과 다른 장면·반쪽 로드·중복이 하나라도 있으면 그 사진은 버리고 20~45초 구간에서 다시 캡처한다.
  yt-capture.mjs 는 <videoId> <초> <저장경로> 형식이고 초는 오름차순이어야 한다.
· **확인된 것만 쓴다 (지침 F16).** 매체 2곳 이상에서 확인되지 않은 것은 쓰지 않는다.
  소속사·본인·기관의 공식 입장은 그대로 인용하고, 입장이 없으면 "아직 입장이 나오지 않았다"고 적는다.
  열애·논란 보도는 단정하지 말고 "○○가 보도했고 소속사는 ○○라고 밝혔다" 수준으로 쓴다.
· 사람이 죽거나 다친 일, 범죄 혐의, 재판, 정치·경제 이야기면 **글을 쓰지 말고 그만둬라.**
  그런 건 사람이 판단한다. 바탕화면에 ★사람이_판단할_이슈.txt 를 남기고 끝내라.
· 검사기를 돌려 오류 0 / 경고 0 이 될 때까지 고친다:
  cd $draft ; perl check_draft.pl $today\$($j.번호)_….txt

[발행 — 여기까지 해야 끝이다. 속보라 예약하지 않고 바로 올린다]
1) cd $draft ; perl publish_folder.pl $today
2) C:\Users\FAMILY\Desktop\블로그\$today 안에서 **이번에 쓴 $($j.번호)번 폴더 하나만 남기고**
   나머지 폴더를 전부 C:\Users\FAMILY\Desktop\블로그\_대기_$today 로 옮긴다.
   **이 단계를 건너뛰면 이미 올린 글이 통째로 다시 올라간다. 반드시 먼저 확인하고 옮겨라.**
   (0_오늘_예약시간표.txt 는 건드리지 않는다)
3) cd $sns ; node src/njob-blog.js $today --now        ← 속보이므로 즉시 발행
4) 끝나면 _대기_$today 안의 폴더를 전부 $today 폴더로 되돌린다. 다음날 분석이 이 폴더를 읽으니 꼭 되돌려라.
5) node src/njob-share-options.mjs --n=3 으로 검색허용·공유가 켜졌는지 확인한다

[절대 하지 마라]
· 이미 발행·예약된 글은 건드리지 않는다 (기본규칙 7-4)
· 오늘 이미 쓴 소재와 겹치는 글은 쓰지 않는다. 겹치면 그만두고 끝내라
· 하루 21편을 넘기지 않는다. $today 폴더의 NN_*.txt 가 이미 21개면 그만둬라
· 비밀번호·키·.env·naver_ad_keys.txt 를 열거나 출력하지 않는다
· 발행된 글을 지우지 않는다

끝나면 한 줄로 보고해라: 파일명 / 제목 / 사진 장수 / 검사기 결과 / 예약 시각.
"@

$promptFile = Join-Path $env:TEMP ("njob_hot_prompt_{0}.txt" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
Set-Content -Path $promptFile -Value $prompt -Encoding utf8

Say 'claude 를 불러 원고를 씁니다 (최대 40분)'
$out = & $claude -p "$prompt" --permission-mode bypassPermissions --add-dir $draft --add-dir $sns 2>&1
$tail = ($out | Select-Object -Last 20) -join "`n"
Say "claude 끝 — $tail"
Remove-Item $promptFile -Force -ErrorAction SilentlyContinue
