/**
 * How high the roof sits above a plan position — what an interior wall on the top storey has to
 * stop under, instead of a nominal ceiling height.
 *
 * Pure and geometry-only, like `classify.ts` it leans on: no notion of storeys here, just "is
 * there a roof plane over this point, and how high is it". `interaction/interior-wall-tool.ts`
 * is the caller, and it is also what makes a wall under a valley — two roof planes over the same
 * run — stop at the lower of the two, which is where the enclosure genuinely is.
 */

import { planeHeightAt, planeOfPolygon, pointInOrOnPolygonPlan } from '../core';
import { classifyAll } from './classify';
import type { Surface } from './surface';

/**
 * The lowest roof plane over `(x, y)` that sits above `aboveZ` (the wall's own floor), or null
 * when no roof covers the point yet — the caller's cue to fall back to a nominal ceiling.
 *
 * Only a single roof plane's height is returned even where two overlap (a hip or a valley): the
 * plane the wall actually meets is whichever is lower there. `roofTopProfile` below is what turns
 * a run crossing two or more of those planes into a shaped, multi-segment top edge rather than a
 * single sloped one, by sampling this function along the run instead of only at its ends.
 */
export function roofHeightAbove(
    surfaces: readonly Surface[],
    x: number,
    y: number,
    aboveZ: number
): number | null {
    const kinds = classifyAll(surfaces);
    let lowest: number | null = null;
    for (const s of surfaces) {
        if (kinds.get(s.id) !== 'roof') continue;
        if (!pointInOrOnPolygonPlan({ x, y }, s.boundaryMm)) continue;
        const plane = planeOfPolygon(s.boundaryMm);
        if (!plane) continue;
        const z = planeHeightAt(plane, x, y);
        if (z === null || z <= aboveZ) continue;
        if (lowest === null || z < lowest) lowest = z;
    }
    return lowest;
}

/** A point along a wall's top edge, with the roof (or nominal ceiling) height already resolved. */
export interface RoofProfilePoint {
    x: number;
    y: number;
    z: number;
}

/**
 * Default vertical error, in mm, `roofTopProfile` will tolerate between two samples before it
 * splits them further.
 *
 * Loose on purpose relative to the mm precision the rest of the model works in: a real ridge or
 * hip changes a wall's required height by centimetres to metres over any span worth drawing, so
 * anything this small is noise, not shape — typically a wall running close to parallel with a
 * hip or ridge line, where floating-point slack in the roof polygons' own edges makes "which
 * plane is lower here" flicker by a millimetre or two over a few points along the run. Chasing
 * that with more breakpoints doesn't make the wall more accurate, only busier.
 */
const DEFAULT_PROFILE_TOLERANCE_MM = 20;

/** Bisection depth limit, so a boundary point flickering at the tolerance can't recurse forever. */
const DEFAULT_PROFILE_MAX_DEPTH = 8;

/**
 * Shortest piece worth its own breakpoint, mm. A second backstop against the same flicker
 * `toleranceMm` guards against — independent of it, since a run long enough to need many real
 * breakpoints could hit `maxDepth` legitimately, where this still caps how fine any single
 * cluster of them can get.
 */
const DEFAULT_PROFILE_MIN_SPAN_MM = 150;

/**
 * The top edge of a wall run from `a` to `b`, as however many points it takes to follow the roof
 * above it to within `toleranceMm` — one flat quad's worth (the two endpoints) under a single
 * roof plane or no roof at all, more wherever the run passes under a ridge, hip, or valley into a
 * different plane. Falls back to `nominalTopMm` at any point with no roof over it.
 *
 * Adaptive bisection rather than a fixed sampling grid: a roof plane's height is exactly linear
 * along any straight line across it, so two points already describe a single-plane span
 * perfectly and cost nothing extra to confirm; only a span that actually crosses planes pays for
 * more samples, split until each interval's straight-line interpolation matches the roof's own
 * height at the interval's midpoint, or until further splitting would only be chasing sub-`minSpanMm` noise.
 */
export function roofTopProfile(
    surfaces: readonly Surface[],
    a: { x: number; y: number },
    b: { x: number; y: number },
    aboveZ: number,
    nominalTopMm: number,
    options: { toleranceMm?: number; maxDepth?: number; minSpanMm?: number } = {}
): RoofProfilePoint[] {
    const toleranceMm = options.toleranceMm ?? DEFAULT_PROFILE_TOLERANCE_MM;
    const maxDepth = options.maxDepth ?? DEFAULT_PROFILE_MAX_DEPTH;
    const minSpanMm = options.minSpanMm ?? DEFAULT_PROFILE_MIN_SPAN_MM;
    const lengthMm = Math.hypot(b.x - a.x, b.y - a.y);
    const lerp = (t: number): { x: number; y: number } => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    });
    const heightAt = (p: { x: number; y: number }): number =>
        roofHeightAbove(surfaces, p.x, p.y, aboveZ) ?? nominalTopMm;

    const samples = new Map<number, number>([
        [0, heightAt(a)],
        [1, heightAt(b)],
    ]);

    const subdivide = (t0: number, t1: number, depth: number): void => {
        if (depth >= maxDepth) return;
        if ((t1 - t0) * lengthMm <= minSpanMm) return;
        const z0 = samples.get(t0)!;
        const z1 = samples.get(t1)!;
        const tMid = (t0 + t1) / 2;
        const zMid = heightAt(lerp(tMid));
        if (Math.abs(zMid - (z0 + z1) / 2) <= toleranceMm) return;
        samples.set(tMid, zMid);
        subdivide(t0, tMid, depth + 1);
        subdivide(tMid, t1, depth + 1);
    };
    subdivide(0, 1, 0);

    return [...samples.entries()]
        .sort(([t1], [t2]) => t1 - t2)
        .map(([t, z]) => ({ ...lerp(t), z }));
}
