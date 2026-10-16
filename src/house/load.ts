/**
 * A house file opened into a store of its own, with no app around it: what a tool's Open does
 * before it derives anything.
 *
 * 1. `parseHouseFile`, `cleanDrawing`, `SurfaceStore.load` (`loadHouse`).
 * 2. The file's `interiorWalls` turned into wall faces, saturated onto the storey's walls and
 *    built up to the floor above, the roof, or the ceiling of the rooms either side
 *    (`buildInteriorWalls`), and the doors standing in them cut in (`placeInteriorOpenings`).
 * 3. The rooms into a `ZoneStore`.
 *
 * `serializeLoadedHouse` writes it back: the store's geometry, and every setting the file came
 * with as it came.
 *
 * Pure: no DOM, no three.js.
 */

import { distance2, nearestPointOnSegment2, type Point3Mm, type Vec2Mm } from '../surfacekit/core';
import {
    SurfaceStore,
    ZoneStore,
    interiorWallSegmentRings,
    partitionCeilingFits,
    floorFootprintsInStorey,
    sortStoreys,
    wallFootprintsInStorey,
    type InteriorWallOptions,
    type Storey,
    type Surface,
    type SurfaceId,
    type Zone,
    type ZoneSeparation,
} from '../surfacekit/model';
import { nearestModularCoordinateMm } from '../surfacekit/grid';
import { saturateInteriorWallPoint } from '../surfacekit/interaction';
import { cleanDrawing } from './drawing-cleanup';
import {
    parseHouseFile,
    serializeHouseFile,
    type ParseResult,
    type ParsedInteriorWall,
} from './house-file';
import type { InteriorOpening } from './simple-house';

/** The model right after Open. */
export interface LoadedHouse {
    parsed: ParseResult;
    store: SurfaceStore;
    zones: ZoneStore;
    /** What the file had wrong, what Open skipped, and what the interior walls could not build. */
    problems: string[];
    /** How many faces the file's interior walls became. */
    interiorFaces: number;
    /** How many of the file's doors and windows in partitions were cut into them. */
    interiorOpenings: number;
}

export interface LoadHouseOptions {
    /**
     * Whether a partition goes onto the module grid on a storey drawn to it (`storeyOnModule`).
     * Default true, as a modeller opens a house it drew. False keeps every partition where the
     * file put it: a house read off a drawing that was not drawn to the module.
     */
    snapToModule?: boolean;
}

/** The house file `input` (text or parsed JSON) opened into a store of its own. */
export function loadHouse(
    input: string | Record<string, unknown>,
    options: LoadHouseOptions = {}
): LoadedHouse {
    const parsed = parseHouseFile(input);
    const cleaned = cleanDrawing(parsed.surfaces, parsed.guides);
    const store = new SurfaceStore();
    const loaded = store.load(cleaned.surfaces, cleaned.guides, parsed.storeys);
    const interior = buildInteriorWalls(
        store,
        parsed.interiorWalls,
        parsed.zones,
        parsed.zoneSeparations,
        options
    );
    const doors = placeInteriorOpenings(store, parsed.interiorOpenings, interior.faceIds);
    const zones = new ZoneStore();
    zones.load(parsed.zones, parsed.zoneSeparations);
    return {
        parsed,
        store,
        zones,
        problems: [
            ...parsed.errors,
            ...loaded.skipped.map((s) => `${s.id} skipped: ${s.message}`),
            ...interior.messages,
            ...doors.messages,
        ],
        interiorFaces: interior.created,
        interiorOpenings: doors.placed,
    };
}

/**
 * A house file's `interiorWalls` built into wall faces: each run's points saturated onto the
 * named storey's own geometry first (`saturateInteriorWallPoint`), then built on that storey the
 * way the Interior Wall tool builds one drawn by hand — up to the floor above, or the roof on the
 * top storey (`interiorWallSegmentRings`). A file being opened has no grid-snap toggle to follow,
 * so the storey decides: on a storey whose walls and floor all stand on the module grid, the
 * partition is put on it too; on one drawn to its measurements (a wall at 7930), it keeps the
 * file's numbers (`storeyOnModule`). Snapping it there would pull an end the saturation had just
 * put on an outer wall back off it — leaving the partition short of the wall, or poking out
 * through it and up through the roof's overhang, with no T where it meets the wall or the roof.
 *
 * Then the ceilings: a partition not marked load-bearing, with a room on each side that both have
 * one (`zoneCeilingsMm` — every room does unless it is open), is fitted to stop under the higher
 * of the two, and cut where the rooms along it change — as setting a ceiling in a modeller does
 * (`partitionCeilingFits`). The rooms are only known once every partition stands, so that is a
 * second pass over what the first one built.
 */
