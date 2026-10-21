/**
 * The internal data model. **IFC is never part of it.**
 *
 * That is the architectural rule the brief calls critical, and this file is where it is
 * enforced by construction: a `Surface` is a planar polygon and a few 2D holes. No IFC
 * entities, no three.js objects, no generated timber. Framing is *derived* from these by
 * `recipe/`, on demand, and IFC is derived from that at export time — both in memory, neither
 * stored.
 *
 * A surface does not know what it is, either. It is drawn as a face — SketchUp's grammar,
 * where a rectangle is a rectangle and a box is six of them — and whether that face is a
 * floor, a wall or a roof is *read off its geometry* afterwards by `classify.ts`, with an
 * override for the cases the geometry cannot settle. Storing a kind at draw time was the
 * alternative, and it forces the user to decide what a face is before it exists, which is
 * exactly the modal floor-tool/wall-tool/roof-tool interaction this model replaces.
 *
 * The payoff is that the viewer stays fast and the undo/save/load story stays trivial: the
 * entire authored state of a house is a few dozen of these objects, which is a small JSON
 * file and an `Object.is` comparison away from a working change-detection system. A model that
 * stored its 5000 generated studs would be three orders of magnitude larger and would have to
 * keep them in sync with every edit.
 */

import type { Point3Mm } from '../core';

export type SurfaceId = string;

/** What a face turns out to be. Derived by `classify.ts`, never chosen at draw time. */
export type SurfaceKind = 'floor' | 'wall' | 'roof';

export const SURFACE_KINDS: readonly SurfaceKind[] = ['floor', 'wall', 'roof'];

/**
 * What fills an opening. A void with nothing in it is a hole (`Surface.holes`), not an opening.
 *
 * A garage door is its own kind rather than a wide door: it has no leaf to swing (it rolls or
 * folds up out of the way), it is sold to its own standard sizes, and it loses heat as a door
 * of its own construction does — none of which a door's width alone would say.
 */
export type OpeningKind = 'window' | 'door' | 'garage-door';

export const OPENING_KINDS: readonly OpeningKind[] = ['window', 'door', 'garage-door'];

/**
 * How a door's hole is filled: one leaf; a leaf and a narrow side leaf beside it — the Danish
 * "halvanden" door, the side leaf a third of the width and bolted shut until a wide load comes
 * through; or two equal leaves meeting in the middle, a double terrace door.
 */
export type DoorLeaves = 'single' | 'one-and-a-half' | 'double';

export const DOOR_LEAVES: readonly DoorLeaves[] = ['single', 'one-and-a-half', 'double'];

/** A halvanden door's side leaf, as a share of the hole's width. */
export const SIDE_LEAF_FRACTION = 1 / 3;

/**
 * How a window's or a glazed door's frame is divided, as its elevation shows it. Absent is one
 * undivided pane — the tight Nordic default; a drawing set that shows more says so.
 *
 * - `mullions`: vertical posts (lodposter) splitting the frame into fields side by side;
 * - `transoms`: horizontal ones (tværposter) splitting it into fields one over the other;
 * - `panes`: glazing bars (sprosser) within each field, as the panes it shows across and up —
 *   `[2, 3]` is a six-pane field. `[1, 1]`, or absent, is none.
 */
export interface OpeningGlazing {
    mullions?: number;
    transoms?: number;
    panes?: readonly [number, number];
}

/** Whether `g` divides the frame at all — undefined and all-ones do not. */
export function isDividedGlazing(g: OpeningGlazing | undefined): boolean {
    return (
        !!g &&
        ((g.mullions ?? 0) > 0 ||
            (g.transoms ?? 0) > 0 ||
            (g.panes !== undefined && (g.panes[0] > 1 || g.panes[1] > 1)))
    );
}

/** How an opening kind is named in the UI's sentences. */
export const OPENING_LABELS: Readonly<Record<OpeningKind, string>> = {
    window: 'window',
    door: 'door',
    'garage-door': 'garage door',
};

/**
 * A window or a door in a surface: a rectangle in that surface's own UV frame
 * (`surface-frame.ts`), and what fills it.
 *
 * Stored in UV rather than as a 3D polygon so a window stays put when the wall it is on is
 * moved or re-pitched, and so "sill at 900, head at 2100" are literal numbers — which is what
 * `openings.ts` needs to lay out a header and cripple studs. The 3D position is recoverable at
 * any time from the surface's frame, so nothing is lost. The kind is stated rather than read off
 * the sill height: a window can go down to the floor, and a door is not one because it does.
 */
