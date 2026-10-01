-- 승인형 발행 대기줄 (사장님 지시 2026-10-01 "수정저장 바로 가능하게 내 승인 반려-반려시 수정방향 지시까지 바로 가능하게 구현해봐")
--
-- 왜
--   스레드 글은 **한 번 올리면 우리가 못 지운다**(API 권한 없음 · 브라우저 세션 없음 — HANDOFF 2026-10-01).
--   그래서 「올린 뒤 고치기」가 불가능하다. 올리기 전에 사장님이 보고 승인한 것만 나가야 한다.
--
-- 흐름
--   ① 내가 시안을 넣는다      node sns-automation/src/threads-queue.js --add ...   (CLI=postgres 로만 쓴다)
--   ② 사장님이 폰에서 고른다  https://momcalendar.com/approve.html  (관리자 로그인)
--        · 수정 저장 → 본문을 고쳐 저장하고 **다시 승인 대기**로 돌아간다
--        · 승인      → approved. 발행기가 집어간다
--        · 반려      → rejected + 수정방향(reject_note). 다음 세션이 그걸 읽고 다시 짠다
--   ③ 발행기가 approved 만 올린다 → posted (permalink 기록)
--
-- ⚠ anon 은 표도 함수도 못 본다(기본 권한 회수 + 명시 grant 는 authenticated 에만). 손님용 아님.

create table if not exists public.threads_queue (
  id          bigint generated always as identity primary key,
  variant     text not null,                      -- A1…A8 · open_list · story …
  body        text not null,
  image_url   text,
  reply_text  text,
  status      text not null default 'pending',    -- pending · approved · rejected · posted
  reject_note text,
  posted_id   text,
  permalink   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint threads_queue_status_chk check (status in ('pending','approved','rejected','posted'))
);
create index if not exists threads_queue_status_idx on public.threads_queue (status, id desc);
alter table public.threads_queue enable row level security;
revoke all on table public.threads_queue from public, anon, authenticated;

-- ── 목록 (관리자만)
create or replace function public.threads_queue_list()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(t order by t.ord, t.id desc), '[]'::jsonb) into v
  from (
    select q.id, q.variant, q.body, q.image_url, q.reply_text, q.status, q.reject_note, q.permalink,
           to_char(q.created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as created,
           case q.status when 'pending' then 1 when 'rejected' then 2 when 'approved' then 3 else 4 end as ord
    from threads_queue q
    where q.status <> 'posted' or q.updated_at > now() - interval '7 days'
  ) t;
  return v;
end $$;

-- ── 수정 저장 — 🔴 고치면 **다시 승인 대기**로 돌아간다 (사장님 화면 "초안 수정 시 다시 승인 대기")
create or replace function public.threads_queue_save(p_id bigint, p_body text, p_image_url text, p_reply text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_st text;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  select status into v_st from threads_queue where id = p_id;
  if v_st is null then raise exception 'not found'; end if;
  if v_st = 'posted' then raise exception '이미 발행된 글은 고칠 수 없다' using errcode = '28000'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception '본문이 비었다'; end if;
  update threads_queue
     set body = p_body, image_url = nullif(btrim(coalesce(p_image_url,'')), ''),
         reply_text = nullif(btrim(coalesce(p_reply,'')), ''),
         status = 'pending', reject_note = null, updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

-- ── 승인
create or replace function public.threads_queue_approve(p_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v record;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  select * into v from threads_queue where id = p_id;
  if v.id is null then raise exception 'not found'; end if;
  if v.status = 'posted' then raise exception '이미 발행됐다' using errcode = '28000'; end if;
  -- 🔴 본문에 링크가 있으면 막는다 — 맘캘 규칙상 링크는 답글로만 (threads-manual.js 와 같은 가드)
  if v.body ~ 'https?://' then raise exception '본문에 링크가 있다 — 링크는 답글로만 간다'; end if;
  update threads_queue set status = 'approved', reject_note = null, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'approved');
end $$;

-- ── 반려 + 수정방향
create or replace function public.threads_queue_reject(p_id bigint, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_st text;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  select status into v_st from threads_queue where id = p_id;
  if v_st is null then raise exception 'not found'; end if;
  if v_st = 'posted' then raise exception '이미 발행됐다' using errcode = '28000'; end if;
  update threads_queue
     set status = 'rejected', reject_note = nullif(btrim(coalesce(p_note,'')), ''), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'rejected');
end $$;

revoke all on function public.threads_queue_list() from public, anon;
revoke all on function public.threads_queue_save(bigint, text, text, text) from public, anon;
revoke all on function public.threads_queue_approve(bigint) from public, anon;
revoke all on function public.threads_queue_reject(bigint, text) from public, anon;
grant execute on function public.threads_queue_list() to authenticated;
grant execute on function public.threads_queue_save(bigint, text, text, text) to authenticated;
grant execute on function public.threads_queue_approve(bigint) to authenticated;
grant execute on function public.threads_queue_reject(bigint, text) to authenticated;

select 'threads_queue 준비됨' as 결과, count(*) as 줄수 from public.threads_queue;
