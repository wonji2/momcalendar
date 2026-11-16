# ORDER — 무토큰 카드뉴스 파이프라인 (배치 생성 + 스탭 승인 게이트)

작성 2026-11-16 (월) · 자비스 · 기준 커밋 `cacb6d49`(main) 위에 오더·시드 커밋 `2241cec1`으로 올림
대상 저장소 `wonji2/momcalendar` · 작업자 = 클로드 코드
관련 문서 `orders/ORDER_STAFF_CARDNEWS.md`(다운로드 화면 최초 설계), `orders/ORDER_STAFF_CARDNEWS_PROMOTE.md`(staff_test → 라이브 반영)

---

## 실행 명령 (길아 님이 클로드 코드에 붙여넣는 1줄)

```
claude "orders/ORDER_CARDNEWS_PIPELINE.md 읽고 §2~§9 그대로 구현한 뒤 §11 검증 V1~V12 실제로 돌려서 표로 보고해"
```

레포 루트에서 실행한다. 이 오더의 최종 기준 문서는 이 파일 하나다(디자인·캡션·승인 규칙 전부 여기 들어 있음).

## 0. 한 줄 요약

지금은 카드뉴스 1편을 만들 때마다 자비스(AI) 토큰을 쓴다. **앞으로는 저장소 안의 Pillow 렌더러 + GitHub Actions가 토큰 0으로 7~30일치를 미리 뽑아 대기 큐에 쌓고, 길아 님이 스탭 화면에서 미리보기·문구 수정·[승인]을 누른 편만 그날 "오늘의 카드뉴스"로 열린다.** AI API 호출은 파이프라인 어디에도 없다.

이 오더 하나로 끝내야 하는 것:

1. `scripts/cardnews/` 생성 파이프라인(렌더러·배치·당일 DB형·발행) 구현
2. Supabase `cardnews_queue` 테이블 + 상태 전이(`pending → approved → published`) + RLS
3. `cardnews.html`을 **큐 + 승인 게이트** 화면으로 확장(미승인 편은 다운로드·노출 잠금)
4. GitHub Actions 2개(주간 배치 / 당일 DB형·발행)
5. 시드 자산 이관(승인된 실물 렌더러·폰트·배경·큐 시드)
6. §10 검증 체크리스트를 실제 실행하고 결과 보고

**하지 말 것(먼저 읽어라)**: 라이브 `index.html` · `staff.html` 직접 수정 금지(스탭 화면은 `staff_test.html`까지), 미승인 편 게시 금지, 확인되지 않은 금액 창작 금지, 인스타 자동 업로드 금지, 스탭 페이지에 Supabase service key 노출 금지.

---

## 1. 지금 상태와 목표

### 1-1. 이미 되어 있는 것 (건드리지 말고 그대로 위에 얹는다)

| 자산 | 경로 | 상태 |
|---|---|---|
| 오늘(11/16) 카드뉴스 8장 | `daily/cardnews/2026-11-16/01.png~08.png` + `caption.txt` + `comment_tags.txt` + `manifest.json` | 라이브 |
| 최신 날짜 포인터 | `daily/cardnews/latest.json` (`{"latest":"2026-11-16","updated_at":...}`) | 라이브 |
| 다운로드 화면 | `cardnews.html` (3:4 미리보기·8장 전체 저장·캡션 복사·첫 댓글 해시태그 복사, `noindex`) | 라이브 |
| 스탭 탭 | `staff_test.html`의 `📰 카드뉴스` 탭(iframe → `cardnews.html`) | 검증용만 반영됨 |
| 아침 카드 CI | `.github/workflows/daily-card.yml` (07:40 KST, `daily/today.png`·`hotdeal.png`·`sale.png`) | 라이브 — **이 워크플로는 손대지 않는다** |
| 스탭 인증·DB | Supabase `https://hycaqsqeogjtbscmzrtm.supabase.co` — 스탭 로그인(`@staff.momcal`), `gonggu`·`hotdeals`·`experiences` 테이블, `is_app_staff()`·`is_app_admin()` RPC | 라이브 |
| 승인된 렌더러 원본 | 이 커밋의 `scripts/cardnews/_seed/insta_cards.py`, `_seed/render_insta_week1.py` | 참고용 시드 |

### 1-2. 목표

- **7~30일치를 미리 만들어 대기**시킨다(고정 정보형). 실시간성이 필요한 공구·핫딜 편만 당일 아침 생성.
- **토큰 0**: 렌더링은 Pillow(파이썬), 스케줄·커밋은 GitHub Actions. 외부 AI API·LLM 호출 없음.
- **승인 게이트**: `approved`가 아닌 편은 "오늘의 카드뉴스"로 노출되지 않고 전체 저장·캡션 복사도 잠긴다.
- 길아 님의 수정은 **캡션·해시태그·제목·CTA 문구**에서 즉시 반영(이미지 재렌더 없이 DB 값이 우선).

### 1-3. 비목표 (이번에 하지 않는다)

- 인스타 자동 업로드·예약 발행(업로드는 계속 길아 님이 직접, 음악·공동작업자 `@momcal_` 포함)
- AI 이미지 생성, 문장 자동 생성(원고는 사람이 확정한 JSON만 렌더)
- `staff.html`(라이브) 수정 — `staff_test.html`까지만. 라이브 반영은 별도 오더
- 기존 `daily/today.png`·`hotdeal.png`·`sale.png` 체계 변경

---

## 2. 최종 구조

