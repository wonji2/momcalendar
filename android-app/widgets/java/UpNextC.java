package com.wantsb.momcalendar.widget;

// ② C 크게 — 오늘 숫자 칩 + 이번 주·다음 주·그 뒤로 묶은 목록
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import com.wantsb.momcalendar.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

public class UpNextC extends UpNextBase {
    @Override
    protected RemoteViews build(Context ctx, int id, JSONObject f, SharedPreferences sp) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.w_upnext_c);
        JSONArray up = upcoming(f);
        head(v, f, up, sp, false);
        Calendar t = todayKst();
        v.setTextViewText(R.id.w_cnt, (t.get(Calendar.MONTH) + 1) + "월 " + t.get(Calendar.DAY_OF_MONTH) + "일 " + DOW[t.get(Calendar.DAY_OF_WEEK) - 1]);
        v.setTextViewText(R.id.w_chip1, "● 오픈 " + f.optInt("open_count"));
        v.setTextViewText(R.id.w_chip2, "● 마감 " + f.optInt("end_count"));
        v.setTextViewText(R.id.w_chip3, "● 맘캘 공구 " + arr(f, "mine").length());
        v.removeAllViews(R.id.w_rows);
        int toSun = (8 - t.get(Calendar.DAY_OF_WEEK)) % 7;   // 이번 주 일요일까지 남은 날
        String last = "";
        for (int i = 0; i < Math.min(5, up.length()); i++) {
            JSONObject o = up.optJSONObject(i);
            int d = dday(o.optString("open_date"));
            String sec = d <= toSun ? "이번 주" : d <= toSun + 7 ? "다음 주" : "그 뒤";
            if (!sec.equals(last)) {
                RemoteViews h = new RemoteViews(ctx.getPackageName(), R.layout.w_sec);
                h.setTextViewText(R.id.w_sec, sec);
                v.addView(R.id.w_rows, h); last = sec;
            }
            v.addView(R.id.w_rows, row(ctx, o, i, id, true, true, sp));
        }
        v.setOnClickPendingIntent(R.id.w_head, open(ctx, SITE, 6200 + id));
        return v;
    }
}
