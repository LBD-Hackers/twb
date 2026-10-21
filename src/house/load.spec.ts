import { describe, expect, it } from 'vitest';
import { fromTwbHouse } from './house-jsonld';
import { loadHouse, serializeLoadedHouse } from './load';

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

describe('loadHouse: a partition of another kind or build-up', () => {
    const typed = {
        ...house,
        interiorWalls: [
            { points: [[5000, 0], [5000, 8000]], partition: 'party' },
            { points: [[0, 4000], [5000, 4000]], buildUpType: 'interiorWall:plumbing' },
            { points: [[5000, 4000], [10000, 4000]], buildUpType: 'interiorWall:gone' },
        ],
        envelope: {
            interiorWall: { layers: [{ material: 'gypsum', thickness: 124, core: true }] },
            'interiorWall:plumbing': {
                name: 'Plumbing',
                layers: [{ material: 'gypsum', thickness: 184, core: true }],
            },
        },
    };

    it('builds its faces as that kind, dressed in that build-up', () => {
        const loaded = loadHouse(typed, { snapToModule: false });
        const listed = new Set(loaded.parsed.surfaces.map((s) => s.id));
        const faces = loaded.store.surfaces().filter((s) => !listed.has(s.id));
        expect(faces.filter((s) => s.partitionKind === 'party').length).toBeGreaterThan(0);
        expect(faces.filter((s) => s.buildUpType === 'interiorWall:plumbing').length).toBeGreaterThan(0);
        expect(faces.every((s) => s.buildUpType !== 'interiorWall:gone')).toBe(true);
    });

    it('says a pin to a build-up the file does not have is left out', () => {
        const loaded = loadHouse(typed, { snapToModule: false });
        expect(loaded.problems.join(' ')).toContain('"interiorWall:gone" is not a build-up in "envelope"');
    });

    it('writes both back on its faces', () => {
        const loaded = loadHouse(typed, { snapToModule: false });
        const saved = JSON.parse(serializeLoadedHouse(loaded)) as Record<string, unknown>;
        const text = JSON.stringify(saved);
        expect(text).toContain('"party"');
        expect(text).toContain('recipe/interiorWall:plumbing');
        // A type keeps its name, as `rdfs:label` on its recipe.
        expect(fromTwbHouse(saved)['envelope']).toMatchObject({
            'interiorWall:plumbing': { name: 'Plumbing' },
        });
        const reopened = loadHouse(saved, { snapToModule: false });
        expect(reopened.store.surfaces().some((s) => s.partitionKind === 'party')).toBe(true);
        expect(reopened.store.surfaces().some((s) => s.buildUpType === 'interiorWall:plumbing')).toBe(
            true
        );
    });
});

describe('loadHouse: window and door types', () => {
    const typed = {
        ...house,
        openings: [
            { kind: 'window', at: [2400, 0], widthMm: 1200, heightMm: 1200, typeId: 'window-2' },
            { kind: 'window', at: [7200, 0], widthMm: 1200, heightMm: 1200 },
            { kind: 'door', at: [2400, 8000], widthMm: 1000, heightMm: 2100, typeId: 'door-9' },
        ],
        fenestrationTypes: [
            { id: 'window-2', slot: 'window', label: 'Fixed glazing', uWm2K: 0.8, glazingLayers: 3 },
        ],
    };

    it('pins each opening to its type, and its kind’s default where it names none', () => {
        const loaded = loadHouse(typed, { snapToModule: false });
        const openings = loaded.store.surfaces().flatMap((s) => s.openings);
        expect(openings.filter((o) => o.typeId === 'window-2')).toHaveLength(1);
        expect(openings.filter((o) => o.kind === 'window' && !o.typeId)).toHaveLength(1);
    });

    it('says a pin to a type the file does not have is left out', () => {
        const loaded = loadHouse(typed, { snapToModule: false });
        expect(loaded.problems.join(' ')).toContain('pinned to "door-9", which is not in "fenestrationTypes"');
        expect(loaded.store.surfaces().flatMap((s) => s.openings).some((o) => o.typeId === 'door-9')).toBe(false);
    });

    it('writes the types and the pins back, the type as an OpeningType', () => {
        const loaded = loadHouse(typed, { snapToModule: false });
        const saved = JSON.parse(serializeLoadedHouse(loaded)) as Record<string, unknown>;
        expect(saved['fenestrationTypes']).toEqual([
            expect.objectContaining({ type: 'OpeningType', id: 'opening-type/window-2', name: 'Fixed glazing', uWm2K: 0.8 }),
        ]);
        expect(JSON.stringify(saved)).toContain('"ofType":"opening-type/window-2"');
        expect(fromTwbHouse(saved)['fenestrationTypes']).toEqual([
            { id: 'window-2', label: 'Fixed glazing', slot: 'window', uWm2K: 0.8, glazingLayers: 3 },
        ]);
        const reopened = loadHouse(saved, { snapToModule: false });
        expect(reopened.problems).toEqual([]);
        expect(reopened.store.surfaces().flatMap((s) => s.openings).filter((o) => o.typeId === 'window-2')).toHaveLength(1);
    });
});
