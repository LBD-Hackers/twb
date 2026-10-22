/**
 * The building's outline in plan, traced from its wall lines.
 *
 * A roof is generated over an outline (`roof-generate.ts`), and there are two places an outline
 * comes from: the wall lines of a house file written in the simple shape (`walls`, a list of plan
 * centrelines), and the walls already standing in the model when roof mode generates a roof over
 * them. Neither is a ring as it stands — the lines come in any order and direction, partitions
 * meet the envelope in T-junctions, a run may be split in two — so this walks the plan graph
 * they make around its outside, the way a hand follows a wall from the outside: at every corner,
 * turn as far right as the lines allow. Whatever stands inside the loop — partitions, a wall
 * split at a door — is never reached, and a line sticking out of it (a garden wall) is walked out
 * and back and then cut off again.
 *
 * Pure: plan points in, a ring out.
 */

import { pointInPolygon2, signedArea2, triangulatePolygon2, type Vec2Mm } from '../core';
import type { PlanSegment } from './room-find';

/** Two ends this close are one corner, mm. */
const JOIN_MM = 1;

interface Graph {
    points: Vec2Mm[];
    /** Neighbour indices per point. */
    next: Set<number>[];
}

/** One corner per cluster of ends within `JOIN_MM`, and the index each end maps to. */
function pool(points: Vec2Mm[], p: Vec2Mm): number {
    const found = points.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= JOIN_MM);
    if (found >= 0) return found;
    points.push({ x: p.x, y: p.y });
    return points.length - 1;
}

/** Where two segments cross, strictly inside both, or null. */
function crossing(a: Vec2Mm, b: Vec2Mm, c: Vec2Mm, d: Vec2Mm): Vec2Mm | null {
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
    const lenR = Math.hypot(rx, ry);
    const lenS = Math.hypot(sx, sy);
    const inside = (v: number, len: number) => v * len > JOIN_MM && (1 - v) * len > JOIN_MM;
    return inside(t, lenR) && inside(u, lenS) ? { x: a.x + t * rx, y: a.y + t * ry } : null;
}

/** Distance from `p` to segment a→b, and how far along it `p` projects (0..1). */
function along(p: Vec2Mm, a: Vec2Mm, b: Vec2Mm): { off: number; t: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    return { off: Math.hypot(p.x - cx, p.y - cy), t };
}

/** The segments as a graph: split wherever an end lands on another line or two lines cross. */
function planGraph(segments: readonly PlanSegment[]): Graph {
    const cuts: Vec2Mm[] = [];
    for (const [a, b] of segments) cuts.push(a, b);
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            const x = crossing(segments[i]![0], segments[i]![1], segments[j]![0], segments[j]![1]);
            if (x) cuts.push(x);
        }
    }
    const points: Vec2Mm[] = [];
    const next: Set<number>[] = [];
    const link = (i: number, j: number) => {
        if (i === j) return;
        while (next.length < points.length) next.push(new Set());
        next[i]!.add(j);
        next[j]!.add(i);
    };
    for (const [a, b] of segments) {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len <= JOIN_MM) continue;
        const stops = cuts
            .map((p) => ({ p, ...along(p, a, b) }))
            .filter(
                ({ off, t }) => off <= JOIN_MM && t * len >= -JOIN_MM && t * len <= len + JOIN_MM
            )
            .sort((m, n) => m.t - n.t)
            .map(({ p }) => pool(points, p));
        for (let k = 0; k + 1 < stops.length; k++) link(stops[k]!, stops[k + 1]!);
    }
    while (next.length < points.length) next.push(new Set());
    return { points, next };
}

/** Signed turn from heading `d` to heading `e`, radians, left positive; a U-turn is +π. */
function turn(d: Vec2Mm, e: Vec2Mm): number {
    const angle = Math.atan2(d.x * e.y - d.y * e.x, d.x * e.x + d.y * e.y);
    return angle <= -Math.PI + 1e-9 ? Math.PI : angle;
}

