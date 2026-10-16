/**
 * Picking an edge or a vertex of an existing face under the cursor — the move tool's first
 * click.
 *
 * Done in **screen space**, against the projected positions, rather than by ray-to-line
 * distance in the model. A vertex is a point the user aims at by eye, and a world tolerance
 * around it is the wrong shape: it is a sphere that projects to a large disc up close and a
 * speck far away, so the same gesture picks a corner in one part of the model and misses it in
 * another. A modeller's vertical inference makes the same choice for the same reason, and the
 * same failure taught it.
 *
 * Pure: the caller supplies the projection, so this is testable with a fake camera and the
 * rest of the module never sees three.js.
 */

import type { Point3Mm } from '../core';
import type { Guide, GuideId, Surface, SurfaceId } from '../model';

/** A position in CSS pixels, relative to the canvas's top-left corner. */
export interface PixelPos {
    x: number;
    y: number;
}

export type Pick =
    | { kind: 'vertex'; surfaceId: SurfaceId; pointMm: Point3Mm }
    | { kind: 'edge'; surfaceId: SurfaceId; aMm: Point3Mm; bMm: Point3Mm };

/** The pick's anchor for an inference to hang from: the vertex, or an edge's midpoint. */
export function pickAnchor(pick: Pick): Point3Mm {
    if (pick.kind === 'vertex') return pick.pointMm;
    return {
        x: (pick.aMm.x + pick.bMm.x) / 2,
        y: (pick.aMm.y + pick.bMm.y) / 2,
        z: (pick.aMm.z + pick.bMm.z) / 2,
    };
}

/** Every model position the pick stands for — what `moveVertices` is handed. */
export function pickPositions(pick: Pick): readonly Point3Mm[] {
    return pick.kind === 'vertex' ? [pick.pointMm] : [pick.aMm, pick.bMm];
}

/**
 * The vertex under the cursor, or failing that the edge, or null.
 *
 * Vertices win over edges outright when both are in tolerance — an edge's nearest point is by
 * construction never farther than its own endpoints, so without the tiering a corner would
 * be unreachable. Same rule as `snap3.ts`'s ladder.
 */
export function pickEdgeOrVertex(
    surfaces: readonly Surface[],
    pixel: PixelPos,
    project: (pointMm: Point3Mm) => PixelPos | null,
    tolerancePx: number
): Pick | null {
    let bestVertex: { pick: Pick; distancePx: number } | null = null;
    let bestEdge: { pick: Pick; distancePx: number } | null = null;

    for (const surface of surfaces) {
        const ring = surface.boundaryMm;
        const projected = ring.map(project);
        for (let i = 0; i < ring.length; i++) {
            const a = projected[i];
            if (!a) continue;
            const dv = Math.hypot(pixel.x - a.x, pixel.y - a.y);
            if (dv <= tolerancePx && (!bestVertex || dv < bestVertex.distancePx)) {
                bestVertex = {
                    pick: { kind: 'vertex', surfaceId: surface.id, pointMm: ring[i]! },
                    distancePx: dv,
                };
            }
            const j = (i + 1) % ring.length;
            const b = projected[j];
            if (!b) continue;
            const de = pixelDistanceToSegment(pixel, a, b);
            if (de <= tolerancePx && (!bestEdge || de < bestEdge.distancePx)) {
                bestEdge = {
                    pick: { kind: 'edge', surfaceId: surface.id, aMm: ring[i]!, bMm: ring[j]! },
                    distancePx: de,
                };
            }
        }
    }
    return bestVertex?.pick ?? bestEdge?.pick ?? null;
}

/**
 * The face edge under the cursor, or null — what a right click on a line of the model is about
 * when that line is not a guide. Corners are not tiered above edges here, unlike
 * `pickEdgeOrVertex`: an edge is being named, and the corner at its end is a part of it.
 */
export function pickFaceEdge(
    surfaces: readonly Surface[],
    pixel: PixelPos,
    project: (pointMm: Point3Mm) => PixelPos | null,
    tolerancePx: number
): { aMm: Point3Mm; bMm: Point3Mm } | null {
    let best: { aMm: Point3Mm; bMm: Point3Mm; distancePx: number } | null = null;
    for (const surface of surfaces) {
        const ring = surface.boundaryMm;
        const projected = ring.map(project);
        for (let i = 0; i < ring.length; i++) {
            const j = (i + 1) % ring.length;
            const a = projected[i];
            const b = projected[j];
            if (!a || !b) continue;
            const distancePx = pixelDistanceToSegment(pixel, a, b);
            if (distancePx <= tolerancePx && (!best || distancePx < best.distancePx)) {
                best = { aMm: ring[i]!, bMm: ring[j]!, distancePx };
            }
        }
    }
    return best ? { aMm: best.aMm, bMm: best.bMm } : null;
}

/**
 * The line under the cursor, or null — the Select tool's second target after the faces.
 *
 * A line has no interior to hit, so unlike a face it cannot be picked by the renderer's own
 * raycast against solid geometry; it is the same screen-space test as `pickEdgeOrVertex`, with
 * the nearest line winning. Separate from that function rather than folded into it because the
 * two answer different questions: that one asks "which corner am I grabbing", this one asks
 * "which line am I talking about", and the move tool must not start dragging a pergola post
 * because it passed near one.
 */
export function pickGuide(
    guides: readonly Guide[],
    pixel: PixelPos,
    project: (pointMm: Point3Mm) => PixelPos | null,
    tolerancePx: number
): GuideId | null {
    let best: { id: GuideId; distancePx: number } | null = null;
    for (const guide of guides) {
        const a = project(guide.aMm);
        const b = project(guide.bMm);
        if (!a || !b) continue;
        const distancePx = pixelDistanceToSegment(pixel, a, b);
        if (distancePx <= tolerancePx && (!best || distancePx < best.distancePx)) {
            best = { id: guide.id, distancePx };
        }
    }
    return best?.id ?? null;
}

function pixelDistanceToSegment(p: PixelPos, a: PixelPos, b: PixelPos): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
