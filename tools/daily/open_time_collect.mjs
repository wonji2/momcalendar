// ⏰ 공구 오픈 시각 전용 수집기 (사장님 2026-10-27 「몇시 오픈인지 공구팡팡은 어케 수집하는지 보고 우리것도 정확도높게 몇시 오픈인지 수집 별도로 하는거 만들어서 우리자체적으로도 해」)
//   설계서 scratchpad/designs/2026-10-27_오픈시각_수집기.md
//
// 공구팡팡 방식(공개 화면 실측 2026-10-27): 카드 하나 = 인스타 게시물 하나(썸네일 주소 post/<게시물 코드>·글 시각 writtenAt·AI 확신도).
//   계정을 지켜보다 새 글을 AI 가 읽어 시작 시각을 뽑고, 캡션에 시각이 없으면 0시로 채운다(0시 3건 원본 캡션에 시각 없음 확인).
// 우리는 시각 값을 남에게서 받지 않는다(규칙 0-J) — **셀러 원본 캡션을 우리 손에 넣는 일만** 한다. 읽기·쓰기는 open_time_fill(:35)이 한다.
//
// 흐름
//   ① 대상(오픈 오늘~+7일): (가) 시각 빈 행(충돌 목록 제외) · (나) 인포크만 근거인 행(캡션으로 다시 볼 것)
//      그중 우리 피드에 「그 상품 낱말이 든 그 셀러 글」(오픈 21일 전~오픈일)이 아직 없는 행만
//   ② 게시물 코드 — 로그인 불필요 길 먼저
//      공구팡팡 공개 달력 calendar?d=0..7 (하루 8요청) 의 대상 셀러 글 코드 · 집계 공통 DB(agg_consensus.json) 의 셀러 글 주소
//      → 그래도 코드가 없는 셀러만 로그인 프로필(ig_profile_sweep, 최근 12개). 한 회차 최대 LIMIT 명
//   ③ 아직 피드에 없는 코드만 ig_embed_fetch(로그인 없이 캡션) → scratchpad/ig_feed/<게시일>.jsonl (채우기·날짜 대조가 같은 파서로 읽는다)
//
// 인스타 호출은 seller_recent_posts 와 **한 벌**로 센다: seller_posts/state.json(셀러 12시간)·cooldown.json(6시간 쉬기)·ig-profile-hl 잠금
//   할 일이 없으면 브라우저를 안 띄운다 · 프로필 연속 0 / embed 연속 실패 5 → 6시간 쉰다
// 실행  node tools/daily/open_time_collect.mjs [--dry]     (LIMIT=15 기본 · 프로필은 오픈 3일 안 셀러만)
// 상태  scratchpad/open_time_collect/ log.txt · pp_leads.jsonl(공구팡팡에서 본 글 코드, 30일)
// 주기  윈도우 예약작업 momcal-open-time-collect 3시간마다 :15 (채우기 :35 전에 끝나게)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';
import { loadFeed } from './date_judge.mjs';
import { toks, STOP, nameMatch } from './verify_judge.mjs';

const MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (...f) => path.join(ROOT, 'scratchpad', ...f);
const DIR = SP('open_time_collect');
const SPOST = SP('seller_posts');
const STATE = path.join(SPOST, 'state.json'), COOL = path.join(SPOST, 'cooldown.json');
const LOCK = 'C:/Users/FAMILY/.momcal-ig-profile-hl.lock';
const LOG = path.join(DIR, 'log.txt'), LEADS = path.join(DIR, 'pp_leads.jsonl');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const LIMIT = Number(process.env.LIMIT || 15);   // 로그인 프로필은 seller_recent_posts(40명/3시간)와 같은 계정이다 → 이쪽은 15명, 오픈 3일 안 셀러만
const DRY = process.argv.includes('--dry');
const MAX_EMBED = 60;
const KST = () => new Date(Date.now() + 9 * 3600e3).toISOString();
const TODAY = KST().slice(0, 10);
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const rdJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const log = (s) => { const l = `[${KST().slice(0, 16).replace('T', ' ')}] ${s}`; console.log(l); if (!DRY) try { fs.appendFileSync(LOG, l + '\n'); } catch { } };
const kstDay = (v) => { const t = Date.parse(v || ''); return isNaN(t) ? '' : new Date(t + 9 * 3600e3).toISOString().slice(0, 10); };

function sql(text) {
  const rel = `scratchpad/_otc_${process.pid}_${Date.now()}.sql`;
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8');
  try {
    for (let i = 0; ; i++) {
      try { const r = parseRows(execFileSync(CLI, sbArgs(rel), { encoding: 'utf8', cwd: ROOT, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 })); if (!r.ok) throw new Error(r.why); return r.rows; }
      catch (e) { if (i >= 2) throw e; }
    }
  } finally { try { fs.unlinkSync(path.join(ROOT, rel)); } catch { } }
}

