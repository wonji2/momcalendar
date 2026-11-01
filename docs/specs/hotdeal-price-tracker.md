# 핫딜 실시간 가격 추적·변동 감시 설계서 (2026-11-01, 사장님 기획 「폴센트형」)

> 상태: **설계서 1판 — 짓기 전.** 규칙 5-b 대로 맥락 없는 검토자(손님 길 · 데이터 규칙 · 되돌리기)가 먼저 구멍을 찾은 뒤 test.html 프로토타입으로 간다.
> 원칙: 가격을 **잘못 보여주느니 「미확인」**으로 둔다(규칙 0-K 「파싱이 허위면 사기 사이트」 · 0-V 「맞는 정보만」). 무토큰 · Node 그대로 · PC 꺼져도 돈다.

## 0. 참고한 자료 · 이미 있던 작업 (일 두 번 안 하게)
| 이미 있는 것 | 하는 일 | 이번 설계에서 |
|---|---|---|
| `price_history(product_id, day, price)` + pg_cron **toss-track**(09:10/09:25·21:10/21:25) · **st11-track**(09:30) | 토스·11번가 상품의 **일별 가격** 적립(최근 7일 2,491개 상품) | 그대로 쓴다. 「등록가 대비 현재가」의 1차 출처 |
| pg_cron **hotdeal-auto-expire** · **goldbox-check** · **hotdeal-evergreen** · **hotdeal-purge** | 기한 지난 딜 내림, 골드박스 확인, 상시 딜, 오래된 딜 정리 | 상태값(price_status)과 충돌 없이 공존 |
| PC `sns-automation/src/soldout-sweep.js`(30분, 네이버 링크 미리보기로 「품절」 판별 → expires_at=now, 카페 글 삭제) | 품절 내림 | **soldout 판정의 원천**. 클라우드로 옮기면 네이버 미리보기 API 는 로그인 불필요라 가능(검토 항목) |
| `tools/daily/mall_price.mjs`(창 띄우는 크롬 + CDP) | 옥션·지마켓·11번가·롯데온 **실측 가격·품절** | 지마켓·옥션은 **PC 전용**(헤드리스·데이터센터 IP 는 봇체크). 11번가·롯데온 JSON-LD 파서는 클라우드로 옮김 |
| `card_preflight.mjs --only=hotdeal` | 카드 보내기 전 가격 실측 | 같은 파서를 공유 |
| 메모리 `hotdeal-price-truth` · `mall-conversion-walls` · `naver-shop-api-scope-empty` · `option-price-is-real-price` · `soldout-verify-with-my-own-eyes` | 실측 사실 | 아래 「몰별 가능 여부」의 근거 |
- 사장님 참고 자료(references/THREADS_REFERENCES.md)에 가격 추적 관련 글은 없음(2026-11-01 확인). 폴센트(fallcent.com)는 쿠팡 전용 가격 변동 알림 서비스 — 「등록가 대비 변동을 뱃지로」 발상만 가져온다.

## 1. 목표
- 핫딜은 24~48시간이면 가격이 오르거나 품절된다 → 손님 헛걸음 방지, 「등록가 대비 지금 얼마」를 투명하게.
- 실측(2026-11-01): 최근 7일 등록 143건 · 노출 중 99건. 몰: 쿠팡 72 · 11번가 20 · 토스 20 · 지마켓 11 · SSG 8 · 롯데온 5 · 보리보리 3 · 네이버 2 · 오늘의집 2.

