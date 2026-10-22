/**
 * A storey's plate in plan, read off its rooms and its walls, or its floor slabs where it has no
 * rooms: what of the storey is building, block by block, with its courtyards — the footprint its
 * facade is fitted onto.
 *
 * Rooms say it best. A storey's rooms stop at the faces of its walls, so the plate is where they
 * are, closed over the walls standing on the storey and over what parts the rooms by less than
 * `CLOSE_MM` twice (a thick wall, a sliver Revit left). A slab is a poorer guide: an upper
 * storey's has its stairs' voids cut out of its edge, and a converter that could not read one
 * writes its box (rvt-rs: a whole storey's floor as one rectangle round the site, over courtyards
 * and the open ground between blocks). With no rooms, the slabs are all there is.
 *
 * It is worked out on a grid of cells, as a drawing is hatched: every room and wall (or every
 * slab) filled in, grown and shrunk again by `CLOSE_MM` so that what parts them by less is
 * filled, then shrunk and grown again by `OPEN_MM` so that a wall standing out of it (a garden
 * wall, a retaining wall on its own) goes. Each hole left smaller than `MIN_HOLE_MM2` (a shaft, a
 * stair's void) or narrower than `MIN_COURT_WIDE_MM` (a corridor no room was placed in) is filled
 * too, and each piece of the plate that holds a room traced round its cells' edges. The traced
 * outlines are then straightened (`simplify`): the steps a slanting edge makes on the grid
 * dropped, every corner on a straight run, every jog shorter than `MIN_JOG_MM`.
 *
 * Pure: plan rings in, plan regions out.
 */

import { pointInPolygon2, signedArea2, type Vec2Mm } from '../surfacekit/core';
import type { PlanRegion } from '../surfacekit/model';

/** How far rooms may stand apart and still be one plate, mm: twice this, a thick wall's. */
export const CLOSE_MM = 500;
/** A wall standing out of the plate narrower than twice this is not part of it, mm. */
export const OPEN_MM = 400;
/** A hole in the plate smaller than this is filled: a shaft or a stair's void, mm². */
export const MIN_HOLE_MM2 = 10e6;
/** A hole narrower than this everywhere is filled too, whatever its area, mm. */
export const MIN_COURT_WIDE_MM = 2000;
/** A jog in an outline shorter than this is straightened out, mm. */
export const MIN_JOG_MM = 300;
/** The grid's cell, mm, unless the storey is too large for that many. */
const CELL_MM = 100;
/** At most this many cells: a larger storey takes larger ones. */
const MAX_CELLS = 6e6;

/** A storey's plate, and the holes in it that were filled. */
export interface StoreyPlate {
    /** Each block, counter-clockwise, its courtyards counter-clockwise too; largest first. */
    regions: PlanRegion[];
    /** The holes filled, each by its area, mm². */
    filled: number[];
}

interface Grid {
    x0: number;
    y0: number;
    cell: number;
    w: number;
    h: number;
}

/**
 * The plate of a storey with `rooms` (each a room's footprint) and `walls` (each a wall's body
 * between its faces), or with no rooms its `slabs` (each a floor slab's outline): see the module
 * doc. Null when there are neither rooms nor slabs.
 */
