import { describe, expect, it } from 'vitest';
import { SurfaceStore, classifyAll, fitWallsToRoof, surfaceFrame } from '../surfacekit/model';
import { parseHouseFile } from './house-file';

const RECT_WALLS = [
    {
        id: 'south',
        points: [
            [0, 0],
            [9600, 0],
        ],
    },
    {
        id: 'east',
        points: [
            [9600, 0],
            [9600, 7200],
        ],
    },
    {
        id: 'north',
        points: [
            [9600, 7200],
            [0, 7200],
        ],
    },
    {
        id: 'west',
        points: [
            [0, 7200],
            [0, 0],
        ],
    },
];

const L_WALLS = [
    {
        points: [
            [0, 0],
            [12000, 0],
            [12000, 4800],
            [4800, 4800],
            [4800, 12000],
            [0, 12000],
            [0, 0],
        ],
    },
];

/** Parses a simple house and loads it into a store, the way Open does. */
function load(house: Record<string, unknown>) {
    const parsed = parseHouseFile(JSON.stringify({ format: 'arch/1', ...house }));
    const store = new SurfaceStore();
    const result = store.load(parsed.surfaces, parsed.guides, parsed.storeys);
    const surfaces = store.surfaces();
    const kinds = classifyAll(surfaces);
    const byId = new Map(surfaces.map((s) => [s.id, s]));
    return { parsed, result, surfaces, kinds, byId };
}

/** Whether the walls already stand up to the roof: roof mode's Save would grow none of them. */
function wallsMeetRoof(surfaces: ReturnType<typeof load>['surfaces']): boolean {
    const kinds = classifyAll(surfaces);
    const roofIds = new Set(surfaces.filter((s) => kinds.get(s.id) === 'roof').map((s) => s.id));
    return fitWallsToRoof(surfaces, { roofIds, interior: false }).length === 0;
}

