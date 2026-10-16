/**
 * 2D geometry primitives, in integer millimetres.
 *
 * Ported from `mep/src/core/geom.ts`, which is metres. arch works in integer millimetres
 * throughout because every structural dimension in the domain is one — the 1200 module, its
 * 400/600 subdivisions, a 45x195 section, a 2800 wall — and because integers make modular
 * snapping exact: `isModularMm(7200)` is a remainder test, not a float comparison with an
 * epsilon. Millimetres are converted to metres in exactly two places: the three.js render
 * boundary (`render/frame.ts`) and never for IFC, which arch writes in millimetres too.
 *
 * "Mm" in a name is a unit, not a scale prefix on an already-scaled value.
 */

export interface Vec2Mm {
    x: number;
    y: number;
}

export interface Bounds2Mm {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Coincidence tolerance, in mm. Two points closer than this are the same point.
 *
 * Deliberately sub-millimetre even though the model is integer-millimetre: intermediate
 * results (a polygon centroid, a line/polygon intersection, a plane solve) are floats, and
 * only the final member coordinates are rounded. A 1 mm tolerance here would weld genuinely
 * distinct points a carpenter can distinguish.
 */
export const WELD_EPS_MM = 0.1;

export function emptyBounds2(): Bounds2Mm {
    return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function isEmptyBounds2(b: Bounds2Mm): boolean {
    return !(b.minX <= b.maxX && b.minY <= b.maxY);
}

export function growBounds2(b: Bounds2Mm, x: number, y: number): void {
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
}

export function boundsOfRing2(ring: readonly Vec2Mm[]): Bounds2Mm {
    const b = emptyBounds2();
    for (const p of ring) growBounds2(b, p.x, p.y);
    return b;
}

export function boundsWidth2(b: Bounds2Mm): number {
    return isEmptyBounds2(b) ? 0 : b.maxX - b.minX;
}

export function boundsHeight2(b: Bounds2Mm): number {
    return isEmptyBounds2(b) ? 0 : b.maxY - b.minY;
}

export function boundsCenter2(b: Bounds2Mm): Vec2Mm {
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function distance2(a: Vec2Mm, b: Vec2Mm): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Signed area of a closed ring via the shoelace formula, mm². Positive = counter-clockwise. */
export function signedArea2(ring: readonly Vec2Mm[]): number {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        sum += ring[j]!.x * ring[i]!.y - ring[i]!.x * ring[j]!.y;
    }
    return sum / 2;
}

export function polygonArea2(ring: readonly Vec2Mm[]): number {
    return Math.abs(signedArea2(ring));
}

/** Ray-casting point-in-polygon test. Boundary cases are not defined — do not rely on them. */
export function pointInPolygon2(p: Vec2Mm, ring: readonly Vec2Mm[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

/** Distance from `p` to the nearest edge of a closed ring, mm. */
export function distanceToRing2(p: Vec2Mm, ring: readonly Vec2Mm[]): number {
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
        const q = nearestPointOnSegment2(p, ring[i]!, ring[(i + 1) % ring.length]!);
        best = Math.min(best, distance2(p, q));
    }
    return best;
}

/**
 * Point-in-polygon with the boundary counted as inside, to `toleranceMm`. The test to use
 * where a point *on* the ring is a legitimate answer — a door's sill on a wall's base.
 */
export function pointInOrOnPolygon2(p: Vec2Mm, ring: readonly Vec2Mm[], toleranceMm = 1): boolean {
    return pointInPolygon2(p, ring) || distanceToRing2(p, ring) <= toleranceMm;
}

/** Nearest point on segment `a`-`b` to `p`, clamped to the segment (not the infinite line). */
export function nearestPointOnSegment2(p: Vec2Mm, a: Vec2Mm, b: Vec2Mm): Vec2Mm {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-9) return { x: a.x, y: a.y };
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * True area-weighted centroid via shoelace accumulation, correct for concave rings — unlike a
 * plain vertex average, which can land outside a concave shape entirely.
 */
export function polygonCentroid2(ring: readonly Vec2Mm[]): Vec2Mm {
    const a = signedArea2(ring);
    if (Math.abs(a) < 1e-9) {
        const n = ring.length || 1;
        let vx = 0;
        let vy = 0;
        for (const p of ring) {
            vx += p.x;
            vy += p.y;
        }
        return { x: vx / n, y: vy / n };
    }
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const p0 = ring[j]!;
        const p1 = ring[i]!;
        const cross = p0.x * p1.y - p1.x * p0.y;
        cx += (p0.x + p1.x) * cross;
        cy += (p0.y + p1.y) * cross;
    }
    const factor = 1 / (6 * a);
    return { x: cx * factor, y: cy * factor };
}

/**
 * Rounds to integer millimetres. The single place that enforces arch's integer-mm rule.
 *
 * Recipes divide — a midpoint, an equal subdivision of a span, a bisected ray boundary — so
 * intermediate values are floats by necessity. Every coordinate that reaches a stored member
 * passes through here, which is what `frame-model.spec.ts`'s "every generated coordinate is an
 * integer" assertion actually tests.
 */
export function mmRound(value: number): number {
    return Math.round(value);
}

/**
 * Convex hull of a point set, counter-clockwise, by Andrew's monotone chain.
 *
 * Exists for `minAreaRect2` below, which is only correct when it rotates through *hull* edges
 * — see that function's note. Collinear points are dropped (strict `<= 0` turn test), so a hull
 * edge is never split into two identical directions, which would make the rotating search do
 * the same work twice.
 */
export function convexHull2(points: readonly Vec2Mm[]): Vec2Mm[] {
    if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: Vec2Mm, a: Vec2Mm, b: Vec2Mm): number =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const half = (src: readonly Vec2Mm[]): Vec2Mm[] => {
        const out: Vec2Mm[] = [];
        for (const p of src) {
            while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) {
                out.pop();
            }
            out.push({ x: p.x, y: p.y });
        }
        out.pop();
        return out;
    };
    const lower = half(sorted);
    const upper = half([...sorted].reverse());
    const hull = [...lower, ...upper];
    return hull.length >= 3 ? hull : sorted.map((p) => ({ x: p.x, y: p.y }));
}

