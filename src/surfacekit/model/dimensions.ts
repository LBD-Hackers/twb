/**
 * Editable dimensions — Revit's temporary dimensions, read off the model.
 *
 * Select a wall or an opening and the numbers that place it appear: a wall's length and its
 * distance to the parallel walls on either side; an opening's distance to what is beside it
 * along the wall, its width, its sill and its height. Type a new number and the model follows.
 *
 * **Every dimension has two ends, and exactly one of them is pinned.** The pinned end stays;
 * the other moves by the difference. What an end *is* decides what moving it does:
 *
 *   - a **line**: a wall run in plan (or a wall's free end, a segment of length zero). Moving it
 *     is `moveWallLine` — the wall and everything standing on it moves sideways.
 *   - an **opening edge**: a jamb, sill or head. When both ends are edges of the same opening the
 *     dimension is its size and the edge moves on its own (a resize); otherwise the whole opening
 *     moves (a slide along the wall, or up and down it).
 *   - **fixed**: the base of the wall a sill is measured from. It never moves, so it is always
 *     the pinned end.
 *   - a **level**: a storey's ceiling line. Moving it is `liftRoof` — the ceiling, the roof and
 *     everything above go up or down together, and the walls stretch.
 *
 * Nothing about a dimension is stored. It is recomputed from the geometry every time the
 * selection or the model changes, like a face's kind or a roof's pitch; the pin is the UI's.
 *
 * Pure: surfaces in, dimensions and edits out.
 */

import { dot3, fromFrameUv, pointInPolygon2, type Point3Mm, type Vec2Mm } from '../core';
import type { Surface, SurfaceId, SurfaceOpening } from './surface';
import type { Storey } from './storey';
import { openingRing3, surfaceFrame } from './surface-frame';
import { COINCIDENT_MM } from './surface-ops';
import {
    floorFootprintsInStorey,
    wallFootprintsInStorey,
    type WallFootprint,
} from './plan-geometry';
import { onPlanSegment, type WallLineMoveRequest, type WallLineSegment } from './wall-line-move';
import { storeyCeilingZ, wallCeilingZ, type RoofLiftRequest } from './roof-lift';

/** Two directions this close to parallel (|sin|) are parallel. */
const PARALLEL_SIN = 0.001;

export type OpeningEdge = 'u0' | 'u1' | 'v0' | 'v1';

export type DimensionRef =
    | { kind: 'line'; segment: WallLineSegment }
    | { kind: 'opening'; surfaceId: SurfaceId; openingId: string; edge: OpeningEdge }
    | { kind: 'fixed' }
    | { kind: 'level'; zMm: number };

export interface Dimension {
    /** Stable for one selection, so a pin choice survives the model changing under it. */
    id: string;
    /** The two measured points, model space. */
    fromMm: Point3Mm;
    toMm: Point3Mm;
    /**
     * The unit direction from `fromMm` to `toMm`, stated rather than derived: a dimension at 0 —
     * a window flush against a wall end — has two equal points and still has to know which way
     * a new value pushes.
     */
    dirMm: Point3Mm;
    /** Which way, in model space, the dimension line is drawn off the measured points. */
    sideMm: Point3Mm;
    valueMm: number;
    ends: readonly [DimensionRef, DimensionRef];
    /** The end that stays unless the user pins the other one. */
    defaultPinned: 0 | 1;
}

export type DimensionEdit =
    | { kind: 'line'; request: WallLineMoveRequest }
    | {
          kind: 'opening';
          surfaceId: SurfaceId;
          openingId: string;
          patch: Pick<SurfaceOpening, 'uMm' | 'vMm' | 'widthMm' | 'heightMm'>;
      }
    | { kind: 'lift'; request: RoofLiftRequest }
    | { kind: 'refused'; message: string };

// ---- Plan helpers ----

interface Line2 {
    a: Vec2Mm;
    d: Vec2Mm;
    len: number;
}

function lineOf(fp: WallFootprint): Line2 | null {
    const dx = fp.bMm.x - fp.aMm.x;
    const dy = fp.bMm.y - fp.aMm.y;
    const len = Math.hypot(dx, dy);
    if (len < COINCIDENT_MM) return null;
    return { a: { x: fp.aMm.x, y: fp.aMm.y }, d: { x: dx / len, y: dy / len }, len };
}

