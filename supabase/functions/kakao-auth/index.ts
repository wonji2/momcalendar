// 맘캘린더 카카오 로그인 처리 Edge Function
// 프론트에서 받은 인가코드(code)를 토큰으로 교환 → 닉네임 조회 → members 테이블에 저장
// REST 키는 서버(시크릿)에서만 사용, 브라우저엔 노출 안 됨
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const { code, redirect_uri, device_id } = await req.json()
    if (!code || !redirect_uri) return json({ error: 'code/redirect_uri 필요' }, 400)

    const REST = Deno.env.get('KAKAO_REST_KEY')
    if (!REST) return json({ error: 'KAKAO_REST_KEY 미설정' }, 500)

    // 1) 인가코드 → 액세스 토큰
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: REST,
        redirect_uri,
        code,
      }),
    })
    const token = await tokenRes.json()
    if (!token.access_token) return json({ error: '토큰 교환 실패', detail: token }, 400)

    // 2) 토큰 → 사용자 정보(닉네임)
    const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    const me = await meRes.json()
    const kakaoId = String(me?.id || '')
    const nickname = me?.kakao_account?.profile?.nickname || ''
    if (!kakaoId) return json({ error: '사용자 정보 조회 실패', detail: me }, 400)

    // 3) members 테이블 저장(service_role)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { error } = await sb.from('members').upsert(
      { kakao_id: kakaoId, nickname, device_id: device_id || null, updated_at: new Date().toISOString() },
      { onConflict: 'kakao_id' },
    )
    if (error) return json({ error: 'DB 저장 실패', detail: error.message }, 500)

    return json({ ok: true, kakao_id: kakaoId, nickname })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
