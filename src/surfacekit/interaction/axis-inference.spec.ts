import { describe, expect, it } from 'vitest';
import { rayToLine, rayToPoint, UP } from './axis-inference';
import { normalize3 } from '../core';

const ANCHOR = { x: 1200, y: 2400, z: 0 };

describe('rayToLine', () => {
    it('finds the height a ray aimed straight at the vertical picks out', () => {
        // Eye 10 m east of the anchor, looking level and due west at 2400 above ground.
        const hit = rayToLine({ x: 11200, y: 2400, z: 2400 }, { x: -1, y: 0, z: 0 }, ANCHOR, UP);
        expect(hit?.distanceMm).toBeCloseTo(0, 6);
        expect(hit?.pointMm.z).toBeCloseTo(2400, 6);
        expect(hit?.pointMm.x).toBeCloseTo(ANCHOR.x, 6);
    });

    it('measures how far the ray passes from the line', () => {
        const hit = rayToLine({ x: 11200, y: 3000, z: 2400 }, { x: -1, y: 0, z: 0 }, ANCHOR, UP);
        expect(hit?.distanceMm).toBeCloseTo(600, 6);
    });

    it('rejects a ray pointing away from the line', () => {
        expect(
            rayToLine({ x: 11200, y: 2400, z: 2400 }, { x: 1, y: 0, z: 0 }, ANCHOR, UP)
        ).toBeNull();
    });

    it('rejects a ray parallel to the line, which has no unique nearest point', () => {
        expect(rayToLine({ x: 11200, y: 2400, z: 0 }, UP, ANCHOR, UP)).toBeNull();
    });

    it('works on a ray angled down at the line, not only a level one', () => {
        const dir = normalize3({ x: -1, y: 0, z: -1 });
        const hit = rayToLine({ x: 11200, y: 2400, z: 10000 }, dir, ANCHOR, UP);
        // Descending 45 degrees over the 10 m run to the anchor: 10000 - 10000 = 0.
        expect(hit?.distanceMm).toBeCloseTo(0, 6);
        expect(hit?.pointMm.z).toBeCloseTo(0, 6);
    });
});

describe('rayToPoint', () => {
    // A wall's top corner: exactly what a roof needs to catch, off any plane the roof itself
    // is currently on.
    const CORNER = { x: 4800, y: 0, z: 2400 };

    it('measures zero for a ray aimed straight at the point', () => {
        const hit = rayToPoint({ x: 4800, y: -6000, z: 2400 }, { x: 0, y: 1, z: 0 }, CORNER);
        expect(hit?.distanceMm).toBeCloseTo(0, 6);
    });

    it('measures how far a ray passes a point it does not hit', () => {
        const hit = rayToPoint({ x: 4500, y: -6000, z: 2400 }, { x: 0, y: 1, z: 0 }, CORNER);
        expect(hit?.distanceMm).toBeCloseTo(300, 6);
    });

    it('rejects a point behind the eye', () => {
        expect(
            rayToPoint({ x: 4800, y: -6000, z: 2400 }, { x: 0, y: -1, z: 0 }, CORNER)
        ).toBeNull();
    });
});
