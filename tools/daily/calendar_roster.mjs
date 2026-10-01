/**
 * 📋 **달력 셀러 명단** — 달력으로 월간 일정을 올리는 셀러를 기억하고, 이번 달 달력이 비었는지 본다
 *
 * 사장님 지시 2026-10-01:
 *   "달력 9월에 파싱했던 모든셀러 다 찾아서 그 사람들은 앞으로도 계속 달력으로 올리니까
 *    기억해뒀다가 매달 달력파싱 작업도 정기업무로 넣어서 하면 되잖아"
 *
 * 왜 명단이 필요한가: 피드 스윕은 모든 셀러를 훑지만 **달력 글이 안 올라왔는지 알 수 없다.**
 *   달력 셀러는 매달 올리니, 「이 셀러는 매달 올리는데 이번 달 것이 아직 없다」를 집어낼 수 있다.
 *   그게 월초에 사람이 봐야 할 **단 하나의 목록**이다.
 *
 * 명단 파일: scratchpad/calendar_sellers.tsv
 *   핸들 \t 마지막으로 달력이 잡힌 달(YYYY-MM) \t 그 달 뽑힌 건수 \t 누적 달 수 \t 처음 잡힌 달
 *
 *   node tools/daily/calendar_roster.mjs --add <파싱결과.tsv> [...]   명단에 반영한다
 *   node tools/daily/calendar_roster.mjs --gaps                      이번 달 달력이 없는 셀러를 뽑는다
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const F = path.join(ROOT, 'scratchpad', 'calendar_sellers.tsv');
const KST = () => new Date(Date.now() + 9 * 3600e3);
const thisMonth = KST().toISOString().slice(0, 7);
const shiftMon = (n) => { const d = KST(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const MON_MIN = shiftMon(-1), MON_MAX = shiftMon(2);

// 핸들 → {last, cnt, months:Set, first}
const load = () => {
  const m = new Map();
  if (!fs.existsSync(F)) return m;
  for (const l of fs.readFileSync(F, 'utf8').split(/\r?\n/)) {
    if (!l.trim() || l.startsWith('#')) continue;
    const [h, last, cnt, nmon, first, seen] = l.split('\t');
    m.set(h, { last, cnt: +cnt || 0, nmon: +nmon || 1, first: first || last, seen: new Set((seen || last || '').split(',').filter(Boolean)) });
  }
  return m;
};
const save = (m) => {
  const head = [
    '# 달력으로 월간 일정을 올리는 셀러 명단 (사장님 지시 2026-10-01)',
    '# 핸들\t마지막달\t그달건수\t누적달수\t처음달\t잡힌달들',
    '# 갱신: node tools/daily/calendar_roster.mjs --add <파싱결과.tsv>   ·   점검: --gaps',
  ].join('\n');
  const rows = [...m.entries()].sort((a, b) => (b[1].last || '').localeCompare(a[1].last || '') || a[0].localeCompare(b[0]))
    .map(([h, v]) => [h, v.last, v.cnt, v.seen.size || v.nmon, v.first, [...v.seen].sort().join(',')].join('\t'));
  fs.writeFileSync(F, head + '\n' + rows.join('\n') + '\n', 'utf8');
};

const AGG = /^(gonggu_|gongu_|gonggoo|ggonggu|momcal)/;
// 파싱 제외 셀러는 명단에도 올리지 않는다
const EXCLUDED = new Set();
try {
  for (const l of fs.readFileSync(path.join(ROOT, 'scratchpad', 'parsing_excluded.txt'), 'utf8').split(/\r?\n/)) {
    const h = l.trim().split(/[\s|#(]/)[0];
    if (/^[a-z0-9._]{3,}$/.test(h)) EXCLUDED.add(h);
  }
} catch { }

if (process.argv.includes('--add')) {
  const files = process.argv.slice(process.argv.indexOf('--add') + 1).filter((x) => !x.startsWith('--'));
  const m = load();
  let added = 0, upd = 0, skipped = 0;
  for (const f of files) {
    if (!fs.existsSync(f)) { console.log(`없음: ${f}`); continue; }
    // 파싱결과 TSV: handle \t slug \t name \t open \t end \t link
    const byHandleMonth = new Map();
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const c = l.split('\t'); if (c.length < 4) continue;
      const h = c[0].replace(/^@+/, '').toLowerCase();
      if (!h || AGG.test(h) || EXCLUDED.has(h)) { skipped++; continue; }
      const mon = (c[3] || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(mon)) continue;
      // 🔴 2026-10-01: 달력 파서는 **모든 날짜에 올해를 붙인다.** 그래서 「12/28」·「2/5」 같은 줄이
      //    2026-12 · 2026-02 로 읽혀 명단의 「마지막달」을 왜곡했다(등록은 날짜창이 걸러낸다).
      //    명단에는 **말이 되는 달만** 담는다 — 지난달 ~ 두 달 뒤.
      if (mon < MON_MIN || mon > MON_MAX) continue;
      const k = h + '|' + mon;
      byHandleMonth.set(k, (byHandleMonth.get(k) || 0) + 1);
    }
    for (const [k, n] of byHandleMonth) {
      const [h, mon] = k.split('|');
      const v = m.get(h);
      if (!v) { m.set(h, { last: mon, cnt: n, nmon: 1, first: mon, seen: new Set([mon]) }); added++; }
      else {
        v.seen.add(mon);
        if (mon >= (v.last || '')) { v.last = mon; v.cnt = n; }
        if (mon < (v.first || '9999-99')) v.first = mon;
        upd++;
      }
    }
  }
  save(m);
  console.log(`명단 갱신 — 새 셀러 ${added}명 · 갱신 ${upd}건 · 집계·제외셀러 ${skipped}행 건너뜀`);
  console.log(`명단 총 ${m.size}명 → ${F}`);
  const cur = [...m.values()].filter((v) => v.last === thisMonth).length;
  console.log(`  이번 달(${thisMonth}) 달력이 잡힌 셀러 ${cur}명 · 아직 없는 셀러 ${m.size - cur}명`);
} else if (process.argv.includes('--gaps')) {
  const m = load();
  const gaps = [...m.entries()].filter(([, v]) => v.last !== thisMonth)
    .sort((a, b) => b[1].seen.size - a[1].seen.size || (b[1].last || '').localeCompare(a[1].last || ''));
  console.log(`이번 달(${thisMonth}) 달력이 아직 없는 달력셀러 ${gaps.length}명 / 명단 ${m.size}명\n`);
  console.log('  ⚠ 「없다」가 아니라 「아직 못 잡았다」다 — 셀러 피드를 직접 봐야 한다 (규칙 0-P: 수확 0건은 내 도구를 의심한다)');
  console.log('\n  누적 달 수 많은 순 (매달 꾸준히 올리는 셀러일수록 위):');
  for (const [h, v] of gaps.slice(0, 40)) console.log(`    @${h.padEnd(26)} 마지막 ${v.last} · 누적 ${v.seen.size}달`);
  if (gaps.length > 40) console.log(`    … 그 외 ${gaps.length - 40}명`);
  const out = path.join(ROOT, 'scratchpad', `calendar_gaps_${thisMonth}.txt`);
  fs.writeFileSync(out, gaps.map(([h]) => h).join('\n') + '\n', 'utf8');
  console.log(`\n  명단 → ${out}  (피드 스윕·바이오 수확이 이 셀러들을 먼저 보게 쓴다)`);
} else {
  const m = load();
  console.log(`달력 셀러 명단 ${m.size}명 · 이번 달(${thisMonth}) 잡힘 ${[...m.values()].filter((v) => v.last === thisMonth).length}명`);
  console.log(`사용법: --add <파싱결과.tsv> [...]  |  --gaps`);
}
