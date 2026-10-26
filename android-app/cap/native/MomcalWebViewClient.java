package com.wantsb.momcalendar;

// Capacitor 의 웹뷰 처리기를 이어받아 「본 화면」 이동만 LinkRouter 로 보낸다 (2026-10-26)
//   Capacitor 공식 방식: BridgeWebViewClient 를 상속해 bridge.setWebViewClient 로 끼운다
//   (새 WebViewClient 로 갈아 끼우면 플러그인 주입이 깨진다 — forum.ionicframework.com/t/233105).
//   iframe 안 이동은 건드리지 않는다(광고·지도·영상 같은 화면 속 화면).

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
        if (request.isForMainFrame() || !isWeb(u)) {
            Activity act = bridge.getActivity();
            if (act != null && LinkRouter.route(act, view, u)) return true;
        }
        if (!request.isForMainFrame()) return false;
        return super.shouldOverrideUrlLoading(view, request);
    }

    private static boolean isWeb(Uri u) {
        String s = u == null ? null : u.getScheme();
        return "http".equalsIgnoreCase(s) || "https".equalsIgnoreCase(s);
    }
}
