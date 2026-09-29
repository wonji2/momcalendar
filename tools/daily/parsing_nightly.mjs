/**
 * 밤샘 인포크 파싱 — 사람·Claude 앱 없이 (사장님 지시 2026-09-01
 *   "수동절차 다 없애고 앱 삭제했다 재설치해도 자동으로 계속 돌아가는 시스템")
 *
 * 왜: 이 일을 하던 `night-parsing` 은 **Claude 앱 예약작업**이었고, 앱 예약작업은
 *     지금까지 4번 통째로 사라졌다(8/25·8/27·8/31·9/1). 인포크 수확은 로그인이
 *     필요 없는 순수 HTTP 라 윈도우 예약작업으로 옮기면 앱과 무관하게 돈다.
 *     (인스타 피드·바이오 수확은 로그인 브라우저가 필요해 여기 넣지 못한다 — 그건 세션 몫)
 *
 * 흐름  ① 인포크 수확 → ② 세척 → ③ 자동분류 → ④ 누적 승인표에 병합(없는 것만)
 *       등록은 하지 않는다. 사장님 승인이 필요한 단계라 승인표까지만 쌓아둔다.
 *
 * 실행  node tools/daily/parsing_nightly.mjs         (예약작업 momcal-night-parsing 이 매일 부른다)
 *       node tools/daily/parsing_nightly.mjs --n 200 (그날 확인할 셀러 수, 기본 400)
 * 로그  scratchpad/parsing_nightly_log.txt
 * 상태  scratchpad/_inpock_seen_auto.txt  (이미 확인한 핸들 — 다음 회차는 그 다음부터)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const NODE = process.execPath;
// supabase CLI — bash PATH 에 없다(메모리 node-portable-path 와 같은 함정). 절대경로를 먼저 쓴다
const SB = existsSync('C:/Users/FAMILY/supabase-cli/supabase.exe') ? 'C:/Users/FAMILY/supabase-cli/supabase.exe' : 'supabase';
// 🔴 **예약작업 환경에는 bash 가 PATH 에 없다.** 셸에서 돌 땐 되는데 무인 회차만 `spawnSync bash ENOENT` 로
//   등록 단계가 통째로 실패했다(2026-09-29 실측, 두 회차 연속). node 와 같은 함정 — 절대경로를 먼저 쓴다.
const BASH = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']
  .find((p) => existsSync(p)) || 'bash';
const LOG = SP('parsing_nightly_log.txt');
const N = Number((process.argv.find(a => a === '--n') ? process.argv[process.argv.indexOf('--n') + 1] : 0)) || 400;

const log = (s) => {
  const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  try { appendFileSync(LOG, `[${t}] ${s}\n`); } catch (_) {}
  console.log(s);
};
const run = (args, timeout = 1800e3) =>
  execFileSync(NODE, args, { encoding: 'utf8', timeout, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

try {
  // 0) 대상 명단 — DB 의 활성 셀러 핸들 (로그인 불필요, 공개 REST)
  const KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
  const API = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/gonggu';
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const since = new Date(Date.now() + 9 * 3600e3 - 90 * 864e5).toISOString().slice(0, 10);
  let handles = new Set();
  for (let from = 0; from < 6000; from += 1000) {
    const r = await fetch(`${API}?select=insta&open_date=gte.${since}&limit=1000&offset=${from}`, { headers: { apikey: KEY } });
    const p = await r.json();
    if (!Array.isArray(p) || !p.length) break;
    p.forEach(x => { const h = String(x.insta || '').trim(); if (h) handles.add(h); });
    if (p.length < 1000) break;
  }
  const seenF = SP('_inpock_seen_auto.txt');
  if (process.argv.includes('--reset')) { writeFileSync(seenF, '', 'utf8'); log(`--reset: seen 비움 — 활동 셀러 전원(${handles.size}명) 처음부터 (매월 마지막주 전수, 사장님 지시 2026-09-27)`); }
  const seen = existsSync(seenF) ? new Set(readFileSync(seenF, 'utf8').split(/\r?\n/).filter(Boolean)) : new Set();
  let todo = [...handles].filter(h => !seen.has(h));
  if (!todo.length) {           // 한 바퀴 다 돌았으면 처음부터 다시
    log(`한 바퀴 완주 — seen 초기화 후 재시작 (전체 ${handles.size}명)`);
    writeFileSync(seenF, '', 'utf8');
    todo = [...handles];
  }
  todo = todo.slice(0, N);
  const todoF = SP('_pn_todo.txt');
  writeFileSync(todoF, todo.join('\n'), 'utf8');
  log(`시작 — 대상 ${todo.length}명 (전체 ${handles.size}명 중 미확인 우선)`);

  // ① 수확 → ② 세척 → ③ 분류 → ④ 병합
  const outF = SP('_pn_out.tsv'), cleanF = SP('_pn_clean.tsv'),
        tableF = SP('_pn_table.md'), unclsF = SP('_pn_uncls.tsv');
  // ⚠ 2026-09-27 실측: 1,059명 전수는 30분 안에 안 끝난다(683명에서 ETIMEDOUT). 셀러당 8초로 잡는다(400명 53분·1,059명 2.4시간). 예약작업 한도 PT4H.
  run([SP('inpock_harvest.mjs'), todoF, outF, seenF, String(todo.length)], Math.max(1800e3, todo.length * 8e3));
  const got = existsSync(outF) ? readFileSync(outF, 'utf8').split('\n').filter(Boolean).length : 0;
  log(`① 수확 ${got}건`);
  if (!got) { log('= 수확 0건 — 종료'); process.exit(0); }

  run([SP('harvest_clean.mjs'), outF, cleanF]);
  const cleaned = readFileSync(cleanF, 'utf8').split('\n').filter(Boolean).length;
  log(`② 세척 ${cleaned}건`);

  run([SP('harvest_to_table.mjs'), cleanF, SP('catvocab.json'), tableF, unclsF]);
  const rows = existsSync(tableF) ? readFileSync(tableF, 'utf8').split('\n').filter(l => l.startsWith('|') && !/^\|\s*[-#]/.test(l)).length : 0;
  log(`③ 자동분류 ${rows}행`);

  // ③.3 핸들 정정 + 브랜드차단 필터 (2026-09-21: labu.bear/mo.jji.kom/이젠가습기가 밤샘 회차마다
  //   계속 재발해 매번 손으로 고쳤다 — 인포크 슬러그가 실제 인스타 핸들과 달라서 생기는 문제.
  //   scratchpad/handle_corrections.txt 로 알려진 것만 정정하고, brand_block 패턴에 걸리는 행은 미리 버린다)
  if (existsSync(tableF)) {
    let corrected = 0, blocked = 0;
    const corrections = {};
    try {
      for (const l of readFileSync(SP('handle_corrections.txt'), 'utf8').split(/\r?\n/)) {
        const s = l.split('#')[0].trim(); if (!s) continue;
        const [bad, good] = s.split('\t').map(x => (x || '').trim());
        if (bad && good) corrections[bad] = good;
      }
    } catch (_) {}
    let patterns = [];
    try {
      const r = await fetch(`https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/brand_block?select=pattern`, { headers: { apikey: KEY } });
      const p = await r.json();
      if (Array.isArray(p)) patterns = p.map(x => { try { return new RegExp(x.pattern, 'i'); } catch (_) { return null; } }).filter(Boolean);
    } catch (_) {}
    const lines0 = readFileSync(tableF, 'utf8').split('\n');
    const kept = lines0.filter(l => {
      if (!/^\|\s*\d/.test(l)) return true;
      if (patterns.some(re => re.test(l))) { blocked++; return false; }
      return true;
    }).map(l => {
      if (!/^\|\s*\d/.test(l)) return l;
      const c = l.split('|');
      const h = (c[8] || '').trim();
      if (corrections[h]) { c[8] = ` ${corrections[h]} `; corrected++; }
      return c.join('|');
    });
    writeFileSync(tableF, kept.join('\n'), 'utf8');
    log(`③.3 핸들 정정 ${corrected}행 · 브랜드차단 ${blocked}행 제외`);
  }

  // ③.5 한글명 채우기 (2026-09-19: 이 채널만 셀러 칸이 빈 채로 승인표에 올라가던 것 — ig_feed_pipeline 처럼
  //   이미 등록된 핸들의 최빈 influencer 를 미리 채워둔다. 못 찾으면 빈칸 그대로 두고 등록 시점 SQL 이 채운다)
  if (existsSync(tableF)) {
    const lines = readFileSync(tableF, 'utf8').split('\n');
    const dataLines = lines.filter(l => /^\|\s*\d/.test(l));
    const handlesHere = [...new Set(dataLines.map(l => l.split('|').map(c => c.trim())[8]).filter(Boolean))];
    const nameOf = {};
    for (let i = 0; i < handlesHere.length; i += 40) {
      const chunk = handlesHere.slice(i, i + 40);
      const q = chunk.map(h => `insta.eq.${encodeURIComponent(h)}`).join(',');
      try {
        const r = await fetch(`${API}?select=insta,influencer&or=(${q})&influencer=not.eq.`, { headers: { apikey: KEY } });
        const p = await r.json();
        const counts = {};
        if (Array.isArray(p)) for (const row of p) {
          const h = row.insta, nm = row.influencer;
          if (!h || !nm) continue;
          counts[h] = counts[h] || {};
          counts[h][nm] = (counts[h][nm] || 0) + 1;
        }
        for (const h of Object.keys(counts)) {
          nameOf[h] = Object.entries(counts[h]).sort((a, b) => b[1] - a[1])[0][0];
        }
      } catch (_) {}
    }
    let filled = 0;
    const outLines = lines.map(l => {
      if (!/^\|\s*\d/.test(l)) return l;
      const c = l.split('|');
      const h = (c[8] || '').trim();
      if (h && nameOf[h] && !(c[2] || '').trim()) { c[2] = ` ${nameOf[h]} `; filled++; }
      return c.join('|');
    });
    writeFileSync(tableF, outLines.join('\n'), 'utf8');
    log(`③.5 한글명 채움 ${filled}행 (핸들 ${handlesHere.length}명 조회)`);
  }

  run([SP('merge_pending.mjs'), tableF, SP('승인대기_누적.md')]);
  const acc = existsSync(SP('승인대기_누적.md'))
    ? readFileSync(SP('승인대기_누적.md'), 'utf8').split('\n').filter(l => l.startsWith('|') && !/^\|\s*[-#]/.test(l)).length : 0;
  log(`④ 병합 완료 — 누적 승인표 ${acc}행`);

  // ─────────────────────────────────────────────────────────────
  // ⑤ 등록까지 자동 (사장님 지시 2026-09-28 "계속 멈추고 말걸지말고 24시간 내내 알아서 계속 돌려")
  //
  // 🔴 게이트를 **전부 통과한 것만** 넣는다. 하나라도 걸리면 그 회차는 등록하지 않고 승인표에만 남긴다.
  //   막는 것: 마감지난 · 표내부중복 · 파싱제외셀러 · 사장님상품(우랩·마이키즈·롤팬) ·
  //            핸들 칸에 인포크 슬러그 · 핸들갈림 · 핸들없음
  //   INSERT 문 자체에도 `where not exists` 중복검사가 들어 있다(gen_insert_gonggu.mjs).
  // ⚠ 하루 상한을 둔다 — 도구가 오작동해도 피해가 하루치를 넘지 않게.
  const DAY_CAP = 600;
  try {
    run([SP('drop_ended.mjs'), tableF]);
    run([SP('pending_dedupe.mjs'), tableF]);
    if (existsSync(SP('_drop_excluded.mjs'))) run([SP('_drop_excluded.mjs'), tableF]);
    if (existsSync(SP('_slug_as_handle_check.mjs'))) run([SP('_slug_as_handle_check.mjs'), tableF, '--fix']);

    const gate = execFileSync(BASH, [SP('pending_check.sh'), tableF], { encoding: 'utf8', timeout: 900e3 });
    const num = (k) => { const m = gate.match(new RegExp('"' + k + '": (\\d+)')); return m ? +m[1] : -1; };
    const excluded = (gate.match(/excluded:\s*(\d+)/) || [])[1];
    const own = (gate.match(/own_product:\s*(\d+)/) || [])[1];
    const split = (gate.match(/handle_split:\s*(\d+)/) || [])[1];
    const isNew = num('is_new'), noHandle = num('no_handle');
    log(`⑤ 게이트 — 제외셀러 ${excluded} · 사장님상품 ${own} · 핸들갈림 ${split} · 핸들없음 ${noHandle} · 신규 ${isNew}`);

    const clean = excluded === '0' && own === '0' && split === '0' && noHandle === 0;
    if (!clean) {
      log('🔴 게이트에 걸린 것이 있다 — 이 회차는 **등록하지 않는다**. 승인표에 남겨두고 사람이 본다.');
    } else if (isNew <= 0) {
      log('= 새로 넣을 것이 없다.');
    } else if (isNew > DAY_CAP) {
      log(`🔴 신규 ${isNew}건은 하루 상한(${DAY_CAP})을 넘는다 — 등록을 멈춘다. 도구 오작동일 수 있다.`);
    } else {
      const insF = SP('_pn_ins.sql');
      // 🌉 등록 시점에 캡션이 함께 저장되게 스윕(jsonl)을 수확 형식으로 바꿔 둔다 (규칙 0-C · 2026-09-29)
      try { execFileSync(NODE, [path.join(ROOT, 'tools', 'daily', 'feed_sweep_to_harvest.mjs')], { encoding: 'utf8', timeout: 600e3 }); } catch (_) {}
      // 🔴 등록 건수는 **DB 로 센다**. 응답의 `"id":` 를 세면 다른 키·다른 문장까지 세어 과대집계된다
      //    (2026-09-29 실측: 게이트 신규 95 · 로그 109 · 실제 103 — 셋이 다 달랐다)
      const cntSql = SP('_pn_cnt.sql');
      writeFileSync(cntSql, "select count(*) as n from public.gonggu;\n", 'utf8');
      const readCnt = () => {
        try {
          const o = execFileSync(SB, ['db', 'query', '--linked', '--file', cntSql, '--output-format', 'json'],
            { encoding: 'utf8', timeout: 300e3 });
          const m = o.match(/"n":\s*"?(\d+)/); return m ? +m[1] : -1;
        } catch (_) { return -1; }
      };
      const before = readCnt();
      run([SP('gen_insert_gonggu.mjs'), tableF, insF, '--source', 'inpock']);
      // SQL 이 크면 413 → 조각으로 나눠 넣는다(조각마다 중복검사가 살아 있는지 도구가 확인한다)
      run([SP('_split_insert.mjs'), insF, SP('_pn_ins_'), '120']);
      const parts = readdirSync(SP('.')).filter(f => /^_pn_ins_\d+\.sql$/.test(f)).sort();
      for (const p of parts) {
        execFileSync(SB, ['db', 'query', '--linked', '--file', SP(p), '--output-format', 'json'],
          { encoding: 'utf8', timeout: 900e3 });
      }
      const after = readCnt();
      const done = (before >= 0 && after >= 0) ? after - before : -1;
      log(`⑥ 등록 ${done < 0 ? '?' : done}건 (DB ${before} → ${after})`);
      if (done > DAY_CAP) log(`🔴 실제 등록 ${done}건이 하루 상한 ${DAY_CAP}을 넘었다 — 도구 오작동 여부를 사람이 확인할 것`);

      // 등록 뒤 자동 점검 — 게이트가 못 보는 것(소분류 이탈·중복)을 본다
      try { execFileSync(NODE, [path.join(ROOT, 'tools', 'daily', 'cat_guard.mjs')], { encoding: 'utf8', timeout: 600e3 }); } catch (_) {}
      // 🔴 `_q_dup.sql` 하나만 돌렸더니 완전일치 1쌍만 잡히고 **브랜드낱말 겹침 17쌍**을 놓쳤다(2026-09-29).
      //    중복은 4가지 검사가 서로 다른 유형을 잡는다 — 넷 다 돌린다.
      for (const q of ['_q_dup_sim.sql', '_q_dup_brand.sql', '_q_dup_alias.sql', '_q_dup_noseller.sql', '_q_badname.sql', '_q_encoding.sql']) {
        try {
          const o = execFileSync(SB, ['db', 'query', '--linked', '--file', SP(q), '--output-format', 'json'],
            { encoding: 'utf8', timeout: 600e3 });
          const n = (o.match(/"(a_id|id)":/g) || []).length;
          const bad = (o.match(/"(날짜불량|십사일초과|이중인코딩|역슬래시|유령문자|이스케이프)":\s*"?([1-9]\d*)/g) || []).length;
          if (n || bad) log(`⚠ ${q} → ${n ? n + '행' : ''}${bad ? ' 불량지표 ' + bad + '종' : ''} — 사람이 확인할 것`);
        } catch (_) {}
      }
      try {
        const q = execFileSync(SB, ['db', 'query', '--linked', '--file', SP('_q_dup.sql'), '--output-format', 'json'],
          { encoding: 'utf8', timeout: 600e3 });
        const dups = (q.match(/"a_id":/g) || []).length;
        if (dups) log(`⚠ 등록 뒤 완전중복 ${dups}쌍 — 사람이 확인할 것`);
      } catch (_) {}
      try { execFileSync(SB, ['db', 'query', '--linked', '--file', SP('_q_seo_refresh.sql'), '--output-format', 'json'], { encoding: 'utf8', timeout: 600e3 }); } catch (_) {}
    }
  } catch (e) {
    log(`🔴 등록 단계 실패(수확·승인표는 남았다): ${String(e.message || e).slice(0, 160)}`);
  }
  log(`✅ 회차 끝.`);
} catch (e) {
  log(`🔴 실패: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
}
