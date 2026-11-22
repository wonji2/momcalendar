// 공구팡팡(09pangpang.com) 첫 화면 최신 목록을 **단서**로 읽어 우리 DB 에 없는 일정만 후보 표로 남긴다
// (사장님 2026-09-08 "비용 없는 선에서 1번(피드 스윕)이랑 3번(공구팡팡 단서) 섞어봐")
//
// 규칙 8(CLAUDE.md): 집계 사이트는 "누가 뭘 한다"는 단서일 뿐 — 등록은 셀러 인스타 원본(캡션)을 우리가 직접 확인한 것만.
//   그래서 이 스크립트는 DB 에 넣지 않는다. 후보 표 + 원본 릴스 링크만 남기고, 세션/스윕이 원본을 확인해 게이트로 등록한다.
//
// 실행: node tools/daily/pp_leads.mjs          (예약작업 momcal-pp-leads, 매시간)
// 출력: scratchpad/pp_leads/<날짜>.md (누적, 처음 본 것만) · 상태 scratchpad/pp_leads_state.json · seen scratchpad/pp_leads_seen.txt
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const OUT_DIR = path.join(ROOT, 'scratchpad', 'pp_leads');
const STATE = path.join(ROOT, 'scratchpad', 'pp_leads_state.json');
const SEEN = path.join(ROOT, 'scratchpad', 'pp_leads_seen.txt');
const SB_URL = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const SB_KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';   // anon(공개) 키 — 읽기만
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128';
const KST = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('Z', '+09:00');
const today = () => KST().slice(0, 10);
mkdirSync(OUT_DIR, { recursive: true });
const seen = new Set(existsSync(SEEN) ? readFileSync(SEEN, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { runs: 0 };
const save = (p) => { Object.assign(state, p, { lastRun: KST() }); writeFileSync(STATE, JSON.stringify(state, null, 2)); };

const html = await fetch('https://09pangpang.com/', { headers: { 'user-agent': UA } }).then(r => r.text()).catch(e => { save({ lastErr: String(e).slice(0, 120) }); process.exit(1); });
// 카드 순서대로 /post/N 과 인스타 원본 링크가 HTML 에 있다. 텍스트는 태그를 벗겨 줄 단위로 읽는다.
const postIds = [...html.matchAll(/href="\/post\/(\d+)"/g)].map(m => m[1]);
const lines = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').split('\n').map(s => s.trim()).filter(Boolean);
const start = lines.findIndex(l => l === '인스타 최신 공구');
const end = lines.findIndex((l, i) => i > start && l === '더 보기');
const body = lines.slice(start + 1, end > 0 ? end : undefined);

const year = today().slice(0, 4);
const md = (s) => { const m = s.match(/(\d{1,2})\/(\d{1,2})/); return m ? `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : ''; };
const cards = [];
for (let i = 0; i < body.length; i++) {
  if (!/^[a-z0-9._]{2,30}$/.test(body[i]) || body[i + 1] !== '팔로워') continue;
  const handle = body[i]; let j = i + 2;
  const followers = body[j++] || '';
  while (j < body.length && !/전$/.test(body[j])) j++;           // "26분 전" / "약 1시간 전"
  const ago = body[j++] || '';
  const name = body[j++] || '';
  let major = '', minor = '';
  if (body[j + 1] === '>') { major = body[j]; minor = body[j + 2]; j += 3; }
  const status = /오픈/.test(body[j] || '') ? body[j++] : '';
  const dates = []; while (j < body.length && /^\d{1,2}\/\d{1,2}|^~|오픈$/.test(body[j] || '')) dates.push(body[j++]);
  const dtxt = dates.join(' ');
  const [o, e] = dtxt.split('~');
  cards.push({ handle, followers, ago, name, major, minor, status, open: md(o || ''), end: md(e || '') || '', postId: postIds[cards.length] || '' });
  i = j - 1;
}

// 우리 DB 대조: 같은 insta 의 오픈일 ±2일 안에 낱말 하나라도 겹치면 "있음"
const norm = (s) => (s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
const toks = (s) => (s || '').split(/[\s·,&/+()]+/).map(norm).filter(t => t.length >= 2);
const q = async (path) => fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }).then(r => r.json()).catch(() => []);
let leads = 0, checked = 0;
const day = today(); const out = path.join(OUT_DIR, `${day}.md`);
if (!existsSync(out)) writeFileSync(out, `## 공구팡팡 단서 ${day} (자동 · DB 에 없는 것만 · 등록 전 셀러 원본 확인 필수)\n| 시각 | 셀러 | 상품(그쪽 표기) | 오픈 | 마감 | 분류(그쪽) | 원본 |\n|---|---|---|---|---|---|---|\n`);
for (const c of cards) {
  const key = `${c.handle}|${c.open}|${norm(c.name)}`;
  if (seen.has(key) || !c.open) continue;
  checked++;
  const rows = await q(`gonggu?select=name,open_date&insta=eq.${encodeURIComponent(c.handle)}&open_date=gte.${shift(c.open, -2)}&open_date=lte.${shift(c.open, 2)}`);
  const mine = Array.isArray(rows) ? rows : [];
  const nt = toks(c.name);
  const have = mine.some(r => { const rt = toks(r.name); return nt.some(t => rt.some(x => x.includes(t) || t.includes(x))); });
  appendFileSync(SEEN, key + '\n'); seen.add(key);
  if (have) continue;
  leads++;
  appendFileSync(out, `| ${KST().slice(11, 16)} | ${c.handle} | ${c.name.replace(/\|/g, '｜')} | ${c.open} | ${c.end} | ${[c.major, c.minor].filter(Boolean).join('/')} | 09pangpang.com/post/${c.postId} |\n`);
}
function shift(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
save({ runs: (state.runs || 0) + 1, lastCards: cards.length, lastChecked: checked, lastLeads: leads, lastErr: null });
console.log(`✅ 카드 ${cards.length} · 새로 본 것 ${checked} · DB 에 없는 단서 ${leads} → ${path.relative(ROOT, out)}`);
