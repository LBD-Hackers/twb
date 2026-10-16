/**
 * SketchUp's Measurements box: start an operation with the mouse, type a number, press Enter.
 *
 * The box never has focus. A digit typed while a tool is mid-operation starts a value, and
 * from then on keys go to the value until Enter applies it or Escape drops it — which is why
 * the tool shortcuts (`m`, `l`, ...) stay usable right up to the first digit and unit letters
 * work after it. What the value *means* is the tool's business and follows SketchUp:
 *
 * - Line: the length of the next edge, in the direction the cursor is pointing from the last
 *   vertex.
 * - Push/Pull and Move: the distance, in the direction the cursor is currently pulling; a
 *   negative value goes the other way.
 * - Rectangle: `width,depth` (or `width;depth`, the Danish separator) along the working
 *   plane's u and v, towards the cursor. Either can be left blank to keep the cursor's.
 *
 * Move takes one value that is **not** a length: a pitch. `35g` (grader), `35d` or `35°` while
 * an edge is armed sets the angle of the roof plane the edge swings from, and the rise that
 * produces is worked out from the run rather than typed. A ridge is lifted *to a pitch* in every
 * conversation about a roof, and the millimetres are the consequence; this is the one place the
 * tool lets the user say it that way round. The unit suffix is what distinguishes the two, so a
 * bare number stays a length and nothing that worked before changes meaning.
 *
 * A typed value bypasses the grid on purpose — that is what typing is *for* — and the store's
 * validation still has the last word on whether the result is a legal face.
 *
 * This module is the pure part: it parses text and does the geometry. No DOM, no signals.
 */

import type { Point3Mm } from '../core';
import { add3, length3, scale3, sub3 } from '../core';

/** Characters that start a value while none is being typed. */
export const MEASURE_START = /^[0-9.-]$/;
/** Characters accepted once a value is under way. `g`, `gr`, `d` and `°` are the pitch units. */
export const MEASURE_CONTINUE = /^[0-9.,;cmgrd° -]$/;

const LENGTH = /^\s*(-?\d*\.?\d+)\s*(mm|cm|m)?\s*$/i;
const ANGLE = /^\s*(-?\d*\.?\d+)\s*(°|g|gr|d)\s*$/i;

/** `"3600"`, `"3.6m"`, `"120cm"`, `"-600"` → millimetres, rounded. Null if not a length. */
export function parseLengthMm(text: string): number | null {
    const m = LENGTH.exec(text);
    if (!m) return null;
    const value = Number(m[1]);
    const unit = (m[2] ?? 'mm').toLowerCase();
    const factor = unit === 'm' ? 1000 : unit === 'cm' ? 10 : 1;
    return Math.round(value * factor);
}

/**
 * `"35g"`, `"35°"`, `"35d"` → 35. Null when the text is not an angle — including a bare
 * `"35"`, which is a length, and is what keeps the Measurements box's existing meaning intact.
 *
 * `g` for *grader* first, because that is what a Danish roof is described in and the keyboard
 * it is typed on has no dead-key-free `°`.
 */
export function parseAngleDeg(text: string): number | null {
    const m = ANGLE.exec(text);
    return m ? Number(m[1]) : null;
}

/**
 * `"1200,2400"` → `[1200, 2400]`; `"1200"` → `[1200]`; `",2400"` → `[null, 2400]`. Null if
 * any field present is not a length. Both `,` and `;` separate, so a Danish keyboard's
 * SketchUp habit carries over.
 */
export function parseLengthsMm(text: string): (number | null)[] | null {
    const out: (number | null)[] = [];
    for (const field of text.split(/[,;]/)) {
        if (field.trim() === '') {
            out.push(null);
            continue;
        }
        const mm = parseLengthMm(field);
        if (mm === null) return null;
        out.push(mm);
    }
    return out;
}

/**
 * SketchUp's sign rule for a typed distance: positive goes the way the cursor is already
 * going, negative the other way. With the cursor still on the anchor, positive is the tool's
 * own positive — along the normal, or up.
 */
export function signedByCursor(typedMm: number, cursorMm: number): number {
    return cursorMm < 0 ? -typedMm : typedMm;
}

/**
 * The point `lengthMm` from `from` in the direction of `toward`, integer mm. Null when the two
 * coincide — there is no direction to type a length along.
 */
export function pointAlong(from: Point3Mm, toward: Point3Mm, lengthMm: number): Point3Mm | null {
    const d = sub3(toward, from);
    const len = length3(d);
    if (len < 1) return null;
    const p = add3(from, scale3(d, lengthMm / len));
    return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
}
