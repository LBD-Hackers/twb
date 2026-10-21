/**
 * A zone's **net** floor area and **net** volume, derived from the surfaces around and above it.
 *
 * A zone's room is found on the wall centrelines (`zone-rooms.ts`), and so is every surface — a face is the
 * centreline of its own framing (`surface.ts`). Net means measured to the construction's own
 * faces instead:
 *
 * - **In plan**, every edge of the outline that runs along a wall is pulled into the room by
 *   half that wall's depth, so the area is the floor between the studs' inner faces — or, where
 *   the caller knows how a wall's construction lies about its face (`SurfaceSideDepthMm`: a
 *   masonry wall on one of its leaves, the rest on its back), by the depth on the room's side. An edge
 *   that runs along no wall — the open side between a kitchen and the living room it opens onto
 *   — stays where it was drawn, since there is nothing there to take off.
 * - **Vertically**, the room starts on top of its own floor's structure and stops at the
 *   underside of whatever is over it: the next floor's joists, a ceiling tie, or the roof —
 *   followed plane by plane under a pitched roof, so a room in the eaves has the volume it
 *   actually has, not a box's. A room with a ceiling of its own (`Zone.ceilingMm`) stops flat
 *   under it wherever the roof or the floor above would have taken it higher, so it no longer
 *   rises into the ridge; where the roof comes down below the ceiling, under the eaves, it still
 *   follows the roof.
 *
 * How deep each surface's construction is lives with the profile (a frame builder reads it off
 * the timber it derived; something else might read it off a wall type), so it comes in as a
 * function rather than being guessed here.
 *
 * Pure: no signals, no DOM, like the rest of this package's geometry.
 */

import {
    boundsOfRing2,
    planeOfPolygon,
    pointInOrOnPolygon2,
    pointInPolygon2,
    polygonArea2,
    polygonCentroid2,
    signedArea2,
    triangulatePolygon2,
    type Point3Mm,
    type Vec2Mm,
} from '../core';
import { classifyAll } from './classify';
import { floorFootprintsInStorey, wallFootprintsInStorey } from './plan-geometry';
import type { Storey } from './storey';
import type { Surface, SurfaceId } from './surface';

/**
 * How far a wall's construction stands off its face on one side, mm: `side` 1 for its positive
 * side (the way its normal points, to the right looking along it towards +X, or +Y for a wall
 * along Y — `surfaceFrame`), -1 for its negative side, its back.
 */
export type SurfaceSideDepthMm = (surfaceId: SurfaceId, side: 1 | -1) => number;

/** Total construction depth of a surface, centred on its face, mm. */
export type SurfaceDepthMm = (surfaceId: SurfaceId) => number;

/** What bounds a zone from above, for the read-out. */
export type ZoneCeiling = 'slab' | 'roof' | 'slab+roof' | 'ceiling' | 'nominal';

export interface ZoneVolume {
    /** The outline pulled in to the walls' inner faces, counter-clockwise. Empty if nothing is left. */
    netOutlineMm: Vec2Mm[];
    grossAreaM2: number;
    netAreaM2: number;
    /** Top of the zone's own floor structure, mm. */
    floorTopMm: number;
    /** Lowest, highest and area-weighted mean clear height over the net area, mm. */
    minHeightMm: number;
    maxHeightMm: number;
    meanHeightMm: number;
    volumeM3: number;
    ceiling: ZoneCeiling;
    /**
     * The net volume as a solid, for drawing it: the floor, the ceiling as one face per plane it
     * sits under, and a vertical side along each stretch of the net outline. Model frame, mm.
     */
    floorFacesMm: Point3Mm[][];
    topFacesMm: Point3Mm[][];
    sideFacesMm: Point3Mm[][];
}

/**
 * How far above the floor something must be to count as the ceiling, mm.
 *
 * Without it the storey's own floor — or a floor on the same storey a step up — would be read as
 * the thing overhead and collapse the room to nothing. Half a metre is lower than any real
 * ceiling and higher than any real step.
 */
