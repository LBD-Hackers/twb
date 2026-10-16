/**
 * A storey's plan, flattened to 2D — what the SVG plan view draws and what the Interior Wall
 * tool snaps to.
 *
 * Pure and geometry-only, in the same spirit as `classify.ts` and `roof-height.ts`: no SVG, no
 * DOM, so `render/plan-view.ts` and the snapping ladder (`interaction/snap3.ts`'s `snapOnPlane`,
 * which is already plane-generic 2D maths) can both be fed from one source of truth rather than
 * projecting the model to plan twice and risking the two disagreeing.
 */

import type { Vec2Mm } from '../core';
import {
    SIDE_LEAF_FRACTION,
    type DoorLeaves,
    type OpeningKind,
    type Surface,
    type SurfaceId,
} from './surface';
import { classifyAll } from './classify';
import { openingRing3, surfaceFrame } from './surface-frame';
import type { Storey } from './storey';

/** A wall's plan footprint: the two ends of its base edge. Walls in this model have no thickness. */
export interface WallFootprint {
    surfaceId: SurfaceId;
    aMm: Vec2Mm;
    bMm: Vec2Mm;
}

/** A floor or roof's plan footprint: its boundary, projected straight onto the XY plane. */
export interface AreaFootprint {
    surfaceId: SurfaceId;
    ringMm: Vec2Mm[];
}

/** Two levels this close are the same level, mm. Matches `classify.ts`'s own tolerance. */
const LEVEL_TOLERANCE_MM = 1;

/**
 * A wall's base edge in plan — the two ends of its lowest edge — or null when its lowest corners
 * do not lie on one straight line (a shape too strange to have a single straight footprint).
 */
export function wallFootprint(surface: Surface): WallFootprint | null {
    const zs = surface.boundaryMm.map((p) => p.z);
    const lowestZ = Math.min(...zs);
    const base = surface.boundaryMm.filter((p) => p.z <= lowestZ + LEVEL_TOLERANCE_MM);
    if (base.length < 2) return null;
    if (base.length === 2) return { surfaceId: surface.id, aMm: base[0]!, bMm: base[1]! };
    // More than two: a base edge split by a vertex — a gable standing on a ceiling that was cut
    // in two, say. Still one straight footprint if every corner is on the line between the two
    // farthest apart, and those two are its ends.
    let a = base[0]!;
    let b = base[1]!;
    for (const p of base) {
        for (const q of base) {
            if (Math.hypot(q.x - p.x, q.y - p.y) > Math.hypot(b.x - a.x, b.y - a.y)) {
                a = p;
                b = q;
            }
        }
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= LEVEL_TOLERANCE_MM) return null;
    const offLine = (p: Vec2Mm): number =>
        Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len;
    if (base.some((p) => offLine(p) > LEVEL_TOLERANCE_MM)) return null;
    // Keep the ring's own order, so the footprint runs the way the wall was drawn.
    const [first, second] = base.indexOf(a) < base.indexOf(b) ? [a, b] : [b, a];
    return { surfaceId: surface.id, aMm: first, bMm: second };
}

/** Whether a surface's Z range reaches at all into `[fromMm, toMm)`. */
function overlapsRange(surface: Surface, fromMm: number, toMm: number): boolean {
    const zs = surface.boundaryMm.map((p) => p.z);
    return (
        Math.min(...zs) < toMm - LEVEL_TOLERANCE_MM && Math.max(...zs) > fromMm + LEVEL_TOLERANCE_MM
    );
}

/** Every wall whose height range reaches into a storey, as plan footprints. */
export function wallFootprintsInStorey(
    surfaces: readonly Surface[],
    storey: Storey
): WallFootprint[] {
    const kinds = classifyAll(surfaces);
    const footprints: WallFootprint[] = [];
    for (const s of surfaces) {
        if (kinds.get(s.id) !== 'wall') continue;
        if (!overlapsRange(s, storey.elevationMm, storey.elevationMm + storey.heightMm)) continue;
        const fp = wallFootprint(s);
        if (fp) footprints.push(fp);
    }
    return footprints;
}

/**
 * A door or window's plan footprint: the segment of its wall's own line that it interrupts.
 *
 * A wall's frame has `vDir` exactly vertical (`surface-frame.ts`), so a hole's four corners —
 * two at its sill, two at its head — project to exactly two distinct XY points regardless of
 * height: the near and far jamb. That is what makes this a segment rather than a rectangle.
 */
export interface WallOpening {
    surfaceId: SurfaceId;
    openingId: string;
    aMm: Vec2Mm;
    bMm: Vec2Mm;
    kind: OpeningKind;
    /** A door, which swings — not a garage door, which does not. */
    isDoor: boolean;
    /** How a door's leaves swing, in plan: one per leaf, and none for a window. */
    swings: readonly DoorSwingPlan[];
}

/**
 * A door's swing in plan: the leaf hangs on `hingeMm`, closes onto `latchMm` (the other jamb),
 * and opens a quarter turn towards `openDir` — a unit vector square to the wall.
 */