/** Drops corners the ring walks out to and straight back from, and corners on a straight run. */
function tidy(ring: Vec2Mm[], keepStraight: boolean): Vec2Mm[] {
    let out = ring.slice();
    for (let changed = true; changed && out.length >= 3;) {
        changed = false;
        for (let i = 0; i < out.length && out.length >= 3; i++) {
            const prev = out[(i - 1 + out.length) % out.length]!;
            const cur = out[i]!;
            const nxt = out[(i + 1) % out.length]!;
            const same = Math.hypot(prev.x - nxt.x, prev.y - nxt.y) <= JOIN_MM;
            if (same) {
                // A spike: out along a line and back. Both the tip and the repeated base go.
                out = out.filter((_, k) => k !== i && k !== (i + 1) % out.length);
                changed = true;
                break;
            }
            const cross = (cur.x - prev.x) * (nxt.y - cur.y) - (cur.y - prev.y) * (nxt.x - cur.x);
            const len = Math.hypot(nxt.x - prev.x, nxt.y - prev.y);
            if (!keepStraight && Math.abs(cross) / Math.max(len, 1) <= 0.5) {
                out.splice(i, 1);
                changed = true;
                break;
            }
        }
    }
    return out;
}

/**
 * The outside of the plan the segments draw, counter-clockwise, or null when they do not close
 * around anything. With `keepStraight` every corner the walk passed through stays, a wall's end
 * on a straight run included — what a floor face wants, so it shares a corner with each wall.
 */
export function outerOutline(
    segments: readonly PlanSegment[],
    keepStraight = false
): Vec2Mm[] | null {
    const { points, next } = planGraph(segments);
    if (points.length < 3) return null;
    // The leftmost corner, lowest of those, is on the outside. Arriving there heading south,
    // the first line to the right of that is the outline's first side.
    let start = 0;
    points.forEach((p, i) => {
        const s = points[start]!;
        if (p.x < s.x - 1e-9 || (Math.abs(p.x - s.x) <= 1e-9 && p.y < s.y)) start = i;
    });
    const ring: number[] = [];
    let at = start;
    let heading: Vec2Mm = { x: 0, y: -1 };
    let first: number | null = null;
    const limit = points.length * 4 + 8;
    for (let steps = 0; steps < limit; steps++) {
        const options = [...next[at]!];
        if (options.length === 0) return null;
        let best = -1;
        let bestTurn = Infinity;
        for (const j of options) {
            const p = points[j]!;
            const q = points[at]!;
            const len = Math.hypot(p.x - q.x, p.y - q.y);
            const e = { x: (p.x - q.x) / len, y: (p.y - q.y) / len };
            const t = turn(heading, e);
            if (t < bestTurn) {
                bestTurn = t;
                best = j;
            }
        }
        if (at === start && first !== null && best === first) break;
        if (first === null) first = best;
        ring.push(at);
        const p = points[best]!;
        const q = points[at]!;
        const len = Math.hypot(p.x - q.x, p.y - q.y);
        heading = { x: (p.x - q.x) / len, y: (p.y - q.y) / len };
        at = best;
    }
    const out = tidy(
        ring.map((i) => points[i]!),
        keepStraight
    );
    if (out.length < 3 || signedArea2(out) <= 0) return null;
    return out;
}

/** A region of the plan: its outline counter-clockwise, and any rings cut out of it. */
export interface PlanRegion {
    ring: Vec2Mm[];
    holes: Vec2Mm[][];
}

/**
 * What of `outer` lies outside `cut`, both outlines in plan: the part of a storey's roof that
 * the storey over it does not stand on. Each region is counter-clockwise, its corners where the
 * two outlines' lines meet. A `cut` strictly inside `outer` comes back as a hole in it; an
 * `outer` inside `cut`, as nothing.
 */
