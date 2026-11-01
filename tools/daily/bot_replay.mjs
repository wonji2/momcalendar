/**
 * 🔁 챗봇 재생 점검 — 지금까지 실손님이 친 말을 전부 라이브에 다시 던져 "지금도 틀리는 것" 을 찾는다 (2026-09-08 신설)
 *   사장님: "지금까지 쌓은 데이터 기반으로 생길 오류 전부 미리 다 수정하고 대비해놔"
 *
 * 실행  node tools/daily/bot_replay.mjs            최근 30일 실손님 발화 전종
 *       node tools/daily/bot_replay.mjs 7          최근 7일
 * 판정  🔴 구멍  = "없어요" 안내를 냈는데 손님 말의 낱말(2자+)이 **진행중 상품명**에 있다 → 지금 손님이 물으면 못 준다
 *       ⚠ 느림   = 4초 초과 (카카오 5초 한도 근접)
 *       ⚠ 찾는중 = AI 마감 초과 안내가 나갔다 (재질문하면 사전에서 나온다)
 *       📏 규격  = 카카오 말풍선 규격 위반 (손님에겐 무응답)
 * 부수효과  uid BOTREPLAY + botai:true → 못 본 문장은 AI 가 해석해 사전(bot_interp)에 남는다 = 사전 예열. 같은 말은 두 번 AI 에 안 간다.
 * 로그  scratchpad/bot_replay_log.txt (최신이 맨 위)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkSpec } from './kakao_spec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const U = 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/kakao-skill';
const DAYS = Number(process.argv[2] || 30);
const LOG = path.join(ROOT, 'scratchpad', 'bot_replay_log.txt');
const MISS = /진행 중이거나 예정인 게 없|다룬 적이 없|진행 중인 게 없어요/;
const STOP = new Set(['공구', '일정', '알려줘', '있어', '있나요', '있어요', '뭐', '오늘', '내일', '이번주', '주말', '언제', '어디', '추천', '제품', '상품', '핫딜', '특가', '세일', '있을까요', '하나요', '해요', '있음', '해줘', '주세요', '그거', '아직', '어제', '보여줘', '사면', '좋을까', '싸게', '파는데', '없나', '말고', '하는', '되는', '진행', '중인', '것', '거', '좀']);

const sql = (text) => {
  const f = path.join(ROOT, 'scratchpad', '_replay_tmp.sql');
  fs.writeFileSync(f, text);
  const o = execFileSync(CLI, ['db', 'query', '--linked', '-f', f], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const i = o.indexOf('"rows"'); if (i < 0) throw new Error('rows 없음');
  return JSON.parse(o.slice(o.lastIndexOf('{', i))).rows || [];
};
const ask = async (utterance) => {
  const t0 = Date.now();
  const j = await fetch(U, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance, user: { id: 'BOTREPLAY' } }, botai: true }) }).then((r) => r.json());
  const o = j?.template?.outputs?.[0] || {};
  const text = o.textCard?.text || '';
  const head = o.carousel ? o.carousel.items[0].header.title : o.listCard ? o.listCard.header.title : o.basicCard ? String(o.basicCard.title || '') : text.split('\n')[0];
  return { ms: Date.now() - t0, kind: Object.keys(o)[0] || '??', card: !!(o.carousel || o.listCard || o.basicCard), text, head: head.slice(0, 44), spec: checkSpec(o), down: /일시적으로 조회/.test(text), wait: /아직 찾는 중/.test(text) };
};

const utts = sql(`
  select split_part(event_data,' | ',1) u, count(*) n
    from events where event_type='kakao_bot' and event_data like '%AHC%' and visited_at > now() - interval '${DAYS} days'
   group by 1 order by 2 desc, 1;`);
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const words = (u) => [...new Set(u.replace(/[?？!！.,~♡♥()]/g, ' ').split(/\s+/).map((w) => w.replace(/(이랑|랑|은|는|이|가|을|를|도|요)$/, '')).filter((w) => w.length >= 2 && !STOP.has(w)))];
const inDb = (w) => { try { return Number(sql(`select count(*) n from gonggu where approved and end_date >= '${today}' and name ilike '%${w.replace(/'/g, "''")}%';`)[0]?.n || 0); } catch { return -1; } };

const out = []; const say = (s) => { console.log(s); out.push(s); };
say(`🔁 재생 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} — 최근 ${DAYS}일 실손님 발화 ${utts.length}종`);
const holes = [], slow = [], waits = [], specs = [], downs = [];
let cards = 0, texts = 0;
for (const { u, n } of utts) {
  let r; try { r = await ask(u); } catch (e) { downs.push(u + ' ' + e.message); continue; }
  if (r.down) { downs.push(u); continue; }
  if (r.card) cards++; else texts++;
  if (r.spec?.length) specs.push(`${u} → ${r.spec.join(',')}`);
  if (r.ms > 4000) slow.push(`${r.ms}ms 「${u}」`);
  if (r.wait) waits.push(u);
  if (!r.card && MISS.test(r.text)) {
    const hit = words(u).map((w) => [w, inDb(w)]).filter(([, c]) => c > 0);
    if (hit.length) holes.push(`「${u}」(${n}회) → 없어요, 그런데 진행중에 ${hit.map(([w, c]) => `'${w}'${c}건`).join(' · ')}`);
  }
}
say(`카드 ${cards} · 글 ${texts} · 🔴구멍 ${holes.length} · ⚠느림 ${slow.length} · ⚠찾는중 ${waits.length} · 📏규격 ${specs.length} · 장애 ${downs.length}`);
holes.forEach((h) => say('  🔴 ' + h));
slow.forEach((h) => say('  ⚠ ' + h));
waits.forEach((h) => say('  ⚠ 찾는중 「' + h + '」'));
specs.forEach((h) => say('  📏 ' + h));
downs.forEach((h) => say('  🔴 장애 「' + h + '」'));
const prev = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
fs.writeFileSync(LOG, out.join('\n') + '\n\n' + prev.split('\n').slice(0, 400).join('\n'));
