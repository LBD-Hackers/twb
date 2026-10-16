/**
 * A storey: a named, elevated slice of the building, authored rather than derived.
 *
 * Everything else in the model is read off geometry after the fact (`classify.ts`) — the one
 * exception the brief actually requires is this one. IFC's `IfcBuildingStorey` is a container
 * with a name and an elevation that exists whether or not anything has been drawn at that level
 * yet, and the 2D plan view needs the same thing: "show me storey 1" has to mean something
 * before a single wall stands on it. So a storey is authored state, alongside the surfaces and
 * the guides (`model/surface-store.ts`), not a classification.
 *
 * A surface's storey membership is still derived, though, exactly the way its kind is: which
 * storey a face belongs to is read off its Z, by `storeyAt`, rather than stored on the face. A
 * floor slab poured at a storey's elevation is that storey's floor without anyone having to
 * assign it — the same argument `classify.ts` makes for floor/wall/roof.
 */

import { DEFAULT_WALL_HEIGHT_MM } from './surface';

export type StoreyId = string;

export interface Storey {
    id: StoreyId;
    /** Free text — "Ground floor", "1st floor", whatever a Danish drawing calls it. */
    name: string;
    /** Base elevation, integer mm, model frame (Z up). Top of the floor joists, per the house file's convention. */
    elevationMm: number;
    /** Storey height, mm — elevation to elevation of the storey above. Free on the top storey. */
    heightMm: number;
}

/** A typical storey height, mm — the same 2-module figure `surface.ts` frames the camera on. */
export const DEFAULT_STOREY_HEIGHT_MM = DEFAULT_WALL_HEIGHT_MM;

/** Shortest storey worth keeping, mm. Below this a "storey" is not a space anyone stands in. */
export const MIN_STOREY_HEIGHT_MM = 1200;

/** Every storey, lowest first. Elevation is the only thing that orders them — there is no separate index to keep in sync. */
export function sortStoreys(storeys: readonly Storey[]): Storey[] {
    return [...storeys].sort((a, b) => a.elevationMm - b.elevationMm);
}

export function topStorey(storeys: readonly Storey[]): Storey | null {
    const sorted = sortStoreys(storeys);
    return sorted[sorted.length - 1] ?? null;
}

/**
 * Which storey a given height belongs to: the highest one whose elevation is at or below it.
 *
 * Anything above the top storey's own elevation is still that storey's — the roof has no
 * storey of its own, and in IFC a roof is conventionally contained in the storey below it. Null
 * only when there are no storeys at all, which `SurfaceStore` never actually allows.
 */
export function storeyAt(storeys: readonly Storey[], zMm: number): Storey | null {
    const sorted = sortStoreys(storeys);
    let found: Storey | null = null;
    for (const s of sorted) {
        if (s.elevationMm <= zMm + 1) found = s;
        else break;
    }
    return found ?? sorted[0] ?? null;
}

/** `storey` and every one above it, lowest first — the run a stacked interior wall climbs. */
export function storeysFrom(storeys: readonly Storey[], storey: Storey): Storey[] {
    return sortStoreys(storeys).filter((s) => s.elevationMm >= storey.elevationMm);
}
