#!/usr/bin/env python3
"""NAIP -> Velia's ground albedo.

    .venv/bin/python -I tools/ground/build_naip.py --raw .cache/naip/raw --work .cache/naip/work --out terrain/naip

Per level (bay 1 m; region = the lake's box at 16 m; the quality tiers take the 2x and 4x box-downsamples):
  1. warp the 4-band NAIP (R G B NIR, UTM 10N) to the world frame (naip_warp.py), area-averaged to the texel
  2. linearise (sRGB), NDVI from the raw bands, water from the game's own DEM (< 0.15 m above the lake)
  3. de-light with the game's DEM at the capture sun: divide by the Lambert ratio at STRENGTH (60 %), gain 0.6-1.6,
     lift the cast terrain shadow, compress the darkest tail (below the 10th percentile) so no pixel is black
  4. classes by NDVI and shore (forest, brush, bare, sand); each class's median lands on the albedo targets (TARGET below)
     (a smooth gain, so class edges do not show); the chroma stays the photo's
  5. water pixels take the nearest land colour (no blue fringe in the shore's mips)
  6. write sRGB WebP; every file carries the class index in alpha (64 + 191 * (forest + brush / 2): 64 bare .. 255
     forest; one scalar interpolates safely, so no separate cover texture is bound: the shader's sampler budget is 16.
     It replaces the NLCD cover (30 m) as the ground's forest / brush / rock classes)
The capture: the index gives 2022-07-21 (USDA FSA, 0.6 m, 4 band); the time of day is not published, so the sun's azimuth
is fitted from the image itself (bare-rock luminance vs the DEM's Lambert shading: 144 deg) and the elevation is the solar
formula's at that azimuth (68 deg, about 12:05 PDT) - see SUN below.
"""
import argparse, json, math, os, sys
import numpy as np
from scipy import ndimage
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lsh, naip_warp
from naip_frame import LEVELS, REPO, REGION_LEVELS

SUN = dict(az=144.0, el=68.0, date='2022-07-21', note='azimuth fitted from the image; elevation from the NOAA formula at that azimuth; flight time not published')
STRENGTH = 0.6
SATURATION = 1.2   # NAIP's high-sun frame is greyer than the ground seen from the lake (Commons 2011 photo): chroma x 1.2, luminance kept
# albedo targets (linear luminance). The world is exposed so ground reads about 6.5 x its albedo.
TARGET = dict(forest=0.0105, brush=0.0185, bare=0.040, sand=0.30)
PLAN = {'bay': dict(texel=1, tiers=[1, 2, 4]), 'region': dict(texel=16, tiers=[16, 32, 64]),
        'south': dict(texel=4, tiers=[4, 8]), 'rubicon': dict(texel=4, tiers=[4, 8])}   # the south region (4 m desktop, 8 m phones): de-lit on its own 4 m DEM

def srgb2lin(v):
    v = v / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)
def lin2srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055).astype(np.float32)
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
def lum(rgb): return rgb[0] * LUM[0] + rgb[1] * LUM[1] + rgb[2] * LUM[2]
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def sun_vec():
    a, e = math.radians(SUN['az']), math.radians(SUN['el'])
    return np.array([math.sin(a) * math.cos(e), math.sin(e), -math.cos(a) * math.cos(e)])   # x east, y up, z south

def cast_shadow(dem, texel, maxd=2500.0):
    """1 where the terrain shadows the point from the sun (ray march along the sun's azimuth)."""
    s = sun_vec(); dx, dz = s[0] / math.hypot(s[0], s[2]), s[2] / math.hypot(s[0], s[2]); t = math.tan(math.radians(SUN['el']))
    h, w = dem.shape; jj, ii = np.mgrid[0:h, 0:w].astype(np.float32)
    shade = np.zeros(dem.shape, np.float32); d = texel * 2.0
    while d < maxd:
        fi = np.clip(ii + dx * d / texel, 0, w - 1.001); fj = np.clip(jj + dz * d / texel, 0, h - 1.001)
        hh = ndimage.map_coordinates(dem, [fj, fi], order=1)
        shade = np.maximum(shade, smooth(0.0, 2.0, hh - dem - d * t))
        d *= 1.25
    return shade

