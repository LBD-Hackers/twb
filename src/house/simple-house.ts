/**
 * The simple shape of a house file: walls as plan lines, a wall height, windows and doors by
 * their centre, and a roof by its type and pitch — expanded here into the ordinary `surfaces`
 * before `house-file.ts` reads them, so everything past the parser sees the same faces a file
 * written corner by corner would have given it.
 *
 * It exists for whoever reads a drawing: a language model reading a plan is asked for this shape, not for faces, because the numbers in it are the ones a plan and a section
 * print — where the walls run, how high they are, where a window sits and how big it is, what the
 * roof is and how steep. Every corner that has to be *worked out* — the gable's apex, the valley
 * where an L's two roofs meet, the top of a wall under a sloping roof, a window's four corners on
 * its wall — is worked out here instead, exactly, by `@surfacekit/model`'s `generateRoof`.
 *
 * ```json
 * {
 *     "@context": "https://w3id.org/twb/context/2.jsonld",
 *     "format": "twb/1",
 *     "type": "Blueprint",
 *     "wallHeightMm": 2400,
 *     "walls": [{ "id": "south", "points": [[0, 0], [9600, 0]] }, ...],
 *     "openings": [{ "kind": "window", "at": [2400, 0], "widthMm": 1200, "heightMm": 1200, "sillMm": 900 }],
 *     "roof": { "type": "gable", "pitchDeg": 25 }
 * }
 * ```
 *
 * - `walls`: each a plan polyline, `[x, y]` mm, along the frame's centreline — a timber wall's
 *   studs, a masonry wall's inner leaf (whose cavity is widened to put the brick on the module:
 *   `moduleCavityMm`); every segment is a wall. The building's outline is traced around the outside of them (`surfacekit/model/plan-outline.ts`), so they
 *   may come in any order and direction. They stand from the lowest storey's floor to the roof,
 *   split into one face per storey.
 * - `wallHeightMm`: the eave height above that floor, where the roof leaves the walls. A wall no
 *   roof covers stops here.
 * - `openings`: each on the wall line nearest its `at`, centred there; `sillMm` above the floor
 *   of its `storey` (the lowest one when left out), 0 for a door. The nearest line may be an
 *   `interiorWalls` run: a door between two rooms is written exactly as a front door is. Those
 *   partitions are not faces yet here, so such an opening comes back as an `InteriorOpening` —
 *   its two jambs on the run's line — and is cut into the partition once it has been built
 *   (`load.ts`'s `placeInteriorOpenings`). An opening in an exterior wall may carry its
 *   own finish as `detail` (a `twb:OpeningDetail`); left out, its kind's standard. Any
 *   opening may carry its division as `glazing` — `{ "mullions": 1, "panes": [2, 3] }` — which
 *   the face's `openingGlazing` checks; left out, one pane. A door in an exterior wall may say
 *   how many leaves it has, `"leaves": "double"` or `"one-and-a-half"`, which the face's
 *   `openingSwings` checks; left out, one.
 * - `roof`: `{ type, pitchDeg, ridge?, highSide?, cover?, outline?, eaveMm? }` over the outline,
 *   or a list of them, each over its own `outline`, for a house whose parts have different roofs.
 *   By default the roof runs on over a shallow recess in one side (`cover`); the walls round the
 *   recess then stand under the roof, and rise to it.
 *
 * Input only, like `interiorWalls`: Save writes the faces this makes, not this.
 */

import type { Point3Mm, Vec2Mm } from '../surfacekit/core';
import {
    DEFAULT_WALL_HEIGHT_MM,
    OPENING_KINDS,
    RIDGE_AXES,
    ROOF_COVERS,
    ROOF_SIDES,
    ROOF_TYPES,
    generateRoof,
    outerOutline,
    roofProfile,
    type OpeningKind,
    type PlanSegment,
    type RidgeAxis,
    type RoofCover,
    type RoofSide,
    type RoofType,
    type Surface,
} from '../surfacekit/model';

