import { describe, expect, it } from 'vitest';
import {
    planarityErrorMm,
    planeOfPolygon,
    polygonArea2,
    type Point3Mm,
    type Vec2Mm,
} from '../core';
import { generateRoof, roofBaseOf, type GeneratedRoof, type RoofSpec } from './roof-generate';
import type { Surface } from './surface';

const plan = (...pts: [number, number][]): Vec2Mm[] => pts.map(([x, y]) => ({ x, y }));

const RECT = plan([0, 0], [9600, 0], [9600, 7200], [0, 7200]);
const L = plan([0, 0], [12000, 0], [12000, 4800], [4800, 4800], [4800, 12000], [0, 12000]);
const T = plan(
    [4800, 0],
    [9600, 0],
    [9600, 7200],
    [14400, 7200],
    [14400, 12000],
    [0, 12000],
    [0, 7200],
    [4800, 7200]
);
const U = plan(
    [0, 0],
    [14400, 0],
    [14400, 12000],
    [9600, 12000],
    [9600, 4800],
    [4800, 4800],
    [4800, 12000],
    [0, 12000]
);
/** A narrow wing running on past the east gable of a wider house. */
const STEP = plan(
    [0, 0],
    [12000, 0],
    [12000, 1200],
    [16800, 1200],
    [16800, 4800],
    [12000, 4800],
    [12000, 7200],
    [0, 7200]
);

const TAN30 = Math.tan(Math.PI / 6);

function roof(outline: Vec2Mm[], spec: Partial<RoofSpec>): GeneratedRoof {
    const result = generateRoof(outline, { type: 'gable', pitchDeg: 30, eaveMm: 2400, ...spec });
    if (!result.ok) throw new Error(result.error);
    return result.roof;
}

/** Every plane flat, sloped as asked, and together covering the outline exactly once. */
function expectSound(r: GeneratedRoof, outline: Vec2Mm[], pitchDeg = 30): void {
    for (const face of r.planes) {
        const plane = planeOfPolygon(face)!;
        expect(planarityErrorMm(face, plane)).toBeLessThanOrEqual(2);
        const pitch = (Math.acos(Math.abs(plane.normal.z)) * 180) / Math.PI;
        expect(pitch).toBeCloseTo(pitchDeg, 0);
    }
    const covered = r.planes.reduce((sum, face) => sum + polygonArea2(face), 0);
    expect(covered).toBeCloseTo(polygonArea2(outline), -3);
}

const zAt = (r: GeneratedRoof, x: number, y: number): number[] =>
    r.planes.flatMap((f) => f.filter((p) => p.x === x && p.y === y).map((p) => p.z));

