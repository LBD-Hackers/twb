import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import { surfaceFrame, openingRing3 } from './surface-frame';
import { storeyCeilingZ, wallCeilingZ } from './roof-lift';

const P = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });

/** The id of the `n`th face added — ids come from a counter shared across stores. */
const sid = (store: SurfaceStore, n: number): string => store.surfaces()[n - 1]!.id;

/** A 7200 × 9600 box, 2400 to the eaves, under a gable roof with its ridge along Y at 4200. */
function gableBox(store: SurfaceStore): void {
    const ridge = 4200;
    const rings: Point3Mm[][] = [
        [P(0, 0, 0), P(7200, 0, 0), P(7200, 9600, 0), P(0, 9600, 0)],
        [P(0, 0, 0), P(7200, 0, 0), P(7200, 0, 2400), P(3600, 0, ridge), P(0, 0, 2400)],
        [P(7200, 0, 0), P(7200, 9600, 0), P(7200, 9600, 2400), P(7200, 0, 2400)],
        [
            P(7200, 9600, 0),
            P(0, 9600, 0),
            P(0, 9600, 2400),
            P(3600, 9600, ridge),
            P(7200, 9600, 2400),
        ],
        [P(0, 9600, 0), P(0, 0, 0), P(0, 0, 2400), P(0, 9600, 2400)],
        [P(0, 0, 2400), P(3600, 0, ridge), P(3600, 9600, ridge), P(0, 9600, 2400)],
        [P(3600, 0, ridge), P(7200, 0, 2400), P(7200, 9600, 2400), P(3600, 9600, ridge)],
    ];
    for (const ring of rings) expect(store.add(ring).surface).not.toBeNull();
}

const zs = (store: SurfaceStore, n: number): number[] =>
    store.get(sid(store, n))!.boundaryMm.map((p) => p.z);

function openingZs(store: SurfaceStore, n: number): number[] {
    const s = store.get(sid(store, n))!;
    const frame = surfaceFrame(s.boundaryMm)!;
    return openingRing3(frame, s.openings[0]!).map((p) => p.z);
}

describe('ceiling lines', () => {
    it("reads a gable wall's ceiling at its eaves, not its ridge", () => {
        const store = new SurfaceStore();
        gableBox(store);
        expect(wallCeilingZ(store.get(sid(store, 2))!)).toBe(2400);
        expect(storeyCeilingZ(store.surfaces(), store.storeys()[0]!)).toBe(2400);
    });
});

describe('liftRoof', () => {
    it('raises the eaves and the ridge alike, so the roof keeps its pitch', () => {
        const store = new SurfaceStore();
        gableBox(store);
        const result = store.liftRoof({ fromZMm: 2400, riseMm: 300, baseZMm: 0 });
        expect(result.ok).toBe(true);
        expect(zs(store, 1)).toEqual([0, 0, 0, 0]);
        expect(zs(store, 2)).toEqual([0, 0, 2700, 4500, 2700]);
        expect(zs(store, 3)).toEqual([0, 0, 2700, 2700]);
        expect(zs(store, 6)).toEqual([2700, 4500, 4500, 2700]);
    });

    it('keeps a window below the ceiling where it was, and lifts one in the gable', () => {
        const store = new SurfaceStore();
        gableBox(store);
        const low = [P(1000, 0, 900), P(2200, 0, 900), P(2200, 0, 2100), P(1000, 0, 2100)];
        expect(store.addOpening(sid(store, 2), low, 'window').ok).toBe(true);
        const high = [
            P(3200, 9600, 2800),
            P(4000, 9600, 2800),
            P(4000, 9600, 3400),
            P(3200, 9600, 3400),
        ];
        expect(store.addOpening(sid(store, 4), high, 'window').ok).toBe(true);
        expect(store.liftRoof({ fromZMm: 2400, riseMm: 600, baseZMm: 0 }).ok).toBe(true);
        expect(Math.min(...openingZs(store, 2))).toBe(900);
        expect(Math.min(...openingZs(store, 4))).toBe(3400);
    });

    it('lowers the ceiling, but not onto a window head', () => {
        const store = new SurfaceStore();
        gableBox(store);
        // On the eaves wall: a window in the gable would still have the triangle above it.
        const ring = [
            P(7200, 1000, 900),
            P(7200, 2200, 900),
            P(7200, 2200, 2100),
            P(7200, 1000, 2100),
        ];
        expect(store.addOpening(sid(store, 3), ring, 'window').ok).toBe(true);
        expect(store.liftRoof({ fromZMm: 2400, riseMm: -200, baseZMm: 0 }).ok).toBe(true);
        expect(zs(store, 3)).toEqual([0, 0, 2200, 2200]);
        const refused = store.liftRoof({ fromZMm: 2200, riseMm: -200, baseZMm: 0 });
        expect(refused.ok).toBe(false);
        expect(zs(store, 3)).toEqual([0, 0, 2200, 2200]);
    });

    it('moves the storeys above with it and grows the lifted storey', () => {
        const store = new SurfaceStore();
        gableBox(store);
        const ground = store.storeys()[0]!;
        store.setStoreyHeight(ground.id, 2400);
        const upper = store.addStorey();
        expect(upper).not.toBeNull();
        const elevationBefore = store.getStorey(upper!.id)!.elevationMm;
        expect(store.liftRoof({ fromZMm: 2400, riseMm: 300, baseZMm: 0 }).ok).toBe(true);
        expect(store.getStorey(upper!.id)!.elevationMm).toBe(elevationBefore + 300);
        expect(store.getStorey(ground.id)!.heightMm).toBe(2700);
    });

    it('refuses a ceiling nobody could stand under', () => {
        const store = new SurfaceStore();
        gableBox(store);
        expect(store.liftRoof({ fromZMm: 2400, riseMm: -1500, baseZMm: 0 }).ok).toBe(false);
    });
});