export function storeyPlate(
    rooms: readonly (readonly Vec2Mm[])[],
    slabs: readonly (readonly Vec2Mm[])[],
    walls: readonly (readonly Vec2Mm[])[] = []
): StoreyPlate | null {
    const from = (rooms.length > 0 ? [...rooms, ...walls] : slabs).filter((r) => r.length >= 3);
    if (from.length === 0) return null;
    const grid = gridOver(from);
    const r = Math.max(1, Math.round(CLOSE_MM / grid.cell));
    const close = (cells: Uint8Array) => shrink(grow(cells, grid, r), grid, r);
    let plate: Uint8Array;
    const filled: number[] = [];
    if (rooms.length > 0) {
        const o = Math.max(1, Math.round(OPEN_MM / grid.cell));
        const own = close(paint(grid, rooms));
        // Closed over the walls and what parts the rooms, its holes filled while a thin wall
        // still closes them (a curtain wall across a recess no room was placed in), then opened:
        // a wall standing out of it goes. The rooms stay as they are, their sharp corners too.
        const walled = close(paint(grid, [...rooms, ...walls]));
        filled.push(...fillHoles(walled, grid));
        plate = grow(shrink(walled, grid, o), grid, o).map((v, i) => v | own[i]!);
    } else {
        plate = close(paint(grid, slabs));
    }
    filled.push(...fillHoles(plate, grid));
    // Only the pieces that hold a room: a terrace's slab, the site's, hold none.
    if (rooms.length > 0) keepPieces(plate, grid, rooms);
    const regions = trace(plate, grid)
        .map((region) => ({
            ring: simplify(region.ring, grid.cell),
            holes: region.holes.map((h) => simplify(h, grid.cell)),
        }))
        .filter((region) => region.ring.length >= 3)
        .map((region) => ({ ...region, holes: region.holes.filter((h) => h.length >= 3) }));
    return { regions, filled };
}

// ---- The grid ------------------------------------------------------------------------------

function gridOver(rings: readonly (readonly Vec2Mm[])[]): Grid {
    const xs = rings.flatMap((r) => r.map((p) => p.x));
    const ys = rings.flatMap((r) => r.map((p) => p.y));
    const [lo, hi] = [
        { x: Math.min(...xs), y: Math.min(...ys) },
        { x: Math.max(...xs), y: Math.max(...ys) },
    ];
    const cell = Math.max(
        CELL_MM,
        Math.ceil(Math.sqrt(((hi.x - lo.x) * (hi.y - lo.y)) / MAX_CELLS))
    );
    // Room round it to grow into, and a border of empty cells.
    const pad = CLOSE_MM + OPEN_MM + 3 * cell;
    const x0 = lo.x - pad;
    const y0 = lo.y - pad;
    return {
        x0,
        y0,
        cell,
        w: Math.ceil((hi.x - lo.x + 2 * pad) / cell),
        h: Math.ceil((hi.y - lo.y + 2 * pad) / cell),
    };
}

/** The cells whose middles lie in any of the rings. */
function paint(grid: Grid, rings: readonly (readonly Vec2Mm[])[]): Uint8Array {
    const out = new Uint8Array(grid.w * grid.h);
    for (const ring of rings) {
        if (ring.length < 3) continue;
        const ys = ring.map((p) => p.y);
        const j0 = Math.max(0, Math.floor((Math.min(...ys) - grid.y0) / grid.cell));
        const j1 = Math.min(grid.h - 1, Math.ceil((Math.max(...ys) - grid.y0) / grid.cell));
        for (let j = j0; j <= j1; j++) {
            const y = grid.y0 + (j + 0.5) * grid.cell;
            // Where the row crosses the ring's edges, paired off left to right.
            const xs: number[] = [];
            ring.forEach((p, i) => {
                const q = ring[(i + 1) % ring.length]!;
                if (p.y <= y === q.y <= y) return;
                xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
            });
            xs.sort((a, b) => a - b);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                const i0 = Math.max(0, Math.ceil((xs[k]! - grid.x0) / grid.cell - 0.5));
                const i1 = Math.min(
                    grid.w - 1,
                    Math.floor((xs[k + 1]! - grid.x0) / grid.cell - 0.5)
                );
                for (let i = i0; i <= i1; i++) out[j * grid.w + i] = 1;
            }
        }
    }
    return out;
}

/** Every cell within `r` cells of a filled one, along each axis in turn: a square's reach. */
function grow(cells: Uint8Array, grid: Grid, r: number): Uint8Array {
    return spread(spread(cells, grid, r, 1, 1), grid, r, grid.w, 1);
}

/** Every cell all of whose cells within `r` are filled. */
function shrink(cells: Uint8Array, grid: Grid, r: number): Uint8Array {
    return spread(spread(cells, grid, r, 1, 0), grid, r, grid.w, 0);
}

