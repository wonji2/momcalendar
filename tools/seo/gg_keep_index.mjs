// 장기 마감 공구 페이지(gg C 계층) 중 구글 손님이 오던 페이지는 색인을 지키는 명단 (사장님 2026-11-19 「고쳐」 — 서치콘솔 메일 「NOINDEX 태그에 의해 제외」)
//
//   왜: 11-16 색인 복구에서 마감한 지 오래된 gg 페이지에 noindex 를 달았다(크롤 예산). 그런데 실측(11-19)하니 최근 90일 구글 노출이 있던 gg 634장 중
//       598장이 이미 noindex 였고, gg 클릭 37회가 전부 그 페이지에서 나왔다. 구글이 색인해 손님을 보내던 페이지를 우리가 내린 것이다.
//       → 최근 90일 노출이 1회라도 있는 gg 페이지는 noindex 를 달지 않고 사이트맵에 싣는다(B 계층과 같게). 노출이 90일 없으면 다시 C 로 간다.
//   2026-11-25: 지킴 기간을 90일 → 16개월(480일)로 늘렸다 — gg 끝난 공구 창을 줄이면서 노출 있던 페이지를 하나도 내리지 않으려고(g_keep_index.mjs 와 같은 기준).
//   무엇을: 서치콘솔 공식 API(읽기 전용)로 최근 16개월 /gg/ 페이지별 노출을 읽어 tools/seo/gg_keep_index.txt 에 파일 이름을 한 줄씩 쓴다.
//   어디서: 깃허브 Actions seo-daily.yml 「페이지 생성」 바로 앞(PC 가 꺼져도 돈다). build.ps1 이 이 파일을 읽는다(GgTier · 보존 gg 계층).
//   실행:   node tools/seo/gg_keep_index.mjs
//   열쇠:   GSC_CLIENT_ID · GSC_CLIENT_SECRET · GSC_REFRESH_TOKEN (깃허브 Secrets / 로컬은 tools/daily/.env). 없거나 API 가 실패하면 기존 명단을 그대로 두고 끝낸다(빌드는 계속).
//   한도:   하루 1회 호출 · 명단은 수백 줄(수십 KB) — 사이트맵 상한(11,500)은 build.ps1 GgKeepCount 가 같이 센다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools/seo/gg_keep_index.txt');
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
  const end = new Date(Date.now() - 2 * 864e5), start = new Date(Date.now() - 480 * 864e5);
  const rows = [];
  for (let at = 0; ; at += 25000) {
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), dimensions: ['page'], dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: '/gg/' }] }], rowLimit: 25000, startRow: at }),
    }).then((x) => x.json());
    if (r.error) keep('API 오류 ' + (r.error.message || ''));
    const b = r.rows || []; rows.push(...b); if (b.length < 25000) break;
  }
  const names = [...new Set(rows.filter((r) => r.impressions >= 1).map((r) => { try { return decodeURIComponent(new URL(r.keys[0]).pathname); } catch { return ''; } })
    .filter((p) => /^\/gg\/[^/]+\.html$/.test(p)).map((p) => p.slice(4)))].sort();
  if (names.length < 50) keep(`명단이 ${names.length}줄뿐 — API 이상으로 보고 덮지 않는다`);
  fs.writeFileSync(OUT, '# 최근 16개월 구글 노출이 있던 gg 페이지 — gg_keep_index.mjs 가 매일 쓴다. 손으로 고치지 않는다\n' + names.join('\n') + '\n');
  console.log(`✅ gg 색인 지킴 명단 ${names.length}줄 (${ymd(start)}~${ymd(end)})`);
} catch (e) { keep('예외 ' + e.message); }
