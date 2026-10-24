package com.wantsb.momcalendar.widget;

// 크게(4×4) — 옆 탭 + 위 단추 + 스크롤 목록(ListView). 찜이 많아도 위젯 안에서 손가락으로 내려 본다.
//   목록 안 누르기는 한 장의 틀(setPendingIntentTemplate, FLAG_MUTABLE 이어야 안드로이드 12+ 에서 먹는다) + 줄마다 채우기.
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import com.wantsb.momcalendar.R;

import org.json.JSONObject;

public class CalLarge extends WidgetBase {
    @Override
    protected RemoteViews build(Context ctx, int id, JSONObject f, SharedPreferences sp) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.w_cal_l);
        paintChrome(ctx, v, id, sp, f, 7000 + id * 20);
        Intent svc = new Intent(ctx, CalListService.class)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));   // 위젯마다 다른 목록
        v.setRemoteAdapter(R.id.w_list, svc);
        v.setEmptyView(R.id.w_list, R.id.w_empty);
        Intent tpl = new Intent(ctx, WidgetAction.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setPendingIntentTemplate(R.id.w_list, PendingIntent.getActivity(ctx, 7900 + id, tpl,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        return v;
    }

    @Override
    protected void afterUpdate(AppWidgetManager mgr, int[] ids) {
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.w_list);
    }
}
