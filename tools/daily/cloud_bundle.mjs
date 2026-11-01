// PC 에만 있는 판정 근거를 클라우드(깃허브 Actions)도 쓰게 Supabase 비공개 저장소에 올린다 (2026-10-27, 사장님 「피시랑 상관없이 제보 받는대로 바로바로 고쳐」)
//
// 왜: 손님 제보 처리기(inquiry_triage.mjs → gonggu_date_audit.mjs)는 날짜를 셀러 원본으로 대조한다.
//     그 근거 중 인스타 피드 캡션(scratchpad/ig_feed)·리틀리 수확(_littly_out.tsv)·인포크 수확기(scratchpad/inpock_harvest.mjs)는
//     이 PC 에만 있다. 클라우드가 같은 근거를 받아야 PC 와 같은 판정을 한다(규칙 0-K: 근거 하나 빠진 판정기로 무인 수정 금지).
// 무엇을: 하나의 gz 파일(JSONL, 줄마다 {f: 상대경로, b: 내용 base64} 또는 피드는 {f, l: 한 줄})
//   · scratchpad/ig_feed/<날짜>.jsonl 최근 62일 — 지금 노출 중·최근 마감 셀러 줄만, 필드는 code·u·t·cap 만(광고 글 뺌)
//   · scratchpad/inpock_harvest.mjs · scratchpad/_littly_out.tsv · scratchpad/date_audit/verified_hash.json
// 어디로: Supabase Storage 비공개 버킷 cloud-bundle / bundle.jsonl.gz (서비스 키로만 읽힘) · 50MB 한도 → 넘으면 올리지 않고 경보
// 실행: node tools/daily/cloud_bundle.mjs  (윈도우 예약작업 momcal-cloud-bundle 3시간) · --dry 는 크기만
// 받는 쪽: tools/daily/cloud_bundle_get.mjs (깃허브 Actions 안에서 풀어 같은 자리에 둔다)
// 한도: 저장소 1GB 중 약 40MB 를 덮어쓴다(쌓이지 않음) · 받을 때만 전송량(클라우드 처리 회차당 약 40MB, 제보가 드물어 월 수백 MB 이하)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.includes('--dry');
const env = Object.fromEntries((fs.existsSync(path.join(REPO, 'tools/daily/.env')) ? fs.readFileSync(path.join(REPO, 'tools/daily/.env'), 'utf8') : '').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const KEY = process.env.SB_SERVICE_KEY || env.SB_SERVICE_KEY;
const SBU = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const log = (s) => { console.log(s); try { fs.appendFileSync(path.join(REPO, 'scratchpad', 'cloud_bundle_log.txt'), `[${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16)}] ${s}\n`); } catch {} };

// 노출 중·최근 마감 셀러(피드 줄 거르기)
const q = path.join(REPO, 'scratchpad', '_cloud_bundle_handles.sql');
fs.writeFileSync(q, "select string_agg(distinct lower(insta), ',') h from gonggu where coalesce(insta,'')<>'' and end_date >= to_char((now() at time zone 'Asia/Seoul')::date - 30,'YYYY-MM-DD');\n");
let want = null;
try {
  const raw = execFileSync(CLI, ['db', 'query', '--linked', '--output-format', 'json', '-f', q], { cwd: REPO, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  const j = JSON.parse(raw.slice(raw.indexOf(raw.trim()[0] === '[' ? '[' : '{')));
  const rows = Array.isArray(j) ? j : j.rows;
  want = new Set(String(rows[0].h || '').split(',').filter(Boolean));
} catch (e) { log('셀러 목록 못 읽음 — 멈춤 ' + e.message.slice(0, 80)); }

if (want && want.size) {
  const lines = [];
  const add = (rel) => { const p = path.join(REPO, rel); if (fs.existsSync(p)) lines.push(JSON.stringify({ f: rel, b: fs.readFileSync(p).toString('base64') })); else log('없음: ' + rel); };
  // 처리기가 쓰는 코드 전부를 PC 판 그대로(공개 레포에 아직 없는 파일·PC 에서 고친 판이 있다) — import 를 따라 모은다
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return; const p = path.join(REPO, rel); if (!fs.existsSync(p)) { log('없음: ' + rel); return; }
    seen.add(rel); add(rel);
    if (!rel.endsWith('.mjs')) return;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    for (const m of src.matchAll(/['"`]([a-z_]+\.(?:mjs|json))['"`]/g)) { const c = path.posix.join(path.posix.dirname(rel), m[1]); if (fs.existsSync(path.join(REPO, c))) walk(c); }
  };
  walk('tools/daily/inquiry_triage.mjs'); walk('tools/daily/gonggu_date_audit.mjs');
  log('코드 ' + seen.size + '개: ' + [...seen].map((x) => x.split('/').pop()).join(' '));
  add('scratchpad/_littly_out.tsv'); add('scratchpad/date_audit/verified_hash.json');
  const cut = new Date(Date.now() + 9 * 3600e3 - 62 * 86400e3).toISOString().slice(0, 10);
  const dir = path.join(REPO, 'scratchpad', 'ig_feed');
  let nFeed = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x) && x.slice(0, 10) >= cut).sort()) {
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      const um = l.match(/"u":"([^"]+)"/); if (!um || !want.has(um[1].toLowerCase())) continue;
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (!o.cap || o.ad) continue;
      lines.push(JSON.stringify({ f: 'scratchpad/ig_feed/' + f, l: JSON.stringify({ code: o.code, u: o.u, t: o.t, ad: false, cap: o.cap }) })); nFeed++;
    }
  }
  // 한 파일 50MB 한도 → 40MB 안쪽 조각으로 나눠 올린다(part-0.gz …) + manifest.json(조각 수)
  const whole = zlib.gzipSync(lines.join('\n'), { level: 9 });
  const nPart = Math.max(1, Math.ceil(whole.length / (36 * 1048576)));
  const parts = Array.from({ length: nPart }, (_, i) => zlib.gzipSync(lines.filter((_, k) => k % nPart === i).join('\n'), { level: 9 }));
  const mbs = parts.map((p) => (p.length / 1048576).toFixed(1));
  log(`묶음: 셀러 ${want.size} · 피드 ${nFeed}줄 · 조각 ${nPart}개(${mbs.join('·')}MB)`);
  if (parts.some((p) => p.length > 48 * 1048576)) log('🔴 조각이 48MB 넘음 — 올리지 않음');
  else if (!DRY) {
    if (!KEY) log('서비스 키 없음(tools/daily/.env SB_SERVICE_KEY)');
    else {
      const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
      await fetch(`${SBU}/storage/v1/bucket`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'cloud-bundle', name: 'cloud-bundle', public: false }) }).catch(() => {});
      const put = (name, body, type) => fetch(`${SBU}/storage/v1/object/cloud-bundle/${name}`, { method: 'POST', headers: { ...H, 'Content-Type': type, 'x-upsert': 'true' }, body });
      let ok = true;
      for (let i = 0; i < nPart; i++) { const r = await put(`part-${i}.gz`, parts[i], 'application/gzip'); if (!r.ok) { ok = false; log(`조각 ${i} 실패 ${r.status} ${(await r.text()).slice(0, 120)}`); } }
      if (ok) { const r = await put('manifest.json', JSON.stringify({ at: new Date().toISOString(), parts: nPart, feed: nFeed, sellers: want.size }), 'application/json'); log(`올림 조각 ${nPart} · 목록 ${r.status}`); }
    }
  }
}
