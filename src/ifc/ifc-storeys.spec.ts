import { describe, expect, it } from 'vitest';
import { mergeShortLevels } from './ifc-to-house';

/** BLOX's levels as Revit writes them, mm, each with the walls and rooms standing on it. */
const blox = [
    { name: 'Level B3', elev: 0, on: 3 },
    { name: 'Level B2', elev: 8790, on: 168 },
    { name: 'Level B1', elev: 11960, on: 83 },
    { name: 'Level B1 EXH-2', elev: 12640, on: 10 },
    { name: 'Level 0', elev: 15710, on: 133 },
    { name: 'Level 0 Plaza', elev: 15865, on: 26 },
    { name: 'Line 1', elev: 19970, on: 3 },
    { name: 'Level 1', elev: 21170, on: 148 },
    { name: 'Level 1M', elev: 23180, on: 53 },
    { name: 'Line 2', elev: 24190, on: 1 },
    { name: 'Level 2', elev: 25470, on: 345 },
    { name: 'Level 3', elev: 29690, on: 244 },
    { name: 'Level 4', elev: 33950, on: 572 },
    { name: 'Line 5', elev: 37630, on: 37 },
    { name: 'Level 5', elev: 38290, on: 418 },
];
type Level = (typeof blox)[number];
const weight = (l: Level) => l.on;
const names = (ls: readonly Level[]) => ls.map((l) => l.name);

describe('mergeShortLevels', () => {
    it('keeps levels with room over them as they are', () => {
        const levels = [blox[0]!, blox[1]!, blox[4]!];
        expect(mergeShortLevels(levels, weight)).toEqual({ kept: levels, merged: [] });
    });

    it('makes the levels too close to stand in between one storey, the one with most on it', () => {
        const { kept, merged } = mergeShortLevels(blox, weight);
        expect(names(kept)).toEqual([
            'Level B3',
            'Level B2',
            'Level B1',
            'Level 0',
            'Level 1',
            'Level 1M',
            'Level 2',
            'Level 3',
            'Level 4',
            'Level 5',
        ]);
        expect(merged.map(([gone, into]) => `${gone.name} > ${into.name}`)).toEqual([
            'Level 0 Plaza > Level 0',
            'Line 5 > Level 5',
            'Level B1 EXH-2 > Level B1',
            'Line 2 > Level 1M',
            'Line 1 > Level 1',
        ]);
    });

    it('keeps a mezzanine with room under and over it once its datum line is gone', () => {
        const { kept } = mergeShortLevels(blox.slice(7, 11), weight);
        expect(names(kept)).toEqual(['Level 1', 'Level 1M', 'Level 2']);
    });

    it('merges a run of levels closer than a storey one at a time, closest first', () => {
        const run = [
            { name: 'a', elev: 0, on: 5 },
            { name: 'b', elev: 1000, on: 1 },
            { name: 'c', elev: 1500, on: 9 },
            { name: 'd', elev: 5000, on: 2 },
        ];
        const { kept, merged } = mergeShortLevels(run, (l) => l.on);
        expect(kept.map((l) => l.name)).toEqual(['c', 'd']);
        expect(merged.map(([g, i]) => `${g.name}>${i.name}`)).toEqual(['b>c', 'a>c']);
    });
});
