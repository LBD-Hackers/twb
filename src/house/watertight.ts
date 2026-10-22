/**
 * Whether a house closes: its shell — every exterior wall, floor and roof face — met along
 * every edge by another face of the shell, its rooms closed by their walls, and its windows and
 * doors each in a face.
 *
 * **The shell.** Every roof is in it; every floor over the ground or the weather, not one with
 * the house under it too (between storeys, round a room rising through them); and every wall
 * with the house on one side and the weather on the other: a step out of each face of the wall,
 * just over its foot, lands over a floor on one side (inside) and over a roof or over nothing on
 * the other (outside). A partition has the house on both sides and a garden wall on neither, so
 * neither is in it. This is read off the faces alone, so it holds for a file in either shape.
 *
 * **Leaks.** An edge of a shell face — its outline's, and each ring cut out of it (a courtyard,
 * the part of a storey's roof the storey over it stands on), not an opening's — is closed where
 * the shell's other faces, or any floor or roof, run along it its whole length: their edges, in
 * line with it to the millimetre and overlapping, however each is split along it, so a T where a
 * wall's foot meets a floor's edge counts; or their faces, where it lies in one (a wall's top
 * under a floor that runs on past it). Every stretch left open is a leak, by where it is and how long.
 *
 * Pure: plain data out.
 */

import {
    clipLineToPolygon2,
    collinearOverlap3,
    distance3,
    distanceToPlane,
    planeHeightAt,
    planeOfPolygon,
    pointInPolygonPlan,
    signedArea2,
    toFrameUv,
    type Frame3,
    type Plane3,
    type Point3Mm,
    type Vec2Mm,
} from '../surfacekit/core';
import {
    classifyAll,
    resolveZoneRooms,
    sortStoreys,
    surfaceFrame,
    type Surface,
    type SurfaceId,
    type SurfaceKind,
} from '../surfacekit/model';
import type { LoadedHouse } from './load';

/** A stretch of a shell face's edge no other face of the shell runs along. */
export interface WatertightLeak {
    /** The face whose edge it is. */
    faceId: SurfaceId;
    kind: SurfaceKind;
    /** Where it starts and ends, model frame, mm. */
    fromMm: Point3Mm;
    toMm: Point3Mm;
    lengthMm: number;
}

/** A room whose walls and separations do not close round it. */
export interface WatertightRoom {
    zoneId: string;
    name: string;
    storey: string | null;
}

/** What `watertightReport` finds. */
export interface WatertightReport {
    /** A shell, with no leak, no room open and no opening left out of a face. */
    watertight: boolean;
    /** How many faces the shell is: exterior walls, floors and roofs. */
    shellFaces: number;
    leaks: WatertightLeak[];
    /** The leaks' length together, mm. */
    leakMm: number;
    /** Rooms no outline was found for (`resolveZoneRooms`). */
    openRooms: WatertightRoom[];
    /** Windows and doors the file places in no face, as the opening's problems say. */
    openingsInNoFace: string[];
}

/** Two edges this far apart across are one line, mm: the faces' own integer coincidence. */
const ON_EDGE_MM = 1;
/** A stretch of edge shorter than this is rounding, not a leak, mm. */
const MIN_LEAK_MM = 2;
/** How far either side of a wall the house is looked for, and how far over its foot, mm. */
const PROBE_MM = 50;
/** Plan cells the faces are filed in, mm. */
const CELL_MM = 2000;

type Edge = readonly [Point3Mm, Point3Mm];

