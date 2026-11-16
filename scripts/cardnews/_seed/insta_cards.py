import os, shutil
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

W, H = 1080, 1440
F_EXB = "scratchpad/Pretendard-ExtraBold.otf"
F_BLD = "scratchpad/Pretendard-Bold.otf"
F_MED = "scratchpad/Pretendard-Medium.otf"
ROOT = "downloads/insta_week1"
DATE = "26.11.16 기준"

PURPLE = (91, 46, 140)
CORAL = (244, 121, 91)
CORAL_SOFT = (253, 242, 239)
PURPLE_SOFT = (244, 240, 250)
INK = (26, 26, 26)
GRAY = (107, 107, 107)
LIGHT_GRAY = (160, 160, 165)
LINE_GRAY = (228, 225, 220)
BG_WARM = (250, 248, 245)
WHITE = (255, 255, 255)
DARK_BG = (22, 21, 24)
DARK_LINE = (60, 58, 64)


def font(path, size):
    return ImageFont.truetype(path, size)


def tw(draw, text, fnt, tr=-0.02):
    if not text:
        return 0
    total = 0.0
    step = fnt.size * tr
    for i, ch in enumerate(text):
        total += draw.textlength(ch, font=fnt)
        if i < len(text) - 1:
            total += step
    return total


def dt(draw, xy, text, fnt, fill, tr=-0.02):
    x, y = xy
    step = fnt.size * tr
    cx = float(x)
    for i, ch in enumerate(text):
        draw.text((cx, y), ch, font=fnt, fill=fill)
        cx += draw.textlength(ch, font=fnt)
        if i < len(text) - 1:
            cx += step
    return cx


def dtc(draw, y, text, fnt, fill, tr=-0.02):
    w = tw(draw, text, fnt, tr)
    dt(draw, ((W - w) / 2.0, y), text, fnt, fill, tr)


def dt_right(draw, y, text, fnt, fill, tr=-0.02, margin=80):
    w = tw(draw, text, fnt, tr)
    dt(draw, (W - margin - w, y), text, fnt, fill, tr)


def fit_size(draw, text, path, size, max_w, tr=-0.02):
    """shrink until it fits max_w"""
    s = size
    while s > 18:
        f = font(path, s)
        if tw(draw, text, f, tr) <= max_w:
            return f
        s -= 2
    return font(path, s)


def date_pill(draw, dark=False, y=70, label=DATE):
    f = font(F_BLD, 26)
    w = tw(draw, label, f)
    pad_x, pad_y = 24, 13
    x2 = W - 80
    x1 = x2 - (w + pad_x * 2)
    if dark:
        draw.rounded_rectangle([x1, y, x2, y + 26 + pad_y * 2], radius=999,
                               fill=(38, 36, 42), outline=(122, 120, 126), width=1)
        col = (255, 255, 255)
    else:
        draw.rounded_rectangle([x1, y, x2, y + 26 + pad_y * 2], radius=999,
                               fill=(238, 235, 230), outline=(208, 205, 200), width=1)
        col = INK
    dt(draw, (x1 + pad_x, y + pad_y - 1), label, f, col)


def logo(draw, dark=False, y=74):
    col = (242, 242, 242) if dark else (150, 148, 145)
    dt(draw, (80, y), "M O M C A L   M A G A Z I N E", font(F_MED, 21), col, 0.02)


# ---------------- covers ----------------
def _dt_stroke(draw, x, y, text, f, fill, tr=-0.03):
    # Pure crisp typography (no harsh border/shadow)
    cx = x
    for ch in text:
        cw = draw.textlength(ch, font=f)
        draw.text((cx, y), ch, font=f, fill=fill)
        cx += cw + f.size * tr


def _dt_center_stroke(draw, y, text, f, fill, stroke_fill=(18, 18, 22), sw=0, tr=-0.03):
    w = tw(draw, text, f, tr)
    x = (W - w) // 2
    cx = x
    for ch in text:
        cw = draw.textlength(ch, font=f)
        draw.text((cx, y), ch, font=f, fill=fill)
        cx += cw + f.size * tr
    return cx - x


