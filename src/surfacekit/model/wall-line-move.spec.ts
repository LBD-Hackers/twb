import { describe, expect, it } from 'vitest';
import { pitchDegOf, planeOfPolygon, polygonArea3, type Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import { classifyAll } from './classify';
import { surfaceFrame, openingRing3 } from './surface-frame';
import type { Surface } from './surface';

const P = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });

/** The id of the `n`th face added — ids come from a counter shared across stores. */
const sid = (store: SurfaceStore, n: number): string => store.surfaces()[n - 1]!.id;

/** A 7200 × 9600 box, 2400 high, with a flat roof — floor, south, east, north, west, roof. */
function flatBox(store: SurfaceStore, z0 = 0): void {
    const z1 = z0 + 2400;
    const rings: Point3Mm[][] = [
        [P(0, 0, z0), P(7200, 0, z0), P(7200, 9600, z0), P(0, 9600, z0)],
        [P(0, 0, z0), P(7200, 0, z0), P(7200, 0, z1), P(0, 0, z1)],
        [P(7200, 0, z0), P(7200, 9600, z0), P(7200, 9600, z1), P(7200, 0, z1)],
        [P(7200, 9600, z0), P(0, 9600, z0), P(0, 9600, z1), P(7200, 9600, z1)],
        [P(0, 9600, z0), P(0, 0, z0), P(0, 0, z1), P(0, 9600, z1)],
        [P(0, 0, z1), P(7200, 0, z1), P(7200, 9600, z1), P(0, 9600, z1)],
    ];
    for (const ring of rings) expect(store.add(ring).surface).not.toBeNull();
}

/** The box under a gable roof: ridge along Y at x = 3600, gables at y = 0 and y = 9600. */
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

const byKind = (surfaces: readonly Surface[], kind: string): Surface[] => {
    const kinds = classifyAll(surfaces);
    return surfaces.filter((s) => kinds.get(s.id) === kind);
};
const planArea = (s: Surface): number => polygonArea3(s.boundaryMm.map((p) => ({ ...p, z: 0 })));
const pitchOf = (s: Surface): number => pitchDegOf(planeOfPolygon(s.boundaryMm)!);
const xs = (s: Surface): number[] => s.boundaryMm.map((p) => p.x);

/** A 900 × 1200 window on the south wall (y = 0), `u` from its west end. */
function southWindow(store: SurfaceStore, x0: number): void {
    const ring = [P(x0, 0, 900), P(x0 + 900, 0, 900), P(x0 + 900, 0, 2100), P(x0, 0, 2100)];
    expect(store.addOpening(sid(store, 2), ring, 'window').ok).toBe(true);
}

function openingXs(store: SurfaceStore, id: string): number[] {
    const s = store.get(id)!;
    const frame = surfaceFrame(s.boundaryMm)!;
    return openingRing3(frame, s.openings[0]!).map((p) => p.x);
}

