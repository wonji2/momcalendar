// 🚫 브랜드 삭제·수집차단 한 방 명령 (사장님 2026-09-08 "하나하나 브랜드 지우고 끼울 때마다 내가 수동으로 해야 해?")
//
//   node tools/daily/brand_remove.mjs --pattern "(아틀리에|아뜰리에|atelier)[ _-]*(퀸스|퀸즈|queens)" --reason "브랜드 측 삭제 요청" [--dry] [--no-push]
//
// 흐름 (--dry 는 ①~③ 을 보기만 한다)
//   ① DB   : 걸리는 행을 scratchpad/삭제요청/<날짜>_<패턴>.json 에 백업 → brand_block 에 패턴 등록(트리거가 재수집 차단)
//            → gonggu·gonggu_archive·hotdeals·experiences 에서 삭제 → seo_refresh()
//   ② 파일 : g/·gg/·p/ 에서 파일명이 걸리는 페이지 삭제, s/*.html·공구브랜드.html·공구제품.html 의 링크·낱말 제거,
//            sitemap-*.xml 에서 해당 <url> 제거 (다음 05:10 빌드가 DB 기준으로 다시 만들며 나머지를 정리한다)
//   ③ 커밋·푸시 → 라이브 404 실측
//   ④ 네이버: sns-automation/src/naver-remove.js 로 서치어드바이저 "웹 페이지 검색 제외" 요청 (저장된 네이버 세션)
//   ⑤ 구글 : 서치콘솔 삭제 요청은 API 가 없다 — 접두어 URL 을 출력한다 (페이지가 404 라 요청 없이도 며칠 안에 빠진다)
//
// ⚠ 패턴은 표기 변형을 다 물되 흔한 낱말 하나로 걸지 말 것 ('퀸스' 단독 금지). 실행 전 --dry 로 걸리는 행·파일을 눈으로 본다.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(ROOT);
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const NODE = process.execPath;
const SITE = 'https://momcalendar.com';
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const PAT = opt('--pattern'); const REASON = opt('--reason') || '브랜드 측 삭제·수집중단 요청';
const DRY = argv.includes('--dry'); const NOPUSH = argv.includes('--no-push');
if (!PAT) { console.error('--pattern "정규식" 이 필요합니다'); process.exit(2); }
const re = new RegExp(PAT, 'i');
const say = (m) => console.log(m);
const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

function sql(text) {
  const f = path.join(ROOT, 'scratchpad', '_brand_remove.sql');
  fs.writeFileSync(f, text);
  const out = execFileSync(CLI, ['db', 'query', '--linked', '-f', f, '--output-format', 'json'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const j = JSON.parse(out.slice(out.indexOf('{')));
  if (j._tag === 'Error') throw new Error(JSON.stringify(j.error).slice(0, 300));
  return j.rows || [];
}

// ── ① DB ──
say(`\n■ 패턴 ${PAT}  (${DRY ? 'DRY' : '실행'})`);
const TABLES = { gonggu: 'name,brand,item,caption', gonggu_archive: 'name,brand,item', hotdeals: 'title', experiences: 'title' };
const hits = {};
for (const [t, cols] of Object.entries(TABLES)) {
  const cond = cols.split(',').map((c) => `coalesce(${c}::text,'') ~* ${q(PAT)}`).join(' or ');
  try { hits[t] = sql(`select row_to_json(x) r from ${t} x where ${cond};`).map((r) => r.r); }
  catch (e) { hits[t] = []; say(`  ⚠ ${t} 조회 실패: ${e.message.slice(0, 80)}`); }
  say(`  ${t.padEnd(15)} ${hits[t].length}건${hits[t].length ? ' — ' + hits[t].slice(0, 3).map((r) => r.name || r.title).join(' / ') : ''}`);
}
const total = Object.values(hits).reduce((a, b) => a + b.length, 0);
const slug = PAT.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
if (!DRY) {
  const bk = path.join(ROOT, 'scratchpad', '삭제요청', `${today}_${slug}.json`);
  fs.mkdirSync(path.dirname(bk), { recursive: true });
  fs.writeFileSync(bk, JSON.stringify({ pattern: PAT, reason: REASON, at: new Date().toISOString(), hits }, null, 1));
  say(`  백업 → ${path.relative(ROOT, bk)}`);
  const dels = Object.entries(TABLES).map(([t, cols]) => `delete from ${t} where ${cols.split(',').map((c) => `coalesce(${c}::text,'') ~* ${q(PAT)}`).join(' or ')};`).join('\n');
  sql(`insert into brand_block(pattern, reason) values (${q(PAT)}, ${q(REASON)}) on conflict (pattern) do nothing;\n${dels}\nselect public.seo_refresh();`);
  const left = Object.entries(TABLES).map(([t, cols]) => sql(`select count(*) n from ${t} where ${cols.split(',').map((c) => `coalesce(${c}::text,'') ~* ${q(PAT)}`).join(' or ')};`)[0].n).reduce((a, b) => a + Number(b), 0);
  say(`  DB 삭제 ${total}건 · brand_block 등록 · seo_refresh · 잔존 ${left}건${left ? ' 🔴' : ' ✅'}`);
}

// ── ② 파일 ──
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const removed = [];
for (const dir of ['g', 'gg', 'p']) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) if (re.test(f) || re.test(dec(f))) removed.push(`${dir}/${f}`);
}
say(`  페이지 ${removed.length}장: ${removed.slice(0, 5).join(', ')}${removed.length > 5 ? ' …' : ''}`);
// 브랜드 표시명(파일명 기준)과 인코딩 슬러그 — 셀러·허브 페이지에서 걷어낼 낱말
const names = [...new Set(removed.filter((f) => f.startsWith('g/')).map((f) => path.basename(f, '.html')))];
const encs = removed.map((f) => encodeURIComponent(path.basename(f, '.html')));
const scrubTargets = ['공구브랜드.html', '공구제품.html', ...fs.readdirSync('s').filter((x) => x.endsWith('.html')).map((x) => 's/' + x)];
const scrubbed = [];
for (const f of scrubTargets) {
  let s = fs.readFileSync(f, 'utf8'); const before = s;
  for (const e of encs) s = s.replace(new RegExp(`<a[^>]*${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>[^<]*</a>`, 'g'), '');
  for (const n of names) { const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); s = s.replace(new RegExp(`<a[^>]*>${esc} 공구</a>`, 'g'), '').replace(new RegExp(`${esc}·|·${esc}|${esc} `, 'g'), '').replace(new RegExp(esc, 'g'), ''); }
  if (s !== before) { scrubbed.push(f); if (!DRY) fs.writeFileSync(f, s); }
}
say(`  언급 제거 ${scrubbed.length}파일: ${scrubbed.slice(0, 6).join(', ')}`);
let smRemoved = 0;
for (const f of fs.readdirSync('.').filter((x) => /^sitemap-.*\.xml$/.test(x))) {
  let s = fs.readFileSync(f, 'utf8');
  // loc 의 마지막 경로 조각(파일명)만 대조 — 앞에 https://… 가 붙어 있어 ^ 로 시작하는 패턴이 안 걸리던 것 (dry 실측)
  s = s.replace(/<url><loc>([^<]*)<\/loc>[\s\S]*?<\/url>\r?\n?/g, (m, loc) => (re.test(dec(loc.split('/').pop() || '')) ? (smRemoved++, '') : m));
  if (!DRY) fs.writeFileSync(f, s);
}
say(`  사이트맵 항목 제거 ${smRemoved}개`);
if (DRY) { say('\n--dry: 여기까지. 실제로 하려면 --dry 를 빼고 다시.'); process.exit(0); }
for (const f of removed) fs.rmSync(f, { force: true });

