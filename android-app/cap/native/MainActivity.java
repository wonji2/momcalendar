package com.wantsb.momcalendar;

// 맘캘린더 안드로이드 앱 본 화면 (Capacitor 웹뷰, 2026-10-26 — TWA 를 웹뷰 앱으로 바꿈)
//   · 사이트 → 앱 다리 플러그인은 super.onCreate 보다 먼저 등록한다(capacitorjs.com/docs/android/custom-code)
//   · 링크 처리기(MomcalWebViewClient)를 끼운다 — 바깥 주소는 LinkRouter 가 연다
//   · momcalendar.com 주소로 앱이 열리면(카카오 로그인 뒤 돌아올 때·알림·위젯·카톡 링크) 그 주소를 앱 화면에 띄운다
//     Capacitor 는 앱을 연 주소를 화면에 띄워 주지 않는다(Bridge 는 늘 server.url 을 연다)

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MomcalLinkPlugin.class);
        super.onCreate(savedInstanceState);
        try { getWindow().getDecorView().setBackgroundColor(LinkRouter.BRAND); } catch (Exception ignored) { }
        if (bridge != null) bridge.setWebViewClient(new MomcalWebViewClient(bridge));
        openSiteUrl(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openSiteUrl(intent);
    }

    private void openSiteUrl(Intent intent) {
        if (intent == null || bridge == null) return;
        Uri d = intent.getData();
        if (d == null || !"https".equalsIgnoreCase(d.getScheme()) || d.getHost() == null) return;
        String h = d.getHost().toLowerCase();
        if (!(h.equals("momcalendar.com") || h.endsWith(".momcalendar.com"))) return;
        final String url = d.toString();
        bridge.getWebView().post(() -> bridge.getWebView().loadUrl(url));
    }
}
