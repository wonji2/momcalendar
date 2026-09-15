// 스윕이 캡션을 못 받은 게시물 채우기 (2026-09-15 검증자 지적: 3일치 feed 행의 80~95% 가 빈 캡션 → 변환기가 "공구 언급 없음"으로 버림)
//
// 흐름: scratchpad/ig_feed/<최근 3일>.jsonl 에서 cap 이 빈 code 를 모아
//   → instagram.com/p/<code>/ og:description (로그인 불필요, node fetch) 으로 캡션 수확
//   → 같은 jsonl 에 캡션 채운 행을 덧붙이고, 변환기가 다시 보게 ig_feed_conv_seen.txt 에서 그 code 를 뺀다
//   → 이후 무인 파이프라인(xx:25)이 변환·게이트·등록.
// 실행: node tools/daily/ig_cap_fill.mjs   (LIMIT 기본 300 · 예약작업 momcal-ig-capfill 매시간 xx:20)
// 상태: scratchpad/ig_cap_fill_state.json · 시도한 code: scratchpad/ig_cap_fill_seen.txt (실패도 기록 — 게시물 삭제·비공개는 다시 봐도 없다)
// 로그: scratchpad/ig_cap_fill_log.txt (run_hidden.vbs 경유라 stderr 가 사라진다 — 오류는 여기)
// ⚠ og 의 날짜는 미국 태평양시라 쓰지 않는다. 원래 스윕 행의 t(taken_at UTC 날짜)를 그대로 쓴다. 429 가 오면 즉시 멈춘다.
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const FEED = path.join(ROOT, 'scratchpad', 'ig_feed');
const STATE = path.join(ROOT, 'scratchpad', 'ig_cap_fill_state.json');
const SEEN = path.join(ROOT, 'scratchpad', 'ig_cap_fill_seen.txt');
const SEEN_CONV = path.join(ROOT, 'scratchpad', 'ig_feed_conv_seen.txt');
const LOG = path.join(ROOT, 'scratchpad', 'ig_cap_fill_log.txt');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128';
const KST = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('Z', '+09:00');
const log = (s) => { const l = `[${KST().slice(0, 16).replace('T', ' ')}] ${s}`; console.log(l); appendFileSync(LOG, l + '\n'); };
const rd = (p) => existsSync(p) ? readFileSync(p, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
const rdJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const state = rdJson(STATE, { runs: 0 });
const save = (p) => { Object.assign(state, p, { lastRun: KST() }); writeFileSync(STATE, JSON.stringify(state, null, 2)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dec = (s) => s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
const LIMIT = Number(process.env.LIMIT || 150);   // 2026-09-15 검증자: 시간당 익명 /p/ 300 은 과속(같은 IP 로 스윕·pp_caps 도 돈다) → 150 · 2초 간격
const COOLDOWN_MS = 3 * 3600e3;                     // 429 를 맞으면 3시간 쉰다 (재차단이면 스윕 og·pp_caps 까지 같이 죽는다)

// 변환기가 다시 보게 conv_seen 에서 code 를 뺀다 — 루프 끝에 한 번만 하면 중간에 죽었을 때 채운 캡션이 영영 묻힌다(검증자 지적) → 10건마다 + finally 에서 비운다
const pendingUnconv = [];
function flushUnconv() {
  if (!pendingUnconv.length || !existsSync(SEEN_CONV)) return;
  const drop = new Set(pendingUnconv.splice(0));
  const kept = readFileSync(SEEN_CONV, 'utf8').split(/\r?\n/).filter(c => c && !drop.has(c.trim()));
  writeFileSync(SEEN_CONV, kept.join('\n') + '\n');
}

try {
  if (state.cooldownUntil && Date.now() < Date.parse(state.cooldownUntil)) { log(`429 휴식 중 (${state.cooldownUntil} 까지) — 이번 회차 건너뜀`); process.exit(0); }
  const files = readdirSync(FEED).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-3);
  const hasCap = new Set(); const empty = new Map();   // code → {file, row}
  for (const f of files) for (const line of readFileSync(path.join(FEED, f), 'utf8').split('\n')) {
    if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch { continue; }
    if (!j.code) continue;
    if (j.cap && j.cap.trim()) hasCap.add(j.code); else if (!empty.has(j.code)) empty.set(j.code, { f, j });
  }
  const seen = new Set(rd(SEEN));
  const todo = [...empty.entries()].filter(([c]) => !hasCap.has(c) && !seen.has(c)).reverse();   // 최신 파일부터
  let ok = 0, none = 0, fail = 0, stop = ''; const filled = [];
  for (const [code, { f, j }] of todo.slice(0, LIMIT)) {
    try {
      const res = await fetch('https://www.instagram.com/p/' + code + '/', { headers: { 'user-agent': UA, 'accept-language': 'ko' }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429) { stop = '429'; state.cooldownUntil = new Date(Date.now() + COOLDOWN_MS).toISOString(); log(`🔴 인스타 429 — 중단, ${state.cooldownUntil} 까지 휴식 (${code})`); break; }
      const html = await res.text();
      const og = (html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1];
      appendFileSync(SEEN, code + '\n');
      if (!og) { none++; await sleep(1200); continue; }
      const d = dec(og);
      const m = d.match(/([A-Za-z0-9._]+) - [A-Za-z]+ \d{1,2}, \d{4}: "([\s\S]*)"\.?\s*$/);
      let cap = m ? m[2] : ((d.match(/^[^:]*?: "([\s\S]*)"/) || [])[1] || '');
      const u = (m && m[1]) || j.u;
      if (!cap.trim()) { none++; await sleep(1200); continue; }
      if (m && m[1] !== j.u) log(`핸들 불일치 ${code}: 스윕 ${j.u} / og ${m[1]} → og 채택`);
      appendFileSync(path.join(FEED, f), JSON.stringify({ ...j, u, cap, src: (j.src || 'feed') + '+fill', seenAt: KST() }) + '\n');
      filled.push(code); pendingUnconv.push(code); ok++;
      if (pendingUnconv.length >= 10) flushUnconv();
    } catch (e) { fail++; log(`실패 ${code} ${String(e).slice(0, 60)}`); }
    await sleep(1800 + Math.random() * 600);
  }
  flushUnconv();
  save({ runs: (state.runs || 0) + 1, lastTodo: todo.length, lastFilled: ok, lastNone: none, lastFail: fail, lastErr: stop || null });
  log(`빈 캡션 ${todo.length} 중 시도 ${Math.min(todo.length, LIMIT)} · 채움 ${ok} · 캡션 없음 ${none} · 실패 ${fail}${stop ? ' · 중단 ' + stop : ''}`);
} catch (e) {
  log(`🔴 최상위 오류: ${String(e && e.stack || e).slice(0, 300)}`);
  save({ lastErr: String(e).slice(0, 120) });
  process.exit(1);
} finally {
  try { flushUnconv(); } catch { }
}
