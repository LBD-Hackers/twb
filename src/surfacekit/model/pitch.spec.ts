import { describe, expect, it } from 'vitest';
import { pitchDegOf, planeOfPolygon, type Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import { classifyAll } from './classify';
import { pitchForRise, pitchMoves, pitchTargets, riseForPitch, surfacePitchTarget } from './pitch';
import type { Surface } from './surface';

const FLOOR: Point3Mm[] = [
    { x: 0, y: 0, z: 0 },
    { x: 7200, y: 0, z: 0 },
    { x: 7200, y: 9600, z: 0 },
    { x: 0, y: 9600, z: 0 },
];

const RIDGE_A: Point3Mm = { x: 3600, y: 0, z: 3900 };
const RIDGE_B: Point3Mm = { x: 3600, y: 9600, z: 3900 };

/**
 * The gabled box the rest of the model's specs build, ridge already lifted 1500 mm: a 3600 mm
 * run either side, so the roof stands at atan(1500/3600) = 22.62°.
 */
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

function roofs(store: SurfaceStore): Surface[] {
    const kinds = classifyAll(store.surfaces());
    return store.surfaces().filter((s) => kinds.get(s.id) === 'roof');
}

function pitchOf(surface: Surface): number {
    return pitchDegOf(planeOfPolygon(surface.boundaryMm)!);
}

describe('pitchTargets', () => {
    it('offers one target per roof plane sharing the ridge, longest run first', () => {
        const targets = pitchTargets(gableBox().surfaces(), [RIDGE_A, RIDGE_B]);
        expect(targets).toHaveLength(2);
        for (const t of targets) {
            expect(t.runMm).toBe(3600);
            expect(t.pitchDeg).toBeCloseTo(22.62, 2);
            expect(t.sign).toBe(1);
            // The hinge is the eave: both ends at wall height.
            expect(t.hingeAMm.z).toBe(2400);
            expect(t.hingeBMm.z).toBe(2400);
        }
    });

    it('leaves the gables out — a wall has no run in plan to set an angle over', () => {
        const store = gableBox();
        const targets = pitchTargets(store.surfaces(), [RIDGE_A, RIDGE_B]);
        const kinds = classifyAll(store.surfaces());
        // Both gables have an apex at the ridge, so they are in the candidate set and rejected.
        const gables = store
            .surfaces()
            .filter(
                (s) =>
                    kinds.get(s.id) === 'wall' &&
                    s.boundaryMm.some((p) => p.z > 2400 + 1) &&
                    s.boundaryMm.length === 5
            );
        expect(gables).toHaveLength(2);
        for (const g of gables) {
            expect(targets.some((t) => t.surfaceId === g.id)).toBe(false);
        }
    });

    it('hinges on the ridge when it is the eave that was picked, and swings downward', () => {
        const store = gableBox();
        const west = roofs(store).find((s) => s.boundaryMm.some((p) => p.x === 0))!;
        const eave = west.boundaryMm.filter((p) => p.z === 2400);
        const target = pitchTargets(store.surfaces(), eave).find((t) => t.surfaceId === west.id)!;
        expect(target.hingeAMm.z).toBe(3900);
        expect(target.sign).toBe(-1);
        expect(target.runMm).toBe(3600);
    });
});

describe('pitchMoves', () => {
    it('sends the ridge to the height the angle implies', () => {
        const store = gableBox();
        const target = pitchTargets(store.surfaces(), [RIDGE_A, RIDGE_B])[0]!;
        const moves = pitchMoves(target, [RIDGE_A, RIDGE_B], 45);
        // 45° over a 3600 run, hinged at the 2400 eave.
        for (const move of moves) {
            expect(move.toMm.z).toBe(6000);
            expect(move.toMm.x).toBe(move.fromMm.x);
            expect(move.toMm.y).toBe(move.fromMm.y);
        }
    });

    it('re-pitches both halves and both gables through the store, and the geometry says so', () => {
        const store = gableBox();
        const target = pitchTargets(store.surfaces(), [RIDGE_A, RIDGE_B])[0]!;
        const result = store.moveVerticesTo(pitchMoves(target, [RIDGE_A, RIDGE_B], 45));

        expect(result.ok).toBe(true);
        // Both roof planes and both gables carry a ridge corner.
        expect(result.surfaceIds).toHaveLength(4);
        for (const roof of roofs(store)) expect(pitchOf(roof)).toBeCloseTo(45, 4);
        for (const s of store.surfaces()) {
            for (const p of s.boundaryMm) {
                if (p.x === 3600 && (p.y === 0 || p.y === 9600)) expect(p.z).toBe(6000);
            }
        }
    });

    it('holds the plan positions, so the module is never at risk', () => {
        const store = gableBox();
        const before = store.surfaces().map((s) => s.boundaryMm.map((p) => [p.x, p.y]));
        const target = pitchTargets(store.surfaces(), [RIDGE_A, RIDGE_B])[0]!;
        store.moveVerticesTo(pitchMoves(target, [RIDGE_A, RIDGE_B], 38));
        const after = store.surfaces().map((s) => s.boundaryMm.map((p) => [p.x, p.y]));
        expect(after).toEqual(before);
    });

    it('drops the eave when the ridge is the hinge, leaving the ridge where it was', () => {
        const store = gableBox();
        const west = roofs(store).find((s) => s.boundaryMm.some((p) => p.x === 0))!;
        const eave = west.boundaryMm.filter((p) => p.z === 2400);
        const target = pitchTargets(store.surfaces(), eave).find((t) => t.surfaceId === west.id)!;

        expect(store.moveVerticesTo(pitchMoves(target, eave, 45)).ok).toBe(true);
        const after = store.get(west.id)!;
        expect(pitchOf(after)).toBeCloseTo(45, 4);
        // 45° dropping 3600 below the 3900 ridge.
        for (const p of after.boundaryMm) {
            if (p.x === 0) expect(p.z).toBe(300);
            if (p.x === 3600) expect(p.z).toBe(3900);
        }
    });
});

describe('surfacePitchTarget', () => {
    it('hinges a roof face on its own eave and swings everything else', () => {
        const store = gableBox();
        const west = roofs(store).find((s) => s.boundaryMm.some((p) => p.x === 0))!;
        const { target, positionsMm } = surfacePitchTarget(west)!;

        expect(target.pitchDeg).toBeCloseTo(22.62, 2);
        expect(target.runMm).toBe(3600);
        expect(target.hingeAMm.z).toBe(2400);
        expect(positionsMm).toHaveLength(2);
        for (const p of positionsMm) expect(p.z).toBe(3900);
    });

    it('is null for a level face — there is no pitch there to change', () => {
        const store = new SurfaceStore();
        const base = store.add(FLOOR).surface!;
        const topId = store.extrude(base.id, 2400).surfaceIds[0]!;
        expect(surfacePitchTarget(store.get(topId)!)).toBeNull();
    });

    it('is null for a gable wall', () => {
        const store = gableBox();
        const kinds = classifyAll(store.surfaces());
        const gable = store
            .surfaces()
            .find((s) => kinds.get(s.id) === 'wall' && s.boundaryMm.length === 5)!;
        expect(surfacePitchTarget(gable)).toBeNull();
    });
});

describe('riseForPitch and pitchForRise', () => {
    it('are each other’s inverse about the pitch the plane already has', () => {
        const target = pitchTargets(gableBox().surfaces(), [RIDGE_A, RIDGE_B])[0]!;
        const rise = riseForPitch(target, 45);
        // 45° puts the ridge at 6000; it stands at 3900.
        expect(rise).toBe(2100);
        expect(pitchForRise(target, rise)).toBeCloseTo(45, 6);
        expect(pitchForRise(target, 0)).toBeCloseTo(target.pitchDeg, 6);
    });

    it('reads a downward drag as a shallower roof, and past level as the other way up', () => {
        const target = pitchTargets(gableBox().surfaces(), [RIDGE_A, RIDGE_B])[0]!;
        expect(pitchForRise(target, -1500)).toBeCloseTo(0, 6);
        expect(pitchForRise(target, -3000)).toBeCloseTo(22.62, 2);
    });
});
