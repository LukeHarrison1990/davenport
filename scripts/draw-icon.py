#!/usr/bin/env python3
# Regenerates the app icons: python3 scripts/draw-icon.py <outdir>  (then copy into build/ and app/renderer/public/)
# Davenport icon: white envelope on an ink-blue tile, sealed with a brass "D" wax seal. Geometry on a 64-unit grid.
from PIL import Image, ImageDraw
import sys
def render(px, tile=True, detail=None):
    S = px * 4
    k = S / 64
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda x, y: (x * k, y * k)
    if detail is None: detail = px >= 40
    if tile:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=14 * k, fill=(31, 58, 95, 255))
    small = px <= 24
    x0, x1, y0, y1 = ((6, 58, 15, 50) if small else (9, 55, 17, 49)) if tile else (4, 60, 12, 52)
    # envelope body
    d.rounded_rectangle([*P(x0, y0), *P(x1, y1)], radius=4.5 * k, fill=(255, 255, 255, 255))
    cx = (x0 + x1) / 2
    tip = y0 + (y1 - y0) * 0.6
    # lower folds
    w = max(1, round(1.8 * k))
    if not small:
        d.line([P(x0 + 1.5, y1 - 1.5), P(cx - 6, tip + 1)], fill=(200, 212, 228, 255), width=w)
        d.line([P(x1 - 1.5, y1 - 1.5), P(cx + 6, tip + 1)], fill=(200, 212, 228, 255), width=w)
    # flap
    d.polygon([P(x0 + 0.8, y0 + 1.6), P(x1 - 0.8, y0 + 1.6), P(cx, tip)], fill=(222, 230, 241, 255))
    d.line([P(x0 + 0.8, y0 + 1.6), P(cx, tip), P(x1 - 0.8, y0 + 1.6)], fill=(176, 193, 216, 255), width=w, joint='curve')
    # wax seal
    r = (9 if small else 8.2) if tile else 9.5
    sy = tip
    d.ellipse([*P(cx - r, sy - r), *P(cx + r, sy + r)], fill=(201, 161, 92, 255))
    d.ellipse([*P(cx - r + 1.6, sy - r + 1.6), *P(cx + r - 1.6, sy + r - 1.6)], outline=(170, 128, 62, 255), width=max(1, round(1.1 * k)))
    if detail:
        # "D" monogram in the seal: an upright with a half-round bowl
        ink = (92, 64, 26, 255)
        lw = max(1, round(1.8 * k))
        h = r * 0.5
        bx = cx - h * 0.55
        d.line([P(bx, sy - h), P(bx, sy + h)], fill=ink, width=lw)
        d.arc([*P(bx - h, sy - h), *P(bx + h, sy + h)], start=-90, end=90, fill=ink, width=lw)
    return img.resize((px, px), Image.LANCZOS)

if __name__ == '__main__':
    out = sys.argv[1]
    import os
    render(1024).save(f'{out}/icon.png')
    sizes = [16, 24, 32, 48, 64, 128, 256, 512]
    os.makedirs(f'{out}/icons', exist_ok=True)
    imgs = {s: render(s) for s in sizes}
    for s, im in imgs.items(): im.save(f'{out}/icons/{s}x{s}.png')
    imgs[256].save(f'{out}/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)], append_images=[imgs[s] for s in [16,24,32,48,64,128]])
    render(32).save(f'{out}/tray.png')
    # preview sheet
    sheet = Image.new('RGBA', (900, 300), (238, 240, 243, 255))
    x = 20
    for s in [256, 128, 64, 48, 32, 24, 16]:
        sheet.paste(imgs.get(s) or render(s), (x, 20 + (256 - s) // 2), imgs.get(s) or render(s)); x += s + 20
    dark = Image.new('RGBA', (900, 40), (31, 58, 95, 255))
    sheet.paste(dark, (0, 260))
    sheet.save(f'{out}/preview.png')
