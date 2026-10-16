import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import { interiorWallSegmentRings } from './interior-wall-geometry';
import { partitionCeilingFits, zoneCeilingsMm, zoneFlatCeilingMm } from './partition-ceiling';
import { resolveZoneRooms } from './zone-rooms';
import type { Zone } from './zone';

const FLOOR: Point3Mm[] = [
    { x: 0, y: 0, z: 0 },
    { x: 7200, y: 0, z: 0 },
    { x: 7200, y: 9600, z: 0 },
    { x: 0, y: 9600, z: 0 },
];

/**
 * A gabled box, 2400 to the eaves with its ridge along y at x = 3600, and a partition across
 * it at y = 4800 built the way the Interior Wall tool builds one: up to the roof, so one face
 * either side of the ridge.
 */
function house(): SurfaceStore {
    const store = new SurfaceStore();
    const base = store.add(FLOOR).surface!;
    const topId = store.extrude(base.id, 2400).surfaceIds[0]!;
    const a = { x: 3600, y: 0, z: 2400 };
    const b = { x: 3600, y: 9600, z: 2400 };
    store.split(topId, [a, b]);
    store.moveVertices([a, b], { x: 0, y: 0, z: 1500 });
    const storey = store.storeys()[0]!;
    for (const piece of interiorWallSegmentRings(
        store.surfaces(),
        store.storeys(),
        storey,
        { x: 0, y: 4800 },
        { x: 7200, y: 4800 }
    )) {
        store.add(piece.ringMm);
    }
    return store;
}

/** The two rooms, each lowered to its height, or open where it has none. */
function rooms(store: SurfaceStore, south?: number, north?: number): Zone[] {
    const storeyId = store.storeys()[0]!.id;
    const zone = (id: string, y: number, ceilingMm?: number): Zone => ({
        id,
        name: id,
        kindId: 'living',
        storeyId,
        seedMm: { x: 2400, y },
        ...(ceilingMm === undefined
            ? { ceiling: 'open' as const }
            : { ceiling: 'lowered' as const, ceilingMm }),
    });
    return [zone('south', 2400, south), zone('north', 7200, north)];
}

const isPartition = (ring: readonly Point3Mm[]) => ring.every((p) => Math.abs(p.y - 4800) < 1);

function partitionTops(store: SurfaceStore): number[] {
    return store
        .surfaces()
        .filter((s) => isPartition(s.boundaryMm))
        .map((s) => Math.max(...s.boundaryMm.map((p) => p.z)))
        .sort((a, b) => a - b);
}

function fit(store: SurfaceStore, zones: Zone[]): void {
    const changes = partitionCeilingFits(
        store.surfaces(),
        store.storeys(),
        zones,
        [],
        new Set(zones.map((z) => z.id))
    );
    expect(store.applyFaceChanges(changes).ok).toBe(true);
}

describe('partitionCeilingFits', () => {
    it('leaves a partition up to the roof where only one room has a ceiling', () => {
        const store = house();
        const before = partitionTops(store);
        expect(before).toHaveLength(2);
        expect(before[0]).toBeCloseTo(3900, 0);
        const { reshape, add } = partitionCeilingFits(
            store.surfaces(),
            store.storeys(),
            rooms(store, 2300),
            [],
            new Set(['south'])
        );
        expect(reshape).toEqual([]);
        expect(add).toEqual([]);
    });

    it('stops a partition under the higher ceiling where both rooms have one', () => {
        const store = house();
        fit(store, rooms(store, 2100, 2300));
        expect(partitionTops(store)).toEqual([2300, 2300]);
    });

    it('runs it up to the roof again when a ceiling is taken away', () => {
        const store = house();
        fit(store, rooms(store, 2100, 2300));
        fit(store, rooms(store, 2100));
        const tops = partitionTops(store);
        expect(tops[0]).toBeCloseTo(3900, 0);
        expect(tops[1]).toBeCloseTo(3900, 0);
    });

    it('keeps the partition facing the way it was drawn', () => {
        const store = house();
        const normals = () =>
            store
                .surfaces()
                .filter((s) => isPartition(s.boundaryMm))
                .map((s) => Math.sign(s.boundaryMm[1]!.x - s.boundaryMm[0]!.x));
        const before = normals();
        fit(store, rooms(store, 2100, 2300));
        expect(normals()).toEqual(before);
    });

    it('leaves a load-bearing partition alone', () => {
        const store = house();
        for (const s of store.surfaces()) {
            if (isPartition(s.boundaryMm)) store.setLoadBearing(s.id, true);
        }
        const { reshape, add } = partitionCeilingFits(
            store.surfaces(),
            store.storeys(),
            rooms(store, 2100, 2300),
            [],
            new Set(['south', 'north'])
        );
        expect(reshape).toEqual([]);
        expect(add).toEqual([]);
    });
});

