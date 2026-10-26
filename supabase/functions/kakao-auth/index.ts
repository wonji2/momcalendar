// 맘캘린더 카카오 로그인 처리 Edge Function
// 프론트에서 받은 인가코드(code)를 토큰으로 교환 → 닉네임 조회 → members 테이블에 저장
// REST 키는 서버(시크릿)에서만 사용, 브라우저엔 노출 안 됨
// 2026-10-27 카카오 「보안 권장 사항」·REST API 문서대로 (scratchpad/designs/2026-10-27_카카오로그인_가이드대로.md)
//   · PKCE: 앱 로그인은 code_verifier 를 보낸다 → 그대로 토큰 요청에(카카오 code_challenge_method S256 지원)
//   · 클라이언트 시크릿(권장 1.3): 시크릿 KAKAO_CLIENT_SECRET 이 있으면 client_secret 포함(카카오 콘솔에서 켜기 전에 시크릿부터 넣는다)
//   · redirect_uri 는 우리 주소만(카카오도 등록값과 대조하지만 한 번 더)
//   · CORS 는 우리 사이트만 · 실패 응답에 카카오 사용자 정보를 싣지 않는다(권장 3.3 사용자 정보 로그 금지)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OK_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?momcalendar\.com$/
const OK_REDIRECT = /^https:\/\/momcalendar\.com\/(test\.html|kktest\.html)?$/

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || ''
  const cors = {
    'Access-Control-Allow-Origin': OK_ORIGIN.test(origin) ? origin : 'https://momcalendar.com',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const { code, redirect_uri, device_id, code_verifier } = await req.json()
    if (!code || !redirect_uri) return json({ error: 'code/redirect_uri 필요' }, 400)
    if (!OK_REDIRECT.test(String(redirect_uri))) return json({ error: 'redirect_uri 허용 안 됨' }, 400)
    if (code_verifier != null && !/^[A-Za-z0-9._~-]{43,128}$/.test(String(code_verifier))) return json({ error: 'code_verifier 형식' }, 400)

    const REST = Deno.env.get('KAKAO_REST_KEY')
    if (!REST) return json({ error: 'KAKAO_REST_KEY 미설정' }, 500)
    const SECRET = Deno.env.get('KAKAO_CLIENT_SECRET') || ''

    // 1) 인가코드 → 액세스 토큰
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: REST, redirect_uri, code })
    if (code_verifier) body.set('code_verifier', String(code_verifier))
    if (SECRET) body.set('client_secret', SECRET)
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
    })
    const token = await tokenRes.json()
    // 카카오 에러는 코드·설명만(토큰·사용자 정보는 싣지 않는다)
    if (!token.access_token) return json({ error: '토큰 교환 실패', detail: { error: token.error, error_code: token.error_code } }, 400)

    // 2) 토큰 → 사용자 정보(닉네임)
    const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    const me = await meRes.json()
    const kakaoId = String(me?.id || '')
    const nickname = me?.kakao_account?.profile?.nickname || ''
    if (!kakaoId) return json({ error: '사용자 정보 조회 실패', detail: { code: me?.code } }, 400)

    // 3) members 테이블 저장(service_role)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { error } = await sb.from('members').upsert(
      { kakao_id: kakaoId, nickname, device_id: device_id || null, updated_at: new Date().toISOString() },
      { onConflict: 'kakao_id' },
    )
    if (error) return json({ error: 'DB 저장 실패' }, 500)

    // 4) 회원 세션 발급 — 출석·캘린더 내보내기처럼 '내 것이 쌓이는 기능'을 서버에서 검증하려면 필요.
    //    셀러 세션과 같은 방식으로, 토큰 원문은 저장하지 않고 sha256 해시만 남긴다.
    const raw = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
    const tokenHash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    const { error: sErr } = await sb.from('member_sessions').insert({ token_hash: tokenHash, kakao_id: kakaoId })
    if (sErr) return json({ error: '세션 발급 실패' }, 500)

    return json({ ok: true, kakao_id: kakaoId, nickname, token: raw })
  } catch (e) {
    return json({ error: String(e).slice(0, 120) }, 500)
  }
})
