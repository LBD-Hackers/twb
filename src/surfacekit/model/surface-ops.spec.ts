import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import {
    extrudeRing,
    insertOnRing,
    insideSegment,
    locateOnRing,
    moveRingVertices,
    segmentOnRing,
    segmentOnSegment,
    splitRing,
    splitRingAlong,
} from './surface-ops';

const TOP: Point3Mm[] = [
    { x: 0, y: 0, z: 2400 },
    { x: 7200, y: 0, z: 2400 },
    { x: 7200, y: 9600, z: 2400 },
    { x: 0, y: 9600, z: 2400 },
];

describe('locateOnRing / insertOnRing', () => {
    it('finds a vertex, an edge interior, and nothing off the ring', () => {
        expect(locateOnRing(TOP, { x: 7200, y: 0, z: 2400 })).toEqual({ kind: 'vertex', index: 1 });
        expect(locateOnRing(TOP, { x: 3600, y: 0, z: 2400 })).toEqual({ kind: 'edge', index: 0 });
        expect(locateOnRing(TOP, { x: 3600, y: 4800, z: 2400 })).toBeNull();
        expect(locateOnRing(TOP, { x: 3600, y: 0, z: 0 })).toBeNull();
    });

    it('splices a point into the edge it sits on, and leaves an existing vertex alone', () => {
        const inserted = insertOnRing(TOP, { x: 3600, y: 0, z: 2400 })!;
        expect(inserted.ring).toHaveLength(5);
        expect(inserted.index).toBe(1);
        expect(inserted.ring[1]).toEqual({ x: 3600, y: 0, z: 2400 });
        const same = insertOnRing(TOP, TOP[2]!)!;
        expect(same.ring).toBe(TOP);
        expect(same.index).toBe(2);
    });
});

describe('splitRing', () => {
    it('cuts a rectangle along a chord between opposite edge midpoints into two rectangles', () => {
        const halves = splitRing(TOP, { x: 3600, y: 0, z: 2400 }, { x: 3600, y: 9600, z: 2400 })!;
        expect(halves).not.toBeNull();
        expect(halves[0]).toHaveLength(4);
        expect(halves[1]).toHaveLength(4);
        const xs = (ring: readonly Point3Mm[]) => ring.map((p) => p.x).sort((a, b) => a - b);
        // One half is the east half, the other the west; both contain the chord's x.
        expect(xs(halves[0])).toEqual([3600, 3600, 7200, 7200]);
        expect(xs(halves[1])).toEqual([0, 0, 3600, 3600]);
    });

    it('cuts along a diagonal between two vertices into two triangles', () => {
        const halves = splitRing(TOP, TOP[0]!, TOP[2]!)!;
        expect(halves[0]).toHaveLength(3);
        expect(halves[1]).toHaveLength(3);
    });

    it('refuses a chord that is one of the ring’s own edges', () => {
        expect(splitRing(TOP, TOP[0]!, TOP[1]!)).toBeNull();
    });

    it('refuses a chord with an end off the ring, or both ends on one point', () => {
        expect(splitRing(TOP, { x: 3600, y: 4800, z: 2400 }, TOP[0]!)).toBeNull();
        expect(splitRing(TOP, TOP[1]!, TOP[1]!)).toBeNull();
    });
});

