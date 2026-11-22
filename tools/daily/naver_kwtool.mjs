// 네이버 검색광고 키워드도구 — 월간 검색량 수집기 (사장님 승인 2026-08-31)
//   node tools/daily/naver_kwtool.mjs 키워드1,키워드2,...        ← 즉석 조회
//   node tools/daily/naver_kwtool.mjs --file scratchpad/kw_targets.txt  ← 파일(한 줄 1키워드)
//
// 키: C:\Users\FAMILY\.momcal_naverad.json  (customer_id / access_license / secret_key)
//     ⚠ 레포 밖 홈 폴더 파일이다. 절대 커밋·출력하지 말 것.
// 결과: 화면 표 + scratchpad/kw_volume_log.tsv 누적 (날짜\t키워드\tPC\t모바일\t합계\t경쟁도)
//   ※ 검색량 10 미만은 API 가 "< 10" 으로 준다 → 5 로 기록한다.
// 제약: 힌트 키워드는 공백 불가(자동 제거), 한 번에 5개, 호출 간 1.2초.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const KEYFILE = path.join(os.homedir(), '.momcal_naverad.json');
let cfg;
try { cfg = JSON.parse(fs.readFileSync(KEYFILE, 'utf8')); } catch (e) {
  console.error('키 파일을 못 읽음:', KEYFILE); process.exit(1);
}
if (!cfg.customer_id || /여기에/.test(String(cfg.customer_id)) || /여기에/.test(cfg.access_license || '')) {
  console.error('키 파일이 아직 양식 그대로다. 세 값을 채워야 한다:', KEYFILE); process.exit(1);
}

const args = process.argv.slice(2);
let kws = [];
if (args[0] === '--file') {
  kws = fs.readFileSync(args[1], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(s => !s.startsWith('#'));
} else if (args[0]) {
  kws = args[0].split(',').map(s => s.trim()).filter(Boolean);
} else {
  console.error('사용법: node naver_kwtool.mjs 키워드1,키워드2  |  --file 목록.txt'); process.exit(1);
}
// 힌트는 공백 제거본으로 보낸다 (API 가 공백을 거부) — 원문↔힌트 매핑 유지
const hintOf = k => k.replace(/\s+/g, '');
const uniq = [...new Map(kws.map(k => [hintOf(k), k])).entries()]; // [hint, 원문]

const BASE = 'https://api.searchad.naver.com';
const URI = '/keywordstool';
function headers() {
  const ts = String(Date.now());
  const sig = crypto.createHmac('sha256', cfg.secret_key).update(`${ts}.GET.${URI}`).digest('base64');
  return { 'X-Timestamp': ts, 'X-API-KEY': cfg.access_license, 'X-Customer': String(cfg.customer_id), 'X-Signature': sig };
}
const numOf = v => (typeof v === 'number') ? v : (/^<\s*10/.test(String(v)) ? 5 : parseInt(String(v).replace(/,/g, '')) || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST
const LOG = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'scratchpad', 'kw_volume_log.tsv');
const rowsOut = [];

for (let i = 0; i < uniq.length; i += 5) {
  const batch = uniq.slice(i, i + 5);
  const q = 'hintKeywords=' + encodeURIComponent(batch.map(b => b[0]).join(',')) + '&showDetail=1';
  const res = await fetch(`${BASE}${URI}?${q}`, { headers: headers() });
  if (!res.ok) {
    console.error(`API ${res.status}:`, (await res.text()).slice(0, 200));
    if (res.status === 429) { console.error('속도 제한 — 30초 쉬고 재시도'); await sleep(30000); i -= 5; continue; }
    process.exit(1);
  }
  const j = await res.json();
  const map = new Map((j.keywordList || []).map(r => [r.relKeyword.replace(/\s+/g, '').toUpperCase(), r]));
  for (const [hint, orig] of batch) {
    const r = map.get(hint.toUpperCase());
    if (!r) { rowsOut.push([today, orig, '', '', '조회안됨', '']); continue; }
    const pc = numOf(r.monthlyPcQcCnt), mo = numOf(r.monthlyMobileQcCnt);
    rowsOut.push([today, orig, pc, mo, pc + mo, r.compIdx || '']);
  }
  if (i + 5 < uniq.length) await sleep(1200);
}

rowsOut.sort((a, b) => (b[4] || 0) - (a[4] || 0) || String(a[1]).localeCompare(String(b[1])));
console.log('키워드\tPC\t모바일\t월간합계\t경쟁도');
for (const r of rowsOut) console.log([r[1], r[2], r[3], r[4], r[5]].join('\t'));
fs.appendFileSync(LOG, rowsOut.map(r => r.join('\t')).join('\n') + '\n', 'utf8');
console.log(`\n${rowsOut.length}건 → ${path.resolve(LOG)} 누적`);
