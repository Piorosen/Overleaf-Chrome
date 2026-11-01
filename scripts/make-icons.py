#!/usr/bin/env python3
"""Generate the extension icons (green rounded square + white sparkle). Stdlib only."""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'extension', 'icons')
GREEN = (9, 136, 66)
SS = 4  # supersampling factor per axis


def inside_rounded_square(x, y, r):
    # unit square [0,1]^2 with corner radius r
    cx = min(max(x, r), 1 - r)
    cy = min(max(y, r), 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def inside_sparkle(x, y, cx, cy, size):
    # 4-point star: |dx|^p + |dy|^p <= size^p with p < 1 (astroid-like)
    dx = abs(x - cx) / size
    dy = abs(y - cy) / size
    p = 0.55
    return dx ** p + dy ** p <= 1.0


def render(n):
    rows = []
    for py in range(n):
        row = bytearray([0])  # filter: none
        for px in range(n):
            bg = fg = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / n
                    y = (py + (sy + 0.5) / SS) / n
                    if inside_rounded_square(x, y, 0.22):
                        bg += 1
                        if inside_sparkle(x, y, 0.5, 0.5, 0.34) or inside_sparkle(x, y, 0.76, 0.25, 0.11):
                            fg += 1
            total = SS * SS
            a = bg / total
            if a == 0:
                row += bytes((0, 0, 0, 0))
                continue
            t = fg / bg  # share of white within the shape
            r, g, b = (round(c * (1 - t) + 255 * t) for c in GREEN)
            row += bytes((r, g, b, round(a * 255)))
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for n in (16, 32, 48, 128):
        path = os.path.join(OUT_DIR, f'icon{n}.png')
        with open(path, 'wb') as f:
            f.write(render(n))
        print('wrote', os.path.normpath(path))


if __name__ == '__main__':
    main()
