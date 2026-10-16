import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import type { Guide, Surface } from '../model';
import { pickAnchor, pickEdgeOrVertex, pickFaceEdge, pickGuide, pickPositions } from './pick';

/** A fake camera: plan view, 10 px per metre, no perspective. */
const project = (p: Point3Mm) => ({ x: p.x / 100, y: -p.y / 100 });

const FLOOR: Surface = {
    id: 's1',
    boundaryMm: [
        { x: 0, y: 0, z: 0 },
        { x: 7200, y: 0, z: 0 },
        { x: 7200, y: 9600, z: 0 },
        { x: 0, y: 9600, z: 0 },
    ],
    openings: [],
    holes: [],
    kindOverride: null,
    loadBearing: true,
    spanDirectionOverride: null,
    roofGroupId: null,
    studSectionOverride: null,
};

describe('pickEdgeOrVertex', () => {
    it('picks the vertex under the cursor, even though its edges are just as near', () => {
        const pick = pickEdgeOrVertex([FLOOR], { x: 73, y: 2 }, project, 12);
        expect(pick).toEqual({ kind: 'vertex', surfaceId: 's1', pointMm: { x: 7200, y: 0, z: 0 } });
    });

    it('picks an edge away from its ends', () => {
        const pick = pickEdgeOrVertex([FLOOR], { x: 36, y: 3 }, project, 12);
        expect(pick?.kind).toBe('edge');
        if (pick?.kind === 'edge') {
            expect(pickPositions(pick)).toEqual([
                { x: 0, y: 0, z: 0 },
                { x: 7200, y: 0, z: 0 },
            ]);
            expect(pickAnchor(pick)).toEqual({ x: 3600, y: 0, z: 0 });
        }
    });

    it('picks nothing in the middle of a face', () => {
        expect(pickEdgeOrVertex([FLOOR], { x: 36, y: -48 }, project, 12)).toBeNull();
    });
});

describe('pickGuide', () => {
    const GUIDES: Guide[] = [
        { id: 'g1', aMm: { x: 0, y: 0, z: 0 }, bMm: { x: 7200, y: 0, z: 0 } },
        { id: 'g2', aMm: { x: 0, y: 4800, z: 0 }, bMm: { x: 7200, y: 4800, z: 0 }, role: 'beam' },
    ];

    it('picks the nearest line within tolerance', () => {
        expect(pickGuide(GUIDES, { x: 36, y: -2 }, project, 12)).toBe('g1');
        expect(pickGuide(GUIDES, { x: 36, y: -46 }, project, 12)).toBe('g2');
    });

    it('misses when nothing is near enough', () => {
        expect(pickGuide(GUIDES, { x: 36, y: -24 }, project, 12)).toBeNull();
        expect(pickGuide([], { x: 0, y: 0 }, project, 12)).toBeNull();
    });
});

describe('pickFaceEdge', () => {
    it('names the edge nearest the cursor, even beside a corner', () => {
        expect(pickFaceEdge([FLOOR], { x: 70, y: 1 }, project, 12)).toEqual({
            aMm: { x: 0, y: 0, z: 0 },
            bMm: { x: 7200, y: 0, z: 0 },
        });
    });

    it('is null away from every edge', () => {
        expect(pickFaceEdge([FLOOR], { x: 36, y: -48 }, project, 12)).toBeNull();
    });
});