## 2. DB (public.hotdeals 칸 추가 — `supabase/sql/hotdeal_price_status_129.sql`)
| 칸 | 형 | 뜻 |
|---|---|---|
| current_price | integer | 마지막으로 확인한 판매가(없으면 null) |
| price_status | text | `active`(특가 유지) · `increased`(인상) · `decreased`(추가 인하) · `soldout`(품절·종료) · `unknown`(미확인, 기본값) |
| last_checked_at | timestamptz | 확인 시각 |
| price_diff | integer | current_price − price (등록가). 등록가는 지금 칸 `price` |
- 판정 기준(파서가 숫자를 낸 경우만): |diff| ≤ 등록가의 2% → active · diff > 2% → increased · diff < −2% → decreased · 품절 신호 → soldout. 숫자를 못 읽으면 **unknown 으로 두고 뱃지를 안 단다**(틀린 숫자 금지).
- 옵션가 함정(메모리 option-price-is-real-price): 대표가와 옵션가가 다르면 **등록 당시와 같은 옵션**을 못 짚는 한 unknown.
- 손님 화면이 읽는 RPC/목록(`hotdeals?select=*`)에 칸이 자동 포함된다. Worker 캐시(api.momcalendar.com) TTL 안에서는 최대 10분 늦게 보인다(허용).

## 3. 감시 엔진 — 무토큰 · 깃허브 Actions · Node
> 사장님 설계는 `hotdeal_price_tracker.py` 였으나 11-01 결정(「파이썬 재작성 말고 Node 그대로」)에 따라 **`tools/daily/hotdeal_price_track.mjs`** 로 짓고 기존 `mall_price.mjs` 파서를 나눠 쓴다.
- 대상: 최근 7일 등록 + 노출 중(expires_at null 또는 미래) + pin_random 제외 ≈ 100건.
- 주기: `.github/workflows/hotdeal-price.yml` 하루 3회(08:30·14:30·20:30 KST = 23:30·05:30·11:30 UTC). cloud_jobs.mjs JOBS 표에 넣어 같은 틀(재시도·health_alerts·로그 Storage)로 돈다.
- 요청 예절: 건당 1.5~2.5초 지연, 데스크톱 UA 3종 돌려쓰기, 한 몰 연속 3회 실패면 그 몰은 그 회차 중단(규칙 0-T 와 같은 정신).
- **몰별 가능 여부(실측 근거)** — 여기서 사장님 설계의 전제 두 가지가 달라진다:
  | 몰 | 7일 건수 | 방법 | 판정 |
  |---|---|---|---|
  | 토스쇼핑 | 20 | 이미 toss-track 이 product_id 로 되묻는다 → price_history 최신 행을 읽기만 | ✅ 바로 |
  | 11번가 | 20 | st11-track 과 같은 JSON-LD(`offers.price`, 데스크톱 UA 필수) | ✅ 바로 |
  | 롯데온·SSG | 13 | 상품 페이지 JSON-LD/메타 — mall_price 파서(롯데온 확인됨), SSG 는 시험 필요 | ✅/시험 |
  | **쿠팡** | **72** | 상품 페이지는 데이터센터 IP·헤드리스에서 **봇 차단**(메모리 mall-conversion-walls·hotdeal-price-truth: 「쿠팡은 검색만·재포착 28%」). OpenGraph 도 같은 페이지라 깃허브 IP 에선 못 읽는다 | ❌ 클라우드 불가 → ① 파트너스 API 상품 조회(제휴 승인 필요, 사장님 확인) ② PC 의 mall_price(창 크롬) 회차 ③ 없으면 unknown |
  | 지마켓·옥션 | 11 | 창 띄우는 「그냥 크롬」+CDP 만 통과 | ❌ 클라우드 불가 → PC 회차(momcal-hotdeal-price-pc, 하루 2회) |
  | 네이버 | 2 | 쇼핑 API 는 2026-10 에 죽음(401, 되살리기 금지 메모리) · 스마트스토어는 로그인 크롬 | PC 회차 |
  | 보리보리·오늘의집 | 5 | 오늘의집은 전용 크롬 프로필(PC) · 보리보리 미확인 | PC 회차/unknown |
  → **클라우드가 53건(토스·11번가·롯데온·SSG), PC 가 83건(쿠팡·지마켓·네이버·오늘의집)**. PC 가 꺼져 있으면 쿠팡은 unknown 으로 남는다(뱃지 없음) — 거짓 뱃지보다 낫다.
