package com.wantsb.momcalendar.widget;

// ② 「다음 오픈」 A·B·C — 맘캘린더 공구를 오픈 순으로 (사장님 찜 연동은 시안 고른 뒤)
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import com.wantsb.momcalendar.R;

import org.json.JSONArray;
import org.json.JSONObject;

abstract class UpNextBase extends WidgetBase {
    static final int PINK = 0xFFE58FA6, MUTE = 0xFFA79F97, INK = 0xFF2E2A27;

    /** 한 줄: 아이콘/동그라미 · 날짜 줄 · 상품명 · D-day */
    RemoteViews row(Context ctx, JSONObject o, int idx, int wid, boolean check, boolean showDd, SharedPreferences sp) {
        RemoteViews r = new RemoteViews(ctx.getPackageName(), check ? R.layout.w_row_check : R.layout.w_row_bell);
        String open = o.optString("open_date"), end = o.optString("end_date"), gid = String.valueOf(o.optLong("id"));
        r.setTextViewText(R.id.w_meta, md(open) + " · " + emoji(o.optString("major")) + " " + o.optString("minor", o.optString("major")));
        boolean done = check && checked(sp, gid);
        r.setTextViewText(R.id.w_name, (done ? "✓ " : "") + o.optString("name"));
        r.setTextColor(R.id.w_name, done ? MUTE : INK);
        if (showDd) {
            r.setTextViewText(R.id.w_dd, ddLabel(open, end));
            r.setTextColor(R.id.w_dd, idx == 0 ? PINK : MUTE);   // 강조색은 가장 가까운 하나에만
        } else r.setTextViewText(R.id.w_dd, "");
        if (check) {
            r.setInt(R.id.w_ck, "setBackgroundResource", done ? R.drawable.w_ck_on : R.drawable.w_ck);
            r.setOnClickPendingIntent(R.id.w_ck, broadcast(ctx, A_CHECK, 9000 + wid * 20 + idx, "gid", gid, wid));
        }
        r.setOnClickPendingIntent(R.id.w_row, open(ctx, searchUrl(o.optString("name")), 7000 + wid * 20 + idx));
        return r;
    }

    void head(RemoteViews v, JSONObject f, JSONArray up, SharedPreferences sp, boolean checkCount) {
        int n = up.length(), done = 0;
        for (int i = 0; i < n; i++) if (checked(sp, String.valueOf(up.optJSONObject(i).optLong("id")))) done++;
        v.setTextViewText(R.id.w_cnt, checkCount ? (done + "/" + Math.min(n, 3)) : ("맘캘린더 " + n));
        int pct = checkCount ? (n == 0 ? 0 : done * 100 / Math.min(n, 3)) : Math.max(8, 100 - Math.min(100, dday(n > 0 ? up.optJSONObject(0).optString("open_date") : null) * 7));
        v.setProgressBar(R.id.w_prog, 100, Math.min(100, pct), false);
    }
}
