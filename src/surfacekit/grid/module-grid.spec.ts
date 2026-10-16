import { describe, expect, it } from 'vitest';
import {
    MODULE_MM,
    isModularMm,
    modularPositionsMm,
    nearestModularMm,
    snapMm,
    subdivideSpanMm,
} from './module-grid';

describe('snapMm', () => {
    it('rounds onto the pitch', () => {
        expect(snapMm(1250, MODULE_MM)).toBe(1200);
        expect(snapMm(1810, 600)).toBe(1800);
        expect(snapMm(-1250, MODULE_MM)).toBe(-1200);
    });
});

describe('isModularMm', () => {
    it('accepts multiples of the module and of its permitted subdivisions', () => {
        expect(isModularMm(1200)).toBe(true);
        expect(isModularMm(7200)).toBe(true);
        expect(isModularMm(1800)).toBe(true); // 3 x 600
        expect(isModularMm(800)).toBe(true); // 2 x 400
        expect(isModularMm(400)).toBe(true);
    });

    it('rejects lengths the system cannot sheet', () => {
        // The acceptance walkthrough's case: 7300 must not pass where 7200 does.
        expect(isModularMm(7300)).toBe(false);
        expect(isModularMm(1000)).toBe(false);
        expect(isModularMm(1500)).toBe(false);
    });

    it('rejects zero and negative lengths', () => {
        expect(isModularMm(0)).toBe(false);
        expect(isModularMm(-1200)).toBe(false);
    });
});

describe('nearestModularMm', () => {
    it('returns a modular length unchanged', () => {
        for (const n of [400, 600, 800, 1200, 1800, 7200]) {
            expect(nearestModularMm(n)).toBe(n);
        }
    });

    it('corrects a non-modular length to something modular', () => {
        expect(isModularMm(nearestModularMm(7300))).toBe(true);
        expect(isModularMm(nearestModularMm(1001))).toBe(true);
        expect(nearestModularMm(7300)).toBe(7200);
    });

    it('prefers the coarser pitch on a tie', () => {
        // 1000 is 200 from 1200 (one module) and 200 from 800 (two 400s). The module wins:
        // in a system built to land sheet edges, rounding to the full module is the better
        // default, and making the tie deterministic keeps auto-correction predictable.
        expect(nearestModularMm(1000)).toBe(1200);
    });

    it('never returns zero', () => {
        // A length that rounds to nothing becomes the finest subdivision — a zero-length wall
        // is not a useful auto-correction.
        expect(nearestModularMm(10)).toBeGreaterThan(0);
        expect(isModularMm(nearestModularMm(10))).toBe(true);
    });
});

describe('subdivideSpanMm', () => {
    it('returns no interior positions when the span already fits', () => {
        expect(subdivideSpanMm(2400, 2400)).toEqual([]);
        expect(subdivideSpanMm(1000, 2400)).toEqual([]);
    });

    it('divides into equal bays, none wider than the limit', () => {
        const positions = subdivideSpanMm(7000, 2400);
        expect(positions).toHaveLength(2); // 3 bays
        const edges = [0, ...positions, 7000];
        for (let i = 1; i < edges.length; i++) {
            expect(edges[i]! - edges[i - 1]!).toBeLessThanOrEqual(2400);
        }
    });

    it('produces equal bays rather than a runt remainder', () => {
        // 7000 / 2400 would leave 2400, 2400, 2200. Equal thirds is what a carpenter sets out.
        const positions = subdivideSpanMm(7000, 2400);
        const edges = [0, ...positions, 7000];
        const widths = edges.slice(1).map((e, i) => e - edges[i]!);
        for (const w of widths) expect(w).toBeCloseTo(widths[0]!, 6);
    });
});

describe('modularPositionsMm', () => {
    it('aligns to the global grid, not to the start of the range', () => {
        // Starting at 500 with a 600 pitch must give 600, 1200, ... — NOT 500, 1100, ...
        // This is what makes two adjacent floors share one continuous joist grid.
        expect(modularPositionsMm(500, 2000, 600)).toEqual([600, 1200, 1800]);
    });

    it('is continuous across two abutting ranges', () => {
        const left = modularPositionsMm(0, 3600, 600);
        const right = modularPositionsMm(3600, 7200, 600);
        const combined = [...new Set([...left, ...right])].sort((a, b) => a - b);
        for (let i = 1; i < combined.length; i++) {
            expect(combined[i]! - combined[i - 1]!).toBe(600);
        }
    });

    it('returns nothing for an inverted or zero range', () => {
        expect(modularPositionsMm(2000, 1000, 600)).toEqual([]);
        expect(modularPositionsMm(0, 1000, 0)).toEqual([]);
    });
});
