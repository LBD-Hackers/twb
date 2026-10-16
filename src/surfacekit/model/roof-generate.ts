/**
 * A roof from four numbers' worth of input: an outline in plan, a type, a pitch and an eave
 * height. Roof mode's Generate (`ui/roof-bar.ts`) puts one over the walls already standing, and a
 * house file written in the simple shape (`walls` + `roof`, see the app's `model/simple-house.ts`)
 * gets its roof from here — which is what lets a drawing be read as "these walls, a 25° gable"
 * instead of every roof plane's corners worked out by whoever reads it.
 *
 * - **Flat** and **shed** are one plane over the whole outline, whatever its shape: level at the
 *   eave, or rising from the outline's low side to its high one.
 * - **Gable** and **hip** on an outline with square corners — a rectangle, an L, a T, a U, a
 *   cross — are built wing by wing. The outline is covered by rectangles as large as it allows
 *   (`wings`), each with its ridge along its own length, gable ends or hips at its short sides.
 *   Over each point the highest wing's roof wins, and a lower wing reaches into a higher one only
 *   on its own side of the higher one's ridge — so an L's short leg runs into the long leg's roof
 *   in two valleys and stops at its ridge, instead of showing again on the far side.
 * - **Hip** on any convex outline is the roof every eave rises from at once: the lowest of their
 *   planes, which is the straight skeleton of a convex polygon.
 *
 * Where the wings still leave a step — a narrow wing running on past a wide one's gable, whose
 * upper part then stands above the lower roof — the step is closed by an upright face (`steps`),
 * so the result is always a closed roof.
 *
 * How the faces come out: every plane is `z = a·x + b·y + c`, and the roof is a height function
 * built from them. The plan is cut into convex cells by every line anything changes across —
 * the outline's sides, the wings' sides and ridges, and where any two planes meet — so inside a
 * cell one plane is the roof throughout. Cells of the same plane are then merged back into faces.
 * No numeric search, no sampling: every corner is where lines cross.
 *
 * Pure: plan points and numbers in, rings out.
 */

import {
    convexHull2,
    distanceToRing2,
    pointInPolygon2,
    signedArea2,
    type Point3Mm,
    type Vec2Mm,
} from '../core';
import { classifyAll } from './classify';
import { MAX_PITCH_DEG, MIN_PITCH_DEG } from './pitch';
import { outerOutline } from './plan-outline';
import { wallFootprint } from './plan-geometry';
import type { Surface, SurfaceId } from './surface';

export type RoofType = 'gable' | 'hip' | 'shed' | 'flat';

export const ROOF_TYPES: readonly RoofType[] = ['gable', 'hip', 'shed', 'flat'];

/** The plan axis a ridge runs along: `x` east–west, `y` north–south. */
export type RidgeAxis = 'x' | 'y';

export const RIDGE_AXES: readonly RidgeAxis[] = ['x', 'y'];

/** A side of the plan, for the high side of a shed roof. */
export type RoofSide = 'north' | 'south' | 'east' | 'west';

export const ROOF_SIDES: readonly RoofSide[] = ['north', 'south', 'east', 'west'];

/**
 * What the roof spans where the outline has a notch in it:
 * - `recesses`: a shallow recess in one side — a recessed entrance, a terrace cut into the house —
 *   is bridged by the roof running through over it, while a missing corner (an L, a T) is a wing
 *   of its own;
 * - `outline`: every notch is followed, the roof ending at every wall;
 * - `box`: one roof over the building's whole extent.
 */
export type RoofCover = 'recesses' | 'outline' | 'box';

export const ROOF_COVERS: readonly RoofCover[] = ['recesses', 'outline', 'box'];

export interface RoofSpec {
    type: RoofType;
    /** Degrees from level. Ignored for a flat roof. */
    pitchDeg: number;
    /** Height of the eaves, where the roof leaves the outline, mm. */
    eaveMm: number;
    /** Gable and hip: the main ridge's direction. Absent or null: along the longer side. */
    ridge?: RidgeAxis | null;
    /** Shed: the side the roof rises towards. Absent or null: across the shorter side, to the north or east. */
    highSide?: RoofSide | null;
    /** What the roof spans over a notch in the outline. Absent or null: `recesses`. */
    cover?: RoofCover | null;
}

export interface GeneratedRoof {
    /** What the roof covers in plan: the outline, with the notches it bridges filled in. */
    outline: Vec2Mm[];
    /** The roof's faces, integer mm, counter-clockwise seen from above. */
    planes: Point3Mm[][];
    /** Upright faces closing a step between two parts of the roof. Usually none. */
    steps: Point3Mm[][];
}

export type RoofResult = { ok: true; roof: GeneratedRoof } | { ok: false; error: string };

/** What the internals return: the roof, before the outline it spans is put on it. */
type Faces = { ok: true; roof: Omit<GeneratedRoof, 'outline'> } | { ok: false; error: string };

/** `z = a·x + b·y + c`. */
interface Plane {
    a: number;
    b: number;
    c: number;
}

/** `nx·x + ny·y = d`, with (nx, ny) a unit vector. */
interface Line {
    nx: number;
    ny: number;
    d: number;
}

/** The part of a higher wing a lower one stays out of: the far side of its ridge. */
interface Exclusion {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    /** The higher wing's ridge axis. */
    axis: RidgeAxis;
    /** Its ridge, as a y (axis x) or x (axis y). */
    ridge: number;
    /** Whether the lower wing keeps the side above the ridge. */
    keepHigh: boolean;
}

