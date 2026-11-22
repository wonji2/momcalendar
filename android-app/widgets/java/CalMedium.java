package com.wantsb.momcalendar.widget;

// 중간(4×2) — 옆 탭은 아이콘만(폭이 좁다) + 위 단추 + 두 줄. 더 보려면 크게 위젯이나 앱.
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import com.wantsb.momcalendar.R;

import org.json.JSONObject;

import java.util.List;

public class CalMedium extends WidgetBase {
    @Override
    protected RemoteViews build(Context ctx, int id, JSONObject f, SharedPreferences sp) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.w_cal_m);
        paintChrome(ctx, v, id, sp, f, 6000 + id * 20);
        v.removeAllViews(R.id.w_rows);
        List<Items.Row> rows = Items.build(ctx, id);
        int n = 0, req = 6500 + id * 20;
        for (Items.Row r : rows) {
            if (r.group) continue;   // 두 줄뿐이라 날짜 제목 대신 줄 안 표시로
            v.addView(R.id.w_rows, RowViews.row(ctx, r, sp, false, req + n * 2));
            if (++n >= 2) break;
        }
        return v;
    }
}
