// 맘캘린더 애플로 로그인 Edge Function (2026-10-27 · App Review 4.8)
// 아이폰 앱이 받은 identity token(JWT) + 원래 nonce 를 받아 검증 → members 에 저장(kakao_id = 'apple:'+sub, provider='apple') → 회원 세션 발급
// 애플 문서 「Verifying a user」 대로 서버에서 확인한다:
//   · 서명: https://appleid.apple.com/auth/keys (JWKS) 의 kid 공개키로 RS256
//   · iss = https://appleid.apple.com · aud = 번들 ID(com.wontsbe.momcalendar) · exp 가 지나지 않았다
//   · nonce: 앱이 만든 난수의 sha256 을 토큰에 넣었다 → 서버가 원래 난수로 다시 계산해 같을 때만, 한 번만(apple_nonce_used)
// 토큰·이메일은 저장하지 않는다(이메일 범위는 요청하지 않는다). 이름은 처음 한 번만 오므로 받으면 별명으로 쓴다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OK_ORIGIN = /^(https:\/\/([a-z0-9-]+\.)?momcalendar\.com|capacitor:\/\/localhost)$/
const ISS = 'https://appleid.apple.com'
const AUD = 'com.wontsbe.momcalendar'

const b64urlBytes = (s: string) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))

let jwksCache: { at: number; keys: any[] } | null = null
async function appleKeys(force = false) {
  if (!force && jwksCache && Date.now() - jwksCache.at < 6 * 3600e3) return jwksCache.keys
  const r = await fetch('https://appleid.apple.com/auth/keys')
  const j = await r.json()
  jwksCache = { at: Date.now(), keys: j.keys || [] }
  return jwksCache.keys
}

async function verifyIdToken(tok: string) {
  const parts = tok.split('.')
  if (parts.length !== 3) throw new Error('형식')
  const head = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])))
  const body = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])))
  if (head.alg !== 'RS256' || !head.kid) throw new Error('alg')
  let jwk = (await appleKeys()).find((k) => k.kid === head.kid)
  if (!jwk) jwk = (await appleKeys(true)).find((k) => k.kid === head.kid)   // 애플이 키를 바꾼 직후
  if (!jwk) throw new Error('kid')
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1]))
  if (!ok) throw new Error('서명')
  const now = Math.floor(Date.now() / 1000)
  if (body.iss !== ISS) throw new Error('iss')
  if (body.aud !== AUD) throw new Error('aud')
  if (!body.exp || body.exp < now - 30) throw new Error('exp')
  if (!body.sub) throw new Error('sub')
  return body
}

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
  if (req.method !== 'POST') return json({ error: 'POST' }, 405)

  try {
    const { id_token, nonce, device_id, name } = await req.json()
    if (!id_token || typeof id_token !== 'string' || id_token.length > 4000) return json({ error: 'id_token 필요' }, 400)
    if (!nonce || !/^[A-Za-z0-9._~-]{16,128}$/.test(String(nonce))) return json({ error: 'nonce 형식' }, 400)

    let claims: any
    try { claims = await verifyIdToken(id_token) } catch (e) { return json({ error: '토큰 검증 실패', detail: String((e as Error).message || e).slice(0, 20) }, 401) }

    // nonce: 토큰 안의 값 = sha256(앱이 보낸 원래 난수) 이어야 한다
    const nonceHash = await sha256hex(String(nonce))
    if (claims.nonce !== nonceHash) return json({ error: 'nonce 불일치' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    // 한 번만 — 같은 토큰을 다시 보내면 여기서 막힌다(기본키 충돌)
    const { error: nErr } = await sb.from('apple_nonce_used').insert({ nonce_hash: nonceHash })
    if (nErr) return json({ error: '이미 쓴 로그인' }, 401)

    const memberId = 'apple:' + String(claims.sub)
    const nick = String(name || '').replace(/[<>]/g, '').trim().slice(0, 20)
    // 이름은 처음 로그인 때만 온다 — 없으면 기존 별명을 덮지 않는다
    const row: Record<string, unknown> = { kakao_id: memberId, provider: 'apple', device_id: device_id || null, updated_at: new Date().toISOString(), last_login_at: new Date().toISOString() }
    if (nick) row.nickname = nick
    const { error } = await sb.from('members').upsert(row, { onConflict: 'kakao_id' })
    if (error) return json({ error: 'DB 저장 실패' }, 500)
    const { data: m } = await sb.from('members').select('nickname').eq('kakao_id', memberId).maybeSingle()

    const raw = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')
    const tokenHash = await sha256hex(raw)
    const { error: sErr } = await sb.from('member_sessions').insert({ token_hash: tokenHash, kakao_id: memberId })
    if (sErr) return json({ error: '세션 발급 실패' }, 500)

    return json({ ok: true, kakao_id: memberId, nickname: m?.nickname || '', provider: 'apple', token: raw })
  } catch (e) {
    return json({ error: String(e).slice(0, 120) }, 500)
  }
})
