/**
 * Moving a wall line in plan — what an edited dimension does to the model.
 *
 * Type a new length for a wall and the wall at its far end has to move; type a new distance
 * between two parallel walls and one of them has to. Both are the same edit: **a plan segment
 * (a wall's footprint, or just a wall's free end) moves sideways, and everything standing on
 * it comes along.**
 *
 * "Standing on it" is read by position, not by edge. Topology here is by coincidence
 * (`surface-ops.ts`), and an interior wall that ends mid-way along an exterior wall gives that
 * wall no vertex — so asking "which faces share an edge with the moved wall", as `extendWall`
 * does, would leave the T-wall behind. Instead every vertex whose plan position is on the
 * segment moves: the wall's own corners, the corner walls and the floor and roof that end on it,
 * the T-walls that end on it, and a gable's ridge end above it. The faces they belong to either
 * translate whole (the wall on the line) or stretch (everything that meets it).
 *
 * **The segment is the whole straight line, not just the wall that was picked.** A roof's eave or a
 * porch ceiling often runs on past the end of the wall under it — a covered porch, a carport
 * under the same roof — and moving only the wall's stretch of that line would take one corner of
 * the eave and leave the other, twisting the roof plane out of flat. So the segment is first
 * grown along every face edge that lies on the same line and touches it, and everything on the
 * grown segment moves. Loose lines on it (a porch's columns) go with it; that part is the
 * store's, since lines are not faces.
 *
 * **A duo-pitch roof keeps its pitches.** Moving an eave wall of a gable roof and leaving the
 * ridge where it was would stretch one roof plane and not the other: the house gets wider and the
 * roof lopsided, two pitches where there was one. The carpenter's reading of "make the house
 * 200 wider" is that the roof comes along at the angle it was drawn at, so the ridge moves too —
 * sideways and up, to where the two planes, each at its old pitch, meet over the new eaves
 * (`ridgeMoves`). A mono-pitch roof, whose top sits on a wall rather than on another roof plane,
 * has no such meeting point and keeps the old behaviour: its pitch changes.
 *
 * Only faces from the base up take part, the same rule `extendWall` applies: the storey below
 * shares its top edge with this storey's floor, and moving that edge would lean its walls over.
 *
 * Openings keep their place in the world on a face that stretches — which is what "the other
 * end is pinned" means for a window on the wall being lengthened — and move with a face that
 * translates whole. Either way they are re-measured in the new frame (`remapOpenings`), because
 * the frame's origin is the wall's min-u corner and may just have moved.
 *
 * Pure: surfaces in, the next surfaces out. The store validates the shapes.
 */

import type { Point3Mm, Vec2Mm } from '../core';
import type { Surface, SurfaceId } from './surface';
import { classifyAll } from './classify';
import { remapOpenings } from './surface-frame';
import {
    COINCIDENT_MM,
    moveRingVerticesTo,
    roundPoint,
    samePoint,
    type VertexMove,
} from './surface-ops';
import { roofFollowMoves } from './roof-follow';

/** A straight stretch of wall line in plan. Both ends the same point for a free wall end. */
export interface WallLineSegment {
    aMm: Vec2Mm;
    bMm: Vec2Mm;
}

export interface WallLineMoveRequest {
    /** The plan segment that moves. */
    segment: WallLineSegment;
    /** How far, and which way, in plan. */
    shiftMm: Vec2Mm;
    /** Faces lower than this (the storeys below) are left alone. */
    baseZMm: number;
}

export type WallLineMoveResult =
    | {
          ok: true;
          /** The whole next model, in the original order. */
          surfaces: Surface[];
          /** Faces that were moved or reshaped — the ones the store has to validate. */
          touched: SurfaceId[];
          /** The segment that actually moved, grown along the line (see the module note). */
          segment: WallLineSegment;
      }
    | { ok: false; message: string };

