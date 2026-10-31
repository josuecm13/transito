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
    for side in w["geometry"]["playable_boundary"].values():
        out.append(f'<polyline points="{pts(side["points"])}" fill="none" stroke="#111" stroke-width="3" stroke-dasharray="8 6"/>')
    style = {"waterway": (WATER, 14), "highway": ("#f2c14e", 5), "rail": ("#333", 3),
             "arterial": ("#fff", 3), "road": ("#fff", 2), "runway": ("#555", 5)}
    for r in w["routes"].values():
        color, width = style[r["kind"]]
        out.append(f'<polyline points="{pts(r["points"])}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"/>')
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
    print("OK: areas, landmark cells, coastline, character refs consistent")