interface Wing {
    /** Null for a wing that is the whole outline (a convex hip). */
    rect: { x0: number; y0: number; x1: number; y1: number } | null;
    axis: RidgeAxis;
    planes: number[];
    excluded: Exclusion[];
}

/** Numeric slack for the cell cutting, mm. */
const EPS = 1e-6;
/** Two plan corners closer than this are one, mm. */
const SAME_MM = 1e-3;
/** A cell smaller than this is noise, mm². */
const MIN_CELL_MM2 = 1e-4;
/** A step lower than this is no step, mm. */
const STEP_MM = 0.5;

const height = (p: Plane, x: number, y: number): number => p.a * x + p.b * y + p.c;

/** The generated roof over `outline` (plan corners in order, either direction), or why not. */
export function generateRoof(outline: readonly Vec2Mm[], spec: RoofSpec): RoofResult {
    const walls = cleanRing(outline);
    if (walls.length < 3) return { ok: false, error: 'The roof outline needs at least 3 corners.' };
    const ring = covered(walls, spec.cover ?? 'recesses');
    const result = roofOver(ring, spec);
    return result.ok ? { ok: true, roof: { ...result.roof, outline: ring } } : result;
}

/**
 * The outline the roof spans: `walls` itself, its bounding rectangle (or, without square
 * corners, its convex hull) for `box`, or for `recesses` with every recess it bridges filled.
 *
 * A recess is a notch that opens onto one side of the bounding rectangle only, and reaches in
 * no further than half the building's depth from that side. A notch at a corner opens onto two
 * sides — that is an L's or a T's missing corner, where a wing's own roof belongs — and a deep
 * one is a courtyard, a U's.
 */
function covered(walls: Vec2Mm[], cover: RoofCover): Vec2Mm[] {
    if (cover === 'outline') return walls;
    if (!isRectilinear(walls)) return cover === 'box' ? cleanRing(convexHull2(walls)) : walls;
    const xs = uniqueSorted(walls.map((p) => p.x));
    const ys = uniqueSorted(walls.map((p) => p.y));
    const nx = xs.length - 1;
    const ny = ys.length - 1;
    const [x0, x1, y0, y1] = [xs[0]!, xs[nx]!, ys[0]!, ys[ny]!];
    if (cover === 'box') {
        return [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
        ];
    }
    const filled: boolean[][] = [];
    for (let i = 0; i < nx; i++) {
        filled.push([]);
        for (let j = 0; j < ny; j++) {
            const c = { x: (xs[i]! + xs[i + 1]!) / 2, y: (ys[j]! + ys[j + 1]!) / 2 };
            filled[i]!.push(pointInPolygon2(c, walls));
        }
    }
    // The notches: the cells outside the walls, in connected pieces.
    const seen = filled.map((col) => col.map(() => false));
    let changed = false;
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            if (filled[i]![j] || seen[i]![j]) continue;
            const cells: [number, number][] = [];
            const stack: [number, number][] = [[i, j]];
            seen[i]![j] = true;
            while (stack.length > 0) {
                const [a, b] = stack.pop()!;
                cells.push([a, b]);
                for (const [da, db] of [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                ] as const) {
                    const [c, d] = [a + da, b + db];
                    if (c < 0 || d < 0 || c >= nx || d >= ny) continue;
                    if (filled[c]![d] || seen[c]![d]) continue;
                    seen[c]![d] = true;
                    stack.push([c, d]);
                }
            }
            const is = cells.map(([a]) => a);
            const js = cells.map(([, b]) => b);
            const [iLo, iHi, jLo, jHi] = [
                Math.min(...is),
                Math.max(...is),
                Math.min(...js),
                Math.max(...js),
            ];
            const sides = [iLo === 0, iHi === nx - 1, jLo === 0, jHi === ny - 1];
            if (sides.filter(Boolean).length !== 1) continue;
            const acrossX = sides[0] || sides[1];
            const depth = acrossX ? xs[iHi + 1]! - xs[iLo]! : ys[jHi + 1]! - ys[jLo]!;
            const extent = acrossX ? x1 - x0 : y1 - y0;
            if (depth > extent / 2) continue;
            for (const [a, b] of cells) filled[a]![b] = true;
            changed = true;
        }
    }
    if (!changed) return walls;
    // The filled cells' outside edges, traced back into a ring.
    const segments: [Vec2Mm, Vec2Mm][] = [];
    const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && filled[i]![j]!;
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            if (!filled[i]![j]) continue;
            const [ax, bx, ay, by] = [xs[i]!, xs[i + 1]!, ys[j]!, ys[j + 1]!];
            if (!inside(i, j - 1))
                segments.push([
                    { x: ax, y: ay },
                    { x: bx, y: ay },
                ]);
            if (!inside(i + 1, j))
                segments.push([
                    { x: bx, y: ay },
                    { x: bx, y: by },
                ]);
            if (!inside(i, j + 1))
                segments.push([
                    { x: bx, y: by },
                    { x: ax, y: by },
                ]);
            if (!inside(i - 1, j))
                segments.push([
                    { x: ax, y: by },
                    { x: ax, y: ay },
                ]);
        }
    }
    return outerOutline(segments) ?? walls;
}