```
scripts/cardnews/
  theme.py               # 색·폰트·타입스케일·여백 상수 (§4 표를 코드로)
  render.py              # Pillow 렌더러 — 표지/속지/엔딩/그리드 4종. _seed/insta_cards.py 이관
  lints.py               # 규칙 자동 검사(금지문자·밀도·사이즈)
  episodes/
    y2026m11.json        # 날짜별 원고(고정 정보형). §5 스키마
    y2026m12.json
  build_batch.py         # 미래 N일치 렌더 → daily/cardnews/<date>/ + 큐 upsert(pending)
  build_today_db.py      # 당일 공구·핫딜 9칸 편(slot='db') → daily/cardnews/<date>/db/
  publish.py             # approved 행만 caption.txt 반영 + latest.json 갱신 + published
  queue.py               # Supabase REST 래퍼(select/upsert/patch, service key는 env로만)
  fonts/                 # Pretendard-{ExtraBold,Bold,Medium}.otf (시드 포함)
  assets/bg/             # 표지 배경 jpg 7장 (시드 포함)
  _seed/                 # 승인된 실물 원본(참고용, 실행 안 함) + README
daily/cardnews/
  2026-11-16/            # 기존 그대로
  2026-11-17/01.png…     # 배치가 만든 편(파일명 규칙 유지: 01.png~NN.png)
  <date>/db/01.png…      # 당일 실시간 DB형(같은 날 두 편 공존)
  queue.json             # 큐 스냅샷(읽기 전용 폴백·시드. 상태 원본은 Supabase)
  latest.json            # 승인·발행된 최신 날짜만 가리킨다
.github/workflows/
  cardnews-batch.yml     # 주 1회 미래 30일 버퍼 채우기
  cardnews-daily.yml     # 매일 06:40 당일 DB형 생성 → 승인분 발행
```

규칙: **파일명·경로는 기존 `daily/cardnews/2026-11-16/` 규격을 그대로 따른다**(`01.png`부터, `manifest.json`, `caption.txt`, `comment_tags.txt`). `cardnews.html`의 기존 로직이 그대로 살아야 한다.

---

## 3. 파이프라인 동작

### 3-1. 고정 정보형(배치) — 주 1회, 미래 30일 버퍼

1. `scripts/cardnews/episodes/*.json`에서 `status:"ready"` 원고만 고른다. `needs_fact_check` 원고는 **렌더하지 않는다**(금액·기한 창작 금지).
2. 대상 날짜의 `daily/cardnews/<date>/manifest.json`이 이미 있으면 건너뛴다(`--force`로만 덮어쓴다).
3. 렌더 → 1080×1440 PNG 세트 + `manifest.json` + `caption.txt` + `comment_tags.txt` + `notion.md`.
4. 큐 upsert: `(date, slot='main')` 행이 없으면 `status='pending', kind='fixed', source='batch'`로 만들고 `slides`·`title`·`caption`·`comment_tags`·`hashtags`·`episode_key`를 채운다. **이미 있는 행의 `status`·`caption`은 절대 덮어쓰지 않는다**(길아 님이 고친 문구 보호). 파일·원고 갱신이 필요하면 별도 컬럼만 patch.
5. `queue.json` 스냅샷을 다시 쓴다(읽기 전용 폴백용).
6. 커밋·푸시(경로: `daily/cardnews/`, `scripts/cardnews/episodes/`).

### 3-2. 실시간 DB형(당일) — 매일 06:40 KST

- 입력: Supabase `gonggu`(`name, influencer, open_date, end_date`) + `hotdeals`(`title, price, price_before, discount_rate, mall, img_url, created_at`).
- 구성(5장): ① 표지(오늘 마감 N건 + 인기 1위) ② **공구·핫딜 9칸 그리드(본인 공구 최우선 4~5칸 + 오늘 인기 핫딜 4~5칸, 개당·팩당 단가 포함)** ③ 마감 임박 TOP5 ④ 왜 지금(브릿지) ⑤ 고정 엔딩.
- 사진: `img_url`을 그대로 쓰되 받은 이미지는 저장소에 커밋하지 않고 런타임 임시폴더에서 합성한다(저작권·용량). 사진 실패 칸은 🛒 자리표시로 대체하고 **3할 넘게 실패하면 그날 DB형은 만들지 않고 종료**(빈 카드 금지).
- 출력 `daily/cardnews/<date>/db/` + 큐 `(date, slot='db', kind='db', status='pending')`.
- 캡션·해시태그는 규칙대로 코드가 조립(§6). 길아 님이 스탭 화면에서 고칠 수 있다.

### 3-3. 발행(게이트 통과분만)

`publish.py`가 하는 일은 세 가지뿐이다.

1. `status='approved'`이고 `date <= 오늘(KST)`인 행을 찾는다.
2. 그 날짜의 `caption.txt`·`comment_tags.txt`·`manifest.json`을 **DB 값으로** 덮어쓴다(스탭이 고친 문구가 파일에도 반영).
3. `daily/cardnews/latest.json`을 `{latest: <가장 최근 approved/published 날짜>, updated_at}` 로 갱신하고 행을 `published`로 올린다.

금지: `pending`·`rejected` 행의 날짜로 `latest.json`을 바꾸지 않는다. 승인 없이 `latest.json`을 손으로 고치지 않는다(길아 님의 유일한 통제선이다).

---

## 4. 디자인 고정 규격 (렌더러가 지켜야 하는 값)

`notes/MOMCAL_INSTA_CARD_RULES.md`의 최종본을 코드로 옮긴다. 시드 `_seed/insta_cards.py`가 이미 이 값을 쓰고 있으니 **그 파일을 기준으로 옮기고, 아래 체크 항목만 보강**하면 된다.

### 4-1. 캔버스·타이포

