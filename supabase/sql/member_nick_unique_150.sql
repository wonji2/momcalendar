-- 닉네임 중복 막기 (사장님 2026-11-16 「다른 앱들은 중복 안 되게 랜덤 숫자 뒤에 붙여서 관리하는 이유가 있지 않을까」)
--   왜: 닉네임이 남에게 보이는 자리(?mycal 공유 「○○님이 공유한 공구」·당첨자 발표)에서 같은 이름이 둘이면 사칭·혼동이 생긴다.
--   방법: 손님이 직접 정한 이름(nick_custom)은 대소문자 무시하고 하나뿐이어야 한다. 겹치면 reason 'taken' + 뒤에 숫자 두 자리를 붙인 빈 이름(suggest)을 돌려준다.
--         카카오·네이버가 준 기본 이름(nick_custom 없음)은 실명이 많아 겹칠 수밖에 없으므로 여기서 막지 않는다.
create unique index if not exists members_nick_custom_uk on public.members (lower(nick_custom)) where nick_custom is not null and nick_custom <> '';

create or replace function public.member_set_nickname(p_token text, p_nick text)
returns json language plpgsql security definer set search_path to 'public' as $f$
declare kid text; v text; n int; c text; i int;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'reason', 'auth'); end if;
  v := btrim(coalesce(p_nick, ''));
  if char_length(v) < 2 or char_length(v) > 10 then return json_build_object('ok', false, 'reason', 'len'); end if;
  if v !~ '^[가-힣A-Za-z0-9]+$' then return json_build_object('ok', false, 'reason', 'chars'); end if;
  if lower(v) ~ '(맘캘|momcal|관리자|운영자|운영진|방장|매니저|스탭|스태프|admin|official|manager|staff)' then return json_build_object('ok', false, 'reason', 'reserved'); end if;
  if exists (select 1 from members where lower(nick_custom) = lower(v) and kakao_id <> kid) then
    for i in 1..30 loop
      c := left(v, 8) || (10 + floor(random() * 90))::int::text;
      exit when not exists (select 1 from members where lower(nick_custom) = lower(c));
      c := null;
    end loop;
    return json_build_object('ok', false, 'reason', 'taken', 'suggest', c);
  end if;
  begin
    update members set nick_custom = v, nick_changed_at = now(), updated_at = now() where kakao_id = kid;
    get diagnostics n = row_count;
  exception when unique_violation then
    return json_build_object('ok', false, 'reason', 'taken', 'suggest', null);
  end;
  if n = 0 then return json_build_object('ok', false, 'reason', 'auth'); end if;
  return json_build_object('ok', true, 'nickname', v);
end $f$;
revoke all on function public.member_set_nickname(text, text) from public;
grant execute on function public.member_set_nickname(text, text) to anon, authenticated;