/** The roof over an outline it spans exactly. */
function roofOver(ring: Vec2Mm[], spec: RoofSpec): Faces {
    if (spec.type !== 'flat') {
        if (!(spec.pitchDeg >= MIN_PITCH_DEG && spec.pitchDeg <= MAX_PITCH_DEG)) {
            return {
                ok: false,
                error: `A roof pitch must be between ${MIN_PITCH_DEG}° and ${MAX_PITCH_DEG}°.`,
            };
        }
    }
    const slope = Math.tan((spec.pitchDeg * Math.PI) / 180);

    if (spec.type === 'flat') {
        return single(ring, { a: 0, b: 0, c: spec.eaveMm });
    }
    if (spec.type === 'shed') {
        const side = spec.highSide ?? defaultHighSide(ring);
        const dir = SIDE_DIRECTION[side];
        const low = Math.min(...ring.map((p) => p.x * dir.x + p.y * dir.y));
        return single(ring, {
            a: slope * dir.x,
            b: slope * dir.y,
            c: spec.eaveMm - slope * low,
        });
    }

    const planes: Plane[] = [];
    const planeId = (p: Plane): number => {
        const found = planes.findIndex(
            (q) =>
                Math.abs(q.a - p.a) < 1e-9 &&
                Math.abs(q.b - p.b) < 1e-9 &&
                Math.abs(q.c - p.c) < 1e-6
        );
        if (found >= 0) return found;
        planes.push(p);
        return planes.length - 1;
    };

    let wings: Wing[];
    if (isRectilinear(ring)) {
        wings = rectilinearWings(ring, spec, slope, planeId);
    } else if (spec.type === 'hip' && isConvex(ring)) {
        const edgePlanes = ring.map((a, i) =>
            planeId(risingFrom(a, ring[(i + 1) % ring.length]!, spec.eaveMm, slope))
        );
        wings = [{ rect: null, axis: 'x', planes: edgePlanes, excluded: [] }];
    } else {
        return {
            ok: false,
            error:
                spec.type === 'hip'
                    ? 'A hip roof needs an outline with square corners, or one without inside corners.'
                    : 'A gable roof needs an outline with square corners — use a hip, shed or flat roof here, or draw it by hand.',
        };
    }
    return solve(ring, planes, wings);
}

/**
 * What a roof over the walls standing in `surfaces` goes on: the outline of the walls that reach
 * the top storey, the height of their lowest eave, and which walls stand on that outline — for
 * roof mode, where the house is already there. Null when the walls do not close around anything.
 */
export function roofBaseOf(
    surfaces: readonly Surface[]
): { outline: Vec2Mm[]; eaveMm: number; wallIds: SurfaceId[] } | null {
    const kinds = classifyAll(surfaces);
    const walls = surfaces
        .filter((s) => kinds.get(s.id) === 'wall')
        .map((s) => {
            const zs = s.boundaryMm.map((p) => p.z);
            return {
                surface: s,
                base: Math.min(...zs),
                top: Math.max(...zs),
                foot: wallFootprint(s),
            };
        })
        .filter((w) => w.foot !== null && w.top - w.base > 1);
    if (walls.length === 0) return null;
    // The walls of the storey the roof goes on: those reaching above every wall's foot. A lower
    // storey's walls stop where the upper storey's stand, and would put the eaves too low.
    const topBase = Math.max(...walls.map((w) => w.base));
    const upper = walls.filter((w) => w.top > topBase + 1);
    const outline = outerOutline(upper.map((w) => [w.foot!.aMm, w.foot!.bMm] as const));
    if (!outline) return null;
    // The eave: where each outside wall's ends stop, the lowest of them. A gable's ends are at
    // the eave too, so this holds for a house whose roof is being redrawn as well.
    let eave = Infinity;
    const wallIds: SurfaceId[] = [];
    for (const w of upper) {
        const { aMm, bMm } = w.foot!;
        const mid = { x: (aMm.x + bMm.x) / 2, y: (aMm.y + bMm.y) / 2 };
        if ([aMm, bMm, mid].some((p) => distanceToRing2(p, outline) > 1)) continue;
        wallIds.push(w.surface.id);
        for (const end of [aMm, bMm]) {
            const above = w.surface.boundaryMm.filter(
                (p) => Math.hypot(p.x - end.x, p.y - end.y) <= 1
            );
            if (above.length > 0) eave = Math.min(eave, Math.max(...above.map((p) => p.z)));
        }
    }
    return Number.isFinite(eave) ? { outline, eaveMm: eave, wallIds } : null;
}

const SIDE_DIRECTION: Readonly<Record<RoofSide, Vec2Mm>> = {
    north: { x: 0, y: 1 },
    south: { x: 0, y: -1 },
    east: { x: 1, y: 0 },
    west: { x: -1, y: 0 },
};

/** Across the shorter side of the outline's extent, rising north or east. */
function defaultHighSide(ring: readonly Vec2Mm[]): RoofSide {
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...ys) - Math.min(...ys);
    return width >= depth ? 'north' : 'east';
}

/** One plane over the whole outline. */
function single(ring: readonly Vec2Mm[], plane: Plane): Faces {
    const face = roundRing(ring.map((p) => ({ x: p.x, y: p.y, z: height(plane, p.x, p.y) })));
    return { ok: true, roof: { planes: [face], steps: [] } };
}

