import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import {
    MAX_COORDINATE_CORRECTION_MM,
    nearestModularCoordinateMm,
    validateModularRing,
} from './grid-validate';
import { isModularMm } from './module-grid';

function rect(widthMm: number, depthMm: number): Point3Mm[] {
    return [
        { x: 0, y: 0, z: 0 },
        { x: widthMm, y: 0, z: 0 },
        { x: widthMm, y: depthMm, z: 0 },
        { x: 0, y: depthMm, z: 0 },
    ];
}

function edgeLengths(ring: readonly Point3Mm[]): number[] {
    return ring.map((a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        return Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    });
}

describe('nearestModularCoordinateMm', () => {
    it('leaves a modular coordinate alone', () => {
        for (const n of [0, 400, 600, 1200, 7200, -2400]) {
            expect(nearestModularCoordinateMm(n)).toBe(n);
        }
    });

    it('uses the same grid on both sides of the origin', () => {
        // A building drawn across the origin would otherwise sit on two different grids.
        expect(nearestModularCoordinateMm(-7300)).toBe(-nearestModularCoordinateMm(7300));
    });

    it('is never more than half the finest subdivision away', () => {
        // This is why coordinate correction can never fail: multiples of 400 are 400 apart.
        for (let v = -3000; v <= 3000; v += 7) {
            expect(Math.abs(nearestModularCoordinateMm(v) - v)).toBeLessThanOrEqual(
                MAX_COORDINATE_CORRECTION_MM
            );
        }
    });
});

describe('validateModularRing', () => {
    it('accepts a modular rectangle unchanged', () => {
        const ring = rect(7200, 9600);
        const result = validateModularRing(ring);
        expect(result.ok).toBe(true);
        expect(result.correctedMm).toEqual(ring);
        expect(result.maxCorrectionMm).toBe(0);
    });

    it('rejects a ring with too few corners', () => {
        const result = validateModularRing([
            { x: 0, y: 0, z: 0 },
            { x: 1200, y: 0, z: 0 },
        ]);
        expect(result.ok).toBe(false);
        expect(result.violations[0]?.code).toBe('too-few-vertices');
        expect(result.correctedMm).toBeNull();
    });

    it('corrects a non-modular rectangle and keeps it closed and rectangular', () => {
        // The bug that motivated the rewrite: correcting edge lengths cumulatively left the
        // ring open. Snapping vertices independently cannot.
        const result = validateModularRing(rect(7250, 9650));
        expect(result.ok).toBe(true);
        const ring = result.correctedMm!;
        expect(ring[0]!.x).toBe(ring[3]!.x);
        expect(ring[1]!.x).toBe(ring[2]!.x);
        expect(ring[0]!.y).toBe(ring[1]!.y);
        expect(ring[2]!.y).toBe(ring[3]!.y);
    });

    it('leaves every axis-aligned edge modular after correction', () => {
        // The guarantee the module exists for: nothing non-modular reaches the model.
        for (const [w, d] of [
            [7250, 9650],
            [7300, 9500],
            [7500, 10_100],
            [3970, 6010],
        ]) {
            const result = validateModularRing(rect(w!, d!));
            expect(result.ok, `${w} x ${d}`).toBe(true);
            for (const len of edgeLengths(result.correctedMm!)) {
                expect(isModularMm(len), `${w} x ${d} produced a ${len} mm edge`).toBe(true);
            }
        }
    });

    it('reports how far it moved things, so the UI can say so', () => {
        const result = validateModularRing(rect(7250, 9650));
        expect(result.maxCorrectionMm).toBeGreaterThan(0);
        expect(result.maxCorrectionMm).toBeLessThanOrEqual(
            Math.hypot(MAX_COORDINATE_CORRECTION_MM, MAX_COORDINATE_CORRECTION_MM)
        );
    });

    it('rejects two corners that collapse onto the same grid position', () => {
        // The one failure snapping cannot fix: merging them would change the shape.
        const result = validateModularRing([
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 0, z: 0 },
            { x: 2400, y: 0, z: 0 },
            { x: 2400, y: 2400, z: 0 },
            { x: 0, y: 2400, z: 0 },
        ]);
        expect(result.ok).toBe(false);
        expect(result.violations.some((v) => v.code === 'collapsed-vertex')).toBe(true);
        expect(result.correctedMm).toBeNull();
    });

    it('names the offending corner index for highlighting', () => {
        const result = validateModularRing([
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 0, z: 0 },
            { x: 2400, y: 0, z: 0 },
            { x: 2400, y: 2400, z: 0 },
            { x: 0, y: 2400, z: 0 },
        ]);
        expect(result.violations[0]?.index).toBe(0);
    });

    it('accepts a diagonal edge with its real, non-modular length', () => {
        // hypot(1200,1200) = 1697, which no grid can make modular. Rejecting it would mean
        // rejecting every angled wall in the system.
        const result = validateModularRing([
            { x: 0, y: 0, z: 0 },
            { x: 2400, y: 0, z: 0 },
            { x: 1200, y: 1200, z: 0 },
        ]);
        expect(result.ok).toBe(true);
    });

    it('leaves heights alone — the grid is a constraint in plan only', () => {
        // A 2450 storey, a ridge at whatever the pitch gives: heights are not sheet widths.
        const result = validateModularRing([
            { x: 0, y: 0, z: 0 },
            { x: 2400, y: 0, z: 0 },
            { x: 2400, y: 0, z: 2450 },
            { x: 0, y: 0, z: 2450 },
        ]);
        expect(result.ok).toBe(true);
        expect(result.correctedMm![2]!.z).toBe(2450);
        expect(result.maxCorrectionMm).toBe(0);
    });

    it('snaps a sloped face in plan without touching its pitch', () => {
        const result = validateModularRing([
            { x: 0, y: 0, z: 2400 },
            { x: 3610, y: 0, z: 2400 },
            { x: 3610, y: 9600, z: 3900 },
            { x: 0, y: 9600, z: 3900 },
        ]);
        expect(result.ok).toBe(true);
        expect(result.correctedMm![1]).toEqual({ x: 3600, y: 0, z: 2400 });
        expect(result.correctedMm![2]).toEqual({ x: 3600, y: 9600, z: 3900 });
    });
});

describe('the module not enforced', () => {
    // The commit half of the grid toggle. Correcting geometry here while the cursor was
    // deliberately drawing free dimensions would silently undo the user's work.
    const FREE_RING = [
        { x: 0, y: 0, z: 0 },
        { x: 4737, y: 0, z: 0 },
        { x: 4737, y: 2913, z: 0 },
        { x: 0, y: 2913, z: 0 },
    ];

    it('leaves every coordinate exactly as drawn', () => {
        const result = validateModularRing(FREE_RING, { enforceModule: false });
        expect(result.ok).toBe(true);
        expect(result.correctedMm).toEqual(FREE_RING);
        expect(result.maxCorrectionMm).toBe(0);
    });

    it('corrects the same ring when the module is enforced', () => {
        const result = validateModularRing(FREE_RING);
        expect(result.correctedMm).not.toEqual(FREE_RING);
        expect(result.maxCorrectionMm).toBeGreaterThan(0);
    });

    it('still rejects a ring that is structurally broken', () => {
        const result = validateModularRing(
            [
                { x: 0, y: 0, z: 0 },
                { x: 10, y: 0, z: 0 },
                { x: 10, y: 2913, z: 0 },
            ],
            { enforceModule: false }
        );
        expect(result.ok).toBe(false);
        expect(result.violations[0]?.code).toBe('degenerate-edge');
    });
});
