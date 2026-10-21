/**
 * Roof mode's other half: the walls that meet a roof drawn over them.
 *
 * Roof mode draws a roof with the ordinary tools while the house under it is locked
 * (`SurfaceStore.locked`), because topology here is by coincidence: without the lock, a ridge
 * drawn across the tops of the interior walls welds into them and lifting it drags them up. The
 * price is that nothing the roof does reaches the walls either — lift a ridge over a box and the
 * gables no longer turn into pentagons by themselves. That is put back here, once, on Save.
 *
 * A wall is fitted by replacing its top with the roof's height along it, exactly: the break
 * points are where the wall crosses an edge of a roof face in plan (a ridge, a hip, the roof's
 * own outline), so a gable's apex lands on the ridge itself rather than near it. Which walls:
 *
 * - **Gables**: a wall standing along the roof's outer edge, with the roof above its top. This is
 *   what drawing a roof over a house means, so it always happens.
 * - **Outside walls under the roof**, off its edge: the back and sides of a recessed entrance the
 *   roof runs on over, the house's end wall under a carport roof. They are the building's own
 *   envelope, so they close the space under the roof like a gable does — when the caller says
 *   which walls are the outside ones (`exterior`).
 * - **Interior walls**: a wall wholly under the roof, off its edge — only when asked, since
 *   whether a partition runs up to the rafters or stops at a ceiling is a design decision.
 * - **Walls that followed the old roof**, when an existing roof was edited: every corner of their
 *   top was on it, so they follow the new one, down as well as up.
 *
 * A wall is only ever grown — never cut down — unless it was following the old roof, and never
 * through a floor: a wall on a lower storey, under the floor of the one above, stays put.
 */

import {
    planeHeightAt,
    planeOfPolygon,
    pointInOrOnPolygonPlan,
    type Plane3,
    type Point3Mm,
} from '../core';
import { classifyAll } from './classify';
import type { PartitionKind, Surface, SurfaceId, SurfaceKind } from './surface';
import { samePoint } from './surface-ops';
import { surfaceFrame } from './surface-frame';

/** One face a change adds: its outline, the roof it belongs to, and its pinned kind. */
export interface AddedFace {
    boundaryMm: readonly Point3Mm[];
    roofGroupId: string | null;
    kindOverride: SurfaceKind | null;
    /** The kind of wall it is pinned to be — a stretch of a partition is its partition's. */
    partitionKind?: PartitionKind | null;
    /** The build-up type it is pinned to — a stretch of a wall is its wall's. */
    buildUpType?: string | null;
}

/** A face a change keeps but alters: a new outline, a new roof group, or both. */
export interface ReshapedFace {
    id: SurfaceId;
    boundaryMm?: readonly Point3Mm[];
    roofGroupId?: string | null;
}

/** An edit to several faces at once, applied by `SurfaceStore.applyFaceChanges`. */
export interface FaceChanges {
    removeIds: readonly SurfaceId[];
    reshape: readonly ReshapedFace[];
    add: readonly AddedFace[];
}

/** How far a corner may be off a plane, or a line, and still be on it, mm. */
const ON_MM = 2;

/** Whether a face stands upright — a wall, whatever else it is. */
function isUpright(ring: readonly Point3Mm[]): boolean {
    const frame = surfaceFrame(ring);
    return frame !== null && Math.abs(frame.normal.z) < 0.0175;
}

/** Whether a face lies level — a floor, a ceiling or a flat roof. */
function isLevel(ring: readonly Point3Mm[]): boolean {
    const frame = surfaceFrame(ring);
    return frame !== null && Math.abs(frame.normal.z) > 0.9998;
}

/** Whether two faces share an edge: two consecutive corners of one are consecutive in the other. */
function shareEdge(a: readonly Point3Mm[], b: readonly Point3Mm[]): boolean {
    for (let i = 0; i < a.length; i++) {
        const p = a[i]!;
        const q = a[(i + 1) % a.length]!;
        for (let j = 0; j < b.length; j++) {
            const r = b[j]!;
            const s = b[(j + 1) % b.length]!;
            if ((samePoint(p, r) && samePoint(q, s)) || (samePoint(p, s) && samePoint(q, r))) {
                return true;
            }
        }
    }
    return false;
}

/**
 * The faces of the roof `id` is part of: its roof group when it has one, otherwise every roof
 * face without a group reachable from it across shared edges — a roof drawn the ordinary way.
 * Empty when `id` is not a roof.
 */
