#!/usr/bin/env python3
"""Build Velia's real Lake Tahoe terrain assets from public-domain US data.

    bash tools/terrain/fetch_tahoe.sh [raw root]          # the raw downloads (.cache/terrain/raw, git-ignored)
    .venv/bin/python -I tools/terrain/build_tahoe.py [--raw DIR] [--out terrain]
    .venv/bin/python -I tools/terrain/build_tahoe.py --region south    # one region level (REGIONS), into terrain/south/

Inputs (all US federal works, public domain; ATTRIBUTION.md):
  - USGS 3DEP Bare Earth DEM (dynamic service; 1 m lidar round the lake, 1/3 arc-second elsewhere), UTM 10N NAD83
  - USGS Lake Tahoe bathymetry (Gardner, Mayer, Hughes Clarke 1998 multibeam; DDS-55), 10 m, UTM 10N WGS84
  - USGS/MRLC NLCD 2021 land cover (30 m, Albers)

Outputs (terrain/, committed): tahoe.json (the manifest) and one .lsh file per grid: gzip of a 2-D-predicted
uint16 grid, hi bytes then lo bytes (src/terrain-data.js decodes it). The world frame is src/geo.js's: a transverse
Mercator centred on Fannette Island's summit, x east, z south (= -northing), y = elevation - Y0 (the lake surface).
"""
import argparse, glob, gzip, json, math, os, sys
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.warp import reproject, Resampling
from rasterio.transform import Affine
from pyproj import Transformer
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

# --- the frame (keep in step with src/geo.js) ------------------------------------------------------------------
def read_geo_js():
    # the origin moved from src/geo.js into the lake's profile (src/sim/geo.js reads waters.lat, waters.lon)
    w = json.load(open(os.path.join(REPO, 'src', 'waters', 'tahoe-emerald.json')))
    return float(w['lat']), float(w['lon'])

LAT0, LON0 = read_geo_js()
PROJ = f'+proj=tmerc +lat_0={LAT0} +lon_0={LON0} +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs'
TO_UTM = Transformer.from_crs(PROJ, 'EPSG:26910', always_xy=True)
FROM_UTM = Transformer.from_crs('EPSG:26910', PROJ, always_xy=True)

# --- the levels: name, spacing m, x0, z0 (the north-west texel centre), width, height (texels) -------------------
# Heights for every level; the shore distance on the levels that hold shore; cover on the lake level.
LEVELS = [
    dict(name='island', step=1.0, x0=-191.5, z0=-191.5, w=384, h=384, src='dem1m_bay', smooth=0.0),
    dict(name='bay', step=2.0, x0=-2303.0, z0=-1791.0, w=2816, h=1792, src='dem1m_bay', smooth=0.8),
    dict(name='basin', step=10.0, x0=-10235.0, z0=-10235.0, w=2048, h=2048, src='dem10m_basin', smooth=0.0),
    dict(name='lake', step=32.0, x0=-13984.0, z0=-45984.0, w=1280, h=1920, src='dem30m_lake', smooth=0.0),
    dict(name='ring', step=96.0, x0=-49104.0, z0=-49104.0, w=1024, h=1024, src='dem100m_ring', smooth=0.0),
]
H_OFFSET, H_STEP = -600.0, 0.05            # uint16 q: y = H_OFFSET + q * H_STEP  (-600 .. +2676 m)
BATHY_SURFACE = 1899.0                     # the survey's own water line (its grid's highest value, Aug 1998): depths
                                           # are taken below it and hung under today's surface (the level change ignored)
D_STEP = 0.5                               # shore distance int16 (stored + 32768) * 0.5 m: +-16 km
D_SUB = {'island': 1, 'bay': 2, 'basin': 2, 'lake': 2, 'ring': 1}   # the distance grid: every k-th texel

# --- the region levels (--region NAME): a fine level over one shore away from the bay, built alone into terrain/NAME/
# with its own manifests (NAME.json, NAME-phone.json), in the lake-wide frame and codes (y0 from terrain/tahoe.json, so
# the region's heights meet the shipped levels'). The loader picks one by the birthplace's region; the lake-wide levels
# are not rebuilt. Each holds heights, the shore distance (every dk-th texel) and NLCD cover (every ck-th texel), and a
# phone set: the heights' f x f block means (as tools/terrain/phone_terrain.mjs), the distance every pdk-th texel.
#   south: South Lake Tahoe, Camp Richardson to Stateline: world x 6,992 to 14,512, z -1,504 to 3,008 (texel edges) at
#   4 m; the heights from the 3DEP 1 m lidar, smoothed (a Gaussian of `smooth` source texels) and read at the texel
#   centres; the bed from DDS-55 by the seamless rules (seamless_bed, the bay's method): the survey's gaps (45 % of the
#   box's water, up to 1.4 km off the shore) take a harmonic fill between the surveyed depths and the 1:6 shelf off the
#   shore in place of the nearest surveyed depth (its fans), the surveyed cells kept (keep_survey); within bed_ease m of
#   the box's edge it eases into the lake-wide (first build's) bed, the one the 10 m and 32 m levels round it carry
# The pin "Off Ski Run" (the south-lake region's first birthplace): world (11,800, -875), 22.85 m deep on the survey's own
# cells, 1.28 km north-west of Ski Run Marina's pier; east of it (the afternoon start, heading 95 deg) the water stays
# deeper than 11 m for 1 km and deeper than 3 m for 1.2 km. Nearer the pier the survey is 11-14 m at its edge (1.6 km
# out); the 22 m the nearest fill drew 800 m north of the pier was one of its fans
REGIONS = {
    'south': dict(name='south', step=4.0, x0=6994.0, z0=-1502.0, w=1880, h=1128, src='dem1m_south', smooth=1.6,
                  flat=0.15, dk=1, ck=2, phone=2, pdk=2, bed='seamless', bed_ease=200.0),
    # rubicon: Rubicon Point and the D.L. Bliss cliffs on the west shore, 4 km north of Emerald Bay's mouth: world x -900 to
    # 1,700, z -6,300 to -3,700 (texel edges) at 4 m, by the same rules as the south's. The pin "Rubicon Point" (the
    # tahoe-west region's birthplace) sits 250 m north-east of the point's tip, over the drop-off
    'rubicon': dict(name='rubicon', step=4.0, x0=-898.0, z0=-6298.0, w=650, h=650, src='dem1m_rubicon', smooth=1.6,
                    flat=0.15, dk=1, ck=2, phone=2, pdk=2, bed='seamless', bed_ease=200.0),
}

