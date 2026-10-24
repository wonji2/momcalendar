package com.wantsb.momcalendar.widget;

// 위젯 누르기 받는 투명 화면 — 열기(앱으로, 주소에 위젯 번호) / 체크(다 했어요 줄 긋기) 를 하고 바로 닫힌다.
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

public class WidgetAction extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Intent in = getIntent();
        String kind = in == null ? null : in.getStringExtra("kind");
        try {
            if ("check".equals(kind)) {
                String key = in.getStringExtra("key");
                if (key != null && key.matches("[gs][0-9]{1,12}")) {
                    RowViews.toggle(WidgetBase.sp(this), key);
                    WidgetBase.redrawAll(this);
                }
            } else if ("open".equals(kind)) {
                String url = in.getStringExtra("url");
                if (url == null || !url.startsWith("https://momcalendar.com/")) url = WidgetBase.SITE;
                // 위젯 번호(wdid)는 「내 찜 연결하기」 주소(linkUrl)에만 실린다 — 번호가 곧 찜 열쇠라 일반 주소에 남기지 않는다(검증자 지적)
                Intent go = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                go.setClassName(this, "com.wantsb.momcalendar.LauncherActivity");
                go.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                startActivity(go);
                WidgetBase.refreshSoon(this);
            }
        } catch (Exception ignored) { }
        finish();
        overridePendingTransition(0, 0);
    }
}
