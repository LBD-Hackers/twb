/**
 * Snapping a pointer position on the working plane.
 *
 * Pure geometry, working entirely in the plane's own 2D frame: this module knows nothing about
 * `Surface`, the camera or three.js. The caller flattens whatever it has — existing surface
 * edges, the ring being drawn — into rings in plane coordinates, and supplies a tolerance
 * already converted from screen pixels to model units at the current camera distance. A fixed
 * model-unit tolerance is either too tight zoomed out or too loose zoomed in, and keeping the
 * conversion in the caller keeps this module and its tests free of any camera concern.
 * `mep/src/interaction/snap.ts` makes the same split for the same reason.
 *
 * The difference from mep is what sits at the bottom of the ladder. mep falls back to a 100 mm
 * convenience grid; arch falls back to the **modular grid**, and that fallback is not a
 * convenience — it is the mechanism that enforces the 1200/600/400 system at the point of
 * drawing, so a non-modular coordinate can never enter the model in the first place.
 *
 * That fallback is nonetheless switchable (`snapToGrid: false`), and the switch is not a
 * hedge. A wall 2700 mm tall, an existing building measured off a survey, a sloping site — all
 * of them are dimensions the modular system cannot express, and a tool that cannot draw them
 * at all is not a tool anyone will keep using. Turning the grid off drops **only** the grid:
 * vertex, midpoint, edge, intersection and axis snapping all still apply, because those are
 * what make freehand drawing precise rather than approximate.
 *
 * Above the axis lock sits one more inference, the **from-point** one — SketchUp's "From
 * Point", Miro's dashed magnet: the caller names a point the user has hovered, and the cursor
 * is pulled onto the lines through that point along the plane axes and perpendicular to the
 * edges that meet there. On its own it aligns the next corner with a corner elsewhere; crossed
 * with the axis lock from the last placed point it pins the cursor to the *intersection* of the
 * two, which is how the fourth corner of a rectangle is found from its first three.
 */

import { distance2, nearestPointOnSegment2, type Vec2Mm } from '../core';
import { MODULE_MM, snapMm, snapPoint2 } from '../grid';

export type SnapKind =
    | 'vertex'
    | 'midpoint'
    | 'intersection'
    | 'edge'
    /** On a line through the hovered point — and on the axis lock too, when both engaged. */
    | 'from-point'
    | 'axis'
    | 'sub-grid'
    | 'module-grid'
    /** No snap applied at all — the raw position on the plane, with the grid switched off. */
    | 'free';

export interface SnapResult {
    /** In the working plane's own 2D coordinates. */
    pointUv: Vec2Mm;
    kind: SnapKind;
    /**
     * Unit direction of the axis lock the returned point lies on, in plane coordinates; null
     * when it lies on none.
     *
     * Returned rather than kept private because *which* axis caught is the feedback that makes
     * an inference usable — the caller maps it back to a world axis and colours the rubber band
     * accordingly (`working-plane.ts`'s `lockAxisOf`). It is set only when the point actually
     * honours the lock: for an `'axis'` result, and for a `'from-point'` one found as the
     * crossing of the two. A lock that engaged but lost to a nearer vertex is not reported —
     * colouring the band for a constraint that is not in force would promise the wrong thing.
     */
    lockDirUv: Vec2Mm | null;
    /**
     * The from-point inference's origin when the returned point lies on one of its lines, so
     * the caller can draw the dashed guide from there to the cursor. Null otherwise.
     */
    fromPointUv: Vec2Mm | null;
}

/** A hovered point the cursor can be aligned with, and the directions to align along. */
export interface FromPoint {
    pointUv: Vec2Mm;
    /** Unit directions, in plane coordinates: the plane axes, the perpendiculars of edges at the point. */
    dirsUv: readonly Vec2Mm[];
}

export interface SnapRing {
    pointsUv: readonly Vec2Mm[];
    /** False for an open polyline — no wraparound edge back to point 0. */
    closed: boolean;
}

export interface SnapContext {
    rings: readonly SnapRing[];
    /** Snap tolerance in model units (mm), already converted from a screen-pixel constant. */
    toleranceMm: number;
    /**
     * The previous vertex in the ring being drawn, if any. Enables axis locking — the
     * horizontal/vertical constraint that makes drawing a rectangle possible without
     * hitting an existing vertex to snap to.
     */
    lastPointUv?: Vec2Mm | null;
    /** Forces the axis lock on regardless of angle. Bound to Shift by the tool. */
    forceAxisLock?: boolean;
    /** A point the user paused on, to align the cursor with. Null or absent when none is armed. */
    fromPoint?: FromPoint | null;
    /** Sub-module pitch offered below the module grid. */
    subPitchMm?: number;
    /**
     * Whether the modular grid is in force. Defaults to true.
     *
     * False removes both the grid fallback *and* the quantisation of the distance travelled
     * along an axis lock — the two places a length is forced onto the module. Nothing else
     * changes: the geometric snaps are untouched.
     */
    snapToGrid?: boolean;
}

