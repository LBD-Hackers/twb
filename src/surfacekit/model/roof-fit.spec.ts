import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import { classifyAll } from './classify';
import { fitWallsToRoof, nextRoofGroupId, roofGroupOf, roofProfile } from './roof-fit';

const p = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });

/** A vertical rectangle from `a` to `b` in plan, `z0` to `z1` high. */
const wall = (ax: number, ay: number, bx: number, by: number, z1 = 2400, z0 = 0): Point3Mm[] => [
    p(ax, ay, z0),
    p(bx, by, z0),
    p(bx, by, z1),
    p(ax, ay, z1),
];

/**
 * The plan from issue #41: a notched outline, 17.2 × 7.2 m, and two interior walls whose tops lie
 * on the roof's eave plane — `s2` right under the ridge.
 */
function issueHouse(): { store: SurfaceStore; ids: Record<string, string> } {
    const store = new SurfaceStore();
    const ids: Record<string, string> = {};
    const add = (name: string, ring: Point3Mm[]): void => {
        const r = store.add(ring);
        if (!r.surface) throw new Error(`${name}: ${r.violations[0]?.message}`);
        ids[name] = r.surface.id;
    };
    add('floor', [
        p(0, 0, 0),
        p(4800, 0, 0),
        p(4800, 2000, 0),
        p(8800, 2000, 0),
        p(8800, 0, 0),
        p(17200, 0, 0),
        p(17200, 7200, 0),
        p(0, 7200, 0),
    ]);
    add('wall-1', wall(0, 0, 4800, 0));
    add('wall-5', wall(8800, 0, 17200, 0));
    add('wall-6', wall(17200, 0, 17200, 7200));
    add('wall-7', wall(17200, 7200, 0, 7200));
    add('wall-8', wall(0, 7200, 0, 0));
    add('s2', wall(13600, 3600, 17200, 3600));
    add('s10', wall(13600, 0, 13600, 7200));
    return { store, ids };
}

/** A gable roof over the whole house, ridge along x at y = 3600, `ridgeZ` high. */
function addGable(store: SurfaceStore, ridgeZ = 4500): Set<string> {
    const south = store.add([
        p(0, 0, 2400),
        p(17200, 0, 2400),
        p(17200, 3600, ridgeZ),
        p(0, 3600, ridgeZ),
    ]);
    const north = store.add([
        p(17200, 7200, 2400),
        p(0, 7200, 2400),
        p(0, 3600, ridgeZ),
        p(17200, 3600, ridgeZ),
    ]);
    return new Set([south.surface!.id, north.surface!.id]);
}

describe('roofProfile', () => {
    it('puts a corner exactly where the wall crosses the ridge', () => {
        const { store } = issueHouse();
        const roofIds = addGable(store);
        const roof = store.surfaces().filter((s) => roofIds.has(s.id));
        expect(roofProfile(roof, { x: 0, y: 0 }, { x: 0, y: 7200 }, 0)).toEqual([
            p(0, 0, 2400),
            p(0, 3600, 4500),
            p(0, 7200, 2400),
        ]);
    });

    it('is null where the roof does not cover the whole wall', () => {
        const { store } = issueHouse();
        const roofIds = addGable(store);
        const roof = store.surfaces().filter((s) => roofIds.has(s.id));
        expect(roofProfile(roof, { x: 0, y: 0 }, { x: 0, y: 9600 }, 0)).toBeNull();
    });
});

