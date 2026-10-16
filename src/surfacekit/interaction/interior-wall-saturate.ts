/**
 * Pulls one point of a house file's interior-wall run onto the storey's own walls and floor —
 * "saturating" a model's approximate plan coordinates onto the geometry they were meant to meet,
 * the same ladder a modeller's `planSnap` offers the cursor while drawing one interactively, minus
 * the cursor-only inferences (axis lock, from-point) that mean nothing for a run read whole from
 * a file.
 *
 * Grid quantisation is deliberately switched off here (`snapToGrid: false`): a point with nothing
 * nearby to snap onto is left exactly as given rather than pulled onto the nearest 1200 mm
 * position, because `snapOnPlane`'s own grid fallback only knows that one pitch, unlike
 * `model/surface-store.ts`'s later, submodule-aware `validateModularRing` (`grid/grid-validate.ts`).
 * Quantising here first would corrupt a legitimate 600 mm coordinate (say, 5400) whenever nothing
 * else was close enough to anchor it, while a neighbouring point of the same straight run that
 * *did* land on a real vertex kept its exact value — turning one wall into two different,
 * non-parallel ones. A real house file did exactly that. Letting every unanchored point through
 * untouched, and leaving the grid to the one place that already gets it right, is what keeps a
 * run straight.
 */

import type { Vec2Mm } from '../core';
import {
    floorFootprintsInStorey,
    wallFootprintsInStorey,
    type Storey,
    type Surface,
} from '../model';
import { snapOnPlane, type SnapRing } from './snap3';

/**
 * How far a house file's interior-wall point may sit from the storey's own walls and floor and
 * still be pulled onto them. Generous relative to the cursor's own snap tolerance
 * (`SNAP_TOLERANCE_PX` at screen scale): these points typically come from a model reading pixel
 * coordinates off a rendered plan rather than a mouse click, so they land close but rarely exact.
 */
export const INTERIOR_WALL_SNAP_TOLERANCE_MM = 300;

/** How far off the storey's walls and floor a point may be and already count as on them, mm. */
const ON_GEOMETRY_MM = 1;

export function saturateInteriorWallPoint(
    surfaces: readonly Surface[],
    storey: Storey,
    pointUv: Vec2Mm,
    toleranceMm: number = INTERIOR_WALL_SNAP_TOLERANCE_MM
): Vec2Mm {
    const rings: SnapRing[] = [];
    for (const w of wallFootprintsInStorey(surfaces, storey)) {
        rings.push({ pointsUv: [w.aMm, w.bMm], closed: false });
    }
    for (const f of floorFootprintsInStorey(surfaces, storey)) {
        rings.push({ pointsUv: f.ringMm, closed: true });
    }
    // A point already on a wall stays there: a corner of that wall a little way along it would
    // otherwise outrank the edge, and turn a partition meeting the wall into a slanted one.
    const exact = snapOnPlane(pointUv, { rings, toleranceMm: ON_GEOMETRY_MM, snapToGrid: false });
    if (exact.kind !== 'free') return exact.pointUv;
    return snapOnPlane(pointUv, { rings, toleranceMm, snapToGrid: false }).pointUv;
}