describe('zoneFlatCeilingMm', () => {
    it('is not held down by a partition that stops under a ceiling', () => {
        const store = house();
        fit(store, rooms(store, 2100, 2100));
        const limit = zoneFlatCeilingMm(
            store.surfaces(),
            store.storeys(),
            rooms(store, 2100, 2100),
            [],
            'south'
        );
        expect(limit).toBeCloseTo(2400, 0);
    });
});

describe('zoneCeilingsMm', () => {
    const flat = (store: SurfaceStore): Zone[] => rooms(store).map(({ ceiling: _open, ...z }) => z);

    it('puts a flat ceiling on the walls, the same in every room under one plate', () => {
        const store = house();
        const zones = flat(store);
        const found = resolveZoneRooms(store.surfaces(), store.storeys(), zones, []);
        const ceilings = zoneCeilingsMm(store.surfaces(), store.storeys(), zones, found);
        expect(ceilings.get('south')).toBe(2400);
        expect(ceilings.get('north')).toBe(2400);
    });

    it('stops a partition between two flat rooms on the plate', () => {
        const store = house();
        fit(store, flat(store));
        expect(partitionTops(store)).toEqual([2400, 2400]);
    });

    it('gives an open room none, and holds a lowered one under the plate', () => {
        const store = house();
        const zones = rooms(store, 2800);
        const found = resolveZoneRooms(store.surfaces(), store.storeys(), zones, []);
        const ceilings = zoneCeilingsMm(store.surfaces(), store.storeys(), zones, found);
        expect(ceilings.get('south')).toBe(2400);
        expect(ceilings.get('north')).toBeUndefined();
    });
});

describe('a partition along rooms ceiled differently', () => {
    it('runs up to the roof beside the open room and stops on the plate beside the rest', () => {
        const store = house();
        const storeyId = store.storeys()[0]!.id;
        const zone = (id: string, x: number, y: number, open = false): Zone => ({
            id,
            name: id,
            kindId: 'living',
            storeyId,
            seedMm: { x, y },
            ...(open ? { ceiling: 'open' as const } : {}),
        });
        const zones = [zone('sw', 1200, 2400, true), zone('se', 4800, 2400), zone('n', 3600, 7200)];
        const separations = [
            { id: 'sep', storeyId, aMm: { x: 2400, y: 0 }, bMm: { x: 2400, y: 4800 } },
        ];
        const changes = partitionCeilingFits(
            store.surfaces(),
            store.storeys(),
            zones,
            separations,
            new Set(zones.map((z) => z.id))
        );
        expect(store.applyFaceChanges(changes).ok).toBe(true);
        const pieces = store
            .surfaces()
            .filter((s) => isPartition(s.boundaryMm))
            .map((s) => {
                const xs = s.boundaryMm.map((p) => p.x);
                return [
                    Math.min(...xs),
                    Math.max(...xs),
                    Math.max(...s.boundaryMm.map((p) => p.z)),
                ];
            })
            .sort((a, b) => a[0]! - b[0]!);
        expect(pieces.map(([a, b, top]) => [a, b, Math.round(top!)])).toEqual([
            [0, 2400, Math.round(2400 + (2400 * 1500) / 3600)],
            [2400, 3600, 2400],
            [3600, 7200, 2400],
        ]);
    });
});
