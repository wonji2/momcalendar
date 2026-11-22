/**
 * supabase CLI 출력 읽기 — 공용 (2026-09-04 신설)
 *
 * 🔴 왜 이게 필요한가
 *   CLI 는 **환경에 따라 출력 형식을 바꾼다**. 손으로 돌리면 늘 정상이고 예약작업만 실패한다.
 *     터미널                        { "boundary":…, "rows": [ {...} ], "warning":… }
 *     예약작업 + --output-format json   [ {...} ]            ← rows 래퍼 없이 최상위가 배열
 *     예약작업 (플래그 없음)             │ [map[id:42 price:8800]] │   ← JSON 이 아니다(ASCII 표)
 *   naver_track 이 이것 때문에 나흘간 죽어 있었고, 그동안 가격이 낡은 채 손님에게 노출됐다.
 *   더 나쁜 건 **조용히 실패**한 것이다 — 파서가 [] 를 돌려주고 exit 0 으로 끝나
 *   "성공했는데 아무 일도 안 한" 회차가 로그상 정상으로 보였다.
 *
 * 그래서 이 모듈이 두 가지를 강제한다
 *   ① sbArgs()   — --output-format json 을 빼먹을 수 없게 인자를 한 곳에서 만든다
 *   ② parseRows() — 세 형식을 다 받고, **못 읽은 것과 0건을 구분**해서 돌려준다
 *                   ok:false = 못 읽었다(장애) / ok:true rows:[] = 진짜 0건
 *
 * ⚠ 정규식을 쓰지 않는다 — 백슬래시가 셸을 지나며 사라져 조용히 오작동한다(2026-09-03 에만 네 번).
 */

/** CLI 인자. 이걸 쓰면 --output-format json 을 빠뜨릴 수 없다. */
export const sbArgs = (sqlFile) => ['db', 'query', '--linked', '--output-format', 'json', '-f', sqlFile];

/**
 * CLI 출력 → { ok, rows }
 *   ok:false  못 읽었다. 호출부는 로그를 남기고 exit 1 로 끝내야 한다.
 *   ok:true   rows 가 [] 여도 그건 "진짜 0건" 이다.
 */
export function parseRows(raw) {
  const s = String(raw == null ? '' : raw);
  // "Initialising login role..." 같은 앞머리를 건너뛰고 첫 괄호부터 읽는다
  const cand = [s.indexOf('['), s.indexOf('{')].filter((x) => x >= 0);
  if (!cand.length) return { ok: false, rows: [], why: 'JSON 이 아니다(ASCII 표이거나 빈 출력)' };
  let j;
  try { j = JSON.parse(s.slice(Math.min.apply(null, cand))); }
  catch (e) { return { ok: false, rows: [], why: 'JSON.parse 실패: ' + String(e.message || e).slice(0, 80) }; }
  if (Array.isArray(j)) return { ok: true, rows: j };                    // 예약작업 + json
  if (j && Array.isArray(j.rows)) return { ok: true, rows: j.rows };     // 터미널
  if (j && typeof j === 'object') return { ok: true, rows: [j] };        // 단일 객체
  return { ok: false, rows: [], why: '모르는 모양' };
}

/** 첫 행의 한 칸을 숫자로. 못 읽으면 null (0 과 구분된다) */
export function firstNum(rows, key) {
  if (!rows || !rows.length) return null;
  const v = rows[0][key];
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
