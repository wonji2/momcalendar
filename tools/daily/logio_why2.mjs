/**
 * 진단 2 — 캐시를 새로 만든 **뒤** 그 안에 내린 행의 이름이 남아 있는지 본다 (2026-11-16)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const TMP = join(ROOT, 'scratchpad', '_logio_why2.sql');
mkdirSync(join(ROOT, 'scratchpad'), { recursive: true });
const A = '로지오가닉·떡뻥&퓨레';   // 36225 떡꾹맘
const B = '아넬라 & 로지오가닉';    // 40303 5_reumine
const C = '로지오가닉 떡뻥';        // 36340 빵로맘
const q = (s) => "'" + s.replace(/'/g, "''") + "'";
writeFileSync(TMP, `select public.seo_refresh() as refreshed;
select
  (select count(*) from public.gonggu where approved) as approved_all,
  (select count(*) from public.gonggu where approved and coalesce(name,'') ~* '로지오') as approved_rogio,
  (position(${q(A)} in public.seo_dataset()::text) > 0) as has_${'A'},
  (position(${q(B)} in public.seo_dataset()::text) > 0) as has_B,
  (position(${q(C)} in public.seo_dataset()::text) > 0) as has_C,
  (select (public.seo_dataset()->>'cached_at')) as cached_at;
`, 'utf8');
const out = execFileSync(CLI, sbArgs(TMP), { encoding: 'utf8', timeout: 240e3, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
const r = parseRows(out);
if (!r.ok) { console.log('🔴 조회 실패 — ' + r.why); process.exit(1); }
for (const row of r.rows) console.log('행: ' + JSON.stringify(row));
