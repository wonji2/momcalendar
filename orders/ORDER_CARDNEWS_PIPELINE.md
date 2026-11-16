# ORDER — 무토큰 카드뉴스 파이프라인 + 인스타·스레드 자동 발행 (배치 생성 → 스탭 승인 → 자동 업로드)

작성 2026-11-16 (월) · 자비스
**개정 2판 2026-11-16 17:34 KST — 인스타그램(@momcal_official)·스레드 자동 발행을 이 오더 안으로 편입. 1판의 "인스타 자동 업로드 금지"는 폐기한다.**
기준 커밋 `1398125f`(main) · 대상 저장소 `wonji2/momcalendar` · 작업자 = 클로드 코드
관련 문서 `orders/ORDER_STAFF_CARDNEWS.md`(다운로드 화면 최초 설계), `orders/ORDER_STAFF_CARDNEWS_PROMOTE.md`(staff_test → 라이브 반영)

---

## 실행 명령 (길아 님이 클로드 코드에 붙여넣는 1줄)

```
claude "orders/ORDER_CARDNEWS_PIPELINE.md 읽고 §2~§9 그대로 구현하고 §10 시드 이관한 뒤 §12 검증 V1~V22 실제로 돌려서 표로 보고해. 인스타·스레드 토큰이 없으면 실발행 없이 dry-run·lint·토큰점검까지만 하고 어디서 멈췄는지 1줄로 알려줘"
```

레포 루트에서 실행한다. 이 오더의 최종 기준 문서는 이 파일 하나다(디자인·캡션·승인·발행 규칙 전부 여기 들어 있음).

### 이번 개정(2판)에서 달라진 것 — 1판과 다르면 이쪽이 이긴다

| 항목 | 1판 | **2판(이 문서)** |
|---|---|---|
| 인스타 자동 업로드 | 비목표(금지) | **목표** — Graph API 자동 발행(§8) |
| 스레드 | 수동 | **목표** — Threads API 자동 발행(§8-6) |
| 첫 댓글 해시태그 20개 | 브라우저 수동/자비스 스케줄 | **API 자동**(§8-4 ⑥) |
| 발행 이미지 | 1080×1440 PNG만 | **3:4 PNG 마스터 + 4:5 JPEG 발행본 병행**(§8-5, 인스타 API는 3:4 거부) |
| 속지 기준일 | 속지 하단에 `26.11.16 기준` 1줄 | **폐기 — 카드 내부 날짜 0건**(§4-4) |
| 큐 스키마 | status 4종 | status + **publish_owner·ig_state·ig_scheduled_at·ig_media_id·threads_*·caption_threads**(§7-1) |
| 중복 방지 | 없음 | **5중 잠금**(§8-8) — 이미 예약된 5편 고정 |
| 워크플로 | 2개 | **4개**(배치·당일·발행·토큰갱신) |

## 0. 한 줄 요약

지금은 카드뉴스 1편을 만들 때마다 자비스(AI) 토큰을 쓰고, 업로드도 사람이 앱에서 한다. **앞으로는 저장소 안의 Pillow 렌더러 + GitHub Actions가 LLM 토큰 0으로 7~30일치를 미리 뽑아 대기 큐에 쌓고, 길아 님이 스탭 화면에서 [승인]을 누른 편만 골든타임에 맞춰 Meta 공식 API로 인스타그램(@momcal_official)과 스레드(@momcal_official)에 자동 업로드된다.** 첫 댓글 해시태그 20개도 API로 자동 등록된다.

이 오더 하나로 끝내야 하는 것:

1. `scripts/cardnews/` 생성 파이프라인(렌더러·배치·당일 DB형) 구현
2. **§8 인스타·스레드 자동 발행**(Graph API · Threads API, 카루셀 + 협업자 + 첫 댓글)
3. Supabase `cardnews_queue` 테이블 + 상태 전이(`pending → approved → published`) + **발행 상태 필드** + RLS
4. `cardnews.html`을 **큐 + 승인 게이트 + 발행 상태** 화면으로 확장(미승인 편은 다운로드·노출·발행 모두 잠금)
5. GitHub Actions 4개(주간 배치 / 당일 DB형 / 10분 단위 발행 / 토큰 갱신)
6. 시드 자산 이관(승인된 실물 렌더러·폰트·배경·큐 시드)
7. §12 검증 체크리스트를 실제 실행하고 결과 보고

**용어 정리(중요)**: 이 문서에서 **"무토큰"** 은 **LLM API 토큰 0**(OpenAI·Anthropic·Gemini 호출 없음)을 뜻한다. **Meta 액세스 토큰은 무료**이며(Instagram API·Threads API는 공식·무료, 게시물 수 제한만 있음) 이 오더에서 쓰는 것은 그 무료 토큰이다. 토큰 비용이 드는 것은 LLM뿐이다.

---

## 1. 지금 상태와 목표

### 1-1. 이미 되어 있는 것 (건드리지 말고 그대로 위에 얹는다)

| 자산 | 경로 | 상태 |
|---|---|---|
| 11/16 카드뉴스 8장 | `daily/cardnews/2026-11-16/01.png~08.png` + `caption.txt` + `comment_tags.txt` + `manifest.json` | 라이브 |
| 11/17 카드뉴스 6장 | `daily/cardnews/2026-11-17/01.png~06.png` + 캡션·태그·manifest | 라이브 |
| 최신 날짜 포인터 | `daily/cardnews/latest.json` (`{"latest":"2026-11-16",...}`) | 라이브 |
| 큐 스냅샷 시드 | `daily/cardnews/queue.json` (11/16 published + 11/17~11/19 pending + 11/20~11/22 db pending, 7행) | 라이브 |
| 다운로드 화면 | `cardnews.html` (3:4 미리보기·전체 저장·캡션 복사·첫 댓글 해시태그 복사, `noindex`) | 라이브 |
| 스탭 탭 | `staff_test.html`의 `📰 카드뉴스` 탭(iframe → `cardnews.html`) | 검증용만 반영됨 |
| 아침 카드 CI | `.github/workflows/daily-card.yml` (07:40 KST, `daily/today.png`·`hotdeal.png`·`sale.png`) | 라이브 — **이 워크플로는 손대지 않는다** |
| 스탭 인증·DB | Supabase `https://hycaqsqeogjtbscmzrtm.supabase.co` — 스탭 로그인(`@staff.momcal`), `gonggu`·`hotdeals`·`experiences` 테이블, `is_app_staff()`·`is_app_admin()` RPC | 라이브 |
| 승인된 렌더러 원본 | `scripts/cardnews/_seed/insta_cards.py`, `_seed/render_insta_week1.py`, `fonts/`, `assets/bg/` | 참고용 시드 |
| 인스타·스레드 계정 | IG `@momcal_official`(프로페셔널), Threads `@momcal_official`, 방장 계정 `@momcal_`(협업자) | 계정만 존재, 발행 자동화 없음 |

### 1-2. 목표

- **7~30일치를 미리 만들어 대기**시킨다(고정 정보형). 실시간성이 필요한 공구·핫딜 편만 당일 아침 생성.
- **LLM 토큰 0**: 렌더링은 Pillow(파이썬), 스케줄·커밋·발행은 GitHub Actions. 외부 AI API·LLM 호출 없음.
- **승인 게이트**: `approved`가 아닌 편은 "오늘의 카드뉴스"로 노출되지 않고, 저장·복사·**인스타 발행**이 모두 잠긴다.
- **골든타임 자동 발행**: 평일 `11:00~12:30` / 주말 `18:00~19:30` 사이에서 날짜별로 흩어진 시각에 인스타·스레드 동시 발행 + 첫 댓글 해시태그 20개 자동 등록.
- 길아 님의 수정은 **캡션·해시태그·제목·CTA 문구**에서 즉시 반영(이미지 재렌더 없이 DB 값이 우선).

### 1-3. 비목표 (이번에 하지 않는다)

- AI 이미지 생성, 문장 자동 생성(원고는 사람이 확정한 JSON만 렌더)
- **브라우저를 몰래 조작해서 인스타에 로그인·업로드하는 방식** — 인스타 이용약관 4.2(자동 접근 금지) 위반이고 계정 정지 위험이 있다. 발행은 **Meta 공식 API로만** 한다. (사람이 쓰는 브라우저 자동화를 폴백으로 쓰려면 길아 님의 명시 지시가 있을 때만, 스탭 사이트 다운로드 경로로만)
- **음악(노래) 자동 삽입** — 인스타그램 Content Publishing API에는 오디오·음악 파라미터가 없다(§8-10).
- `staff.html`(라이브) 수정 — `staff_test.html`까지만. 라이브 반영은 `orders/ORDER_STAFF_CARDNEWS_PROMOTE.md`.
- 기존 `daily/today.png`·`hotdeal.png`·`sale.png` 체계 변경
- Threads 이외의 채널(X·페이스북·네이버블로그) 확장

---

## 2. 최종 구조

