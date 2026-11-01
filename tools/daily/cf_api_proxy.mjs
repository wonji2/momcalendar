// 맘캘린더 데이터 서버 우회로(api.momcalendar.com) 배포·점검 도구 — Cloudflare API 직접 호출 (wrangler 불필요)
//
// 흐름: momcalendar.com 은 이미 사장님 Cloudflare 에 DNS 호스팅 중(8/29 프록시 롤백, 네임서버만 유지).
//       Worker(tools/daily/cf_api_proxy/worker.js) 를 올리고 api.momcalendar.com 을 그 Worker 의 커스텀 도메인으로 붙인다.
//       사이트(index.html 맨 앞 fetch 감싸기)는 supabase.co 가 안 닿는 손님만 이 주소로 자동 우회한다.
//
// 실행:  node tools/daily/cf_api_proxy.mjs check     — 지금 상태(토큰·zone·Worker·도메인·ECH·실제 응답) 만 본다
//        node tools/daily/cf_api_proxy.mjs deploy    — Worker 올리기 + 도메인 연결 + zone ECH 끄기 + 실제 응답 확인
// 토큰:  tools/daily/.env 의 CF_API_TOKEN=...  (백업에서 제외되는 값 — 잃으면 Cloudflare 대시보드에서 재발급)
//        권한: Account › Workers Scripts:Edit · Zone › Workers Routes:Edit · DNS:Edit · Zone Settings:Edit · Zone:Read (zone = momcalendar.com)
// ⚠ 8/29 사고: Cloudflare 프록시가 켠 ECH 가 한국 통신사 SNI 검사장비와 충돌해 사장님 폰(SKT) ERR_FAILED.
//    그래서 deploy 는 zone 설정 ech=off 를 **반드시** 같이 하고, check 는 HTTPS 레코드에 ech 가 없는지 본다.
//    본 사이트(momcalendar.com) 레코드는 회색(DNS only) 그대로 둔다 — 이 도구는 api. 하나만 만진다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZONE_NAME = 'momcalendar.com';
const HOSTNAME = 'api.momcalendar.com';
const SCRIPT = 'momcal-api-proxy';
const ANON = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const API = 'https://api.cloudflare.com/client/v4';

function loadToken() {
  if (process.env.CF_API_TOKEN) return process.env.CF_API_TOKEN;
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^CF_API_TOKEN=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

async function cf(token, method, p, body, raw) {
  const r = await fetch(API + p, {
    method, headers: { Authorization: 'Bearer ' + token, ...(raw ? {} : { 'Content-Type': 'application/json' }) },
    body: raw ? body : (body ? JSON.stringify(body) : undefined),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j.errors || j).slice(0, 300)}`);
  return j.result;
}

// expect: 기대하는 HTTP 상태(기본 200). 404·400 을 기대하는 검사는 그 값이 와야 ✅ 다.
async function probe(label, url, headers, expect = 200, init = {}) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000), ...init });
    const t = await r.text();
    const ok = r.status === expect;
    console.log(`  ${ok ? '✅' : '🔴'} ${label}: ${r.status} ${t.slice(0, 80).replace(/\s+/g, ' ')}  proxy=${r.headers.get('x-momcal-proxy') || '-'}`);
    return ok;
  } catch (e) { console.log(`  🔴 ${label}: ${String(e).slice(0, 120)}`); return false; }
}

async function dnsHttps(host) {
  try {
    const j = await (await fetch(`https://dns.google/resolve?name=${host}&type=HTTPS`)).json();
    return (j.Answer || []).map(a => a.data).join(' | ') || '(HTTPS 레코드 없음)';
  } catch (e) { return 'DoH 조회 실패 ' + e; }
}

