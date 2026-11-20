// owner-notify — 사장님 카톡(나에게 보내기)으로 이웃셀러 결제·입금·카페 닉네임 알림 (사장님 2026-11-20 「이웃셀러 유료결제 들어오면 나한테 카톡오게해」)
//
// 읽은 공식 문서(규칙 5-c, 2026-11-20):
//   developers.kakao.com/docs/ko/kakaotalk-message/rest-api (나에게 보내기 POST kapi.kakao.com/v2/api/talk/memo/default/send, text 200자, link 도메인=제품 링크 관리 웹 도메인)
//   developers.kakao.com/docs/ko/kakaologin/rest-api (인가 코드·토큰 받기·토큰 갱신, client_secret ON 이면 필수)
//   developers.kakao.com/docs/ko/getting-started/security-guideline (state 매번 새 난수·서버 보관 비교 / 시크릿·리프레시 토큰은 백엔드에서만 / 사용자 정보 로그 금지)
//
// 길(op)
//   POST ?op=start  (x-cron-secret) → state 를 만들어 app_private_config 에 10분 보관하고 카카오 동의 주소를 돌려준다.
//                    사장님이 그 주소를 한 번 누르면(talk_message 동의) 아래 콜백으로 돌아온다. 로컬 도구 tools/daily/kakao_owner_connect.mjs
//   GET  (콜백: ?code&state | ?error)  → state 대조(한 번 쓰면 지움) → 토큰 받기(client_secret) → scope 에 talk_message 확인
//                    → 리프레시 토큰을 app_private_config 'kakao_owner_refresh' 에 → 시험 카톡 한 통 → 결과 글자.
//   POST ?op=send   (x-cron-secret, 크론 owner-notify 1분 · 보낼 줄 있을 때만) → owner_notify_queue pending 10줄까지 보낸다.
//                    실패 3번이면 failed + health_alerts 'owner-notify'.
//   POST ?op=keep   (x-cron-secret, 매주) → 토큰 갱신만(새 리프레시 토큰이 오면 저장 — 안 하면 2달 뒤 조용히 끊긴다).
//   POST ?op=test   (x-cron-secret) → 시험 카톡.
// 비밀값: KAKAO_REST_KEY · KAKAO_CLIENT_SECRET · PUSH_CRON_SECRET (Supabase 시크릿). 코드에 안 박는다.
// 배포: supabase functions deploy owner-notify --no-verify-jwt (카카오 콜백·크론은 JWT 가 없다)
import { createClient } from 'npm:@supabase/supabase-js@2';

const SELF = 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/owner-notify';
const LINK = 'https://momcalendar.com/admin.html';
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
const T = (t: string, s = 200) => new Response(t, { status: s, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const sb = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const REST = () => Deno.env.get('KAKAO_REST_KEY') || '';
const SECRET = () => Deno.env.get('KAKAO_CLIENT_SECRET') || '';

async function cfgGet(c: ReturnType<typeof sb>, key: string) {
  const { data } = await c.from('app_private_config').select('value').eq('key', key).maybeSingle();
  return (data?.value as string) || '';
}
async function cfgSet(c: ReturnType<typeof sb>, key: string, value: string) {
  const { error } = await c.from('app_private_config').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error('config save: ' + error.message);
}
async function alert(c: ReturnType<typeof sb>, detail: string) {
  // 같은 경보(앞 20자가 같은 것)는 12시간에 한 번 — 다른 종류 경보는 막지 않는다
  const since = new Date(Date.now() - 12 * 3600e3).toISOString();
  const head = detail.slice(0, 20).replace(/[%_\\]/g, '');
  const { data } = await c.from('health_alerts').select('id').eq('kind', 'owner-notify').like('detail', head + '%').gte('created_at', since).limit(1);
  if (!data?.length) await c.from('health_alerts').insert({ kind: 'owner-notify', detail: detail.slice(0, 500) });
}

function tokenBody(p: Record<string, string>) {
  const b = new URLSearchParams({ client_id: REST(), ...p });
  if (SECRET()) b.set('client_secret', SECRET());
  return b;
}

// 리프레시 토큰 → 액세스 토큰. 새 리프레시 토큰이 오면 저장한다.
async function accessToken(c: ReturnType<typeof sb>): Promise<string> {
  const rt = await cfgGet(c, 'kakao_owner_refresh');
  if (!rt) throw new Error('not_connected');
  const r = await fetch('https://kauth.kakao.com/oauth/token', { signal: AbortSignal.timeout(10000),
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: tokenBody({ grant_type: 'refresh_token', refresh_token: rt }),
  });
  const t = await r.json().catch(() => ({}));
  if (!t.access_token) {
    // 리프레시 토큰이 죽었으면(invalid_grant) 지운다 → 크론이 더 부르지 않고, 알림 줄은 다시 연결될 때까지 pending 으로 남는다
    if (t.error === 'invalid_grant') await c.from('app_private_config').delete().eq('key', 'kakao_owner_refresh').eq('value', rt);
    throw new Error('refresh_failed ' + (t.error_code || t.error || r.status));
  }
  if (t.refresh_token) await cfgSet(c, 'kakao_owner_refresh', t.refresh_token);
  return t.access_token as string;
}

async function memo(at: string, text: string) {
  const tpl = { object_type: 'text', text: text.slice(0, 200), link: { web_url: LINK, mobile_web_url: LINK }, button_title: '관리자 열기' };
  const r = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', { signal: AbortSignal.timeout(10000),
    method: 'POST',
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ template_object: JSON.stringify(tpl) }),
  });
  const d = await r.json().catch(() => ({}));
  if (d.result_code !== 0) throw new Error('memo ' + r.status + ' ' + (d.code ?? '') + ' ' + String(d.msg || '').slice(0, 120));
}

