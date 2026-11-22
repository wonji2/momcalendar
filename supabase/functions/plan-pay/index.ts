// 이웃셀러 패키지 카드결제 승인 (토스페이먼츠) — 사장님 2026-11-18 「토스페이먼츠 붙여 스룩말고」
//
// ① 셀러 화면이 토스 결제창에서 돌아오면(successUrl 의 paymentKey·orderId·amount) 부른다.
//   POST { token, paymentKey, orderId, amount }
//     · DB plan_card_begin: 이 주문이 이 셀러 것인지 · 금액이 결제 요청 전에 서버가 저장한 값과 같은지 대조하고,
//       결제 열쇠를 적어 둔 채 잠근다(confirming)
//     · 토스 승인 API(POST /v1/payments/confirm, Basic 시크릿키:, Idempotency-Key=주문번호)
//     · 응답의 status=DONE · totalAmount · orderId 를 다시 대조 → DB plan_card_finish 가 이웃셀러를 확정
//     · 확정을 못 하면(자리 없음 등) 결제를 바로 취소(POST /v1/payments/{paymentKey}/cancel)하고 plan_card_canceled
// ② 서버 크론(plan-pay-sweep, 3분)이 부른다.  POST ?op=sweep  헤더 x-cron-secret
//     · 90초 넘게 confirming 인 주문 · 취소가 남은 주문을 토스에 다시 물어 확정·취소·실패를 끝낸다
//
// 🔴 상태를 모르면 실패로 적지 않는다(검증 2026-11-18 A·B): 승인 호출이 끊기거나 5xx·409 면 결제 조회로 확인하고,
//    그래도 모르면 confirming 그대로 둔다 → ② 가 이어서 끝낸다. 「실패」는 토스가 분명히 거절했거나 결제가 죽은 상태일 때만.
// 열쇠: 시크릿 키는 Supabase 시크릿 TOSSPAY_SECRET_KEY 에만 있다. 없으면 아무것도 하지 않고 not_configured 로 끝낸다.
//       코드·로그·응답에 키를 싣지 않는다.
// 배포: supabase functions deploy plan-pay --no-verify-jwt   (셀러 토큰을 본문으로 받아 DB 가 확인한다)
// 표·함수: supabase/sql/plan_tosspay_163.sql · plan_tosspay_fix_165.sql · 설계서 scratchpad/designs/2026-11-18_이웃셀러_토스페이먼츠.md
// PC 가 꺼져도 돈다(서버).
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOW = ['https://momcalendar.com', 'https://www.momcalendar.com'];
const cors = (req: Request) => {
  const o = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOW.includes(o) ? o : ALLOW[0],
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
};
const TOSS = 'https://api.tosspayments.com/v1/payments';
type Obj = Record<string, unknown>;
type Res = { net: boolean; status: number; j: Obj };

async function toss(path: string, secret: string, init: { method: string; body?: unknown; idem?: string }): Promise<Res> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const headers: Record<string, string> = { Authorization: 'Basic ' + btoa(secret + ':') };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.idem) headers['Idempotency-Key'] = init.idem;
    const r = await fetch(TOSS + path, { method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: ctl.signal });
    let j: Obj = {};
    try { j = await r.json(); } catch { /* 본문 없음 */ }
    return { net: true, status: r.status, j };
  } catch (_e) {
    return { net: false, status: 0, j: {} };
  } finally { clearTimeout(timer); }
}

// 결제 한 건의 상태를 넷으로 가른다: done(우리 주문 그대로 승인됨) · mismatch(승인됐는데 값이 다름) · dead(끝난 결제) · pending(아직 모름)
//   🔴 조회한 결제의 주문번호가 우리 주문과 다르면 「남의 결제 열쇠」다 → 건드리지 않고 거절(dead)로 닫는다.
//      (검증 2026-11-18 N1: 지난 회차의 결제 열쇠를 새 주문에 끼워 넣어 그 결제를 취소시키는 길을 막는다. 취소는 주문번호가 같고 금액만 다를 때뿐)
function classify(p: Obj, orderId: string, amount: number): 'done' | 'mismatch' | 'dead' | 'pending' {
  if (p.orderId !== undefined && p.orderId !== orderId) return 'dead';
  if (p.status === 'DONE') return Number(p.totalAmount) === amount ? 'done' : 'mismatch';
  if (p.status === 'ABORTED' || p.status === 'EXPIRED' || p.status === 'CANCELED' || p.status === 'PARTIAL_CANCELED') return 'dead';
  return 'pending';
}