/** The plane rising at `slope` from edge a→b of a counter-clockwise ring, into the ring. */
function risingFrom(a: Vec2Mm, b: Vec2Mm, eaveMm: number, slope: number): Plane {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    return { a: slope * nx, b: slope * ny, c: eaveMm - slope * (nx * a.x + ny * a.y) };
}

/** Counter-clockwise, no repeated corners, no corners on a straight run. */
function cleanRing(outline: readonly Vec2Mm[]): Vec2Mm[] {
    let ring: Vec2Mm[] = [];
    for (const p of outline) {
        const last = ring[ring.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) ring.push({ x: p.x, y: p.y });
    }
    if (ring.length > 1) {
        const first = ring[0]!;
        const last = ring[ring.length - 1]!;
        if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.5) ring.pop();
    }
    for (let changed = true; changed && ring.length >= 3;) {
        changed = false;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[(i - 1 + ring.length) % ring.length]!;
            const b = ring[i]!;
            const c = ring[(i + 1) % ring.length]!;
            const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            if (Math.abs(cross) / Math.max(Math.hypot(c.x - a.x, c.y - a.y), 1) <= 0.5) {
                ring.splice(i, 1);
                changed = true;
                break;
            }
        }
    }
    if (signedArea2(ring) < 0) ring = ring.reverse();
    return ring;
}

function isRectilinear(ring: readonly Vec2Mm[]): boolean {
    return ring.every((a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        return Math.abs(a.x - b.x) <= 0.5 || Math.abs(a.y - b.y) <= 0.5;
    });
}

function isConvex(ring: readonly Vec2Mm[]): boolean {
    return ring.every((a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        const c = ring[(i + 2) % ring.length]!;
        return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0;
    });
}

/**
 * The wings of a square-cornered outline: rectangles as large as the outline allows, picked
 * largest first and then by how much each adds, until they cover it — an L is its two legs, a T
 * its bar and its stem, a U its base and two arms. They overlap where they meet, which is where
 * the valleys go.
 */