export function roofGroupOf(
    surfaces: readonly Surface[],
    kinds: ReadonlyMap<SurfaceId, SurfaceKind>,
    id: SurfaceId
): SurfaceId[] {
    const start = surfaces.find((s) => s.id === id);
    if (!start || kinds.get(id) !== 'roof') return [];
    if (start.roofGroupId) {
        return surfaces
            .filter((s) => s.roofGroupId === start.roofGroupId && kinds.get(s.id) === 'roof')
            .map((s) => s.id);
    }
    const roofs = surfaces.filter((s) => kinds.get(s.id) === 'roof' && !s.roofGroupId);
    const group = [start];
    for (let grew = true; grew;) {
        grew = false;
        for (const s of roofs) {
            if (group.includes(s)) continue;
            if (group.some((g) => shareEdge(g.boundaryMm, s.boundaryMm))) {
                group.push(s);
                grew = true;
            }
        }
    }
    return group.map((s) => s.id);
}

/** A roof group id no face in `surfaces` has yet. */
export function nextRoofGroupId(surfaces: readonly Surface[]): string {
    let n = 1;
    const taken = new Set(surfaces.map((s) => s.roofGroupId));
    while (taken.has(`roof-${n}`)) n++;
    return `roof-${n}`;
}

interface RoofPlane {
    ring: readonly Point3Mm[];
    plane: Plane3;
}

function roofPlanes(faces: readonly Surface[]): RoofPlane[] {
    return faces.flatMap((s) => {
        const plane = planeOfPolygon(s.boundaryMm);
        return plane ? [{ ring: s.boundaryMm, plane }] : [];
    });
}

/** The lowest roof over a plan point that is above `aboveZ`, or null where there is none. */
function roofZ(planes: readonly RoofPlane[], x: number, y: number, aboveZ: number): number | null {
    let lowest: number | null = null;
    for (const { ring, plane } of planes) {
        if (!pointInOrOnPolygonPlan({ x, y }, ring)) continue;
        const z = planeHeightAt(plane, x, y);
        if (z === null || z <= aboveZ) continue;
        if (lowest === null || z < lowest) lowest = z;
    }
    return lowest;
}

/** Where plan segment p→q crosses plan segment a→b, as a parameter along p→q, or null. */
function crossingT(
    p: { x: number; y: number },
    q: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
): number | null {
    const rx = q.x - p.x;
    const ry = q.y - p.y;
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom;
    const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / denom;
    return t > 1e-6 && t < 1 - 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? t : null;
}

/**
 * The roof's height along plan segment p→q, as the corners of a polyline: the ends and every
 * point where the segment crosses a roof edge in plan, with the ones on a straight run dropped.
 * Null when the roof does not cover the whole segment.
 */