/** Whether a plan point lies on the segment, within the model's coincidence tolerance. */
export function onPlanSegment(pt: Vec2Mm, aMm: Vec2Mm, bMm: Vec2Mm): boolean {
    const dx = bMm.x - aMm.x;
    const dy = bMm.y - aMm.y;
    const len2 = dx * dx + dy * dy;
    const t =
        len2 === 0
            ? 0
            : Math.max(0, Math.min(1, ((pt.x - aMm.x) * dx + (pt.y - aMm.y) * dy) / len2));
    return Math.hypot(pt.x - (aMm.x + t * dx), pt.y - (aMm.y + t * dy)) <= COINCIDENT_MM;
}

export function moveWallLine(
    surfaces: readonly Surface[],
    request: WallLineMoveRequest
): WallLineMoveResult {
    const { aMm, bMm } = growAlongLine(surfaces, request.segment, request.baseZMm);
    const shift: Point3Mm = {
        x: Math.round(request.shiftMm.x),
        y: Math.round(request.shiftMm.y),
        z: 0,
    };
    if (shift.x === 0 && shift.y === 0) return { ok: false, message: 'Nothing to move.' };

    const kinds = classifyAll(surfaces);
    const onLine = (p: Point3Mm): boolean => onPlanSegment(p, aMm, bMm);
    const moved = (p: Point3Mm): Point3Mm =>
        roundPoint({ x: p.x + shift.x, y: p.y + shift.y, z: p.z });

    const ridge = ridgeMoves(surfaces, kinds, { aMm, bMm }, shift, request.baseZMm);
    const ridgeTarget = (p: Point3Mm): Point3Mm | null =>
        ridge.find((m) => samePoint(p, m.fromMm))?.toMm ?? null;

    const next: Surface[] = [];
    const touched: SurfaceId[] = [];
    const roofMoves: VertexMove[] = [];
    for (const s of surfaces) {
        const baseZ = Math.min(...s.boundaryMm.map((p) => p.z));
        const reshaped = s.boundaryMm.some((p) => onLine(p) || ridgeTarget(p) !== null);
        if (baseZ < request.baseZMm - COINCIDENT_MM || !reshaped) {
            next.push(s);
            continue;
        }
        const ring = s.boundaryMm.map((p) => (onLine(p) ? moved(p) : (ridgeTarget(p) ?? p)));
        const whole = s.boundaryMm.every(onLine);
        const holes = s.holes.map((h) => h.map((p) => (whole || onLine(p) ? moved(p) : p)));
        const openings = remapOpenings(s, ring, whole ? shift : null);
        if (!openings) {
            return {
                ok: false,
                message: `An opening in ${s.id} would end up outside it — move it first.`,
            };
        }
        if (kinds.get(s.id) === 'roof') {
            for (const p of s.boundaryMm) {
                if (onLine(p)) roofMoves.push({ fromMm: p, toMm: moved(p) });
                const to = ridgeTarget(p);
                if (to) roofMoves.push({ fromMm: p, toMm: to });
            }
        }
        next.push({ ...s, boundaryMm: ring, holes, openings });
        touched.push(s.id);
    }
    if (touched.length === 0) {
        return { ok: false, message: 'There is no wall there to move.' };
    }

    // Interior walls built up to a roof that just changed pitch stay on it.
    const follow = roofFollowMoves(surfaces, roofMoves);
    if (follow.length > 0) {
        for (let i = 0; i < next.length; i++) {
            const s = next[i]!;
            const { ring, moved: any } = moveRingVerticesTo(s.boundaryMm, follow);
            if (!any) continue;
            const openings = remapOpenings(s, ring, null);
            if (!openings) {
                return {
                    ok: false,
                    message: `An opening in ${s.id} would end up outside it — move it first.`,
                };
            }
            next[i] = { ...s, boundaryMm: ring, openings };
            if (!touched.includes(s.id)) touched.push(s.id);
        }
    }
    return { ok: true, surfaces: next, touched, segment: { aMm, bMm } };
}

/** Two heights this close are the same level, mm. Matches `classify.ts`. */
const LEVEL_TOLERANCE_MM = 1;

