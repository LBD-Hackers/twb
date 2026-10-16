import { describe, expect, it } from 'vitest';
import {
    clipLineToPolygon2,
    convexHull2,
    minAreaRect2,
    signedArea2,
    triangulatePolygon2,
    type Vec2Mm,
} from './geom2';

const square: Vec2Mm[] = [
    { x: 0, y: 0 },
    { x: 4800, y: 0 },
    { x: 4800, y: 4800 },
    { x: 0, y: 4800 },
];

describe('convexHull2', () => {
    it('drops interior and collinear points', () => {
        const hull = convexHull2([...square, { x: 2400, y: 2400 }, { x: 2400, y: 0 }]);
        expect(hull).toHaveLength(4);
    });

    it('passes a degenerate set straight through', () => {
        expect(convexHull2([{ x: 0, y: 0 }])).toHaveLength(1);
    });
});

describe('minAreaRect2', () => {
    it('finds the short axis of an axis-aligned room', () => {
        const rect = minAreaRect2([
            { x: 0, y: 0 },
            { x: 7200, y: 0 },
            { x: 7200, y: 3600 },
            { x: 0, y: 3600 },
        ])!;
        expect(rect.longMm).toBeCloseTo(7200, 3);
        expect(rect.shortMm).toBeCloseTo(3600, 3);
        // Joists span the short way: along Y here, whichever sign.
        expect(Math.abs(rect.shortDir.y)).toBeCloseTo(1, 6);
    });

    it('rotates with the room — the whole reason it is not a bounding box', () => {
        // A 45-degree rectangle: an axis-aligned bounding box would report a square.
        const rect = minAreaRect2([
            { x: 0, y: 0 },
            { x: 3000, y: 3000 },
            { x: 2000, y: 4000 },
            { x: -1000, y: 1000 },
        ])!;
        expect(rect.longMm).toBeCloseTo(Math.hypot(3000, 3000), 3);
        expect(rect.shortMm).toBeCloseTo(Math.hypot(1000, 1000), 3);
    });

    it('returns null for a degenerate ring', () => {
        expect(
            minAreaRect2([
                { x: 0, y: 0 },
                { x: 1, y: 1 },
            ])
        ).toBeNull();
    });
});

describe('clipLineToPolygon2', () => {
    it('keeps the interior run of a line across a square', () => {
        const runs = clipLineToPolygon2({ x: 0, y: 2400 }, { x: 1, y: 0 }, [square]);
        expect(runs).toHaveLength(1);
        expect(runs[0]!.t0).toBeCloseTo(0, 6);
        expect(runs[0]!.t1).toBeCloseTo(4800, 6);
    });

    it('splits around a hole, which is what a stairwell is', () => {
        const hole: Vec2Mm[] = [
            { x: 1200, y: 1200 },
            { x: 3600, y: 1200 },
            { x: 3600, y: 3600 },
            { x: 1200, y: 3600 },
        ];
        const runs = clipLineToPolygon2({ x: 0, y: 2400 }, { x: 1, y: 0 }, [square, hole]);
        expect(runs).toHaveLength(2);
        expect(runs[0]!.t1).toBeCloseTo(1200, 6);
        expect(runs[1]!.t0).toBeCloseTo(3600, 6);
    });

    it('crosses a concave polygon in two runs', () => {
        const lShape: Vec2Mm[] = [
            { x: 0, y: 0 },
            { x: 4800, y: 0 },
            { x: 4800, y: 1200 },
            { x: 2400, y: 1200 },
            { x: 2400, y: 4800 },
            { x: 0, y: 4800 },
        ];
        expect(clipLineToPolygon2({ x: 0, y: 600 }, { x: 1, y: 0 }, [lShape])).toHaveLength(1);
        expect(clipLineToPolygon2({ x: 0, y: 2400 }, { x: 1, y: 0 }, [lShape])[0]!.t1).toBeCloseTo(
            2400,
            6
        );
    });

    it('counts a vertex on the line once, so a line through a corner still reports the interior', () => {
        const diamond: Vec2Mm[] = [
            { x: 0, y: 0 },
            { x: 2400, y: -2400 },
            { x: 4800, y: 0 },
            { x: 2400, y: 2400 },
        ];
        const runs = clipLineToPolygon2({ x: 0, y: 0 }, { x: 1, y: 0 }, [diamond]);
        expect(runs).toHaveLength(1);
        expect(runs[0]!.t1 - runs[0]!.t0).toBeCloseTo(4800, 6);
    });
});

describe('triangulatePolygon2', () => {
    it('covers a concave L exactly, whichever way it winds', () => {
        const l = [
            { x: 0, y: 0 },
            { x: 2000, y: 0 },
            { x: 2000, y: 1000 },
            { x: 1000, y: 1000 },
            { x: 1000, y: 2000 },
            { x: 0, y: 2000 },
        ];
        for (const ring of [l, [...l].reverse()]) {
            const tris = triangulatePolygon2(ring);
            expect(tris).toHaveLength(4);
            const area = tris.reduce((s, t) => s + signedArea2(t), 0);
            expect(area).toBeCloseTo(3e6, 6);
            expect(tris.every((t) => signedArea2(t) > 0)).toBe(true);
        }
    });

    it('makes no zero-area sliver at a collinear corner', () => {
        const ring = [
            { x: 0, y: 0 },
            { x: 500, y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 1000 },
            { x: 0, y: 1000 },
        ];
        const tris = triangulatePolygon2(ring);
        expect(tris.every((t) => signedArea2(t) > 1)).toBe(true);
        expect(tris.reduce((s, t) => s + signedArea2(t), 0)).toBeCloseTo(1e6, 6);
    });
});