// ── ③ 커밋·푸시·라이브 ──
const git = (...a) => spawnSync('git', a, { encoding: 'utf8' });
git('add', '-A', '--', 'g', 'gg', 'p', 's', '공구브랜드.html', '공구제품.html', ...fs.readdirSync('.').filter((x) => /^sitemap-.*\.xml$/.test(x)));
git('commit', '-q', '-m', `브랜드 삭제 요청 처리 — ${names.join('·') || slug}: 페이지 ${removed.length}장·사이트맵 ${smRemoved}·언급 ${scrubbed.length}파일 (brand_remove.mjs)\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`);
if (!NOPUSH) {
  const pl = git('pull', '-q', '--rebase', '--autostash', 'origin', 'main'); if (pl.status) say('  ⚠ pull: ' + pl.stderr.slice(0, 200));
  const ps = git('push', '-q', 'origin', 'main'); say(ps.status ? '  🔴 push 실패: ' + ps.stderr.slice(0, 200) : '  커밋·푸시 완료');
}
const urls = removed.map((f) => `${SITE}/${f.split('/')[0]}/${encodeURIComponent(path.basename(f))}`);
if (!NOPUSH && urls.length) {
  say('  라이브 404 대기(최대 10분)…');
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const codes = await Promise.all(urls.map((u) => fetch(`${u}?cb=${Date.now()}`).then((r) => r.status).catch(() => 0)));
    ok = codes.every((c) => c === 404);
    if (ok) say(`  라이브 404 확인 ${codes.length}/${codes.length}`);
  }
  if (!ok) say('  ⚠ 10분 안에 404 가 안 됐다 — GitHub Pages 배포를 확인');
}

// ── ④ 네이버 검색 제외 ──
const NR = path.join(ROOT, 'sns-automation', 'src', 'naver-remove.js');
if (urls.length && fs.existsSync(NR)) {
  const r = spawnSync(NODE, [NR, ...urls], { cwd: path.join(ROOT, 'sns-automation'), encoding: 'utf8', env: { ...process.env, HEADLESS: 'true' } });
  say('  네이버: ' + (r.stdout || '').trim().split('\n').slice(-3).join(' | ') + (r.status ? ` (exit ${r.status}) ${(r.stderr || '').slice(0, 120)}` : ''));
}

// ── ⑤ 구글 ──
say('\n■ 구글 서치콘솔 삭제 요청 (API 없음 — 페이지가 404 라 안 해도 며칠 안에 빠진다). 급하면 접두어로:');
for (const n of names) say(`   https://search.google.com/search-console/removals?resource_id=https%3A%2F%2Fmomcalendar.com%2F  →  https://momcalendar.com/g/${n}  /  https://momcalendar.com/gg/${n}`);
say('\n완료. 다음 05:10 빌드가 셀러·허브 페이지를 DB 기준으로 다시 만든다.');