/** An oriented rectangle: a centre, two unit axes and the extents along them. */
export interface OrientedRect2 {
    centerMm: Vec2Mm;
    /** Unit vector along the rectangle's long side. */
    longDir: Vec2Mm;
    /** Unit vector along the short side — `longDir` rotated +90°. */
    shortDir: Vec2Mm;
    longMm: number;
    shortMm: number;
}

/**
 * The minimum-area rotated rectangle enclosing a point set — how "which way do the joists
 * span?" is actually answered, since joists span the short way.
 *
 * Rotating calipers over the **convex hull's own edges**, not over arbitrary angles: the
 * Freeman–Shapira result is that a minimum-area enclosing rectangle always has a side flush
 * with a hull edge, so testing one orientation per hull edge is both exact and finite. Sampling
 * angles instead would be approximate and slower for the same answer.
 *
 * Returns null for a degenerate set (fewer than 3 distinct points).
 */
export function minAreaRect2(points: readonly Vec2Mm[]): OrientedRect2 | null {
    const hull = convexHull2(points);
    if (hull.length < 3) return null;
    let best: OrientedRect2 | null = null;
    let bestArea = Infinity;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i]!;
        const b = hull[(i + 1) % hull.length]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-9) continue;
        const ex = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        const ey = { x: -ex.y, y: ex.x };
        let minU = Infinity;
        let maxU = -Infinity;
        let minV = Infinity;
        let maxV = -Infinity;
        for (const p of hull) {
            const u = p.x * ex.x + p.y * ex.y;
            const v = p.x * ey.x + p.y * ey.y;
            minU = Math.min(minU, u);
            maxU = Math.max(maxU, u);
            minV = Math.min(minV, v);
            maxV = Math.max(maxV, v);
        }
        const du = maxU - minU;
        const dv = maxV - minV;
        const area = du * dv;
        if (area >= bestArea) continue;
        bestArea = area;
        const cu = (minU + maxU) / 2;
        const cv = (minV + maxV) / 2;
        const centerMm = { x: ex.x * cu + ey.x * cv, y: ex.y * cu + ey.y * cv };
        const longFirst = du >= dv;
        best = {
            centerMm,
            longDir: longFirst ? ex : ey,
            shortDir: longFirst ? ey : ex,
            longMm: Math.max(du, dv),
            shortMm: Math.min(du, dv),
        };
    }
    return best;
}

