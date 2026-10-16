/**
 * Finding the face a newly drawn line closes.
 *
 * SketchUp's rule: the moment an edge completes a loop with the edges already there, the loop
 * is a face. This is the (deliberately small) version of that rule this tool applies. Given
 * the segment just drawn, from `a` to `b`, it looks for the *shortest* chain of existing
 * edges — guides and face boundaries alike — that leads from `b` back to `a` without using
 * the new segment itself. The new segment plus that chain is the candidate ring; whether it is
 * a face (planar, big enough) is the store's decision, not this module's.
 *
 * Shortest by edge count, found by breadth-first search over vertices keyed on their integer
 * coordinates. "Topology by coincidence" again (`surface-ops.ts`): two edges connect because
 * they end on the same millimetre, and nothing else. Shortest is the right pick because the
 * smallest loop through a new edge is the face the user is looking at; a longer loop that
 * also closes is one of that face's neighbours seen the long way round.
 *
 * What this does *not* do, on purpose: it never finds a loop the new segment is not part of,
 * and it finds at most one. A line that bisects a ring of guides into two faces makes one of
 * them here; the other is one more click away. That is a much smaller promise than SketchUp's
 * full face-finder, and it covers the case that matters — closing a shape you are drawing.
 */

import {
    cross3,
    distance3,
    dot3,
    length3,
    normalize3,
    sub3,
    type Dir3,
    type Point3Mm,
} from '../core';
import { COINCIDENT_MM, insideSegment, roundPoint, samePoint } from './surface-ops';

export type Segment = readonly [Point3Mm, Point3Mm];

const key = (p: Point3Mm): string => {
    const r = roundPoint(p);
    return `${r.x},${r.y},${r.z}`;
};

/**
 * The chain of existing edges from `b` back to `a`, as a list of points starting with `b` and
 * ending with `a`, or null when no such chain exists. `edges` may include the segment `a`–`b`
 * itself; it is skipped.
 */
export function findLoopPath(
    a: Point3Mm,
    b: Point3Mm,
    edges: readonly Segment[]
): readonly Point3Mm[] | null {
    const adjacency = new Map<string, { to: string; point: Point3Mm }[]>();
    const link = (from: Point3Mm, to: Point3Mm): void => {
        const k = key(from);
        const list = adjacency.get(k) ?? [];
        list.push({ to: key(to), point: to });
        adjacency.set(k, list);
    };
    for (const [p, q] of edges) {
        const isNew = (samePoint(p, a) && samePoint(q, b)) || (samePoint(p, b) && samePoint(q, a));
        if (isNew) continue;
        link(p, q);
        link(q, p);
    }

    const start = key(b);
    const goal = key(a);
    if (start === goal) return null;
    const cameFrom = new Map<string, { from: string; point: Point3Mm }>();
    const queue: string[] = [start];
    const seen = new Set<string>([start]);
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of adjacency.get(current) ?? []) {
            if (seen.has(next.to)) continue;
            seen.add(next.to);
            cameFrom.set(next.to, { from: current, point: next.point });
            if (next.to === goal) return unwind(cameFrom, goal, b);
            queue.push(next.to);
        }
    }
    return null;
}

function unwind(
    cameFrom: ReadonlyMap<string, { from: string; point: Point3Mm }>,
    goal: string,
    start: Point3Mm
): Point3Mm[] {
    const path: Point3Mm[] = [];
    let at = goal;
    for (;;) {
        const step = cameFrom.get(at);
        if (!step) break;
        path.push(step.point);
        at = step.from;
    }
    path.push(start);
    return path.reverse();
}

/**
 * Every face a newly drawn segment closes — SketchUp's full rule, where `findLoopPath` above is
 * the small version of it.
 *
 * The segment `a`–`b` can close a face in any plane that contains it and one of the edges that
 * meet it at either end: the facade it runs along, the ground it drops to, the roof plane it
 * extends. For each such plane the edges lying in it make a planar graph, and the faces of that
 * graph either side of the new segment are found by walking it, always taking the sharpest left
 * turn — which keeps the smallest region on the left. A walk that comes back round clockwise
 * went round the outside of everything and is not a face. So one segment can close no face, one
 * face, or two: a line across a ring of guides makes both halves.
 *
 * Edges are joined where they touch as well as where they meet end to end: a line that ends
 * part-way along an edge makes a corner there (`nodeEdges`), as the store's `breakAt` does.
 * Loops that are the outline of an existing face are the caller's to throw away (the store's
 * duplicate guard does).
 */
