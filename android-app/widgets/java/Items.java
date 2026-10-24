package com.wantsb.momcalendar.widget;

// 위젯 목록 만들기 — 탭(무엇을) × 단추(누구 것) × 기간(이번 주·이번 달)
//   전체 탭 = 날짜 줄(오늘·내일·날짜별)에 공구·핫딜·세일이 섞인다 / 종류 탭 = 그 종류 목록(묶음 제목 없이 쭉)
//   상품명 옆 표시는 사이트와 같은 판정 + 내일마감·마감 D-n·오픈 D-n (사장님 2026-10-24 "db랑 똑같이 오늘오픈 오늘마감 내일마감 마감 d-2")
//   동그라미(다 했어요)는 내 찜에서만.
import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

final class Items {
    // 표시 색 — 사이트 카드와 같은 계열
    static final int T_OP = 0, T_EN = 1, T_ING = 2, T_UP = 3;
    static final int K_G = 0xFFE58FA6, K_H = 0xFFEFA25E, K_L = 0xFF86B2DA, K_S = 0xFF93C483;
    static final String[] DOW = {"일", "월", "화", "수", "목", "금", "토"};

    static final class Row {
        boolean group; String label;              // 묶음 제목
        String key, name, meta, tag, url;         // 한 줄
        int tagKind = -1, dot = 0; boolean star, check;
        String sortDate = "";
    }

    static String title(String tab, boolean month) {
        switch (tab) {
            case "gonggu": return "공구";
            case "hot": return "오늘 핫딜";
            case "live": return "라방";
            case "sale": return "세일 일정";
            default: return month ? "이번 달 일정" : "이번 주 일정";
        }
    }

