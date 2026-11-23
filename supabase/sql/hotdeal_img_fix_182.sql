-- 핫딜 카드 사진을 「상품 링크의 대표 사진」으로 (사장님 2026-11-23 「상품링크 메인이미지로 쓰게해야지」)
--
-- 왜: 수집기(깃허브 Actions, 해외 주소)가 11번가·GS SHOP 상품 페이지를 못 읽어 커뮤니티 글 사진(화면 캡처)으로 떨어진다.
--     DB 서버(서울)에서는 같은 페이지가 읽힌다(2026-11-23 실측: 11번가·GS 200, 오늘의집 403).
-- 흐름(10분마다, PC 와 무관): ① 지난 회차에 보낸 요청의 답에서 og:image 를 읽어 사진 교체 ② 커뮤니티 사진이 걸린 노출 중 딜을 8건까지 새로 요청
--   · 할 일이 없으면 바깥 요청을 하지 않는다 · 한 딜 3번까지만 시도 · 옛 사진은 hotdeal_img_fix.old_img 에 남는다(되돌리기)
--   · 받는 사진 주소는 그 몰의 사진 저장소(cdn.011st.com · asset.m-gs.kr)일 때만 — 다른 주소·로고는 버린다
-- 상태: 표 hotdeal_img_fix · 심박 ops_status 'hotdeal-img-fix' · 크론 hotdeal-img-fix
-- 한도: net._http_response 에 페이지 본문(약 300KB)이 6시간 머문다 — 하루 새 딜 30건 안팎이라 10MB 아래
-- 되돌리기: update hotdeals h set img_url=f.old_img from hotdeal_img_fix f where f.hotdeal_id=h.id and f.done and h.img_url=f.new_img;
--           select cron.unschedule('hotdeal-img-fix');

create table if not exists public.hotdeal_img_fix (
  hotdeal_id bigint primary key,
  page_url   text not null,
  req_id     bigint,
  tries      int not null default 0,
  done       boolean not null default false,
  old_img    text,
  new_img    text,
  note       text,
  tried_at   timestamptz not null default now()
);
alter table public.hotdeal_img_fix enable row level security;
revoke all on public.hotdeal_img_fix from anon, authenticated;

create or replace function public.hotdeal_img_fix_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, net, pg_temp
as $fn$
declare
  r record;
  og text;
  fixed int := 0;
  failed int := 0;
  queued int := 0;
  rid bigint;
begin
  -- ① 지난 요청의 답 읽기
  for r in
    select f.hotdeal_id, f.req_id, f.old_img, f.tries, p.status_code, p.content, p.timed_out, p.error_msg
    from hotdeal_img_fix f
    left join net._http_response p on p.id = f.req_id
    where not f.done and f.req_id is not null
  loop
    if r.status_code is null and r.error_msg is null and r.timed_out is null then
      -- 답이 아직 없다. 20분 넘게 없으면 실패로 친다
      update hotdeal_img_fix set req_id = null, note = '답 없음'
       where hotdeal_id = r.hotdeal_id and tried_at < now() - interval '20 minutes';
      continue;
    end if;
    og := null;
    if r.status_code = 200 then
      og := coalesce(
        substring(r.content from 'property=["'']og:image["''][^>]+content=["'']([^"'']+)'),
        substring(r.content from 'content=["'']([^"'']+)["''][^>]+property=["'']og:image'));
      og := replace(coalesce(og, ''), '&amp;', '&');
      if og like '//%' then og := 'https:' || og; end if;
      if og like 'http://%' then og := 'https://' || substr(og, 8); end if;
    end if;
    if og ~ '^https://(cdn\.011st\.com/|asset\.m-gs\.kr/prod/)' and og !~* 'logo|default|noimg|no_image' then
      update hotdeals set img_url = og where id = r.hotdeal_id and img_url = r.old_img;
      update hotdeal_img_fix set done = true, new_img = og, req_id = null, note = '교체' where hotdeal_id = r.hotdeal_id;
      fixed := fixed + 1;
    else
      update hotdeal_img_fix set req_id = null,
             note = '실패 ' || coalesce(r.status_code::text, left(coalesce(r.error_msg, '시간 초과'), 40))
       where hotdeal_id = r.hotdeal_id;
      failed := failed + 1;
    end if;
  end loop;

  -- ② 새로 요청(커뮤니티 글 사진이 걸린 노출 중 딜만 · 한 회차 8건)
  for r in
    select h.id, h.img_url,
           case when h.mall = '11번가'
                  then 'https://www.11st.co.kr/products/' || substring(h.link from 'products(?:%2F|/)([0-9]{6,})')
                when h.mall = 'GS SHOP'
                  then 'https://www.gsshop.com/prd/prd.gs?prdid=' || substring(h.link from 'prdid(?:%3D|=)([0-9]{5,})')
           end as page_url
    from hotdeals h
    left join hotdeal_img_fix f on f.hotdeal_id = h.id
    where (h.expires_at is null or h.expires_at > now())
      and h.created_at > now() - interval '4 days'
      and h.mall in ('11번가', 'GS SHOP')
      and (h.img_url like '%cdn.jirum-alarm.com/community/%' or h.img_url like '%bbhd.kr/bbs/data/editor/%')
      and (f.hotdeal_id is null or (not f.done and f.req_id is null and f.tries < 3 and f.tried_at < now() - interval '30 minutes'))
    order by h.id desc
    limit 8
  loop
    continue when r.page_url is null;
    rid := net.http_get(
      url := r.page_url,
      headers := '{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36","Accept-Language":"ko-KR,ko;q=0.9"}'::jsonb,
      timeout_milliseconds := 15000);
    insert into hotdeal_img_fix (hotdeal_id, page_url, req_id, tries, old_img, tried_at)
    values (r.id, r.page_url, rid, 1, r.img_url, now())
    on conflict (hotdeal_id) do update
      set req_id = excluded.req_id, tries = hotdeal_img_fix.tries + 1, old_img = excluded.old_img,
          page_url = excluded.page_url, tried_at = now();
    queued := queued + 1;
  end loop;

  insert into ops_status (id, payload, updated_at)
  values ('hotdeal-img-fix', jsonb_build_object('fixed', fixed, 'failed', failed, 'queued', queued, 'at', now()), now())
  on conflict (id) do update set payload = excluded.payload, updated_at = excluded.updated_at;

  return jsonb_build_object('fixed', fixed, 'failed', failed, 'queued', queued);
end
$fn$;

revoke all on function public.hotdeal_img_fix_tick() from public, anon, authenticated;

select cron.unschedule('hotdeal-img-fix') where exists (select 1 from cron.job where jobname = 'hotdeal-img-fix');
select cron.schedule('hotdeal-img-fix', '3-59/10 * * * *', $$select public.hotdeal_img_fix_tick()$$);
