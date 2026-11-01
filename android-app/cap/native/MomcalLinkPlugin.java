package com.wantsb.momcalendar;

// 사이트(자바스크립트) → 앱 기능 다리 (2026-10-26). 사이트는 Capacitor.Plugins.MomcalLink 로 부른다.
//   open(url)            바깥 링크 — LinkRouter 와 같은 길(누름 한 번에 한 번만)
//   share(title,text,url,files?)   공유 시트 — 웹뷰엔 navigator.share 가 없다(크롬·TWA 엔 있었다)
//   saveFile(name,mime,base64)     카드 이미지·캘린더 파일 저장 — 웹뷰는 a download·blob 을 못 받는다(capacitor 이슈 #5478)
//   widgetId()           홈화면 위젯 번호 — TWA 때는 앱이 주소에 붙였다(referrer 로 확인), 이제는 앱이 직접 알려 준다
//   pushReady()          알림 설정 파일(google-services.json)이 앱에 들어 있나 — 없으면 알림 켜기를 부르지 않는다
// 주의: 위젯 번호는 찜 열쇠다. 이 다리는 allowNavigation(=momcalendar.com 만) 화면에만 열린다 — 로그인 화면은 앱 안에서 열어도 allowNavigation 에 넣지 않는다(MomcalWebViewClient).

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import org.json.JSONObject;

@CapacitorPlugin(name = "MomcalLink")
public class MomcalLinkPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        Activity act = getActivity();
        if (url == null || act == null) { call.reject("no url"); return; }
        Uri u = Uri.parse(url);
        act.runOnUiThread(() -> {
            if (!LinkRouter.route(act, getBridge().getWebView(), u)) getBridge().getWebView().loadUrl(url);   // 우리 사이트 주소면 앱 화면에서
            call.resolve();
        });
    }

    @PluginMethod
    public void share(PluginCall call) {
        Activity act = getActivity();
        if (act == null) { call.reject("no activity"); return; }
        String title = call.getString("title", "맘캘린더");
        String text = call.getString("text", "");
        String url = call.getString("url", "");
        String body = (text == null ? "" : text) + (url == null || url.isEmpty() ? "" : ((text == null || text.isEmpty()) ? "" : "\n") + url);
        try {
            ArrayList<Uri> files = new ArrayList<>();
            JSArray arr = call.getArray("files");
            if (arr != null) {
                for (int k = 0; k < arr.length(); k++) {
                    JSONObject f = arr.getJSONObject(k);
                    File dir = new File(act.getCacheDir(), "share");
                    dir.mkdirs();
                    File out = new File(dir, safeName(f.optString("name", "momcal.png")));
                    try (FileOutputStream os = new FileOutputStream(out)) { os.write(Base64.decode(f.optString("base64", ""), Base64.DEFAULT)); }
                    files.add(FileProvider.getUriForFile(act, act.getPackageName() + ".fileprovider", out));
                }
            }
            Intent send;
            if (files.isEmpty()) {
                send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
            } else {
                send = new Intent(files.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
                send.setType("image/*");
                if (files.size() == 1) send.putExtra(Intent.EXTRA_STREAM, files.get(0));
                else send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, files);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            if (!body.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, body);
            act.startActivity(Intent.createChooser(send, title));
            call.resolve();
        } catch (Exception e) {
            call.reject("share failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        Activity act = getActivity();
        String name = safeName(call.getString("name", "momcal"));
        String mime = call.getString("mime", "application/octet-stream");
        if (mime != null && mime.contains(";")) mime = mime.substring(0, mime.indexOf(';')).trim();   // text/calendar;charset=utf-8 → text/calendar (캘린더 앱 필터와 맞게 — 검증자 지적)
        String b64 = call.getString("base64", "");
        if (act == null || b64 == null || b64.isEmpty()) { call.reject("empty"); return; }
        try {
            byte[] data = Base64.decode(b64, Base64.DEFAULT);
            boolean image = mime != null && mime.startsWith("image/");
            Uri saved = null;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = act.getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/맘캘린더");
                Uri col = image ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                saved = cr.insert(col, v);
                if (saved == null) throw new Exception("insert null");
                try (OutputStream os = cr.openOutputStream(saved)) { os.write(data); }
            } else {
                // 안드로이드 9 이하: 앱 전용 폴더에 저장(권한 없이 되는 곳)
                File dir = act.getExternalFilesDir(image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS);
                File out = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(out)) { os.write(data); }
                saved = FileProvider.getUriForFile(act, act.getPackageName() + ".fileprovider", out);
            }
            JSObject r = new JSObject();
            r.put("uri", saved.toString());
            // 캘린더 파일은 바로 열어 캘린더 앱이 받게 한다(크롬에서 받은 뒤 누르던 것과 같은 결과)
            if (call.getBoolean("open", false)) {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(saved, mime);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                try { act.startActivity(i); r.put("opened", true); } catch (Exception e) { r.put("opened", false); }
            }
            call.resolve(r);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void widgetId(PluginCall call) {
        JSObject r = new JSObject();
        try {
            r.put("id", com.wantsb.momcalendar.widget.WidgetBase.wid(getContext()));
            com.wantsb.momcalendar.widget.WidgetBase.refreshSoon(getContext());
        } catch (Throwable t) { r.put("id", ""); }
        call.resolve(r);
    }

    // 강제 종료 기록 시험용 — 시험용 빌드(웹뷰 디버깅 켬)에서만. 출시판은 거절한다
    @PluginMethod
    public void crashTest(PluginCall call) {
        boolean dbg = false;
        try { dbg = getBridge().getConfig().isWebContentsDebuggingEnabled(); } catch (Throwable ignored) { }
        if (!dbg) { call.reject("not allowed"); return; }
        call.resolve();
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> { throw new RuntimeException("momcal crashTest (e2e)"); }, 300);
    }

    @PluginMethod
    public void crashStatus(PluginCall call) {
        android.content.SharedPreferences sp = getContext().getSharedPreferences(CrashReporter.PREF, android.content.Context.MODE_PRIVATE);
        JSObject r = new JSObject();
        r.put("pending", sp.getString("trace", null) != null);
        r.put("sentAt", sp.getLong("sentAt", 0));
        call.resolve(r);
    }

    @PluginMethod
    public void pushReady(PluginCall call) {
        JSObject r = new JSObject();
        int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        r.put("ready", id != 0);
        call.resolve(r);
    }

    private static String safeName(String s) {
        if (s == null || s.isEmpty()) return "momcal";
        return s.replaceAll("[\\\\/:*?\"<>|]", "_");
    }
}
