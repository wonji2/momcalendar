// 사장님 카톡 알림(owner-notify) 연결·시험 도구 (2026-11-20)
//   node tools/daily/kakao_owner_connect.mjs          → 카카오 동의 주소를 만든다(10분 유효, 한 번만). 사장님이 카카오에 로그인된 브라우저에서 누른다.
//   node tools/daily/kakao_owner_connect.mjs --test   → 시험 카톡 한 통
//   node tools/daily/kakao_owner_connect.mjs --keep   → 토큰 갱신만(매주 서버 크론 owner-notify-keep 이 대신 한다)
// 비밀값은 PUSH_CRON_SECRET 환경값 또는 %USERPROFILE%\.momcal_cron_secret 에서 읽는다(코드에 안 박는다).
// 상세: supabase/functions/owner-notify/index.ts · supabase/sql/plan_owner_notify_175.sql
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const sec = process.env.PUSH_CRON_SECRET || (() => { try { return readFileSync(join(process.env.USERPROFILE || process.env.HOME || '.', '.momcal_cron_secret'), 'utf8').trim(); } catch { return ''; } })();
if (!sec) { console.error('크론 비밀값이 없습니다(PUSH_CRON_SECRET 또는 ~/.momcal_cron_secret)'); process.exit(1); }
const op = process.argv.includes('--test') ? 'test' : process.argv.includes('--keep') ? 'keep' : 'start';
const r = await fetch('https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/owner-notify?op=' + op, { method: 'POST', headers: { 'x-cron-secret': sec, 'content-type': 'application/json' }, body: '{}' });
const d = await r.json().catch(() => ({}));
if (op === 'start' && d.url) console.log('아래 주소를 카카오에 로그인된 브라우저에서 10분 안에 한 번 누르세요:\n' + d.url);
else console.log(r.status, JSON.stringify(d));
process.exit(d.ok ? 0 : 1);
