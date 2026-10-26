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
        fitSystemBars();
        makeNotificationChannel();
        // 처음 켤 때의 주소는 BridgeActivity.load() 가 onNewIntent(getIntent()) 로 넘겨준다 → 여기서 또 부르면 두 번 연다(검증자 지적)
    }

    // 상태바·아래 막대·키보드 자리를 웹뷰 바깥으로 비우고 그 자리를 보라로 칠한다 (TWA 때와 같은 모양)
    //   안드로이드 15+(targetSdk 35+)는 화면을 상태바 밑까지 강제로 넓힌다(edge-to-edge). 사이트는 viewport-fit=cover 가 아니라
    //   그 자리를 비워야 한다. Capacitor 의 insetsHandling 은 웹뷰 140 미만에서 웹뷰 padding 으로 처리해 사이트 바탕이 비쳐
    //   연회색에 흰 아이콘이 됐다(e2e 02_home_loaded.png) → 설정은 disable 로 두고 여기서 여백(margin)으로 직접 한다(SystemBars 문서의 disable 안내).
    private void fitSystemBars() {
        if (bridge == null) return;
        final android.view.View web = bridge.getWebView();
        try { android.view.View p = (android.view.View) web.getParent(); if (p != null) p.setBackgroundColor(LinkRouter.BRAND); } catch (Exception ignored) { }
        try {
            androidx.core.view.WindowInsetsControllerCompat c = new androidx.core.view.WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
            c.setAppearanceLightStatusBars(false);       // 보라 바탕에 흰 아이콘
            c.setAppearanceLightNavigationBars(false);
        } catch (Exception ignored) { }
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() | androidx.core.view.WindowInsetsCompat.Type.displayCutout());
            androidx.core.graphics.Insets ime = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime());
            android.view.ViewGroup.MarginLayoutParams lp = (android.view.ViewGroup.MarginLayoutParams) v.getLayoutParams();
            lp.setMargins(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));   // 키보드가 올라오면 입력칸이 가려지지 않게
            v.setLayoutParams(lp);
            return androidx.core.view.WindowInsetsCompat.CONSUMED;
        });
        androidx.core.view.ViewCompat.requestApplyInsets(web);
    }

    // 알림 종류(채널) 「맘캘린더 알림」 — 중요도 높음 = 화면 위에 팝업으로 뜬다(웹 알림·TWA 때와 같게)
    //   채널이 없으면 FCM 이 「기타(fcm_fallback)」 보통 등급으로 넣어 팝업 없이 알림창에만 조용히 들어갔다(2026-10-26 e2e: importance=3)
    //   안드로이드 공식: 팝업(헤드업)은 IMPORTANCE_HIGH 채널만 — developer.android.com/develop/ui/views/notifications/channels
    static final String CHANNEL = "momcal_default";
    private void makeNotificationChannel() {
        if (android.os.Build.VERSION.SDK_INT < 26) return;
        try {
            android.app.NotificationChannel ch = new android.app.NotificationChannel(CHANNEL, "맘캘린더 알림", android.app.NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("찜한 공구 오픈·마감, 세일, 라방 알림");
            ch.enableVibration(true);
            ch.setShowBadge(true);
            getSystemService(android.app.NotificationManager.class).createNotificationChannel(ch);
        } catch (Exception ignored) { }
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
