import subprocess, sys
subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "--quiet"])

from PIL import Image, ImageDraw, ImageFont
import os

OUT = r"C:\Users\robert.barnett\Desktop\pktSolution"
FONTS = r"C:\Windows\Fonts"

# Brand colors
PKT_COLOR  = (147, 197, 253)   # #93c5fd  light blue
SOL_COLOR  = (100, 116, 139)   # #64748b  muted slate
BG_COLOR   = (8,   13,  24)    # #080d18  site dark
DOT_COLOR  = (51,  65,  85)    # #334155

BAR_COLORS = [
    (96,  165, 250),  # pktFlow  blue
    (45,  212, 191),  # pktSNMP  teal
    (74,  222, 128),  # pktLog   green
    (167, 139, 250),  # pktPCAP  purple
    (226, 232, 240),  # pktHub   white
]

def lerp_color(colors, t):
    t = max(0.0, min(1.0, t))
    seg = t * (len(colors) - 1)
    i = min(int(seg), len(colors) - 2)
    f = seg - i
    c1, c2 = colors[i], colors[i+1]
    return tuple(int(c1[j] + f*(c2[j]-c1[j])) for j in range(3))

def draw_bar(draw, x, y, w, h, colors):
    for row in range(h):
        color = lerp_color(colors, row / max(h-1, 1))
        draw.line([(x, y+row), (x+w-1, y+row)], fill=color+(255,))

# ── LOGO PNG ──────────────────────────────────────────────────────────────────
H = 96
PAD = 18
BAR_W = 6
GAP = 14
DOT_R = 3

font_pkt = ImageFont.truetype(os.path.join(FONTS, "courbd.ttf"), 68)
font_sol = ImageFont.truetype(os.path.join(FONTS, "segoeui.ttf"), 42)

pb = font_pkt.getbbox("pkt")
sb = font_sol.getbbox("Solution")
pkt_w = pb[2] - pb[0]
sol_w = sb[2] - sb[0]

W = PAD + BAR_W + GAP + pkt_w + GAP*2 + sol_w + PAD

img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

draw_bar(draw, PAD, PAD, BAR_W, H - PAD*2, BAR_COLORS)

pkt_x = PAD + BAR_W + GAP
pkt_y = (H - (pb[3]-pb[1]))//2 - pb[1]
draw.text((pkt_x, pkt_y), "pkt", font=font_pkt, fill=PKT_COLOR+(255,))

dot_x = pkt_x + pkt_w + GAP
dot_y = H // 2
draw.ellipse([dot_x-DOT_R, dot_y-DOT_R, dot_x+DOT_R, dot_y+DOT_R], fill=DOT_COLOR+(255,))

sol_x = dot_x + GAP
sol_y = (H - (sb[3]-sb[1]))//2 - sb[1]
draw.text((sol_x, sol_y), "Solution", font=font_sol, fill=SOL_COLOR+(255,))

# Transparent version
img.save(os.path.join(OUT, "pktSolution-logo.png"))
print(f"Logo PNG saved  ({W}x{H})")

# ── FAVICON ───────────────────────────────────────────────────────────────────
def make_favicon(size):
    fav = Image.new("RGBA", (size, size), BG_COLOR+(255,))
    d   = ImageDraw.Draw(fav)
    bw  = max(3, size // 8)
    draw_bar(d, 0, 0, bw, size, BAR_COLORS)

    fnt_size = int(size * 0.62)
    fnt = ImageFont.truetype(os.path.join(FONTS, "courbd.ttf"), fnt_size)
    bb  = fnt.getbbox("p")
    px  = bw + (size - bw - (bb[2]-bb[0]))//2 - bb[0]
    py  = (size - (bb[3]-bb[1]))//2 - bb[1]
    d.text((px, py), "p", font=fnt, fill=PKT_COLOR+(255,))
    return fav

fav32 = make_favicon(32)
fav48 = make_favicon(48)
fav16 = fav32.resize((16, 16), Image.LANCZOS)

fav32.save(os.path.join(OUT, "favicon.png"))
print("favicon.png saved  (32x32)")

# ICO with 16, 32, 48 embedded
fav48.save(
    os.path.join(OUT, "favicon.ico"),
    format="ICO",
    sizes=[(16,16),(32,32),(48,48)]
)
print("favicon.ico saved  (16+32+48)")
print("All done.")
