package com.wantsb.momcalendar.widget;

// 맘캘린더 홈화면 위젯 공통 (사장님 2026-10-24 "2랑 9 다 좋아 셋다 내가 써보고 결정하게 만들어줘")
//   데이터: Supabase RPC widget_feed() 한 번(≈3KB) → SharedPreferences 에 저장 → 위젯 다섯 개가 같이 쓴다.
//   새로고침: 30분(updatePeriodMillis) + 위젯을 누를 때. 탭·체크는 저장된 데이터로 바로 다시 그린다(네트워크 안 씀).
//   디자인 원칙: references/THREADS_REFERENCES.md — 상자 줄이기·여백과 글자 굵기로 위계·강조색 하나(분홍).
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import java.util.TimeZone;

public abstract class WidgetBase extends AppWidgetProvider {
    static final String FEED = "https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/rpc/widget_feed";
    static final String KEY = "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";
    static final String SITE = "https://momcalendar.com/";
    static final String PREF = "momcal_widget";
    static final String A_TAB = "com.wantsb.momcalendar.widget.TAB";
    static final String A_CHECK = "com.wantsb.momcalendar.widget.CHECK";
    static final String A_REFRESH = "com.wantsb.momcalendar.widget.REFRESH";
    static final String[] DOW = {"일", "월", "화", "수", "목", "금", "토"};

    protected abstract RemoteViews build(Context ctx, int id, JSONObject feed, SharedPreferences sp);

    // ── 그리기 ──
    void render(Context ctx, AppWidgetManager mgr, int[] ids) {
        SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        JSONObject feed;
        try { feed = new JSONObject(sp.getString("feed", "{}")); } catch (Exception e) { feed = new JSONObject(); }
        for (int id : ids) {
            try { mgr.updateAppWidget(id, build(ctx, id, feed, sp)); } catch (Exception ignored) { }
        }
    }
    void renderAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        render(ctx, mgr, mgr.getAppWidgetIds(new ComponentName(ctx, getClass())));
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        render(ctx, mgr, ids);
        final PendingResult pr = goAsync();
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try { if (fetch(app)) renderAll(app); } finally { pr.finish(); }
        }).start();
    }

    @Override
    public void onReceive(Context ctx, Intent it) {
        String a = it.getAction();
        SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        if (A_TAB.equals(a)) {
            sp.edit().putString("tab_" + it.getIntExtra("wid", 0), it.getStringExtra("tab")).apply();
            renderAll(ctx);
        } else if (A_CHECK.equals(a)) {
            String key = "," + it.getStringExtra("gid") + ",";
            String cur = sp.getString("chk", ",");
            sp.edit().putString("chk", cur.contains(key) ? cur.replace(key, ",") : cur + it.getStringExtra("gid") + ",").apply();
            renderAll(ctx);
        } else if (A_REFRESH.equals(a)) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            onUpdate(ctx, mgr, mgr.getAppWidgetIds(new ComponentName(ctx, getClass())));
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
            OutputStream os = c.getOutputStream(); os.write("{}".getBytes("UTF-8")); os.close();
            if (c.getResponseCode() != 200) return false;
            BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder(); String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            new JSONObject(sb.toString());   // 깨진 응답은 저장하지 않는다
            ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString("feed", sb.toString()).apply();
            return true;
        } catch (Exception e) { return false; } finally { if (c != null) c.disconnect(); }
    }

    // ── 도우미 ──
    static Calendar todayKst() {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul"));
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c;
    }
    static Calendar parse(String ymd) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul"));
        c.clear();
        c.set(Integer.parseInt(ymd.substring(0, 4)), Integer.parseInt(ymd.substring(5, 7)) - 1, Integer.parseInt(ymd.substring(8, 10)));
        return c;
    }
    static int dday(String ymd) {
        if (ymd == null || ymd.length() < 10) return 0;
        return (int) Math.round((parse(ymd).getTimeInMillis() - todayKst().getTimeInMillis()) / 86400000.0);
    }
    /** 「10.26. 월」 — 저널 앱 날짜 줄 꼴 */
    static String md(String ymd) {
        if (ymd == null || ymd.length() < 10) return "";
        Calendar c = parse(ymd);
        return (c.get(Calendar.MONTH) + 1) + "." + c.get(Calendar.DAY_OF_MONTH) + ". " + DOW[c.get(Calendar.DAY_OF_WEEK) - 1];
    }
    static String ddLabel(String open, String end) {
        int d = dday(open);
        if (d > 0) return "D-" + d;
        if (end != null && dday(end) == 0) return "오늘 마감";
        return "진행 중";
    }
    static String emoji(String major) {
        if (major == null) return "🛒";
        switch (major) {
            case "육아": return "🍼"; case "식품": return "🍽"; case "리빙": return "🏠"; case "건강": return "💊";
            case "뷰티": return "💄"; case "패션": return "👕"; case "가전": return "🔌"; case "인테리어": return "🛋";
            case "여행": return "✈"; case "반려동물": return "🐾"; default: return "🛒";
        }
    }
    static JSONArray arr(JSONObject f, String k) { JSONArray a = f.optJSONArray(k); return a == null ? new JSONArray() : a; }
    /** 오픈 전인 내 공구만(오픈순) — 「다음 오픈」 */
    static JSONArray upcoming(JSONObject f) {
        JSONArray all = arr(f, "mine"), out = new JSONArray();
        for (int i = 0; i < all.length(); i++) { JSONObject o = all.optJSONObject(i); if (o != null && dday(o.optString("open_date")) > 0) out.put(o); }
        if (out.length() == 0) return all;
        return out;
    }
    static boolean checked(SharedPreferences sp, String gid) { return sp.getString("chk", ",").contains("," + gid + ","); }

    // ── 누르면 ──
    static PendingIntent open(Context ctx, String url, int req) {
        Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        it.setClassName(ctx, "com.wantsb.momcalendar.LauncherActivity");
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, req, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static String searchUrl(String name) {
        try { return SITE + "?q=" + java.net.URLEncoder.encode(name, "UTF-8"); } catch (Exception e) { return SITE; }
    }
    PendingIntent broadcast(Context ctx, String action, int req, String k1, String v1, int wid) {
        Intent it = new Intent(ctx, getClass()).setAction(action).putExtra(k1, v1).putExtra("wid", wid);
        return PendingIntent.getBroadcast(ctx, req, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
