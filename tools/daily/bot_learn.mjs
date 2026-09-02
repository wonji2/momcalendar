/**
 * 🤖 카카오톡 챗봇 자동 학습 (2026-09-01, 사장님 지시 "매일 1시간마다 말 학습해서 답 이상하게 나간거 수정")
 *
 * 흐름
 *   ① events.kakao_bot_miss (챗봇이 못 찾은 검색어) 를 지난 24시간분 읽는다
 *   ② 각 검색어를 bot_guess RPC 로 대조 → 가까운 DB 낱말 후보를 뽑는다
 *   ③ 확실한 것만 bot_alias 에 자동 등록한다 (오타 1글자 차 · 첫 글자 동일)
 *      ⚠ 애매한 것은 등록하지 않고 보고서에만 남긴다 — 잘못 등록하면 엉뚱한 공구를 보여준다
 *   ④ 남은 것(후보 없음)은 🔴 로 보고서에 남긴다 → 세션이 보고 말투 규칙을 손본다
 *
 * 실행       node tools/daily/bot_learn.mjs        (--dry 면 등록 안 하고 보기만)
 * 예약작업   momcal-bot-learn — 30분마다 (사장님 지시 2026-09-01, Claude 무관)
 * 보고서     scratchpad/bot_learn_report.txt  (최신이 맨 위, 세션이 훑는 곳)
 * 상태       없음 — 24시간 창을 매번 다시 보고, 이미 등록된 별칭은 건너뛴다
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);   // ⚠ 예약작업은 cwd 가 System32 라 supabase --linked 가 프로젝트를 못 찾는다 (카페 크롤러와 같은 함정)
const CLI  = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const SB   = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const KEY  = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const DRY  = process.argv.includes('--dry');
const REPORT = path.join(ROOT, 'scratchpad', 'bot_learn_report.txt');

const sql = (text) => {                       // events 는 anon 열람 차단 → CLI(관리자)로만 읽는다
  const f = path.join(ROOT, 'scratchpad', '_botlearn_tmp.sql');
  fs.writeFileSync(f, text);
  const out = execFileSync(CLI, ['db', 'query', '--linked', '-f', f], { encoding: 'utf8', maxBuffer: 1 << 24 });
  fs.unlinkSync(f);
  const m = out.match(/"rows":\s*(\[[\s\S]*?\])\s*,?\s*\n\s*"warning"/) || out.match(/"rows":\s*(\[[\s\S]*\])/);
  return m ? JSON.parse(m[1]) : [];
};
const post = (p, b) => fetch(`${SB}/rest/v1/${p}`, { method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(b) }).then(r => r.json());

const lev = (a, b) => {                       // 편집거리 (자동 등록 판정용)
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[a.length][b.length];
};
const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const log = [];
const say = (s) => { console.log(s); log.push(s); };

// ① 못 알아들은 말
const miss = sql(`
  select split_part(event_data,' <= ',1) kw, count(*) c,
         max(split_part(event_data,' <= ',2)) sample
    from events where event_type='kakao_bot_miss'
     and visited_at > now() - interval '6 hours'
     and split_part(event_data,' <= ',1) <> ''
   group by 1 order by 2 desc limit 40;`);

// 이미 등록된 별칭은 건너뛴다
const known = new Set(sql(`select term from bot_alias;`).map(r => String(r.term).toLowerCase()));

say(`\n===== ${now} 챗봇 학습 =====`);
if (!miss.length) { say('못 알아들은 말 없음 — 손볼 것 없습니다.'); }

let added = 0, pend = 0, dead = 0, fixed = 0, okNone = 0, review = 0;
for (const m of miss) {
  const kw = String(m.kw || '').trim();
  if (!kw || known.has(kw.toLowerCase())) continue;
  const g = await post('rpc/bot_guess', { p_kw: kw }).catch(() => []);
  const cand = Array.isArray(g) ? g.map(x => x.word).filter(Boolean) : [];
  if (!cand.length) {
    // 지금도 실패하는지 챗봇에 다시 물어본다 — 이미 고친 옛 로그가 계속 🔴 로 뜨면 진짜 문제가 묻힌다
    const say2 = m.sample || kw;
    let nowOk = '';
    try {
      const r = await fetch(`${SB}/functions/v1/kakao-skill`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userRequest: { utterance: say2, user: { id: 'BOTLEARN' } } }) }).then(x => x.json());
      const o = r?.template?.outputs?.[0] || {};
      // 카드 = 찾아줬다 / "없어요" 안내 = 그런 공구가 정말 없는 것(안내가 정답) / 그 외 텍스트 = 알아듣긴 했다
      if (o.carousel || o.listCard) nowOk = 'card';
      else if (/진행 중이거나 예정인 게 없어요/.test(o.textCard?.text || '')) nowOk = 'none';
      else if (o.textCard) nowOk = 'text';
    } catch (_) { /* 확인 실패면 🔴 */ }
    if (nowOk === 'card' || nowOk === 'text') { fixed++; say(`🟢 이제 됨   "${say2}"  (${m.c}회) — 지난 로그, 손볼 것 없음`); continue; }
    if (nowOk === 'none') {
      // 🔑 거르지 말고 전부 올린다 (사장님 지시 2026-09-02)
      //    전에는 순한글 2~6자만 올렸다. 그래서 "이유식 스푼 파는곳 있어?" 같은
      //    **문장**이 사장님 눈에 안 보였고, 정작 그게 우리가 못 알아들은 진짜 사례였다.
      //    무엇이 틀렸는지는 사장님이 보고 판단하신다.
      // ⚠ 우리 테스트만 뺀다 — 사람이 친 말이 아니다.
      const isOurTest = /ㅁㄴㅇㄹ|존재하지않|존재안하|존재안함|없는브랜드|아기침대2024|테스트|zzz|asdf|qwer/i.test(say2);
      if (!isOurTest) {
        review++;
        if (!DRY) { const qq = (t) => "'" + String(t).replace(/'/g, "''") + "'";
          try { sql(`select bot_review_add(${qq(kw)}, ${qq(say2)}, ${Number(m.c) || 1});`); } catch (_) {} }
        say(`🙋 사장님 검토  "${say2}"  (${m.c}회)`);
        continue;
      }
      okNone++; say(`🟡 우리 테스트 "${say2}"  (${m.c}회) — 검토판에 안 올림`); continue;
    }
    dead++; say(`🔴 확인 실패 "${kw}"  (원문: ${say2}) ${m.c}회 — 챗봇 응답을 못 받았습니다`); continue;
  }

  // ③ 확실한 것만 자동 등록 = 한 낱말 + 편집거리 정확히 1 (= 진짜 오타)
  //   ⚠ 이 조건을 느슨하게 하면 "소고기 어" → "소고기칩" 처럼 다른 상품을 배운다 (2026-09-01 dry 에서 잡음)
  const best = cand[0];
  // 🔴 2026-09-02: 여기 `!/\s/` 에서 백슬래시가 사라져 `!/s/` 로 있었다.
  //    "알파벳 s 가 없으면" 이라는 뜻이 되어 **공백 검사가 죽어 있었다.**
  // 🔴 그리고 **길이가 같을 때만** 배운다 — 오타는 치환이지 글자가 빠지는 게 아니다.
  //    이걸 안 걸어서 `브라운(3) → 브라(2)` 를 배웠다(리틀브라운 쌀빵 ↔ 누브라 속옷).
  const sure = !/\s/.test(kw) && kw.length >= 3 &&
    best.length === kw.length && best[0] === kw[0] && lev(best, kw) === 1;
  if (sure) {
    // ⚠ bot_alias 는 손님 키로 쓰기가 막혀 있다(RLS) → 반드시 CLI(관리자)로 넣고, 넣은 뒤 되읽어 확인한다.
    //   2026-09-01: anon 으로 넣다 조용히 실패했는데 catch 가 삼켜서 "배웠음"으로 거짓 보고했다.
    let okIns = DRY;
    if (!DRY) {
      const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";
      try {
        sql(`insert into bot_alias(term, expand) values (${q(kw)}, ${q(best)}) on conflict (term) do nothing;`);
        okIns = sql(`select 1 ok from bot_alias where term = ${q(kw)};`).length > 0;
      } catch (e) { okIns = false; }
    }
    if (!okIns) { dead++; say(`🔴 등록실패 "${kw}" → "${best}" — bot_alias 에 안 들어갔습니다`); continue; }
    known.add(kw.toLowerCase()); added++;
    say(`✅ 배웠음  "${kw}" → "${best}"  (${m.c}회)`);
  } else {
    pend++; say(`⏳ 애매함  "${kw}" ~ ${cand.join(', ')}  (${m.c}회) — 사람이 판단`);
  }
}
say(`요약: 자동학습 ${added} · 🙋사장님검토 ${review} · 사람판단 ${pend} · 이미해결 ${fixed} · 없는게맞음 ${okNone} · 🔴이상 ${dead}${DRY ? '  (--dry, 실제 등록 안 함)' : ''}`);

const prev = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8') : '';
fs.writeFileSync(REPORT, log.join('\n') + '\n' + prev.split('\n').slice(0, 400).join('\n'));
