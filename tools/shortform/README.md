# 숏폼 자동화 — 도우인·샤오홍슈 → 한국어 릴스/쇼츠

공유문구를 붙여 넣으면 아래 순서로 끝까지 돌아갑니다.

1. **다운로드**: 워터마크 없는 원본 영상이나 이미지를 받습니다 (`download.mjs`).
2. **음성인식**: 중국어 음성을 자막 구간으로 뽑습니다. 로컬 faster-whisper를 쓰므로 비용이 들지 않습니다 (`transcribe.py`).
3. **현지화**: Claude가 한국어 후킹 제목, 자막, 캡션, 해시태그를 만듭니다 (`script.mjs`).
4. **렌더**: 1080x1920 30fps mp4로 만듭니다. 뒤 배경은 같은 화면을 흐리게 깔고, 위에 후킹 제목, 아래에 한국어 자막을 넣습니다. 원본의 중국어 자막 자리는 흐리게 가릴 수 있고, 원본 메타데이터는 지웁니다 (`render.mjs`).

## 설치 (한 번)

```bash
# ffmpeg (윈도우)
winget install Gyan.FFmpeg
# Claude SDK — package.json 은 .gitignore 라 --no-save 로 받는다
npm i --prefix tools/shortform --no-save --no-package-lock @anthropic-ai/sdk
# 음성인식 (선택)
pip install faster-whisper
# 다운로드가 막힐 때의 예비 수단 (선택)
pip install yt-dlp
```

`ANTHROPIC_API_KEY` 환경변수를 넣어 주세요. 키가 없으면 `--no-ai` 옵션으로 돌리고 후킹 제목은 `--hook`으로 직접 줍니다.

## 쓰는 법

```bash
# 공유문구를 통째로 붙여 넣어도 링크만 골라 씁니다
node tools/shortform/run.mjs "7.43 复制打开抖音，看看【…】 https://v.douyin.com/iABCdef/ …"

# 여러 개 한 번에: 한 줄에 하나 (# 으로 시작하는 줄은 무시)
node tools/shortform/run.mjs --file=scratchpad/shortform/queue.txt --mask=0.78,0.12 --max=60
```

결과물은 `scratchpad/shortform/<플랫폼>_<id>/` 에 생기고, 이번 실행 목록은 `scratchpad/shortform/결과.md` 에 남습니다.

| 파일 | 내용 |
|---|---|
| `source.mp4` / `img_01.jpg…` | 원본 (워터마크 없음) |
| `meta.json` | 제목·설명·작성자·태그 |
| `segments.json` | 중국어 음성인식 구간 |
| `ko.json` | 후킹·자막·캡션·해시태그 |
| `final.mp4` | **업로드용 완성본** |
| `caption.txt` | **업로드할 때 붙여 넣을 캡션** (원작자 표기가 들어 있음) |

단계별로 따로 돌릴 수도 있습니다.

```bash
node tools/shortform/download.mjs "<링크>"
python tools/shortform/transcribe.py <폴더>/source.mp4 <폴더>/segments.json small
node tools/shortform/script.mjs <폴더> --tone="육아맘 친근한 말투"
node tools/shortform/render.mjs <폴더> --hook="첫줄\n둘째줄" --mask=0.78,0.12
```

### 옵션

| 옵션 | 뜻 |
|---|---|
| `--mask=0.78,0.12` | 원본 화면 세로 78% 지점부터 12% 높이를 흐리게 처리합니다. 원본에 박힌 중국어 자막을 가릴 때 씁니다 |
| `--max=60` | 최대 길이(초) |
| `--sec=2.5` | 이미지 슬라이드 한 장당 초 |
| `--bgm=음악.mp3` | 이미지 슬라이드 배경음 (없으면 무음) |
| `--hook="…"` | 후킹 제목을 직접 지정 (`\n`으로 줄바꿈) |
| `--tone="…"` | 자막·캡션 말투 |
| `--font="…"` | 글꼴 (윈도우는 맑은 고딕이 기본) |
| `--no-ai` / `--no-whisper` | Claude나 음성인식을 건너뜁니다 |
| `--force` | 이미 만든 결과도 다시 만듭니다 |

## 막혔을 때

- **샤오홍슈가 "데이터를 못 찾았습니다"를 띄울 때**: 로그인이 필요한 경우입니다. 브라우저에서 샤오홍슈에 로그인한 뒤 개발자도구 → Application → Cookies에서 값을 복사해 `XHS_COOKIE="a1=…; web_session=…"` 로 넣어 주세요.
- **도우인이 빈 페이지를 줄 때**: 마찬가지로 `DOUYIN_COOKIE` 를 넣어 주세요.
- **두 사이트 모두 페이지 구조가 자주 바뀝니다.** 파싱이 실패하면 yt-dlp가 깔려 있을 때 자동으로 yt-dlp로 다시 시도합니다. 파서는 `lib/extract.mjs` 한 곳에 모여 있고, 테스트는 `node --test tools/shortform/test/*.test.mjs` 로 돌립니다.

## 🔴 저작권

받은 영상은 원작자의 저작물입니다. 번역 자막만 입혀 그대로 다시 올리면 저작권 침해가 될 수 있고, 인스타·유튜브의 "독창적이지 않은 콘텐츠" 정책에 걸려 도달이 줄거나 계정이 제재될 수 있습니다.

- 허락을 받았거나 2차 창작으로 인정될 만큼 직접 편집한 경우에만 올려 주세요.
- 캡션에 원작자 표기를 자동으로 넣지만, 원작자 표기가 허락을 대신하지는 않습니다.