def world_grid(L, k=1):
    xs = L['x0'] + np.arange(0, L['w'], k) * L['step']
    zs = L['z0'] + np.arange(0, L['h'], k) * L['step']
    return xs, zs

def mosaic(raw, prefix):
    files = sorted(glob.glob(os.path.join(raw, prefix + '_*.tif')))
    if not files: sys.exit(f'missing {prefix}_*.tif in {raw}: run tools/terrain/fetch_tahoe.sh')
    srcs = [rasterio.open(f) for f in files]
    arr, tr = merge(srcs, nodata=-9999.0)
    for s in srcs: s.close()
    a = arr[0].astype(np.float64); a[a <= -9000] = np.nan
    return a, tr

def sample(arr, tr, X, Y, order=1):
    """bilinear sample of a north-up raster (affine tr) at UTM points X, Y (texel centres at +0.5)"""
    col = (X - tr.c) / tr.a - 0.5; row = (Y - tr.f) / tr.e - 0.5
    nan = np.isnan(arr)
    filled = np.where(nan, 0.0, arr)
    v = ndimage.map_coordinates(filled, [row, col], order=order, mode='nearest')
    m = ndimage.map_coordinates((~nan).astype(np.float64), [row, col], order=order, mode='nearest')
    with np.errstate(invalid='ignore', divide='ignore'):
        out = np.where(m > 0.5, v / np.maximum(m, 1e-9), np.nan)
    return out

def utm_of(L, k=1):
    xs, zs = world_grid(L, k)
    XX, ZZ = np.meshgrid(xs, zs)
    E, N = TO_UTM.transform(XX, -ZZ)
    return np.asarray(E), np.asarray(N)

def read_bathy(raw):
    """USGS DDS-55 lt_bathy.e00 (ArcInfo export grid): 1992 x 3416, 10 m, elevations (m), rows from the north"""
    p = os.path.join(raw, 'lt_bathy.e00')
    if not os.path.exists(p):
        g = p + '.gz'
        if not os.path.exists(g): sys.exit('missing lt_bathy.e00(.gz): run tools/terrain/fetch_tahoe.sh')
        with gzip.open(g, 'rb') as f, open(p, 'wb') as o: o.write(f.read())
    with open(p) as f:
        lines = f.read().split('\n')
    ncols, nrows = map(int, lines[2].split()[:2])
    cell = float(lines[3].split()[0])
    xmin, ymin = map(float, lines[4].split()); xmax, ymax = map(float, lines[5].split())
    per_row = math.ceil(ncols / 5)
    body = lines[6:6 + nrows * per_row]
    vals = np.empty((nrows, ncols), np.float64)
    for r in range(nrows):
        s = ''.join(body[r * per_row:(r + 1) * per_row])
        vals[r] = np.array([float(s[i:i + 14]) for i in range(0, ncols * 14, 14)])
    vals[vals < -1e30] = np.nan
    tr = Affine(cell, 0, xmin, 0, -cell, ymax)
    return vals, tr

def island_from_lidar(raw, Y0):
    """Fannette Island at 1 m from the 2022 lidar points (tools/terrain/fetch_island_lidar.py): the 1 m DEMs flatten it
    into the lake, and the cloud labels its points water (9) or unclassified (1). The ground: each 1 m cell's lowest
    return, then a grey opening (a 5 m disc) takes off the trees; cells within 1 m of the opened surface keep their
    own value (ledges, the knob's edges), the rest take the opened one; holes are filled from their neighbours.
    Returns (grid, affine) in UTM 10N, NaN off the island."""
    import laspy
    files = sorted(glob.glob(os.path.join(raw, 'ept_island', '*.laz')))
    if not files: sys.exit('missing ept_island/*.laz: run tools/terrain/fetch_island_lidar.py')
    t = Transformer.from_crs('EPSG:3857', 'EPSG:26910', always_xy=True)
    E0, N0, E1, N1 = 751000, 4315450, 751500, 4315950
    w, h = E1 - E0, N1 - N0
    zmin = np.full(h * w, np.inf)
    for f in files:
        l = laspy.read(f)
        c = np.asarray(l.classification)
        keep = (c == 1) | (c == 2) | (c == 9)
        E, N = t.transform(np.asarray(l.x)[keep], np.asarray(l.y)[keep]); z = np.asarray(l.z)[keep]
        i = np.floor(E - E0).astype(int); j = np.floor(N1 - N).astype(int)
        ok = (i >= 0) & (i < w) & (j >= 0) & (j < h) & (z > Y0 - 1) & (z < Y0 + 60)
        np.minimum.at(zmin, j[ok] * w + i[ok], z[ok])
    zmin = zmin.reshape(h, w)
    land = np.isfinite(zmin) & (zmin > Y0 + 0.35)
    lab, n = ndimage.label(land)
    sizes = ndimage.sum(np.ones_like(zmin), lab, range(1, n + 1))
    land = lab == (1 + int(np.argmax(sizes)))                      # the island: the largest dry body in the box
    land = ndimage.binary_fill_holes(ndimage.binary_closing(land, iterations=2))
    g = np.where(land & np.isfinite(zmin), zmin, np.nan)
    # fill the cells with no return (shadows) from the nearest return, then open off the trees
    idx = ndimage.distance_transform_edt(~np.isfinite(g), return_distances=False, return_indices=True)
    filled = g[tuple(idx)]
    fp = np.hypot(*np.mgrid[-3:4, -3:4]) <= 2.6
    opened = ndimage.grey_opening(filled, footprint=fp)
    ground = np.where(filled - opened < 1.0, filled, opened)
    ground = ndimage.gaussian_filter(ground, 0.6)
    ground[~land] = np.nan
    print(f'island lidar: {land.sum()} m2 dry, rock summit {np.nanmax(ground) - Y0:.1f} m above the lake '
          f'(first returns up to {np.nanmax(np.where(land, zmin, np.nan)) - Y0:.1f} m)')
    return ground, Affine(1, 0, E0, 0, -1, N1)

