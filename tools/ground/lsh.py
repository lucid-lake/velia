"""Read terrain/*.lsh (src/terrain-data.js's format) and compose the game's own DEM on a world grid, so the albedo's
de-lighting and the horizon map use exactly the heights the mesh does. numpy only."""
import gzip, json, os
import numpy as np
from scipy import ndimage

def unpredict(raw, w, h):
    n = w * h
    p = np.frombuffer(raw, np.uint8)
    r = ((p[:n].astype(np.uint32) << 8) | p[n:2 * n]).reshape(h, w)      # the residuals, mod 2^16
    # q[j,i] = r + left + up - ul (mod 2^16): invert with a cumulative sum along both axes
    q = np.cumsum(np.cumsum(r.astype(np.uint64), axis=1), axis=0) & 0xffff
    return q.astype(np.uint16)

def load(terrain_dir, regions=()):
    """the lake-wide levels (tahoe.json), finest first; each named region level (terrain/<r>/<r>.json) goes in by its
    step, so composite() lays it over the coarser lake-wide levels it sits in"""
    man = json.load(open(os.path.join(terrain_dir, 'tahoe.json')))
    levels = []
    def add(L, folder, M):
        raw = gzip.open(os.path.join(folder, L['height']), 'rb').read()
        H = M['height']['offset'] + M['height']['step'] * unpredict(raw, L['w'], L['h']).astype(np.float64)
        levels.append(dict(L, H=H))
    for L in man['levels']: add(L, terrain_dir, man)
    for r in regions:
        folder = os.path.join(terrain_dir, r); M = json.load(open(os.path.join(folder, f'{r}.json')))
        assert M['height'] == man['height'] and M['y0'] == man['y0'], f'{r}: not in the lake-wide codes'
        for L in M['levels']: add(L, folder, M)
    levels.sort(key=lambda L: L['step'])          # stable: the lake-wide order is kept
    return man, levels

def composite(levels, xs, zs, blend=12):
    """Heights (m above the lake) at world x = xs[i], z = zs[j]; the finest level that holds the point, feathered
    into the next coarser one over its last `blend` texels (as makeSampler does). Returns float32 [len(zs), len(xs)]."""
    X, Z = np.meshgrid(xs, zs)
    out = None
    for L in reversed(levels):                      # coarsest first, finer ones laid over
        fx = (X - L['x0']) / L['step']; fz = (Z - L['z0']) / L['step']
        v = ndimage.map_coordinates(L['H'], [fz, fx], order=1, mode='nearest').astype(np.float32)
        m = np.minimum.reduce([fx, fz, L['w'] - 1 - fx, L['h'] - 1 - fz])
        t = np.clip(m / blend, 0, 1); s = (t * t * (3 - 2 * t)).astype(np.float32)
        out = v if out is None else out * (1 - s) + v * s
    return out
