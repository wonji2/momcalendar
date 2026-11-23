# ORDER — 사이트 핫딜 폴센트형 전환 (1단계 정리 · 2단계 90일 최저가 판정)

작성 2026-11-23 (월) 17:20 KST · 자비스 · 기준 커밋 `f5b21147`(main, 2026-11-23 16:24 KST)
대상 저장소 `wonji2/momcalendar` · 작업자 = 클로드 코드
근거 실측 `handoffs/🔍-맘캘-핫딜-구조-실측-및-결함-진단/핫딜-구조-실측-결함진단-2026-11-23.md` (11-23 16:30 KST)

## 길아 님 확정 지시

> "카톡방 잘 구현이 안돼서 버렸어ㅠ 입력이 안돼서 그냥 일단 사이트 구현 말이야"
> "글고 폴센트처럼 3개월 이내 최저가 정도는 모아야할듯"
> "쿠팡은 보수적으로해 한번만 더 걸리면 영정임" (2026-11-23, 이 오더의 최우선 제약)

**이 오더의 경계**: 카톡 발송·도쿄 VM·`kakao_pc_hotdeal_sender.py` 는 **범위 밖**이다. 손대지 않는다.
사이트(`momcalendar.com` 핫딜 탭)의 **품질·판정·데이터 축적**만 한다.

---

## 실행 명령 (길아 님이 클로드 코드에 붙여넣는 1줄)

```
claude "orders/ORDER_HOTDEAL_POLCENT_2026-11-23.md 끝까지 읽고 §1 표부터 실제 파일과 대조한 뒤 §2(쿠팡 예산) → §3·§4(1단계) → §5·§6(2단계) 순서로 구현하고, §8 V1~V22 를 실제로 돌려 표로 보고해. index.html 은 test.html 선검증을 통과한 뒤에만 같은 패치로 승격하고, 커밋은 A~H 로 나눠 올려. git add -A 금지"
```

레포 루트(`wonji2/momcalendar` 체크아웃)에서 실행한다. PowerShell 스크립트는 UTF-8 BOM 으로 저장한다(저장소 규칙).

---

## 1. 지금 상태 — 착수 전에 이 표부터 실제 파일·DB와 대조하라 (11-23 16:52 KST 실측)

공개 REST(`hotdeals`, publishable key) 916행 · 코드 4개 파일 · 깃허브 실행 로그로 잰 값이다. **숫자가 다르면 그 자리에서 멈추고 보고한다**(코드가 이미 바뀌었을 수 있다).

| 항목 | 실측값 | 근거 |
| --- | --- | --- |
| 노출 중(만료 전) | **916건** | REST `hotdeals?or=(pin_random.is.true,expires_at.is.null,expires_at.gt.now())` |
| `price_status` | **unknown 916 / 916 (100%)** | 가격을 한 번도 다시 재지 않았다 |
| `is_lowest=true` | **11건 (1.2%)** | 그중 `lp_*` 2건 |
| `price_before` 없음 | **709 / 916 (77%)** | 할인율 계산 불가 |
| `discount_rate` 없음 | **701 / 916 (77%)** | 「급하락순」 정렬이 사실상 무력 |
| `product_id` 없음 | **50건** | 네이버 브랜드커넥트 |
| 출처 | linkprice 492 · toss 242 · coupang 72 · naver 50 · ohouse 48 · 3hoursahead 12 |  |
| 몰 | 지마켓 263 · 토스 242 · 롯데온 95 · 쿠팡 72 · 옥션 63 · 11번가 58 · 네이버 50 · 오늘의집 48 · 야놀자 11 · GS샵 7 · SSG 4 · 클룩 1 |  |
| 상품키 접두사 | `jirum_` 467 · `toss_` 242 · `cp_` 61 · (없음) 50 · `oh_` 48 · `lp_` 19 · `nol_` 11 · `bbhd_` 6 · `숫자_숫자` 11 · `klook_` 1 | **키가 경로마다 다르다** |
| 가격 이력 있는 키 | `6636188191_13352606475`(10일) · `lp_11st_3084309385`(21일)는 있음. **`cp_6810407988`·`jirum_40618324` 는 `hotdeal_chart2` → `[]`** | 이력이 붙는 키는 3.3%뿐 |
| 오늘 등록 | 94건 (16:52까지) | 11-20 371 · 11-21 280 · 11-22 297 |
| 오늘 회차 로그 | `[source:jirum] 끝 — 새 글 39~44 · 연 것 20 · 등록 0~4 · 건너뜀 {쿠팡 딥링크 상한: 9~14, 우리 링크로 못 바꾸는 몰·주소: 4~9, 가격 없음: 1~7}` | 실행 45078066860 |
| 쿠팡 쿼터 | **오전에 15건을 다 써서 오후 쿠팡 딜은 하루 종일 버려진다** | 위 「쿠팡 딥링크 상한」 9~14건/회차 |
| 지름알림 레코드 필드 | `isYearLowest`(bool, 샘플 4건 모두 false) · `categoryName`("생활·식품"·"디지털"·"기타") · `postedAt` · `price`(제보 문구의 **체감가**. 예: 오늘의집 쿠폰 3중 적용 후 34,171원) | `jirum_record()` 가 이미 이 객체를 통째로 읽는다 |
| 실측 재확인 가능 몰 | **토스만 확인됨**(`toss-sync?mode=track` 이 이미 price_history 에 쓰고 카드 가격도 갱신) | 오늘 curl: `store.ohou.se` **403**, `ohou.se` **403**, 롯데온 403, 11번가 연결 실패(000), 옥션 200·파싱 실패, 지마켓 200·쿠폰가 미반영 |
| 쿠팡 호출 | 딥링크: 회차 5 · 하루 15 · 프로세스 10 · 간격 2.1초(`baby_hotdeal_auto.py:468~486, 528~530, 878~887`). 판정엔진: 키워드 20 + 재추적 20 = 40/일 · 2초(`supabase/functions/coupang-hotdeal/index.ts:44~46`). **베이비핫딜 경로는 회차 10·일 상한 없음**(`:1139`, `:1204→1018`) | 지금은 bbhd 새 글 0건이라 실제 0 |
| 화면 | `limit=500` 3곳(`index.html:4035, 4978, 11144`) · 상품 42 가격 덮어쓰기(`index.html:4984`, `test.html:5046`) · 정렬 `discount_rate` 기준(`:5235~5240`) · 중복 제거가 **제목+가격**(`:5324`) | 500 < 916 이라 416건이 조용히 안 보인다 |