# --- the lake bed -------------------------------------------------------------------------------------------------
# The 1998 multibeam (DDS-55) stops short of the shore: its coverage ends 40-60 m off the north shore at 5-11 m of water
# and misses the bay mouth's sill; its grid is interpolated straight across Fannette Island (-10 m at the island's own
# shoreline), so near any shore its depth is the gridder's guess. The first build (kept as --legacy-bed) filled each gap
# cell with the nearest surveyed depth, capped by a 1:6 shelf off the shore, and mixed the shelf into the survey on a
# straight ramp over 5-40 m from the shore. That drew artefacts no real bed has: Voronoi fans (flat facets and straight
# ridges radiating from the coverage edge: the mouth's sill), a 3-5 m step along the coverage edge where the shelf met
# the held edge depth (a line 300-500 m long off the north shore), creases at exactly 5 m and 40 m off every shore (the
# ramp's ends: the lip of every drop-off an offset copy of the shoreline), and a crease lattice every 10 m (the survey's
# grid read bilinearly). The seamless bed keeps the same sources and the same shelf, and joins them smoothly:
#   - the survey read as before (bilinear, SURVEY_ORDER 1): where the survey covers the bed away from the shore and
#     the gaps, the bed is the first build's to the bit, so the open bay (the wind's deep-water cells, the Cruise
#     voyages, v1's frames over it) is unchanged; SURVEY_ORDER 3 reads it with a cubic spline (no crease lattice
#     every 10 m, but every cell moves by centimetres: kept as an option, not the default);
#   - its coverage gaps filled with the survey's edge depths carried smoothly across (Laplace's equation, solved exactly
#     on the level's grid, level into the shore) in place of the nearest one, under the first build's 1:6 shelf off the
#     shore (a soft maximum: no crease): no fans, no flat-held facet, the beaches as before;
#   - the 1:6 shelf mixed into it on the first build's ramp (from BAND0 off the shore: the beaches and the island's
#     edge as before), its two ends rounded (BAND_ROUND: no crease) and its outer end pushed out by the rounding and
#     wandering along the shore with a world-anchored noise (48-64 m, over 80-260 m), so its steepest part is never
#     steeper than the first build's (a real drop-off keeps its shape) and the lip of a drop-off is an uneven edge, not
#     the shoreline offset by 40 m;
#   - the join of the survey and a gap feathered (a mask-weighted Gaussian of SEAM_SIGMA m, eased out over SEAM_BAND m
#     each side), so the slope turns over 10-20 m, not at one cell.
# Every level runs the same rules on the same world-anchored inputs, so the nested levels still agree at their seams.
# It runs in REGION (the bay, the mouth and the shore outside), eased into the first build's bed past it.
SURVEY_ORDER = 1       # the survey's interpolation: 1 bilinear (the first build's), 3 a cubic spline
GAP_SIGMA = 4.0        # m: the light smoothing over a gap's cells
SOFT_M = 0.4           # m: the soft maximum's width where a gap's carried depth meets the shelf
SHORE_D = 0.0          # m: the bed's depth at the water's edge (the Laplace boundary on land); the bed is then <= -0.3
BAND0, BAND1, BAND_VAR = 5.0, 40.0, 8.0    # m off the shore: the shelf's mix into the survey starts, ends (the first
                                           # build's); the outer end is pushed out by the rounding and wanders 0-2x this
BAND_ROUND = 8.0       # m: the length of each of the ramp's rounded ends (the first build's ramp had a crease at each)
# Where: Emerald Bay, its mouth and the shore outside it (world x, z box, m), eased into the first build's bed over
# REGION_EASE m outside the box: the lake's other shores keep the first build's bed byte for byte (the harbour's piers,
# breakwaters and moorings were laid out on it; a regrid there is its own item)
REGION = (-1400.0, 2700.0, -2100.0, 1000.0)   # x0, x1, z0, z1
REGION_EASE = 400.0
KEEP0, KEEP1 = 8.0, 16.0   # m off the shore: the first build's bed up to KEEP0, the seamless one from KEEP1
SEAM_SIGMA = 6.0       # m: the feather's Gaussian across the survey's coverage edge
SEAM_BAND = 24.0       # m each side of the edge over which the feather eases out

def band_noise(X, Z, salt):
    """a smooth world-anchored noise in [0, 1] (three skewed sines, wavelengths 80-260 m): deterministic, no seed"""
    v = (np.sin(X * 0.0241 + Z * 0.0107 + 1.3 + salt) + np.sin(X * -0.0117 + Z * 0.0293 + 2.9 + 2.1 * salt)
         + 0.6 * np.sin(X * 0.0583 - Z * 0.0419 + 0.7 + 3.7 * salt))
    return np.clip(v / 5.2 + 0.5, 0.0, 1.0)