/** A face as the file writes it — what `parseHouseFile` reads from `surfaces`. */
export interface SimpleFace {
    id: string;
    points: [number, number, number][];
    openings?: [number, number, number][][];
    openingKinds?: OpeningKind[];
    /** Per opening, its own finish (a `twb:OpeningDetail` id), or null for its kind's standard. */
    openingDetails?: (string | null)[];
    /** Per opening, its division as the file gave it, or null for one pane. */
    openingGlazing?: (Record<string, unknown> | null)[];
    /** Per opening, a door's leaves as the file gave them (`{ leaves }`), or null for one leaf. */
    openingSwings?: ({ leaves: string } | null)[];
    kind?: 'roof';
    roofGroup?: string;
}

/**
 * A window or door in an interior partition, as the file places it: its two jambs in plan on the
 * partition's line, and its sill and height above the floor of its storey. Cut into the
 * partition's face once the partition is built — see the module doc.
 */
export interface InteriorOpening {
    kind: OpeningKind;
    /** The storey it stands on, by name; null for the lowest. */
    storeyName: string | null;
    aMm: Vec2Mm;
    bMm: Vec2Mm;
    sillMm: number;
    heightMm: number;
}

/** What the simple shape expands to: the faces, and the openings waiting for their partitions. */
export interface SimpleHouse {
    faces: SimpleFace[];
    interiorOpenings: InteriorOpening[];
}

/** How far an opening's `at` may be from its wall's line, mm. */
const OPENING_REACH_MM = 600;
/** A window's sill when the file does not say, mm. */
const DEFAULT_SILL_MM = 900;
/** How far a corner may be off a line and still be on it, mm. */
const ON_MM = 1;

/** Whether the file uses the simple shape at all. */
export function isSimpleHouse(json: Record<string, unknown>): boolean {
    return json['walls'] !== undefined || json['roof'] !== undefined;
}

interface WallLine {
    id: string;
    a: Vec2Mm;
    b: Vec2Mm;
}

/** One segment of an `interiorWalls` run, and the storey the run starts on. */
interface PartitionLine {
    storey: string | null;
    a: Vec2Mm;
    b: Vec2Mm;
}

interface RoofPart {
    type: RoofType;
    pitchDeg: number;
    ridge: RidgeAxis | null;
    highSide: RoofSide | null;
    cover: RoofCover | null;
    outline: Vec2Mm[] | null;
    eaveMm: number | null;
}

/** A point of a wall's top: how far along the wall, and how high. */
interface TopPoint {
    t: number;
    z: number;
}

