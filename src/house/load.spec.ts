import { describe, expect, it } from 'vitest';
import { loadHouse } from './load';

/** A 10 × 8 m box on the module, with a partition at 5000 — off it. */
const house = {
    format: 'arch/1',
    wallHeightMm: 2800,
    walls: [{ points: [[0, 0], [10000, 0], [10000, 8000], [0, 8000], [0, 0]] }],
    roof: { type: 'flat', pitchDeg: 0 },
    interiorWalls: [{ points: [[5000, 0], [5000, 8000]] }],
};

const partitionX = (snapToModule?: boolean): number[] => {
    const loaded = loadHouse(house, snapToModule === undefined ? {} : { snapToModule });
    const listed = new Set(loaded.parsed.surfaces.map((s) => s.id));
    const partition = loaded.store.surfaces().find((s) => !listed.has(s.id))!;
    return [...new Set(partition.boundaryMm.map((p) => p.x))];
};

describe('loadHouse', () => {
    it('puts a partition on the module grid on a storey drawn to it', () => {
        expect(partitionX()).toEqual([4800]);
    });

    it('keeps it where the file put it with snapToModule: false', () => {
        expect(partitionX(false)).toEqual([5000]);
    });
});
