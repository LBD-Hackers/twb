import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import { hostOf, openHoles, resolvedSurfaces } from './surface-holes';

const P = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });

/** A 7200 × 2400 wall along y = 0, and nothing else. */
function wall(): { store: SurfaceStore; wallId: string } {
    const store = new SurfaceStore();
    const wallId = store.add([P(0, 0, 0), P(7200, 0, 0), P(7200, 0, 2400), P(0, 0, 2400)]).surface!
        .id;
    return { store, wallId };
}

/** A 1200 × 1200 window-sized loop strictly inside the wall. */
const LOOP = [P(1200, 0, 900), P(2400, 0, 900), P(2400, 0, 2100), P(1200, 0, 2100)];

describe('inner loops', () => {
    it('a loop drawn inside a face is an inner ring of it and a face of its own', () => {
        const { store, wallId } = wall();
        const filler = store.add(LOOP, { enforceModule: false }).surface!;
        expect(store.get(wallId)!.holes).toHaveLength(1);
        expect(hostOf(filler, store.surfaces())?.host.id).toBe(wallId);
        expect(openHoles(store.get(wallId)!, store.surfaces())).toHaveLength(0);
        // Derivation sees one whole wall.
        const resolved = resolvedSurfaces(store.surfaces());
        expect(resolved.map((s) => s.id)).toEqual([wallId]);
        expect(resolved[0]!.holes).toHaveLength(0);
    });

    it('deleting the filling face leaves a real hole, and no stray lines', () => {
        const { store, wallId } = wall();
        const filler = store.add(LOOP, { enforceModule: false }).surface!;
        store.removeFace(filler.id);
        expect(openHoles(store.get(wallId)!, store.surfaces())).toHaveLength(1);
        expect(resolvedSurfaces(store.surfaces())[0]!.holes).toHaveLength(1);
        expect(store.guides()).toHaveLength(0);
    });

    it('a loop touching the edge is not an inner loop', () => {
        const { store, wallId } = wall();
        store.add([P(1200, 0, 0), P(2400, 0, 0), P(2400, 0, 2100), P(1200, 0, 2100)], {
            enforceModule: false,
        });
        expect(store.get(wallId)!.holes).toHaveLength(0);
    });

    it('a split through a hole is refused; one beside it takes the hole along', () => {
        const { store, wallId } = wall();
        store.add(LOOP, { enforceModule: false });
        expect(store.split(wallId, [P(1800, 0, 0), P(1800, 0, 2400)]).ok).toBe(false);
        const cut = store.split(wallId, [P(3600, 0, 0), P(3600, 0, 2400)]);
        expect(cut.ok).toBe(true);
        const withHole = cut.surfaceIds.filter((id) => store.get(id)!.holes.length === 1);
        expect(withHole).toHaveLength(1);
    });

    it('moving the filling face moves the ring with it', () => {
        const { store, wallId } = wall();
        store.add(LOOP, { enforceModule: false });
        const moved = store.moveVertices([P(1200, 0, 2100), P(2400, 0, 2100)], P(0, 0, 100));
        expect(moved.ok).toBe(true);
        const ring = store.get(wallId)!.holes[0]!;
        expect(Math.max(...ring.map((p) => p.z))).toBe(2200);
        expect(openHoles(store.get(wallId)!, store.surfaces())).toHaveLength(0);
    });
});

describe('SurfaceStore.makeOpening', () => {
    it('turns the face in an inner ring into a window in its host', () => {
        const { store, wallId } = wall();
        const filler = store.add(LOOP, { enforceModule: false }).surface!;
        const result = store.makeOpening(filler.id, 'window');
        expect(result.ok).toBe(true);
        expect(store.get(filler.id)).toBeUndefined();
        const host = store.get(wallId)!;
        expect(host.holes).toHaveLength(0);
        expect(host.openings).toEqual([
            {
                id: `${wallId}h1`,
                kind: 'window',
                uMm: 1200,
                vMm: 900,
                widthMm: 1200,
                heightMm: 1200,
            },
        ]);
    });

    it('heals a door drawn up from the floor back into the wall, as a door', () => {
        const { store, wallId } = wall();
        const split = store.split(wallId, [
            P(1200, 0, 0),
            P(1200, 0, 2100),
            P(2100, 0, 2100),
            P(2100, 0, 0),
        ]);
        expect(split.ok).toBe(true);
        const piece = split.surfaceIds.find((id) => store.get(id)!.boundaryMm.length === 4)!;
        const result = store.makeOpening(piece, 'door');
        expect(result.ok).toBe(true);
        expect(store.surfaces()).toHaveLength(1);
        const host = store.surfaces()[0]!;
        expect(host.boundaryMm).toHaveLength(4);
        expect(host.openings).toHaveLength(1);
        expect(host.openings[0]).toMatchObject({
            kind: 'door',
            vMm: 0,
            widthMm: 900,
            heightMm: 2100,
        });
    });

    it('refuses a face that is not a rectangle', () => {
        const { store } = wall();
        const tri = store.add([P(1200, 0, 900), P(2400, 0, 900), P(1800, 0, 2100)], {
            enforceModule: false,
        }).surface!;
        expect(store.makeOpening(tri.id, 'window').ok).toBe(false);
    });
});
