/**
 * 한 번짜리 — seo_dataset 캐시를 지금 다시 만든다 (2026-11-16 로지오가닉 타셀러 비노출 직후)
 *
 * 왜: seo-daily 빌드는 pg_cron(seo-refresh, KST 04:20)이 넣어 둔 **캐시**를 읽는다.
 *     09시에 DB를 고쳤으니 캐시는 아직 옛것 — 이걸 안 돌리면 오늘 빌드는 내린 행을 그대로 다시 만든다.
 *     brand_remove.mjs 도 삭제 뒤 같은 함수를 부른다.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const TMP = join(ROOT, 'scratchpad', '_logio_seo_refresh.sql');
mkdirSync(join(ROOT, 'scratchpad'), { recursive: true });
writeFileSync(TMP, 'select public.seo_refresh() as r;\n', 'utf8');
const out = execFileSync(CLI, sbArgs(TMP), { encoding: 'utf8', timeout: 240e3, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
const r = parseRows(out);
if (!r.ok) { console.log('🔴 seo_refresh 출력을 못 읽었다 — ' + r.why); process.exit(1); }
console.log('seo_refresh 결과: ' + JSON.stringify(r.rows).slice(0, 300));
console.log('✅ seo_refresh 완료 — 이제 seo-daily 를 다시 돌리면 캐시가 새 값이다');
