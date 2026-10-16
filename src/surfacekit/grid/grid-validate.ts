/**
 * Validates drawn geometry against the modular system, and auto-corrects it.
 *
 * The brief asks to "reject or auto-correct" non-modular geometry. The correction rule that
 * actually works is **snap the vertices, not the edges**, and it took a failing test to find
 * that out. Correcting edge *lengths* cumulatively — walk the ring, stretch each edge to a
 * modular length — cannot close a ring: stretching edge `i` moves vertex `i`, which changes
 * edge `i+1`'s direction as well as its length, and a rectangle drifts open by the time the
 * walk comes back round. Snapping each vertex **independently** has no such coupling, so a
 * rectangle stays a rectangle and a ring stays closed.
 *
 * It is also sufficient, which is the part worth understanding: if every vertex coordinate is
 * a multiple of a permitted subdivision, then every axis-aligned edge length is a difference
 * of two such multiples and so is modular by construction. That is why the drawing tools snap
 * points to the grid rather than measuring lengths as you draw — the lengths take care of
 * themselves.
 *
 * A diagonal edge between two grid points is the one thing that is *not* modular and cannot
 * be: (0,0) to (1200,1200) is 1697 mm, and no grid can change that. Diagonals are therefore
 * accepted with their real length, and it is the framing inside them — laid out at 400/600
 * along the wall's own axis by `wall-recipe.ts` — that stays modular. Rejecting diagonals
 * would mean rejecting every angled wall in the system.
 *
 * Returns violations rather than throwing, following the rejection-over-exception rule in
 * `mep/src/zones/zone-store.ts`: a rejected commit leaves the tool armed and puts a message in
 * the status bar, so the user simply clicks again.
 */

import type { Point3Mm } from '../core';
import { distance3 } from '../core';
import { isModularMm, SUBDIVISIONS_MM } from './module-grid';

/** Minimum edge length worth keeping, in mm. Below this it is a stray double click. */
export const MIN_EDGE_LENGTH_MM = 50;

/**
 * How far a coordinate can ever be from the nearest modular position.
 *
 * Half the finest subdivision — because the multiples of 400 alone are spaced 400 apart, so no
 * coordinate is ever further than 200 mm from one. Stated as a constant because it is the
 * reason coordinate correction can never fail, which is not obvious.
 */
export const MAX_COORDINATE_CORRECTION_MM = SUBDIVISIONS_MM[SUBDIVISIONS_MM.length - 1]! / 2;

/**
 * Shared vocabulary for rejecting a commit, not only a modular-grid one — `model/surface-store.ts`
 * constructs `Violation`s of its own (`degenerate-edge`, `non-planar`, `outside-face`) directly,
 * for the same rejection-over-exception reason this module returns them rather than throwing: a
 * rejected commit leaves the drawing tool armed.
 */
export type ViolationCode =
    | 'too-few-vertices'
    | 'degenerate-edge'
    | 'collapsed-vertex'
    | 'non-modular-edge'
    | 'non-planar'
    /** An opening that is not inside the face it was drawn on — so it is a face of its own. */
    | 'outside-face'
    /** A face with the outline of one already there — re-drawing an edge is not a second face. */
    | 'duplicate-face'
    /** A face outside the part of the model being edited — the house under roof mode's draft. */
    | 'locked-face';

export interface Violation {
    code: ViolationCode;
    message: string;
    /** Index of the offending edge or vertex, so the UI can highlight it. */
    index: number;
}

export interface ValidationResult {
    ok: boolean;
    violations: readonly Violation[];
    /** The snapped ring. Non-null whenever `ok` is true. */
    correctedMm: readonly Point3Mm[] | null;
    /** Largest distance any vertex moved, mm — so the UI can report what it changed. */
    maxCorrectionMm: number;
}

/**
 * The nearest modular position for a single coordinate, preferring the coarsest subdivision.
 *
 * Unlike `nearestModularMm`, which measures a *length* and so is positive and non-zero, a
 * coordinate may be zero or negative. Negatives are handled by symmetry so the grid is the
 * same on both sides of the origin — which matters because a building drawn across the origin
 * would otherwise have two different grids.
 */
export function nearestModularCoordinateMm(valueMm: number): number {
    const sign = valueMm < 0 ? -1 : 1;
    const magnitude = Math.abs(valueMm);
    let best = 0;
    let bestError = Infinity;
    for (const pitch of SUBDIVISIONS_MM) {
        const candidate = Math.round(magnitude / pitch) * pitch;
        const error = Math.abs(candidate - magnitude);
        // Strictly less: SUBDIVISIONS_MM is coarsest-first, so on a tie the coarser candidate
        // already holds `best` and keeps it.
        if (error < bestError) {
            bestError = error;
            best = candidate;
        }
    }
    return sign * best;
}

