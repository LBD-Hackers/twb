/**
 * Reads what each face *is* — floor, wall or roof — off the geometry, after the fact.
 *
 * The drawing tools never ask. A face is drawn as a face, in SketchUp's grammar, and the
 * question of what the framing recipe should make of it is answered here, from its normal
 * and its neighbours, whenever anything needs to know. That keeps the classification honest:
 * a face that was a flat roof becomes a floor the moment a storey is built on top of it,
 * without anyone having to remember to retag it.
 *
 * Three rules, applied in order, with an override on the surface winning over all of them:
 *
 *   1. **Vertical** (normal has no Z) — a wall.
 *   2. **Sloped** — a roof. Nothing else in a timber house is planar and tilted.
 *   3. **Horizontal** — a floor if it is at the lowest level of the model or if something
 *      stands on it (another face has a corner on its level and rises above it); otherwise a
 *      flat roof. The lowest-level rule is what makes a rectangle just drawn on the ground a
 *      floor rather than a roof with nothing under it.
 *
 * Pure: no three.js, no signals, so it can be unit-tested with literal rings and reused by
 * `recipe/` unchanged.
 */

import { planeOfPolygon } from '../core';
import type { Surface, SurfaceId, SurfaceKind } from './surface';

/** Below this |normal.z| a face is vertical. sin(1°). */
const VERTICAL_NORMAL_Z = 0.0175;
/** Above this |normal.z| a face is horizontal. cos(1°). */
const HORIZONTAL_NORMAL_Z = 0.9998;
/** Two levels this close are the same level, mm. */
const LEVEL_TOLERANCE_MM = 1;

export function classifySurface(surface: Surface, all: readonly Surface[]): SurfaceKind {
    if (surface.kindOverride) return surface.kindOverride;
    const plane = planeOfPolygon(surface.boundaryMm);
    // A degenerate ring has no orientation; call it a wall so it still renders as *something*
    // the user will notice and delete.
    if (!plane) return 'wall';
    const nz = Math.abs(plane.normal.z);
    if (nz < VERTICAL_NORMAL_Z) return 'wall';
    if (nz < HORIZONTAL_NORMAL_Z) return 'roof';

    const levelMm = surface.boundaryMm[0]!.z;
    let lowestMm = Infinity;
    for (const other of all) {
        for (const p of other.boundaryMm) lowestMm = Math.min(lowestMm, p.z);
    }
    if (levelMm <= lowestMm + LEVEL_TOLERANCE_MM) return 'floor';

    for (const other of all) {
        if (other.id === surface.id) continue;
        let touches = false;
        let rises = false;
        for (const p of other.boundaryMm) {
            if (Math.abs(p.z - levelMm) <= LEVEL_TOLERANCE_MM) touches = true;
            else if (p.z > levelMm + LEVEL_TOLERANCE_MM) rises = true;
        }
        if (touches && rises) return 'floor';
    }
    return 'roof';
}

/** Every surface's kind at once — the renderer's input, and the shape `recipe/` will take. */
export function classifyAll(all: readonly Surface[]): Map<SurfaceId, SurfaceKind> {
    const kinds = new Map<SurfaceId, SurfaceKind>();
    for (const s of all) kinds.set(s.id, classifySurface(s, all));
    return kinds;
}