export interface SurfaceOpening {
    id: string;
    kind: OpeningKind;
    /** Distance along the surface's u axis from its origin to the opening's near edge, mm. */
    uMm: number;
    /** Distance along the surface's v axis (up, for a wall) from its origin to the underside, mm. */
    vMm: number;
    widthMm: number;
    heightMm: number;
    /**
     * Doors only: the leaf hangs on the far jamb (`uMm + widthMm`) rather than the near one.
     * Absent means false. Together with `swingsBack` this mirrors the swing over either axis —
     * along the wall, or across it.
     */
    hingeAtEnd?: boolean;
    /** Doors only: the leaf swings to the back of the face (−normal) rather than the front. */
    swingsBack?: boolean;
    /**
     * Doors only: how many leaves fill the hole. Absent means `'single'`. A halvanden door hangs
     * its wide leaf where a single one would hang (`hingeAtEnd`) and its side leaf on the other
     * jamb; a double door hangs one on each, so `hingeAtEnd` changes nothing for it.
     */
    leaves?: DoorLeaves;
    /** How the frame is divided (`OpeningGlazing`). Absent is one undivided pane. */
    glazing?: OpeningGlazing;
}

export interface Surface {
    id: SurfaceId;
    /**
     * The planar boundary, integer mm, model frame (Z-up). Closed implicitly — the last
     * vertex joins the first, and repeating it would put a zero-length edge in every recipe.
     *
     * The face is the centreline of the raw timber frame: the middle of the studs, joists or
     * rafters, not a finished surface. The recipes centre plates and joists on it and offset
     * battens by half the assembly thickness, and the module lines of a drawing are exactly
     * these lines — so nothing anywhere stores a wall thickness in the geometry.
     */
    boundaryMm: readonly Point3Mm[];
    openings: readonly SurfaceOpening[];
    /**
     * Inner rings: loops drawn strictly inside the face, SketchUp's way. Each is either filled by
     * a face of its own with that outline — the loop was drawn and nothing else happened yet — or
     * open, once that face was deleted: a real hole, a void nothing fills. Which is read off the
     * model (`surface-holes.ts`), not stored. Model frame, integer mm, coplanar with the face.
     */
    holes: readonly (readonly Point3Mm[])[];
    /**
     * Pins the classification when the geometry is ambiguous — a horizontal face between
     * storeys is a floor to the room below and could be read as a flat roof if nothing has
     * been built on it yet. Null means "derive it".
     */
    kindOverride: SurfaceKind | null;
    /**
     * Whether this surface carries load from above. Drives the pillar layout under floor
     * beams and is an input to the stud-spacing decision. Null means "derive it": framing makes
     * a wall load-bearing where that saves timber, and says why.
     */
    loadBearing: boolean | null;
    /**
     * Escape hatch for the one genuinely ambiguous case in the roof heuristics: a flat or
     * square roof has no slope to derive a span direction from. Null means "derive it".
     */
    spanDirectionOverride: { x: number; y: number } | null;
    /**
     * Groups the planes of one roof, so a dormer gets its own rafter grid instead of being
     * assigned to the main roof beneath it. See the roof recipe's known limitations.
     */
    roofGroupId: string | null;
    /**
     * Manual stud-section pin for this one wall, overriding both the exterior/interior default
     * and the house-wide `MaterialOverrides` category pin for it. Null means "use whichever of
     * those applies" — the behaviour before this existed. Ignored on a non-wall face.
     */
    studSectionOverride: string | null;
    /**
     * What kind of wall this one is pinned to be, where it is not what the house's own partition
     * is: a `light` partition (studs), a `heavy` one (masonry), or a `party` wall between two
     * dwellings — the house's build-ups for each decide its layers. Absent or null means "derive
     * it": a partition is the house's partition, an exterior wall an exterior wall. Ignored on a
     * non-wall face.
     */
    partitionKind?: PartitionKind | null;
    /**
     * The build-up type this face is pinned to, where it is not its kind's own build-up: the id
     * of one more build-up of its kind — `interiorWall:plumbing` — that the house's envelope
     * holds. Absent or null means "its kind's own".
     */
    buildUpType?: string | null;
}

/** The kinds of wall a wall can be pinned to be, besides what it is read as (`Surface.partitionKind`). */
export const PARTITION_KINDS = ['light', 'heavy', 'party'] as const;
export type PartitionKind = (typeof PARTITION_KINDS)[number];

/** A typical storey, mm — 2 modules. Used to bias the camera framing towards wall height. */
export const DEFAULT_WALL_HEIGHT_MM = 2400;
