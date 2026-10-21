import { describe, expect, it } from 'vitest';
import { polygonArea3, type Point3Mm } from '../core';
import type { Surface } from './surface';
import type { Storey } from './storey';
import { insetPolygon, zoneVolume } from './zone-volume';

const face = (id: string, boundaryMm: Point3Mm[]): Surface => ({
    id,
    boundaryMm,
    openings: [],
    holes: [],
    kindOverride: null,
    loadBearing: true,
    spanDirectionOverride: null,
    roofGroupId: null,
    studSectionOverride: null,
});

const p = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });

/** A wall standing on the plan segment a–b, from `z0` up to `z1`. */
const wall = (id: string, a: [number, number], b: [number, number], z0: number, z1: number) =>
    face(id, [p(a[0], a[1], z0), p(b[0], b[1], z0), p(b[0], b[1], z1), p(a[0], a[1], z1)]);

const GROUND: Storey = { id: 'st1', name: 'Ground floor', elevationMm: 0, heightMm: 2400 };

/** A 7200 × 4800 box, 2400 tall, split by a partition at x = 3600, with a flat top. */
function box(): Surface[] {
    return [
        face('floor', [p(0, 0, 0), p(7200, 0, 0), p(7200, 4800, 0), p(0, 4800, 0)]),
        wall('south', [0, 0], [7200, 0], 0, 2400),
        wall('east', [7200, 0], [7200, 4800], 0, 2400),
        wall('north', [7200, 4800], [0, 4800], 0, 2400),
        wall('west', [0, 4800], [0, 0], 0, 2400),
        wall('partition', [3600, 0], [3600, 4800], 0, 2400),
        face('top', [p(0, 0, 2400), p(7200, 0, 2400), p(7200, 4800, 2400), p(0, 4800, 2400)]),
    ];
}

/** Exterior walls 200 deep, the partition 100, floor and top 200. */
const depth = (id: string): number => (id === 'partition' ? 100 : 200);

const WEST_ROOM = [
    { x: 0, y: 0 },
    { x: 3600, y: 0 },
    { x: 3600, y: 4800 },
    { x: 0, y: 4800 },
];

describe('zoneVolume', () => {
    it('takes half of each wall off the area, and floor and ceiling off the height', () => {
        const v = zoneVolume(box(), GROUND, WEST_ROOM, depth);
        // Three exterior sides lose 100, the partition side 50: 3450 × 4600.
        expect(v.grossAreaM2).toBeCloseTo(17.28, 6);
        expect(v.netAreaM2).toBeCloseTo(3.45 * 4.6, 6);
        // Floor top at 100, flat top's underside at 2300.
        expect(v.floorTopMm).toBe(100);
        expect(v.minHeightMm).toBeCloseTo(2200, 6);
        expect(v.maxHeightMm).toBeCloseTo(2200, 6);
        expect(v.volumeM3).toBeCloseTo(3.45 * 4.6 * 2.2, 6);
        expect(v.ceiling).toBe('roof');
    });

    it('takes off what a wall has on the room’s side, where the caller knows each side', () => {
        // The partition (along +y) stands on one leaf: 20 on its back (west), 300 on its
        // positive side (east, to its right looking along +y).
        const side = (id: string, s: 1 | -1): number =>
            id === 'partition' ? (s === 1 ? 300 : 20) : depth(id) / 2;
        const west = zoneVolume(box(), GROUND, WEST_ROOM, depth, undefined, undefined, side);
        expect(west.netAreaM2).toBeCloseTo(3.48 * 4.6, 6);
        const eastRoom = WEST_ROOM.map((q) => ({ x: q.x + 3600, y: q.y }));
        const east = zoneVolume(box(), GROUND, eastRoom, depth, undefined, undefined, side);
        expect(east.netAreaM2).toBeCloseTo(3.2 * 4.6, 6);
    });

    it('leaves an edge that runs along no wall where it was drawn', () => {
        const surfaces = box().filter((s) => s.id !== 'partition');
        const v = zoneVolume(surfaces, GROUND, WEST_ROOM, depth);
        expect(v.netAreaM2).toBeCloseTo(3.5 * 4.6, 6);
    });

    it('follows a pitched roof down to the eaves rather than stopping at a flat box', () => {
        // A monopitch over the whole box, 2400 at the south eave rising to 4800 at the north.
        const surfaces = box().filter((s) => s.id !== 'top');
        surfaces.push(
            face('roof', [p(0, 0, 2400), p(7200, 0, 2400), p(7200, 4800, 4800), p(0, 4800, 4800)])
        );
        const v = zoneVolume(surfaces, GROUND, WEST_ROOM, () => 0);
        expect(v.ceiling).toBe('roof');
        expect(v.minHeightMm).toBeCloseTo(2400, 6);
        expect(v.maxHeightMm).toBeCloseTo(4800, 6);
        // Linear in y, so the mean is the height halfway across: 3600.
        expect(v.meanHeightMm).toBeCloseTo(3600, 6);
        expect(v.volumeM3).toBeCloseTo(3.6 * 4.8 * 3.6, 6);
    });

    it('finds the full height and the exact volume under an off-centre ridge', () => {
        // A gable along y with its ridge at x = 3601, 2400 at the eaves.
        const surfaces = box().filter((s) => s.id !== 'top' && s.id !== 'partition');
        surfaces.push(
            face('roof-w', [
                p(0, 0, 2400),
                p(3601, 0, 4800),
                p(3601, 4800, 4800),
                p(0, 4800, 2400),
            ]),
            face('roof-e', [
                p(3601, 0, 4800),
                p(7200, 0, 2400),
                p(7200, 4800, 2400),
                p(3601, 4800, 4800),
            ])
        );
        const whole = [
            { x: 0, y: 0 },
            { x: 7200, y: 0 },
            { x: 7200, y: 4800 },
            { x: 0, y: 4800 },
        ];
        const v = zoneVolume(surfaces, GROUND, whole, () => 0);
        expect(v.maxHeightMm).toBeCloseTo(4800, 6);
        expect(v.minHeightMm).toBeCloseTo(2400, 6);
        // Two triangular prisms' worth over a box: 7.2 × 4.8 × (2.4 + 2.4 / 2).
        expect(v.volumeM3).toBeCloseTo(7.2 * 4.8 * 3.6, 3);
    });

    it('stops flat under a ceiling of its own instead of rising to the ridge', () => {
        // A gable along y, ridge at x = 3600 at 4800, eaves at 2400; a ceiling at 3000.
        // Walls tall enough to reach the ceiling: it is held to the lowest wall top.
        const surfaces = box().filter(
            (s) =>
                s.id !== 'top' &&
                s.id !== 'partition' &&
                !['south', 'east', 'north', 'west'].includes(s.id)
        );
        surfaces.push(
            wall('south', [0, 0], [7200, 0], 0, 3200),
            wall('east', [7200, 0], [7200, 4800], 0, 3200),
            wall('north', [7200, 4800], [0, 4800], 0, 3200),
            wall('west', [0, 4800], [0, 0], 0, 3200)
        );
        surfaces.push(
            face('roof-w', [
                p(0, 0, 2400),
                p(3600, 0, 4800),
                p(3600, 4800, 4800),
                p(0, 4800, 2400),
            ]),
            face('roof-e', [
                p(3600, 0, 4800),
                p(7200, 0, 2400),
                p(7200, 4800, 2400),
                p(3600, 4800, 4800),
            ])
        );
        const whole = [
            { x: 0, y: 0 },
            { x: 7200, y: 0 },
            { x: 7200, y: 4800 },
            { x: 0, y: 4800 },
        ];
        const v = zoneVolume(surfaces, GROUND, whole, () => 0, 3000);
        expect(v.ceiling).toBe('ceiling');
        expect(v.maxHeightMm).toBeCloseTo(3000, 6);
        // Still down to the eaves at the walls: the roof is lower than the ceiling there.
        expect(v.minHeightMm).toBeCloseTo(2400, 6);
        // The roof reaches 3000 at 900 in from each eave: two sloped strips under a flat middle.
        const strips = 2 * 0.9 * 4.8 * ((2.4 + 3.0) / 2);
        const middle = (7.2 - 1.8) * 4.8 * 3.0;
        expect(v.volumeM3).toBeCloseTo(strips + middle, 3);
        for (const top of v.topFacesMm)
            for (const q of top) expect(q.z).toBeLessThanOrEqual(3000.001);
    });

    it('holds a ceiling to the lowest wall around the room', () => {
        const surfaces = box().filter((s) => s.id !== 'top');
        const v = zoneVolume(surfaces, GROUND, WEST_ROOM, () => 0, 2500);
        expect(v.ceiling).toBe('ceiling');
        expect(v.maxHeightMm).toBeCloseTo(2400, 6);
    });

    it('takes a ceiling as the top where nothing is overhead', () => {
        const surfaces = box().filter((s) => s.id !== 'top');
        const v = zoneVolume(surfaces, GROUND, WEST_ROOM, () => 0, 2300);
        expect(v.ceiling).toBe('ceiling');
        expect(v.maxHeightMm).toBeCloseTo(2300, 6);
        expect(v.minHeightMm).toBeCloseTo(2300, 6);
    });

    it('builds a closed solid whose top follows both roof planes up to the ridge', () => {
        const surfaces = box().filter((s) => s.id !== 'top' && s.id !== 'partition');
        surfaces.push(
            face('roof-w', [
                p(0, 0, 2400),
                p(3600, 0, 4800),
                p(3600, 4800, 4800),
                p(0, 4800, 2400),
            ]),
            face('roof-e', [
                p(3600, 0, 4800),
                p(7200, 0, 2400),
                p(7200, 4800, 2400),
                p(3600, 4800, 4800),
            ])
        );
        const whole = [
            { x: 0, y: 0 },
            { x: 7200, y: 0 },
            { x: 7200, y: 4800 },
            { x: 0, y: 4800 },
        ];
        const v = zoneVolume(surfaces, GROUND, whole, () => 0);
        // Every top vertex sits on the roof: 2400 at the eaves, 4800 on the ridge line.
        for (const face of v.topFacesMm) {
            for (const q of face) {
                expect(q.z).toBeCloseTo(2400 + (2400 * (3600 - Math.abs(q.x - 3600))) / 3600, 6);
            }
        }
        // The gable-end sides are split at the ridge; the eave sides are not.
        expect(v.sideFacesMm).toHaveLength(6);
        const floorArea = v.floorFacesMm.reduce((s, f) => s + polygonArea3(f), 0);
        expect(floorArea).toBeCloseTo(7200 * 4800, 3);
    });

    it('stops under the next storey’s floor, and falls back to the storey height with nothing above', () => {
        const surfaces = box().filter((s) => s.id !== 'top');
        const bare = zoneVolume(surfaces, GROUND, WEST_ROOM, () => 0);
        expect(bare.ceiling).toBe('nominal');
        expect(bare.meanHeightMm).toBeCloseTo(2400, 6);

        // A wall standing on the top makes it a floor — the storey above's — not a flat roof.
        const stacked = [...box(), wall('upper', [0, 0], [7200, 0], 2400, 4800)];
        const under = zoneVolume(stacked, GROUND, WEST_ROOM, depth);
        expect(under.ceiling).toBe('slab');
        expect(under.meanHeightMm).toBeCloseTo(2300 - 100, 6);
    });
});

describe('insetPolygon', () => {
    it('makes a step where a straight run changes from wall to open', () => {
        const ring = [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 2000, y: 0 },
            { x: 2000, y: 1000 },
            { x: 0, y: 1000 },
        ];
        const out = insetPolygon(ring, [100, 0, 0, 0, 0]);
        expect(out).toHaveLength(6);
        expect(out[0]).toEqual({ x: 0, y: 100 });
        expect(out[1]).toEqual({ x: 1000, y: 100 });
        expect(out[2]).toEqual({ x: 1000, y: 0 });
    });
});
