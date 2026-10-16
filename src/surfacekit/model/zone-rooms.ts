/**
 * Every zone's room, found from the lines that enclose it — see `zone.ts` for why a zone stores
 * a point rather than an outline.
 *
 * A room on a storey is bounded by that storey's walls, its floors' own edges (so a floor with
 * no walls on it yet is still one room) and its zone separations. `room-find.ts` does the
 * geometry; this decides what each zone makes of the answer.
 */

import { polygonArea2, type Vec2Mm } from '../core';
import { floorFootprintsInStorey, wallFootprintsInStorey } from './plan-geometry';
import { roomOutlineAt, type PlanSegment } from './room-find';
import type { Storey, StoreyId } from './storey';
import type { Surface } from './surface';
import { MIN_ZONE_AREA_M2, type Zone, type ZoneId, type ZoneSeparation } from './zone';

/** Why a zone has no room of its own. */
export type ZoneProblem =
    /** The lines around its point do not close — a wall or separation it relied on is gone. */
    | { kind: 'open' }
    /** An earlier zone already claims the same room — a separation between them is gone. */
    | { kind: 'shared'; withZoneId: ZoneId };

export interface ZoneRoom {
    /** Counter-clockwise, on the wall centrelines. Null when the zone has a problem. */
    outlineMm: Vec2Mm[] | null;
    problem: ZoneProblem | null;
}

/** The plan segments that bound rooms on a storey: walls, floor edges and zone separations. */
export function roomSegmentsInStorey(
    surfaces: readonly Surface[],
    storey: Storey,
    separations: readonly ZoneSeparation[]
): PlanSegment[] {
    const out: PlanSegment[] = wallFootprintsInStorey(surfaces, storey).map((w) => [w.aMm, w.bMm]);
    for (const f of floorFootprintsInStorey(surfaces, storey)) {
        f.ringMm.forEach((p, i) => out.push([p, f.ringMm[(i + 1) % f.ringMm.length]!]));
    }
    for (const s of separations) if (s.storeyId === storey.id) out.push([s.aMm, s.bMm]);
    return out;
}

/**
 * The room each zone sits in. Zones are taken in list order, so where two land in one room the
 * older keeps it and the newer is the one reported as `shared` — the one to delete or re-split.
 */
export function resolveZoneRooms(
    surfaces: readonly Surface[],
    storeys: readonly Storey[],
    zones: readonly Zone[],
    separations: readonly ZoneSeparation[]
): Map<ZoneId, ZoneRoom> {
    const segmentsByStorey = new Map<StoreyId, PlanSegment[]>();
    const claimed = new Map<string, ZoneId>();
    const out = new Map<ZoneId, ZoneRoom>();
    for (const zone of zones) {
        const storey = storeys.find((s) => s.id === zone.storeyId);
        if (!storey) {
            out.set(zone.id, { outlineMm: null, problem: { kind: 'open' } });
            continue;
        }
        let segments = segmentsByStorey.get(storey.id);
        if (!segments) {
            segments = roomSegmentsInStorey(surfaces, storey, separations);
            segmentsByStorey.set(storey.id, segments);
        }
        const outline = roomOutlineAt(segments, zone.seedMm);
        if (!outline || polygonArea2(outline) / 1e6 < MIN_ZONE_AREA_M2) {
            out.set(zone.id, { outlineMm: null, problem: { kind: 'open' } });
            continue;
        }
        const key = `${storey.id}:${ringKey(outline)}`;
        const owner = claimed.get(key);
        if (owner) {
            out.set(zone.id, { outlineMm: null, problem: { kind: 'shared', withZoneId: owner } });
            continue;
        }
        claimed.set(key, zone.id);
        out.set(zone.id, { outlineMm: outline, problem: null });
    }
    return out;
}

/** The same ring always gives the same key, whichever corner it happens to start on. */
function ringKey(ring: readonly Vec2Mm[]): string {
    return ring
        .map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
        .sort()
        .join(';');
}
