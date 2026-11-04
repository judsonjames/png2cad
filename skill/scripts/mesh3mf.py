"""Polygons to watertight meshes, and meshes to 3MF.

No third-party mesh libraries: polygons with holes are triangulated by hole bridging plus ear
clipping, extruded into closed prisms, and written as a core-spec 3MF (millimetres) that Bambu
Studio, Orca Slicer and its forks, PrusaSlicer and Cura open.

3MF layout: one mesh object per part (named, with a display color from a basematerials group),
grouped under one parent object made of components, so slicers load it as ONE object with named
parts. Metadata/model_settings.config (the Bambu Studio / Orca Slicer convention) assigns part k
to filament k + 1, so each material lands on its own filament slot.
"""
import zipfile
import xml.etree.ElementTree as ET
import numpy as np

# ---------- polygon helpers (all 2D, millimetres) ----------


def signed_area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def point_in_poly(pt, poly):
    """Even-odd test of one point against one closed polygon."""
    x, y = pt
    xs, ys = poly[:, 0], poly[:, 1]
    xn, yn = np.roll(xs, -1), np.roll(ys, -1)
    cross = (ys > y) != (yn > y)
    with np.errstate(divide="ignore", invalid="ignore"):
        xi = xs + (y - ys) * (xn - xs) / (yn - ys)
    return bool(np.count_nonzero(cross & (x < xi)) % 2)


