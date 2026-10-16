/**
 * The inferences a line drawn in open space runs on: SketchUp's red, green and blue axes from the
 * last point, and the dotted "in line with that corner" that stops it where something else ends.
 *
 * The vertical alone (`axis-inference.ts`) was enough while a free line only ever went up from
 * the ground to find a plane to lie in. A line that is free for its whole length needs all three:
 * down a corner to the ground, along the facade, across to the next post. Each axis is a line in
 * space through the last point, caught on *screen* distance for the reason a modeller gives for the
 * vertical — the world axes do not project to screen axes — with a narrow band to catch and a wide
 * one to hold, so the lock behaves like a magnet rather than a tripwire.
 *
 * Once an axis holds, the point slides along it, and the one thing still worth snapping to is
 * where it draws level with something already there: the end of the facade, the far side of the
 * roof. That is `alignedTo` — the point on the axis at the same distance along it as an existing
 * corner, when the cursor is near it on screen. The caller draws the dotted line from that corner.
 *
 * Pure: the caller supplies the ray, the projection and the corners.
 */

import { add3, dot3, scale3, sub3, type Dir3, type Point3Mm } from '../core';
import { rayToLine } from './axis-inference';
import type { PixelPos } from './pick';

export type WorldAxis = 'x' | 'y' | 'z';

export const WORLD_AXES: Readonly<Record<WorldAxis, Dir3>> = {
    x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 },
};

export interface AxisInferenceInput {
    ray: { originMm: Point3Mm; dir: Dir3; pixel: PixelPos };
    project: (pointMm: Point3Mm) => PixelPos | null;
    /** The last placed point — every axis runs through it. */
    anchorMm: Point3Mm;
    /** Corners the point may draw level with. */
    cornersMm: readonly Point3Mm[];
    /** Screen band that catches an axis, px. */
    catchPx: number;
    /**
     * Largest angle on screen between the axis and the way the cursor lies from the anchor, deg.
     * The band alone is a wide angle close to the anchor, where a line meant to run 20° off the
     * axis is still inside it; the angle alone would never let a far cursor go. Both must hold.
     */
    catchDeg: number;
    /** How much wider the band is for the axis already held. */
    holdFactor: number;
    /** The axis held on the previous move, if any. */
    held: WorldAxis | null;
    /** Shift: the nearest axis, however far the cursor is from it. */
    force: boolean;
    /** Screen band for drawing level with a corner, px. */
    alignPx: number;
    /** How far along the axis the point must be before the axis counts, mm. */
    minAlongMm: number;
    /** Steps the distance along the axis snaps to, mm; 0 for none. */
    pitchMm: number;
}

export interface AxisInference {
    pointMm: Point3Mm;
    axis: WorldAxis;
    /** The corner the point was drawn level with, for the dotted line; null when none. */
    alignedTo: Point3Mm | null;
}

