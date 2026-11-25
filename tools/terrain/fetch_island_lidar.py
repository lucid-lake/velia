#!/usr/bin/env python3
"""Fetch the USGS 3DEP lidar points over Fannette Island (public domain) from the public Entwine Point Tile copy on
AWS (s3://usgs-lidar-public, HTTP, no key), for tools/terrain/build_tahoe.py's 1 m island grid.

The 3DEP 1 m DEMs (and the dynamic service) hydro-flatten the island away: the lake polygon covers it. The points
are still in the cloud. Every EPT node that meets the island's box, at every depth, is saved as LAZ (the union of
all depths is the full-density cloud).

    .venv/bin/python -I tools/terrain/fetch_island_lidar.py [--raw .cache/terrain/raw]
"""
import argparse, json, os, sys, time, urllib.request
from pyproj import Transformer

BASE = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SierraNevada_5_2022'
BOX_UTM = (751000, 4315450, 751500, 4315950)   # E0, N0, E1, N1 (UTM 10N): the island and 150 m of water round it

def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'velia-terrain-build'}), timeout=120) as r:
                return r.read()
        except Exception as e:
            if k == tries - 1: raise
            time.sleep(3 * (k + 1))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', default=os.path.join(os.path.dirname(__file__), '..', '..', '.cache', 'terrain', 'raw'))
    a = ap.parse_args()
    out = os.path.join(a.raw, 'ept_island'); os.makedirs(out, exist_ok=True)
    ept = json.loads(get(f'{BASE}/ept.json'))
    open(os.path.join(out, 'ept.json'), 'wb').write(json.dumps(ept).encode())
    b = ept['bounds']; side = b[3] - b[0]
    t = Transformer.from_crs('EPSG:26910', 'EPSG:3857', always_xy=True)
    xs, ys = zip(*[t.transform(e, n) for e in BOX_UTM[0::2] for n in BOX_UTM[1::2]])
    bx0, bx1, by0, by1 = min(xs), max(xs), min(ys), max(ys)
    hier = {}
    def load(key):
        h = json.loads(get(f'{BASE}/ept-hierarchy/{key}.json'))
        hier.update(h)
    load('0-0-0-0')
    keys = []
    stack = ['0-0-0-0']
    while stack:
        key = stack.pop()
        if key not in hier: continue
        if hier[key] == -1: load(key)
        d, X, Y, Z = map(int, key.split('-'))
        s = side / 2 ** d
        x0, y0 = b[0] + X * s, b[1] + Y * s
        if x0 > bx1 or x0 + s < bx0 or y0 > by1 or y0 + s < by0: continue
        if hier.get(key, 0) > 0: keys.append(key)
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    stack.append(f'{d + 1}-{2 * X + dx}-{2 * Y + dy}-{2 * Z + dz}')
    print(f'{len(keys)} nodes meet the island box; depths {min(int(k.split("-")[0]) for k in keys)}–{max(int(k.split("-")[0]) for k in keys)}')
    total = 0
    for key in keys:
        p = os.path.join(out, f'{key}.laz')
        if not os.path.exists(p) or os.path.getsize(p) == 0:
            data = get(f'{BASE}/ept-data/{key}.laz'); open(p, 'wb').write(data)
        total += os.path.getsize(p)
    print(f'saved {total / 1e6:.1f} MB in {out}')

if __name__ == '__main__':
    main()