export function outlineDifference(outer: readonly Vec2Mm[], cut: readonly Vec2Mm[]): PlanRegion[] {
    const a = signedArea2(outer) < 0 ? [...outer].reverse() : [...outer];
    const b = signedArea2(cut) < 0 ? [...cut].reverse() : [...cut];
    const edgesOf = (ring: readonly Vec2Mm[]): PlanSegment[] =>
        ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as const);
    const touches =
        a.some((p) => nearRing(p, b)) ||
        b.some((p) => nearRing(p, a)) ||
        edgesOf(a).some(([p, q]) => edgesOf(b).some(([r, s]) => crossing(p, q, r, s) !== null));
    if (!touches) {
        if (b.every((p) => pointInPolygon2(p, a))) return [{ ring: a, holes: [b] }];
        if (a.every((p) => pointInPolygon2(p, b))) return [];
        return [{ ring: a, holes: [] }];
    }
    return planFaces([...edgesOf(a), ...edgesOf(b)])
        .filter((face) => {
            const p = innerPoint(face);
            return pointInPolygon2(p, a) && !pointInPolygon2(p, b);
        })
        .map((ring) => ({ ring: tidy(ring, false), holes: [] }))
        .filter((r) => r.ring.length >= 3);
}

/**
 * What the outlines cover together, in plan: the plate a storey's floor slabs make, however they
 * overlap or touch. Each region is counter-clockwise, and a ring the outlines close round without
 * covering (a courtyard, a stair's void between two slabs) is a hole in it, counter-clockwise
 * too. Outlines that touch only at a corner are regions of their own.
 */
export function outlineUnion(rings: readonly (readonly Vec2Mm[])[]): PlanRegion[] {
    const ccw = rings
        .filter((r) => r.length >= 3 && Math.abs(signedArea2(r)) > 0)
        .map((r) => (signedArea2(r) < 0 ? [...r].reverse() : [...r]));
    if (ccw.length === 0) return [];
    const edgesOf = (ring: readonly Vec2Mm[]): PlanSegment[] =>
        ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as const);
    const inAny = (p: Vec2Mm) => ccw.some((r) => pointInPolygon2(p, r));
    // A face is covered where a point just inside its longest edge is: a point in the middle of
    // it could land on an outline standing apart inside it, which the face does not reach.
    const covered = planFaces(ccw.flatMap(edgesOf)).filter((face) => inAny(besideRing(face, 1)));
    // The edges of covered faces with no covered face on their other side: the regions' edges,
    // each with its region on its left.
    const key = (p: Vec2Mm, q: Vec2Mm) => `${p.x},${p.y}>${q.x},${q.y}`;
    const inner = new Set(covered.flatMap((f) => edgesOf(f).map(([p, q]) => key(p, q))));
    const bounding = covered.flatMap(edgesOf).filter(([p, q]) => !inner.has(key(q, p)));
    const from = new Map<string, PlanSegment[]>();
    for (const e of bounding) {
        const k = `${e[0].x},${e[0].y}`;
        from.set(k, [...(from.get(k) ?? []), e]);
    }
    const used = new Set<PlanSegment>();
    const loops: Vec2Mm[][] = [];
    for (const start of bounding) {
        if (used.has(start)) continue;
        const loop: Vec2Mm[] = [];
        let e: PlanSegment | undefined = start;
        for (let steps = 0; e && !used.has(e) && steps <= bounding.length; steps++) {
            used.add(e);
            loop.push(e[0]);
            const p: Vec2Mm = e[0];
            const q: Vec2Mm = e[1];
            const d: Vec2Mm = { x: q.x - p.x, y: q.y - p.y };
            // Where two regions touch at a corner, each keeps its own: turn as far left as it goes.
            const next: PlanSegment[] = (from.get(`${q.x},${q.y}`) ?? []).filter((n) => !used.has(n));
            e = next
                .map((n) => ({ n, t: turn(d, { x: n[1].x - n[0].x, y: n[1].y - n[0].y }) }))
                .sort((x, y) => y.t - x.t)[0]?.n;
        }
        const ring = tidy(loop, false);
        // An outline inside another that its faces never reached: covered beyond its edge too.
        if (ring.length >= 3 && !inAny(besideRing(ring, -1))) loops.push(ring);
    }
    const outers = loops.filter((r) => signedArea2(r) > 0);
    const holes = loops.filter((r) => signedArea2(r) < 0).map((r) => [...r].reverse());
    // Each hole in the smallest region round it, larger than it (a region standing in a hole
    // is not round it).
    const round = (ring: readonly Vec2Mm[], h: readonly Vec2Mm[]) =>
        signedArea2(ring) > signedArea2(h) && pointInPolygon2(innerPoint(h), ring);
    const bySize = outers.sort((a, b) => signedArea2(a) - signedArea2(b));
    return bySize
        .map((ring, i) => ({
            ring,
            holes: holes.filter(
                (h) => round(ring, h) && !bySize.slice(0, i).some((smaller) => round(smaller, h))
            ),
        }))
        .sort((a, b) => signedArea2(b.ring) - signedArea2(a.ring));
}

