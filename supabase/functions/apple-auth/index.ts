// 맘캘린더 애플로 로그인 Edge Function (2026-10-27 · App Review 4.8)
// 아이폰 앱이 받은 identity token(JWT) + 원래 nonce 를 받아 검증 → members 에 저장(kakao_id = 'apple:'+sub, provider='apple') → 회원 세션 발급
// 애플 문서 「Verifying a user」 대로 서버에서 확인한다:
//   · 서명: https://appleid.apple.com/auth/keys (JWKS) 의 kid 공개키로 RS256
//   · iss = https://appleid.apple.com · aud = 번들 ID(com.wontsbe.momcalendar) · exp 가 지나지 않았다
//   · nonce: 앱이 만든 난수의 sha256 을 토큰에 넣었다 → 서버가 원래 난수로 다시 계산해 같을 때만, 한 번만(apple_nonce_used)
// 이메일은 받지 않는다(이메일 범위를 요청하지 않는다). 이름은 처음 한 번만 오므로 받으면 별명으로 쓴다.
// 탈퇴 때 애플 토큰 철회(App Review 5.1.1(v), 2026-10-27 — 설계 scratchpad/designs/2026-10-27_애플탈퇴_토큰철회.md):
//   · 로그인: 앱이 준 authorizationCode(1회용·5분)를 /auth/token 으로 바꿔 refresh token 을 apple_tokens 에(같은 sub 일 때만). 실패해도 로그인은 그대로
//   · {action:'flush'}: 탈퇴 RPC 가 apple_revoke_queue 에 옮긴 토큰을 /auth/revoke 로 끊는다(탈퇴 직후 앱이 부르고, 하루 1번 pg_cron 이 다시)
//   · client_secret = ES256 JWT(kid=APPLE_SIWA_KEY_ID, iss=APPLE_TEAM_ID, aud=https://appleid.apple.com, sub=번들 ID), 부를 때마다 5분짜리
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