describe('fitWallsToRoof', () => {
    it('grows the gables, leaves the eave walls, and the interior walls unless asked', () => {
        const { store, ids } = issueHouse();
        const roofIds = addGable(store);
        const fits = new Map(
            fitWallsToRoof(store.surfaces(), { roofIds, interior: false }).map((f) => [
                f.id,
                f.boundaryMm,
            ])
        );
        expect([...fits.keys()].sort()).toEqual([ids['wall-6']!, ids['wall-8']!].sort());
        expect(fits.get(ids['wall-8']!)).toContainEqual(p(0, 3600, 4500));
        expect(fits.get(ids['wall-8']!)).toHaveLength(5);
    });

    it('takes the interior walls up to the roof when asked', () => {
        const { store, ids } = issueHouse();
        const roofIds = addGable(store);
        const fits = new Map(
            fitWallsToRoof(store.surfaces(), { roofIds, interior: true }).map((f) => [
                f.id,
                f.boundaryMm,
            ])
        );
        // Under the ridge, the whole top goes to the ridge.
        expect(fits.get(ids['s2']!)).toEqual(wall(13600, 3600, 17200, 3600, 4500));
        // Across the ridge, the wall comes out a pentagon with its apex on the ridge.
        expect(fits.get(ids['s10']!)).toContainEqual(p(13600, 3600, 4500));
        expect(fits.get(ids['s10']!)).toHaveLength(5);
    });

    it('takes the outside walls round a recess the roof runs over up to it, when told which they are', () => {
        const { store } = issueHouse();
        const recess: Record<string, string> = {};
        for (const [name, ring] of [
            ['side-w', wall(4800, 0, 4800, 2000)],
            ['back', wall(4800, 2000, 8800, 2000)],
            ['side-e', wall(8800, 2000, 8800, 0)],
        ] as const) {
            recess[name] = store.add(ring).surface!.id;
        }
        const roofIds = addGable(store);
        const ids = new Set(Object.values(recess));
        const alone = fitWallsToRoof(store.surfaces(), { roofIds, interior: false }).map(
            (f) => f.id
        );
        expect(alone.filter((id) => ids.has(id))).toEqual([]);
        const fits = new Map(
            fitWallsToRoof(store.surfaces(), { roofIds, interior: false, exterior: ids }).map(
                (f) => [f.id, f.boundaryMm]
            )
        );
        // The back of the recess, under the south slope 2000 in from the eave.
        const z = Math.round(2400 + (2000 / 3600) * 2100);
        expect(fits.get(recess['back']!)).toEqual(wall(4800, 2000, 8800, 2000, z));
        expect(fits.get(recess['side-w']!)).toContainEqual(p(4800, 2000, z));
    });

    it('stops at the floor of the storey above, and at a wall standing on the top', () => {
        const { store, ids } = issueHouse();
        store.add([p(0, 0, 2400), p(17200, 0, 2400), p(17200, 7200, 2400), p(0, 7200, 2400)]);
        store.add(wall(0, 7200, 0, 0, 5000, 2400));
        const roofIds = addGable(store, 7000);
        const fitted = fitWallsToRoof(store.surfaces(), { roofIds, interior: true }).map(
            (f) => f.id
        );
        expect(fitted).not.toContain(ids['s10']);
        expect(fitted).not.toContain(ids['s2']);
        expect(fitted).not.toContain(ids['wall-8']);
    });

    it('brings walls that followed the old roof down with an edited one', () => {
        const { store, ids } = issueHouse();
        const roofIds = addGable(store);
        for (const f of fitWallsToRoof(store.surfaces(), { roofIds, interior: true })) {
            expect(store.applyFaceChanges({ removeIds: [], reshape: [f], add: [] }).ok).toBe(true);
        }
        const oldRoof = store.surfaces().filter((s) => roofIds.has(s.id));
        // The ridge comes down 900 — as Move would, on the roof alone.
        store.locked.set(
            new Set(
                store
                    .surfaces()
                    .filter((s) => !roofIds.has(s.id))
                    .map((s) => s.id)
            )
        );
        store.moveVertices([p(0, 3600, 4500), p(17200, 3600, 4500)], p(0, 0, -900));
        store.locked.set(null);
        const fits = new Map(
            fitWallsToRoof(store.surfaces(), { roofIds, oldRoof, interior: false }).map((f) => [
                f.id,
                f.boundaryMm,
            ])
        );
        expect(fits.get(ids['s2']!)).toEqual(wall(13600, 3600, 17200, 3600, 3600));
        expect(fits.get(ids['wall-8']!)).toContainEqual(p(0, 3600, 3600));
    });
});

describe('roofGroupOf', () => {
    it('finds the planes of a roof drawn without a group across their shared ridge', () => {
        const { store } = issueHouse();
        const roofIds = addGable(store);
        const kinds = classifyAll(store.surfaces());
        const [first] = [...roofIds];
        expect(new Set(roofGroupOf(store.surfaces(), kinds, first!))).toEqual(roofIds);
        expect(nextRoofGroupId(store.surfaces())).toBe('roof-1');
    });
});

describe('SurfaceStore.locked', () => {
    it('keeps a ridge drawn over the house from welding into the walls or lifting them', () => {
        const { store, ids } = issueHouse();
        const before = store.surfaces();
        store.locked.set(new Set(before.map((s) => s.id)));
        const top = store.add([
            p(0, 0, 2400),
            p(17200, 0, 2400),
            p(17200, 7200, 2400),
            p(0, 7200, 2400),
        ]);
        expect(top.surface).not.toBeNull();
        expect(store.split(top.surface!.id, [p(0, 3600, 2400), p(17200, 3600, 2400)]).ok).toBe(
            true
        );
        expect(store.get(ids['wall-8']!)!.boundaryMm).toHaveLength(4);
        expect(store.moveVertices([p(0, 3600, 2400), p(17200, 3600, 2400)], p(0, 0, 2100)).ok).toBe(
            true
        );
        expect(store.get(ids['s2']!)).toBe(before.find((s) => s.id === ids['s2']));
        expect(store.get(ids['wall-6']!)).toBe(before.find((s) => s.id === ids['wall-6']));
    });

    it('refuses to split, delete or cut into a locked face', () => {
        const { store, ids } = issueHouse();
        store.locked.set(new Set([ids['wall-1']!]));
        expect(store.split(ids['wall-1']!, [p(2400, 0, 0), p(2400, 0, 2400)]).ok).toBe(false);
        expect(store.removeFace(ids['wall-1']!)).toBe(false);
        expect(
            store.addOpening(
                ids['wall-1']!,
                [p(1200, 0, 900), p(2400, 0, 900), p(2400, 0, 2100), p(1200, 0, 2100)],
                'window'
            ).ok
        ).toBe(false);
        expect(store.get(ids['wall-1']!)).toBeDefined();
    });
});
