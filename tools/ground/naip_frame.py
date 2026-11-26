"""The world frame and the three NAIP levels, shared by fetch_naip.py and build_naip.py (keep in step with
src/geo.js and terrain/tahoe.json: the bay, basin and lake levels' outer edges)."""
import os, re
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
_s = open(os.path.join(REPO, 'src', 'waters', 'tahoe-emerald.json')).read()   # the lake profile's origin (src/sim/geo.js reads it)
LAT0 = float(re.search(r'"lat":\s*([-\d.]+)', _s).group(1)); LON0 = float(re.search(r'"lon":\s*([-\d.]+)', _s).group(1))
PROJ = f'+proj=tmerc +lat_0={LAT0} +lon_0={LON0} +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs'
TO_UTM = Transformer.from_crs(PROJ, 'EPSG:26910', always_xy=True)

# level: outer edge rectangle in world metres (x east, z south = -northing): x0, z0, x1, z1 (texel EDGES, not centres)
LEVELS = {
    'bay':   dict(x0=-2304.0, z0=-1792.0, x1=3328.0, z1=1792.0),          # bay level: 2 m texels x0 -2303, 2816 x 1792
    'basin': dict(x0=-10240.0, z0=-10240.0, x1=10240.0, z1=10240.0),      # basin level: 10 m texels, 2048 square
    'region': dict(x0=-14000.0, z0=-46000.0, x1=26960.0, z1=15440.0),     # the lake level's box (32 m texels, 1280 x 1920), whole lake and its rim
    'lake':  dict(x0=-14000.0, z0=-46000.0, x1=26960.0, z1=15440.0),
    'south': dict(x0=6992.0, z0=-1504.0, x1=14512.0, z1=3008.0),          # the south region level (terrain/south/south.json): 4 m texels, 1880 x 1128
    'rubicon': dict(x0=-900.0, z0=-6300.0, x1=1700.0, z1=-3700.0),        # the Rubicon region level (terrain/rubicon/rubicon.json): 4 m texels, 650 x 650
}
# the region levels: their DEM comes from terrain/<name>/<name>.json, laid over the lake-wide levels (lsh.load)
REGION_LEVELS = ('south', 'rubicon')

def utm_bbox(L, margin=0.0):
    """Envelope in UTM 10N (EPSG:26910) of a world rectangle, plus a margin (m)."""
    pts = [(L['x0'], L['z0']), (L['x1'], L['z0']), (L['x1'], L['z1']), (L['x0'], L['z1'])]
    # world (x, z) -> tmerc easting x, northing -z
    u = [TO_UTM.transform(x, -z) for x, z in pts]
    xs = [p[0] for p in u]; ys = [p[1] for p in u]
    return min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin
