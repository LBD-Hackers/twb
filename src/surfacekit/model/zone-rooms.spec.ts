import { describe, expect, it } from 'vitest';
import { polygonArea2, type Point3Mm } from '../core';
import type { Surface } from './surface';
import type { Storey } from './storey';
import type { Zone, ZoneSeparation } from './zone';
import { resolveZoneRooms } from './zone-rooms';

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
const wall = (id: string, a: [number, number], b: [number, number]) =>
    face(id, [p(a[0], a[1], 0), p(b[0], b[1], 0), p(b[0], b[1], 2400), p(a[0], a[1], 2400)]);

const STOREYS: Storey[] = [{ id: 'st1', name: 'Ground floor', elevationMm: 0, heightMm: 2400 }];

/** A 7200 × 4800 box with four walls and no partition. */
const BOX: Surface[] = [
    face('floor', [p(0, 0, 0), p(7200, 0, 0), p(7200, 4800, 0), p(0, 4800, 0)]),
    wall('s', [0, 0], [7200, 0]),
    wall('e', [7200, 0], [7200, 4800]),
    wall('n', [7200, 4800], [0, 4800]),
    wall('w', [0, 4800], [0, 0]),
];

const zone = (id: string, x: number, y: number): Zone => ({
    id,
    name: id,
    kindId: 'living',
    storeyId: 'st1',
    seedMm: { x, y },
});

/** An open kitchen: a separation across the box at x = 2400, with no wall there. */
const SPLIT: ZoneSeparation[] = [
    { id: 'zs1', storeyId: 'st1', aMm: { x: 2400, y: 0 }, bMm: { x: 2400, y: 4800 } },
];

describe('resolveZoneRooms', () => {
    it('divides a room where a separation runs, though there is no wall there', () => {
        const rooms = resolveZoneRooms(
            BOX,
            STOREYS,
            [zone('kitchen', 1000, 1000), zone('living', 5000, 1000)],
            SPLIT
        );
        expect(polygonArea2(rooms.get('kitchen')!.outlineMm!)).toBe(2400 * 4800);
        expect(polygonArea2(rooms.get('living')!.outlineMm!)).toBe(4800 * 4800);
    });

    it('reports the newer of two zones that end up in one room, and leaves the older whole', () => {
        const rooms = resolveZoneRooms(
            BOX,
            STOREYS,
            [zone('kitchen', 1000, 1000), zone('living', 5000, 1000)],
            []
        );
        expect(polygonArea2(rooms.get('kitchen')!.outlineMm!)).toBe(7200 * 4800);
        expect(rooms.get('living')).toEqual({
            outlineMm: null,
            problem: { kind: 'shared', withZoneId: 'kitchen' },
        });
    });

    it('reports a zone whose room no longer closes', () => {
        const rooms = resolveZoneRooms(BOX, STOREYS, [zone('out', -1000, 1000)], SPLIT);
        expect(rooms.get('out')!.problem).toEqual({ kind: 'open' });
    });
});