/** The faces the simple shape describes. Problems go to `errors`, each naming where it is. */
export function expandSimpleHouse(json: Record<string, unknown>, errors: string[]): SimpleHouse {
    const wallHeight = readHeight(json['wallHeightMm'], 'wallHeightMm', errors);
    const lines = readWalls(json['walls'], errors);
    const partitions = readPartitions(json['interiorWalls']);
    const levels = readLevels(json['storeys']);
    const base = levels[0]?.elevationMm ?? 0;
    const eave = base + wallHeight;
    const parts = readRoof(json['roof'], errors);

    const segments: PlanSegment[] = lines.map((w) => [w.a, w.b]);
    const outline = segments.length > 0 ? outerOutline(segments) : null;
    const floorRing = segments.length > 0 ? outerOutline(segments, true) : null;
    if (lines.length > 0 && !outline) {
        errors.push('"walls" do not close around the house: the outline could not be traced.');
    }

    const faces: SimpleFace[] = [];
    if (floorRing) {
        faces.push({ id: 'floor', points: floorRing.map((p) => [p.x, p.y, base]) });
        for (const level of levels.slice(1)) {
            if (level.elevationMm >= eave) {
                errors.push(
                    `storey "${level.name}" starts above the eaves; its floor is not generated — draw it by hand.`
                );
                continue;
            }
            faces.push({
                id: `floor-${slug(level.name)}`,
                points: floorRing.map((p) => [p.x, p.y, level.elevationMm]),
            });
        }
    }

    // The roof, part by part.
    const roofFaces: Point3Mm[][] = [];
    if (parts.length > 1 && parts.some((p) => !p.outline)) {
        errors.push('"roof": with more than one part, every part needs its own "outline".');
    } else {
        parts.forEach((part, k) => {
            const where = parts.length > 1 ? `roof[${k}]` : 'roof';
            const over = part.outline ?? outline;
            if (!over) {
                if (lines.length === 0)
                    errors.push(`${where}.outline is needed when there are no "walls".`);
                return;
            }
            const result = generateRoof(over, {
                type: part.type,
                pitchDeg: part.pitchDeg,
                eaveMm: part.eaveMm ?? eave,
                ridge: part.ridge,
                highSide: part.highSide,
                cover: part.cover,
            });
            if (!result.ok) {
                errors.push(`${where}: ${result.error}`);
                return;
            }
            const prefix = parts.length > 1 ? `roof-${k + 1}` : 'roof';
            const group = `roof-${k + 1}`;
            result.roof.planes.forEach((ring, n) => {
                roofFaces.push(ring);
                faces.push({
                    id: `${prefix}-${n + 1}`,
                    points: ring.map(toFile),
                    roofGroup: group,
                    ...(part.type === 'flat' ? { kind: 'roof' as const } : {}),
                });
            });
            result.roof.steps.forEach((ring, n) => {
                faces.push({ id: `${prefix}-step-${n + 1}`, points: ring.map(toFile) });
            });
        });
    }

    // The walls, each up to the roof over it, one face per storey.
    const roofSurfaces = roofFaces.map((ring, i) => asSurface(`r${i}`, ring));
    const wallFaces: { line: WallLine; lo: number; hi: number; face: SimpleFace }[] = [];
    const tops: Point3Mm[] = [];
    for (const line of lines) {
        const top = wallTop(line, roofFaces, roofSurfaces, eave, base);
        for (const pt of top) tops.push(at(line, pt));
        const bands = levels.length > 0 ? levels.map((l) => l.elevationMm) : [base];
        bands.forEach((lo, k) => {
            const hi = k + 1 < bands.length ? bands[k + 1]! : Infinity;
            const runs = runsAbove(clampTop(top, hi), lo);
            runs.forEach((run, r) => {
                const ring = [
                    at(line, { t: run[0]!.t, z: lo }),
                    at(line, { t: run[run.length - 1]!.t, z: lo }),
                    ...run
                        .slice()
                        .reverse()
                        .map((pt) => at(line, pt)),
                ];
                const suffix =
                    (bands.length > 1 ? `-${slug(levels[k]!.name)}` : '') +
                    (runs.length > 1 ? `-${r + 1}` : '');
                const face: SimpleFace = {
                    id: `${line.id}${suffix}`,
                    points: dedupe(ring).map(toFile),
                };
                if (face.points.length >= 3) wallFaces.push({ line, lo, hi, face });
            });
        });
    }
    faces.push(...wallFaces.map((w) => w.face));

    // A wall's top corners go into the roof faces they sit on, so the two share them.
    for (const face of faces) {
        if (!face.roofGroup) continue;
        face.points = withCorners(face.points.map(fromFile), tops).map(toFile);
    }

    // The openings, each on its wall — an exterior one, or a partition.
    const interiorOpenings: InteriorOpening[] = [];
    readOpenings(json['openings'], errors).forEach((o, i) => {
        const where = `openings[${i}]`;
        const level = o.storey === null ? levels[0] : levels.find((l) => l.name === o.storey);
        if (o.storey !== null && !level) {
            errors.push(
                `${where}.storey ${JSON.stringify(o.storey)} names no storey in this file.`
            );
            return;
        }
        let best: WallLine | null = null;
        let bestOff = Infinity;
        for (const line of lines) {
            const off = distanceToSegment(o.at, line.a, line.b);
            if (off < bestOff) {
                best = line;
                bestOff = off;
            }
        }
        // A partition climbs from the storey it starts on, so it only holds openings from there up.
        const reaches = (p: PartitionLine) => {
            const from = p.storey === null ? levels[0] : levels.find((l) => l.name === p.storey);
            return !from || !level || from.elevationMm <= level.elevationMm;
        };
        let partition: PartitionLine | null = null;
        for (const p of partitions.filter(reaches)) {
            const off = distanceToSegment(o.at, p.a, p.b);
            if (off < bestOff) {
                partition = p;
                bestOff = off;
            }
        }
        if (bestOff > OPENING_REACH_MM) {
            errors.push(
                `${where}.at is not on any wall — it is ${Math.round(bestOff)} mm from the nearest.`
            );
            return;
        }
        if (partition) {
            const len = Math.hypot(partition.b.x - partition.a.x, partition.b.y - partition.a.y);
            const ux = (partition.b.x - partition.a.x) / len;
            const uy = (partition.b.y - partition.a.y) / len;
            const centre = (o.at.x - partition.a.x) * ux + (o.at.y - partition.a.y) * uy;
            const jamb = (t: number): Vec2Mm => ({
                x: Math.round(partition.a.x + ux * t),
                y: Math.round(partition.a.y + uy * t),
            });
            interiorOpenings.push({
                kind: o.kind,
                storeyName: o.storey,
                aMm: jamb(centre - o.widthMm / 2),
                bMm: jamb(centre + o.widthMm / 2),
                sillMm: o.sillMm,
                heightMm: o.heightMm,
            });
            return;
        }
        const floor = level?.elevationMm ?? base;
        const zLo = floor + o.sillMm;
        const zHi = zLo + o.heightMm;
        // Nearer than the reach, and no partition: an exterior wall.
        const line = best!;
        const host = wallFaces.find(
            (w) => w.line === line && w.lo <= zLo + ON_MM && zHi <= w.hi + ON_MM
        );
        if (!host) {
            errors.push(`${where} does not fit on one storey of wall "${line.id}".`);
            return;
        }
        const len = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
        const centre =
            ((o.at.x - line.a.x) * (line.b.x - line.a.x) +
                (o.at.y - line.a.y) * (line.b.y - line.a.y)) /
            len;
        const t0 = centre - o.widthMm / 2;
        const t1 = centre + o.widthMm / 2;
        const ring = [
            at(line, { t: t0, z: zLo }),
            at(line, { t: t1, z: zLo }),
            at(line, { t: t1, z: zHi }),
            at(line, { t: t0, z: zHi }),
        ].map(toFile);
        host.face.openings = [...(host.face.openings ?? []), ring];
        host.face.openingKinds = [...(host.face.openingKinds ?? []), o.kind];
        // Only an opening with a finish of its own writes the list, padded to line up with the rest.
        const details = host.face.openingDetails ?? [];
        if (o.detail !== null || details.length > 0) {
            host.face.openingDetails = [
                ...details,
                ...Array<null>(host.face.openings.length - 1 - details.length).fill(null),
                o.detail,
            ];
        }
        const glazings = host.face.openingGlazing ?? [];
        if (o.glazing !== null || glazings.length > 0) {
            host.face.openingGlazing = [
                ...glazings,
                ...Array<null>(host.face.openings.length - 1 - glazings.length).fill(null),
                o.glazing,
            ];
        }
        const swings = host.face.openingSwings ?? [];
        if (o.leaves !== null || swings.length > 0) {
            host.face.openingSwings = [
                ...swings,
                ...Array<null>(host.face.openings.length - 1 - swings.length).fill(null),
                o.leaves === null ? null : { leaves: o.leaves },
            ];
        }
    });

    return { faces, interiorOpenings };
}

