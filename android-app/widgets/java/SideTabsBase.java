package com.wantsb.momcalendar.widget;

// ⑨ 옆 탭 카드 (크게) — 저널 앱처럼 왼쪽 세로 탭(이모지 + 세로 글씨, 탭마다 다른 파스텔).
//   탭을 누르면 저장된 데이터로 바로 다시 그린다. 공구=오늘 오픈 인기순 · 찜=맘캘린더 공구 체크 · 핫딜 · 세일 · 출석
import android.content.Context;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import com.wantsb.momcalendar.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.Locale;

abstract class SideTabsBase extends WidgetBase {
    static final String[] TABS = {"gonggu", "mine", "hot", "sale", "attend"};
    static final int[] TAB_IDS = {R.id.w_t0, R.id.w_t1, R.id.w_t2, R.id.w_t3, R.id.w_t4};
    static final int[] TAB_BG = {R.drawable.w_tab_pink, R.drawable.w_tab_yel, R.drawable.w_tab_sky, R.drawable.w_tab_mint, R.drawable.w_tab_sand};
    static final int INK = 0xFF2E2A27, MUTE = 0xFFA79F97, PINK = 0xFFE58FA6;

    abstract int layout();

    RemoteViews lk(Context ctx, String meta, String name, String right, boolean rightPink, String url, int req) {
        RemoteViews r = new RemoteViews(ctx.getPackageName(), R.layout.w_lk);
        r.setTextViewText(R.id.w_meta, meta);
        r.setTextViewText(R.id.w_name, name);
        r.setTextViewText(R.id.w_dd, right);
        r.setTextColor(R.id.w_dd, rightPink ? PINK : MUTE);
        r.setOnClickPendingIntent(R.id.w_row, open(ctx, url, req));
        return r;
    }

