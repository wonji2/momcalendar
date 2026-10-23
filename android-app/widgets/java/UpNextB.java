package com.wantsb.momcalendar.widget;

// ② B 분홍 종이 + 오른쪽 그림 칸 (중간) — 저널 앱 「Try 0/2 + 새싹 칸」. 동그라미 = 「샀어요」 체크(이 폰에만 저장)
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import com.wantsb.momcalendar.R;

import org.json.JSONArray;
import org.json.JSONObject;

public class UpNextB extends UpNextBase {
    @Override
    protected RemoteViews build(Context ctx, int id, JSONObject f, SharedPreferences sp) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.w_upnext_b);
        JSONArray up = upcoming(f);
        head(v, f, up, sp, true);
        v.removeAllViews(R.id.w_rows);
        for (int i = 0; i < Math.min(2, up.length()); i++) v.addView(R.id.w_rows, row(ctx, up.optJSONObject(i), i, id, true, false, sp));
        JSONObject first = up.optJSONObject(0);
        v.setTextViewText(R.id.w_big, first == null ? "" : ddLabel(first.optString("open_date"), first.optString("end_date")));
        v.setOnClickPendingIntent(R.id.w_box, open(ctx, first == null ? SITE : searchUrl(first.optString("name")), 6100 + id));
        return v;
    }
}