const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const op = u.searchParams.get('op') || '';
  const c = sb();

  // 카카오 콜백(사장님 브라우저)
  if (req.method === 'GET' && !op) {
    const code = u.searchParams.get('code') || '', state = u.searchParams.get('state') || '', err = u.searchParams.get('error') || '';
    const saved = await cfgGet(c, 'kakao_owner_state');
    const [sv, exp] = saved.split('|');
    // 맞는 state 일 때만 지운다(한 번 쓰면 끝). 틀린 요청이 진행 중인 연결을 지우지 못하게.
    if (!sv || !state || sv !== state) return T('연결 주소가 맞지 않아요. 새 주소를 받아 다시 눌러 주세요.', 400);
    const { data: del } = await c.from('app_private_config').delete().eq('key', 'kakao_owner_state').eq('value', saved).select('key');
    if (!del?.length) return T('이미 쓴 연결 주소예요. 새 주소를 받아 다시 눌러 주세요.', 400);
    if (Number(exp || 0) < Date.now()) return T('연결 주소가 만료됐어요(10분). 새 주소를 받아 다시 눌러 주세요.', 400);
    if (err) return T('카카오에서 동의가 취소됐어요 (' + err + '). 새 주소를 받아 다시 눌러 주세요.', 400);
    if (!code) return T('잘못된 접근이에요.', 400);
    const r = await fetch('https://kauth.kakao.com/oauth/token', { signal: AbortSignal.timeout(10000),
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: tokenBody({ grant_type: 'authorization_code', redirect_uri: SELF, code }),
    });
    const t = await r.json().catch(() => ({}));
    if (!t.access_token || !t.refresh_token) return T('카카오 토큰을 받지 못했어요 (' + (t.error_code || t.error || r.status) + ').', 400);
    if (!String(t.scope || '').split(/[ ,]/).includes('talk_message')) return T('「카카오톡 메시지 전송」에 동의하지 않아 알림을 보낼 수 없어요. 새 주소로 다시 눌러 동의해 주세요.', 400);
    // 계정 고정: 처음 연결한 카카오 계정 번호를 적어 두고, 그 뒤엔 같은 계정만 받는다(주소가 새도 남의 카톡으로 못 돌린다).
    // 받는 계정을 바꾸려면 app_private_config 'kakao_owner_id' 를 지운 뒤 다시 연결.
    const me = await fetch('https://kapi.kakao.com/v2/user/me', { signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${t.access_token}` } }).then((x) => x.json()).catch(() => ({}));
    const kid = String(me?.id || '');
    if (!kid) return T('카카오 계정을 확인하지 못했어요. 다시 눌러 주세요.', 400);
    const owner = await cfgGet(c, 'kakao_owner_id');
    if (owner && owner !== kid) return T('처음 연결한 카카오 계정과 달라요. 그 계정으로 로그인해 다시 눌러 주세요.', 403);
    if (!owner) await cfgSet(c, 'kakao_owner_id', kid);
    await cfgSet(c, 'kakao_owner_refresh', t.refresh_token);
    // 연결이 끊긴 사이 실패로 끝난 최근 7일 알림을 다시 보낸다
    await c.from('owner_notify_queue').update({ status: 'pending', tries: 0, claimed_at: null }).eq('status', 'failed').gte('created_at', new Date(Date.now() - 7 * 86400e3).toISOString());
    try { await memo(t.access_token, '[맘캘린더] 카톡 알림 연결됨' + String.fromCharCode(10) + '이웃셀러 결제·입금·카페 닉네임이 여기로 와요.'); }
    catch (e) { return T('연결은 됐지만 시험 카톡을 못 보냈어요: ' + (e as Error).message, 500); }
    return T('카톡 알림이 연결됐어요. 카톡 「나와의 채팅」에 시험 메시지가 왔는지 보세요. 이 창은 닫으셔도 됩니다.');
  }

  const cron = Deno.env.get('PUSH_CRON_SECRET') || '';
  if (!cron || req.headers.get('x-cron-secret') !== cron) return J({ ok: false, msg: 'unauthorized' }, 401);

  if (op === 'start') {
    if (!REST()) return J({ ok: false, msg: 'no_rest_key' }, 500);
    const state = rand();
    await cfgSet(c, 'kakao_owner_state', state + '|' + (Date.now() + 10 * 60e3));
    const q = new URLSearchParams({ client_id: REST(), redirect_uri: SELF, response_type: 'code', scope: 'talk_message', state });
    return J({ ok: true, url: 'https://kauth.kakao.com/oauth/authorize?' + q.toString() });
  }

  if (op === 'keep' || op === 'test') {
    try {
      const at = await accessToken(c);
      if (op === 'test') await memo(at, '[맘캘린더] 카톡 알림 시험');
      await c.from('ops_status').upsert({ id: 'owner-notify', payload: { ok: true, op }, updated_at: new Date().toISOString() }).then(() => {}, () => {});
      return J({ ok: true });
    } catch (e) {
      const m = (e as Error).message;
      await alert(c, '사장님 카톡 알림 토큰 ' + m + ' — node tools/daily/kakao_owner_connect.mjs 로 다시 연결');
      return J({ ok: false, msg: m });
    }
  }

  if (op === 'send') {
    // 선점(겹친 호출이 같은 줄을 두 번 보내지 않게) — plan_owner_notify_fix_176.sql
    const { data: rows, error: ce } = await c.rpc('owner_notify_claim', { p_n: 10 });
    if (ce) return J({ ok: false, msg: 'claim ' + ce.message }, 500);
    if (!rows?.length) return J({ ok: true, sent: 0 });
    let at = '';
    try { at = await accessToken(c); }
    catch (e) {
      const m = (e as Error).message;
      // 토큰 문제는 줄의 잘못이 아니다 — 횟수를 쓰지 않고 pending 으로 돌려 둔다(다시 연결되면 나간다)
      for (const r of rows) {
        await c.from('owner_notify_queue').update({ err: m.slice(0, 300), status: 'pending', claimed_at: null }).eq('id', r.id);
      }
      await alert(c, '사장님 카톡 알림을 못 보냄(' + m + ') — node tools/daily/kakao_owner_connect.mjs 로 다시 연결');
      return J({ ok: false, msg: m });
    }
    let sent = 0;
    for (const r of rows) {
      try {
        await memo(at, r.body);
        const { error: ue } = await c.from('owner_notify_queue').update({ status: 'sent', sent_at: new Date().toISOString(), err: null, claimed_at: null }).eq('id', r.id);
        if (ue) await alert(c, '카톡은 보냈지만 보낸 표시 실패(5분 뒤 한 번 더 갈 수 있음): ' + ue.message);
        sent++;
      } catch (e) {
        const tries = r.tries + 1, m = (e as Error).message;
        await c.from('owner_notify_queue').update({ tries, err: m.slice(0, 300), status: tries >= 3 ? 'failed' : 'pending', claimed_at: null }).eq('id', r.id);
        if (tries >= 3) await alert(c, '사장님 카톡 알림 3번 실패: ' + m);
      }
    }
    return J({ ok: true, sent });
  }

  return J({ ok: false, msg: 'bad_op' }, 400);
});