export const MIN_CLEAR_HEIGHT_MM = 500;

/** How near an outline edge must lie to a wall's line to be read as running along it, mm. */
const ON_WALL_TOLERANCE_MM = 5;

/**
 * `ceilingMm` is the room's own ceiling, mm above its storey's floor (`Zone.ceilingMm`) — the
 * underside the room stops at, held to the lowest wall top around the room. Absent, the room runs
 * up to whatever is overhead.
 *
 * `minClearMm` is how far over the floor something must be to be what is overhead
 * (`MIN_CLEAR_HEIGHT_MM`). A space whose roof comes right down to its floor — an attic over a
 * ceiling, the roof meeting it at the eaves — takes 0, so it closes there instead of opening up.
 *
 * `sideDepthMm`, where given, is how far each wall stands off its face on the room's side; absent,
 * half its `depthMm` on either side.
 */
export function zoneVolume(
    surfaces: readonly Surface[],
    storey: Storey,
    outlineMm: readonly Vec2Mm[],
    depthMm: SurfaceDepthMm,
    ceilingMm?: number,
    minClearMm: number = MIN_CLEAR_HEIGHT_MM,
    sideDepthMm?: SurfaceSideDepthMm
): ZoneVolume {
    const outline = counterClockwise(outlineMm);
    const grossAreaM2 = polygonArea2(outline) / 1e6;

    const walls = wallFootprintsInStorey(surfaces, storey);
    // The lowest top any wall around the room has: a ceiling never goes above it.
    const lowestWallTopMm = lowestWallTopAround(surfaces, storey, outline);
    const offsets = outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length]!;
        let half = 0;
        for (const w of walls) {
            if (!runsAlong(a, b, w.aMm, w.bMm)) continue;
            half = Math.max(
                half,
                sideDepthMm
                    ? sideDepthMm(w.surfaceId, roomSide(a, b, w.aMm, w.bMm))
                    : depthMm(w.surfaceId) / 2
            );
        }
        return half;
    });
    const netOutlineMm = insetPolygon(outline, offsets);
    const netArea = signedArea2(netOutlineMm);
    const net = netArea > 0 ? netOutlineMm : [];
    const netAreaM2 = Math.max(netArea, 0) / 1e6;

    const probe = net.length > 0 ? interiorProbe(net) : interiorProbe(outline);
    const floorTopMm = floorTopAt(surfaces, storey, probe, depthMm);
    const clearMm = floorTopMm + minClearMm;
    const overhead = overheadPlanes(surfaces, clearMm, depthMm);
    const nominal: Ceiling = {
        kind: 'nominal',
        a: 0,
        b: 0,
        c: storey.elevationMm + storey.heightMm,
    };
    const own: Ceiling | null =
        ceilingMm !== undefined
            ? {
                  kind: 'ceiling',
                  a: 0,
                  b: 0,
                  c: Math.min(storey.elevationMm + ceilingMm, lowestWallTopMm),
              }
            : null;
    const ceilingAt = (p: Vec2Mm): Ceiling => {
        let best: Ceiling | null = null;
        let bestZ = Infinity;
        for (const o of overhead) {
            if (!pointInOrOnPolygon2(p, o.ringMm)) continue;
            const z = heightOf(o, p);
            if (z <= clearMm || z >= bestZ) continue;
            best = o;
            bestZ = z;
        }
        // The room's own ceiling holds it down; with nothing else overhead, it is the top.
        if (own && (!best || heightOf(own, p) < bestZ)) return own;
        return best ?? nominal;
    };

    // Cut the room along every line where what is overhead can change — an overhead face's own
    // edges, and where two overhead faces pass through each other — so that each piece is under
    // exactly one plane. Then everything is exact: a piece's top is that plane, and its volume is
    // its area times the height at its centroid, since the height is linear across it.
    const lines = net.length > 0 ? cutLines(net, overhead, own) : [];
    let pieces: Vec2Mm[][] = triangulatePolygon2(net);
    for (const line of lines) pieces = pieces.flatMap((piece) => splitConvex(piece, line));

    const hit = new Set<Ceiling['kind']>();
    const topFacesMm: Point3Mm[][] = [];
    const floorFacesMm: Point3Mm[][] = [];
    let volumeMm3 = 0;
    let minHeightMm = Infinity;
    let maxHeightMm = -Infinity;
    for (const piece of pieces) {
        const centroid = polygonCentroid2(piece);
        const ceiling = ceilingAt(centroid);
        hit.add(ceiling.kind);
        volumeMm3 += polygonArea2(piece) * (heightOf(ceiling, centroid) - floorTopMm);
        const top = piece.map((p) => ({ x: p.x, y: p.y, z: heightOf(ceiling, p) }));
        for (const t of top) {
            minHeightMm = Math.min(minHeightMm, t.z - floorTopMm);
            maxHeightMm = Math.max(maxHeightMm, t.z - floorTopMm);
        }
        topFacesMm.push(top);
        floorFacesMm.push(piece.map((p) => ({ x: p.x, y: p.y, z: floorTopMm })).reverse());
    }

    // The sides: one vertical face per stretch of outline under one plane, its top following
    // that plane — so a side under a ridge rises to it and falls again.
    const sideFacesMm: Point3Mm[][] = [];
    for (let i = 0; i < net.length; i++) {
        const a = net[i]!;
        const b = net[(i + 1) % net.length]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1) continue;
        const inward = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
        const ts = [0, 1, ...lines.map((l) => crossingT(a, b, l)).filter((t) => t > 0 && t < 1)];
        ts.sort((u, v) => u - v);
        for (let k = 0; k + 1 < ts.length; k++) {
            const t0 = ts[k]!;
            const t1 = ts[k + 1]!;
            if ((t1 - t0) * len < 1) continue;
            const p0 = lerp(a, b, t0);
            const p1 = lerp(a, b, t1);
            const m = lerp(a, b, (t0 + t1) / 2);
            const ceiling = ceilingAt({ x: m.x + inward.x, y: m.y + inward.y });
            sideFacesMm.push([
                { ...p0, z: floorTopMm },
                { ...p1, z: floorTopMm },
                { ...p1, z: heightOf(ceiling, p1) },
                { ...p0, z: heightOf(ceiling, p0) },
            ]);
        }
    }

    return {
        netOutlineMm: net,
        grossAreaM2,
        netAreaM2,
        floorTopMm,
        minHeightMm: pieces.length > 0 ? minHeightMm : 0,
        maxHeightMm: pieces.length > 0 ? maxHeightMm : 0,
        meanHeightMm: netArea > 0 ? volumeMm3 / netArea : 0,
        volumeM3: volumeMm3 / 1e9,
        ceiling: ceilingOf(hit),
        floorFacesMm,
        topFacesMm,
        sideFacesMm,
    };
}

