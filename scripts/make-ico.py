"""Builds Windows .ico files the way Windows expects: classic 32-bit bitmaps for 16–128 px, PNG only for 256 px.

Some parts of Windows (the taskbar and Explorer's small icons in particular) can't draw PNG-compressed small icons
from a program file and show a blank page instead.

Usage: python3 scripts/make-ico.py <png-folder> <out.ico> [sizes...]
The folder holds <size>x<size>.png files (as produced by scripts/render-icon.js).
"""
import io
import struct
import sys
from pathlib import Path

from PIL import Image


def dib(img: Image.Image) -> bytes:
    w, h = img.size
    px = img.convert('RGBA').load()
    header = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    xor = bytearray()
    for y in range(h - 1, -1, -1):  # bottom-up rows
        for x in range(w):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))
    row = ((w + 31) // 32) * 4  # 1-bit AND mask, rows padded to 32 bits; alpha does the real work
    and_mask = bytearray(row * h)
    for y in range(h - 1, -1, -1):
        for x in range(w):
            if px[x, y][3] == 0:
                i = (h - 1 - y) * row + x // 8
                and_mask[i] |= 0x80 >> (x % 8)
    return header + bytes(xor) + bytes(and_mask)


def main() -> None:
    folder, out = Path(sys.argv[1]), Path(sys.argv[2])
    sizes = [int(s) for s in sys.argv[3:]] or [16, 20, 24, 32, 40, 48, 64, 128, 256]
    images = []
    for s in sizes:
        src = folder / f'{s}x{s}.png'
        img = Image.open(src) if src.exists() else Image.open(folder / '512x512.png').resize((s, s), Image.LANCZOS)
        img = img.convert('RGBA')
        if s >= 256:
            buf = io.BytesIO()
            img.save(buf, 'PNG')
            data = buf.getvalue()
        else:
            data = dib(img)
        images.append((s, data))
    head = struct.pack('<HHH', 0, 1, len(images))
    entries, blobs = b'', b''
    offset = 6 + 16 * len(images)
    for s, data in images:
        entries += struct.pack('<BBBBHHII', s % 256, s % 256, 0, 0, 1, 32, len(data), offset + len(blobs))
        blobs += data
    out.write_bytes(head + entries + blobs)
    print(f'{out}: {", ".join(f"{s}{" (png)" if s >= 256 else ""}" for s, _ in images)}')


if __name__ == '__main__':
    main()
