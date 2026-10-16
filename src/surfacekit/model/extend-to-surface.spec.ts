import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import { aimExtendToSurface, facesAlongRay, planExtendToSurface } from './extend-to-surface';

const p = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });

/**
 * An L: the main roof along x over 0..12000 × 0..7200, ridge at y = 3600, 45° (ridge 6000); the
 * wing north of it over 4800..9600 × 7200..14400, ridge along y at x = 7200, also 45° (ridge
 * 4800). The wing's ridge stops at y = 7200, the main roof's north eave.
 */
function lHouse() {
    const store = new SurfaceStore();
    const add = (ring: Point3Mm[]) => store.add(ring).surface!;
    add([p(0, 0, 2400), p(12000, 0, 2400), p(12000, 3600, 6000), p(0, 3600, 6000)]);
    const mainNorth = add([
        p(12000, 7200, 2400),
        p(0, 7200, 2400),
        p(0, 3600, 6000),
        p(12000, 3600, 6000),
    ]);
    const wingWest = add([
        p(4800, 14400, 2400),
        p(4800, 7200, 2400),
        p(7200, 7200, 4800),
        p(7200, 14400, 4800),
    ]);
    const wingEast = add([
        p(9600, 7200, 2400),
        p(9600, 14400, 2400),
        p(7200, 14400, 4800),
        p(7200, 7200, 4800),
    ]);
    return { store, mainNorth, wingWest, wingEast };
}

describe('planExtendToSurface', () => {
    it('runs the wing’s ridge along itself until it meets the main roof', () => {
        const { store, mainNorth } = lHouse();
        const plan = planExtendToSurface(store.surfaces(), [p(7200, 7200, 4800)], mainNorth);
        // The main north plane is at 4800 where y = 3600 + (6000 − 4800) = 4800.
        expect(plan).toEqual({
            ok: true,
            moves: [{ fromMm: p(7200, 7200, 4800), toMm: p(7200, 4800, 4800) }],
        });
    });

    it('leaves the eave corners already on the main roof, and makes a valley down each side', () => {
        const { store, mainNorth, wingWest, wingEast } = lHouse();
        // The whole end edge picked: the eave corner stays, the ridge end goes.
        const plan = planExtendToSurface(
            store.surfaces(),
            [p(4800, 7200, 2400), p(7200, 7200, 4800)],
            mainNorth
        );
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.moves).toHaveLength(1);
        const result = store.moveVerticesTo(plan.moves);
        expect(result.ok).toBe(true);
        expect(store.get(wingWest.id)!.boundaryMm).toContainEqual(p(7200, 4800, 4800));
        expect(store.get(wingEast.id)!.boundaryMm).toContainEqual(p(7200, 4800, 4800));
    });

    it('carries an eave corner along its eave when it stops short of the main roof', () => {
        const store = new SurfaceStore();
        const main = store.add([
            p(12000, 7200, 2400),
            p(0, 7200, 2400),
            p(0, 3600, 6000),
            p(12000, 3600, 6000),
        ]).surface!;
        // A monopitch wing whose end stops 1200 short, at y = 8400.
        store.add([
            p(4800, 14400, 2400),
            p(4800, 8400, 2400),
            p(7200, 8400, 4800),
            p(7200, 14400, 4800),
        ]);
        const plan = planExtendToSurface(
            store.surfaces(),
            [p(4800, 8400, 2400), p(7200, 8400, 4800)],
            main
        );
        expect(plan).toEqual({
            ok: true,
            moves: [
                { fromMm: p(4800, 8400, 2400), toMm: p(4800, 7200, 2400) },
                { fromMm: p(7200, 8400, 4800), toMm: p(7200, 4800, 4800) },
            ],
        });
    });

    it('says so when nothing runs towards the target', () => {
        const { store, mainNorth } = lHouse();
        // The wing's far ridge end: its ridge runs away from the main roof.
        const plan = planExtendToSurface(store.surfaces(), [p(7200, 14400, 4800)], mainNorth);
        expect(plan.ok).toBe(false);
    });
});

describe('aimExtendToSurface', () => {
    it('takes the slope the ridge meets first, even behind the one the cursor is over', () => {
        const { store, mainNorth } = lHouse();
        // From the south, high up: the ray crosses the south slope before the north one.
        const origin = p(6000, -20000, 20000);
        const target = p(6000, 5400, 4200);
        const d = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
        const len = Math.hypot(d.x, d.y, d.z);
        const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
        const hits = facesAlongRay(store.surfaces(), origin, dir, new Set());
        expect(hits[0]?.surface.id).not.toBe(mainNorth.id);
        const aim = aimExtendToSurface(
            store.surfaces(),
            store.surfaces(),
            [p(7200, 7200, 4800)],
            origin,
            dir
        );
        expect(aim?.target.id).toBe(mainNorth.id);
        expect(aim?.plan).toEqual({
            ok: true,
            moves: [{ fromMm: p(7200, 7200, 4800), toMm: p(7200, 4800, 4800) }],
        });
    });
});