/**
 * One axis of `grow` (`to` 1: a cell takes 1 where any within `r` along it is 1) or `shrink`
 * (`to` 0: a cell takes 0 where any is 0), `step` 1 along a row, `w` down a column.
 */
function spread(cells: Uint8Array, grid: Grid, r: number, step: number, to: 0 | 1): Uint8Array {
    const out = new Uint8Array(cells.length).fill(1 - to);
    const [n, lines, stride] = step === 1 ? [grid.w, grid.h, grid.w] : [grid.h, grid.w, 1];
    for (let line = 0; line < lines; line++) {
        const at = (k: number) => line * stride + k * step;
        // The last cell along the line that has `to`; past the grid's edge is empty.
        let last = to === 0 ? -1 : -Infinity;
        for (let k = 0; k < n; k++) {
            if (cells[at(k)] === to) last = k;
            if (k - last <= r) out[at(k)] = to;
        }
        last = to === 0 ? n : Infinity;
        for (let k = n - 1; k >= 0; k--) {
            if (cells[at(k)] === to) last = k;
            if (last - k <= r) out[at(k)] = to;
        }
    }
    return out;
}

/** The pieces of `cells` with `value`, four ways connected, each as its cells' indices. */
function pieces(cells: Uint8Array, grid: Grid, value: 0 | 1): number[][] {
    const seen = new Uint8Array(cells.length);
    const out: number[][] = [];
    for (let s = 0; s < cells.length; s++) {
        if (seen[s] || cells[s] !== value) continue;
        const piece: number[] = [];
        const stack = [s];
        seen[s] = 1;
        while (stack.length > 0) {
            const c = stack.pop()!;
            piece.push(c);
            const i = c % grid.w;
            const j = (c - i) / grid.w;
            const next = [
                i > 0 ? c - 1 : -1,
                i + 1 < grid.w ? c + 1 : -1,
                j > 0 ? c - grid.w : -1,
                j + 1 < grid.h ? c + grid.w : -1,
            ];
            for (const d of next) {
                if (d >= 0 && !seen[d] && cells[d] === value) {
                    seen[d] = 1;
                    stack.push(d);
                }
            }
        }
        out.push(piece);
    }
    return out;
}

/**
 * Fills each hole smaller than `MIN_HOLE_MM2`, or narrower everywhere than `MIN_COURT_WIDE_MM`
 * (a corridor no room was placed in), in place; the areas of those filled, mm².
 */
function fillHoles(cells: Uint8Array, grid: Grid): number[] {
    const area = grid.cell * grid.cell;
    // The grid's border is outside: the piece of empty cells round the plate.
    const holes = pieces(cells, grid, 0).filter((piece) => !piece.includes(0));
    const mask = new Uint8Array(cells.length);
    for (const piece of holes) for (const c of piece) mask[c] = 1;
    const wide = shrink(mask, grid, Math.max(1, Math.round(MIN_COURT_WIDE_MM / 2 / grid.cell)));
    const filled: number[] = [];
    for (const piece of holes) {
        if (piece.length * area >= MIN_HOLE_MM2 && piece.some((c) => wide[c])) continue;
        for (const c of piece) cells[c] = 1;
        filled.push(piece.length * area);
    }
    return filled;
}

/** Empties each piece of the plate that holds no room, in place. */
function keepPieces(cells: Uint8Array, grid: Grid, rooms: readonly (readonly Vec2Mm[])[]): void {
    const held = new Set<number>();
    for (const ring of rooms) {
        const p = ringPoint(ring);
        const i = Math.floor((p.x - grid.x0) / grid.cell);
        const j = Math.floor((p.y - grid.y0) / grid.cell);
        if (i >= 0 && i < grid.w && j >= 0 && j < grid.h) held.add(j * grid.w + i);
    }
    for (const piece of pieces(cells, grid, 1)) {
        if (piece.some((c) => held.has(c))) continue;
        for (const c of piece) cells[c] = 0;
    }
}

