/**
 * The storeys a vertical push/pull leaves behind: the drawn boxes say where the levels are.
 *
 * Storeys are authored (`storey.ts`), but in 3D they are mostly drawn rather than typed — a floor
 * pulled up 2200 is a 2200 storey, and a second box pulled up off its top is a storey above it.
 * So the two push/pull verbs keep the list in step with what they built, rather than leaving the
 * plan view to disagree with the model until someone retypes the numbers:
 *
 * - **A box on a new level** — one whose floor stands at least a storey's height above the top
 *   storey's floor, and is itself tall enough to stand in — adds a storey there. The storey it
 *   now sits on gets the gap as its height, elevation to elevation, as the field means.
 * - **A stretched box** whose pulled face is a storey's floor takes that storey's elevation with
 *   it, and the storey below's height with it.
 * - **The top storey's height** follows its walls (`storeyCeilingZ`), there being no storey above
 *   it to measure to. The storeys below are measured to the next floor and are left alone.
 *
 * Only vertical pulls: a wall pulled sideways says nothing about levels.
 */

import { COINCIDENT_MM } from './surface-ops';
import type { Surface } from './surface';
import { MIN_STOREY_HEIGHT_MM, sortStoreys, type Storey } from './storey';
import { storeyCeilingZ } from './roof-lift';

export interface StoreyPull {
    /**
     * `box`: a new box between the two heights (push/pull's default). `stretch`: the face at
     * `fromZMm` moved to `toZMm`, dragging whatever stands on its corners (Shift).
     */
    mode: 'box' | 'stretch';
    fromZMm: number;
    toZMm: number;
}

/**
 * The storey list after a vertical pull, given the surfaces as the pull left them. Null when
 * nothing about the storeys changes. `mint` names and numbers a new storey; the caller owns ids.
 */
export function storeysAfterPull(
    storeys: readonly Storey[],
    surfaces: readonly Surface[],
    pull: StoreyPull,
    mint: (elevationMm: number, heightMm: number) => Storey
): Storey[] | null {
    let list = sortStoreys(storeys);
    const at = (z: number): number =>
        list.findIndex((s) => Math.abs(s.elevationMm - z) <= COINCIDENT_MM);

    if (pull.mode === 'box') {
        const lo = Math.min(pull.fromZMm, pull.toZMm);
        const hi = Math.max(pull.fromZMm, pull.toZMm);
        const top = list[list.length - 1];
        if (
            top &&
            at(lo) === -1 &&
            lo - top.elevationMm >= MIN_STOREY_HEIGHT_MM &&
            hi - lo >= MIN_STOREY_HEIGHT_MM
        ) {
            list = [
                ...list.slice(0, -1),
                { ...top, heightMm: lo - top.elevationMm },
                mint(lo, hi - lo),
            ];
        }
    } else {
        const i = at(pull.fromZMm);
        const below = list[i - 1];
        const above = list[i + 1];
        const to = pull.toZMm;
        // A floor pulled through the one below or above would reorder the storeys — leave them.
        const fits =
            i !== -1 &&
            (!below || to - below.elevationMm >= MIN_STOREY_HEIGHT_MM) &&
            (!above || above.elevationMm - to >= MIN_STOREY_HEIGHT_MM);
        if (fits) {
            list = list.map((s, j) => {
                if (j === i) return { ...s, elevationMm: to };
                if (j === i - 1) return { ...s, heightMm: to - s.elevationMm };
                return s;
            });
        }
    }

    const topIndex = list.length - 1;
    const top = list[topIndex];
    const ceiling = top ? storeyCeilingZ(surfaces, top) : null;
    if (top && ceiling !== null && ceiling - top.elevationMm >= MIN_STOREY_HEIGHT_MM) {
        list = list.map((s, j) =>
            j === topIndex ? { ...s, heightMm: ceiling - top.elevationMm } : s
        );
    }

    const before = sortStoreys(storeys);
    const same =
        list.length === before.length &&
        list.every(
            (s, i) =>
                s.id === before[i]!.id &&
                s.elevationMm === before[i]!.elevationMm &&
                s.heightMm === before[i]!.heightMm
        );
    return same ? null : list;
}