/** Two pitches whose slopes (rise per run) differ by less than this are the same pitch. */
const SAME_SLOPE = 0.005;

/**
 * Where the ridge of each duo-pitch roof with an eave on the moved line has to go for both of its
 * planes to keep their pitch (see the module note).
 *
 * A roof plane takes part when its corners on the line are its eave — all at its lowest level —
 * and every other corner is its ridge: level, and on a line parallel to the eave. The plane on
 * the other side of that ridge is every other roof face with a corner on it; each of them has to
 * be a plain slope down from the ridge (two or more ridge corners, an eave parallel to it and off
 * the moved line), all at one pitch. Anything else — a hip end meeting the ridge in a single
 * point, a mono-pitch plane whose top rests on a wall — is left as it was, ridge and all.
 *
 * With the moved plane at slope `a` and the other at `b`, an eave that moves `s` away from the
 * ridge takes the ridge `s·a/(a+b)` the same way and `that·b` up: the one point where a plane at
 * slope `a` from the new eave meets a plane at slope `b` from the old one. A symmetric roof's
 * ridge stays in the middle, rising by half the widening times the slope.
 */
function ridgeMoves(
    surfaces: readonly Surface[],
    kinds: ReadonlyMap<SurfaceId, string>,
    segment: WallLineSegment,
    shift: Point3Mm,
    baseZMm: number
): VertexMove[] {
    const { aMm, bMm } = segment;
    const len = Math.hypot(bMm.x - aMm.x, bMm.y - aMm.y);
    if (len <= COINCIDENT_MM) return [];
    // Horizontal unit normal of the moved line; `off` is a point's signed plan distance from it.
    const n = { x: -(bMm.y - aMm.y) / len, y: (bMm.x - aMm.x) / len };
    const off = (p: Point3Mm): number => (p.x - aMm.x) * n.x + (p.y - aMm.y) * n.y;
    const onLine = (p: Point3Mm): boolean => onPlanSegment(p, aMm, bMm);
    const level = (a: number, b: number): boolean => Math.abs(a - b) <= LEVEL_TOLERANCE_MM;

    const roofs = surfaces.filter(
        (s) =>
            kinds.get(s.id) === 'roof' &&
            Math.min(...s.boundaryMm.map((p) => p.z)) >= baseZMm - COINCIDENT_MM
    );

    /** The face's slope down from `ridge` to its eave, or null when it is not a plain slope. */
    const slopeFrom = (s: Surface, ridge: readonly Point3Mm[], ridgeOff: number) => {
        const topZ = ridge[0]!.z;
        const ring = s.boundaryMm;
        const top = ring.filter((p) => level(p.z, topZ));
        if (top.length < 2 || top.some((p) => Math.abs(off(p) - ridgeOff) > COINCIDENT_MM))
            return null;
        if (ring.some((p) => p.z > topZ + LEVEL_TOLERANCE_MM)) return null;
        const lowZ = Math.min(...ring.map((p) => p.z));
        const eave = ring.filter((p) => level(p.z, lowZ));
        if (eave.length < 2 || level(lowZ, topZ)) return null;
        const eaveOff = off(eave[0]!);
        if (eave.some((p) => Math.abs(off(p) - eaveOff) > COINCIDENT_MM)) return null;
        const run = Math.abs(eaveOff - ridgeOff);
        return run > COINCIDENT_MM ? { slope: (topZ - lowZ) / run, eaveOff } : null;
    };

    const moves: VertexMove[] = [];
    for (const r of roofs) {
        const eave = r.boundaryMm.filter(onLine);
        const ridge = r.boundaryMm.filter((p) => !onLine(p));
        if (eave.length < 2 || ridge.length < 2) continue;
        const lowZ = Math.min(...r.boundaryMm.map((p) => p.z));
        if (eave.some((p) => !level(p.z, lowZ))) continue;
        const topZ = ridge[0]!.z;
        if (ridge.some((p) => !level(p.z, topZ)) || level(topZ, lowZ)) continue;
        const ridgeOff = off(ridge[0]!);
        if (ridge.some((p) => Math.abs(off(p) - ridgeOff) > COINCIDENT_MM)) continue;
        if (Math.abs(ridgeOff) <= COINCIDENT_MM) continue;
        const a = (topZ - lowZ) / Math.abs(ridgeOff);

        // The planes on the other side of the ridge: one pitch, eaves off the moved line.
        let b: number | null = null;
        let plain = true;
        for (const o of roofs) {
            if (o === r || !o.boundaryMm.some((p) => ridge.some((q) => samePoint(p, q)))) continue;
            const other = slopeFrom(o, ridge, ridgeOff);
            if (!other) {
                plain = false;
                break;
            }
            // A plane on the same side (the porch's continuation of this one) is not the other side.
            if (Math.sign(other.eaveOff - ridgeOff) === Math.sign(-ridgeOff)) {
                if (Math.abs(other.slope - a) > SAME_SLOPE) plain = false;
                continue;
            }
            if (o.boundaryMm.some(onLine)) plain = false;
            if (b !== null && Math.abs(other.slope - b) > SAME_SLOPE) plain = false;
            b ??= other.slope;
        }
        if (!plain || b === null) continue;

        // `away` points from the ridge towards this plane's eave.
        const away = Math.sign(-ridgeOff);
        const sAway = (shift.x * n.x + shift.y * n.y) * away;
        const d = (sAway * a) / (a + b);
        const delta = { x: n.x * away * d, y: n.y * away * d, z: d * b };
        for (const p of ridge) {
            if (moves.some((m) => samePoint(m.fromMm, p))) continue;
            moves.push({
                fromMm: p,
                toMm: roundPoint({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z }),
            });
        }
    }
    return moves;
}