**한 줄 진단**: 링크·수집·은폐는 이미 폴센트급이다. 빠진 것은 **판정·만료·노출·이력**이고, 새로 짜는 게 아니라 이미 있는 판정 부품을 대량 수집 경로에 붙이는 일이다.

---

## 2. [P0] 쿠팡 호출 예산 — 초보수. 이 장을 가장 먼저 구현한다

### 2-1. 왜 이게 1번인가

쿠팡 파트너스 API 가 **한 번만 더 제재되면 영구 정지(영정)** 다(길아 님 2026-11-23). 그런데 지금 코드는 제재를 부르는 구조가 세 군데 있다.

1. `_CP_DL_CALLS` 가 **프로세스 지역 변수**다. 회차마다 새 프로세스라 상한이 매번 0부터 다시 센다(`:388, :471~478, :994~999`). 회차 안에서만 10회를 막을 뿐, 하루 총량은 서버 상태(`st['cp']`)에만 의존한다 — 그 상태 저장이 실패하면 상한이 사라진다(`jirum_state_save` 예외는 로그만 찍고 넘어간다).
2. **베이비핫딜 경로는 일 상한이 없다**(`:1139`). 15분 회차 × 10회 = 이론상 하루 960회. 지금은 새 글이 0건이라 0이지만, 게시판이 살아나는 날 바로 터진다.
3. 사진검색(`coupang_main_image`)이 딥링크와 **같은 카운터**를 나눠 쓴다. 어느 쪽이 예산을 먹었는지 로그로 구분되지 않는다.

### 2-2. 절대 규칙 (숫자를 바꾸지 말 것)

| 규칙 | 값 | 비고 |
| --- | --- | --- |
| 딥링크 하루 상한 | **15건 유지** | **올리지 않는다.** 이전 계획의 "50건 상향"은 폐기됐다 |
| 회차 상한 | 5건 (`JIRUM_CP_RUN`) 유지 |  |
| 호출 간격 | **2.1초 이상 유지** | 줄이면 1분 한도(50회)를 넘겨 차단된다. 2026-08-03 사고 원인이 속도였다 |
| 수집기 몫 하루 총합 | **15건** (딥링크+사진검색+재확인 **모두 합쳐서**) | 사진검색은 그중 최대 3건 |
| 판정엔진(함수) 몫 | 40건/일 유지 (키워드 20 + 재추적 20) |  |
| **두 몫 합계 하드 캡** | **55건/일** | 넘으면 그날 쿠팡 호출 전면 중단 |
| 재확인(FIFO)에서 쿠팡 신규 호출 | **0건** | 재확인은 판정엔진 몫만. 수집기는 쿠팡 가격을 다시 묻지 않는다 |

### 2-3. 구현 ①서버 원자 카운터 — `supabase/sql/hotdeal_polcent_185.sql`

프로세스 변수 대신 **DB에서 원자적으로 세고 거부**한다. 이게 하드 캡의 유일한 보장이다.

```sql
-- 2026-11-23 쿠팡 호출 예산 (길아 님 "한 번만 더 걸리면 영정") — 서버 원자 카운터
create or replace function public.coupang_budget_take(p_kind text default 'deeplink', p_cap int default 15)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st jsonb; d text := (now() at time zone 'Asia/Seoul')::date::text;
begin
  perform pg_advisory_xact_lock(hashtext('coupang-budget'));           -- 동시 회차가 겹쳐도 합계가 새지 않게
  select payload into st from ops_status where id = 'coupang-budget' for update;
  st := coalesce(st, '{}'::jsonb);
  if st->>'day' is distinct from d then                                  -- 날짜(KST)가 바뀌면 리셋
    st := jsonb_build_object('day', d, 'total', 0, 'deeplink', 0, 'image', 0, 'recheck', 0);
  end if;
  if coalesce((st->>'blocked_until')::timestamptz, 'epoch'::timestamptz) > now() then
    return jsonb_build_object('ok', false, 'reason', 'blocked',
      'blocked_until', st->>'blocked_until', 'used', coalesce((st->>'total')::int, 0), 'cap', p_cap);
  end if;
  if coalesce((st->>'total')::int, 0) >= least(p_cap, 55) then
    return jsonb_build_object('ok', false, 'reason', 'cap',
      'used', coalesce((st->>'total')::int, 0), 'cap', least(p_cap, 55));
  end if;
  if p_kind = 'image' and coalesce((st->>'image')::int, 0) >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'image_cap',
      'used', coalesce((st->>'image')::int, 0), 'cap', 3);
  end if;
  st := jsonb_set(st, array['total'], to_json(coalesce((st->>'total')::int, 0) + 1));
  st := jsonb_set(st, array[p_kind], to_json(coalesce((st->>p_kind)::int, 0) + 1));
  insert into ops_status(id, payload, updated_at) values ('coupang-budget', st, now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now();
  return jsonb_build_object('ok', true, 'used', (st->>'total')::int, 'cap', least(p_cap, 55),
                            'kind', p_kind, 'kind_used', (st->>p_kind)::int, 'day', d);
end $$;

create or replace function public.coupang_budget_block(p_reason text, p_hours int default 6)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st jsonb; d text := (now() at time zone 'Asia/Seoul')::date::text; until_ts timestamptz;
begin
  until_ts := now() + (greatest(coalesce(p_hours, 6), 1) || ' hours')::interval;
  select payload into st from ops_status where id = 'coupang-budget' for update;
  st := coalesce(st, '{}'::jsonb);
  if st->>'day' is distinct from d then st := jsonb_build_object('day', d, 'total', 0, 'deeplink', 0, 'image', 0, 'recheck', 0); end if;
  st := jsonb_set(st, array['blocked_until'], to_json(until_ts));
  st := jsonb_set(st, array['last_error'], to_json(coalesce(p_reason, '')));
  insert into ops_status(id, payload, updated_at) values ('coupang-budget', st, now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now();
  insert into health_alerts(kind, detail)
    values ('hotdeal:쿠팡한도', left('쿠팡 호출을 멈췄다 — ' || coalesce(p_reason, '') || ' · 차단 ' || p_hours || '시간', 300));
  return st;
end $$;

revoke all on function public.coupang_budget_take(text, int) from public, anon, authenticated;
revoke all on function public.coupang_budget_block(text, int) from public, anon, authenticated;
grant execute on function public.coupang_budget_take(text, int) to service_role;
grant execute on function public.coupang_budget_block(text, int) to service_role;
```

### 2-4. 구현 ②수집기 단일 관문 — `tools/daily/baby_hotdeal_auto.py`

