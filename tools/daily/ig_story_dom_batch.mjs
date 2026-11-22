/**
 * 📖 인스타 **스토리(24시간)** 를 화면(DOM)에서 넘기며 받는 배치 생성기 (2026-10-07)
 *
 * 왜 DOM 인가: 2026-10-07 실측 — GET /api/v1/feed/reels_media/ 는 전부 500, 스토리 페이지 SSR 에는 데이터가 없고
 *   (하이라이트 페이지는 SSR 에 reels_media connection 이 있다 — ig_story_hl_loop.js 가 그걸 쓴다),
 *   네트워크 캡처에도 graphql 요청이 안 잡힌다. 대신 **스토리 화면에서 ArrowRight 로 넘기면 URL 이 바뀌고
 *   현재 장면의 <img>/<video> 가 DOM 에 있다** → 그걸 블롭 다운로드로 받는다(mc_st_<핸들>_<n>.jpg).
 *
 * 한 셀러 = [navigate /stories/<핸들>/ → 5초 → 「스토리 보기」 확인 클릭(좌표 780,430 @1568x705) → 4초 → JS 루프]
 *   JS 루프: 장면마다 이미지면 받고, 동영상이면 포스터 대신 건너뛴다. ArrowRight → 1.3초 → URL 이 안 바뀌면 끝. 최대 25장.
 *   ⚠ 스토리가 없는 셀러는 확인 화면 없이 프로필로 돌아간다 — 루프가 0장으로 끝난다(오류 아님).
 *
 *   IG_TAB=<탭id> node tools/daily/ig_story_dom_batch.mjs 핸들1 핸들2 …  > actions.json   (5명씩)
 */
const js = (h) => String.raw`const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const out={h:'${h}',got:0,seen:0,vid:0,links:[]};
if(!/\/stories\//.test(location.pathname)){ out.note='스토리 없음(프로필로 돌아옴)'; out; } else {
const dl=async(url,name)=>{ try{ const b=await (await fetch(url)).blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; document.body.appendChild(a); a.click(); a.remove(); await sleep(350); return true; }catch(e){ return false; } };
const seenUrl=new Set();
for(let i=0;i<25;i++){
  const key=location.pathname; if(seenUrl.has(key)) break; seenUrl.add(key); out.seen++;
  const img=[...document.querySelectorAll('img')].filter(x=>x.naturalWidth>400&&x.naturalHeight>600).sort((a,b)=>b.naturalWidth-a.naturalWidth)[0];
  const vid=document.querySelector('video');
  for(const a of document.querySelectorAll('a[href]')){ const u=a.href||''; if(/l\.instagram\.com\/\?u=/.test(u)){ try{ const d=decodeURIComponent(new URL(u).searchParams.get('u')||''); out.links.push(d.replace(/^https?:\/\//,'').split('?')[0].slice(0,50)); }catch(e){} } }
  if(img){ if(await dl(img.src,'mc_st_${h}_'+(i+1)+'.jpg')) out.got++; } else if(vid){ out.vid++; }
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',keyCode:39,bubbles:true}));
  await sleep(1300);
  if(!/\/stories\//.test(location.pathname)) break;
}
out.links=[...new Set(out.links)].slice(0,8); out; }`;
// ⚠ 루프를 javascript_tool 안에서 기다리면 45초 CDP 한도에 걸린다(2026-10-07 실측 — 받긴 다 받았는데 도구는 timeout).
//   → 루프를 **떼어 놓고**(window.__mcSt 에 결과) 'started' 만 돌려준 뒤, 30초 기다렸다가 결과를 읽는다.
const detached = (h) => `window.__mcSt=null; (async()=>{ window.__mcSt = await (async()=>{ ${js(h).replace(/\bout; \}$/, 'return out; }').replace(/out\.note='스토리 없음\(프로필로 돌아옴\)'; out;/, "out.note='스토리 없음(프로필로 돌아옴)'; return out;")} })(); })(); 'started'`;
const TAB = Number(process.env.IG_TAB || 0) || undefined;
const acts = [];
for (const h of process.argv.slice(2)) {
  acts.push({ name: 'navigate', input: { tabId: TAB, url: 'https://www.instagram.com/stories/' + h + '/' } });
  acts.push({ name: 'computer', input: { tabId: TAB, action: 'wait', duration: 5 } });
  acts.push({ name: 'computer', input: { tabId: TAB, action: 'left_click', coordinate: [780, 430], action_summary: '스토리 보기 확인 버튼을 누른다' } });
  acts.push({ name: 'computer', input: { tabId: TAB, action: 'wait', duration: 4 } });
  acts.push({ name: 'javascript_tool', input: { tabId: TAB, action: 'javascript_exec', text: detached(h) } });
  acts.push({ name: 'computer', input: { tabId: TAB, action: 'wait', duration: 10 } });
  acts.push({ name: 'computer', input: { tabId: TAB, action: 'wait', duration: 10 } });
  acts.push({ name: 'computer', input: { tabId: TAB, action: 'wait', duration: 10 } });
  acts.push({ name: 'javascript_tool', input: { tabId: TAB, action: 'javascript_exec', text: "window.__mcSt || 'running'" } });
}
process.stdout.write(JSON.stringify(acts));
