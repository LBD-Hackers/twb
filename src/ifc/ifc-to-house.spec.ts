import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHouseFile, type FileEnvelopeLayer, type ParseResult } from '../house/house-file';
import { loadHouse } from '../house/load';
import { polygonArea2 } from '../surfacekit/core/geom2';
import { resolveZoneRooms } from '../surfacekit/model/zone-rooms';
import { zoneVolume } from '../surfacekit/model/zone-volume';
import { matchMaterial } from './ifc-materials';
import { coupleWindows, ifcImportSummary, ifcToHouse, type CouplingWindow } from './ifc-to-house';

type Json = Record<string, unknown>;

/**
 * The buildingSMART Duplex, not kept in the repository: put it at `fixtures/Duplex.ifc` to run
 * the tests on it (see `fixtures/README.md`). Without it they are skipped.
 */
const DUPLEX = new URL('../../fixtures/Duplex.ifc', import.meta.url);
const describeDuplex = describe.skipIf(!existsSync(DUPLEX));

/** A build-up of the file, by assembly: its layers inside → outside, as the file writes them. */
const layersOf = (parsed: ParseResult, id: string): FileEnvelopeLayer[] =>
    (parsed.settings['envelope'] as Record<string, { layers: FileEnvelopeLayer[] }>)[id]!.layers;

