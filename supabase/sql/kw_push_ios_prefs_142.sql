-- 아이폰 키워드 핫딜 발송 대상이 알림 종류 설정(prefs.hotdeal)을 읽지 않던 구멍 (2026-11-12)
--   안드(kw_push_targets_fcm)는 읽는데 아이폰만 빠져, 아이폰에서 「키워드 핫딜」을 꺼도 계속 갔다. 한 줄만 더한다.
create or replace function public.kw_push_targets_ios()
 returns table(device_id text, apns_token text, env text, hotdeal_id bigint, keyword text, title text, price integer, discount_rate integer, mall text, img_url text, unit_price integer, unit_label text)
 language sql stable security definer set search_path to 'public'
as $function$
  select distinct on (s.device_id, h.id)
         s.device_id, s.apns_token, s.env, h.id, k.keyword, h.title, h.price, h.discount_rate, h.mall, h.img_url, h.unit_price, h.unit_label
  from kw_push_subs k
  join push_ios s on s.device_id = k.device_id
  join hotdeals h on position(lower(k.keyword) in lower(h.title)) > 0
  where h.created_at > now() - interval '90 minutes'
    and h.price > 0 and h.img_url is not null
    and (h.expires_at is null or h.expires_at > now())
    and s.fail_count < 5
    and coalesce((s.prefs->>'hotdeal')::boolean, true)
    and not exists (select 1 from kw_push_log l where l.device_id = s.device_id and l.hotdeal_id = h.id)
    and (select count(*) from kw_push_log l2 where l2.device_id = s.device_id and l2.sent_at > now() - interval '24 hours') < 5
  order by s.device_id, h.id, length(k.keyword) desc;
$function$;
select position('hotdeal'')::boolean' in pg_get_functiondef('public.kw_push_targets_ios'::regproc)) > 0 as reads_pref,
       (select count(*) from public.kw_push_targets_ios()) as now_targets;
