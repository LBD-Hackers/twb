import { describe, expect, it } from 'vitest';
import { SurfaceStore } from './surface-store';
import type { Point3Mm } from '../core';
import type { Storey } from './storey';
import { interiorWallSegmentRings } from './interior-wall-geometry';

const FLOOR: Point3Mm[] = [
    { x: 0, y: 0, z: 0 },
    { x: 7200, y: 0, z: 0 },
    { x: 7200, y: 9600, z: 0 },
    { x: 0, y: 9600, z: 0 },
];

/** A gabled box, exactly as `roof-height.spec.ts` builds one for the same reason. */
function gableBox(): SurfaceStore {
    const store = new SurfaceStore();
    const base = store.add(FLOOR).surface!;
    const topId = store.extrude(base.id, 2400).surfaceIds[0]!;
    const a = { x: 3600, y: 0, z: 2400 };
    const b = { x: 3600, y: 9600, z: 2400 };
    store.split(topId, [a, b]);
    store.moveVertices([a, b], { x: 0, y: 0, z: 1500 });
    return store;
}

const GROUND: Storey = { id: 'st1', name: 'Ground floor', elevationMm: 0, heightMm: 2400 };
const FIRST: Storey = { id: 'st2', name: '1st floor', elevationMm: 2400, heightMm: 2400 };
const ACROSS = [
    { x: 0, y: 4800 },
    { x: 7200, y: 4800 },
] as const;

describe('interiorWallSegmentRings', () => {
    it('stops a storey with one above it flat at the floor above, and builds that storey only', () => {
        const pieces = interiorWallSegmentRings([], [GROUND, FIRST], GROUND, ...ACROSS);
        expect(pieces).toHaveLength(1);
        expect(pieces[0]!.singlePiece).toBe(true);
        expect(pieces[0]!.ringMm.map((p) => p.z)).toEqual([0, 0, 2400, 2400]);
    });

    it('falls back to the top storey’s own height with no roof over it', () => {
        const pieces = interiorWallSegmentRings([], [GROUND, FIRST], FIRST, ...ACROSS);
        expect(pieces).toHaveLength(1);
        expect(pieces[0]!.ringMm.map((p) => p.z)).toEqual([2400, 2400, 4800, 4800]);
    });

    it('splits the top storey at the ridge instead of stopping flat, following the roof', () => {
        const store = gableBox();
        const pieces = interiorWallSegmentRings(store.surfaces(), [GROUND], GROUND, ...ACROSS);
        expect(pieces).toHaveLength(2);
        for (const piece of pieces) expect(piece.singlePiece).toBe(false);
        // First piece runs from the wall (x=0) to the ridge (x=3600), rising from eave to ridge.
        expect(pieces[0]!.ringMm.map((p) => Math.round(p.x))).toEqual([0, 3600, 3600, 0]);
        expect(pieces[0]!.ringMm.map((p) => Math.round(p.z))).toEqual([0, 0, 3900, 2400]);
        // Second piece runs from the ridge back down to the far wall (x=7200).
        expect(pieces[1]!.ringMm.map((p) => Math.round(p.x))).toEqual([3600, 7200, 7200, 3600]);
        expect(pieces[1]!.ringMm.map((p) => Math.round(p.z))).toEqual([0, 0, 2400, 3900]);
    });

    it('stops flat under a ceiling below the whole roof, as one rectangle', () => {
        const store = gableBox();
        const pieces = interiorWallSegmentRings(store.surfaces(), [GROUND], GROUND, ...ACROSS, {
            ceilingMm: 2300,
        });
        expect(pieces).toHaveLength(1);
        expect(pieces[0]!.singlePiece).toBe(true);
        expect(pieces[0]!.ringMm.map((p) => Math.round(p.z))).toEqual([0, 0, 2300, 2300]);
    });

    it('follows the roof up to a ceiling that cuts across it, and flat under it from there', () => {
        const store = gableBox();
        const pieces = interiorWallSegmentRings(store.surfaces(), [GROUND], GROUND, ...ACROSS, {
            ceilingMm: 3150,
        });
        // Eave 2400 at x=0 rising to 3900 at x=3600: the ceiling at 3150 is met halfway, at 1800.
        expect(pieces.map((p) => p.ringMm.map((v) => Math.round(v.x)))).toEqual([
            [0, 1800, 1800, 0],
            [1800, 5400, 5400, 1800],
            [5400, 7200, 7200, 5400],
        ]);
        expect(pieces.map((p) => p.ringMm.map((v) => Math.round(v.z)))).toEqual([
            [0, 0, 3150, 2400],
            [0, 0, 3150, 3150],
            [0, 0, 2400, 3150],
        ]);
    });
});