async function cancelPay(sb: SupabaseClient, secret: string, orderId: string, paymentKey: string, reason: string): Promise<boolean> {
  const c = await toss('/' + encodeURIComponent(paymentKey) + '/cancel', secret, { method: 'POST', body: { cancelReason: reason }, idem: 'c-' + orderId });
  let okc = c.status === 200 && (c.j.status === 'CANCELED' || c.j.status === 'PARTIAL_CANCELED');
  if (!okc) {          // 이미 취소돼 있을 수 있다 — 조회로 한 번 더 본다
    const q = await toss('/' + encodeURIComponent(paymentKey), secret, { method: 'GET' });
    okc = q.status === 200 && q.j.status === 'CANCELED';
  }
  await sb.rpc('plan_card_canceled', { p_order_id: orderId, p_ok: okc, p_msg: okc ? null : String(c.j.code || 'HTTP_' + c.status).slice(0, 80) });
  return okc;
}

// confirming 으로 잠긴 주문 하나를 끝까지 민다. 돌려주는 msg: ok · refunded · refund_pending · mismatch · declined · unknown
async function settle(sb: SupabaseClient, secret: string, orderId: string, paymentKey: string, amount: number, ageMin: number): Promise<Obj> {
  // 승인(멱등키가 같아 두 번 불러도 한 번만 승인된다). 인증 뒤 10분이 지났으면 토스가 거절한다 → 아래 조회가 가른다
  const res = await toss('/confirm', secret, { method: 'POST', body: { paymentKey, orderId, amount }, idem: orderId });
  let pay: Obj = res.j;
  let kind: 'done' | 'mismatch' | 'dead' | 'pending' | 'unknown';
  if (res.status === 200) {
    const k = classify(pay, orderId, amount);
    kind = (k === 'pending' && ageMin >= 60) ? 'dead' : k;     // 200 인데 끝나지 않은 상태가 1시간 넘게 되풀이되면 닫는다(N2)
  } else {
    const q = await toss('/' + encodeURIComponent(paymentKey), secret, { method: 'GET' });
    const rejected = res.net && res.status >= 400 && res.status < 500 && ![401, 403, 408, 409, 429].includes(res.status);   // 토스가 이 결제를 분명히 거절했다(키 오류·잠깐 막힘은 거절이 아니다)
    if (q.status === 200) {
      const k = classify(q.j, orderId, amount);
      if (k === 'pending') kind = (rejected || ageMin >= 60) ? 'dead' : 'unknown';
      else { kind = k; if (k !== 'dead') pay = q.j; }
    } else if (q.net && q.status === 404) kind = (rejected || ageMin >= 15) ? 'dead' : 'unknown';
    else kind = 'unknown';
  }
  if (kind === 'unknown' || kind === 'pending') return { ok: false, msg: 'unknown' };      // 잠근 채 둔다 → 크론이 이어서
  if (kind === 'dead') {
    const code = String(res.j.code || pay.status || 'HTTP_' + res.status).slice(0, 80);
    await sb.rpc('plan_card_finish', { p_order_id: orderId, p_payment_key: paymentKey, p_ok: false, p_code: code, p_msg: String(res.j.message || '').slice(0, 300) });
    return { ok: false, msg: 'declined', code };
  }
  if (kind === 'mismatch') {
    await sb.rpc('plan_card_mismatch', { p_order_id: orderId });
    const okc = await cancelPay(sb, secret, orderId, paymentKey, '주문 정보 불일치');
    return { ok: false, msg: okc ? 'mismatch' : 'refund_pending' };
  }
  const receipt = (pay.receipt && typeof pay.receipt === 'object') ? String((pay.receipt as Obj).url || '') : '';
  const fin = await sb.rpc('plan_card_finish', {
    p_order_id: orderId, p_payment_key: paymentKey, p_ok: true, p_method: String(pay.method || ''),
    p_approved_at: typeof pay.approvedAt === 'string' ? pay.approvedAt : null, p_receipt_url: receipt || null,
  });
  if (fin.error) return { ok: false, msg: 'unknown' };                   // 결제는 됐다. 잠근 채 두면 크론이 다시 확정한다
  if (fin.data?.ok) return { ok: true };
  if (fin.data?.need_cancel) {
    const okc = await cancelPay(sb, secret, orderId, paymentKey, '이웃셀러 자리 마감·신청 종료로 자동 취소');
    return { ok: false, msg: okc ? 'refunded' : 'refund_pending', why: fin.data.msg };
  }
  return { ok: false, msg: 'unknown' };
}