function rectilinearWings(
    ring: readonly Vec2Mm[],
    spec: RoofSpec,
    slope: number,
    planeId: (p: Plane) => number
): Wing[] {
    const xs = uniqueSorted(ring.map((p) => p.x));
    const ys = uniqueSorted(ring.map((p) => p.y));
    const nx = xs.length - 1;
    const ny = ys.length - 1;
    const inside: boolean[][] = [];
    for (let i = 0; i < nx; i++) {
        inside.push([]);
        for (let j = 0; j < ny; j++) {
            const c = { x: (xs[i]! + xs[i + 1]!) / 2, y: (ys[j]! + ys[j + 1]!) / 2 };
            inside[i]!.push(pointInPolygon2(c, ring));
        }
    }
    // Prefix sums over the inside cells, so "is this block all inside" is four lookups.
    const sum: number[][] = Array.from({ length: nx + 1 }, () => new Array<number>(ny + 1).fill(0));
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            sum[i + 1]![j + 1] =
                (inside[i]![j] ? 1 : 0) + sum[i]![j + 1]! + sum[i + 1]![j]! - sum[i]![j]!;
        }
    }
    const full = (i0: number, i1: number, j0: number, j1: number): boolean =>
        sum[i1 + 1]![j1 + 1]! - sum[i0]![j1 + 1]! - sum[i1 + 1]![j0]! + sum[i0]![j0]! ===
        (i1 - i0 + 1) * (j1 - j0 + 1);

    type Block = [number, number, number, number];
    const maximal: Block[] = [];
    for (let i0 = 0; i0 < nx; i0++) {
        for (let i1 = i0; i1 < nx; i1++) {
            for (let j0 = 0; j0 < ny; j0++) {
                for (let j1 = j0; j1 < ny; j1++) {
                    if (!full(i0, i1, j0, j1)) break;
                    const grows =
                        (i0 > 0 && full(i0 - 1, i1, j0, j1)) ||
                        (i1 < nx - 1 && full(i0, i1 + 1, j0, j1)) ||
                        (j0 > 0 && full(i0, i1, j0 - 1, j1)) ||
                        (j1 < ny - 1 && full(i0, i1, j0, j1 + 1));
                    if (!grows) maximal.push([i0, i1, j0, j1]);
                }
            }
        }
    }

    const covered = inside.map((col) => col.map(() => false));
    const cellArea = (i: number, j: number) => (xs[i + 1]! - xs[i]!) * (ys[j + 1]! - ys[j]!);
    const blockArea = ([i0, i1, j0, j1]: Block) =>
        (xs[i1 + 1]! - xs[i0]!) * (ys[j1 + 1]! - ys[j0]!);
    const fresh = ([i0, i1, j0, j1]: Block): number => {
        let area = 0;
        for (let i = i0; i <= i1; i++) {
            for (let j = j0; j <= j1; j++) if (!covered[i]![j]) area += cellArea(i, j);
        }
        return area;
    };
    const chosen: Block[] = [];
    for (;;) {
        let best: Block | null = null;
        let bestKey: [number, number] = [0, 0];
        for (const block of maximal) {
            const key: [number, number] = [fresh(block), blockArea(block)];
            if (key[0] <= 0) continue;
            if (
                !best ||
                key[0] > bestKey[0] + 1e-6 ||
                (Math.abs(key[0] - bestKey[0]) <= 1e-6 && key[1] > bestKey[1] + 1e-6)
            ) {
                best = block;
                bestKey = key;
            }
        }
        if (!best) break;
        chosen.push(best);
        const [i0, i1, j0, j1] = best;
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) covered[i]![j] = true;
    }

    const rects = chosen.map(([i0, i1, j0, j1]) => ({
        x0: xs[i0]!,
        x1: xs[i1 + 1]!,
        y0: ys[j0]!,
        y1: ys[j1 + 1]!,
    }));
    const overlaps = (r: (typeof rects)[number], s: (typeof rects)[number]) =>
        Math.min(r.x1, s.x1) - Math.max(r.x0, s.x0) > 0.5 &&
        Math.min(r.y1, s.y1) - Math.max(r.y0, s.y0) > 0.5;

    // Each wing's ridge runs along its longer side; the first wing's may be set. A square wing
    // joining an earlier one runs out from it, so its end is a gable rather than its side.
    const axes: RidgeAxis[] = [];
    rects.forEach((r, k) => {
        const w = r.x1 - r.x0;
        const h = r.y1 - r.y0;
        if (k === 0 && spec.ridge) axes.push(spec.ridge);
        else if (Math.abs(w - h) > 0.5) axes.push(w > h ? 'x' : 'y');
        else {
            const parent = rects.findIndex((s, m) => m < k && overlaps(r, s));
            axes.push(parent >= 0 ? (axes[parent] === 'x' ? 'y' : 'x') : 'x');
        }
    });

    const onOutline = (a: Vec2Mm, b: Vec2Mm): boolean => sideOnOutline(ring, a, b);
    const wings: Wing[] = rects.map((r, k) => {
        const axis = axes[k]!;
        const eave = spec.eaveMm;
        const planesOf: number[] = [];
        const south = { x: r.x0, y: r.y0 };
        const east = { x: r.x1, y: r.y0 };
        const north = { x: r.x1, y: r.y1 };
        const west = { x: r.x0, y: r.y1 };
        // The rectangle's own sides, counter-clockwise: south, east, north, west.
        const sides: [Vec2Mm, Vec2Mm, RidgeAxis][] = [
            [south, east, 'x'],
            [east, north, 'y'],
            [north, west, 'x'],
            [west, south, 'y'],
        ];
        for (const [a, b, along] of sides) {
            const eaveSide = along === axis;
            // A hip end only where the wing's end is an outside wall; inside the outline it
            // runs on into the wing it meets, and a hip there would dent that wing's roof.
            if (eaveSide || (spec.type === 'hip' && onOutline(a, b))) {
                planesOf.push(planeId(risingFrom(a, b, eave, slope)));
            }
        }
        return { rect: r, axis, planes: planesOf, excluded: [] };
    });

    // Highest ridge first; a lower wing stays on its own side of every higher one's ridge.
    const halfSpan = (w: Wing) =>
        (w.axis === 'x' ? w.rect!.y1 - w.rect!.y0 : w.rect!.x1 - w.rect!.x0) / 2;
    const order = wings
        .map((_, k) => k)
        .sort((m, n) => halfSpan(wings[n]!) - halfSpan(wings[m]!) || m - n);
    const sorted = order.map((k) => wings[k]!);
    sorted.forEach((w, k) => {
        const r = w.rect!;
        for (const v of sorted.slice(0, k)) {
            const s = v.rect!;
            if (!overlaps(r, s)) continue;
            const [lo, hi, slo, shi] =
                v.axis === 'x' ? [r.y0, r.y1, s.y0, s.y1] : [r.x0, r.x1, s.x0, s.x1];
            const outLow = lo < slo - 0.5;
            const outHigh = hi > shi + 0.5;
            if (outLow === outHigh) continue;
            w.excluded.push({ ...s, axis: v.axis, ridge: (slo + shi) / 2, keepHigh: outHigh });
        }
    });
    return sorted;
}

function uniqueSorted(values: readonly number[]): number[] {
    const out: number[] = [];
    for (const v of [...values].sort((a, b) => a - b)) {
        if (out.length === 0 || v - out[out.length - 1]! > 0.5) out.push(v);
    }
    return out;
}

/** Whether side a→b lies wholly along the outline. */
function sideOnOutline(ring: readonly Vec2Mm[], a: Vec2Mm, b: Vec2Mm): boolean {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const spans: [number, number][] = [];
    ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        const off = (pt: Vec2Mm) => Math.abs((pt.x - a.x) * uy - (pt.y - a.y) * ux);
        if (off(p) > 0.5 || off(q) > 0.5) return;
        const tp = (p.x - a.x) * ux + (p.y - a.y) * uy;
        const tq = (q.x - a.x) * ux + (q.y - a.y) * uy;
        spans.push([Math.min(tp, tq), Math.max(tp, tq)]);
    });
    spans.sort((m, n) => m[0] - n[0]);
    let reach = 0;
    for (const [s, e] of spans) {
        if (s > reach + 0.5) break;
        reach = Math.max(reach, e);
    }
    return reach >= len - 0.5;
}

function inWing(w: Wing, p: Vec2Mm): boolean {
    const r = w.rect;
    if (r && (p.x < r.x0 || p.x > r.x1 || p.y < r.y0 || p.y > r.y1)) return false;
    return !w.excluded.some((e) => {
        if (p.x < e.x0 || p.x > e.x1 || p.y < e.y0 || p.y > e.y1) return false;
        const across = e.axis === 'x' ? p.y : p.x;
        return e.keepHigh ? across < e.ridge : across > e.ridge;
    });
}

