import { describe, expect, it } from 'vitest';
import { signedArea2, type Vec2Mm } from '../core';
import { outerOutline } from './plan-outline';
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