// 공구팡팡 공개 달력 한 장 → 카드 객체들 (RSC self.__next_f.push 조각을 이어 붙여 {"offerId": 객체를 통째로 읽는다)
export function ppOffers(html) {
  const s = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => { try { return JSON.parse('"' + m[1] + '"'); } catch { return ''; } }).join('');
  const out = [];
  for (let i = s.indexOf('{"offerId":'); i >= 0; i = s.indexOf('{"offerId":', i + 1)) {
    let depth = 0, j = i, inStr = false, esc = false;
    for (; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; }
    }
    try { out.push(JSON.parse(s.slice(i, j + 1))); } catch { }
  }
  return out;
}
// 썸네일 주소 끝이 인스타 게시물 코드다(…/post/De9wATrgTW9 = instagram.com/p/De9wATrgTW9 — 2026-10-27 캡션 대조로 확인)
export const ppCode = (o) => (String(o.thumbnailUrl || '').match(/\/post\/([A-Za-z0-9_-]{8,20})$/) || [])[1] || '';

if (MAIN) {
  fs.mkdirSync(DIR, { recursive: true });
  // 한도(규칙 0-L): 공구팡팡 글 코드는 30일치만 · log 1MB 넘으면 뒤 2,000줄
  try { if (fs.statSync(LOG).size > 1e6) fs.writeFileSync(LOG, fs.readFileSync(LOG, 'utf8').split('\n').slice(-2000).join('\n')); } catch { }
  const cool = rdJson(COOL, {});
  const cooling = cool.until && cool.until > KST();

  // ① 대상
  const conflictIds = new Set(rdJson(SP('open_time_conflict.json'), []).map(Number));
  const rows = sql(`select id, name, lower(insta) insta, open_date, coalesce(open_time_src,'') src from public.gonggu
    where approved and coalesce(insta,'') <> '' and open_date >= '${TODAY}' and open_date <= '${addDays(TODAY, 7)}'
      and (open_time is null or open_time_src = 'inpock') order by open_date, id;`).filter((r) => r.src || !conflictIds.has(+r.id));
  const handles = [...new Set(rows.map((r) => r.insta))];
  const feed = loadFeed(ROOT, handles, 60, TODAY);
  const wantOf = (name) => toks(name).filter((w) => !STOP.has(w) && w.length >= 2);
  const covered = (r) => (feed.get(r.insta) || []).some((p) => p.t <= r.open_date && p.t >= addDays(r.open_date, -21) && wantOf(r.name).some((w) => p.cap.toLowerCase().includes(w)));
  const gap = rows.filter((r) => !covered(r));
  const byH = new Map();
  for (const r of gap) { if (!byH.has(r.insta)) byH.set(r.insta, []); byH.get(r.insta).push(r); }
  log(`① 대상 ${rows.length}행(빈칸 ${rows.filter((r) => !r.src).length} · 인포크만 ${rows.filter((r) => r.src).length}) 중 우리 피드에 그 상품 글이 없는 행 ${gap.length} · 셀러 ${byH.size}명${cooling ? ` · 인스타 쉬는 중 ~${cool.until.slice(0, 16)}` : ''}`);

  // ② 게시물 코드 — 공구팡팡 공개 달력(오늘~+7일, 하루 한 장씩)
  const leads = new Map();
  for (const l of (fs.existsSync(LEADS) ? fs.readFileSync(LEADS, 'utf8').split('\n') : [])) { try { const o = JSON.parse(l); if (o.code && o.seen >= addDays(TODAY, -30)) leads.set(o.code, o); } catch { } }
  let ppReq = 0, ppNew = 0, ppErr = '';
  if (byH.size) for (let d = 0; d <= 7; d++) {
    try {
      const r = await fetch(`https://09pangpang.com/calendar?d=${d}`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' }, signal: AbortSignal.timeout(20000) });
      ppReq++;
      if (!r.ok) { ppErr = `d=${d} ${r.status}`; continue; }
      for (const o of ppOffers(await r.text())) {
        const code = ppCode(o), h = String(o.account?.handle || '').toLowerCase();
        if (!code || !h || leads.has(code)) continue;
        // 시각은 참고로만 적어 둔다(0시는 「시각 없음」 기본값이라 빈칸) — 값으로 쓰지 않는다
        const t = Date.parse(o.startAt || ''); const hm = isNaN(t) ? '' : new Date(t + 9 * 3600e3).toISOString().slice(11, 16);
        leads.set(code, { code, h, title: String(o.title || '').slice(0, 80), open: kstDay(o.startAt), hm: hm === '00:00' ? '' : hm, written: o.writtenAt || '', seen: TODAY });
        ppNew++;
      }
    } catch (e) { ppErr = `d=${d} ${String(e.message || e).slice(0, 60)}`; }
    await new Promise((res) => setTimeout(res, 700));
  }
  if (!DRY) fs.writeFileSync(LEADS, [...leads.values()].map((o) => JSON.stringify(o)).join('\n') + '\n');
  const haveCodes = new Set([...feed.values()].flat().map((p) => p.code).filter(Boolean));
  // 이미 읽은 코드(_ig_embed_seen.txt)는 새 코드로 안 센다: 빈 글·60일 밖 옛 글이 매 회차 자리를 차지하고 셀러를 프로필 대상에서 빼던 것(검증자 2026-10-27)
  try { for (const c of fs.readFileSync(SP('_ig_embed_seen.txt'), 'utf8').split(/\r?\n/)) if (c.trim()) haveCodes.add(c.trim().replace(/^(p|reel)\//, '')); } catch { }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const codeDay = (c) => { let id = 0n; for (const ch of String(c).slice(0, 11)) { const k = B64.indexOf(ch); if (k < 0) return ''; id = id * 64n + BigInt(k); } return new Date(Number((id >> 23n) + 1314220021721n) + 9 * 3600e3).toISOString().slice(0, 10); };
  const codes = new Set(), viaLead = new Set();
  for (const o of leads.values()) {
    const mine = byH.get(o.h); if (!mine || haveCodes.has(o.code)) continue;
    if (mine.some((r) => !o.open || (o.open >= addDays(r.open_date, -1) && o.open <= addDays(r.open_date, 1)))) { codes.add(`p/${o.code}`); viaLead.add(o.h); }
  }
  // 집계 공통 DB(cafe-links 세션)의 셀러 인스타 글 주소
  try {
    for (const cl of rdJson(SP('agg_consensus.json'), { clusters: [] }).clusters || []) {
      const h = String(cl.handle || '').toLowerCase(); if (!byH.has(h)) continue;
      for (const v of Object.values(cl.sites || {})) {
        const m = String(v.url || v.post_url || '').match(/instagram\.com\/(p|reel)\/([A-Za-z0-9_-]{5,20})/);
        const d = codeDay(m ? m[2] : ''); const mine = byH.get(h);
        if (m && !haveCodes.has(m[2]) && mine.some((r) => d && d <= r.open_date && d >= addDays(r.open_date, -21) && nameMatch(r.name, v.name || (cl.names || [])[0] || '') >= 1)) { codes.add(`${m[1]}/${m[2]}`); viaLead.add(h); }
      }
    }
  } catch { }
  log(`② 공구팡팡 ${ppReq}요청 새 글 코드 ${ppNew}(쌓인 것 ${leads.size})${ppErr ? ` · 오류 ${ppErr}` : ''} · 대상 셀러 글 코드 ${codes.size}개(${viaLead.size}명)`);

  // ②-b 코드가 하나도 없는 셀러만 로그인 프로필로 — 오늘·내일 오픈 먼저, 12시간 안에 연 셀러는 안 연다
  const state = rdJson(STATE, {});
  const recent = (h) => state[h] && Date.now() - Date.parse(state[h]) < 12 * 3600e3;
  const first = (h) => byH.get(h).map((r) => r.open_date).sort()[0];
  const pick = [...byH.keys()].filter((h) => !viaLead.has(h) && !recent(h) && first(h) <= addDays(TODAY, 3)).sort((a, b) => first(a).localeCompare(first(b)) || byH.get(b).length - byH.get(a).length).slice(0, LIMIT);
  if (DRY) {
    log(`(시험) 프로필로 열 셀러 ${pick.length}명: ${pick.slice(0, 15).join(',')}`);
    log(`(시험) 받을 글 코드 ${codes.size}개: ${[...codes].slice(0, 10).join(' ')}`);
  } else if (cooling) {
    log('인스타 쉬는 중 — 프로필·캡션 받기는 건너뛴다(공구팡팡 글 코드만 쌓았다)');
  } else {
    let profs = [], psOut = '', locked = false; const profCodes = [];
    if (pick.length) {

      try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); locked = true; }
      catch { const pid = +fs.readFileSync(LOCK, 'utf8'); let alive = false; try { process.kill(pid, 0); alive = true; } catch { } if (!alive) { fs.writeFileSync(LOCK, String(process.pid)); locked = true; } else log(`ig-profile-hl 을 다른 도구(pid ${pid})가 쓰는 중 — 프로필은 다음 회차`); }
      if (locked) {
        const stamp = KST().slice(0, 16).replace(/[-:T]/g, '');
        const listF = path.join(DIR, `_list_${stamp}.txt`), profF = path.join(DIR, `_prof_${stamp}.jsonl`);
        fs.writeFileSync(listF, pick.join('\n') + '\n');
        const ps = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'daily', 'ig_profile_sweep.mjs'), listF, profF], { encoding: 'utf8', cwd: ROOT, timeout: 40 * 60e3 });
        try { fs.unlinkSync(LOCK); } catch { }
        try { fs.unlinkSync(listF); } catch { }
        psOut = ps.stdout || '';
        profs = fs.existsSync(profF) ? fs.readFileSync(profF, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
        try { fs.unlinkSync(profF); } catch { }
      }
    }
    const opened = profs.filter((p) => p.n > 0);
    // seller_recent_posts 가 그사이 쓴 기록을 덮지 않게 쓰기 직전에 다시 읽어 합친다
    if (profs.length) { const cur = rdJson(STATE, {}); for (const p of profs) cur[String(p.h).toLowerCase()] = KST(); fs.writeFileSync(STATE, JSON.stringify(cur)); }
    if (pick.length && profs.length) log(`②-b 프로필 ${profs.length}/${pick.length}명 열림 · 게시물 있음 ${opened.length}명`);
    if (/중단\(차단 의심\)/.test(psOut) || (locked && pick.length >= 5 && !opened.length)) {
      fs.writeFileSync(COOL, JSON.stringify({ until: new Date(Date.now() + 9 * 3600e3 + 6 * 3600e3).toISOString(), why: '프로필 연속 게시물 0(차단·로그아웃 의심) — open_time_collect' }));
      log('🛑 프로필이 게시물을 안 보여 준다(차단·로그아웃 의심) — 6시간 쉰다');
    } else {
      for (const p of opened) {
        const f0 = first(String(p.h).toLowerCase()) || TODAY; const from = addDays(f0 < addDays(TODAY, -3) ? f0 : addDays(TODAY, -3), -21);
        for (const c of p.posts || []) if (c.d >= from && !haveCodes.has(c.c)) profCodes.push(`${c.k}/${c.c}`);
      }
      { const lead = [...codes]; codes.clear(); for (const c of [...profCodes, ...lead]) codes.add(c); }
      // ③ 캡션 — 한 회차 최대 MAX_EMBED 개(같은 IP 로 embed 를 쓰는 도구가 셋이다: pangpang_posts_round·seller_recent_posts·이것)
      if (codes.size > MAX_EMBED) { const keep = [...codes].slice(0, MAX_EMBED); codes.clear(); keep.forEach((c) => codes.add(c)); }
      if (codes.size) {
        const codesF = path.join(DIR, `_codes_${process.pid}.txt`);
        fs.writeFileSync(codesF, [...codes].join('\n') + '\n');
        const ef = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'daily', 'ig_embed_fetch.mjs'), codesF], { encoding: 'utf8', cwd: ROOT, timeout: 40 * 60e3 });
        try { fs.unlinkSync(codesF); } catch { }
        log(`③ 캡션 받기 ${codes.size}개: ${String(ef.stdout || '').split('\n').filter((l) => /^끝 —|새 게시물 없음/.test(l.replace(/^\[[^\]]+\]\s*/, ''))).map((l) => l.replace(/^\[[^\]]+\]\s*/, '')).join(' ') || `종료 ${ef.status}`}`);
        if (ef.status === 4) {
          fs.writeFileSync(COOL, JSON.stringify({ until: new Date(Date.now() + 9 * 3600e3 + 6 * 3600e3).toISOString(), why: 'embed 연속 실패 5 — open_time_collect' }));
          log('🛑 embed 연속 실패 — 6시간 쉰다');
        }
      } else log('③ 받을 캡션 없음');
    }
  }
  // 정확도·채움률 장부(사장님 2026-10-27 「정확도가 80%이상일때 올리든말든 결정」) — scratchpad/open_time_accuracy.md·.tsv
  if (!DRY) { const rp = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'daily', 'open_time_report.mjs')], { encoding: 'utf8', cwd: ROOT, timeout: 5 * 60e3 }); log('장부 ' + String(rp.stdout || '').split(/\r?\n/).filter((l) => /일치율|우리도 아는/.test(l)).map((l) => l.replace(/^- /, '').replace(/\*/g, '')).join(' / ')); }
  log('끝 (시각 읽기·쓰기는 open_time_fill :35 회차)');
}