```
scripts/cardnews/
  __init__.py
  theme.py                # 색·폰트·타입스케일·여백 상수 (§4 표를 코드로)
  render.py               # Pillow 렌더러 — 표지/속지/엔딩/그리드. _seed/insta_cards.py 이관
                          #   render_episode(date, aspect="3:4"|"4:5") 로 캔버스 높이를 파라미터화
  lints.py                # 규칙 자동 검사(금지문자·밀도·사이즈·태그 개수·캡션 길이)
  episodes/
    y2026m11.json         # 날짜별 원고(고정 정보형). §5 스키마
    y2026m12.json
  build_batch.py          # 미래 N일치 렌더 → daily/cardnews/<date>/ + 큐 upsert(pending)
  build_today_db.py       # 당일 공구·핫딜 9칸 편(slot='db') → daily/cardnews/<date>/db/
  queue.py                # Supabase REST 래퍼(select/upsert/patch, service key는 env로만)
  caption.py              # 캡션 조립(§6) + Threads 500자 축약(§6-5)
  images_api.py           # 발행용 파생 이미지 변환(3:4 PNG → 4:5 JPEG, §8-5)
  ig_api.py               # Instagram Graph API 래퍼(컨테이너·캐러셀·발행·첫댓글·quota·중복검사)
  threads_api.py          # Threads API 래퍼(캐러셀·발행)
  publish_ig.py           # ★ 발행 오케스트레이터 (§8-4). 승인+시각+중복가드 통과분만
  token_refresh.py        # IG·Threads 장기 토큰 갱신(§8-3) + 만료 임박 경고
  publish.py              # 승인분 사이트 반영(caption.txt·latest.json·published)
  fonts/                  # Pretendard-{ExtraBold,Bold,Medium}.otf (시드 포함)
  assets/bg/              # 표지 배경 jpg 7장 (시드 포함)
  _seed/                  # 승인된 실물 원본(참고용, 실행 안 함) + README
daily/cardnews/
  2026-11-16/             # 기존 그대로
  2026-11-17/01.png…      # 배치가 만든 편(파일명 규칙 유지: 01.png~NN.png)
  <date>/api/01.jpg…      # ★발행용 4:5 JPEG 파생본 (§8-5) — 인스타·스레드 API가 먹는 규격
  <date>/db/01.png…       # 당일 실시간 DB형(같은 날 두 편 공존)
  queue.json              # 큐 스냅샷(읽기 전용 폴백·시드. 상태 원본은 Supabase)
  latest.json             # 승인·발행된 최신 날짜만 가리킨다
  publish_log.jsonl       # ★발행 이력(멱등성·감사용, append only)
.github/workflows/
  cardnews-batch.yml      # 일 1회 미래 30일 버퍼 채우기
  cardnews-daily.yml      # 매일 06:40 당일 DB형 생성 → 승인분 사이트 발행
  cardnews-publish.yml    # ★10분 단위 깨어나 scheduled_at 지난 승인분을 인스타·스레드에 발행
  cardnews-token.yml      # ★주 1회 IG·Threads 토큰 만료 점검·갱신
```

규칙: **파일명·경로는 기존 `daily/cardnews/2026-11-16/` 규격을 그대로 따른다**(`01.png`부터, `manifest.json`, `caption.txt`, `comment_tags.txt`). `cardnews.html`의 기존 로직이 그대로 살아야 한다. 새로 생기는 것은 `api/` 파생 폴더와 `publish_log.jsonl`뿐이다.

---

## 3. 파이프라인 동작

### 3-1. 고정 정보형(배치) — 일 1회, 미래 30일 버퍼

1. `scripts/cardnews/episodes/*.json`에서 `status:"ready"` 원고만 고른다. `needs_fact_check` 원고는 **렌더하지 않는다**(금액·기한 창작 금지).
2. 대상 날짜의 `daily/cardnews/<date>/manifest.json`이 이미 있으면 건너뛴다(`--force`로만 덮어쓴다).
3. 렌더 → 1080×1440 PNG 세트 + `api/`(1080×1350 JPEG) 세트 + `manifest.json` + `caption.txt` + `comment_tags.txt` + `caption_threads.txt` + `notion.md`.
4. 큐 upsert: `(date, slot='main')` 행이 없으면 `status='pending', kind='fixed', source='batch'`로 만들고 `slides`·`api_slides`·`title`·`caption`·`caption_threads`·`comment_tags`·`hashtags`·`episode_key`·`scheduled_at`(§8-7)을 채운다. **이미 있는 행의 `status`·`caption`·`caption_threads`는 절대 덮어쓰지 않는다**(길아 님이 고친 문구 보호). 파일·원고 갱신이 필요하면 별도 컬럼만 patch.
5. `queue.json` 스냅샷을 다시 쓴다(읽기 전용 폴백용).
6. 커밋·푸시(경로: `daily/cardnews/`, `scripts/cardnews/episodes/`).

### 3-2. 실시간 DB형(당일) — 매일 06:40 KST

- 입력: Supabase `gonggu`(`name, influencer, open_date, end_date`) + `hotdeals`(`title, price, price_before, discount_rate, mall, img_url, created_at`).
- 구성(5장): ① 표지(오늘 마감 N건 + 인기 1위) ② **공구·핫딜 9칸 그리드(본인 공구 최우선 4~5칸 + 오늘 인기 핫딜 4~5칸, 개당·팩당 단가 포함)** ③ 마감 임박 TOP5 ④ 왜 지금(브릿지) ⑤ 고정 엔딩.
- 사진: `img_url`을 그대로 쓰되 받은 이미지는 저장소에 커밋하지 않고 런타임 임시폴더에서 합성한다(저작권·용량). 사진 실패 칸은 🛒 자리표시로 대체하고 **3할 넘게 실패하면 그날 DB형은 만들지 않고 종료**(빈 카드 금지).
- 출력 `daily/cardnews/<date>/db/` + `api/` + 큐 `(date, slot='db', kind='db', status='pending')`.
- 캡션·해시태그는 규칙대로 코드가 조립(§6). 길아 님이 스탭 화면에서 고칠 수 있다.
- **DB형은 당일 생성이라 승인 시각이 늦다** → `scheduled_at`은 그날 골든타임 창 안에서 미리 잡아두고, 창이 끝날 때까지 승인되지 않으면 그날은 발행하지 않는다(`missed_window`). 대신 다음 날 같은 편을 자동 재발행하지 않는다(중복 방지).

### 3-3. 사이트 발행(게이트 통과분만)

`publish.py`가 하는 일은 세 가지뿐이다.

1. `status='approved'`이고 `date <= 오늘(KST)`인 행을 찾는다.
2. 그 날짜의 `caption.txt`·`comment_tags.txt`·`manifest.json`을 **DB 값으로** 덮어쓴다(스탭이 고친 문구가 파일에도 반영).
3. `daily/cardnews/latest.json`을 `{latest: <가장 최근 approved/published 날짜>, updated_at}` 로 갱신하고 행을 `published`로 올린다.

금지: `pending`·`rejected` 행의 날짜로 `latest.json`을 바꾸지 않는다. 승인 없이 `latest.json`을 손으로 고치지 않는다(길아 님의 유일한 통제선이다).

### 3-4. 인스타·스레드 발행 (신설 · 상세는 §8)

`publish_ig.py`는 **사이트 게이트와 별개의 잠금**을 하나 더 통과해야 한다.

```
status='approved'  AND  publish_owner='pipeline'  AND  ig_state='api_pending'
AND  scheduled_at <= now(KST)  AND  now <= scheduled_at + 60분
AND  중복 없음(§8-8)  → 인스타 발행 → 첫 댓글 → 스레드 발행 → ig_state='api_published'
```

하나라도 어긋나면 **아무것도 하지 않고 조용히 종료**한다(로그만 남긴다).

---

## 4. 디자인 고정 규격 (렌더러가 지켜야 하는 값)

`notes/MOMCAL_INSTA_CARD_RULES.md`의 최종본을 코드로 옮긴다. 시드 `_seed/insta_cards.py`가 이미 이 값을 쓰고 있으니 **그 파일을 기준으로 옮기고, 아래 체크 항목만 보강**하면 된다.

### 4-1. 캔버스·타이포

- 마스터 캔버스 **1080×1440 (3:4)**, 사방 안전 여백 **80px**, 좌측 정렬 기준선 `x=80`. (발행용 4:5 파생본은 §8-5)
- Pretendard **ExtraBold(800) / Bold(700) / Medium(500)** 3종만. 자간 한글 **-2%**(-0.02em), 영문 로고만 +0.3em.
- 타입 스케일(고정): 표지 헤드라인 120~150px / 표지 리드 52~62px / (**표지 기준일 뱃지 없음 — 아래 §4-3**) / 속지 섹션 제목 60~68px / 항목 제목 42~44px / 본문 34~38px / 체크리스트 38~40px / 라벨 박스 26px / 페이지 번호 24~26px / 엔딩 메인 56px.
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
  - 크기 36px / 700 / 자간 -2% / 위치 `x=80, y=114` (로고 바로 아래, 폭 넘으면 축소)
  - **그림자·테두리·반투명 판 없이 깔끔한 화이트 타이포**로만. 사진형은 흰색, B 순백형은 상단 22%를 톤다운 배경 띠(`#5B2E8C` 8~12% 또는 어두운 톤 그라데이션)로 처리해 흰 글씨를 유지한다(검은 글씨로 바꾸지 않는다).
  - 이 줄은 "표지에 서브 설명 금지" 규칙의 예외다(설명문이 아니라 브랜드 표지판).
- **🔴 표지 하단 서브 문구는 고정 금지 (길아 님 2026-11-16 확정)** — 각 요일 주제·CTA에 맞는 실제 엄마들 말투 한 줄을 얇은 라인 아래에 쓴다(예: 화요일 `저장 안 하면 순서 밀려요 · 출생신고하면 바로 ㄱㄱ`). 어느 편에나 같은 문구를 복사하지 않는다.
- **🔴 상단 우측은 비운다 — 표지에 날짜 배지를 넣지 않는다 (길아 님 2026-11-16 확정).**
  인스타 캐러셀의 `1/N` 표시와 오른쪽 위에서 겹쳐 보여 지저분해진다. `26.11.17 기준` 같은 뱃지·알약·텍스트를 **표지 어디에도 넣지 않는다**.
  **기준일은 캡션에만 적는다** — 표지에도, 속지에도 넣지 않는다(§4-4).
  → 렌더러에서 뱃지 함수(`date_pill`) 호출을 **전부 제거**하고, 남겨두더라도 표지에서는 호출하지 않는다.
- 하단 좌측: 리드 1줄(52~62px, 흰색 80%) → 후킹 2~3줄(120~150px, **마지막 줄만 포인트색**).
- 금지: 검은 선 테두리(stroke), 90px 미만 헤드라인, 표지에 면책·출처·서브 설명 2~3줄, 이모지, `#`, **표지의 날짜 뱃지(기준일 표기)**.
- AI 생성·자체 제작 배경이면 출처 표기 없음. 외부 사진을 실제로 쓸 때만 `사진 출처 Pinterest` / `사진 출처 @셀러` 22px 1줄.

