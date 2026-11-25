# The terrain and ground bakes

The tools that turn public US data into the files under `terrain/` and `v2/photo/`. They run offline, on a
developer's machine; the game only reads their output. Every input is public domain (`ATTRIBUTION.md`).

| Tool | Reads | Writes |
|---|---|---|
| `tools/terrain/fetch_tahoe.sh` | USGS 3DEP elevation, USGS DDS-55 bathymetry, NLCD 2021, the 3DEP lidar points over Fannette Island | `.cache/terrain/raw/` |
| `tools/terrain/build_tahoe.py` | `.cache/terrain/raw/` | `terrain/tahoe.json` and `terrain/<level>-{h,d,c}.lsh` |
| `tools/terrain/carve_channel.mjs` | `terrain/bay-h.lsh`, `basin-h.lsh` | the same files, Emerald Bay's entrance channel carved in (run after `build_tahoe.py`) |
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

## Region levels

A region level is one fine grid over a shore away from Emerald Bay, built alone into `terrain/<region>/`, in the
lake-wide frame and codes. The page fetches it in place of the bay's only when the player starts at a birthplace in that region
(the region row's `level` in `src/waters/<lake>.json`; `v2/terrain/region.js`, `v2/notes/terrain.md` § Region levels).
Today there is one, `south` (South Lake Tahoe, Camp Richardson to Stateline):

| | Desktop | Phone |
|---|---|---|
| Box (texel edges, world m) | x 6,992 to 14,512, z -1,504 to 3,008 | the same |
| Heights | `south-h.lsh`, 4 m, 1880 x 1128 | `south-h2.lsh`, 8 m (2 x 2 block means) |
| Shore distance | `south-d.lsh`, 4 m | `south-d2.lsh`, 8 m |
| Cover (NLCD) | `south-c.lsh`, 8 m | the same file |
| Photo (NAIP 2022) | `photo/full/south/<tx>-<ty>.webp`, 4 m, 256 px tiles | `photo/phone/south/…`, 8 m |
| Manifests | `south.json`, `photo/manifest.json` | `south-phone.json`, `photo/manifest.json` |

The heights come from the 3DEP 1 m lidar (a Gaussian of 1.6 m, read at the texel centres). The bed comes from DDS-55
by the bay's seamless rule (`build_tahoe.py` `seamless_bed`): the survey's cells are kept exactly, and its gaps (45 % of
the box's water, up to 1.6 km off the shore) take a harmonic (Laplace) fill between the surveyed depths and a 1:6 shelf
off the shore, feathered on the filled side of the coverage edge, in place of the nearest surveyed depth's fans. Within
200 m of the box's edge the bed eases into the lake-wide one, so it meets the 10 m and 32 m levels round it
(`v2/tests/south-terrain.test.mjs`).

The pin "Off Ski Run": world (11,800, -875), 22.85 m deep, 1.28 km north-west of Ski Run Marina's pier, with open water
east of it (deeper than 3 m for 1.2 km on heading 95 degrees). Rebuild it:

```sh
TAHOE_SETS="south bathy nlcd" bash tools/terrain/fetch_tahoe.sh                     # 1 m lidar, about 180 MB
.venv/bin/python -I tools/terrain/build_tahoe.py --region south                      # terrain/south/*.lsh, *.json
.venv/bin/python -I tools/ground/fetch_naip.py --out .cache/naip/raw --levels south  # NAIP at 2 m, about 45 MB
.venv/bin/python -I tools/ground/build_naip.py --raw .cache/naip/raw --work .cache/naip/work --out .cache/naip/out --levels south
node tools/v2-photo-tiles.mjs --region south                                          # terrain/south/photo/
```

The full-size albedo files stay in `.cache/naip/out/` (git-ignored); only the tiles are committed. The build is
deterministic for the same downloads (gzip with no timestamp; the WebP tiles from the same Chrome).