/**
 * Snap kinds ranked most-specific first. A candidate in a higher tier wins over a lower one as
 * long as it is within tolerance, **even if a lower tier sits closer to the cursor**.
 *
 * Without the tiering, `edge` (the nearest point on a segment, which by construction is never
 * farther than that segment's own endpoints) would shadow every vertex and midpoint, making
 * those snaps unreachable in practice. mep hit exactly this and documents it.
 */
const PRIORITY: readonly SnapKind[] = [
    'vertex',
    'intersection',
    'midpoint',
    'edge',
    'from-point',
    'axis',
];

/**
 * Angles the axis lock engages on, in degrees: the plane's own axes and nothing between. The 45s
 * were locks too, and caught a line meant to run at 40° as often as one meant at 45; a diagonal
 * is drawn free, or typed.
 */
const AXIS_LOCK_ANGLES_DEG = [0, 90, 180, 270] as const;

/** How close to a lock angle the cursor must be before the lock takes over, in degrees. */
export const AXIS_LOCK_ENGAGE_DEG = 6;

/**
 * How far apart in angle the axis lock and a from-point line must be before their crossing is
 * taken as the point. Two nearly parallel lines cross somewhere far off the cursor, and a
 * point the user is not pointing at is not an inference — it is a jump. sin(15°).
 */
const MIN_CROSSING_SIN = 0.2588;

/** Interior-crossing margin, so two edges merely sharing a vertex are not an 'intersection'. */
const INTERSECTION_EPS = 1e-6;

function segmentIntersection(a1: Vec2Mm, a2: Vec2Mm, b1: Vec2Mm, b2: Vec2Mm): Vec2Mm | null {
    const d1x = a2.x - a1.x;
    const d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x;
    const d2y = b2.y - b1.y;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-12) return null;

    const dx = b1.x - a1.x;
    const dy = b1.y - a1.y;
    const t = (dx * d2y - dy * d2x) / denom;
    const u = (dx * d1y - dy * d1x) / denom;
    if (t < INTERSECTION_EPS || t > 1 - INTERSECTION_EPS) return null;
    if (u < INTERSECTION_EPS || u > 1 - INTERSECTION_EPS) return null;
    return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

/**
 * Projects `point` onto the nearest axis ray from `from`, if one is engaged.
 *
 * Returns null when no angle is close enough and the lock is not forced — the caller then
 * falls through to the grid, which is the common case for the very first vertex of a ring.
 *
 * The lock is expressed in the plane's own axes, which is the whole reason a *vertical* lock
 * needs no code of its own: on the ground plane the 0/90 degree rays are world X and Y, and on
 * a wall's vertical plane the 90 degree ray is world Z. One rule, three axes.
 */
function axisLock(
    point: Vec2Mm,
    from: Vec2Mm,
    force: boolean
): { point: Vec2Mm; dir: Vec2Mm } | null {
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;

    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    let bestAngle = 0;
    let bestDelta = Infinity;
    for (const candidate of AXIS_LOCK_ANGLES_DEG) {
        // Wrap into [-180, 180] so 359 and 1 read as 2 degrees apart, not 358.
        const delta = Math.abs(((angleDeg - candidate + 540) % 360) - 180);
        if (delta < bestDelta) {
            bestDelta = delta;
            bestAngle = candidate;
        }
    }
    if (!force && bestDelta > AXIS_LOCK_ENGAGE_DEG) return null;

    const rad = (bestAngle * Math.PI) / 180;
    const dir = { x: Math.cos(rad), y: Math.sin(rad) };
    // Project onto the ray rather than rotating the cursor onto it: projection keeps the
    // point under the cursor's own reach instead of swinging it out to the raw radius.
    const along = dx * dir.x + dy * dir.y;
    return { point: { x: from.x + along * dir.x, y: from.y + along * dir.y }, dir };
}