1. 모듈 전역 `_CP_STOP = False`(그 회차 쿠팡 호출 전면 중단 스위치)와 `_CP_FAILS = 0`(연속 실패)를 둔다.
2. `cp_take(kind, cap=15)` 를 만든다 — `run_sql("select public.coupang_budget_take('deeplink', 15) as r;")` 결과 `ok=false` 면 `False`. **이 함수를 통과하지 않은 쿠팡 호출은 코드에 존재하지 않게 한다.**
3. `get_coupang_deeplink()`(`:468`) 첫 줄에서 `_CP_STOP` 확인 → `cp_take('deeplink')` 통과 시에만 진행. 기존 `_CP_DL_CALLS >= 10` 조건은 **보조로만** 남긴다(주 방어선은 서버).
4. `coupang_main_image()`(`:992`)도 `cp_take('image')` 를 통과해야 한다. **지름알림 쿠팡 딜은 이미 사진검색을 안 쓴다**(`:926`) — 이 동작 유지(쿼터를 사진에 쓰지 않는다).
5. **429/오류 처리**:
   - 응답 코드 429, 또는 본문/헤더에 `429|Too Many|rate limit|quota|LIMIT_EXCEEDED` 가 보이면 → `coupang_budget_block('429 ...', 6)` 호출, `_CP_STOP = True`, 그 회차의 남은 쿠팡 호출 전부 건너뛴다(다른 몰 수집은 계속).
   - 타임아웃·5xx 가 **3회 연속**이면 `coupang_budget_block('연속 실패 3회: <마지막 오류>', 3)`, `_CP_STOP = True`.
   - 차단 상태에서는 `get_coupang_deeplink` 가 서버에서 거부되어 `None` 을 돌려준다 → 그 딜은 `keep=True` 로 넘기지 않고 **seen** 처리(상태 저장으로 재시도 폭주를 막는다. §4-2 의 상한과 같은 규칙).
6. 간격: 호출 사이 `time.sleep(2.1)` 유지(`:474`). 사진검색도 같은 간격을 지난다(`:997`). **2초 미만 금지.**
7. 베이비핫딜 경로(`:1139`)도 같은 `get_coupang_deeplink` 를 쓰므로 위 관문이 자동 적용된다. **일 상한이 없던 구멍이 이걸로 닫힌다.**

### 2-5. 구현 ③쿼터 배분 — 15건을 하루에 나눠, 가치 높은 것에만

지금은 오전에 15건을 다 써서 오후 쿠팡 딜이 전부 버려진다(오늘 회차 로그 실측). 상한을 못 올리니 **아껴 쓰는 수밖에 없다.**

- **시간대 누적 상한**(KST): 06시 전 0 · 06~12시 4 · 12~18시 9 · 18~24시 15. (회차 상한 5는 유지)
- **후보 우선순위 점수** — 회차에 모인 쿠팡 후보를 점수 내림차순으로 정렬한 뒤 상위부터 호출한다.

| 조건 | 점수 |
| --- | --- |
| 육아 핵심어(기저귀·분유·이유식·물티슈·젖병·유모차·카시트·아기·유아·키즈·장난감) | +3 |
| 생필품(커피·생수·휴지·세제·샴푸·치약·계란·김·미역·쌀·라면·참치·간식·생활) | +2 |
| 가격 10,000~70,000원 | +1 |
| 품목 밖 분류(`_JIRUM_SKIP_CATS` — 디지털·게임·자동차·골프·캠핑·상품권 등) | −3 |
| 같은 날 같은 몰에서 이미 3건 등록 | −2 |

- 점수 **≤ 0** 이면 **호출하지 않고 seen 처리**(keep 금지), `stats['쿠팡 쿼터 아껴 건너뜀'] += 1`.
- 쿼터가 소진되면 `stats['쿠팡 쿼터 소진']` 에 시각을 남기고, 그날 처음 소진될 때 `health_alerts kind='hotdeal:쿠팡쿼터'` 상세 `"15/15 소진 HH:MM — 남은 쿠팡 후보 N건 폐기"`.
- 🔴 **쿼터가 없다고 지름알림의 구매 주소를 그대로 저장하는 우회는 절대 금지**(수집기 헌법). 못 올리면 버린다.

### 2-6. 구현 ④문서·주석 정리

- `tools/daily/baby_hotdeal_auto.py:522` 주석 "쿠팡 API 는 하루 40회 불변…" → 실제 예산 표로 교체:
  `# 쿠팡 예산(2026-11-23): 판정엔진 함수 40(키워드20+재추적20) + 수집기 15(딥링크·사진·재확인 합계) = 하루 55 하드 캡. 서버 카운터 coupang_budget_take 가 최종 방어선. 영정 위험으로 어떤 이유로도 늘리지 않는다.`
- `.github/workflows/hotdeal-cloud.yml:13` "쿠팡 딥링크는 …회차당 10회" → `회차 5 · 하루 15 · 서버 원자 카운터(함수 40과 합계 55 상한)`.
- 같은 줄의 **미존재 파일 언급**(`tools/daily/hotdeal_cloud_fallback.mjs`) 삭제 — 저장소에 그 파일이 없다(실측).

---

## 3. [1단계] 화면·노출 정상화

### 3-1. 만료를 소스·제목·`isEnd` 기준으로 (3일 고정 제거)

지금은 지름알림·베이비핫딜 INSERT 가 `now() + interval '3 days'` 고정이다(`:935`, `:1216`). 끝난 딜이 사흘 남고, 5일짜리 딜은 사흘 만에 사라진다.

`hd_expires_at(rec, raw_title)` 를 만들어 순서대로 정한다:

1. `rec['isEnd'] is True` → **등록하지 않는다**(이미 그렇게 하고 있다).
2. 제목 기간문구(`hd_period_end`)가 있으면 → **그날 23:59:59 KST**.
3. 지름알림 `postedAt` 이 있으면 → `postedAt + 36시간`.
4. 그 밖 → `now() + 36시간`.
5. 상한: `min(계산값, now() + 72시간)`.

### 3-2. 같은 상품 중복 방지 — **72시간 유지** (단축 부작용 차단)

지금 중복 판정은 `expires_at > now() AND price <= price` 라서 사실상 "3일"이었다. 만료를 36시간으로 줄이면 **중복 판정 창도 36시간으로 짧아져** 같은 딜이 다시 올라온다. 그래서 기준을 따로 못 박는다.

- 같은 `product_key`(2단계 전에는 `product_id`)가 **최근 72시간 안에 등록됐으면** 등록하지 않는다:
  `AND NOT EXISTS (SELECT 1 FROM public.hotdeals WHERE product_key = <key> AND created_at > now() - interval '72 hours')`
