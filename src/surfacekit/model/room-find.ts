/**
 * Finding the room a plan point is in, from the wall centrelines around it.
 *
 * The walls of a storey are a set of plan segments (`plan-geometry.ts`'s `WallFootprint`) that
 * were never told they enclose anything: an interior wall is a run from one wall to another, and
 * an exterior wall is one side of a floor pushed up. The rooms are the faces of the planar graph
 * those segments make, and this finds the one containing a point — so a zone can be made by
 * clicking inside a room instead of tracing it corner by corner.
 *
 * The graph is built the honest way rather than assumed: every segment is split wherever another
 * crosses it, or ends on it (the T where a partition meets a facade), so two walls meeting
 * mid-length share a vertex. Overlapping collinear segments — a wall on a floor's own edge, when
 * both are passed in — split into identical pieces and are merged. Walls that end in the middle
 * of a room (a stub partition) are pruned first: they bound nothing, and left in they would put
 * an out-and-back spike into the room's outline.
 *
 * Doors and windows do not break a footprint (they are holes in the wall, not gaps in its base
 * edge), so a room is closed by its walls whatever is cut into them — which is what a room is.
 */

import { pointInPolygon2, signedArea2, type Vec2Mm } from '../core';

export type PlanSegment = readonly [Vec2Mm, Vec2Mm];

/** Two points this close are one vertex, mm. The model is integer millimetres. */
const MERGE_MM = 1;

const keyOf = (p: Vec2Mm): string => `${Math.round(p.x)},${Math.round(p.y)}`;

/**
 * The smallest closed outline of wall segments around `pointMm`, counter-clockwise, or null
 * when the point is not enclosed — outside the building, or in a room with a gap in its walls.
 */
export function roomOutlineAt(segments: readonly PlanSegment[], pointMm: Vec2Mm): Vec2Mm[] | null {
    const edges = nodedEdges(segments);
    const adjacency = pruneDangling(edges);
    let best: { ring: Vec2Mm[]; area: number } | null = null;
    for (const ring of faces(adjacency)) {
        const area = signedArea2(ring);
        // Bounded faces come out counter-clockwise; the one clockwise face is the outside.
        if (area <= 0) continue;
        if (!pointInPolygon2(pointMm, ring)) continue;
        if (!best || area < best.area) best = { ring, area };
    }
    return best ? dropCollinear(best.ring) : null;
}

/** Every segment split at every vertex lying on it, deduplicated, as undirected edges. */
function nodedEdges(segments: readonly PlanSegment[]): [Vec2Mm, Vec2Mm][] {
    const clean = segments
        .map(([a, b]) => [round(a), round(b)] as const)
        .filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) >= MERGE_MM);

    const points: Vec2Mm[] = clean.flatMap(([a, b]) => [a, b]);
    for (let i = 0; i < clean.length; i++) {
        for (let j = i + 1; j < clean.length; j++) {
            const hit = crossing(clean[i]!, clean[j]!);
            if (hit) points.push(round(hit));
        }
    }

    const seen = new Set<string>();
    const out: [Vec2Mm, Vec2Mm][] = [];
    for (const [a, b] of clean) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const len = Math.sqrt(len2);
        const along = points
            .filter((p) => Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len <= MERGE_MM)
            .map((p) => ({ p, t: ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 }))
            .filter(({ t }) => t >= -1e-9 && t <= 1 + 1e-9)
            .sort((u, v) => u.t - v.t);
        for (let k = 0; k + 1 < along.length; k++) {
            const p = along[k]!.p;
            const q = along[k + 1]!.p;
            const kp = keyOf(p);
            const kq = keyOf(q);
            if (kp === kq) continue;
            const key = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push([p, q]);
        }
    }
    return out;
}