def clean_loop(p, tol=1e-7):
    """Drop repeated points and points in a straight line with their neighbours (they give zero-area
    triangles). tol is twice the triangle area in mm2."""
    p = np.asarray(p, float)
    changed = True
    while changed and len(p) > 3:
        changed = False
        q = np.roll(p, -1, axis=0)
        keep = np.linalg.norm(q - p, axis=1) > 1e-9
        if not keep.all():
            p, changed = p[keep], True
            continue
        a, c = np.roll(p, 1, axis=0), np.roll(p, -1, axis=0)
        cr = np.abs((p[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (p[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0]))
        flat = cr <= tol
        if flat.any():
            flat &= ~np.roll(flat, 1)            # never drop two neighbours in one pass
            p, changed = p[~flat], True
    return p


def nest_loops(loops):
    """Group closed loops into regions: [(outer, [holes...]), ...], outer CCW and holes CW.
    A loop's depth is how many other loops contain it; even depth = outer, odd = hole."""
    loops = [clean_loop(l) for l in loops]
    loops = [l for l in loops if len(l) >= 3 and abs(signed_area(l)) > 1e-9]
    n = len(loops)
    areas = [abs(signed_area(l)) for l in loops]
    inside = np.zeros((n, n), bool)            # inside[i, j]: loop i lies inside loop j
    for i in range(n):
        probe = loops[i][0]
        for j in range(n):
            if i != j and areas[j] > areas[i] and point_in_poly(probe, loops[j]):
                inside[i, j] = True
    depth = inside.sum(1)
    regions = {}
    for i in np.argsort(depth):
        if depth[i] % 2 == 0:
            regions[i] = []
    for i in range(n):
        if depth[i] % 2 == 1:                   # parent = the smallest containing outer
            parents = [j for j in range(n) if inside[i, j] and depth[j] == depth[i] - 1]
            if parents:
                regions[min(parents, key=lambda j: areas[j])].append(i)
    out = []
    for o, hs in regions.items():
        outer = loops[o] if signed_area(loops[o]) > 0 else loops[o][::-1]
        holes = [loops[h] if signed_area(loops[h]) < 0 else loops[h][::-1] for h in hs]
        out.append((outer, holes))
    return out


def _cross(o, a, b):
    return (a[..., 0] - o[..., 0]) * (b[..., 1] - o[..., 1]) - (a[..., 1] - o[..., 1]) * (b[..., 0] - o[..., 0])


def _in_cone(prev, v, nxt, x):
    """Is point x inside the interior angle of a CCW polygon at vertex v (O'Rourke's InCone)?"""
    if _cross(v, nxt, prev) >= 0:                       # convex vertex
        return _cross(v, x, prev) > 0 and _cross(x, v, nxt) > 0
    return not (_cross(v, x, nxt) >= 0 and _cross(x, v, prev) >= 0)


def bridge_holes(outer, holes):
    """Join holes into the outer loop with zero-width bridges (Eberly). Returns (points, ids) where
    ids index the original vertices (outer first, then each hole in order), so duplicates share ids."""
    pts = [tuple(p) for p in outer]
    ids = list(range(len(outer)))
    base = len(outer)
    hole_info = []
    for h in holes:
        hole_info.append((h, base))
        base += len(h)
    hole_info.sort(key=lambda t: -t[0][:, 0].max())
    for h, off in hole_info:
        m = int(np.argmax(h[:, 0]))
        M = h[m]
        P = np.array(pts)
        A, B = P, np.roll(P, -1, axis=0)
        best_x, best_k = np.inf, None
        for k in range(len(P)):                # nearest edge hit by a ray from M toward +x
            a, b = A[k], B[k]
            if (a[1] > M[1]) == (b[1] > M[1]):
                continue
            if a[1] == b[1]:
                continue
            x = a[0] + (M[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if M[0] <= x < best_x:
                best_x, best_k = x, k
        if best_k is None:
            raise ValueError("hole bridging failed: hole not inside outer loop")
        a, b = A[best_k], B[best_k]
        k = best_k if a[0] >= b[0] else (best_k + 1) % len(P)
        Ppt = P[k]
        I = np.array([best_x, M[1]])
        # a reflex vertex inside triangle (M, I, P) blocks the bridge: take the one closest in angle
        nxt, prv = np.roll(P, -1, axis=0), np.roll(P, 1, axis=0)
        reflex = _cross(prv, P, nxt) < 0
        tri = [M, I, Ppt] if _cross(M, I, Ppt) > 0 else [M, Ppt, I]
        c1, c2, c3 = _cross(tri[0], tri[1], P), _cross(tri[1], tri[2], P), _cross(tri[2], tri[0], P)
        inside = reflex & (c1 >= 0) & (c2 >= 0) & (c3 >= 0) & ~np.all(P == Ppt, axis=1)
        if abs(_cross(M, I, Ppt)) <= 1e-12:
            # the ray hit the vertex itself: it is visible. (The triangle is flat, and a flat triangle
            # would count every point on that line as inside, sending the bridge through the vertex.)
            inside[:] = False
        if inside.any():
            cand = np.nonzero(inside)[0]
            d = P[cand] - M
            ang = np.abs(np.arctan2(d[:, 1], d[:, 0]))
            k = int(cand[np.lexsort((np.hypot(d[:, 0], d[:, 1]), ang))[0]])
        # the target point may appear several times (earlier bridges end there too): use the copy
        # whose interior angle contains the direction to M, or the new bridge interleaves wrongly
        copies = np.nonzero(np.all(P == P[k], axis=1))[0]
        if len(copies) > 1:
            k = next((int(c) for c in copies if _in_cone(P[(c - 1) % len(P)], P[c], P[(c + 1) % len(P)], M)),
                     int(k))
        hole_seq = [tuple(h[(m + j) % len(h)]) for j in range(len(h))] + [tuple(M)]
        hole_ids = [off + (m + j) % len(h) for j in range(len(h))] + [off + m]
        pts = pts[:k + 1] + hole_seq + pts[k:]
        ids = ids[:k + 1] + hole_ids + ids[k:]
    return np.array(pts, float), ids


def ear_clip(P):
    """Triangulate a CCW, weakly simple polygon (bridged holes allowed). Returns index triples
    into P, and how many ears had to be forced (0 for a clean polygon)."""
    n = len(P)
    if n < 3:
        return [], 0
    prev = np.array([(i - 1) % n for i in range(n)])
    nxt = np.array([(i + 1) % n for i in range(n)])
    alive = np.ones(n, bool)
    eps = 1e-12

    def is_reflex(i):
        return _cross(P[prev[i]], P[i], P[nxt[i]]) <= eps

    reflex = np.array([is_reflex(i) for i in range(n)])
    tris, forced, remaining, i, stall, relaxed = [], 0, n, 0, 0, False
    while remaining > 3:
        p, q = prev[i], nxt[i]
        ear = False
        if not reflex[i]:
            cand = np.nonzero(alive & reflex)[0]
            cand = cand[(cand != p) & (cand != q) & (cand != i)]
            if len(cand):
                C = P[cand]
                same = (np.all(C == P[p], 1) | np.all(C == P[i], 1) | np.all(C == P[q], 1))
                C = C[~same]
                # strict mode: a vertex on the triangle's edge blocks the ear; relaxed mode lets it
                # pass (bridged holes put duplicate vertices on candidate edges)
                lim = eps if relaxed else -eps
                c1, c2, c3 = _cross(P[p], P[i], C), _cross(P[i], P[q], C), _cross(P[q], P[p], C)
                inside = (c1 > lim) & (c2 > lim) & (c3 > lim) if relaxed else (c1 >= lim) & (c2 >= lim) & (c3 >= lim)
                ear = not inside.any()
            else:
                ear = True
        if not ear and stall > remaining:
            if not relaxed:                    # a full lap with no ear: retry with the relaxed test
                relaxed, stall = True, 0
                continue
            live = np.nonzero(alive)[0]        # still stuck: clip the most convex vertex
            conv = np.array([_cross(P[prev[j]], P[j], P[nxt[j]]) for j in live])
            i = int(live[np.argmax(conv)])
            p, q = prev[i], nxt[i]
            ear, forced = True, forced + 1
        if ear:
            tris.append((p, i, q))
            alive[i] = False
            nxt[p], prev[q] = q, p
            remaining -= 1
            reflex[p], reflex[q] = is_reflex(p), is_reflex(q)
            i, stall, relaxed = q, 0, False
        else:
            i, stall = nxt[i], stall + 1
    live = np.nonzero(alive)[0]
    a = live[0]
    tris.append((prev[a], a, nxt[a]))
    return tris, forced


def fix_slivers(tris, pts, tol=1e-9):
    """Remove zero-area triangles from a 2D triangulation by edge flips: a sliver (a, b, c) with b on
    edge a-c is merged with the triangle across a-c, (a, c, d), and re-split as (a, b, d), (b, c, d).
    The surface stays closed (just dropping the sliver would leave a crack)."""
    tris = [tuple(t) for t in tris]
    for _ in range(4 * len(tris) + 1):
        bad = None
        cr = np.abs(_cross(pts[[t[0] for t in tris]], pts[[t[1] for t in tris]], pts[[t[2] for t in tris]])) \
            if tris else np.zeros(0)
        for k in np.nonzero(cr <= tol)[0]:
            a, b, c = tris[k]
            if len({a, b, c}) == 3:
                bad = k
                break
        if bad is None:
            return tris
        a, b, c = tris[bad]
        # rotate so that b is the middle point (lies between a and c)
        for _ in range(3):
            if np.dot(pts[a] - pts[b], pts[c] - pts[b]) <= 0:
                break
            a, b, c = b, c, a
        # the sliver runs c -> a along its long edge, so the triangle across holds a -> c
        mate = next((k for k, t in enumerate(tris) if k != bad and
                     any(t[i] == a and t[(i + 1) % 3] == c for i in range(3))), None)
        if mate is None:                          # sliver on the boundary: nothing across, drop it
            tris.pop(bad)
            continue
        t = tris[mate]
        i = next(i for i in range(3) if t[i] == a and t[(i + 1) % 3] == c)
        d = t[(i + 2) % 3]
        for k in sorted((bad, mate), reverse=True):
            tris.pop(k)
        tris += [(a, b, d), (b, c, d)]
    return tris


def resolve_touching(loops, tol=1e-6):
    """Where a vertex of one loop lies on an edge of another (a hole touching the outline at a point),
    insert it into that edge too, so the two loops share the point instead of forming a T-junction."""
    out = [np.asarray(l, float) for l in loops]
    for i in range(len(out)):
        for j in range(len(out)):
            if i == j:
                continue
            A = out[j]
            B = np.roll(A, -1, axis=0)
            lo = np.minimum(A, B) - tol
            hi = np.maximum(A, B) + tol
            inserts = {}
            for v in out[i]:
                cand = np.nonzero(np.all((v >= lo) & (v <= hi), axis=1))[0]
                for k in cand:
                    a, b = A[k], B[k]
                    ab = b - a
                    L2 = ab @ ab
                    if L2 == 0:
                        continue
                    t = ((v - a) @ ab) / L2
                    if not (1e-9 < t < 1 - 1e-9):
                        continue
                    if abs(ab[0] * (v[1] - a[1]) - ab[1] * (v[0] - a[0])) / np.sqrt(L2) < tol:
                        inserts.setdefault(int(k), []).append((t, v.copy()))
            if inserts:
                newl = []
                for k in range(len(A)):
                    newl.append(A[k])
                    for _, v in sorted(inserts.get(k, []), key=lambda e: e[0]):
                        newl.append(v)
                out[j] = np.array(newl)
    return out


def extrude(regions, z0, z1):
    """Closed prisms for regions [(outer CCW, [holes CW])]. Returns (vertices Nx3, triangles Mx3, forced)."""
    V, T, forced = [], [], 0
    for outer, holes in regions:
        loops = resolve_touching([outer] + list(holes))
        outer, holes = loops[0], loops[1:]
        flat = np.vstack(loops)
        nv = len(flat)
        # triangulate in a slightly rotated frame: outlines traced from pixels have many exactly
        # horizontal edges at equal heights, which the horizontal bridge ray would hit exactly.
        # The triangles index the same points, so the real geometry is untouched.
        rot = np.array([[np.cos(0.6180339), -np.sin(0.6180339)], [np.sin(0.6180339), np.cos(0.6180339)]])
        P, ids = bridge_holes(outer @ rot.T, [hh @ rot.T for hh in holes])
        tris, f = ear_clip(P)
        forced += f
        ids = np.array(ids)
        # work in unique-vertex ids so bridge duplicates are one vertex, then flip away slivers
        tris = [(ids[a], ids[b], ids[c]) for a, b, c in tris if len({ids[a], ids[b], ids[c]}) == 3]
        # slivers judged on the coordinates as written to the file (6 decimals, 0.000001 mm); at
        # 4 decimals nearly aligned points became exactly aligned and the flips misjudged sides
        tris = fix_slivers(tris, np.round(flat, 6), tol=1e-12)
        base = sum(x.shape[0] for x in V)
        V.append(np.hstack([flat, np.full((nv, 1), z0)]))      # bottom ring: base .. base+nv-1
        V.append(np.hstack([flat, np.full((nv, 1), z1)]))      # top ring: base+nv ..
        bot, top = base, base + nv
        for ia, ib, ic in tris:
            T.append((top + ia, top + ib, top + ic))           # top faces up (CCW)
            T.append((bot + ia, bot + ic, bot + ib))           # bottom faces down
        start = 0
        for l in loops:                                        # walls, outward (interior is on the left)
            k = len(l)
            for j in range(k):
                a, b = start + j, start + (j + 1) % k
                T.append((bot + a, bot + b, top + b))
                T.append((bot + a, top + b, top + a))
            start += k
    if not V:
        return np.zeros((0, 3)), np.zeros((0, 3), int), 0
    return np.vstack(V), np.array(T, int), forced


# ---------- mesh checks ----------


def mesh_check(V, T):
    """Watertight and consistently oriented: every directed edge appears once and its reverse once."""
    e = np.vstack([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    key = e[:, 0].astype(np.int64) * (len(V) + 1) + e[:, 1]
    rkey = e[:, 1].astype(np.int64) * (len(V) + 1) + e[:, 0]
    uniq, counts = np.unique(key, return_counts=True)
    dup = int((counts > 1).sum())
    unmatched = int((~np.isin(key, rkey)).sum())
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    vol = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)
    nrm = np.cross(b - a, c - a)
    area2 = np.linalg.norm(nrm, axis=1)
    folded = count_folded(V, T, nrm, area2)
    return {"triangles": int(len(T)), "open_edges": unmatched, "duplicate_edges": dup,
            "volume_mm3": vol, "degenerate": int((area2 < 1e-12).sum()), "folded": folded,
            "watertight": unmatched == 0 and dup == 0 and vol > 0 and folded == 0}


def count_folded(V, T, nrm, area2):
    """Folded cap triangles: in each shell (a connected piece of the mesh), every flat face on the
    shell's top level must face up and every flat face on its bottom level must face down. A folded
    triangle faces the wrong way, and its overlap is hidden in the volume and area totals."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    n = len(V)
    rows = np.concatenate([T[:, 0], T[:, 1], T[:, 2]])
    cols = np.concatenate([T[:, 1], T[:, 2], T[:, 0]])
    _, comp = connected_components(coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n)), directed=False)
    tcomp = comp[T[:, 0]]
    z = V[T][:, :, 2]
    flat = np.isclose(z[:, 0], z[:, 1]) & np.isclose(z[:, 1], z[:, 2]) & (area2 > 1e-12)
    bad = 0
    for c in np.unique(tcomp):
        m = tcomp == c
        zs = V[np.unique(T[m])][:, 2]
        top, bot = zs.max(), zs.min()
        at_top = m & flat & np.isclose(z[:, 0], top)
        at_bot = m & flat & np.isclose(z[:, 0], bot)
        bad += int((nrm[at_top, 2] < 0).sum() + (nrm[at_bot, 2] > 0).sum())
    return bad


# ---------- 3MF ----------

NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
MAT = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02"


def write_3mf(path, parts, title="part", project=None, center=None):
    """parts: list of dicts {name, color (r, g, b), V (Nx3 mm), T (Mx3)}. One parent object, one part each.
    project: optional Bambu project settings dict (bambu_profile.project_settings). With it the file
    says it comes from Bambu Studio, so Bambu Studio loads the printer, process and one filament per
    part; without it the file is plain 3MF and Bambu Studio loads geometry only.
    center: (x, y) bed point to place the plate's centre on (Bambu beds start at the front-left corner)."""
    app = f"BambuStudio-{project['version']}" if project else "png2cad"
    out = [f'<?xml version="1.0" encoding="UTF-8"?>',
           f'<model unit="millimeter" xml:lang="en-US" xmlns="{NS}" xmlns:m="{MAT}">',
           f' <metadata name="Title">{title}</metadata>',
           f' <metadata name="Application">{app}</metadata>']
    if project:
        out.append(' <metadata name="BambuStudio:3mfVersion">1</metadata>')
    out += [
           ' <resources>',
           '  <basematerials id="1">']
    for p in parts:
        r, g, b = p["color"]
        out.append(f'   <base name="{p["name"]}" displaycolor="#{r:02X}{g:02X}{b:02X}FF"/>')
    out.append('  </basematerials>')
    for k, p in enumerate(parts):
        oid = k + 2
        out.append(f'  <object id="{oid}" type="model" name="{p["name"]}" pid="1" pindex="{k}">')
        out.append('   <mesh>')
        out.append('    <vertices>')
        out += [f'     <vertex x="{x:.6f}" y="{y:.6f}" z="{z:.6f}"/>' for x, y, z in p["V"]]
        out.append('    </vertices>')
        out.append('    <triangles>')
        out += [f'     <triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in p["T"]]
        out.append('    </triangles>')
        out.append('   </mesh>')
        out.append('  </object>')
    parent = len(parts) + 2
    out.append(f'  <object id="{parent}" type="model" name="{title}">')
    out.append('   <components>')
    out += [f'    <component objectid="{k + 2}"/>' for k in range(len(parts))]
    out.append('   </components>')
    out.append('  </object>')
    out.append(' </resources>')
    out.append(' <build>')
    if center is not None:
        allv = np.vstack([p["V"] for p in parts])
        mid = (allv.min(0) + allv.max(0)) / 2
        tx, ty = center[0] - mid[0], center[1] - mid[1]
        out.append(f'  <item objectid="{parent}" transform="1 0 0 0 1 0 0 0 1 {tx:.6f} {ty:.6f} {-allv[:, 2].min():.6f}" printable="1"/>')
    else:
        out.append(f'  <item objectid="{parent}"/>')
    out.append(' </build>')
    out.append('</model>')
    ctypes = ('<?xml version="1.0" encoding="UTF-8"?>\n'
              '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
              ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
              ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
              '</Types>\n')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            ' <Relationship Target="/3D/3dmodel.model" Id="rel0" '
            'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
            '</Relationships>\n')
    ident = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"
    cfg = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>', f'  <object id="{parent}">',
           f'    <metadata key="name" value="{title}"/>', '    <metadata key="extruder" value="1"/>']
    for k, p in enumerate(parts):
        cfg += [f'    <part id="{k + 2}" subtype="normal_part">',
                f'      <metadata key="name" value="{p["name"]}"/>',
                f'      <metadata key="matrix" value="{ident}"/>',
                f'      <metadata key="extruder" value="{k + 1}"/>',
                '    </part>']
    cfg += ['  </object>', '</config>']
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ctypes)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", "\n".join(out) + "\n")
        z.writestr("Metadata/model_settings.config", "\n".join(cfg) + "\n")
        if project:
            import json
            z.writestr("Metadata/project_settings.config", json.dumps(project, indent=4) + "\n")


def read_3mf(path):
    """Read parts back: list of {name, color, V, T, extruder}, following the build item and its
    components; extruder comes from Metadata/model_settings.config when present."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        for req in ("[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"):
            if req not in names:
                raise ValueError(f"missing {req}")
        root = ET.fromstring(z.read("3D/3dmodel.model"))
        cfg = ET.fromstring(z.read("Metadata/model_settings.config")) if "Metadata/model_settings.config" in names else None
    ext = {}
    if cfg is not None:
        for part in cfg.iter("part"):
            for md in part.findall("metadata"):
                if md.get("key") == "extruder":
                    ext[part.get("id")] = int(md.get("value"))
    ns = {"c": NS}
    mats = {}
    for bm in root.iter(f"{{{NS}}}basematerials"):
        mats[bm.get("id")] = [b.get("displaycolor") for b in bm.findall("c:base", ns)]
    objs = {o.get("id"): o for o in root.iter(f"{{{NS}}}object")}
    item = root.find("c:build/c:item", ns)
    parent = objs[item.get("objectid")]
    comps = parent.findall("c:components/c:component", ns)
    targets = [objs[c.get("objectid")] for c in comps] if comps else [parent]
    parts = []
    for o in targets:
        vs = o.findall("c:mesh/c:vertices/c:vertex", ns)
        ts = o.findall("c:mesh/c:triangles/c:triangle", ns)
        V = np.array([[float(v.get("x")), float(v.get("y")), float(v.get("z"))] for v in vs])
        T = np.array([[int(t.get("v1")), int(t.get("v2")), int(t.get("v3"))] for t in ts])
        col = mats.get(o.get("pid"), [None])[int(o.get("pindex", 0))] if o.get("pid") else None
        parts.append({"name": o.get("name"), "color": col, "V": V, "T": T, "extruder": ext.get(o.get("id"))})
    return parts, item.get("objectid"), parent.get("name")