/** The point the cursor means on one of the three axes from the anchor, or null. */
export function inferAxis(input: AxisInferenceInput): AxisInference | null {
    const { ray, project, anchorMm } = input;
    const anchorPx = project(anchorMm);
    if (!anchorPx) return null;

    let best: { axis: WorldAxis; distancePx: number; alongMm: number } | null = null;
    for (const axis of ['x', 'y', 'z'] as const) {
        const dir = WORLD_AXES[axis];
        const farPx = project(add3(anchorMm, scale3(dir, 1000)));
        if (!farPx) continue;
        const distancePx = pixelDistanceToLine(ray.pixel, anchorPx, farPx);
        const hold = input.held === axis ? input.holdFactor : 1;
        const band = input.force ? Infinity : input.catchPx * hold;
        if (distancePx > band) continue;
        const reachPx = Math.hypot(ray.pixel.x - anchorPx.x, ray.pixel.y - anchorPx.y);
        const maxDeg = input.force ? 90 : Math.min(input.catchDeg * hold, 45);
        if (reachPx > 0 && distancePx / reachPx > Math.sin((maxDeg * Math.PI) / 180)) continue;
        const hit = rayToLine(ray.originMm, ray.dir, anchorMm, dir);
        if (!hit) continue;
        const alongMm = dot3(sub3(hit.pointMm, anchorMm), dir);
        // The guard that lets the line leave the anchor at all: every axis passes through it,
        // so near the anchor every axis is "near" the cursor.
        if (Math.abs(alongMm) <= input.minAlongMm) continue;
        if (!best || distancePx < best.distancePx) best = { axis, distancePx, alongMm };
    }
    if (!best) return null;
    const dir = WORLD_AXES[best.axis];

    // Level with an existing corner beats the grid: it is the length the user is aiming for.
    let aligned: { pointMm: Point3Mm; cornerMm: Point3Mm; distancePx: number } | null = null;
    for (const corner of input.cornersMm) {
        const alongMm = dot3(sub3(corner, anchorMm), dir);
        if (Math.abs(alongMm) <= input.minAlongMm) continue;
        const pointMm = add3(anchorMm, scale3(dir, alongMm));
        const px = project(pointMm);
        if (!px) continue;
        const distancePx = Math.hypot(px.x - ray.pixel.x, px.y - ray.pixel.y);
        if (distancePx > input.alignPx) continue;
        if (!aligned || distancePx < aligned.distancePx) {
            aligned = { pointMm, cornerMm: corner, distancePx };
        }
    }
    if (aligned) {
        return { pointMm: roundMm(aligned.pointMm), axis: best.axis, alignedTo: aligned.cornerMm };
    }

    const alongMm =
        input.pitchMm > 0 ? Math.round(best.alongMm / input.pitchMm) * input.pitchMm : best.alongMm;
    if (alongMm === 0) return null;
    return {
        pointMm: roundMm(add3(anchorMm, scale3(dir, alongMm))),
        axis: best.axis,
        alignedTo: null,
    };
}

/**
 * The point on a face edge or a line nearest the cursor, when the cursor is on it on screen —
 * how a free line lands part-way along an edge rather than only at its ends and middle.
 */
export function nearestOnSegments(
    segments: readonly (readonly [Point3Mm, Point3Mm])[],
    ray: { originMm: Point3Mm; dir: Dir3; pixel: PixelPos },
    project: (pointMm: Point3Mm) => PixelPos | null,
    tolerancePx: number,
    pitchMm: number
): Point3Mm | null {
    let best: { pointMm: Point3Mm; distancePx: number } | null = null;
    for (const [a, b] of segments) {
        const pa = project(a);
        const pb = project(b);
        if (!pa || !pb) continue;
        if (pixelDistanceToSegment(ray.pixel, pa, pb) > tolerancePx) continue;
        const d = sub3(b, a);
        const lengthMm = Math.hypot(d.x, d.y, d.z);
        if (lengthMm < 1) continue;
        const dir = scale3(d, 1 / lengthMm);
        const hit = rayToLine(ray.originMm, ray.dir, a, dir);
        if (!hit) continue;
        let t = dot3(sub3(hit.pointMm, a), dir);
        if (pitchMm > 0) t = Math.round(t / pitchMm) * pitchMm;
        t = Math.max(0, Math.min(lengthMm, t));
        const pointMm = add3(a, scale3(dir, t));
        const px = project(pointMm);
        if (!px) continue;
        const distancePx = Math.hypot(px.x - ray.pixel.x, px.y - ray.pixel.y);
        if (!best || distancePx < best.distancePx) best = { pointMm, distancePx };
    }
    return best ? roundMm(best.pointMm) : null;
}

export function pixelDistanceToLine(p: PixelPos, a: PixelPos, b: PixelPos): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // The axis is end-on to the camera: it projects to a point, so nothing is "along" it.
    if (len < 1e-6) return Infinity;
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function pixelDistanceToSegment(p: PixelPos, a: PixelPos, b: PixelPos): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const roundMm = (p: Point3Mm): Point3Mm => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
    z: Math.round(p.z),
});
