/**
 * A guide: a line that is not (yet) the side of any face — and, once given a `role`, the one
 * piece of timber that is authored rather than derived.
 *
 * SketchUp lets you draw a bare edge anywhere and forms a face the moment edges close a loop.
 * `Surface` cannot express a bare edge — it is a polygon or nothing — so the loose lines the
 * Line tool leaves behind live here instead, as a category of their own. Two things follow
 * from keeping them separate rather than bolting a "no face yet" flag onto `Surface`:
 *
 * - **Nothing downstream ever sees a plain one.** Classification, the framing recipes and the
 *   IFC export read `surfaces` and only `surfaces`. A roleless guide can never turn into a stud.
 * - **They are disposable.** A guide's whole purpose is to be snapped to — its ends, its
 *   midpoint, the line itself — while the faces around it are drawn, and `purgeGuides` throws
 *   every one of them away in one go once they have done that job. The file format writes
 *   them, so a half-finished drawing survives Save, but a reader may ignore the list.
 *
 * **A line with a role is neither of those things.** A pergola, a carport, a porch canopy: a
 * post and a beam standing free of any face, which the recipes cannot derive because there is
 * no surface to derive them from. Rather than invent a second authored type — with its own
 * store, its own snapping, its own tool — a line the user has already drawn is simply promoted:
 * `role: 'column'` makes it a post, `role: 'beam'` makes it a beam, and `recipe/line-members.ts`
 * turns it into timber the same way a recipe turns a face into timber. Everything that makes a
 * *guide* a guide is then switched off for it — Purge leaves it, a face drawn along it does not
 * consume it, `breakAt` does not cut it in two — because those all say "this line is scratch",
 * and it no longer is. Dropping the role hands it back to the guides.
 *
 * Integer millimetres, model frame, like everything else. A guide is consumed — removed — when
 * a face is committed whose boundary runs along it, so drawing a rectangle with four lines
 * leaves a face and no guides, exactly as in SketchUp.
 */

import type { Point3Mm } from '../core';

export type GuideId = string;

/**
 * What a line has been declared to be, when it has been declared anything.
 *
 * Two, because two is what a free-standing timber structure is made of: something vertical that
 * carries (`column`) and something spanning that is carried (`beam`). The distinction is not
 * read off the geometry the way a face's kind is, because it cannot be — a raking pergola brace
 * is neither plumb nor level, and a short vertical line between two beams is a post in one
 * design and a baluster in another. So it is stated, per line, by the person drawing it.
 */
export type GuideRole = 'column' | 'beam';

export const GUIDE_ROLES: readonly GuideRole[] = ['column', 'beam'];

export interface Guide {
    id: GuideId;
    aMm: Point3Mm;
    bMm: Point3Mm;
    /** Absent — the normal case — is a plain construction line. See `GuideRole`. */
    role?: GuideRole;
}

/** Has this line been declared a piece of timber, rather than left as scratch? */
export function isStructuralLine(guide: Guide): boolean {
    return guide.role !== undefined;
}

/**
 * The role a line would most likely be given, from how it lies.
 *
 * Only a default for the button the user clicks — nothing derives a role behind their back.
 * Within 15° of plumb reads as a column, because a post is the one member whose direction is
 * not a design choice; everything else defaults to a beam.
 */
export function suggestedGuideRole(guide: Guide): GuideRole {
    const dx = guide.bMm.x - guide.aMm.x;
    const dy = guide.bMm.y - guide.aMm.y;
    const dz = guide.bMm.z - guide.aMm.z;
    const length = Math.hypot(dx, dy, dz);
    if (length === 0) return 'beam';
    return Math.abs(dz) / length > Math.cos((15 * Math.PI) / 180) ? 'column' : 'beam';
}

/** The middle of a guide, for snapping. Float; callers round if they store it. */
export function guideMidpoint(guide: Guide): Point3Mm {
    return {
        x: (guide.aMm.x + guide.bMm.x) / 2,
        y: (guide.aMm.y + guide.bMm.y) / 2,
        z: (guide.aMm.z + guide.bMm.z) / 2,
    };
}
