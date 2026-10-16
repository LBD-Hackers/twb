import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import type { Guide, Surface } from '../model';
import { boxModeOf, selectInBox } from './box-select';

/** A plan-view camera: 10 px per metre, y up the model is up the screen. */
const project = (p: Point3Mm) => ({ x: p.x / 100, y: -p.y / 100 });

const face = (id: string, x0: number, y0: number, x1: number, y1: number): Surface => ({
    id,
    boundaryMm: [
        { x: x0, y: y0, z: 0 },
        { x: x1, y: y0, z: 0 },
        { x: x1, y: y1, z: 0 },
        { x: x0, y: y1, z: 0 },
    ],
    openings: [],
    holes: [],
    kindOverride: null,
    loadBearing: true,
    spanDirectionOverride: null,
    roofGroupId: null,
    studSectionOverride: null,
});
// Screen x 0..10, y -10..0 for `a`; `b` sits to the right, x 20..30.
const A = face('a', 0, 0, 1000, 1000);
const B = face('b', 2000, 0, 3000, 1000);
const G: Guide = { id: 'g', aMm: { x: 1500, y: 500, z: 0 }, bMm: { x: 2500, y: 500, z: 0 } };

describe('box selection', () => {
    it('reads the drag direction: left to right is a window, right to left a crossing', () => {
        expect(boxModeOf({ x: 0, y: 0 }, { x: 10, y: 5 })).toBe('window');
        expect(boxModeOf({ x: 10, y: 0 }, { x: 0, y: 5 })).toBe('crossing');
    });

    it('a window takes only what is wholly inside', () => {
        const sel = selectInBox([A, B], [G], { x: -1, y: -11 }, { x: 22, y: 1 }, project);
        expect(sel).toEqual({ surfaceIds: ['a'], guideIds: [] });
    });

    it('a crossing takes everything it touches', () => {
        const sel = selectInBox([A, B], [G], { x: 25, y: -11 }, { x: 5, y: 1 }, project);
        expect(sel).toEqual({ surfaceIds: ['a', 'b'], guideIds: ['g'] });
    });

    it('a crossing inside a face touches it', () => {
        const sel = selectInBox([A, B], [G], { x: 6, y: -6 }, { x: 4, y: -4 }, project);
        expect(sel).toEqual({ surfaceIds: ['a'], guideIds: [] });
    });

    it('a window inside a face takes nothing', () => {
        const sel = selectInBox([A, B], [G], { x: 4, y: -6 }, { x: 6, y: -4 }, project);
        expect(sel).toEqual({ surfaceIds: [], guideIds: [] });
    });
});
