package com.wantsb.momcalendar;

// 바깥 주소를 어디서 열지 정하는 곳 (2026-10-26)
//
// 왜 앱 코드가 여나: 잘 되는 한국 웹뷰 앱은 링크를 페이지가 아니라 앱이 연다.
//   · 카카오 하이브리드 가이드 https://developers.kakao.com/docs/latest/ko/javascript/hybrid
//     intent: → Intent.parseUri → 앱 실행, 없으면 browser_fallback_url
//   · 토스페이먼츠 https://www.tosspayments.com/blog/articles/dev-4  앱이 없으면 market://, 안드로이드 11+ 는 <queries>
//   · 안드로이드 공식 https://developer.android.com/develop/ui/views/layout/webapps/in-app-browsing-embedded-web
//     남의 사이트는 Custom Tabs(기본 브라우저와 쿠키 공유)
// 선택창을 안 띄우는 법: 여는 앱(패키지)을 정해서 startActivity 한다. 정하지 않은 ACTION_VIEW 는
//   받을 앱이 여럿이면 안드로이드가 고르게 한다(https://developer.android.com/training/basics/intents/sending).

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.webkit.WebView;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;
import java.util.Arrays;
import java.util.List;

public final class LinkRouter {
    private LinkRouter() {}

    static final String NAVER_APP = "com.nhn.android.search";
    static final String KAKAOTALK = "com.kakao.talk";
    static final String INSTAGRAM = "com.instagram.android";
    static final String PLAY = "com.android.vending";
    // 기본 브라우저를 정하지 않은 폰에서 Custom Tab 을 맡길 브라우저(앞이 우선) — 크롬·삼성 인터넷·엣지·웨일
    static final List<String> BROWSERS = Arrays.asList("com.android.chrome", "com.sec.android.app.sbrowser", "com.microsoft.emmx", "com.naver.whale");
    static final int BRAND = 0xFF602090;

    private static String lastUrl = "";
    private static long lastAt = 0;

    static boolean isWeb(Uri u) {
        String s = u == null ? null : u.getScheme();
        return "http".equalsIgnoreCase(s) || "https".equalsIgnoreCase(s);
    }

    /** 페이지 안에서 쓰는 주소(data: blob: about: javascript:) — 웹뷰에 맡긴다 */
    static boolean isPageScheme(Uri u) {
        String s = u == null || u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        return s.equals("data") || s.equals("blob") || s.equals("about") || s.equals("javascript");
    }

    static boolean isOurSite(Uri u) {
        if (u == null || u.getHost() == null || !"https".equalsIgnoreCase(u.getScheme())) return false;
        String h = u.getHost().toLowerCase();
        return h.equals("momcalendar.com") || h.endsWith(".momcalendar.com");
    }

    /** 우리 앱 화면 안에서 그대로 여는 주소인가 — 우리 사이트와 로그인 화면(카카오·네이버)만 */
    public static boolean inApp(Uri u) {
        if (isOurSite(u)) return true;
        if (u == null || u.getHost() == null || !"https".equalsIgnoreCase(u.getScheme())) return false;
        String h = u.getHost().toLowerCase();
        // 선물하기·스토어·단톡방·채널은 밖으로(앱 안에 갇히지 않게) — 로그인 두 곳만 안에서
        return h.equals("kauth.kakao.com") || h.equals("accounts.kakao.com") || h.equals("nid.naver.com");
    }

    /** 이 주소를 앱 밖에서 처리했으면 true. 앱 화면 안에서 열 주소면 false. */
    public static boolean route(Activity act, WebView web, Uri u) {
        if (u == null || u.getScheme() == null) return false;
        if (isPageScheme(u) || inApp(u)) return false;
        String sc = u.getScheme().toLowerCase();
        // http 로 온 우리 사이트·로그인 주소는 https 로 바꿔 앱 안에서(평문 통신은 막혀 있다)
        if (sc.equals("http")) {
            Uri s = u.buildUpon().scheme("https").build();
            if (inApp(s)) { if (web != null) web.post(() -> web.loadUrl(s.toString())); return true; }
        }
        String key = u.toString();
        long now = System.currentTimeMillis();
        if (key.equals(lastUrl) && now - lastAt < 1500) return true;   // 같은 누름이 두 번 들어와도 한 번만 연다
        lastUrl = key; lastAt = now;
        try {
            if (sc.equals("intent")) { openIntentUri(act, web, key); return true; }
            if (sc.equals("http") || sc.equals("https")) { openWeb(act, u); return true; }
            if (sc.equals("market")) { openMarket(act, u); return true; }
            // kakaotalk: kakaolink: naversearchapp: tel: mailto: sms: 등 — 그 스킴의 앱으로
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (ActivityNotFoundException e) {
            // 받을 앱이 없다 — 화면은 그대로 둔다(손님은 다른 버튼을 누를 수 있다)
        } catch (Exception ignored) { }
        return true;
    }

    /** 바깥 https: 네이버·카톡·인스타는 그 앱이 있으면 그 앱으로, 아니면 브라우저의 Custom Tab */
    static void openWeb(Activity act, Uri u) {
        String h = u.getHost() == null ? "" : u.getHost().toLowerCase();
        PackageManager pm = act.getPackageManager();
        if ((h.equals("naver.me") || h.equals("naver.com") || h.endsWith(".naver.com")) && installed(pm, NAVER_APP)) {
            // 네이버 앱 인앱브라우저(로그인이 살아 있다) — 패키지를 정해서 선택창 없이
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("naversearchapp://inappbrowser?url=" + Uri.encode(u.toString()) + "&target=new&version=6"));
            i.setPackage(NAVER_APP);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { act.startActivity(i); return; } catch (Exception ignored) { }
        }
        if ((h.equals("open.kakao.com") || h.equals("pf.kakao.com") || h.equals("qr.kakao.com")) && installed(pm, KAKAOTALK)) {
            if (startIn(act, u, KAKAOTALK)) return;
        }
        if ((h.equals("instagram.com") || h.endsWith(".instagram.com")) && installed(pm, INSTAGRAM)) {
            if (startIn(act, u, INSTAGRAM)) return;
        }
        customTab(act, u);
    }