/** Where two segments cross or touch, strictly as a single point; null if parallel or apart. */
function crossing(s: PlanSegment, t: PlanSegment): Vec2Mm | null {
    const [a, b] = s;
    const [c, d] = t;
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-9) return null;
    const u = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
    const v = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
    const eps = 1e-9;
    if (u < -eps || u > 1 + eps || v < -eps || v > 1 + eps) return null;
    return { x: a.x + u * rx, y: a.y + u * ry };
}

/** Vertex key → its point and its neighbours, with every degree-one vertex peeled away. */
function pruneDangling(
    edges: readonly [Vec2Mm, Vec2Mm][]
): Map<string, { point: Vec2Mm; next: Set<string> }> {
    const adjacency = new Map<string, { point: Vec2Mm; next: Set<string> }>();
    const node = (p: Vec2Mm): { point: Vec2Mm; next: Set<string> } => {
        const k = keyOf(p);
        let n = adjacency.get(k);
        if (!n) {
            n = { point: p, next: new Set() };
            adjacency.set(k, n);
        }
        return n;
    };
    for (const [a, b] of edges) {
        node(a).next.add(keyOf(b));
        node(b).next.add(keyOf(a));
    }
    const queue = [...adjacency.keys()].filter((k) => adjacency.get(k)!.next.size <= 1);
    while (queue.length > 0) {
        const k = queue.pop()!;
        const n = adjacency.get(k);
        if (!n) continue;
        adjacency.delete(k);
        for (const other of n.next) {
            const o = adjacency.get(other);
            if (!o) continue;
            o.next.delete(k);
            if (o.next.size <= 1) queue.push(other);
        }
    }
    return adjacency;
}

/**
 * Every face of the planar graph, each as a ring with the face on its left — so bounded faces
 * are counter-clockwise and the unbounded one is clockwise.
 *
 * The standard half-edge walk: arriving at a vertex along u→v, leave along the edge that is next
 * *clockwise* from v→u, which is the tightest left-hand turn and keeps the walk hugging one face.
 */
function faces(adjacency: Map<string, { point: Vec2Mm; next: Set<string> }>): Vec2Mm[][] {
    const sorted = new Map<string, string[]>();
    for (const [k, n] of adjacency) {
        const angle = (to: string): number => {
            const p = adjacency.get(to)!.point;
            return Math.atan2(p.y - n.point.y, p.x - n.point.x);
        };
        sorted.set(
            k,
            [...n.next].sort((a, b) => angle(a) - angle(b))
        );
    }

    const used = new Set<string>();
    const out: Vec2Mm[][] = [];
    for (const [from, outs] of sorted) {
        for (const to of outs) {
            if (used.has(`${from}>${to}`)) continue;
            const ring: Vec2Mm[] = [];
            let u = from;
            let v = to;
            // A face never has more half-edges than the graph does; the bound only stops a bug
            // from hanging the tab.
            for (let guard = 0; guard <= adjacency.size * 4; guard++) {
                const he = `${u}>${v}`;
                if (used.has(he)) break;
                used.add(he);
                ring.push(adjacency.get(u)!.point);
                const around = sorted.get(v)!;
                const back = around.indexOf(u);
                const w = around[(back - 1 + around.length) % around.length]!;
                u = v;
                v = w;
            }
            if (ring.length >= 3) out.push(ring);
        }
    }
    return out;
}

/** Removes the vertices a straight wall picked up where another one teed into it from outside. */
function dropCollinear(ring: readonly Vec2Mm[]): Vec2Mm[] {
    const out: Vec2Mm[] = [];
    for (let i = 0; i < ring.length; i++) {
        const prev = ring[(i - 1 + ring.length) % ring.length]!;
        const p = ring[i]!;
        const next = ring[(i + 1) % ring.length]!;
        const cross = (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x);
        const len = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
        if (Math.abs(cross) / len > 0.5) out.push(p);
    }
    return out;
}

function round(p: Vec2Mm): Vec2Mm {
    return { x: Math.round(p.x), y: Math.round(p.y) };
}
