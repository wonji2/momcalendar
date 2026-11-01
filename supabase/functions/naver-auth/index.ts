// 맘캘린더 네이버 로그인 처리 Edge Function (kakao-auth 를 그대로 본뜸 · 2026-10-24)
// 프론트에서 받은 인가코드(code)+state 를 토큰으로 교환 → 별명(+동의 시 성별·연령대) 조회 → members 에 저장(kakao_id = 'naver:'+id, provider='naver')
// Client ID/Secret 은 서버 시크릿(NAVER_CLIENT_ID / NAVER_CLIENT_SECRET)에서만 쓴다.
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
    const { op, code, state, redirect_uri, device_id } = await req.json()
    const ID = Deno.env.get('NAVER_CLIENT_ID')
    const SECRET = Deno.env.get('NAVER_CLIENT_SECRET')
    if (!ID || !SECRET) return json({ error: 'NAVER_CLIENT_ID/SECRET 미설정' }, 500)
    // 0) 브라우저가 인증 주소를 만들 때 쓰는 Client ID (OAuth 의 client_id 는 공개값 — 시크릿은 절대 안 나간다)
    if (op === 'id') return json({ ok: true, client_id: ID })
    if (!code || !state) return json({ error: 'code/state 필요' }, 400)

    // 1) 인가코드 → 액세스 토큰 (네이버는 redirect_uri 를 요구하지 않지만 넣어도 무해)
    const qs = new URLSearchParams({ grant_type: 'authorization_code', client_id: ID, client_secret: SECRET, code, state })
    if (redirect_uri) qs.set('redirect_uri', redirect_uri)
    const tokenRes = await fetch('https://nid.naver.com/oauth2.0/token?' + qs.toString())
    const token = await tokenRes.json()
    if (!token.access_token) return json({ error: '토큰 교환 실패', detail: token }, 400)

    // 2) 토큰 → 사용자 정보(별명)
    const meRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    const me = await meRes.json()
    const nid = String(me?.response?.id || '')
    const nickname = me?.response?.nickname || me?.response?.name || ''
    if (!nid) return json({ error: '사용자 정보 조회 실패', detail: me }, 400)
    // 추가(선택) 동의 항목 — 손님이 동의했을 때만 온다. 안 오면 null 로 둔다(이전 값은 지우지 않는다)
    const g = me?.response?.gender
    const gender = (g === 'F' || g === 'M' || g === 'U') ? g : null
    const a = me?.response?.age
    const age_range = (typeof a === 'string' && /^[0-9]{1,2}-[0-9]{1,3}$/.test(a)) ? a : null
    const memberId = 'naver:' + nid   // members.kakao_id 가 회원 키 — 카카오 숫자 id 와 절대 겹치지 않게 접두어

    // 3) members 저장(service_role)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { error } = await sb.from('members').upsert(
      { kakao_id: memberId, nickname, provider: 'naver', device_id: device_id || null, updated_at: new Date().toISOString(),
        ...(gender ? { gender } : {}), ...(age_range ? { age_range } : {}) },
      { onConflict: 'kakao_id' },
    )
    if (error) return json({ error: 'DB 저장 실패', detail: error.message }, 500)

    // 4) 회원 세션 발급 — 토큰 원문은 저장하지 않고 sha256 해시만
    const raw = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
    const tokenHash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    const { error: sErr } = await sb.from('member_sessions').insert({ token_hash: tokenHash, kakao_id: memberId })
    if (sErr) return json({ error: '세션 발급 실패', detail: sErr.message }, 500)

    return json({ ok: true, kakao_id: memberId, nickname, provider: 'naver', token: raw })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