- 품절: soldout-sweep(PC·30분)이 이미 expires_at 을 세팅한다. 엔진은 그 결과를 `price_status='soldout'` 로 옮기고, 파서가 「품절」 신호를 직접 봤을 때도 soldout(단, 지마켓 빈 화면은 품절 아님 — 메모리 soldout-verify).

## 4. 손님 화면 (hdCardHtml · 검색 결과·핫딜 탭 공통)
| price_status | 뱃지 | 색 | 카드 |
|---|---|---|---|
| increased | `▲ 인상 (현재 OO,OOO원)` | 주황 | 그대로 |
| decreased | `▼ 추가할인 (현재 OO,OOO원)` | 파랑 | 그대로 |
| active | `특가 진행 중` | 초록 | 그대로 |
| soldout | `품절 종료` | 회색 | 반투명(opacity .55), 눌러도 열리지 않게는 **안 함**(손님이 직접 확인할 수 있게 링크는 둔다 — 검토 항목) |
| unknown | (없음) — 검색 결과에선 지금 넣은 「N일 전 핫딜 (가격변동 가능)」 그대로 | | |
- 「현재 OO,OOO원」 은 last_checked_at 이 **24시간 안**일 때만. 더 오래된 값은 숫자 없이 뱃지만(또는 unknown 취급).
- 정렬: 검색 결과·핫딜 탭에서 `soldout` 과 `increased`(등록가 대비 +10% 이상)는 **목록 맨 아래**로. 나머지는 지금 순서.
- 글자·여백은 DESIGN_SPEC 토큰(규칙 0-G), 새 CSS 는 `.hc-ps` 한 벌.

## 5. 단계별 프로토타입 (test.html 먼저 · 각 단계 끝에 /검증)
| 단계 | 내용 | 끝나는 조건 |
|---|---|---|
| 0 | 이 설계서 금붕어 검토 3명(손님 길·데이터 규칙·되돌리기) | 구멍 0 또는 반영 |
| 1 | SQL: 칸 4개 추가 + `hotdeal_price_apply(id, price, status)` 함수(쓰기는 service role) + 되돌리기(칸만 null) | 라이브 DB 적용, 손님 화면 무변화 확인 |
| 2 | 엔진 1차: 토스(price_history 읽기)·11번가(JSON-LD) 두 몰만, `--dry` 로 3회차 돌려 **실측 대조 20건 눈검수 오차 0** | 정확도 표 scratchpad/designs 에 |
| 3 | test.html 뱃지·정렬 — 2단계 데이터로 기저귀·분유·트립트랩 검색 캡처 | 사장님 확인 |
| 4 | 엔진에 롯데온·SSG 추가, Actions 하루 3회 켜기(cloud_jobs 표), health_alerts 로 실패 경보 | 7일 운행, 오판 0 |
| 5 | PC 회차(쿠팡·지마켓·네이버·오늘의집, mall_price 창 크롬) 하루 2회 — 쿠팡 파트너스 API 는 사장님 확인 뒤 | |
| 6 | 라이브 배포(index.html) — 사장님 「배포해」 | |

## 6. 위험·한도
- 거짓 뱃지: 옵션가·쿠폰가·카드할인가는 등록가와 비교 기준이 다르다 → 제목에 `[쿠폰+카드]` 태그가 있는 딜은 **current_price 를 읽어도 뱃지를 숫자 없이**(「가격 조건 확인」)만 달거나 unknown.
- 전송량·한도(0-L): 하루 3회 × 100건 페이지 읽기 ≈ 60MB/일 깃허브 쪽(무료), DB 쓰기 300행/일(무시). price_history 는 그대로.
- 차단: 11번가·SSG 가 깃허브 IP 를 막으면 그 몰은 PC 회차로.
- 되돌리기: 칸 4개를 null 로 두면 화면은 지금과 같다(뱃지 코드가 null 이면 안 단다).