export function buildInteriorWalls(
    store: SurfaceStore,
    walls: readonly ParsedInteriorWall[],
    zones: readonly Zone[] = [],
    separations: readonly ZoneSeparation[] = [],
    options: LoadHouseOptions = {}
): { created: number; faceIds: SurfaceId[]; messages: string[] } {
    const messages: string[] = [];
    const storeys = sortStoreys(store.storeys());
    const built: BuiltSegment[] = [];
    for (const wall of walls) {
        const storey: Storey | undefined = wall.storeyName
            ? storeys.find(
                  (s) => s.name.trim().toLowerCase() === wall.storeyName!.trim().toLowerCase()
              )
            : storeys[0];
        if (!storey) {
            messages.push(`interior wall: storey "${wall.storeyName}" not found.`);
            continue;
        }
        const pointsUv: Vec2Mm[] = [];
        for (const raw of wall.pointsMm) {
            const p = saturateInteriorWallPoint(store.surfaces(), storey, raw);
            const last = pointsUv[pointsUv.length - 1];
            if (last && distance2(last, p) < 1) continue;
            pointsUv.push(p);
        }
        if (pointsUv.length < 2) {
            messages.push('interior wall: fewer than two distinct points after snapping.');
            continue;
        }
        const enforceModule =
            options.snapToModule !== false && storeyOnModule(store.surfaces(), storey);
        for (let i = 0; i + 1 < pointsUv.length; i++) {
            const segment = {
                storey,
                a: pointsUv[i]!,
                b: pointsUv[i + 1]!,
                loadBearing: wall.loadBearing,
            };
            built.push({
                ...segment,
                faceIds: addSegment(store, segment, {}, messages, enforceModule),
            });
        }
    }
    const faceIds = built.flatMap((s) => s.faceIds);
    if (zones.length > 0) {
        const before = new Set(store.surfaces().map((s) => s.id));
        const result = store.applyFaceChanges(
            partitionCeilingFits(
                store.surfaces(),
                store.storeys(),
                zones,
                separations,
                new Set(zones.map((z) => z.id))
            )
        );
        if (!result.ok) messages.push(...result.violations.map((v) => v.message));
        // A partition cut where the rooms along it change: its new pieces are partitions too.
        faceIds.push(
            ...store
                .surfaces()
                .filter((s) => !before.has(s.id))
                .map((s) => s.id)
        );
    }
    return { created: faceIds.length, faceIds, messages };
}

/**
 * Whether every wall and floor corner of `storey` stands on the module grid in plan: a house
 * drawn to the module, whose partitions go onto it as well. One corner off it — a house read
 * from a drawing as measured — and the partitions keep the file's numbers instead.
 */
export function storeyOnModule(surfaces: readonly Surface[], storey: Storey): boolean {
    const onModule = (p: Vec2Mm) =>
        Math.abs(nearestModularCoordinateMm(p.x) - p.x) < 0.5 &&
        Math.abs(nearestModularCoordinateMm(p.y) - p.y) < 0.5;
    return (
        wallFootprintsInStorey(surfaces, storey).every((w) => onModule(w.aMm) && onModule(w.bMm)) &&
        floorFootprintsInStorey(surfaces, storey).every((f) => f.ringMm.every(onModule))
    );
}

/** One straight piece of a partition run, on its storey, and the faces it was built into. */
interface BuiltSegment {
    storey: Storey;
    a: Vec2Mm;
    b: Vec2Mm;
    /** The run's, null for Auto. */
    loadBearing: boolean | null;
    faceIds: SurfaceId[];
}

function addSegment(
    store: SurfaceStore,
    { storey, a, b, loadBearing }: Omit<BuiltSegment, 'faceIds'>,
    options: InteriorWallOptions,
    messages: string[],
    enforceModule: boolean
): SurfaceId[] {
    const ids: SurfaceId[] = [];
    for (const piece of interiorWallSegmentRings(
        store.surfaces(),
        store.storeys(),
        storey,
        a,
        b,
        options
    )) {
        const result = store.add(piece.ringMm, {
            enforceModule: piece.singlePiece && enforceModule,
        });
        if (result.surface) {
            ids.push(result.surface.id);
            if (loadBearing !== null) store.setLoadBearing(result.surface.id, loadBearing);
        } else messages.push(...result.violations.map((v) => v.message));
    }
    return ids;
}

/**
 * How far an interior opening's middle may be off the partition face it goes into, in plan, mm.
 * A partition is snapped onto the storey's walls and the module as it is built, so its face can
 * stand a little off the line the file wrote.
 */
const PARTITION_REACH_MM = 300;

/**
 * Cuts the file's doors and windows in partitions (`ParseResult.interiorOpenings`) into the faces
 * `buildInteriorWalls` made of them (`faceIds`): each into the nearest of those faces in plan that
 * spans its storey's height from sill to head, with its jambs brought square onto that face.
 */