/**
 * The top of a wall, from its start to its end: along the roof edge it stands under, or the
 * roof's height over it where it stands inside the roof, or flat at the eave where no roof is.
 * A step in the roof over the wall's line comes out as two points at the same `t`.
 */
function wallTop(
    line: WallLine,
    roofFaces: readonly Point3Mm[][],
    roofSurfaces: readonly Surface[],
    eave: number,
    base: number
): TopPoint[] {
    const len = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
    const ux = (line.b.x - line.a.x) / len;
    const uy = (line.b.y - line.a.y) / len;
    const off = (p: Vec2Mm) => Math.abs((p.x - line.a.x) * uy - (p.y - line.a.y) * ux);
    const along = (p: Vec2Mm) => (p.x - line.a.x) * ux + (p.y - line.a.y) * uy;

    // Roof edges running along the wall's line: the wall stands at the roof's edge.
    const pieces: [TopPoint, TopPoint][] = [];
    for (const ring of roofFaces) {
        ring.forEach((p, i) => {
            const q = ring[(i + 1) % ring.length]!;
            if (off(p) > ON_MM || off(q) > ON_MM) return;
            let [s, e] = [
                { t: along(p), z: p.z },
                { t: along(q), z: q.z },
            ];
            if (Math.abs(e.t - s.t) < ON_MM) return;
            if (e.t < s.t) [s, e] = [e, s];
            const from = Math.max(s.t, 0);
            const to = Math.min(e.t, len);
            if (to - from < ON_MM) return;
            const zAt = (t: number) => s.z + ((e.z - s.z) * (t - s.t)) / (e.t - s.t);
            pieces.push([
                { t: from, z: zAt(from) },
                { t: to, z: zAt(to) },
            ]);
        });
    }
    if (pieces.length > 0) return upperEnvelope(pieces, len, eave);

    // Under the roof, off its edge: the roof's height over the wall's line.
    const profile =
        roofSurfaces.length > 0 ? roofProfile(roofSurfaces, line.a, line.b, base) : null;
    if (profile) return profile.map((p) => ({ t: along(p), z: p.z }));
    return [
        { t: 0, z: eave },
        { t: len, z: eave },
    ];
}