- **1080×1440 (3:4)**, 사방 안전 여백 **80px**, 좌측 정렬 기준선 `x=80`.
- Pretendard **ExtraBold(800) / Bold(700) / Medium(500)** 3종만. 자간 한글 **-2%**(-0.02em), 영문 로고만 +0.3em.
- 타입 스케일(고정): 표지 헤드라인 120~150px / 표지 리드 52~62px / 기준일 뱃지 26px / 속지 섹션 제목 60~68px / 항목 제목 42~44px / 본문 34~38px / 체크리스트 38~40px / 라벨 박스 26px / 페이지 번호 24~26px / 엔딩 메인 56px.
- 행간: 두 줄 이상 제목 1.05~1.15, 본문 1.35.

### 4-2. 색

- 배경 60 : 텍스트 30 : 포인트 10. 톤다운·파스텔만(원색 금지).
- 메인 퍼플 `#5B2E8C` / 서브 코랄 `#F4795B` / 먹색 `#1A1A1A` / 회색 `#6B6B6B` / 따뜻한 흰 `#FAF8F5`.
- **한 카드에 강조색은 1군데만.** 퍼플·코랄 동시 강조 금지.

### 4-3. 표지(1장) — A 매거진형 / B 순백 타이포형 / C OPEN 알림형

공통:

- 상단 좌측 `M O M C A L   M A G A Z I N E` — 22px, 흰색 90%, 자간 +0.3em, `(80, 72)`.
- **🔴 브랜드 고정 서브 문구 (길아 님 2026-11-16 최종 확정 · 생략 금지)**
  - 문구(그대로): **`공구 · 핫딜 · 세일 · 육아정보 커뮤니티 맘캘린더`**
  - 크기 26px / 700 / 자간 -1% / 위치 `x=80, y=104` (로고 바로 아래)
  - **그림자·테두리·반투명 판 없이 깔끔한 화이트 타이포**로만. 사진형은 흰색 92%, B 순백형은 상단 22%를 톤다운 배경 띠(`#5B2E8C` 8~12% 또는 어두운 톤 그라데이션)로 처리해 흰 글씨를 유지한다(검은 글씨로 바꾸지 않는다).
  - 이 줄은 "표지에 서브 설명 금지" 규칙의 예외다(설명문이 아니라 브랜드 표지판).
- 상단 우측: 기준일 뱃지 `26.11.17 기준` — 26px 700, 알약(반투명 판 + 1px 테두리).
- 하단 좌측: 리드 1줄(52~62px, 흰색 80%) → 후킹 2~3줄(120~150px, **마지막 줄만 포인트색**).
- 금지: 검은 선 테두리(stroke), 90px 미만 헤드라인, 표지에 면책·출처·서브 설명 2~3줄, 이모지, `#`.
- AI 생성·자체 제작 배경이면 출처 표기 없음. 외부 사진을 실제로 쓸 때만 `사진 출처 Pinterest` / `사진 출처 @셀러` 22px 1줄.

### 4-4. 속지(2~5장) — 🔴 밀도 규칙 포함 (이번 오더의 핵심 지적사항)

길아 님 지적: **"속지 하단이 비어 보인다"**. 아래를 렌더러 assert로 강제한다.

- 장당 **5~6개 항목** 기본. 항목이 3~4개로 끝나면 ① 항목 수를 늘리고 ② 각 항목 설명을 1줄→2줄로 보강하고 ③ 표·랭킹 행을 추가한다. 여백으로 때우지 않는다.
- 본문 블록의 **마지막 항목 baseline은 y=1,170~1,240px(카드 높이의 81~86%)** 사이에서 끝난다. 즉 세로 **80~85% 이상**을 정보로 채운다.
- 그 아래에 `기준일 1줄`(24px, 회색 55%)과 `페이지 번호 n/N`(24px, 회색 60%)만 남긴다. 이 둘을 뺀 하단 공백이 **120px를 넘으면 실패**.
- 렌더 후 `lints.check_density()`가 카드별 내용 bbox 하단을 측정한다:
  - `bottom < 1150` → **실패**(exit 2, 어느 카드인지 출력) — 재구성 후 다시 렌더
  - `1150 ≤ bottom < 1170` → 경고 로그
  - `bottom > 1330` → 넘침 실패(하단 여백 침범)
- 속지 구조: 상단 좌측 라벨 박스 `1 · 한 단어 반응`(26px, 톤다운 배경 + 1px 테두리) → 섹션 제목 60~68px 1줄 → 항목들 → 필요 시 브릿지 1줄(`오늘 이 가격은 여기서 →`).
- 항목 표현: `제목(42px 700) + 우측 값(42px 800 포인트색) + 설명 2줄(34px 회색)` 또는 `✔ 체크리스트(38~40px, ✔는 먹색 단색, 금액·기한만 포인트색)` 또는 `랭킹(순번 40px 포인트 + 이름 38px + 가격 38px 800)`.
- 아이콘은 1.5px 단색 선만. 이모지 금지(`✔`만 허용), `#` 금지.

### 4-5. 고정 엔딩(마지막 장) — 전 편 공통, 생략 금지

순백(`#FFFFFF`) 중앙 정렬: 미니 아이콘 → `육아맘이 매일 1분 만에 챙기는` → `공구 · 세일 · 육아 정보` → 1px 구분선(폭 120px) → `M O M C A L   M A G A Z I N E` → `저장해두면 이번 주에 또 꺼내 보실 수 있어요` → 검은 알약 버튼 **`@momcal_official >`** → `팔로우하고 다음 정보도 받아가세요 :)`

### 4-6. 하지 않는 것