def process(level, texel, raw, work, lv):
    L = LEVELS[level]
    cache = os.path.join(work, f'rgbn_{level}_{texel:g}m.npy')
    if os.path.exists(cache): d = np.load(cache)
    else:
        d = naip_warp.warp(raw, level, texel); np.save(cache, d)
    h, w = d.shape[1:]
    xs = L['x0'] + (np.arange(w) + 0.5) * texel; zs = L['z0'] + (np.arange(h) + 0.5) * texel
    dem = lsh.composite(lv, xs, zs).astype(np.float32)
    rgb = srgb2lin(d[:3].astype(np.float32)); nir = d[3].astype(np.float32); r = d[0].astype(np.float32)
    ndvi = (nir - r) / (nir + r + 1.0)
    water = smooth(0.35, -0.05, dem)                                            # 1 on the lake
    # --- de-light ---------------------------------------------------------------------------------------------------
    dsm = ndimage.gaussian_filter(dem, max(1.0, 12.0 / texel))                   # the slope seen at 12 m or more
    gz, gx = np.gradient(dsm, texel)
    s = sun_vec(); nl = np.sqrt(gx * gx + 1 + gz * gz)
    lam = np.maximum((-gx * s[0] + s[1] - gz * s[2]) / nl, 0.05) / s[1]            # 1 on flat ground
    gain = 1.0 / (1.0 + STRENGTH * (lam - 1.0)); gain = np.clip(gain, 0.6, 1.6)
    if texel <= 2: gain *= 1.0 + 0.45 * cast_shadow(dem, texel)                     # cast terrain shadow, lifted
    rgb *= gain[None]
    L0 = lum(rgb); land = water < 0.5
    p10 = np.percentile(L0[land][::7], 10)
    comp = np.where(L0 < p10, p10 * np.power(np.maximum(L0, 1e-5) / p10, 0.6) / np.maximum(L0, 1e-5), 1.0).astype(np.float32)
    rgb *= comp[None]                                                              # compress the darkest tail
    # --- classes ------------------------------------------------------------------------------------------------------
    # In this NAIP conifers and shrubs share an NDVI (0.3 vs 0.4); the conifer crown is the darker in the near infrared
    # (NIR 100-130 against 150-165 for brush and meadow). Vegetated by NDVI, forest by the low NIR, brush the rest.
    sg = max(0.5, 3.0 / texel) if texel < 8 else 0.0
    nd = ndimage.gaussian_filter(ndvi, sg) if sg else ndvi
    nr = ndimage.gaussian_filter(nir, sg) if sg else nir
    veg = smooth(0.12, 0.25, nd)
    forest = veg * smooth(148.0, 118.0, nr)
    brush = veg * (1 - forest)
    bare = np.clip(1 - veg, 0, 1)
    shoreH = smooth(3.5, 1.0, dem) * smooth(0.0, 0.5, dem)
    Lb = lum(rgb)
    sand = bare * shoreH * smooth(0.10, 0.25, Lb)                                  # bright flat ground at the water's edge
    bare = bare - sand
    landw = 1 - water
    W = dict(forest=forest * landw, brush=brush * landw, bare=bare * landw, sand=sand * landw)
    sel = (water < 0.5) & (dem < 3000)
    med = {k: float(np.median(Lb[sel & (W[k] > 0.6)])) if np.any(sel & (W[k] > 0.6)) else 0.0 for k in W}
    logg = np.zeros_like(Lb); wsum = np.zeros_like(Lb)
    for k in W:
        if med[k] > 0: logg += W[k] * math.log(TARGET[k] / med[k]); wsum += W[k]
    g = np.exp(logg / np.maximum(wsum, 1e-3)); g = ndimage.gaussian_filter(g, max(0.5, 2.0 / texel)) if texel < 8 else g
    rgb *= g[None]
    Lg = lum(rgb)
    rgb = np.maximum(Lg[None] + (rgb - Lg[None]) * SATURATION, 0)
    # --- water: the nearest land colour ---------------------------------------------------------------------------------
    wm = water > 0.5
    if wm.any() and (~wm).any():
        idx = ndimage.distance_transform_edt(wm, return_distances=False, return_indices=True)
        rgb = rgb[:, idx[0], idx[1]]
    info = dict(level=level, texel=texel, w=int(w), h=int(h), median_before=med, targets=TARGET,
                gain_class={k: (TARGET[k] / med[k] if med[k] else None) for k in W}, p10=float(p10),
                share={k: float((W[k][sel]).mean()) for k in W})
    return rgb, W, dem, info

