import { describe, expect, it } from 'vitest';
import { SurfaceStore, type Storey } from '../model';
import { saturateInteriorWallPoint } from './interior-wall-saturate';

const GROUND: Storey = { id: 'st1', name: 'Ground floor', elevationMm: 0, heightMm: 2400 };

/** A plain rectangular envelope, corners on the 1200 grid, the way an exterior wall always is. */
function envelopeStore(): SurfaceStore {
    const store = new SurfaceStore();
    store.add([
        { x: 0, y: 0, z: 0 },
        { x: 8400, y: 0, z: 0 },
        { x: 8400, y: 14400, z: 0 },
        { x: 0, y: 14400, z: 0 },
    ]);
    store.add([
        { x: 5400, y: 0, z: 0 },
        { x: 5400, y: 1200, z: 0 },
        { x: 5400, y: 1200, z: 2400 },
        { x: 5400, y: 0, z: 2400 },
    ]);
    return store;
}

describe('saturateInteriorWallPoint', () => {
    it('leaves a point exactly as given when nothing is nearby to snap onto — even off the 1200 grid', () => {
        const store = envelopeStore();
        // 5400 is a real 600 mm sub-module coordinate, not a 1200 mm one, and (5400, 6000) sits
        // well clear of every wall and floor edge above. A version of this function that fell
        // back to the module grid moved a point like this to (6000, 6000) — quantising a
        // coordinate that was already exactly on the finer, still-permitted grid, and only
        // because nothing else happened to be close enough to anchor it first.
        const p = saturateInteriorWallPoint(store.surfaces(), GROUND, { x: 5400, y: 6000 });
        expect(p).toEqual({ x: 5400, y: 6000 });
    });

    it('pulls a point within tolerance onto a real wall vertex, exactly', () => {
        const store = envelopeStore();
        const p = saturateInteriorWallPoint(store.surfaces(), GROUND, { x: 5390, y: 1205 });
        expect(p.x).toBe(5400);
        expect(p.y).toBe(1200);
    });

    it('pulls a point within tolerance onto a real wall edge, not just its endpoints', () => {
        const store = envelopeStore();
        // 100 mm off the floor's own south edge (y = 0), partway along it.
        const p = saturateInteriorWallPoint(store.surfaces(), GROUND, { x: 3000, y: 100 });
        expect(p.x).toBe(3000);
        expect(p.y).toBe(0);
    });

    it('leaves two independently-saturated ends of the same straight run equal, so it stays straight', () => {
        const store = envelopeStore();
        // Two points meant to be the same run's ends at x = 5400, one anchored by the real wall
        // vertex at (5400, 1200), the other with nothing nearby — both must come back at the
        // same x, or the "straight" run they describe would come out bent.
        const a = saturateInteriorWallPoint(store.surfaces(), GROUND, { x: 5400, y: 1200 });
        const b = saturateInteriorWallPoint(store.surfaces(), GROUND, { x: 5400, y: 6000 });
        expect(a.x).toBe(b.x);
    });
});
