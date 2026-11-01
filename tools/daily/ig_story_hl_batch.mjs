/**
 * 📖 인스타 **스토리·하이라이트** 달력 수확 배치 생성기 (2026-10-07, 사장님 "스토리랑 하이라이트에도 다 있어")
 *
 * 왜: 달력 셀러 명단에서 이번 달 달력이 안 잡힌 셀러는 달력을 **게시물이 아니라 스토리·하이라이트**에 둔다.
 *     둘 다 로그인 탭에서만 읽힌다 → Claude 크롬 확장(claude-in-chrome) 탭에서 이 JS 를 돌린다.
 *
 * 흐름(셀러 1명 = navigate 프로필 → JS 1회):
 *   ① 프로필 HTML 에서 uid           (web_profile_info 는 IP 429 가 잦다 — 메모리 ig-graphql-posts-query)
 *   ② 하이라이트 목록: graphql query_hash d4d88dc1500312af6f937f7b804c68c3 (include_highlight_reels) — 2026-10-07 실측 200
 *   ③ 스토리: /api/v1/feed/user/<uid>/story/ → 없으면 /api/v1/feed/reels_media/?reel_ids=<uid> (스토리가 없으면 500 이 온다 — 오류 아님)
 *   ④ 제목이 일정꼴(공구·일정·달력·캘린더·스케줄·N월)인 하이라이트만 reels_media/?reel_ids=highlight:<id> 로 열어
 *      그림을 **블롭 다운로드**로 Downloads 에 떨어뜨린다(mc_hl_<핸들>_<id>_<n>.jpg). 스토리는 mc_st_<핸들>_<n>.jpg.
 *      ⚠ CDN 주소를 도구 출력에 그대로 내면 [BLOCKED] 로 가려진다 → 주소는 안 내보내고 파일로 받는다.
 *   ⑤ 받은 그림은 세션이 눈으로 읽어 `cal_reg.mjs` 로 등록한다(핸들은 지어내지 않는다 — 프로필 그대로).
 *
 *   node tools/daily/ig_story_hl_batch.mjs 핸들1 핸들2 …  > actions.json   (5명씩. 5초 간격)
 * 결과 요약은 세션이 scratchpad/story_hl_log_<날짜>.txt 에 적는다.
 */
const SCHED_RE = String.raw`/공구|일정|달력|캘린더|스케줄|schedule|calendar|\d+\s*월|오픈|예정|이달|이번달|monthly/i`;
const js = (h) => String.raw`await new Promise(r=>setTimeout(r,2500));
const H={'x-ig-app-id':'936619743392459','x-requested-with':'XMLHttpRequest'}; const out={h:'${h}'};
const html=document.documentElement.innerHTML;
let m=html.match(/"profile_id":"(\d+)"/)||html.match(/"id":"(\d+)","username":"${h.replace(/\./g, '\\.')}"/)||html.match(/"user_id":"(\d+)"/);
out.uid=m?m[1]:null; out.title=document.title.slice(0,50);
if(!out.uid){ out.note='uid 못 찾음(비공개·없는 계정·로그인벽?)'; out; } else {
const dl=async(url,name)=>{ try{ const b=await (await fetch(url)).blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; document.body.appendChild(a); a.click(); a.remove(); await new Promise(r=>setTimeout(r,350)); return true; }catch(e){ return false; } };
const pick=(it)=>{ const c=(it.image_versions2&&it.image_versions2.candidates)||[]; return c.length?c[0].url:null; };
// 하이라이트 목록
out.hl=[];
try{ const v=encodeURIComponent(JSON.stringify({user_id:out.uid,include_chaining:false,include_reel:false,include_suggested_users:false,include_logged_out_extras:false,include_highlight_reels:true,include_live_status:false}));
  const r=await fetch('/graphql/query/?query_hash=d4d88dc1500312af6f937f7b804c68c3&variables='+v,{headers:H,credentials:'include'}); out.hlStatus=r.status;
  const j=await r.json(); out.hl=(j.data?.user?.edge_highlight_reels?.edges||[]).map(e=>({id:String(e.node.id),title:String(e.node.title||'')})); }catch(e){ out.hlErr=String(e).slice(0,60); }
// 스토리
out.st=0; out.stDl=0; out.stLinks=[];
try{ let items=null; let r=await fetch('/api/v1/feed/user/'+out.uid+'/story/',{headers:H,credentials:'include'}); out.stStatus=r.status;
  const ct=(r.headers.get('content-type')||'');   // 이 경로는 HTML(200) 로 떨어질 때가 있다 — JSON 일 때만 믿는다 (2026-10-07 실측)
  if(r.ok && ct.includes('json')){ const j=await r.json(); items=(j.reel&&j.reel.items)||[]; }
  else { r=await fetch('/api/v1/feed/reels_media/?reel_ids='+out.uid,{headers:H,credentials:'include'}); out.stStatus2=r.status; if(r.ok){ const j=await r.json(); const reel=j.reels&&j.reels[out.uid]; items=reel?reel.items:[]; } }
  if(items){ out.st=items.length; let n=0; for(const it of items.slice(0,20)){ for(const s of (it.story_link_stickers||[])) out.stLinks.push(String(s.story_link.url||'').replace(/^https?:\/\//,'').split('?')[0].slice(0,50)); const u=pick(it); if(u&&await dl(u,'mc_st_${h}_'+(++n)+'.jpg')) out.stDl++; } }
}catch(e){ out.stErr=String(e).slice(0,60); }
// 일정꼴 하이라이트만 연다
out.hlDl={}; const SCHED=${SCHED_RE};
for(const hl of out.hl.filter(x=>SCHED.test(x.title)).slice(0,4)){
  try{ const r=await fetch('/api/v1/feed/reels_media/?reel_ids=highlight:'+hl.id,{headers:H,credentials:'include'}); if(!r.ok){ out.hlDl[hl.title]='http '+r.status; continue; }
    const j=await r.json(); const reel=j.reels&&j.reels['highlight:'+hl.id]; const items=reel?reel.items:[]; let n=0;
    // 최신 것부터 — 이번 달 달력은 보통 마지막에 있다
    for(const it of items.slice(-12).reverse()){ const u=pick(it); if(u&&await dl(u,'mc_hl_${h}_'+hl.id+'_'+(++n)+'.jpg')); }
    out.hlDl[hl.title]=items.length+'개 중 '+n+'장 받음';
  }catch(e){ out.hlDl[hl.title]='err '+String(e).slice(0,40); }
}
out; }`;
const handles = process.argv.slice(2);
const acts = [];
for (const h of handles) {
  acts.push({ name: 'navigate', input: { tabId: Number(process.env.IG_TAB || 0) || undefined, url: 'https://www.instagram.com/' + h + '/' } });
  acts.push({ name: 'javascript_tool', input: { tabId: Number(process.env.IG_TAB || 0) || undefined, action: 'javascript_exec', text: js(h) } });
  acts.push({ name: 'computer', input: { tabId: Number(process.env.IG_TAB || 0) || undefined, action: 'wait', duration: 5 } });
}
acts.pop();
process.stdout.write(JSON.stringify(acts));
