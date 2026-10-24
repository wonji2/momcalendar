package com.wantsb.momcalendar.widget;

// 큰 위젯 목록을 채운다 — 저장된 데이터(SharedPreferences)로만 그린다(네트워크 안 씀).
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.List;

public class CalListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(), intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0));
    }

    static final class Factory implements RemoteViewsFactory {
        final Context ctx; final int wid;
        List<Items.Row> rows = new ArrayList<>();
        Factory(Context ctx, int wid) { this.ctx = ctx; this.wid = wid; }
        @Override public void onCreate() { }
        @Override public void onDataSetChanged() {
            try { rows = Items.build(ctx, wid); } catch (Exception e) { rows = new ArrayList<>(); }
        }
        @Override public void onDestroy() { rows.clear(); }
        @Override public int getCount() { return rows.size(); }
        @Override public RemoteViews getViewAt(int i) {
            if (i < 0 || i >= rows.size()) return null;
            return RowViews.row(ctx, rows.get(i), WidgetBase.sp(ctx), true, 0);
        }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public long getItemId(int i) { return i; }
        @Override public boolean hasStableIds() { return false; }
    }
}