function ceilingOf(hit: ReadonlySet<Ceiling['kind']>): ZoneCeiling {
    if (hit.has('ceiling')) return 'ceiling';
    if (hit.has('slab') && hit.has('roof')) return 'slab+roof';
    if (hit.has('roof')) return 'roof';
    if (hit.has('slab')) return 'slab';
    return 'nominal';
}

/**
 * The lowest top of any wall that runs along the room's outline, mm in the model frame; infinite
 * with no wall. A ceiling is never higher than this.
 */
export function lowestWallTopAround(
    surfaces: readonly Surface[],
    storey: Storey,
    outlineMm: readonly Vec2Mm[]
): number {
    const byId = new Map(surfaces.map((s) => [s.id, s]));
    const outline = counterClockwise(outlineMm);
    let lowest = Infinity;
    for (const w of wallFootprintsInStorey(surfaces, storey)) {
        const along = outline.some((a, i) =>
            runsAlong(a, outline[(i + 1) % outline.length]!, w.aMm, w.bMm)
        );
        const wall = byId.get(w.surfaceId);
        if (along && wall) lowest = Math.min(lowest, lowestTopOf(wall));
    }
    return lowest;
}

/** The lowest top any wall on the storey has, mm — its plate, where the walls are all one height. */
export function lowestWallTopInStorey(surfaces: readonly Surface[], storey: Storey): number {
    const byId = new Map(surfaces.map((s) => [s.id, s]));
    let lowest = Infinity;
    for (const w of wallFootprintsInStorey(surfaces, storey)) {
        const wall = byId.get(w.surfaceId);
        if (wall) lowest = Math.min(lowest, lowestTopOf(wall));
    }
    return lowest;
}

