import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import {
    dimensionEdit,
    openingDimensions,
    storeyCeilingDimensions,
    wallDimensions,
    type Dimension,
} from './dimensions';

const P = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });

/** The id of the `n`th face added — ids come from a counter shared across stores. */
const sid = (store: SurfaceStore, n: number): string => store.surfaces()[n - 1]!.id;

/** A 7200 × 9600 flat-roofed box with an interior wall across it at y = 4800 (the 7th face). */
function house(): SurfaceStore {
    const store = new SurfaceStore();
    const rings: Point3Mm[][] = [
        [P(0, 0, 0), P(7200, 0, 0), P(7200, 9600, 0), P(0, 9600, 0)],
        [P(0, 0, 0), P(7200, 0, 0), P(7200, 0, 2400), P(0, 0, 2400)],
        [P(7200, 0, 0), P(7200, 9600, 0), P(7200, 9600, 2400), P(7200, 0, 2400)],
        [P(7200, 9600, 0), P(0, 9600, 0), P(0, 9600, 2400), P(7200, 9600, 2400)],
        [P(0, 9600, 0), P(0, 0, 0), P(0, 0, 2400), P(0, 9600, 2400)],
        [P(0, 0, 2400), P(7200, 0, 2400), P(7200, 9600, 2400), P(0, 9600, 2400)],
        [P(0, 4800, 0), P(7200, 4800, 0), P(7200, 4800, 2400), P(0, 4800, 2400)],
    ];
    for (const ring of rings) expect(store.add(ring).surface).not.toBeNull();
    return store;
}

const storey = (store: SurfaceStore) => store.storeys()[0]!;
const find = (dims: Dimension[], id: string): Dimension => dims.find((d) => d.id === id)!;

function apply(store: SurfaceStore, dim: Dimension, value: number, pinned: 0 | 1): void {
    const edit = dimensionEdit(store.surfaces(), dim, value, pinned, 0);
    if (edit.kind === 'line') expect(store.moveWallLine(edit.request).ok).toBe(true);
    else if (edit.kind === 'opening') {
        expect(store.resizeOpening(edit.surfaceId, edit.openingId, edit.patch).ok).toBe(true);
    } else if (edit.kind === 'lift') expect(store.liftRoof(edit.request).ok).toBe(true);
    else throw new Error(edit.message);
}

describe('wallDimensions', () => {
    it('measures a wall end to end and to the nearest parallel wall', () => {
        const store = house();
        const dims = wallDimensions(store.surfaces(), storey(store), sid(store, 2));
        expect(find(dims, 'length').valueMm).toBe(7200);
        const parallel = dims.filter((d) => d.id.startsWith('parallel'));
        expect(parallel.map((d) => d.valueMm)).toEqual([4800]);
    });

    it('draws the length outside the house', () => {
        const store = house();
        const length = find(
            wallDimensions(store.surfaces(), storey(store), sid(store, 2)),
            'length'
        );
        expect(length.sideMm.y).toBeLessThan(0);
    });

    it('lengthens a wall by moving the wall at its unpinned end', () => {
        const store = house();
        const length = find(
            wallDimensions(store.surfaces(), storey(store), sid(store, 2)),
            'length'
        );
        apply(store, length, 8400, 0);
        expect(store.get(sid(store, 3))!.boundaryMm.every((p) => p.x === 8400)).toBe(true);
        expect(store.get(sid(store, 5))!.boundaryMm.every((p) => p.x === 0)).toBe(true);
        expect(
            find(wallDimensions(store.surfaces(), storey(store), sid(store, 2)), 'length').valueMm
        ).toBe(8400);
    });

    it('moves the other end when that one is pinned', () => {
        const store = house();
        const length = find(
            wallDimensions(store.surfaces(), storey(store), sid(store, 2)),
            'length'
        );
        apply(store, length, 8400, 1);
        expect(store.get(sid(store, 5))!.boundaryMm.every((p) => p.x === -1200)).toBe(true);
        expect(store.get(sid(store, 3))!.boundaryMm.every((p) => p.x === 7200)).toBe(true);
    });

    it('moves the selected wall to a new distance from its neighbour', () => {
        const store = house();
        const dims = wallDimensions(store.surfaces(), storey(store), sid(store, 7));
        const toSouth = dims.find((d) => d.id.startsWith('parallel') && d.toMm.y === 0)!;
        expect(toSouth.valueMm).toBe(4800);
        apply(store, toSouth, 3600, toSouth.defaultPinned);
        expect(store.get(sid(store, 7))!.boundaryMm.every((p) => p.y === 3600)).toBe(true);
    });
});

