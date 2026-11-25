#!/usr/bin/env python3
"""Fetch USDA NAIP (4-band RGB + NIR) for Velia's bay, basin and lake levels from the USGS National Map
'NAIP Plus' ImageServer (public domain; ATTRIBUTION.md). No key, no spend; a few dozen polite requests.

    .venv/bin/python -I tools/ground/fetch_naip.py --out .cache/naip/raw [--levels bay,basin,lake]

Writes GeoTIFFs in UTM 10N (EPSG:26910), 4 bands uint8, one file per tile, and <out>/index.json with the capture
dates the service reports over the bay. Idempotent: skips files present.
  bay    0.6 m (native) tiles of 2,000 px
  basin  4 m   tiles of 2,000 px
  lake   32 m  one export
  region 16 m  the lake's box (the runtime's regional photo): 2 x 2 exports
  south  2 m   the south region's box (built to 4 m and 8 m by build_naip.py): 2 x 2 exports
"""
import argparse, json, math, os, sys, time, datetime, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from naip_frame import LEVELS, utm_bbox, TO_UTM

SVC = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer'
PLAN = {'bay': (0.6, 2000, 60.0), 'basin': (4.0, 2000, 400.0), 'lake': (32.0, 2000, 3200.0), 'region': (16.0, 2000, 1600.0), 'south': (2.0, 2000, 200.0)}

def get(url, out, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'velia-naip-fetch/1.0'})
            with urllib.request.urlopen(req, timeout=600) as r:
                data = r.read()
            if data[:4] not in (b'II*\x00', b'MM\x00*'):
                raise RuntimeError('not a TIFF: ' + data[:200].decode('latin1'))
            with open(out + '.part', 'wb') as f: f.write(data)
            os.replace(out + '.part', out)
            return len(data)
        except Exception as e:
            print('  retry', k, e, flush=True); time.sleep(5 * (k + 1))
    raise SystemExit('FAILED ' + out)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--levels', default='bay,region')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for name in a.levels.split(','):
        px, T, margin = PLAN[name]
        e0, n0, e1, n1 = utm_bbox(LEVELS[name], margin)
        e0 = math.floor(e0 / px) * px; n0 = math.floor(n0 / px) * px
        e1 = math.ceil(e1 / px) * px; n1 = math.ceil(n1 / px) * px
        step = T * px
        nx = math.ceil((e1 - e0) / step); ny = math.ceil((n1 - n0) / step)
        print(f'{name}: UTM {e0:.1f},{n0:.1f} .. {e1:.1f},{n1:.1f}  {nx}x{ny} tiles at {px} m', flush=True)
        for j in range(ny):
            for i in range(nx):
                ta, tb = e0 + i * step, n0 + j * step
                tc, td = min(ta + step, e1), min(tb + step, n1)
                w = round((tc - ta) / px); h = round((td - tb) / px)
                out = os.path.join(a.out, f'naip_{name}_{px}m_{int(ta)}_{int(tb)}.tif')
                if os.path.exists(out) and os.path.getsize(out) > 1000: continue
                q = dict(bbox=f'{ta},{tb},{tc},{td}', bboxSR=26910, imageSR=26910, size=f'{w},{h}', format='tiff',
                         pixelType='U8', bandIds='0,1,2,3', interpolation='RSP_BilinearInterpolation', f='image')
                n = get(SVC + '/exportImage?' + urllib.parse.urlencode(q), out)
                print(f'  {os.path.basename(out)} {w}x{h} {n/1e6:.1f} MB', flush=True)
                time.sleep(2)
    L = LEVELS['bay' if 'bay' in a.levels.split(',') else a.levels.split(',')[0]]; dates = {}
    for (x, z) in [((L['x0'] + L['x1']) / 2, (L['z0'] + L['z1']) / 2), (L['x0'], L['z0']), (L['x1'], L['z1']), (L['x0'], L['z1']), (L['x1'], L['z0'])]:
        e, n = TO_UTM.transform(x, -z)
        q = dict(f='json', geometry=json.dumps({'x': e, 'y': n, 'spatialReference': {'wkid': 26910}}), geometryType='esriGeometryPoint',
                 returnGeometry='false', returnCatalogItems='true', returnPixelValues='false')
        d = json.load(urllib.request.urlopen(SVC + '/identify?' + urllib.parse.urlencode(q), timeout=60))
        for f in d.get('catalogItems', {}).get('features', []):
            at = f['attributes']
            if at.get('Category') == 1:
                dates[at['Name']] = datetime.datetime.fromtimestamp(at['acquisition_date'] / 1000, datetime.UTC).date().isoformat()
    json.dump({'service': SVC, 'fetched': datetime.date.today().isoformat(), 'primary_footprints': dates}, open(os.path.join(a.out, 'index.json' if a.levels == 'bay,region' else f'index-{a.levels.replace(",", "-")}.json'), 'w'), indent=1)
    print(dates)

if __name__ == '__main__':
    main()
