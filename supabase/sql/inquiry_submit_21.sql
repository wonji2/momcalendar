-- 사이트에서 직접 오류/건의를 받는 창구.
-- inquiries 테이블은 방문자가 직접 INSERT 못 하게 잠가두고, 이 함수로만 넣는다
-- (스팸·대량 등록 방지: 길이 제한 + 기기당 하루 5건).

create or replace function submit_inquiry(
  p_kind text, p_content text, p_contact text default null,
  p_device text default null, p_page text default null, p_token text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare kid text; nick text; n int;
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

  insert into inquiries (kind, content, contact, kakao_id, nickname, device_id, page_url, status)
  values (coalesce(nullif(btrim(p_kind),''), 'etc'), btrim(p_content), nullif(btrim(p_contact),''),
          kid, nick, p_device, left(coalesce(p_page,''), 300), 'new');

  return json_build_object('ok', true);
end $$;

revoke all on function submit_inquiry(text,text,text,text,text,text) from public;
grant execute on function submit_inquiry(text,text,text,text,text,text) to anon, authenticated;

select 'ok' as result;
