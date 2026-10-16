/**
 * The working plane: the 2D surface a 3D drawing operation actually happens on.
 *
 * This is what makes SketchUp-style direct-3D drawing tractable. A click gives a ray, and a
 * ray alone cannot place a point in space — it needs a surface to land on. Rather than asking
 * the user to manage a plane, the plane is inferred and the pointer is intersected with it:
 * the ground, or the face under the cursor — its own frame (`model/surface-frame.ts`), so a
 * rectangle drawn on a wall is measured along the wall and up it — or, for a line drawn in
 * open space, the plane through the corners placed so far.
 *
 * Deliberately pure — no three.js. The plane is model-frame maths (integer mm, Z-up) so it can
 * be unit-tested without a renderer; `render/viewport.ts` supplies the ray and
 * `interaction/snap3.ts` snaps the result. Keeping the three concerns apart is what lets the
 * snapping rules be tested against literal rays rather than through a WebGL context.
 */

import {
    add3,
    cross3,
    dot3,
    fromFrameUv,
    normalize3,
    planeOfPolygon,
    scale3,
    signedDistanceToFrame,
    sub3,
    toFrameUv,
    type Dir3,
    type Frame3,
    type Point3Mm,
    type Vec2Mm,
} from '../core';

/**
 * A `Frame3` with an identity, so two planes can be told apart without comparing their
 * vectors — a modeller uses it to skip a grid rebuild when the plane has not actually changed.
 */
export interface WorkingPlane extends Frame3 {
    id: string;
}

