import { describe, expect, it } from 'vitest';
import { signedArea2, type Vec2Mm } from '../core';
import { outerOutline, outlineUnion } from './plan-outline';
import type { PlanSegment } from './room-find';

const v = (x: number, y: number): Vec2Mm => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number): PlanSegment => [v(ax, ay), v(bx, by)];

/** The ring as a set of corners, so the test does not depend on where it starts. */
const corners = (ring: readonly Vec2Mm[] | null) =>
    new Set((ring ?? []).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));

describe('outerOutline', () => {
    it('traces walls given in any order and direction, counter-clockwise', () => {
        const ring = outerOutline([
            seg(9600, 7200, 9600, 0),
            seg(0, 0, 9600, 0),
            seg(0, 7200, 0, 0),
            seg(9600, 7200, 0, 7200),
        ]);
        expect(corners(ring)).toEqual(new Set(['0,0', '9600,0', '9600,7200', '0,7200']));
        expect(signedArea2(ring!)).toBeGreaterThan(0);
    });

    it('walks round the outside of an L, past partitions meeting it in T-junctions', () => {
        const ring = outerOutline([
            seg(0, 0, 12000, 0),
            seg(12000, 0, 12000, 4800),
            seg(12000, 4800, 4800, 4800),
            seg(4800, 4800, 4800, 12000),
            seg(4800, 12000, 0, 12000),
            seg(0, 12000, 0, 0),
            // Partitions: one from the south wall, one crossing the other leg.
            seg(4800, 0, 4800, 4800),
            seg(0, 7200, 4800, 7200),
        ]);
        expect(corners(ring)).toEqual(
            new Set(['0,0', '12000,0', '12000,4800', '4800,4800', '4800,12000', '0,12000'])
        );
    });

    it('cuts off a wall sticking out of the outline', () => {
        const ring = outerOutline([
            seg(0, 0, 6000, 0),
            seg(6000, 0, 6000, 6000),
            seg(6000, 6000, 0, 6000),
            seg(0, 6000, 0, 0),
            seg(6000, 3600, 9600, 3600),
        ]);
        expect(corners(ring)).toEqual(new Set(['0,0', '6000,0', '6000,6000', '0,6000']));
    });

    it('keeps the corners on straight runs when asked, for a floor that shares each wall end', () => {
        const segments = [
            seg(0, 0, 4800, 0),
            seg(4800, 0, 9600, 0),
            seg(9600, 0, 9600, 7200),
            seg(9600, 7200, 0, 7200),
            seg(0, 7200, 0, 0),
        ];
        expect(corners(outerOutline(segments)).has('4800,0')).toBe(false);
        expect(corners(outerOutline(segments, true)).has('4800,0')).toBe(true);
    });

    it('is null for walls that do not close', () => {
        expect(outerOutline([seg(0, 0, 9600, 0), seg(9600, 0, 9600, 7200)])).toBeNull();
    });
});

describe('outlineUnion', () => {
    const box = (x0: number, y0: number, x1: number, y1: number): Vec2Mm[] => [
        v(x0, y0),
        v(x1, y0),
        v(x1, y1),
        v(x0, y1),
    ];
    const area = (ring: readonly Vec2Mm[]) => signedArea2(ring) / 1e6;

    it('joins overlapping outlines into one, counter-clockwise', () => {
        const regions = outlineUnion([box(0, 0, 10000, 6000), [...box(6000, 2000, 14000, 9000)].reverse()]);
        expect(regions).toHaveLength(1);
        expect(regions[0]!.holes).toEqual([]);
        expect(area(regions[0]!.ring)).toBeCloseTo(60 + 56 - 16);
        expect(corners(regions[0]!.ring)).toEqual(
            new Set(['0,0', '10000,0', '10000,2000', '14000,2000', '14000,9000', '6000,9000', '6000,6000', '0,6000'])
        );
    });

    it('joins outlines that share an edge, with no corner left on the straight run', () => {
        const regions = outlineUnion([box(0, 0, 5000, 6000), box(5000, 0, 12000, 6000)]);
        expect(regions).toHaveLength(1);
        expect(corners(regions[0]!.ring)).toEqual(new Set(['0,0', '12000,0', '12000,6000', '0,6000']));
    });

    it('keeps outlines that only touch at a corner apart', () => {
        const regions = outlineUnion([box(0, 0, 5000, 5000), box(5000, 5000, 9000, 9000)]);
        expect(regions.map((r) => area(r.ring))).toEqual([25, 16]);
    });

    it('takes an outline inside another into it', () => {
        const regions = outlineUnion([box(0, 0, 10000, 10000), box(2000, 2000, 4000, 4000)]);
        expect(regions).toHaveLength(1);
        expect(area(regions[0]!.ring)).toBeCloseTo(100);
        expect(regions[0]!.holes).toEqual([]);
    });

    it('leaves what a ring of outlines closes round as a hole, counter-clockwise', () => {
        const regions = outlineUnion([
            box(0, 0, 12000, 3000),
            box(0, 9000, 12000, 12000),
            box(0, 3000, 3000, 9000),
            box(9000, 3000, 12000, 9000),
        ]);
        expect(regions).toHaveLength(1);
        expect(area(regions[0]!.ring)).toBeCloseTo(144);
        expect(regions[0]!.holes).toHaveLength(1);
        expect(area(regions[0]!.holes[0]!)).toBeCloseTo(36);
    });

    it('keeps an outline standing in another one\'s hole a region of its own', () => {
        const regions = outlineUnion([
            box(0, 0, 12000, 3000),
            box(0, 9000, 12000, 12000),
            box(0, 3000, 3000, 9000),
            box(9000, 3000, 12000, 9000),
            box(5000, 5000, 7000, 7000),
        ]);
        expect(regions.map((r) => [area(r.ring), r.holes.length])).toEqual([
            [144, 1],
            [4, 0],
        ]);
    });
});
