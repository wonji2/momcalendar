-- 스레드 대기줄 — **예약 발행** 붙이기 (사장님 지시 2026-10-02 "승인하면 몇시 발행되게까지 예약 가능하게 해")
--   · publish_at 열 추가: 비어 있으면 "승인 즉시 다음 차례에", 값이 있으면 **그 시각 이후** 에 나간다.
--   · 승인 RPC 가 시각을 같이 받는다. 화면에서 시간을 고르면 그대로 들어온다(KST 로 해석).
--   · 발행기(threads-publish.js `due`)가 10분마다 돌면서 **승인됐고 시각이 지난 글**만 올린다.
-- 적용: supabase db query --file supabase/sql/threads_queue_schedule_78.sql --linked

alter table public.threads_queue add column if not exists publish_at timestamptz;
create index if not exists threads_queue_due_idx on public.threads_queue (status, publish_at);

-- ── 목록: 예약 시각을 같이 내려준다 (화면이 "10/2 15:00 예약" 으로 보여줄 수 있게)
create or replace function public.threads_queue_list()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(t order by t.ord, t.id desc), '[]'::jsonb) into v
  from (
    select q.id, q.variant, q.body, q.image_url, q.reply_text, q.status, q.reject_note, q.permalink,
           to_char(q.created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as created,
           to_char(q.publish_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as publish_kst,
           to_char(q.publish_at at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI') as publish_input,
           case q.status when 'pending' then 1 when 'rejected' then 2 when 'approved' then 3 else 4 end as ord
    from threads_queue q
    where q.status <> 'posted' or q.updated_at > now() - interval '7 days'
  ) t;
  return v;
end $$;

-- ── 승인(+예약). p_publish_at 은 'YYYY-MM-DDTHH:MM' (화면 datetime-local 값, **KST**). 비우면 즉시 대상.
drop function if exists public.threads_queue_approve(bigint);
create or replace function public.threads_queue_approve(p_id bigint, p_publish_at text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v record; v_at timestamptz;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  select * into v from threads_queue where id = p_id;
  if v.id is null then raise exception 'not found'; end if;
  if v.status = 'posted' then raise exception '이미 발행됐다' using errcode = '28000'; end if;
  -- 🔴 본문에 링크가 있으면 막는다 — 맘캘 규칙상 링크는 답글로만
  if v.body ~ 'https?://' then raise exception '본문에 링크가 있다 — 링크는 답글로만 간다'; end if;
  if coalesce(btrim(p_publish_at), '') <> '' then
    begin
      v_at := (replace(btrim(p_publish_at), 'T', ' '))::timestamp at time zone 'Asia/Seoul';
    exception when others then raise exception '예약 시각을 못 읽겠다: %', p_publish_at;
    end;
    if v_at < now() - interval '5 minutes' then raise exception '지난 시각으로는 예약할 수 없다'; end if;
  end if;
  update threads_queue
     set status = 'approved', reject_note = null, publish_at = v_at, updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'approved',
                            'publish_at', to_char(v_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI'));
end $$;

revoke all on function public.threads_queue_approve(bigint, text) from public, anon;
grant execute on function public.threads_queue_approve(bigint, text) to authenticated;
revoke all on function public.threads_queue_list() from public, anon;
grant execute on function public.threads_queue_list() to authenticated;
