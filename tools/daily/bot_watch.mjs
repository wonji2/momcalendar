/**
 * 🔎 챗봇 실패 감시 — 10분마다 (사장님 지시 2026-09-01 "4시간이 손님 많은 시간, 10분마다 학습하고 오류 고쳐놔")
 *
 * 무인 학습기(bot_learn.mjs)는 오타만 배운다. 이건 그 옆에서
 * **실제 손님이 물었는데 카드가 안 나간 발화**를 뽑아 세션이 눈으로 고치게 하는 것이다.
 *
 * 실행   node tools/daily/bot_watch.mjs [분]      기본 12분 창
 * 판정   원문을 지금 챗봇에 다시 물어봐서 여전히 실패하는 것만 🔴 로 남긴다
 *        (이미 고친 것이 계속 뜨면 진짜 문제가 묻힌다)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const MIN = Number(process.argv[2] || 12);

const f = path.join(ROOT, 'scratchpad', '_botwatch_tmp.sql');
fs.writeFileSync(f, `
select split_part(event_data,' | ',1) says, count(*) c
  from events
 where event_type='kakao_bot' and event_data like '%AHC%'
   and split_part(event_data,' | ',3) = 'textCard'
   and visited_at > now() - interval '${MIN} minutes'
 group by 1 order by 2 desc limit 25;`);
const out = execFileSync(CLI, ['db', 'query', '--linked', '-f', f], { encoding: 'utf8', maxBuffer: 1 << 24 });
fs.unlinkSync(f);
const m = out.match(/"rows":\s*(\[[\s\S]*?\])\s*,?\s*\n\s*"warning"/) || out.match(/"rows":\s*(\[[\s\S]*\])/);
const rows = m ? JSON.parse(m[1]) : [];

// 인사·감사류는 원래 글로 답하는 게 정상이라 제외한다
const OK = /안녕|하이|반가|고마|감사|땡큐|사랑|좋아|최고|짱|대박|우와|우왕|잘가|수고|굿밤|잘자|송중기|핫딜|도움|메뉴|사용법/;
const bad = [];
for (const r of rows) {
  const say = String(r.says || '').trim();
  if (!say || OK.test(say)) continue;
  try {
    const j = await fetch(`${SB}/functions/v1/kakao-skill`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userRequest: { utterance: say, user: { id: 'BOTWATCH' } } }),
    }).then((x) => x.json());
    const o = j?.template?.outputs?.[0] || {};
    if (o.carousel || o.listCard) continue;                    // 지금은 답한다 → 이미 해결
    const t = o.textCard?.text || '';
    bad.push({ say, cnt: r.c, ans: t.split('\n')[0].slice(0, 46) });
  } catch (e) { bad.push({ say, cnt: r.c, ans: '🔴 응답 없음' }); }
}

const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
console.log(`===== ${now} 최근 ${MIN}분 손님 실패 =====`);
if (!bad.length) console.log('없음 — 손님 질문에 전부 카드로 답했습니다.');
for (const b of bad) console.log(`🔴 "${b.say}" (${b.cnt}회) → ${b.ans}`);