/**
 * The highest of the pieces over every point of the wall, flat at the eave where none reaches:
 * where a lower roof (an annex's) runs along a wall a higher one's gable stands on, the wall
 * follows the gable. A jump between two roofs comes out as two points at the same `t`.
 */
function upperEnvelope(
    pieces: readonly [TopPoint, TopPoint][],
    len: number,
    eave: number
): TopPoint[] {
    const zAt = ([s, e]: readonly [TopPoint, TopPoint], t: number) =>
        s.z + ((e.z - s.z) * (t - s.t)) / (e.t - s.t);
    const cuts = new Set<number>([0, len]);
    for (const [s, e] of pieces) {
        cuts.add(s.t);
        cuts.add(e.t);
    }
    // Where two pieces cross, the higher one changes.
    for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < pieces.length; j++) {
            const m = pieces[i]!;
            const n = pieces[j]!;
            const from = Math.max(m[0].t, n[0].t);
            const to = Math.min(m[1].t, n[1].t);
            if (to - from < ON_MM) continue;
            const d0 = zAt(m, from) - zAt(n, from);
            const d1 = zAt(m, to) - zAt(n, to);
            if (d0 * d1 < 0) cuts.add(from + ((to - from) * d0) / (d0 - d1));
        }
    }
    const ts = [...cuts].filter((t) => t >= 0 && t <= len).sort((a, b) => a - b);
    const top: TopPoint[] = [];
    for (let i = 0; i + 1 < ts.length; i++) {
        const [t0, t1] = [ts[i]!, ts[i + 1]!];
        if (t1 - t0 < 0.01) continue;
        const mid = (t0 + t1) / 2;
        const over = pieces.filter(([s, e]) => s.t <= mid && e.t >= mid);
        const high = (t: number) =>
            over.length > 0 ? Math.max(...over.map((p) => zAt(p, t))) : eave;
        top.push({ t: t0, z: high(t0) }, { t: t1, z: high(t1) });
    }
    return dropStraightTop(dedupeTop(top));
}

/** Drops points of the top on a straight run between their neighbours, keeping every jump. */
function dropStraightTop(top: TopPoint[]): TopPoint[] {
    const out: TopPoint[] = [];
    for (const p of top) {
        while (out.length >= 2) {
            const a = out[out.length - 2]!;
            const b = out[out.length - 1]!;
            if (b.t - a.t < 0.01 || p.t - b.t < 0.01) break;
            const expected = a.z + ((p.z - a.z) * (b.t - a.t)) / (p.t - a.t);
            if (Math.abs(expected - b.z) > 0.5) break;
            out.pop();
        }
        out.push(p);
    }
    return out;
}

/** The top cut down to `hi` wherever it rises above it. */
function clampTop(top: readonly TopPoint[], hi: number): TopPoint[] {
    if (hi === Infinity) return top.slice();
    const out: TopPoint[] = [];
    top.forEach((p, i) => {
        const prev = top[i - 1];
        if (prev && (prev.z - hi) * (p.z - hi) < 0 && p.t > prev.t) {
            const t = prev.t + ((hi - prev.z) * (p.t - prev.t)) / (p.z - prev.z);
            out.push({ t, z: hi });
        }
        out.push({ t: p.t, z: Math.min(p.z, hi) });
    });
    return dedupeTop(out);
}

