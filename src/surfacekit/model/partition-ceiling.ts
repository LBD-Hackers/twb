/**
 * Partitions under room ceilings.
 *
 Where the rooms on both sides of a partition have a ceiling — and most do: a room's ceiling is
 * flat on its walls unless it is open (`ZoneCeilingKind`) — the space over them is one cold
 * attic (`envelope/attic.ts`), and nothing divides it: the partition stops under the higher of
 * the two ceilings instead of running on up to the roof. Open either room and it runs up to the
 * roof, or the floor above, again — the same heights the Interior Wall tool builds it to
 * (`interiorWallSegmentRings`).
 *
 * Only a partition: an upright face standing on its storey's floor with a room on each side.
 * A wall with a room on one side only is a facade, and a wall marked load-bearing carries
 * what is over it, so it is left as drawn.
 */

import {
    distance2,
    pointInPolygon2,
    toFrameUv,
    type Point3Mm,
    type Vec2Mm,
} from '../core';
import { interiorWallSegmentRings } from './interior-wall-geometry';
import { wallFootprintsInStorey } from './plan-geometry';
import type { AddedFace, FaceChanges, ReshapedFace } from './roof-fit';
import type { Storey } from './storey';
import type { Surface, SurfaceId } from './surface';
import { openingRing3, surfaceFrame } from './surface-frame';
import {
    MIN_FLAT_CEILING_MM,
    ROOF_ROOM_CEILING_MM,
    zoneCeilingHeightMm,
    type Zone,
    type ZoneId,
    type ZoneSeparation,
} from './zone';
import { resolveZoneRooms } from './zone-rooms';
import { lowestWallTopAround, lowestWallTopInStorey } from './zone-volume';

/** How far either side of a partition's centreline its rooms are looked for, mm. */
const ROOM_PROBE_MM = 150;

/** How far a wall's foot may be off its storey's floor and still stand on it, mm. */
const ON_FLOOR_MM = 2;

interface Partition {
    surface: Surface;
    storey: Storey;
    aMm: Vec2Mm;
    bMm: Vec2Mm;
    /** The zones either side. */
    zones: readonly [Zone, Zone];
}

/** Every partition between two rooms, on every storey. */
function partitionsOf(
    surfaces: readonly Surface[],
    storeys: readonly Storey[],
    zones: readonly Zone[],
    rooms: ReadonlyMap<ZoneId, { outlineMm: readonly Vec2Mm[] | null }>
): Partition[] {
    const byId = new Map(surfaces.map((s) => [s.id, s]));
    const out: Partition[] = [];
    for (const storey of storeys) {
        const zoneAt = (p: Vec2Mm): Zone | undefined =>
            zones.find((z) => {
                const outline = z.storeyId === storey.id ? rooms.get(z.id)?.outlineMm : null;
                return outline ? pointInPolygon2(p, outline) : false;
            });
        for (const w of wallFootprintsInStorey(surfaces, storey)) {
            const surface = byId.get(w.surfaceId);
            if (!surface || surface.loadBearing === true) continue;
            const foot = Math.min(...surface.boundaryMm.map((p) => p.z));
            if (Math.abs(foot - storey.elevationMm) > ON_FLOOR_MM) continue;
            const len = distance2(w.aMm, w.bMm);
            if (len < 1) continue;
            const mid = { x: (w.aMm.x + w.bMm.x) / 2, y: (w.aMm.y + w.bMm.y) / 2 };
            const n = {
                x: (-(w.bMm.y - w.aMm.y) / len) * ROOM_PROBE_MM,
                y: ((w.bMm.x - w.aMm.x) / len) * ROOM_PROBE_MM,
            };
            const left = zoneAt({ x: mid.x + n.x, y: mid.y + n.y });
            const right = zoneAt({ x: mid.x - n.x, y: mid.y - n.y });
            if (!left || !right || left.id === right.id) continue;
            out.push({ surface, storey, aMm: w.aMm, bMm: w.bMm, zones: [left, right] });
        }
    }
    return out;
}

/**
 * Where a flat ceiling over a room is, mm above its floor: on the lowest wall round it, leaving
 * out the partitions that follow the ceilings — they stop under it rather than hold it up. A
 * room no wall bounds takes the storey's plate. A room whose walls are knee walls is in the
 * roof, and ceiled under the collars (`ROOF_ROOM_CEILING_MM`). Infinite where the storey has no
 * walls at all.
 */
function flatCeilingMm(
    surfaces: readonly Surface[],
    storey: Storey,
    outlineMm: readonly Vec2Mm[],
    partitionIds: ReadonlySet<SurfaceId>
): number {
    const walls = surfaces.filter((s) => !partitionIds.has(s.id));
    let top = lowestWallTopAround(walls, storey, outlineMm);
    if (!Number.isFinite(top)) top = lowestWallTopInStorey(walls, storey);
    const height = top - storey.elevationMm;
    return height < MIN_FLAT_CEILING_MM ? ROOF_ROOM_CEILING_MM : height;
}