export function roofProfile(
    roof: readonly Surface[],
    p: { x: number; y: number },
    q: { x: number; y: number },
    aboveZ: number
): Point3Mm[] | null {
    const planes = roofPlanes(roof);
    const ts = new Set<number>([0, 1]);
    for (const { ring } of planes) {
        for (let i = 0; i < ring.length; i++) {
            const t = crossingT(p, q, ring[i]!, ring[(i + 1) % ring.length]!);
            if (t !== null) ts.add(t);
        }
    }
    const sorted = [...ts].sort((a, b) => a - b);
    const at = (t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    // Every stretch between two break points has to be under the roof, not only its ends.
    for (let i = 0; i + 1 < sorted.length; i++) {
        const mid = at((sorted[i]! + sorted[i + 1]!) / 2);
        if (roofZ(planes, mid.x, mid.y, aboveZ) === null) return null;
    }
    const points: Point3Mm[] = [];
    for (const t of sorted) {
        const xy = at(t);
        const z = roofZ(planes, xy.x, xy.y, aboveZ);
        if (z === null) return null;
        points.push({ x: Math.round(xy.x), y: Math.round(xy.y), z: Math.round(z) });
    }
    // A break point the roof runs straight through is no corner.
    const out: Point3Mm[] = [];
    for (const pt of points) {
        while (out.length >= 2) {
            const a = out[out.length - 2]!;
            const b = out[out.length - 1]!;
            const run = Math.hypot(pt.x - a.x, pt.y - a.y);
            const along = Math.hypot(b.x - a.x, b.y - a.y);
            const expected = run === 0 ? a.z : a.z + ((pt.z - a.z) * along) / run;
            if (Math.abs(expected - b.z) > 1) break;
            out.pop();
        }
        if (!out.length || !samePoint(out[out.length - 1]!, pt)) out.push(pt);
    }
    return out;
}

/**
 * A wall split into the run along its top, from its left end to its right, and the rest.
 * `left`/`right` are indices into the ring; the top runs from one to the other in `step`.
 */
interface WallTop {
    left: number;
    right: number;
    step: 1 | -1;
    top: Point3Mm[];
    baseZ: number;
    p: { x: number; y: number };
    q: { x: number; y: number };
}

function wallTop(ring: readonly Point3Mm[]): WallTop | null {
    const frame = surfaceFrame(ring);
    if (!frame) return null;
    const u = ring.map(
        (pt) => (pt.x - frame.originMm.x) * frame.uDir.x + (pt.y - frame.originMm.y) * frame.uDir.y
    );
    const uMin = Math.min(...u);
    const uMax = Math.max(...u);
    if (uMax - uMin < 1) return null;
    const highestAt = (target: number): number => {
        let best = -1;
        ring.forEach((pt, i) => {
            if (Math.abs(u[i]! - target) > 1) return;
            if (best < 0 || pt.z > ring[best]!.z) best = i;
        });
        return best;
    };
    const left = highestAt(uMin);
    const right = highestAt(uMax);
    const walk = (step: 1 | -1): Point3Mm[] => {
        const out = [ring[left]!];
        for (let i = left; i !== right;) {
            i = (i + step + ring.length) % ring.length;
            out.push(ring[i]!);
        }
        return out;
    };
    const mean = (pts: readonly Point3Mm[]) => pts.reduce((sum, pt) => sum + pt.z, 0) / pts.length;
    const forward = walk(1);
    const backward = walk(-1);
    const step = mean(forward) >= mean(backward) ? 1 : -1;
    const baseZ = Math.min(...ring.map((pt) => pt.z));
    return {
        left,
        right,
        step,
        top: step === 1 ? forward : backward,
        baseZ,
        p: { x: ring[left]!.x, y: ring[left]!.y },
        q: { x: ring[right]!.x, y: ring[right]!.y },
    };
}

/** The wall with its top replaced by `profile`, which runs from its left end to its right. */
function withTop(
    ring: readonly Point3Mm[],
    top: WallTop,
    profile: readonly Point3Mm[]
): Point3Mm[] {
    // Everything that is not the top, from the right end round to the left in the ring's own
    // direction, keeps its place; the new top closes the ring from left to right.
    const rest: Point3Mm[] = [];
    for (let i = top.right; ;) {
        i = (i + top.step + ring.length) % ring.length;
        if (i === top.left) break;
        rest.push(ring[i]!);
    }
    const out = [...profile, ...rest];
    return top.step === 1 ? out : out.reverse();
}

/** Whether every corner of `pts` is on one of the roof planes, inside it in plan. */
function onRoof(planes: readonly RoofPlane[], pts: readonly Point3Mm[]): boolean {
    return pts.every((pt) =>
        planes.some(({ ring, plane }) => {
            if (!pointInOrOnPolygonPlan(pt, ring)) return false;
            const z = planeHeightAt(plane, pt.x, pt.y);
            return z !== null && Math.abs(z - pt.z) <= ON_MM;
        })
    );
}

/** The roof's outer edges in plan: those no other roof face has an edge along. */
function outerEdges(roof: readonly Surface[]): [Point3Mm, Point3Mm][] {
    const edges: [Point3Mm, Point3Mm][] = [];
    for (const s of roof) {
        const ring = s.boundaryMm;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i]!;
            const b = ring[(i + 1) % ring.length]!;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const shared = roof.some(
                (o) =>
                    o !== s &&
                    o.boundaryMm.some((c, j) => {
                        const d = o.boundaryMm[(j + 1) % o.boundaryMm.length]!;
                        return distanceToSegmentPlan(mid, c, d) <= ON_MM;
                    })
            );
            if (!shared) edges.push([a, b]);
        }
    }
    return edges;
}

