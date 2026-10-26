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
        // 상태바·아래 막대 자리(웹뷰 바깥 여백)를 보라로 — TWA 때와 같은 색. 없으면 연회색 바탕에 흰 아이콘이라 시계가 안 보였다(e2e 01_home.png)
        try { android.view.View p = (android.view.View) bridge.getWebView().getParent(); if (p != null) p.setBackgroundColor(LinkRouter.BRAND); } catch (Exception ignored) { }
        //   웹뷰 140 미만은 Capacitor 가 웹뷰 자체에 여백(padding)을 준다 → 그 여백은 웹뷰 바탕색으로 칠해진다(SystemBars 문서). 사이트 본문은 자기 바탕색을 칠하므로 안 바뀐다
        try { bridge.getWebView().setBackgroundColor(LinkRouter.BRAND); } catch (Exception ignored) { }
        // 처음 켤 때의 주소는 BridgeActivity.load() 가 onNewIntent(getIntent()) 로 넘겨준다 → 여기서 또 부르면 두 번 연다(검증자 지적)
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
