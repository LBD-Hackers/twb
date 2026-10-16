import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import { classifyAll } from './classify';
import { faceSpannedBy } from './face-chord';
import { roofFollowMoves } from './roof-follow';

const P = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });

/** A 7200 × 9600 box with a flat lid, and a partition along x = 3600 up to the lid. */
function boxWithPartition(): SurfaceStore {
    const store = new SurfaceStore();
    const rings: Point3Mm[][] = [
        [P(0, 0, 0), P(7200, 0, 0), P(7200, 9600, 0), P(0, 9600, 0)],
        [P(0, 0, 0), P(7200, 0, 0), P(7200, 0, 2400), P(0, 0, 2400)],
        [P(7200, 0, 0), P(7200, 9600, 0), P(7200, 9600, 2400), P(7200, 0, 2400)],
        [P(7200, 9600, 0), P(0, 9600, 0), P(0, 9600, 2400), P(7200, 9600, 2400)],
        [P(0, 9600, 0), P(0, 0, 0), P(0, 0, 2400), P(0, 9600, 2400)],
        [P(0, 0, 2400), P(7200, 0, 2400), P(7200, 9600, 2400), P(0, 9600, 2400)],
        [P(3600, 0, 0), P(3600, 9600, 0), P(3600, 9600, 2400), P(3600, 0, 2400)],
        [P(0, 4800, 0), P(3600, 4800, 0), P(3600, 4800, 2400), P(0, 4800, 2400)],
    ];
    for (const ring of rings) expect(store.add(ring).surface).not.toBeNull();
    return store;
}

const lidId = (store: SurfaceStore) =>
    store.surfaces().find((s) => s.boundaryMm.every((p) => p.z === 2400))!.id;

describe('faceSpannedBy', () => {
    it('finds the lid under a partition top that runs across it', () => {
        const store = boxWithPartition();
        expect(faceSpannedBy(store.surfaces(), P(3600, 0, 2400), P(3600, 9600, 2400))).toBe(
            lidId(store)
        );
    });

    it('finds nothing for a line along an edge, or one that stops inside the face', () => {
        const store = boxWithPartition();
        expect(faceSpannedBy(store.surfaces(), P(0, 0, 2400), P(7200, 0, 2400))).toBeNull();
        // The short partition: from the west wall to the middle of the lid, not across it.
        expect(faceSpannedBy(store.surfaces(), P(0, 4800, 2400), P(3600, 4800, 2400))).toBeNull();
    });

    it('lets a partition top lifted as a ridge make a gable roof', () => {
        const store = boxWithPartition();
        const a = P(3600, 0, 2400);
        const b = P(3600, 9600, 2400);
        const lid = faceSpannedBy(store.surfaces(), a, b)!;
        expect(store.split(lid, [a, b]).ok).toBe(true);
        const lifted = [a, b].map((p) => ({ fromMm: p, toMm: { ...p, z: 3900 } }));
        const moves = [...lifted, ...roofFollowMoves(store.surfaces(), lifted)];
        expect(store.moveVerticesTo(moves).ok).toBe(true);

        const surfaces = store.surfaces();
        const kinds = classifyAll(surfaces);
        const roofs = surfaces.filter((s) => kinds.get(s.id) === 'roof');
        expect(roofs).toHaveLength(2);
        for (const r of roofs) expect(Math.max(...r.boundaryMm.map((p) => p.z))).toBe(3900);
        // The short partition meets the roof slope, not the old flat lid.
        const short = surfaces.find((s) => s.boundaryMm.some((p) => p.y === 4800))!;
        expect(Math.max(...short.boundaryMm.map((p) => p.z))).toBe(3900);
    });
});