function distanceToSegmentPlan(
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Whether a floor or ceiling lies between a wall's top and the roof, over plan point `xy`. With
 * `atTop`, one lying right on the top counts too — a ceiling on an interior wall is where that
 * wall stops, while a gable goes on past the ceiling to close the attic.
 */
function floorBetween(
    surfaces: readonly Surface[],
    skip: ReadonlySet<SurfaceId>,
    xy: { x: number; y: number },
    fromZ: number,
    toZ: number,
    atTop: boolean
): boolean {
    const from = atTop ? fromZ - ON_MM : fromZ + ON_MM;
    return surfaces.some((s) => {
        if (skip.has(s.id) || !isLevel(s.boundaryMm)) return false;
        const z = s.boundaryMm[0]!.z;
        return z > from && z < toZ - ON_MM && pointInOrOnPolygonPlan(xy, s.boundaryMm);
    });
}

/** Whether another wall stands on this one's top — the storey above, which the roof is over. */
function stackedOn(
    surfaces: readonly Surface[],
    wall: Surface,
    mid: { x: number; y: number },
    topZ: number
): boolean {
    return surfaces.some((s) => {
        if (s === wall || !isUpright(s.boundaryMm)) return false;
        const baseZ = Math.min(...s.boundaryMm.map((pt) => pt.z));
        if (Math.abs(baseZ - topZ) > ON_MM) return false;
        const top = wallTop(s.boundaryMm);
        return top !== null && distanceToSegmentPlan(mid, top.p, top.q) <= ON_MM;
    });
}

export interface FitWallsOptions {
    /** The roof's faces. */
    roofIds: ReadonlySet<SurfaceId>;
    /** The roof as it was before an edit — walls whose top was on it follow the new one. */
    oldRoof?: readonly Surface[];
    /** Whether walls wholly under the roof, not only those along its edge, grow up to it. */
    interior: boolean;
    /** The building's outside walls: they grow to a roof over them wherever it stands, as a gable does. */
    exterior?: ReadonlySet<SurfaceId>;
}

/** The walls the roof changes, as new outlines — see the header for which, and how. */
export function fitWallsToRoof(
    surfaces: readonly Surface[],
    options: FitWallsOptions
): { id: SurfaceId; boundaryMm: Point3Mm[] }[] {
    const roof = surfaces.filter((s) => options.roofIds.has(s.id));
    if (roof.length === 0) return [];
    const kinds = classifyAll(surfaces);
    const oldPlanes = roofPlanes(options.oldRoof ?? []);
    const edges = outerEdges(roof);
    const out: { id: SurfaceId; boundaryMm: Point3Mm[] }[] = [];

    for (const wall of surfaces) {
        if (options.roofIds.has(wall.id) || kinds.get(wall.id) !== 'wall') continue;
        if (!isUpright(wall.boundaryMm)) continue;
        const top = wallTop(wall.boundaryMm);
        if (!top) continue;
        const profile = roofProfile(roof, top.p, top.q, top.baseZ);
        if (!profile) continue;

        const following = oldPlanes.length > 0 && onRoof(oldPlanes, top.top);
        if (!following) {
            const highest = Math.max(...top.top.map((pt) => pt.z));
            const mid = { x: (top.p.x + top.q.x) / 2, y: (top.p.y + top.q.y) / 2 };
            const roofAtMid = profile.reduce((z, pt) => Math.max(z, pt.z), 0);
            if (stackedOn(surfaces, wall, mid, highest)) continue;
            // Only ever grown: a wall that reaches through the roof anywhere is left alone.
            const planes = roofPlanes(roof);
            const under = top.top.every((pt) => {
                const z = roofZ(planes, pt.x, pt.y, top.baseZ);
                return z !== null && z >= pt.z - ON_MM;
            });
            if (!under) continue;
            const alongEdge = [top.p, mid, top.q].every((pt) =>
                edges.some(([a, b]) => distanceToSegmentPlan(pt, a, b) <= ON_MM)
            );
            const outside = alongEdge || (options.exterior?.has(wall.id) ?? false);
            if (!outside && !options.interior) continue;
            if (floorBetween(surfaces, options.roofIds, mid, highest, roofAtMid, !outside)) {
                continue;
            }
        }
        // A top that already is the roof's profile has nothing to fit.
        const already =
            top.top.length === profile.length &&
            (top.top.every((pt, i) => samePoint(pt, profile[i]!)) ||
                top.top.every((pt, i) => samePoint(pt, profile[profile.length - 1 - i]!)));
        if (already) continue;

        out.push({ id: wall.id, boundaryMm: withTop(wall.boundaryMm, top, profile) });
    }
    return out;
}

/**
 * The model as `changes` would leave it, unchecked — for roof mode's preview, which shows the
 * walls growing to meet the roof before anything is saved. New faces get placeholder ids.
 * `changed` lists the faces the change adds or reshapes.
 */
export function previewFaceChanges(
    surfaces: readonly Surface[],
    changes: FaceChanges
): { surfaces: Surface[]; changed: Set<SurfaceId> } {
    const removed = new Set(changes.removeIds);
    const reshaped = new Map(changes.reshape.map((r) => [r.id, r]));
    const changed = new Set<SurfaceId>();
    const out: Surface[] = [];
    for (const s of surfaces) {
        if (removed.has(s.id)) continue;
        const r = reshaped.get(s.id);
        if (r?.boundaryMm) changed.add(s.id);
        out.push(r ? { ...s, ...r, boundaryMm: r.boundaryMm ?? s.boundaryMm } : s);
    }
    changes.add.forEach((face, i) => {
        const id = `preview-${i + 1}`;
        changed.add(id);
        out.push({
            id,
            boundaryMm: face.boundaryMm,
            openings: [],
            holes: [],
            kindOverride: face.kindOverride,
            loadBearing: null,
            spanDirectionOverride: null,
            roofGroupId: face.roofGroupId,
            studSectionOverride: null,
        });
    });
    return { surfaces: out, changed };
}
