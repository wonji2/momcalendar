package com.wantsb.momcalendar.widget;

// 맘캘린더 홈화면 위젯 v5 — 나만의 캘린더 (사장님 2026-10-24)
//   "내찜보기 위젯 이어야지 나만의 캘린더 만드는거니까" · "옆에 이건 꼭 살려야지 트레이드마큰데" · "찜연결도 다 해놔"
//   · 옆 탭(전체·공구·핫딜·라방·세일) = 무엇을 / 위 단추(내 찜·전체) = 누구 것 — 고른 값은 폰에 저장(껐다 켜도 그대로)
//   · 데이터: Supabase RPC widget_feed(p_widget) 한 번 → SharedPreferences. 30분마다 + 앱을 연 뒤 30초·3분에 다시 받는다.
//   · 내 찜 연결: 「내 찜 연결하기」 줄만 위젯 번호(wid)를 ?wdid= 로 붙여 연다 → 사이트가 widget_bind(wid, mc_did) (supabase/sql/widget_feed_101.sql)
//   · 상시 공구는 서버에서 빠져 온다(gonggu.always). 핫딜은 할인율 표시 없이 많이 눌린 순.
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import com.wantsb.momcalendar.R;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;

public abstract class WidgetBase extends AppWidgetProvider {
    static final String FEED = "https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/rpc/widget_feed";
    static final String KEY = "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";
    static final String SITE = "https://momcalendar.com/";
    // 사이트 연결 코드(widgetBind)는 라이브 index.html 에 있다(2026-10-24 배포).
    static final String LINK_PAGE = "https://momcalendar.com/";
    static final String PREF = "momcal_widget";
    static final String A_TAB = "com.wantsb.momcalendar.widget.TAB";
    static final String A_MODE = "com.wantsb.momcalendar.widget.MODE";
    static final String A_PERIOD = "com.wantsb.momcalendar.widget.PERIOD";
    static final String A_REFRESH = "com.wantsb.momcalendar.widget.REFRESH";

    protected abstract RemoteViews build(Context ctx, int id, JSONObject feed, SharedPreferences sp);
    /** 큰 위젯은 목록(ListView)을 다시 읽게 한다 */
    protected void afterUpdate(AppWidgetManager mgr, int[] ids) { }