describe('generateRoof', () => {
    it('puts a gable over a rectangle, ridge along the longer side', () => {
        const r = roof(RECT, {});
        expect(r.planes).toHaveLength(2);
        expect(r.steps).toHaveLength(0);
        expectSound(r, RECT);
        const ridge = Math.round(2400 + 3600 * TAN30);
        expect(zAt(r, 0, 3600)).toEqual([ridge, ridge]);
        expect(zAt(r, 9600, 3600)).toEqual([ridge, ridge]);
        expect(zAt(r, 0, 0)).toEqual([2400]);
    });

    it('turns the ridge when told to', () => {
        const r = roof(RECT, { ridge: 'y' });
        expect(r.planes).toHaveLength(2);
        const ridge = Math.round(2400 + 4800 * TAN30);
        expect(zAt(r, 4800, 0)).toEqual([ridge, ridge]);
    });

    it('gives an L two ridges and a valley where they meet', () => {
        const r = roof(L, {});
        expectSound(r, L);
        expect(r.planes).toHaveLength(5);
        expect(r.steps).toHaveLength(0);
        // The valley runs from the inside corner, at the eave, to where the ridges meet.
        const top = Math.round(2400 + 2400 * TAN30);
        expect(zAt(r, 4800, 4800)).toContain(2400);
        expect(zAt(r, 2400, 2400)).toContain(top);
    });

    it('builds T, U and cross shapes wing by wing, without steps', () => {
        const plus = plan(
            [4800, 0],
            [9600, 0],
            [9600, 4800],
            [14400, 4800],
            [14400, 9600],
            [9600, 9600],
            [9600, 14400],
            [4800, 14400],
            [4800, 9600],
            [0, 9600],
            [0, 4800],
            [4800, 4800]
        );
        for (const outline of [T, U, plus]) {
            const r = roof(outline, {});
            expectSound(r, outline);
            expect(r.steps).toHaveLength(0);
        }
    });

    it('hips every end, and merges the planes two wings share', () => {
        const rect = roof(RECT, { type: 'hip' });
        expect(rect.planes).toHaveLength(4);
        expectSound(rect, RECT);
        const l = roof(L, { type: 'hip' });
        expectSound(l, L);
        expect(l.planes).toHaveLength(6);
    });

    it('closes the step where a narrow wing runs past a wide gable', () => {
        const r = roof(STEP, {});
        expectSound(r, STEP);
        expect(r.steps).toHaveLength(1);
        const step = r.steps[0]!;
        expect(step.every((p) => p.x === 12000)).toBe(true);
        // From the narrow wing's ridge up to the wide one's.
        expect(Math.min(...step.map((p) => p.z))).toBe(2400);
        expect(Math.max(...step.map((p) => p.z))).toBe(Math.round(2400 + 3600 * TAN30));
    });

    it('shares every corner a step has with the roof planes it meets', () => {
        const r = roof(STEP, {});
        const key = (p: Point3Mm) => `${p.x},${p.y},${p.z}`;
        const planeCorners = new Set(r.planes.flat().map(key));
        for (const p of r.steps[0]!) {
            if (p.z > 2400) expect(planeCorners.has(key(p))).toBe(true);
        }
    });

    it('lays a shed roof as one plane over any outline, rising to the side asked', () => {
        const r = roof(L, { type: 'shed', pitchDeg: 10, highSide: 'north' });
        expect(r.planes).toHaveLength(1);
        const face = r.planes[0]!;
        expect(face).toHaveLength(6);
        expect(zAt(r, 0, 0)).toEqual([2400]);
        expect(zAt(r, 0, 12000)).toEqual([Math.round(2400 + 12000 * Math.tan(Math.PI / 18))]);
        const east = roof(RECT, { type: 'shed', pitchDeg: 10, highSide: 'west' });
        expect(zAt(east, 9600, 0)).toEqual([2400]);
    });

    it('lays a flat roof level at the eave', () => {
        const r = roof(U, { type: 'flat' });
        expect(r.planes).toHaveLength(1);
        expect(r.planes[0]!.every((p) => p.z === 2400)).toBe(true);
    });

    it('hips a convex outline without square corners', () => {
        const hexagon = plan(
            [2400, 0],
            [7200, 0],
            [9600, 3600],
            [7200, 7200],
            [2400, 7200],
            [0, 3600]
        );
        const r = roof(hexagon, { type: 'hip' });
        expectSound(r, hexagon);
        expect(r.planes).toHaveLength(6);
    });

    it('runs one roof on over a shallow recess in one side', () => {
        const recessed = plan(
            [0, 0],
            [4800, 0],
            [4800, 2400],
            [9600, 2400],
            [9600, 0],
            [18000, 0],
            [18000, 8400],
            [0, 8400]
        );
        const r = roof(recessed, {});
        expect(r.planes).toHaveLength(2);
        expect(polygonArea2(r.outline)).toBe(18000 * 8400);
        const ridge = Math.round(2400 + 4200 * TAN30);
        expect(zAt(r, 0, 4200)).toEqual([ridge, ridge]);
        // Asked to follow every wall, the recess is a notch in the roof too.
        const followed = roof(recessed, { cover: 'outline' });
        expect(followed.planes.length).toBeGreaterThan(2);
        expectSound(followed, recessed);
    });

    it('leaves a missing corner or a deep courtyard as wings, unless told to cover everything', () => {
        expect(roof(L, {}).outline).toHaveLength(6);
        expect(roof(U, {}).outline).toHaveLength(8);
        const box = roof(L, { cover: 'box' });
        expect(box.planes).toHaveLength(2);
        expect(polygonArea2(box.outline)).toBe(12000 * 12000);
    });

    it('refuses what it cannot build, saying why', () => {
        const skew = plan([0, 0], [9600, 0], [8400, 7200], [4800, 3600], [0, 7200]);
        const gable = generateRoof(skew, { type: 'gable', pitchDeg: 30, eaveMm: 2400 });
        expect(gable.ok).toBe(false);
        const steep = generateRoof(RECT, { type: 'gable', pitchDeg: 90, eaveMm: 2400 });
        expect(steep.ok).toBe(false);
        if (!steep.ok) expect(steep.error).toMatch(/pitch/);
    });
});

describe('roofBaseOf', () => {
    const face = (id: string, ring: Point3Mm[]): Surface => ({
        id,
        boundaryMm: ring,
        openings: [],
        holes: [],
        kindOverride: null,
        loadBearing: null,
        spanDirectionOverride: null,
        roofGroupId: null,
        studSectionOverride: null,
    });
    const p = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });
    const wall = (ax: number, ay: number, bx: number, by: number, z0: number, z1: number) => [
        p(ax, ay, z0),
        p(bx, by, z0),
        p(bx, by, z1),
        p(ax, ay, z1),
    ];

    it('reads the outline and eave height off the top storey of walls', () => {
        const surfaces = [
            face('floor', [p(0, 0, 0), p(9600, 0, 0), p(9600, 7200, 0), p(0, 7200, 0)]),
            face('s', wall(0, 0, 9600, 0, 0, 2700)),
            face('e', wall(9600, 0, 9600, 7200, 0, 2700)),
            face('n', wall(9600, 7200, 0, 7200, 0, 2700)),
            face('w', wall(0, 7200, 0, 0, 0, 2700)),
            face('s2', wall(0, 0, 9600, 0, 2700, 5100)),
            face('e2', wall(9600, 0, 9600, 7200, 2700, 5100)),
            face('n2', wall(9600, 7200, 0, 7200, 2700, 5100)),
            face('w2', wall(0, 7200, 0, 0, 2700, 5100)),
            face('partition', wall(4800, 0, 4800, 7200, 2700, 5100)),
        ];
        const base = roofBaseOf(surfaces);
        expect(base?.eaveMm).toBe(5100);
        expect(base && polygonArea2(base.outline)).toBe(9600 * 7200);
    });

    it('is null with no walls closing round anything', () => {
        expect(roofBaseOf([face('s', wall(0, 0, 9600, 0, 0, 2400))])).toBeNull();
    });
});