/** The stretches of the top that stand above `lo`, each starting and ending on it or at a wall end. */
function runsAbove(top: readonly TopPoint[], lo: number): TopPoint[][] {
    const pts: TopPoint[] = [];
    top.forEach((p, i) => {
        const prev = top[i - 1];
        if (prev && (prev.z - lo) * (p.z - lo) < 0 && p.t > prev.t) {
            pts.push({ t: prev.t + ((lo - prev.z) * (p.t - prev.t)) / (p.z - prev.z), z: lo });
        }
        pts.push(p);
    });
    // A run is every stretch between two points that stands above `lo` along its length.
    const runs: TopPoint[][] = [];
    let run: TopPoint[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
        const p = pts[i]!;
        const q = pts[i + 1]!;
        if ((p.z + q.z) / 2 > lo + ON_MM) {
            if (run.length === 0) run.push(p);
            run.push(q);
        } else if (run.length > 0) {
            runs.push(run);
            run = [];
        }
    }
    if (run.length > 0) runs.push(run);
    return runs
        .map((r) => dedupeTop(r.map((p) => ({ t: p.t, z: Math.max(p.z, lo) }))))
        .filter((r) => r.length >= 2 && r[r.length - 1]!.t - r[0]!.t > ON_MM);
}

function dedupeTop(top: readonly TopPoint[]): TopPoint[] {
    const out: TopPoint[] = [];
    for (const p of top) {
        const last = out[out.length - 1];
        if (!last || Math.abs(last.t - p.t) > 0.01 || Math.abs(last.z - p.z) > 0.01) out.push(p);
    }
    return out;
}

/** A point of a wall's plane, rounded to the millimetre. */
function at(line: WallLine, pt: TopPoint): Point3Mm {
    const len = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
    const k = pt.t / len;
    return {
        x: Math.round(line.a.x + (line.b.x - line.a.x) * k),
        y: Math.round(line.a.y + (line.b.y - line.a.y) * k),
        z: Math.round(pt.z),
    };
}

/** `ring` with every corner of `extra` that lies on one of its edges, strictly inside it, added. */
function withCorners(ring: readonly Point3Mm[], extra: readonly Point3Mm[]): Point3Mm[] {
    const out: Point3Mm[] = [];
    ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        out.push(p);
        const d = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
        const len2 = d.x * d.x + d.y * d.y + d.z * d.z;
        if (len2 === 0) return;
        const inside = extra
            .map((e) => {
                const t = ((e.x - p.x) * d.x + (e.y - p.y) * d.y + (e.z - p.z) * d.z) / len2;
                const off = Math.hypot(
                    p.x + d.x * t - e.x,
                    p.y + d.y * t - e.y,
                    p.z + d.z * t - e.z
                );
                return { e, t, off };
            })
            .filter(
                ({ t, off }) =>
                    off <= ON_MM && t * Math.sqrt(len2) > ON_MM && (1 - t) * Math.sqrt(len2) > ON_MM
            )
            .sort((m, n) => m.t - n.t);
        for (const { e } of inside) {
            const last = out[out.length - 1]!;
            if (last.x !== e.x || last.y !== e.y || last.z !== e.z) out.push(e);
        }
    });
    return out;
}

function dedupe(ring: readonly Point3Mm[]): Point3Mm[] {
    const out: Point3Mm[] = [];
    for (const p of ring) {
        const last = out[out.length - 1];
        if (!last || last.x !== p.x || last.y !== p.y || last.z !== p.z) out.push(p);
    }
    while (out.length > 1) {
        const a = out[0]!;
        const b = out[out.length - 1]!;
        if (a.x === b.x && a.y === b.y && a.z === b.z) out.pop();
        else break;
    }
    return out;
}

function distanceToSegment(p: Vec2Mm, a: Vec2Mm, b: Vec2Mm): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function asSurface(id: string, ring: readonly Point3Mm[]): Surface {
    return {
        id,
        boundaryMm: ring,
        openings: [],
        holes: [],
        kindOverride: null,
        loadBearing: null,
        spanDirectionOverride: null,
        roofGroupId: null,
        studSectionOverride: null,
    };
}

const toFile = (p: Point3Mm): [number, number, number] => [p.x, p.y, p.z];
const fromFile = (p: [number, number, number]): Point3Mm => ({ x: p[0], y: p[1], z: p[2] });

/** An id-safe form of a storey's name. */
function slug(name: string): string {
    return (
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'storey'
    );
}

// ---- Reading ----

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readHeight(raw: unknown, where: string, errors: string[]): number {
    if (raw === undefined) return DEFAULT_WALL_HEIGHT_MM;
    if (isFiniteNumber(raw) && raw > 0) return Math.round(raw);
    errors.push(`"${where}" must be a height in millimetres — ${DEFAULT_WALL_HEIGHT_MM} is used.`);
    return DEFAULT_WALL_HEIGHT_MM;
}