/** A point just to the left (`side` 1) or right (-1) of the middle of a ring's longest edge. */
function besideRing(ring: readonly Vec2Mm[], side: 1 | -1): Vec2Mm {
    let [p, q] = [ring[0]!, ring[1 % ring.length]!];
    ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) > Math.hypot(q.x - p.x, q.y - p.y)) [p, q] = [a, b];
    });
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const off = (2 * JOIN_MM * side) / len;
    return { x: (p.x + q.x) / 2 - (q.y - p.y) * off, y: (p.y + q.y) / 2 + (q.x - p.x) * off };
}

/** Whether `p` is on one of the ring's edges, within `JOIN_MM`. */
function nearRing(p: Vec2Mm, ring: readonly Vec2Mm[]): boolean {
    return ring.some((q, i) => {
        const { off, t } = along(p, q, ring[(i + 1) % ring.length]!);
        return off <= JOIN_MM && t >= 0 && t <= 1;
    });
}

/**
 * The bounded faces of the plan graph the segments make, each counter-clockwise: walked with
 * the face on the left, turning as far left as the lines allow at every corner.
 */
function planFaces(segments: readonly PlanSegment[]): Vec2Mm[][] {
    const { points, next } = planGraph(segments);
    const used = new Set<string>();
    const faces: Vec2Mm[][] = [];
    const heading = (i: number, j: number): Vec2Mm => {
        const p = points[i]!;
        const q = points[j]!;
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        return { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    };
    points.forEach((_, start) => {
        for (const first of next[start]!) {
            if (used.has(`${start}>${first}`)) continue;
            const ring: number[] = [];
            let [from, to] = [start, first];
            for (let steps = 0; steps < points.length * 4 + 8; steps++) {
                used.add(`${from}>${to}`);
                ring.push(from);
                const d = heading(from, to);
                let best = -1;
                let bestTurn = -Infinity;
                for (const j of next[to]!) {
                    const t = j === from ? -Math.PI : turn(d, heading(to, j));
                    if (t > bestTurn) {
                        bestTurn = t;
                        best = j;
                    }
                }
                [from, to] = [to, best];
                if (from === start && to === first) break;
            }
            const face = ring.map((i) => points[i]!);
            if (face.length >= 3 && signedArea2(face) > 0) faces.push(face);
        }
    });
    return faces;
}

/** A point well inside a ring, concave or not: the middle of its largest triangle. */
function innerPoint(ring: readonly Vec2Mm[]): Vec2Mm {
    const triangles = triangulatePolygon2(ring);
    const area = ([p, q, r]: [Vec2Mm, Vec2Mm, Vec2Mm]) =>
        Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    const largest = triangles.reduce<[Vec2Mm, Vec2Mm, Vec2Mm] | null>(
        (m, t) => (!m || area(t) > area(m) ? t : m),
        null
    );
    if (!largest) return ring[0]!;
    return {
        x: (largest[0].x + largest[1].x + largest[2].x) / 3,
        y: (largest[0].y + largest[1].y + largest[2].y) / 3,
    };
}

/**
 * The outlines of the segments that stand apart from those `outline` is traced along, inside it:
 * each a ring of walls standing on its own in the house — a courtyard. Counter-clockwise.
 */
export function innerOutlines(
    segments: readonly PlanSegment[],
    outline: readonly Vec2Mm[]
): Vec2Mm[][] {
    const onOutline = (s: PlanSegment) => s.every((p) => nearRing(p, outline));
    return segmentGroups(segments)
        .filter((group) => !group.some(onOutline))
        .map((segs) => outerOutline(segs, true))
        .filter(
            (ring): ring is Vec2Mm[] =>
                !!ring &&
                ring.every((p) => pointInPolygon2(p, outline) && !nearRing(p, outline))
        );
}

/** The segments in groups that meet — an end on another, or crossing — in the order given. */
export function segmentGroups(segments: readonly PlanSegment[]): PlanSegment[][] {
    const group = segments.map((_, i) => i);
    const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i]!)));
    const meets = ([a, b]: PlanSegment, [c, d]: PlanSegment) =>
        crossing(a, b, c, d) !== null ||
        [a, b].some((p) => along(p, c, d).off <= JOIN_MM && between(p, c, d)) ||
        [c, d].some((p) => along(p, a, b).off <= JOIN_MM && between(p, a, b));
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            if (meets(segments[i]!, segments[j]!)) group[find(i)] = find(j);
        }
    }
    const groups = new Map<number, PlanSegment[]>();
    segments.forEach((s, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), s]));
    return [...groups.values()];
}

