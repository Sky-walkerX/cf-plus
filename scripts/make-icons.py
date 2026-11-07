"""Render CF+ toolbar icons (no dependencies). Usage: python3 scripts/make-icons.py public/icons"""
import struct, sys, zlib, os

def png(w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

def hexc(s):
    s = s.lstrip('#'); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))

# Shapes in a 0..1 unit square: (kind, params, color)
BG = hexc('#161a20')
SHAPES = [
    ('rrect', (0.0, 0.0, 1.0, 1.0, 0.22), BG),
    ('rrect', (0.17, 0.40, 0.33, 0.80, 0.05), hexc('#f2c94c')),   # yellow bar
    ('rrect', (0.38, 0.24, 0.54, 0.80, 0.05), hexc('#5b8def')),   # blue bar
    ('rrect', (0.59, 0.52, 0.75, 0.80, 0.05), hexc('#ef5b5b')),   # red bar
    ('rrect', (0.735, 0.13, 0.785, 0.37, 0.02), hexc('#e3e6ea')),  # plus vertical
    ('rrect', (0.64, 0.225, 0.88, 0.275, 0.02), hexc('#e3e6ea')),  # plus horizontal
]

def inside(kind, p, x, y):
    x0, y0, x1, y1, r = p
    if not (x0 <= x <= x1 and y0 <= y <= y1): return False
    cx = min(max(x, x0 + r), x1 - r); cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def render(n, ss=6):
    px = []
    for j in range(n):
        for i in range(n):
            acc = [0, 0, 0, 0]
            for sj in range(ss):
                for si in range(ss):
                    x = (i + (si + 0.5) / ss) / n; y = (j + (sj + 0.5) / ss) / n
                    col = None
                    for kind, p, c in SHAPES:
                        if inside(kind, p, x, y): col = c
                    if col:
                        acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            k = ss * ss; a = acc[3] / 255
            px += [int(acc[0] / a) if a else 0, int(acc[1] / a) if a else 0, int(acc[2] / a) if a else 0, int(acc[3] / k)]
    return px

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for n in (16, 32, 48, 128):
    open(os.path.join(out, f'{n}.png'), 'wb').write(png(n, n, render(n)))
print('icons written to', out)
