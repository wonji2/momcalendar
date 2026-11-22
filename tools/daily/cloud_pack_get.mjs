// 깃허브 Actions 안에서 cloud_pack.mjs 가 올린 「코드+명단」 묶음을 받아 같은 자리에 푼다 (2026-11-10)
//   쓰는 곳: cloud_jobs.mjs 가 JOBS 의 pack 항목이 있는 작업 앞에서 부른다.
//   낡음: 묶음이 14일보다 오래됐으면 경고만 하고 계속 돈다(코드·명단은 자주 안 바뀐다 — 제외 셀러 명단이 낡아도 PC 없이 24시간 도는 게 우선).
//         단 60일을 넘으면 멈춘다(exit 2) — 그 정도면 PC 가 오래 죽었거나 명단이 너무 낡았다.
//   실행: SB_SERVICE_KEY=… node tools/daily/cloud_pack_get.mjs linkinbio
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const name = process.argv[2] || 'linkinbio';
const KEY = process.env.SB_SERVICE_KEY;
const SBU = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const get = (n) => fetch(`${SBU}/storage/v1/object/cloud-bundle/${n}`, { headers: H });
const man = await get(`pack-${name}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (!man) { console.log(`🔴 묶음 ${name} 목록 없음 — cloud_pack.mjs 를 PC 에서 한 번 돌려야 한다`); process.exit(2); }
const days = (Date.now() - new Date(man.at).getTime()) / 86400e3;
console.log(`묶음 ${name} ${man.at} (${days.toFixed(1)}일 전) · 파일 ${man.files}개`);
if (days > 60) { console.log('🔴 60일 넘게 낡음 — 멈춤'); process.exit(2); }
if (days > 14) console.log('🟡 14일 넘게 낡음 — PC 에서 cloud_pack.mjs 를 다시 돌려 주세요(계속 진행)');
const buf = Buffer.from(await get(`pack-${name}.gz`).then((r) => r.arrayBuffer()));
let n = 0;
for (const l of zlib.gunzipSync(buf).toString('utf8').split('\n')) {
  if (!l) continue; const o = JSON.parse(l);
  fs.mkdirSync(path.dirname(o.f), { recursive: true }); fs.writeFileSync(o.f, Buffer.from(o.b, 'base64')); n++;
}
for (const f of fs.readdirSync('tools/daily')) if (f.endsWith('.sh')) { try { fs.chmodSync('tools/daily/' + f, 0o755); } catch {} }
console.log(`풀기 끝: 파일 ${n}`);
process.stdout.write(days > 14 ? 'STALE\n' : '');