/**
 * One block of a storey's plan: the outline a group of its walls traces on its own, the ring a
 * floor on it takes (every corner the walk passed through, as `outerOutline`'s `keepStraight`),
 * and its courtyards — the outlines of the groups standing inside it.
 */
export interface PlanBlock {
    outline: Vec2Mm[];
    floorRing: Vec2Mm[];
    courts: Vec2Mm[][];
}

/**
 * The blocks a storey's wall lines make: each group of lines that meet (`segmentGroups`), traced
 * round its outside, is a block unless it stands inside another block's outline, where it is a
 * courtyard of that block. Largest first; groups that close round nothing are left out.
 */
export function planBlocks(segments: readonly PlanSegment[]): PlanBlock[] {
    const traced = segmentGroups(segments)
        .map((segs) => ({ segs, outline: outerOutline(segs) }))
        .filter((g): g is { segs: PlanSegment[]; outline: Vec2Mm[] } => g.outline !== null)
        .sort((a, b) => signedArea2(b.outline) - signedArea2(a.outline));
    const inside = (ring: readonly Vec2Mm[], of: readonly Vec2Mm[]) =>
        ring.every((p) => pointInPolygon2(p, of) && !nearRing(p, of));
    const blocks = traced.filter(
        (g) => !traced.some((h) => h !== g && inside(g.outline, h.outline))
    );
    return blocks.map((b) => ({
        outline: b.outline,
        floorRing: outerOutline(b.segs, true) ?? b.outline,
        courts: traced
            .filter((g) => !blocks.includes(g) && inside(g.outline, b.outline))
            .map((g) => outerOutline(g.segs, true) ?? g.outline),
    }));
}

/** Whether `p` projects onto segment a→b, within `JOIN_MM` of its ends. */
function between(p: Vec2Mm, a: Vec2Mm, b: Vec2Mm): boolean {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = along(p, a, b).t * len;
    return t >= -JOIN_MM && t <= len + JOIN_MM;
}

