import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import type { Surface } from './surface';
import { classifyAll, classifySurface } from './classify';

let n = 0;
function face(boundaryMm: Point3Mm[], kindOverride: Surface['kindOverride'] = null): Surface {
    return {
        id: `s${++n}`,
        boundaryMm,
        openings: [],
        holes: [],
        kindOverride,
        loadBearing: true,
        spanDirectionOverride: null,
        roofGroupId: null,
        studSectionOverride: null,
    };
}

const slab = (z: number): Point3Mm[] => [
    { x: 0, y: 0, z },
    { x: 7200, y: 0, z },
    { x: 7200, y: 9600, z },
    { x: 0, y: 9600, z },
];

const wallAtY0 = (zLow: number, zHigh: number): Point3Mm[] => [
    { x: 0, y: 0, z: zLow },
    { x: 7200, y: 0, z: zLow },
    { x: 7200, y: 0, z: zHigh },
    { x: 0, y: 0, z: zHigh },
];

describe('classifySurface', () => {
    it('reads a vertical face as a wall', () => {
        const w = face(wallAtY0(0, 2400));
        expect(classifySurface(w, [w])).toBe('wall');
    });

    it('reads a tilted face as a roof', () => {
        const r = face([
            { x: 0, y: 0, z: 2400 },
            { x: 7200, y: 0, z: 2400 },
            { x: 7200, y: 4800, z: 3900 },
            { x: 0, y: 4800, z: 3900 },
        ]);
        expect(classifySurface(r, [r])).toBe('roof');
    });

    it('reads a horizontal face at the lowest level as a floor, even on its own', () => {
        const f = face(slab(0));
        expect(classifySurface(f, [f])).toBe('floor');
    });

    it('reads the top of a box as a flat roof, and as a floor once a storey stands on it', () => {
        const ground = face(slab(0));
        const wall = face(wallAtY0(0, 2400));
        const top = face(slab(2400));
        expect(classifySurface(top, [ground, wall, top])).toBe('roof');
        const upperWall = face(wallAtY0(2400, 4800));
        expect(classifySurface(top, [ground, wall, top, upperWall])).toBe('floor');
    });

    it('lets an override win over the geometry', () => {
        const top = face(slab(2400), 'floor');
        expect(classifySurface(top, [face(slab(0)), top])).toBe('floor');
    });

    it('classifies everything at once', () => {
        const ground = face(slab(0));
        const wall = face(wallAtY0(0, 2400));
        const kinds = classifyAll([ground, wall]);
        expect(kinds.get(ground.id)).toBe('floor');
        expect(kinds.get(wall.id)).toBe('wall');
    });
});
