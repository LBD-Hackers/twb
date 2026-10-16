/**
 * The modular system. Every dimension in a floor or wall is a multiple of these numbers, and
 * this module is the only place that decides what "modular" means.
 *
 * Why 1200: it is the width of a standard OSB / plasterboard / gypsum sheet. A building set
 * out on a 1200 grid is one whose sheets land on framing members with no cutting and no
 * unsupported edges, which is the entire economic argument for a modular timber frame.
 *
 * Why 400 and 600 and nothing else: they are the only divisors of 1200 that put a sheet edge
 * on a member — 1200/600 = 2 bays, 1200/400 = 3 bays. 500 would divide 1000 but not 1200; 300
 * divides 1200 but is closer than anyone frames. So the subdivision set is not a preference,
 * it is forced by the module, and `calculateStudSpacing` returning only 400 or 600 is the same
 * fact stated from the other end.
 *
 * Roofs are deliberately exempt (see `interaction/tools/roof-tool.ts`): a roof plane is free
 * at any angle, and its *framing* is snapped to the structural spacing afterwards by the roof
 * recipe rather than its geometry being constrained during drawing.
 */

import type { Vec2Mm } from '../core';

/** Sheet width. The number the whole app is dimensioned in. */
export const MODULE_MM = 1200;

/**
 * Permitted subdivisions of the module, coarsest first.
 *
 * Order matters: `nearestModularMm` prefers the coarsest pitch that fits, so a length that is
 * a clean multiple of 600 is never reported as "a multiple of 400" by accident.
 */
export const SUBDIVISIONS_MM = [MODULE_MM, 600, 400] as const;

/** The finest pitch a drawn point may land on. Everything else is a multiple of it. */
export const FINEST_PITCH_MM = 200;

/**
 * Snap tolerance in *screen* pixels, converted to model units at the current camera distance
 * by the caller.
 *
 * A fixed model-unit tolerance cannot work: 50 mm is an invisible sliver when zoomed out to a
 * whole house and a magnet that swallows every nearby vertex when zoomed in to one stud.
 * `mep/src/interaction/snap.ts` makes the same argument and keeps the conversion in the
 * caller, so this module and its tests stay free of any camera concern.
 */
export const SNAP_TOLERANCE_PX = 12;

/** Rounds a scalar onto a fixed pitch. */
export function snapMm(valueMm: number, pitchMm: number): number {
    if (pitchMm <= 0) return Math.round(valueMm);
    return Math.round(valueMm / pitchMm) * pitchMm;
}

/** Rounds a plan point onto a fixed pitch. */
export function snapPoint2(p: Vec2Mm, pitchMm: number): Vec2Mm {
    return { x: snapMm(p.x, pitchMm), y: snapMm(p.y, pitchMm) };
}

/**
 * Is this length one the modular system permits?
 *
 * A length qualifies if it is a positive multiple of any permitted subdivision. 2400 (2
 * modules), 1800 (3 x 600) and 800 (2 x 400) all pass; 1000 and 1500 do not. Note that 1200
 * itself is a multiple of both 600 and 400, which is the point of the system rather than an
 * ambiguity.
 */
export function isModularMm(lengthMm: number): boolean {
    if (lengthMm <= 0) return false;
    return SUBDIVISIONS_MM.some((pitch) => lengthMm % pitch === 0);
}

/**
 * The nearest permitted length, preferring the coarsest subdivision.
 *
 * Ties go to the coarser pitch: a 1000 mm wall is 1200 away by 200 and 800 away by 200, and
 * rounding up to the full module is the better default in a system whose whole purpose is to
 * land on sheet edges. Never returns 0 — a length that rounds to nothing becomes the finest
 * subdivision instead, because a zero-length wall is not a useful auto-correction.
 */
export function nearestModularMm(lengthMm: number): number {
    let best = 0;
    let bestError = Infinity;
    for (const pitch of SUBDIVISIONS_MM) {
        const candidate = Math.round(lengthMm / pitch) * pitch;
        if (candidate <= 0) continue;
        const error = Math.abs(candidate - lengthMm);
        // Strictly less: SUBDIVISIONS_MM is coarsest-first, so an equal-error coarser
        // candidate already holds `best` and keeps it.
        if (error < bestError) {
            bestError = error;
            best = candidate;
        }
    }
    return best === 0 ? SUBDIVISIONS_MM[SUBDIVISIONS_MM.length - 1]! : best;
}

/**
 * Divides a span into equal bays no wider than `maxSpacingMm`, returning the interior
 * positions (not the two ends).
 *
 * Equal bays rather than "`maxSpacing`, `maxSpacing`, remainder": a carpenter sets out equal
 * spacings, the remainder strategy leaves one runt bay at the end that no sheet edge lands on,
 * and the equal version is never *less* safe because every bay it produces is <= the limit.
 * Used for floor joists between beams and for the intermediate foundation pillars.
 */
export function subdivideSpanMm(spanMm: number, maxSpacingMm: number): number[] {
    if (spanMm <= maxSpacingMm || maxSpacingMm <= 0) return [];
    const bays = Math.ceil(spanMm / maxSpacingMm);
    const positions: number[] = [];
    for (let i = 1; i < bays; i++) positions.push((spanMm * i) / bays);
    return positions;
}

/**
 * Positions along an axis at `spacingMm`, aligned to the **global** module grid rather than to
 * `fromMm`.
 *
 * Global alignment is what makes two adjacent floor surfaces produce joists on one continuous
 * grid, so a deck sheet spanning the join still lands on members. It is deliberately NOT used
 * for wall studs: a wall's sheathing starts at that wall's own corner, so `wall-recipe.ts`
 * lays its studs out from the wall's own origin instead. Getting these two the wrong way round
 * produces framing that looks right and cannot be sheeted.
 */
export function modularPositionsMm(fromMm: number, toMm: number, spacingMm: number): number[] {
    if (spacingMm <= 0 || toMm <= fromMm) return [];
    const positions: number[] = [];
    const first = Math.ceil(fromMm / spacingMm) * spacingMm;
    for (let p = first; p <= toMm; p += spacingMm) positions.push(p);
    return positions;
}
