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


if __name__ == "__main__":
    w = yaml.safe_load(WORLD.read_text())
    metrics = yaml.safe_load(METRICS.read_text()) if METRICS.exists() else None
    errs = check(w) + check_streets(w, metrics)
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "specs/map/preview.svg"
    out.write_text(render(w))
    print(f"wrote {out}")
    if errs:
        print("\n".join(errs))
        sys.exit(1)
    print("OK: areas, landmark cells, coastline, character refs, active area, blockout, street profiles, population, street styles, reference sectors, street metrics consistent")