### 4-4. 속지(2~5장) — 🔴 밀도 규칙 포함 (이번 오더의 핵심 지적사항)

길아 님 지적: **"속지 하단이 비어 보인다"**. 아래를 렌더러 assert로 강제한다.

- 장당 **5~6개 항목** 기본. 항목이 3~4개로 끝나면 ① 항목 수를 늘리고 ② 각 항목 설명을 1줄→2줄로 보강하고 ③ 표·랭킹 행을 추가한다. 여백으로 때우지 않는다.
- 본문 블록의 **마지막 항목 baseline**은 캔버스 높이 `H`에 대해 **`H×0.80 ~ H×0.86`** 사이에서 끝난다. 즉 세로 **80~85% 이상**을 정보로 채운다.

| 캔버스 | 실패(너무 비었음) | 경고 | 정상 구간 | 넘침 실패 |
|---|---|---|---|---|
| H=1440 (3:4 마스터) | `bottom < 1150` | `1150 ≤ bottom < 1170` | **1170~1240** | `bottom > 1330` |
| H=1350 (4:5 발행본) | `bottom < 1080` | `1080 ≤ bottom < 1097` | **1097~1162** | `bottom > 1247` |

- 그 아래에 페이지 번호 `n/N`(24px, 회색 60%)만 남긴다. **🔴 카드 이미지 내부에 날짜 표기는 0건** — 기준일은 캡션에만 적는다. (1판에 있던 "속지 하단 좌측 1줄 `26.11.16 기준`" 규칙은 **폐기**한다.)
- 렌더 후 `lints.check_density()`가 카드별 내용 bbox 하단을 측정해 위 표로 판정한다(경고·실패 로그에 어느 카드인지 출력, 실패는 exit 2).
- 속지 구조: 상단 좌측 로고 `M O M C A L   M A G A Z I N E` + **같은 줄 우측 정렬 태그 `공구 · 핫딜 · 육아정보 · 맘캘린더`(21px, 회색)** → 좌측 라벨 박스 `1 · 한 단어 반응`(26px, 톤다운 배경 + 1px 테두리) → 섹션 제목 60~68px 1줄 → **제목과 본문 사이 여백 최소 60~66px 이상** → 항목들 → 필요 시 브릿지 1줄.
- **🔴 속지 틀 4종 이상 지원 — 한 편 안에서 같은 리스트 틀을 반복하지 않는다 (길아 님 2026-11-16 확정)**
  - 지원 틀: `timeline`(세로 단계 플로우) / `table`(2열 표, 좌측 틴트 열) / `cards_grid`(2×2 라운드 카드 + 번호 배지 + TIP 띠) / `editorial`(파스텔 배경 + 형광펜 하이라이트 + KEY POINT 박스) + 기본 `info`(kv·check·rank) / `visual_grid`(사진 썸네일 그리드).
  - 한 편(표지+속지+엔딩) 안에 같은 틀이 2번 반복되면 주제에 맞게 다른 틀로 섞는다. 예: 화요일 입소대기 편 = 표지 + timeline + table + cards_grid + editorial + 엔딩.
  - 브릿지 라인은 하단 라인(`H-118`)과 본문 마지막선(`H-200`) 사이의 **수직 중앙(`H-175`)에 정렬**한다.
- 항목 표현: `제목(42px 700) + 우측 값(42px 800 포인트색) + 설명 2줄(34px 회색)` 또는 `✔ 체크리스트(38~40px, ✔는 먹색 단색, 금액·기한만 포인트색)` 또는 `랭킹(순번 40px 포인트 + 이름 38px + 가격 38px 800)`.
- **🔴 불필요한 영어 단어 금지** — `childcare` 같은 뜻풀이 없는 영어를 카드 문구에 넣지 않는다(상품명·기관명·핸들 등 고유명사는 예외). 이모지도 금지 — **Pretendard 폰트에 없는 이모지를 카드 이미지 텍스트에 쓰면 두부(□)로 깨진다**. 강조가 필요하면 `TIP ·`처럼 텍스트만 쓴다.
- 아이콘은 1.5px 단색 선만. `#` 금지.

### 4-5. 고정 엔딩(마지막 장) — 전 편 공통, 생략 금지