/** A point inside a ring: its corners' middle where that is in it, else beside an edge. */
function ringPoint(ring: readonly Vec2Mm[]): Vec2Mm {
    const mid = {
        x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
        y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
    };
    if (pointInPolygon2(mid, ring)) return mid;
    const sign = signedArea2(ring) >= 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
        const [p, q] = [ring[i]!, ring[(i + 1) % ring.length]!];
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len < 1) continue;
        const at = {
            x: (p.x + q.x) / 2 - ((q.y - p.y) / len) * 50 * sign,
            y: (p.y + q.y) / 2 + ((q.x - p.x) / len) * 50 * sign,
        };
        if (pointInPolygon2(at, ring)) return at;
    }
    return mid;
}

// ---- Tracing ---------------------------------------------------------------------------------

/**
 * The plate's outlines, round its cells' edges with the plate on the left: counter-clockwise
 * round each piece, clockwise round each hole (given back counter-clockwise, in the piece round
 * it). Where two pieces touch at a corner, each keeps its own outline.
 */
function trace(cells: Uint8Array, grid: Grid): PlanRegion[] {
    const filled = (i: number, j: number) =>
        i >= 0 && j >= 0 && i < grid.w && j < grid.h && cells[j * grid.w + i] === 1;
    // Each edge from corner (i, j) to a neighbouring corner, the plate on its left.
    const out = new Map<number, number[]>();
    const key = (i: number, j: number) => j * (grid.w + 1) + i;
    const edge = (a: number, b: number) => out.set(a, [...(out.get(a) ?? []), b]);
    for (let j = 0; j < grid.h; j++) {
        for (let i = 0; i < grid.w; i++) {
            if (!filled(i, j)) continue;
            if (!filled(i, j - 1)) edge(key(i, j), key(i + 1, j));
            if (!filled(i + 1, j)) edge(key(i + 1, j), key(i + 1, j + 1));
            if (!filled(i, j + 1)) edge(key(i + 1, j + 1), key(i, j + 1));
            if (!filled(i - 1, j)) edge(key(i, j + 1), key(i, j));
        }
    }
    const corner = (k: number): Vec2Mm => {
        const i = k % (grid.w + 1);
        return { x: grid.x0 + i * grid.cell, y: grid.y0 + ((k - i) / (grid.w + 1)) * grid.cell };
    };
    const loops: Vec2Mm[][] = [];
    for (const [start, ends] of out) {
        while (ends.length > 0) {
            const loop: number[] = [start];
            let [from, at] = [start, ends.pop()!];
            while (at !== start) {
                loop.push(at);
                const next = out.get(at)!;
                // At a corner two pieces touch at, the turn to the left keeps to this piece.
                const d = [corner(at).x - corner(from).x, corner(at).y - corner(from).y];
                const pick =
                    next.length === 1
                        ? 0
                        : next.findIndex((n) => {
                              const e = [corner(n).x - corner(at).x, corner(n).y - corner(at).y];
                              return d[0]! * e[1]! - d[1]! * e[0]! > 0;
                          });
                const k = pick >= 0 ? pick : 0;
                [from, at] = [at, next[k]!];
                next.splice(k, 1);
            }
            loops.push(loop.map(corner));
        }
    }
    const outers = loops
        .filter((l) => signedArea2(l) > 0)
        .sort((a, b) => signedArea2(a) - signedArea2(b));
    const holes = loops.filter((l) => signedArea2(l) < 0).map((l) => [...l].reverse());
    const regions = outers.map((ring) => ({ ring, holes: [] as Vec2Mm[][] }));
    for (const h of holes) {
        // In the smallest piece round it.
        const round = regions.find(
            (r) => signedArea2(r.ring) > signedArea2(h) && h.every((q) => pointInOrOn(q, r.ring))
        );
        round?.holes.push(h);
    }
    return regions.sort((a, b) => signedArea2(b.ring) - signedArea2(a.ring));
}