function readPlanPoints(
    raw: unknown,
    min: number,
    where: string,
    errors: string[]
): Vec2Mm[] | null {
    if (!Array.isArray(raw) || raw.length < min) {
        errors.push(`${where} must be an array of at least ${min} [x, y] corners.`);
        return null;
    }
    const out: Vec2Mm[] = [];
    for (let k = 0; k < raw.length; k++) {
        const p = raw[k];
        if (!Array.isArray(p) || p.length !== 2 || !p.every(isFiniteNumber)) {
            errors.push(`${where}[${k}] must be [x, y] in millimetres.`);
            return null;
        }
        out.push({ x: Math.round(p[0] as number), y: Math.round(p[1] as number) });
    }
    return out;
}

/**
 * The segments of the `interiorWalls` runs, for an opening to find its partition by. Read leniently:
 * a run with a bad corner is left out here and reported by `house-file.ts`, which reads them for real.
 */
function readPartitions(raw: unknown): PartitionLine[] {
    if (!Array.isArray(raw)) return [];
    const out: PartitionLine[] = [];
    for (const entry of raw) {
        if (!isRecord(entry)) continue;
        const points = readPlanPoints(entry['points'], 2, '', []);
        if (!points) continue;
        const storey =
            typeof entry['storey'] === 'string' && entry['storey'] ? entry['storey'] : null;
        for (let k = 0; k + 1 < points.length; k++) {
            const a = points[k]!;
            const b = points[k + 1]!;
            if (Math.hypot(b.x - a.x, b.y - a.y) >= ON_MM) out.push({ storey, a, b });
        }
    }
    return out;
}

function readWalls(raw: unknown, errors: string[]): WallLine[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
        errors.push('"walls" must be an array of { "points": [[x, y], ...] }.');
        return [];
    }
    const lines: WallLine[] = [];
    const taken = new Set<string>();
    raw.forEach((entry, i) => {
        const where = `walls[${i}]`;
        const pointsRaw = isRecord(entry) ? entry['points'] : entry;
        const points = readPlanPoints(pointsRaw, 2, `${where}.points`, errors);
        if (!points) return;
        const named =
            isRecord(entry) && typeof entry['id'] === 'string' && entry['id'] ? entry['id'] : null;
        let id = named ? (named.startsWith('wall') ? named : `wall-${named}`) : `wall-${i + 1}`;
        while (taken.has(id)) id = `${id}-${i + 1}`;
        taken.add(id);
        for (let k = 0; k + 1 < points.length; k++) {
            const a = points[k]!;
            const b = points[k + 1]!;
            if (Math.hypot(b.x - a.x, b.y - a.y) < ON_MM) continue;
            lines.push({ id: points.length > 2 ? `${id}-${k + 1}` : id, a, b });
        }
    });
    return lines;
}

/** Just the storeys' names and elevations, lowest first — the parser reads the rest. */
function readLevels(raw: unknown): { name: string; elevationMm: number }[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(isRecord)
        .filter((s) => typeof s['name'] === 'string' && isFiniteNumber(s['elevationMm']))
        .map((s) => ({
            name: s['name'] as string,
            elevationMm: Math.round(s['elevationMm'] as number),
        }))
        .sort((a, b) => a.elevationMm - b.elevationMm);
}