describeDuplex('the Duplex (buildingSMART sample, Revit IFC2X3)', () => {
    const { house, report } = existsSync(DUPLEX)
        ? ifcToHouse(readFileSync(DUPLEX, 'utf8'))
        : ifcToHouse(timberHouseIfc());
    const h = house as Json;

    it('opens in arch with no problems', () => {
        const parsed = parseHouseFile(JSON.stringify(house));
        expect(parsed.errors).toEqual([]);
        expect(parsed.storeys.map((s) => [s.name, s.elevationMm])).toEqual([
            ['Level 1', 0],
            ['Level 2', 3100],
        ]);
    });

    it('reads its brick-on-block walls as heavy: a masonry house', () => {
        expect(report.construction).toBe('heavy');
        expect(h['constructionSystem']).toBe('masonry');
        expect(h['buildingUse']).toBe('dwelling');
    });

    it('puts the exterior walls on the middle of the block, 263.5 mm in from the brick', () => {
        // The walls' faces are 8800 × 17800 over the brick: 2 × 263.5 less.
        expect(h['walls']).toEqual([
            {
                id: 'north',
                points: [
                    [0, 17273],
                    [8273, 17273],
                ],
            },
            {
                id: 'east',
                points: [
                    [8273, 17273],
                    [8273, 0],
                ],
            },
            {
                id: 'south',
                points: [
                    [8273, 0],
                    [0, 0],
                ],
            },
            {
                id: 'west',
                points: [
                    [0, 0],
                    [0, 17273],
                ],
            },
        ]);
        expect(h['wallHeightMm']).toBe(6000);
    });

    it('builds the exterior wall inside → outside from its layers, the block its core', () => {
        const parsed = parseHouseFile(JSON.stringify(house));
        const wall = layersOf(parsed, 'exteriorWall').map((l) => [
            l.material,
            l.thickness,
            l.core === true,
        ]);
        expect(wall).toEqual([
            ['gypsum', 16, false],
            ['air-still', 41, false],
            ['concrete-block', 193, true],
            ['eps-34', 50, false],
            ['air-still', 25, false],
            ['brick', 92, false],
        ]);
        const cavity = layersOf(parsed, 'exteriorWall')[3]!;
        expect(cavity.ties).toBeTruthy();
        expect(layersOf(parsed, 'exteriorWall')[5]!.masonry?.bond).toBe('stretcher');
        // The roof: the joists inside, the sedum outside.
        const roof = layersOf(parsed, 'roof');
        expect(roof[0]!.core && roof[0]!.members).toBeTruthy();
        expect(roof[roof.length - 1]!.material).toBe('green-roof');
        // The ground floor: the wood floor on the slab.
        expect(layersOf(parsed, 'floor').map((l) => l.material)).toEqual([
            'floorboards',
            'mw-34',
            'concrete',
        ]);
    });

    it('reads every window and door, with its sill and storey', () => {
        const openings = h['openings'] as Json[];
        // 22 in the IFC, the stairs' columns of three coupled into one each (below).
        expect(openings.filter((o) => o['kind'] === 'window')).toHaveLength(14);
        expect(openings.filter((o) => o['kind'] === 'door')).toHaveLength(14);
        // The big fixed window on the north facade of Level 1.
        expect(openings).toContainEqual({
            kind: 'window',
            at: [5702, 17273],
            widthMm: 4835,
            heightMm: 2420,
            sillMm: 100,
            storey: 'Level 1',
        });
        // Every one lands on its face, the partitions' too.
        const parsed = parseHouseFile(JSON.stringify(house));
        const onFaces = parsed.surfaces.reduce((n, s) => n + s.openings.length, 0);
        expect(onFaces + parsed.interiorOpenings.length).toBe(28);
    });

    it('couples the stairs’ windows, three over each other with 66 mm of wall between, into one', () => {
        const openings = h['openings'] as Json[];
        expect(openings).toContainEqual({
            kind: 'window',
            at: [563, 17273],
            widthMm: 819,
            heightMm: 2410,
            sillMm: 100,
            storey: 'Level 2',
            glazing: { transoms: 2 },
        });
        // The wide window beside each column is kept apart, and said to be too close.
        expect(report.warnings.join('\n')).toMatch(/12 windows .* coupled into 4/);
        expect(report.warnings.join('\n')).toMatch(/4 pairs of windows with only 89 mm, 100 mm/);
    });

    it('takes a flat green roof behind a parapet, and the brick facade', () => {
        expect(h['roof']).toEqual({ type: 'flat', pitchDeg: 0 });
        expect(h['expression']).toMatchObject({
            notation: 'flat-roof',
            facade: 'brick',
            roofCovering: 'green',
        });
        expect(h['roofLoad']).toBe('green');
    });

    it('reads the rooms, their ceilings on the joists, and parts the open ones', () => {
        const zones = h['zones'] as Json[];
        expect(zones).toHaveLength(20);
        // Its ceilings hang 195 mm under the joists of Level 2: arch's flat ceiling, on them.
        const kitchen = zones.find((z) => z['name'] === 'A103 Kitchen')!;
        expect(kitchen['zoneKind']).toBe('kitchen');
        expect(kitchen['ceiling']).toBeUndefined();
        expect((h['zoneSeparations'] as Json[]).length).toBeGreaterThan(0);
    });

    it('keeps the party walls and the plumbing walls as their own build-ups', () => {
        const envelope = h['envelope'] as Record<string, { name?: string; layers: { thickness: number }[] }>;
        const thick = (id: string) => envelope[id]!.layers.reduce((s, l) => s + l.thickness, 0);
        // A masonry house: its stud partitions are light ones, flagged, in their own build-up.
        expect(envelope['interiorWall']).toBeUndefined();
        expect(thick('lightPartition')).toBe(124);
        expect(thick('partyWall')).toBe(550);
        const plumbing = report.buildUpTypes.find((t) => /^Basic Wall:Interior - Plumbing/.test(t.layerSet))!;
        expect(plumbing.id).toMatch(/^lightPartition:/);
        expect(thick(plumbing.id)).toBe(184);
        // Where the furring lines it, the party wall is built of the furring instead of its own
        // finish on that side: 645 mm lined on one side, 740 mm on both.
        const lined = report.buildUpTypes.filter((t) => / \+ Basic Wall:Interior - Furring/.test(t.layerSet));
        expect(lined.map((t) => thick(t.id)).sort()).toEqual([645, 645, 645, 740]);
        const runs = h['interiorWalls'] as { partition?: string; buildUpType?: string }[];
        expect(runs.filter((r) => r.partition === 'party').length).toBeGreaterThan(4);
        expect(runs.filter((r) => r.buildUpType === plumbing.id)).toHaveLength(2);
        expect(runs.filter((r) => !r.partition)).toEqual([]);
        expect(report.warnings.join(' ')).not.toMatch(/one partition build-up|written as partitions/);
        const loaded = loadHouse(house, { snapToModule: false });
        expect(loaded.store.surfaces().filter((s) => s.partitionKind === 'party').length).toBeGreaterThan(3);
    });

    it('closes every room: partitions on the party wall, separations on the walls they continue', () => {
        const loaded = loadHouse(house, { snapToModule: false });
        const zones = loaded.zones.zones();
        const rooms = resolveZoneRooms(
            loaded.store.surfaces(),
            loaded.store.storeys(),
            zones,
            loaded.zones.separations()
        );
        const area = (name: string) => {
            const outline = rooms.get(zones.find((z) => z.name === name)!.id)!.outlineMm!;
            return Math.round(Math.abs(polygonArea2(outline)) / 1e4) / 100;
        };
        expect(zones.filter((z) => !rooms.get(z.id)?.outlineMm).map((z) => z.name)).toEqual([]);
        expect(zones.filter((z) => rooms.get(z.id)?.problem).map((z) => z.name)).toEqual([]);
        // On its lines the party wall stands on a leaf, so the two dwellings' rooms differ; to
        // the walls' faces they mirror each other, as Revit's rooms do (zone-volume, below).
        expect(area('B104 Bathroom 1')).toBeLessThan(6);
        expect(area('B102 Living Room')).toBeLessThan(35);
        // The hallways' b-reps leave the stair's opening out, as Revit's rooms do (6.89 m² net).
        expect(area('A201 Hallway')).toBeLessThan(8);
        expect(area('A201 Hallway')).toBeCloseTo(area('B201 Hallway'), 1);
    });

    it('measures the two dwellings’ rooms alike to their walls’ faces, as Revit does', () => {
        const loaded = loadHouse(house, { snapToModule: false });
        const envelope = h['envelope'] as Record<string, { layers: { thickness: number; core?: true }[] }>;
        const surfaces = loaded.store.surfaces();
        const zones = loaded.zones.zones();
        const rooms = resolveZoneRooms(surfaces, loaded.store.storeys(), zones, loaded.zones.separations());
        const KIND = { party: 'partyWall', light: 'lightPartition', heavy: 'heavyPartition' } as const;
        // A partition's build-up runs from its positive side across its core to its back.
        const side = (id: string, sign: 1 | -1): number => {
            const s = surfaces.find((x) => x.id === id)!;
            const key = s.buildUpType ?? (s.partitionKind ? KIND[s.partitionKind] : 'exteriorWall');
            const layers = envelope[key]!.layers;
            const core = layers.findIndex((l) => l.core);
            const sum = (ls: typeof layers) => ls.reduce((t, l) => t + l.thickness, 0);
            if (!s.partitionKind) return sum(layers.slice(0, core)) + layers[core]!.thickness / 2;
            return sign === 1
                ? sum(layers.slice(0, core)) + layers[core]!.thickness / 2
                : layers[core]!.thickness / 2 + sum(layers.slice(core + 1));
        };
        const net = (name: string) => {
            const z = zones.find((x) => x.name === name)!;
            const storey = loaded.store.storeys().find((st) => st.id === z.storeyId)!;
            return zoneVolume(surfaces, storey, rooms.get(z.id)!.outlineMm!, () => 0, undefined, undefined, side)
                .netAreaM2;
        };
        // Revit's B104 and A104: 1456 × 2171 mm each. Faces are whole millimetres, the party
        // wall's leaf half one off: within 0.001 m².
        expect(net('A104 Bathroom 1')).toBeCloseTo(3.160976, 2);
        expect(net('B104 Bathroom 1')).toBeCloseTo(3.160976, 2);
        expect(Math.abs(net('A104 Bathroom 1') - 3.160976)).toBeLessThan(0.001);
        expect(Math.abs(net('B104 Bathroom 1') - 3.160976)).toBeLessThan(0.001);
        expect(net('A103 Kitchen')).toBeCloseTo(net('B103 Kitchen'), 1);
        expect(net('A204 Bathroom 2')).toBeCloseTo(net('B204 Bathroom 2'), 1);
        expect(net('A203 Bedroom 2')).toBeCloseTo(22.04, 1);
    });

    it('says what it left out', () => {
        const types = report.skipped.map((s) => s.type);
        expect(types).toEqual(expect.arrayContaining(['IFCSTAIR', 'IFCBEAM', 'IFCFOOTING']));
        const notes = String(h['notes']);
        expect(notes).toContain('Left out: 2 × IFCSTAIR');
        expect(ifcImportSummary(report)[0]).toMatch(/^Read from IFC \(IFC2X3\): heavy/);
    });
});

