import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import { findLoopPath, findPlanarLoops, type Segment } from './loop-find';

const A: Point3Mm = { x: 0, y: 0, z: 0 };
const B: Point3Mm = { x: 4800, y: 0, z: 0 };
const C: Point3Mm = { x: 4800, y: 3600, z: 0 };
const D: Point3Mm = { x: 0, y: 3600, z: 0 };

describe('findLoopPath', () => {
    it('finds the chain of existing edges that the new segment closes into a loop', () => {
        const edges: Segment[] = [
            [A, B],
            [B, C],
            [C, D],
        ];
        // The fourth side, D → A: the chain back from A to D runs the other three.
        expect(findLoopPath(D, A, edges)).toEqual([A, B, C, D]);
    });

    it('ignores the new segment itself even when it is already among the edges', () => {
        const edges: Segment[] = [
            [A, B],
            [B, C],
            [C, D],
            [D, A],
        ];
        expect(findLoopPath(D, A, edges)).toEqual([A, B, C, D]);
        // Only the new segment joins them: no loop.
        expect(findLoopPath(A, B, [[A, B]])).toBeNull();
    });

    it('returns null when the ends are not connected by anything', () => {
        expect(findLoopPath(A, C, [[A, B]])).toBeNull();
        expect(findLoopPath(A, A, [[A, B]])).toBeNull();
    });

    it('takes the shortest loop when several close', () => {
        // A rectangle with an extra corner E on the long way round: A-B-C-D-A plus B-E-D.
        const E: Point3Mm = { x: 2400, y: 1800, z: 0 };
        const edges: Segment[] = [
            [A, B],
            [B, E],
            [E, D],
            [D, A],
            [C, D],
        ];
        // New segment B → C: back from C, the shortest way to B is C-D-A-B? No — C-D-E-B is
        // three edges too. Both are three; either is a loop of four vertices. Whichever it
        // picks, it must be a real chain from C to B.
        const path = findLoopPath(B, C, edges)!;
        expect(path[0]).toEqual(C);
        expect(path[path.length - 1]).toEqual(B);
        expect(path).toHaveLength(4);
    });

    it('connects by coincident millimetres, not by object identity', () => {
        const edges: Segment[] = [
            [
                { x: 0, y: 0, z: 0 },
                { x: 4800, y: 0, z: 0 },
            ],
            [
                { x: 4800, y: 0, z: 0 },
                { x: 4800, y: 3600, z: 0 },
            ],
        ];
        expect(findLoopPath({ x: 4800, y: 3600, z: 0 }, { x: 0, y: 0, z: 0 }, edges)).toHaveLength(
            3
        );
    });
});

const P = (x: number, y: number, z: number): Point3Mm => ({ x, y, z });
const keys = (ring: readonly Point3Mm[]) => ring.map((p) => `${p.x},${p.y},${p.z}`).sort();

describe('findPlanarLoops', () => {
    it('closes the fourth side of three', () => {
        const loops = findPlanarLoops(D, A, [
            [A, B],
            [B, C],
            [C, D],
        ]);
        expect(loops).toHaveLength(1);
        expect(keys(loops[0]!)).toEqual(keys([A, B, C, D]));
    });

    it('makes both halves when a line crosses a ring of lines', () => {
        const M = P(2400, 0, 0);
        const N = P(2400, 3600, 0);
        const loops = findPlanarLoops(M, N, [
            [A, M],
            [M, B],
            [B, C],
            [C, N],
            [N, D],
            [D, A],
        ]);
        expect(loops.map(keys).sort()).toEqual([keys([A, M, N, D]), keys([M, B, C, N])].sort());
    });

    it('finds the vertical face a line down from the eave closes with the ground', () => {
        // A flat roof's edges at 2400, and two lines already drawn: down a corner, along the ground.
        const roof: Segment[] = [
            [P(0, 0, 2400), P(4800, 0, 2400)],
            [P(4800, 0, 2400), P(4800, 3600, 2400)],
            [P(4800, 3600, 2400), P(0, 3600, 2400)],
            [P(0, 3600, 2400), P(0, 0, 2400)],
        ];
        const loops = findPlanarLoops(P(4800, 0, 0), P(4800, 0, 2400), [
            ...roof,
            [P(0, 0, 2400), P(0, 0, 0)],
            [P(0, 0, 0), P(4800, 0, 0)],
        ]);
        expect(loops).toHaveLength(1);
        expect(keys(loops[0]!)).toEqual(
            keys([P(0, 0, 0), P(4800, 0, 0), P(4800, 0, 2400), P(0, 0, 2400)])
        );
    });

    it('joins a line that ends part-way along an edge', () => {
        // A — B is one edge; the new line comes down onto its middle.
        const M = P(2400, 0, 0);
        const loops = findPlanarLoops(P(2400, 3600, 0), M, [
            [A, B],
            [A, D],
            [D, P(2400, 3600, 0)],
        ]);
        expect(loops).toHaveLength(1);
        expect(keys(loops[0]!)).toEqual(keys([A, M, P(2400, 3600, 0), D]));
    });

    it('finds nothing when the lines do not close', () => {
        expect(findPlanarLoops(A, B, [[B, C]])).toEqual([]);
    });
});