describe('openingDimensions', () => {
    function withWindow(n: 2 | 4, x0: number): SurfaceStore {
        const store = house();
        const wall = sid(store, n);
        const y = n === 2 ? 0 : 9600;
        const ring = [P(x0, y, 900), P(x0 + 900, y, 900), P(x0 + 900, y, 2100), P(x0, y, 2100)];
        expect(store.addOpening(wall, ring, 'window').ok).toBe(true);
        return store;
    }
    const dimsOf = (store: SurfaceStore, n: number) =>
        openingDimensions(
            store.surfaces(),
            storey(store),
            sid(store, n),
            store.get(sid(store, n))!.openings[0]!.id
        );

    it('places an opening between the wall ends, with its size', () => {
        const store = withWindow(2, 1200);
        const dims = dimsOf(store, 2);
        expect(find(dims, 'before').valueMm).toBe(1200);
        expect(find(dims, 'width').valueMm).toBe(900);
        expect(find(dims, 'after').valueMm).toBe(5100);
        expect(find(dims, 'sill').valueMm).toBe(900);
        expect(find(dims, 'height').valueMm).toBe(1200);
    });

    it('slides the opening along its wall from either side', () => {
        const store = withWindow(2, 1200);
        apply(store, find(dimsOf(store, 2), 'before'), 1500, 0);
        expect(store.get(sid(store, 2))!.openings[0]!.uMm).toBe(1500);
        const after = find(dimsOf(store, 2), 'after');
        apply(store, after, 4500, after.defaultPinned);
        expect(store.get(sid(store, 2))!.openings[0]!.uMm).toBe(1800);
    });

    it('moves the wall end instead when the opening is pinned', () => {
        const store = withWindow(2, 1200);
        apply(store, find(dimsOf(store, 2), 'before'), 1500, 1);
        expect(store.get(sid(store, 5))!.boundaryMm.every((p) => p.x === -300)).toBe(true);
        expect(find(dimsOf(store, 2), 'before').valueMm).toBe(1500);
    });

    it('resizes from the unpinned jamb, on a wall drawn in −X too', () => {
        const store = withWindow(4, 1200);
        // The north wall runs from x = 7200 to x = 0, so its near jamb is the east one at x = 2100.
        const width = find(dimsOf(store, 4), 'width');
        expect(width.fromMm.x).toBe(2100);
        apply(store, width, 1200, 0);
        const hole = store.get(sid(store, 4))!.openings[0]!;
        expect(hole.widthMm).toBe(1200);
        expect(hole.uMm + hole.widthMm).toBe(2100);
    });

    it('raises the sill keeping the height, and grows the height keeping the sill', () => {
        const store = withWindow(2, 1200);
        apply(store, find(dimsOf(store, 2), 'sill'), 1000, 0);
        let hole = store.get(sid(store, 2))!.openings[0]!;
        expect([hole.vMm, hole.heightMm]).toEqual([1000, 1200]);
        apply(store, find(dimsOf(store, 2), 'height'), 1300, 0);
        hole = store.get(sid(store, 2))!.openings[0]!;
        expect([hole.vMm, hole.heightMm]).toEqual([1000, 1300]);
    });

    it('never moves the base a sill is measured from', () => {
        const store = withWindow(2, 1200);
        const sill = find(dimsOf(store, 2), 'sill');
        expect(dimensionEdit(store.surfaces(), sill, 1000, 1, 0).kind).toBe('refused');
    });
});