function pointInOrOn(p: Vec2Mm, ring: readonly Vec2Mm[]): boolean {
    if (pointInPolygon2(p, ring)) return true;
    return ring.some((a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len === 0) return false;
        const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
        if (t < 0 || t > 1) return false;
        return Math.hypot(a.x + t * (b.x - a.x) - p.x, a.y + t * (b.y - a.y) - p.y) < 1e-6;
    });
}

// ---- Straightening ---------------------------------------------------------------------------

/**
 * A traced outline straightened: each jog shorter than `MIN_JOG_MM` between two runs nearly in
 * line (`straightenJogs`) — between two walls' runs first, then any — the corners that only
 * step along a slanting edge (Douglas–Peucker, to a little more than a cell), each corner on a
 * straight run, and each corner stepped by less than `MIN_CORNER_STEP_MM` (`squareCorners`).
 * Corners to the millimetre; counter-clockwise as it came.
 */
export function simplify(ring: readonly Vec2Mm[], cell: number): Vec2Mm[] {
    // A jog between two long runs first: Douglas–Peucker would slant them into one edge.
    const out = douglasPeucker(straightenJogs(dropStraight(ring, 0.5), LONG_RUN_MM), 1.2 * cell);
    return squareCorners(straightenJogs(out, 0)).map((p) => ({
        x: Math.round(p.x),
        y: Math.round(p.y),
    }));
}

/** A corner stepped in or out by less than this both ways is squared off, mm. */
export const MIN_CORNER_STEP_MM = 600;

/**
 * Each corner stepped by two short sides (`MIN_CORNER_STEP_MM`), each in line with the side
 * beyond the other — a notch at a corner no room reaches into, a column's corner standing out —
 * squared off: the two long sides run on to where they meet.
 */
function squareCorners(ring: readonly Vec2Mm[]): Vec2Mm[] {
    let out = ring.slice();
    for (let changed = true; changed && out.length > 4; ) {
        changed = false;
        const n = out.length;
        for (let i = 0; i < n; i++) {
            const [a, b, c, d, e] = [0, 1, 2, 3, 4].map((k) => out[(i + k) % n]!);
            const [ab, bc, cd, de] = [unit(a!, b!), unit(b!, c!), unit(c!, d!), unit(d!, e!)];
            if (!ab || !bc || !cd || !de) continue;
            if (Math.hypot(c!.x - b!.x, c!.y - b!.y) >= MIN_CORNER_STEP_MM) continue;
            if (Math.hypot(d!.x - c!.x, d!.y - c!.y) >= MIN_CORNER_STEP_MM) continue;
            const parallel = (u: Vec2Mm, v: Vec2Mm) => Math.abs(u.x * v.y - u.y * v.x) < 0.05;
            if (!parallel(ab, cd) || !parallel(bc, de) || parallel(ab, de)) continue;
            // Where a–b's line and d–e's meet.
            const den = ab.x * de.y - ab.y * de.x;
            const t = ((d!.x - a!.x) * de.y - (d!.y - a!.y) * de.x) / den;
            const at = { x: a!.x + ab.x * t, y: a!.y + ab.y * t };
            const next = out.filter((_, k) => ![(i + 1) % n, (i + 2) % n, (i + 3) % n].includes(k));
            next.splice(next.indexOf(a!) + 1, 0, at);
            if (signedArea2(next) > 0) {
                out = next;
                changed = true;
                break;
            }
        }
    }
    return out;
}

/** A run of an outline at least this long is a wall's, not a step of a slanting edge, mm. */
const LONG_RUN_MM = 1000;

/**
 * Each jog shorter than `MIN_JOG_MM` between two runs nearly in line, both at least `minRun`
 * long, straightened: the shorter run moved onto the longer's line. Corners on a straight run
 * dropped too.
 */
