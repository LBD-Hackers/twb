/**
 * Which face a line runs straight across — a chord from one of its edges to another, through
 * its inside, without being one of its edges.
 *
 * The case this exists for: an interior wall on the top storey stands up to the ceiling, so its
 * top edge lies in the flat top face, running from one side of it to the other. On screen it is
 * a line across that face, and it looks exactly like a ridge drawn there. Lifting it should lift
 * a ridge: the top face has to be split along it first, or only the wall rises and punches up
 * through a roof that stays flat. `surface-store.ts`'s `split` does the splitting; this finds the
 * face to split.
 */

import {
    distanceToRing2,
    pointInPolygon2,
    signedDistanceToFrame,
    toFrameUv,
} from '../core';
import type { Point3Mm } from '../core';
import type { Surface, SurfaceId } from './surface';
import { surfaceFrame } from './surface-frame';
import { COINCIDENT_MM } from './surface-ops';

/**
 * The face the segment `a`–`b` crosses as a chord, or null: both ends on the face's boundary,
 * the whole segment in its plane, its midpoint strictly inside, and not already one of its
 * edges. With several such faces (a floor and a ceiling cannot both hold one line, so this is
 * rare), the first in model order.
 */
export function faceSpannedBy(
    surfaces: readonly Surface[],
    aMm: Point3Mm,
    bMm: Point3Mm
): SurfaceId | null {
    const mid: Point3Mm = {
        x: (aMm.x + bMm.x) / 2,
        y: (aMm.y + bMm.y) / 2,
        z: (aMm.z + bMm.z) / 2,
    };
    for (const s of surfaces) {
        const frame = surfaceFrame(s.boundaryMm);
        if (!frame) continue;
        if ([aMm, bMm].some((p) => Math.abs(signedDistanceToFrame(frame, p)) > COINCIDENT_MM)) {
            continue;
        }
        const ring = s.boundaryMm.map((p) => toFrameUv(frame, p));
        const a = toFrameUv(frame, aMm);
        const b = toFrameUv(frame, bMm);
        const m = toFrameUv(frame, mid);
        if (distanceToRing2(a, ring) > COINCIDENT_MM || distanceToRing2(b, ring) > COINCIDENT_MM) {
            continue;
        }
        // Along an edge the midpoint is on the boundary too; a chord's is well inside.
        if (distanceToRing2(m, ring) <= COINCIDENT_MM || !pointInPolygon2(m, ring)) continue;
        return s.id;
    }
    return null;
}
