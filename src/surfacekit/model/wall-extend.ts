/**
 * Pulling a stretch of wall out of the plan — how a rectangular house becomes an L.
 *
 * The gesture is the plan's own: put a node on a wall, and drag the part of the wall between
 * that node and one of its ends (or between two nodes) out by a module or two. What it has to
 * do to the model is a 3D edit, because a wall in plan is a stack of faces in space, and
 * everything that meets it — the floor it stands on, the walls it turns the corner into, the
 * roof or storey floor above it — has to come along or the house tears open.
 *
 * The rule is one question asked of every edge of the moved piece: **does the face on the other
 * side of it contain the direction of the pull?**
 *
 *   - **Yes → it stretches.** The floor, a flat roof, the storey floor above, the corner wall
 *     the piece turns into and a gable's roof planes (whose ridge runs the way the gable end is
 *     pulled) all contain the pull, so the edge the piece shares with them moves out and they
 *     grow along with it, staying planar by construction.
 *   - **No → a new face fills the gap.** The part of the wall that stays behind is crossed by
 *     the pull, so it gets a return wall between it and the moved piece; a roof plane sloping
 *     *down to* the pulled wall is crossed by it too, so the wing gets a flat roof strip at the
 *     eave instead of a roof plane dragged out of its own plane. That flat strip is a real
 *     roof face and can be pitched with Move afterwards — this edit never invents a pitch.
 *
 * The part of the wall that was pulled does not stay behind as well, which is what makes the
 * connection between the old house and the new wing **open** in plan: there is floor where the
 * wall stood, and nothing standing on it.
 *
 * Every storey from the active one up is pulled together, the same way an interior wall climbs
 * every storey above the one it was drawn in — an L-shaped house is L-shaped all the way up.
 *
 * Pure, like `surface-ops.ts`: surfaces in, the next surfaces out, and the store decides whether
 * the result is admissible (`SurfaceStore.extendWall`).
 */

import { distance3, planeOfPolygon, type Point3Mm, type Vec2Mm } from '../core';
import type { Surface, SurfaceId, SurfaceKind } from './surface';
import { classifyAll } from './classify';
import { openingFromRing3, openingRing3, remapOpenings, surfaceFrame } from './surface-frame';
import { insertOnRing, roundPoint, samePoint, segmentOnRing, COINCIDENT_MM } from './surface-ops';

/** A face is vertical when its normal has this little Z. Matches `classify.ts`. */
const VERTICAL_NORMAL_Z = 0.0175;
/** A plane "contains" the pull when its normal is this close to perpendicular to it. */
const IN_PLANE_DOT = 0.01;
/** A stretch of wall shorter than this is not worth pulling, mm. */
const MIN_SEGMENT_MM = 50;

export interface WallExtendRequest {
    /** The plan segment being pulled — both ends on one wall line (or one floor edge). */
    fromMm: Vec2Mm;
    toMm: Vec2Mm;
    /** Where the pull starts: faces lower than this (the storeys below) are left alone. */
    baseZMm: number;
    /** How far, and which way, in plan. Only its component across the segment counts. */
    offsetMm: Vec2Mm;
}

export type WallExtendResult =
    | {
          ok: true;
          /** The whole next model, in the original order with new faces appended. */
          surfaces: Surface[];
          /** Faces that are new or reshaped — the ones the store has to validate. */
          touched: SurfaceId[];
      }
    | { ok: false; message: string };

/**
 * The model after pulling `fromMm`–`toMm` out by `offsetMm`. `mintId` names the new faces, so
 * the store keeps control of ids.
 */
