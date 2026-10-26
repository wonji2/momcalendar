package com.wantsb.momcalendar;

// 앱 강제 종료 기록 (2026-10-26 사장님 「아직 못 한 건 다 해」 — references/SELF_QA.md)
//   손님 폰에서 앱이 죽으면 그 순간의 오류(스택)를 폰에 적어 두고, 다음에 앱을 켤 때 우리 서버(events, event_type=app_crash)로 보낸다.
//   웹 쪽 자바스크립트 오류는 이미 events js_error 로 모인다 — 이것은 그 바깥(자바·앱 코드)이 죽는 경우.
//   보내는 곳은 사이트와 같은 공개 키·같은 표(손님용 insert 만 열려 있다). 외부 SDK(Crashlytics) 없이 — 데이터가 우리 표에 바로 쌓여 error_radar 가 본다.
//   보낸 뒤 지운다. 못 보내면(인터넷 없음) 다음에 켤 때 다시.

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public final class CrashReporter {
    private CrashReporter() {}
    static final String PREF = "mc_crash";
    static final String URL_EVENTS = "https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/events";
    static final String ANON = "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";   // 사이트에 공개된 손님용 키(index.html 과 같다)

    /** 앱이 켜질 때 한 번 — 기존 처리기(안드로이드 기본 「앱이 중지됨」)는 그대로 이어 부른다 */
    public static void install(Context ctx) {
        final Context app = ctx.getApplicationContext();
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try {
                StringWriter sw = new StringWriter();
                e.printStackTrace(new PrintWriter(sw));
                String s = sw.toString();
                if (s.length() > 3000) s = s.substring(0, 3000);
                app.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
                    .putString("trace", s).putString("thread", t.getName()).putLong("at", System.currentTimeMillis()).commit();   // commit: 죽기 전에 써야 한다
            } catch (Throwable ignored) { }
            if (prev != null) prev.uncaughtException(t, e);
        });
    }

    /** 지난번에 죽은 기록이 있으면 서버로 보낸다(백그라운드) */
    public static void sendPending(Context ctx) {
        final Context app = ctx.getApplicationContext();
        final SharedPreferences sp = app.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        final String trace = sp.getString("trace", null);
        if (trace == null) return;
        new Thread(() -> {
            try {
                String ver = "?";
                try { ver = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName; } catch (Exception ignored) { }
                JSONObject d = new JSONObject();
                d.put("plat", "android");
                d.put("ver", ver);
                d.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                d.put("sdk", Build.VERSION.SDK_INT);
                d.put("at", sp.getLong("at", 0));
                d.put("thread", sp.getString("thread", ""));
                d.put("trace", trace);
                JSONObject body = new JSONObject();
                body.put("event_type", "app_crash");
                body.put("event_data", d.toString());
                HttpURLConnection c = (HttpURLConnection) new URL(URL_EVENTS).openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(8000); c.setReadTimeout(8000);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("apikey", ANON);
                c.setRequestProperty("Authorization", "Bearer " + ANON);
                c.setRequestProperty("Prefer", "return=minimal");
                try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                int code = c.getResponseCode();
                c.disconnect();
                if (code >= 200 && code < 300) sp.edit().remove("trace").remove("thread").remove("at").putLong("sentAt", System.currentTimeMillis()).apply();
            } catch (Throwable ignored) { }
        }).start();
    }
}
