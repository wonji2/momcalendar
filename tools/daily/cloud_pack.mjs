// 서버(깃허브 Actions)에서 돌릴 작업의 「코드+명단」 묶음을 Supabase 비공개 저장소에 올린다 (2026-11-10, 사장님 「서버자동실행하라고 고정규칙」)
//
// 왜: 링크인바이오 수확·등록(linkon_harvest → 게이트 → 등록)은 코드 일부(scratchpad 처리기·제외 셀러 명단·분류 사전)가
//     공개 저장소에 없다. 사업 데이터라 공개 저장소에 올리지 않고(규칙: 공개 레포 금지), cloud_bundle 처럼 비공개 버킷으로 전달한다.
//     서버는 받은 파일로 PC 와 **같은 코드**를 돌린다(PC 판을 그대로 — 판이 갈라지지 않는다).
// 무엇을: 파일 목록(아래 PACKS) → JSONL {f, b(base64)} → gzip → cloud-bundle/pack-<이름>.gz + pack-<이름>.json(올린 시각)
// 언제: 코드·명단을 고쳤을 때 손으로 한 번(`node tools/daily/cloud_pack.mjs`) + cloud_bundle.mjs 가 3시간마다 자동으로 같이 부른다.
//       PC 가 꺼져 있어도 서버는 마지막 묶음으로 돈다(명단이 14일 넘게 낡으면 경보 — cloud_pack_get.mjs).
// 한도: 약 0.5MB 덮어쓰기(쌓이지 않음). LONG_TERM_REGISTER 영향 없음.
// 실행: node tools/daily/cloud_pack.mjs [이름] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SBU = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const DRY = process.argv.includes('--dry');
const which = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0] || 'linkinbio';

export const PACKS = {
  linkinbio: {
    // 코드 뿌리(import 를 따라 같은 폴더 .mjs 를 더 모은다)
    roots: ['tools/daily/linkon_harvest.mjs', 'tools/daily/linkinbio_all.mjs', 'tools/daily/drop_badname.mjs', 'tools/daily/own_product_check.mjs',
      'tools/daily/cat_classify.mjs', 'tools/daily/gonggu_date_audit.mjs', 'tools/daily/alert.mjs'],
    files: ['tools/daily/register_table.sh', 'tools/daily/sb_query.mjs',
      'scratchpad/inpock_harvest.mjs', 'scratchpad/harvest_clean.mjs', 'scratchpad/harvest_to_table.mjs', 'scratchpad/drop_ended.mjs', 'scratchpad/pending_dedupe.mjs',
      'scratchpad/_drop_excluded.mjs', 'scratchpad/_drop_rejected.mjs', 'scratchpad/_drop_gate_blockers.mjs', 'scratchpad/_split_insert.mjs',
      'scratchpad/gf_vals.mjs', 'scratchpad/gf_pick.mjs', 'scratchpad/gate_db_overlap.mjs', 'scratchpad/_slug_as_handle_check.mjs', 'scratchpad/_slug_resolver.mjs',
      'scratchpad/pending_check.sh', 'scratchpad/gate_filter.sh', 'scratchpad/excluded_check.sh', 'scratchpad/name_check.sh', 'scratchpad/gen_insert_gonggu.mjs',
      'scratchpad/gen_alias_audit.mjs', 'scratchpad/parsing_excluded.txt', 'scratchpad/catvocab.json', 'scratchpad/_rejected_names.txt', 'scratchpad/_judged_drop.txt',
      'scratchpad/_handle_split_ok.txt', 'scratchpad/_slugmap.tsv', 'scratchpad/date_audit/verified_hash.json', 'scratchpad/_alias_clause.sql', 'scratchpad/_dup_clause.sql'],
  },
};

export function collect(name) {
  const P = PACKS[name]; if (!P) throw new Error('알 수 없는 묶음 ' + name);
  const seen = new Set(), missing = [];
  const add = (rel) => { if (seen.has(rel)) return; const p = path.join(REPO, rel); if (!fs.existsSync(p)) { missing.push(rel); return; } seen.add(rel); };
  const walk = (rel) => {
    if (seen.has(rel)) return; const p = path.join(REPO, rel); if (!fs.existsSync(p)) { missing.push(rel); return; }
    seen.add(rel);
    if (!rel.endsWith('.mjs')) return;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    for (const m of src.matchAll(/['"`]([a-z_]+\.(?:mjs|json))['"`]/g)) { const c = path.posix.join(path.posix.dirname(rel), m[1]); if (fs.existsSync(path.join(REPO, c))) walk(c); }
  };
  for (const r of P.roots) walk(r);
  for (const f of P.files) add(f);
  // 비밀값 파일은 절대 싣지 않는다
  for (const f of [...seen]) if (/(^|\/)\.env|secret|token/i.test(f)) { seen.delete(f); }
  return { files: [...seen].sort(), missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = Object.fromEntries((fs.existsSync(path.join(REPO, 'tools/daily/.env')) ? fs.readFileSync(path.join(REPO, 'tools/daily/.env'), 'utf8') : '').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  const KEY = process.env.SB_SERVICE_KEY || env.SB_SERVICE_KEY;
  const { files, missing } = collect(which);
  const lines = files.map((f) => JSON.stringify({ f, b: fs.readFileSync(path.join(REPO, f)).toString('base64') }));
  const gz = zlib.gzipSync(lines.join('\n'), { level: 9 });
  console.log(`묶음 ${which}: 파일 ${files.length}개 · ${(gz.length / 1048576).toFixed(2)}MB${missing.length ? ' · 없는 파일 ' + missing.join(' ') : ''}`);
  if (missing.length) { console.log('🔴 없는 파일이 있어 올리지 않음'); process.exit(1); }
  if (gz.length > 20 * 1048576) { console.log('🔴 20MB 초과 — 올리지 않음'); process.exit(1); }
  if (DRY) process.exit(0);
  if (!KEY) { console.log('🔴 서비스 키 없음(tools/daily/.env SB_SERVICE_KEY)'); process.exit(1); }
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  const put = (n, body, type) => fetch(`${SBU}/storage/v1/object/cloud-bundle/${n}`, { method: 'POST', headers: { ...H, 'Content-Type': type, 'x-upsert': 'true' }, body });
  const r1 = await put(`pack-${which}.gz`, gz, 'application/gzip');
  if (!r1.ok) { console.log('🔴 올리기 실패', r1.status, (await r1.text()).slice(0, 120)); process.exit(1); }
  const r2 = await put(`pack-${which}.json`, JSON.stringify({ at: new Date().toISOString(), files: files.length, bytes: gz.length }), 'application/json');
  console.log(`올림 ✅ ${r1.status}/${r2.status}`);
}
