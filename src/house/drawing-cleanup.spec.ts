import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../surfacekit/core';
import { SurfaceStore, type Guide, type GuideId, type Surface } from '../surfacekit/model';
import { cleanDrawing, describeCleanup, drawingDuplicates, faceMerges } from './drawing-cleanup';
import { parseHouseFile } from './house-file';

const p = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });

function face(id: string, boundaryMm: Point3Mm[]): Surface {
    return {
        id,
        boundaryMm,
        openings: [],
        holes: [],
        kindOverride: null,
        loadBearing: true,
        spanDirectionOverride: null,
        roofGroupId: null,
        studSectionOverride: null,
    };
}

const guide = (id: string, a: Point3Mm, b: Point3Mm, role?: Guide['role']): Guide => ({
    id: id as GuideId,
    aMm: a,
    bMm: b,
    ...(role ? { role } : {}),
});

const deck = [p(0, 0, 2200), p(3600, 0, 2200), p(3600, 6000, 2200), p(0, 6000, 2200)];

describe('cleanDrawing', () => {
    it('keeps the first of a face drawn twice, whatever corner or direction the copy starts from', () => {
        const copy = [deck[2]!, deck[1]!, deck[0]!, deck[3]!];
        const { surfaces, removed } = cleanDrawing(
            [
                face('a', deck),
                face('b', copy),
                face(
                    'c',
                    deck.map((q) => ({ ...q, z: 0 }))
                ),
            ],
            []
        );
        expect(surfaces.map((s) => s.id)).toEqual(['a', 'c']);
        expect(removed).toEqual([{ kind: 'surface', id: 'b', sameAs: 'a' }]);
    });

    it('takes a guide drawn either way for the same guide, but not one declared something else', () => {
        const a = p(0, 0, 0);
        const b = p(0, 0, 2200);
        const { guides, removed } = cleanDrawing(
            [],
            [guide('g1', a, b), guide('g2', b, a), guide('g3', a, b, 'column')]
        );
        expect(guides.map((g) => g.id)).toEqual(['g1', 'g3']);
        expect(removed).toEqual([{ kind: 'guide', id: 'g2', sameAs: 'g1' }]);
    });

    it('finds the decks drawn twice over the garage-carport’s carport, and says so', () => {
        const file = parseHouseFile(readFileSync('fixtures/houses/garage-carport.json', 'utf8'));
        const found = drawingDuplicates(file.surfaces, file.guides);
        expect(found).toEqual([
            { kind: 'surface', id: 's15', sameAs: 's10' },
            { kind: 'surface', id: 's16', sameAs: 's11' },
        ]);
        expect(describeCleanup(found)).toBe(
            'Removed 2 faces drawn on top of another (s15 = s10, s16 = s11).'
        );
        expect(describeCleanup([])).toBe('Nothing to clean up.');
    });
});

describe('faceMerges', () => {
    /** A 4800 × 2400 wall along X, cut into two at x = 2400. */
    const left = [p(0, 0, 0), p(2400, 0, 0), p(2400, 0, 2400), p(0, 0, 2400)];
    const right = [p(2400, 0, 0), p(4800, 0, 0), p(4800, 0, 2400), p(2400, 0, 2400)];

    it('heals a wall cut in two for nothing', () => {
        expect(faceMerges([face('a', left), face('b', right)], [])).toEqual([
            { keep: 'a', drop: 'b' },
        ]);
    });

    it('keeps the cut where a partition butts into it', () => {
        const partition = face('c', [
            p(2400, 0, 0),
            p(2400, 3000, 0),
            p(2400, 3000, 2400),
            p(2400, 0, 2400),
        ]);
        expect(faceMerges([face('a', left), face('b', right), partition], [])).toEqual([]);
    });

    it('keeps the cut where a column is declared along it', () => {
        const column = guide('g', p(2400, 0, 0), p(2400, 0, 2400), 'column');
        expect(faceMerges([face('a', left), face('b', right)], [column])).toEqual([]);
        // A plain construction line is only scratch.
        const scratch = guide('g', p(2400, 0, 0), p(2400, 0, 2400));
        expect(faceMerges([face('a', left), face('b', right)], [scratch])).toHaveLength(1);
    });

    it('keeps faces apart that differ in more than their shape', () => {
        const pinned = { ...face('b', right), kindOverride: 'roof' as const };
        expect(faceMerges([face('a', left), pinned], [])).toEqual([]);
    });

    it('leaves faces that only touch at a corner, or lie in two planes', () => {
        const corner = face(
            'b',
            right.map((q) => ({ ...q, x: q.x + 2400, z: q.z + 2400 }))
        );
        const across = face('c', [p(0, 0, 0), p(0, 3000, 0), p(0, 3000, 2400), p(0, 0, 2400)]);
        expect(faceMerges([face('a', left), corner, across], [])).toEqual([]);
    });

    it('heals the gable partition drawn in six strips into one wall, and nothing else', () => {
        const file = parseHouseFile(readFileSync('fixtures/houses/split-walls.json', 'utf8'));
        const merges = faceMerges(file.surfaces, file.guides, file.storeys);
        expect(new Set(merges.map((m) => m.keep))).toEqual(new Set(['s7']));
        expect(merges.map((m) => m.drop).sort()).toEqual(['s10', 's11', 's12', 's8', 's9']);

        const store = new SurfaceStore();
        store.load(file.surfaces, file.guides, file.storeys);
        for (const m of merges) expect(store.mergeFaces(m.keep, m.drop).ok).toBe(true);
        expect(store.surfaces()).toHaveLength(file.surfaces.length - 5);
        // One outline: the foot, the two ends, and the top where it changes slope — the straight
        // corners the strips left along the foot and the slopes are gone.
        const wall = store.get('s7' as Surface['id'])!;
        expect(wall.boundaryMm.length).toBeLessThanOrEqual(6);
        expect(faceMerges(store.surfaces(), store.guides(), store.storeys())).toEqual([]);
        expect(describeCleanup([], merges)).toBe(
            `Healed 5 faces into 1 (${merges.map((m) => `${m.drop} → ${m.keep}`).join(', ')}).`
        );
    });

    it('keeps a partition one face per storey', () => {
        const file = parseHouseFile(readFileSync('fixtures/houses/vent-2storey.json', 'utf8'));
        const clean = cleanDrawing(file.surfaces, file.guides);
        expect(faceMerges(clean.surfaces, clean.guides, file.storeys)).toEqual([]);
        // With no deck drawn between the storeys, the storey line alone keeps them apart.
        const walls = clean.surfaces.filter((s) => s.id === 'i0' || s.id === 'i1');
        expect(faceMerges(walls, [], file.storeys)).toEqual([]);
        expect(faceMerges(walls, [])).toHaveLength(1);
    });

    it('keeps a wall cut where a floor deck runs through it', () => {
        const low = [p(0, 0, 0), p(4800, 0, 0), p(4800, 0, 2400), p(0, 0, 2400)];
        const high = [p(0, 0, 2400), p(4800, 0, 2400), p(4800, 0, 4800), p(0, 0, 4800)];
        const deck = face('d', [
            p(-1000, -1000, 2400),
            p(6000, -1000, 2400),
            p(6000, 3000, 2400),
            p(-1000, 3000, 2400),
        ]);
        expect(faceMerges([face('a', low), face('b', high), deck], [])).toEqual([]);
    });
});
