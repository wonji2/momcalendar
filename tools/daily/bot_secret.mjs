// 챗봇(kakao-skill)을 부르는 우리 로봇이 AI 를 쓰려면 크론 비밀값 머리말이 있어야 한다 (보안 점검 2026-11-13 F9).
//   비밀값: 환경변수 PUSH_CRON_SECRET → 없으면 ~/.momcal_cron_secret. 둘 다 없으면 머리말 없이 부른다(규칙 답만 나온다).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
let cron = process.env.PUSH_CRON_SECRET || '';
if (!cron) { try { cron = fs.readFileSync(path.join(os.homedir(), '.momcal_cron_secret'), 'utf8').trim(); } catch { /* 없음 */ } }
export const botHeaders = () => (cron ? { 'Content-Type': 'application/json', 'x-cron-secret': cron } : { 'Content-Type': 'application/json' });