    static boolean startIn(Activity act, Uri u, String pkg) {
        Intent i = new Intent(Intent.ACTION_VIEW, u);
        i.setPackage(pkg);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { act.startActivity(i); return true; } catch (Exception e) { return false; }
    }

    /** Custom Tab 을 여는 브라우저를 반드시 정한다 — 정하지 않으면 기본 브라우저가 없는 폰에서 선택창이 뜬다(검증자 지적) */
    static String browserPackage(Activity act) {
        String pkg = null;
        try { pkg = CustomTabsClient.getPackageName(act, null); } catch (Exception ignored) { }   // 기본 브라우저가 Custom Tab 을 지원하면 그것
        if (pkg == null) { try { pkg = CustomTabsClient.getPackageName(act, BROWSERS, true); } catch (Exception ignored) { } }   // 없으면 목록 순서대로
        if (pkg == null) pkg = defaultBrowser(act.getPackageManager());
        return pkg;
    }

    static void customTab(Activity act, Uri u) {
        String pkg = browserPackage(act);
        try {
            CustomTabsIntent ct = new CustomTabsIntent.Builder()
                .setShowTitle(true)
                .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder().setToolbarColor(BRAND).build())
                .build();
            if (pkg != null) ct.intent.setPackage(pkg);
            ct.launchUrl(act, u);
            return;
        } catch (Exception ignored) { }
        Intent i = new Intent(Intent.ACTION_VIEW, u);
        i.addCategory(Intent.CATEGORY_BROWSABLE);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (pkg != null) i.setPackage(pkg);
        try { act.startActivity(i); } catch (Exception ignored) { }
    }

    static String defaultBrowser(PackageManager pm) {
        try {
            ResolveInfo ri = pm.resolveActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")), PackageManager.MATCH_DEFAULT_ONLY);
            if (ri != null && ri.activityInfo != null && !"android".equals(ri.activityInfo.packageName)) return ri.activityInfo.packageName;
        } catch (Exception ignored) { }
        for (String b : BROWSERS) if (installed(pm, b)) return b;
        return null;
    }

    /** intent: 주소 — 카카오 가이드 그대로: parseUri → 앱 실행 → 없으면 browser_fallback_url → 그것도 없으면 스토어 */
    static void openIntentUri(Activity act, WebView web, String s) {
        Intent i;
        try { i = Intent.parseUri(s, Intent.URI_INTENT_SCHEME); } catch (Exception e) { return; }
        // 보안: 페이지가 우리 앱 안 화면이나 아무 컴포넌트를 직접 부르지 못하게(안드로이드 intent 보안 권고)
        i.addCategory(Intent.CATEGORY_BROWSABLE);
        i.setComponent(null);
        i.setSelector(null);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // 바로 실행해 본다 — resolveActivity 는 <queries> 에 없는 앱이면 깔려 있어도 null 이다(안드로이드 11 패키지 공개 범위)
        try { act.startActivity(i); return; } catch (Exception ignored) { }
        String fb = i.getStringExtra("browser_fallback_url");
        if (fb != null && !fb.isEmpty()) {
            Uri f = Uri.parse(fb);
            if (inApp(f)) { if (web != null) web.post(() -> web.loadUrl(fb)); }   // 카카오 웹 로그인 같은 건 앱 화면 안에서
            else if (isWeb(f)) openWeb(act, f);
            return;
        }
        String pkg = i.getPackage();
        if (pkg != null && !pkg.isEmpty()) openMarket(act, Uri.parse("market://details?id=" + pkg));
    }

    /** 스토어: 플레이 스토어를 정해서 연다(갤럭시는 플레이·갤럭시 스토어 선택창이 뜬다 — 검증자 지적) */
    static void openMarket(Activity act, Uri u) {
        Intent i = new Intent(Intent.ACTION_VIEW, u);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (installed(act.getPackageManager(), PLAY)) i.setPackage(PLAY);
        try { act.startActivity(i); return; } catch (Exception ignored) { }
        String id = u.getQueryParameter("id");
        if (id != null) customTab(act, Uri.parse("https://play.google.com/store/apps/details?id=" + Uri.encode(id)));
    }

    static boolean installed(PackageManager pm, String pkg) {
        try { pm.getPackageInfo(pkg, 0); return true; } catch (Exception e) { return false; }
    }
}