/** The plane that is the roof at `p`: the highest wing's lowest plane there. -1 for none. */
function roofPlaneAt(planes: readonly Plane[], wings: readonly Wing[], p: Vec2Mm): number {
    let best = -1;
    let bestZ = -Infinity;
    for (const w of wings) {
        if (!inWing(w, p)) continue;
        let low = -1;
        let lowZ = Infinity;
        for (const id of w.planes) {
            const z = height(planes[id]!, p.x, p.y);
            if (z < lowZ - 1e-9) {
                low = id;
                lowZ = z;
            }
        }
        if (low >= 0 && lowZ > bestZ + 1e-9) {
            best = low;
            bestZ = lowZ;
        }
    }
    return best;
}

function lineThrough(a: Vec2Mm, b: Vec2Mm): Line | null {
    return normalLine(b.y - a.y, a.x - b.x, (b.y - a.y) * a.x + (a.x - b.x) * a.y);
}

function normalLine(nx: number, ny: number, d: number): Line | null {
    const len = Math.hypot(nx, ny);
    if (len < 1e-12) return null;
    let line = { nx: nx / len, ny: ny / len, d: d / len };
    if (line.nx < -1e-12 || (Math.abs(line.nx) <= 1e-12 && line.ny < 0)) {
        line = { nx: -line.nx, ny: -line.ny, d: -line.d };
    }
    return line;
}

/** Splits a convex cell by a line; a cell the line misses comes back whole. */
function split(cell: Vec2Mm[], line: Line): Vec2Mm[][] {
    const s = cell.map((p) => line.nx * p.x + line.ny * p.y - line.d);
    if (s.every((v) => v >= -EPS) || s.every((v) => v <= EPS)) return [cell];
    const pos: Vec2Mm[] = [];
    const neg: Vec2Mm[] = [];
    for (let i = 0; i < cell.length; i++) {
        const p = cell[i]!;
        const q = cell[(i + 1) % cell.length]!;
        const sp = s[i]!;
        const sq = s[(i + 1) % cell.length]!;
        if (sp >= -EPS) pos.push(p);
        if (sp <= EPS) neg.push(p);
        if ((sp > EPS && sq < -EPS) || (sp < -EPS && sq > EPS)) {
            const t = sp / (sp - sq);
            const x = { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
            pos.push(x);
            neg.push(x);
        }
    }
    return [pos, neg].filter((c) => c.length >= 3 && signedArea2(c) > MIN_CELL_MM2);
}

/** Plan corners, shared: one index per point, however many cells reach it. */
class CornerPool {
    readonly points: Vec2Mm[] = [];
    private readonly grid = new Map<string, number[]>();

    id(p: Vec2Mm): number {
        const kx = Math.round(p.x / SAME_MM);
        const ky = Math.round(p.y / SAME_MM);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (const i of this.grid.get(`${kx + dx},${ky + dy}`) ?? []) {
                    const q = this.points[i]!;
                    if (Math.hypot(q.x - p.x, q.y - p.y) <= SAME_MM) return i;
                }
            }
        }
        this.points.push(p);
        const key = `${kx},${ky}`;
        const list = this.grid.get(key) ?? [];
        list.push(this.points.length - 1);
        this.grid.set(key, list);
        return this.points.length - 1;
    }
}

