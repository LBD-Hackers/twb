import { describe, expect, it } from 'vitest';
import { storeysAfterPull } from './storey-follow';
import type { Storey } from './storey';

const GROUND: Storey = { id: 'st1', name: 'Ground floor', elevationMm: 0, heightMm: 2400 };
const mint = (elevationMm: number, heightMm: number): Storey => ({
    id: 'new',
    name: 'New',
    elevationMm,
    heightMm,
});

describe('storeysAfterPull', () => {
    it('adds a storey for a box standing a storey above the top one', () => {
        const next = storeysAfterPull(
            [GROUND],
            [],
            { mode: 'box', fromZMm: 2700, toZMm: 5100 },
            mint
        );
        expect(next).toEqual([
            { ...GROUND, heightMm: 2700 },
            { id: 'new', name: 'New', elevationMm: 2700, heightMm: 2400 },
        ]);
    });

    it('a low box — a plinth, a parapet — is not a storey', () => {
        expect(
            storeysAfterPull([GROUND], [], { mode: 'box', fromZMm: 2400, toZMm: 3000 }, mint)
        ).toBeNull();
    });

    it('a box pulled down below the ground is not a storey', () => {
        expect(
            storeysAfterPull([GROUND], [], { mode: 'box', fromZMm: 0, toZMm: -2400 }, mint)
        ).toBeNull();
    });

    it('a floor stretched through the storey above is left alone', () => {
        const first: Storey = { id: 'st2', name: '1st', elevationMm: 2400, heightMm: 2400 };
        expect(
            storeysAfterPull(
                [GROUND, first],
                [],
                { mode: 'stretch', fromZMm: 2400, toZMm: 1000 },
                mint
            )
        ).toBeNull();
    });
});