def cover_photo(bg_path, lead, l1, l2, accent, out_path, dark_text=True, sub="육아동지한테 당장 공유해 두세요"):
    bg = Image.open(bg_path).convert("RGBA")
    bg = ImageEnhance.Color(bg).enhance(0.88)
    bw, bh = bg.size
    scale = max(W / bw, H / bh)
    bg = bg.resize((int(bw * scale), int(bh * scale)), Image.Resampling.LANCZOS)
    bg = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2,
                  (bg.width - W) // 2 + W, (bg.height - H) // 2 + H))
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for y in range(H):
        if y < 290:
            od.line([(0, y), (W, y)], fill=(0, 0, 0, int(215 * (1 - y / 290))))
        elif y > int(H * 0.28):
            t = (y - int(H * 0.28)) / (H - int(H * 0.28))
            od.line([(0, y), (W, y)], fill=(12, 12, 16, int(225 * (t ** 1.05))))
    img = Image.alpha_composite(bg, ov).convert("RGB")
    d = ImageDraw.Draw(img)
    logo(d, dark=True)
    f_tag = fit_size(d, "공구 · 핫딜 · 세일 · 육아정보 커뮤니티 맘캘린더", F_BLD, 36, W - 160)
    dt(d, (80, 114), "공구 · 핫딜 · 세일 · 육아정보 커뮤니티 맘캘린더", f_tag, WHITE, -0.02)

    # @dorimomnurse editorial style: left-aligned, crisp text, muted pastel accent, thin rule
    x = 80
    y_lead = 675
    f_lead = fit_size(d, lead, F_BLD, 54, W - 160)
    dt(d, (x, y_lead), lead, f_lead, (238, 240, 244), -0.02)

    y1 = y_lead + 74
    f1 = fit_size(d, l1, F_EXB, 122, W - 160)
    _dt_stroke(d, x, y1, l1, f1, WHITE, tr=-0.035)

    y2 = y1 + int(f1.size * 1.12)
    f2 = fit_size(d, l2, F_EXB, 122, W - 160)
    # Toned-down trendy pastel (mint / warm peach) like @dorimomnurse & @kkiri.home
    pastel = (128, 212, 206) if accent == CORAL else (243, 196, 184)
    _dt_stroke(d, x, y2, l2, f2, pastel, tr=-0.035)

    # Thin editorial rule + clear readable sub-line
    y_rule = y2 + int(f2.size * 1.15) + 24
    d.line([(x, y_rule), (W - 80, y_rule)], fill=(255, 255, 255, 110), width=2)
    f_sub = fit_size(d, sub, F_BLD, 40, W - 160)
    dt(d, (x, y_rule + 24), sub, f_sub, (225, 228, 234), -0.02)

    img.save(out_path, quality=95)
    return out_path


