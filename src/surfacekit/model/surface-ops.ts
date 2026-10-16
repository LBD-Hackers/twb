/**
 * The ring operations behind SketchUp's editing verbs: split a face along a line, push/pull a
 * face into a box, move the vertices several faces share.
 *
 * Pure functions on `Point3Mm[]` rings, with the store deciding what to do with the results —
 * the same split as `grid-validate.ts`, and for the same reason: each of these is a piece of
 * geometry that is much easier to get right, and to test, without a store or a signal in the
 * way.
 *
 * **Topology is by coincidence.** The model has no shared-vertex structure; two faces meet
 * because they have a corner at the same integer-millimetre position, and nothing else. That
 * is deliberately weaker than a real B-rep and it is enough for the verbs here: `moveVertices`
 * moves every vertex at a given position in every face, so an edge two faces share moves in
 * both, and `insertOnRing` is applied to every face whose edge passes through a split point,
 * so the end walls of a box pick up the ridge point the moment the roof is split — which is
 * what turns them into gables when the ridge is lifted. Integer coordinates are what make
 * "the same position" a plain equality rather than a tolerance nobody agrees on.
 */

import {
    add3,
    distance3,
    nearestPointOnSegment3,
    scale3,
    type Dir3,
    type Point3Mm,
} from '../core';

/**
 * Two positions this close are the same vertex, mm.
 *
 * Larger than `geom2.ts`'s `WELD_EPS_MM` on purpose: those are float intermediates, these are
 * the model's own integer coordinates, so anything under a millimetre is rounding, not shape.
 */
export const COINCIDENT_MM = 1;

export function samePoint(a: Point3Mm, b: Point3Mm, toleranceMm = COINCIDENT_MM): boolean {
    return distance3(a, b) <= toleranceMm;
}

export type RingLocation =
    | { kind: 'vertex'; index: number }
    /** On the edge from `ring[index]` to `ring[index + 1]`, strictly between its ends. */
    | { kind: 'edge'; index: number };

/** Where a point sits on a ring — a vertex, the interior of an edge, or nowhere. */
export function locateOnRing(
    ring: readonly Point3Mm[],
    p: Point3Mm,
    toleranceMm = COINCIDENT_MM
): RingLocation | null {
    for (let i = 0; i < ring.length; i++) {
        if (samePoint(ring[i]!, p, toleranceMm)) return { kind: 'vertex', index: i };
    }
    let best: { index: number; distanceMm: number } | null = null;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const { pointMm } = nearestPointOnSegment3(p, a, b);
        const d = distance3(pointMm, p);
        if (d <= toleranceMm && (!best || d < best.distanceMm)) best = { index: i, distanceMm: d };
    }
    return best ? { kind: 'edge', index: best.index } : null;
}

/**
 * The ring with `p` as a vertex, if `p` lies on it: unchanged when it already is one, with
 * `p` spliced into the edge it sits on otherwise. Null when `p` is not on the ring at all.
 */
export function insertOnRing(
    ring: readonly Point3Mm[],
    p: Point3Mm,
    toleranceMm = COINCIDENT_MM
): { ring: readonly Point3Mm[]; index: number } | null {
    const where = locateOnRing(ring, p, toleranceMm);
    if (!where) return null;
    if (where.kind === 'vertex') return { ring, index: where.index };
    const next = [...ring];
    next.splice(where.index + 1, 0, p);
    return { ring: next, index: where.index + 1 };
}

/**
 * Splits a ring in two along the chord from `a` to `b`, both of which must lie on it.
 *
 * Returns null when the chord is not a genuine cut: an endpoint off the ring, both endpoints
 * on the same vertex, or the two adjacent — a chord that *is* one of the ring's own edges,
 * which would leave one half with two corners. The halves keep the parent's winding.
 */
export function splitRing(
    ring: readonly Point3Mm[],
    a: Point3Mm,
    b: Point3Mm,
    toleranceMm = COINCIDENT_MM
): readonly [readonly Point3Mm[], readonly Point3Mm[]] | null {
    return splitRingAlong(ring, [a, b], toleranceMm);
}

/**
 * Splits a ring along a path whose first and last points lie on it and whose interior points
 * lie inside it — a line drawn from one edge to another by way of a few corners, which is how
 * an L-shaped room or a hipped roof gets cut out of a face. A two-point path is the plain chord.
 *
 * The interior points are trusted to be inside the ring; the caller checks that, since the
 * ring alone cannot tell "inside" from "outside" without a frame to flatten into. Both halves
 * keep the parent's winding: the first runs along the ring from `a` to `b` and back along the
 * path, the second the other way round.
 */