2px 이상 테두리, 6px 이상 그림자, 3색 그라데이션, 폰트 4종 이상, 카드당 강조 2군데, 카드 안 이모지·별표 볼드·`#`, 확인 안 된 금액·기간·순위, 없는 출처 만들기, 표지 검은 선 테두리.

---

## 5. 원고 JSON 스키마 (`scripts/cardnews/episodes/*.json`)

```json
{
  "schema_version": 1,
  "month": "2026-11",
  "episodes": [
    {
      "key": "2026-11-17",
      "episode_key": "day2_tue",
      "kind": "fixed",
      "status": "ready",
      "cover": {
        "type": "photo",
        "bg": "assets/bg/daycare.jpg",
        "lead": "3월 입소 생각 중이면",
        "hook": ["지금 대기 안 걸면", "봄에 못 들어가요"],
        "accent": "coral"
      },
      "badge": "26.11.17 기준",
      "brand_line": "공구 · 핫딜 · 세일 · 육아정보 커뮤니티 맘캘린더",
      "cards": [
        {
          "label": "1 · 언제 걸까",
          "title": "출생신고 직후가 시작이에요",
          "accent": "purple",
          "rows": [
            {"t": "check", "text": "출생신고 직후 주민번호 나오면 바로 대기", "value": "출생 직후"},
            {"t": "kv", "head": "맞벌이 200점", "desc": ["부부 모두 재직·사업자·휴직 증빙 시 1순위"], "value": "1순위"}
          ],
          "note": "지역·원마다 신학기 반 편성 시기가 달라 공고 확인이 먼저예요.",
          "bridge": "동점이면 신청한 순서대로 들어가요 →"
        }
      ],
      "caption": "[ 공유/저장 필수 ] …",
      "hashtags": "#맘캘정보 #어린이집대기 #육아정보 #시간제보육 #육아꿀팁",
      "comment_tags": "#어린이집 #… (정확히 20개)",
      "cta": {"type": "comment_dm", "keyword": "얼집", "line": "댓글에 「얼집」 남겨주시면 …"},
      "facts": {"verified": "2026-11-16", "sources": ["아이사랑", "지자체 보육포털"]}
    }
  ]
}
```

- `cards[]` 마지막에 엔딩을 넣지 않는다(렌더러가 자동 추가).
- `status`: `ready`(렌더 대상) / `needs_fact_check`(렌더 금지, 스탭 화면에 "검증 필요"로만 표시) / `hold`.
- `kind`: `fixed`(배치) / `db`(당일 생성, 원고 JSON에는 넣지 않는다).
- 표지 `brand_line`은 **§4-3의 고정 문구를 그대로** 쓴다(원고에서 바꾸지 않는다. 렌더러가 상수로 강제해도 된다).
- 원고에 금액·기한이 들어가면 `facts.sources`가 비어 있으면 안 된다(비면 렌더 거부).

---

## 6. 캡션 · 해시태그 · CTA · 노션 정리본 규격

### 6-1. 캡션 (인스타 본문)

- 첫 줄 **`[ 공유/저장 필수 ]`** 로 시작(대괄호형 고정, `‼️` 변형 금지).
- 3~6덩어리, 덩어리 사이 빈 줄. **별표 볼드(`**`) 금지, 구분선(`---`) 금지**(인스타에서 기계적으로 보임).
- 핵심은 **`✔` 체크리스트 5~8줄**, 각 줄에 금액 또는 기한.
- **CTA는 1편에 정확히 1개** — 저장 / 맞춤 공유·태그 / 댓글 DM 중 하나.
- 해시태그 **정확히 5개**: `#맘캘정보` 1개 고정 + 주제 키워드 4개. 본문 맨 끝 1줄.
- 마지막에 기준일 1줄: `※ 26.11.17 기준, 아이사랑·복지로 안내 확인` (긴 면책문 금지).
- 공동 작업자 안내: **캡션 본문에는 넣지 않는다.** 업로드 시 인스타에서 `@momcal_`를 공동 작업자로 추가한다는 사실은 카드뉴스 화면 안내문(§7-4)과 스탭 화면 체크리스트에 표시한다.
- 톤: 친근한 구어체(`~예요`, `~하세요`), 과장 없이 담백하게. 별표·구분선·이모지 남발 금지(이모지는 0~2개).

### 6-2. 첫 댓글 해시태그 (`comment_tags.txt`)

- **정확히 20개**, 공백 구분 1줄. `#맘캘린더` 포함. 본문 5개와 중복돼도 된다(첫 댓글은 검색 유입용).
- 렌더 시 `lints.check_tags()`가 개수 20·`#` 형식·중복 없음을 검사.

### 6-3. 노션 정리본 (`notion.md`)

- 구조: 인사 1줄 → `💡 맘캘 결론부터` 콜아웃 2줄 → 이모지 섹션 제목 + `A/B/C` 상황 갈래(`👉`로 결론) → 누가/언제/얼마나/어떻게 1줄씩 → `⚠️` 함정 콜아웃 → 신청 포털 링크(아이사랑·복지로·고용24 등 실제 링크) → 고정 푸터.
- 푸터는 **한 줄씩 공백**:

```
오늘 최저가 육아 공구·핫딜 모음 & 맘캘린더 바로가기

인스타그램 (@momcal_official) : https://www.instagram.com/momcal_official/

맘캘린더 웹사이트 : https://momcalendar.com

안드로이드 앱 다운로드 : https://play.google.com/store/apps/details?id=com.wantsb.momcalendar

아이폰 앱 다운로드 : https://apps.apple.com/kr/app/id6826126083
```