- 같은 링크(`link`) 중복 판정도 `created_at > now() - interval '72 hours'` 로 바꾼다.
- 더 싼 값이면 예전처럼 기존 행을 만료시키고 새로 올린다(유지).

### 3-3. 노출 상한은 **500 그대로**

`index.html:4035 · 4978 · 11144`(및 `test.html` 의 같은 3곳)의 `limit=500` 을 **올리지 않는다**. Egress·첫 화면 성능 때문에 500 이 상한이다.
36시간 만료로 바뀌면 하루 300건 기준 활성 ≈ 450건이라 500 안에 다 들어온다(11-20 371 · 11-21 280 · 11-22 297 실측). 지금 쌓인 916건은 만료가 3일로 박혀 있어 **자연 소진에 2일** 걸린다 — 기존 행을 손대지 않는다(급히 줄여야 하면 사장님 승인 후 별도 실행).

### 3-4. 정렬·뱃지를 데이터에 맞게 (정직)

1. **기본 정렬을 `judge`(판정딜 우선 + 최신순)로 추가**한다. `_hdCurrentSort` 기본값을 `'judge'` 로, 드롭다운(`hdSortDropdown`)에 「판정딜」 항목과 기본 라벨을 넣는다.
   정렬 키: `score = (is_lowest ? 2 : 0) + (price_status === 'measured' || price_status === 'reported' ? 1 : 0)` → 같으면 `created_at` 내림차순.
2. **「급하락순」은 `discount_rate` 가 null 인 카드를 빼고** 정렬한다(77%가 null 이라 지금은 이름만 급하락순). 빼고 나서 8장 미만이면 그때만 나머지를 뒤에 붙인다.
3. 「인기순」(`is_lowest`)은 그대로.
4. 뱃지: 1단계에서는 지금 그대로(`is_lowest` → 「역대최저」, 11건). 2단계에서 `judge_basis='measured'` 일 때만 「역대최저」, `'reported'` 면 「제보가 최저」 작은 태그로 바꾼다(§6-3·§6-4).
5. 중복 카드: `hdDedupe`(`:5324`)가 제목+가격 기준이라 같은 상품이 값만 달라도 2장 뜬다(실례: 명장 김치찌개 19,910/20,890). **2단계에서 `product_key` 로 묶고 싼 쪽만** 남긴다. 1단계에서는 키가 안 붙으므로 손대지 않는다.

### 3-5. 하드코딩 제거

- `index.html:4984` 와 `test.html:5046` 의 `if(item.id === 42 && item.price === 8800) item.price = 9900;` **삭제**.
  대체는 DB 값으로 한다(§4-4). 클라이언트가 특정 상품 가격을 덮어쓰는 코드는 남기지 않는다.
- `main()` 의 하드코딩 만료 SQL(`:1406`, id 2012/1885/1884/1936) **삭제** — 이미 끝난 일회성 작업이 매 회차 돈다.
- **매 회차 돌던 정비를 하루 1회로 내린다**(공구 표를 15분마다 만지지 않게). KST 날짜가 바뀐 첫 회차에만 실행하고, 상태에 마지막 실행 날짜(`hotdeal-housekeeping`)를 남긴다:
  - `clean_polluted_gonggu_titles()`(`:1395` 호출, `:490` 정의 — 공구 표를 만진다)
  - `purge_old_history()`(`:1400` 호출, `:499` 정의 — 180일 삭제)
  - `run_fix_thumbnails()`(`:1364` 정의 — 하드코딩 id 사진 교체)
  로직은 바꾸지 않고 **실행 빈도만** 내린다(같은 UPDATE 를 반복하던 것이라 결과는 같다).

### 3-6. 이번 범위 아님 (다음 오더)

- 판매처 칩에 옥션·SSG·GS샵·CJ온스타일 추가(노출 중 63·4·7·1건인데 칩이 없다) — UI 변경량이 커서 분리.
- 세시간전·야놀자·클룩 12건(정가만, 핫딜 아님) 노출 여부 — 사장님 결정 대기.
- 카톡 발송 — 범위 밖.

---

## 4. [1단계] 수집·분류·재시도

### 4-1. 분류 기본값 보강 (리빙 42% → 25% 이하)

`classify_category()` 의 마지막 기본값 `return '리빙','생활용품'`(`:294`, `:756`)이 사실상 「분류 실패」다. 그 앞에 키워드를 넣는다. **소분류는 사이트 `CATS` 에 있는 것만 쓴다**(없는 이름을 만들면 칩에서 안 보인다 — `index.html:3060~3071`).

| 키워드 | 대분류 | 소분류 |
| --- | --- | --- |
| 커피·원두·캡슐·생수·탄산수·주스·두유 | 식품 | 음료/차/즙 |
| 김·미역·건어물·멸치·황태·참치캔 | 식품 | 수산물/건해산 |
| 계란·달걀·닭가슴살·삼겹·소고기 | 식품 | 정육/계란 |
| 쌀·잡곡·현미·견과·아몬드 | 식품 | 과일/야채 · 견과류 |
| 휴지·키친타올·행주·수세미 | 리빙 | 생활용품 |
| 세제·섬유유연제·얼룩제거 | 리빙 | 청소/세제 |
| 수납·정리함·행거·선반 | 인테리어 | 수납정리 |
| 커튼·러그·이불·베개 | 인테리어 | 패브릭 |
| 드라이기·고데기·전기면도기 | 가전 | 생활가전 |
| 에어프라이어·전기밥솥·믹서기 | 가전 | 주방가전 |
| 세럼·앰플·토너·크림·마스크팩 | 뷰티 | 스킨케어 |
| 샴푸·컨디셔너·트리트먼트 | 뷰티 | 헤어케어 |
| 배변패드·고양이모래·사료·펫간식 | 반려동물 | 사료 · 간식 |
| 문구·노트·필기구 | 리빙 | 생활용품 |

- 지름알림 `categoryName` 도 같이 쓴다: `생활·식품` → 제목 판정 우선(모르면 리빙/생활용품), `디지털` → 가전/취미·디지털기기, `기타` → 제목 판정.
- 측정: 다음 회차 500건 표본에서 `리빙/생활용품` 비중이 **25% 이하**인지 확인(V8). 안 되면 키워드를 더 넣는다(임의로 눈대중 넘기지 말고 수치로).

### 4-2. `keep=True` 무한 재시도를 유한으로

지금은 상한·일시 실패로 건너뛴 글을 `seen` 에 넣지 않아(`skip(..., keep=True)`, `:820~825`) **매 회차 같은 글을 다시 열고**, RSS 50건 창을 벗어나면 영구 소실된다(오늘 회차당 9~14건).

