import { describe, expect, it } from 'vitest';
import { cross3, dot3, normalize3, add3, scale3, type Point3Mm } from '../core';
import { inferAxis, nearestOnSegments, type AxisInferenceInput } from './free-inference';

// An orthographic camera looking down at the model from the south-east, 10 mm per pixel.
const D = normalize3({ x: -1, y: 1, z: -1 });
const R = normalize3(cross3(D, { x: 0, y: 0, z: 1 }));
const U = cross3(R, D);
const S = 10;
const project = (p: Point3Mm) => ({ x: dot3(p, R) / S, y: -dot3(p, U) / S });
const rayAt = (pixel: { x: number; y: number }) => ({
    originMm: add3(add3(scale3(R, pixel.x * S), scale3(U, -pixel.y * S)), scale3(D, -100_000)),
    dir: D,
    pixel,
});
const aim = (p: Point3Mm, dx = 0, dy = 0) => {
    const px = project(p);
    return rayAt({ x: px.x + dx, y: px.y + dy });
};

const base = (ray: ReturnType<typeof rayAt>): AxisInferenceInput => ({
    ray,
    project,
    anchorMm: { x: 0, y: 0, z: 2400 },
    cornersMm: [],
    catchPx: 22,
    catchDeg: 12,
    holdFactor: 3,
    held: null,
    force: false,
    alignPx: 12,
    minAlongMm: 50,
    pitchMm: 600,
});

describe('inferAxis', () => {
    it('catches the red axis and steps along it on the grid', () => {
        const hit = inferAxis(base(aim({ x: 3100, y: 0, z: 2400 }, 0, 3)));
        expect(hit).toEqual({ pointMm: { x: 3000, y: 0, z: 2400 }, axis: 'x', alignedTo: null });
    });

    it('catches the blue axis down to the ground', () => {
        const hit = inferAxis(base(aim({ x: 0, y: 0, z: 0 }, 2, 0)));
        expect(hit?.axis).toBe('z');
        expect(hit?.pointMm).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('stops level with a corner when the cursor passes it — the end of the facade', () => {
        const input = base(aim({ x: 4780, y: 0, z: 2400 }, 0, 2));
        input.cornersMm = [{ x: 4750, y: 7200, z: 0 }];
        const hit = inferAxis(input);
        expect(hit).toEqual({
            pointMm: { x: 4750, y: 0, z: 2400 },
            axis: 'x',
            alignedTo: { x: 4750, y: 7200, z: 0 },
        });
    });

    it('lets go away from every axis, and near the anchor', () => {
        expect(inferAxis(base(aim({ x: 3000, y: 3000, z: 2400 })))).toBeNull();
        expect(inferAxis(base(aim({ x: 10, y: 0, z: 2400 })))).toBeNull();
    });

    it('does not catch a line meant to run off the axis, close to the anchor', () => {
        // 20 px off the axis at 60 px out is 18° — inside the band, outside the angle.
        const anchorPx = project({ x: 0, y: 0, z: 2400 });
        const alongPx = project({ x: 1000, y: 0, z: 2400 });
        const ux =
            (alongPx.x - anchorPx.x) / Math.hypot(alongPx.x - anchorPx.x, alongPx.y - anchorPx.y);
        const uy =
            (alongPx.y - anchorPx.y) / Math.hypot(alongPx.x - anchorPx.x, alongPx.y - anchorPx.y);
        const pixel = { x: anchorPx.x + ux * 60 - uy * 20, y: anchorPx.y + uy * 60 + ux * 20 };
        expect(inferAxis(base(rayAt(pixel)))).toBeNull();
    });

    it('holds the axis it has further out than it catches', () => {
        const ray = aim({ x: 3000, y: 0, z: 2400 }, 0, 40);
        expect(inferAxis(base(ray))).toBeNull();
        expect(inferAxis({ ...base(ray), held: 'x' })?.axis).toBe('x');
    });
});

describe('nearestOnSegments', () => {
    it('lands part-way along an edge, on the grid', () => {
        const edge = [
            { x: 0, y: 0, z: 0 },
            { x: 7200, y: 0, z: 0 },
        ] as const;
        const p = nearestOnSegments([edge], aim({ x: 2500, y: 0, z: 0 }, 1, 1), project, 12, 600);
        expect(p).toEqual({ x: 2400, y: 0, z: 0 });
        expect(
            nearestOnSegments([edge], aim({ x: 2500, y: 3000, z: 0 }), project, 12, 600)
        ).toBeNull();
    });
});
