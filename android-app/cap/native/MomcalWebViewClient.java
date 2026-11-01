package com.wantsb.momcalendar;

// Capacitor 의 웹뷰 처리기를 이어받아 「본 화면」 이동을 LinkRouter 로 보낸다 (2026-10-26)
//   Capacitor 공식 방식: BridgeWebViewClient 를 상속해 bridge.setWebViewClient 로 끼운다
//   (새 WebViewClient 로 갈아 끼우면 플러그인 주입이 깨진다 — forum.ionicframework.com/t/233105).
//   iframe 안 이동은 건드리지 않는다(광고·지도·영상 같은 화면 속 화면). 단 iframe 의 intent:·kakaotalk: 같은 앱 주소는 앱이 연다.
//   로그인 화면(카카오·네이버)은 앱 화면 안에서 열되 Capacitor allowNavigation 에는 넣지 않는다 —
//   넣으면 그 화면에도 앱 다리(위젯 번호 등)가 열린다(검증자 지적: Bridge.setAllowedOriginRules).

import android.app.Activity;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

public class MomcalWebViewClient extends BridgeWebViewClient {
    private final Bridge bridge;

    public MomcalWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        Activity act = bridge.getActivity();
        if (!request.isForMainFrame()) {
            if (!LinkRouter.isWeb(u) && !LinkRouter.isPageScheme(u) && act != null) return LinkRouter.route(act, view, u);
            return false;
        }
        if (LinkRouter.isOurSite(u)) return super.shouldOverrideUrlLoading(view, request);   // Capacitor 기본(우리 사이트 = 앱 안)
        if (LinkRouter.inApp(u) || LinkRouter.isPageScheme(u)) return false;                // 로그인 화면·data:/blob: — 앱 화면 안에서
        if (act != null) return LinkRouter.route(act, view, u);
        return true;
    }
}