const cross2 = (a: Vec2Mm, b: Vec2Mm): number => a.x * b.y - a.y * b.x;
const along = (l: Line2, p: Vec2Mm): number => (p.x - l.a.x) * l.d.x + (p.y - l.a.y) * l.d.y;
const across = (l: Line2, p: Vec2Mm): number => (p.x - l.a.x) * -l.d.y + (p.y - l.a.y) * l.d.x;
const at = (l: Line2, t: number): Vec2Mm => ({ x: l.a.x + l.d.x * t, y: l.a.y + l.d.y * t });
const isParallel = (a: Line2, b: Line2): boolean => Math.abs(cross2(a.d, b.d)) < PARALLEL_SIN;
const onLine = (l: Line2, p: Vec2Mm): boolean => Math.abs(across(l, p)) <= COINCIDENT_MM;

/**
 * The whole straight run a footprint is part of: every collinear footprint that touches it, and
 * every one touching those. A wall an earlier edit split in two still moves as one line.
 */
export function wallRun(footprints: readonly WallFootprint[], fp: WallFootprint): WallLineSegment {
    const line = lineOf(fp);
    if (!line) return { aMm: fp.aMm, bMm: fp.bMm };
    let lo = 0;
    let hi = line.len;
    let grew = true;
    const used = new Set<WallFootprint>([fp]);
    while (grew) {
        grew = false;
        for (const other of footprints) {
            if (used.has(other) || !onLine(line, other.aMm) || !onLine(line, other.bMm)) continue;
            const t0 = Math.min(along(line, other.aMm), along(line, other.bMm));
            const t1 = Math.max(along(line, other.aMm), along(line, other.bMm));
            if (t1 < lo - COINCIDENT_MM || t0 > hi + COINCIDENT_MM) continue;
            used.add(other);
            lo = Math.min(lo, t0);
            hi = Math.max(hi, t1);
            grew = true;
        }
    }
    return { aMm: at(line, lo), bMm: at(line, hi) };
}

/** What a wall end at `pt` is butted against: the run of a wall crossing it there, else the point itself. */
function endRef(footprints: readonly WallFootprint[], line: Line2, pt: Vec2Mm): DimensionRef {
    for (const other of footprints) {
        const l = lineOf(other);
        if (!l || isParallel(l, line)) continue;
        if (onPlanSegment(pt, other.aMm, other.bMm)) {
            return { kind: 'line', segment: wallRun(footprints, other) };
        }
    }
    return { kind: 'line', segment: { aMm: pt, bMm: pt } };
}

/** The side of a wall away from the storey's floor — outside, for an exterior wall. */
function outwardSign(surfaces: readonly Surface[], storey: Storey, line: Line2): 1 | -1 {
    const mid = at(line, line.len / 2);
    const probe = { x: mid.x - line.d.y * 300, y: mid.y + line.d.x * 300 };
    const floors = floorFootprintsInStorey(surfaces, storey);
    return floors.some((f) => pointInPolygon2(probe, f.ringMm)) ? -1 : 1;
}

const to3 = (p: Vec2Mm, z: number): Point3Mm => ({ x: p.x, y: p.y, z });

function footprintOf(surfaces: readonly Surface[], storey: Storey, id: SurfaceId) {
    const footprints = wallFootprintsInStorey(surfaces, storey);
    const fp = footprints.find((f) => f.surfaceId === id);
    const line = fp ? lineOf(fp) : null;
    return fp && line ? { footprints, fp, line } : null;
}

// ---- Dimensions of a wall ----

/**
 * A wall's length, end to end, and its distance to the nearest parallel wall on each side whose
 * span overlaps it. Empty when the face is not a wall in this storey.
 */
