import { describe, expect, it } from 'vitest';
import { polygonArea2 } from '../surfacekit/core';
import { SurfaceStore, classifyAll, outlineDifference } from '../surfacekit/model';
import { parseHouseFile } from './house-file';
import { loadHouse, saturateHouse } from './load';
import { watertightReport } from './watertight';
import { houseShapeOf } from './simple-house';

const rect = (x0: number, y0: number, x1: number, y1: number, storey?: string) =>
    [
        [x0, y0, x1, y0],
        [x1, y0, x1, y1],
        [x1, y1, x0, y1],
        [x0, y1, x0, y0],
    ].map(([ax, ay, bx, by]) => ({
        points: [
            [ax, ay],
            [bx, by],
        ],
        ...(storey ? { storey } : {}),
    }));

/** A wide ground floor, and an upper storey on the west half of it: a lower wing to the east. */
const STEPPED = {
    format: 'arch/1',
    storeys: [
        { name: 'Ground', elevationMm: 0, heightMm: 3000 },
        { name: 'Upper', elevationMm: 3000, heightMm: 2800 },
    ],
    walls: [...rect(0, 0, 18000, 9600, 'Ground'), ...rect(0, 0, 9600, 9600, 'Upper')],
    openings: [
        { kind: 'door', at: [4800, 0], widthMm: 1000, heightMm: 2100 },
        { kind: 'window', at: [4800, 0], widthMm: 1200, heightMm: 1200, sillMm: 900, storey: 'Upper' },
        { kind: 'window', at: [18000, 4800], widthMm: 1200, heightMm: 1200, sillMm: 900 },
    ],
};

function open(house: Record<string, unknown>) {
    const parsed = parseHouseFile(JSON.stringify(house));
    const store = new SurfaceStore();
    const result = store.load(parsed.surfaces, parsed.guides, parsed.storeys);
    const surfaces = store.surfaces();
    return { parsed, result, surfaces, kinds: classifyAll(surfaces), byId: new Map(surfaces.map((s) => [s.id, s])) };
}

const zs = (ring: readonly { z: number }[]) => [...new Set(ring.map((p) => p.z))].sort((a, b) => a - b);
const planArea = (ring: readonly { x: number; y: number }[]) => polygonArea2(ring) / 1e6;