- 레퍼런스 문장 복사 금지. 공식 기준 + 맘캘 톤으로 재작성.

---

## 7. 승인 워크플로우 (이게 이번 작업의 심장)

### 7-1. 데이터 모델 — Supabase `public.cardnews_queue`

```sql
create table if not exists public.cardnews_queue (
  id            bigint generated always as identity primary key,
  date          date        not null,
  slot          text        not null default 'main',   -- 'main'(고정 정보형) | 'db'(당일 실시간)
  kind          text        not null default 'fixed',  -- 'fixed' | 'db'
  status        text        not null default 'pending',-- pending | approved | published | rejected
  title         text,
  subtitle      text,
  cta_type      text,
  episode_key   text,
  slides        jsonb       not null default '[]'::jsonb, -- ["01.png","02.png",...]  daily/cardnews/<date>/[db/] 기준 상대경로
  caption       text,
  comment_tags  text,
  hashtags      text,
  notion_md     text,
  source        text not null default 'batch',          -- 'batch' | 'db' | 'manual'
  meta          jsonb       not null default '{}'::jsonb,-- 밀도 측정값·렌더 버전 등
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text,
  approved_at   timestamptz,
  published_at  timestamptz,
  unique (date, slot)
);
create index if not exists cardnews_queue_date_idx on public.cardnews_queue (date);

alter table public.cardnews_queue enable row level security;

-- 스탭·관리자만 읽고 고친다 (기존 is_app_staff/is_app_admin 재사용)
create policy cnq_staff_read   on public.cardnews_queue for select to authenticated using (public.is_app_staff() or public.is_app_admin());
create policy cnq_staff_write  on public.cardnews_queue for update to authenticated using (public.is_app_staff() or public.is_app_admin()) with check (public.is_app_staff() or public.is_app_admin());
-- 파이프라인(서비스 키)은 RLS 우회 → 별도 정책 불필요
```

- **anon 키로는 절대 쓰지 못하게** 한다(정책에 anon 없음).
- 앱(손님) 쪽에서 이 테이블을 읽을 일은 없다. `cardnews.html`은 스탭 로그인 세션을 써서 읽는다 → 로그인 전에는 `queue.json` 폴백만 보인다(승인 버튼 숨김).

### 7-2. 상태 전이

```
(batch/db 생성) ─▶ pending ──[승인]──▶ approved ──[publish.py]──▶ published
                      │                    ▲                         │
                      └──[반려]──▶ rejected └──[승인 취소]◀──────────┘(오늘 것만 취소 가능)
```

- `approved`가 되면 `approved_at`, `updated_by`를 기록.
- `approved → pending` 되돌리기는 **오늘·내일 날짜만** 허용(이미 인스타에 올린 과거 편은 `published` 고정, 수정 금지).
- `rejected`는 다시 `pending`으로 되돌릴 수 있다(재검토).

### 7-3. REST 호출 규격 (스탭 페이지)

기존 `staff_test.html`의 `sbHeaders()`·`ACCESS_TOKEN` 체계를 그대로 쓴다.

```
GET    /rest/v1/cardnews_queue?select=*&date=gte.2026-11-16&date=lte.2026-11-30&order=date.asc,slot.asc
PATCH  /rest/v1/cardnews_queue?date=eq.2026-11-17&slot=eq.main
       body: {"status":"approved","caption":"…","comment_tags":"…","hashtags":"…","title":"…","updated_by":"<staff id>"}
```

- PATCH에는 항상 `updated_at: now()` 상당 값을 넣고, `Prefer: return=representation`으로 결과를 받아 화면을 갱신.
- 실패 시 토스트로 사유 표시(권한·네트워크). **낙관적 UI로 상태를 먼저 바꾸지 않는다**(실패가 숨는다).

### 7-4. 화면(`cardnews.html`) 확장안

기존 화면(상단바·히어로·전체 저장·캡션 복사·3:4 그리드·줌·날짜 선택)을 유지하고 위에 두 모드를 얹는다.

**모드 탭**: `[ 오늘 ]` `[ 대기 큐 ]`

1. **오늘 모드** (기본, 지금과 같은 화면)
   - 오늘 날짜의 `main`(있으면 `db`도 토글) 행을 DB에서 먼저 조회 → `approved`/`published`면 지금처럼 전체 저장·캡션 복사 활성.
   - `pending`이면 카드 위에 회색 띠 **`미승인 편입니다 — 승인 전에는 저장·복사가 잠깁니다`** + 버튼 `disabled` + 미리보기는 허용.
   - 행이 없으면 `manifest.json` 폴백, 그것도 없으면 "오늘 카드뉴스 준비 중".
   - 승인된 편이 하나도 없으면 DB형 → 없으면 가장 최근 승인 편을 보여주되 **제목에 날짜를 명시**.
2. **대기 큐 모드**
   - 이번 주 + 다음 주 목록을 날짜/요일/상태 배지(`대기`·`승인`·`발행`·`반려`)·제목·CTA로 리스트.
   - 행을 누르면 상세: ① 카드 3:4 썸네일 그리드(승인 전에도 미리보기 가능) ② **캡션 textarea**(DB 값 수정 가능) ③ 해시태그 5개 입력 ④ 첫 댓글 20개 입력 ⑤ 제목·CTA 문구 입력 ⑥ 버튼 `[ 임시 저장 ]` `[ 승인 ]` `[ 반려 ]`(승인된 편은 `[ 승인 취소 ]`).
   - 저장·승인 후 목록으로 돌아가며 상태 배지가 즉시 갱신된다. 토스트 문구: `저장했어요`, `승인했어요 — 오늘부터 저장·복사가 열립니다`.
   - 상단에 **업로드 체크리스트** 1줄: `인스타 업로드 시 공동 작업자 @momcal_ 추가 · 노래 넣기 · 첫 댓글 해시태그 20개`.
   - 프리필: `notion.md`가 있으면 `[ 노션 정리본 복사 ]` 버튼도 제공(승인 후 활성).

