import { describe, expect, it } from 'vitest';
import {
    groundPlane,
    lockAxisOf,
    planeThroughRing,
    ringLiesInPlane,
    signedDistanceToPlane,
    verticalPlaneThrough,
} from './working-plane';

const WALL_PLANE = verticalPlaneThrough({ x: 0, y: 0, z: 0 }, { x: 4800, y: 0, z: 0 })!;

describe('lockAxisOf', () => {
    it('names the in-plane axes on the ground plane', () => {
        const ground = groundPlane(0);
        expect(lockAxisOf(ground, { x: 1, y: 0 })).toBe('x');
        expect(lockAxisOf(ground, { x: 0, y: 1 })).toBe('y');
        expect(lockAxisOf(ground, { x: Math.SQRT1_2, y: Math.SQRT1_2 })).toBe('diagonal');
    });

    it('names the vertical on a wall plane — the lock the ground plane cannot offer', () => {
        expect(lockAxisOf(WALL_PLANE, { x: 0, y: 1 })).toBe('z');
        expect(lockAxisOf(WALL_PLANE, { x: 0, y: -1 })).toBe('z');
        // Along the wall, which here runs east.
        expect(lockAxisOf(WALL_PLANE, { x: 1, y: 0 })).toBe('x');
    });

    it('does not name a wall running at an angle as either horizontal axis', () => {
        const angled = verticalPlaneThrough({ x: 0, y: 0, z: 0 }, { x: 3000, y: 1000, z: 0 })!;
        expect(lockAxisOf(angled, { x: 1, y: 0 })).toBe('diagonal');
        expect(lockAxisOf(angled, { x: 0, y: 1 })).toBe('z');
    });
});

describe('ringLiesInPlane', () => {
    const floor = [
        { x: 0, y: 0, z: 0 },
        { x: 4800, y: 0, z: 0 },
        { x: 4800, y: 3600, z: 0 },
    ];

    it('accepts geometry in the plane', () => {
        expect(ringLiesInPlane(groundPlane(0), floor)).toBe(true);
    });

    it('rejects a floor against a wall plane, so it cannot offer phantom snap points', () => {
        expect(ringLiesInPlane(WALL_PLANE, floor)).toBe(false);
    });

    it('accepts the part of that floor that does lie in the wall plane', () => {
        expect(
            ringLiesInPlane(WALL_PLANE, [
                { x: 0, y: 0, z: 0 },
                { x: 4800, y: 0, z: 2400 },
            ])
        ).toBe(true);
    });
});

describe('planeThroughRing', () => {
    it('has no plane until three points exist', () => {
        expect(planeThroughRing([])).toBeNull();
        expect(planeThroughRing([{ x: 0, y: 0, z: 0 }])).toBeNull();
        expect(
            planeThroughRing([
                { x: 0, y: 0, z: 0 },
                { x: 4800, y: 0, z: 2400 },
            ])
        ).toBeNull();
    });

    it('has no plane while three points stay collinear', () => {
        expect(
            planeThroughRing([
                { x: 0, y: 0, z: 0 },
                { x: 2400, y: 0, z: 1200 },
                { x: 4800, y: 0, z: 2400 },
            ])
        ).toBeNull();
    });

    it('locks a tilted plane through the first three non-collinear corners', () => {
        // A monopitch roof plane: one edge at z=2400, the opposite at z=3000, 4800 apart.
        const plane = planeThroughRing([
            { x: 0, y: 0, z: 2400 },
            { x: 4800, y: 0, z: 2400 },
            { x: 4800, y: 3600, z: 3000 },
        ])!;
        expect(plane).not.toBeNull();
        // Not the ground plane's normal — the whole point of leaving it.
        expect(plane.normal.z).toBeLessThan(0.999);
        // The rectangle's fourth corner, at the height the pitch implies, is exactly in it.
        expect(signedDistanceToPlane(plane, { x: 0, y: 3600, z: 3000 })).toBeCloseTo(0, 6);
        // A point still on the ground is not.
        expect(signedDistanceToPlane(plane, { x: 0, y: 3600, z: 0 })).not.toBeCloseTo(0, 3);
    });
});
