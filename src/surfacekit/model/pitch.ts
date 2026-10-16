/**
 * Re-pitching a plane: hold one edge still and swing the rest of the face to a given angle.
 *
 * The gesture this exists for is the one nobody wants to do in millimetres. A ridge is lifted
 * to *a pitch* — 25°, 35°, 45° — and the height that produces is a consequence, not the input.
 * Today the only way in is `moveVertices`, which takes a rise; this module is the inverse, and
 * it deliberately stops short of the store: given a hinge and an angle it returns a list of
 * `VertexMove`s, and `SurfaceStore.moveVerticesTo` applies them through the same validation
 * every other verb goes through.
 *
 * **The pitch is never stored.** It is read off the plane whenever anyone asks (`pitchDegOf`),
 * exactly as a face's kind is read off its normal in `classify.ts`. Setting a pitch is a one-off
 * edit of the geometry, not a constraint the model then has to maintain — move a wall afterwards
 * and the pitch changes, which is the same bargain the rest of this model makes.
 *
 * **It is a shear, not a rotation.** Every moved vertex keeps its plan position and only its `z`
 * changes, by `run · tan(pitch)` where `run` is its perpendicular distance to the hinge *in
 * plan*. A true rotation about the hinge axis would drag the corners horizontally and off the
 * 1200 module — and the module is a constraint in plan only, heights being free, so a pure-`z`
 * edit is the one shape of edit that can never fail the grid check. For the ordinary case, a
 * ridge parallel to its eave, every moved vertex gets the same new height and this degenerates
 * exactly into the vertical move it generalises.
 *
 * Pure: rings and numbers in, moves out. No store, no signals.
 */

import { pitchDegOf, planeOfPolygon, type Point3Mm } from '../core';
import type { Surface, SurfaceId } from './surface';
import { COINCIDENT_MM, roundPoint, samePoint, type VertexMove } from './surface-ops';

/** Two heights this close are the same level, mm. Matches `classify.ts`'s own level tolerance. */
const LEVEL_TOLERANCE_MM = 1;

/** How far a stationary corner may sit off the hinge line in plan and still be on it, mm. */
const HINGE_TOLERANCE_MM = 1;

/**
 * Shortest run worth re-pitching, mm.
 *
 * This is what keeps a **gable wall out of the candidate list**. A gable shares the ridge with
 * the two roof planes and would otherwise qualify — its unmoved corners are level and collinear
 * — but a wall is vertical, so in plan its whole outline collapses onto one line and the ridge
 * stands zero millimetres from it. There is no angle to set over no run, and 100 mm is far below
 * any real rafter run while being far above integer-mm noise.
 */
const MIN_RUN_MM = 100;

/** Below this a plane is level: it has no pitch to *change*, only one to establish. */
export const MIN_PITCH_DEG = 0.5;

/** Steepest angle still worth calling a pitch rather than a wall, degrees. */
export const MAX_PITCH_DEG = 85;

/**
 * One way of re-pitching: which edge stays put, how much run there is to swing over, and what
 * the plane reads as now.
 *
 * A single edge can offer several — the ridge of a duo-pitch roof belongs to a plane on each
 * side, and each is a legitimate answer to "set the pitch to 35°" with a different result.
 * Which one to take is the caller's decision, not this module's.
 */
export interface PitchTarget {
    surfaceId: SurfaceId;
    /** The edge that stays put. Both ends are at the same level, by construction. */
    hingeAMm: Point3Mm;
    hingeBMm: Point3Mm;
    /** Perpendicular plan distance from the hinge to the farthest moved corner, mm. */
    runMm: number;
    /** What this plane's pitch is now, degrees. */
    pitchDeg: number;
    /**
     * +1 when the moved corners sit above the hinge, -1 when below.
     *
     * Read off the geometry rather than assumed, and it is what makes "hold the ridge and drop
     * the eave" work with no extra flag: pick the eave with the ridge already above it and the
     * new angle is applied downward, which is the edit a fixed maximum building height asks for.
     */
    sign: 1 | -1;
}

/** Perpendicular distance from `p` to the line `a`–`b`, both flattened to plan, mm. */
function planDistanceToLine(p: Point3Mm, a: Point3Mm, b: Point3Mm): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** The two of `points` farthest apart in plan — the longest line their set defines. */
function farthestPairInPlan(points: readonly Point3Mm[]): readonly [Point3Mm, Point3Mm] | null {
    let best: { a: Point3Mm; b: Point3Mm; d: number } | null = null;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const a = points[i]!;
            const b = points[j]!;
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            if (!best || d > best.d) best = { a, b, d };
        }
    }
    return best && best.d > HINGE_TOLERANCE_MM ? [best.a, best.b] : null;
}

/**
 * The target a face offers when `movedMm` swings and `stationaryMm` stays, or null when it
 * offers none — the stationary corners are not level, do not lie on one line in plan, or leave
 * no run to swing over.
 */