export function snapOnPlane(pointUv: Vec2Mm, ctx: SnapContext): SnapResult {
    const byKind = new Map<SnapKind, { point: Vec2Mm; dist: number }>();
    const consider = (candidate: Vec2Mm, kind: SnapKind): void => {
        const d = distance2(pointUv, candidate);
        if (d > ctx.toleranceMm) return;
        const current = byKind.get(kind);
        if (!current || d < current.dist) byKind.set(kind, { point: candidate, dist: d });
    };

    const edgePitch = ctx.snapToGrid === false ? 0 : (ctx.subPitchMm ?? MODULE_MM);
    const edges: { a: Vec2Mm; b: Vec2Mm }[] = [];
    for (const { pointsUv, closed } of ctx.rings) {
        for (const p of pointsUv) consider(p, 'vertex');
        const edgeCount = closed ? pointsUv.length : pointsUv.length - 1;
        for (let i = 0; i < edgeCount; i++) {
            const a = pointsUv[i]!;
            const b = pointsUv[(i + 1) % pointsUv.length]!;
            // Tested for proximity at the raw nearest point, then quantised along the edge:
            // a point *on* an edge is still a point in the model, and with the grid in force
            // it has to land on the grid like any other. Otherwise a ridge line's end could
            // sit anywhere along a wall's top edge and put a non-modular corner into the wall.
            const raw = nearestPointOnSegment2(pointUv, a, b);
            const d = distance2(pointUv, raw);
            if (d <= ctx.toleranceMm) {
                const current = byKind.get('edge');
                if (!current || d < current.dist) {
                    byKind.set('edge', { point: quantizeAlongEdge(raw, a, b, edgePitch), dist: d });
                }
            }
            consider({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'midpoint');
            edges.push({ a, b });
        }
    }

    // Broad-phase before the pairwise crossing test: only edges whose tolerance-expanded
    // bounding box could contain a point this close to the cursor can cross near it. Keeps
    // this cheap on a model with hundreds of wall edges.
    const tol = ctx.toleranceMm;
    const nearby = edges.filter(({ a, b }) => {
        return (
            pointUv.x >= Math.min(a.x, b.x) - tol &&
            pointUv.x <= Math.max(a.x, b.x) + tol &&
            pointUv.y >= Math.min(a.y, b.y) - tol &&
            pointUv.y <= Math.max(a.y, b.y) + tol
        );
    });
    for (let i = 0; i < nearby.length; i++) {
        for (let j = i + 1; j < nearby.length; j++) {
            const hit = segmentIntersection(nearby[i]!.a, nearby[i]!.b, nearby[j]!.a, nearby[j]!.b);
            if (hit) consider(hit, 'intersection');
        }
    }

    const locked = ctx.lastPointUv
        ? axisLock(pointUv, ctx.lastPointUv, ctx.forceAxisLock === true)
        : null;
    if (locked) {
        // The lock is not a proximity candidate — it is a constraint, so it is registered
        // unconditionally rather than through `consider`'s tolerance test.
        byKind.set('axis', { point: locked.point, dist: distance2(pointUv, locked.point) });
    }

    // The from-point inference is a proximity candidate like an edge — the cursor has to be
    // near one of its lines — but what it yields depends on the lock: the crossing of the two
    // when both are in force and cross at a real angle, the projection onto the line alone
    // otherwise. The crossing is fully determined and is not quantised; the projection still
    // has a free length along the line, which goes onto the grid like a lock's does.
    let fromHit: { point: Vec2Mm; viaLock: boolean } | null = null;
    if (ctx.fromPoint) {
        const near = nearestFromLine(pointUv, ctx.fromPoint, ctx.toleranceMm);
        if (near) {
            const crossing =
                locked && ctx.lastPointUv
                    ? lineCrossing(ctx.lastPointUv, locked.dir, ctx.fromPoint.pointUv, near.dir)
                    : null;
            fromHit = crossing
                ? { point: crossing, viaLock: true }
                : {
                      point:
                          ctx.snapToGrid === false
                              ? near.point
                              : quantizeAlongLock(near.point, ctx.fromPoint.pointUv, ctx),
                      viaLock: false,
                  };
            byKind.set('from-point', {
                point: fromHit.point,
                dist: distance2(pointUv, fromHit.point),
            });
        }
    }

    for (const kind of PRIORITY) {
        const hit = byKind.get(kind);
        if (!hit) continue;
        if (kind === 'from-point' && fromHit && ctx.fromPoint) {
            return {
                pointUv: hit.point,
                kind,
                lockDirUv: fromHit.viaLock && locked ? locked.dir : null,
                fromPointUv: ctx.fromPoint.pointUv,
            };
        }
        // An axis-locked point still has a free coordinate along the ray, and letting that
        // stay unsnapped would put a non-modular length into the model — the one thing this
        // module exists to prevent. Quantise the distance travelled along the lock instead,
        // unless the grid is switched off, in which case a free length is exactly the point.
        if (kind === 'axis' && locked && ctx.lastPointUv) {
            const pointOnLock =
                ctx.snapToGrid !== false
                    ? quantizeAlongLock(hit.point, ctx.lastPointUv, ctx)
                    : hit.point;
            return { pointUv: pointOnLock, kind, lockDirUv: locked.dir, fromPointUv: null };
        }
        return { pointUv: hit.point, kind, lockDirUv: null, fromPointUv: null };
    }

    const lockDirUv = null;
    const fromPointUv = null;
    if (ctx.snapToGrid === false) return { pointUv, kind: 'free', lockDirUv, fromPointUv };

    const sub = ctx.subPitchMm ?? 0;
    if (sub > 0) {
        const onSub = snapPoint2(pointUv, sub);
        const onModule = snapPoint2(pointUv, MODULE_MM);
        // Prefer the module grid when the cursor is genuinely near it; the sub-grid is the
        // finer fallback, not the default, so drawn dimensions land on full modules by
        // default and subdivide only when the user aims between them.
        if (distance2(pointUv, onModule) <= ctx.toleranceMm) {
            return { pointUv: onModule, kind: 'module-grid', lockDirUv, fromPointUv };
        }
        return { pointUv: onSub, kind: 'sub-grid', lockDirUv, fromPointUv };
    }
    return { pointUv: snapPoint2(pointUv, MODULE_MM), kind: 'module-grid', lockDirUv, fromPointUv };
}

/**
 * The from-point line the cursor is nearest, with the cursor projected onto it — or null when
 * none is within tolerance. The point itself is excluded: standing on it, the cursor is on
 * every line at once, and that is the vertex snap's job, not this one's.
 */
function nearestFromLine(
    point: Vec2Mm,
    from: FromPoint,
    toleranceMm: number
): { point: Vec2Mm; dir: Vec2Mm } | null {
    const dx = point.x - from.pointUv.x;
    const dy = point.y - from.pointUv.y;
    if (Math.hypot(dx, dy) <= toleranceMm) return null;
    let best: { point: Vec2Mm; dir: Vec2Mm; dist: number } | null = null;
    for (const dir of from.dirsUv) {
        const along = dx * dir.x + dy * dir.y;
        const projected = { x: from.pointUv.x + along * dir.x, y: from.pointUv.y + along * dir.y };
        const dist = distance2(point, projected);
        if (dist <= toleranceMm && (!best || dist < best.dist))
            best = { point: projected, dir, dist };
    }
    return best;
}

/** Where two lines cross, or null when they are too nearly parallel for the crossing to mean anything. */
function lineCrossing(p: Vec2Mm, pDir: Vec2Mm, q: Vec2Mm, qDir: Vec2Mm): Vec2Mm | null {
    const denom = pDir.x * qDir.y - pDir.y * qDir.x;
    if (Math.abs(denom) < MIN_CROSSING_SIN) return null;
    const t = ((q.x - p.x) * qDir.y - (q.y - p.y) * qDir.x) / denom;
    return { x: p.x + t * pDir.x, y: p.y + t * pDir.y };
}

/**
 * Moves a point on an edge to the nearest grid position along that edge, without leaving it.
 *
 * For an edge parallel to a plane axis the varying coordinate is rounded onto the pitch and
 * clamped to the edge, which is what keeps the point modular *and* on the edge at once. A
 * diagonal edge has no grid positions along it — no pitch makes hypot(1200, 1200) modular —
 * so it is left alone, as `grid-validate.ts` leaves diagonals alone. A pitch of 0 means the
 * grid is off and the raw point stands.
 */
function quantizeAlongEdge(point: Vec2Mm, a: Vec2Mm, b: Vec2Mm, pitchMm: number): Vec2Mm {
    if (pitchMm <= 0) return point;
    const clamp = (v: number, lo: number, hi: number): number =>
        Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), v));
    if (Math.abs(a.y - b.y) < 1e-6) return { x: clamp(snapMm(point.x, pitchMm), a.x, b.x), y: a.y };
    if (Math.abs(a.x - b.x) < 1e-6) return { x: a.x, y: clamp(snapMm(point.y, pitchMm), a.y, b.y) };
    return point;
}

/** Rounds the distance travelled along an engaged axis lock onto the modular pitch. */
function quantizeAlongLock(point: Vec2Mm, from: Vec2Mm, ctx: SnapContext): Vec2Mm {
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return point;
    const pitch = ctx.subPitchMm && ctx.subPitchMm > 0 ? ctx.subPitchMm : MODULE_MM;
    const snapped = snapMm(len, pitch);
    const k = snapped / len;
    return { x: from.x + dx * k, y: from.y + dy * k };
}