// 🪣 캐시 비우기 (2026-10-14 신설)
//   왜 필요한가: 캐시가 **두 겹**이다.
//     ① caches.default  — cacheKey() 에 BUILD 가 들어 있어 **배포하면 저절로 버려진다**
//     ② fetch 의 cf:{cacheEverything} — 지점끼리 나눠 쓰는 캐시. 열쇠가 **원서버 URL** 이라
//        BUILD 가 안 들어간다 → **배포해도 TTL(공구·핫딜 900초)까지 옛 답을 들고 있다.**
//   ②에 BUILD 를 넣을 방법이 없다 — URL 에 파라미터를 더하면 PostgREST 가 그걸 **칸 이름으로 알고 400** 을 내고,
//   cf.cacheKey 로 열쇠를 따로 주는 건 Enterprise 전용이다. 그래서 **지우는 쪽**으로 푼다.
//   ⚠ zone 전체를 비운다 — momcalendar.com 정적 파일도 같이 비워지지만 GitHub Pages 가 다시 주므로 해가 없다.
async function purgeCache(token, zoneId) {
  // ⚠ 망 오류까지 여기서 삼킨다 — 캐시를 못 비운 것이 **배포 실패**로 보이면 안 된다(Worker 는 이미 올라갔다).
  let r, j;
  try {
    r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purge_everything: true }),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    console.log(`  🔴 캐시 비우기 실패(망): ${String(e).slice(0, 120)} — 배포 자체는 끝났다. 나중에 purge 만 다시 돌릴 것`);
    return false;
  }
  if (j && j.success) { console.log('  ✅ Cloudflare 캐시 비움 (zone 전체)'); return true; }
  const e = (j.errors || [])[0] || {};
  console.log(`  🔴 캐시 비우기 실패 ${e.code || r.status}: ${e.message || '알 수 없음'}`);
  if (String(e.code) === '10000') {
    console.log('     → 토큰에 **Zone › Cache Purge › Purge** 권한이 없다.');
    console.log('     → Cloudflare 대시보드 > 내 프로필 > API 토큰 > 그 토큰 편집 > 권한에 Zone·Cache Purge·Purge 추가');
    console.log('     → 권한을 켜기 전까지는 공구·핫딜이 최대 900초(15분) 옛 답을 보일 수 있다.');
  }
  return false;
}