/**
 * Snaps a point's plan coordinates independently onto the modular grid. **Z is left alone.**
 *
 * The modular system is a system of sheet widths and stud spacings, and both are laid out in
 * plan: a 1200 module is the width of a board standing against a wall, not its height. So the
 * grid constrains x and y and nothing else — a 2700 storey, a ridge lifted to whatever pitch
 * the eaves and the span give, a window head at 2100 are all free — which is the one constraint
 * the brief actually states: geometry "needs to fit to the grid in plan".
 */
export function snapVertexToModuleInPlan(p: Point3Mm): Point3Mm {
    return {
        x: nearestModularCoordinateMm(p.x),
        y: nearestModularCoordinateMm(p.y),
        z: p.z,
    };
}

export interface ValidationOptions {
    /**
     * Whether to correct the ring onto the modular grid. Defaults to true.
     *
     * False keeps only the structural checks — too few corners, corners on top of each other.
     * This is the commit half of the snapping toggle, and it is not optional: snapping the
     * *cursor* freely while the store still auto-corrects every committed vertex produces a
     * tool that visibly ignores the user, which is worse than having no toggle at all.
     */
    enforceModule?: boolean;
}

/**
 * Validates and corrects a closed boundary ring — any face, whatever it turns out to be.
 *
 * Only the plan coordinates are corrected (see `snapVertexToModuleInPlan`), so a sloped roof
 * plane and a wall of any height pass through here on the same terms as a floor: their
 * corners land on the grid seen from above, and their heights are whatever was drawn.
 */
export function validateModularRing(
    ringMm: readonly Point3Mm[],
    options: ValidationOptions = {}
): ValidationResult {
    const enforceModule = options.enforceModule !== false;
    if (ringMm.length < 3) {
        return {
            ok: false,
            violations: [
                {
                    code: 'too-few-vertices',
                    message: `A boundary needs at least 3 corners; got ${ringMm.length}.`,
                    index: 0,
                },
            ],
            correctedMm: null,
            maxCorrectionMm: 0,
        };
    }

    const violations: Violation[] = [];
    const corrected: Point3Mm[] = [];
    let maxCorrectionMm = 0;

    for (const p of ringMm) {
        const snapped = enforceModule ? snapVertexToModuleInPlan(p) : p;
        maxCorrectionMm = Math.max(maxCorrectionMm, distance3(p, snapped));
        corrected.push(snapped);
    }

    for (let i = 0; i < corrected.length; i++) {
        const a = corrected[i]!;
        const b = corrected[(i + 1) % corrected.length]!;
        const lengthMm = distance3(a, b);

        if (lengthMm < MIN_EDGE_LENGTH_MM) {
            // Two vertices landed on the same grid position. This is the real failure mode of
            // snapping — a corner drawn finer than the grid can express — and the only one
            // that cannot be corrected, since merging the vertices would change the shape.
            violations.push({
                code: lengthMm === 0 ? 'collapsed-vertex' : 'degenerate-edge',
                message:
                    `Corners ${i} and ${(i + 1) % corrected.length} are closer than the grid ` +
                    `can express. Move them at least ${SUBDIVISIONS_MM[SUBDIVISIONS_MM.length - 1]} mm apart.`,
                index: i,
            });
            continue;
        }

        // A horizontal, axis-aligned edge between two modular coordinates is modular by
        // construction, so this is a guard against that invariant breaking, not an expected
        // user error. A diagonal is exempt: no grid can make hypot(1200, 1200) modular. So is
        // a vertical edge, whose length is a height and not a plan dimension at all. With the
        // module not enforced there is no invariant to guard, and the check would fire on
        // every edge.
        if (!enforceModule) continue;
        const axisAligned = (a.x === b.x && a.z === b.z) || (a.y === b.y && a.z === b.z);
        if (axisAligned && !isModularMm(Math.round(lengthMm))) {
            violations.push({
                code: 'non-modular-edge',
                message:
                    `Edge ${i} is ${Math.round(lengthMm)} mm — not a multiple of ` +
                    `${SUBDIVISIONS_MM.join(', ')} mm.`,
                index: i,
            });
        }
    }

    return {
        ok: violations.length === 0,
        violations,
        correctedMm: violations.length === 0 ? corrected : null,
        maxCorrectionMm,
    };
}
