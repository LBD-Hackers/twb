import { describe, expect, it } from 'vitest';
import { SurfaceStore } from './surface-store';
import type { Point3Mm } from '../core';
import {
    floorFootprintsInStorey,
    roofFootprints,
    wallFootprint,
    wallFootprintsInStorey,
    pointInDoorSwing,
    wallOpeningsInStorey,
} from './plan-geometry';
import type { Storey } from './storey';
import { classifyAll } from './classify';

const FLOOR: Point3Mm[] = [
    { x: 0, y: 0, z: 0 },
    { x: 7200, y: 0, z: 0 },
    { x: 7200, y: 9600, z: 0 },
    { x: 0, y: 9600, z: 0 },
];

const GROUND: Storey = { id: 'st1', name: 'Ground floor', elevationMm: 0, heightMm: 2400 };
const FIRST: Storey = { id: 'st2', name: '1st floor', elevationMm: 2400, heightMm: 2400 };

function box(): SurfaceStore {
    const store = new SurfaceStore();
    const base = store.add(FLOOR).surface!;
    store.extrude(base.id, 2400);
    return store;
}

describe('wallFootprint', () => {
    it('is the two lowest corners of a vertical wall', () => {
        const store = box();
        const kinds = classifyAll(store.surfaces());
        const wall = store.surfaces().find((s) => kinds.get(s.id) === 'wall')!;
        const fp = wallFootprint(wall)!;
        expect(fp.aMm.x === fp.bMm.x || fp.aMm.y === fp.bMm.y).toBe(true);
        expect(
            [fp.aMm, fp.bMm].every((p) => wall.boundaryMm.some((q) => q.x === p.x && q.y === p.y))
        ).toBe(true);
    });

    it('is null for a shape with more than two lowest corners (a flat roof)', () => {
        const store = new SurfaceStore();
        const flat = store.add(FLOOR).surface!;
        expect(wallFootprint(flat)).toBeNull();
    });
});

describe('wallFootprintsInStorey', () => {
    it('finds the four walls of a single-storey box, and none for a storey above it', () => {
        const store = box();
        expect(wallFootprintsInStorey(store.surfaces(), GROUND)).toHaveLength(4);
        expect(wallFootprintsInStorey(store.surfaces(), FIRST)).toHaveLength(0);
    });
});

describe('floorFootprintsInStorey', () => {
    it('finds the floor at the storey’s own elevation only', () => {
        const store = box();
        expect(floorFootprintsInStorey(store.surfaces(), GROUND)).toHaveLength(1);
        expect(floorFootprintsInStorey(store.surfaces(), FIRST)).toHaveLength(0);
    });
});

describe('roofFootprints', () => {
    it('projects the roof plane’s boundary to plan', () => {
        const store = box();
        const roofs = roofFootprints(store.surfaces());
        expect(roofs).toHaveLength(1);
        expect(roofs[0]!.ringMm).toEqual(FLOOR.map((p) => ({ x: p.x, y: p.y })));
    });
});

describe('wallOpeningsInStorey', () => {
    function doorInSouthWall(): { store: SurfaceStore; wallId: string; openingId: string } {
        const store = box();
        const wall = store
            .surfaces()
            .find(
                (s) => s.boundaryMm.every((p) => p.y === 0) && s.boundaryMm.some((p) => p.z > 0)
            )!;
        const result = store.addOpening(
            wall.id,
            [
                { x: 1000, y: 0, z: 0 },
                { x: 1900, y: 0, z: 0 },
                { x: 1900, y: 0, z: 2100 },
                { x: 1000, y: 0, z: 2100 },
            ],
            'door'
        );
        expect(result.ok).toBe(true);
        return { store, wallId: wall.id, openingId: store.get(wall.id)!.openings[0]!.id };
    }

    it('gives a door a swing hinged on its near jamb, opening square to the wall', () => {
        const { store } = doorInSouthWall();
        const [door] = wallOpeningsInStorey(store.surfaces(), GROUND);
        expect(door!.isDoor).toBe(true);
        expect(door!.swings[0]!.hingeMm).toEqual({ x: 1000, y: 0 });
        expect(door!.swings[0]!.latchMm).toEqual({ x: 1900, y: 0 });
        expect(Math.abs(door!.swings[0]!.openDir.x)).toBeCloseTo(0);
        expect(Math.abs(door!.swings[0]!.openDir.y)).toBeCloseTo(1);
    });

    it("hangs a halvanden door's side leaf on the other jamb, a third of the width", () => {
        const { store, wallId, openingId } = doorInSouthWall();
        store.resizeOpening(wallId, openingId, { leaves: 'one-and-a-half' });
        const [wide, side] = wallOpeningsInStorey(store.surfaces(), GROUND)[0]!.swings;
        expect(wide!.hingeMm).toEqual({ x: 1000, y: 0 });
        expect(wide!.latchMm).toEqual({ x: 1600, y: 0 });
        expect(side!.hingeMm).toEqual({ x: 1900, y: 0 });
        expect(side!.latchMm).toEqual({ x: 1600, y: 0 });
    });

    it("meets a double door's two leaves in the middle", () => {
        const { store, wallId, openingId } = doorInSouthWall();
        store.resizeOpening(wallId, openingId, { leaves: 'double' });
        const swings = wallOpeningsInStorey(store.surfaces(), GROUND)[0]!.swings;
        expect(swings.map((w) => w.latchMm)).toEqual([
            { x: 1450, y: 0 },
            { x: 1450, y: 0 },
        ]);
    });

    it('picks a door by its swing, not only by its hole', () => {
        const { store } = doorInSouthWall();
        const swing = wallOpeningsInStorey(store.surfaces(), GROUND)[0]!.swings[0]!;
        const inward = (d: number) => ({ x: 1000 + 300, y: swing.openDir.y * d });
        expect(pointInDoorSwing(swing, inward(500), 10)).toBe(true);
        // Past the arc, and behind the wall, it is not the door.
        expect(pointInDoorSwing(swing, { x: 1000, y: swing.openDir.y * 1000 }, 10)).toBe(false);
        expect(pointInDoorSwing(swing, inward(-300), 10)).toBe(false);
    });

    it('mirrors the swing along the wall and across it', () => {
        const { store, wallId, openingId } = doorInSouthWall();
        const before = wallOpeningsInStorey(store.surfaces(), GROUND)[0]!.swings[0]!;
        store.resizeOpening(wallId, openingId, { hingeAtEnd: true, swingsBack: true });
        const after = wallOpeningsInStorey(store.surfaces(), GROUND)[0]!.swings[0]!;
        expect(after.hingeMm).toEqual(before.latchMm);
        expect(after.latchMm).toEqual(before.hingeMm);
        expect(after.openDir.y).toBeCloseTo(-before.openDir.y);
    });
});
