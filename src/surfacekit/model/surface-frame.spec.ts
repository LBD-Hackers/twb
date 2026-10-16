import { describe, expect, it } from 'vitest';
import { toFrameUv, type Point3Mm } from '../core';
import { openingFromRing3, openingRing3, surfaceFrame } from './surface-frame';

const near = (a: Point3Mm, b: Point3Mm): void => {
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
};

describe('surfaceFrame', () => {
    it('gives a wall along X a u axis towards +X and v straight up, whichever way it winds', () => {
        const ccw: Point3Mm[] = [
            { x: 0, y: 0, z: 0 },
            { x: 7200, y: 0, z: 0 },
            { x: 7200, y: 0, z: 2400 },
            { x: 0, y: 0, z: 2400 },
        ];
        const cw = [...ccw].reverse();
        for (const ring of [ccw, cw]) {
            const f = surfaceFrame(ring)!;
            near(f.uDir, { x: 1, y: 0, z: 0 });
            near(f.vDir, { x: 0, y: 0, z: 1 });
            near(f.originMm, { x: 0, y: 0, z: 0 });
            expect(toFrameUv(f, { x: 2400, y: 0, z: 900 })).toEqual({ x: 2400, y: 900 });
        }
    });

    it('gives a wall along Y a u axis towards +Y', () => {
        const f = surfaceFrame([
            { x: 7200, y: 0, z: 0 },
            { x: 7200, y: 9600, z: 0 },
            { x: 7200, y: 9600, z: 2400 },
            { x: 7200, y: 0, z: 2400 },
        ])!;
        near(f.uDir, { x: 0, y: 1, z: 0 });
        near(f.vDir, { x: 0, y: 0, z: 1 });
    });

    it('gives a horizontal face world X and Y, so a hole’s UV is its plan', () => {
        const f = surfaceFrame([
            { x: 1200, y: 2400, z: 2400 },
            { x: 8400, y: 2400, z: 2400 },
            { x: 8400, y: 12000, z: 2400 },
            { x: 1200, y: 12000, z: 2400 },
        ])!;
        near(f.uDir, { x: 1, y: 0, z: 0 });
        near(f.vDir, { x: 0, y: 1, z: 0 });
        near(f.originMm, { x: 1200, y: 2400, z: 2400 });
    });

    it('gives a sloped face a horizontal u along the eave and a v up the slope', () => {
        const f = surfaceFrame([
            { x: 0, y: 0, z: 2400 },
            { x: 7200, y: 0, z: 2400 },
            { x: 7200, y: 4800, z: 3900 },
            { x: 0, y: 4800, z: 3900 },
        ])!;
        expect(f.uDir.z).toBeCloseTo(0, 9);
        near(f.uDir, { x: 1, y: 0, z: 0 });
        expect(f.vDir.z).toBeGreaterThan(0);
        expect(f.vDir.y).toBeGreaterThan(0);
    });

    it('returns null for a ring with no plane', () => {
        expect(
            surfaceFrame([
                { x: 0, y: 0, z: 0 },
                { x: 1200, y: 0, z: 0 },
                { x: 2400, y: 0, z: 0 },
            ])
        ).toBeNull();
    });
});

describe('openingRing3 / openingFromRing3', () => {
    const wall = surfaceFrame([
        { x: 0, y: 0, z: 0 },
        { x: 7200, y: 0, z: 0 },
        { x: 7200, y: 0, z: 2400 },
        { x: 0, y: 0, z: 2400 },
    ])!;

    it('round-trips a window through the wall frame', () => {
        const hole = { id: 'h', uMm: 1200, vMm: 900, widthMm: 1200, heightMm: 1200 };
        const ring = openingRing3(wall, hole);
        expect(ring[0]).toEqual({ x: 1200, y: 0, z: 900 });
        expect(ring[2]).toEqual({ x: 2400, y: 0, z: 2100 });
        expect(openingFromRing3(wall, ring, 'h')).toEqual(hole);
    });

    it('accepts the rectangle in any corner order', () => {
        const ring = [
            { x: 2400, y: 0, z: 2100 },
            { x: 1200, y: 0, z: 2100 },
            { x: 1200, y: 0, z: 900 },
            { x: 2400, y: 0, z: 900 },
        ];
        expect(openingFromRing3(wall, ring, 'h')?.uMm).toBe(1200);
    });

    it('rejects a ring that is not an axis-aligned rectangle in the frame', () => {
        expect(
            openingFromRing3(
                wall,
                [
                    { x: 1200, y: 0, z: 900 },
                    { x: 2400, y: 0, z: 1200 },
                    { x: 2400, y: 0, z: 2100 },
                    { x: 1200, y: 0, z: 1800 },
                ],
                'h'
            )
        ).toBeNull();
    });
});
