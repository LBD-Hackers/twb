import { describe, expect, it } from 'vitest';
import { loadHouse, saturateHouse } from './load';
import { watertightReport, watertightSummary } from './watertight';

const box = (walls: number[][][], extra: Record<string, unknown> = {}) => ({
    format: 'arch/1',
    wallHeightMm: 2400,
    walls: walls.map((points) => ({ points })),
    roof: { type: 'flat', pitchDeg: 0 },
    ...extra,
});

/** A 9.6 × 7.2 m box, its walls one by one. */
const BOX = box([
    [
        [0, 0],
        [9600, 0],
    ],
    [
        [9600, 0],
        [9600, 7200],
    ],
    [
        [9600, 7200],
        [0, 7200],
    ],
    [
        [0, 7200],
        [0, 0],
    ],
]);

describe('watertightReport', () => {
    it('finds no leak in a closed box, and counts its six faces as the shell', () => {
        const report = watertightReport(loadHouse(BOX));
        expect(report).toMatchObject({ watertight: true, shellFaces: 6, leaks: [], leakMm: 0 });
        expect(watertightSummary(report)[0]).toMatch(/^Watertight: 6 faces of shell/);
    });

    it('finds none under a gable roof, nor in a stepped house with a courtyard', () => {
        expect(
            watertightReport(
                loadHouse({ ...BOX, roof: { type: 'gable', pitchDeg: 35, ridge: 'x' } })
            ).leaks
        ).toEqual([]);
        const ring = (x0: number, y0: number, x1: number, y1: number, storey: string) =>
            [
                [x0, y0, x1, y0],
                [x1, y0, x1, y1],
                [x1, y1, x0, y1],
                [x0, y1, x0, y0],
            ].map(([ax, ay, bx, by]) => ({
                storey,
                points: [
                    [ax, ay],
                    [bx, by],
                ],
            }));
        const stepped = {
            format: 'arch/1',
            storeys: [
                { name: 'Ground', elevationMm: 0, heightMm: 3000 },
                { name: 'Upper', elevationMm: 3000, heightMm: 2800 },
            ],
            walls: [
                ...ring(0, 0, 24000, 18000, 'Ground'),
                ...ring(8400, 6000, 15600, 12000, 'Ground'),
                ...ring(0, 0, 24000, 18000, 'Upper'),
                ...ring(8400, 6000, 15600, 12000, 'Upper'),
                ...ring(30000, 0, 36000, 6000, 'Ground'),
            ],
        };
        const report = watertightReport(loadHouse(stepped));
        expect(report.leaks).toEqual([]);
        // Two floors on the ground (the block's, the shed's; the upper storey's has the house
        // under it), two roofs (the upper storey's, open over the courtyard, and the shed's), and
        // the walls: the block's and its courtyard's on two storeys, the shed's.
        expect(report.shellFaces).toBe(2 + 2 + 2 * (4 + 4) + 4);
    });

    it("finds the leak a wall left out of a box leaves, along that wall's edges", () => {
        const detailed = saturateHouse(BOX).house as {
            surfaces: { id: string; points: number[][] }[];
        };
        const south = detailed.surfaces.find((s) => s.points.every((p) => p[1] === 0))!;
        const open = { ...detailed, surfaces: detailed.surfaces.filter((s) => s !== south) };
        const report = watertightReport(loadHouse(open));
        expect(report.watertight).toBe(false);
        // The floor's and the roof's south edges, and the two walls' ends standing beside it.
        expect(report.leakMm).toBe(2 * 9600 + 2 * 2400);
        expect(new Set(report.leaks.map((l) => l.kind))).toEqual(
            new Set(['floor', 'roof', 'wall'])
        );
        for (const leak of report.leaks) expect([leak.fromMm.y, leak.toMm.y]).toEqual([0, 0]);
    });

    it('finds a wall top under a floor that runs on past it closed', () => {
        // The upper storey 200 mm wider to the south than the one under it.
        const ring = (y0: number, storey: string) =>
            [
                [0, y0, 9600, y0],
                [9600, y0, 9600, 7200],
                [9600, 7200, 0, 7200],
                [0, 7200, 0, y0],
            ].map(([ax, ay, bx, by]) => ({
                storey,
                points: [
                    [ax, ay],
                    [bx, by],
                ],
            }));
        const house = {
            format: 'arch/1',
            storeys: [
                { name: 'Ground', elevationMm: 0, heightMm: 3000 },
                { name: 'Upper', elevationMm: 3000, heightMm: 2800 },
            ],
            walls: [...ring(200, 'Ground'), ...ring(0, 'Upper')],
        };
        expect(watertightReport(loadHouse(house)).leaks).toEqual([]);
    });
});

describe('loadHouse, repair: clean', () => {
    /** The box with its south wall drawn as two, in line. */
    const split = box([
        [
            [0, 0],
            [4800, 0],
        ],
        [
            [4800, 0],
            [9600, 0],
        ],
        ...BOX.walls.slice(1).map((w) => w.points),
    ]);

    it('heals a wall split for nothing into one, and only when asked', () => {
        const detailed = saturateHouse(split).house;
        const plain = loadHouse(detailed);
        const clean = loadHouse(detailed, { repair: 'clean' });
        expect(plain.merged).toBe(0);
        expect(clean.merged).toBe(1);
        expect(clean.store.surfaces()).toHaveLength(plain.store.surfaces().length - 1);
        expect(watertightReport(clean).leaks).toEqual([]);
    });

    it('passes the repair through saturateHouse', () => {
        const ids = (h: Record<string, unknown>) =>
            (h['surfaces'] as { id: string }[]).map((s) => s.id).length;
        expect(ids(saturateHouse(split, { repair: 'clean' }).house)).toBe(
            ids(saturateHouse(split).house) - 1
        );
    });
});
