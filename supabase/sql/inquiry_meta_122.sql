-- 오류 제보에 화면 캡처·기기 정보 자동 첨부 (사장님 2026-10-26 「캡처해서 동그라미 치는 수고 없이」 — 스레드 댓글 참고, references/SELF_QA.md)
--   meta  : 환경(웹·카톡·바로가기·안드 앱·아이폰 앱)·기기·화면 크기·주소·버전·로그인·알림 권한·최근 자바스크립트 오류
--   shot  : 보낼 때 보던 화면(JPEG data URL, 사이트가 줄여서 보낸다 — 상한 300KB)
--   한도(LONG_TERM_REGISTER): 제보는 하루 몇 건, 건당 ≤300KB → 1년 수십 MB 안쪽. 같은 기기 하루 5건 제한은 그대로.
alter table public.inquiries add column if not exists meta jsonb;
alter table public.inquiries add column if not exists shot text;

drop function if exists public.submit_inquiry(text, text, text, text, text, text);
create or replace function public.submit_inquiry(p_kind text, p_content text, p_contact text default null, p_device text default null,
                                                 p_page text default null, p_token text default null,
                                                 p_meta jsonb default null, p_shot text default null)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare kid text; nick text; n int; shot text;
begin
  if p_content is null or length(btrim(p_content)) < 5 then
    return json_build_object('ok', false, 'error', 'too_short');
  end if;
  if length(p_content) > 2000 then
    return json_build_object('ok', false, 'error', 'too_long');
  end if;

  -- 로그인했으면 누가 보냈는지 같이 남긴다(답변하기 쉬우라고)
  if p_token is not null then
    kid := _member_from_token(p_token);
    if kid is not null then select nickname into nick from members where kakao_id = kid; end if;
  end if;

  -- 도배 방지: 같은 기기에서 하루 5건까지
  select count(*) into n from inquiries
   where device_id = p_device and created_at > now() - interval '1 day';
  if p_device is not null and n >= 5 then
    return json_build_object('ok', false, 'error', 'too_many');
  end if;

  -- 화면 캡처: JPEG/PNG data URL 이고 300KB 이하일 때만 받는다(그 밖엔 버리고 글은 받는다)
  shot := case when p_shot ~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$' and length(p_shot) <= 300000 then p_shot else null end;

  insert into inquiries (kind, content, contact, kakao_id, nickname, device_id, page_url, user_agent, status, meta, shot)
  values (coalesce(nullif(btrim(p_kind),''), 'etc'), btrim(p_content), nullif(btrim(p_contact),''),
          kid, nick, p_device, left(coalesce(p_page,''), 300), left(coalesce(p_meta->>'ua',''), 300), 'new',
          case when p_meta is not null and length(p_meta::text) <= 8000 then p_meta else null end, shot);

  return json_build_object('ok', true, 'shot', shot is not null);
end $function$;
revoke all on function public.submit_inquiry(text, text, text, text, text, text, jsonb, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text, text, text, jsonb, text) to anon, authenticated, service_role;
