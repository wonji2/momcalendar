/**
 * 🔤 사이트 인기 검색어를 **해시태그용 낱말 목록**으로 굽는다 (사장님 지시 2026-09-30)
 *   > "우리 db에 있는 인기 검색어로 상품명 해시태그 써"
 *
 * 왜 굽나: 검색어 표 `public.site_search_stats` 는 **anon 이 못 읽는다**(42501, 의도된 잠금).
 *   그런데 캡션을 만드는 건 브라우저 페이지(reelcard.html · instastudio.html)다.
 *   → node 가 CLI 로 읽어 **낱말만** 파일로 구워 두고, 페이지가 그 파일을 읽는다.
 *
 * 🔴 **검색 횟수는 굽지 않는다.** 순서만 남긴다 —
 *    이 파일은 GitHub Pages 로 공개되므로, 경쟁사가 우리 검색 규모를 알 수 있으면 안 된다.
 *    낱말 자체는 어차피 우리가 해시태그로 공개하는 것들이다.
 *
 * 실행:  node tools/daily/search_terms_bake.mjs
 *        (make-card.mjs 가 카드 만들기 전에 부른다 · 아침 예약작업에 딸려 돈다)
 * 산출:  daily/search_terms.json  { asof, terms: [...] }   ← 많이 검색된 순
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const LIMIT = Number(process.env.TERMS || 300);

const f = join(tmpdir(), 'mc_terms_bake.sql');
writeFileSync(f, `select term, c30 from public.site_search_stats order by c30 desc limit ${LIMIT};`);
const out = execFileSync(CLI, sbArgs(f), { encoding: 'utf8', timeout: 120e3, stdio: ['ignore', 'pipe', 'pipe'] });
const p = parseRows(out);
if (!p.ok) { console.error('🔴 검색어를 못 읽었다:', p.why); process.exit(1); }

// 해시태그로 쓸 수 있는 낱말만 남긴다 — 공백 제거, 2~14자, 한글이 하나는 있어야 한다
const BAD = /(모음전|골라담기|기획전|무료배송|최저가|이벤트)/;
const terms = [];
const seen = new Set();
for (const r of p.rows) {
  const t = String(r.term || '').replace(/\s+/g, '').replace(/[^가-힣A-Za-z0-9]/g, '');
  if (t.length < 2 || t.length > 14) continue;
  if (!/[가-힣]/.test(t)) continue;
  if (BAD.test(t)) continue;
  if (seen.has(t)) continue;
  seen.add(t); terms.push(t);
}
mkdirSync('daily', { recursive: true });
const asof = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
writeFileSync('daily/search_terms.json', JSON.stringify({ asof, terms }), 'utf8');
console.log(`인기 검색어 ${terms.length}개 구움 → daily/search_terms.json (상위 10: ${terms.slice(0, 10).join(' · ')})`);