function readRoof(raw: unknown, errors: string[]): RoofPart[] {
    if (raw === undefined) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    const parts: RoofPart[] = [];
    list.forEach((entry, i) => {
        const where = Array.isArray(raw) ? `roof[${i}]` : 'roof';
        if (!isRecord(entry)) {
            errors.push(`${where} must be { "type", "pitchDeg" }.`);
            return;
        }
        const type = entry['type'];
        if (!ROOF_TYPES.includes(type as RoofType)) {
            errors.push(`${where}.type must be one of ${ROOF_TYPES.join(', ')}.`);
            return;
        }
        const pitch = entry['pitchDeg'];
        if (type !== 'flat' && !isFiniteNumber(pitch)) {
            errors.push(`${where}.pitchDeg must be the roof's pitch in degrees.`);
            return;
        }
        const ridge = entry['ridge'];
        if (ridge !== undefined && !RIDGE_AXES.includes(ridge as RidgeAxis)) {
            errors.push(
                `${where}.ridge must be "x" or "y" — it runs along the longer side instead.`
            );
        }
        const highSide = entry['highSide'];
        if (highSide !== undefined && !ROOF_SIDES.includes(highSide as RoofSide)) {
            errors.push(`${where}.highSide must be one of ${ROOF_SIDES.join(', ')}.`);
        }
        const cover = entry['cover'];
        if (cover !== undefined && !ROOF_COVERS.includes(cover as RoofCover)) {
            errors.push(`${where}.cover must be one of ${ROOF_COVERS.join(', ')}.`);
        }
        const eave = entry['eaveMm'];
        if (eave !== undefined && !isFiniteNumber(eave)) {
            errors.push(
                `${where}.eaveMm must be a height in millimetres — the wall height is used.`
            );
        }
        const outline =
            entry['outline'] === undefined
                ? null
                : readPlanPoints(entry['outline'], 3, `${where}.outline`, errors);
        if (entry['outline'] !== undefined && !outline) return;
        parts.push({
            type: type as RoofType,
            pitchDeg: isFiniteNumber(pitch) ? pitch : 0,
            ridge: RIDGE_AXES.includes(ridge as RidgeAxis) ? (ridge as RidgeAxis) : null,
            highSide: ROOF_SIDES.includes(highSide as RoofSide) ? (highSide as RoofSide) : null,
            cover: ROOF_COVERS.includes(cover as RoofCover) ? (cover as RoofCover) : null,
            outline,
            eaveMm: isFiniteNumber(eave) ? Math.round(eave) : null,
        });
    });
    return parts;
}

interface OpeningInput {
    kind: OpeningKind;
    at: Vec2Mm;
    widthMm: number;
    heightMm: number;
    sillMm: number;
    storey: string | null;
    /** Its own finish, or null for its kind's standard. */
    detail: string | null;
    /** Its division, unchecked — the face's `openingGlazing` checks it — or null for one pane. */
    glazing: Record<string, unknown> | null;
    /** A door's leaves, unchecked — the face's `openingSwings` checks them — or null for one. */
    leaves: string | null;
}

function readOpenings(raw: unknown, errors: string[]): OpeningInput[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
        errors.push('"openings" must be an array.');
        return [];
    }
    const out: OpeningInput[] = [];
    raw.forEach((entry, i) => {
        const where = `openings[${i}]`;
        if (!isRecord(entry)) {
            errors.push(`${where} must be { "kind", "at", "widthMm", "heightMm", "sillMm" }.`);
            return;
        }
        const kind = entry['kind'] === undefined ? 'window' : entry['kind'];
        if (!OPENING_KINDS.includes(kind as OpeningKind)) {
            errors.push(`${where}.kind must be one of ${OPENING_KINDS.join(', ')}.`);
            return;
        }
        const atRaw = entry['at'];
        if (!Array.isArray(atRaw) || atRaw.length !== 2 || !atRaw.every(isFiniteNumber)) {
            errors.push(`${where}.at must be [x, y], the opening's centre in plan.`);
            return;
        }
        const width = entry['widthMm'];
        const height = entry['heightMm'];
        if (!isFiniteNumber(width) || width <= 0 || !isFiniteNumber(height) || height <= 0) {
            errors.push(`${where} needs a positive "widthMm" and "heightMm".`);
            return;
        }
        const sill = entry['sillMm'];
        if (sill !== undefined && !isFiniteNumber(sill)) {
            errors.push(`${where}.sillMm must be a height in millimetres.`);
            return;
        }
        const storey = entry['storey'];
        const detail = entry['detail'];
        if (detail !== undefined && typeof detail !== 'string') {
            errors.push(`${where}.detail must be an opening detail's id.`);
            return;
        }
        out.push({
            kind: kind as OpeningKind,
            at: { x: atRaw[0] as number, y: atRaw[1] as number },
            widthMm: width,
            heightMm: height,
            sillMm: isFiniteNumber(sill) ? sill : kind === 'window' ? DEFAULT_SILL_MM : 0,
            storey: typeof storey === 'string' && storey ? storey : null,
            detail: detail ?? null,
            glazing: isRecord(entry['glazing']) ? entry['glazing'] : null,
            leaves: typeof entry['leaves'] === 'string' ? entry['leaves'] : null,
        });
    });
    return out;
}