/**
 * Every room's ceiling, mm above its floor (`zoneCeilingHeightMm`): flat on the walls round it,
 * lowered under that, or none for a room open to the roof or the floor above — and none where
 * the room has no outline, or nothing bounds it.
 */
export function zoneCeilingsMm(
    surfaces: readonly Surface[],
    storeys: readonly Storey[],
    zones: readonly Zone[],
    rooms: ReadonlyMap<ZoneId, { outlineMm: readonly Vec2Mm[] | null }>
): Map<ZoneId, number | undefined> {
    const partitionIds = new Set(
        partitionsOf(surfaces, storeys, zones, rooms).map((p) => p.surface.id)
    );
    const out = new Map<ZoneId, number | undefined>();
    for (const zone of zones) {
        const storey = storeys.find((s) => s.id === zone.storeyId);
        const outline = rooms.get(zone.id)?.outlineMm;
        if (!storey || !outline) continue;
        const flat = flatCeilingMm(surfaces, storey, outline, partitionIds);
        out.set(
            zone.id,
            Number.isFinite(flat) ? zoneCeilingHeightMm(zone, Math.round(flat)) : undefined
        );
    }
    return out;
}

/**
 * Where a flat ceiling over the zone is, mm above its floor (`flatCeilingMm`) — the highest a
 * lowered one may be set. Infinite where nothing bounds the room.
 */
export function zoneFlatCeilingMm(
    surfaces: readonly Surface[],
    storeys: readonly Storey[],
    zones: readonly Zone[],
    separations: readonly ZoneSeparation[],
    zoneId: ZoneId
): number {
    const zone = zones.find((z) => z.id === zoneId);
    const storey = zone ? storeys.find((s) => s.id === zone.storeyId) : undefined;
    const rooms = resolveZoneRooms(surfaces, storeys, zones, separations);
    const outline = rooms.get(zoneId)?.outlineMm;
    if (!storey || !outline) return Infinity;
    const partitionIds = new Set(
        partitionsOf(surfaces, storeys, zones, rooms).map((p) => p.surface.id)
    );
    return flatCeilingMm(surfaces, storey, outline, partitionIds);
}

/**
 * The partitions bordering `zoneIds` reshaped to the rooms' ceilings: under the higher of the
 * two where both rooms have one, up to the roof or the floor above where either is open. Only
 * the faces whose outline changes are returned, for `SurfaceStore.applyFaceChanges`; a
 * partition that would no longer be one face (it runs under a ridge and has no ceiling to stop
 * under) is left as it is.
 */
export function partitionCeilingFits(
    surfaces: readonly Surface[],
    storeys: readonly Storey[],
    zones: readonly Zone[],
    separations: readonly ZoneSeparation[],
    zoneIds: ReadonlySet<ZoneId>
): FaceChanges {
    const rooms = resolveZoneRooms(surfaces, storeys, zones, separations);
    const partitions = partitionsOf(surfaces, storeys, zones, rooms);
    const ceilings = zoneCeilingsMm(surfaces, storeys, zones, rooms);
    /** The ceiling the partition stops under at a point along it: both sides', or none. */
    const ceilingAt = (p: Partition, at: Vec2Mm): number | undefined => {
        const len = distance2(p.aMm, p.bMm);
        const n = {
            x: (-(p.bMm.y - p.aMm.y) / len) * ROOM_PROBE_MM,
            y: ((p.bMm.x - p.aMm.x) / len) * ROOM_PROBE_MM,
        };
        const side = (q: Vec2Mm): number | undefined => {
            const zone = zones.find((z) => {
                const outline = z.storeyId === p.storey.id ? rooms.get(z.id)?.outlineMm : null;
                return outline ? pointInPolygon2(q, outline) : false;
            });
            return zone ? ceilings.get(zone.id) : undefined;
        };
        const left = side({ x: at.x + n.x, y: at.y + n.y });
        const right = side({ x: at.x - n.x, y: at.y - n.y });
        return left !== undefined && right !== undefined ? Math.max(left, right) : undefined;
    };
    const reshape: ReshapedFace[] = [];
    const add: AddedFace[] = [];
    for (const p of partitions) {
        if (!p.zones.some((z) => zoneIds.has(z.id))) continue;
        const runs = ceilingRuns(p, (at) => ceilingAt(p, at));
        const pieces = runs.flatMap((run) =>
            interiorWallSegmentRings(surfaces, storeys, p.storey, run.aMm, run.bMm, {
                ceilingMm: run.ceilingMm,
            }).map((piece) => facingAs(piece.ringMm, p.surface.boundaryMm))
        );
        // One run under a ridge with no ceiling to stop under: left as it is, as drawn.
        if (runs.length === 1 && pieces.length !== 1) continue;
        if (pieces.length === 1) {
            if (!sameRing(pieces[0]!, p.surface.boundaryMm)) {
                reshape.push({ id: p.surface.id, boundaryMm: pieces[0]! });
            }
            continue;
        }
        // Rooms along it ceiled differently: a face per stretch. The face keeps the stretch its
        // doors are in, and is left whole where they are in more than one.
        const frame = surfaceFrame(p.surface.boundaryMm);
        const holes = frame ? p.surface.openings.map((o) => openingRing3(frame, o)) : [];
        const keeps = pieces.findIndex((ring) =>
            holes.every((hole) => hole.every((q) => insideAlong(q, ring)))
        );
        if (keeps < 0) continue;
        pieces.forEach((ring, i) => {
            if (i === keeps) reshape.push({ id: p.surface.id, boundaryMm: ring });
            else add.push({ boundaryMm: ring, kindOverride: null, roofGroupId: null });
        });
    }
    return { removeIds: [], reshape, add };
}