- 상태에 `st['keep'] = {pid: {'n': 횟수, 'first': ISO시각}}` 를 둔다.
- `keep` 재시도가 **3회 또는 6시간**을 넘으면 keep 하지 않고 `seen` 처리 + `stats['재시도 초과 폐기'] += 1`.
- `st['keep']` 은 최근 200건만 남긴다(상태 크기 상한).
- 목적은 "버리지 않기"가 아니라 **"무한정 붙잡지 않기"** 다. 못 올린 딜은 못 올린 것으로 세고 넘어간다.

### 4-3. 회차당 상세 상한

`JIRUM_MAX_NEW = 20` → **30**(`:528`). 새 글의 44%를 아예 열어보지도 않던 손실을 줄인다. 상세 요청 간격 1~2초(`:829`)는 그대로. **쿠팡 쿼터와는 무관**하다(쿠팡 호출은 §2 관문이 따로 막는다).

### 4-4. DB 값 정리 (하드코딩 대체)

- `id=42` 상품: 실제 가격을 확인해 `UPDATE public.hotdeals SET price = <확인값> WHERE id = 42;`. **확인 못 하면 값을 추정하지 말고** `expires_at = now()` 로 내린다(틀린 값 노출 금지).

### 4-5. 감시 — 지금 없는 것만 추가

기존 `supabase/sql/jirum_collect_watch_135.sql` 이 **6시간 성공 기록 없음·24시간 등록 0건**을 이미 잡는다. 같은 경보를 또 만들지 않는다. 새로 필요한 것만:

- **쿠팡 쿼터 소진**(오늘처럼 오전에 15건을 다 쓰는 경우): 그날 처음 소진될 때 `health_alerts kind='hotdeal:쿠팡쿼터'` — `"15/15 소진 HH:MM — 남은 쿠팡 후보 N건 폐기"`.
- **쿠팡 차단**: `coupang_budget_block` 이 넣는 `hotdeal:쿠팡한도`(§2-3). 이게 뜨면 사람이 파트너스 콘솔을 본다.
- **정체**: `ops_status 'jirum-collect'` 의 `ok=false` 가 6시간 이어지는 경우 — 기존 감시가 `ok` 를 보므로 **중복이면 만들지 않고**, 실제로 비어 있는 경우에만 한 줄 추가한다.
- `ops.html` 알림 목록에서 위 3종이 보이는지 확인(V20).

---

## 5. [2단계] 상품키 통일 — 폴센트 구조의 토대

### 5-1. 규칙

`product_key = '<mall_code>:<product_no>'`

| 몰 | mall_code | 상품번호 출처 |
| --- | --- | --- |
| 쿠팡 | `coupang` | `vp/products/<no>` · `cp_<no>` · `<no>_<itemId>` 의 앞부분 |
| 지마켓 | `gmarket` | `goodscode=<no>` (8~10자리) |
| 옥션 | `auction` | `itemno=A<no>` |
| 11번가 | `11st` | `products/<no>` |
| 롯데온 | `lotteon` | `p/product/LO<no>` |
| SSG | `ssg` | `itemId=<no>` |
| GS샵 | `gsshop` | `prdid=<no>` |
| CJ온스타일 | `cjonstyle` | `p/item/<no>` |
| 올리브영 | `oliveyoung` | `goodsNo=A<no>` |
| 토스 | `toss` | `toss.shopping/i/<no>` · `t/<no>` |
| 오늘의집 | `ohouse` | `productions/<no>` · `goods/<no>` |
| 네이버 브랜드커넥트 | `naver` | 링크의 상품 id (없으면 비운다 — 지어내지 않는다) |
| 야놀자·클룩·세시간전 | `yanolja` `klook` `3hoursahead` | 각자 번호 (`track=false`) |

### 5-2. 스키마 추가 — `supabase/sql/hotdeal_polcent_186.sql`

```sql
alter table public.hotdeals
  add column if not exists product_key text,
  add column if not exists mall_code   text,
  add column if not exists option_no   text,
  add column if not exists key_src     text,               -- backfill | collector | engine | unknown
  add column if not exists judge_stage text,               -- none | collecting | provisional | confirmed
  add column if not exists judge_basis text,               -- none | measured | reported | mixed
  add column if not exists avg_price   integer,
  add column if not exists min_price   integer,
  add column if not exists drop_pct    integer,
  add column if not exists judge_at    timestamptz,
  add column if not exists track       boolean not null default true;   -- 여행·정가 상품은 false

alter table public.price_history
  add column if not exists product_key text,
  add column if not exists src text not null default 'measured';        -- measured | reported

create index if not exists hotdeals_product_key_idx on public.hotdeals (product_key, created_at desc);
create index if not exists price_history_key_day_idx on public.price_history (product_key, day);
```

- **유니크 인덱스는 만들지 않는다**(지금 중복 행이 있을 수 있다). 필요하면 중복 정리 뒤 별도 판단.
- `price_status` 는 이미 있다(`hotdeal_stage1_131.sql`). 값 정의를 못 박는다: `unknown | reported | measured | soldout`.
- **한 번에 `unknown` 을 없앤다**(11-23 실측 916/916 unknown). 값의 출처로 가른다 — 몰 API 가 준 값은 `measured`, 사람이 쓴 제보가를 옮긴 것은 `reported`:

```sql
update public.hotdeals set price_status = case
    when product_id like 'cp\_%' then 'reported'                 -- 지름알림 경유 쿠팡 = 제보가(몰 확인 아님)
    when source in ('coupang','goldbox','toss','adpick') then 'measured'
    else 'reported' end
 where price_status = 'unknown';
```

### 5-3. 백필 — `tools/daily/hotdeal_key_backfill.py`

기존 함수를 **재사용**한다(`jirum_origin_url`, `_JIRUM_ID_RULES`, `resolve_coupang_pid`). 새 정규식을 새로 쓰지 않는다.

