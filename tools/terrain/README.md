# The terrain and ground bakes

The tools that turn public US data into the files under `terrain/` and `v2/photo/`. They run offline, on a
developer's machine; the game only reads their output. Every input is public domain (`ATTRIBUTION.md`).

| Tool | Reads | Writes |
|---|---|---|
| `tools/terrain/fetch_tahoe.sh` | USGS 3DEP elevation, USGS DDS-55 bathymetry, NLCD 2021, the 3DEP lidar points over Fannette Island | `.cache/terrain/raw/` |
| `tools/terrain/build_tahoe.py` | `.cache/terrain/raw/` | `terrain/tahoe.json` and `terrain/<level>-{h,d,c}.lsh` |
| `tools/terrain/phone_terrain.mjs` | `terrain/tahoe.json` | `terrain/tahoe-phone.json`, the phone height grids |
| `tools/ground/fetch_naip.py` | the NAIP Plus image service | `.cache/naip/raw/` |
| `tools/ground/build_naip.py` | `.cache/naip/raw/`, `terrain/*.lsh` (the de-lighting DEM) | `terrain/naip/albedo-*.webp`, `naip.json` |
| `tools/v2-photo-tiles.mjs` | `terrain/naip/albedo-*.webp` | `v2/photo/<set>/<level>/<tx>-<ty>.webp`, `manifest.json` |
| `tools/v2-shore-bake.mjs` | `terrain/*.lsh` | `v2/assets/shore/shore.vsf.gz` |

Helpers: `tools/ground/naip_frame.py` (the world frame and the NAIP boxes), `naip_warp.py` (NAIP tiles to a world
raster), `lsh.py` (reads the `.lsh` grids), `tools/terrain/fetch_island_lidar.py` (the island's lidar points).

## Setup

Python 3.12 or newer, in a venv at the repo root (git-ignored):

```sh
python3 -m venv .venv
.venv/bin/pip install -r tools/terrain/requirements.txt
```

The shell script takes `PYTHON=<path to python>` to use another interpreter. The node tools need only the repo's own
`npm ci`; `v2-photo-tiles.mjs` drives a local Chrome (`LAKESHORE_CHROME` overrides its path).

Downloads go to `.cache/` (git-ignored, a few hundred MB). The fetches are free, need no key and skip files already there.

## The format

A `.lsh` file is a gzip of a 2-D predicted `uint16` grid (left + up - up-left, mod 2^16), the high bytes plane then
the low bytes plane. Heights: `y = -600 + 0.05 q` metres above the lake. Shore distance: `(q - 32768) * 0.5` metres,
negative on the water. Cover: plain `uint8` classes, gzip (`build_tahoe.py` `NLCD_MAP`). The world frame: a transverse
Mercator on Fannette Island's summit, x east, z south, y up from the lake surface (`src/sim/geo.js`).