export function extendWall(
    surfaces: readonly Surface[],
    request: WallExtendRequest,
    mintId: () => SurfaceId
): WallExtendResult {
    const p = request.fromMm;
    const q = request.toMm;
    const lengthMm = Math.hypot(q.x - p.x, q.y - p.y);
    if (lengthMm < MIN_SEGMENT_MM) {
        return { ok: false, message: 'Pick a stretch of wall to pull, not a point.' };
    }
    const along: Vec2Mm = { x: (q.x - p.x) / lengthMm, y: (q.y - p.y) / lengthMm };
    const across: Vec2Mm = { x: -along.y, y: along.x };
    const distanceMm = request.offsetMm.x * across.x + request.offsetMm.y * across.y;
    if (Math.round(distanceMm) === 0) {
        return { ok: false, message: 'Pull the wall some distance first.' };
    }
    const shift: Point3Mm = {
        x: Math.round(across.x * distanceMm),
        y: Math.round(across.y * distanceMm),
        z: 0,
    };
    const tOf = (pt: Point3Mm | Vec2Mm): number => (pt.x - p.x) * along.x + (pt.y - p.y) * along.y;
    const offLine = (pt: Point3Mm): number =>
        Math.abs((pt.x - p.x) * across.x + (pt.y - p.y) * across.y);

    // ---- 1. The walls standing on the segment, from the base up ----
    const moving = surfaces.filter((s) => {
        const plane = planeOfPolygon(s.boundaryMm);
        if (!plane || Math.abs(plane.normal.z) >= VERTICAL_NORMAL_Z) return false;
        if (s.boundaryMm.some((pt) => offLine(pt) > COINCIDENT_MM)) return false;
        if (Math.min(...s.boundaryMm.map((pt) => pt.z)) < request.baseZMm - COINCIDENT_MM) {
            return false;
        }
        const ts = s.boundaryMm.map(tOf);
        return Math.min(lengthMm, Math.max(...ts)) - Math.max(0, Math.min(...ts)) > COINCIDENT_MM;
    });
    const movingIds = new Set(moving.map((s) => s.id));

    // ---- 2. Each one cut at the two ends of the segment; the middle moves ----
    const replacements = new Map<SurfaceId, Surface[]>();
    const staying: Surface[] = [];
    const moved: { before: Point3Mm[]; surface: Surface }[] = [];
    for (const wall of moving) {
        const frame = surfaceFrame(wall.boundaryMm);
        if (!frame) return { ok: false, message: `${wall.id} has no plane to cut.` };
        const holeRings = wall.openings.map((h) => ({ hole: h, ring: openingRing3(frame, h) }));
        for (const { ring } of holeRings) {
            const ts = ring.map(tOf);
            const lo = Math.min(...ts);
            const hi = Math.max(...ts);
            const straddles = (t: number): boolean =>
                lo < t - COINCIDENT_MM && hi > t + COINCIDENT_MM;
            if (straddles(0) || straddles(lengthMm)) {
                return {
                    ok: false,
                    message: 'A door or window crosses the node — move the node clear of it.',
                };
            }
        }
        const holesIn = (lo: number, hi: number, delta: Point3Mm | null, ring: Point3Mm[]) => {
            const pieceFrame = surfaceFrame(ring);
            if (!pieceFrame) return [];
            return holeRings.flatMap(({ hole, ring: hr }) => {
                const ts = hr.map(tOf);
                if (Math.min(...ts) < lo - COINCIDENT_MM || Math.max(...ts) > hi + COINCIDENT_MM) {
                    return [];
                }
                const placed = delta ? hr.map((pt) => add(pt, delta)) : hr;
                const remapped = openingFromRing3(pieceFrame, placed, hole.id);
                return remapped ? [{ ...hole, ...remapped }] : [];
            });
        };

        const left = clipByT(wall.boundaryMm, tOf, -Infinity, 0);
        const middle = clipByT(wall.boundaryMm, tOf, 0, lengthMm);
        const right = clipByT(wall.boundaryMm, tOf, lengthMm, Infinity);
        if (!middle) continue;
        const pieces: Surface[] = [];
        let keptId = false;
        const idFor = (): SurfaceId => {
            if (keptId) return mintId();
            keptId = true;
            return wall.id;
        };
        for (const [ring, lo, hi] of [
            [left, -Infinity, 0],
            [right, lengthMm, Infinity],
        ] as const) {
            if (!ring) continue;
            const piece: Surface = {
                ...wall,
                id: idFor(),
                boundaryMm: ring,
                openings: holesIn(lo, hi, null, ring),
            };
            pieces.push(piece);
            staying.push(piece);
        }
        const movedRing = middle.map((pt) => add(pt, shift));
        const movedPiece: Surface = {
            ...wall,
            id: idFor(),
            boundaryMm: movedRing,
            openings: holesIn(0, lengthMm, shift, movedRing),
        };
        pieces.push(movedPiece);
        moved.push({ before: middle, surface: movedPiece });
        replacements.set(wall.id, pieces);
    }

    // ---- 3. The edges the moved pieces leave behind ----
    const edges: [Point3Mm, Point3Mm][] = [];
    const seen = new Set<string>();
    const addEdge = (a: Point3Mm, b: Point3Mm): void => {
        if (samePoint(a, b)) return;
        const key = [a, b]
            .map((pt) => `${pt.x},${pt.y},${pt.z}`)
            .sort()
            .join('|');
        if (seen.has(key)) return;
        seen.add(key);
        edges.push([a, b]);
    };
    for (const { before } of moved) {
        for (let i = 0; i < before.length; i++)
            addEdge(before[i]!, before[(i + 1) % before.length]!);
    }
    // No wall on the line: it is a floor's own edge being pulled (a plan with no walls yet).
    if (moved.length === 0) {
        addEdge({ x: p.x, y: p.y, z: request.baseZMm }, { x: q.x, y: q.y, z: request.baseZMm });
    }

    // ---- 4. Stretch what contains the pull, fill across what does not ----
    const others: Surface[] = [...surfaces.filter((s) => !movingIds.has(s.id)), ...staying];
    const stretchEdges = new Map<SurfaceId, [Point3Mm, Point3Mm][]>();
    const welds = new Map<SurfaceId, Point3Mm[]>();
    const fillers: { ring: Point3Mm[]; kindOverride: SurfaceKind | null }[] = [];
    const kinds = classifyAll(surfaces);
    let sharedAny = false;
    for (const [a, b] of edges) {
        const sharers = others.filter((s) => segmentOnRing(s.boundaryMm, a, b));
        if (sharers.length === 0) continue;
        sharedAny = true;
        const stretchers = sharers.filter((s) => containsPull(s, shift));
        if (stretchers.length > 0) {
            for (const s of stretchers) {
                stretchEdges.set(s.id, [...(stretchEdges.get(s.id) ?? []), [a, b]]);
            }
            continue;
        }
        // A level strip across a roof's eave is a roof, but `classify.ts` would call it a floor:
        // the roof plane and the gable both rise from its edge, which is exactly what "something
        // stands on it" looks like. Pinned, since the geometry alone cannot tell the two apart.
        const acrossRoof = a.z === b.z && sharers.every((s) => kinds.get(s.id) === 'roof');
        fillers.push({
            ring: [a, b, add(b, shift), add(a, shift)],
            kindOverride: acrossRoof ? 'roof' : null,
        });
        // The faces the filler meets gain its corners, so they keep sharing the edge later.
        for (const s of sharers) welds.set(s.id, [...(welds.get(s.id) ?? []), a, b]);
    }
    if (moved.length === 0 && !sharedAny) {
        return { ok: false, message: 'There is no wall or floor edge there to pull.' };
    }

    // ---- 5. Assemble ----
    const touched: SurfaceId[] = [];
    const next: Surface[] = [];
    for (const s of surfaces) {
        const pieces = replacements.get(s.id);
        if (pieces) {
            next.push(...pieces);
            touched.push(...pieces.map((x) => x.id));
            continue;
        }
        next.push(s);
    }
    for (let i = 0; i < next.length; i++) {
        const s = next[i]!;
        const toStretch = stretchEdges.get(s.id);
        const toWeld = welds.get(s.id);
        if (!toStretch && !toWeld) continue;
        let ring: readonly Point3Mm[] = s.boundaryMm;
        for (const pt of toWeld ?? []) ring = insertOnRing(ring, pt)?.ring ?? ring;
        if (toStretch) {
            const stretched = stretchRing(ring, toStretch, shift);
            if (!stretched) {
                return { ok: false, message: `${s.id} cannot follow the pulled wall.` };
            }
            ring = stretched;
        }
        const holes = remapOpenings(s, ring, null);
        if (!holes) {
            return {
                ok: false,
                message: `An opening in ${s.id} would end up outside it — move it first.`,
            };
        }
        next[i] = { ...s, boundaryMm: ring, openings: holes };
        if (!touched.includes(s.id)) touched.push(s.id);
    }
    for (const { ring, kindOverride } of fillers) {
        const surface: Surface = {
            id: mintId(),
            boundaryMm: ring.map(roundPoint),
            openings: [],
            holes: [],
            kindOverride,
            loadBearing: null,
            spanDirectionOverride: null,
            roofGroupId: null,
            studSectionOverride: null,
        };
        next.push(surface);
        touched.push(surface.id);
    }
    return { ok: true, surfaces: next, touched };
}