/** Finer than this a partition's run between two ceilings is not found, mm. */
const RUN_STEP_MM = 100;

/**
 * The stretches of a partition with one ceiling over each — split where the rooms either side
 * change, found by stepping along it and closing in on each change to the millimetre.
 */
function ceilingRuns(
    p: Partition,
    ceilingAt: (at: Vec2Mm) => number | undefined
): { aMm: Vec2Mm; bMm: Vec2Mm; ceilingMm: number | undefined }[] {
    const len = distance2(p.aMm, p.bMm);
    const at = (t: number): Vec2Mm => ({
        x: p.aMm.x + ((p.bMm.x - p.aMm.x) * t) / len,
        y: p.aMm.y + ((p.bMm.y - p.aMm.y) * t) / len,
    });
    const steps = Math.max(2, Math.ceil(len / RUN_STEP_MM));
    const ts = Array.from({ length: steps }, (_, i) => ((i + 0.5) * len) / steps);
    const values = ts.map((t) => ceilingAt(at(t)));
    const cuts: number[] = [];
    for (let i = 1; i < ts.length; i++) {
        if (values[i] === values[i - 1]) continue;
        let lo = ts[i - 1]!;
        let hi = ts[i]!;
        while (hi - lo > 1) {
            const mid = (lo + hi) / 2;
            if (ceilingAt(at(mid)) === values[i - 1]) lo = mid;
            else hi = mid;
        }
        cuts.push(Math.round((lo + hi) / 2));
    }
    // Each stretch's ceiling, and the slivers where the rooms either side change a little apart
    // — the probes off each face meet a corner at different places — run into the stretch before.
    let runs = [0, ...cuts].map((from, i) => ({
        from,
        to: i < cuts.length ? cuts[i]! : len,
        // None is a ceiling too — the room open to the roof — so not a value to fall back from.
        ceilingMm:
            values[
                Math.max(
                    0,
                    ts.findIndex((x) => x > from)
                )
            ],
    }));
    runs = runs.reduce<typeof runs>((out, run) => {
        const last = out[out.length - 1];
        if (last && (run.to - run.from < MIN_RUN_MM || last.ceilingMm === run.ceilingMm)) {
            last.to = run.to;
        } else if (last && last.to - last.from < MIN_RUN_MM) {
            out[out.length - 1] = { ...run, from: last.from };
        } else out.push({ ...run });
        return out;
    }, []);
    return runs.map((run, i) => ({
        aMm: i === 0 ? p.aMm : at(run.from),
        bMm: i === runs.length - 1 ? p.bMm : at(run.to),
        ceilingMm: run.ceilingMm,
    }));
}

/** Shorter than this, a stretch of partition is a sliver at a corner, not a wall of its own, mm. */
const MIN_RUN_MM = 600;

/** Whether a point lies within a wall's ring along it, to a millimetre. */
function insideAlong(q: Point3Mm, ring: readonly Point3Mm[]): boolean {
    const frame = surfaceFrame(ring);
    if (!frame) return false;
    const uv = ring.map((r) => toFrameUv(frame, r));
    const p = toFrameUv(frame, q);
    const us = uv.map((r) => r.x);
    return p.x >= Math.min(...us) - 1 && p.x <= Math.max(...us) + 1;
}

/** `ring`, turned round if it faces the other way from `like`. */
function facingAs(ring: readonly Point3Mm[], like: readonly Point3Mm[]): Point3Mm[] {
    const a = surfaceFrame(ring)?.normal;
    const b = surfaceFrame(like)?.normal;
    const same = !a || !b || a.x * b.x + a.y * b.y + a.z * b.z >= 0;
    return same ? [...ring] : [...ring].reverse();
}

/** Whether two rings have the same corners, to the millimetre, wherever each starts. */
function sameRing(a: readonly Point3Mm[], b: readonly Point3Mm[]): boolean {
    const key = (ring: readonly Point3Mm[]): string =>
        ring
            .map((p) => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`)
            .sort()
            .join(';');
    return a.length === b.length && key(a) === key(b);
}