async function main() {
  const mode = process.argv[2] || 'check';
  const token = loadToken();
  console.log(`■ cf_api_proxy ${mode}  ${new Date().toISOString()}`);
  if (!token) {
    console.log('🔴 CF_API_TOKEN 없음 — tools/daily/.env 에 CF_API_TOKEN=... 을 넣을 것 (권한은 파일 머리 주석)');
    console.log('   토큰 없이 볼 수 있는 것만 확인한다.');
  }

  let zone = null, account = null;
  if (token) {
    const zones = await cf(token, 'GET', `/zones?name=${ZONE_NAME}`);
    zone = zones[0];
    if (!zone) throw new Error(`zone ${ZONE_NAME} 이 이 토큰으로 안 보인다`);
    account = zone.account.id;
    console.log(`  zone ${zone.id} · account ${account} · plan ${zone.plan && zone.plan.name}`);
  }

  if (mode === 'deploy') {
    if (!token) process.exit(1);
    // 1) Worker 올리기 (module 형식, multipart)
    // 올릴 때마다 BUILD 를 지금 시각으로 — caches.default 의 열쇠가 바뀌어 그쪽 옛 캐시는 버려진다(2026-10-01).
    // ⚠ 공유 캐시단(cf:cacheEverything)은 BUILD 가 안 들어간다 → 배포 끝에 purgeCache() 로 따로 비운다(2026-10-14).
    const build = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const src = fs.readFileSync(path.join(__dirname, 'cf_api_proxy', 'worker.js'), 'utf8').split('__BUILD__').join(build);
    console.log('  build =', build, '(caches.default 는 이걸로 버려진다 · 공유 캐시단은 끝에서 purge)');
    const fd = new FormData();
    fd.append('metadata', new Blob([JSON.stringify({ main_module: 'worker.js', compatibility_date: '2025-09-01' })], { type: 'application/json' }));
    fd.append('worker.js', new Blob([src], { type: 'application/javascript+module' }), 'worker.js');
    await cf(token, 'PUT', `/accounts/${account}/workers/scripts/${SCRIPT}`, fd, true);
    console.log(`  ✅ Worker ${SCRIPT} 업로드 (${src.length}B)`);

    // 2) 커스텀 도메인 연결 (DNS 레코드·인증서를 Cloudflare 가 만든다)
    const doms = await cf(token, 'GET', `/accounts/${account}/workers/domains?hostname=${HOSTNAME}`);
    if (doms.length && doms[0].service === SCRIPT) console.log(`  ✅ 도메인 ${HOSTNAME} 이미 ${SCRIPT} 에 연결됨`);
    else {
      await cf(token, 'PUT', `/accounts/${account}/workers/domains`, { zone_id: zone.id, hostname: HOSTNAME, service: SCRIPT, environment: 'production' });
      console.log(`  ✅ 도메인 ${HOSTNAME} → ${SCRIPT} 연결`);
    }

    // 3) 🔴 ECH 끄기 (8/29 사고 재발 방지) — zone 전체 설정이지만 프록시 레코드가 api. 하나뿐이라 영향도 그것뿐
    const ech = await cf(token, 'GET', `/zones/${zone.id}/settings/ech`).catch(() => null);
    if (ech && ech.value !== 'off') { await cf(token, 'PATCH', `/zones/${zone.id}/settings/ech`, { value: 'off' }); console.log('  ✅ zone ECH off 로 변경'); }
    // 🔴 2026-09-29 검증 지적: zone 의 Browser Cache TTL 4시간이 Worker 가 붙인 max-age=0 을 덮어써
    //    손님 브라우저가 핫딜 목록을 4시간 들고 있었다(마감된 딜이 계속 보임). 0 = 우리가 붙인 머리말을 존중하게 한다.
    const bct = await cf(token, 'GET', `/zones/${zone.id}/settings/browser_cache_ttl`).catch(() => null);
    if (bct && Number(bct.value) !== 0) { await cf(token, 'PATCH', `/zones/${zone.id}/settings/browser_cache_ttl`, { value: 0 }); console.log(`  ✅ zone 브라우저 캐시 ${bct.value}초 → 머리말 존중(0)`); }
    else console.log(`  ✅ zone ECH ${ech ? ech.value : '(설정 조회 불가 — 아래 HTTPS 레코드로 확인)'}`);

    // 4) 🪣 공유 캐시단 비우기 — BUILD 로는 안 버려진다(purgeCache 주석 참고). 실패해도 배포는 성공이다.
    await purgeCache(token, zone.id);
  }

  // 캐시만 비우기:  node tools/daily/cf_api_proxy.mjs purge
  //   사장님이 DB 를 고치고 바로 확인하실 때. 배포 없이 손님 화면을 즉시 최신으로 만든다.
  if (mode === 'purge') {
    if (!token) process.exit(1);
    const ok = await purgeCache(token, zone.id);
    process.exit(ok ? 0 : 1);
  }

  // 4) 상태 점검 (토큰 유무와 무관하게 실제 응답으로 본다)
  console.log('■ 실제 응답');
  if (token) {
    const doms = await cf(token, 'GET', `/accounts/${account}/workers/domains?hostname=${HOSTNAME}`).catch(() => []);
    console.log(`  도메인 연결: ${doms.length ? doms.map(d => d.hostname + '→' + d.service).join(', ') : '없음'}`);
    const ech = await cf(token, 'GET', `/zones/${zone.id}/settings/ech`).catch(() => null);
    const bct2 = await cf(token, 'GET', `/zones/${zone.id}/settings/browser_cache_ttl`).catch(() => null);
    console.log('  zone 브라우저 캐시:', bct2 ? (Number(bct2.value) === 0 ? '머리말 존중 ✅' : bct2.value + '초 🔴') : '모름');
    console.log(`  zone ECH: ${ech ? ech.value : '조회 불가'}`);
  }
  console.log(`  HTTPS 레코드 ${HOSTNAME}: ${await dnsHttps(HOSTNAME)}`);
  const ok1 = await probe('ping', `https://${HOSTNAME}/__ping`);
  const ok2 = await probe('rest gonggu 1건', `https://${HOSTNAME}/rest/v1/gonggu?select=id&limit=1`, { apikey: ANON, Authorization: 'Bearer ' + ANON });
  // POST + JSON 본문이 그대로 원서버까지 가는지 — 잘못된 code 에 카카오가 400/KOE320 을 주면 본문 전달까지 정상이다
  const ok3 = await probe('functions kakao-auth POST(잘못된 code → 400 이 정상)', `https://${HOSTNAME}/functions/v1/kakao-auth`,
    { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, 400,
    { method: 'POST', body: JSON.stringify({ code: 'probe_invalid', redirect_uri: 'https://momcalendar.com/' }) });
  const ok4 = await probe('허용 밖 경로 → 404', `https://${HOSTNAME}/admin`, undefined, 404);
  const rec = await dnsHttps(HOSTNAME);
  const echLeak = /ech=/.test(rec);
  console.log(echLeak ? '  🔴 HTTPS 레코드에 ech= 가 있다 — 8/29 사고 재발 위험. zone ECH 를 끄고 다시 확인' : '  ✅ ech 없음');
  console.log(ok1 && ok2 && ok3 && ok4 && !echLeak ? '✅ 우회로 정상' : '🔴 우회로 미완성 — 위 🔴 를 잡을 것');
}

main().catch(e => { console.error('🔴', e.message || e); process.exit(1); });
