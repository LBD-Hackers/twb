import { describe, expect, it } from 'vitest';
import { sortStoreys, storeyAt, storeysFrom, topStorey, type Storey } from './storey';

const GROUND: Storey = { id: 'st1', name: 'Ground floor', elevationMm: 0, heightMm: 2400 };
const FIRST: Storey = { id: 'st2', name: '1st floor', elevationMm: 2400, heightMm: 2400 };
const SECOND: Storey = { id: 'st3', name: '2nd floor', elevationMm: 4800, heightMm: 2400 };
const UNSORTED = [SECOND, GROUND, FIRST];

describe('sortStoreys', () => {
    it('orders by elevation regardless of input order', () => {
        expect(sortStoreys(UNSORTED)).toEqual([GROUND, FIRST, SECOND]);
    });
});

describe('topStorey', () => {
    it('is the highest storey, or null with none', () => {
        expect(topStorey(UNSORTED)).toEqual(SECOND);
        expect(topStorey([])).toBeNull();
    });
});

describe('storeyAt', () => {
    it('finds the storey a height falls within', () => {
        expect(storeyAt(UNSORTED, 0)).toEqual(GROUND);
        expect(storeyAt(UNSORTED, 1200)).toEqual(GROUND);
        expect(storeyAt(UNSORTED, 2400)).toEqual(FIRST);
        expect(storeyAt(UNSORTED, 4900)).toEqual(SECOND);
    });

    it('below the lowest storey still resolves to it, not to nothing', () => {
        expect(storeyAt(UNSORTED, -500)).toEqual(GROUND);
    });

    it('above the top storey resolves to the top storey — a roof has no storey of its own', () => {
        expect(storeyAt(UNSORTED, 9000)).toEqual(SECOND);
    });
});

describe('storeysFrom', () => {
    it('is the given storey and every one above it, lowest first', () => {
        expect(storeysFrom(UNSORTED, FIRST)).toEqual([FIRST, SECOND]);
        expect(storeysFrom(UNSORTED, GROUND)).toEqual([GROUND, FIRST, SECOND]);
        expect(storeysFrom(UNSORTED, SECOND)).toEqual([SECOND]);
    });
});