export function placeInteriorOpenings(
    store: SurfaceStore,
    openings: readonly InteriorOpening[],
    faceIds: readonly SurfaceId[]
): { placed: number; messages: string[] } {
    let placed = 0;
    const messages: string[] = [];
    const storeys = sortStoreys(store.storeys());
    openings.forEach((o, i) => {
        const mid = { x: (o.aMm.x + o.bMm.x) / 2, y: (o.aMm.y + o.bMm.y) / 2 };
        const where = `interior ${o.kind} ${i + 1} at [${Math.round(mid.x)}, ${Math.round(mid.y)}]`;
        const storey = o.storeyName
            ? storeys.find(
                  (s) => s.name.trim().toLowerCase() === o.storeyName!.trim().toLowerCase()
              )
            : storeys[0];
        if (!storey) {
            messages.push(`${where}: storey "${o.storeyName}" not found.`);
            return;
        }
        const zLo = storey.elevationMm + o.sillMm;
        const zHi = zLo + o.heightMm;
        let best: { id: SurfaceId; p: Vec2Mm; q: Vec2Mm } | null = null;
        let bestOff = PARTITION_REACH_MM;
        for (const id of faceIds) {
            const face = store.get(id);
            if (!face) continue;
            const zs = face.boundaryMm.map((p) => p.z);
            if (Math.min(...zs) > zLo + 1 || Math.max(...zs) < zHi - 1) continue;
            const [p, q] = planSpan(face.boundaryMm);
            const off = distance2(mid, nearestPointOnSegment2(mid, p, q));
            if (off <= bestOff) {
                best = { id, p, q };
                bestOff = off;
            }
        }
        if (!best) {
            messages.push(`${where} stands in no partition that was built.`);
            return;
        }
        // Under a ridge or a hip a partition is one face per roof plane over it, and a door in
        // the middle of the wall stands across the line between two: they are healed into one
        // face first, the way a gable wall is one.
        const { p, q } = best;
        const len = distance2(p, q);
        const along = (v: Vec2Mm) => ((v.x - p.x) * (q.x - p.x) + (v.y - p.y) * (q.y - p.y)) / len;
        const [t0, t1] = [along(o.aMm), along(o.bMm)].sort((m, n) => m - n) as [number, number];
        const floorOf = (id: SurfaceId) => Math.min(...store.get(id)!.boundaryMm.map((v) => v.z));
        const across = faceIds.filter((id) => {
            const face = id !== best!.id ? store.get(id) : undefined;
            if (!face || Math.abs(floorOf(id) - floorOf(best!.id)) > 1) return false;
            const [m, n] = planSpan(face.boundaryMm);
            const offLine = (v: Vec2Mm) =>
                Math.abs((v.x - p.x) * (q.y - p.y) - (v.y - p.y) * (q.x - p.x)) / len;
            if (offLine(m) > 1 || offLine(n) > 1) return false;
            const [s0, s1] = [along(m), along(n)].sort((g, h) => g - h) as [number, number];
            return s0 < t1 - 1 && s1 > t0 + 1;
        });
        // Nearest first, so each one healed in meets the face along an edge.
        const middle = (id: SurfaceId) => {
            const [m, n] = planSpan(store.get(id)!.boundaryMm);
            return Math.abs((along(m) + along(n)) / 2 - (t0 + t1) / 2);
        };
        across.sort((m, n) => middle(m) - middle(n));
        for (const id of across) {
            const merged = store.mergeFaces(best.id, id);
            if (!merged.ok) {
                messages.push(`${where}: ${merged.violations.map((v) => v.message).join(' ')}`);
                return;
            }
        }
        const onFace = (v: Vec2Mm) => {
            const t = along(v) / len;
            return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        };
        const a = onFace(o.aMm);
        const b = onFace(o.bMm);
        const result = store.addOpening(
            best.id,
            [
                { ...a, z: zLo },
                { ...b, z: zLo },
                { ...b, z: zHi },
                { ...a, z: zHi },
            ],
            o.kind
        );
        if (result.ok) placed++;
        else messages.push(`${where}: ${result.violations.map((v) => v.message).join(' ')}`);
    });
    return { placed, messages };
}

/** A vertical face's line in plan: the two of its corners furthest apart. */
function planSpan(ring: readonly Point3Mm[]): [Vec2Mm, Vec2Mm] {
    let best: [Vec2Mm, Vec2Mm] = [ring[0]!, ring[0]!];
    let bestD = -1;
    for (const a of ring) {
        for (const b of ring) {
            const d = distance2(a, b);
            if (d > bestD) {
                bestD = d;
                best = [a, b];
            }
        }
    }
    return [
        { x: best[0].x, y: best[0].y },
        { x: best[1].x, y: best[1].y },
    ];
}


/**
 * The house as Save writes it (`twb/1`): the store's faces, lines and storeys, the zones, and
 * every setting the file was opened with.
 */
export function serializeLoadedHouse(house: LoadedHouse): string {
    return serializeHouseFile(
        {
            surfaces: house.store.surfaces(),
            guides: house.store.guides(),
            storeys: house.store.storeys(),
            zones: house.zones.zones(),
            zoneSeparations: house.zones.separations(),
            openingDetails: house.parsed.openingDetails,
            openingLintels: house.parsed.openingLintels,
        },
        { name: house.parsed.name, notes: house.parsed.notes, settings: house.parsed.settings }
    );
}
