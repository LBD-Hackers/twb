import { describe, expect, it } from 'vitest';
import {
    MEASURE_CONTINUE,
    parseAngleDeg,
    parseLengthMm,
    parseLengthsMm,
    pointAlong,
    signedByCursor,
} from './measure-input';

describe('parseLengthMm', () => {
    it('reads millimetres by default', () => {
        expect(parseLengthMm('3600')).toBe(3600);
        expect(parseLengthMm(' 3600 ')).toBe(3600);
        expect(parseLengthMm('-600')).toBe(-600);
    });

    it('accepts m and cm suffixes', () => {
        expect(parseLengthMm('3.6m')).toBe(3600);
        expect(parseLengthMm('120cm')).toBe(1200);
        expect(parseLengthMm('2400mm')).toBe(2400);
        expect(parseLengthMm('0.05m')).toBe(50);
    });

    it('rejects anything that is not a length', () => {
        expect(parseLengthMm('')).toBeNull();
        expect(parseLengthMm('-')).toBeNull();
        expect(parseLengthMm('abc')).toBeNull();
        expect(parseLengthMm('12x')).toBeNull();
    });
});

describe('parseAngleDeg', () => {
    it('reads the pitch units', () => {
        expect(parseAngleDeg('35g')).toBe(35);
        expect(parseAngleDeg('35gr')).toBe(35);
        expect(parseAngleDeg('35d')).toBe(35);
        expect(parseAngleDeg('35°')).toBe(35);
        expect(parseAngleDeg(' 22.5 g ')).toBe(22.5);
    });

    it('leaves a bare number a length — the suffix is the whole distinction', () => {
        expect(parseAngleDeg('35')).toBeNull();
        expect(parseAngleDeg('3600')).toBeNull();
        expect(parseLengthMm('35g')).toBeNull();
    });

    it('rejects anything that is not an angle', () => {
        expect(parseAngleDeg('')).toBeNull();
        expect(parseAngleDeg('g')).toBeNull();
        expect(parseAngleDeg('35m')).toBeNull();
    });

    it('lets its own units through the Measurements box', () => {
        // A unit letter is not a tool shortcut once a value is under way — the same reason
        // `m` and `c` are in there for millimetres and centimetres.
        for (const ch of ['g', 'r', 'd', '°']) expect(MEASURE_CONTINUE.test(ch)).toBe(true);
    });
});

describe('parseLengthsMm', () => {
    it('splits on comma or semicolon and keeps blanks as null', () => {
        expect(parseLengthsMm('1200,2400')).toEqual([1200, 2400]);
        expect(parseLengthsMm('1200;2400')).toEqual([1200, 2400]);
        expect(parseLengthsMm('1200')).toEqual([1200]);
        expect(parseLengthsMm(',2400')).toEqual([null, 2400]);
        expect(parseLengthsMm('1.2m,')).toEqual([1200, null]);
    });

    it('is null when any field is malformed', () => {
        expect(parseLengthsMm('1200,x')).toBeNull();
    });
});

describe('signedByCursor', () => {
    it('follows the cursor’s direction, and flips for a negative value', () => {
        expect(signedByCursor(600, 1800)).toBe(600);
        expect(signedByCursor(600, -50)).toBe(-600);
        expect(signedByCursor(-600, 1800)).toBe(-600);
        expect(signedByCursor(-600, -50)).toBe(600);
        expect(signedByCursor(600, 0)).toBe(600);
    });
});

describe('pointAlong', () => {
    it('walks the typed length toward the cursor, ignoring how far the cursor is', () => {
        const from = { x: 0, y: 0, z: 0 };
        expect(pointAlong(from, { x: 100, y: 0, z: 0 }, 3600)).toEqual({ x: 3600, y: 0, z: 0 });
        expect(pointAlong(from, { x: 0, y: 0, z: 9000 }, 2400)).toEqual({ x: 0, y: 0, z: 2400 });
    });

    it('rounds to integer millimetres', () => {
        const p = pointAlong({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, 1000);
        expect(p).toEqual({ x: 707, y: 707, z: 0 });
    });

    it('has no answer while the cursor sits on the start', () => {
        expect(pointAlong({ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 5 }, 1000)).toBeNull();
    });
});