export function splitRingAlong(
    ring: readonly Point3Mm[],
    path: readonly Point3Mm[],
    toleranceMm = COINCIDENT_MM
): readonly [readonly Point3Mm[], readonly Point3Mm[]] | null {
    if (path.length < 2) return null;
    const a = path[0]!;
    const b = path[path.length - 1]!;
    const withA = insertOnRing(ring, a, toleranceMm);
    if (!withA) return null;
    const withB = insertOnRing(withA.ring, b, toleranceMm);
    if (!withB) return null;
    const full = withB.ring;
    const ia = full.findIndex((p) => samePoint(p, a, toleranceMm));
    const ib = withB.index;
    if (ia === -1 || ia === ib) return null;

    const walk = (from: number, to: number): Point3Mm[] => {
        const out: Point3Mm[] = [];
        for (let i = from; ; i = (i + 1) % full.length) {
            out.push(full[i]!);
            if (i === to) break;
        }
        return out;
    };
    const interior = path.slice(1, -1);
    const first = [...walk(ia, ib), ...[...interior].reverse()];
    const second = [...walk(ib, ia), ...interior];
    if (first.length < 3 || second.length < 3) return null;
    return [first, second];
}

/**
 * Does the segment `a`–`b` run along the ring — is it (part of) one of the ring's own edges?
 *
 * Both ends and the middle on the ring. For the convex faces this tool draws that is exactly
 * "along an edge"; a chord across the interior fails at its midpoint. It is the test that
 * decides whether a line the user drew is a new edge or a re-tracing of an existing one.
 */
export function segmentOnRing(
    ring: readonly Point3Mm[],
    a: Point3Mm,
    b: Point3Mm,
    toleranceMm = COINCIDENT_MM
): boolean {
    return [a, b, midpoint3(a, b)].every((p) => locateOnRing(ring, p, toleranceMm) !== null);
}

/** Does the segment `a`–`b` lie within the segment `p`–`q`? Same three-point test. */
export function segmentOnSegment(
    p: Point3Mm,
    q: Point3Mm,
    a: Point3Mm,
    b: Point3Mm,
    toleranceMm = COINCIDENT_MM
): boolean {
    return [a, b, midpoint3(a, b)].every(
        (r) => distance3(nearestPointOnSegment3(r, p, q).pointMm, r) <= toleranceMm
    );
}

/** Where a point sits on a segment: strictly between its ends, or not on it at all. */
export function insideSegment(
    p: Point3Mm,
    q: Point3Mm,
    r: Point3Mm,
    toleranceMm = COINCIDENT_MM
): boolean {
    if (samePoint(r, p, toleranceMm) || samePoint(r, q, toleranceMm)) return false;
    return distance3(nearestPointOnSegment3(r, p, q).pointMm, r) <= toleranceMm;
}

export function midpoint3(a: Point3Mm, b: Point3Mm): Point3Mm {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/**
 * The faces push/pull makes: the ring moved `distanceMm` along `normal`, plus one quad per
 * edge joining the two. The original face is not among them — it stays where it was, as the
 * bottom of the box, exactly as SketchUp leaves it.
 *
 * Every coordinate is rounded, because a normal is a unit float and the model is integer mm.
 */
export function extrudeRing(
    ring: readonly Point3Mm[],
    normal: Dir3,
    distanceMm: number
): { top: readonly Point3Mm[]; sides: readonly (readonly Point3Mm[])[] } {
    const offset = scale3(normal, distanceMm);
    const top = ring.map((p) => roundPoint(add3(p, offset)));
    const sides: Point3Mm[][] = [];
    for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        sides.push([ring[i]!, ring[j]!, top[j]!, top[i]!]);
    }
    return { top, sides };
}

/**
 * The ring with every vertex at one of `positions` moved by `delta`, and whether any was.
 *
 * "At one of" is by coincidence, per the module note: this is how an edge two faces share
 * moves in both without either knowing about the other.
 */
export function moveRingVertices(
    ring: readonly Point3Mm[],
    positions: readonly Point3Mm[],
    delta: Point3Mm,
    toleranceMm = COINCIDENT_MM
): { ring: readonly Point3Mm[]; moved: boolean } {
    let moved = false;
    const next = ring.map((p) => {
        if (!positions.some((q) => samePoint(p, q, toleranceMm))) return p;
        moved = true;
        return roundPoint(add3(p, delta));
    });
    return { ring: moved ? next : ring, moved };
}

/**
 * One vertex position and where it is going — the general form of a move, for the edits whose
 * vertices do *not* all travel by the same vector.
 *
 * `moveRingVertices` above covers the uniform case (an edge lifted straight up, every corner by
 * the same rise). Re-pitching a plane is the other case: each moved corner's new height depends
 * on how far it stands from the hinge, so the edit is a list of destinations rather than one
 * delta. `pitch.ts` computes those destinations; this applies them.
 */
export interface VertexMove {
    fromMm: Point3Mm;
    toMm: Point3Mm;
}

