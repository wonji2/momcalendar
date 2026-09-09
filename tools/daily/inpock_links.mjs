// 인포크 페이지에서 (상품명, 판매링크) 를 **날짜 없이 전부** 긁는다 (2026-09-09 신설)
//
// 🔴 왜 따로 만들었나
//   `scratchpad/inpock_harvest.mjs` 의 harvest() 는 **날짜를 읽어낸 블록만** 돌려준다.
//   일정 수확에는 그게 맞지만, "이미 아는 공구의 판매링크를 찾는" 일에는 너무 좁다.
//   실측(2026-09-09): 카페링크 공구를 가진 셀러 79명 중 **23명이 인포크 페이지에 블록이 6~42개나 있는데
//   수확은 0건**이었다 — 셀러가 제목에 날짜를 안 적었을 뿐이다.
//   날짜 조건을 빼고 이름만 맞추니 26건 → **56건**으로 늘었다.
//   (CLAUDE.md 규칙 0-P: "수확 0건 = 일정 없음이 아니다" 와 같은 뿌리)
//
// 쓰는 곳: tools/daily/cafe_link_fix.mjs
// 로그인 불필요. 상품명 세척은 inpock_harvest 의 cleanName 을 그대로 쓴다(표기가 갈리지 않게).
import { cleanName } from '../../scratchpad/inpock_harvest.mjs';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

// 슬러그 후보 — 아는 슬러그 먼저, 그 다음 핸들 변형
//   ⚠ 추측은 절반을 놓친다(실측 20/40). 아는 슬러그가 있으면 그게 정답이다.
export function slugCandidates(handle, known) {
  const a = [known, handle, String(handle).replace(/[._]/g, ''), String(handle).replace(/^_+|_+$/g, '')];
  return [...new Set(a)].filter(Boolean);
}

async function getNextData(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 15000);
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const h = await r.text();
    if (h.length < 8000) return null;                 // 빈 페이지(≈5.3KB) = 그 슬러그가 없다
    const m = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const j = JSON.parse(m[1]);
    return (j && j.props && j.props.pageProps) || null;
  } catch (e) { return null; }
}

/**
 * 셀러의 인포크에서 링크가 붙은 항목을 전부 돌려준다.
 * @returns null (페이지 없음) | { slug, base, items: [{ name, url, open, end }] }
 *   url 은 **절대경로로 바꿔서** 준다 — 인포크 원본은 "/api/r/…" 상대경로다(이걸 놓쳐 조용히 0건이 났다).
 *   open/end 는 있을 때만 채운다. 없다고 버리지 않는다 — 그게 이 모듈의 존재 이유다.
 */
export async function inpockLinks(handle, known) {
  for (const s of slugCandidates(handle, known)) {
    for (const base of ['https://link.inpock.co.kr', 'https://inpk.link']) {
      const pp = await getNextData(base + '/' + s);
      if (!pp || !Array.isArray(pp.blocks) || !pp.blocks.length) continue;
      const items = [];
      const seen = new Set();
      const walk = (arr, depth) => {
        if (!Array.isArray(arr) || depth > 4) return;
        for (const b of arr) {
          if (!b || typeof b !== 'object') continue;
          const raw = b.url || b.link || '';
          const title = b.title || b.name || b.label || '';
          if (raw && title) {
            let u = String(raw);
            if (u.charAt(0) === '/') u = base + u;
            const nm = cleanName(title);
            const key = nm + '|' + u;
            if (nm && !seen.has(key)) {
              seen.add(key);
              items.push({
                name: nm,
                url: u,
                open: b.open_at || b.start_at || '',   // 필드명이 바뀐 적이 있다 — 둘 다 본다
                end: b.open_until || b.end_at || '',
              });
            }
          }
          for (const k of ['schedule_list', 'items', 'links', 'blocks', 'children']) {
            if (Array.isArray(b[k])) walk(b[k], depth + 1);
          }
        }
      };
      walk(pp.blocks, 0);
      if (items.length) return { slug: s, base: base, items: items };
    }
  }
  return null;
}