/** The lowest point of a wall's top edge, mm: its vertices above the lowest one it has. */
function lowestTopOf(wall: Surface): number {
    const zs = wall.boundaryMm.map((p) => p.z);
    const base = Math.min(...zs);
    const tops = zs.filter((z) => z > base + 1);
    return tops.length > 0 ? Math.min(...tops) : Infinity;
}

/**
 * Whether the edge a–b lies along the wall footprint w1–w2: both its ends on the wall's line, and
 * the two overlapping by more than a tolerance (so a wall merely meeting the edge's end at a
 * corner does not count).
 */
/**
 * Which side of the wall `w1`–`w2` the room is on whose counter-clockwise outline has the edge
 * `a`–`b`: the room lies to the edge's left, and the wall's positive side to its right looking
 * along it towards +X, or +Y for a wall along Y (`surfaceFrame`).
 */
function roomSide(a: Vec2Mm, b: Vec2Mm, w1: Vec2Mm, w2: Vec2Mm): 1 | -1 {
    let u = { x: w2.x - w1.x, y: w2.y - w1.y };
    if (u.x < 0 || (u.x === 0 && u.y < 0)) u = { x: -u.x, y: -u.y };
    const positive = { x: u.y, y: -u.x };
    const inward = { x: -(b.y - a.y), y: b.x - a.x };
    return inward.x * positive.x + inward.y * positive.y > 0 ? 1 : -1;
}

function runsAlong(a: Vec2Mm, b: Vec2Mm, w1: Vec2Mm, w2: Vec2Mm): boolean {
    const dx = w2.x - w1.x;
    const dy = w2.y - w1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return false;
    const off = (p: Vec2Mm): number => Math.abs((p.x - w1.x) * dy - (p.y - w1.y) * dx) / len;
    if (off(a) > ON_WALL_TOLERANCE_MM || off(b) > ON_WALL_TOLERANCE_MM) return false;
    const t = (p: Vec2Mm): number => ((p.x - w1.x) * dx + (p.y - w1.y) * dy) / len;
    const lo = Math.max(Math.min(t(a), t(b)), 0);
    const hi = Math.min(Math.max(t(a), t(b)), len);
    return hi - lo > ON_WALL_TOLERANCE_MM;
}

/**
 * A counter-clockwise ring with each edge moved inward (to its left) by its own distance.
 *
 * Each new corner is where the two moved edges either side of it meet. Where two consecutive
 * edges are parallel — a straight wall with a vertex along it — there is no meeting point, so
 * the corner is moved straight in, and where the two were moved by different amounts (a straight
 * run that is part wall, part open) it becomes a step of two corners.
 */