/**
 * The ring with every vertex matching a move's `fromMm` sent to its `toMm`, and whether any
 * was. Same coincidence rule as `moveRingVertices`, so a shared edge still moves in every face
 * that has a corner there without any of them knowing about each other.
 */
export function moveRingVerticesTo(
    ring: readonly Point3Mm[],
    moves: readonly VertexMove[],
    toleranceMm = COINCIDENT_MM
): { ring: readonly Point3Mm[]; moved: boolean } {
    let moved = false;
    const next = ring.map((p) => {
        const move = moves.find((m) => samePoint(p, m.fromMm, toleranceMm));
        if (!move) return p;
        moved = true;
        return roundPoint(move.toMm);
    });
    return { ring: moved ? next : ring, moved };
}

/** The model is integer millimetres; anything derived through a float goes through here. */
export function roundPoint(p: Point3Mm): Point3Mm {
    return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
}

/**
 * The one ring two faces make together when the edges they share are taken away — SketchUp's
 * "erase the line between two coplanar faces and they heal into one". The undo of a split.
 *
 * Each ring first takes a corner wherever the other has one on its edge, so a split that put a
 * point into one face's edge but not the other's still shares edge for edge. The second ring is
 * turned to wind the same way as the first, the edges they both run along (in opposite
 * directions, then) cancel, and what is left is walked back into a ring. Null when they share no
 * edge, when they are not the same plane's two sides of a cut, or when the remainder is not one
 * ring — two faces touching along two separate stretches enclose a hole, which a face cannot have.
 */
export function mergeRings(
    first: readonly Point3Mm[],
    second: readonly Point3Mm[],
    toleranceMm = COINCIDENT_MM
): Point3Mm[] | null {
    let a: readonly Point3Mm[] = first;
    let b: readonly Point3Mm[] = second;
    for (const p of second) a = insertOnRing(a, p, toleranceMm)?.ring ?? a;
    for (const p of first) b = insertOnRing(b, p, toleranceMm)?.ring ?? b;
    const na = newell(a);
    if (dot(na, newell(b)) < 0) b = [...b].reverse();

    type Edge = { from: Point3Mm; to: Point3Mm };
    const edgesOf = (ring: readonly Point3Mm[]): Edge[] =>
        ring.map((p, i) => ({ from: p, to: ring[(i + 1) % ring.length]! }));
    const ea = edgesOf(a);
    const eb = edgesOf(b);
    const shared = (e: Edge, f: Edge): boolean =>
        samePoint(e.from, f.to, toleranceMm) && samePoint(e.to, f.from, toleranceMm);
    const keptA = ea.filter((e) => !eb.some((f) => shared(e, f)));
    const keptB = eb.filter((f) => !ea.some((e) => shared(e, f)));
    if (keptA.length === ea.length) return null;
    const remaining = [...keptA, ...keptB];
    if (remaining.length < 3) return null;

    const ring: Point3Mm[] = [];
    let edge = remaining.shift()!;
    const start = edge.from;
    ring.push(edge.from);
    while (!samePoint(edge.to, start, toleranceMm)) {
        const i = remaining.findIndex((e) => samePoint(e.from, edge.to, toleranceMm));
        if (i === -1) return null;
        edge = remaining.splice(i, 1)[0]!;
        ring.push(edge.from);
    }
    if (remaining.length > 0) return null;
    const cutEnds = ea.filter((e) => !keptA.includes(e)).flatMap((e) => [e.from, e.to]);
    return dropStraightCorners(ring, cutEnds, toleranceMm);
}

/**
 * The ring without those of `candidates` that now have a straight run through them — what is
 * left at each end of a healed cut. Only those: a straight corner elsewhere was put there to
 * match a neighbour's, and topology by coincidence needs it kept.
 */
function dropStraightCorners(
    ring: readonly Point3Mm[],
    candidates: readonly Point3Mm[],
    toleranceMm: number
): Point3Mm[] {
    const out = [...ring];
    for (let i = 0; i < out.length && out.length > 3;) {
        const prev = out[(i - 1 + out.length) % out.length]!;
        const next = out[(i + 1) % out.length]!;
        const p = out[i]!;
        const isCutEnd = candidates.some((c) => samePoint(c, p, toleranceMm));
        if (isCutEnd && insideSegment(prev, next, p, toleranceMm)) out.splice(i, 1);
        else i++;
    }
    return out;
}

function newell(ring: readonly Point3Mm[]): Point3Mm {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        const q = ring[(i + 1) % ring.length]!;
        x += (p.y - q.y) * (p.z + q.z);
        y += (p.z - q.z) * (p.x + q.x);
        z += (p.x - q.x) * (p.y + q.y);
    }
    return { x, y, z };
}

const dot = (a: Point3Mm, b: Point3Mm): number => a.x * b.x + a.y * b.y + a.z * b.z;
