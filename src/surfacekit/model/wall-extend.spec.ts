import { describe, expect, it } from 'vitest';
import { polygonArea3, type Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import { classifyAll } from './classify';
import type { Surface } from './surface';

const P = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });

/** A 7200 × 9600 box, 2400 high, with a flat roof — the ground floor, walls and lid. */
function flatBox(store: SurfaceStore): void {
    const rings: Point3Mm[][] = [
        [P(0, 0, 0), P(7200, 0, 0), P(7200, 9600, 0), P(0, 9600, 0)],
        [P(0, 0, 0), P(7200, 0, 0), P(7200, 0, 2400), P(0, 0, 2400)],
        [P(7200, 0, 0), P(7200, 9600, 0), P(7200, 9600, 2400), P(7200, 0, 2400)],
        [P(7200, 9600, 0), P(0, 9600, 0), P(0, 9600, 2400), P(7200, 9600, 2400)],
        [P(0, 9600, 0), P(0, 0, 0), P(0, 0, 2400), P(0, 9600, 2400)],
        [P(0, 0, 2400), P(7200, 0, 2400), P(7200, 9600, 2400), P(0, 9600, 2400)],
    ];
    for (const ring of rings) expect(store.add(ring).surface).not.toBeNull();
}

/** The same box under a gable roof: ridge along Y at x = 3600, gables at y = 0 and y = 9600. */
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

function planArea(s: Surface): number {
    return polygonArea3(s.boundaryMm.map((p) => ({ ...p, z: 0 })));
}

/** Walls whose every corner is on the line y = `y`, as [xMin, xMax] runs. */
function wallRunsAtY(surfaces: readonly Surface[], y: number): number[][] {
    const kinds = classifyAll(surfaces);
    return surfaces
        .filter((s) => kinds.get(s.id) === 'wall' && s.boundaryMm.every((p) => p.y === y))
        .map((s) => {
            const xs = s.boundaryMm.map((p) => p.x);
            return [Math.min(...xs), Math.max(...xs)];
        })
        .sort((a, b) => a[0]! - b[0]!);
}

describe('SurfaceStore.extendWall — flat roof', () => {
    it('pulls the east half of the south wall out into an open L', () => {
        const store = new SurfaceStore();
        flatBox(store);
        const result = store.extendWall({
            fromMm: { x: 3600, y: 0 },
            toMm: { x: 7200, y: 0 },
            baseZMm: 0,
            offsetMm: { x: 0, y: -2400 },
        });
        expect(result.ok).toBe(true);
        const surfaces = store.surfaces();
        const kinds = classifyAll(surfaces);

        // The floor and the roof are both L-shaped now: the box plus the 3600 × 2400 wing.
        const floor = surfaces.find((s) => kinds.get(s.id) === 'floor')!;
        const roof = surfaces.find((s) => kinds.get(s.id) === 'roof')!;
        expect(floor.boundaryMm).toHaveLength(6);
        expect(planArea(floor)).toBe(7200 * 9600 + 3600 * 2400);
        expect(planArea(roof)).toBe(7200 * 9600 + 3600 * 2400);

        // Open connection: what is left on y = 0 is the west half; the east half stands at -2400.
        expect(wallRunsAtY(surfaces, 0)).toEqual([[0, 3600]]);
        expect(wallRunsAtY(surfaces, -2400)).toEqual([[3600, 7200]]);

        // A return wall closes the step at x = 3600, and the east wall has grown to meet the wing.
        const walls = surfaces.filter((s) => kinds.get(s.id) === 'wall');
        const returnWall = walls.find((s) => s.boundaryMm.every((p) => p.x === 3600));
        expect(returnWall).toBeDefined();
        const east = walls.find((s) => s.boundaryMm.every((p) => p.x === 7200))!;
        expect(Math.min(...east.boundaryMm.map((p) => p.y))).toBe(-2400);
        expect(east.boundaryMm).toHaveLength(4);
        expect(walls).toHaveLength(6);
    });

    it('pushes a corner in, too — the other way to make an L', () => {
        const store = new SurfaceStore();
        flatBox(store);
        const result = store.extendWall({
            fromMm: { x: 3600, y: 0 },
            toMm: { x: 7200, y: 0 },
            baseZMm: 0,
            offsetMm: { x: 0, y: 2400 },
        });
        expect(result.ok).toBe(true);
        const surfaces = store.surfaces();
        const kinds = classifyAll(surfaces);
        const floor = surfaces.find((s) => kinds.get(s.id) === 'floor')!;
        expect(planArea(floor)).toBe(7200 * 9600 - 3600 * 2400);
        const east = surfaces.find(
            (s) => kinds.get(s.id) === 'wall' && s.boundaryMm.every((p) => p.x === 7200)
        )!;
        expect(Math.min(...east.boundaryMm.map((p) => p.y))).toBe(2400);
    });

    it('carries a door on the pulled part with it, and refuses a node through one', () => {
        const store = new SurfaceStore();
        flatBox(store);
        const south = store.surfaces()[1]!;
        // A 900 door at x 5000–5900, on the part being pulled.
        expect(
            store.addOpening(
                south.id,
                [P(5000, 0, 0), P(5900, 0, 0), P(5900, 0, 2100), P(5000, 0, 2100)],
                'door'
            ).ok
        ).toBe(true);

        const through = store.extendWall({
            fromMm: { x: 5400, y: 0 },
            toMm: { x: 7200, y: 0 },
            baseZMm: 0,
            offsetMm: { x: 0, y: -1200 },
        });
        expect(through.ok).toBe(false);

        const clear = store.extendWall({
            fromMm: { x: 3600, y: 0 },
            toMm: { x: 7200, y: 0 },
            baseZMm: 0,
            offsetMm: { x: 0, y: -1200 },
        });
        expect(clear.ok).toBe(true);
        const kinds = classifyAll(store.surfaces());
        const pulled = store
            .surfaces()
            .find((s) => kinds.get(s.id) === 'wall' && s.boundaryMm.every((p) => p.y === -1200))!;
        expect(pulled.openings).toHaveLength(1);
        // Still at x 5000: re-measured from the pulled piece's own end at x = 3600.
        expect(pulled.openings[0]!.uMm).toBe(1400);
    });
});