function add(a: Point3Mm, b: Point3Mm): Point3Mm {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Does the face's own plane contain the (horizontal) pull direction? */
function containsPull(surface: Surface, shift: Point3Mm): boolean {
    const plane = planeOfPolygon(surface.boundaryMm);
    if (!plane) return false;
    const len = Math.hypot(shift.x, shift.y);
    return Math.abs((plane.normal.x * shift.x + plane.normal.y * shift.y) / len) < IN_PLANE_DOT;
}

/**
 * The part of a ring whose `t` lies in `[lo, hi]` — Sutherland–Hodgman against the two
 * half-planes, which is exact for the convex faces a wall is (a rectangle, a gable pentagon).
 * Null when nothing of the ring is left, or only a sliver.
 */
function clipByT(
    ring: readonly Point3Mm[],
    tOf: (p: Point3Mm) => number,
    lo: number,
    hi: number
): Point3Mm[] | null {
    let out: Point3Mm[] = [...ring];
    for (const [bound, keep] of [
        [lo, (t: number) => t >= lo - COINCIDENT_MM],
        [hi, (t: number) => t <= hi + COINCIDENT_MM],
    ] as const) {
        if (!Number.isFinite(bound) || out.length === 0) continue;
        const input = out;
        out = [];
        for (let i = 0; i < input.length; i++) {
            const a = input[i]!;
            const b = input[(i + 1) % input.length]!;
            const ta = tOf(a);
            const tb = tOf(b);
            const aIn = keep(ta);
            const bIn = keep(tb);
            if (aIn) out.push(a);
            if (aIn !== bIn) {
                const k = (bound - ta) / (tb - ta);
                out.push(
                    roundPoint({
                        x: a.x + (b.x - a.x) * k,
                        y: a.y + (b.y - a.y) * k,
                        z: a.z + (b.z - a.z) * k,
                    })
                );
            }
        }
    }
    const cleaned = dedupe(out);
    if (cleaned.length < 3) return null;
    const ts = cleaned.map(tOf);
    if (Math.max(...ts) - Math.min(...ts) <= COINCIDENT_MM) return null;
    return cleaned;
}

/** Drops consecutive repeats, including the last-to-first one. */
function dedupe(ring: readonly Point3Mm[]): Point3Mm[] {
    const out: Point3Mm[] = [];
    for (const pt of ring) {
        if (out.length > 0 && samePoint(out[out.length - 1]!, pt)) continue;
        out.push(pt);
    }
    while (out.length > 1 && samePoint(out[0]!, out[out.length - 1]!)) out.pop();
    return out;
}

/**
 * The ring with each edge `a`–`b` pushed out by `shift`: the run of the ring from `a` to `b`
 * becomes `a, a+shift, …, b+shift, b`, and the corners that leaves standing in a straight line
 * are taken out again — which is how a corner wall grows by the pull rather than gaining a
 * zero-width notch. Only the corners this edit made or moved are ever taken out; a corner the
 * face had for some other reason (a weld from an earlier split) stays.
 */
function stretchRing(
    ring: readonly Point3Mm[],
    edges: readonly [Point3Mm, Point3Mm][],
    shift: Point3Mm
): Point3Mm[] | null {
    let current: Point3Mm[] = [...ring];
    const editPoints: Point3Mm[] = [];
    for (const [a, b] of edges) {
        current = [...(insertOnRing(current, a)?.ring ?? current)];
        current = [...(insertOnRing(current, b)?.ring ?? current)];
        const ia = current.findIndex((pt) => samePoint(pt, a));
        const ib = current.findIndex((pt) => samePoint(pt, b));
        if (ia === -1 || ib === -1) return null;
        const run =
            forwardRunOnSegment(current, ia, ib, a, b) ??
            forwardRunOnSegment(current, ib, ia, a, b);
        if (!run) return null;
        const [from, to] = run;
        const path: Point3Mm[] = [];
        for (let i = from; ; i = (i + 1) % current.length) {
            path.push(current[i]!);
            if (i === to) break;
        }
        const replacement = [path[0]!, ...path.map((pt) => add(pt, shift)), path[path.length - 1]!];
        editPoints.push(...replacement);
        // Rotate so the run starts at index 0, then splice it out and the replacement in.
        const rotated = [...current.slice(from), ...current.slice(0, from)];
        current = [...replacement, ...rotated.slice(path.length)];
    }
    return simplifyAt(current, editPoints);
}

/** `[from, to]` when walking forward from `from` reaches `to` without leaving `a`–`b`. */
function forwardRunOnSegment(
    ring: readonly Point3Mm[],
    from: number,
    to: number,
    a: Point3Mm,
    b: Point3Mm
): [number, number] | null {
    for (let i = from; ; i = (i + 1) % ring.length) {
        if (distanceToSegment(ring[i]!, a, b) > COINCIDENT_MM) return null;
        if (i === to) return [from, to];
    }
}

function distanceToSegment(pt: Point3Mm, a: Point3Mm, b: Point3Mm): number {
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
    const k =
        len2 === 0
            ? 0
            : Math.max(
                  0,
                  Math.min(
                      1,
                      ((pt.x - a.x) * ab.x + (pt.y - a.y) * ab.y + (pt.z - a.z) * ab.z) / len2
                  )
              );
    return distance3(pt, { x: a.x + ab.x * k, y: a.y + ab.y * k, z: a.z + ab.z * k });
}

/**
 * Removes repeats, and corners standing in a straight line with their neighbours — whether
 * between them or doubling back past one — but only at the given positions.
 */
function simplifyAt(ring: readonly Point3Mm[], at: readonly Point3Mm[]): Point3Mm[] {
    let out = dedupe(ring);
    let changed = true;
    while (changed && out.length > 3) {
        changed = false;
        for (let i = 0; i < out.length; i++) {
            const pt = out[i]!;
            if (!at.some((x) => samePoint(x, pt))) continue;
            const prev = out[(i - 1 + out.length) % out.length]!;
            const next = out[(i + 1) % out.length]!;
            const straight =
                samePoint(prev, next) || distanceToLine(pt, prev, next) <= COINCIDENT_MM;
            if (!straight) continue;
            out = dedupe([...out.slice(0, i), ...out.slice(i + 1)]);
            changed = true;
            break;
        }
    }
    return out;
}

function distanceToLine(pt: Point3Mm, a: Point3Mm, b: Point3Mm): number {
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ap = { x: pt.x - a.x, y: pt.y - a.y, z: pt.z - a.z };
    const cx = ab.y * ap.z - ab.z * ap.y;
    const cy = ab.z * ap.x - ab.x * ap.z;
    const cz = ab.x * ap.y - ab.y * ap.x;
    const len = Math.hypot(ab.x, ab.y, ab.z);
    return len === 0 ? distance3(pt, a) : Math.hypot(cx, cy, cz) / len;
}
