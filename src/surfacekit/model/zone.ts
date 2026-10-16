/**
 * A zone: a room on one storey, and what it is for — a bedroom, a bathroom, a kitchen.
 *
 * What a room is *for* is authored, like a storey (`storey.ts`), because the geometry cannot say
 * it: two identical rectangles either side of a partition are a bedroom and a study only because
 * someone said so. What the room *is* — its outline — is not authored. It is derived, every time,
 * from the lines that enclose it: the storey's walls, its floors' edges, and the **zone
 * separations** drawn where two zones meet with no wall between them (the kitchen end of an
 * open-plan living room). A zone only stores a point inside its room (`seedMm`), and
 * `zone-rooms.ts` finds the room around it.
 *
 * That is the model's usual rule — derive, don't store — applied to rooms: move a wall and every
 * zone it bounds follows, and two zones can never overlap, since the rooms are the faces of one
 * planar graph. The cost is that a zone can find itself in no closed room at all (a wall it
 * relied on was deleted) or in the same room as another (a separation between them was); both
 * are reported rather than hidden (`ZoneProblem`).
 *
 * What a kind id *means* (its label, its colour, whether a room is wet) is a profile's business,
 * not the engine's. The engine carries the id through untouched.
 */

import type { Vec2Mm } from '../core';
import type { StoreyId } from './storey';

export type ZoneId = string;

export interface Zone {
    id: ZoneId;
    /** Free text — "Bedroom 2", "Bad", whatever the drawing calls it. */
    name: string;
    /** A profile's room-kind id. Opaque to the engine. */
    kindId: string;
    storeyId: StoreyId;
    /** A point inside the room, integer mm — where it was clicked. The room is found around it. */
    seedMm: Vec2Mm;
    /** How the room is ceiled (`ZoneCeilingKind`). Absent: `'flat'`, as most rooms are. */
    ceiling?: ZoneCeilingKind;
    /**
     * A lowered ceiling's height, mm above the storey's floor (the frame's centreline, like every
     * height). Only with `ceiling: 'lowered'` — a flat ceiling's height is not chosen.
     */
    ceilingMm?: number;
}

/**
 * How a room is ceiled — a choice, not a height:
 *
 * - **`'flat'`**, the default: flat at the top of the walls round it, where the construction
 *   puts it. Under a pitched roof that is the trusses' bottom chords (or the ceiling joists
 *   tying the rafters) on the wall plate, battened across and lined; under a floor, the floor's
 *   joists, lined. Every room under the same plate has the same ceiling. A room in the roof,
 *   whose walls are knee walls, is ceiled at `ROOF_ROOM_CEILING_MM`, under the collars.
 * - **`'open'`**: no ceiling. The room runs up to the floor above or into the roof, to the
 *   ridge, and its partitions with it — which, under a pitched roof, takes a ridge beam.
 * - **`'lowered'`**: hung under where a flat one would be, at `Zone.ceilingMm` — a bathroom or a
 *   hall with ducts over it.
 */
export type ZoneCeilingKind = 'flat' | 'open' | 'lowered';

/** Below this, mm over the floor, the walls round a room are knee walls: it is in the roof. */
export const MIN_FLAT_CEILING_MM = 2100;

/** A flat ceiling in a room in the roof, under the collars, mm above its floor. */
export const ROOF_ROOM_CEILING_MM = 2400;

/** A lowered ceiling given to a room that had none starts this high, mm above its floor. */
export const DEFAULT_LOWERED_CEILING_MM = 2300;

export function zoneCeilingKind(zone: Pick<Zone, 'ceiling'>): ZoneCeilingKind {
    return zone.ceiling ?? 'flat';
}

/**
 * The room's ceiling, mm above its floor, given where a flat one is (`flatMm`, the top of the
 * walls round it): there for a flat one, under it for a lowered one, none for an open room.
 */
export function zoneCeilingHeightMm(
    zone: Pick<Zone, 'ceiling' | 'ceilingMm'>,
    flatMm: number
): number | undefined {
    switch (zoneCeilingKind(zone)) {
        case 'open':
            return undefined;
        case 'lowered':
            return Math.min(zone.ceilingMm ?? DEFAULT_LOWERED_CEILING_MM, flatMm);
        case 'flat':
            return flatMm;
    }
}

export type ZoneSeparationId = string;

/**
 * A line in plan that divides two zones where there is no wall — an open kitchen from its living
 * room, a hall from the stair it opens onto. It bounds rooms and nothing else: it is not a
 * surface, carries no timber, and takes nothing off the net area either side of it.
 */
export interface ZoneSeparation {
    id: ZoneSeparationId;
    storeyId: StoreyId;
    aMm: Vec2Mm;
    bMm: Vec2Mm;
}

/** Below this a room is treated as a sliver between two lines, not a room, m². */
export const MIN_ZONE_AREA_M2 = 0.25;
