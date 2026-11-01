// 📖 인스타 스토리·하이라이트 달력 수확 — 로그인 탭(claude-in-chrome)에 한 번 심고, 백그라운드 루프로 돈다 (2026-10-07)
//   사장님: "10월 달력 없는애들도 훑지만 … 스토리랑 하이라이트에도 다 있어"
//   쓰는 법: javascript_tool 로 이 파일 내용을 그대로 실행 → window.__mcSH.start([핸들…]) → 1분마다 window.__mcSH.status() 로 확인.
//   프로필 페이지로 이동하지 않는다 — 같은 출처에서 fetch('/<핸들>/') 로 HTML 을 받아 uid 를 찾는다(네비게이션 비용 0).
//   받은 그림은 블롭 다운로드로 Downloads/mc_st_<핸들>_n.jpg · mc_hl_<핸들>_<id>_n.jpg 에 떨어진다 → 세션이 읽어 cal_reg.mjs 로 등록.
//   ⚠ CDN 주소는 도구 출력에 내지 않는다([BLOCKED]). 간격 6초, 연속 실패 4회면 멈추고 status 에 적는다.
(() => {
  const H = { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' };
  const SCHED = /공구|일정|달력|캘린더|스케줄|schedule|calendar|\d+\s*월|오픈|예정|이달|이번달|monthly|event|이벤트/i;
  const S = (window.__mcSH = window.__mcSH || { res: [], queue: [], running: false, fails: 0, log: [] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dl = async (url, name) => { try { const b = await (await fetch(url)).blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); await sleep(400); return true; } catch (e) { return false; } };
  const pick = (it) => { const c = (it.image_versions2 && it.image_versions2.candidates) || []; return c.length ? c[0].url : null; };
  const one = async (h) => {
    const out = { h, t: new Date().toISOString().slice(11, 16) };
    try {
      const r0 = await fetch('/' + h + '/', { credentials: 'include' }); out.page = r0.status;
      const html = await r0.text();
      const esc = h.replace(/[.]/g, '\\.');
      let m = html.match(/"profile_id":"(\d+)"/) || html.match(new RegExp('"id":"(\\d+)","username":"' + esc + '"')) || html.match(/"user_id":"(\d+)"/);
      out.uid = m ? m[1] : null;
      if (!out.uid) { out.note = 'uid 없음(비공개·없는 계정·로그인벽)'; return out; }
      // 하이라이트
      out.hl = [];
      try {
        const v = encodeURIComponent(JSON.stringify({ user_id: out.uid, include_chaining: false, include_reel: false, include_suggested_users: false, include_logged_out_extras: false, include_highlight_reels: true, include_live_status: false }));
        const r = await fetch('/graphql/query/?query_hash=d4d88dc1500312af6f937f7b804c68c3&variables=' + v, { headers: H, credentials: 'include' }); out.hlStatus = r.status;
        const j = await r.json(); out.hl = (j.data?.user?.edge_highlight_reels?.edges || []).map((e) => ({ id: String(e.node.id), title: String(e.node.title || '') }));
      } catch (e) { out.hlErr = String(e).slice(0, 50); }
      // 스토리
      out.st = 0; out.stDl = 0; out.stLinks = [];
      try {
        const r = await fetch('/api/v1/feed/reels_media/?reel_ids=' + out.uid, { headers: H, credentials: 'include' }); out.stStatus = r.status;
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
          const j = await r.json(); const reel = j.reels && j.reels[out.uid]; const items = reel ? reel.items : [];
          out.st = items.length; let n = 0;
          for (const it of items.slice(0, 20)) { for (const s of (it.story_link_stickers || [])) out.stLinks.push(String(s.story_link.url || '').replace(/^https?:\/\//, '').split('?')[0].slice(0, 50)); const u = pick(it); if (u && await dl(u, 'mc_st_' + h + '_' + (++n) + '.jpg')) out.stDl++; }
        }
      } catch (e) { out.stErr = String(e).slice(0, 50); }
      // 일정꼴 하이라이트
      out.hlDl = {};
      for (const hl of out.hl.filter((x) => SCHED.test(x.title)).slice(0, 4)) {
        try {
          const r = await fetch('/api/v1/feed/reels_media/?reel_ids=highlight:' + hl.id, { headers: H, credentials: 'include' });
          if (!r.ok) { out.hlDl[hl.title] = 'http ' + r.status; continue; }
          const j = await r.json(); const reel = j.reels && j.reels['highlight:' + hl.id]; const items = reel ? reel.items : []; let n = 0;
          for (const it of items.slice(-12).reverse()) { const u = pick(it); if (u && await dl(u, 'mc_hl_' + h + '_' + hl.id + '_' + (++n) + '.jpg')); }
          out.hlDl[hl.title] = items.length + '개 중 ' + n + '장';
          await sleep(1500);
        } catch (e) { out.hlDl[hl.title] = 'err ' + String(e).slice(0, 30); }
      }
      S.fails = 0;
    } catch (e) { out.err = String(e).slice(0, 60); S.fails++; }
    return out;
  };
  S.start = (handles) => { S.queue.push(...handles); if (S.running) return 'queued ' + S.queue.length; S.running = true; (async () => { while (S.queue.length) { if (S.fails >= 4) { S.log.push('연속 실패 4회 — 멈춤'); break; } const h = S.queue.shift(); S.res.push(await one(h)); await sleep(6000); } S.running = false; })(); return 'started ' + handles.length; };
  S.status = () => ({ running: S.running, left: S.queue.length, done: S.res.length, fails: S.fails, log: S.log.slice(-3) });
  S.take = () => { const r = S.res.splice(0); return r.map((o) => ({ h: o.h, uid: o.uid, page: o.page, hl: (o.hl || []).map((x) => x.title).join('|'), st: o.st, stDl: o.stDl, links: (o.stLinks || []).slice(0, 6), hlDl: o.hlDl, note: o.note || o.err || o.stErr || o.hlErr })); };
  return 'installed';
})();