- `--dry`: 활성+최근 60일(약 2만행)을 200건씩 읽어 `product_key` 계산 → **매핑표·키 없음·충돌** 3개 표를 찍고 아무것도 쓰지 않는다.
- `--apply`: 같은 계산으로 `PATCH hotdeals` / `PATCH price_history`(product_key 만).
- 규칙: 계산 실패한 행은 건드리지 않고 `key_src='unknown'`. 추정 금지.
- 충돌(같은 키에 서로 다른 상품명)은 **보고만** 한다. 자동 병합 금지.
- 실행 순서: dry 결과를 보고서에 붙이고 → 사장님/자비스 확인 → apply. apply 뒤에도 키 없음 건수를 다시 센다.
- **전환 직후 구·신 키 중복 정리**: 백필 뒤 같은 `product_key` 로 활성 행이 2건 이상인 것을 뽑아, **싼 쪽만 남기고 비싼 쪽 `expires_at = now()`** 로 내린다(실례: 명장 김치찌개 19,910/20,890, 천연사이다 제로 10,120/11,900). 행을 지우지는 않는다 — 만료만.
- **지름알림 레코드 필드 점검**(재확인만): `jirum_record()` 가 돌려주는 객체에 `isYearLowest`(bool) · `categoryName` · `postedAt` · `price` 가 **있다**(11-23 표본 4건). `isYearLowest=true` 는 **보조 표기**로만 쓰고 `is_lowest` 승격 근거로 쓰지 않는다(§6-3). 없는 필드를 찾아 헤매지 말 것 — 있으면 위 4개다.

### 5-4. 새 수집분은 처음부터 키를 채운다

- 지름알림·베이비핫딜: `jirum_<pid>`/`bbhd_<wr_id>` 대신 **계산한 `product_key` 를 `product_id` 로도 쓴다**(지름알림 글 번호는 상품 신원이 아니다 — 재게시되면 새 키가 된다).
- 판정엔진(쿠팡·링크프라이스)·토스·네이버: 각자 `product_key` 를 채운다. `option_no` 는 쿠팡 옵션 id 를 보존한다.
- `track=false` 대상: 여행(야놀자·클룩·세시간전) — 가격 판정 대상 아님.

---

## 6. [2단계] 90일 이력 · 판정 엔진 · 표시

### 6-1. 1일 1행 upsert — 모든 수집 경로

| 경로 | 언제 | `src` |
| --- | --- | --- |
| 지름알림·베이비핫딜(제보) | 등록 직전 `price_history?on_conflict=product_id,day` | `reported` |
| 판정엔진(쿠팡·링크프라이스) | 판정 회차 | `measured` |
| 토스 재확인 | `toss-sync?mode=track` (이미 쌓고 있다) | `measured` |

- 행 형태: `{product_id: <가장 정밀한 키>, product_key, day: 오늘(KST), price, src}`
- **등록할 때 `price_status` 도 같이 쓴다**: 몰 API 가 준 값이면 `measured`, 제보가를 옮긴 것이면 `reported`(새 행이 `unknown` 으로 시작하지 않게).
- **하루 1행 원칙**: 같은 날 여러 번 보면 **마지막 값**으로 덮는다(현재 `merge-duplicates` 동작). 차트는 그날의 MIN 을 그린다(§6-5).
- 용량: 300건/일 × 90일 ≈ 2.7만행. 180일 프룬(`price-history-prune`, `noti_master_132.sql`) 유지 → 용량 문제 없음.
- **묶음 함수(`hotdeal_ingest`)는 만들지 않는다** — 건당 3회(이력 upsert·판정 조회·등록)면 하루 100회 미만이다. 실패 지점만 늘어난다.

### 6-2. 판정 함수 — `supabase/sql/hotdeal_polcent_187.sql`

```sql
-- 판정은 한 곳에서. 사이트 카드·차트·(나중에)발송이 같은 값을 본다.
create or replace function public.hotdeal_judge(
  p_key text, p_price int, p_days int default 90, p_min_points int default 7)
returns table(points int, avg_price int, min_price int, drop_pct int,
              is_lowest boolean, basis text, stage text)
language sql stable security definer set search_path = public as $$
  with h as (
    select ph.price, coalesce(ph.src, 'measured') as s
      from public.price_history ph
     where ph.product_id = p_key
       and ph.day >= (now() at time zone 'Asia/Seoul')::date - least(greatest(coalesce(p_days, 90), 7), 180)
       and ph.day <  (now() at time zone 'Asia/Seoul')::date          -- 오늘 값은 비교에서 뺀다
  ), a as (
    select count(*)::int as n,
           round(avg(price))::int as avg_p,
           min(price)::int as min_p,
           count(*) filter (where s = 'measured')::int as nm
      from h
  )
  select a.n,
         a.avg_p,
         a.min_p,
         coalesce(case when a.avg_p > 0 then round((a.avg_p - p_price) * 100.0 / a.avg_p)::int end, 0),
         coalesce(a.n >= p_min_points and a.min_p is not null and p_price <= a.min_p, false),
         case when a.n = 0 then 'none' when a.nm = 0 then 'reported' when a.nm = a.n then 'measured' else 'mixed' end,
         case when a.n = 0 then 'none' when a.n < p_min_points then 'collecting'
              when a.n < 14 then 'provisional' else 'confirmed' end
    from a;
$$;
revoke all on function public.hotdeal_judge(text, int, int, int) from public, anon, authenticated;
grant execute on function public.hotdeal_judge(text, int, int, int) to service_role;
```

### 6-3. 판정 규칙 (값을 지어내지 않는다)

- 표본 **7일 이상**부터 판정한다(`collecting` → `provisional`). 90일 창, 오늘 제외.
- `is_lowest = true` 는 **`basis='measured'` 이고 `stage in ('provisional','confirmed')` 이고 `drop_pct >= 5`** 일 때만.
- `basis='reported'` 만 있는 상품은 **절대 `is_lowest=true` 로 승격하지 않는다.** 카드에는 「제보가 최저」 태그(`badge='reported'`)만.
  - 지름알림 원문에 최저가 표시(`isYearLowest`)가 있어도 마찬가지다. **보조 표기만** 한다(`badge` 가 아니라 `ship_note` 같은 별도 칸 또는 `key_src` 메모) — 우리 90일 이력으로 판정한 값과 섞지 않는다.
- `price_status`:
  - 토스처럼 몰에서 값을 다시 확인한 상품 → `measured`
  - 확인 수단이 없는 몰(지마켓·11번가·롯데온·옥션·SSG·GS샵·CJ·오늘의집) → `reported`
  - 품절·종료 확인 → `soldout`
  - 아직 한 번도 못 본 → `unknown` (186 적용 뒤 **0건**이 된다 — 916/916 unknown 이 사라지는 것이 이 단계의 성공 지표)

### 6-4. 적용 시점