function targetFrom(
    surface: Surface,
    stationaryMm: readonly Point3Mm[],
    movedMm: readonly Point3Mm[]
): PitchTarget | null {
    if (stationaryMm.length < 2 || movedMm.length === 0) return null;

    const levelMm = stationaryMm[0]!.z;
    if (stationaryMm.some((p) => Math.abs(p.z - levelMm) > LEVEL_TOLERANCE_MM)) return null;

    const hinge = farthestPairInPlan(stationaryMm);
    if (!hinge) return null;
    const [a, b] = hinge;
    if (stationaryMm.some((p) => planDistanceToLine(p, a, b) > HINGE_TOLERANCE_MM)) return null;

    let runMm = 0;
    let farthest = movedMm[0]!;
    for (const p of movedMm) {
        const d = planDistanceToLine(p, a, b);
        if (d > runMm) {
            runMm = d;
            farthest = p;
        }
    }
    if (runMm < MIN_RUN_MM) return null;

    const plane = planeOfPolygon(surface.boundaryMm);
    if (!plane) return null;

    return {
        surfaceId: surface.id,
        hingeAMm: a,
        hingeBMm: b,
        runMm: Math.round(runMm),
        pitchDeg: pitchDegOf(plane),
        sign: farthest.z < levelMm - LEVEL_TOLERANCE_MM ? -1 : 1,
    };
}

/**
 * Every way of re-pitching the faces that have a corner at one of `positionsMm` — the move
 * tool's question, asked of the edge it has hold of.
 *
 * Sorted by run, longest first, because a caller with no better information wants the main roof
 * plane rather than the dormer cheek that happens to share the same ridge point.
 */
export function pitchTargets(
    surfaces: readonly Surface[],
    positionsMm: readonly Point3Mm[],
    toleranceMm = COINCIDENT_MM
): readonly PitchTarget[] {
    const out: PitchTarget[] = [];
    for (const surface of surfaces) {
        const moved: Point3Mm[] = [];
        const stationary: Point3Mm[] = [];
        for (const p of surface.boundaryMm) {
            if (positionsMm.some((q) => samePoint(p, q, toleranceMm))) moved.push(p);
            else stationary.push(p);
        }
        const target = targetFrom(surface, stationary, moved);
        if (target) out.push(target);
    }
    return out.sort((x, y) => y.runMm - x.runMm);
}

/**
 * The face's own re-pitch: **hinged on its lowest level edge** — the eave — with every corner
 * clear of that edge swinging.
 *
 * That is the right default because the eave is where the roof meets the wall it bears on, and
 * a wall's height is authored while a ridge's is a consequence. The other choice, holding the
 * ridge and dropping the eaves, is what a maximum building height asks for; it is reachable
 * through `pitchTargets` by taking hold of the eave instead, which is what the Move tool does.
 *
 * Null when the face has no level edge to hinge on, or when it is level itself — a flat face has
 * no pitch to change, and picking one of its four equally valid edges to swing from would be a
 * coin toss dressed up as a decision.
 */
export function surfacePitchTarget(
    surface: Surface
): { target: PitchTarget; positionsMm: readonly Point3Mm[] } | null {
    const ring = surface.boundaryMm;
    if (ring.length < 3) return null;

    let hinge: { a: Point3Mm; b: Point3Mm } | null = null;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        if (Math.abs(a.z - b.z) > LEVEL_TOLERANCE_MM) continue;
        if (!hinge || a.z < hinge.a.z - LEVEL_TOLERANCE_MM) hinge = { a, b };
    }
    if (!hinge) return null;

    const stationary: Point3Mm[] = [];
    const moved: Point3Mm[] = [];
    for (const p of ring) {
        const onHinge =
            Math.abs(p.z - hinge.a.z) <= LEVEL_TOLERANCE_MM &&
            planDistanceToLine(p, hinge.a, hinge.b) <= HINGE_TOLERANCE_MM;
        (onHinge ? stationary : moved).push(p);
    }

    const target = targetFrom(surface, stationary, moved);
    if (!target || target.pitchDeg < MIN_PITCH_DEG) return null;
    return { target, positionsMm: moved };
}

/**
 * Where each of `positionsMm` has to go for `target`'s plane to stand at `pitchDeg`.
 *
 * Every position is given a height, whether or not it belongs to `target`'s own face: the ridge
 * of a duo-pitch roof is a corner of the plane on the other side and of both gables too, and all
 * of them have to arrive at the same place or the store's planarity check will — rightly —
 * reject the edit. That is the same "topology by coincidence" rule `moveRingVertices` works by.
 */
export function pitchMoves(
    target: PitchTarget,
    positionsMm: readonly Point3Mm[],
    pitchDeg: number
): readonly VertexMove[] {
    const slope = Math.tan((pitchDeg * Math.PI) / 180) * target.sign;
    return positionsMm.map((p) => ({
        fromMm: p,
        toMm: roundPoint({
            x: p.x,
            y: p.y,
            z: target.hingeAMm.z + planDistanceToLine(p, target.hingeAMm, target.hingeBMm) * slope,
        }),
    }));
}

/**
 * The rise `target`'s farthest corner travels to reach `pitchDeg` — the same number the Move
 * tool would have been given by hand, for the read-out that shows both.
 */
export function riseForPitch(target: PitchTarget, pitchDeg: number): number {
    const now = Math.tan((target.pitchDeg * Math.PI) / 180) * target.runMm;
    const next = Math.tan((pitchDeg * Math.PI) / 180) * target.runMm;
    return Math.round((next - now) * target.sign);
}

/** The pitch a rise of `riseMm` at `target`'s farthest corner would produce, degrees. */
export function pitchForRise(target: PitchTarget, riseMm: number): number {
    const heightMm =
        Math.tan((target.pitchDeg * Math.PI) / 180) * target.runMm + riseMm * target.sign;
    return (Math.atan2(Math.abs(heightMm), target.runMm) * 180) / Math.PI;
}
