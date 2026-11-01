// 깃허브 Actions 안에서 PC 가 올린 판정 묶음(cloud_bundle.mjs)을 받아 같은 자리에 푼다 (2026-10-27)
//   받는 것: 처리기 코드(PC 판 그대로) · 인스타 피드 최근 62일(노출 셀러만) · 리틀리 수확 · 판정 해시
//   🔴 alert.mjs 는 클라우드용 빈 껍데기로 바꾼다 — PC 판은 daily/_alert.txt 를 git 으로 푸시하는데,
//      클라우드엔 그 파일이 없어 PC 알림을 통째로 지워 버린다. 클라우드 처리 결과는 DB(제보 메모·site_watch)에 남는다.
//   묶음이 48시간보다 오래됐으면 「낡음」 으로 끝낸다(exit 2) — 낡은 근거로 고치지 않는다
// 실행: SB_SERVICE_KEY=… node tools/daily/cloud_bundle_get.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const KEY = process.env.SB_SERVICE_KEY;
const SBU = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const get = (n) => fetch(`${SBU}/storage/v1/object/cloud-bundle/${n}`, { headers: H });
const man = await get('manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (!man) { console.log('묶음 목록 없음'); process.exitCode = 2; }
else {
  const age = (Date.now() - new Date(man.at).getTime()) / 3600e3;
  console.log(`묶음 ${man.at} (${age.toFixed(1)}시간 전) · 조각 ${man.parts} · 피드 ${man.feed}줄`);
  if (age > 48) { console.log("🔴 묶음이 48시간보다 낡음 — PC 가 오래 꺼져 있다. 낡은 근거로 고치지 않음"); process.exitCode = 2; }
  else {
    const feed = new Map(); let nFile = 0;
    for (let i = 0; i < man.parts; i++) {
      const buf = Buffer.from(await get(`part-${i}.gz`).then((r) => r.arrayBuffer()));
      for (const l of zlib.gunzipSync(buf).toString('utf8').split('\n')) {
        if (!l) continue; const o = JSON.parse(l);
        if (o.b != null) { fs.mkdirSync(path.dirname(o.f), { recursive: true }); fs.writeFileSync(o.f, Buffer.from(o.b, 'base64')); nFile++; }
        else { if (!feed.has(o.f)) feed.set(o.f, []); feed.get(o.f).push(o.l); }
      }
    }
    for (const [f, ls] of feed) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ls.join('\n') + '\n'); }
    fs.writeFileSync('tools/daily/alert.mjs', [
      '// 클라우드용 빈 껍데기 — cloud_bundle_get.mjs 가 쓴다(PC 알림 파일을 건드리지 않게)',
      'export function readAlerts() { return []; }',
      'export function setAlert() {}',
      'export function clearAlert() {}',
      'export function pushAlerts() { return { ok: true, skipped: \'클라우드\' }; }', ''].join('\n'));
    console.log(`풀기 끝: 파일 ${nFile} · 피드 ${feed.size}일치`);
  }
}