def save_webp(rgb_lin, path, q=80, alpha=None):
    a = np.clip(lin2srgb(rgb_lin) * 255 + 0.5, 0, 255).astype(np.uint8)
    if alpha is None:
        im = Image.fromarray(np.moveaxis(a, 0, -1), 'RGB'); im.save(path, 'WEBP', quality=q, method=5)
    else:   # alpha is the class index (never 0, so no decoder drops the colour under it); exact keeps it
        rgba = np.concatenate([np.moveaxis(a, 0, -1), np.clip(alpha, 0, 255).astype(np.uint8)[..., None]], axis=-1)
        Image.fromarray(rgba, 'RGBA').save(path, 'WEBP', quality=q, method=5, exact=True, alpha_quality=100)
    return os.path.getsize(path)

def box(a, k):   # area average by k in linear light
    c, h, w = a.shape; return a[:, :h // k * k, :w // k * k].reshape(c, h // k, k, w // k, k).mean(axis=(2, 4))

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True); ap.add_argument('--work', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--levels', default='bay,region'); ap.add_argument('--q', type=int, default=80)
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True); os.makedirs(a.out, exist_ok=True)
    meta = dict(source='USDA FSA NAIP 2022 (4-band, 0.6 m), USGS National Map NAIP Plus ImageServer', capture=SUN['date'], sun=SUN,
                strength=STRENGTH, targets=TARGET, levels={})
    for name in a.levels.split(','):
        P = PLAN[name]
        man, lv = lsh.load(os.path.join(REPO, 'terrain'), (name,) if name in REGION_LEVELS else ())
        rgb, W, dem, info = process(name, P['texel'], a.raw, a.work, lv)
        info['files'] = {}
        for k in P['tiers']:
            f = k // P['texel']
            im = rgb if f == 1 else box(rgb, f)
            idx = (W['forest'] + 0.5 * W['brush']).astype(np.float32)   # the class index at this texel: forest 255, brush ~160, bare 64
            al = np.round(64 + 191 * (idx if f == 1 else box(idx[None], f)[0]))
            p = os.path.join(a.out, f'albedo-{name}-{k}m.webp'); n = save_webp(im, p, a.q, al)
            info['files'][f'{k}'] = dict(file=os.path.basename(p), w=int(im.shape[2]), h=int(im.shape[1]), bytes=n)
            print(name, k, 'm', im.shape, f'{n/1e6:.1f} MB', flush=True)
        info.update(extent=dict(L := LEVELS[name]))
        meta['levels'][name] = info
        print(json.dumps({k: info[k] for k in ('median_before', 'gain_class', 'share')}), flush=True)
    p = os.path.join(a.out, 'naip.json')
    old = json.load(open(p)) if os.path.exists(p) else {}
    meta['levels'] = {**old.get('levels', {}), **meta['levels']}
    json.dump(meta, open(p, 'w'), indent=1)
