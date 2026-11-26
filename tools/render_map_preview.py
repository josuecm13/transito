"""Render specs/map/world.yaml to an SVG preview and check its internal consistency.

Usage: python tools/render_map_preview.py [out.svg]   (requires PyYAML)
Also checks street_styles against specs/map/street-metrics.yaml.
Exits 1 if any consistency check fails.
"""
import collections
import glob
import math
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WORLD = ROOT / "specs/map/world.yaml"
METRICS = ROOT / "specs/map/street-metrics.yaml"
METRIC_KEYS = ("blocks_measured", "block_area_p10_m2", "block_area_median_m2", "block_area_p90_m2",
               "dead_end_share", "t_share", "x_share", "intersections_per_km2", "street_km_per_km2",
               "mean_segment_m")
MAX_SECTOR_KM2 = 2.0
EARTH_R = 6371008.8
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

COLORS = {
    "colon": "#c9a66b", "jungle-ridge": "#4f7d45", "canal-central": "#6f9a5c",
    "pacific-locks": "#a8a29a", "city-core": "#d8d2c4", "costa-del-este": "#e8e2cf",
    "tito-corridor": "#c98f6b", "airport": "#bdbdbd",
}
WATER, LAKE = "#2e5f80", "#3f7f8f"


def point_in_poly(x, y, poly):
    inside = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def check(w):
    errs = []
    rows = [r.split() for r in w["grid"].strip().splitlines()]
    if len(rows) != 8 or any(len(r) != 6 for r in rows):
        return ["grid must be 8 rows x 6 cols"]
    code2id = {d["code"]: d["id"] for d in w["districts"]}
    cnt = collections.Counter(c for r in rows for c in r)
    for d in w["districts"]:
        if cnt[d["code"]] != d["target_km2"]:
            errs.append(f"area {d['id']}: grid {cnt[d['code']]} vs target {d['target_km2']}")
    for d in w["districts"]:
        if "label_at" in d:
            x, y = d["label_at"]
            got = code2id[rows[7 - int(y // 1000)][int(x // 1000)]]
            if got != d["id"]:
                errs.append(f"district {d['id']}: label_at ({x},{y}) falls in {got}")
    land = w["geometry"]["land"]
    lms = {}
    for l in w["landmarks"]:
        lms[l["id"]] = l
        col, row = int(l["x"] // 1000), 7 - int(l["y"] // 1000)
        got = code2id[rows[row][col]]
        if got != l["district"]:
            errs.append(f"landmark {l['id']} is in {got}, spec says {l['district']}")
        if not l.get("on_water") and not point_in_poly(l["x"], l["y"], land):
            errs.append(f"landmark {l['id']} ({l['x']},{l['y']}) is in the sea")
    for name, r in w["routes"].items():
        for x, y in r["points"]:
            if not (0 <= x <= w["bounds"]["width"] and 0 <= y <= w["bounds"]["height"]):
                errs.append(f"route {name} point {x},{y} out of bounds")
    for f in sorted(glob.glob(str(ROOT / "specs/characters/*-*.md"))):
        fm = yaml.safe_load(Path(f).read_text().split("---")[1])
        for k in ("home", "work", "home_act2"):
            if k in fm and fm[k] not in lms:
                errs.append(f"{Path(f).name}: {k} '{fm[k]}' is not a landmark")
        if fm["home"] in lms and lms[fm["home"]]["district"] != fm["home_district"]:
            errs.append(f"{Path(f).name}: home is not in home_district")
    ax, ay = w["active_area"]["rect"]["x"], w["active_area"]["rect"]["y"]
    if not (0 <= ax[0] < ax[1] <= w["bounds"]["width"] and 0 <= ay[0] < ay[1] <= w["bounds"]["height"]):
        errs.append(f"active_area.rect x={ax} y={ay} must satisfy min < max and lie inside bounds")
    sp = w["active_area"].get("spawn")
    if sp not in lms:
        errs.append(f"active_area.spawn '{sp}' is not a landmark id")
    elif not (ax[0] <= lms[sp]["x"] <= ax[1] and ay[0] <= lms[sp]["y"] <= ay[1]):
        errs.append(f"active_area.spawn '{sp}' is outside active_area.rect")
    dids = {d["id"] for d in w["districts"]}
    for did, b in w["blockout"]["districts"].items():
        if did not in dids:
            errs.append(f"blockout district '{did}' is not a district id")
            continue
        if not b["footprint"][1] < b["lot"]:
            errs.append(f"blockout {did}: footprint max {b['footprint'][1]} must be < lot {b['lot']}")
        if b["footprint"][0] > b["footprint"][1]:
            errs.append(f"blockout {did}: footprint min > max")
        if b["height"][0] > b["height"][1]:
            errs.append(f"blockout {did}: height min > max")
        if not 0 <= b["fill"] <= 1:
            errs.append(f"blockout {did}: fill {b['fill']} not in [0, 1]")
    profiles = w["street_profiles"]
    for name, r in w["routes"].items():
        if r["kind"] not in profiles:
            errs.append(f"route {name}: kind '{r['kind']}' has no street_profiles entry")
    ped = w["population"]["pedestrians"]
    ring, despawn = ped["spawn_ring"], ped["despawn_at"]
    if not ring[0] < ring[1] < despawn:
        errs.append(f"pedestrians: need spawn_ring[0] < spawn_ring[1] < despawn_at, got {ring}, {despawn}")
    if ped["speed"][0] > ped["speed"][1]:
        errs.append("pedestrians: speed min > max")
    if not ped["budget"] > 0:
        errs.append("pedestrians: budget must be > 0")
    street_classes = ["avenue", *((w.get("street_styles") or {}).get("hierarchy") or {}).keys()]
    for k in ped["walk_on"]:
        if k not in street_classes:
            errs.append(f"pedestrians: walk_on '{k}' is not a street class (valid: {', '.join(street_classes)})")
    for l in w["landmarks"]:
        if "trigger_radius" in l:
            if "display_name" not in l:
                errs.append(f"landmark {l['id']}: trigger_radius requires display_name")
            if not l["trigger_radius"] > 0:
                errs.append(f"landmark {l['id']}: trigger_radius must be > 0")
    return errs


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def dist_seg(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def coast_edges(w):
    """Edges of geometry.land that are shoreline (not the west/east land edges at the map border)."""
    land, W = w["geometry"]["land"], w["bounds"]["width"]
    return [(a, b) for a, b in zip(land, land[1:] + land[:1]) if not (a[0] == b[0] and a[0] in (0, W))]


def dist_coast(x, y, edges):
    return min(dist_seg(x, y, a, b) for a, b in edges)


def dist_polyline(x, y, pts):
    return min(dist_seg(x, y, a, b) for a, b in zip(pts, pts[1:]))


def sample_polyline(pts, step):
    """Points along a polyline every `step` m, vertices included."""
    out = [tuple(pts[0])]
    for a, b in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        out += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(1, n + 1)]
    return out


def check_layers(w):
    """Canal and relief sections (the other layer sections were retired with the authored generators, #12 2.5 F5)."""
    errs = []
    land = w["geometry"]["land"]
    W, H = w["bounds"]["width"], w["bounds"]["height"]
    edges = coast_edges(w)
    lms = {l["id"]: l for l in w["landmarks"]}
    routes = w["routes"]

    def inb(p):
        return 0 <= p[0] <= W and 0 <= p[1] <= H

    # --- canal: centreline on land between its mouths, locks and bridges on the channel ---
    canal = w.get("canal") or {}
    cl = None
    if canal:
        rt = routes.get(canal["route"])
        if not rt or rt["kind"] != "waterway":
            errs.append(f"canal.route '{canal['route']}' is not a routes entry of kind waterway")
        else:
            cl = rt["points"]
            half = canal["width"] / 2
            inside = [point_in_poly(x, y, land) for x, y in sample_polyline(cl, 50)]
            if True in inside:
                first, last = inside.index(True), len(inside) - 1 - inside[::-1].index(True)
                if not all(inside[first:last + 1]):
                    errs.append("canal: centreline leaves geometry.land between its two mouths")
            else:
                errs.append("canal: centreline never touches geometry.land")
            if inside[0] or inside[-1]:
                errs.append("canal: both ends of the centreline must reach the sea (outside geometry.land)")
            for lk in canal["locks"]:
                lm = lms.get(lk["landmark"])
                if not lm:
                    errs.append(f"canal.locks {lk['id']}: landmark '{lk['landmark']}' does not exist")
                elif dist_polyline(lm["x"], lm["y"], cl) > 30:
                    errs.append(f"canal.locks {lk['id']}: landmark {lk['landmark']} is {dist_polyline(lm['x'], lm['y'], cl):.0f} m "
                                "from the canal centreline (max 30)")
                if lk["chamber"] != [305, 34]:
                    errs.append(f"canal.locks {lk['id']}: chamber must keep the real 305 x 34 m, got {lk['chamber']}")
            for bl in canal["bridge_landmarks"]:
                lm = lms.get(bl)
                if not lm:
                    errs.append(f"canal.bridge_landmarks: landmark '{bl}' does not exist")
                elif dist_polyline(lm["x"], lm["y"], cl) > half:
                    errs.append(f"canal.bridge_landmarks: {bl} is {dist_polyline(lm['x'], lm['y'], cl):.0f} m from the canal "
                                f"centreline, outside the {half:g} m half-width (not on the channel)")
            if not canal["lake_level"] > canal["sea_level"]:
                errs.append("canal: lake_level must be above sea_level")

    # --- relief ridges and far grid ---
    ids = set()
    for rd in w["relief"].get("ridges") or []:
        if rd["id"] in ids:
            errs.append(f"relief.ridges: duplicate id {rd['id']}")
        ids.add(rd["id"])
        if not (rd["width"] > 0 and rd["amplitude"] > 0):
            errs.append(f"relief.ridges {rd['id']}: width and amplitude must be > 0")
        for x, y in rd["points"]:
            if not point_in_poly(x, y, land):
                errs.append(f"relief.ridges {rd['id']}: crest point ({x},{y}) is in the sea")
    far = w["relief"]["grid"].get("far")
    if not far or not far["cell"] > w["relief"]["grid"]["cell"]:
        errs.append("relief.grid.far.cell must exist and be coarser than relief.grid.cell")
    elif W % far["cell"] or H % far["cell"]:
        errs.append(f"relief.grid.far.cell {far['cell']} must divide the map size {W} x {H}")

    return errs


def bbox_km2(b):
    """Area of [min_lon, min_lat, max_lon, max_lat] with a local equirectangular approximation."""
    min_lon, min_lat, max_lon, max_lat = b
    lat0 = math.radians((min_lat + max_lat) / 2)
    w = math.radians(max_lon - min_lon) * EARTH_R * math.cos(lat0)
    h = math.radians(max_lat - min_lat) * EARTH_R
    return w * h / 1e6


def check_sector(sec, path):
    errs = []
    if not isinstance(sec, dict):
        return [f"{path}: expected a mapping"]
    name = sec.get("name")
    if not isinstance(name, str) or not name:
        errs.append(f"{path}: name must be a non-empty string")
    path = f"{path} ({name})"
    has_bbox = "bbox" in sec
    has_place = "place" in sec or "size_m" in sec
    if has_bbox == has_place:
        errs.append(f"{path}: needs exactly one of bbox or place + size_m")
        return errs
    pinned = "import_area_id" in sec
    if pinned and not (isinstance(sec["import_area_id"], str) and UUID.match(sec["import_area_id"])):
        errs.append(f"{path}: import_area_id must be a UUID")
    if "note" in sec and not isinstance(sec["note"], str):
        errs.append(f"{path}: note must be a string")
    if has_bbox:
        b = sec["bbox"]
        if not (isinstance(b, list) and len(b) == 4 and all(is_num(v) for v in b)):
            return errs + [f"{path}: bbox must be [min_lon, min_lat, max_lon, max_lat] numbers"]
        min_lon, min_lat, max_lon, max_lat = b
        if not min_lon < max_lon:
            errs.append(f"{path}: bbox min_lon {min_lon} must be < max_lon {max_lon}")
        if not min_lat < max_lat:
            errs.append(f"{path}: bbox min_lat {min_lat} must be < max_lat {max_lat}")
        if not all(-180 <= v <= 180 for v in (min_lon, max_lon)):
            errs.append(f"{path}: bbox longitude out of [-180, 180]")
        if not all(-90 <= v <= 90 for v in (min_lat, max_lat)):
            errs.append(f"{path}: bbox latitude out of [-90, 90]")
        if errs:
            return errs
        km2 = bbox_km2(b)
    else:
        place, size = sec.get("place"), sec.get("size_m")
        if not isinstance(place, str) or not place:
            errs.append(f"{path}: place must be a non-empty string")
        if not (is_num(size) and size > 0):
            return errs + [f"{path}: size_m must be a positive number"]
        km2 = size * size / 1e6
    if km2 > MAX_SECTOR_KM2 and not pinned:
        errs.append(f"{path}: area {km2:.2f} km² exceeds {MAX_SECTOR_KM2} km² (only sectors pinned by "
                    "import_area_id may be larger)")
    return errs


def active_land_districts(w):
    """Land districts owning a grid cell inside active_area.rect."""
    rows = [r.split() for r in w["grid"].strip().splitlines()]
    by_code = {d["code"]: d for d in w["districts"]}
    cs = w["bounds"]["cell_size"]
    (x0, x1), (y0, y1) = w["active_area"]["rect"]["x"], w["active_area"]["rect"]["y"]
    out = set()
    for r, row in enumerate(rows):
        cy0 = (len(rows) - 1 - r) * cs
        for c, code in enumerate(row):
            cx0 = c * cs
            if cx0 < x1 and cx0 + cs > x0 and cy0 < y1 and cy0 + cs > y0:
                d = by_code[code]
                if d.get("playable") == "land":
                    out.add(d["id"])
    return out


def check_streets(w, metrics):
    errs = []
    ss = w.get("street_styles")
    if not isinstance(ss, dict):
        return ["street_styles: missing section"]
    if not (isinstance(ss.get("seed"), int) and not isinstance(ss.get("seed"), bool)):
        errs.append("street_styles.seed must be an integer")
    hier = ss.get("hierarchy") or {}
    for cls in ("collector", "local", "alley"):
        h = hier.get(cls)
        if not isinstance(h, dict):
            errs.append(f"street_styles.hierarchy: missing class '{cls}'")
            continue
        if not (is_num(h.get("width")) and h["width"] > 0):
            errs.append(f"street_styles.hierarchy.{cls}: width must be > 0")
        if not (is_num(h.get("sidewalk")) and h["sidewalk"] >= 0):
            errs.append(f"street_styles.hierarchy.{cls}: sidewalk must be >= 0")
    if isinstance(hier.get("alley"), dict) and hier["alley"].get("sidewalk") != 0:
        errs.append("street_styles.hierarchy.alley: sidewalk must be 0")
    dids = {d["id"] for d in w["districts"]}
    sdist = ss.get("districts")
    if not isinstance(sdist, dict):
        return errs + ["street_styles.districts: missing section"]
    W, H = w["bounds"]["width"], w["bounds"]["height"]
    ref_names = []
    for did, d in sdist.items():
        p = f"street_styles.districts.{did}"
        if did not in dids:
            errs.append(f"{p}: '{did}' is not a district id")
        if not isinstance(d, dict):
            errs.append(f"{p}: expected a mapping")
            continue
        style = d.get("style")
        if style == "formal":
            field = d.get("field")
            if not isinstance(field, list) or not field:
                errs.append(f"{p}: formal style needs a non-empty field list")
                field = []
            for i, el in enumerate(field):
                ep = f"{p}.field[{i}]"
                if not isinstance(el, dict):
                    errs.append(f"{ep}: expected a mapping")
                    continue
                kind = el.get("kind")
                if kind == "grid":
                    if not is_num(el.get("angle")):
                        errs.append(f"{ep}: grid needs a numeric angle")
                elif kind == "radial":
                    at = el.get("at")
                    if not (isinstance(at, list) and len(at) == 2 and all(is_num(v) for v in at)):
                        errs.append(f"{ep}: radial needs at: [x, y]")
                    elif not (0 <= at[0] <= W and 0 <= at[1] <= H):
                        errs.append(f"{ep}: radial at {at} is outside bounds")
                elif kind != "coastline":
                    errs.append(f"{ep}: kind '{kind}' must be grid, radial or coastline")
                for k in ("weight", "decay"):
                    if k in el and not (is_num(el[k]) and el[k] > 0):
                        errs.append(f"{ep}: {k} must be a positive number")
            sp = d.get("spacing")
            if not isinstance(sp, dict):
                errs.append(f"{p}: formal style needs spacing {{collector, local}}")
            else:
                for k in ("collector", "local"):
                    if not (is_num(sp.get(k)) and sp[k] > 0):
                        errs.append(f"{p}.spacing.{k} must be a positive number")
        elif style == "informal":
            g = d.get("growth")
            if not isinstance(g, dict):
                errs.append(f"{p}: informal style needs a growth block")
            else:
                sl = g.get("segment_length")
                if not (isinstance(sl, list) and len(sl) == 2 and all(is_num(v) and v > 0 for v in sl)
                        and sl[0] <= sl[1]):
                    errs.append(f"{p}.growth.segment_length must be [min, max] positive with min <= max")
                for k in ("branch_probability", "snap_radius", "min_angle", "alley_probability"):
                    if not (is_num(g.get(k)) and g[k] > 0):
                        errs.append(f"{p}.growth.{k} must be a positive number")
                for k in ("branch_probability", "alley_probability"):
                    if is_num(g.get(k)) and g[k] > 1:
                        errs.append(f"{p}.growth.{k} must be <= 1")
        else:
            errs.append(f"{p}: style '{style}' must be formal or informal")
        lu = d.get("land_use")
        if not isinstance(lu, dict):
            errs.append(f"{p}: land_use {{park, court}} missing")
        else:
            ok = True
            for k in ("park", "court"):
                if not (is_num(lu.get(k)) and 0 <= lu[k] <= 1):
                    errs.append(f"{p}.land_use.{k} must be a number in [0, 1]")
                    ok = False
            if ok and not lu["park"] + lu["court"] < 1:
                errs.append(f"{p}.land_use: park + court = {lu['park'] + lu['court']:g} must be < 1")
        exempt = False
        if "realism" in d:
            if d["realism"] != "exempt":
                errs.append(f"{p}.realism: only 'exempt' is allowed")
            else:
                exempt = True
                reason = d.get("realism_reason")
                if not (isinstance(reason, str) and reason.strip()):
                    errs.append(f"{p}: realism: exempt requires a non-empty realism_reason")
        elif "realism_reason" in d:
            errs.append(f"{p}: realism_reason without realism: exempt")
        refs = d.get("reference", [])
        if not isinstance(refs, list):
            errs.append(f"{p}.reference must be a list of sectors")
            refs = []
        if not refs and not exempt:
            errs.append(f"{p}: needs at least one reference sector (or realism: exempt + realism_reason)")
        for i, sec in enumerate(refs):
            errs += check_sector(sec, f"{p}.reference[{i}]")
            if isinstance(sec, dict) and isinstance(sec.get("name"), str):
                ref_names.append(sec["name"])
    for did in sorted(active_land_districts(w) - set(sdist)):
        errs.append(f"street_styles.districts: active-area land district '{did}' has no entry")
    # Frozen reference metrics.
    refs_m = (metrics or {}).get("references")
    if not isinstance(refs_m, dict):
        return errs + ["street-metrics.yaml: missing references section"]
    for name in ref_names:
        m = refs_m.get(name)
        if not isinstance(m, dict):
            errs.append(f"street-metrics.yaml: reference sector '{name}' has no entry")
            continue
        mm = m.get("metrics") if isinstance(m.get("metrics"), dict) else {}
        for k in METRIC_KEYS:
            if not is_num(mm.get(k)):
                errs.append(f"street-metrics.yaml: {name}.metrics.{k} missing or not numeric")
    band = (metrics or {}).get("band")
    default = band.get("default") if isinstance(band, dict) else None
    if not isinstance(default, dict) or not default:
        return errs + ["street-metrics.yaml: band.default missing"]
    for k, v in default.items():
        if not (is_num(v) and v > 0):
            errs.append(f"street-metrics.yaml: band.default.{k} must be a positive number")
    for name, ov in (band.get("overrides") or {}).items():
        if name not in refs_m:
            errs.append(f"street-metrics.yaml: band override '{name}' is not a reference")
        for k, v in (ov or {}).items():
            if k not in default:
                errs.append(f"street-metrics.yaml: band override {name}.{k} is not a band key")
            elif not (is_num(v) and v > 0):
                errs.append(f"street-metrics.yaml: band override {name}.{k} must be a positive number")
    return errs


def render_layers(w, s, pts):
    """SVG for the relief ridges and the canal channel with its locks."""
    H = w["bounds"]["height"]
    out = ['<g id="layers-1-5">']
    xy = lambda p: (p[0] * s, (H - p[1]) * s)
    for rd in (w["relief"].get("ridges") or []):
        out.append(f'<polyline points="{pts(rd["points"])}" fill="none" stroke="#7a5230" stroke-width="{max(2, rd["width"]*2*s/3):.0f}" stroke-opacity="0.35" stroke-linecap="round"/>'
                   f'<polyline points="{pts(rd["points"])}" fill="none" stroke="#7a5230" stroke-width="1.5" stroke-dasharray="6 3"/>')
    canal = w.get("canal")
    if canal:
        cl = w["routes"][canal["route"]]["points"]
        out.append(f'<polyline points="{pts(cl)}" fill="none" stroke="{WATER}" stroke-width="{canal["width"]*s:.0f}" stroke-linejoin="round" stroke-opacity="0.9"/>')
        for lk in canal["locks"]:
            lm = next(l for l in w["landmarks"] if l["id"] == lk["landmark"])
            cx, cy = xy((lm["x"], lm["y"]))
            out.append(f'<rect x="{cx-9:.0f}" y="{cy-4:.0f}" width="18" height="8" fill="#e9e4d8" stroke="#333" stroke-width="1"/>'
                       f'<text x="{cx+12:.0f}" y="{cy-6:.0f}" font-size="9" fill="#fff" stroke="#000" stroke-width="2" paint-order="stroke">{lk["id"]} x{lk["steps"]}</text>')
    out.append("</g>")
    return out


def render(w):
    W, H = w["bounds"]["width"], w["bounds"]["height"]
    s = 0.1  # 1 px = 10 m
    def pts(p): return " ".join(f"{x*s:.0f},{(H-y)*s:.0f}" for x, y in p)
    rows = [r.split() for r in w["grid"].strip().splitlines()]
    code2id = {d["code"]: d["id"] for d in w["districts"]}
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W*s:.0f}" height="{H*s:.0f}" font-family="sans-serif">',
           f'<rect width="100%" height="100%" fill="{WATER}"/>',
           '<defs><clipPath id="land">' f'<polygon points="{pts(w["geometry"]["land"])}"/></clipPath></defs>',
           '<g clip-path="url(#land)">']
    for r, row in enumerate(rows):
        for c, code in enumerate(row):
            did = code2id[code]
            fill = LAKE if did == "gatun-lake" else COLORS.get(did, WATER)
            out.append(f'<rect x="{c*1000*s}" y="{r*1000*s}" width="{1000*s}" height="{1000*s}" fill="{fill}"/>')
    out.append("</g>")
    for isl in w["geometry"]["islands"]:
        out.append(f'<polygon points="{pts(isl["points"])}" fill="#4f7d45"/>')
    (x0, x1), (y0, y1) = w["active_area"]["rect"]["x"], w["active_area"]["rect"]["y"]
    out.append(f'<rect x="{x0*s:.0f}" y="{(H-y1)*s:.0f}" width="{(x1-x0)*s:.0f}" height="{(y1-y0)*s:.0f}" '
               'fill="none" stroke="#d7263d" stroke-width="2" stroke-dasharray="6 4"/>')
    for side in w["geometry"]["playable_boundary"].values():
        out.append(f'<polyline points="{pts(side["points"])}" fill="none" stroke="#111" stroke-width="3" stroke-dasharray="8 6"/>')
    style = {"waterway": (WATER, 14), "highway": ("#f2c14e", 5), "rail": ("#333", 3),
             "arterial": ("#fff", 3), "road": ("#fff", 2), "runway": ("#555", 5)}
    for r in w["routes"].values():
        color, width = style[r["kind"]]
        out.append(f'<polyline points="{pts(r["points"])}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"/>')
    out += render_layers(w, s, pts)
    # District names: at `label_at` if given, else on the district's cell closest to its centroid.
    halo = 'stroke="#fff" stroke-width="4" paint-order="stroke" text-anchor="middle"'
    for d in w["districts"]:
        cells = [(c, r) for r, row in enumerate(rows) for c, code in enumerate(row) if code == d["code"]]
        if d["id"] == "sea" or not cells:
            continue
        if "label_at" in d:
            cx, cy = d["label_at"][0] * s, (H - d["label_at"][1]) * s
        else:
            mc = sum(c for c, _ in cells) / len(cells)
            mr = sum(r for _, r in cells) / len(cells)
            c, r = min(cells, key=lambda cr: (cr[0] - mc) ** 2 + (cr[1] - mr) ** 2)
            cx, cy = (c + 0.5) * 1000 * s, (r + 0.5) * 1000 * s
        sub = d.get("sub") or ", ".join(p.strip() for p in d["inspired_by"].split(",")[:3])
        out.append(f'<text x="{cx:.0f}" y="{cy:.0f}" font-size="17" font-weight="bold" fill="#222" {halo}>{d["name"]}</text>'
                   f'<text x="{cx:.0f}" y="{cy+15:.0f}" font-size="10" fill="#444" {halo}>{sub}</text>')
    for wl in w["geometry"].get("water_labels", []):
        out.append(f'<text x="{wl["x"]*s:.0f}" y="{(H-wl["y"])*s:.0f}" font-size="18" font-style="italic" '
                   f'fill="#cfe3ef" text-anchor="middle">{wl["name"]}</text>')
    for l in w["landmarks"]:
        x, y = l["x"]*s, (H-l["y"])*s
        out.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="5" fill="#d7263d" stroke="#fff"/>'
                   f'<text x="{x+7:.0f}" y="{y+4:.0f}" font-size="11" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">{l["id"]}</text>')
    out.append("</svg>")
    return "\n".join(out)


# --- procedural: inputs of the procedural isthmus (mirror of parseProcedural in src/world/spec.ts) ---
# Rules: num, pos (> 0), nonneg, frac ([0, 1]), int1 (integer >= 1), pt (map point), span ([min < max]),
# pair, str, octaves, a nested dict, or a callable for lists. A leading "?" marks an optional key.
AIRPORT_TERMINAL_STOP = "airport-terminal"
OCTAVES = {"wavelength": "pos", "octaves": "int1", "?gain": "frac", "?lacunarity": "num"}
PROC_SCHEMA = {
    "cell": "pos",
    "relief": {
        "seed": "num", "background": "nonneg", "zones": "list",
        "modulation": {"lo": "nonneg", "hi": "num", "octaves": OCTAVES, "warp": "nonneg", "grain_deg": "num", "grain_ratio": "pos"},
        "coast_taper": "pos", "coast_wobble": {"amplitude": "nonneg", "octaves": OCTAVES},
        "erosion": {"iterations": "int1", "k": "pos", "m": "pos", "dt": "pos", "diffusion": "nonneg"},
        "peak": "pos", "peak_quantile": "num", "sea_floor": {"shore": "nonneg", "slope": "pos"},
        "hummocks": {"amplitude": "nonneg", "octaves": OCTAVES, "inland": "span", "max_slope": "pos"},
    },
    "lake": {"dam_hint": "pt", "snap_radius": "pos", "min_inland": "nonneg", "frame_margin": "nonneg", "target_km2": "pos"},
    "rivers": {"min_area_km2": "pos", "width_per_sqrt_km2": "pos", "max_width": "pos"},
    "canal": {"caribbean": "pt", "pacific_locks": "pt", "pacific": "pt", "width": "pos", "depth": "pos", "dig_weight": "nonneg"},
    "airport": {
        "hint": "pt", "radius": "pos", "runway_length": "pos", "runway_spacing": "pos", "runway_width": "pos",
        "margin": "nonneg", "distance_weight": "nonneg", "heading_range": "span",
        "apron": {"length": "pos", "depth": "pos", "building": "pair"}, "edge_margin": "nonneg", "towards": "pt",
        "culvert_penalty": "nonneg", "grade_slope_max": "nonneg", "grade_reach_max": "nonneg",
    },
    "roads": {
        "grade": {k: {"g0": "pos", "k": "pos", "max_grade": "pos"} for k in ("highway", "road", "rail")},
        "bridge": "pos", "sea_bridge": "pos", "canal_bridge": "pos", "reuse": "pos", "stops": "stops", "routes": "list",
    },
    "suitability": {"max_slope": "pos", "height_band": "span", "coast_fade": "frac", "coast_range": "pos", "crossing": "frac"},
    "towns": {"road_discount": "pos", "jitter": "nonneg", "jitter_wavelength": "pos", "min_suitability": "frac",
              "seed_snap": "nonneg", "seed": "num", "separation": "nonneg", "airport_buffer": "nonneg", "items": "list"},
    "cover": {
        "seed": "num", "beach_width": "nonneg",
        "mangrove": {"max_height": "pos", "river_area_km2": "pos", "reach": "nonneg"},
        "clearing": {"wavelength": "pos", "threshold": "frac", "lowland_bonus": "nonneg", "fringe_bonus": "nonneg"},
        "high_forest": {"height": "pos", "slope": "pos"},
    },
    "transit": {"stops": "stops", "lines": "list", "off_urban": "pos", "off_road": "pos",
                "grade": {"metro": "pos", "rail": "pos"}, "bridge": "pos", "interchange_radius": "pos"},
    "act1": {"line": "str", "branch_to": "str", "anchor_at": "frac", "town": "str", "barrio_radius": "pos", "strip_half_width": "pos"},
    "?landmarks": "landmark_rules",
    "?trails": "list",
    "game": {"district_cell": "pos", "rect_margin": "nonneg", "districts": "game_districts"},
}
ZONE = {"line": {"id": "str", "kind": "str", "points": "pts2", "width": "pos", "rate": "nonneg"},
        "disc": {"id": "str", "kind": "str", "at": "pt", "radius": "pos", "rate": "nonneg"}}
ROUTE = {"id": "str", "kind": "str", "stops": "refs"}
TOWN = {"id": "str", "target_km2": "pos", "?seeds": "pts1", "?seed_along": {"route": "str", "from": "str", "?reach": "pos"}, "?road_affinity": "pos",
        "?patches": {"wavelength": "pos", "threshold": "frac"}}
LINE = {"id": "str", "name": "str", "mode": "str", "color": "color", "branches": "branches", "station_spacing": "pos"}


def check_procedural(w):
    """procedural: strict keys, value rules, stop references and ids (src/world/spec.ts parseProcedural)."""
    errs = []
    W, H = w["bounds"]["width"], w["bounds"]["height"]

    def is_pt(v):
        return isinstance(v, list) and len(v) == 2 and all(is_num(c) for c in v)

    def value(v, rule, path):
        if isinstance(rule, dict):
            section(v, rule, path)
        elif rule in ("num", "pos", "nonneg", "frac", "int1"):
            if not is_num(v):
                errs.append(f"{path}: expected a number")
            elif rule == "pos" and not v > 0:
                errs.append(f"{path}: must be > 0")
            elif rule == "nonneg" and not v >= 0:
                errs.append(f"{path}: must be >= 0")
            elif rule == "frac" and not 0 <= v <= 1:
                errs.append(f"{path}: expected a fraction in [0, 1]")
            elif rule == "int1" and not (isinstance(v, int) and v >= 1):
                errs.append(f"{path}: expected an integer >= 1")
        elif rule == "str":
            if not isinstance(v, str) or not v:
                errs.append(f"{path}: expected a non-empty string")
        elif rule in ("pair", "span"):
            if not is_pt(v):
                errs.append(f"{path}: expected [number, number]")
            elif rule == "span" and not v[0] < v[1]:
                errs.append(f"{path}: expected [min, max] with min < max")
        elif rule == "pt":
            if not is_pt(v):
                errs.append(f"{path}: expected [x, y]")
            elif not (0 <= v[0] <= W and 0 <= v[1] <= H):
                errs.append(f"{path}: ({v[0]}, {v[1]}) is outside the map")
        elif rule in ("pts1", "pts2"):
            n = 1 if rule == "pts1" else 2
            if not isinstance(v, list) or len(v) < n:
                errs.append(f"{path}: expected at least {n} points")
            else:
                for i, q in enumerate(v):
                    value(q, "pt", f"{path}[{i}]")
        elif rule == "color":
            if not (isinstance(v, list) and len(v) == 3 and all(isinstance(c, int) and 0 <= c <= 255 for c in v)):
                errs.append(f"{path}: expected [r, g, b] integers 0-255")
        # list / stops / refs / branches are checked by the callers below

    def section(o, schema, path):
        if not isinstance(o, dict):
            errs.append(f"{path}: expected a mapping")
            return False
        keys = {k.lstrip("?"): k.startswith("?") for k in schema}
        for k in o:
            if k not in keys:
                errs.append(f"{path}.{k}: unknown key (allowed: {', '.join(keys)})")
        for k, opt in keys.items():
            if k not in o:
                if not opt:
                    errs.append(f"{path}.{k}: missing")
                continue
            value(o[k], schema[("?" if opt else "") + k], f"{path}.{k}")
        return True

    def unique(items, path):
        seen = set()
        for it in items:
            i = it.get("id") if isinstance(it, dict) else None
            if i in seen:
                errs.append(f"{path}: duplicate id '{i}'")
            seen.add(i)

    def stops(v, path):
        if not isinstance(v, dict) or not v:
            errs.append(f"{path}: expected at least one stop")
            return {}
        for k, q in v.items():
            if k == AIRPORT_TERMINAL_STOP:
                errs.append(f"{path}.{k}: reserved stop id (the generated airport terminal)")
            value(q, "pt", f"{path}.{k}")
        return v

    def refs(v, path, known):
        if not isinstance(v, list) or len(v) < 2 or not all(isinstance(x, str) and x for x in v):
            errs.append(f"{path}: expected at least 2 stop ids")
            return
        for x in v:
            if x != AIRPORT_TERMINAL_STOP and x not in known:
                errs.append(f"{path}: unknown stop '{x}'")

    pr = w.get("procedural")
    if not section(pr, PROC_SCHEMA, "procedural"):
        return errs

    rel = pr.get("relief") or {}
    zones = rel.get("zones") if isinstance(rel.get("zones"), list) else []
    for i, z in enumerate(zones):
        kind = z.get("kind") if isinstance(z, dict) else None
        if kind not in ZONE:
            errs.append(f"procedural.relief.zones[{i}].kind: expected line or disc")
        else:
            section(z, ZONE[kind], f"procedural.relief.zones[{i}]")
    unique(zones, "procedural.relief.zones")
    mod = rel.get("modulation") or {}
    if is_num(mod.get("lo")) and is_num(mod.get("hi")) and not mod["hi"] > mod["lo"]:
        errs.append("procedural.relief.modulation.hi: must be > lo")
    if is_num((rel.get("erosion") or {}).get("diffusion")) and rel["erosion"]["diffusion"] > 0.2:
        errs.append("procedural.relief.erosion.diffusion: must be <= 0.2 (explicit step stability)")
    if is_num(rel.get("peak_quantile")) and not 0 < rel["peak_quantile"] < 1:
        errs.append("procedural.relief.peak_quantile: expected 0 < q < 1")

    ap = pr.get("airport") or {}
    hr = ap.get("heading_range")
    if is_pt(hr) and not (hr[0] >= 0 and hr[1] <= 180):
        errs.append("procedural.airport.heading_range: expected degrees within [0, 180]")
    b = (ap.get("apron") or {}).get("building")
    if is_pt(b) and not (b[0] > 0 and b[1] > 0):
        errs.append("procedural.airport.apron.building: expected [length, depth] > 0")
    if is_num(ap.get("runway_spacing")) and is_num(ap.get("runway_width")) and not ap["runway_spacing"] > ap["runway_width"]:
        errs.append("procedural.airport.runway_spacing: must be > runway_width (runways would overlap)")

    rd = pr.get("roads") or {}
    road_stops = stops(rd.get("stops"), "procedural.roads.stops")
    routes = rd.get("routes") if isinstance(rd.get("routes"), list) else []
    for i, r in enumerate(routes):
        p = f"procedural.roads.routes[{i}]"
        if section(r, ROUTE, p):
            if r.get("kind") not in ("highway", "road", "rail"):
                errs.append(f"{p}.kind: expected highway, road, rail")
            refs(r.get("stops"), f"{p}.stops", road_stops)
    unique(routes, "procedural.roads.routes")
    by_route = {r.get("id"): r for r in routes if isinstance(r, dict)}

    tw = pr.get("towns") or {}
    items = tw.get("items") if isinstance(tw.get("items"), list) else []
    for i, t in enumerate(items):
        p = f"procedural.towns.items[{i}]"
        if not section(t, TOWN, p):
            continue
        if ("seeds" in t) == ("seed_along" in t):
            errs.append(f"{p}: expected exactly one of seeds, seed_along")
        sa = t.get("seed_along")
        if isinstance(sa, dict):
            rt = by_route.get(sa.get("route"))
            if not rt:
                errs.append(f"{p}.seed_along.route: unknown route '{sa.get('route')}'")
            elif rt.get("kind") == "rail":
                errs.append(f"{p}.seed_along.route: '{sa['route']}' is a railroad; towns grow along roads")
            elif sa.get("from") == AIRPORT_TERMINAL_STOP or sa.get("from") not in (rt.get("stops") or []):
                errs.append(f"{p}.seed_along.from: '{sa.get('from')}' is not a named stop of route '{sa['route']}'")
    unique(items, "procedural.towns.items")

    tr = pr.get("transit") or {}
    transit_stops = stops(tr.get("stops"), "procedural.transit.stops")
    lines = tr.get("lines") if isinstance(tr.get("lines"), list) else []
    for i, l in enumerate(lines):
        p = f"procedural.transit.lines[{i}]"
        if not section(l, LINE, p):
            continue
        if l.get("mode") not in ("metro", "rail"):
            errs.append(f"{p}.mode: expected metro, rail")
        br = l.get("branches")
        if not isinstance(br, list) or not br:
            errs.append(f"{p}.branches: expected at least one branch")
        else:
            for j, b2 in enumerate(br):
                refs(b2, f"{p}.branches[{j}]", transit_stops)
    unique(lines, "procedural.transit.lines")

    a1 = pr.get("act1")
    if isinstance(a1, dict):
        p = "procedural.act1"
        if a1.get("anchor_at") in (0, 1):
            errs.append(f"{p}.anchor_at: must be strictly between 0 and 1")
        line = next((l for l in lines if isinstance(l, dict) and l.get("id") == a1.get("line")), None)
        if line is None:
            errs.append(f'{p}.line: unknown transit line "{a1.get("line")}"')
        else:
            br = line.get("branches") if isinstance(line.get("branches"), list) else []
            ending = [b for b in br if isinstance(b, list) and b and b[-1] == a1.get("branch_to")]
            if len(ending) != 1:
                errs.append(f'{p}.branch_to: {len(ending)} branches of {a1.get("line")} end at "{a1.get("branch_to")}" (expected exactly 1)')
        if a1.get("town") not in {t.get("id") for t in items if isinstance(t, dict)}:
            errs.append(f'{p}.town: unknown town "{a1.get("town")}"')

    gm = pr.get("game")
    if isinstance(gm, dict):
        p = "procedural.game"
        dc = gm.get("district_cell")
        if is_num(dc) and dc > 0 and (W % dc or H % dc):
            errs.append(f"{p}.district_cell: {dc} m must divide the bounds ({W} × {H})")
        gd = gm.get("districts")
        sources = ["sea", "lake", "wild", "airport", *[t.get("id") for t in items if isinstance(t, dict)]]
        dids = {d["id"] for d in w["districts"]}
        if not isinstance(gd, dict):
            errs.append(f"{p}.districts: expected a mapping")
        else:
            for k in gd:
                if k not in sources:
                    errs.append(f"{p}.districts.{k}: unknown key (allowed: {', '.join(sources)})")
            for src in sources:
                if src not in gd:
                    errs.append(f"{p}.districts.{src}: missing")
                elif gd[src] not in dids:
                    errs.append(f'{p}.districts.{src}: unknown district "{gd[src]}"')

    lm = pr.get("landmarks")
    if lm is not None:
        p = "procedural.landmarks"
        ids = {l["id"] for l in w["landmarks"]}
        if not isinstance(lm, dict):
            errs.append(f"{p}: expected a mapping")
            lm = {}
        for lid, rule in lm.items():
            if lid not in ids:
                errs.append(f"{p}.{lid}: unknown landmark (not in landmarks:)")
            if rule == "anchor":
                continue
            if isinstance(rule, dict):
                # PyYAML (YAML 1.1) reads a bare `on` key as the boolean True; js-yaml keeps the string.
                rule = {("on" if k is True else k): v for k, v in rule.items()}
            if isinstance(rule, dict) and "on" in rule:
                allowed = {"on", "route", "feature", "tolerance"}
                for k in rule:
                    if k not in allowed:
                        errs.append(f"{p}.{lid}.{k}: unknown key (allowed: {', '.join(sorted(allowed))})")
                if rule.get("on") != "crossing":
                    errs.append(f"{p}.{lid}.on: expected crossing")
                route_ids = {r.get("id") for r in ((pr.get("roads") or {}).get("routes") or []) if isinstance(r, dict)}
                if rule.get("route") not in route_ids:
                    errs.append(f"{p}.{lid}.route: unknown route {rule.get('route')!r} (not in procedural.roads.routes)")
                if rule.get("feature") != "canal":
                    errs.append(f"{p}.{lid}.feature: expected canal")
                if not (is_num(rule.get("tolerance")) and rule["tolerance"] > 0):
                    errs.append(f"{p}.{lid}.tolerance: must be > 0")
                continue
            if not (isinstance(rule, dict) and len(rule) == 1 and next(iter(rule)) in ("along", "steepest_within", "airport")):
                errs.append(f"{p}.{lid}: expected anchor, {{ along: m }}, {{ steepest_within: m }} or {{ airport: terminal | apron }} or {{ on: crossing, route, feature: canal, tolerance: m }}")
                continue
            k, v = next(iter(rule.items()))
            if k == "airport":
                if v not in ("terminal", "apron"):
                    errs.append(f"{p}.{lid}.airport: expected terminal | apron")
            elif not (is_num(v) and v > 0):
                errs.append(f"{p}.{lid}.{k}: must be > 0")
    tr = pr.get("trails")
    if tr is not None:
        p = "procedural.trails"
        if not isinstance(tr, list):
            errs.append(f"{p}: expected a list")
            tr = []
        trail_keys = {"id": "str", "from": "str", "to": {"highest_within": "pos", "margin": "nonneg", "min_distance": "nonneg"},
                      "width": "pos", "max_grade": "pos", "min_length": "pos", "max_length": "pos"}
        for i, t in enumerate(tr):
            if section(t, trail_keys, f"{p}[{i}]"):
                if isinstance(t.get("from"), str) and t["from"] != AIRPORT_TERMINAL_STOP:
                    errs.append(f"{p}[{i}].from: expected {AIRPORT_TERMINAL_STOP} (the landside of the generated terminal)")
                if is_num(t.get("min_length")) and is_num(t.get("max_length")) and not t["max_length"] >= t["min_length"]:
                    errs.append(f"{p}[{i}].max_length: must be >= min_length")
        unique(tr, p)
    return errs


SCALE_KEYS = {"human", "storey", "door", "lane", "sidewalk_min", "traffic"}


def check_scale(w):
    """Mirror of parseScale / checkScale in src/world/spec.ts (human scale, README "Human scale")."""
    errs = []
    sc = w.get("scale")
    if not isinstance(sc, dict):
        return ["scale: expected a mapping"]
    for k in sorted(set(sc) - SCALE_KEYS):
        errs.append(f"scale.{k}: unknown key (allowed: {', '.join(sorted(SCALE_KEYS))})")
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
    for k in ("human", "storey", "sidewalk_min"):
        if not (num(sc.get(k)) and sc[k] > 0):
            errs.append(f"scale.{k}: must be a number > 0")
    door, lane = sc.get("door"), sc.get("lane")
    if not (isinstance(door, list) and len(door) == 2 and all(num(v) and v > 0 for v in door)):
        errs.append("scale.door: [width, height] must be > 0")
    elif num(sc.get("storey")) and sc["storey"] < door[1]:
        errs.append(f"scale.storey: {sc['storey']} m does not fit a {door[1]} m door (scale.door)")
    if not (isinstance(lane, list) and len(lane) == 2 and all(num(v) for v in lane) and 0 < lane[0] <= lane[1]):
        errs.append("scale.lane: expected [min, max] with 0 < min <= max")
    traffic = sc.get("traffic")
    if not (isinstance(traffic, list) and all(isinstance(k, str) for k in traffic)):
        errs.append("scale.traffic: expected a list of street_profiles kinds")
        traffic = []
    for k in traffic:
        if k not in w["street_profiles"]:
            errs.append(f'scale.traffic: unknown street_profiles kind "{k}"')
    if errs:
        return errs
    storey, smin = sc["storey"], sc["sidewalk_min"]

    def whole_lanes(width):
        if not width > 0:
            return None
        n = max(1, math.ceil(width / lane[1] - 1e-9))
        return n if n * lane[0] <= width + 1e-9 else None

    def street(path, width, sidewalk):
        if whole_lanes(width) is None:
            errs.append(f"{path}.width: {width} m is not a whole number of {lane[0]}–{lane[1]} m lanes (scale.lane)")
        if sidewalk != 0 and not sidewalk >= smin:
            errs.append(f"{path}.sidewalk: {sidewalk} m must be 0 or at least {smin} m (scale.sidewalk_min)")

    for k in traffic:
        p = w["street_profiles"][k]
        street(f"street_profiles.{k}", p["width"], p["sidewalk"])
    for cls, p in ((w.get("street_styles") or {}).get("hierarchy") or {}).items():
        street(f"street_styles.hierarchy.{cls}", p["width"], p["sidewalk"])
    for rid, r in w["routes"].items():
        if "width" in r and r["kind"] in traffic:
            street(f"routes.{rid}", r["width"], 0)
    for did, b in w["blockout"]["districts"].items():
        lo, hi = b["height"]
        if max(1, math.ceil(lo / storey - 1e-9)) > math.floor(hi / storey + 1e-9):
            errs.append(f"blockout.districts.{did}.height: [{lo}, {hi}] holds no whole {storey} m storey (scale.storey)")
        fl = b.get("frontage_lots") or {}
        if "level_height" in fl:
            errs.append(f"blockout.districts.{did}.frontage_lots.level_height: removed, storeys come from scale.storey")
    return errs


if __name__ == "__main__":
    w = yaml.safe_load(WORLD.read_text())
    metrics = yaml.safe_load(METRICS.read_text()) if METRICS.exists() else None
    errs = check(w) + check_streets(w, metrics) + check_layers(w) + check_procedural(w) + check_scale(w)
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "specs/map/preview.svg"
    out.write_text(render(w))
    print(f"wrote {out}")
    if errs:
        print("\n".join(errs))
        sys.exit(1)
    print("OK: areas, landmark cells, coastline, character refs, active area, blockout, street profiles, population, street styles, reference sectors, street metrics, relief ridges and canal, procedural inputs, human scale consistent")
