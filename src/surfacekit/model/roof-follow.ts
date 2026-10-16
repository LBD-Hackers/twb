/**
 * Keeping the walls that were built to the roof on the roof when the roof moves.
 *
 * **The problem is that topology here is by coincidence.** Two faces move together because they
 * have a corner at the same position and for no other reason (`surface-ops.ts`'s header), which
 * is exactly right for the faces a roof edit is *about*: lift a ridge and both roof planes and
 * both gables follow, because the ridge is a corner of all four. An interior wall under that
 * ridge has a corner on the ridge *line* but not at either of its ends, so nothing matches and
 * the wall is left standing at the old height with the roof somewhere above or through it.
 *
 * The rule this applies is the one the wall was built with in the first place: its top edge
 * follows `roofTopProfile`, so a top vertex that was *exactly* on the roof before the edit
 * belongs exactly on the roof after it. Every such vertex is re-asked the same question —
 * "how high is the roof over this plan position" — of the model the edit is about to produce.
 *
 * That leaves nothing to store. A wall does not carry a "follows the roof" flag; whether it was
 * following is read off the geometry, the same way a face's kind and a roof's pitch are. A wall
 * whose top was never on the roof — one that stops at a nominal ceiling, or stands outside the
 * roof's footprint — is not on it before the edit either, and is left alone.
 *
 * Pure: surfaces and moves in, more moves out. The caller commits the two lists as one edit, so
 * the roof and the walls under it arrive in the same version of the model.
 */

import type { Point3Mm } from '../core';
import { classifyAll } from './classify';
import { roofHeightAbove } from './roof-height';
import type { Surface } from './surface';
import { moveRingVerticesTo, samePoint, type VertexMove } from './surface-ops';

/**
 * How close a wall's top corner has to be to the roof to count as having been built to it, mm.
 *
 * Tight, not loose. Every point `roofTopProfile` produces is the roof's own height at that plan
 * position, computed rather than sampled onto a grid, so a wall that follows the roof sits on it
 * to within float noise and integer rounding. A generous tolerance here would not catch more real
 * cases; it would only start dragging walls that merely happen to end near the eave.
 */
const ON_ROOF_TOLERANCE_MM = 5;

/** Below this the refit would move a corner by less than the model's own precision, mm. */
const WORTH_MOVING_MM = 1;

/**
 * The extra moves that keep wall tops on the roof when `roofMoves` is applied to `surfaces`.
 *
 * Positions already in `roofMoves` are skipped — they are being moved as corners of the roof
 * itself, and an answer computed from the post-edit model would only restate it. The caller
 * commits `[...roofMoves, ...roofFollowMoves(...)]` in one `moveVerticesTo`, which is also why
 * the order matters: a ring vertex takes the first move that matches it.
 */
export function roofFollowMoves(
    surfaces: readonly Surface[],
    roofMoves: readonly VertexMove[]
): readonly VertexMove[] {
    if (roofMoves.length === 0) return [];
    const after = surfaces.map((s) => ({
        ...s,
        boundaryMm: moveRingVerticesTo(s.boundaryMm, roofMoves).ring,
    }));

    const kinds = classifyAll(surfaces);
    const moves: VertexMove[] = [];
    const seen: Point3Mm[] = [];

    for (const wall of surfaces) {
        if (kinds.get(wall.id) !== 'wall') continue;
        let baseMm = Infinity;
        for (const p of wall.boundaryMm) baseMm = Math.min(baseMm, p.z);

        for (const p of wall.boundaryMm) {
            // Only the top of a wall is ever built to a roof; its base is the storey's.
            if (p.z <= baseMm + ON_ROOF_TOLERANCE_MM) continue;
            if (roofMoves.some((m) => samePoint(p, m.fromMm))) continue;
            if (seen.some((q) => samePoint(p, q))) continue;

            const wasMm = roofHeightAbove(surfaces, p.x, p.y, baseMm);
            if (wasMm === null || Math.abs(wasMm - p.z) > ON_ROOF_TOLERANCE_MM) continue;
            const nowMm = roofHeightAbove(after, p.x, p.y, baseMm);
            if (nowMm === null || Math.abs(nowMm - p.z) < WORTH_MOVING_MM) continue;

            seen.push(p);
            moves.push({ fromMm: p, toMm: { x: p.x, y: p.y, z: Math.round(nowMm) } });
        }
    }
    return moves;
}
