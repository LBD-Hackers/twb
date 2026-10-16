/**
 * Snapping a pointer ray onto a line in space, rather than onto the working plane.
 *
 * Why this exists at all. `snap3.ts` locks to axes in the *working plane's own* frame, which
 * gives world X and Y for free on the ground and world Z for free on a wall's vertical plane.
 * That looked like it covered all three axes, and it does not cover the case that matters: you
 * cannot get onto a vertical plane until you have drawn a line in plan to define one, so from
 * the moment a free line's first corner is placed until the second, the ground plane owns the
 * cursor absolutely. Moving the mouse up then slides the point away across the ground — the
 * exact opposite of drawing a vertical line, and the reason a plane-only inference feels
 * broken.
 *
 * So the vertical is inferred as a **line in space through the last placed point**, tested
 * against the pointer ray directly and overriding the plane hit when it engages. That is what
 * SketchUp's blue-axis inference is, and it needs no plane to exist first. Push/Pull reads its
 * distance off the same primitive along a face's normal, and Move its rise along the vertical:
 * one free number each, and no plane could supply either.
 *
 * The same problem shows up again for a free-drawn roof plane, one level worse: a corner needs
 * to catch an existing 3D point — a wall's top corner, most often — that is not merely off the
 * *current* plane but was never meant to define one. `ringLiesInPlane`'s filter is right for
 * edges and midpoints, which only mean anything projected flat, and wrong for a vertex, which is
 * a real point in space whether or not it happens to lie on whatever plane the roof is currently
 * using. `rayToPoint` below is the same trick as `rayToLine`, aimed at a point instead of a
 * line, so that snap can be offered *alongside* the in-plane ladder rather than filtered into it.
 *
 * Pure geometry, no three.js: the caller supplies the ray in model coordinates and a tolerance
 * already converted from screen pixels, exactly as `snap3.ts` takes its tolerance.
 */

import { add3, distance3, dot3, scale3, sub3, type Dir3, type Point3Mm } from '../core';

/** The vertical, as a direction. The one axis no working plane can supply on its own. */
export const UP: Dir3 = { x: 0, y: 0, z: 1 };

export interface RayLineHit {
    /** The point on the *line* nearest the ray — the snapped position. */
    pointMm: Point3Mm;
    /** How far the ray passes from the line, mm. Compare against a screen-derived tolerance. */
    distanceMm: number;
}

/**
 * The point on an infinite line nearest to a ray, and how close the two pass.
 *
 * Both directions must be unit vectors. Returns null when they are parallel (no unique nearest
 * point) or when the nearest approach is behind the eye — the same `t > 0` rejection
 * `rayToPlane` makes, and for the same reason: an orbit that puts the camera below a point
 * would otherwise snap to the line on the far side of the viewer.
 */
export function rayToLine(
    originMm: Point3Mm,
    dir: Dir3,
    anchorMm: Point3Mm,
    lineDir: Dir3
): RayLineHit | null {
    const w0 = sub3(originMm, anchorMm);
    const b = dot3(dir, lineDir);
    const denom = 1 - b * b;
    // Parallel within a millidegree or so: the "nearest point" is the whole line.
    if (Math.abs(denom) < 1e-9) return null;

    const d = dot3(dir, w0);
    const e = dot3(lineDir, w0);
    const t = (b * e - d) / denom;
    if (t <= 0) return null;

    const s = (e - b * d) / denom;
    const onLine = add3(anchorMm, scale3(lineDir, s));
    const onRay = add3(originMm, scale3(dir, t));
    return { pointMm: onLine, distanceMm: distance3(onLine, onRay) };
}

export interface RayPointHit {
    /** How far the ray passes from the point, mm. Compare against a screen-derived tolerance. */
    distanceMm: number;
}

/**
 * How closely a ray passes a fixed 3D point, for catching a vertex that is not on any plane the
 * caller currently has — a free-drawn line reaching for an existing wall's top corner.
 *
 * `dir` must be a unit vector. Returns null when the point's nearest approach is behind the eye,
 * the same `t <= 0` rejection `rayToLine` and `rayToPlane` make, so an orbit that puts the
 * camera past a point cannot snap to it on the wrong side.
 */
export function rayToPoint(originMm: Point3Mm, dir: Dir3, pointMm: Point3Mm): RayPointHit | null {
    const w = sub3(pointMm, originMm);
    const t = dot3(w, dir);
    if (t <= 0) return null;
    const onRay = add3(originMm, scale3(dir, t));
    return { distanceMm: distance3(onRay, pointMm) };
}