describe('the simple shape, storey by storey', () => {
    it('stands each storey on its own outline, from its floor to its top', () => {
        const { parsed, result, kinds, byId } = open(STEPPED);
        expect(parsed.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(planArea(byId.get('floor')!.boundaryMm)).toBeCloseTo(172.8);
        expect(planArea(byId.get('floor-upper')!.boundaryMm)).toBeCloseTo(92.16);
        expect(zs(byId.get('floor-upper')!.boundaryMm)).toEqual([3000]);
        // The upper storey's walls run from 3000 to 5800, the ground floor's from 0 to 3000.
        const walls = [...byId.values()].filter((s) => kinds.get(s.id) === 'wall');
        expect(walls).toHaveLength(8);
        expect(new Set(walls.map((w) => zs(w.boundaryMm).join('-')))).toEqual(new Set(['0-3000', '3000-5800']));
    });

    it('roofs the wing flat where the storey above does not stand, and the top storey over all of it', () => {
        const { kinds, byId } = open(STEPPED);
        const wing = byId.get('roof-ground')!;
        expect(kinds.get('roof-ground')).toBe('roof');
        expect(zs(wing.boundaryMm)).toEqual([3000]);
        expect(planArea(wing.boundaryMm)).toBeCloseTo(80.64);
        const top = byId.get('roof-upper')!;
        expect(kinds.get('roof-upper')).toBe('roof');
        expect(zs(top.boundaryMm)).toEqual([5800]);
        expect(planArea(top.boundaryMm)).toBeCloseTo(92.16);
        // The upper floor is a floor: walls stand on it.
        expect(kinds.get('floor-upper')).toBe('floor');
    });

    it('puts each opening in a wall of its own storey', () => {
        const { byId } = open(STEPPED);
        const south = [...byId.values()].filter((s) => s.openings.length > 0);
        const at = (s: (typeof south)[number]) => `${s.id}:${zs(s.boundaryMm).join('-')}:${s.openings.length}`;
        expect(south.map(at).sort()).toEqual(['wall-1:0-3000:1', 'wall-2:0-3000:1', 'wall-5:3000-5800:1']);
    });

    it('roofs the top storey as its roof says: a gable over the upper storey, the wing flat', () => {
        const { parsed, kinds, surfaces } = open({
            ...STEPPED,
            roof: { type: 'gable', pitchDeg: 30, ridge: 'x' },
        });
        expect(parsed.errors).toEqual([]);
        const roofs = surfaces.filter((s) => kinds.get(s.id) === 'roof');
        expect(roofs.map((r) => r.id).sort()).toEqual(['roof-ground', 'roof-upper-1-1', 'roof-upper-1-2']);
        const gable = surfaces.find((s) => s.id === 'roof-upper-1-1')!;
        expect(Math.max(...gable.boundaryMm.map((p) => p.z))).toBeGreaterThan(5800);
    });

    it('cuts the storey above out of a roof it stands inside, as a hole', () => {
        const { parsed, result, byId } = open({
            format: 'arch/1',
            storeys: [
                { name: 'Ground', elevationMm: 0, heightMm: 3000 },
                { name: 'Upper', elevationMm: 3000, heightMm: 2800 },
            ],
            walls: [...rect(0, 0, 18000, 12000, 'Ground'), ...rect(6000, 3000, 12000, 9000, 'Upper')],
        });
        expect(parsed.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(byId.get('roof-ground')!.holes).toHaveLength(1);
    });

    it('leaves a courtyard open: a ring of walls inside the outline is cut out of the floor and the roof', () => {
        const { parsed, result, byId, kinds } = open({
            format: 'arch/1',
            storeys: [{ name: 'Ground', elevationMm: 0, heightMm: 3000 }],
            walls: [...rect(0, 0, 24000, 18000, 'Ground'), ...rect(8000, 6000, 16000, 12000, 'Ground')],
        });
        expect(parsed.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(byId.get('floor')!.holes).toHaveLength(1);
        expect(byId.get('roof-ground')!.holes).toHaveLength(1);
        // The courtyard's walls stand as walls of the house: eight in all.
        expect([...kinds.values()].filter((k) => k === 'wall')).toHaveLength(8);
    });

    it('stands a wall that names no storey on the lowest', () => {
        const { parsed, byId } = open({
            ...STEPPED,
            walls: [...rect(0, 0, 18000, 9600), ...rect(0, 0, 9600, 9600, 'Upper')],
        });
        expect(parsed.errors).toEqual([]);
        expect(zs(byId.get('floor')!.boundaryMm)).toEqual([0]);
        expect(planArea(byId.get('roof-ground')!.boundaryMm)).toBeCloseTo(80.64);
    });

    it('says which storey a wall names that the file does not have', () => {
        const { parsed } = open({ ...STEPPED, walls: [...STEPPED.walls, ...rect(0, 0, 1000, 1000, 'Attic')] });
        expect(parsed.errors.join('\n')).toMatch(/storey "Attic", which the file does not have/);
    });
});

describe('the simple shape, a storey of several blocks', () => {
    /** Two blocks apart on the ground floor, joined by nothing; an upper storey on the west one. */
    const BLOCKS = {
        format: 'arch/1',
        storeys: [
            { name: 'Ground', elevationMm: 0, heightMm: 3000 },
            { name: 'Upper', elevationMm: 3000, heightMm: 2800 },
        ],
        walls: [
            ...rect(0, 0, 9600, 9600, 'Ground'),
            ...rect(14400, 0, 24000, 6000, 'Ground'),
            ...rect(0, 0, 9600, 9600, 'Upper'),
        ],
        openings: [{ kind: 'door', at: [19200, 0], widthMm: 1000, heightMm: 2100 }],
    };

    it('gives each block of a storey its own floor', () => {
        const { parsed, result, kinds, byId } = open(BLOCKS);
        expect(parsed.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(planArea(byId.get('floor')!.boundaryMm)).toBeCloseTo(92.16);
        expect(planArea(byId.get('floor-2')!.boundaryMm)).toBeCloseTo(57.6);
        expect(kinds.get('floor-2')).toBe('floor');
        // The east block's door is in its wall.
        expect([...byId.values()].filter((s) => s.openings.length > 0).map((s) => s.id)).toEqual(['wall-5']);
    });

    it('roofs the block no storey stands on, and the one under the upper storey only past it', () => {
        const { byId } = open(BLOCKS);
        const roofs = [...byId.values()].filter((s) => s.id.startsWith('roof-ground'));
        // The west block is all under the upper storey: only the east block is roofed at 3000.
        expect(roofs.map((r) => [zs(r.boundaryMm), planArea(r.boundaryMm)])).toEqual([[[3000], 57.6]]);
        expect(planArea(byId.get('roof-upper')!.boundaryMm)).toBeCloseTo(92.16);
    });

    it('roofs an upper storey over part of one block, the rest of that block and the other one flat', () => {
        const house = {
            ...BLOCKS,
            walls: [...BLOCKS.walls.filter((w) => w.storey !== 'Upper'), ...rect(0, 0, 4800, 9600, 'Upper')],
        };
        const { byId } = open(house);
        const roofs = [...byId.values()].filter((s) => s.id.startsWith('roof-ground'));
        expect(roofs.map((r) => planArea(r.boundaryMm)).sort((a, b) => a - b)).toEqual([46.08, 57.6]);
    });

    it('covers the blocks a roof naming the storey gives no outline for, each with its own', () => {
        const house = {
            ...BLOCKS,
            walls: BLOCKS.walls.filter((w) => w.storey !== 'Upper'),
            storeys: [BLOCKS.storeys[0]],
            roof: { type: 'gable', pitchDeg: 30, ridge: 'x', storey: 'Ground' },
        };
        const { parsed, byId } = open(house);
        expect(parsed.errors).toEqual([]);
        const groups = new Set([...byId.values()].map((s) => s.roofGroupId).filter((g) => g));
        expect(groups).toEqual(new Set(['roof-ground-1', 'roof-ground-1-2']));
    });
});

describe('the simple shape, a room rising through storeys', () => {
    const storeys = (n: number) =>
        Array.from({ length: n }, (_, k) => ({ name: `S${k}`, elevationMm: 3000 * k, heightMm: 3000 }));
    /** A 24 × 18 m block on each storey, with a ring of walls round a 7.2 × 6 m hall on some. */
    const house = (n: number, ringOn: number[], roofOn: number | null) => ({
        format: 'arch/1',
        storeys: storeys(n),
        walls: [
            ...Array.from({ length: n }, (_, k) => rect(0, 0, 24000, 18000, `S${k}`)).flat(),
            ...ringOn.flatMap((k) => rect(8400, 6000, 15600, 12000, `S${k}`)),
        ],
        ...(roofOn !== null
            ? {
                  roof: {
                      type: 'flat',
                      pitchDeg: 0,
                      storey: `S${roofOn}`,
                      outline: [
                          [8400, 6000],
                          [15600, 6000],
                          [15600, 12000],
                          [8400, 12000],
                      ],
                  },
              }
            : {}),
    });
    const flats = (byId: Map<string, { boundaryMm: readonly { z: number }[]; holes: readonly unknown[] }>) =>
        [...byId.entries()]
            .filter(([id]) => id.startsWith('roof'))
            .map(([id, f]) => `${id}@${zs(f.boundaryMm).join()}:${f.holes.length}`)
            .sort();

    it('opens the floor over a room rising through a storey, and roofs it at that storey\'s top', () => {
        // Two storeys; the hall's walls on the upper one, its roof over it.
        const { parsed, byId } = open(house(2, [1], 1));
        expect(parsed.errors).toEqual([]);
        expect(byId.get('floor-s1')!.holes).toHaveLength(1);
        // No roof under the hall at 3000: the upper storey stands on the rest of the block.
        expect(flats(byId)).toEqual(['roof-s1-1-1@6000:0', 'roof-s1@6000:1']);
        expect(watertightReport(loadHouse(house(2, [1], 1))).leaks).toEqual([]);
    });

    it('rises through every storey with a ring round it, up to the roof', () => {
        // Four storeys, the hall's walls on the upper three, its roof on the top one.
        const { parsed, byId } = open(house(4, [1, 2, 3], 3));
        expect(parsed.errors).toEqual([]);
        for (const id of ['floor-s1', 'floor-s2', 'floor-s3']) expect(byId.get(id)!.holes).toHaveLength(1);
        expect(flats(byId)).toEqual(['roof-s3-1-1@12000:0', 'roof-s3@12000:1']);
        expect(watertightReport(loadHouse(house(4, [1, 2, 3], 3))).leaks).toEqual([]);
    });

    it('is closed by the floor of the storey above where that one has no ring there', () => {
        const { byId } = open(house(3, [1], null));
        expect(byId.get('floor-s1')!.holes).toHaveLength(1);
        expect(byId.get('floor-s2')!.holes).toEqual([]);
        expect(flats(byId)).toEqual(['roof-s2@9000:0']);
        expect(watertightReport(loadHouse(house(3, [1], null))).leaks).toEqual([]);
    });

    it('leaves a ring no roof covers, with nothing over it, a courtyard open to the sky', () => {
        // The ring on the top storey only, no roof over it: the storey under it is roofed there.
        const { byId } = open(house(2, [1], null));
        expect(flats(byId)).toEqual(['roof-s0', 'roof-s1'].map((id) => expect.stringContaining(id)));
        expect(byId.get('roof-s1')!.holes).toHaveLength(1);
        expect(zs(byId.get('roof-s0')!.boundaryMm)).toEqual([3000]);
    });
});

describe('the simple shape, an opening in a floor', () => {
    const square = (x0: number, y0: number, x1: number, y1: number) => [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
    ];
    const TWO = {
        format: 'arch/1',
        storeys: [
            { name: 'Ground', elevationMm: 0, heightMm: 3000 },
            { name: 'Upper', elevationMm: 3000, heightMm: 2800 },
        ],
        wallHeightMm: 5800,
        walls: rect(0, 0, 9600, 7200),
        roof: { type: 'flat', pitchDeg: 0 },
    };

    it('cuts a stair\'s opening inside a floor out of it as a hole', () => {
        const house = { ...TWO, floorOpenings: [{ storey: 'Upper', outline: square(3000, 2000, 4000, 5000) }] };
        const { parsed, byId } = open(house);
        expect(parsed.errors).toEqual([]);
        expect(byId.get('floor-upper')!.holes).toHaveLength(1);
        expect(planArea(byId.get('floor-upper')!.boundaryMm)).toBeCloseTo(69.12);
        expect(byId.get('floor')!.holes).toEqual([]);
        expect(watertightReport(loadHouse(house)).leaks).toEqual([]);
    });

    it('cuts one at the floor\'s edge out of it as a notch, keeping each wall\'s corner', () => {
        const house = { ...TWO, floorOpenings: [{ storey: 'Upper', outline: square(0, 2000, 1000, 5300) }] };
        const { parsed, byId } = open(house);
        expect(parsed.errors).toEqual([]);
        const floor = byId.get('floor-upper')!;
        expect(floor.holes).toEqual([]);
        expect(planArea(floor.boundaryMm)).toBeCloseTo(69.12 - 3.3);
        expect(watertightReport(loadHouse(house)).leaks).toEqual([]);
    });

    it('cuts it storey by storey too, and says which openings it cannot place', () => {
        const stepped = {
            ...STEPPED,
            floorOpenings: [
                { storey: 'Upper', outline: square(3000, 2000, 4000, 5000) },
                { storey: 'Ground', outline: square(3000, 2000, 4000, 5000) },
                { storey: 'Attic', outline: square(3000, 2000, 4000, 5000) },
            ],
        };
        const { parsed, byId } = open(stepped);
        expect(byId.get('floor-upper')!.holes).toHaveLength(1);
        expect(parsed.errors).toEqual([
            "floorOpenings[1] is in the lowest storey's floor, which nothing is under.",
            'floorOpenings[2].storey must name a storey the file has.',
        ]);
    });
});

describe('outlineDifference', () => {
    it('is what of one outline lies outside the other', () => {
        const a = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ];
        const b = [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 10 },
            { x: 0, y: 10 },
        ];
        const out = outlineDifference(a, b);
        expect(out).toHaveLength(1);
        expect(polygonArea2(out[0]!.ring)).toBeCloseTo(60);
        expect(outlineDifference(b, a)).toEqual([]);
        // Across the middle: two pieces.
        const band = [
            { x: 4, y: -2 },
            { x: 6, y: -2 },
            { x: 6, y: 12 },
            { x: 4, y: 12 },
        ];
        expect(outlineDifference(a, band).map((r) => polygonArea2(r.ring))).toEqual([40, 40]);
    });
});

describe('the two shapes', () => {
    it('says which a file is in', () => {
        expect(houseShapeOf(STEPPED)).toBe('simple');
        expect(houseShapeOf({ format: 'arch/1', surfaces: [] })).toBe('detailed');
    });

    it('saturates a simple house into a detailed one that opens to the same faces', () => {
        const { house, problems } = saturateHouse(STEPPED);
        expect(problems).toEqual([]);
        expect(houseShapeOf(house)).toBe('detailed');
        const again = loadHouse(house);
        expect(again.problems).toEqual([]);
        const ids = (h: ReturnType<typeof loadHouse>) => h.store.surfaces().map((s) => s.id).sort();
        expect(ids(again)).toEqual(ids(loadHouse(STEPPED)));
        expect(saturateHouse(house).house).toEqual(house);
    });
});