def cover_type(lead, l1, l2, accent, out_path, dark=False):
    bg = DARK_BG if dark else BG_WARM
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    logo(d, dark=dark)
    date_pill(d, dark=dark)

    # Bold center card framing to prevent flat empty look
    card_fill = (30, 29, 36) if dark else WHITE
    card_border = (65, 62, 75) if dark else (225, 220, 215)
    d.rounded_rectangle([72, 250, W - 72, H - 150], radius=36, fill=card_fill, outline=card_border, width=2)

    # Top accent pill
    f_lead = fit_size(d, lead, F_EXB, 42, W - 240)
    lw = tw(d, lead, f_lead, -0.02)
    px, py = 36, 18
    bx1 = (W - lw) // 2 - px
    bx2 = bx1 + lw + px * 2
    by1 = 440
    by2 = by1 + 42 + py * 2
    d.rounded_rectangle([bx1, by1, bx2, by2], radius=999, fill=accent)
    dt(d, (bx1 + px, by1 + py - 2), lead, f_lead, WHITE, -0.02)

    y1 = by2 + 54
    f1 = fit_size(d, l1, F_EXB, 136, W - 200)
    _dt_center_stroke(d, y1, l1, f1, WHITE if dark else INK, stroke_fill=(0, 0, 0), sw=0, tr=-0.03)

    # Highlight bar behind line 2
    y2 = y1 + int(f1.size * 1.18)
    f2 = fit_size(d, l2, F_EXB, 136, W - 220)
    w2 = tw(d, l2, f2, -0.03)
    hx1 = (W - w2) // 2 - 28
    hx2 = hx1 + w2 + 56
    d.rounded_rectangle([hx1, y2 + 4, hx2, y2 + int(f2.size * 1.08)], radius=20, fill=accent)
    _dt_center_stroke(d, y2, l2, f2, WHITE, stroke_fill=(0, 0, 0), sw=0, tr=-0.03)

    # Bottom subtle callout
    sub = "맘캘린더 실시간 집계 · 저장하고 바로 확인"
    fs = font(F_BLD, 30)
    sw = tw(d, sub, fs, -0.02)
    dt(d, ((W - sw) // 2, H - 255), sub, fs, (175, 175, 182) if dark else GRAY, -0.02)

    img.save(out_path, quality=95)
    return out_path


# ---------------- inner cards ----------------
def chrome(d, page, total, footer=DATE, dark=False):
    line = DARK_LINE if dark else LINE_GRAY
    sub = (140, 140, 145) if dark else LIGHT_GRAY
    logo(d, dark=dark)
    tag = "공구 · 핫딜 · 육아정보 · 맘캘린더"
    ftag = font(F_MED, 21)
    dt_right(d, 74, tag, ftag, (175, 175, 180) if dark else (150, 148, 145))
    d.line([(80, 118), (W - 80, 118)], fill=line, width=1)
    d.line([(80, H - 118), (W - 80, H - 118)], fill=line, width=1)
    pg = f"{page}/{total}"
    pw = tw(d, pg, font(F_MED, 24))
    dt(d, (W - 80 - pw, H - 88), pg, font(F_MED, 24), sub)


def label_box(d, text, accent, tint, dark=False):
    f = font(F_BLD, 26)
    w = tw(d, text, f)
    pad_x, pad_y = 22, 12
    box = [80, 174, 80 + w + pad_x * 2, 174 + 26 + pad_y * 2]
    fill = tint if not dark else (255, 255, 255, 0)
    d.rounded_rectangle(box, radius=10, fill=fill, outline=accent, width=1)
    dt(d, (80 + pad_x, 174 + pad_y - 1), text, f, accent)
    return box[3]


def check_glyph(d, x, y, color, s=34):
    d.line([(x + s * 0.08, y + s * 0.55), (x + s * 0.38, y + s * 0.86)], fill=color, width=4)
    d.line([(x + s * 0.36, y + s * 0.86), (x + s * 0.95, y + s * 0.12)], fill=color, width=4)


def info_card(out_path, page, total, label, title, rows, accent, tint,
              bridge=None, footer=DATE, dark=False):
    """rows: list of dicts
       {'t':'kv','head':..,'desc':[..],'value':..}
       {'t':'check','text':..,'value':..}
       {'t':'rank','num':..,'name':..,'sub':..,'value':..}
       {'t':'branch','tag':..,'text':..}
       {'t':'note','text':..}
    """
    bg = DARK_BG if dark else BG_WARM
    ink = WHITE if dark else INK
    sub = (165, 165, 170) if dark else GRAY
    line = DARK_LINE if dark else LINE_GRAY
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    chrome(d, page, total, footer, dark)

    y = label_box(d, label, accent, tint, dark)
    y += 38
    f_title = fit_size(d, title, F_EXB, 60, W - 160)
    dt(d, (80, y), title, f_title, ink)
    y += 124

    def _h(r):
        t = r['t']
        if t == 'kv':
            return 34 + 60 + 47 * len(r.get('desc', [])) + 24
        if t == 'check':
            return 78
        if t == 'rank':
            return 28 + 56 + (44 if r.get('sub') else 0) + 22
        if t == 'branch':
            return 28 + 44 + 52 + 14
        return 48

    natural = sum(_h(r) for r in rows)
    limit = (H - 236) if bridge else (H - 186)
    n = max(1, len(rows))
    extra = max(0, min(64, (limit - y - natural) // n))

    for r in rows:
        if r['t'] == 'kv':
            d.line([(80, y), (W - 80, y)], fill=line, width=1)
            y += 34
            avail = W - 160
            if r.get('value'):
                fv = font(F_EXB, 42)
                avail = W - 160 - tw(d, r['value'], fv) - 32
            fh = fit_size(d, r['head'], F_BLD, 42, avail)
            dt(d, (80, y), r['head'], fh, ink)
            if r.get('value'):
                dt_right(d, y, r['value'], fv, accent)
            y += 60
            for ln in r.get('desc', []):
                f = fit_size(d, ln, F_MED, 34, W - 160)
                dt(d, (80, y), ln, f, sub)
                y += 47
            y += 24
        elif r['t'] == 'check':
            check_glyph(d, 80, y + 4, accent if r.get('accent') else (WHITE if dark else INK))
            avail = W - 160 - 54
            if r.get('value'):
                fvv = font(F_BLD, 32)
                avail = avail - tw(d, r['value'], fvv) - 28
            f = fit_size(d, r['text'], F_MED, 38, avail)
            dt(d, (134, y), r['text'], f, ink)
            if r.get('value'):
                dt_right(d, y + 2, r['value'], fvv, accent)
            y += 78
        elif r['t'] == 'rank':
            d.line([(80, y), (W - 80, y)], fill=line, width=1)
            y += 28
            dt(d, (80, y), r['num'], font(F_EXB, 40), accent)
            avail = W - 300
            if r.get('value'):
                frv = font(F_EXB, 34)
                avail = W - 160 - 70 - tw(d, r['value'], frv) - 28
            f = fit_size(d, r['name'], F_BLD, 38, avail)
            dt(d, (150, y + 2), r['name'], f, ink)
            if r.get('value'):
                dt_right(d, y, r['value'], frv, accent)
            y += 56
            if r.get('sub'):
                dt(d, (150, y), r['sub'], font(F_MED, 30), sub)
                y += 44
            y += 22
        elif r['t'] == 'branch':
            d.line([(80, y), (W - 80, y)], fill=line, width=1)
            y += 28
            dt(d, (80, y), r['tag'], font(F_BLD, 30), accent)
            y += 44
            f = fit_size(d, r['text'], F_MED, 34, W - 160)
            dt(d, (80, y), r['text'], f, ink)
            y += 52
            y += 14
        elif r['t'] == 'note':
            f = fit_size(d, r['text'], F_MED, 32, W - 160)
            dt(d, (80, y), r['text'], f, sub)
            y += 48
        if r['t'] != 'note':
            y += extra

    if bridge:
        d.line([(80, H - 200), (W - 80, H - 200)], fill=line, width=1)
        f = fit_size(d, bridge, F_BLD, 32, W - 160)
        dt(d, (80, H - 175), bridge, f, accent)
    img.save(out_path, quality=95)
    return y


# ---------------- visual grid card (2x2 / 3x2 / 3x3 product thumbnails) ----------------
def visual_grid_card(out_path, page_num, total_pages, label, title, items, accent, tint,
                     bridge=None, footer=DATE):
    img = Image.new("RGB", (W, H), BG_WARM)
    d = ImageDraw.Draw(img)
    chrome(d, page_num, total_pages, footer, False)
    y = label_box(d, label, accent, tint, False) + 28
    f_t = fit_size(d, title, F_EXB, 52, W - 160)
    dt(d, (80, y), title, f_t, INK)
    y += 84

    n_items = len(items)
    if n_items >= 7:
        cols, max_items = 3, 9
        gap = 20
        cw = (W - 160 - gap * 2) // 3  # 293px
        ch = 286
        ph = 186
        title_sz, val_sz, badge_sz = 23, 27, 19
    elif n_items >= 5:
        cols, max_items = 3, 6
        gap = 22
        cw = (W - 160 - gap * 2) // 3
        ch = 380
        ph = 245
        title_sz, val_sz, badge_sz = 25, 30, 20
    else:
        cols, max_items = 2, 4
        gap = 28
        cw = (W - 160 - gap) // 2
        ch = 380
        ph = 246
        title_sz, val_sz, badge_sz = 28, 34, 22

    for idx, it in enumerate(items[:max_items]):
        col = idx % cols
        row = idx // cols
        cx = 80 + col * (cw + gap)
        cy = y + row * (ch + gap)

        d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=18, fill=WHITE, outline=(228, 224, 218), width=2)
        try:
            th = Image.open(it["img"]).convert("RGB")
            tw_i, th_i = th.size
            sc = max(cw / tw_i, ph / th_i)
            th = th.resize((int(tw_i * sc), int(th_i * sc)), Image.Resampling.LANCZOS)
            th = th.crop(((th.width - cw) // 2, (th.height - ph) // 2,
                          (th.width - cw) // 2 + cw, (th.height - ph) // 2 + ph))
            mask = Image.new("L", (cw, ph), 0)
            md = ImageDraw.Draw(mask)
            md.rounded_rectangle([0, 0, cw, ph + 18], radius=18, fill=255)
            img.paste(th, (cx, cy), mask)
        except Exception:
            d.rounded_rectangle([cx, cy, cx + cw, cy + ph], radius=18, fill=(240, 236, 230))

        badge = it.get("badge", "")
        if badge:
            bf = font(F_BLD, badge_sz)
            bw = tw(d, badge, bf, -0.02) + 20
            bcol = PURPLE if it.get("is_gonggu") else CORAL
            d.rounded_rectangle([cx + 10, cy + 10, cx + 10 + bw, cy + 40], radius=10, fill=bcol)
            dt(d, (cx + 20, cy + 14), badge, bf, WHITE, -0.02)

        nf = fit_size(d, it["name"], F_BLD, title_sz, cw - 24)
        dt(d, (cx + 12, cy + ph + 14), it["name"], nf, INK, -0.02)
        vcol = PURPLE if it.get("is_gonggu") else CORAL
        vf = font(F_EXB, val_sz)
        dt(d, (cx + 12, cy + ph + 52), it["value"], vf, vcol, -0.02)
        if it.get("unit"):
            vw = tw(d, it["value"], vf, -0.02)
            ux = cx + 12 + vw + 7
            max_uw = max(40, (cx + cw - 10) - ux)
            uf = fit_size(d, it["unit"], F_MED, 16, max_uw, -0.02)
            dt(d, (ux, cy + ph + 56), it["unit"], uf, GRAY, -0.02)

    if bridge:
        dt(d, (80, 1284), bridge, font(F_BLD, 30), accent)
    img.save(out_path, quality=95)
    return out_path


# ---------------- ending ----------------
def ending(out_path):
    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)
    cx = W // 2
    logo_path = os.path.join(os.path.dirname(__file__), "momcal-channel-640.png")
    if not os.path.exists(logo_path):
        logo_path = "scratchpad/momcal-channel-640.png"
    if os.path.exists(logo_path):
        sz = 140
        lg = Image.open(logo_path).convert("RGBA").resize((sz, sz), Image.Resampling.LANCZOS)
        mask = Image.new("L", (sz, sz), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, sz, sz], radius=32, fill=255)
        img.paste(lg, (cx - sz // 2, 305), mask)
    else:
        cy = 390
        d.rounded_rectangle([cx - 32, cy - 28, cx + 32, cy + 32], radius=10, outline=INK, width=2)
        d.line([(cx - 32, cy - 8), (cx + 32, cy - 8)], fill=INK, width=2)
        d.line([(cx - 14, cy - 36), (cx - 14, cy - 22)], fill=INK, width=2)
        d.line([(cx + 14, cy - 36), (cx + 14, cy - 22)], fill=INK, width=2)
        d.ellipse([cx - 5, cy + 7, cx + 5, cy + 17], fill=PURPLE)

    dtc(d, 480, "육아맘이 매일 1분 만에 챙기는", font(F_MED, 34), GRAY)
    dtc(d, 528, "공구 · 세일 · 육아 정보", font(F_EXB, 56), INK)
    d.line([(W // 2 - 60, 640), (W // 2 + 60, 640)], fill=LINE_GRAY, width=1)
    dtc(d, 686, "M O M C A L   M A G A Z I N E", font(F_MED, 26), LIGHT_GRAY, 0.02)
    dtc(d, 752, "저장해두면 이번 주에 또 꺼내 보실 수 있어요", font(F_MED, 28), GRAY)

    btn = "@momcal_official  >"
    fb = font(F_BLD, 32)
    bw_px = tw(d, btn, fb)
    bx1 = (W - (bw_px + 84)) / 2
    d.rounded_rectangle([bx1, 838, bx1 + bw_px + 84, 916], radius=39, fill=INK)
    dtc(d, 858, btn, fb, WHITE)
    dtc(d, 958, "팔로우하고 다음 정보도 받아가세요 :)", font(F_MED, 28), LIGHT_GRAY)
    img.save(out_path, quality=95)


# ---------------- timeline card (vertical step flow) ----------------
def timeline_card(out_path, page, total, label, title, steps, accent, tint,
                  bridge=None, footer=DATE):
    img = Image.new("RGB", (W, H), BG_WARM)
    d = ImageDraw.Draw(img)
    chrome(d, page, total, footer, False)
    y = label_box(d, label, accent, tint, False) + 38
    f_title = fit_size(d, title, F_EXB, 60, W - 160)
    dt(d, (80, y), title, f_title, INK)
    y += 130

    n = len(steps)
    limit = H - 236 if bridge else H - 180
    step_h = (limit - y) // max(1, n)
    cx = 112
    # Vertical connector line
    if n > 1:
        d.line([(cx, y + 28), (cx, y + (n - 1) * step_h + 28)], fill=(220, 214, 206), width=4)

    for i, st in enumerate(steps):
        sy = y + i * step_h
        # Circle badge
        r = 28
        fill_c = accent if i == 0 else WHITE
        txt_c = WHITE if i == 0 else accent
        d.ellipse([cx - r, sy, cx + r, sy + r * 2], fill=fill_c, outline=accent, width=3)
        f_num = font(F_EXB, 26)
        nw = tw(d, f"0{i+1}", f_num)
        dt(d, (cx - nw // 2, sy + 14), f"0{i+1}", f_num, txt_c)

        # Card box on the right
        bx1, bx2 = 172, W - 80
        by2 = sy + step_h - 22
        d.rounded_rectangle([bx1, sy - 6, bx2, by2], radius=18, fill=WHITE, outline=(232, 227, 220), width=2)
        if st.get("tag"):
            ftg = font(F_BLD, 24)
            dt_right(d, sy + 18, st["tag"], ftg, accent, margin=108)
        fh = fit_size(d, st["head"], F_BLD, 38, bx2 - bx1 - 190)
        dt(d, (bx1 + 28, sy + 14), st["head"], fh, INK)
        fd = fit_size(d, st["desc"], F_MED, 30, bx2 - bx1 - 76)
        dt(d, (bx1 + 28, sy + 72), st["desc"], fd, GRAY)

    if bridge:
        d.line([(80, H - 200), (W - 80, H - 200)], fill=LINE_GRAY, width=1)
        dt(d, (80, H - 175), bridge, fit_size(d, bridge, F_BLD, 32, W - 160), accent)
    img.save(out_path, quality=95)


# ---------------- table card (@kokoko_3sis 2-col table style) ----------------
def table_card(out_path, page, total, label, title, rows, accent, tint,
               note=None, bridge=None, footer=DATE, rh_max=176):
    img = Image.new("RGB", (W, H), BG_WARM)
    d = ImageDraw.Draw(img)
    chrome(d, page, total, footer, False)
    y = label_box(d, label, accent, tint, False) + 38
    f_title = fit_size(d, title, F_EXB, 60, W - 160)
    dt(d, (80, y), title, f_title, INK)
    y += 126

    tx1, tx2 = 80, W - 80
    lw = 270
    n = len(rows)
    avail_h = (H - 280 if note else H - 230) - y
    rh = min(rh_max, max(128, avail_h // max(1, n)))

    # Outer border
    table_h = rh * n
    d.rounded_rectangle([tx1, y, tx2, y + table_h], radius=18, fill=WHITE, outline=(224, 219, 212), width=2)
    # Left tinted column background
    d.rounded_rectangle([tx1, y, tx1 + lw, y + table_h], radius=18, fill=(244, 241, 236))
    d.rectangle([tx1 + lw - 18, y, tx1 + lw, y + table_h], fill=(244, 241, 236))

    for i, r in enumerate(rows):
        ry = y + i * rh
        if i > 0:
            d.line([(tx1, ry), (tx2, ry)], fill=(230, 226, 220), width=2)
        # Left label centered vertically
        fl = fit_size(d, r["left"], F_BLD, 32, lw - 36)
        l_w = tw(d, r["left"], fl)
        dt(d, (tx1 + (lw - l_w) // 2, ry + (rh - 34) // 2), r["left"], fl, INK)

        # Right main + sub
        rx = tx1 + lw + 32
        rw = tx2 - rx - 24
        main_col = accent if i == 0 else INK
        fm = fit_size(d, r["right"], F_EXB, 34, rw)
        if r.get("sub"):
            dt(d, (rx, ry + rh // 2 - 42), r["right"], fm, main_col)
            fs = fit_size(d, r["sub"], F_MED, 28, rw)
            dt(d, (rx, ry + rh // 2 + 8), r["sub"], fs, GRAY)
        else:
            dt(d, (rx, ry + (rh - 36) // 2), r["right"], fm, main_col)

    if note:
        dt(d, (80, y + table_h + 32), note, fit_size(d, note, F_MED, 29, W - 160), GRAY)

    if bridge:
        d.line([(80, H - 200), (W - 80, H - 200)], fill=LINE_GRAY, width=1)
        dt(d, (80, H - 175), bridge, fit_size(d, bridge, F_BLD, 32, W - 160), accent)
    img.save(out_path, quality=95)


# ---------------- 2x2 rounded cards grid ----------------
def cards_grid_card(out_path, page, total, label, title, boxes, accent, tint,
                    tip=None, bridge=None, footer=DATE):
    img = Image.new("RGB", (W, H), BG_WARM)
    d = ImageDraw.Draw(img)
    chrome(d, page, total, footer, False)
    y = label_box(d, label, accent, tint, False) + 38
    f_title = fit_size(d, title, F_EXB, 60, W - 160)
    dt(d, (80, y), title, f_title, INK)
    y += 128

    gap = 24
    cw = (W - 160 - gap) // 2
    ch = 330
    for i, b in enumerate(boxes[:4]):
        col = i % 2
        row = i // 2
        cx = 80 + col * (cw + gap)
        cy = y + row * (ch + gap)
        d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=22, fill=WHITE, outline=(228, 223, 216), width=2)
        # Number badge
        num_txt = b.get("badge", f"0{i+1}")
        fn = font(F_EXB, 26)
        nw = tw(d, num_txt, fn)
        d.rounded_rectangle([cx + 28, cy + 28, cx + 28 + nw + 28, cy + 72], radius=10, fill=tint)
        dt(d, (cx + 42, cy + 36), num_txt, fn, accent)
        # Head (up to 2 lines)
        hy = cy + 98
        for ln in b["head"].split("\n")[:2]:
            fh = fit_size(d, ln, F_EXB, 38, cw - 56)
            dt(d, (cx + 28, hy), ln, fh, INK)
            hy += 48
        # Desc lines
        dy = cy + 212
        for ln in b["desc"].split("\n")[:2]:
            fd = fit_size(d, ln, F_MED, 28, cw - 56)
            dt(d, (cx + 28, dy), ln, fd, GRAY)
            dy += 38

    if tip:
        ty = y + ch * 2 + gap + 22
        d.rounded_rectangle([80, ty, W - 80, ty + 88], radius=14, fill=tint)
        f_tip = fit_size(d, tip, F_BLD, 28, W - 220)
        dt(d, (110, ty + 29), tip, f_tip, accent)

    if bridge:
        d.line([(80, H - 200), (W - 80, H - 200)], fill=LINE_GRAY, width=1)
        dt(d, (80, H - 175), bridge, fit_size(d, bridge, F_BLD, 32, W - 160), accent)
    img.save(out_path, quality=95)


# ---------------- editorial card (@dorimomnurse pastel + highlight + KEY POINT) ----------------
def editorial_card(out_path, page, total, label, title_lines, body_paras, highlight,
                   key_points, accent, tint, bridge=None, footer=DATE):
    # Soft pastel tinted editorial background
    bg_pastel = (250, 243, 241) if accent == CORAL else (242, 245, 248)
    box_pastel = (242, 229, 225) if accent == CORAL else (228, 234, 240)
    img = Image.new("RGB", (W, H), bg_pastel)
    d = ImageDraw.Draw(img)
    chrome(d, page, total, footer, False)

    y = label_box(d, label, accent, WHITE, False) + 42
    for ln in title_lines[:2]:
        ft = fit_size(d, ln, F_EXB, 66, W - 160)
        dt(d, (80, y), ln, ft, INK, -0.03)
        y += 82
    y += 18
    # Short editorial rule
    d.line([(80, y), (168, y)], fill=accent, width=5)
    y += 48

    # Body paragraphs with optional highlighter phrase
    fb = font(F_MED, 36)
    for para in body_paras:
        if highlight and highlight in para:
            pre, post = para.split(highlight, 1)
            px = 80
            if pre:
                dt(d, (px, y), pre, fb, (55, 55, 60))
                px += tw(d, pre, fb)
            hw = tw(d, highlight, font(F_EXB, 36))
            d.rectangle([px - 4, y + 6, px + hw + 6, y + 46], fill=(255, 232, 130))
            dt(d, (px, y), highlight, font(F_EXB, 36), INK)
            px += hw + 4
            if post:
                dt(d, (px, y), post, fb, (55, 55, 60))
        else:
            dt(d, (80, y), para, fb, (55, 55, 60))
        y += 58
    y += 28

    # KEY POINT box
    ky1 = max(y + 12, 820)
    ky2 = min(H - 232 if bridge else H - 170, ky1 + 100 + len(key_points) * 62)
    d.rounded_rectangle([80, ky1, W - 80, ky2], radius=20, fill=box_pastel)
    dt(d, (118, ky1 + 34), "KEY POINT", font(F_BLD, 25), accent)
    py = ky1 + 88
    for kp in key_points:
        fk = fit_size(d, kp, F_BLD, 33, W - 236)
        dt(d, (118, py), kp, fk, INK)
        py += 60

    if bridge:
        d.line([(80, H - 200), (W - 80, H - 200)], fill=LINE_GRAY, width=1)
        dt(d, (80, H - 175), bridge, fit_size(d, bridge, F_BLD, 32, W - 160), accent)
    img.save(out_path, quality=95)


# =====================================================================
# episode builders
# =====================================================================
def build(day, cover_fn, cards, total_pages):
    out = os.path.join(ROOT, day)
    os.makedirs(out, exist_ok=True)
    cover_fn(os.path.join(out, "card_1_cover.png"))
    n = 1
    for c in cards:
        n += 1
        kind = c.get('kind', 'info')
        if kind == 'ending':
            ending(os.path.join(out, f"card_{n}_ending.png"))
        elif kind == 'visual_grid':
            visual_grid_card(os.path.join(out, f"card_{n}.png"), n, total_pages,
                             c['label'], c['title'], c['items'], c['accent'], c['tint'],
                             bridge=c.get('bridge'), footer=c.get('footer', DATE))
        elif kind == 'timeline':
            timeline_card(os.path.join(out, f"card_{n}.png"), n, total_pages,
                          c['label'], c['title'], c['steps'], c['accent'], c['tint'],
                          bridge=c.get('bridge'), footer=c.get('footer', DATE))
        elif kind == 'table':
            table_card(os.path.join(out, f"card_{n}.png"), n, total_pages,
                       c['label'], c['title'], c['rows'], c['accent'], c['tint'],
                       note=c.get('note'), bridge=c.get('bridge'), footer=c.get('footer', DATE),
                       rh_max=c.get('rh_max', 176))
        elif kind == 'cards_grid':
            cards_grid_card(os.path.join(out, f"card_{n}.png"), n, total_pages,
                            c['label'], c['title'], c['boxes'], c['accent'], c['tint'],
                            tip=c.get('tip'), bridge=c.get('bridge'), footer=c.get('footer', DATE))
        elif kind == 'editorial':
            editorial_card(os.path.join(out, f"card_{n}.png"), n, total_pages,
                           c['label'], c['title_lines'], c['body_paras'], c.get('highlight'),
                           c['key_points'], c['accent'], c['tint'],
                           bridge=c.get('bridge'), footer=c.get('footer', DATE))
        else:
            info_card(os.path.join(out, f"card_{n}.png"), n, total_pages,
                      c['label'], c['title'], c['rows'], c['accent'], c['tint'],
                      bridge=c.get('bridge'), footer=c.get('footer', DATE),
                      dark=c.get('dark', False))
    return out