describe('a gable house with a covered porch under the same roof', () => {
    // The main box runs y 0…9600; the roof, its gable and the porch ceiling run on to y = −3000,
    // over two columns. Drawn in the app, as a user would: the ceiling is split at the ridge line,
    // so the porch gable's base has three corners on one line.
    function porchHouse(): SurfaceStore {
        const faces: Point3Mm[][] = [
            [P(0, 0, 0), P(7200, 0, 0), P(7200, 9600, 0), P(0, 9600, 0)],
            [P(3600, 0, 5221), P(7200, 0, 2200), P(7200, 9600, 2200), P(3600, 9600, 5221)],
            [P(3600, 9600, 5221), P(0, 9600, 2200), P(0, 0, 2200), P(3600, 0, 5221)],
            [P(0, 0, 2200), P(0, 0, 0), P(7200, 0, 0), P(7200, 0, 2200), P(3600, 0, 2200)],
            [P(7200, 0, 2200), P(3600, 0, 5221), P(0, 0, 2200), P(3600, 0, 2200)],
            [P(7200, 0, 0), P(7200, 9600, 0), P(7200, 9600, 2200), P(7200, 0, 2200)],
            [
                P(7200, 9600, 0),
                P(0, 9600, 0),
                P(0, 9600, 2200),
                P(3600, 9600, 5221),
                P(7200, 9600, 2200),
            ],
            [P(0, 9600, 0), P(0, 0, 0), P(0, 0, 2200), P(0, 9600, 2200)],
            [P(3600, 0, 2200), P(0, 0, 2200), P(0, -3000, 2200), P(3600, -3000, 2200)],
            [P(3600, -3000, 2200), P(7200, -3000, 2200), P(7200, 0, 2200), P(3600, 0, 2200)],
            [P(7200, -3000, 2200), P(3600, -3000, 5221), P(0, -3000, 2200), P(3600, -3000, 2200)],
            [P(7200, 0, 2200), P(3600, 0, 5221), P(3600, -3000, 5221), P(7200, -3000, 2200)],
            [P(3600, 0, 5221), P(0, 0, 2200), P(0, -3000, 2200), P(3600, -3000, 5221)],
        ];
        const store = new SurfaceStore();
        store.load(
            faces.map((boundaryMm, i) => ({
                id: `f${i + 1}`,
                boundaryMm,
                openings: [],
                holes: [],
                kindOverride: null,
                loadBearing: true,
                spanDirectionOverride: null,
                roofGroupId: null,
                studSectionOverride: null,
            })),
            [
                { id: 'c1', aMm: P(0, -3000, 2200), bMm: P(0, -3000, 0), role: 'column' },
                { id: 'c2', aMm: P(7200, -3000, 2200), bMm: P(7200, -3000, 0), role: 'column' },
            ]
        );
        return store;
    }
    const face = (store: SurfaceStore, id: string) => store.get(id)!.boundaryMm;

    it('widens the house with the porch roof and its column coming along', () => {
        for (const pinned of [0, 1] as const) {
            const store = porchHouse();
            const width = find(wallDimensions(store.surfaces(), storey(store), 'f4'), 'length');
            expect(width.valueMm).toBe(7200);
            apply(store, width, 7800, pinned);
            const x = pinned === 0 ? 7800 : -600;
            const porchRoof = pinned === 0 ? 'f12' : 'f13';
            expect(face(store, porchRoof).filter((p) => p.x === x)).toHaveLength(2);
            const column = store.guides().find((g) => g.id === (pinned === 0 ? 'c2' : 'c1'))!;
            expect([column.aMm.x, column.bMm.x]).toEqual([x, x]);
        }
    });

    it('makes the porch shallower from its gable', () => {
        const store = porchHouse();
        const dims = wallDimensions(store.surfaces(), storey(store), 'f11');
        const depth = dims.find((d) => d.id.startsWith('parallel') && d.valueMm === 3000)!;
        expect(depth).toBeDefined();
        apply(store, depth, 2400, depth.defaultPinned);
        expect(face(store, 'f11').every((p) => p.y === -2400)).toBe(true);
        expect(face(store, 'f12')).toContainEqual(P(3600, -2400, 5221));
        expect(store.guides().every((g) => g.aMm.y === -2400 && g.bMm.y === -2400)).toBe(true);
    });
});

describe('an opening flush against the wall end', () => {
    it('can still be moved away from it', () => {
        const store = house();
        const wall = sid(store, 2);
        const ring = [P(0, 0, 900), P(900, 0, 900), P(900, 0, 2100), P(0, 0, 2100)];
        expect(store.addOpening(wall, ring, 'window').ok).toBe(true);
        const hole = store.get(wall)!.openings[0]!;
        const before = find(
            openingDimensions(store.surfaces(), storey(store), wall, hole.id),
            'before'
        );
        expect(before.valueMm).toBe(0);
        apply(store, before, 600, 0);
        expect(store.get(wall)!.openings[0]!.uMm).toBe(600);
    });
});

describe('ceiling height', () => {
    it("is shown on a wall and lifts everything from the wall's top up", () => {
        const store = house();
        const ceiling = find(
            wallDimensions(store.surfaces(), storey(store), sid(store, 2)),
            'ceiling'
        );
        expect(ceiling.valueMm).toBe(2400);
        expect(ceiling.ends[0].kind).toBe('fixed');
        apply(store, ceiling, 2700, 0);
        const zs = store.surfaces().flatMap((s) => s.boundaryMm.map((p) => p.z));
        expect(new Set(zs)).toEqual(new Set([0, 2700]));
    });

    it('is found for the storey as a whole, for a selected roof', () => {
        const store = house();
        const dims = storeyCeilingDimensions(store.surfaces(), storey(store));
        expect(dims.map((d) => d.valueMm)).toEqual([2400]);
    });
});