/** Whether the house closes: see the module doc. */
export function watertightReport(house: LoadedHouse): WatertightReport {
    const surfaces = house.store.surfaces();
    const kinds = classifyAll(surfaces);
    const shell = shellFaces(surfaces, kinds);
    // Any floor or roof closes an edge — a wall's top under a floor between storeys — and only
    // the shell's edges are looked at.
    const closers = [...new Set([...shell, ...surfaces.filter((s) => kinds.get(s.id) !== 'wall')])];
    const leaks = openEdges(shell, closers, kinds);
    const storeys = sortStoreys(house.store.storeys());
    const rooms = resolveZoneRooms(
        surfaces,
        storeys,
        house.zones.zones(),
        house.zones.separations()
    );
    const openRooms = house.zones
        .zones()
        .filter((z) => rooms.get(z.id)?.problem)
        .map((z) => ({
            zoneId: z.id,
            name: z.name,
            storey: storeys.find((s) => s.id === z.storeyId)?.name ?? null,
        }));
    const openingsInNoFace = house.problems.filter((p) =>
        /^openings\[\d+\]|^interior (window|door|garage-door) \d+/.test(p)
    );
    return {
        watertight:
            shell.length > 0 &&
            leaks.length === 0 &&
            openRooms.length === 0 &&
            openingsInNoFace.length === 0,
        shellFaces: shell.length,
        leaks,
        leakMm: Math.round(leaks.reduce((s, l) => s + l.lengthMm, 0)),
        openRooms,
        openingsInNoFace,
    };
}

/** The report as lines of text, for the CLI and a tool's status line. */
export function watertightSummary(r: WatertightReport): string[] {
    const m = (mm: number) => `${(mm / 1000).toLocaleString('en', { maximumFractionDigits: 1 })} m`;
    const lines = [
        r.watertight
            ? `Watertight: ${r.shellFaces} faces of shell, every edge closed, every room closed.`
            : `Not watertight: ${r.leaks.length} open edge${r.leaks.length === 1 ? '' : 's'} (${m(r.leakMm)}) in ${r.shellFaces} faces of shell, ` +
              `${r.openRooms.length} room${r.openRooms.length === 1 ? '' : 's'} open, ` +
              `${r.openingsInNoFace.length} opening${r.openingsInNoFace.length === 1 ? '' : 's'} in no face.`,
    ];
    const at = (p: Point3Mm) => `[${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}]`;
    for (const l of [...r.leaks].sort((a, b) => b.lengthMm - a.lengthMm).slice(0, 20)) {
        lines.push(
            `- open: ${l.kind} ${l.faceId}, ${Math.round(l.lengthMm)} mm from ${at(l.fromMm)} to ${at(l.toMm)}`
        );
    }
    if (r.leaks.length > 20) lines.push(`- … and ${r.leaks.length - 20} more open edges`);
    for (const z of r.openRooms)
        lines.push(`- room open: ${z.name}${z.storey ? ` (${z.storey})` : ''}`);
    return lines;
}

// ---- The shell ---------------------------------------------------------------------------------

/** A floor or a roof, with its plane and its plan box: what a step out of a wall lands on. */
interface Plate {
    s: Surface;
    kind: SurfaceKind;
    height: (x: number, y: number) => number | null;
    lo: { x: number; y: number };
    hi: { x: number; y: number };
}

function plateOf(s: Surface, kind: SurfaceKind): Plate | null {
    const plane = planeOfPolygon(s.boundaryMm);
    if (!plane) return null;
    const xs = s.boundaryMm.map((p) => p.x);
    const ys = s.boundaryMm.map((p) => p.y);
    return {
        s,
        kind,
        height: (x, y) => planeHeightAt(plane, x, y),
        lo: { x: Math.min(...xs), y: Math.min(...ys) },
        hi: { x: Math.max(...xs), y: Math.max(...ys) },
    };
}

/** The floors and roofs, filed by plan cell. */
function plateIndex(plates: readonly Plate[]): (x: number, y: number) => Plate[] {
    const cells = new Map<string, Plate[]>();
    const cell = (v: number) => Math.floor(v / CELL_MM);
    for (const p of plates) {
        for (let i = cell(p.lo.x); i <= cell(p.hi.x); i++) {
            for (let j = cell(p.lo.y); j <= cell(p.hi.y); j++) {
                const key = `${i},${j}`;
                cells.set(key, [...(cells.get(key) ?? []), p]);
            }
        }
    }
    return (x, y) => cells.get(`${cell(x)},${cell(y)}`) ?? [];
}

/**
 * Whether a point is in the house: the highest floor or roof under it, where it is not cut out
 * of that face, is a floor.
 */
