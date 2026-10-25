// 맘캘린더 카페(momcal, clubid 31499187) 글 한 개 + 댓글 → 사이트 안에서 읽기용 (사장님 2026-10-25 「커뮤니티 본문이랑 댓글 눈팅은 가능하게하고 댓글쓰거나 글쓰기는 카페로」)
//  흐름  GET /functions/v1/cafe-article?id=<글번호>  → 네이버 카페 공개 API(로그인 불필요) 두 번 → 본문을 안전한 블록으로 바꿔 JSON
//         글: apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/31499187/articles/{id}
//         댓글: .../v2/cafes/31499187/articles/{id}/comments/pages/1 (등록순, 첫 쪽)
//  본문  SmartEditor HTML 을 그대로 내보내지 않는다(스크립트·스타일·추적 태그) → {t:'p',text} {t:'img',src} {t:'link',url,title} {t:'quote',text} {t:'video'} {t:'hr'} 블록
//  막는 것  이 카페 글만 · 숫자 id 만 · 비공개/블라인드/읽기 불가 글은 ok:false
//  캐시  응답에 Cache-Control 120초(브라우저) — 글은 자주 안 바뀐다
import { DOMParser, Element } from 'https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts'

const CLUB = 31499187
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}
const json = (o: unknown, status = 200, cache = 0) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json', ...(cache ? { 'Cache-Control': `public, max-age=${cache}` } : {}) } })

async function getJson(url: string) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://m.cafe.naver.com/' } })
  if (!r.ok) throw new Error('http ' + r.status)
  return await r.json()
}
const okImg = (u: string) => /^https:\/\/([a-z0-9-]+\.)*(pstatic\.net|naver\.net)\//i.test(u)
const clean = (s: string) => s.replace(/​/g, '').replace(/[ \t]+\n/g, '\n').trim()

type Block = { t: string; text?: string; src?: string; url?: string; title?: string }

function blocksFromHtml(html: string): Block[] {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc?.getElementById('root')
  if (!root) return []
  const out: Block[] = []
  const comps = [...root.querySelectorAll('.se-component')] as Element[]
  const textOf = (el: Element) => {
    const ps = [...el.querySelectorAll('.se-text-paragraph')] as Element[]
    if (ps.length) return clean(ps.map((p) => (p.textContent || '')).join('\n'))
    return clean(el.textContent || '')
  }
  if (comps.length) {
    for (const c of comps) {
      const cls = c.getAttribute('class') || ''
      if (/se-text\b/.test(cls) || /se-sectionTitle/.test(cls)) { const t = textOf(c); if (t) out.push({ t: 'p', text: t }); continue }
      if (/se-quotation/.test(cls)) { const t = textOf(c); if (t) out.push({ t: 'quote', text: t }); continue }
      if (/se-horizontalLine/.test(cls)) { out.push({ t: 'hr' }); continue }
      if (/se-video|se-oembed/.test(cls)) { out.push({ t: 'video' }); continue }
      if (/se-oglink/.test(cls)) {
        const a = c.querySelector('a[href]') as Element | null
        const url = a?.getAttribute('href') || ''
        const title = clean((c.querySelector('.se-oglink-title') as Element | null)?.textContent || url)
        if (/^https?:\/\//i.test(url)) out.push({ t: 'link', url, title })
        continue
      }
      const imgs = [...c.querySelectorAll('img')] as Element[]
      let pushed = false
      for (const im of imgs) {
        const src = im.getAttribute('data-lazy-src') || im.getAttribute('src') || ''
        if (okImg(src)) { out.push({ t: 'img', src: src.replace(/\?type=[^&]+/, '') }); pushed = true }
      }
      if (!pushed) { const t = textOf(c); if (t) out.push({ t: 'p', text: t }) }
    }
    return out
  }
  // 옛 편집기 글: 줄바꿈 살리고 글자 + 사진만
  for (const br of [...root.querySelectorAll('br')] as Element[]) br.replaceWith(doc!.createTextNode('\n'))
  for (const im of [...root.querySelectorAll('img')] as Element[]) {
    const src = im.getAttribute('src') || ''
    if (okImg(src)) im.replaceWith(doc!.createTextNode(`\n[[IMG:${src}]]\n`))
  }
  const txt = clean(root.textContent || '')
  for (const part of txt.split(/\n?\[\[IMG:([^\]]+)\]\]\n?/)) {
    if (!part) continue
    if (okImg(part)) out.push({ t: 'img', src: part.replace(/\?type=[^&]+/, '') })
    else if (part.trim()) out.push({ t: 'p', text: clean(part) })
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const id = Number(new URL(req.url).searchParams.get('id') || '')
    if (!Number.isInteger(id) || id <= 0 || id > 1e10) return json({ ok: false, error: 'id 필요' }, 400)
    const base = `https://apis.naver.com/cafe-web/cafe-articleapi`
    const [a, c] = await Promise.allSettled([
      getJson(`${base}/v2.1/cafes/${CLUB}/articles/${id}?useCafeId=true`),
      getJson(`${base}/v2/cafes/${CLUB}/articles/${id}/comments/pages/1?requestFrom=A&orderBy=asc`),
    ])
    if (a.status !== 'fulfilled') return json({ ok: false, error: '글을 불러오지 못했어요' }, 502)
    const art = a.value?.result?.article
    if (!art || art.isBlind || art.isReadable === false) return json({ ok: false, error: '카페에서만 볼 수 있는 글이에요' }, 200, 60)
    const blocks = blocksFromHtml(String(art.contentHtml || ''))
    const items = c.status === 'fulfilled' ? (c.value?.result?.comments?.items || []) : []
    const comments = (items as any[]).slice(0, 200).map((x) => ({
      id: String(x.id || ''),
      reply: x.isRef === true || (x.refId && String(x.refId) !== String(x.id)),
      deleted: x.isDeleted === true,
      nick: String(x.writer?.nick || ''),
      host: Number(x.memberLevel) === 999,
      text: x.isDeleted ? '' : String(x.content || '').slice(0, 2000),
      image: (x.image && okImg(String(x.image.url || ''))) ? String(x.image.url) : (x.sticker && okImg(String(x.sticker.url || '')) ? String(x.sticker.url) : ''),
      at: Number(x.updateDate) || 0,
    }))
    return json({
      ok: true, id,
      subject: String(art.subject || ''),
      board: String(art.menu?.name || ''), boardId: Number(art.menu?.id || 0),
      nick: String(art.writer?.nick || ''), host: Number(art.writer?.memberLevel) === 999,
      at: Number(art.writeDate) || 0, read: Number(art.readCount) || 0, commentCount: Number(art.commentCount) || comments.length,
      blocks, comments, more: c.status === 'fulfilled' ? !!c.value?.result?.hasNext : false,
      url: `https://m.cafe.naver.com/ca-fe/web/cafes/${CLUB}/articles/${id}`,
    }, 200, 120)
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 120) }, 500)
  }
})
