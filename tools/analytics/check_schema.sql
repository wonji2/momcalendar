select 'analytics_daily' t, count(*) n from information_schema.columns where table_schema='public' and table_name='analytics_daily'
union all select 'analytics_meta', count(*) from information_schema.columns where table_schema='public' and table_name='analytics_meta'
union all select 'analytics_manual', count(*) from information_schema.columns where table_schema='public' and table_name='analytics_manual'
union all select 'rpc', count(*) from pg_proc where proname='analytics_overview';
-- 기대: 5 / 6 / 4 / 1