def legacy_bed(L, water, b):
    """the first build's bed (kept for the record and the A/B: --legacy-bed)"""
    dLand = ndimage.distance_transform_edt(water) * L['step']
    shelf = -np.minimum(0.4 + dLand / 6.0, 30.0)
    bed = np.where(np.isfinite(b), b - BATHY_SURFACE, np.nan)
    if np.isfinite(bed).any():
        idx = ndimage.distance_transform_edt(~np.isfinite(bed), return_distances=False, return_indices=True)
        bed = np.where(np.isfinite(bed), bed, np.maximum(bed[tuple(idx)], shelf))
    else:
        bed = shelf
    bed = np.minimum(bed, -0.3)
    wB = np.clip((dLand - 5) / 35.0, 0, 1)
    return np.minimum(-0.3, bed * wB + np.maximum(bed, shelf) * (1 - wB))

def laplace_fill(val, known, water, edge_value=None, prior=None, eps=1e-6):
    """the harmonic surface over water & ~known: Dirichlet on known cells (val); on land Dirichlet (edge_value) or, with
    edge_value None, Neumann (the surface runs level into the shore); Neumann at the grid's border; a pull of eps toward
    prior (a gap with no surveyed cell takes it; elsewhere it moves nothing); solved exactly (sparse LU)"""
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import spsolve
    unk = water & ~known
    n = int(unk.sum())
    out = np.where(known, val, np.nan)
    if n == 0: return out
    h, w = unk.shape
    idx = -np.ones(unk.shape, np.int64); idx[unk] = np.arange(n)
    jj, ii = np.nonzero(unk)
    rows, cols, vals = [], [], []
    diag = np.zeros(n); rhs = np.zeros(n)
    me = idx[jj, ii]
    for dj, di in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nj, ni = jj + dj, ii + di
        inside = (nj >= 0) & (nj < h) & (ni >= 0) & (ni < w)
        nj_c, ni_c = np.clip(nj, 0, h - 1), np.clip(ni, 0, w - 1)
        diag += inside
        nb_unk = inside & unk[nj_c, ni_c]
        rows.append(me[nb_unk]); cols.append(idx[nj_c, ni_c][nb_unk]); vals.append(-np.ones(nb_unk.sum()))
        nb_known = inside & known[nj_c, ni_c] & ~unk[nj_c, ni_c]
        rhs[nb_known] += val[nj_c, ni_c][nb_known]
        nb_land = inside & ~water[nj_c, ni_c]
        if edge_value is None: diag -= nb_land      # Neumann: no coupling to land
        else: rhs[nb_land] += edge_value
    if prior is not None:
        diag += eps; rhs += eps * prior[jj, ii]
    rows.append(me); cols.append(me); vals.append(diag)
    A = coo_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n)).tocsc()
    x = spsolve(A, rhs)
    out[unk] = x
    return out

def rounded_ramp(d, d0, d1, r):
    """0 up to d0, 1 from d1, linear between with its two corners rounded over r m each (a trapezoidal slope: C1, no
    crease; its steepest part 1 / (d1 - d0 - r), the straight ramp's 1 / (d1 - d0) a little raised)"""
    v = 1.0 / (d1 - d0 - r)
    x = np.clip(d - d0, 0, None); span = d1 - d0
    up = v * x * x / (2 * r)                                    # the first r m: the slope grows from 0 to v
    mid = v * (r / 2 + (x - r))                                 # then straight
    down = 1 - v * np.square(np.clip(span - x, 0, None)) / (2 * r)   # the last r m: back to 0
    return np.clip(np.where(x < r, up, np.where(x < span - r, mid, down)), 0, 1)

def region_weight(L):
    """1 inside REGION, easing (smoothstep) to 0 over REGION_EASE m outside it, on the level's texel centres"""
    xs, zs = world_grid(L)
    x0, x1, z0, z1 = REGION
    dx = np.maximum(np.maximum(x0 - xs, xs - x1), 0.0); dz = np.maximum(np.maximum(z0 - zs, zs - z1), 0.0)
    d = np.hypot(dz[:, None], dx[None, :])
    t = np.clip(1 - d / REGION_EASE, 0, 1)
    return t * t * (3 - 2 * t)

def seamless_bed(L, water, bs, keep_survey=False):
    """bs: the survey's elevation where it has coverage, NaN elsewhere -> the bed (m, <= -0.3) on water. keep_survey:
    the feather across the coverage edge moves only the filled side (the surveyed cells keep the survey's value)"""
    step = L['step']
    dLand = ndimage.distance_transform_edt(water) * step
    srv = bs - BATHY_SURFACE
    known = water & np.isfinite(srv)
    shelf = -np.minimum(0.4 + dLand / 6.0, 30.0)
    # a gap: the survey's edge depths carried smoothly across it (the harmonic surface, level into the shore), never
    # deeper than the 1:6 shelf off the shore (the first build's rule, so a cove the survey missed still shoals to its
    # beach as before); the shallower of the two by a soft maximum (no crease where they meet)
    Es = laplace_fill(np.where(known, srv, 0.0), known, water, None, prior=shelf)
    a_, b_ = Es, shelf
    gap = 0.5 * (a_ + b_ + np.sqrt((a_ - b_) ** 2 + SOFT_M ** 2))
    S = np.where(known, srv, np.where(water, gap, SHORE_D))
    # a light mask-weighted Gaussian over the gap cells (GAP_SIGMA): the bend where the carried depth meets the shelf
    # turns over a few metres
    if GAP_SIGMA / step > 0.5 and (water & ~known).any():
        g = GAP_SIGMA / step; wt = water.astype(np.float64)
        blur = ndimage.gaussian_filter(np.where(water, S, 0.0), g) / np.maximum(ndimage.gaussian_filter(wt, g), 1e-6)
        S = np.where(water & ~known, blur, S)
    # the feather across the coverage edge (only near the join of surveyed and filled water)
    seam = known ^ ndimage.binary_erosion(known, border_value=1)
    seam &= ndimage.binary_dilation(water & ~known)
    if seam.any() and SEAM_SIGMA / step > 0.5:
        dSeam = ndimage.distance_transform_edt(~seam) * step
        wt = water.astype(np.float64)
        s = SEAM_SIGMA / step
        blur = ndimage.gaussian_filter(np.where(water, S, 0.0), s) / np.maximum(ndimage.gaussian_filter(wt, s), 1e-6)
        k = np.clip(1 - dSeam / SEAM_BAND, 0, 1); k = k * k * (3 - 2 * k)
        if keep_survey: k = np.where(known, 0.0, k)
        S = np.where(water, S * (1 - k) + blur * k, S)
    # the shelf off the shore, mixed into the survey on a rounded ramp over a wandering band
    xs, zs = world_grid(L)
    X, Z = np.meshgrid(xs, zs)
    d0 = BAND0
    d1 = BAND1 + BAND_ROUND + 2 * BAND_VAR * band_noise(X, Z, 1.7)   # never steeper than the first build's ramp
    wB = rounded_ramp(dLand, d0, d1, BAND_ROUND)
    bed = S * wB + np.maximum(S, shelf) * (1 - wB)
    return np.minimum(np.where(water, bed, -0.3), -0.3)