describeDuplex('the Duplex’s floors between storeys', () => {
    it('reads its joisted floor as the floor between storeys, of timber', () => {
        const { house, report } = ifcToHouse(readFileSync(DUPLEX, 'utf8'));
        const parsed = parseHouseFile(JSON.stringify(house));
        expect(report.buildups.deck).toMatch(/Wood Joist/);
        expect(report.structure).toEqual({ floors: 'timber', roof: 'timber' });
        const core = layersOf(parsed, 'deck').find((l) => l.core)!;
        expect(core.members).toBeTruthy();
        expect(layersOf(parsed, 'deck')[0]!.material).toBe('floorboards');
        expect(report.skipped.some((s) => /floor between storeys/.test(s.names.join()))).toBe(
            false
        );
    });

    it('reads them, and the roof, as concrete where their joists are hollow-core slabs', () => {
        // The same house with the joists of its floors and its roof made hollow-core elements.
        const text = readFileSync(DUPLEX, 'utf8').replaceAll(
            "IFCMATERIAL('Wood - Dimensional Lumber')",
            "IFCMATERIAL('Precast Concrete - Hollow Core')"
        );
        const { house, report } = ifcToHouse(text);
        const parsed = parseHouseFile(JSON.stringify(house));
        expect(parsed.errors).toEqual([]);
        expect(report.structure).toEqual({ floors: 'hollow-core', roof: 'hollow-core' });
        // A heavy house says so as its own choice, as well as in its build-ups.
        expect([parsed.settings['floorStructure'], parsed.settings['roofStructure']]).toEqual([
            'hollow-core',
            'hollow-core',
        ]);
        const deckCore = layersOf(parsed, 'deck').find((l) => l.core)!;
        expect([deckCore.material, deckCore.members ?? null]).toEqual(['hollow-core', null]);
        const roofCore = layersOf(parsed, 'roof').find((l) => l.core)!;
        expect([roofCore.material, roofCore.members ?? null]).toEqual(['hollow-core', null]);
        expect(ifcImportSummary(report).join('\n')).toContain(
            'Floors between storeys: hollow-core slabs; roof: hollow-core slabs.'
        );
    });
});