    @Override
    protected RemoteViews build(Context ctx, int id, JSONObject f, SharedPreferences sp) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layout());
        String tab = sp.getString("tab_" + id, "gonggu");
        int ti = 0;
        for (int i = 0; i < TABS.length; i++) {
            boolean on = TABS[i].equals(tab);
            if (on) ti = i;
            v.setTextColor(TAB_IDS[i], on ? INK : 0xFF8A7F76);
            v.setOnClickPendingIntent(TAB_IDS[i], broadcast(ctx, A_TAB, 8000 + id * 10 + i, "tab", TABS[i], id));
        }
        v.setInt(R.id.w_edge, "setBackgroundResource", TAB_BG[ti]);   // 고른 탭 색이 패널 가장자리로 이어진다
        v.setViewVisibility(R.id.w_chip3, View.GONE);   // 옆 탭은 칩 두 개만
        v.removeAllViews(R.id.w_rows);
        NumberFormat nf = NumberFormat.getInstance(Locale.KOREA);
        int req = 8500 + id * 20;
        switch (tab) {
            case "mine": {
                JSONArray up = upcoming(f);
                int done = 0, n = Math.min(3, up.length());
                for (int i = 0; i < n; i++) if (checked(sp, String.valueOf(up.optJSONObject(i).optLong("id")))) done++;
                v.setTextViewText(R.id.w_title, "이번 주 살 것"); v.setTextViewText(R.id.w_cnt, done + "/" + n);
                v.setProgressBar(R.id.w_prog, 100, n == 0 ? 0 : done * 100 / n, false);
                v.setTextViewText(R.id.w_chip1, "● 오픈 예정 " + up.length()); v.setTextViewText(R.id.w_chip2, "● 맘캘린더 공구");
                v.setTextViewText(R.id.w_secl, "곧 오픈 · 오픈순");
                for (int i = 0; i < Math.min(4, up.length()); i++) {
                    JSONObject o = up.optJSONObject(i);
                    String gid = String.valueOf(o.optLong("id"));
                    boolean c = checked(sp, gid);
                    RemoteViews r = new RemoteViews(ctx.getPackageName(), R.layout.w_row_check);
                    r.setTextViewText(R.id.w_meta, md(o.optString("open_date")) + " · " + ddLabel(o.optString("open_date"), o.optString("end_date")));
                    r.setTextViewText(R.id.w_name, (c ? "✓ " : "") + o.optString("name"));
                    r.setTextColor(R.id.w_name, c ? MUTE : INK);
                    r.setTextViewText(R.id.w_dd, "");
                    r.setInt(R.id.w_ck, "setBackgroundResource", c ? R.drawable.w_ck_on : R.drawable.w_ck);
                    r.setOnClickPendingIntent(R.id.w_ck, broadcast(ctx, A_CHECK, req + i, "gid", gid, id));
                    r.setOnClickPendingIntent(R.id.w_row, open(ctx, searchUrl(o.optString("name")), req + 10 + i));
                    v.addView(R.id.w_rows, r);
                }
                break;
            }
            case "hot": {
                JSONArray h = arr(f, "hot");
                v.setTextViewText(R.id.w_title, "오늘 뜬 핫딜"); v.setTextViewText(R.id.w_cnt, String.valueOf(h.length()));
                v.setProgressBar(R.id.w_prog, 100, 100, false);
                v.setTextViewText(R.id.w_chip1, "● 할인율 높은 순"); v.setTextViewText(R.id.w_chip2, "● 가격 실측");
                v.setTextViewText(R.id.w_secl, "핫딜 · 할인율순");
                for (int i = 0; i < Math.min(4, h.length()); i++) {
                    JSONObject o = h.optJSONObject(i);
                    int rate = o.optInt("discount_rate");
                    v.addView(R.id.w_rows, lk(ctx, o.optString("mall") + (rate > 0 ? " · -" + rate + "%" : ""), o.optString("title"),
                            nf.format(o.optLong("price")) + "원", i == 0, SITE + "#hotdeal", req + i));
                }
                break;
            }
            case "sale": {
                JSONArray s = arr(f, "sale");
                v.setTextViewText(R.id.w_title, "브랜드 세일"); v.setTextViewText(R.id.w_cnt, String.valueOf(s.length()));
                v.setProgressBar(R.id.w_prog, 100, 60, false);
                v.setTextViewText(R.id.w_chip1, "● 공식 세일만"); v.setTextViewText(R.id.w_chip2, "● 시작일 알림");
                v.setTextViewText(R.id.w_secl, "다가오는 세일");
                for (int i = 0; i < Math.min(4, s.length()); i++) {
                    JSONObject o = s.optJSONObject(i);
                    int d = dday(o.optString("start_date"));
                    v.addView(R.id.w_rows, lk(ctx, md(o.optString("start_date")) + (o.optString("end_date").isEmpty() ? "" : " ~ " + md(o.optString("end_date"))),
                            o.optString("brand") + " " + o.optString("title"), d > 0 ? "D-" + d : "진행 중", i == 0, SITE, req + i));
                }
                break;
            }
            case "attend": {
                v.setTextViewText(R.id.w_title, "오늘 출석 체크"); v.setTextViewText(R.id.w_cnt, "");
                v.setProgressBar(R.id.w_prog, 100, 30, false);
                v.setTextViewText(R.id.w_chip1, "● 매달 추첨"); v.setTextViewText(R.id.w_chip2, "● 개근 선물");
                v.setTextViewText(R.id.w_secl, "출석하면");
                v.addView(R.id.w_rows, lk(ctx, "하루 한 번", "출석하고 이달 경품 응모하기", "›", true, SITE + "?attend=1", req));
                v.addView(R.id.w_rows, lk(ctx, "한 달 개근", "개근하면 선물 한 번 더", "›", false, SITE + "?attend=1", req + 1));
                break;
            }
            default: {
                JSONArray g = arr(f, "today_top");
                v.setTextViewText(R.id.w_title, "오늘 열린 공구"); v.setTextViewText(R.id.w_cnt, String.valueOf(f.optInt("open_count")));
                int oc = f.optInt("open_count"), ec = f.optInt("end_count");
                v.setProgressBar(R.id.w_prog, 100, oc + ec == 0 ? 0 : oc * 100 / (oc + ec), false);
                v.setTextViewText(R.id.w_chip1, "● 오픈 " + oc); v.setTextViewText(R.id.w_chip2, "● 마감 " + ec);
                v.setTextViewText(R.id.w_secl, "오늘 오픈 · 인기순");
                for (int i = 0; i < Math.min(4, g.length()); i++) {
                    JSONObject o = g.optJSONObject(i);
                    v.addView(R.id.w_rows, lk(ctx, md(f.optString("today")) + " · " + emoji(o.optString("major")) + " " + o.optString("major"),
                            o.optString("name"), o.optString("seller"), false, searchUrl(o.optString("name")), req + i));
                }
            }
        }
        return v;
    }
}