function inHouse(p: Point3Mm, near: (x: number, y: number) => Plate[]): boolean {
    let best: Plate | null = null;
    let bestZ = -Infinity;
    for (const plate of near(p.x, p.y)) {
        if (p.x < plate.lo.x || p.x > plate.hi.x || p.y < plate.lo.y || p.y > plate.hi.y) continue;
        const z = plate.height(p.x, p.y);
        if (z === null || z > p.z || z <= bestZ) continue;
        if (!pointInPolygonPlan(p, plate.s.boundaryMm)) continue;
        if (plate.s.holes.some((h) => pointInPolygonPlan(p, h))) continue;
        best = plate;
        bestZ = z;
    }
    return best?.kind === 'floor';
}

/** The faces of the shell: see the module doc. */
function shellFaces(
    surfaces: readonly Surface[],
    kinds: ReadonlyMap<SurfaceId, SurfaceKind>
): Surface[] {
    const plates = surfaces
        .filter((s) => kinds.get(s.id) !== 'wall')
        .map((s) => plateOf(s, kinds.get(s.id)!))
        .filter((p): p is Plate => p !== null);
    const near = plateIndex(plates);
    const facesOutside = (s: Surface): boolean => {
        const ring = s.boundaryMm;
        const foot = Math.min(...ring.map((p) => p.z));
        // The wall's line in plan: its two corners furthest apart.
        let [a, b] = [ring[0]!, ring[0]!];
        for (const p of ring)
            for (const q of ring)
                if (Math.hypot(p.x - q.x, p.y - q.y) > Math.hypot(a.x - b.x, a.y - b.y))
                    [a, b] = [p, q];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1) return false;
        const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: foot + PROBE_MM };
        const side = (k: number) =>
            inHouse(
                { x: mid.x + k * n.x * PROBE_MM, y: mid.y + k * n.y * PROBE_MM, z: mid.z },
                near
            );
        return side(1) !== side(-1);
    };
    // A floor with the house under it too (one between storeys, round a room rising through it)
    // is inside: only one over the ground or the weather is shell.
    const overOutside = (s: Surface): boolean => {
        const plate = plates.find((p) => p.s === s);
        const at = plate && pointOnFace(s);
        if (!plate || !at) return true;
        const z = plate.height(at.x, at.y);
        return z === null || !inHouse({ ...at, z: z - PROBE_MM }, near);
    };
    return surfaces.filter((s) => {
        const kind = kinds.get(s.id);
        return kind === 'roof' || (kind === 'wall' ? facesOutside(s) : overOutside(s));
    });
}

/** A point of a face in plan, just inside one of its edges and in none of its holes. */
function pointOnFace(s: Surface): { x: number; y: number } | null {
    const ring = s.boundaryMm;
    const sign = signedArea2(ring.map((p) => ({ x: p.x, y: p.y }))) >= 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
        const [p, q] = [ring[i]!, ring[(i + 1) % ring.length]!];
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len < 4 * PROBE_MM) continue;
        const at = {
            x: (p.x + q.x) / 2 - ((q.y - p.y) / len) * PROBE_MM * sign,
            y: (p.y + q.y) / 2 + ((q.x - p.x) / len) * PROBE_MM * sign,
        };
        if (pointInPolygonPlan(at, ring) && !s.holes.some((h) => pointInPolygonPlan(at, h)))
            return at;
    }
    return null;
}

// ---- The open edges ----------------------------------------------------------------------------

function edgesOf(ring: readonly Point3Mm[]): Edge[] {
    return ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as const);
}

/**
 * Every stretch of an edge of a face of `checked` that no other face of `shell` (the shell, and
 * every floor and roof) closes: runs along, or has it lying in it.
 */