const b64url = (b: Uint8Array | string) => {
  const u = typeof b === 'string' ? new TextEncoder().encode(b) : b
  let s = ''; u.forEach((x) => { s += String.fromCharCode(x) })
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
// 애플 문서 「Creating a client secret」: ES256, kid·iss·iat·exp(≤6개월)·aud·sub
async function clientSecret(): Promise<string | null> {
  const pem = Deno.env.get('APPLE_SIWA_P8'), kid = Deno.env.get('APPLE_SIWA_KEY_ID'), team = Deno.env.get('APPLE_TEAM_ID')
  if (!pem || !kid || !team) return null
  const der = Uint8Array.from(atob(pem.split('\\n').join('\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const now = Math.floor(Date.now() / 1000)
  const input = b64url(JSON.stringify({ alg: 'ES256', kid })) + '.' + b64url(JSON.stringify({ iss: team, iat: now, exp: now + 300, aud: ISS, sub: AUD }))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input)))   // r||s (JWS 꼴)
  return input + '.' + b64url(sig)
}
async function appleForm(path: string, f: Record<string, string>) {
  return await fetch(ISS + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f).toString(), signal: AbortSignal.timeout(8000) })   // 애플이 늦어도 로그인·탈퇴가 멈추지 않게
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
    const body = await req.json()
    const sbAdmin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    // 철회 대기열 비우기 — 대기열에 있는 토큰만 끊는다(누가 불러도 철회 말고는 하는 일이 없다).
    //   실패한 줄은 20시간 뒤에만 다시 — 아무나 여러 번 불러도 다시 시도 횟수(10번)를 태우지 못한다(Codex 지적)
    if (body && body.action === 'flush') {
      const cs = await clientSecret()
      const sb = sbAdmin()
      if (!cs) { await sb.from('health_alerts').insert({ kind: '애플키없음', detail: 'flush — Edge 시크릿 APPLE_SIWA_P8·APPLE_SIWA_KEY_ID·APPLE_TEAM_ID' }); return json({ ok: false, error: '키 없음' }, 503) }
      const since = new Date(Date.now() - 20 * 3600e3).toISOString()
      const { data: rows } = await sb.from('apple_revoke_queue').select('id,refresh_token,tries').is('done_at', null).lt('tries', 10).or('last_try_at.is.null,last_try_at.lt.' + since).order('id').limit(20)
      let done = 0, fail = 0
      for (const r of rows || []) {
        let err = ''
        try {
          const res = await appleForm('/auth/revoke', { client_id: AUD, client_secret: cs, token: r.refresh_token, token_type_hint: 'refresh_token' })
          if (res.status !== 200) err = 'http_' + res.status + ' ' + (await res.text()).slice(0, 80)
        } catch (e) { err = String(e).slice(0, 80) }
        if (!err) {
          const { error: uErr } = await sb.from('apple_revoke_queue').update({ done_at: new Date().toISOString(), last_try_at: new Date().toISOString(), refresh_token: '-', last_error: null }).eq('id', r.id)
          if (uErr) { fail++; await sb.from('health_alerts').insert({ kind: '애플토큰철회실패', detail: 'queue ' + r.id + ' 철회됨·표 갱신 실패 ' + String(uErr.message).slice(0, 60) }) } else done++
        }
        else {
          fail++
          await sb.from('apple_revoke_queue').update({ tries: (r.tries || 0) + 1, last_error: err, last_try_at: new Date().toISOString() }).eq('id', r.id)
          if ((r.tries || 0) + 1 >= 10) await sb.from('health_alerts').insert({ kind: '애플토큰철회실패', detail: 'queue ' + r.id + ' ' + err })
        }
      }
      return json({ ok: true, done, fail })
    }
    const { id_token, nonce, device_id, name, auth_code } = body || {}
    if (!id_token || typeof id_token !== 'string' || id_token.length > 4000) return json({ error: 'id_token 필요' }, 400)
    if (!nonce || !/^[A-Za-z0-9._~-]{16,128}$/.test(String(nonce))) return json({ error: 'nonce 형식' }, 400)

    let claims: any
    try { claims = await verifyIdToken(id_token) } catch (e) { return json({ error: '토큰 검증 실패', detail: String((e as Error).message || e).slice(0, 20) }, 401) }

    // nonce: 토큰 안의 값 = sha256(앱이 보낸 원래 난수) 이어야 한다
    const nonceHash = await sha256hex(String(nonce))
    if (claims.nonce !== nonceHash) return json({ error: 'nonce 불일치' }, 401)

    const sb = sbAdmin()
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

    // 탈퇴 때 철회할 refresh token — 로그인과 별개로 처리하고, 실패해도 로그인은 막지 않는다
    if (auth_code && typeof auth_code === 'string' && auth_code.length < 2000) {
      try {
        const cs = await clientSecret()
        if (!cs) await sb.from('health_alerts').insert({ kind: '애플키없음', detail: '로그인 — 철회용 토큰을 보관하지 못함(Edge 시크릿 APPLE_SIWA_P8·APPLE_SIWA_KEY_ID·APPLE_TEAM_ID)' })
        else {
          const res = await appleForm('/auth/token', { client_id: AUD, client_secret: cs, code: auth_code, grant_type: 'authorization_code' })
          const t = await res.json().catch(() => null)
          let tsub = ''
          try { tsub = JSON.parse(new TextDecoder().decode(b64urlBytes(String(t?.id_token || '').split('.')[1] || ''))).sub || '' } catch (_) { tsub = '' }
          if (res.ok && t?.refresh_token && tsub === String(claims.sub)) {
            const { error: tErr } = await sb.from('apple_tokens').upsert({ kakao_id: memberId, refresh_token: String(t.refresh_token), updated_at: new Date().toISOString() }, { onConflict: 'kakao_id' })
            if (tErr) await sb.from('health_alerts').insert({ kind: '애플토큰교환실패', detail: '보관 실패 ' + String(tErr.message).slice(0, 60) })
          } else {
            await sb.from('health_alerts').insert({ kind: '애플토큰교환실패', detail: 'http_' + res.status + ' ' + String(t?.error || (tsub ? 'sub' : 'no_token')).slice(0, 40) })
          }
        }
      } catch (e) { try { await sb.from('health_alerts').insert({ kind: '애플토큰교환실패', detail: String(e).slice(0, 80) }) } catch (_) {} }
    }

    const raw = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')
    const tokenHash = await sha256hex(raw)
    const { error: sErr } = await sb.from('member_sessions').insert({ token_hash: tokenHash, kakao_id: memberId })
    if (sErr) return json({ error: '세션 발급 실패' }, 500)

    return json({ ok: true, kakao_id: memberId, nickname: m?.nickname || '', provider: 'apple', token: raw })
  } catch (e) {
    return json({ error: String(e).slice(0, 120) }, 500)
  }
})
