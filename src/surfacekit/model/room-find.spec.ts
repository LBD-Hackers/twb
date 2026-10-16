import { describe, expect, it } from 'vitest';
import { polygonArea2, type Vec2Mm } from '../core';
import { roomOutlineAt, type PlanSegment } from './room-find';

const seg = (ax: number, ay: number, bx: number, by: number): PlanSegment => [
    { x: ax, y: ay },
    { x: bx, y: by },
];

/** A 7200 × 4800 outline with a partition teeing into both long walls at x = 3600. */
const HOUSE: PlanSegment[] = [
    seg(0, 0, 7200, 0),
    seg(7200, 0, 7200, 4800),
    seg(7200, 4800, 0, 4800),
    seg(0, 4800, 0, 0),
    seg(3600, 0, 3600, 4800),
];

const sortedCorners = (ring: readonly Vec2Mm[]): string[] =>
    ring.map((p) => `${p.x},${p.y}`).sort();

describe('roomOutlineAt', () => {
    it('finds the room on each side of a partition that tees into the facade', () => {
        const west = roomOutlineAt(HOUSE, { x: 1000, y: 1000 });
        const east = roomOutlineAt(HOUSE, { x: 6000, y: 1000 });
        expect(sortedCorners(west!)).toEqual(['0,0', '0,4800', '3600,0', '3600,4800']);
        expect(sortedCorners(east!)).toEqual(['3600,0', '3600,4800', '7200,0', '7200,4800']);
    });

    it('returns null outside the building', () => {
        expect(roomOutlineAt(HOUSE, { x: -500, y: 1000 })).toBeNull();
    });

    it('returns null in a room whose walls do not close', () => {
        const open = HOUSE.filter((_, i) => i !== 1);
        expect(roomOutlineAt(open, { x: 6000, y: 1000 })).toBeNull();
    });

    it('ignores a stub wall that ends in the middle of a room', () => {
        const withStub = [...HOUSE, seg(5400, 0, 5400, 2000)];
        const east = roomOutlineAt(withStub, { x: 6000, y: 3000 });
        expect(polygonArea2(east!)).toBe(3600 * 4800);
    });

    it('splits walls where they cross, and merges one lying over another', () => {
        // An L-shaped room from a cross of partitions, with the south wall passed in twice.
        const crossed = [
            ...HOUSE.slice(0, 4),
            seg(0, 0, 7200, 0),
            seg(3600, -1000, 3600, 4800),
            seg(0, 2400, 3600, 2400),
        ];
        const sw = roomOutlineAt(crossed, { x: 1000, y: 1000 });
        expect(sortedCorners(sw!)).toEqual(['0,0', '0,2400', '3600,0', '3600,2400']);
    });
});