def read_nlcd(raw):
    p = os.path.join(raw, 'nlcd_NLCD_2021_Land_Cover_L48.tif')
    if not os.path.exists(p): sys.exit('missing NLCD: run tools/terrain/fetch_tahoe.sh')
    return rasterio.open(p)

# --- the encoding ------------------------------------------------------------------------------------------------
def encode_u16(q):
    """2-D prediction (left + up - upleft, mod 2^16), then the hi bytes plane and the lo bytes plane, gzip"""
    q = q.astype(np.int64)
    pred = np.zeros_like(q)
    pred[1:, 1:] = q[1:, :-1] + q[:-1, 1:] - q[:-1, :-1]
    pred[0, 1:] = q[0, :-1]
    pred[1:, 0] = q[:-1, 0]
    r = ((q - pred) % 65536).astype(np.uint16)
    planes = np.concatenate([(r >> 8).astype(np.uint8).ravel(), (r & 255).astype(np.uint8).ravel()])
    return gzip.compress(planes.tobytes(), 9, mtime=0)

def encode_u8(c):
    return gzip.compress(c.astype(np.uint8).tobytes(), 9, mtime=0)

def decode_u16(b, w, h):   # the check: the same as src/terrain-data.js
    p = np.frombuffer(gzip.decompress(b), np.uint8)
    r = (p[:w * h].astype(np.int64) << 8 | p[w * h:]).reshape(h, w)
    q = np.zeros_like(r)
    for j in range(h):
        if j == 0: q[0] = np.cumsum(r[0]) % 65536; continue
        # q[j,i] = r + q[j,i-1] + q[j-1,i] - q[j-1,i-1]  => q[j] - q[j-1] = cumsum(r[j]) + (q[j-1,0]-q[j-1,0]) ...
        d = np.cumsum(r[j])                  # (q[j,i]-q[j-1,i]) = sum_{k<=i} r[j,k] + (q[j,-1]-q[j-1,-1])=0 start
        q[j] = (q[j - 1] + d) % 65536
    return q

# --- cover classes (NLCD 2021 -> ours) ---------------------------------------------------------------------------
#  0 none/unknown, 1 water, 2 urban (developed 22-24), 3 open developed (21: lawns, parks, ski runs), 4 rock/barren (31),
#  5 forest (41-43), 6 shrub (51-52), 7 grass/meadow (71-74, 81-82), 8 wetland (90-95), 9 snow/ice (12)
NLCD_MAP = {11: 1, 12: 9, 21: 3, 22: 2, 23: 2, 24: 2, 31: 4, 41: 5, 42: 5, 43: 5, 51: 6, 52: 6, 71: 7, 72: 7, 73: 7, 74: 7,
            81: 7, 82: 7, 90: 8, 95: 8}