순백(`#FFFFFF`) 중앙 정렬: **맘캘린더 공식 로고(`momcal-channel-640.png`, 140px, 라운드 마스크 — 선 그린 달력 아이콘 대체, 길아 님 2026-11-16 지시)** → `육아맘이 매일 1분 만에 챙기는` → `공구 · 세일 · 육아 정보` → 1px 구분선(폭 120px) → `M O M C A L   M A G A Z I N E` → `저장해두면 이번 주에 또 꺼내 보실 수 있어요` → 검은 알약 버튼 **`@momcal_official >`** → `팔로우하고 다음 정보도 받아가세요 :)`

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
      "key": "2026-11-24",
      "episode_key": "day9_tue",
      "kind": "fixed",
      "status": "ready",
      "cover": {
        "type": "photo",
        "bg": "assets/bg/daycare.jpg",
        "lead": "상담 가서 뭘 물어볼까요",
        "hook": ["이건 꼭", "물어보세요"],
        "accent": "coral"
      },
      "brand_line": "공구 · 핫딜 · 세일 · 육아정보 커뮤니티 맘캘린더",
      "cover_sub": "상담 끝나고 후회하지 마세요 · 저장해두고 하나씩",
      "cards": [
        {
          "template": "timeline",
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
- `cards[].template`: `info`|`timeline`|`table`|`cards_grid`|`editorial`|`visual_grid`. **한 편에서 같은 값 2회 반복 금지**(lints가 검사).
- `status`: `ready`(렌더 대상) / `needs_fact_check`(렌더 금지, 스탭 화면에 "검증 필요"로만 표시) / `hold` / `published`(이미 발행, 렌더 제외).
- `kind`: `fixed`(배치) / `db`(당일 생성, 원고 JSON에는 넣지 않는다).
- 표지 `brand_line`은 **§4-3의 고정 문구를 그대로** 쓴다(원고에서 바꾸지 않는다. 렌더러가 상수로 강제해도 된다).
- 원고에 금액·기한이 들어가면 `facts.sources`가 비어 있으면 안 된다(비면 렌더 거부).

---

## 6. 캡션 · 해시태그 · CTA · 스레드 축약 · 노션 정리본 규격

### 6-1. 캡션 (인스타 본문) — 조립 순서 고정

아래 순서를 코드가 강제한다(순서가 바뀌면 lint 실패).

```
① [ 공유/저장 필수 ] + 후킹 한 줄 (질문형 우선)
② 빈 줄
③ 본문 2~4덩어리 (각 덩어리 사이 빈 줄, 번호 묶음 1./2./3. 또는 ✔ 체크리스트 5~8줄)
④ 빈 줄 + CTA 정확히 1개 (저장 / 배우자·육아동지 공유 / 댓글 DM 중 하나)
⑤ 빈 줄 + 기준일 1줄 :  ※ 26.11.17 기준, 아이사랑·복지로 안내 확인
⑥ .
⑦ .
⑧ .
⑨ 📍 공구 핫딜 정보 공유 커뮤니티 맘캘린더💛
⑩ 공구 일정 검색 웹사이트 @momcal_ 프로필링크
⑪ .
⑫ .
⑬ .
⑭ 해시태그 정확히 5개 (#맘캘정보 고정 + 주제 4개)
```

- **푸터 ⑥~⑬은 한 글자도 바꾸지 않는다**(길아 님 2026-11-16 확정). 점 3개는 위 3줄·아래 3줄.
- 본문에서 **별표 볼드(`**`) 금지, 구분선(`---`) 금지**(인스타에서 기계적으로 보임). 마크다운 금지.
- 3~6덩어리 원칙, 이모지는 📍·💛 정도만(0~2개).
- 인스타 캡션 상한 2,200자·해시태그 30개·@태그 20개 → **`lints.check_caption()`이 2,200자 초과를 실패로 처리**한다(현재 캡션 ~660자로 여유).
- 공동 작업자 안내: **캡션 본문에는 넣지 않는다.** 업로드 시 인스타에서 `@momcal_`를 공동 작업자로 넣는 사실은 스탭 화면 체크리스트에만 표시한다.

### 6-2. 첫 댓글 해시태그 (`comment_tags.txt`)

- **정확히 20개**, 공백 구분 1줄. `#맘캘린더` 포함. 본문 5개와 중복돼도 된다(첫 댓글은 검색 유입용).
- 렌더 시 `lints.check_tags()`가 개수 20·`#` 형식·중복 없음을 검사.
- **이 댓글은 이제 API가 자동 등록한다(§8-4 6단계).** 댓글 API 상한은 넉넉하지만 2,200자 상한을 lint로 같이 본다.

### 6-3. 스레드 축약 캡션 (`caption_threads`)

- **500자 이내**. Threads는 이모지를 UTF-8 바이트로 세므로 `len_threads()`를 따로 구현한다: 일반 문자 1, 이모지·기호는 `len(ch.encode('utf-8'))` 바이트 수.
- 조립: `[ 공유/저장 필수 ] 후킹` 1줄 → 핵심 ✔ 3~4줄 → CTA 1줄 → `. . .` → 푸터 2줄(`📍 …` / `공구 일정 검색 …`) → `. . .`. **넘치면 ✔ 줄을 뒤에서부터 잘라** 500자 이하로 맞춘다(푸터·CTA는 절대 자르지 않는다).
- `**`·`---` 금지. 해시태그는 본문에 넣지 않고 **`topic_tag` 파라미터**로 넘긴다(§8-6). 값은 `맘캘정보` 고정(1~50자, `.`·`&` 금지).
- Threads에는 인스타 댓글→DM 자동화(리틀리)가 없다. **댓글 DM을 CTA로 쓴 편은 Threads용으로 `저장해두고 프로필 링크에서 확인` 식으로 치환**한다(`cta.threads_line`이 있으면 그 값을 우선).

### 6-4. 노션 정리본 (`notion.md`)

- 구조: 인사 1줄 → `💡 맘캘 결론부터` 콜아웃 2줄 → 이모지 섹션 제목 + `A/B/C` 상황 갈래(`👉`로 결론) → 누가/언제/얼마나/어떻게 1줄씩 → `⚠️` 함정 콜아웃 → 신청 포털 링크(아이사랑·복지로·고용24 등 실제 링크) → 고정 푸터. **모바일 줄바꿈: 1항목 1줄 원칙**(11-16 지적 반영).
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

## 7. 승인 워크플로우 (사이트 게이트)

### 7-1. 데이터 모델 — Supabase `public.cardnews_queue`

1판 스키마에 **발행 상태 컬럼을 추가**한다(아래 ★ 표시가 신설).

```sql
create table if not exists public.cardnews_queue (
  id              bigint generated always as identity primary key,
  date            date        not null,
  slot            text        not null default 'main',   -- 'main'(고정 정보형) | 'db'(당일 실시간)
  kind            text        not null default 'fixed',  -- 'fixed' | 'db'
  status          text        not null default 'pending',-- pending | approved | published | rejected
  title           text,
  subtitle        text,
  cta_type        text,
  episode_key     text,
  slides          jsonb       not null default '[]'::jsonb, -- ["01.png",...] 3:4 마스터
  api_slides      jsonb       not null default '[]'::jsonb, -- ★ ["api/01.jpg",...] 발행용 4:5 JPEG
  caption         text,
  caption_threads text,                                    -- ★ 500자 축약 캡션
  comment_tags    text,
  hashtags        text,
  notion_md       text,
  source          text not null default 'batch',            -- 'batch' | 'db' | 'manual'
  -- ★ 발행 제어 (여기가 중복 발행을 막는 자리다)
  publish_owner   text not null default 'pipeline',         -- 'pipeline' | 'jarvis_web' | 'none'
  ig_state        text not null default 'none',             -- none | native_scheduled | api_pending | api_publishing | api_published | api_failed | missed_window
  ig_scheduled_at timestamptz,                              -- 골든타임 창 안에서 날짜별로 흩어진 시각
  ig_media_id     text,
  ig_permalink    text,
  threads_state   text not null default 'none',             -- none | api_pending | api_published | api_failed | skipped
  threads_media_id text,
  publish_error   text,
  meta            jsonb       not null default '{}'::jsonb, -- 밀도 측정값·렌더 버전·발행 응답 원문
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text,
  approved_at     timestamptz,
  published_at    timestamptz,
  unique (date, slot)
);
create index if not exists cardnews_queue_date_idx on public.cardnews_queue (date);
create index if not exists cardnews_queue_ig_idx   on public.cardnews_queue (ig_state, ig_scheduled_at);

alter table public.cardnews_queue enable row level security;

-- 스탭·관리자만 읽고 고친다 (기존 is_app_staff/is_app_admin 재사용)
create policy cnq_staff_read   on public.cardnews_queue for select to authenticated using (public.is_app_staff() or public.is_app_admin());
create policy cnq_staff_write  on public.cardnews_queue for update to authenticated using (public.is_app_staff() or public.is_app_admin()) with check (public.is_app_staff() or public.is_app_admin());
-- 파이프라인(서비스 키)은 RLS 우회 → 별도 정책 불필요

-- ★ 토큰 보관소(§8-3). 서비스 롤만 접근, anon·authenticated 정책 없음
create table if not exists public.social_tokens (
  key        text primary key,          -- 'ig_long_token' | 'threads_long_token'
  value      text not null,
  expires_at timestamptz,
  refreshed_at timestamptz not null default now()
);
alter table public.social_tokens enable row level security;
```

- **anon 키로는 절대 쓰지 못하게** 한다(정책에 anon 없음).
- 앱(손님) 쪽에서 이 테이블을 읽을 일은 없다. `cardnews.html`은 스탭 로그인 세션을 써서 읽는다 → 로그인 전에는 `queue.json` 폴백만 보인다(승인·발행 버튼 숨김).

### 7-2. 상태 전이

```
(batch/db 생성) ─▶ pending ──[승인]──▶ approved ──[publish.py]──▶ published(사이트)
                      │                    │
                      │                    └──[publish_ig.py]──▶ ig_state: api_pending → api_publishing → api_published
                      └──[반려]──▶ rejected

이미 인스타에 예약/발행된 편은  publish_owner='jarvis_web',  ig_state='native_scheduled'  (파이프라인 손대지 않음)
```

- `approved`가 되면 `approved_at`, `updated_by`를 기록.
- `approved → pending` 되돌리기는 **오늘·내일 날짜만** 허용(이미 인스타에 올린 과거 편은 `published` 고정, 수정 금지).
- `rejected`는 다시 `pending`으로 되돌릴 수 있다(재검토).
- **`ig_state`가 `api_published`인 행은 어떤 경로로도 `api_pending`으로 되돌리지 않는다**(중복 발행 방지의 최후 방어선).

### 7-3. REST 호출 규격 (스탭 페이지)

기존 `staff_test.html`의 `sbHeaders()`·`ACCESS_TOKEN` 체계를 그대로 쓴다.

```
GET    /rest/v1/cardnews_queue?select=*&date=gte.2026-11-16&date=lte.2026-11-30&order=date.asc,slot.asc
PATCH  /rest/v1/cardnews_queue?date=eq.2026-11-17&slot=eq.main
       body: {"status":"approved","caption":"…","caption_threads":"…","comment_tags":"…","hashtags":"…","title":"…","updated_by":"<staff id>","updated_at":"…"}
```

- PATCH에는 항상 `updated_at` 값을 넣고, `Prefer: return=representation`으로 결과를 받아 화면을 갱신.
- 실패 시 토스트로 사유 표시(권한·네트워크). **낙관적 UI로 상태를 먼저 바꾸지 않는다**(실패가 숨는다).
- **스탭 페이지는 `status`·문구만 고친다. `ig_state`·`ig_media_id`는 읽기 전용**(발행 상태를 사람이 손으로 뒤집으면 중복이 난다).

### 7-4. 화면(`cardnews.html`) 확장안

기존 화면(상단바·히어로·전체 저장·캡션 복사·3:4 그리드·줌·날짜 선택)을 유지하고 위에 두 모드를 얹는다.

**모드 탭**: `[ 오늘 ]` `[ 대기 큐 ]`

1. **오늘 모드** (기본, 지금과 같은 화면)
   - 오늘 날짜의 `main`(있으면 `db`도 토글) 행을 DB에서 먼저 조회 → `approved`/`published`면 지금처럼 전체 저장·캡션 복사 활성.
   - `pending`이면 카드 위에 회색 띠 **`미승인 편입니다 — 승인 전에는 저장·복사·발행이 잠깁니다`** + 버튼 `disabled` + 미리보기는 허용.
   - 행이 없으면 `manifest.json` 폴백, 그것도 없으면 "오늘 카드뉴스 준비 중".
2. **대기 큐 모드**
   - 이번 주 + 다음 주 목록을 날짜/요일/상태 배지(`대기`·`승인`·`발행`)·**발행 배지(§7-5)**·제목·CTA로 리스트.
   - 행을 누르면 상세: ① 카드 3:4 썸네일 그리드(승인 전에도 미리보기) ② **캡션 textarea** ③ 해시태그 5개 ④ 첫 댓글 20개 ⑤ **스레드 축약 캡션 textarea + 실시간 글자수(500 기준)** ⑥ 제목·CTA 문구 ⑦ **발행 카드**: `발행 예정 2026-11-24(화) 11:32` · `인스타 대기` · `스레드 대기` · 버튼 `[ 지금 발행 ]`(승인 후에만 활성, 한 번 더 확인 다이얼로그) ⑧ 버튼 `[ 임시 저장 ]` `[ 승인 ]` `[ 반려 ]`(승인된 편은 `[ 승인 취소 ]`).
   - 저장·승인 후 목록으로 돌아가며 상태 배지가 즉시 갱신된다. 토스트: `저장했어요`, `승인했어요 — 발행 시각에 인스타·스레드에 올라갑니다`.
   - 상단에 **업로드 체크리스트** 1줄: `공동 작업자 @momcal_ 초대 수락 · 첫 댓글 해시태그 20개는 자동 · 노래는 앱에서만`.
   - 프리필: `notion.md`가 있으면 `[ 노션 정리본 복사 ]` 버튼도 제공(승인 후 활성).

**모바일 우선**(갤럭시 Z 플립7 세로 화면): 큐 리스트는 1열 카드, 상세는 세로 스택, 저장/승인 버튼은 하단 고정 바, 가로 스크롤 금지. 기존 CSS 토큰(`--p`, `--bd`, 14px 라운드) 유지.

**staff_test.html**: 지금의 iframe 탭 그대로 두고, `mountNews()`에 `?mode=queue`로 바로 열리는 보조 링크 1개만 추가(선택). 라이브 `staff.html`은 **손대지 않는다** — 반영은 `orders/ORDER_STAFF_CARDNEWS_PROMOTE.md`(이 커밋에 같이 들어간다).

### 7-5. 게이트 규칙(요약)

| 상태 | 카드 미리보기 | 전체 저장·개별 저장 | 캡션·태그 복사 | "오늘의 카드뉴스" 노출 | `latest.json` | 인스타/스레드 발행 |
|---|---|---|---|---|---|---|
| pending | O(워터마크) | ✕ | ✕ | ✕ | ✕ | ✕ |
| approved | O | O | O | **O** | **O** | **O**(발행 시각·중복가드 통과 시) |
| published | O | O | O | O | O | 이미 발행됨 |
| rejected | O | ✕ | ✕ | ✕ | ✕ | ✕ |

| 발행 배지(`ig_state`) | 화면 표기 |
|---|---|
| `none` | `발행 안 함` |
| `native_scheduled` | `인스타 예약됨(직접) · 파이프라인 제외` |
| `api_pending` | `발행 대기 11/24 11:32` |
| `api_publishing` | `발행 중…` |
| `api_published` | `발행 완료` + 게시물 링크 |
| `api_failed` | `발행 실패 — 사유` + `[ 재시도 ]` |
| `missed_window` | `시간 놓침 — 오늘 발행 안 함` |

- 게이트는 화면에서 강제하고, 파일 단위 1차 방어는 `publish.py`가 `latest.json`을 approved만 가리키게 하는 것. 승인 없이 `latest.json`을 고치면 **오더 위반**이다.
- PNG·JPG 파일 자체는 공개 URL을 알면 열린다(저장소 공개·Pages 호스팅, 발행 API가 URL로 가져가야 하므로 필수). 이건 실수 방지 게이트다.

---

## 8. 인스타그램·스레드 자동 발행 (이번 개정의 심장)

### 8-0. 왜 공식 API인가 — 비용 0

- **Instagram API(Instagram Login 방식)**와 **Threads API**는 Meta 공식 무료 API다. 게시물 개수 제한(24시간당 인스타 100건·스레드 250건)만 있고 **요금은 없다**.
- 브라우저로 로그인해서 '게시' 버튼을 누르는 방식은 인스타그램 이용약관 4.2(자동 접근 금지)에 걸리고 계정 정지 위험이 있다. **이 오더는 API 경로만 구현한다.**
- API는 자체 예약 기능이 **없다**. "예약"은 우리가 `scheduled_at`을 정해두고 GitHub Actions가 그 시각에 깨어나 호출하는 방식으로 구현한다(§8-7).

### 8-1. 계정 준비 상태와 전제

| 항목 | 값 | 확인 |
|---|---|---|
| 인스타 계정 | `@momcal_official` **프로페셔널(비즈니스/크리에이터)** 이어야 함 | 앱 → 설정 → 계정 유형에서 확인·전환 |
| 스레드 계정 | `@momcal_official` | 인스타 계정과 연동 |
| 협업자 계정 | `@momcal_` | 공개 계정이어야 초대 가능 |
| Facebook 페이지 | **필요 없음**(Instagram Login 방식) | — |
| 비용 | 0원 | — |

**개인 계정은 API 발행이 불가능하다.** 프로페셔널이 아니면 Claude Code가 `GET /me?fields=account_type`으로 확인해 `BUSINESS`/`MEDIA_CREATOR`가 아니면 **즉시 멈추고 보고**한다.

### 8-2. 길아 님이 1회 해야 하는 일 (15분, 여기서만 사람 손이 필요하다)

1. **Meta 개발자 앱 만들기** — developers.facebook.com 로그인 → 앱 만들기 → 유형 **Business** → 사용 사례 **"Manage messaging & content on Instagram"** → **API setup with Instagram login**.
2. **권한 3개 추가** (Permissions and features):
   - `instagram_business_basic`
   - `instagram_business_content_publish`
   - `instagram_business_manage_comments`  ← 첫 댓글 해시태그 자동 등록용
3. **앱을 Live로 게시** — 앱 설정 → 기본 → **개인정보처리방침 URL**(`https://momcalendar.com/privacy.html`)과 카테고리 입력 후 저장 → 좌측 **Publish → Live**. (자기 계정만 쓰는 Standard Access라 **앱 심사는 필요 없다**.)
4. **토큰 발급** — API setup with Instagram login → 계정 추가(`@momcal_official` 로그인·허용) → **Generate token** → `IGAA…` 로 시작하는 **장기(60일) 토큰**이 한 번만 보이므로 즉시 복사.
5. **Threads 토큰 발급** — Threads용 앱(또는 같은 앱의 Threads 유스케이스)에서 `threads_basic`, `threads_content_publish` 승인 후 `THREADS…` 장기 토큰 발급.
6. **GitHub Secrets 4개 등록** — `wonji2/momcalendar` → Settings → Secrets and variables → Actions:

   | 이름 | 값 |
   |---|---|
   | `IG_USER_ID` | `@momcal_official`의 IG user id (`GET /me?fields=user_id` 결과) |
   | `IG_ACCESS_TOKEN` | `IGAA…` 장기 토큰 |
   | `THREADS_USER_ID` | Threads user id (`GET /me?fields=id,username` 결과) |
   | `THREADS_ACCESS_TOKEN` | `TH…` 장기 토큰 |

7. **최초 1회 토큰을 Supabase에 심기** — Claude Code가 `python -m scripts.cardnews.token_refresh --seed`로 `social_tokens` 테이블에 넣는다(이후 갱신은 자동, §8-3).

> 토큰을 못 받았거나 실패하면 **§8-9 폴백 경로**로 자동 분기한다. 토큰이 없다고 오더 전체를 멈추지 않는다.

### 8-3. 토큰 수명·자동 갱신 (여기서 사람이 놓치면 60일 뒤 발행이 죽는다)

- 인스타 장기 토큰: **60일**, `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…` — **발급 24시간 이후·만료 전**에만 갱신되고, 갱신하면 60일이 다시 시작된다. 60일 안에 갱신 못 하면 **되살릴 수 없고 재로그인**만이 답이다.
- Threads 장기 토큰: **60일**, `GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=…` (조건 동일).
- 그래서 토큰은 GitHub Secrets에만 두지 않는다(워크플로가 Secrets를 스스로 갱신할 수 없다). **Supabase `social_tokens` 테이블을 원본으로 쓰고**, 워크플로는 매 실행마다 이 테이블에서 읽는다.
- `token_refresh.py` 동작:
  1. `social_tokens`에서 두 토큰을 읽는다. 없으면 Secrets 값으로 폴백.
  2. `expires_at`까지 **15일 이하**면 갱신 호출 → 성공 시 새 토큰·`expires_at`(+60일)을 upsert.
  3. 갱신 실패(만료·권한 회수)면 GitHub Actions 로그에 `::error::IG_TOKEN_EXPIRED`로 남기고, 큐 테이블 `meta`에 상태를 적는다. 자비스가 그 신호를 보고 길아 님께 "토큰 다시 발급" 1줄을 올린다.
- `.github/workflows/cardnews-token.yml`은 **주 1회(일 02:10 KST)**와 `workflow_dispatch`로 돈다.

### 8-4. 인스타 발행 순서 (카루셀 + 협업자 + 첫 댓글)

`ig_api.py` / `publish_ig.py`가 지키는 순서. 버전은 `IG_GRAPH_VERSION`(기본 `v23.0`)으로 고정하고 테스트 통과 전에는 올리지 않는다.

```
① 사전 점검 (발행 전에 전부 통과해야 다음으로)
   - GET  /me?fields=user_id,username,account_type          → 프로페셔널 확인
   - GET  /{IG_USER_ID}/content_publishing_limit?fields=config,quota_usage
       → quota_usage ≥ quota_total-5 이면 오늘 발행 중단(로그)
   - 중복 검사(§8-8)
② 자식 컨테이너 1장씩 (슬라이드 수만큼)
   POST /{IG_USER_ID}/media
        image_url=https://momcalendar.com/daily/cardnews/<date>/api/01.jpg
        &is_carousel_item=true
   → {"id": "<CHILD_ID>"}  (순서대로 보관)
③ 부모(카루셀) 컨테이너
   POST /{IG_USER_ID}/media
        media_type=CAROUSEL
        &children=<CHILD_ID_1>,<CHILD_ID_2>,…
        &caption=<DB caption>
        &collaborators=["momcal_"]
   → {"id": "<PARENT_ID>"}
④ 상태 폴링
   GET /{PARENT_ID}?fields=status_code   → 1분 간격, 최대 5분
       FINISHED → ⑤,  ERROR/EXPIRED → 실패 처리
⑤ 발행
   POST /{IG_USER_ID}/media_publish?creation_id=<PARENT_ID>
   → {"id": "<MEDIA_ID>"}   ← 이 id로만 댓글·퍼머링크를 얻는다
⑥ 첫 댓글 (해시태그 20개)
   POST /{MEDIA_ID}/comments?message=<comment_tags.txt 전문>
⑦ 기록
   GET  /{MEDIA_ID}?fields=permalink,timestamp  → permalink 저장
   DB: ig_state='api_published', ig_media_id, ig_permalink, published_at
   daily/cardnews/publish_log.jsonl 에 한 줄 append
```

- **`collaborators`는 부모(카루셀) 컨테이너에만** 넣는다(자식에 넣으면 거부). 값은 `@` 없는 유저네임 `"momcal_"`, 최대 3명.
- 발행 실패 시 **자식 컨테이너를 다시 만들지 않는다**(24시간 내 400개 제한). 부모 컨테이너부터 재시도한다.
- ①에서 하나라도 실패하면 아무것도 만들지 않고 종료(컨테이너 낭비 금지).

### 8-5. 🔴 이미지 제약 — 인스타 API는 3:4를 거부한다 (이번 개정에서 가장 중요한 사실)

Meta 공식 문서 판정:

| 규격 | 인스타 앱(사람이 직접) | 인스타 **API** | 스레드 API |
|---|---|---|---|
| 형식 | PNG/JPG | **JPEG만**(PNG는 `36001/2207005` 거부) | JPEG·PNG |
| 비율 | 1.91:1 ~ **3:4** | 1.91:1 ~ **4:5** (3:4는 `36003/2207009` 거부) | **10:1까지** (사실상 자유) |
| 폭 | 320~1080 | 320~1440 | 320~1440 |
| 용량 | — | 8MB | 8MB(JPEG) / 3MB(PNG) |

즉 **1080×1440 PNG 마스터를 그대로 API에 던지면 100% 실패**한다. 그래서 파생본을 만든다.

- **마스터(그대로 둔다)**: `daily/cardnews/<date>/01.png…` = 1080×1440 PNG. 사람이 앱에서 직접 올릴 때·스탭 다운로드·기존 `cardnews.html`이 쓰는 원본. **디자인 규격 §4는 이 파일 기준이다.**
- **발행용 파생본(신설)**: `daily/cardnews/<date>/api/01.jpg…` = **1080×1350(4:5) JPEG q92, sRGB**.
  - **중앙 크롭 금지.** 1440→1350 크롭은 위아래 45px씩 잘려 상단 로고(`y=72`)와 하단 페이지 번호가 날아간다.
  - **같은 렌더러로 캔버스 높이 `H=1350`으로 다시 그린다**(`render.aspect="4:5"`). 레이아웃은 `H` 기준 상대값이라 그대로 흐르고, 밀도 판정도 §4-4 표의 1350행을 쓴다.
  - 파일당 8MB 이하 확인(현재 PNG 약 1.3MB → JPEG는 그 이하).
- **스레드는 `api/` 4:5 JPEG를 그대로 쓴다**(플랫폼 간 화면 통일·저장소 절약). 3:4가 꼭 필요하면 `--threads-ratio 3:4` 플래그로 1080×1440 JPEG 세트를 따로 만들 수 있게만 열어둔다(기본값은 4:5).
- `manifest.json`에 발행본 정보를 남긴다:

```json
"api": {"size":"1080x1350","ratio":"4:5","format":"jpeg","quality":92,"slides":["api/01.jpg", "api/02.jpg"]}
```

- `lints.check_api_images()`: 모든 `api/*.jpg`가 1080×1350·JPEG·≤8MB·sRGB인지 확인. 하나라도 어긋나면 발행 금지(exit 3).

### 8-6. 스레드 발행 (같은 이미지 · 500자 축약 · topic_tag)

```
① 아이템
   POST https://graph.threads.net/{THREADS_USER_ID}/threads
        media_type=IMAGE&image_url=<api/01.jpg>&is_carousel_item=true
② 부모
   POST /{THREADS_USER_ID}/threads
        media_type=CAROUSEL&children=<id,id,…>
        &text=<caption_threads (≤500)>&topic_tag=맘캘정보
③ 폴링 GET /{CONTAINER}?fields=status,error_message  → FINISHED
④ POST /{THREADS_USER_ID}/threads_publish?creation_id=<CONTAINER>
```

- 카루셀 **2~20장**(인스타 10장보다 넉넉). 슬라이드 5~8장이면 그대로.
- `text` **500자 상한** — §6-3의 `caption_threads`를 쓴다. 없으면 코드가 자동 축약한다.
- `topic_tag`는 `#` 없이 `맘캘정보`(1~50자, `.`·`&` 금지). 해시태그를 본문에 몰아넣지 않는다.
- 스레드에도 **맘캘 푸터 2줄은 반드시 유지**한다.
- 인스타 발행이 성공하고 스레드가 실패해도 **인스타를 되돌리지 않는다**. `threads_state='api_failed'`로 남기고 다음 실행에서 스레드만 재시도(최대 3회).
- 스레드는 24시간 250건 제한. 우리는 하루 1편이라 무관하지만, quota 오류가 오면 그날 스레드는 건너뛴다.

### 8-7. 발행 시각 — 골든타임 창 안에서 날짜별 랜덤 분산

길아 님 확정(2026-11-16): **평일은 오전 11:00~12:30, 주말은 저녁 18:00~19:30, 매일 같은 분은 금지.**

- `build_batch.py`가 날짜별로 시각을 한 번 정해 DB `ig_scheduled_at`에 **저장**한다(매번 다시 뽑지 않는다 — 화면과 실제가 어긋나면 신뢰가 깨진다).
- 산출식: `seed = int(hashlib.sha256(date.isoformat()).hexdigest()[:8],16)` → 창 길이(90분) 안의 분 단위 오프셋. 5분 단위로 반올림해 `:00/:05/:10…`에 맞춘다(예: 화 11:15, 수 11:40, 목 12:10, 월 11:20 — 이미 예약된 4건과 같은 결).
- 평일(월~금) 창 = 11:00~12:30, 주말(토·일) 창 = 18:00~19:30. **KST 기준**으로 계산하고 UTC로 변환해 저장.
- `.github/workflows/cardnews-publish.yml` cron(UTC):

```yaml
on:
  schedule:
    - cron: '*/10 2-3 * * 1-5'    # KST 평일 11:00~12:59
    - cron: '*/10 9-10 * * 0,6'   # KST 주말 18:00~19:59
  workflow_dispatch:
```
  (KST 11:00 = UTC 02:00, KST 18:00 = UTC 09:00. GitHub cron은 최대 15~30분 늦게 돌 수 있다.)
- 스크립트 판정: `ig_scheduled_at <= now <= ig_scheduled_at + 60분` → 발행. `now > ig_scheduled_at + 60분` → `missed_window`로 남기고 **그날은 올리지 않는다**(골든타임을 놓친 편을 밤 11시에 올리는 것보다 안 올리는 게 낫다). `missed_window`는 다음 날 자비스가 길아 님께 알린다.
- 같은 실행에서 `main`·`db` 두 슬롯이 걸리면 **`main` 먼저**, `db`는 `main` 성공 후 30분 뒤 시각으로 자동 조정.

### 8-8. 🔴 중복 발행 절대 방지 가드 (5중 잠금)

지금 이미 **인스타·스레드에 직접 예약이 끝난 5편**이 있다. 파이프라인이 이걸 또 올리면 계정에 같은 글이 두 번 뜬다.

| 날짜 | 편 | 예약 시각 | 상태 |
|---|---|---|---|
| 2026-11-16(월) | 2027 출산지원금 | **20:00** | 인스타+스레드 예약 완료 |
| 2026-11-17(화) | 어린이집 입소대기 | **11:15** | 인스타+스레드 예약 완료 |
| 2026-11-18(수) | 시간제보육 | **11:40** | 인스타+스레드 예약 완료 |
| 2026-11-19(목) | 어린이집 준비물 | **12:10** | 인스타+스레드 예약 완료 |
| 2026-11-23(월) | 2027 자녀장려금 | **11:20** | 인스타+스레드 예약 완료 |

**가드 5중**

1. **큐 시드(가장 중요)**: 위 5행은 `publish_owner='jarvis_web'`, `ig_state='native_scheduled'`, `ig_scheduled_at`=위 시각으로 **`daily/cardnews/queue.json` 시드 + Supabase upsert**에 반드시 넣는다. `publish_ig.py`는 `publish_owner='pipeline' AND ig_state='api_pending'`인 행만 본다 → 이 5편은 **코드 수준에서 대상이 아니다.**

   `queue.json`에 들어갈 5행의 정확한 모양(그대로 복사해 쓴다. `slides`는 이미지가 저장소에 있으면 채우고 없으면 `[]` + `needs_assets:true`):

```json
[
  {"date":"2026-11-16","slot":"main","kind":"fixed","status":"published",
   "publish_owner":"jarvis_web","ig_state":"native_scheduled",
   "ig_scheduled_at":"2026-11-16T20:00:00+09:00","threads_state":"none",
   "title":"2027년 출산 예정이면 나라에서 총 얼마 받을까?","slides":["01.png","…","08.png"],
   "note":"인스타·스레드 직접 예약 완료(11/16 20:00). 파이프라인 발행 제외."},
  {"date":"2026-11-17","slot":"main","kind":"fixed","status":"approved",
   "publish_owner":"jarvis_web","ig_state":"native_scheduled",
   "ig_scheduled_at":"2026-11-17T11:15:00+09:00","threads_state":"none",
   "note":"직접 예약 완료(11/17 11:15). 파이프라인 발행 제외."},
  {"date":"2026-11-18","slot":"main","kind":"fixed","status":"approved",
   "publish_owner":"jarvis_web","ig_state":"native_scheduled",
   "ig_scheduled_at":"2026-11-18T11:40:00+09:00","threads_state":"none",
   "slides":[],"needs_assets":true,
   "note":"직접 예약 완료(11/18 11:40). 이미지는 자비스 로컬에만 있음 → 저장소 이관은 별건."},
  {"date":"2026-11-19","slot":"main","kind":"fixed","status":"approved",
   "publish_owner":"jarvis_web","ig_state":"native_scheduled",
   "ig_scheduled_at":"2026-11-19T12:10:00+09:00","threads_state":"none",
   "slides":[],"needs_assets":true,
   "note":"직접 예약 완료(11/19 12:10). 이미지는 자비스 로컬에만 있음."},
  {"date":"2026-11-23","slot":"main","kind":"fixed","status":"approved",
   "publish_owner":"jarvis_web","ig_state":"native_scheduled",
   "ig_scheduled_at":"2026-11-23T11:20:00+09:00","threads_state":"none",
   "slides":[],"needs_assets":true,
   "episode_key":"2027_child_credit",
   "title":"2027년 자녀장려금, 기준 그대로예요",
   "note":"직접 예약 완료(11/23 11:20). 원고·이미지는 자비스가 별도 이관."}
]
```

   Supabase upsert도 같은 값으로 넣는다(`on conflict (date,slot) do update set publish_owner=excluded.publish_owner, ig_state=excluded.ig_state, ig_scheduled_at=excluded.ig_scheduled_at` — 단 `status`·`caption`은 덮지 않는다).
2. **시각 게이트**: `ig_scheduled_at`이 없거나 미래면 발행하지 않는다. 5편은 `native_scheduled`라 여기서도 걸린다.
3. **발행 직전 원격 대조**: 인스타 `GET /{IG_USER_ID}/media?fields=id,caption,timestamp&limit=10`, 스레드 `GET /{THREADS_USER_ID}/threads?fields=id,text,timestamp&limit=10`을 읽어, **최근 12시간 안에 같은 캡션 첫 줄(후킹 문장) 또는 같은 제목을 가진 글이 있으면 발행 취소**하고 `ig_state='native_scheduled'`로 정정한다. (사람이 앱에서 먼저 올린 경우까지 잡는다.)
4. **발행 로그(멱등성)**: `daily/cardnews/publish_log.jsonl`에 `{date, slot, platform, container_id, media_id, at}`를 append. 같은 `(date, slot, platform)`이 이미 있으면 발행하지 않는다. 이 파일은 커밋되어 git 이력이 감사 기록이 된다.
5. **DB 단일 진실**: `ig_state='api_published'`면 재발행 금지. 재시도는 `api_failed`에서만, 최대 3회(`meta.retry` 카운터). 3회 실패는 `api_failed`로 두고 사람에게 넘긴다.

추가:
- **`--force`는 존재하지 않게 만든다.** 사람이 강제로 다시 올려야 하는 상황이면 스탭 화면에서 `ig_state`를 직접 바꾸는 게 아니라, 그 편을 `slot='main2'` 같은 새 행으로 만들어 올린다(기존 행 보존).
- `publish.py`(사이트)와 `publish_ig.py`(발행)는 **서로의 상태를 바꾸지 않는다**. 한쪽이 실패해도 다른 쪽을 막지 않는다.

### 8-9. 실패 시 분기 — 토큰이 없거나 API가 막혔을 때

| 상황 | 파이프라인 동작 | 길아 님이 할 일 |
|---|---|---|
| `IG_ACCESS_TOKEN`/`THREADS_ACCESS_TOKEN` 미설정 | `publish_ig.py`가 `SKIP: no_token`으로 종료, 사이트 발행은 정상 진행. **스탭 화면에 노란 띠**: "발행 토큰 미설정 — §8-2의 6단계를 하면 자동 발행이 켜집니다" | §8-2의 1~6단계(15분, 1회) |
| 토큰 만료(재갱신 실패) | `::error::IG_TOKEN_EXPIRED`, `ig_state='api_failed'` 유지 | Meta 앱에서 토큰 재발급 → Secrets 갱신 → `token_refresh.py --seed` |
| 3:4 거부(`36003`) | **발행 중단**(자동으로 크롭해 올리지 않는다 — 잘린 카드를 올리는 것보다 안 올리는 게 낫다). 단 §8-5 파생본을 쓰면 발생하지 않아야 정상 | Claude Code에 `api/` 파생본 재생성 지시 |
| 협업자 초대 미수락 | 발행은 정상, `@momcal_` 피드에만 안 뜸 | `@momcal_` 계정 앱 알림에서 **수락**(매 편) |
| quota 초과(코드 9/2207042) | 3시간 뒤 재시도(최대 12회) | 없음 |
| API 자체가 막힘(정책 변경) | 폴백: `publish_ig.py --fallback`이 `api_failed` 편을 **스탭 화면 상단 '오늘 바로 올릴 편'으로 승격**하고 자비스에게 알림 신호를 남긴다 | 스탭에서 다운로드 → 앱 업로드 |

- **폴백(토큰 없음)에서도 무토큰 원칙은 유지된다**: 스탭 화면에서 8장 + 캡션 + 첫 댓글 복사 → 사람이 앱에서 업로드. 지금 하는 방식 그대로다. 자동화가 되는 만큼만 자동화한다.

### 8-10. API로 안 되는 것 → 운영 규칙 (반드시 스탭 화면·문서에 명시)

1. **노래(음악) 삽입 불가.** 인스타 Content Publishing API에 오디오 파라미터가 없다. → **노래를 꼭 넣고 싶은 편은 발행 후 인스타 앱에서 직접 음악을 얹는다**(발행된 글 편집에서 음악 추가 가능 여부는 그때 확인). 자동 발행 편은 **무음 릴스/사진 카루셀**이 된다. 이 트레이드오프는 길아 님이 선택한다(§12 보고 참조).
2. **협업자 초대 수락은 `@momcal_` 계정에서 사람이 눌러야 한다**(API 초대만 가능). 앱 알림에서 수락. "항상 허용" 설정이 되면 이후 자동.
3. **발행 후 캡션·이미지 수정 불가**(API). 문구 수정은 발행 전에만. 잘못 올렸으면 지우고 다시(댓글은 지울 수 있다).
4. **Reels·스토리·릴스형 1장 요약은 이 오더 범위 밖**(§7 규격은 카루셀).
5. **API 발행 글에 '예약' 라벨이 남지 않는다** — 실제로 그 시각에 API가 올리므로 인스타 예약함에 쌓이지 않는다. 예약함 확인이 필요하면 `publish_log.jsonl`과 스탭 화면을 본다.

### 8-11. 자비스 쪽 기존 자동화 정리 (파이프라인과 겹치면 중복이 난다)

파이프라인이 켜지면 아래 자비스 스케줄은 역할을 바꾼다. Claude Code는 이 표를 문서에만 남기고, 실제 스케줄 변경은 자비스가 한다.

| 자비스 스케줄 | 지금 | 파이프라인 이후 |
|---|---|---|
| `📸 매일 맘캘 인스타 카드뉴스 준비` (08:30) | 카드·캡션을 매일 생성 | **생성 중단**. 승인 안 된 편이 있으면 "승인 대기 N편"만 알림 |
| `💬 매일 맘캘 인스타 첫댓글 해시태그 자동 등록` (20:05 + 4회) | 브라우저로 첫 댓글 작성 | **중단**. API가 5분 안에 직접 단다. 자비스는 하루 1회 "댓글 달렸는지" 점검만 |
| `📸 주간 맘캘 인스타 콘텐츠 사전 검토` (일 10:00) | 주간 원고·이미지 검토 | **유지**(원고 확정은 사람 몫) |
| `💬 리틀리 얼집/보육 자동DM ON` | 댓글 DM 게이트 | **유지**(리틀리 담당, 이 오더 범위 밖) |

---

## 9. GitHub Actions (무토큰)

네 파일을 새로 만든다. 기존 `daily-card.yml`·`hotdeal-cloud.yml`·`seo-daily.yml` 등은 건드리지 않는다.

### 9-1. `.github/workflows/cardnews-batch.yml`

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

### 9-2. `.github/workflows/cardnews-daily.yml`

```yaml
name: 카드뉴스 당일(DB형) + 승인분 사이트 반영
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
      - name: 승인분 사이트 반영
        env:
          SUPABASE_URL: https://hycaqsqeogjtbscmzrtm.supabase.co
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: python3 -m scripts.cardnews.publish
      - name: 커밋
        run: |
          git config user.name  "momcal-bot"
          git config user.email "noreply@momcalendar.com"
          git add daily/cardnews
          git diff --cached --quiet && echo "바뀐 것 없음" || { git commit -m "카드뉴스 $(TZ=Asia/Seoul date '+%Y-%m-%d') (DB형·사이트 반영)"; git push; }
```

### 9-3. `.github/workflows/cardnews-publish.yml` (★신설 — 인스타·스레드 발행)

```yaml
name: 카드뉴스 인스타·스레드 발행
on:
  schedule:
    - cron: '*/10 2-3 * * 1-5'    # KST 평일 11:00~12:59 창
    - cron: '*/10 9-10 * * 0,6'   # KST 주말 18:00~19:59 창
  workflow_dispatch:
    inputs:
      date: { description: '날짜 YYYY-MM-DD (비우면 오늘)', required: false }
      dry:  { description: 'dry-run (true면 API 호출 없이 판정만)', required: false, default: 'false' }
permissions: { contents: write }
concurrency: { group: cardnews-publish, cancel-in-progress: false }
jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install pillow requests
      - name: 발행 판정 + 발행
        env:
          SUPABASE_URL: https://hycaqsqeogjtbscmzrtm.supabase.co
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          IG_USER_ID:        ${{ secrets.IG_USER_ID }}
          IG_ACCESS_TOKEN:   ${{ secrets.IG_ACCESS_TOKEN }}
          THREADS_USER_ID:   ${{ secrets.THREADS_USER_ID }}
          THREADS_ACCESS_TOKEN: ${{ secrets.THREADS_ACCESS_TOKEN }}
          DRY: ${{ github.event.inputs.dry || 'false' }}
          DATE: ${{ github.event.inputs.date }}
        run: python3 -m scripts.cardnews.publish_ig --dry "$DRY" ${DATE:+--date "$DATE"}
      - name: 발행 로그 커밋
        run: |
          git config user.name  "momcal-bot"
          git config user.email "noreply@momcalendar.com"
          git add daily/cardnews/publish_log.jsonl daily/cardnews/queue.json
          git diff --cached --quiet && echo "바뀐 것 없음" || { git commit -m "카드뉴스 발행 로그 ($(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M'))"; git push; }
```

- 15분 내 실패는 `::error::`로 남기고, 같은 실행에서 **인스타 성공·스레드 실패를 구분**해 기록한다(스레드만 다음 실행에서 재시도).
- 워크플로가 커밋을 푸시하므로 동시에 도는 배치 워크플로와 충돌하지 않게 `concurrency` 그룹을 분리한다. push 충돌 시 `git pull --rebase` 1회 재시도.

### 9-4. `.github/workflows/cardnews-token.yml` (★신설 — 토큰 갱신)

```yaml
name: 카드뉴스 토큰 갱신 점검
on:
  schedule:
    - cron: '10 17 * * 0'      # 일 17:10 UTC = 월 02:10 KST
  workflow_dispatch:
permissions: { contents: read }
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install requests
      - name: 토큰 점검·갱신
        env:
          SUPABASE_URL: https://hycaqsqeogjtbscmzrtm.supabase.co
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          IG_ACCESS_TOKEN:   ${{ secrets.IG_ACCESS_TOKEN }}
          THREADS_ACCESS_TOKEN: ${{ secrets.THREADS_ACCESS_TOKEN }}
        run: python3 -m scripts.cardnews.token_refresh --refresh-if-days 15
```

- 비밀키는 **`secrets.SUPABASE_SERVICE_KEY`** + 위 4개만. 스탭 페이지에는 publishable 키만.
- 워크플로 안에서 새 토큰을 GitHub Secrets에 되쓸 수 없으므로 갱신 결과는 **Supabase `social_tokens`**에 저장한다(§8-3).

---

## 10. 시드 자산 (이미 이 커밋에 들어 있음)

| 파일 | 용도 |
|---|---|
| `scripts/cardnews/_seed/insta_cards.py` | **승인된 실물 렌더러**(11/16 8장을 만든 그 코드). `theme.py` + `render.py`로 옮겨 적는다. 시드 경로는 `scratchpad/…` 기준이므로 `scripts/cardnews/fonts`, `assets/bg`로 바꾼다. |
| `scripts/cardnews/_seed/render_insta_week1.py` | 11/16~11/22 7편 원고+캡션 실물. `episodes/y2026m11.json`으로 옮길 때 **문장을 그대로** 쓴다(이미 길아 님 톤 승인분). 11/16(월)은 이미 발행됨 → `status:"published"`, 렌더 제외. |
| `scripts/cardnews/fonts/Pretendard-*.otf` | CI 렌더용(외부 다운로드 의존 제거) |
| `scripts/cardnews/assets/bg/*.jpg` | 표지 배경 7장(자체 제작 → 출처 표기 없음) |
| `daily/cardnews/queue.json` | 큐 스냅샷 시드(11/16 published + 11/17~11/19 pending + 11/20~11/22 db pending) — Supabase 미연결 시 폴백·개발용. **여기에 §8-8의 5편 `native_scheduled` 표시를 반드시 추가한다.** |

시드 `_seed/` 폴더는 실행 대상이 아니다(참고·이관 원본). 옮긴 뒤 README 한 줄로 "이관 완료 · 원본 보존" 표시.

---

## 11. 30일 콘텐츠 플랜 (주기 고정)

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
- **11/16·11/17·11/18·11/19·11/23은 이미 인스타·스레드 예약이 끝난 편(§8-8)** 이므로 배치가 렌더해도 `publish_owner='jarvis_web'`로 두고 **발행 대상에서 제외**한다. 11/23 자녀장려금 원고는 자비스가 별도 이관한다(이미지 파일은 저장소에 아직 없음 → `needs_assets: true`). 11/20~11/22 DB형은 예약이 없으므로 **파이프라인 발행 대상**이다(그날 06:40 생성 → 길아 님 승인 → 골든타임 자동 발행).
- 이 표 기준으로 **바로 렌더 가능한 날이 22일**이다: 고정 정보형 10편(✅ 3 + 에버그린 7) + DB형 12일. 나머지 **8일(⚠️)은 사실 확인 후 `ready`로 바꾸면 다음 배치가 자동으로 채운다.**
- 이미지가 필요한 표지 배경은 `assets/bg/`의 7장을 돌려 쓴다(주제별 1장 고정 매핑).

---

## 12. 검증 (직접 실행하고 결과를 표로 보고)

| # | 검증 | 방법 | 통과 기준 |
|---|---|---|---|
| V1 | 7일치 큐 조회 | `build_batch --days 30` 실행 후 `cardnews.html?mode=queue` (스탭 로그인) | 11/17~11/23 목록이 상태 배지와 함께 뜬다 |
| V2 | 캡션 수정 → 승인 | 11/17 행 캡션 한 줄 수정 → `[승인]` | DB `status='approved'`, `updated_by` 기록, 목록 배지 즉시 변경 |
| V3 | 승인 전 잠금 | 승인 전 상태에서 저장·복사·발행 버튼 | `disabled` + 미승인 띠 노출, 눌러도 아무 일 없음 |
| V4 | 승인 후 사이트 발행 | `publish.py` 실행 | `caption.txt`가 수정 문구로 바뀌고 `latest.json`이 11/17을 가리킴, 행 `published` |
| V5 | 미승인 편 비노출 | 11/18을 pending으로 둔 채 `latest.json` | 11/18이 절대 가리키지 않는다 |
| V6 | 이미지 규격 | `identify`/PIL로 각 PNG | 전 장 1080×1440, 3:4, 잘림 없음(모서리 픽셀 확인) |
| V7 | 금지 문자 | `lints.py` | 캡션에 `**`·`---` 0건, 카드 텍스트 이모지 0건(`✔` 제외), `#` 0건 |
| V8 | 해시태그 | `lints.py` | 본문 5개, 첫 댓글 20개 |
| V9 | **속지 밀도** | `lints.check_density()` | 모든 속지 bbox 하단이 §4-4 표의 정상 구간(1440: 1170~1240 / 1350: 1097~1162), 위반 0건 |
| V10 | **표지 브랜드 문구** | 11/17 표지 육안 | `공구 · 핫딜 · 세일 · 육아정보 커뮤니티 맘캘린더`가 36px 화이트·그림자/테두리 없이 보인다 |
| V11 | **표지 날짜 뱃지 없음** | 11/17~11/19 표지 3장 육안 + `lints` | 상단 우측에 `26.11.xx 기준` 0건 |
| V12 | 무토큰(LLM) | 워크플로·스크립트 grep | `openai\|anthropic\|claude\|gemini` API 호출 0건, 렌더 입력은 JSON·DB뿐 |
| V13 | 라이브 보존 | `git diff --stat` | `index.html`·`staff.html`·`daily/today.png` 등 무변경 |
| **V14** | **발행 캡션 조립 순서** | `lints.check_caption()` (11/17~11/19) | §6-1 ①~⑭ 순서 위반 0건, 푸터 8줄 문자열 일치, 2,200자 이하 |
| **V15** | **발행용 파생 이미지** | `lints.check_api_images()` | `api/*.jpg` 전 장 1080×1350·JPEG·sRGB·≤8MB, 장수 = PNG 장수 |
| **V16** | **스레드 축약 캡션** | `caption.len_threads()` | 500자 이하(이모지 바이트 계산), 푸터 2줄·CTA 보존 |
| **V17** | **발행 시각 산출** | 30일치 `ig_scheduled_at` 표 출력 | 평일 전부 11:00~12:30, 주말 전부 18:00~19:30, **같은 분 중복 0건**, KST/UTC 변환 오차 0 |
| **V18** | **중복 가드** | 유닛테스트 + `publish_ig.py --dry` | §8-8의 5편이 `SKIP: owner=jarvis_web`로 전부 제외되고, 임의로 `api_pending`을 넣어도 최근 12시간 대조에서 취소된다 |
| **V19** | **토큰 점검** | `python -m scripts.cardnews.token_refresh --check` | 토큰 없으면 `SKIP: no_token`으로 정상 종료(오류 아님), 있으면 `account_type`·만료일 출력 |
| **V20** | **인스타 카루셀 dry-run** *(토큰 있을 때만)* | `publish_ig.py --dry` | 자식·부모 컨테이너 payload가 §8-4와 일치(로그로 확인). 실제 컨테이너 생성은 하지 않는다 |
| **V21** | **스레드 payload dry-run** *(토큰 있을 때만)* | `publish_ig.py --dry` | `text` 500자 이하·`topic_tag='맘캘정보'`·children 개수 일치 |
| **V22** | **발행 로그 멱등성** | 같은 날짜로 두 번 `publish_ig.py` 실행 | 두 번째는 `SKIP: already_published`로 아무 것도 하지 않는다 |

검증 후 보고 형식:

```
V1~V22: 통과/실패/토큰없음(스킵) 표
생성 편수: N편 (fixed N / db N), 평균 렌더 시간
밀도 측정값: 카드별 bottom px 목록(최소/최대)
발행 시각 표: 11/24~12/16 날짜·요일·KST 시각
추가/변경 파일 목록 + 커밋 해시
남은 리스크: (예: 12/15 행사 정보 미확인 / IG 토큰 미설정 / 3:4→4:5 파생본 육안 확인 필요)
```

---

## 13. 하지 말 것 (위반 시 즉시 되돌리고 보고)

1. 라이브 `index.html`·`staff.html` 직접 수정. (`staff_test.html`까지만)
2. 승인 없이 `latest.json` 변경, `pending` 편을 "오늘의 카드뉴스"로 노출.
3. **승인 없이, 또는 §8-7 시각 전에 인스타·스레드에 발행.** (`publish_ig.py`의 5중 가드 우회 금지, `--force` 신설 금지)
4. **§8-8의 5편(11/16 20:00 · 11/17 11:15 · 11/18 11:40 · 11/19 12:10 · 11/23 11:20)을 파이프라인이 다시 올리는 것.** 이 5편은 `publish_owner='jarvis_web'`으로 고정한다.
5. 금액·기한·순위 창작. `facts.sources` 없는 원고 렌더.
6. **토큰·service key를 저장소·스탭 페이지·로그에 남기는 것.** (publishable 키만 화면에, 액세스 토큰은 GitHub Secrets·Supabase `social_tokens`에만)
7. **브라우저 자동화로 인스타에 로그인·업로드하는 코드 추가**(약관 위반·계정 정지 위험). API만 쓴다.
8. **3:4 PNG를 인스타 API에 그대로 보내기 / 잘라서 올리기.** 반드시 §8-5 파생본을 만든다.
9. AI API 호출·이미지 생성 API 사용.
10. 기존 `daily/cardnews/2026-11-16/` 8장·`cardnews.html` 기존 기능 삭제(확장만).
11. `cardnews_queue`·`social_tokens` RLS 끄기, anon 쓰기 허용.

## 14. 되돌리기

- **발행만 끄기(가장 먼저 할 일)**: `cardnews-publish.yml`의 `on:`을 `workflow_dispatch`만 남긴다. 배치·사이트 반영은 계속 돈다. 이미 예약된 5편은 인스타 자체 예약이라 영향 없다.
- 파이프라인 전체 끄기: `cardnews-batch.yml`·`cardnews-daily.yml`도 같은 방식으로.
- 게이트 문제 시: `cardnews.html`을 이 커밋 이전 버전으로 되돌리고 `queue.json` fallback만 남긴다(기존 8장 다운로드는 계속 동작).
- DB: `cardnews_queue` 테이블은 남겨두고 `status`를 모두 `pending`으로 되돌린다(데이터 삭제 금지). **`ig_state='api_published'` 행은 건드리지 않는다**(이미 인스타에 있는 글이다 — 되돌리면 다음 실행에서 중복 발행된다).
- 토큰 폐기: Meta 앱에서 토큰을 무효화하면 파이프라인은 `no_token`으로 안전하게 멈춘다.