1. **등록할 때**: insert 직후 `select * from public.hotdeal_judge(<product_id>, <price>)` 1회 → 그 값으로 `judge_stage·judge_basis·avg_price·min_price·drop_pct·is_lowest·judge_at·badge` 를 채운다.
2. **매일 1회 배치**(KST 07:40, 쿠팡 엔진 08:00 전): 활성 상품 전체를 다시 판정한다. 900행이면 한 번의 SQL 로 돌 수 있다:
   ```sql
   with act as (
     select id, product_id, price from public.hotdeals
      where (expires_at is null or expires_at > now()) and price > 0 and product_id is not null
        and coalesce(track, true)
   ), j as (
     select a.id, j.* from act a cross join lateral public.hotdeal_judge(a.product_id, a.price) j
   )
   update public.hotdeals h set
     judge_stage = j.stage, judge_basis = j.basis, avg_price = j.avg_price,
     min_price = j.min_price, drop_pct = j.drop_pct, judge_at = now(),
     is_lowest = (j.is_lowest and j.basis = 'measured' and j.drop_pct >= 5),
     badge = case when j.is_lowest and j.basis = 'measured' and j.drop_pct >= 5 then 'lowest'
                  when j.basis = 'reported' and j.is_lowest then 'reported'
                  when coalesce(j.drop_pct, 0) >= 25 then 'super'
                  when coalesce(j.drop_pct, 0) >= 10 then 'sale' end
   from j where h.id = j.id;
   ```
   스키마에 없는 칸을 만들지 않는다(표본 수는 `price_history` 로 다시 셀 수 있다).
3. 크론 등록은 기존 방식(`cron.schedule('hotdeal-judge-daily', '40 22 * * *', ...)`, UTC 22:40 = KST 07:40).

### 6-5. 차트 — `hotdeal_chart3`

```sql
create or replace function public.hotdeal_chart3(pid text, days int default 90)
returns table(day date, price integer, basis text)
language sql stable security definer set search_path = public as $$
  select ph.day, min(ph.price)::int as price,
         case when count(*) filter (where coalesce(ph.src,'measured') = 'measured') > 0 then 'measured' else 'reported' end
    from public.price_history ph
   where (ph.product_key = pid or ph.product_id = pid)
     and ph.day >= (now() at time zone 'Asia/Seoul')::date - least(greatest(coalesce(days, 90), 7), 180)
     and exists (select 1 from public.hotdeals h where h.product_id = pid or h.product_key = pid)
   group by ph.day
   order by ph.day;
$$;
revoke all on function public.hotdeal_chart3(text, int) from public;
grant execute on function public.hotdeal_chart3(text, int) to anon, authenticated;
```

- `index.html:5541` 상세 시트: `hotdeal_chart3({pid: h.product_key || h.product_id, days: 180})` → 실패하면 지금처럼 `hotdeal_chart2` 폴백.
- 문구 정직화(`:5598`): 표본 7일 미만이면 「가격 변동 이력 수집 중」 대신 **「가격 이력 N일째 · 판정은 7일부터」**, `basis='reported'` 면 「제보가 기준(몰 자동 확인 불가)」을 한 줄 붙인다.
- 「역대최저」 배지 문구는 `judge_basis='measured'` 일 때만. 제보 기준이면 「제보가 최저」.

### 6-6. 재확인(FIFO) — 실측 가능한 곳만

| 몰 | 처리 | 근거 |
| --- | --- | --- |
| 토스 | 기존 `toss-sync?mode=track` 이 전량(500 상한) 확인 중 → **가장 오래 안 본 것부터 100건**으로 바꿔 회차 부하 분산, `last_checked_at`·`price_status='measured'` 채움 | 이미 동작 중(이력에 값이 쌓인다) |
| 쿠팡 | **함수 몫 40만.** 수집기 신규 호출 0 | §2-2 |
| 오늘의집·지마켓·11번가·롯데온·옥션·SSG·GS샵·CJ | `price_status='reported'` 고정 + 카드 각주 「제보가(몰에서 자동 확인 불가)」 | 오늘 curl 실측: 오늘의집 403, 롯데온 403, 11번가 000, 옥션 200·파싱 실패, 지마켓 200·쿠폰가 미반영 |
| 네이버 | `product_id` 가 없어 이력 불가 → `track=false` | 50건 |

- 실측 가능 여부는 **먼저 GitHub Actions IP 에서 시험**한다(200 + 가격 파싱 성공일 때만 켠다). 안 되면 `reported` 로 정직하게 남기고 코드를 만들지 않는다.

---

## 7. 커밋·배포 순서 (A~H, 각각 따로)

| 커밋 | 내용 | 파일 |
| --- | --- | --- |
| **A** | 쿠팡 예산: RPC 2개 + 수집기 관문·429 중단·쿼터 배분 | `supabase/sql/hotdeal_polcent_185.sql`, `tools/daily/baby_hotdeal_auto.py` |
| **B** | 1단계 수집: 만료 36시간·중복 72시간·분류 키워드·keep 상한·`JIRUM_MAX_NEW=30` | `tools/daily/baby_hotdeal_auto.py` |
| **C** | 청소: 하드코딩 만료 SQL 삭제·정비를 하루 1회로·주석/워크플로 문구·감시 | `tools/daily/baby_hotdeal_auto.py`, `.github/workflows/hotdeal-cloud.yml`, `supabase/sql/hotdeal_stall_watch_*.sql`(필요 시) |
| **D** | 2단계 스키마 + 판정 함수 + 차트3 + 크론 | `supabase/sql/hotdeal_polcent_186.sql`, `187.sql` |
| **E** | 백필 스크립트(먼저 `--dry` 결과 보고) | `tools/daily/hotdeal_key_backfill.py` |
| **F** | 수집기 2단계 연결: `product_key`·`price_history` upsert·등록 시 판정 | `tools/daily/baby_hotdeal_auto.py` |
| **G** | 재확인 정리(토스 FIFO·`last_checked_at`·`price_status`) | `supabase/functions/toss-sync/index.ts` |
| **H** | 화면 승격: 정렬 `judge`·급하락 정직·id 42 삭제·중복 키 기준·상세 시트 차트3·문구 | `test.html` 먼저 → 검증 → `index.html` |

- 커밋 전 `git ls-files | wc -l` 이 **55,448 이상**인지 확인한다(줄었으면 부분 체크아웃 — 멈추고 보고).
- `git add -A`·`git add .`·`commit -a`·`--no-verify` 금지. 올릴 경로만 지정한다.
- **H 의 index.html 승격**: `test.html` 에 먼저 넣고 V16~V19 를 통과한 뒤, **같은 패치를 그대로** `index.html` 에 적용한다. 두 파일이 어긋나면 되돌린다(§9). 라이브 승격은 이 오더가 승인한 범위(정렬·뱃지 문구·id 42 삭제·중복 키)로 한정하며 그 밖의 `index.html` 수정은 하지 않는다.

---