describe('a light house: timber frame, gable roof', () => {
    const { house, report } = ifcToHouse(timberHouseIfc());
    const h = house as Json;

    it('reads the stud walls as light: a timber frame', () => {
        expect(report.construction).toBe('light');
        expect(h['constructionSystem']).toBe('timber-frame');
    });

    it('puts the walls through the middle of the studs, 153.5 mm in from the cladding', () => {
        const walls = h['walls'] as { points: number[][] }[];
        const xs = walls.flatMap((w) => w.points.map((p) => p[0]!));
        const ys = walls.flatMap((w) => w.points.map((p) => p[1]!));
        expect(Math.max(...xs) - Math.min(...xs)).toBe(8000 - 307);
        expect(Math.max(...ys) - Math.min(...ys)).toBe(5000 - 307);
    });

    it('builds its wall with studs in the core, the cladding outside', () => {
        const parsed = parseHouseFile(JSON.stringify(house));
        expect(parsed.errors).toEqual([]);
        const layers = layersOf(parsed, 'exteriorWall');
        expect(layers.map((l) => l.material)).toEqual([
            'gypsum',
            'vapour-barrier',
            'mw-37',
            'gypsum-wind',
            'air-ventilated',
            'cladding',
        ]);
        expect(layers[2]!.core && layers[2]!.members?.cc).toBe(600);
    });

    it('reads the gable roof off its two slopes', () => {
        expect(h['roof']).toMatchObject({ type: 'gable', ridge: 'x', pitchDeg: 30 });
        expect((h['roofOverhang'] as Json)['eavesMm']).toBeGreaterThan(0);
        expect(h['expression']).toMatchObject({
            notation: 'overhang-barge',
            facade: 'board-on-board',
        });
    });

    it('places the window, the front door and the door in the partition', () => {
        const openings = h['openings'] as Json[];
        expect(openings).toContainEqual({
            kind: 'window',
            // Written to 0.1 mm: the window's middle is half a millimetre off the module.
            at: [1846.5, 0],
            widthMm: 1200,
            heightMm: 1200,
            sillMm: 900,
        });
        expect(openings.filter((o) => o['kind'] === 'door')).toHaveLength(2);
        expect(h['interiorWalls']).toEqual([
            {
                points: [
                    [3846.5, 0],
                    [3846.5, 4693],
                ],
            },
        ]);
        const parsed = parseHouseFile(JSON.stringify(house));
        expect(parsed.interiorOpenings).toHaveLength(1);
    });
});