describe('SurfaceStore.extendWall — gable roof', () => {
    it('pulls part of a gable end out, and the roof plane on that side runs out with it', () => {
        const store = new SurfaceStore();
        gableBox(store);
        const result = store.extendWall({
            fromMm: { x: 3600, y: 0 },
            toMm: { x: 7200, y: 0 },
            baseZMm: 0,
            offsetMm: { x: 0, y: -2400 },
        });
        expect(result.ok).toBe(true);
        const surfaces = store.surfaces();
        const kinds = classifyAll(surfaces);
        const roofs = surfaces.filter((s) => kinds.get(s.id) === 'roof');
        expect(roofs).toHaveLength(2);
        const east = roofs.find((s) => s.boundaryMm.some((p) => p.x === 7200))!;
        expect(Math.min(...east.boundaryMm.map((p) => p.y))).toBe(-2400);
        // The return wall under the ridge reaches the ridge.
        const returnWall = surfaces.find(
            (s) =>
                kinds.get(s.id) === 'wall' &&
                s.boundaryMm.every((p) => p.x === 3600) &&
                s.boundaryMm.some((p) => p.y === -2400)
        )!;
        expect(Math.max(...returnWall.boundaryMm.map((p) => p.z))).toBe(4200);
    });

    it('pulls part of an eave wall out under a flat strip at eave height', () => {
        const store = new SurfaceStore();
        gableBox(store);
        const result = store.extendWall({
            fromMm: { x: 7200, y: 4800 },
            toMm: { x: 7200, y: 9600 },
            baseZMm: 0,
            offsetMm: { x: 3600, y: 0 },
        });
        expect(result.ok).toBe(true);
        const surfaces = store.surfaces();
        const kinds = classifyAll(surfaces);
        const flat = surfaces.filter(
            (s) => kinds.get(s.id) === 'roof' && s.boundaryMm.every((p) => p.z === 2400)
        );
        expect(flat).toHaveLength(1);
        expect(planArea(flat[0]!)).toBe(4800 * 3600);
        // The north gable grew a low step at its east end rather than folding.
        const gable = surfaces.find(
            (s) => kinds.get(s.id) === 'wall' && s.boundaryMm.every((p) => p.y === 9600)
        )!;
        expect(Math.max(...gable.boundaryMm.map((p) => p.x))).toBe(10800);
        expect(Math.max(...gable.boundaryMm.map((p) => p.z))).toBe(4200);
    });
});

describe('SurfaceStore.extendWall — a bare floor', () => {
    it('pulls a floor edge when there are no walls yet', () => {
        const store = new SurfaceStore();
        store.add([P(0, 0, 0), P(7200, 0, 0), P(7200, 9600, 0), P(0, 9600, 0)]);
        const result = store.extendWall({
            fromMm: { x: 0, y: 9600 },
            toMm: { x: 3600, y: 9600 },
            baseZMm: 0,
            offsetMm: { x: 0, y: 3600 },
        });
        expect(result.ok).toBe(true);
        expect(store.surfaces()).toHaveLength(1);
        expect(planArea(store.surfaces()[0]!)).toBe(7200 * 9600 + 3600 * 3600);
    });

    it('does nothing where there is nothing to pull', () => {
        const store = new SurfaceStore();
        store.add([P(0, 0, 0), P(7200, 0, 0), P(7200, 9600, 0), P(0, 9600, 0)]);
        const before = store.surfaces();
        const result = store.extendWall({
            fromMm: { x: 0, y: 20000 },
            toMm: { x: 3600, y: 20000 },
            baseZMm: 0,
            offsetMm: { x: 0, y: 1200 },
        });
        expect(result.ok).toBe(false);
        expect(store.surfaces()).toBe(before);
    });
});
