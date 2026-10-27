package com.wantsb.momcalendar;

// 앱 안 브라우저 창 (사장님 2026-10-27 「카페 본문을 들어가서 링크 누르면 또 이렇게 떠 제발 안뜨게해 동일한 창에서 띄우면 되지」)
//
// 왜: 바깥 주소를 크롬 Custom Tab 으로 열면, 그 안에서 누른 링크(naver.me 등)를 크롬이 다른 앱(NAVER)에 넘기려 해
//   「열기: Chrome / 삼성 브라우저 / NAVER」 선택창이 뜬다(기본 브라우저를 안 정한 폰). Custom Tab 은 이걸 끌 수 없다.
//   → 우리 웹뷰 창에서 연다. 그 안의 http(s) 이동은 전부 같은 창에서 이어지고 다른 앱으로 안 넘긴다.
// 규칙
//   · http(s): 같은 창(맘캘린더 주소면 이 창을 닫고 앱 본 화면에서)
//   · intent:  browser_fallback_url 이 있으면 그 주소를 같은 창에서. 없으면 손님이 직접 누른 것만 그 앱으로(패키지 지정 — 선택창 없음)
//   · 그 밖 스킴(naversearchapp: kakaotalk: tel: market: …): 손님이 직접 누른 것만 그 앱으로. 페이지가 저절로 여는 건 막는다
//   · 뒤로가기 = 앞 페이지, 첫 페이지면 창 닫기 · 새 창 열기(target=_blank)도 같은 창
//   · 로그인(네이버 등)은 이 창 안에서 한 번 하면 앱 쿠키에 남는다(CookieManager — 앱 전체 공유). 네이버 로그인 화면은 「로그인 상태 유지」를 미리 켠다(10-27)

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public class InAppBrowserActivity extends Activity {
    public static final String EXTRA_URL = "url";
    private WebView web;
    private TextView title, host;
    private ProgressBar bar;

    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        try { getWindow().setStatusBarColor(LinkRouter.BRAND); } catch (Exception ignored) { }
        String url = getIntent() == null ? null : getIntent().getStringExtra(EXTRA_URL);
        if (url == null || url.isEmpty()) { finish(); return; }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        // 위 막대: 닫기(X) · 제목 · 주소 — Custom Tab 과 같은 자리·같은 보라색
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setBackgroundColor(LinkRouter.BRAND);
        top.setPadding(dp(4), 0, dp(16), 0);
        TextView close = new TextView(this);
        close.setText("✕");
        close.setTextColor(Color.WHITE);
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        close.setGravity(Gravity.CENTER);
        close.setContentDescription("닫기");
        close.setOnClickListener(v -> finish());
        top.addView(close, new LinearLayout.LayoutParams(dp(52), dp(56)));
        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        title = new TextView(this);
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.END);
        host = new TextView(this);
        host.setTextColor(0xCCFFFFFF);
        host.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        host.setSingleLine(true);
        host.setEllipsize(TextUtils.TruncateAt.END);
        texts.addView(title);
        texts.addView(host);
        top.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        root.addView(top, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        web = new WebView(this);
        FrameLayout holder = new FrameLayout(this);
        holder.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(holder, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        // 안드로이드 15+(targetSdk 35+)는 화면 끝까지 그린다 → 위 막대가 상태 표시줄 밑으로, 아래가 내비 막대 밑으로 가지 않게 여백
        root.setOnApplyWindowInsetsListener((v, ins) -> {
            int t = 0, btm = 0;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets in = ins.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime());
                t = in.top; btm = in.bottom;
            } else { t = ins.getSystemWindowInsetTop(); btm = ins.getSystemWindowInsetBottom(); }
            v.setPadding(0, t, 0, btm);
            return ins;
        });
        root.setBackgroundColor(LinkRouter.BRAND);
        holder.setBackgroundColor(Color.WHITE);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportMultipleWindows(true);            // target=_blank → onCreateWindow 에서 같은 창으로
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return handle(view, req.getUrl(), req.hasGesture(), req.isForMainFrame());
            }
            @Override
            public void onPageStarted(WebView view, String u, Bitmap fav) { showHost(u); bar.setVisibility(View.VISIBLE); }
            @Override
            public void onPageFinished(WebView view, String u) {
                showHost(u); bar.setVisibility(View.GONE);
                try { CookieManager.getInstance().flush(); } catch (Exception ignored) { }
                // 네이버 로그인 화면이면 「로그인 상태 유지」를 미리 켠다 — 한 번 로그인하면 앱을 껐다 켜도 다시 안 묻게
                // (사장님 2026-10-27 「딱 한번만 로그인하면 두번다신 로그인 안하게」). 화면에 보이는 체크라 손님이 끌 수 있다
                try {
                    String h = Uri.parse(u).getHost();
                    if (h != null && h.equalsIgnoreCase("nid.naver.com"))
                        view.evaluateJavascript("(function(){var c=document.getElementById('loginStay')||document.querySelector('input[name=nvlong]');if(c&&!c.checked)c.click();})()", null);
                } catch (Exception ignored) { }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) { bar.setProgress(p); }
            @Override
            public void onReceivedTitle(WebView view, String t) { if (t != null && !t.startsWith("http")) title.setText(t); }
            @Override
            public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message resultMsg) {
                // 새 창 요청은 같은 창에서 연다: 임시 웹뷰로 주소만 받아 본 웹뷰에 넣는다
                WebView tmp = new WebView(view.getContext());
                tmp.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                        Uri u = r.getUrl();
                        if (!handle(web, u, true, true)) web.loadUrl(u.toString());
                        tmp.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport t = (WebView.WebViewTransport) resultMsg.obj;
                t.setWebView(tmp);
                resultMsg.sendToTarget();
                return true;
            }
        });
        showHost(url);
        web.loadUrl(url);
    }

    private void showHost(String u) {
        try { Uri x = Uri.parse(u); if (x.getHost() != null) host.setText(x.getHost()); } catch (Exception ignored) { }
    }

    /** true = 처리했다(웹뷰는 안 연다) · false = 같은 창에서 연다 */
    private boolean handle(WebView view, Uri u, boolean gesture, boolean mainFrame) {
        if (u == null || u.getScheme() == null) return true;
        String sc = u.getScheme().toLowerCase();
        if (sc.equals("http") || sc.equals("https")) {
            String h = u.getHost() == null ? "" : u.getHost().toLowerCase();
            if (mainFrame && (h.equals("momcalendar.com") || h.endsWith(".momcalendar.com"))) {
                // 우리 사이트 주소 — 이 창을 닫고 앱 본 화면에서
                Intent i = new Intent(this, MainActivity.class);
                i.setAction(Intent.ACTION_VIEW);
                i.setData(u);
                i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                try { startActivity(i); } catch (Exception ignored) { }
                finish();
                return true;
            }
            return false;   // 같은 창
        }
        if (sc.equals("intent")) {
            Intent i;
            try { i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME); } catch (Exception e) { return true; }
            String fb = i.getStringExtra("browser_fallback_url");
            if (fb != null && (fb.startsWith("https://") || fb.startsWith("http://"))) { view.loadUrl(fb); return true; }
            if (!gesture) return true;   // 페이지가 저절로 앱을 여는 건 막는다
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setComponent(null);
            i.setSelector(null);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { startActivity(i); } catch (Exception ignored) { }
            return true;
        }
        if (sc.equals("javascript") || sc.equals("about") || sc.equals("data") || sc.equals("blob")) return false;
        if (!gesture) return true;
        // tel: mailto: sms: kakaotalk: naversearchapp: market: … — 그 스킴을 받는 앱으로(브라우저가 아니라 선택창이 안 뜬다)
        Intent i = new Intent(Intent.ACTION_VIEW, u);
        i.addCategory(Intent.CATEGORY_BROWSABLE);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); } catch (Exception ignored) { }
        return true;
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { try { web.stopLoading(); web.destroy(); } catch (Exception ignored) { } }
        super.onDestroy();
    }
}