describe('coupling windows', () => {
    const line = { a: { x: 0, y: 0 }, b: { x: 10000, y: 0 } };
    const w = (alongMm: number, widthMm: number, sillMm: number, heightMm: number) =>
        ({
            entry: null,
            line,
            alongMm,
            widthMm,
            sillMm,
            heightMm,
            band: 0,
            mullions: 0,
            transoms: 0,
        }) as CouplingWindow<null>;

    it('joins two side by side with a sliver between them by a mullion', () => {
        const [one, ...rest] = coupleWindows([w(1000, 1000, 900, 1200), w(2060, 1000, 900, 1200)]);
        expect(rest).toEqual([]);
        expect([one!.alongMm, one!.widthMm, one!.mullions, one!.coupled]).toEqual([
            1530,
            2060,
            1,
            true,
        ]);
    });

    it('keeps them apart where a pier stands between them, or their panes would be unequal', () => {
        expect(coupleWindows([w(1000, 1000, 900, 1200), w(2200, 1000, 900, 1200)])).toHaveLength(2);
        expect(coupleWindows([w(1000, 1000, 900, 1200), w(2460, 1800, 900, 1200)])).toHaveLength(2);
    });
});

describe('IFC material names', () => {
    it.each([
        ['Masonry - Brick', 'brick', 'heavy'],
        ['Masonry - Concrete Block', 'concrete-block', 'heavy'],
        ['Porebeton 100', 'aerated-concrete', 'heavy'],
        ['Insulation / Thermal Barriers - Rigid insulation', 'eps-34', 'insulation'],
        ['Insulation / Thermal Barriers - Semi-rigid insulation', 'mw-34', 'insulation'],
        ['Mineraluld 37', 'mw-37', 'insulation'],
        ['Roofing - EPDM Membrane', 'roofing-felt', 'covering'],
        ['Roofing - Barrier', 'roof-underlay', 'membrane'],
        ['Metal - Stud Layer', 'softwood', 'studs'],
        ['Wood - Dimensional Lumber', 'softwood', 'studs'],
        ['Masonry - Grout', 'screed', 'finish'],
        ['Plasterboard', 'gypsum', 'board'],
        ['Vindgips 9 mm', 'gypsum-wind', 'board'],
        ['Misc. Air Layers - Air Space', 'air-still', 'air'],
        ['Site - Grass', 'green-roof', 'covering'],
        ['Precast Concrete - Hollow Core', 'hollow-core', 'heavy'],
        ['Huldæk HD 220', 'hollow-core', 'heavy'],
        ['Concrete - Cast In Situ', 'concrete', 'heavy'],
    ])('reads "%s" as %s (%s)', (name, materialId, role) => {
        expect(matchMaterial(name)).toEqual({ materialId, role, known: true });
    });
});

/**
 * A small timber house as an IFC4 file, written here so the test says what it holds: walls of
 * 8000 × 5000 over the cladding, 2600 high, its layers outside first; a window, a front door, a
 * partition with a door, and a gable roof of 30° as two sloping slabs.
 */