describe('splitRingAlong', () => {
    it('cuts along an edge-to-edge path through the interior, keeping the corners in between', () => {
        // An L-shaped cut: in from the south edge, across, and out through the east edge.
        const path: Point3Mm[] = [
            { x: 2400, y: 0, z: 2400 },
            { x: 2400, y: 4800, z: 2400 },
            { x: 7200, y: 4800, z: 2400 },
        ];
        const halves = splitRingAlong(TOP, path)!;
        expect(halves).not.toBeNull();
        // South-east half: the two path ends, the interior corner, and the SE corner of TOP.
        expect(halves[0]).toHaveLength(4);
        expect(halves[0]).toContainEqual({ x: 2400, y: 4800, z: 2400 });
        expect(halves[0]).toContainEqual({ x: 7200, y: 0, z: 2400 });
        // The rest: the L around the other three corners.
        expect(halves[1]).toHaveLength(6);
        expect(halves[1]).toContainEqual({ x: 2400, y: 4800, z: 2400 });
        expect(halves[1]).toContainEqual({ x: 0, y: 9600, z: 2400 });
    });

    it('is the plain chord for a two-point path', () => {
        const a = { x: 3600, y: 0, z: 2400 };
        const b = { x: 3600, y: 9600, z: 2400 };
        expect(splitRingAlong(TOP, [a, b])).toEqual(splitRing(TOP, a, b));
    });
});

describe('segmentOnRing / segmentOnSegment / insideSegment', () => {
    it('tells an edge, or part of one, from a chord across the face', () => {
        expect(segmentOnRing(TOP, TOP[0]!, TOP[1]!)).toBe(true);
        expect(segmentOnRing(TOP, { x: 1200, y: 0, z: 2400 }, { x: 4800, y: 0, z: 2400 })).toBe(
            true
        );
        expect(segmentOnRing(TOP, TOP[0]!, TOP[2]!)).toBe(false);
        expect(segmentOnRing(TOP, { x: 3600, y: 0, z: 2400 }, { x: 3600, y: 9600, z: 2400 })).toBe(
            false
        );
    });

    it('tells a sub-segment from an overlapping or crossing one', () => {
        const p = { x: 0, y: 0, z: 0 };
        const q = { x: 4800, y: 0, z: 0 };
        expect(segmentOnSegment(p, q, { x: 1200, y: 0, z: 0 }, { x: 2400, y: 0, z: 0 })).toBe(true);
        expect(segmentOnSegment(p, q, { x: 1200, y: 0, z: 0 }, { x: 6000, y: 0, z: 0 })).toBe(
            false
        );
        expect(insideSegment(p, q, { x: 1200, y: 0, z: 0 })).toBe(true);
        expect(insideSegment(p, q, p)).toBe(false);
        expect(insideSegment(p, q, { x: 1200, y: 600, z: 0 })).toBe(false);
    });
});

describe('extrudeRing', () => {
    it('moves the ring along the normal and joins it to the original with one quad per edge', () => {
        const { top, sides } = extrudeRing(TOP, { x: 0, y: 0, z: 1 }, 600);
        expect(top.every((p) => p.z === 3000)).toBe(true);
        expect(sides).toHaveLength(4);
        expect(sides[0]).toEqual([
            { x: 0, y: 0, z: 2400 },
            { x: 7200, y: 0, z: 2400 },
            { x: 7200, y: 0, z: 3000 },
            { x: 0, y: 0, z: 3000 },
        ]);
    });

    it('rounds to integer millimetres along a tilted normal', () => {
        const n = { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 };
        const { top } = extrudeRing(TOP, n, 1000);
        for (const p of top) {
            expect(Number.isInteger(p.y)).toBe(true);
            expect(Number.isInteger(p.z)).toBe(true);
        }
        expect(top[0]).toEqual({ x: 0, y: 707, z: 3107 });
    });
});

describe('moveRingVertices', () => {
    it('moves only the vertices at the given positions and reports whether any moved', () => {
        const { ring, moved } = moveRingVertices(TOP, [TOP[0]!, TOP[1]!], { x: 0, y: 0, z: 500 });
        expect(moved).toBe(true);
        expect(ring[0]!.z).toBe(2900);
        expect(ring[1]!.z).toBe(2900);
        expect(ring[2]!.z).toBe(2400);
    });

    it('returns the same ring object when nothing is at those positions', () => {
        const { ring, moved } = moveRingVertices(TOP, [{ x: 1, y: 1, z: 1 }], { x: 0, y: 0, z: 1 });
        expect(moved).toBe(false);
        expect(ring).toBe(TOP);
    });
});