export function insetPolygon(ring: readonly Vec2Mm[], offsetsMm: readonly number[]): Vec2Mm[] {
    const n = ring.length;
    const lines = ring.map((a, i) => {
        const b = ring[(i + 1) % n]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        const inward = { x: -dir.y, y: dir.x };
        const d = offsetsMm[i] ?? 0;
        return { p: { x: a.x + inward.x * d, y: a.y + inward.y * d }, dir, inward, d };
    });
    const out: Vec2Mm[] = [];
    for (let i = 0; i < n; i++) {
        const prev = lines[(i - 1 + n) % n]!;
        const cur = lines[i]!;
        const denom = prev.dir.x * cur.dir.y - prev.dir.y * cur.dir.x;
        if (Math.abs(denom) < 1e-9) {
            const v = ring[i]!;
            out.push({ x: v.x + prev.inward.x * prev.d, y: v.y + prev.inward.y * prev.d });
            if (Math.abs(prev.d - cur.d) > 1e-6) {
                out.push({ x: v.x + cur.inward.x * cur.d, y: v.y + cur.inward.y * cur.d });
            }
            continue;
        }
        const t = ((cur.p.x - prev.p.x) * cur.dir.y - (cur.p.y - prev.p.y) * cur.dir.x) / denom;
        out.push({ x: prev.p.x + prev.dir.x * t, y: prev.p.y + prev.dir.y * t });
    }
    return out;
}

/** Top of the storey's floor structure under `p`, or the bare storey level where there is none. */
function floorTopAt(
    surfaces: readonly Surface[],
    storey: Storey,
    p: Vec2Mm,
    depthMm: SurfaceDepthMm
): number {
    let top: number | null = null;
    for (const f of floorFootprintsInStorey(surfaces, storey)) {
        if (!pointInOrOnPolygon2(p, f.ringMm)) continue;
        const z = storey.elevationMm + depthMm(f.surfaceId) / 2;
        if (top === null || z > top) top = z;
    }
    return top ?? storey.elevationMm;
}

/** A ceiling plane in plan: its height is `a·x + b·y + c`. */
interface Ceiling {
    kind: 'slab' | 'roof' | 'ceiling' | 'nominal';
    a: number;
    b: number;
    c: number;
}

interface Overhead extends Ceiling {
    kind: 'slab' | 'roof';
    ringMm: Vec2Mm[];
}

const heightOf = (plane: Ceiling, p: Vec2Mm): number => plane.a * p.x + plane.b * p.y + plane.c;

/**
 * Every floor and roof that could be over the room, as its underside's plane. A roof's
 * underside is half its depth below the face measured square to the slope, which is further
 * than that measured plumb — by 1 / cos(pitch).
 */
function overheadPlanes(
    surfaces: readonly Surface[],
    aboveMm: number,
    depthMm: SurfaceDepthMm
): Overhead[] {
    const kinds = classifyAll(surfaces);
    const out: Overhead[] = [];
    for (const s of surfaces) {
        const kind = kinds.get(s.id);
        if (kind !== 'floor' && kind !== 'roof') continue;
        const plane = planeOfPolygon(s.boundaryMm);
        if (!plane || Math.abs(plane.normal.z) < 1e-6) continue;
        if (Math.max(...s.boundaryMm.map((p) => p.z)) <= aboveMm) continue;
        const nz = plane.normal.z;
        const plumbHalf = depthMm(s.id) / 2 / Math.abs(nz);
        out.push({
            kind: kind === 'floor' ? 'slab' : 'roof',
            ringMm: s.boundaryMm.map((p) => ({ x: p.x, y: p.y })),
            a: -plane.normal.x / nz,
            b: -plane.normal.y / nz,
            c: plane.d / nz - plumbHalf,
        });
    }
    return out;
}

/** A line in plan: through `p`, along the unit `d`. */
interface Line2 {
    p: Vec2Mm;
    d: Vec2Mm;
}

/**
 * The lines the room must be cut along for every piece to sit under one plane: the edges of
 * each overhead face near the room, and the line where each pair of them are at the same height
 * (a slab and the roof crossing it, say), and where each of them passes through the room's own
 * flat ceiling, when it has one. Infinite lines rather than segments — a line cuts pieces that
 * did not need it only into smaller pieces under the same plane, which is harmless.
 */
