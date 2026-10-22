import { describe, expect, it } from 'vitest';
import { signedArea2, type Vec2Mm } from '../surfacekit/core';
import { storeyPlate } from './storey-plate';

const box = (x0: number, y0: number, x1: number, y1: number): Vec2Mm[] => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
];
const m2 = (ring: readonly Vec2Mm[]) => Math.round(signedArea2(ring) / 1e6);
const corners = (ring: readonly Vec2Mm[]) => new Set(ring.map((p) => `${p.x},${p.y}`));

describe('storeyPlate', () => {
    it('closes the plate over the walls between rooms, round the rooms', () => {
        // Two rooms with a 300 mm wall between them.
        const plate = storeyPlate([box(0, 0, 4000, 5000), box(4300, 0, 9000, 5000)], [])!;
        expect(plate.regions).toHaveLength(1);
        expect(corners(plate.regions[0]!.ring)).toEqual(
            new Set(['0,0', '9000,0', '9000,5000', '0,5000'])
        );
        expect(plate.regions[0]!.holes).toEqual([]);
    });

    it('keeps blocks apart that stand further apart than a wall', () => {
        const plate = storeyPlate([box(0, 0, 6000, 6000), box(12000, 0, 16000, 4000)], [])!;
        expect(plate.regions.map((r) => m2(r.ring))).toEqual([36, 16]);
    });

    it('fills a shaft between rooms, and leaves a courtyard open', () => {
        // Four rooms round a 6 × 6 m courtyard; four round a 2 × 2 m shaft.
        const ring = (x: number, inner: number) => [
            box(x, 0, x + 4000 + inner, 4000),
            box(x + 4000 + inner, 0, x + 8000 + inner, 4000 + inner),
            box(x + 4000, 4000 + inner, x + 8000 + inner, 8000 + inner),
            box(x, 4000, x + 4000, 8000 + inner),
        ];
        const plate = storeyPlate([...ring(0, 6000), ...ring(30000, 2000)], [])!;
        expect(plate.regions).toHaveLength(2);
        expect(plate.regions[0]!.holes.map(m2)).toEqual([36]);
        expect(plate.regions[1]!.holes).toEqual([]);
        expect(plate.filled.map((a) => Math.round(a / 1e6))).toEqual([4]);
    });

    it('trims a slab drawn as a box round the site to the rooms on it', () => {
        const plate = storeyPlate([box(0, 0, 6000, 6000)], [box(-20000, -20000, 50000, 50000)])!;
        expect(plate.regions.map((r) => m2(r.ring))).toEqual([36]);
    });

    it('stands on the rooms and walls where there are rooms, on the slabs where there are none', () => {
        const rooms = storeyPlate([box(0, 0, 6000, 6000)], [box(0, 0, 6000, 3000)])!;
        expect(rooms.regions.map((r) => m2(r.ring))).toEqual([36]);
        // A wall along the rooms' edge is in the plate, to its outer face.
        const walled = storeyPlate([box(0, 0, 6000, 6000)], [], [box(0, -300, 6000, 0)])!;
        expect(corners(walled.regions[0]!.ring)).toEqual(
            new Set(['0,-300', '6000,-300', '6000,6000', '0,6000'])
        );
        // A garden wall standing out of it is not.
        const garden = storeyPlate([box(0, 0, 6000, 6000)], [], [box(6000, 3000, 12000, 3200)])!;
        expect(garden.regions.map((r) => m2(r.ring))).toEqual([36]);
        const slabs = storeyPlate([], [box(0, 0, 6000, 6000), box(6000, 0, 9000, 6000)])!;
        expect(slabs.regions.map((r) => m2(r.ring))).toEqual([54]);
    });

    it('straightens a slanting edge and a short jog', () => {
        const slanting = storeyPlate(
            [
                [
                    { x: 0, y: 0 },
                    { x: 10000, y: 0 },
                    { x: 10000, y: 4000 },
                    { x: 0, y: 6000 },
                ],
            ],
            []
        )!;
        expect(slanting.regions[0]!.ring).toHaveLength(4);
        // Two rooms whose far walls are 150 mm out of line: one edge.
        const jog = storeyPlate([box(0, 0, 10000, 4000), box(10000, 0, 14000, 4150)], [])!;
        expect(jog.regions[0]!.ring).toHaveLength(4);
    });
});