export function wallDimensions(
    surfaces: readonly Surface[],
    storey: Storey,
    wallId: SurfaceId
): Dimension[] {
    const found = footprintOf(surfaces, storey, wallId);
    if (!found) return [];
    const { footprints, fp, line } = found;
    const z = storey.elevationMm;
    const out = outwardSign(surfaces, storey, line);
    const normal: Point3Mm = { x: -line.d.y * out, y: line.d.x * out, z: 0 };
    const b = at(line, line.len);
    const dims: Dimension[] = [
        {
            id: 'length',
            fromMm: to3(line.a, z),
            toMm: to3(b, z),
            dirMm: { x: line.d.x, y: line.d.y, z: 0 },
            sideMm: normal,
            valueMm: Math.round(line.len),
            ends: [endRef(footprints, line, line.a), endRef(footprints, line, b)],
            defaultPinned: 0,
        },
    ];

    const run = wallRun(footprints, fp);
    const nearest: { [side: string]: { s: number; t: number; other: WallFootprint } } = {};
    for (const other of footprints) {
        if (other === fp) continue;
        const l = lineOf(other);
        if (!l || !isParallel(l, line)) continue;
        const s = across(line, other.aMm);
        if (Math.abs(s) <= COINCIDENT_MM) continue;
        const t0 = Math.max(0, Math.min(along(line, other.aMm), along(line, other.bMm)));
        const t1 = Math.min(line.len, Math.max(along(line, other.aMm), along(line, other.bMm)));
        if (t1 - t0 <= COINCIDENT_MM) continue;
        const side = s > 0 ? 'left' : 'right';
        const best = nearest[side];
        if (!best || Math.abs(s) < Math.abs(best.s)) nearest[side] = { s, t: (t0 + t1) / 2, other };
    }
    for (const side of ['left', 'right']) {
        const hit = nearest[side];
        if (!hit) continue;
        const from = at(line, hit.t);
        const to = { x: from.x - line.d.y * hit.s, y: from.y + line.d.x * hit.s };
        dims.push({
            id: `parallel-${side}`,
            fromMm: to3(from, z),
            toMm: to3(to, z),
            dirMm: {
                x: (-line.d.y * hit.s) / Math.abs(hit.s),
                y: (line.d.x * hit.s) / Math.abs(hit.s),
                z: 0,
            },
            sideMm: { x: line.d.x, y: line.d.y, z: 0 },
            valueMm: Math.round(Math.abs(hit.s)),
            ends: [
                { kind: 'line', segment: run },
                { kind: 'line', segment: wallRun(footprints, hit.other) },
            ],
            // The selected wall is the one that moves.
            defaultPinned: 1,
        });
    }
    const surface = surfaces.find((s) => s.id === wallId);
    const ceiling = surface ? ceilingDimension(storey, fp, wallCeilingZ(surface), normal) : null;
    if (ceiling) dims.push(ceiling);
    return dims;
}

/**
 * The storey's ceiling height — floor to ceiling line, measured up the corner a wall starts at.
 * Null when the wall has no ceiling line above the floor.
 */
function ceilingDimension(
    storey: Storey,
    fp: WallFootprint,
    ceilingZMm: number | null,
    sideMm: Point3Mm
): Dimension | null {
    if (ceilingZMm === null || ceilingZMm <= storey.elevationMm + COINCIDENT_MM) return null;
    return {
        id: 'ceiling',
        fromMm: to3(fp.aMm, storey.elevationMm),
        toMm: to3(fp.aMm, ceilingZMm),
        dirMm: { x: 0, y: 0, z: 1 },
        sideMm,
        valueMm: Math.round(ceilingZMm - storey.elevationMm),
        ends: [{ kind: 'fixed' }, { kind: 'level', zMm: ceilingZMm }],
        defaultPinned: 0,
    };
}

/**
 * The storey's ceiling height on its own, for a selected roof: measured up the start of the
 * longest wall that reaches the storey's ceiling line (`storeyCeilingZ`), where it is easiest to
 * find. Empty when no wall stands on the storey's floor.
 */
export function storeyCeilingDimensions(surfaces: readonly Surface[], storey: Storey): Dimension[] {
    const zMm = storeyCeilingZ(surfaces, storey);
    if (zMm === null) return [];
    let best: { fp: WallFootprint; lengthMm: number } | null = null;
    for (const fp of wallFootprintsInStorey(surfaces, storey)) {
        const surface = surfaces.find((s) => s.id === fp.surfaceId);
        if (!surface || wallCeilingZ(surface) !== zMm) continue;
        const lengthMm = Math.hypot(fp.bMm.x - fp.aMm.x, fp.bMm.y - fp.aMm.y);
        if (!best || lengthMm > best.lengthMm) best = { fp, lengthMm };
    }
    const line = best ? lineOf(best.fp) : null;
    if (!best || !line) return [];
    const out = outwardSign(surfaces, storey, line);
    const normal: Point3Mm = { x: -line.d.y * out, y: line.d.x * out, z: 0 };
    const dim = ceilingDimension(storey, best.fp, zMm, normal);
    return dim ? [dim] : [];
}

// ---- Dimensions of an opening ----

interface Station {
    t: number;
    ref: DimensionRef;
}

