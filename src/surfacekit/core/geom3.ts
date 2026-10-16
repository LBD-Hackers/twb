/**
 * 3D geometry primitives, in integer millimetres, in arch's model frame.
 *
 * The model frame is right-handed and **Z-up**: X east, Y north, Z up. That is deliberately
 * the IFC frame, so `ifc/` performs no axis maths at all — a model coordinate is written into
 * the STEP file verbatim. `mep` carries a Y-up render frame and a mirror because its geometry
 * arrives from `@ifc-lite/geometry`'s WebGL pipeline; arch authors all of its own, so it does
 * not inherit that tax. The one conversion, to three.js's Y-up metres, lives in
 * `render/frame.ts` and nowhere else.
 */

import type { Vec2Mm } from './geom2';
import { pointInOrOnPolygon2, pointInPolygon2 } from './geom2';

export interface Point3Mm {
    x: number;
    y: number;
    z: number;
}

/** A unit vector. Same shape as `Point3Mm`, but dimensionless — named to keep them apart. */
export type Dir3 = Point3Mm;

export function add3(a: Point3Mm, b: Point3Mm): Point3Mm {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub3(a: Point3Mm, b: Point3Mm): Point3Mm {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale3(a: Point3Mm, k: number): Point3Mm {
    return { x: a.x * k, y: a.y * k, z: a.z * k };
}

export function dot3(a: Point3Mm, b: Point3Mm): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross3(a: Point3Mm, b: Point3Mm): Point3Mm {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

export function length3(a: Point3Mm): number {
    return Math.hypot(a.x, a.y, a.z);
}

export function distance3(a: Point3Mm, b: Point3Mm): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * The stretch of segment `a0`–`a1` that segment `b0`–`b1` lies along — both ends of `b` within
 * `toleranceMm` of `a`'s line, overlapping it by at least `minLengthMm` — or null. Where two
 * faces share an edge, however differently each was split along it.
 */
export function collinearOverlap3(
    a0: Point3Mm,
    a1: Point3Mm,
    b0: Point3Mm,
    b1: Point3Mm,
    toleranceMm: number,
    minLengthMm: number
): [Point3Mm, Point3Mm] | null {
    const len = distance3(a0, a1);
    if (len < minLengthMm || len < 1e-9) return null;
    const d = scale3(sub3(a1, a0), 1 / len);
    const off = (p: Point3Mm): number => {
        const rel = sub3(p, a0);
        return length3(sub3(rel, scale3(d, dot3(rel, d))));
    };
    if (off(b0) > toleranceMm || off(b1) > toleranceMm) return null;
    const t0 = dot3(sub3(b0, a0), d);
    const t1 = dot3(sub3(b1, a0), d);
    const from = Math.max(0, Math.min(t0, t1));
    const to = Math.min(len, Math.max(t0, t1));
    if (to - from < minLengthMm) return null;
    return [add3(a0, scale3(d, from)), add3(a0, scale3(d, to))];
}

/** The point on segment `ab` nearest to `p`, and its parameter `t` in [0, 1] along the segment. */
export function nearestPointOnSegment3(
    p: Point3Mm,
    a: Point3Mm,
    b: Point3Mm
): { pointMm: Point3Mm; t: number } {
    const ab = sub3(b, a);
    const len2 = dot3(ab, ab);
    if (len2 < 1e-12) return { pointMm: a, t: 0 };
    const t = Math.max(0, Math.min(1, dot3(sub3(p, a), ab) / len2));
    return { pointMm: add3(a, scale3(ab, t)), t };
}

/** Returns a zero vector unchanged rather than dividing by zero — callers must check. */
export function normalize3(a: Point3Mm): Dir3 {
    const len = length3(a);
    if (len < 1e-9) return { x: 0, y: 0, z: 0 };
    return { x: a.x / len, y: a.y / len, z: a.z / len };
}

/** Drops Z. Every roof test in `calc/` works in plan, so this is used constantly. */
export function toPlan(p: Point3Mm): Vec2Mm {
    return { x: p.x, y: p.y };
}

/** A plane as `normal . p = d`, with `normal` a unit vector. */
export interface Plane3 {
    normal: Dir3;
    d: number;
}

/**
 * Twice the area-weighted normal of a polygon, by **Newell's method**.
 *
 * The shared computation behind `planeOfPolygon` (normalize it) and `polygonArea3` (take half
 * its length) — the exact 3D generalisation of the 2D shoelace sum, and for the same reason:
 * summing over every edge rather than just the first three vertices is what stays well-behaved
 * when a drawn polygon has a collinear or near-collinear corner.
 */
function newellVector(ring: readonly Point3Mm[]): Point3Mm {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j]!;
        const b = ring[i]!;
        nx += (a.y - b.y) * (a.z + b.z);
        ny += (a.z - b.z) * (a.x + b.x);
        nz += (a.x - b.x) * (a.y + b.y);
    }
    return { x: nx, y: ny, z: nz };
}

/**
 * Plane of a polygon by **Newell's method**, oriented so `normal.z >= 0`.
 *
 * Newell rather than the cross product of the first three vertices: three consecutive vertices
 * can be collinear (giving a zero normal) or merely near-collinear (giving a normal dominated
 * by float noise), and a drawn polygon regularly has both. Newell sums over every edge, so it
 * is the area-weighted best fit and degrades gracefully on a slightly non-planar ring — which
 * is exactly what a user-drawn roof is.
 *
 * Returns null for a degenerate ring (fewer than 3 points, or zero area).
 */
export function planeOfPolygon(ring: readonly Point3Mm[]): Plane3 | null {
    if (ring.length < 3) return null;
    const raw = newellVector(ring);
    if (length3(raw) < 1e-6) return null;
    let normal = normalize3(raw);
    // Orient upward. Every roof/floor test below assumes it, and a user's winding direction is
    // not something to depend on.
    if (normal.z < 0) normal = scale3(normal, -1);
    return { normal, d: dot3(normal, ring[0]!) };
}

/**
 * True area of a planar polygon in 3D, mm².
 *
 * Not the shoelace formula on `(x, y)` — that measures the polygon's *plan-projected shadow*,
 * which is a different question and, for a vertical or steeply-pitched surface, a wildly wrong
 * answer to it: a wall or a steep roof plane can have a shadow near zero while its own area is
 * enormous. This sums the same Newell terms `planeOfPolygon` does and takes half the length of
 * the result instead of normalizing it away, which is exactly the 3D generalisation of the 2D
 * shoelace sum and needs no plane to be found first.
 */
export function polygonArea3(ring: readonly Point3Mm[]): number {
    if (ring.length < 3) return 0;
    return length3(newellVector(ring)) / 2;
}

/** Signed distance from `p` to the plane, in mm. Positive is on the normal's side. */
export function distanceToPlane(p: Point3Mm, plane: Plane3): number {
    return dot3(plane.normal, p) - plane.d;
}

/** Largest absolute deviation of any ring vertex from the plane, in mm. */
export function planarityErrorMm(ring: readonly Point3Mm[], plane: Plane3): number {
    let worst = 0;
    for (const p of ring) worst = Math.max(worst, Math.abs(distanceToPlane(p, plane)));
    return worst;
}

/**
 * Where a ray hits a plane. Returns the parameter `t` such that `origin + dir * t` is the hit,
 * or null when the ray is parallel to the plane.
 *
 * `t` rather than the point: the roof grid needs to compare hits by distance and pick the
 * lowest, and doing that on `t` avoids recomputing a length per candidate.
 */
export function rayPlaneT(origin: Point3Mm, dir: Dir3, plane: Plane3): number | null {
    const denom = dot3(plane.normal, dir);
    if (Math.abs(denom) < 1e-9) return null;
    return (plane.d - dot3(plane.normal, origin)) / denom;
}

/**
 * Height of a non-vertical plane above a plan position.
 *
 * Valid precisely because `|normal.z|` is non-zero, which makes the plane a graph `z = f(x,y)`
 * over the XY plane — the same condition that lets the roof recipe cast straight-up rays and
 * treat every hit as unique per plane. Returns null for a vertical plane (a wall drawn as a
 * roof), rather than dividing by a near-zero.
 */
export function planeHeightAt(plane: Plane3, x: number, y: number): number | null {
    if (Math.abs(plane.normal.z) < 1e-6) return null;
    return (plane.d - plane.normal.x * x - plane.normal.y * y) / plane.normal.z;
}

/**
 * Pitch of a plane above horizontal, degrees — 0 is level, 90 is vertical.
 *
 * Reads off the normal rather than off any pair of points on the plane, so it is independent
 * of which way a rafter happens to run across it. `Math.abs(normal.z)` because a plane has two
 * sides and a roof drawn with either winding has the same pitch; `planeOfPolygon` already
 * orients upward, but nothing here needs to depend on that.
 */
export function pitchDegOf(plane: Plane3): number {
    const horizontal = Math.hypot(plane.normal.x, plane.normal.y);
    return (Math.atan2(horizontal, Math.abs(plane.normal.z)) * 180) / Math.PI;
}

/**
 * An orthonormal 2D frame embedded in 3D: `uDir` and `vDir` are unit and perpendicular, and
 * `normal = uDir x vDir`.
 *
 * The one shape shared by a surface's own frame (`model/surface-frame.ts`, where a hole's
 * `uMm`/`vMm` are measured) and the drawing working plane (`interaction/working-plane.ts`),
 * which is what lets a working plane *be* a surface's frame with nothing lost in between:
 * draw a rectangle on a wall and its corners come back in exactly the coordinates a hole is
 * stored in.
 */
export interface Frame3 {
    originMm: Point3Mm;
    uDir: Dir3;
    vDir: Dir3;
    normal: Dir3;
}

/** Model point -> the frame's own 2D coordinates. Points off the plane are projected onto it. */
export function toFrameUv(frame: Frame3, pMm: Point3Mm): Vec2Mm {
    const rel = sub3(pMm, frame.originMm);
    return { x: dot3(rel, frame.uDir), y: dot3(rel, frame.vDir) };
}

/** The frame's own 2D coordinates -> model point. */
export function fromFrameUv(frame: Frame3, uv: Vec2Mm): Point3Mm {
    return add3(frame.originMm, add3(scale3(frame.uDir, uv.x), scale3(frame.vDir, uv.y)));
}

/** Perpendicular distance from a model point to the frame's plane, mm. Signed along the normal. */
export function signedDistanceToFrame(frame: Frame3, pMm: Point3Mm): number {
    return dot3(sub3(pMm, frame.originMm), frame.normal);
}

/** Is a plan point inside a 3D polygon's projection onto the XY plane? */
export function pointInPolygonPlan(p: Vec2Mm, ring: readonly Point3Mm[]): boolean {
    return pointInPolygon2(
        p,
        ring.map((q) => ({ x: q.x, y: q.y }))
    );
}

/**
 * Is a plan point inside — or on the edge of, to `toleranceMm` — a 3D polygon's projection onto
 * the XY plane?
 *
 * The boundary-tolerant test to use wherever the point being asked about is expected to sit
 * exactly on the ring, not safely inside it: an interior wall's ends, for instance, land right on
 * the eave where it meets an exterior wall, which is exactly a roof polygon's own edge in plan.
 * The strict `pointInPolygonPlan` resolves that case by the ray-casting algorithm's arbitrary
 * top/bottom-edge convention, so it counts one eave and misses the other — a real point on a real
 * roof reads as off it.
 */
export function pointInOrOnPolygonPlan(
    p: Vec2Mm,
    ring: readonly Point3Mm[],
    toleranceMm = 1
): boolean {
    return pointInOrOnPolygon2(
        p,
        ring.map((q) => ({ x: q.x, y: q.y })),
        toleranceMm
    );
}

/**
 * A unit vector perpendicular to `axis`, for seeding a local frame when the caller has no
 * meaningful preference.
 *
 * Picks the world axis *least* aligned with `axis` before crossing, because crossing with a
 * nearly-parallel vector gives a short, noise-dominated result. Used as the guard in
 * `ifc/member-placement.ts` when a member's `sectionXDir` is degenerate.
 */
export function anyPerpendicular(axis: Dir3): Dir3 {
    const seed: Dir3 = Math.abs(axis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    return normalize3(cross3(axis, seed));
}