function timberHouseIfc(): string {
    const lines: string[] = [];
    let n = 0;
    const e = (text: string): string => {
        n += 1;
        lines.push(`#${n}=${text};`);
        return `#${n}`;
    };
    const pt = (...c: number[]) =>
        e(`IFCCARTESIANPOINT((${c.map((v) => v.toFixed(4)).join(',')}))`);
    const dir = (...c: number[]) => e(`IFCDIRECTION((${c.map((v) => v.toFixed(6)).join(',')}))`);
    const place3 = (o: number[], z?: number[], x?: number[]) =>
        e(`IFCAXIS2PLACEMENT3D(${pt(...o)},${z ? dir(...z) : '$'},${x ? dir(...x) : '$'})`);
    const local = (rel: string, p: string) => e(`IFCLOCALPLACEMENT(${rel},${p})`);

    const lengthUnit = e('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
    const units = e(`IFCUNITASSIGNMENT((${lengthUnit}))`);
    const context = e(
        `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,${place3([0, 0, 0])},$)`
    );
    const project = e(`IFCPROJECT('p',$,'Lille hus',$,$,$,$,(${context}),${units})`);
    const site = local('$', place3([0, 0, 0]));
    const storeyPlacement = local(site, place3([0, 0, 0]));
    const storey = e(`IFCBUILDINGSTOREY('s',$,'Stueplan',$,$,${storeyPlacement},$,$,.ELEMENT.,0.)`);
    void project;

    const mat = (name: string) => e(`IFCMATERIAL('${name}')`);
    const layerSet = (name: string, layers: [string, number][]) =>
        e(
            `IFCMATERIALLAYERSET((${layers.map(([m, t]) => e(`IFCMATERIALLAYER(${mat(m)},${t},$)`)).join(',')}),'${name}')`
        );
    const ext: [string, number][] = [
        ['Beklædning, træ', 22],
        ['Ventileret luftspalte', 25],
        ['Vindgips', 9],
        ['Træskelet 45x195 med mineraluld', 195],
        ['Dampspærre PE', 0.2],
        ['Gipsplade', 13],
    ];
    const t = ext.reduce((s, [, v]) => s + v, 0);
    const extSet = layerSet('Ydervæg, træ', ext);
    const partSet = layerSet('Indervæg', [
        ['Gipsplade', 13],
        ['Træskelet 45x95', 95],
        ['Gipsplade', 13],
    ]);

    const contained: string[] = [];
    const rels: string[] = [];
    const W = 8000;
    const D = 5000;
    const H = 2600;
    const wall = (
        name: string,
        a: number[],
        b: number[],
        set: string,
        thickness: number,
        offset: number
    ) => {
        const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
        const dx = (b[0]! - a[0]!) / len;
        const dy = (b[1]! - a[1]!) / len;
        const placement = local(storeyPlacement, place3([a[0]!, a[1]!, 0], [0, 0, 1], [dx, dy, 0]));
        const axis = e(
            `IFCSHAPEREPRESENTATION(${context},'Axis','Curve2D',(${e(`IFCPOLYLINE((${pt(0, 0)},${pt(len, 0)}))`)}))`
        );
        const profile = e(
            `IFCRECTANGLEPROFILEDEF(.AREA.,$,${e(`IFCAXIS2PLACEMENT2D(${pt(len / 2, 0)},$)`)},${len},${thickness})`
        );
        const solid = e(
            `IFCEXTRUDEDAREASOLID(${profile},${place3([0, 0, 0])},${dir(0, 0, 1)},${H})`
        );
        const body = e(`IFCSHAPEREPRESENTATION(${context},'Body','SweptSolid',(${solid}))`);
        const shape = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(${axis},${body}))`);
        const w = e(`IFCWALLSTANDARDCASE('${name}',$,'${name}',$,$,${placement},${shape},$)`);
        const usage = e(`IFCMATERIALLAYERSETUSAGE(${set},.AXIS2.,.POSITIVE.,${offset})`);
        rels.push(e(`IFCRELASSOCIATESMATERIAL('m${name}',$,$,$,(${w}),${usage})`));
        contained.push(w);
        return { w, placement, len };
    };
    // Counter-clockwise, the axis on each wall's middle, the layers from the outside (−y) in.
    const h = t / 2;
    const south = wall('S', [0, h], [W, h], extSet, t, -h);
    wall('E', [W - h, 0], [W - h, D], extSet, t, -h);
    wall('N', [W, D - h], [0, D - h], extSet, t, -h);
    wall('W', [h, D], [h, 0], extSet, t, -h);
    const partition = wall('P', [4000, t], [4000, D - t], partSet, 121, -60.5);

    const hole = (
        host: { w: string; placement: string },
        name: string,
        along: number,
        width: number,
        sill: number,
        height: number,
        depth: number,
        kind: 'IFCWINDOW' | 'IFCDOOR'
    ) => {
        const placement = local(host.placement, place3([along, 0, sill]));
        const profile = e(
            `IFCRECTANGLEPROFILEDEF(.AREA.,$,${e(`IFCAXIS2PLACEMENT2D(${pt(width / 2, 0)},$)`)},${width},${depth})`
        );
        const solid = e(
            `IFCEXTRUDEDAREASOLID(${profile},${place3([0, 0, 0])},${dir(0, 0, 1)},${height})`
        );
        const shape = e(
            `IFCPRODUCTDEFINITIONSHAPE($,$,(${e(`IFCSHAPEREPRESENTATION(${context},'Body','SweptSolid',(${solid}))`)}))`
        );
        const opening = e(
            `IFCOPENINGELEMENT('o${name}',$,'${name}',$,$,${placement},${shape},$,$)`
        );
        rels.push(e(`IFCRELVOIDSELEMENT('v${name}',$,$,$,${host.w},${opening})`));
        const filler = e(
            `${kind}('f${name}',$,'${name}',$,$,${placement},$,$,${height},${width},$,$,$)`
        );
        rels.push(e(`IFCRELFILLSELEMENT('r${name}',$,$,$,${opening},${filler})`));
        contained.push(filler);
    };
    // The window 1200 wide, its middle 2000 from the south-west corner over the cladding.
    hole(south, 'Vindue', 2000 - 600, 1200, 900, 1200, t, 'IFCWINDOW');
    hole(south, 'Hoveddør', 6000, 1000, 0, 2100, t, 'IFCDOOR');
    hole(partition, 'Indvendig dør', 1500, 900, 0, 2100, 121, 'IFCDOOR');

    // Two slopes of 30°, falling south and north from a ridge along x.
    const pitch = (30 * Math.PI) / 180;
    const slope = (side: 1 | -1, name: string) => {
        const run = D / 2 + 500;
        const centre = [W / 2, D / 2 + (side * run) / 2, H + (run / 2) * Math.tan(pitch)];
        const placement = local(
            storeyPlacement,
            place3(centre, [0, side * Math.sin(pitch), Math.cos(pitch)], [1, 0, 0])
        );
        const profile = e(
            `IFCRECTANGLEPROFILEDEF(.AREA.,$,${e(`IFCAXIS2PLACEMENT2D(${pt(0, 0)},$)`)},${W + 800},${run / Math.cos(pitch)})`
        );
        const solid = e(
            `IFCEXTRUDEDAREASOLID(${profile},${place3([0, 0, 0])},${dir(0, 0, 1)},250)`
        );
        const shape = e(
            `IFCPRODUCTDEFINITIONSHAPE($,$,(${e(`IFCSHAPEREPRESENTATION(${context},'Body','SweptSolid',(${solid}))`)}))`
        );
        return e(`IFCSLAB('${name}',$,'${name}',$,$,${placement},${shape},$,.ROOF.)`);
    };
    const slabs = [slope(-1, 'Tag syd'), slope(1, 'Tag nord')];
    const roof = e(`IFCROOF('roof',$,'Tag',$,$,${storeyPlacement},$,$,.GABLE_ROOF.)`);
    rels.push(e(`IFCRELAGGREGATES('ra',$,$,$,${roof},(${slabs.join(',')}))`));
    contained.push(roof);
    rels.push(e(`IFCRELCONTAINEDINSPATIALSTRUCTURE('c',$,$,$,(${contained.join(',')}),${storey})`));

    return [
        'ISO-10303-21;',
        'HEADER;',
        "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
        "FILE_NAME('lille-hus.ifc','2026-10-15T00:00:00',(''),(''),'','','');",
        "FILE_SCHEMA(('IFC4'));",
        'ENDSEC;',
        'DATA;',
        ...lines,
        'ENDSEC;',
        'END-ISO-10303-21;',
    ].join('\n');
}