/** The ground plane at a given level — the plane everything starts on. */
export function groundPlane(levelMm = 0): WorkingPlane {
    return {
        id: `ground@${levelMm}`,
        originMm: { x: 0, y: 0, z: levelMm },
        uDir: { x: 1, y: 0, z: 0 },
        vDir: { x: 0, y: 1, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
    };
}

/**
 * The vertical plane containing a horizontal base line.
 *
 * `vDir` is exactly `(0,0,1)` rather than a computed perpendicular. That is not a shortcut: it
 * makes a wall's `v` coordinate a literal height above its base, so a 2100 mm door head is the
 * number 2100 and not a projection of it. `model/surface-frame.ts` makes the same choice for a
 * vertical face's frame, and `wall-recipe.ts` and `openings.ts` will depend on it being exact.
 *
 * Returns null if the two points are coincident in plan (no direction to build a plane from).
 */
export function verticalPlaneThrough(aMm: Point3Mm, bMm: Point3Mm): WorkingPlane | null {
    const along = normalize3({ x: bMm.x - aMm.x, y: bMm.y - aMm.y, z: 0 });
    if (along.x === 0 && along.y === 0) return null;
    const vDir: Dir3 = { x: 0, y: 0, z: 1 };
    return {
        id: `vertical@${aMm.x},${aMm.y}`,
        originMm: aMm,
        uDir: along,
        vDir,
        normal: cross3(along, vDir),
    };
}

/**
 * A plane through a point with a given normal — a free plane, where the user can work at any
 * angle.
 *
 * `uDir` is seeded from world east and re-derived if the plane is near-vertical, so the frame
 * stays well-conditioned as the plane tilts. Returns null for a degenerate normal.
 */
export function planeFromNormal(
    originMm: Point3Mm,
    normal: Dir3,
    id = 'free'
): WorkingPlane | null {
    const n = normalize3(normal);
    if (n.x === 0 && n.y === 0 && n.z === 0) return null;
    const seed: Dir3 = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const uDir = normalize3(sub3(seed, scale3(n, dot3(seed, n))));
    return { id, originMm, uDir, vDir: cross3(n, uDir), normal: n };
}

/**
 * The plane through a ring a line drawn in open space is still tracing, once it has one.
 *
 * A ring of fewer than three points, or three that are collinear, has no unique plane — the
 * caller falls back to the ground (or lets the vertical inference lift a point off it) until
 * this returns non-null. From the first genuinely non-planar corner onward it locks: every
 * later corner is snapped by projecting onto *this* plane, which is what makes the ring
 * coplanar by construction rather than by a check applied after the fact.
 *
 * Reuses `planeOfPolygon`'s Newell fit over every vertex placed so far, not just the first
 * three. That is free precision rather than an approximation: every vertex after the third is
 * already the result of projecting onto the plane the previous fit produced, so folding it back
 * into the fit only helps the plane stay well-conditioned against the mm rounding at each click,
 * and costs nothing because a genuinely coplanar point set has one normal to find regardless of
 * how many vertices the sum runs over.
 */
export function planeThroughRing(ringMm: readonly Point3Mm[]): WorkingPlane | null {
    const fit = planeOfPolygon(ringMm);
    if (!fit) return null;
    return planeFromNormal(ringMm[0]!, fit.normal, 'roof');
}

/**
 * Which world axis an engaged axis lock caught, for feedback.
 *
 * `'diagonal'` covers the 45-degree rays, which are a real lock but not a world axis.
 */
export type LockAxis = 'x' | 'y' | 'z' | 'diagonal';

/** How close to a world axis a locked direction must be to be named one. cos(1 degree). */
const AXIS_NAMING_TOLERANCE = 0.9998;

/**
 * Names the world axis a plane-local lock direction points along.
 *
 * This is the only reason `snapOnPlane` returns its lock direction: the snapping itself works
 * entirely in the plane's own 2D frame and has no idea whether a given ray is "vertical". The
 * plane does, so the translation lives here — and it is what lets the UI say *Vertical lock*
 * and paint the guide blue, which is the difference between an inference the user trusts and
 * one they merely suffer.
 */
export function lockAxisOf(plane: WorkingPlane, dirUv: Vec2Mm): LockAxis {
    return worldAxisOf(add3(scale3(plane.uDir, dirUv.x), scale3(plane.vDir, dirUv.y)));
}

/** Names the world axis a direction points along — a face normal, for push/pull's guide. */
export function worldAxisOf(dir: Dir3): LockAxis {
    const world = normalize3(dir);
    if (Math.abs(world.z) >= AXIS_NAMING_TOLERANCE) return 'z';
    if (Math.abs(world.x) >= AXIS_NAMING_TOLERANCE) return 'x';
    if (Math.abs(world.y) >= AXIS_NAMING_TOLERANCE) return 'y';
    return 'diagonal';
}

/** Model point -> the plane's own 2D coordinates. Points off the plane are projected onto it. */
export function toPlaneUv(plane: WorkingPlane, pMm: Point3Mm): Vec2Mm {
    return toFrameUv(plane, pMm);
}

/** The plane's own 2D coordinates -> model point. */
export function fromPlaneUv(plane: WorkingPlane, uv: Vec2Mm): Point3Mm {
    return fromFrameUv(plane, uv);
}

/** Perpendicular distance from a model point to the plane, mm. Signed along the normal. */
export function signedDistanceToPlane(plane: WorkingPlane, pMm: Point3Mm): number {
    return signedDistanceToFrame(plane, pMm);
}

/** Promotes a surface's own frame to a working plane, so drawing can happen *on* that surface. */
export function planeFromFrame(frame: Frame3, id: string): WorkingPlane {
    return { id, ...frame };
}

/**
 * Does every point of a ring lie in the plane?
 *
 * The snapping candidates a tool offers must be filtered through this, and forgetting to is a
 * subtle bug rather than an obvious one. `toPlaneUv` *projects*, so on the ground plane — where
 * everything is at z = 0 anyway — passing unfiltered geometry looks perfectly correct. Switch
 * to a wall's vertical plane and the entire floor collapses onto a line in that plane, offering
 * the user a row of phantom vertices to snap to that correspond to nothing they can see.
 */
export function ringLiesInPlane(
    plane: WorkingPlane,
    ringMm: readonly Point3Mm[],
    toleranceMm = 1
): boolean {
    return ringMm.every((p) => Math.abs(signedDistanceToPlane(plane, p)) <= toleranceMm);
}

/**
 * Where a pointer ray meets the working plane.
 *
 * Returns null when the ray is parallel to the plane, and also when the hit is *behind* the
 * camera (`t <= 0`) — which is the case that matters in practice: an orbit that brings the eye
 * below the ground plane would otherwise place floor points on the far side of the world.
 */
export function rayToPlane(plane: WorkingPlane, originMm: Point3Mm, dir: Dir3): Point3Mm | null {
    const denom = dot3(plane.normal, dir);
    if (Math.abs(denom) < 1e-9) return null;
    const t = dot3(plane.normal, sub3(plane.originMm, originMm)) / denom;
    if (t <= 0) return null;
    return add3(originMm, scale3(dir, t));
}
