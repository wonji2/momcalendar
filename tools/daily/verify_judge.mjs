/**
 * 🔎 공구 행 ↔ 셀러 인포크 **판정 기준 한 벌** (2026-10-05)
 *
 * 왜 따로 뺐나: 판정을 쓰는 곳이 둘이다.
 *   · `tools/daily/verify_rows.mjs`              — 이미 등록된 행을 되짚는 로컬 도구
 *   · Edge Function `inpock-lookup`(관리자 화면) — 등록 **전** 파싱 결과를 대조
 * 둘이 기준을 따로 가지면 한쪽만 고쳐져 어긋난다(메모리 same-flaw-in-sibling-code).
 * 그래서 **여기 한 곳**에만 두고, 서버 쪽은 `build_inpock_lookup.mjs` 가 이 파일을 그대로 묶어 올린다.
 *
 * ⚠ 이 파일은 **순수 함수만** 둔다 — node 전용 모듈(fs·path·process)을 쓰면 Edge(Deno)에서 죽는다.
 *
 * 판정 코드:
 *   ok     ✅ 인포크에 같은 상품·같은 기간(±1일)이 있다
 *   regong 🔁 인포크엔 **지난 회차만** 있고 우리 것은 진행 중·예정 → 새 회차다. **고치지 않는다**
 *   date   ⚠ 상품은 맞는데 기간이 다르다 → 인포크 값이 원본
 *   none   ❔ 인포크에 맞는 상품이 없다(인포크 없음·상시링크·달력이 이미지). **틀렸다는 뜻이 아니다**
 *   + nameLoose: 이름이 「비슷함」 수준(1점)으로만 맞았다 → 사람이 이름을 한 번 본다
 */

// ── 이름 대조 — 완전일치로 걸지 않는다 (인포크 제목이 더 짧거나 길다: 「요거쪽쪽」 vs 「요거쪽쪽 요거트」) ──
export const norm = (s) => String(s || '').toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
export const toks = (s) => String(s || '').toLowerCase()
  .split(/[^가-힣a-z0-9]+/).filter((w) => w.length >= 2);
export const STOP = new Set(['모음전', '골라담기', '세트', '신상', '공구', '특가', '단독', '앵콜', '모음', '기획전', '차수']);

/** 두 상품명이 같은 것을 가리키나 — 0(아님) · 1(비슷) · 2(거의 같음) */
export function nameMatch(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 2;
  if (na.length >= 4 && nb.includes(na)) return 2;
  if (nb.length >= 4 && na.includes(nb)) return 2;
  const ta = toks(a).filter((w) => !STOP.has(w));
  const tb = toks(b).filter((w) => !STOP.has(w));
  if (!ta.length || !tb.length) return 0;
  const shared = ta.filter((w) => tb.includes(w));
  if (!shared.length) return 0;
  // 브랜드로 쓰이는 첫 낱말이 겹치면 더 믿는다 — 단 **브랜드 하나만** 겹친 것은 「비슷함」(1)이다.
  // 🔴 2026-10-05 검증자: 첫 낱말만 같아도 2점을 줘서 「룰라러브 천연해면스펀지」↔「룰라러브 바디워시」,
  //    「한우 선물세트」↔「한우 사골곰탕」이 같은 상품이 됐다 → 남의 상품 날짜로 교정 SQL 이 만들어진다.
  if (shared.includes(ta[0]) && shared.includes(tb[0])) return shared.length >= 2 ? 2 : 1;
  return shared.some((w) => w.length >= 3) ? 1 : 0;
}

export const dayGap = (a, b) => {
  const pa = Date.parse(String(a) + 'T00:00:00Z'), pb = Date.parse(String(b) + 'T00:00:00Z');
  return (isNaN(pa) || isNaN(pb)) ? 99 : Math.round(Math.abs(pa - pb) / 864e5);
};

/**
 * 한 행을 그 셀러의 인포크 항목들과 대조한다.
 * @param r      { name, open_date, end_date }
 * @param ip     harvest().rows — [{ name, open, end, url }]
 * @param today  KST 오늘 "YYYY-MM-DD" (재공구 판정에 쓴다)
 * @returns { code:'ok'|'regong'|'date'|'none', nameLoose:boolean, best:{name,open,end,url}|null }
 */
export function judgeInpock(r, ip, today) {
  let best = null, bestScore = 0;
  for (const c of (ip || [])) {
    const s = nameMatch(r.name, c.name);
    // 점수가 같으면 **오픈일이 우리 것과 가까운 쪽**을 고른다. 전엔 먼저 나온 것이 이겨서, 같은 이름의
    // [지난 회차, 이번 회차] 순서에 따라 판정이 재공구↔일치로 뒤집혔다(검증자 2026-10-05).
    if (s > bestScore || (s === bestScore && s > 0 && dayGap(r.open_date, c.open) < dayGap(r.open_date, best.open))) { bestScore = s; best = c; }
  }
  if (!best || bestScore < 1) return { code: 'none', nameLoose: false, best: null };
  const gOpen = dayGap(r.open_date, best.open), gEnd = dayGap(r.end_date, best.end);
  let code;
  if (gOpen <= 1 && gEnd <= 1) code = 'ok';
  // ⚠ 재공구는 **오픈일이 3일 넘게 벌어졌을 때만**이다. 오픈일이 같은데 마감만 다르면 같은 회차다 —
  //   인포크 10-03~04(끝남) vs 우리 10-03~06 을 재공구로 보면 끝난 공구를 「그대로 두라」고 하게 된다(검증자).
  else if (gOpen <= 3) code = 'date';
  // 🔴 인포크 쪽이 **이미 마감**이고 우리 것은 진행 중이면 **재공구**다 (메모리 gonggu-dup-definition
  //   "날짜 다르면 재공구다"). 셀러가 인포크를 안 지웠을 뿐이다 —
  //   여기서 인포크 날짜로 덮으면 **진행 중인 공구가 과거가 되어 손님 화면에서 사라진다.**
  //   2026-10-05 실측: 「마카오 여행」 인포크 10-01~04(마감) vs 우리 10-05~08(진행중).
  else if (best.end < today && String(r.end_date) >= today) code = 'regong';
  else code = 'date';
  return { code, nameLoose: bestScore === 1, best };
}