function straightenJogs(ring: readonly Vec2Mm[], minRun: number): Vec2Mm[] {
    let out = ring.slice();
    for (let changed = true; changed && out.length > 3; ) {
        changed = false;
        out = dropStraight(out, 1);
        for (let i = 0; i < out.length && out.length > 3; i++) {
            const n = out.length;
            const [a, b, c, d] = [
                out[(i - 1 + n) % n]!,
                out[i]!,
                out[(i + 1) % n]!,
                out[(i + 2) % n]!,
            ];
            if (Math.hypot(c.x - b.x, c.y - b.y) >= MIN_JOG_MM) continue;
            const u = unit(a, b);
            const v = unit(c, d);
            if (!u || !v || Math.abs(u.x * v.y - u.y * v.x) > 0.17 || u.x * v.x + u.y * v.y < 0)
                continue;
            // The shorter run onto the longer's line; the jog between them goes.
            const [lenIn, lenOut] = [
                Math.hypot(b.x - a.x, b.y - a.y),
                Math.hypot(d.x - c.x, d.y - c.y),
            ];
            if (Math.min(lenIn, lenOut) < minRun) continue;
            const onto = (p: Vec2Mm, from: Vec2Mm, dir: Vec2Mm): Vec2Mm => {
                const t = (p.x - from.x) * dir.x + (p.y - from.y) * dir.y;
                return { x: from.x + dir.x * t, y: from.y + dir.y * t };
            };
            const next = [...out];
            if (lenIn >= lenOut) {
                // c and d slide across onto a–b's line, d keeping its place along c–d's.
                next[(i + 2) % n] = onto(d, a, u);
                next.splice((i + 1) % n, 1);
            } else {
                next[(i - 1 + n) % n] = onto(a, d, v);
                next.splice(i, 1);
            }
            if (next.length >= 3 && signedArea2(next) > 0) {
                out = next;
                changed = true;
                break;
            }
        }
    }
    return dropStraight(out, 1);
}

function unit(a: Vec2Mm, b: Vec2Mm): Vec2Mm | null {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return len < 1e-9 ? null : { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** Drops each corner within `mm` of the line through its neighbours, and repeated corners. */
function dropStraight(ring: readonly Vec2Mm[], mm: number): Vec2Mm[] {
    let out = ring.slice();
    for (let changed = true; changed && out.length > 3; ) {
        changed = false;
        for (let i = 0; i < out.length && out.length > 3; i++) {
            const n = out.length;
            const [a, b, c] = [out[(i - 1 + n) % n]!, out[i]!, out[(i + 1) % n]!];
            const len = Math.hypot(c.x - a.x, c.y - a.y);
            const off =
                len < 1e-9
                    ? 0
                    : Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / len;
            const between = (b.x - a.x) * (c.x - a.x) + (b.y - a.y) * (c.y - a.y);
            if (off <= mm && between >= 0 && between <= len * len) {
                out.splice(i, 1);
                changed = true;
            }
        }
    }
    return out;
}

/** A closed ring's corners within `tol` of the outline kept, the rest dropped. */
function douglasPeucker(ring: readonly Vec2Mm[], tol: number): Vec2Mm[] {
    if (ring.length <= 4) return ring.slice();
    // Split at the corner farthest from the first, and run each half as an open line.
    const far = ring.reduce(
        (m, p, i) =>
            Math.hypot(p.x - ring[0]!.x, p.y - ring[0]!.y) >
            Math.hypot(ring[m]!.x - ring[0]!.x, ring[m]!.y - ring[0]!.y)
                ? i
                : m,
        0
    );
    const line = (pts: readonly Vec2Mm[]): Vec2Mm[] => {
        if (pts.length <= 2) return pts.slice();
        const [a, b] = [pts[0]!, pts[pts.length - 1]!];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        let worst = 0;
        let at = -1;
        for (let i = 1; i + 1 < pts.length; i++) {
            const p = pts[i]!;
            const d =
                len < 1e-9
                    ? Math.hypot(p.x - a.x, p.y - a.y)
                    : Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len;
            if (d > worst) [worst, at] = [d, i];
        }
        if (worst <= tol) return [a, b];
        return [...line(pts.slice(0, at + 1)).slice(0, -1), ...line(pts.slice(at))];
    };
    const first = line(ring.slice(0, far + 1));
    const second = line([...ring.slice(far), ring[0]!]);
    return [...first.slice(0, -1), ...second.slice(0, -1)];
}