**모바일 우선**(갤럭시 Z 플립7 세로 화면): 큐 리스트는 1열 카드, 상세는 세로 스택, 저장/승인 버튼은 하단 고정 바, 가로 스크롤 금지. 기존 CSS 토큰(`--p`, `--bd`, 14px 라운드) 유지.

**staff_test.html**: 지금의 iframe 탭 그대로 두고, `mountNews()`에 `?mode=queue`로 바로 열리는 보조 링크 1개만 추가(선택). 라이브 `staff.html`은 **손대지 않는다**.

### 7-5. 게이트 규칙(요약)

| 상태 | 카드 미리보기 | 전체 저장·개별 저장 | 캡션·태그 복사 | "오늘의 카드뉴스" 노출 | `latest.json` |
|---|---|---|---|---|---|
| pending | O(워터마크) | ✕ | ✕ | ✕ | ✕ |
| approved | O | O | O | **O** | **O** |
| published | O | O | O | O | O |
| rejected | O | ✕ | ✕ | ✕ | ✕ |

- 게이트는 화면에서 강제하고, 파일 단위 1차 방어는 `publish.py`가 `latest.json`을 approved만 가리키게 하는 것. 승인 없이 `latest.json`을 고치면 **오더 위반**이다.
- PNG 파일 자체는 공개 URL을 알면 열린다(저장소가 공개·Pages 호스팅). 이건 실수 방지 게이트이고, 완전 차단이 필요하면 2단계로 pending 이미지를 별도 브랜치(`cardnews-staging`)에만 두는 방식으로 확장한다(이번 범위 아님).

---

## 8. GitHub Actions (무토큰)

두 파일을 새로 만든다. 기존 `daily-card.yml`·`hotdeal-cloud.yml` 등은 건드리지 않는다.

### 8-1. `.github/workflows/cardnews-batch.yml`

```yaml
name: 카드뉴스 배치 (30일 버퍼)
on:
  schedule:
    - cron: '10 18 * * 6'      # 토 18:10 UTC = 일 03:10 KST
  workflow_dispatch:
    inputs:
      days:  { description: '며칠치 (기본 30)', required: false, default: '30' }
      start: { description: '시작 날짜 YYYY-MM-DD (비우면 내일)', required: false }
permissions: { contents: write }
concurrency: { group: cardnews-batch, cancel-in-progress: false }
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install pillow requests
      - name: 배치 렌더
        env:
          SUPABASE_URL: https://hycaqsqeogjtbscmzrtm.supabase.co
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          DAYS: ${{ github.event.inputs.days || '30' }}
          START: ${{ github.event.inputs.start }}
        run: python3 -m scripts.cardnews.build_batch --days "$DAYS" ${START:+--start "$START"}
      - name: 커밋
        run: |
          git config user.name  "momcal-bot"
          git config user.email "noreply@momcalendar.com"
          git add daily/cardnews scripts/cardnews/episodes
          git diff --cached --quiet && echo "바뀐 것 없음" || { git commit -m "카드뉴스 배치 ($(TZ=Asia/Seoul date '+%Y-%m-%d'))"; git push; }
```

### 8-2. `.github/workflows/cardnews-daily.yml`

```yaml
name: 카드뉴스 당일(DB형) + 승인분 발행
on:
  schedule:
    - cron: '40 21 * * *'      # 21:40 UTC = 06:40 KST
  workflow_dispatch:
permissions: { contents: write }
concurrency: { group: cardnews-daily, cancel-in-progress: false }
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install pillow requests
      - name: 당일 DB형 생성
        continue-on-error: true
        env:
          SUPABASE_URL: https://hycaqsqeogjtbscmzrtm.supabase.co
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: python3 -m scripts.cardnews.build_today_db
      - name: 승인분 발행
        env:
          SUPABASE_URL: https://hycaqsqeogjtbscmzrtm.supabase.co
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: python3 -m scripts.cardnews.publish
      - name: 커밋
        run: |
          git config user.name  "momcal-bot"
          git config user.email "noreply@momcalendar.com"
          git add daily/cardnews
          git diff --cached --quiet && echo "바뀐 것 없음" || { git commit -m "카드뉴스 $(TZ=Asia/Seoul date '+%Y-%m-%d') (DB형·발행)"; git push; }
```

- 비밀키는 **`secrets.SUPABASE_SERVICE_KEY`**(이미 다른 워크플로가 쓰는 이름)만. 스탭 페이지에는 publishable 키만.
- 실패는 `::error::`로 남기고, DB형 실패가 발행 단계를 막지 않게 `continue-on-error`.

---

## 9. 시드 자산 (이 커밋에 이미 들어 있음)