function openEdges(
    checked: readonly Surface[],
    shell: readonly Surface[],
    kinds: ReadonlyMap<SurfaceId, SurfaceKind>
): WatertightLeak[] {
    const looked = new Set(checked.map((s) => s.id));
    const all = shell.flatMap((s) =>
        [s.boundaryMm, ...s.holes].flatMap((ring) => edgesOf(ring).map((e) => ({ e, id: s.id })))
    );
    const cells = new Map<string, number[]>();
    const cell = (v: number) => Math.floor(v / CELL_MM);
    const keysOf = ([p, q]: Edge): string[] => {
        const keys: string[] = [];
        const [x0, x1] = [
            cell(Math.min(p.x, q.x) - ON_EDGE_MM),
            cell(Math.max(p.x, q.x) + ON_EDGE_MM),
        ];
        const [y0, y1] = [
            cell(Math.min(p.y, q.y) - ON_EDGE_MM),
            cell(Math.max(p.y, q.y) + ON_EDGE_MM),
        ];
        for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) keys.push(`${i},${j}`);
        return keys;
    };
    all.forEach(({ e }, k) => {
        for (const key of keysOf(e)) cells.set(key, [...(cells.get(key) ?? []), k]);
    });
    // The faces, filed by plan cell as the edges are, each with its plane and its rings in it.
    const faceCells = new Map<string, number[]>();
    shell.forEach((s, k) => {
        const xs = s.boundaryMm.map((p) => p.x);
        const ys = s.boundaryMm.map((p) => p.y);
        const box: Edge = [
            { x: Math.min(...xs), y: Math.min(...ys), z: 0 },
            { x: Math.max(...xs), y: Math.max(...ys), z: 0 },
        ];
        for (const key of keysOf(box)) faceCells.set(key, [...(faceCells.get(key) ?? []), k]);
    });
    const framed = new Map<number, { frame: Frame3; plane: Plane3; rings: Vec2Mm[][] } | null>();
    const frameOf = (k: number) => {
        if (!framed.has(k)) {
            const s = shell[k]!;
            const frame = surfaceFrame(s.boundaryMm);
            const plane = planeOfPolygon(s.boundaryMm);
            framed.set(
                k,
                frame && plane
                    ? {
                          frame,
                          plane,
                          rings: [s.boundaryMm, ...s.holes].map((r) =>
                              r.map((p) => toFrameUv(frame, p))
                          ),
                      }
                    : null
            );
        }
        return framed.get(k)!;
    };
    /** The stretches of `e`, by distance from its start, that lie in another face of the shell. */
    const inFaces = ([p, q]: Edge, id: SurfaceId, len: number): [number, number][] =>
        [...new Set(keysOf([p, q]).flatMap((key) => faceCells.get(key) ?? []))]
            .filter((k) => shell[k]!.id !== id)
            .flatMap((k) => {
                const f = frameOf(k);
                if (!f || [p, q].some((r) => Math.abs(distanceToPlane(r, f.plane)) > ON_EDGE_MM))
                    return [];
                const [a, b] = [toFrameUv(f.frame, p), toFrameUv(f.frame, q)];
                const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
                return clipLineToPolygon2(a, d, f.rings).map(
                    ({ t0, t1 }) => [Math.max(0, t0), Math.min(len, t1)] as [number, number]
                );
            })
            .filter(([t0, t1]) => t1 > t0);
    const leaks: WatertightLeak[] = [];
    all.forEach(({ e, id }) => {
        if (!looked.has(id)) return;
        const [p, q] = e;
        const len = distance3(p, q);
        if (len < MIN_LEAK_MM) return;
        const near = new Set(keysOf(e).flatMap((key) => cells.get(key) ?? []));
        const covered = [...near]
            .filter((k) => all[k]!.id !== id)
            .map((k) => collinearOverlap3(p, q, all[k]!.e[0], all[k]!.e[1], ON_EDGE_MM, ON_EDGE_MM))
            .filter((o): o is [Point3Mm, Point3Mm] => o !== null)
            .map(
                ([a, b]) =>
                    [distance3(p, a), distance3(p, b)].sort((x, y) => x - y) as [number, number]
            )
            .concat(inFaces(e, id, len))
            .sort((x, y) => x[0] - y[0]);
        const at = (t: number): Point3Mm => ({
            x: p.x + ((q.x - p.x) * t) / len,
            y: p.y + ((q.y - p.y) * t) / len,
            z: p.z + ((q.z - p.z) * t) / len,
        });
        let reached = 0;
        for (const [t0, t1] of [...covered, [len, len] as [number, number]]) {
            if (t0 - reached >= MIN_LEAK_MM) {
                leaks.push({
                    faceId: id,
                    kind: kinds.get(id)!,
                    fromMm: at(reached),
                    toMm: at(t0),
                    lengthMm: Math.round(t0 - reached),
                });
            }
            reached = Math.max(reached, t1);
        }
    });
    return leaks;
}
