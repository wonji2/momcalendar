package com.wantsb.momcalendar.widget;

// ② A 베이지 종이 (중간) — 상자 없이 줄만, 가장 가까운 D-day 하나만 분홍
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import com.wantsb.momcalendar.R;

import org.json.JSONArray;
import org.json.JSONObject;

public class UpNextA extends UpNextBase {
    @Override
    protected RemoteViews build(Context ctx, int id, JSONObject f, SharedPreferences sp) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.w_upnext_a);
        JSONArray up = upcoming(f);
        head(v, f, up, sp, false);
        v.removeAllViews(R.id.w_rows);
        for (int i = 0; i < Math.min(2, up.length()); i++) v.addView(R.id.w_rows, row(ctx, up.optJSONObject(i), i, id, false, true, sp));
        v.setOnClickPendingIntent(R.id.w_root, open(ctx, SITE, 6000 + id));
        return v;
    }
}