describe('moveWallLine', () => {
    it('lengthens a box: the end wall translates, floor and roof stretch', () => {
        const store = new SurfaceStore();
        flatBox(store);
        const result = store.moveWallLine({
            segment: { aMm: { x: 7200, y: 0 }, bMm: { x: 7200, y: 9600 } },
            shiftMm: { x: 1200, y: 0 },
            baseZMm: 0,
        });
        expect(result.ok).toBe(true);
        const surfaces = store.surfaces();
        expect(planArea(byKind(surfaces, 'floor')[0]!)).toBe(8400 * 9600);
        expect(planArea(byKind(surfaces, 'roof')[0]!)).toBe(8400 * 9600);
        expect(xs(store.get(sid(store, 3))!).every((x) => x === 8400)).toBe(true);
        expect(Math.max(...xs(store.get(sid(store, 2))!))).toBe(8400);
    });

    it('drags a gable ridge end along with the gable wall', () => {
        const store = new SurfaceStore();
        gableBox(store);
        const result = store.moveWallLine({
            segment: { aMm: { x: 0, y: 9600 }, bMm: { x: 7200, y: 9600 } },
            shiftMm: { x: 0, y: 1200 },
            baseZMm: 0,
        });
        expect(result.ok).toBe(true);
        for (const roof of byKind(store.surfaces(), 'roof')) {
            expect(roof.boundaryMm.some((p) => p.x === 3600 && p.y === 10800 && p.z === 4200)).toBe(
                true
            );
        }
    });

    it('keeps the roof pitch when an eave wall moves: the ridge follows', () => {
        const store = new SurfaceStore();
        gableBox(store);
        const result = store.moveWallLine({
            segment: { aMm: { x: 7200, y: 0 }, bMm: { x: 7200, y: 9600 } },
            shiftMm: { x: 1200, y: 0 },
            baseZMm: 0,
        });
        expect(result.ok).toBe(true);
        // 7200 → 8400 wide at 1800 over 3600 each side: ridge to the middle, up by 600 · 0.5.
        const roofs = byKind(store.surfaces(), 'roof');
        expect(roofs).toHaveLength(2);
        for (const roof of roofs) {
            const top = roof.boundaryMm.filter((p) => p.z > 2400);
            expect(top).toHaveLength(2);
            for (const p of top) expect([p.x, p.z]).toEqual([4200, 4500]);
        }
        for (const gable of store.surfaces().filter((s) => s.boundaryMm.length === 5)) {
            expect(gable.boundaryMm.some((p) => p.x === 4200 && p.z === 4500)).toBe(true);
        }
    });

    it("keeps an asymmetric roof's two pitches, and a porch roof's, when an eave wall moves", () => {
        // Ridge at x = 2400 (1800 over 2400 west, over 4800 east), the roof run on over a porch
        // to y = -3000 — the eave line there has no wall under it and has to come along too.
        const store = new SurfaceStore();
        const r = 4200;
        const rings: Point3Mm[][] = [
            [P(0, 0, 0), P(7200, 0, 0), P(7200, 9600, 0), P(0, 9600, 0)],
            [P(0, 0, 0), P(7200, 0, 0), P(7200, 0, 2400), P(2400, 0, r), P(0, 0, 2400)],
            [P(7200, 0, 0), P(7200, 9600, 0), P(7200, 9600, 2400), P(7200, 0, 2400)],
            [
                P(7200, 9600, 0),
                P(0, 9600, 0),
                P(0, 9600, 2400),
                P(2400, 9600, r),
                P(7200, 9600, 2400),
            ],
            [P(0, 9600, 0), P(0, 0, 0), P(0, 0, 2400), P(0, 9600, 2400)],
            [P(0, 0, 2400), P(2400, 0, r), P(2400, 9600, r), P(0, 9600, 2400)],
            [P(2400, 0, r), P(7200, 0, 2400), P(7200, 9600, 2400), P(2400, 9600, r)],
            [P(0, -3000, 2400), P(2400, -3000, r), P(2400, 0, r), P(0, 0, 2400)],
            [P(2400, -3000, r), P(7200, -3000, 2400), P(7200, 0, 2400), P(2400, 0, r)],
        ];
        for (const ring of rings) expect(store.add(ring).surface).not.toBeNull();
        const before = byKind(store.surfaces(), 'roof').map(pitchOf);

        const result = store.moveWallLine({
            segment: { aMm: { x: 7200, y: 0 }, bMm: { x: 7200, y: 9600 } },
            shiftMm: { x: 600, y: 0 },
            baseZMm: 0,
        });
        expect(result.ok).toBe(true);
        const roofs = byKind(store.surfaces(), 'roof');
        expect(roofs).toHaveLength(4);
        roofs.forEach((roof, i) => expect(pitchOf(roof)).toBeCloseTo(before[i]!, 1));
        // 600 · (3/8) / (3/8 + 3/4) = 200 east, 200 · 3/4 = 150 up — on the porch as well.
        for (const y of [-3000, 0, 9600]) {
            expect(
                roofs.some((s) =>
                    s.boundaryMm.some((p) => p.y === y && p.x === 2600 && p.z === 4350)
                )
            ).toBe(true);
        }
    });

    it('keeps a window in place on a wall stretched at its min-u end', () => {
        const store = new SurfaceStore();
        flatBox(store);
        southWindow(store, 1200);
        const result = store.moveWallLine({
            segment: { aMm: { x: 0, y: 0 }, bMm: { x: 0, y: 9600 } },
            shiftMm: { x: -1200, y: 0 },
            baseZMm: 0,
        });
        expect(result.ok).toBe(true);
        expect(store.get(sid(store, 2))!.openings[0]!.uMm).toBe(2400);
        expect(Math.min(...openingXs(store, sid(store, 2)))).toBe(1200);
    });

    it('moves a window with the wall that translates', () => {
        const store = new SurfaceStore();
        flatBox(store);
        southWindow(store, 1200);
        const result = store.moveWallLine({
            segment: { aMm: { x: 0, y: 0 }, bMm: { x: 7200, y: 0 } },
            shiftMm: { x: 0, y: -600 },
            baseZMm: 0,
        });
        expect(result.ok).toBe(true);
        expect(store.get(sid(store, 2))!.openings[0]!.uMm).toBe(1200);
        expect(store.get(sid(store, 2))!.boundaryMm.every((p) => p.y === -600)).toBe(true);
    });

    it('stretches an interior wall that ends mid-way on the moved wall', () => {
        const store = new SurfaceStore();
        flatBox(store);
        const t = store.add([
            P(0, 4800, 0),
            P(7200, 4800, 0),
            P(7200, 4800, 2400),
            P(0, 4800, 2400),
        ]);
        expect(t.surface).not.toBeNull();
        const result = store.moveWallLine({
            segment: { aMm: { x: 7200, y: 0 }, bMm: { x: 7200, y: 9600 } },
            shiftMm: { x: 1200, y: 0 },
            baseZMm: 0,
        });
        expect(result.ok).toBe(true);
        expect(Math.max(...xs(store.get(t.surface!.id)!))).toBe(8400);
    });

    it('leaves the storeys below the base alone', () => {
        const store = new SurfaceStore();
        flatBox(store);
        // An upper storey on the box's lid, the lid serving as its floor.
        const z0 = 2400;
        const z1 = 4800;
        for (const ring of [
            [P(0, 0, z0), P(7200, 0, z0), P(7200, 0, z1), P(0, 0, z1)],
            [P(7200, 0, z0), P(7200, 9600, z0), P(7200, 9600, z1), P(7200, 0, z1)],
            [P(7200, 9600, z0), P(0, 9600, z0), P(0, 9600, z1), P(7200, 9600, z1)],
            [P(0, 9600, z0), P(0, 0, z0), P(0, 0, z1), P(0, 9600, z1)],
            [P(0, 0, z1), P(7200, 0, z1), P(7200, 9600, z1), P(0, 9600, z1)],
        ]) {
            expect(store.add(ring).surface).not.toBeNull();
        }
        const before = store.get(sid(store, 3))!;
        const result = store.moveWallLine({
            segment: { aMm: { x: 7200, y: 0 }, bMm: { x: 7200, y: 9600 } },
            shiftMm: { x: 600, y: 0 },
            baseZMm: z0,
        });
        expect(result.ok).toBe(true);
        expect(store.get(sid(store, 3))).toBe(before);
        expect(xs(store.get(sid(store, 8))!).every((x) => x === 7800)).toBe(true);
    });

    it('refuses to shrink a wall out from under its window', () => {
        const store = new SurfaceStore();
        flatBox(store);
        southWindow(store, 6000);
        const result = store.moveWallLine({
            segment: { aMm: { x: 7200, y: 0 }, bMm: { x: 7200, y: 9600 } },
            shiftMm: { x: -1200, y: 0 },
            baseZMm: 0,
        });
        expect(result.ok).toBe(false);
        expect(Math.max(...xs(store.get(sid(store, 2))!))).toBe(7200);
    });
});
