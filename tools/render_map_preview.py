"""Render specs/map/world.yaml to an SVG preview and check its internal consistency.

Usage: python tools/render_map_preview.py [out.svg]   (requires PyYAML)
Exits 1 if any consistency check fails.
"""
import collections
import glob
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WORLD = ROOT / "specs/map/world.yaml"

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
    for k in ped["walk_on"]:
        if k not in profiles:
            errs.append(f"pedestrians: walk_on kind '{k}' has no street_profiles entry")
    for l in w["landmarks"]:
        if "trigger_radius" in l:
            if "display_name" not in l:
                errs.append(f"landmark {l['id']}: trigger_radius requires display_name")
            if not l["trigger_radius"] > 0:
                errs.append(f"landmark {l['id']}: trigger_radius must be > 0")
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
    errs = check(w)
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "specs/map/preview.svg"
    out.write_text(render(w))
    print(f"wrote {out}")
    if errs:
        print("\n".join(errs))
        sys.exit(1)
    print("OK: areas, landmark cells, coastline, character refs, active area, blockout, street profiles, population consistent")