## 8. 검증 (V1~V22 — 실제로 돌리고 결과를 표로 보고)

| # | 검증 | 통과 기준 |
| --- | --- | --- |
| V1 | `python -m py_compile tools/daily/baby_hotdeal_auto.py` | 오류 0 |
| V2 | `JIRUM_DRY=1 JIRUM_LIMIT=5 python3 tools/daily/baby_hotdeal_auto.py` | DB 쓰기 0, 키·링크·분류가 찍힌다 |
| V3 | `select public.coupang_budget_take('deeplink',15)` 16회 | 1~15 `ok=true`, 16번째 `reason='cap'` |
| V4 | 같은 호출을 `image` 로 4회 | 4번째 `reason='image_cap'` |
| V5 | `coupang_budget_block('시험',6)` → `coupang_budget_take` | `ok=false, reason='blocked'` + `health_alerts 'hotdeal:쿠팡한도'` 1행 |
| V6 | 429 모의(응답을 429로 바꾼 단위 시험 또는 `_CP_STOP` 강제) | 그 회차 쿠팡 호출 0, 다른 몰 수집은 계속, 상태 `blocked_until` 기록 |
| V7 | 만료: 기간문구 있는 제목 1건 + 없는 1건 | 기간일 23:59 / +36시간, 72시간 상한 |
| V8 | 분류: 알려진 제목 30건 표 | 기대 분류 일치, 다음 500건 표본 `리빙/생활용품` ≤ 25% |
| V9 | keep 상한: 같은 글을 4회 상한 걸리게 | 3회 뒤 `seen`, `st['keep']` ≤ 200 |
| V10 | 186 적용 + 판정 배치 1회 뒤 활성 전건 | `price_status='unknown'` **0건**, `judge_basis` 분포(measured/reported/mixed/none) 출력 |
| V11 | `hotdeal_key_backfill.py --dry` | 키 붙음/키 없음/충돌 3개 수치와 충돌 목록 |
| V12 | `select * from hotdeal_judge('6636188191_13352606475', 9480)` | `points=9`(오늘 제외), `min_price=9480`, `is_lowest=true`, `basis='measured'`, `stage='provisional'` |
| V13 | 제보만 있는 키(예: 신규 지름알림 딜) 판정 | `is_lowest=false`, `basis='reported'`, `badge='reported'` |
| V14 | `hotdeal_chart3('gmarket:<번호>')` | 그날 MIN 1행씩, 옵션 여러 개여도 1점 |
| V15 | 토스 재확인 1회 | 오늘 `src='measured'` 행 생김, `last_checked_at` 갱신, FIFO 100건 |
| V16 | 화면(테스트 페이지) | 카드 렌더·콘솔 오류 0, `grep -c "id === 42" index.html test.html` = **0/0** |
| V17 | 기본 정렬 | 첫 카드가 판정딜, 그 뒤 최신순 |
| V18 | 「급하락순」 | `discount_rate` null 카드가 섞이지 않는다 |
| V19 | `limit=500` | `index.html`·`test.html` 각 3곳 그대로 |
| V20 | 워크플로/주석 | 없는 파일 언급 0, 예산 문구가 실제와 일치 |
| V21 | 배포 | `deploy-pages` 게이트 통과, 라이브 `/` 200 · 핫딜 탭 렌더 |
| V22 | 되돌리기 시험 | §9 SQL 을 트랜잭션 안에서 돌려 오류 0 |

---

## 9. 되돌리기

```sql
-- A 되돌리기
drop function if exists public.coupang_budget_take(text,int);
drop function if exists public.coupang_budget_block(text,int);
delete from public.ops_status where id = 'coupang-budget';

-- D 되돌리기 (칸은 남겨도 무해 — 화면·판정만 끄려면 이것부터)
drop function if exists public.hotdeal_chart3(text,int);
drop function if exists public.hotdeal_judge(text,int,int,int);
select cron.unschedule('hotdeal-judge-daily');
```

- 코드는 커밋 단위로 되돌린다(`git revert <sha>` — 새 커밋을 얹는 방식. force-push 금지).
- `index.html` 승격이 잘못됐으면 **H 커밋만** revert 하고 `test.html` 은 남긴다.
- 만료·중복 규칙을 되돌리면 `expires_at` 은 다시 3일 고정이 된다(기존 행은 이미 지나간 값이라 그대로).

---

## 10. 보고 형식 (이 표를 채워서)

| 항목 | 결과 | 근거(명령·파일:행·수치) |
| --- | --- | --- |
| A~H 커밋 SHA |  |  |
| 쿠팡 예산 하드 캡 |  | V3~V6 |
| 1단계: 만료·중복·분류·keep·MAX_NEW |  | V7~V9 |
| 2단계: 키 통일(백필 결과) | 키 붙음 / 없음 / 충돌 | V11 |
| 판정: unknown 0건·basis 분포 | measured n · reported n | V10·V12·V13 |
| 차트·상세 시트 |  | V14 |
| 화면 승격 | test → index, V16~V19 |  |
| 못 한 것·확인 못 한 것 |  | 추측으로 채우지 말 것 |

---

## 11. 사람이 해야 하는 것 (클코 범위 밖)

1. **쿠팡 파트너스 콘솔에서 최근 경고·제재 이력 확인** — 오늘 429 가 실제로 있었는지. 있으면 이 오더의 쿠팡 몫을 15에서 더 내린다(자비스/사장님 판단).
2. 백필 `--dry` 결과를 보고 `--apply` 승인.
3. 세시간전·야놀자·클룩 12건(정가만) 노출 유지 여부 결정.
4. 카톡 발송·도쿄 VM 상태 확인(별건 — 이 오더 범위 아님).

---

## 12. 하지 말 것 (한 번 더)

1. **쿠팡 호출을 늘리지 않는다.** 딥링크 15·회차 5·간격 2.1초·합계 55 — 어떤 이유로도 예외 없음.
2. 지름알림·애드픽·링크프라이스의 구매 주소를 **그대로 저장하지 않는다**(우리 링크로 재조립 규칙 유지).
3. `is_lowest=true` 를 **제보가만으로 승격하지 않는다.**
4. `index.html` 은 `test.html` 검증 뒤에만, 이 오더가 승인한 줄만 고친다.
5. 숫자를 지어내지 않는다 — 못 잰 값은 「못 쟀다」고 쓴다.
6. `git add -A`·`--no-verify`·force-push 금지. 커밋 전 파일 수 확인.
7. 카톡 발송기(`kakao_pc_hotdeal_sender.py`)·도쿄 VM 관련 파일은 건드리지 않는다.