    static SharedPreferences sp(Context ctx) { return ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE); }
    static JSONObject feed(SharedPreferences sp) {
        try { return new JSONObject(sp.getString("feed", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** 이 폰 위젯 번호 — 처음 한 번 만들고 계속 쓴다 */
    public static String wid(Context ctx) {
        SharedPreferences sp = sp(ctx);
        String w = sp.getString("wid", null);
        if (w == null) {
            String abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            SecureRandom r = new SecureRandom(); StringBuilder b = new StringBuilder("w");
            for (int i = 0; i < 24; i++) b.append(abc.charAt(r.nextInt(abc.length())));
            w = b.toString(); sp.edit().putString("wid", w).apply();
        }
        return w;
    }

    /** 내 찜 / 전체 — 한 번 고르면 그대로(전역). 고른 적 없으면: 연결돼 있고 찜이 있으면 내 찜 */
    static String mode(SharedPreferences sp, JSONObject f) {
        String m = sp.getString("mode", null);
        if (m != null) return m;
        boolean has = f.optBoolean("linked") && (f.optJSONArray("wish") != null && f.optJSONArray("wish").length() > 0
                || f.optJSONArray("sale_wish") != null && f.optJSONArray("sale_wish").length() > 0);
        return has ? "mine" : "all";
    }
    static String tab(SharedPreferences sp, int id) { return sp.getString("tab_" + id, sp.getString("tab_last", "all")); }
    static boolean month(SharedPreferences sp) { return sp.getBoolean("month", false); }

    // ── 그리기 ──
    void render(Context ctx, AppWidgetManager mgr, int[] ids) {
        SharedPreferences sp = sp(ctx);
        JSONObject f = feed(sp);
        for (int id : ids) {
            try { mgr.updateAppWidget(id, build(ctx, id, f, sp)); } catch (Exception ignored) { }
        }
        afterUpdate(mgr, ids);
    }
    void renderAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        render(ctx, mgr, mgr.getAppWidgetIds(new ComponentName(ctx, getClass())));
    }
    /** 두 위젯 모두 다시 그린다(체크·토글 뒤) */
    static void redrawAll(Context ctx) {
        new CalLarge().renderAll(ctx);
        new CalMedium().renderAll(ctx);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        render(ctx, mgr, ids);
        final PendingResult pr = goAsync();
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try { if (fetch(app)) redrawAll(app); } finally { pr.finish(); }
        }).start();
    }

    @Override
    public void onReceive(Context ctx, Intent it) {
        String a = it.getAction();
        SharedPreferences sp = sp(ctx);
        if (A_TAB.equals(a)) {
            String t = it.getStringExtra("tab");
            sp.edit().putString("tab_" + it.getIntExtra("wid", 0), t).putString("tab_last", t).apply();
            redrawAll(ctx);
        } else if (A_MODE.equals(a)) {
            sp.edit().putString("mode", it.getStringExtra("mode")).apply();   // 사장님 "한번 내찜 눌러놨으면 … 그대로 유지"
            redrawAll(ctx);
        } else if (A_PERIOD.equals(a)) {
            sp.edit().putBoolean("month", !month(sp)).apply();
            redrawAll(ctx);
        } else if (A_REFRESH.equals(a)) {
            final PendingResult pr = goAsync();
            final Context app = ctx.getApplicationContext();
            new Thread(() -> { try { if (fetch(app)) redrawAll(app); } finally { pr.finish(); } }).start();
        } else {
            super.onReceive(ctx, it);
        }
    }

    // ── 데이터 ──
    static boolean fetch(Context ctx) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(FEED).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(8000); c.setReadTimeout(10000);
            c.setRequestProperty("apikey", KEY);
            c.setRequestProperty("Authorization", "Bearer " + KEY);
            c.setRequestProperty("Content-Type", "application/json");
            c.setDoOutput(true);
            OutputStream os = c.getOutputStream(); os.write(("{\"p_widget\":\"" + wid(ctx) + "\"}").getBytes("UTF-8")); os.close();
            if (c.getResponseCode() != 200) return false;
            BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder(); String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            new JSONObject(sb.toString());   // 깨진 응답은 저장하지 않는다
            sp(ctx).edit().putString("feed", sb.toString()).apply();
            return true;
        } catch (Exception e) { return false; } finally { if (c != null) c.disconnect(); }
    }

    /** 앱을 연 뒤 30초·3분에 다시 받는다 — 앱에서 찜하거나 방금 연결한 게 위젯에 바로 오게 */
    public static void refreshSoon(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long now = System.currentTimeMillis();
        long[] after = {30_000L, 180_000L};
        for (int i = 0; i < after.length; i++) {
            Intent it = new Intent(ctx, CalLarge.class).setAction(A_REFRESH);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 9900 + i, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.set(AlarmManager.RTC, now + after[i], pi);
        }
    }

    /** 주소에 위젯 번호를 붙인다(#앞에) */
    static String withWid(Context ctx, String url) {
        String hash = "";
        int h = url.indexOf('#');
        if (h >= 0) { hash = url.substring(h); url = url.substring(0, h); }
        return url + (url.contains("?") ? "&" : "?") + "wdid=" + wid(ctx) + hash;
    }
    static String linkUrl(Context ctx) { return LINK_PAGE + "?wlink=1&wdid=" + wid(ctx); }

    // ── 누르면 ──
    /** 앱(사이트) 열기 — WidgetAction 을 거쳐 위젯 번호를 붙이고 새로고침을 예약한다 */
    static PendingIntent open(Context ctx, String url, int req) {
        Intent it = new Intent(ctx, WidgetAction.class).setAction("open:" + req)
                .putExtra("kind", "open").putExtra("url", url)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, req, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static PendingIntent check(Context ctx, String key, int req) {
        Intent it = new Intent(ctx, WidgetAction.class).setAction("check:" + key)
                .putExtra("kind", "check").putExtra("key", key)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, req, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    PendingIntent broadcast(Context ctx, String action, int req, String k1, String v1, int wid) {
        Intent it = new Intent(ctx, getClass()).setAction(action).putExtra(k1, v1).putExtra("wid", wid);
        return PendingIntent.getBroadcast(ctx, req, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ── 옆 탭·위 단추 (두 위젯 공통) ──
    static final String[] TABS = {"all", "gonggu", "hot", "live", "sale"};
    static final int[] TAB_IDS = {R.id.w_t0, R.id.w_t1, R.id.w_t2, R.id.w_t3, R.id.w_t4};
    static final int[] TAB_BG = {R.drawable.w_tab_sand, R.drawable.w_tab_pink, R.drawable.w_tab_peach, R.drawable.w_tab_sky, R.drawable.w_tab_mint};
    static final int INK = 0xFF2E2A27, MUTE = 0xFFA79F97, TAB_OFF = 0xFF8A7F76;

    void paintChrome(Context ctx, RemoteViews v, int id, SharedPreferences sp, JSONObject f, int reqBase) {
        String tab = tab(sp, id), mode = mode(sp, f);
        int ti = 0;
        for (int i = 0; i < TABS.length; i++) {
            boolean on = TABS[i].equals(tab);
            if (on) ti = i;
            v.setTextColor(TAB_IDS[i], on ? INK : TAB_OFF);
            v.setOnClickPendingIntent(TAB_IDS[i], broadcast(ctx, A_TAB, reqBase + i, "tab", TABS[i], id));
        }
        v.setInt(R.id.w_edge, "setBackgroundResource", TAB_BG[ti]);   // 고른 탭 색이 패널 가장자리로 이어진다
        v.setTextViewText(R.id.w_title, Items.title(tab, month(sp)));
        v.setOnClickPendingIntent(R.id.w_title, broadcast(ctx, A_PERIOD, reqBase + 7, "x", "1", id));   // 제목 = 이번 주 ↔ 이번 달
        boolean mine = "mine".equals(mode);
        v.setInt(R.id.w_seg_mine, "setBackgroundResource", mine ? R.drawable.w_seg_on : 0);
        v.setInt(R.id.w_seg_all, "setBackgroundResource", mine ? 0 : R.drawable.w_seg_on);
        v.setTextColor(R.id.w_seg_mine, mine ? INK : MUTE);
        v.setTextColor(R.id.w_seg_all, mine ? MUTE : INK);
        v.setOnClickPendingIntent(R.id.w_seg_mine, broadcast(ctx, A_MODE, reqBase + 5, "mode", "mine", id));
        v.setOnClickPendingIntent(R.id.w_seg_all, broadcast(ctx, A_MODE, reqBase + 6, "mode", "all", id));
    }
}
