/**
 * Selecting by dragging a box — AutoCAD's two boxes, told apart by which way the drag goes.
 *
 * Left to right is a **window**: only what lies wholly inside the box is taken. Right to left is
 * a **crossing**: anything the box touches is taken, inside or cut by its sides. The direction is
 * the whole of the interface, so the box is drawn differently for each (by the modeller) and the user
 * can see which one they are dragging before letting go.
 *
 * In screen space, like every other pick here (`pick.ts`): a box is drawn on the screen, and
 * "inside" means inside it as seen. Hidden faces count, as they do in AutoCAD and SketchUp — a box
 * round a house takes the back walls too, which is what a box round a house is for. Pure: the
 * caller supplies the projection.
 */

import type { Point3Mm } from '../core';
import type { Guide, GuideId, Surface, SurfaceId } from '../model';
import type { PixelPos } from './pick';

export type BoxMode = 'window' | 'crossing';

/** Left to right is a window, right to left a crossing. */
export function boxModeOf(from: PixelPos, to: PixelPos): BoxMode {
    return to.x >= from.x ? 'window' : 'crossing';
}

export interface BoxSelection {
    surfaceIds: SurfaceId[];
    guideIds: GuideId[];
}

/** What a box from `from` to `to` selects. */
export function selectInBox(
    surfaces: readonly Surface[],
    guides: readonly Guide[],
    from: PixelPos,
    to: PixelPos,
    project: (pointMm: Point3Mm) => PixelPos | null
): BoxSelection {
    const mode = boxModeOf(from, to);
    const box: Rect = {
        x0: Math.min(from.x, to.x),
        y0: Math.min(from.y, to.y),
        x1: Math.max(from.x, to.x),
        y1: Math.max(from.y, to.y),
    };
    const surfaceIds = surfaces
        .filter((s) => takes(s.boundaryMm.map(project), true, box, mode))
        .map((s) => s.id);
    const guideIds = guides
        .filter((g) => takes([project(g.aMm), project(g.bMm)], false, box, mode))
        .map((g) => g.id);
    return { surfaceIds, guideIds };
}

interface Rect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

function takes(
    points: readonly (PixelPos | null)[],
    closed: boolean,
    box: Rect,
    mode: BoxMode
): boolean {
    if (mode === 'window') return points.every((p) => p !== null && inside(p, box));
    const seen = points.filter((p): p is PixelPos => p !== null);
    if (seen.some((p) => inside(p, box))) return true;
    const n = seen.length;
    const edges = closed ? n : n - 1;
    for (let i = 0; i < edges; i++) {
        if (segmentCrossesBox(seen[i]!, seen[(i + 1) % n]!, box)) return true;
    }
    // A face bigger than the box, round it on every side, is touched by it all the same.
    return closed && n >= 3 && pointInPolygon({ x: box.x0, y: box.y0 }, seen);
}

const inside = (p: PixelPos, r: Rect): boolean =>
    p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

function segmentCrossesBox(a: PixelPos, b: PixelPos, r: Rect): boolean {
    const corners = [
        { x: r.x0, y: r.y0 },
        { x: r.x1, y: r.y0 },
        { x: r.x1, y: r.y1 },
        { x: r.x0, y: r.y1 },
    ];
    for (let i = 0; i < 4; i++) {
        if (segmentsCross(a, b, corners[i]!, corners[(i + 1) % 4]!)) return true;
    }
    return false;
}

function segmentsCross(a: PixelPos, b: PixelPos, c: PixelPos, d: PixelPos): boolean {
    const cross = (o: PixelPos, p: PixelPos, q: PixelPos): number =>
        (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return d1 * d2 < 0 && d3 * d4 < 0;
}

function pointInPolygon(p: PixelPos, ring: readonly PixelPos[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}
