// 깃허브 Actions 안에서 PC 가 올린 판정 묶음(cloud_bundle.mjs)을 받아 같은 자리에 푼다 (2026-10-27)
//   받는 것: 처리기 코드(PC 판 그대로) · 인스타 피드 최근 62일(노출 셀러만) · 리틀리 수확 · 판정 해시
//   알림은 alert.mjs 클라우드 모드(env MOMCAL_CLOUD=1)가 health_alerts 로 보낸다 — 워크플로가 env 를 준다.
//   조각은 scratchpad/_bundle/ 에 두고 manifest.at 가 같으면 다시 받지 않는다(워크플로 actions/cache 가 그 폴더를 보관 — 묶음 62MB, 전송량 한도).
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
      const cdir = 'scratchpad/_bundle'; fs.mkdirSync(cdir, { recursive: true });
      const cf = `${cdir}/part-${i}.gz`, cm = `${cdir}/manifest.json`;
      let buf = null;
      if (fs.existsSync(cf) && fs.existsSync(cm) && JSON.parse(fs.readFileSync(cm, 'utf8')).at === man.at) { buf = fs.readFileSync(cf); console.log(`조각 ${i} 캐시에서`); }
      else { buf = Buffer.from(await get(`part-${i}.gz`).then((r) => r.arrayBuffer())); fs.writeFileSync(cf, buf); if (i === man.parts - 1) fs.writeFileSync(cm, JSON.stringify(man)); console.log(`조각 ${i} 받음 ${(buf.length / 1048576).toFixed(1)}MB`); }
      for (const l of zlib.gunzipSync(buf).toString('utf8').split('\n')) {
        if (!l) continue; const o = JSON.parse(l);
        if (o.b != null) { fs.mkdirSync(path.dirname(o.f), { recursive: true }); fs.writeFileSync(o.f, Buffer.from(o.b, 'base64')); nFile++; }
        else { if (!feed.has(o.f)) feed.set(o.f, []); feed.get(o.f).push(o.l); }
      }
    }
    for (const [f, ls] of feed) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ls.join('\n') + '\n'); }
    // (alert.mjs 는 MOMCAL_CLOUD=1 환경이면 스스로 클라우드 모드 — 덮어쓰지 않는다, 2026-11-01)
    console.log(`풀기 끝: 파일 ${nFile} · 피드 ${feed.size}일치`);
  }
}
