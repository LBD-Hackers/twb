/**
 * A surface's own 2D frame: where its holes are measured from, and the plane a rectangle
 * drawn *on* it lands in.
 *
 * The frame is canonical — a function of the boundary alone, with no dependence on winding
 * direction or on which corner happened to be drawn first — because two things rely on
 * reading the same numbers back later. A hole's `uMm`/`vMm` must still mean the same place
 * after the surface has been split or one of its edges moved, and the framing recipes read
 * "sill at 900 above the base" literally. So:
 *
 *   - **A vertical face** (a wall): `vDir` is exactly world up, `uDir` runs horizontally along
 *     the face towards +X (or +Y for a face along Y) whatever the winding, and the normal
 *     follows from that. A `v` coordinate is a height above the base.
 *   - **A horizontal face** (a floor, a flat roof): world X and Y, so a hole's UV *is* its plan.
 *   - **A sloped face** (a roof plane): `uDir` horizontal along the eave, `vDir` up the slope.
 *
 * In every case the origin is the corner of the boundary's UV bounding box, which is the one
 * point on the plane that does not move when a vertex elsewhere on the ring is edited.
 */

import {
    add3,
    cross3,
    fromFrameUv,
    normalize3,
    planeOfPolygon,
    pointInOrOnPolygon2,
    scale3,
    toFrameUv,
    type Dir3,
    type Frame3,
    type Point3Mm,
    type Vec2Mm,
} from '../core';
import type { Surface, SurfaceOpening } from './surface';

/** An opening's rectangle alone — what a ring measures; what fills it is the caller's. */
export type OpeningGeometry = Pick<SurfaceOpening, 'id' | 'uMm' | 'vMm' | 'widthMm' | 'heightMm'>;

/** A face is vertical when its normal has this little Z. sin(1°) — well inside integer-mm noise. */
const VERTICAL_NORMAL_Z = 0.0175;

const UP: Dir3 = { x: 0, y: 0, z: 1 };

/** The frame of a boundary ring, or null when the ring has no plane (degenerate). */
export function surfaceFrame(boundaryMm: readonly Point3Mm[]): Frame3 | null {
    const plane = planeOfPolygon(boundaryMm);
    if (!plane) return null;
    let normal = plane.normal;

    let uDir: Dir3;
    let vDir: Dir3;
    if (Math.abs(normal.z) < VERTICAL_NORMAL_Z) {
        // `planeOfPolygon` only fixes the sign of Z, which a vertical face has none of, so its
        // normal still carries the winding. The u axis is fixed instead — to run with +X, or
        // with +Y for a face along Y — and the normal follows from it, so a hole's `uMm` is
        // measured from the same end of a wall however that wall was drawn.
        vDir = UP;
        uDir = normalize3(cross3(vDir, { x: normal.x, y: normal.y, z: 0 }));
        if (uDir.x < 0 || (uDir.x === 0 && uDir.y < 0)) uDir = scale3(uDir, -1);
        normal = cross3(uDir, vDir);
    } else {
        // Horizontal or sloped: the eave direction is what is left of X once the slope is
        // taken out, so a flat face gets exactly world X and Y.
        uDir = normalize3(cross3(UP, normal));
        if (uDir.x === 0 && uDir.y === 0 && uDir.z === 0) uDir = { x: 1, y: 0, z: 0 };
        vDir = normalize3(cross3(normal, uDir));
    }

    const seed: Frame3 = { originMm: boundaryMm[0]!, uDir, vDir, normal };
    let uMin = Infinity;
    let vMin = Infinity;
    for (const p of boundaryMm) {
        const uv = toFrameUv(seed, p);
        uMin = Math.min(uMin, uv.x);
        vMin = Math.min(vMin, uv.y);
    }
    return { ...seed, originMm: fromFrameUv(seed, { x: uMin, y: vMin }) };
}

/** A hole's four corners in model space, in the surface frame's winding. */
export function openingRing3(frame: Frame3, hole: OpeningGeometry): Point3Mm[] {
    const corners: Vec2Mm[] = [
        { x: hole.uMm, y: hole.vMm },
        { x: hole.uMm + hole.widthMm, y: hole.vMm },
        { x: hole.uMm + hole.widthMm, y: hole.vMm + hole.heightMm },
        { x: hole.uMm, y: hole.vMm + hole.heightMm },
    ];
    return corners.map((uv) => fromFrameUv(frame, uv));
}

/**
 * A hole from a rectangle drawn in model space, or null when the ring is not an axis-aligned
 * rectangle in this frame.
 *
 * A window is a rectangle by definition here — that is what the opening recipe frames — and
 * checking it in UV rather than trusting the caller is what keeps a rectangle drawn on one
 * face from being stored on a frame it does not fit.
 */
export function openingFromRing3(
    frame: Frame3,
    ringMm: readonly Point3Mm[],
    id: string,
    toleranceMm = 1
): OpeningGeometry | null {
    if (ringMm.length !== 4) return null;
    const uv = ringMm.map((p) => toFrameUv(frame, p));
    const uMin = Math.min(...uv.map((q) => q.x));
    const uMax = Math.max(...uv.map((q) => q.x));
    const vMin = Math.min(...uv.map((q) => q.y));
    const vMax = Math.max(...uv.map((q) => q.y));
    // Every corner must sit on the bounding box's corners for the ring to be that box.
    const onCorner = uv.every(
        (q) =>
            (Math.abs(q.x - uMin) <= toleranceMm || Math.abs(q.x - uMax) <= toleranceMm) &&
            (Math.abs(q.y - vMin) <= toleranceMm || Math.abs(q.y - vMax) <= toleranceMm)
    );
    if (!onCorner) return null;
    const widthMm = Math.round(uMax - uMin);
    const heightMm = Math.round(vMax - vMin);
    if (widthMm <= 0 || heightMm <= 0) return null;
    return { id, uMm: Math.round(uMin), vMm: Math.round(vMin), widthMm, heightMm };
}

/**
 * The face's openings re-measured in a reshaped ring's frame, which may have a new origin — the
 * frame's origin is the boundary's min-u corner, so moving that end of a wall would otherwise
 * drag every opening on it along. Each opening keeps its model-space position, shifted by
 * `shiftMm` when the whole face was moved with it. Null when one of them no longer fits.
 */
export function remapOpenings(
    surface: Surface,
    ringMm: readonly Point3Mm[],
    shiftMm: Point3Mm | null
): SurfaceOpening[] | null {
    if (surface.openings.length === 0) return [];
    const oldFrame = surfaceFrame(surface.boundaryMm);
    const newFrame = surfaceFrame(ringMm);
    if (!oldFrame || !newFrame) return null;
    const boundaryUv = ringMm.map((pt) => toFrameUv(newFrame, pt));
    const openings: SurfaceOpening[] = [];
    for (const hole of surface.openings) {
        let corners = openingRing3(oldFrame, hole);
        if (shiftMm) corners = corners.map((pt) => add3(pt, shiftMm));
        const remapped = openingFromRing3(newFrame, corners, hole.id);
        if (!remapped) return null;
        const inside = openingRing3(newFrame, remapped).every((pt) =>
            pointInOrOnPolygon2(toFrameUv(newFrame, pt), boundaryUv)
        );
        if (!inside) return null;
        openings.push({ ...hole, ...remapped });
    }
    return openings;
}