/** One interval of a line that lies inside a polygon, as parameters along the line's direction. */
export interface LineInterval {
    t0: number;
    t1: number;
}

/**
 * The parts of an infinite line that lie inside a ring with holes, as parameter intervals
 * along `dir` from `origin`.
 *
 * Intersect every edge, sort the crossing parameters, and keep the odd–even interior runs —
 * the 1D form of the same ray-casting rule `pointInPolygon2` uses. Doing it this way rather
 * than clipping against a convex decomposition is what makes a concave floor and a stairwell
 * hole fall out for free: a hole is just more edges contributing more crossings.
 *
 * Edges exactly parallel to the line contribute nothing, and a vertex crossing is counted once
 * by the half-open `>=`/`<` span test, so a joist line passing exactly through a corner does
 * not toggle the inside flag twice and vanish.
 */
export function clipLineToPolygon2(
    origin: Vec2Mm,
    dir: Vec2Mm,
    rings: readonly (readonly Vec2Mm[])[]
): LineInterval[] {
    const nx = -dir.y;
    const ny = dir.x;
    const crossings: number[] = [];
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[j]!;
            const b = ring[i]!;
            // Signed side of each endpoint relative to the line.
            const sa = (a.x - origin.x) * nx + (a.y - origin.y) * ny;
            const sb = (b.x - origin.x) * nx + (b.y - origin.y) * ny;
            if (sa === sb) continue;
            // Half-open in `sa`: a vertex sitting exactly on the line belongs to one edge only.
            if (!(sa <= 0 && sb > 0) && !(sb <= 0 && sa > 0)) continue;
            const f = sa / (sa - sb);
            const px = a.x + (b.x - a.x) * f;
            const py = a.y + (b.y - a.y) * f;
            crossings.push((px - origin.x) * dir.x + (py - origin.y) * dir.y);
        }
    }
    crossings.sort((p, q) => p - q);
    const intervals: LineInterval[] = [];
    for (let i = 0; i + 1 < crossings.length; i += 2) {
        const t0 = crossings[i]!;
        const t1 = crossings[i + 1]!;
        if (t1 - t0 > WELD_EPS_MM) intervals.push({ t0, t1 });
    }
    return intervals;
}

/**
 * Triangles covering a simple polygon, by ear clipping — the plain-data counterpart of three's
 * `ShapeUtils.triangulateShape`, for the packages that must not import three. Concave rings are
 * fine; self-intersecting ones are not (they are not polygons). Collinear corners are dropped as
 * they are met rather than becoming zero-area triangles. Every triangle is counter-clockwise.
 */
export function triangulatePolygon2(ring: readonly Vec2Mm[]): [Vec2Mm, Vec2Mm, Vec2Mm][] {
    const pts = signedArea2(ring) < 0 ? [...ring].reverse() : [...ring];
    const idx = pts.map((_, i) => i);
    const out: [Vec2Mm, Vec2Mm, Vec2Mm][] = [];
    const cross = (a: Vec2Mm, b: Vec2Mm, c: Vec2Mm): number =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    while (idx.length > 3) {
        let clipped = false;
        for (let k = 0; k < idx.length; k++) {
            const n = idx.length;
            const a = pts[idx[(k - 1 + n) % n]!]!;
            const b = pts[idx[k]!]!;
            const c = pts[idx[(k + 1) % n]!]!;
            const turn = cross(a, b, c);
            if (Math.abs(turn) < 1e-6) {
                idx.splice(k, 1);
                clipped = true;
                break;
            }
            if (turn < 0) continue;
            // An ear holds no other corner of the ring, on its edges included.
            const blocked = idx.some((j) => {
                const p = pts[j]!;
                if (p === a || p === b || p === c) return false;
                return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
            });
            if (blocked) continue;
            out.push([a, b, c]);
            idx.splice(k, 1);
            clipped = true;
            break;
        }
        // Only a ring that is not simple can leave nothing clippable; stop rather than spin.
        if (!clipped) break;
    }
    if (idx.length === 3) {
        const [a, b, c] = idx.map((i) => pts[i]!) as [Vec2Mm, Vec2Mm, Vec2Mm];
        if (cross(a, b, c) > 1e-6) out.push([a, b, c]);
    }
    return out;
}