export interface DoorSwingPlan {
    hingeMm: Vec2Mm;
    latchMm: Vec2Mm;
    openDir: Vec2Mm;
}

/**
 * A door's leaves in plan, from the jamb its (wide) leaf hangs on to the other one: one leaf
 * across the whole hole; a wide leaf and a side leaf a third as wide on the other jamb, meeting
 * where they close; or two equal leaves meeting in the middle.
 */
export function doorLeafSwings(
    hingeMm: Vec2Mm,
    otherJambMm: Vec2Mm,
    openDir: Vec2Mm,
    leaves: DoorLeaves
): DoorSwingPlan[] {
    if (leaves === 'single') return [{ hingeMm, latchMm: otherJambMm, openDir }];
    const t = leaves === 'double' ? 0.5 : 1 - SIDE_LEAF_FRACTION;
    const meetMm = {
        x: hingeMm.x + (otherJambMm.x - hingeMm.x) * t,
        y: hingeMm.y + (otherJambMm.y - hingeMm.y) * t,
    };
    return [
        { hingeMm, latchMm: meetMm, openDir },
        { hingeMm: otherJambMm, latchMm: meetMm, openDir },
    ];
}

/**
 * Whether a plan point is on a door's leaf or inside the quarter circle it sweeps — what makes a
 * click on the swing, not only on the hole in the wall, pick the door. `toleranceMm` widens it,
 * so the leaf and the arc's own line can be hit.
 */
export function pointInDoorSwing(
    swing: DoorSwingPlan,
    pointMm: Vec2Mm,
    toleranceMm: number
): boolean {
    const { hingeMm, latchMm, openDir } = swing;
    const radiusMm = Math.hypot(latchMm.x - hingeMm.x, latchMm.y - hingeMm.y);
    if (radiusMm === 0) return false;
    const along = { x: (latchMm.x - hingeMm.x) / radiusMm, y: (latchMm.y - hingeMm.y) / radiusMm };
    const dx = pointMm.x - hingeMm.x;
    const dy = pointMm.y - hingeMm.y;
    return (
        Math.hypot(dx, dy) <= radiusMm + toleranceMm &&
        dx * openDir.x + dy * openDir.y >= -toleranceMm &&
        dx * along.x + dy * along.y >= -toleranceMm
    );
}

/** Every door and window cut into a wall reaching into a storey, as plan footprints. */
export function wallOpeningsInStorey(surfaces: readonly Surface[], storey: Storey): WallOpening[] {
    const kinds = classifyAll(surfaces);
    const openings: WallOpening[] = [];
    for (const s of surfaces) {
        if (kinds.get(s.id) !== 'wall') continue;
        if (!overlapsRange(s, storey.elevationMm, storey.elevationMm + storey.heightMm)) continue;
        if (s.openings.length === 0) continue;
        const frame = surfaceFrame(s.boundaryMm);
        if (!frame) continue;
        for (const hole of s.openings) {
            const [near, far] = openingRing3(frame, hole);
            if (!near || !far) continue;
            const aMm = { x: near.x, y: near.y };
            const bMm = { x: far.x, y: far.y };
            const isDoor = hole.kind === 'door';
            // A wall's normal is horizontal (`surface-frame.ts`), so its XY is already unit.
            const side = hole.swingsBack ? -1 : 1;
            const openDir = { x: frame.normal.x * side, y: frame.normal.y * side };
            const swings = isDoor
                ? doorLeafSwings(
                      hole.hingeAtEnd ? bMm : aMm,
                      hole.hingeAtEnd ? aMm : bMm,
                      openDir,
                      hole.leaves ?? 'single'
                  )
                : [];
            openings.push({
                surfaceId: s.id,
                openingId: hole.id,
                aMm,
                bMm,
                kind: hole.kind,
                isDoor,
                swings,
            });
        }
    }
    return openings;
}

/** Every floor sitting at (approximately) a storey's own elevation, as plan footprints. */
export function floorFootprintsInStorey(
    surfaces: readonly Surface[],
    storey: Storey
): AreaFootprint[] {
    const kinds = classifyAll(surfaces);
    const footprints: AreaFootprint[] = [];
    for (const s of surfaces) {
        if (kinds.get(s.id) !== 'floor') continue;
        const levelMm = s.boundaryMm[0]!.z;
        if (Math.abs(levelMm - storey.elevationMm) > LEVEL_TOLERANCE_MM) continue;
        footprints.push({ surfaceId: s.id, ringMm: s.boundaryMm.map((p) => ({ x: p.x, y: p.y })) });
    }
    return footprints;
}

/** Every roof plane's outline, projected to plan — the reference a top-storey wall snaps to. */
export function roofFootprints(surfaces: readonly Surface[]): AreaFootprint[] {
    const kinds = classifyAll(surfaces);
    const footprints: AreaFootprint[] = [];
    for (const s of surfaces) {
        if (kinds.get(s.id) !== 'roof') continue;
        footprints.push({ surfaceId: s.id, ringMm: s.boundaryMm.map((p) => ({ x: p.x, y: p.y })) });
    }
    return footprints;
}