describe('the simple house shape', () => {
    it('builds a gable house from four wall lines, a height and a pitch', () => {
        const { parsed, result, kinds, byId, surfaces } = load({
            wallHeightMm: 2400,
            walls: RECT_WALLS,
            roof: { type: 'gable', pitchDeg: 30 },
        });
        expect(parsed.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(kinds.get('floor')).toBe('floor');
        expect([...kinds.values()].filter((k) => k === 'roof')).toHaveLength(2);
        // The ridge runs along x, so the east and west walls are the gables.
        const ridge = Math.round(2400 + 3600 * Math.tan(Math.PI / 6));
        expect(byId.get('wall-west')!.boundaryMm).toContainEqual({ x: 0, y: 3600, z: ridge });
        expect(byId.get('wall-east')!.boundaryMm).toContainEqual({ x: 9600, y: 3600, z: ridge });
        expect(byId.get('wall-south')!.boundaryMm).toHaveLength(4);
        expect(wallsMeetRoof(surfaces)).toBe(true);
    });

    it('puts each opening centred on its wall, at its sill', () => {
        const { parsed, byId } = load({
            wallHeightMm: 2400,
            walls: RECT_WALLS,
            openings: [
                { kind: 'window', at: [2400, 0], widthMm: 1200, heightMm: 1200, sillMm: 900 },
                { kind: 'door', at: [9600, 3600], widthMm: 1000, heightMm: 2100 },
                { at: [4800, 7150], widthMm: 1800, heightMm: 1000 },
            ],
            roof: { type: 'gable', pitchDeg: 30 },
        });
        expect(parsed.errors).toEqual([]);
        const window = byId.get('wall-south')!.openings[0]!;
        expect(window).toMatchObject({
            kind: 'window',
            uMm: 1800,
            vMm: 900,
            widthMm: 1200,
            heightMm: 1200,
        });
        const door = byId.get('wall-east')!.openings[0]!;
        expect(door).toMatchObject({ kind: 'door', vMm: 0, widthMm: 1000, heightMm: 2100 });
        // A window with no sill gets the default one, on the wall nearest its `at`.
        const north = byId.get('wall-north')!;
        expect(north.openings[0]).toMatchObject({ kind: 'window', vMm: 900, widthMm: 1800 });
        expect(surfaceFrame(north.boundaryMm)).not.toBeNull();
    });

    it('roofs an L with valleys, and grows every gable to it', () => {
        const { parsed, result, surfaces, kinds } = load({
            wallHeightMm: 2500,
            walls: L_WALLS,
            roof: { type: 'gable', pitchDeg: 25 },
        });
        expect(parsed.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect([...kinds.values()].filter((k) => k === 'roof')).toHaveLength(5);
        expect([...kinds.values()].filter((k) => k === 'wall')).toHaveLength(6);
        expect(wallsMeetRoof(surfaces)).toBe(true);
    });

    it('splits the walls at each storey and puts the openings on theirs', () => {
        const { parsed, result, byId, surfaces } = load({
            storeys: [
                { name: 'Ground floor', elevationMm: 0, heightMm: 2700 },
                { name: '1st floor', elevationMm: 2700, heightMm: 2400 },
            ],
            wallHeightMm: 3600,
            walls: RECT_WALLS,
            openings: [
                { kind: 'door', at: [4800, 0], widthMm: 1000, heightMm: 2100 },
                { at: [4800, 0], widthMm: 800, heightMm: 600, sillMm: 200, storey: '1st floor' },
            ],
            roof: { type: 'gable', pitchDeg: 40 },
        });
        expect(parsed.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(byId.get('floor-1st-floor')!.boundaryMm.every((p) => p.z === 2700)).toBe(true);
        const ground = byId.get('wall-south-ground-floor')!;
        const upper = byId.get('wall-south-1st-floor')!;
        expect(Math.max(...ground.boundaryMm.map((p) => p.z))).toBe(2700);
        expect(Math.min(...upper.boundaryMm.map((p) => p.z))).toBe(2700);
        expect(ground.openings.map((o) => o.kind)).toEqual(['door']);
        expect(upper.openings[0]).toMatchObject({ kind: 'window', vMm: 200 });
        expect(wallsMeetRoof(surfaces)).toBe(true);
    });

    it('roofs each part of the house on its own, the shared wall following the higher one', () => {
        const { parsed, result, byId } = load({
            wallHeightMm: 2400,
            walls: [
                {
                    points: [
                        [0, 0],
                        [9600, 0],
                        [9600, 7200],
                        [0, 7200],
                        [0, 0],
                    ],
                },
                {
                    id: 'annex',
                    points: [
                        [9600, 1200],
                        [13200, 1200],
                        [13200, 6000],
                        [9600, 6000],
                    ],
                },
            ],
            roof: [
                {
                    type: 'gable',
                    pitchDeg: 35,
                    outline: [
                        [0, 0],
                        [9600, 0],
                        [9600, 7200],
                        [0, 7200],
                    ],
                },
                {
                    type: 'shed',
                    pitchDeg: 8,
                    highSide: 'west',
                    outline: [
                        [9600, 1200],
                        [13200, 1200],
                        [13200, 6000],
                        [9600, 6000],
                    ],
                },
            ],
        });
        expect(parsed.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        // The main house's east gable is whole, above the annex's roof as well.
        const gable = byId.get('wall-1-2')!;
        expect(gable.boundaryMm).toHaveLength(5);
        const annexRoof = byId.get('roof-2-1')!;
        expect(Math.max(...annexRoof.boundaryMm.map((p) => p.z))).toBeLessThan(
            Math.max(...gable.boundaryMm.map((p) => p.z))
        );
    });

    it('lets a roof reach past the walls, over a carport', () => {
        const { parsed, result, byId } = load({
            wallHeightMm: 2400,
            walls: RECT_WALLS,
            roof: {
                type: 'gable',
                pitchDeg: 30,
                outline: [
                    [0, 0],
                    [13200, 0],
                    [13200, 7200],
                    [0, 7200],
                ],
            },
        });
        expect(parsed.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        // The east wall stands under the roof, off its edge: it still rises to the ridge.
        const ridge = Math.round(2400 + 3600 * Math.tan(Math.PI / 6));
        expect(Math.max(...byId.get('wall-east')!.boundaryMm.map((p) => p.z))).toBe(ridge);
    });

    it('runs one roof on over a recessed entrance, the walls round it rising to meet it', () => {
        const { parsed, result, kinds, byId } = load({
            wallHeightMm: 2400,
            walls: [
                {
                    points: [
                        [0, 0],
                        [4800, 0],
                        [4800, 2400],
                        [9600, 2400],
                        [9600, 0],
                        [18000, 0],
                        [18000, 8400],
                        [0, 8400],
                        [0, 0],
                    ],
                },
            ],
            roof: { type: 'gable', pitchDeg: 30 },
        });
        expect(parsed.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect([...kinds.values()].filter((k) => k === 'roof')).toHaveLength(2);
        // The back of the recess stands under the south slope, 2400 in from the eave.
        const z = Math.round(2400 + 2400 * Math.tan(Math.PI / 6));
        const back = byId.get('wall-1-3')!;
        expect(Math.max(...back.boundaryMm.map((p) => p.z))).toBe(z);
        // Its sides slope up to it from the eave.
        expect(byId.get('wall-1-2')!.boundaryMm).toContainEqual({ x: 4800, y: 2400, z });
    });

    it('says what is wrong, naming where', () => {
        const open = load({
            walls: [
                {
                    points: [
                        [0, 0],
                        [9600, 0],
                        [9600, 7200],
                    ],
                },
            ],
            roof: { type: 'gable', pitchDeg: 30 },
        });
        expect(open.parsed.errors.join(' ')).toMatch(/do not close/);
        const stray = load({
            walls: RECT_WALLS,
            openings: [{ at: [4800, 3600], widthMm: 1200, heightMm: 1200 }],
            roof: { type: 'gable', pitchDeg: 30 },
        });
        expect(stray.parsed.errors.join(' ')).toMatch(/openings\[0\]\.at is not on any wall/);
        const kind = load({ walls: RECT_WALLS, roof: { type: 'mansard', pitchDeg: 30 } });
        expect(kind.parsed.errors.join(' ')).toMatch(/roof\.type/);
    });

    it('opens the L-house example without a problem', async () => {
        const { readFile } = await import('node:fs/promises');
        const text = await readFile(
            new URL('../../fixtures/houses/l-house.json', import.meta.url),
            'utf8'
        );
        const parsed = parseHouseFile(text);
        expect(parsed.errors).toEqual([]);
        expect(parsed.interiorWalls).toHaveLength(1);
        expect(parsed.interiorOpenings).toEqual([
            {
                kind: 'door',
                storeyName: null,
                aMm: { x: 4800, y: 1950 },
                bMm: { x: 4800, y: 2850 },
                sillMm: 0,
                heightMm: 2100,
            },
        ]);
        expect(parsed.settings['roofOverhang']).toMatchObject({ eavesMm: 400 });
        const store = new SurfaceStore();
        expect(store.load(parsed.surfaces).skipped).toEqual([]);
    });
});
