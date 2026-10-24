package com.wantsb.momcalendar.widget;

// 한 줄 그리기 — 큰 위젯(목록)과 중간 위젯이 같이 쓴다.
//   체크하면 초록 동그라미 + 상품명에 줄(사장님 2026-10-24 "동그라미 왼쪽 누르면 할일 마친것처럼 실선").
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.view.View;
import android.widget.RemoteViews;

import com.wantsb.momcalendar.R;

final class RowViews {
    static final int[] TAG_BG = {R.drawable.w_tag_op, R.drawable.w_tag_en, R.drawable.w_tag_ing, R.drawable.w_tag_up};
    static final int[] TAG_FG = {0xFFC0392B, 0xFF9A7208, 0xFF2E7D32, 0xFFC24E00};

    static boolean checked(SharedPreferences sp, String key) { return sp.getString("chk", ",").contains("," + key + ","); }
    static void toggle(SharedPreferences sp, String key) {
        String cur = sp.getString("chk", ","), k = "," + key + ",";
        sp.edit().putString("chk", cur.contains(k) ? cur.replace(k, ",") : cur + key + ",").apply();
    }

    /** inList=true 면 목록(채우기 인텐트), false 면 직접 누르기 */
    static RemoteViews row(Context ctx, Items.Row r, SharedPreferences sp, boolean inList, int req) {
        if (r.group) {
            RemoteViews g = new RemoteViews(ctx.getPackageName(), R.layout.w_grp);
            g.setTextViewText(R.id.w_grp, r.label);
            return g;
        }
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.w_item);
        boolean done = r.check && checked(sp, r.key);
        String nm = (r.star ? "★ " : "") + r.name;
        if (done) {
            SpannableString s = new SpannableString(nm);
            s.setSpan(new StrikethroughSpan(), 0, nm.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            v.setTextViewText(R.id.w_name, s);
        } else v.setTextViewText(R.id.w_name, nm);
        v.setTextColor(R.id.w_name, done ? WidgetBase.MUTE : WidgetBase.INK);
        v.setTextViewText(R.id.w_meta, r.meta == null ? "" : r.meta);
        v.setViewVisibility(R.id.w_meta, r.meta == null || r.meta.isEmpty() ? View.GONE : View.VISIBLE);
        if (r.dot != 0) { v.setViewVisibility(R.id.w_dot, View.VISIBLE); v.setTextColor(R.id.w_dot, r.dot); }
        else v.setViewVisibility(R.id.w_dot, View.GONE);
        if (r.tagKind >= 0 && r.tag != null) {
            v.setViewVisibility(R.id.w_tag, View.VISIBLE);
            v.setTextViewText(R.id.w_tag, r.tag);
            v.setTextColor(R.id.w_tag, done ? WidgetBase.MUTE : TAG_FG[r.tagKind]);
            v.setInt(R.id.w_tag, "setBackgroundResource", TAG_BG[r.tagKind]);
        } else v.setViewVisibility(R.id.w_tag, View.GONE);
        if (r.check) {
            v.setViewVisibility(R.id.w_ck, View.VISIBLE);
            v.setInt(R.id.w_ck, "setBackgroundResource", done ? R.drawable.w_ck_on : R.drawable.w_ck);
        } else v.setViewVisibility(R.id.w_ck, View.GONE);

        if (inList) {
            v.setOnClickFillInIntent(R.id.w_row, new Intent().putExtra("kind", "open").putExtra("url", r.url));
            if (r.check) v.setOnClickFillInIntent(R.id.w_ck, new Intent().putExtra("kind", "check").putExtra("key", r.key));
        } else {
            v.setOnClickPendingIntent(R.id.w_row, WidgetBase.open(ctx, r.url, req));
            if (r.check) v.setOnClickPendingIntent(R.id.w_ck, WidgetBase.check(ctx, r.key, req + 1));
        }
        return v;
    }
}