/** The arrangement: cut, label each cell with its plane, merge cells into faces. */
function solve(ring: readonly Vec2Mm[], planes: readonly Plane[], wings: readonly Wing[]): Faces {
    const lines: Line[] = [];
    const addLine = (line: Line | null) => {
        if (!line) return;
        const dup = lines.some(
            (l) =>
                Math.abs(l.nx - line.nx) < 1e-9 &&
                Math.abs(l.ny - line.ny) < 1e-9 &&
                Math.abs(l.d - line.d) < 1e-6
        );
        if (!dup) lines.push(line);
    };
    ring.forEach((a, i) => addLine(lineThrough(a, ring[(i + 1) % ring.length]!)));
    for (const w of wings) {
        const r = w.rect;
        if (!r) continue;
        addLine(normalLine(1, 0, r.x0));
        addLine(normalLine(1, 0, r.x1));
        addLine(normalLine(0, 1, r.y0));
        addLine(normalLine(0, 1, r.y1));
        for (const e of w.excluded) {
            addLine(e.axis === 'x' ? normalLine(0, 1, e.ridge) : normalLine(1, 0, e.ridge));
        }
    }
    for (let i = 0; i < planes.length; i++) {
        for (let j = i + 1; j < planes.length; j++) {
            const p = planes[i]!;
            const q = planes[j]!;
            addLine(normalLine(p.a - q.a, p.b - q.b, q.c - p.c));
        }
    }

    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    let cells: Vec2Mm[][] = [
        [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
        ],
    ];
    for (const line of lines) cells = cells.flatMap((c) => split(c, line));

    const pool = new CornerPool();
    interface Cell {
        corners: number[];
        plane: number;
    }
    const kept: Cell[] = [];
    for (const c of cells) {
        const mid = {
            x: c.reduce((s, p) => s + p.x, 0) / c.length,
            y: c.reduce((s, p) => s + p.y, 0) / c.length,
        };
        if (!pointInPolygon2(mid, ring)) continue;
        const plane = roofPlaneAt(planes, wings, mid);
        if (plane < 0) return { ok: false, error: 'Part of the outline has no roof over it.' };
        const corners: number[] = [];
        for (const p of c) {
            const id = pool.id(p);
            if (corners[corners.length - 1] !== id) corners.push(id);
        }
        while (corners.length > 1 && corners[0] === corners[corners.length - 1]) corners.pop();
        if (corners.length >= 3) kept.push({ corners, plane });
    }

    const owner = new Map<string, number>();
    kept.forEach((cell, k) => {
        cell.corners.forEach((u, i) =>
            owner.set(`${u},${cell.corners[(i + 1) % cell.corners.length]}`, k)
        );
    });
    const pt = (i: number) => pool.points[i]!;

    // Faces: per plane, the cell edges no other cell of that plane runs back along.
    const faces: Point3Mm[][] = [];
    const byPlane = new Map<number, Cell[]>();
    for (const cell of kept) byPlane.set(cell.plane, [...(byPlane.get(cell.plane) ?? []), cell]);
    for (const [planeIndex, group] of byPlane) {
        const edges = new Set<string>();
        for (const cell of group) {
            cell.corners.forEach((u, i) =>
                edges.add(`${u},${cell.corners[(i + 1) % cell.corners.length]}`)
            );
        }
        const outgoing = new Map<number, number[]>();
        for (const key of edges) {
            const [u, v] = key.split(',').map(Number) as [number, number];
            if (edges.has(`${v},${u}`)) continue;
            outgoing.set(u, [...(outgoing.get(u) ?? []), v]);
        }
        for (const loop of chainLoops(outgoing, pt)) {
            const simple = dropStraight(loop.map(pt));
            if (simple.length < 3) continue;
            if (signedArea2(simple) <= 0) {
                return { ok: false, error: 'The roof came out with a hole in one of its planes.' };
            }
            const plane = planes[planeIndex]!;
            faces.push(
                roundRing(simple.map((p) => ({ x: p.x, y: p.y, z: height(plane, p.x, p.y) })))
            );
        }
    }

    // Steps: an edge between two cells whose planes do not meet there.
    interface StepPiece {
        u: number;
        v: number;
        top: [number, number];
        bottom: [number, number];
    }
    const pieces = new Map<string, { line: Line; list: StepPiece[] }>();
    for (const cell of kept) {
        cell.corners.forEach((u, i) => {
            const v = cell.corners[(i + 1) % cell.corners.length]!;
            const other = owner.get(`${v},${u}`);
            if (other === undefined) return;
            const them = kept[other]!;
            if (them.plane === cell.plane) return;
            const mine = planes[cell.plane]!;
            const theirs = planes[them.plane]!;
            const [pu, pv] = [pt(u), pt(v)];
            const top: [number, number] = [height(mine, pu.x, pu.y), height(mine, pv.x, pv.y)];
            const bottom: [number, number] = [
                height(theirs, pu.x, pu.y),
                height(theirs, pv.x, pv.y),
            ];
            // Only the upper side of a step reports it, so each step is found once.
            if (Math.max(top[0] - bottom[0], top[1] - bottom[1]) <= STEP_MM) return;
            if (top[0] + top[1] <= bottom[0] + bottom[1]) return;
            const line = lineThrough(pu, pv)!;
            const key = `${line.nx.toFixed(9)},${line.ny.toFixed(9)},${line.d.toFixed(4)}`;
            const entry = pieces.get(key) ?? { line, list: [] };
            entry.list.push({ u, v, top, bottom });
            pieces.set(key, entry);
        });
    }
    const steps: Point3Mm[][] = [];
    for (const { line, list } of pieces.values()) {
        const dir = { x: -line.ny, y: line.nx };
        const t = (i: number) => pt(i).x * dir.x + pt(i).y * dir.y;
        // Run every piece the same way along its line, then join those that meet end to end.
        const runs = list
            .map((s): StepPiece =>
                t(s.u) <= t(s.v)
                    ? s
                    : {
                          u: s.v,
                          v: s.u,
                          top: [s.top[1], s.top[0]],
                          bottom: [s.bottom[1], s.bottom[0]],
                      }
            )
            .sort((m, n) => t(m.u) - t(n.u));
        const chains: StepPiece[][] = [];
        for (const s of runs) {
            const chain = chains[chains.length - 1];
            const last = chain?.[chain.length - 1];
            const joins =
                last !== undefined &&
                last.v === s.u &&
                Math.abs(last.top[1] - s.top[0]) <= STEP_MM &&
                Math.abs(last.bottom[1] - s.bottom[0]) <= STEP_MM;
            if (joins) chain!.push(s);
            else chains.push([s]);
        }
        for (const chain of chains) {
            const at = (i: number, z: number): Point3Mm => ({ x: pt(i).x, y: pt(i).y, z });
            const bottom = [
                at(chain[0]!.u, chain[0]!.bottom[0]),
                ...chain.map((s) => at(s.v, s.bottom[1])),
            ];
            const top = [at(chain[0]!.u, chain[0]!.top[0]), ...chain.map((s) => at(s.v, s.top[1]))];
            const face = dropStraight3(roundRing([...bottom, ...top.reverse()]));
            if (face.length >= 3) steps.push(face);
        }
    }

    // A corner of one face on the edge of another becomes a corner of that one too — a step's
    // foot on a roof plane's eave, say — so faces meet corner to corner.
    const all = [...faces, ...steps];
    const corners = all.flat();
    return {
        ok: true,
        roof: {
            planes: faces.map((ring) => withCornersOn(ring, corners)),
            steps: steps.map((ring) => withCornersOn(ring, corners)),
        },
    };
}