/**
 * An opening's place along its wall — to the nearest wall end, crossing wall or other opening on
 * each side — its width, and, measured up the wall, its sill and its height.
 */
export function openingDimensions(
    surfaces: readonly Surface[],
    storey: Storey,
    surfaceId: SurfaceId,
    openingId: string
): Dimension[] {
    const surface = surfaces.find((s) => s.id === surfaceId);
    const hole = surface?.openings.find((h) => h.id === openingId);
    const frame = surface ? surfaceFrame(surface.boundaryMm) : null;
    const found = footprintOf(surfaces, storey, surfaceId);
    if (!surface || !hole || !frame || !found) return [];
    const { footprints, line } = found;
    const z = storey.elevationMm;
    const out = outwardSign(surfaces, storey, line);
    const normal: Point3Mm = { x: -line.d.y * out, y: line.d.x * out, z: 0 };

    // Which jamb is nearer the footprint's start depends on how the wall was drawn.
    const uForward = frame.uDir.x * line.d.x + frame.uDir.y * line.d.y > 0;
    const [c0, c1] = openingRing3(frame, hole);
    const t0 = Math.min(along(line, c0!), along(line, c1!));
    const t1 = Math.max(along(line, c0!), along(line, c1!));
    const nearEdge: OpeningEdge = uForward ? 'u0' : 'u1';
    const farEdge: OpeningEdge = uForward ? 'u1' : 'u0';
    const edgeRef = (edge: OpeningEdge): DimensionRef => ({
        kind: 'opening',
        surfaceId,
        openingId,
        edge,
    });

    const stations: Station[] = [
        { t: 0, ref: endRef(footprints, line, line.a) },
        { t: line.len, ref: endRef(footprints, line, at(line, line.len)) },
    ];
    for (const other of footprints) {
        const l = lineOf(other);
        if (!l || isParallel(l, line)) continue;
        // Where the other wall's line crosses this one, if it reaches it.
        const denom = cross2(line.d, l.d);
        const rel = { x: l.a.x - line.a.x, y: l.a.y - line.a.y };
        const t = cross2(rel, l.d) / denom;
        const tOther = cross2(rel, line.d) / denom;
        if (t <= COINCIDENT_MM || t >= line.len - COINCIDENT_MM) continue;
        if (tOther < -COINCIDENT_MM || tOther > l.len + COINCIDENT_MM) continue;
        stations.push({ t, ref: { kind: 'line', segment: wallRun(footprints, other) } });
    }
    for (const other of surface.openings) {
        if (other.id === hole.id) continue;
        const [o0, o1] = openingRing3(frame, other);
        const ta = along(line, o0!);
        const tb = along(line, o1!);
        const lowIsU0 = ta < tb;
        stations.push({
            t: Math.min(ta, tb),
            ref: { kind: 'opening', surfaceId, openingId: other.id, edge: lowIsU0 ? 'u0' : 'u1' },
        });
        stations.push({
            t: Math.max(ta, tb),
            ref: { kind: 'opening', surfaceId, openingId: other.id, edge: lowIsU0 ? 'u1' : 'u0' },
        });
    }
    const before = stations
        .filter((s) => s.t <= t0 + COINCIDENT_MM)
        .reduce<Station | null>((best, s) => (!best || s.t > best.t ? s : best), null);
    const after = stations
        .filter((s) => s.t >= t1 - COINCIDENT_MM)
        .reduce<Station | null>((best, s) => (!best || s.t < best.t ? s : best), null);

    const dims: Dimension[] = [];
    if (before) {
        dims.push({
            id: 'before',
            fromMm: to3(at(line, before.t), z),
            toMm: to3(at(line, t0), z),
            dirMm: { x: line.d.x, y: line.d.y, z: 0 },
            sideMm: normal,
            valueMm: Math.round(t0 - before.t),
            ends: [before.ref, edgeRef(nearEdge)],
            defaultPinned: 0,
        });
    }
    dims.push({
        id: 'width',
        fromMm: to3(at(line, t0), z),
        toMm: to3(at(line, t1), z),
        dirMm: { x: line.d.x, y: line.d.y, z: 0 },
        sideMm: normal,
        valueMm: hole.widthMm,
        ends: [edgeRef(nearEdge), edgeRef(farEdge)],
        defaultPinned: 0,
    });
    if (after) {
        dims.push({
            id: 'after',
            fromMm: to3(at(line, t1), z),
            toMm: to3(at(line, after.t), z),
            dirMm: { x: line.d.x, y: line.d.y, z: 0 },
            sideMm: normal,
            valueMm: Math.round(after.t - t1),
            ends: [edgeRef(farEdge), after.ref],
            defaultPinned: 1,
        });
    }

    // Up the wall, beside the near jamb: from the wall's base to the sill, and sill to head.
    const u = uForward ? hole.uMm : hole.uMm + hole.widthMm;
    const beside: Point3Mm = uForward
        ? { x: -frame.uDir.x, y: -frame.uDir.y, z: 0 }
        : { x: frame.uDir.x, y: frame.uDir.y, z: 0 };
    const up = (v: number): Point3Mm => fromFrameUv(frame, { x: u, y: v });
    if (hole.vMm > 0) {
        dims.push({
            id: 'sill',
            fromMm: up(0),
            toMm: up(hole.vMm),
            dirMm: frame.vDir,
            sideMm: beside,
            valueMm: hole.vMm,
            ends: [{ kind: 'fixed' }, edgeRef('v0')],
            defaultPinned: 0,
        });
    }
    dims.push({
        id: 'height',
        fromMm: up(hole.vMm),
        toMm: up(hole.vMm + hole.heightMm),
        dirMm: frame.vDir,
        sideMm: beside,
        valueMm: hole.heightMm,
        ends: [edgeRef('v0'), edgeRef('v1')],
        defaultPinned: 0,
    });
    return dims;
}

