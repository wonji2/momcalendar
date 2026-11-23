// 휴면 제품 페이지(p/) 색인 지킴 명단 — 최근 90일 구글 노출 1회 이상인 p 페이지는 noindex 로 내리지 않는다 (2026-11-23 ORDER_TEST_BLOCK_AND_SEO_TOP3 §4-1)
//
//   gg_keep_index.mjs(2026-11-19) 를 그대로 복제하고 대상만 /p/ 로 바꿨다. gg 쪽 규칙은 건드리지 않는다.
//   무엇을: 서치콘솔 공식 API(읽기 전용)로 최근 90일 /p/ 페이지별 노출을 읽어 tools/seo/p_keep_index.txt 에 파일 이름을 한 줄씩 쓴다.
//   어디서: 깃허브 Actions seo-daily.yml 「페이지 생성」 앞 단계(PC 가 꺼져도 돈다). build.ps1 의 PIndexTier 가 이 파일을 읽는다.
//   실행:   node tools/seo/p_keep_index.mjs
//   열쇠:   GSC_CLIENT_ID · GSC_CLIENT_SECRET · GSC_REFRESH_TOKEN (깃허브 Secrets / 로컬은 tools/daily/.env). 없거나 API 가 실패하거나 30줄 미만이면 기존 명단을 그대로 두고 끝낸다(빌드는 계속).
//   한도:   하루 1회 호출 · 명단은 수백 줄(수십 KB).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools/seo/p_keep_index.txt');
const SITE = 'https://momcalendar.com/';
const envFile = () => { try { return Object.fromEntries(fs.readFileSync(path.join(ROOT, 'tools/daily/.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])); } catch { return {}; } };
const E = { ...envFile(), ...process.env };
const CID = E.GSC_CLIENT_ID || E.BLOGGER_CLIENT_ID, CSEC = E.GSC_CLIENT_SECRET || E.BLOGGER_CLIENT_SECRET, RT = E.GSC_REFRESH_TOKEN;
const keep = (m) => { console.log('⚠ ' + m + ' — 기존 명단을 그대로 둔다'); process.exit(0); };
if (!CID || !CSEC || !RT) keep('서치콘솔 열쇠 없음');

try {
  const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: RT, grant_type: 'refresh_token' }) }).then((x) => x.json());
  if (!tok.access_token) keep('토큰 갱신 실패 ' + (tok.error || ''));
  const ymd = (d) => d.toISOString().slice(0, 10);
  const end = new Date(Date.now() - 2 * 864e5), start = new Date(Date.now() - 92 * 864e5);
  const rows = [];
  for (let at = 0; ; at += 25000) {
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), dimensions: ['page'], dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: '/p/' }] }], rowLimit: 25000, startRow: at }),
    }).then((x) => x.json());
    if (r.error) keep('API 오류 ' + (r.error.message || ''));
    const b = r.rows || []; rows.push(...b); if (b.length < 25000) break;
  }
  const names = [...new Set(rows.filter((r) => r.impressions >= 1).map((r) => { try { return decodeURIComponent(new URL(r.keys[0]).pathname); } catch { return ''; } })
    .filter((p) => /^\/p\/[^/]+\.html$/.test(p)).map((p) => p.slice(3)))].sort();
  if (names.length < 30) keep(`명단이 ${names.length}줄뿐 — API 이상으로 보고 덮지 않는다`);
  fs.writeFileSync(OUT, '# 최근 90일 구글 노출이 있던 p 페이지 — p_keep_index.mjs 가 매일 쓴다. 손으로 고치지 않는다\n' + names.join('\n') + '\n');
  console.log(`✅ p 색인 지킴 명단 ${names.length}줄 (${ymd(start)}~${ymd(end)})`);
} catch (e) { keep('예외 ' + e.message); }