| 파일 | 용도 |
|---|---|
| `scripts/cardnews/_seed/insta_cards.py` | **승인된 실물 렌더러**(11/16 8장을 만든 그 코드). `theme.py` + `render.py`로 옮겨 적는다. 시드 경로는 `scratchpad/…` 기준이므로 `scripts/cardnews/fonts`, `assets/bg`로 바꾼다. |
| `scripts/cardnews/_seed/render_insta_week1.py` | 11/16~11/22 7편 원고+캡션 실물. `episodes/y2026m11.json`으로 옮길 때 **문장을 그대로** 쓴다(이미 길아 님 톤 승인분). 11/16(월)은 이미 발행됨 → `status:"published"`, 렌더 제외. |
| `scripts/cardnews/fonts/Pretendard-*.otf` | CI 렌더용(외부 다운로드 의존 제거) |
| `scripts/cardnews/assets/bg/*.jpg` | 표지 배경 7장(자체 제작 → 출처 표기 없음) |
| `daily/cardnews/queue.json` | 큐 스냅샷 시드(11/16 published + 11/17~11/22 pending) — Supabase 미연결 시 폴백·개발용 |

시드 `_seed/` 폴더는 실행 대상이 아니다(참고·이관 원본). 옮긴 뒤 README 한 줄로 "이관 완료 · 원본 보존" 표시.

---

## 10. 30일 콘텐츠 플랜 (주기 고정)

주간 리듬: **월=돈/지원금 · 화=절차·기한 · 수=제도·혜택 · 목=준비물·체크리스트 · 금=공구 DB · 토=공구 캘린더 DB · 일=핫딜 DB**

| 날짜 | 요일 | 주제 | 표지 후킹(2줄) | CTA | 검증 |
|---|---|---|---|---|---|
| 11/17 | 화 | 어린이집 입소대기 | 지금 대기 안 걸면 / 봄에 못 들어가요 | 댓글DM 「얼집」 | ✅ 완료 |
| 11/18 | 수 | 시간제보육 | 어린이집 안 보내도 OK / 시간당 2,000원 보육 | 댓글DM 「보육」 | ✅ 완료 |
| 11/19 | 목 | 첫 등원 준비물 8 | 엄마들이 꼭 빠뜨리는 / 첫날 준비물 8가지 | 댓글DM 「준비물」 | ✅ 완료 |
| 11/20 | 금 | 공구 마감 TOP5 | 오늘 밤 12시면 끝나요 / 마감 임박 공구 TOP 5 | 공유 | DB형 |
| 11/21 | 토 | 11월 공구 캘린더 | 날짜별로 딱 정리한 / 11월 공구 캘린더 | 저장 | DB형 |
| 11/22 | 일 | 오늘 핫딜 TOP5 | 지금 바로 담아야 할 / 오늘 핫딜 TOP 5 | 댓글DM 「핫딜」 | DB형 |
| 11/23 | 월 | 육아휴직 급여·6+6 | 똑같이 써도 받는 돈이 / 다릅니다 | 댓글DM 「육아휴직」 | ⚠️ 고용노동부 확인 |
| 11/24 | 화 | 어린이집 상담 질문 7 | 상담 가서 뭘 물어볼까요 / 이건 꼭 물어보세요 | 저장 | 에버그린 |
| 11/25 | 수 | 부모급여·아동수당 기한 | 지나면 소급 안 됩니다 / 신청 기한 정리 | 댓글DM 「수당」 | ⚠️ 복지로 확인 |
| 11/26 | 목 | 이유식 시작 체크 | 첫 이유식 전에 / 이건 확인하세요 | 저장 | 에버그린 |
| 11/27 | 금 | 공구 마감 TOP5 | 이번 주 마지막 기회 / 마감 임박 5개 | 공유 | DB형 |
| 11/28 | 토 | 이번 주 공구 캘린더 | 이번 주 공구 / 날짜만 외우세요 | 저장 | DB형 |
| 11/29 | 일 | 오늘 할인율 TOP5 | 오늘 제일 많이 내려간 / 생활템 5개 | 댓글DM 「핫딜」 | DB형 |
| 11/30 | 월 | 연말정산 자녀 공제 | 12월에 준비 안 하면 / 1월에 못 받아요 | 저장 | ⚠️ 국세청 확인 |
| 12/01 | 화 | 겨울 실내놀이 10 | 추운 날 집에서 / 이거 해주세요 | 저장 | 에버그린 |
| 12/02 | 수 | 유치원 우선모집 일정 | 우리 집 해당되나요 / 우선모집 일정 총정리 | 댓글DM 「유치원」 | ⚠️ 교육청 확인 |
| 12/03 | 목 | 아기 목욕·보습 순서 | 목욕 후 3분 안에 / 이렇게 하세요 | 저장 | 에버그린 |
| 12/04 | 금 | 공구 마감 TOP5 | 오늘 자정 마감 / 많이 본 5개 | 공유 | DB형 |
| 12/05 | 토 | 12월 공구 캘린더 | 12월 공구 일정 / 한 장에 정리 | 저장 | DB형 |
| 12/06 | 일 | 주말 특가 TOP5 | 주말에만 이 가격 / 지금이 최저 | 댓글DM 「핫딜」 | DB형 |
| 12/07 | 월 | 영유아 건강검진 시기 | 안 받으면 과태료? / 검진 시기 정리 | 댓글DM 「검진」 | ⚠️ 건보공단 확인 |
| 12/08 | 화 | 입소 첫 달 적응 | 울면서 들어가도 / 괜찮을까요 | 저장 | 에버그린 |
| 12/09 | 수 | 산모·산후 지원 | 출산하고 나서도 / 받을 게 있어요 | 댓글DM 「산후」 | ⚠️ 지자체 확인 |
| 12/10 | 목 | 겨울 아기 상비템 | 이거 없으면 밤에 / 병원 갑니다 | 저장 | 에버그린 |
| 12/11 | 금 | 공구 마감 TOP5 | 이번 주 마감 / 놓치면 2주 뒤 | 공유 | DB형 |
| 12/12 | 토 | 주말 공구 캘린더 | 주말에 열리는 / 공구만 모았어요 | 저장 | DB형 |
| 12/13 | 일 | 오늘 최저가 TOP5 | 제값 주고 사지 마세요 / 오늘 최저 5개 | 댓글DM 「핫딜」 | DB형 |
| 12/14 | 월 | 예방접종 일정 | 시기 놓치면 / 다시 맞아야 해요 | 저장 | ⚠️ 질병청 확인 |
| 12/15 | 화 | 크리스마스 아이와 갈 곳 | 예약 안 하면 못 가요 / 아이랑 갈 곳 | 저장 | ⚠️ 지자체 행사 확인 |
| 12/16 | 수 | 아기 옷 사이즈 | 90 사면 안 되는 이유 / 개월별 사이즈 | 저장 | 에버그린 |