export function findPlanarLoops(a: Point3Mm, b: Point3Mm, edges: readonly Segment[]): Point3Mm[][] {
    const noded = nodeEdges([...edges, [a, b]]);
    const ab = sub3(b, a);
    const abLength = length3(ab);
    if (abLength < 1) return [];

    // The planes worth trying: the new segment and each non-collinear edge at either end.
    const normals: Dir3[] = [];
    for (const [p, q] of noded) {
        for (const end of [a, b]) {
            const other = samePoint(p, end) ? q : samePoint(q, end) ? p : null;
            if (!other) continue;
            const n = cross3(ab, sub3(other, end));
            if (length3(n) < 1e-6 * abLength * length3(sub3(other, end))) continue;
            const unit = normalize3(n);
            if (!normals.some((m) => Math.abs(dot3(m, unit)) > 0.99999)) normals.push(unit);
        }
    }

    const loops: Point3Mm[][] = [];
    const seen = new Set<string>();
    for (const normal of normals) {
        const d = dot3(normal, a);
        const inPlane = noded.filter(
            ([p, q]) =>
                Math.abs(dot3(normal, p) - d) <= COINCIDENT_MM &&
                Math.abs(dot3(normal, q) - d) <= COINCIDENT_MM
        );
        const u = normalize3(ab);
        const v = cross3(normal, u);
        const uv = (p: Point3Mm) => ({ x: dot3(sub3(p, a), u), y: dot3(sub3(p, a), v) });
        for (const [from, to] of [
            [a, b],
            [b, a],
        ] as const) {
            const loop = walkLeft(from, to, inPlane, uv);
            if (!loop) continue;
            const signature = loop.map(key).sort().join('|');
            if (seen.has(signature)) continue;
            seen.add(signature);
            loops.push(loop);
        }
    }
    return loops;
}

/**
 * The face on the left of the directed edge `from` → `to`: at every corner, the edge that turns
 * most sharply left. Null when the walk dead-ends, revisits a corner, or comes round clockwise
 * (the outside).
 */
function walkLeft(
    from: Point3Mm,
    to: Point3Mm,
    edges: readonly Segment[],
    uv: (p: Point3Mm) => { x: number; y: number }
): Point3Mm[] | null {
    const adjacency = new Map<string, Point3Mm[]>();
    const link = (p: Point3Mm, q: Point3Mm): void => {
        const list = adjacency.get(key(p)) ?? [];
        if (!list.some((r) => samePoint(r, q))) list.push(q);
        adjacency.set(key(p), list);
    };
    for (const [p, q] of edges) {
        link(p, q);
        link(q, p);
    }

    const ring: Point3Mm[] = [from];
    const visited = new Set<string>([key(from)]);
    let prev = from;
    let at = to;
    for (let guard = 0; guard < edges.length + 2; guard++) {
        if (samePoint(at, from)) break;
        if (visited.has(key(at))) return null;
        visited.add(key(at));
        ring.push(at);
        const here = uv(at);
        const back = uv(prev);
        const backAngle = Math.atan2(back.y - here.y, back.x - here.x);
        let best: { point: Point3Mm; turn: number } | null = null;
        for (const next of adjacency.get(key(at)) ?? []) {
            if (samePoint(next, prev)) continue;
            const w = uv(next);
            const angle = Math.atan2(w.y - here.y, w.x - here.x);
            // Clockwise from the way back: the smallest is the sharpest left turn.
            let turn = backAngle - angle;
            while (turn <= 0) turn += 2 * Math.PI;
            while (turn > 2 * Math.PI) turn -= 2 * Math.PI;
            if (!best || turn < best.turn) best = { point: next, turn };
        }
        if (!best) return null;
        prev = at;
        at = best.point;
    }
    if (!samePoint(at, from) || ring.length < 3) return null;
    // Counter-clockwise in the plane's own frame is a bounded face; clockwise is the outside.
    let area2 = 0;
    for (let i = 0; i < ring.length; i++) {
        const p = uv(ring[i]!);
        const q = uv(ring[(i + 1) % ring.length]!);
        area2 += p.x * q.y - q.x * p.y;
    }
    return area2 > 0 ? ring : null;
}

/** Every edge split wherever another edge's end lies on it, so a T is a corner. */
function nodeEdges(edges: readonly Segment[]): Segment[] {
    const ends = edges.flatMap(([p, q]) => [p, q]);
    const out: Segment[] = [];
    const seen = new Set<string>();
    for (const [p, q] of edges) {
        const cuts = ends
            .filter((r) => insideSegment(p, q, r))
            .sort((r, s) => distance3(p, r) - distance3(p, s));
        const stops = [p, ...cuts, q];
        for (let i = 0; i + 1 < stops.length; i++) {
            const s = stops[i]!;
            const t = stops[i + 1]!;
            if (samePoint(s, t)) continue;
            const ks = key(s);
            const kt = key(t);
            const k = ks < kt ? `${ks}|${kt}` : `${kt}|${ks}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push([s, t]);
        }
    }
    return out;
}