// ---- From a typed value to an edit ----

/**
 * What typing `newValueMm` into `dim` with end `pinned` held does to the model. The store still
 * has the last word — this only says which edit to ask it for.
 */
export function dimensionEdit(
    surfaces: readonly Surface[],
    dim: Dimension,
    newValueMm: number,
    pinned: 0 | 1,
    baseZMm: number
): DimensionEdit {
    if (!Number.isFinite(newValueMm) || newValueMm < 0) {
        return { kind: 'refused', message: 'A dimension cannot be negative.' };
    }
    const delta = newValueMm - dim.valueMm;
    if (Math.round(delta) === 0) return { kind: 'refused', message: 'That is what it already is.' };
    const moving = dim.ends[pinned === 0 ? 1 : 0];
    const staying = dim.ends[pinned];
    // The moving end goes out along the measured direction (from → to), or back along it.
    const sign = pinned === 0 ? 1 : -1;
    const move: Point3Mm = {
        x: dim.dirMm.x * delta * sign,
        y: dim.dirMm.y * delta * sign,
        z: dim.dirMm.z * delta * sign,
    };

    if (moving.kind === 'fixed') {
        return { kind: 'refused', message: 'The base of the wall stays where it is.' };
    }
    if (moving.kind === 'level') {
        return {
            kind: 'lift',
            request: { fromZMm: moving.zMm, riseMm: Math.round(move.z), baseZMm },
        };
    }
    if (moving.kind === 'line') {
        if (Math.abs(move.z) > COINCIDENT_MM) {
            return { kind: 'refused', message: 'A wall only moves in plan.' };
        }
        return {
            kind: 'line',
            request: { segment: moving.segment, shiftMm: { x: move.x, y: move.y }, baseZMm },
        };
    }

    const surface = surfaces.find((s) => s.id === moving.surfaceId);
    const hole = surface?.openings.find((h) => h.id === moving.openingId);
    const frame = surface ? surfaceFrame(surface.boundaryMm) : null;
    if (!surface || !hole || !frame) {
        return { kind: 'refused', message: 'That opening is gone.' };
    }
    const du = Math.round(dot3(move, frame.uDir));
    const dv = Math.round(dot3(move, frame.vDir));
    const patch = { uMm: hole.uMm, vMm: hole.vMm, widthMm: hole.widthMm, heightMm: hole.heightMm };
    const resize =
        staying.kind === 'opening' &&
        staying.surfaceId === moving.surfaceId &&
        staying.openingId === moving.openingId;
    if (!resize) {
        patch.uMm += du;
        patch.vMm += dv;
    } else if (moving.edge === 'u0') {
        patch.uMm += du;
        patch.widthMm -= du;
    } else if (moving.edge === 'u1') {
        patch.widthMm += du;
    } else if (moving.edge === 'v0') {
        patch.vMm += dv;
        patch.heightMm -= dv;
    } else {
        patch.heightMm += dv;
    }
    return { kind: 'opening', surfaceId: surface.id, openingId: hole.id, patch };
}