/**
 * `segment` grown along its own line over every edge (of a face from the base up) that lies on
 * that line and overlaps or touches it — until nothing more does. A point stays a point: a free
 * wall end has no line to grow along.
 */
export function growAlongLine(
    surfaces: readonly Surface[],
    segment: WallLineSegment,
    baseZMm: number
): WallLineSegment {
    const { aMm, bMm } = segment;
    const len = Math.hypot(bMm.x - aMm.x, bMm.y - aMm.y);
    if (len <= COINCIDENT_MM) return segment;
    const d = { x: (bMm.x - aMm.x) / len, y: (bMm.y - aMm.y) / len };
    const along = (p: Vec2Mm): number => (p.x - aMm.x) * d.x + (p.y - aMm.y) * d.y;
    const onLine = (p: Vec2Mm): boolean =>
        Math.abs((p.x - aMm.x) * -d.y + (p.y - aMm.y) * d.x) <= COINCIDENT_MM;
    const edges: [number, number][] = [];
    for (const s of surfaces) {
        if (Math.min(...s.boundaryMm.map((p) => p.z)) < baseZMm - COINCIDENT_MM) continue;
        const ring = s.boundaryMm;
        for (let i = 0; i < ring.length; i++) {
            const p = ring[i]!;
            const q = ring[(i + 1) % ring.length]!;
            if (!onLine(p) || !onLine(q)) continue;
            const tp = along(p);
            const tq = along(q);
            if (Math.abs(tp - tq) > COINCIDENT_MM) edges.push([Math.min(tp, tq), Math.max(tp, tq)]);
        }
    }
    let lo = 0;
    let hi = len;
    let grew = true;
    while (grew) {
        grew = false;
        for (const [t0, t1] of edges) {
            if (t1 < lo - COINCIDENT_MM || t0 > hi + COINCIDENT_MM) continue;
            if (t0 < lo - COINCIDENT_MM || t1 > hi + COINCIDENT_MM) {
                lo = Math.min(lo, t0);
                hi = Math.max(hi, t1);
                grew = true;
            }
        }
    }
    const at = (t: number): Vec2Mm => ({
        x: Math.round(aMm.x + d.x * t),
        y: Math.round(aMm.y + d.y * t),
    });
    return lo === 0 && hi === len ? segment : { aMm: at(lo), bMm: at(hi) };
}