- ⚠️ 표시 원고는 `status:"needs_fact_check"`로 두고 **렌더하지 않는다**. 자비스/길아 님이 확인해 `ready`로 바꾸면 다음 배치에서 자동 렌더된다.
- 이 표 기준으로 **바로 렌더 가능한 날이 22일**이다: 고정 정보형 10편(✅ 3 + 에버그린 7) + DB형 12일. 나머지 **8일(⚠️)은 사실 확인 후 `ready`로 바꾸면 다음 배치가 자동으로 채운다.**
- 즉 **첫 배치에서 1주(11/17~11/22)는 빈틈없이**, 같은 실행에서 30일 버퍼 중 22일이 채워진다. ⚠️ 8편은 자비스/길아 님이 출처를 확인해 문구를 확정한다(금액 창작 금지).
- 이미지가 필요한 표지 배경은 `assets/bg/`의 7장을 돌려 쓴다(주제별 1장 고정 매핑).

---

## 11. 검증 (직접 실행하고 결과를 표로 보고)

| # | 검증 | 방법 | 통과 기준 |
|---|---|---|---|
| V1 | 7일치 큐 조회 | `build_batch --days 30` 실행 후 `cardnews.html?mode=queue` (스탭 로그인) | 11/17~11/23 목록이 상태 배지와 함께 뜬다 |
| V2 | 캡션 수정 → 승인 | 11/17 행 캡션 한 줄 수정 → `[승인]` | DB `status='approved'`, `updated_by` 기록, 목록 배지 즉시 변경 |
| V3 | 승인 전 잠금 | 승인 전 상태에서 저장·복사 버튼 | `disabled` + 미승인 띠 노출, 눌러도 아무 일 없음 |
| V4 | 승인 후 발행 | `publish.py` 실행 | `caption.txt`가 수정 문구로 바뀌고 `latest.json`이 11/17을 가리킴, 행 `published` |
| V5 | 미승인 편 비노출 | 11/18을 pending으로 둔 채 `latest.json` | 11/18이 절대 가리키지 않는다 |
| V6 | 이미지 규격 | `identify`/PIL로 각 PNG | 전 장 1080×1440, 3:4, 잘림 없음(모서리 픽셀 확인) |
| V7 | 금지 문자 | `lints.py` | 캡션에 `**`·`---` 0건, 카드 텍스트 이모지 0건(`✔` 제외), `#` 0건 |
| V8 | 해시태그 | `lints.py` | 본문 5개, 첫 댓글 20개 |
| V9 | **속지 밀도** | `lints.check_density()` | 모든 속지 내용 bbox 하단 ∈ [1150, 1330], 위반 0건 |
| V10 | **표지 브랜드 문구** | 11/17 표지 OCR/육안 | `공구 · 핫딜 · 세일 · 육아정보 커뮤니티 맘캘린더`가 26px 화이트·그림자/테두리 없이 보인다 |
| V11 | 무토큰 | 워크플로·스크립트 grep | `openai|anthropic|claude|gemini` API 호출 0건, 렌더 입력은 JSON·DB뿐 |
| V12 | 라이브 보존 | `git diff --stat` | `index.html`·`staff.html`·`daily/today.png` 등 무변경 |

검증 후 보고 형식:

```
V1~V12: 통과/실패 표
생성 편수: N편 (fixed N / db N), 평균 렌더 시간
밀도 측정값: 카드별 bottom px 목록(최소/최대)
추가/변경 파일 목록 + 커밋 해시
남은 리스크: (예: 12/15 행사 정보 미확인)
```

---

## 12. 하지 말 것 (위반 시 즉시 되돌리고 보고)

1. 라이브 `index.html`·`staff.html` 직접 수정. (`staff_test.html`까지만)
2. 승인 없이 `latest.json` 변경, `pending` 편을 "오늘의 카드뉴스"로 노출.
3. 금액·기한·순위 창작. `facts.sources` 없는 원고 렌더.
4. 스탭 페이지·커밋에 Supabase **service key** 노출(publishable 키만).
5. AI API 호출 추가, 이미지 생성 API 사용.
6. 인스타 자동 업로드·예약 발행 붙이기.
7. 기존 `daily/cardnews/2026-11-16/` 8장·`cardnews.html` 기존 기능 삭제(확장만).
8. `cardnews_queue` RLS 끄기, anon 쓰기 허용.

## 13. 되돌리기

- 파이프라인만 끄기: `cardnews-batch.yml`·`cardnews-daily.yml`의 `on:`을 `workflow_dispatch`만 남긴다.
- 게이트 문제 시: `cardnews.html`을 이 커밋 이전 버전으로 되돌리고 `queue.json` fallback만 남긴다(기존 8장 다운로드는 계속 동작).
- DB: `cardnews_queue` 테이블은 남겨두고 `status`를 모두 `pending`으로 되돌린다(데이터 삭제 금지).
