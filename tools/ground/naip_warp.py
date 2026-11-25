#!/usr/bin/env python3
"""NAIP tiles (UTM 10N GeoTIFFs from fetch_naip.py) -> one level's world-frame raster, as .npy uint8 [4, h, w]
(R, G, B, NIR), area-averaged to the target texel. The world frame is src/geo.js's (tools/ground/naip_frame.py).

    .venv/bin/python -I tools/ground/naip_warp.py --raw .cache/naip/raw --level bay --texel 1 --out .cache/naip/work
"""
import argparse, glob, os, sys
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.warp import reproject, Resampling
from rasterio.transform import Affine
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from naip_frame import LEVELS, PROJ

def warp(raw, level, texel, prefix=None):
    L = LEVELS[level]
    files = sorted(glob.glob(os.path.join(raw, f'naip_{prefix or level}_*.tif')))
    if not files: sys.exit(f'no naip_{level}_*.tif in {raw}')
    srcs = [rasterio.open(f) for f in files]
    arr, tr = merge(srcs, nodata=0)                      # [4, H, W] in UTM
    crs = srcs[0].crs
    for s in srcs: s.close()
    w = int(round((L['x1'] - L['x0']) / texel)); h = int(round((L['z1'] - L['z0']) / texel))
    dst = np.zeros((4, h, w), np.uint8)
    # north-up in the tmerc frame: row j has northing -(z0 + (j + .5) texel)
    dtr = Affine(texel, 0, L['x0'], 0, -texel, -L['z0'])
    for b in range(4):
        reproject(arr[b], dst[b], src_transform=tr, src_crs=crs, dst_transform=dtr, dst_crs=PROJ,
                  resampling=Resampling.average, src_nodata=None)
    return dst

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True); ap.add_argument('--level', required=True)
    ap.add_argument('--texel', type=float, required=True); ap.add_argument('--out', required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    d = warp(a.raw, a.level, a.texel)
    p = os.path.join(a.out, f'rgbn_{a.level}_{a.texel:g}m.npy'); np.save(p, d)
    print(p, d.shape, [float(d[b].mean()) for b in range(4)])
