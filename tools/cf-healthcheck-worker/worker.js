// 맘캘린더 외부 감시 — 5분마다 홈·test.html·sitemap 을 두드려 200 + '맘캘린더' 를 확인한다.
// 깃허브와 무관하게 돈다(깃허브 액션·Pages 가 같이 망가진 경우의 마지막 그물).
// 상태는 KV(STATE)에 두고 '바뀔 때만' 알린다 — 5분마다 같은 경보가 쏟아지지 않게.
const SITE = 'https://momcalendar.com';
const TARGETS = [
  { name: '/', url: SITE + '/', keyword: '맘캘린더' },
  { name: '/test.html', url: SITE + '/test.html' },
  { name: '/sitemap.xml', url: SITE + '/sitemap.xml' },
];

async function probe() {
  const bad = [];
  for (const t of TARGETS) {
    try {
      const r = await fetch(t.url + '?hc=' + Date.now(), { cf: { cacheTtl: 0 } });
      let ok = r.status === 200;
      if (ok && t.keyword) {
        const body = await r.text();
        ok = body.includes(t.keyword);
      }
      if (!ok) bad.push(`${t.name} ${r.status}${r.status === 200 ? ' (키워드 없음)' : ''}`);
    } catch (e) {
      bad.push(`${t.name} ${e.message}`);
    }
  }
  return bad;
}

async function notify(env, text) {
  // 보냈으면 true. 토큰이 없으면(알림을 안 쓰는 설정) 보낸 것으로 친다 — 상태는 그대로 기록한다.
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return true;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function check(env) {
  const bad = await probe();
  const prev = await env.STATE.get('state');
  // 알림이 실제로 나갔을 때만 상태를 바꾼다 — 텔레그램이 잠깐 실패하면 다음 회차(5분 뒤)에 다시 보낸다(코덱스 검사 2026-11-23)
  if (bad.length === 0) {
    const sent = prev === 'down' ? await notify(env, '🟢 라이브 회복 — momcalendar.com 다시 정상') : true;
    if (sent) await env.STATE.put('state', 'up');
  } else {
    const sent = prev !== 'down' ? await notify(env, `🔴 라이브 이상 — ${bad.join(' · ')}\n복구: bash tools/emergency_restore.sh --yes`) : true;
    if (sent) await env.STATE.put('state', 'down');
  }
  return { bad, prev: prev || 'up' };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(check(env));
  },
  async fetch(req, env) {
    const bad = await probe();
    return new Response(JSON.stringify({ site: SITE, ok: bad.length === 0, bad }, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