function cutLines(
    ring: readonly Vec2Mm[],
    overhead: readonly Overhead[],
    own: Ceiling | null
): Line2[] {
    const box = boundsOfRing2(ring);
    const near = (pts: readonly Vec2Mm[]): boolean => {
        const b = boundsOfRing2(pts);
        return b.maxX >= box.minX && b.minX <= box.maxX && b.maxY >= box.minY && b.minY <= box.maxY;
    };
    const relevant = overhead.filter((o) => near(o.ringMm));
    const lines: Line2[] = [];
    const seen = new Set<string>();
    const add = (p: Vec2Mm, dx: number, dy: number): void => {
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) return;
        let d = { x: dx / len, y: dy / len };
        if (d.x < -1e-9 || (Math.abs(d.x) <= 1e-9 && d.y < 0)) d = { x: -d.x, y: -d.y };
        // Same line, same key: its direction, and its distance from the origin.
        const offset = p.x * -d.y + p.y * d.x;
        const key = `${d.x.toFixed(6)},${d.y.toFixed(6)},${offset.toFixed(1)}`;
        if (seen.has(key)) return;
        seen.add(key);
        lines.push({ p, d });
    };
    for (const o of relevant) {
        o.ringMm.forEach((c, i) => {
            const e = o.ringMm[(i + 1) % o.ringMm.length]!;
            if (near([c, e])) add(c, e.x - c.x, e.y - c.y);
        });
    }
    const planes: Ceiling[] = own ? [...relevant, own] : relevant;
    for (let i = 0; i < planes.length; i++) {
        for (let j = i + 1; j < planes.length; j++) {
            const u = planes[i]!;
            const v = planes[j]!;
            // (Δa)x + (Δb)y + Δc = 0: a line with normal (Δa, Δb).
            const da = u.a - v.a;
            const db = u.b - v.b;
            const dc = u.c - v.c;
            const n2 = da * da + db * db;
            if (n2 < 1e-12) continue;
            add({ x: (-da * dc) / n2, y: (-db * dc) / n2 }, -db, da);
        }
    }
    return lines;
}

/** Signed side of `p` against a line: positive on its left. */
const side = (l: Line2, p: Vec2Mm): number => l.d.x * (p.y - l.p.y) - l.d.y * (p.x - l.p.x);

/** A convex polygon cut in two by a line, each half kept only if it has any area. */
function splitConvex(poly: readonly Vec2Mm[], line: Line2): Vec2Mm[][] {
    const left: Vec2Mm[] = [];
    const right: Vec2Mm[] = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const sa = side(line, a);
        const sb = side(line, b);
        if (sa >= -1e-9) left.push(a);
        if (sa <= 1e-9) right.push(a);
        if ((sa > 1e-9 && sb < -1e-9) || (sa < -1e-9 && sb > 1e-9)) {
            const x = lerp(a, b, sa / (sa - sb));
            left.push(x);
            right.push(x);
        }
    }
    return [left, right].filter((p) => p.length >= 3 && polygonArea2(p) > 1);
}

/** Where the segment a–b crosses a line, as a fraction along it; NaN when parallel. */
function crossingT(a: Vec2Mm, b: Vec2Mm, line: Line2): number {
    const sa = side(line, a);
    const sb = side(line, b);
    return Math.abs(sa - sb) < 1e-9 ? NaN : sa / (sa - sb);
}

const lerp = (a: Vec2Mm, b: Vec2Mm, t: number): Vec2Mm => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
});

/** A point inside the ring — its centroid when that is inside, else a nudge in from a corner. */
function interiorProbe(ring: readonly Vec2Mm[]): Vec2Mm {
    const c = {
        x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
        y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
    };
    if (pointInPolygon2(c, ring)) return c;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const p = { x: m.x - ((b.y - a.y) / len) * 10, y: m.y + ((b.x - a.x) / len) * 10 };
        if (pointInPolygon2(p, ring)) return p;
    }
    return c;
}

function counterClockwise(ring: readonly Vec2Mm[]): Vec2Mm[] {
    return signedArea2(ring) < 0 ? [...ring].reverse() : [...ring];
}
