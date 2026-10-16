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

import { signedArea2, type Vec2Mm } from '../core';
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
