/**
 * 진단 한 번 — 「비노출로 내렸는데 gg 페이지·sitemap 에 왜 아직 있나」 (2026-11-16)
 *   · gonggu 에서 approved=true 인 로지오 행 수 (서버 열쇠로 본 진짜 값)
 *   · seo_dataset() 캐시에 「빵로맘」 이 아직 들어 있는가
 *   · gonggu_hold 에 그 행들이 잠겨 있는가
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const TMP = join(ROOT, 'scratchpad', '_logio_why.sql');
mkdirSync(join(ROOT, 'scratchpad'), { recursive: true });
writeFileSync(TMP, `select
  (select count(*) from public.gonggu where approved and coalesce(name,'') ~* '로지오') as approved_rogio,
  (select count(*) from public.gonggu where coalesce(name,'') ~* '로지오') as all_rogio,
  (select count(*) from public.gonggu_hold h join public.gonggu g on g.id=h.id where coalesce(g.name,'') ~* '로지오') as held_rogio,
  (select public.seo_dataset()::text like '%빵로맘%') as dataset_has_bbang,
  (select public.seo_dataset()::text like '%떡꾹맘%') as dataset_has_ddeok,
  (select (public.seo_dataset()->>'cached_at')) as cached_at;
`, 'utf8');
const out = execFileSync(CLI, sbArgs(TMP), { encoding: 'utf8', timeout: 240e3, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
const r = parseRows(out);
if (!r.ok) { console.log('🔴 조회 실패 — ' + r.why); process.exit(1); }
console.log('진단: ' + JSON.stringify(r.rows[0]));