    // ── 날짜 ──
    static Calendar today() {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul"));
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c;
    }
    static String ymd(Calendar c) { return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH)); }
    static String plus(int n) { Calendar c = today(); c.add(Calendar.DAY_OF_MONTH, n); return ymd(c); }
    static Calendar parse(String s) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul")); c.clear();
        c.set(Integer.parseInt(s.substring(0, 4)), Integer.parseInt(s.substring(5, 7)) - 1, Integer.parseInt(s.substring(8, 10)));
        return c;
    }
    static int dd(String s) {
        if (s == null || s.length() < 10) return 0;
        return (int) Math.round((parse(s).getTimeInMillis() - today().getTimeInMillis()) / 86400000.0);
    }
    static String md(String s) {
        if (s == null || s.length() < 10) return "";
        Calendar c = parse(s); return (c.get(Calendar.MONTH) + 1) + "." + c.get(Calendar.DAY_OF_MONTH);
    }
    static String dayLabel(String s) {
        int d = dd(s); Calendar c = parse(s); String w = DOW[c.get(Calendar.DAY_OF_WEEK) - 1];
        if (d <= 0) return "오늘 · " + w;
        if (d == 1) return "내일 · " + w;
        return md(s) + ". " + w;
    }

    // ── 표시 말 ──
    static void gTag(Row r, String open, String end) {
        String t = plus(0);
        if (open.equals(t)) { r.tag = "오늘오픈"; r.tagKind = T_OP; return; }
        if (end.equals(t)) { r.tag = "오늘마감"; r.tagKind = T_EN; return; }
        if (open.compareTo(t) > 0) { r.tag = "오픈 D-" + dd(open); r.tagKind = T_UP; return; }
        int n = dd(end);
        if (n == 1) { r.tag = "내일마감"; r.tagKind = T_EN; return; }
        if (n <= 3) { r.tag = "마감 D-" + n; r.tagKind = T_EN; return; }
        r.tag = "진행중"; r.tagKind = T_ING;
    }
    static void sTag(Row r, String start, String end) {
        String t = plus(0);
        if (start.compareTo(t) > 0) { int n = dd(start); r.tag = n == 1 ? "내일 시작" : "시작 D-" + n; r.tagKind = T_UP; return; }
        if (start.equals(t)) { r.tag = "오늘 시작"; r.tagKind = T_OP; return; }
        if (end == null || end.isEmpty()) { r.tag = "진행중"; r.tagKind = T_ING; return; }
        int n = dd(end);
        if (n == 0) { r.tag = "오늘 끝"; r.tagKind = T_EN; return; }
        if (n == 1) { r.tag = "내일 끝"; r.tagKind = T_EN; return; }
        if (n <= 3) { r.tag = "끝 D-" + n; r.tagKind = T_EN; return; }
        r.tag = "진행중"; r.tagKind = T_ING;
    }

    static String q(String name) { try { return WidgetBase.SITE + "?q=" + URLEncoder.encode(name, "UTF-8"); } catch (Exception e) { return WidgetBase.SITE; } }

    static Row gonggu(JSONObject o, boolean check) {
        Row r = new Row();
        String open = o.optString("open_date"), end = o.optString("end_date");
        r.key = "g" + o.optLong("id"); r.name = o.optString("name"); r.star = o.optBoolean("partner");
        String seller = o.optString("seller");
        r.meta = (seller.isEmpty() ? "" : seller + " · ") + md(open) + "~" + md(end);
        gTag(r, open, end); r.url = q(r.name); r.dot = K_G; r.check = check;
        String t = plus(0);
        r.sortDate = open.compareTo(t) > 0 ? open : end;
        return r;
    }
    static Row sale(JSONObject o, boolean check) {
        Row r = new Row();
        String s = o.optString("start_date"), e = o.optString("end_date");
        r.key = "s" + o.optLong("id"); r.name = (o.optString("brand") + " " + o.optString("title")).trim();
        r.meta = md(s) + (e.isEmpty() ? "" : " ~ " + md(e));
        sTag(r, s, e); r.url = WidgetBase.SITE; r.dot = K_S; r.check = check;
        String t = plus(0);
        r.sortDate = s.compareTo(t) > 0 ? s : (e.isEmpty() ? t : e);
        return r;
    }
    static Row hot(JSONObject o, NumberFormat nf) {
        Row r = new Row();
        r.key = "h" + o.optLong("id"); r.name = o.optString("title");   // 몰 페이지 이름 그대로(0-S-원본)
        long p = o.optLong("price");
        r.meta = o.optString("mall") + (p > 0 ? " · " + nf.format(p) + "원" : "");   // 할인율은 싣지 않는다(사장님 2026-10-24)
        r.url = WidgetBase.SITE + "#hotdeal"; r.dot = K_H; r.sortDate = plus(0);
        return r;
    }
    static Row note(String text, String url) {
        Row r = new Row(); r.key = "n"; r.name = text; r.meta = ""; r.url = url; return r;
    }
    static Row group(String label) { Row r = new Row(); r.group = true; r.label = label; return r; }

    /** 날짜 줄로 묶는다 — 기간(이번 주 7일·이번 달 31일) 밖은 뺀다. 이미 진행 중이고 기간 안에 안 끝나는 건 「오늘」 */
    static List<Row> timeline(List<Row> in, boolean month) {
        String t = plus(0), last = plus(month ? 30 : 6);
        List<Row> keep = new ArrayList<>();
        for (Row r : in) {
            String k = r.sortDate == null || r.sortDate.isEmpty() ? t : r.sortDate;
            if (k.compareTo(last) > 0) { if (r.tagKind != T_UP) k = t; else continue; }   // 진행 중인데 기간 뒤에 끝나면 오늘 줄, 기간 뒤에 열리면 뺀다
            if (k.compareTo(t) < 0) k = t;
            r.sortDate = k; keep.add(r);
        }
        Collections.sort(keep, (a, b) -> a.sortDate.compareTo(b.sortDate));
        List<Row> out = new ArrayList<>(); String cur = null;
        for (Row r : keep) {
            if (!r.sortDate.equals(cur)) { cur = r.sortDate; out.add(group(dayLabel(cur))); }
            out.add(r);
        }
        return out;
    }

    static List<Row> build(Context ctx, int widgetId) {
        SharedPreferences sp = WidgetBase.sp(ctx);
        JSONObject f = WidgetBase.feed(sp);
        String tab = WidgetBase.tab(sp, widgetId), mode = WidgetBase.mode(sp, f);
        boolean month = WidgetBase.month(sp), mine = "mine".equals(mode);
        NumberFormat nf = NumberFormat.getInstance(Locale.KOREA);
        List<Row> rows = new ArrayList<>();
        JSONArray wish = arr(f, "wish"), swish = arr(f, "sale_wish"), feed = arr(f, "feed"), hot = arr(f, "hot"), sale = arr(f, "sale");

        if (mine && !f.optBoolean("linked")) {
            rows.add(note("💜 눌러서 내 찜 연결하기", WidgetBase.linkUrl(ctx)));
            rows.get(0).meta = "앱이 열리면 끝 — 한 번만 하면 돼요";
            return rows;
        }
        switch (tab) {
            case "gonggu":
                if (mine) {
                    List<Row> g = new ArrayList<>();
                    for (int i = 0; i < wish.length(); i++) g.add(gonggu(wish.optJSONObject(i), true));
                    rows = timeline(g, month);
                } else for (int i = 0; i < feed.length(); i++) rows.add(gonggu(feed.optJSONObject(i), false));
                if (rows.isEmpty()) rows.add(note(mine ? "아직 찜한 공구가 없어요" : "오늘 진행 중인 공구가 없어요", WidgetBase.SITE));
                break;
            case "hot":
                if (mine) { rows.add(note("핫딜 저장은 곧 열려요 — 지금은 전체에서 보기", WidgetBase.SITE + "#hotdeal")); break; }
                for (int i = 0; i < hot.length(); i++) rows.add(hot(hot.optJSONObject(i), nf));
                if (rows.isEmpty()) rows.add(note("오늘 올라온 핫딜이 아직 없어요", WidgetBase.SITE + "#hotdeal"));
                break;
            case "live":
                rows.add(note("라방 일정은 곧 열려요", WidgetBase.SITE));
                break;
            case "sale":
                if (mine) {
                    List<Row> s = new ArrayList<>();
                    for (int i = 0; i < swish.length(); i++) s.add(sale(swish.optJSONObject(i), true));
                    rows = timeline(s, month);
                    if (rows.isEmpty()) rows.add(note("아직 찜한 세일이 없어요 — 사이트 세일 탭에서 💜", WidgetBase.SITE));
                } else {
                    for (int i = 0; i < sale.length(); i++) rows.add(sale(sale.optJSONObject(i), false));
                    if (rows.isEmpty()) rows.add(note("다가오는 세일이 없어요", WidgetBase.SITE));
                }
                break;
            default: {   // 전체 탭 = 날짜 줄
                List<Row> m = new ArrayList<>();
                if (mine) {
                    for (int i = 0; i < wish.length(); i++) m.add(gonggu(wish.optJSONObject(i), true));
                    for (int i = 0; i < swish.length(); i++) m.add(sale(swish.optJSONObject(i), true));
                } else {
                    for (int i = 0; i < feed.length(); i++) { JSONObject o = feed.optJSONObject(i); if (o.optBoolean("partner")) m.add(gonggu(o, false)); }
                    JSONArray own = arr(f, "mine");   // 곧 열리는 맘캘린더 공구
                    for (int i = 0; i < own.length(); i++) { JSONObject o = own.optJSONObject(i); if (dd(o.optString("open_date")) > 0) { Row r = gonggu(o, false); r.star = true; r.meta = "맘캘린더 · " + md(o.optString("open_date")) + "~" + md(o.optString("end_date")); m.add(r); } }
                    for (int i = 0; i < Math.min(3, hot.length()); i++) m.add(hot(hot.optJSONObject(i), nf));
                    for (int i = 0; i < sale.length(); i++) m.add(sale(sale.optJSONObject(i), false));
                }
                rows = timeline(m, month);
                if (rows.isEmpty()) rows.add(note(mine ? "아직 찜한 게 없어요 — 사이트에서 💜 누르면 여기 떠요" : "이번 주 일정이 없어요", WidgetBase.SITE));
            }
        }
        return rows;
    }
    static JSONArray arr(JSONObject f, String k) { JSONArray a = f.optJSONArray(k); return a == null ? new JSONArray() : a; }
}