/** `ring` with every point of `corners` that lies inside one of its edges, within a millimetre, added. */
function withCornersOn(ring: readonly Point3Mm[], corners: readonly Point3Mm[]): Point3Mm[] {
    const out: Point3Mm[] = [];
    ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        out.push(p);
        const d = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
        const len = Math.hypot(d.x, d.y, d.z);
        if (len === 0) return;
        const on = corners
            .map((c) => {
                const t = ((c.x - p.x) * d.x + (c.y - p.y) * d.y + (c.z - p.z) * d.z) / (len * len);
                const off = Math.hypot(
                    p.x + d.x * t - c.x,
                    p.y + d.y * t - c.y,
                    p.z + d.z * t - c.z
                );
                return { c, t, off };
            })
            .filter(({ t, off }) => off <= 1 && t * len > 1 && (1 - t) * len > 1)
            .sort((m, n) => m.t - n.t);
        for (const { c } of on) {
            const last = out[out.length - 1]!;
            if (last.x !== c.x || last.y !== c.y || last.z !== c.z) out.push(c);
        }
    });
    return out;
}

/**
 * Directed boundary edges chained into loops. Where two loops touch at a corner, the walk takes
 * the sharpest left turn, which keeps each loop to its own side of the touch.
 */
function chainLoops(outgoing: Map<number, number[]>, pt: (i: number) => Vec2Mm): number[][] {
    const loops: number[][] = [];
    const take = (u: number, v: number) => {
        const list = outgoing.get(u)!;
        list.splice(list.indexOf(v), 1);
        if (list.length === 0) outgoing.delete(u);
    };
    while (outgoing.size > 0) {
        const [start, firstList] = outgoing.entries().next().value as [number, number[]];
        let prev = start;
        let at = firstList[0]!;
        take(start, at);
        const loop = [start];
        for (let guard = 0; at !== start && guard < 100000; guard++) {
            loop.push(at);
            const options = outgoing.get(at);
            if (!options || options.length === 0) break;
            let best = options[0]!;
            if (options.length > 1) {
                const d = { x: pt(at).x - pt(prev).x, y: pt(at).y - pt(prev).y };
                let bestTurn = -Infinity;
                for (const o of options) {
                    const e = { x: pt(o).x - pt(at).x, y: pt(o).y - pt(at).y };
                    const turnAngle = Math.atan2(d.x * e.y - d.y * e.x, d.x * e.x + d.y * e.y);
                    if (turnAngle > bestTurn) {
                        bestTurn = turnAngle;
                        best = o;
                    }
                }
            }
            take(at, best);
            prev = at;
            at = best;
        }
        loops.push(loop);
    }
    return loops;
}

/** Drops corners on a straight run. */
function dropStraight(ring: Vec2Mm[]): Vec2Mm[] {
    const out = ring.slice();
    for (let changed = true; changed && out.length >= 3;) {
        changed = false;
        for (let i = 0; i < out.length; i++) {
            const a = out[(i - 1 + out.length) % out.length]!;
            const b = out[i]!;
            const c = out[(i + 1) % out.length]!;
            const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            const len = Math.hypot(c.x - a.x, c.y - a.y);
            if (len < SAME_MM || Math.abs(cross) / len <= 1e-3) {
                out.splice(i, 1);
                changed = true;
                break;
            }
        }
    }
    return out;
}

/** Drops corners on a straight run in 3D — within a millimetre, after rounding. */
function dropStraight3(ring: Point3Mm[]): Point3Mm[] {
    const out = ring.slice();
    for (let changed = true; changed && out.length >= 3;) {
        changed = false;
        for (let i = 0; i < out.length; i++) {
            const a = out[(i - 1 + out.length) % out.length]!;
            const b = out[i]!;
            const c = out[(i + 1) % out.length]!;
            const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
            const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
            const len = Math.hypot(ac.x, ac.y, ac.z);
            const cross = Math.hypot(
                ab.y * ac.z - ab.z * ac.y,
                ab.z * ac.x - ab.x * ac.z,
                ab.x * ac.y - ab.y * ac.x
            );
            const between = ab.x * ac.x + ab.y * ac.y + ab.z * ac.z;
            if (len > 0 && cross / len <= 1 && between > 0 && between < len * len) {
                out.splice(i, 1);
                changed = true;
                break;
            }
        }
    }
    return out;
}

/** Integer millimetres, with any corner that rounds onto its neighbour dropped. */
function roundRing(ring: readonly Point3Mm[]): Point3Mm[] {
    const out: Point3Mm[] = [];
    for (const p of ring) {
        const q = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
        const last = out[out.length - 1];
        if (!last || last.x !== q.x || last.y !== q.y || last.z !== q.z) out.push(q);
    }
    while (out.length > 1) {
        const a = out[0]!;
        const b = out[out.length - 1]!;
        if (a.x === b.x && a.y === b.y && a.z === b.z) out.pop();
        else break;
    }
    return out;
}
