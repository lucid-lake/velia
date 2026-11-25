#!/usr/bin/env bash
# Fetch the public-domain raw inputs for tools/terrain/build_tahoe.py into .cache/terrain/raw/ (git-ignored).
# USGS 3DEP Bare Earth DEM (dynamic service, the best source per pixel: 1 m lidar round the lake, 1/3" elsewhere),
# exported in UTM 10N (EPSG:26910, NAD83) metres, float32 GeoTIFF. Free, no key. Idempotent: skips files present.
#   bash tools/terrain/fetch_tahoe.sh [repo root]     (Python: .venv, see tools/terrain/README.md)
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
RAW="$ROOT/.cache/terrain/raw"; mkdir -p "$RAW"
SVC="https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
dem() {   # name E0 N0 E1 N1 pixel_m: tiles of at most 2000 px a side (bigger exports fail), mosaicked by the build
  local name="$1" e0="$2" n0="$3" e1="$4" n1="$5" px="$6" T=2000
  local step=$(( T * px )) e n out w h
  for (( n = n0; n < n1; n += step )); do for (( e = e0; e < e1; e += step )); do
    local ee=$(( e + step < e1 ? e + step : e1 )) nn=$(( n + step < n1 ? n + step : n1 ))
    w=$(( (ee - e) / px )); h=$(( (nn - n) / px )); out="$RAW/${name}_${e}_${n}.tif"
    [ -s "$out" ] && continue
    echo "fetch $(basename "$out") ${w}x${h} @ ${px} m"
    curl -sf --retry 4 --retry-delay 5 -m 600 -o "$out.part" "$SVC?bbox=$e,$n,$ee,$nn&bboxSR=26910&imageSR=26910&size=$w,$h&format=tiff&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&f=image" \
      || { echo "FAILED $out"; rm -f "$out.part"; return 1; }
    mv "$out.part" "$out"
  done; done
}
# Fannette Island at E 751300, N 4315694 (UTM 10N).
dem dem1m_bay   748200 4313600 754800 4317600 1      # Emerald Bay and its walls, 1 m (lidar)
dem dem10m_basin 739000 4303000 763000 4327000 10    # 24 km round the bay
dem dem30m_lake 734000 4300000 782000 4362000 30     # the whole lake and its rim
dem dem100m_ring 701000 4265000 801000 4365000 100   # the far Sierra ring, ±50 km
# USGS DDS-55 Lake Tahoe bathymetry (1998 multibeam, 10 m ArcInfo export grid, elevations in m), public domain
[ -s "$RAW/lt_bathy.e00.gz" ] || curl -sf --retry 3 -m 600 -o "$RAW/lt_bathy.e00.gz" https://pubs.usgs.gov/dds/dds-55/pacmaps/exports/lt_bathy.e00.gz
[ -s "$RAW/lt_meta.htm" ] || curl -sf --retry 3 -m 60 -o "$RAW/lt_meta.htm" https://pubs.usgs.gov/dds/dds-55/pacmaps/lt_meta.htm
# NLCD 2021 land cover and impervious (MRLC WCS, Albers EPSG:5070, 30 m), public domain: the lake's box plus 1 km
WCS="https://www.mrlc.gov/geoserver/mrlc_download/wcs?service=WCS&version=2.0.1&request=GetCoverage&format=image/geotiff&subset=X(-2068904,-2003724)&subset=Y(2005957,2081416)"
for c in NLCD_2021_Land_Cover_L48 NLCD_2021_Impervious_L48; do
  [ -s "$RAW/nlcd_$c.tif" ] || curl -sf --retry 3 -m 600 -o "$RAW/nlcd_$c.tif" "$WCS&coverageid=mrlc_download__$c"
done
# Fannette Island's lidar points: the DEMs above lose the island (the lake's hydro-flattening polygon covers it)
PY="${PYTHON:-$ROOT/.venv/bin/python}"
"$PY" -I "$(dirname "$0")/fetch_island_lidar.py" --raw "$RAW"
ls -la "$RAW"