Deno.serve(async (req) => {
  const H = { ...cors(req), 'Content-Type': 'application/json' };
  const J = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: H });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return J({ ok: false, msg: 'method' }, 405);
  const secret = Deno.env.get('TOSSPAY_SECRET_KEY') || '';
  const isSweep = new URL(req.url).searchParams.get('op') === 'sweep';

  if (isSweep) {
    const cron = Deno.env.get('PUSH_CRON_SECRET') || '';
    if (!cron || req.headers.get('x-cron-secret') !== cron) return J({ ok: false, msg: 'unauthorized' }, 401);
    if (!secret) return J({ ok: false, msg: 'not_configured' }, 503);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const list = await sb.rpc('plan_card_resolve_list');
    if (list.error) return J({ ok: false, msg: 'server' }, 500);
    const out: Obj[] = [];
    for (const p of (list.data || []) as Obj[]) {
      const orderId = String(p.order_id), key = p.payment_key ? String(p.payment_key) : '', age = Number(p.age_min) || 0;
      if (!key) {                                  // 열쇠 없이 잠긴 줄(있어선 안 된다) — 15분 지나면 실패로 닫는다
        if (age >= 15 && p.status === 'confirming') await sb.rpc('plan_card_finish', { p_order_id: orderId, p_payment_key: null, p_ok: false, p_code: 'NO_KEY', p_msg: '결제 열쇠 없이 잠김' });
        out.push({ orderId, msg: 'no_key' }); continue;
      }
      if (p.status === 'cancel_needed') { out.push({ orderId, msg: (await cancelPay(sb, secret, orderId, key, '이웃셀러 확정 실패로 자동 취소')) ? 'refunded' : 'refund_pending' }); continue; }
      const r = await settle(sb, secret, orderId, key, Number(p.amount), age);
      out.push({ orderId, msg: r.ok ? 'ok' : r.msg });
    }
    return J({ ok: true, n: out.length, out });
  }

  let b: Obj;
  try { b = await req.json(); } catch { return J({ ok: false, msg: 'bad' }, 400); }
  const token = typeof b.token === 'string' ? b.token : '';
  const paymentKey = typeof b.paymentKey === 'string' ? b.paymentKey : '';
  const orderId = typeof b.orderId === 'string' ? b.orderId : '';
  const amount = Number(b.amount);
  if (!token || token.length > 400 || !paymentKey || paymentKey.length > 200 || !/^[A-Za-z0-9_=-]{6,64}$/.test(orderId) || !Number.isInteger(amount) || amount <= 0) {
    return J({ ok: false, msg: 'bad' }, 400);
  }
  if (!secret) return J({ ok: false, msg: 'not_configured' }, 503);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 주인·금액 대조 + 결제 열쇠 적고 잠금. 여기서 거절되면 승인 호출을 하지 않았으므로 돈은 나가지 않는다(paid:false)
  const beg = await sb.rpc('plan_card_begin', { p_token: token, p_order_id: orderId, p_amount: amount, p_payment_key: paymentKey });
  if (beg.error) return J({ ok: false, msg: 'server', paid: false }, 500);
  if (!beg.data?.ok) return J({ ok: false, msg: beg.data?.msg || 'closed', paid: beg.data?.msg === 'in_progress' ? null : false });
  if (beg.data.done) return J({ ok: true, done: true });
  return J(await settle(sb, secret, orderId, paymentKey, amount, 0));
});