def block_mean(q, f):
    """the mean of each f x f block, rounded (texel centres: the block's centre); tools/terrain/phone_terrain.mjs's"""
    h, w = q.shape[0] // f * f, q.shape[1] // f * f
    return np.floor(q[:h, :w].astype(np.float64).reshape(h // f, f, w // f, f).sum(axis=(1, 3)) / (f * f) + 0.5).astype(np.uint16)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', default=os.path.join(REPO, '.cache', 'terrain', 'raw'))
    ap.add_argument('--out', default=None, help='default terrain/ (terrain/<region>/ with --region)')
    ap.add_argument('--legacy-bed', action='store_true', help="the first build's bed (nearest fill, a straight 5-40 m ramp): the A/B")
    ap.add_argument('--region', choices=sorted(REGIONS), help='build one region level (REGIONS) and its manifests, nothing else')
    a = ap.parse_args()
    if a.region:
        return build_region(a)
    a.out = a.out or os.path.join(REPO, 'terrain')
    os.makedirs(a.out, exist_ok=True)

    srcs = {p: mosaic(a.raw, p) for p in sorted({L['src'] for L in LEVELS})}
    bathy, btr = read_bathy(a.raw)
    # the survey with its holes filled by the nearest value, for the cubic read (its coverage still comes from the
    # bilinear read's mask: the fill only keeps the spline from ringing at the edge)
    bathy_c = None
    if not a.legacy_bed and SURVEY_ORDER != 1:
        nn = ndimage.distance_transform_edt(np.isnan(bathy), return_distances=False, return_indices=True)
        bathy_c = bathy[tuple(nn)]

    # the lake surface: the hydro-flattened water of the 1 m lidar (the mode of the elevations near the island)
    dem1, tr1 = srcs['dem1m_bay']
    E0, N0 = TO_UTM.transform(0.0, 0.0)
    c, r = int((E0 - tr1.c) / tr1.a), int((N0 - tr1.f) / tr1.e)
    win = dem1[r - 400:r + 400, c - 400:c + 400]
    vals, cnt = np.unique(np.round(win[np.isfinite(win)], 2), return_counts=True)
    Y0 = float(vals[np.argmax(cnt)])
    print(f'lake surface (lidar water): {Y0:.2f} m; share of the window {cnt.max() / win.size:.1%}')

    island, itr = island_from_lidar(a.raw, Y0)
    # the summit: the island's highest ground (it sets src/geo.js ORIGIN; rerun the build if it moves)
    k = np.unravel_index(np.nanargmax(island), island.shape)
    sE, sN = itr.c + (k[1] + 0.5), itr.f - (k[0] + 0.5)
    slon, slat = Transformer.from_crs('EPSG:26910', 'EPSG:4326', always_xy=True).transform(sE, sN)
    print(f'island summit {np.nanmax(island) - Y0:.1f} m above the lake at {slat:.6f}, {slon:.6f} (geo.js ORIGIN {LAT0}, {LON0})')
    nlcd = read_nlcd(a.raw)
    manifest = dict(version=1, proj=PROJ, origin=dict(lat=LAT0, lon=LON0), y0=Y0,
                    height=dict(offset=H_OFFSET, step=H_STEP), distance=dict(step=D_STEP), levels=[],
                    sources=['USGS 3DEP Bare Earth DEM (1 m lidar, 1/3 arc-second), public domain',
                             'USGS DDS-55 Lake Tahoe bathymetry 1998 (Gardner, Mayer, Hughes Clarke), public domain',
                             'USGS/MRLC NLCD 2021 land cover, public domain'])
    total = 0
    for L in LEVELS:
        E, N = utm_of(L)
        dem, tr = srcs[L['src']]
        src = dem
        if L['smooth'] > 0: src = ndimage.gaussian_filter(np.where(np.isnan(dem), np.nanmean(dem), dem), L['smooth'])
        h = sample(src, tr, E, N) - Y0
        h = np.where(np.isfinite(h), h, 0.0)   # holes (none expected inside the exports)
        if L['step'] <= 2:                      # Fannette Island from the lidar points (the DEM lost it)
            ih = sample(island, itr, E, N) - Y0
            h = np.where(np.isfinite(ih), np.maximum(ih, 0.3), h)
        # the lake: the hydro-flattened water (within a few cm of this source's own lake surface, on the lake's
        # connected body); each source flattens the lake to its own value (the 1 m lidar's sets Y0)
        b = sample(bathy, btr, E, N)
        wetB = np.isfinite(b) & (b < BATHY_SURFACE - 3)
        hv = np.round(h[wetB & np.isfinite(h)], 1) if wetB.any() else np.round(h[np.isfinite(h)], 1)
        vv, cc = np.unique(hv, return_counts=True); surf = float(vv[np.argmax(cc)])
        flat = np.abs(h - surf) < (0.15 if L['step'] <= 2 else 0.5)
        lab, nl = ndimage.label(flat)
        sizes = ndimage.sum(np.ones_like(h), lab, range(1, nl + 1))
        # the lake's body: the largest flat region (Tahoe), plus flat regions that touch the bathymetry's wet cells
        keep = np.zeros(nl + 1, bool)
        if nl: keep[1 + int(np.argmax(sizes))] = True
        touch = np.unique(lab[wetB & flat]); keep[touch] = True; keep[0] = False
        water = keep[lab]
        if L['name'] == 'island':   # the island level sits in the bay: everything flat round it is the lake
            water = flat
        bed = legacy_bed(L, water, b)
        if not a.legacy_bed:
            wR = region_weight(L)
            if wR.any():
                bs = sample(bathy_c, btr, E, N, order=SURVEY_ORDER) if bathy_c is not None else b
                # the wash (under KEEP0 m off the shore, eased out by KEEP1) keeps the first build's bed: the beaches and
                # rocks the boat grounds on, the sounder's and the assist's shoals, are the ones they were tuned on
                dL = ndimage.distance_transform_edt(water) * L['step']
                t = np.clip((dL - KEEP0) / (KEEP1 - KEEP0), 0, 1); wR = wR * t * t * (3 - 2 * t)
                bed = np.where(wR > 0, seamless_bed(L, water, np.where(np.isfinite(b), bs, np.nan)) * wR + bed * (1 - wR), bed)
        h = np.where(water, bed, np.maximum(h - surf, 0.05))   # land: above this source's own lake surface
        print(f"        {L['name']}: source lake surface {surf + Y0:.2f} m")
        q = np.clip(np.round((h - H_OFFSET) / H_STEP), 0, 65535).astype(np.uint16)
        hb = encode_u16(q)
        fn = f"{L['name']}-h.lsh"; open(os.path.join(a.out, fn), 'wb').write(hb); total += len(hb)
        ent = dict(name=L['name'], step=L['step'], x0=L['x0'], z0=L['z0'], w=L['w'], h=L['h'], height=fn)
        # the shore distance: signed metres, negative on the lake, from the water mask (half a texel at the edge)
        dIn = ndimage.distance_transform_edt(water) * L['step']
        dOut = ndimage.distance_transform_edt(~water) * L['step']
        sd = np.where(water, -(dIn - 0.5 * L['step']), dOut - 0.5 * L['step'])
        k = D_SUB[L['name']]
        sdk = sd[::k, ::k]
        dq = np.clip(np.round(sdk / D_STEP) + 32768, 0, 65535).astype(np.uint16)
        db = encode_u16(dq); dfn = f"{L['name']}-d.lsh"
        open(os.path.join(a.out, dfn), 'wb').write(db); total += len(db)
        ent.update(distance=dfn, dk=k, dw=sdk.shape[1], dh=sdk.shape[0])
        print(f"{L['name']:7s} {L['w']}x{L['h']} @ {L['step']} m: h {h.min():.1f}..{h.max():.1f} m, water {water.mean():.1%}, "
              f"heights {len(hb) / 1e6:.2f} MB, distance {len(db) / 1e6:.2f} MB")
        # the round trip check on a strip (the full decode is slow in Python)
        assert np.array_equal(decode_u16(hb, L['w'], L['h']), q), 'decode mismatch'
        if L['name'] == 'lake' or L['name'] == 'basin' or L['name'] == 'bay':
            # cover: NLCD classes, nearest, on this level's grid (bay at 4 m: every 2nd texel)
            ck = 2 if L['name'] == 'bay' else 1
            Ec, Nc = utm_of(L, ck)
            t5 = Transformer.from_crs('EPSG:26910', nlcd.crs, always_xy=True)
            Xa, Ya = t5.transform(Ec, Nc)
            band = nlcd.read(1); T = nlcd.transform
            ci = np.clip(((Xa - T.c) / T.a).astype(int), 0, band.shape[1] - 1)
            ri = np.clip(((Ya - T.f) / T.e).astype(int), 0, band.shape[0] - 1)
            raw = band[ri, ci]
            lut = np.zeros(256, np.uint8)
            for kk, v in NLCD_MAP.items(): lut[kk] = v
            cls = lut[raw]
            wk = water[::ck, ::ck][:cls.shape[0], :cls.shape[1]]
            # our lake -> 1; other NLCD water (Cascade, Fallen Leaf...) -> 10 ("pond": a flat still surface)
            cls = np.where(wk, 1, np.where(cls == 1, 10, cls))
            cb = encode_u8(cls); cfn = f"{L['name']}-c.lsh"
            open(os.path.join(a.out, cfn), 'wb').write(cb); total += len(cb)
            ent.update(cover=cfn, ck=ck, cw=cls.shape[1], ch=cls.shape[0])
            print(f"        cover {cls.shape[1]}x{cls.shape[0]}: {len(cb) / 1e6:.2f} MB; " +
                  ', '.join(f'{n} {np.mean(cls == i):.0%}' for i, n in enumerate(['-', 'water', 'urban', 'open', 'rock', 'forest', 'shrub', 'grass', 'wet', 'snow', 'pond']) if np.mean(cls == i) > 0.005))
        manifest['levels'].append(ent)
    manifest['bytes'] = total
    json.dump(manifest, open(os.path.join(a.out, 'tahoe.json'), 'w'), indent=1)
    print(f'total {total / 1e6:.2f} MB in {a.out}')

def build_region(a):
    """one region level (REGIONS[a.region]) into terrain/<region>/: <r>-h.lsh, <r>-d.lsh, <r>-c.lsh, the phone set's
    <r>-h<f>.lsh and <r>-d<pdk>.lsh, and the manifests <r>.json and <r>-phone.json (the lake-wide manifests' fields)"""
    L = REGIONS[a.region]
    out = a.out or os.path.join(REPO, 'terrain', L['name'])
    os.makedirs(out, exist_ok=True)
    lake = json.load(open(os.path.join(REPO, 'terrain', 'tahoe.json')))
    Y0 = float(lake['y0'])                      # the lake-wide frame's surface (the bay's lidar water), not re-measured
    assert lake['proj'] == PROJ, 'the lake profile moved: rebuild the lake-wide levels first'
    dem, tr = mosaic(a.raw, L['src'])
    bathy, btr = read_bathy(a.raw)
    E, N = utm_of(L)
    # the source must cover the level and a margin for the smoothing: no hole may reach a texel
    src = ndimage.gaussian_filter(np.where(np.isnan(dem), np.nanmean(dem), dem), L['smooth']) if L['smooth'] > 0 else dem
    h = sample(src, tr, E, N) - Y0
    hole = ~np.isfinite(sample(dem, tr, E, N))
    if hole.any(): sys.exit(f"{L['src']}: {int(hole.sum())} texels without lidar: widen the fetch")
    b = sample(bathy, btr, E, N)
    wetB = np.isfinite(b) & (b < BATHY_SURFACE - 3)
    hv = np.round(h[wetB], 1) if wetB.any() else np.round(h, 1)
    vv, cc = np.unique(hv, return_counts=True); surf = float(vv[np.argmax(cc)])
    flat = np.abs(h - surf) < L['flat']
    lab, nl = ndimage.label(flat)
    sizes = ndimage.sum(np.ones_like(h), lab, range(1, nl + 1))
    keep = np.zeros(nl + 1, bool)
    if nl: keep[1 + int(np.argmax(sizes))] = True
    touch = np.unique(lab[wetB & flat]); keep[touch] = True; keep[0] = False
    water = keep[lab]
    bed = legacy_bed(L, water, b)               # the lake-wide rules (the 10 m and 32 m levels' bed)
    if L.get('bed') == 'seamless':
        sb = seamless_bed(L, water, np.where(np.isfinite(b), b, np.nan), keep_survey=True)
        xs, zs = world_grid(L)
        dx = np.minimum(xs - L['x0'], L['x0'] + (L['w'] - 1) * L['step'] - xs); dz = np.minimum(zs - L['z0'], L['z0'] + (L['h'] - 1) * L['step'] - zs)
        t = np.clip(np.minimum(dz[:, None], dx[None, :]) / L['bed_ease'], 0, 1); wE = t * t * (3 - 2 * t)
        bed = np.where(water, sb * wE + bed * (1 - wE), bed)
        srv = water & np.isfinite(b)
        moved = srv & (np.abs(bed - (b - BATHY_SURFACE)) > 0.01)
        print(f"{L['name']}: seamless bed; {int((water & ~np.isfinite(b)).sum())} gap texels filled; surveyed texels "
              f"moved > 1 cm: {int(moved.sum())} of {int(srv.sum())} (the shore ramp and the edge ease)")
    h = np.where(water, bed, np.maximum(h - surf, 0.05))
    print(f"{L['name']}: source lake surface {surf + Y0:.2f} m (the frame's {Y0:.2f} m)")
    q = np.clip(np.round((h - H_OFFSET) / H_STEP), 0, 65535).astype(np.uint16)
    files = {}
    def write(fn, data):
        open(os.path.join(out, fn), 'wb').write(data); files[fn] = len(data)
    hb = encode_u16(q); write(f"{L['name']}-h.lsh", hb)
    assert np.array_equal(decode_u16(hb, L['w'], L['h']), q), 'decode mismatch'
    ent = dict(name=L['name'], step=L['step'], x0=L['x0'], z0=L['z0'], w=L['w'], h=L['h'], height=f"{L['name']}-h.lsh")
    # the shore distance: signed metres, negative on the lake (as the lake-wide levels)
    dIn = ndimage.distance_transform_edt(water) * L['step']
    dOut = ndimage.distance_transform_edt(~water) * L['step']
    sd = np.where(water, -(dIn - 0.5 * L['step']), dOut - 0.5 * L['step'])
    def dist(k):
        sdk = sd[::k, ::k]
        return sdk, encode_u16(np.clip(np.round(sdk / D_STEP) + 32768, 0, 65535).astype(np.uint16))
    sdk, db = dist(L['dk']); dfn = f"{L['name']}-d.lsh"; write(dfn, db)
    ent.update(distance=dfn, dk=L['dk'], dw=sdk.shape[1], dh=sdk.shape[0])
    # cover: NLCD classes, nearest, every ck-th texel; our lake 1, other NLCD water 10
    ck = L['ck']
    Ec, Nc = utm_of(L, ck)
    nlcd = read_nlcd(a.raw)
    Xa, Ya = Transformer.from_crs('EPSG:26910', nlcd.crs, always_xy=True).transform(Ec, Nc)
    band = nlcd.read(1); T = nlcd.transform
    ci = ((Xa - T.c) / T.a).astype(int); ri = ((Ya - T.f) / T.e).astype(int)
    if ci.min() < 0 or ri.min() < 0 or ci.max() >= band.shape[1] or ri.max() >= band.shape[0]: sys.exit('NLCD does not cover the region')
    lut = np.zeros(256, np.uint8)
    for kk, v in NLCD_MAP.items(): lut[kk] = v
    cls = lut[band[ri, ci]]
    wk = water[::ck, ::ck][:cls.shape[0], :cls.shape[1]]
    cls = np.where(wk, 1, np.where(cls == 1, 10, cls))
    cfn = f"{L['name']}-c.lsh"; write(cfn, encode_u8(cls))
    ent.update(cover=cfn, ck=ck, cw=cls.shape[1], ch=cls.shape[0])
    names = ['-', 'water', 'urban', 'open', 'rock', 'forest', 'shrub', 'grass', 'wet', 'snow', 'pond']
    print(f"{L['name']} {L['w']}x{L['h']} @ {L['step']:g} m: h {h.min():.1f}..{h.max():.1f} m, water {water.mean():.1%}; cover " +
          ', '.join(f'{n} {np.mean(cls == i):.0%}' for i, n in enumerate(names) if np.mean(cls == i) > 0.005))
    head = dict(version=1, region=L['name'], proj=PROJ, origin=dict(lat=LAT0, lon=LON0), y0=Y0,
                height=dict(offset=H_OFFSET, step=H_STEP), distance=dict(step=D_STEP),
                box=dict(x0=L['x0'] - L['step'] / 2, z0=L['z0'] - L['step'] / 2,
                         x1=L['x0'] + (L['w'] - 0.5) * L['step'], z1=L['z0'] + (L['h'] - 0.5) * L['step']),
                sources=['USGS 3DEP Bare Earth DEM (1 m lidar), public domain',
                         'USGS DDS-55 Lake Tahoe bathymetry 1998 (Gardner, Mayer, Hughes Clarke), public domain',
                         'USGS/MRLC NLCD 2021 land cover, public domain'])
    full = dict(head, levels=[ent], bytes=files[ent['height']] + files[dfn] + files[cfn])
    # the phone set: the heights' block means, the distance every pdk-th texel, the cover shared
    f, pdk = L['phone'], L['pdk']
    qp = block_mean(q, f); hpn = f"{L['name']}-h{f}.lsh"; write(hpn, encode_u16(qp))
    sdp, dbp = dist(pdk); dpn = f"{L['name']}-d{pdk}.lsh"; write(dpn, dbp)
    pent = dict(ent, step=L['step'] * f, x0=L['x0'] + L['step'] * (f - 1) / 2, z0=L['z0'] + L['step'] * (f - 1) / 2,
                w=int(qp.shape[1]), h=int(qp.shape[0]), height=hpn, distance=dpn, dk=pdk, dw=sdp.shape[1], dh=sdp.shape[0],
                dx0=L['x0'], dz0=L['z0'], dstep=L['step'] * pdk, cx0=L['x0'], cz0=L['z0'], cstep=L['step'] * ck)
    phone = dict(head, levels=[pent], bytes=files[hpn] + files[dpn] + files[cfn], variant='phone')
    json.dump(full, open(os.path.join(out, f"{L['name']}.json"), 'w'), indent=1)
    json.dump(phone, open(os.path.join(out, f"{L['name']}-phone.json"), 'w'), indent=1)
    for fn, n in files.items(): print(f'  {fn:16s} {n:>9,d} B')
    print(f"full set {full['bytes']:,d} B, phone set {phone['bytes']:,d} B in {out}")

if __name__ == '__main__':
    main()
