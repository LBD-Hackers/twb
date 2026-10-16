import { describe, expect, it } from 'vitest';
import { SurfaceStore } from './surface-store';
import type { Point3Mm } from '../core';
import { roofHeightAbove, roofTopProfile } from './roof-height';

const FLOOR: Point3Mm[] = [
    { x: 0, y: 0, z: 0 },
    { x: 7200, y: 0, z: 0 },
    { x: 7200, y: 9600, z: 0 },
    { x: 0, y: 9600, z: 0 },
];

/** A gabled box, exactly as `surface-store.spec.ts` builds one for the same reason. */
function gableBox(): SurfaceStore {
    const store = new SurfaceStore();
    const base = store.add(FLOOR).surface!;
    const topId = store.extrude(base.id, 2400).surfaceIds[0]!;
    const a = { x: 3600, y: 0, z: 2400 };
    const b = { x: 3600, y: 9600, z: 2400 };
    store.split(topId, [a, b]);
    store.moveVertices([a, b], { x: 0, y: 0, z: 1500 });
    return store;
}

describe('roofHeightAbove', () => {
    it('reads the slope height on either side of the ridge, symmetrically', () => {
        const store = gableBox();
        // Eave 2400, ridge 3900 at x=3600: linear over a 3600 mm run either side of it.
        expect(roofHeightAbove(store.surfaces(), 1800, 4800, 0)).toBeCloseTo(3150);
        expect(roofHeightAbove(store.surfaces(), 5400, 4800, 0)).toBeCloseTo(3150);
    });

    it('is null outside the roof’s footprint, and null below the given floor', () => {
        const store = gableBox();
        expect(roofHeightAbove(store.surfaces(), 20000, 20000, 0)).toBeNull();
        // The eave height (2400) sits at the given floor, not above it.
        expect(roofHeightAbove(store.surfaces(), 0, 4800, 2400)).toBeNull();
    });

    it('reads the roof height at a point exactly on the eave — where an interior wall always ends', () => {
        const store = gableBox();
        // y=0 and y=9600 are both the roof rectangle's own edges in plan, the ray-casting
        // point-in-polygon test's classic blind spot. An interior wall's ends sit exactly here,
        // against the exterior wall, on every run — not an edge case for it, the normal case.
        expect(roofHeightAbove(store.surfaces(), 1800, 0, 0)).toBeCloseTo(3150);
        expect(roofHeightAbove(store.surfaces(), 1800, 9600, 0)).toBeCloseTo(3150);
    });

    it('takes the lower of two overlapping roof planes', () => {
        const store = new SurfaceStore();
        store.add([
            { x: 0, y: 0, z: 3000 },
            { x: 4800, y: 0, z: 3000 },
            { x: 4800, y: 4800, z: 3600 },
            { x: 0, y: 4800, z: 3600 },
        ]);
        store.add([
            { x: 0, y: 0, z: 4200 },
            { x: 4800, y: 0, z: 4200 },
            { x: 4800, y: 4800, z: 4800 },
            { x: 0, y: 4800, z: 4800 },
        ]);
        expect(roofHeightAbove(store.surfaces(), 2400, 2400, 0)).toBe(3300);
    });
});

describe('roofTopProfile', () => {
    it('adds exactly the ridge as a breakpoint for a run crossing a gable, and no more', () => {
        const store = gableBox();
        const profile = roofTopProfile(
            store.surfaces(),
            { x: 0, y: 4800 },
            { x: 7200, y: 4800 },
            0,
            2400
        );
        expect(profile.map((p) => Math.round(p.x))).toEqual([0, 3600, 7200]);
        expect(profile[0]!.z).toBeCloseTo(2400);
        expect(profile[1]!.z).toBeCloseTo(3900);
        expect(profile[2]!.z).toBeCloseTo(2400);
    });

    it('stays at two points along a single roof plane — a straight line needs no breakpoint', () => {
        const store = gableBox();
        // Both ends sit under the same slope (x from 0 to 3600, the ridge), so the height along
        // it is already exactly linear.
        const profile = roofTopProfile(
            store.surfaces(),
            { x: 0, y: 4800 },
            { x: 3600, y: 4800 },
            0,
            2400
        );
        expect(profile).toHaveLength(2);
        expect(profile[0]!.z).toBeCloseTo(2400);
        expect(profile[1]!.z).toBeCloseTo(3900);
    });

    it('does not split a run too short to be worth a breakpoint, even straddling the ridge', () => {
        const store = gableBox();
        // 100 mm either side of the ridge at x = 3600: a real height change is there, but the
        // run itself is far under `minSpanMm`, which is exactly the guard against turning a wall
        // that merely grazes a ridge or hip line into a cluster of slivers.
        const profile = roofTopProfile(
            store.surfaces(),
            { x: 3550, y: 4800 },
            { x: 3650, y: 4800 },
            0,
            2400
        );
        expect(profile).toHaveLength(2);
    });

    it('falls back to the nominal top for a run with no roof over it', () => {
        const store = gableBox();
        const profile = roofTopProfile(
            store.surfaces(),
            { x: 20000, y: 20000 },
            { x: 21000, y: 20000 },
            0,
            2400
        );
        expect(profile).toHaveLength(2);
        expect(profile[0]!.z).toBe(2400);
        expect(profile[1]!.z).toBe(2400);
    });
});
