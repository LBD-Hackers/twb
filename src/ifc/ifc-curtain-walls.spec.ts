import { describe, expect, it } from 'vitest';
import { parseHouseFile } from '../house/house-file';
import { loadHouse } from '../house/load';
import { watertightReport } from '../house/watertight';
import { classifyAll } from '../surfacekit/model';
import { ifcToHouse, type IfcImportOptions } from './ifc-to-house';

type Json = Record<string, unknown>;
interface Opening {
    kind: string;
    at: [number, number];
    widthMm: number;
    heightMm: number;
    sillMm: number;
    storey?: string;
    glazing?: { mullions?: number; transoms?: number };
}

/** The office's footprint and storeys, mm: 12 × 8 m, two storeys of 3 m, walls of 200 mm concrete. */
const W = 12000;
const D = 8000;
const H = 3000;
const T = 200;

/**
 * A small office block, flat-roofed, as Revit writes one: concrete walls per storey on the
 * walls' middles, a flat roof slab over the top storey, and on demand a curtain wall set in the
 * south wall (a glazed panel), the ground floor's north wall a curtain wall with a door in it, a
 * canopy over the entrance under the upper storey, or a basement smaller than the house.
 */
function officeIfc(
    opts: {
        setIn?: boolean;
        facade?: boolean;
        canopy?: boolean;
        basement?: boolean;
        glassPartition?: boolean;
        /** Two rooms on each storey, a sliver between them where a partition would be. */
        rooms?: boolean;
        /** The east facade left out, as a converter may leave a curtain wall out. */
        gap?: boolean;
        /** A shed of its own east of the house on the ground floor, with a room in it. */
        annex?: boolean;
        /** The south wall in two in line, as two walls. */
        split?: boolean;
        /**
         * The ground floor's west room rising through the upper storey: the upper storey's rooms
         * round a 4 × 3 m hole over it, under a skylight of its own (`'roofed'`) or none.
         */
        hall?: 'roofed' | 'open';
    } = {}
): string {
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
    e(`IFCPROJECT('p',$,'Kontor',$,$,$,$,(${context}),${units})`);
    const site = local('$', place3([0, 0, 0]));
    const rels: string[] = [];
    const storeys = [
        ...(opts.basement ? [{ name: 'Kælder', z: -H }] : []),
        { name: 'Stueetage', z: 0 },
        { name: '1. sal', z: H },
    ].map((s) => {
        const placement = local(site, place3([0, 0, s.z]));
        const st = e(
            `IFCBUILDINGSTOREY('${s.name}',$,'${s.name}',$,$,${placement},$,$,.ELEMENT.,${s.z.toFixed(1)})`
        );
        return { ...s, st, contained: [] as string[] };
    });
    const storeyAt = (z: number) => storeys.find((s) => s.z === z)!;

    // A box in the world, extruded up from its floor: a slab, a mullion, a panel or a door.
    const boxShape = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
        const profile = e(
            `IFCRECTANGLEPROFILEDEF(.AREA.,$,${e(`IFCAXIS2PLACEMENT2D(${pt((x0 + x1) / 2, (y0 + y1) / 2)},$)`)},${x1 - x0},${y1 - y0})`
        );
        const solid = e(
            `IFCEXTRUDEDAREASOLID(${profile},${place3([0, 0, z0])},${dir(0, 0, 1)},${z1 - z0})`
        );
        return e(
            `IFCPRODUCTDEFINITIONSHAPE($,$,(${e(`IFCSHAPEREPRESENTATION(${context},'Body','SweptSolid',(${solid}))`)}))`
        );
    };
    const box = (
        type: string,
        name: string,
        b: [number, number, number, number, number, number],
        tail = '$'
    ) => e(`${type}('${name}',$,'${name}',$,$,${local(site, place3([0, 0, 0]))},${boxShape(...b)},$,${tail})`);

    const concrete = e(
        `IFCMATERIALLAYERSET((${e(`IFCMATERIALLAYER(${e("IFCMATERIAL('Beton')")},${T},$)`)}),'Ydervæg, beton 200')`
    );
    const wall = (name: string, a: number[], b: number[], z0: number, height: number) => {
        const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
        const dx = (b[0]! - a[0]!) / len;
        const dy = (b[1]! - a[1]!) / len;
        const placement = local(site, place3([a[0]!, a[1]!, z0], [0, 0, 1], [dx, dy, 0]));
        const axis = e(
            `IFCSHAPEREPRESENTATION(${context},'Axis','Curve2D',(${e(`IFCPOLYLINE((${pt(0, 0)},${pt(len, 0)}))`)}))`
        );
        const profile = e(
            `IFCRECTANGLEPROFILEDEF(.AREA.,$,${e(`IFCAXIS2PLACEMENT2D(${pt(len / 2, 0)},$)`)},${len},${T})`
        );
        const solid = e(
            `IFCEXTRUDEDAREASOLID(${profile},${place3([0, 0, 0])},${dir(0, 0, 1)},${height})`
        );
        const body = e(`IFCSHAPEREPRESENTATION(${context},'Body','SweptSolid',(${solid}))`);
        const w = e(
            `IFCWALLSTANDARDCASE('${name}',$,'${name}',$,$,${placement},${e(`IFCPRODUCTDEFINITIONSHAPE($,$,(${axis},${body}))`)},$)`
        );
        const usage = e(`IFCMATERIALLAYERSETUSAGE(${concrete},.AXIS2.,.POSITIVE.,${-T / 2})`);
        rels.push(e(`IFCRELASSOCIATESMATERIAL('m${name}',$,$,$,(${w}),${usage})`));
        storeyAt(z0).contained.push(w);
    };
    // A curtain wall along x at `y`, from x0 to x1 and z0 to z1: mullions at each x of `posts`
    // (its ends among them), transoms at its foot and head and at each z of `rails`, a panel in
    // each bay.
    const curtainWall = (
        name: string,
        y: number,
        posts: number[],
        z0: number,
        z1: number,
        rails: number[] = []
    ) => {
        const parts: string[] = [];
        const half = 50;
        for (const x of posts)
            parts.push(box('IFCMEMBER', `${name} post ${x}`, [x - 30, x + 30, y - half, y + half, z0, z1]));
        for (const z of [z0, ...rails, z1 - 60])
            parts.push(
                box('IFCMEMBER', `${name} rail ${z}`, [posts[0]!, posts[posts.length - 1]!, y - half, y + half, z, z + 60])
            );
        for (let i = 0; i + 1 < posts.length; i++)
            parts.push(
                box('IFCPLATE', `${name} panel ${i}`, [posts[i]! + 30, posts[i + 1]! - 30, y - 10, y + 10, z0 + 60, z1 - 60])
            );
        const cw = e(
            `IFCCURTAINWALL('${name}',$,'${name}',$,$,${local(site, place3([0, 0, 0]))},$,$,.NOTDEFINED.)`
        );
        rels.push(e(`IFCRELAGGREGATES('a${name}',$,$,$,${cw},(${parts.join(',')}))`));
        storeyAt(z0 < H ? (z0 < 0 ? -H : 0) : H).contained.push(cw);
    };

    const h = T / 2;
    const ring = (z0: number, height: number, north = true) => {
        if (opts.split) {
            wall(`S${z0}a`, [0, h], [5000, h], z0, height);
            wall(`S${z0}b`, [5000, h], [W, h], z0, height);
        } else wall(`S${z0}`, [0, h], [W, h], z0, height);
        if (!opts.gap) wall(`E${z0}`, [W - h, 0], [W - h, D], z0, height);
        if (north) wall(`N${z0}`, [W, D - h], [0, D - h], z0, height);
        wall(`W${z0}`, [h, D], [h, 0], z0, height);
    };
    ring(0, H, !opts.facade);
    ring(H, H);
    if (opts.hall) {
        const st = storeyAt(0);
        st.contained.push(box('IFCSPACE', 'Hal', [T, 5950, T, D - T, 0, H - 300]));
        st.contained.push(box('IFCSPACE', 'Kontor', [6050, W - T, T, D - T, 0, H - 300]));
        // Round the hole from x 1000 to 5000 and y 2500 to 5500, on the upper storey.
        const up = storeyAt(H);
        for (const [i, b] of ([
            [T, W - T, T, 2500],
            [T, W - T, 5500, D - T],
            [T, 1000, 2500, 5500],
            [5000, W - T, 2500, 5500],
        ] as const).entries())
            up.contained.push(box('IFCSPACE', `Rum ${i}`, [b[0], b[1], b[2], b[3], H, 2 * H - 300]));
    }
    if (opts.rooms) {
        for (const z of [0, H]) {
            const st = storeyAt(z);
            st.contained.push(box('IFCSPACE', `Rum ${z} vest`, [T, 5950, T, D - T, z, z + H - 300]));
            st.contained.push(box('IFCSPACE', `Rum ${z} øst`, [6050, W - T, T, D - T, z, z + H - 300]));
        }
    }
    if (opts.annex) {
        const [x0, x1, y1] = [W + 5000, W + 9000, 4000];
        wall('AS', [x0, h], [x1, h], 0, H);
        wall('AE', [x1 - h, 0], [x1 - h, y1], 0, H);
        wall('AN', [x1, y1 - h], [x0, y1 - h], 0, H);
        wall('AW', [x0 + h, y1], [x0 + h, 0], 0, H);
        storeyAt(0).contained.push(box('IFCSPACE', 'Skur', [x0 + T, x1 - T, T, y1 - T, 0, H - 300]));
    }
    if (opts.basement) {
        // A plant room under the middle of the house: its own four walls, smaller than the house.
        wall('KS', [3000, 2000], [7000, 2000], -H, H);
        wall('KE', [7000, 2000], [7000, 5000], -H, H);
        wall('KN', [7000, 5000], [3000, 5000], -H, H);
        wall('KW', [3000, 5000], [3000, 2000], -H, H);
    }
    if (opts.setIn) curtainWall('Glasfelt', h, [3000, 4000], 900, 2100);
    if (opts.glassPartition) {
        // A glazed partition across the ground floor, Revit's way: each panel a curtain wall of its
        // own, 120 mm between them; and a partition that stops in the gap between two.
        curtainWall('Glas 1', 4000, [4000, 4940], 0, 2900);
        curtainWall('Glas 2', 4000, [5060, 6000], 0, 2900);
        curtainWall('Glas 3', 4000, [6120, 7060], 0, 2900);
        wall('P', [5000, 4100], [5000, D - h], 0, H);
    }
    if (opts.facade) {
        curtainWall('Facade', D - h, [h, 3000, 6000, 9000, W - h], 0, H - 50, [2100]);
        storeyAt(0).contained.push(
            // Its body takes in its leaf's swing, 800 mm into the room, as Revit writes a
            // curtain wall's door: its middle stands well off the glass.
            box('IFCDOOR', 'Glasdør', [7000, 8000, D - h - 800, D - h + 50, 60, 2100], '$,2040,1000,$,$,$')
        );
    }
    // The flat roof over the top storey, and the canopy over the entrance under it.
    const slabs = [box('IFCSLAB', 'Tag', [0, W, 0, D, 2 * H, 2 * H + 250], '.ROOF.')];
    if (opts.canopy) slabs.push(box('IFCSLAB', 'Baldakin', [3000, 6000, -2000, 0, 2600, 2800], '.ROOF.'));
    if (opts.hall === 'roofed')
        slabs.push(box('IFCSLAB', 'Ovenlys', [1000, 5000, 2500, 5500, 2 * H + 250, 2 * H + 400], '.ROOF.'));
    const roof = e(`IFCROOF('roof',$,'Tag',$,$,${local(site, place3([0, 0, 0]))},$,$,.FLAT_ROOF.)`);
    rels.push(e(`IFCRELAGGREGATES('ra',$,$,$,${roof},(${slabs.join(',')}))`));
    storeyAt(H).contained.push(roof);
    for (const s of storeys)
        if (s.contained.length > 0)
            rels.push(
                e(`IFCRELCONTAINEDINSPATIALSTRUCTURE('c${s.name}',$,$,$,(${s.contained.join(',')}),${s.st})`)
            );

    return [
        'ISO-10303-21;',
        'HEADER;',
        "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
        "FILE_NAME('kontor.ifc','2026-10-19T00:00:00',(''),(''),'','','');",
        "FILE_SCHEMA(('IFC4'));",
        'ENDSEC;',
        'DATA;',
        ...lines,
        'ENDSEC;',
        'END-ISO-10303-21;',
    ].join('\n');
}

const read = (opts: Parameters<typeof officeIfc>[0], options: IfcImportOptions = {}) => {
    const { house, report } = ifcToHouse(officeIfc(opts), options);
    const h = house as Json;
    return {
        h,
        report,
        openings: (h['openings'] as Opening[] | undefined) ?? [],
        storeys: (h['storeys'] as { name: string; elevationMm: number }[] | undefined) ?? [],
        warned: report.warnings.join('\n'),
        skipped: report.skipped.map((s) => s.type),
    };
};

describe('a curtain wall set in a wall', () => {
    const { openings, skipped, warned } = read({ setIn: true });

    it('is a window in that wall, where the panel is', () => {
        const glazed = openings.filter((o) => o.kind === 'window');
        // 3500 along the south wall, whose line the origin is on: the hole is out to the posts'
        // outer faces, 30 mm past their middles, and from the foot rail's underside to the head's top.
        expect(glazed).toEqual([
            expect.objectContaining({ at: [3400, 0], widthMm: 1060, heightMm: 1200, sillMm: 900 }),
        ]);
        expect(warned).toContain('1 curtain wall set in a wall');
    });

    it('is not left out', () => {
        expect(skipped).not.toContain('IFCCURTAINWALL');
    });
});

describe('a facade that is a curtain wall', () => {
    const { h, openings, skipped, warned } = read({ facade: true });
    const north = openings.filter((o) => o.at[1] === D - T && !o.storey?.startsWith('1'));

    it('closes the outline as its wall', () => {
        expect((h['walls'] as unknown[]).length).toBe(4);
        expect(skipped).not.toContain('IFCCURTAINWALL');
    });

    it('is glazed bay by bay, a stud pier at each mullion, its transom kept', () => {
        const windows = north.filter((o) => o.kind === 'window').sort((a, b) => a.at[0] - b.at[0]);
        // The bays between the posts' middles, less a full pier at each end of the wall and half
        // a pier either side of each mullion: the corner posts stand 30 mm in from its ends.
        expect(windows.map((o) => [o.widthMm, o.sillMm, o.glazing?.transoms])).toEqual([
            [2930 - 90 - 45, 0, 1],
            [3000 - 90, 0, 1],
            [2930 - 45 - 90, 0, 1],
        ]);
        // From the floor up to the header, 300 mm under the storey above: the glass runs higher.
        expect(windows.map((o) => o.heightMm)).toEqual([H - 300, H - 300, H - 300]);
        expect(warned).toContain('built as a wall of the house\'s frame glazed bay by bay: 3 windows');
    });

    it('gives the bay with the door in it to the door', () => {
        const doors = north.filter((o) => o.kind === 'door');
        expect(doors).toHaveLength(1);
        expect(doors[0]!.at[0]).toBe(7500 - T / 2);
    });

    it('parses as a house file', () => {
        expect(parseHouseFile(JSON.stringify(h)).errors).toEqual([]);
    });
});

describe('a canopy under the top storey', () => {
    const { h, storeys, warned } = read({ canopy: true });

    it('does not take the upper storey out of the house: the eave stays over it', () => {
        expect(storeys.map((s) => s.name)).toEqual(['Stueetage', '1. sal']);
        expect(h['wallHeightMm']).toBe(2 * H);
        expect(warned).toContain('the house file has one eave over every storey');
    });

    it('is left alone where no roof is under the top storey', () => {
        expect(read({}).warned).not.toContain('one eave over every storey');
        expect(read({}).h['wallHeightMm']).toBe(2 * H);
    });
});

describe('a basement smaller than the house', () => {
    const { h, storeys, warned } = read({ basement: true });

    it('stands each storey on its own outline: the basement on its own walls, the house on the ground floor\'s', () => {
        const walls = h['walls'] as { storey?: string; points: number[][] }[];
        const extent = (storey: string) => {
            const pts = walls.filter((w) => w.storey === storey).flatMap((w) => w.points);
            const xs = pts.map((p) => p[0]!);
            const ys = pts.map((p) => p[1]!);
            return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
        };
        expect(storeys.map((s) => s.name)).toEqual(['Kælder', 'Stueetage', '1. sal']);
        expect(walls.filter((w) => w.storey === 'Kælder')).toHaveLength(4);
        expect(extent('Stueetage')).toEqual([W - T, D - T]);
        expect(extent('1. sal')).toEqual([W - T, D - T]);
        expect(extent('Kælder')[0]).toBeLessThan(W - T);
        expect(warned).toContain('Each storey stands on its plate');
        expect(warned).not.toContain('The outline is read on');
    });

    it('stands each storey on the outline its own walls close round, with no repair', () => {
        const { warned: plain } = read({ basement: true }, { repair: 'none' });
        expect(plain).toContain("The storeys' facades close round outlines of their own");
        expect(plain).not.toContain('Each storey stands on its plate');
    });

    it('builds the basement\'s walls as its facade, not as partitions under the house', () => {
        const runs = (h['interiorWalls'] as { storey?: string }[] | undefined) ?? [];
        expect(runs.filter((r) => r.storey === 'Kælder')).toHaveLength(0);
    });

    it('opens with a floor on each storey and the roof over the top one', () => {
        const house = loadHouse(h, { snapToModule: false });
        expect(house.problems).toEqual([]);
        const kinds = classifyAll(house.store.surfaces());
        const of = (kind: string) => house.store.surfaces().filter((s) => kinds.get(s.id) === kind);
        expect(of('floor')).toHaveLength(3);
        expect(of('roof')).toHaveLength(1);
        expect(of('wall')).toHaveLength(12);
    });
});

describe('a glazed partition of one curtain wall per panel', () => {
    const { h, report, warned } = read({ glassPartition: true });
    const runs = (h['interiorWalls'] as { points: [number, number][] }[]).map((r) => r.points);
    // 4000 in the IFC, less the 100 to the walls' lines the origin is moved by.
    const glassLine = 4000 - T / 2;

    it('is one wall of glass along the line', () => {
        const glass = runs.filter((p) => p.every(([, y]) => y === glassLine));
        expect(glass).toHaveLength(1);
        const xs = glass[0]!.map(([x]) => x);
        // From the first panel's outer post face to the last one's.
        expect([Math.min(...xs), Math.max(...xs)]).toEqual([3970 - T / 2, 7090 - T / 2]);
        expect(warned).toContain('3 curtain walls standing side by side on a line are joined into 1');
    });

    it('takes the partition that stopped in the gap between two panels onto its line', () => {
        const partition = runs.find((p) => p.every(([x]) => x === 5000 - T / 2))!;
        expect(Math.min(...partition.map(([, y]) => y))).toBe(glassLine);
    });

    it('measures each window’s glass off its panel: 880 × 2780 mm', () => {
        expect(report.curtainGlass.map((g) => [g.glassAreaM2, g.panes])).toEqual([
            [2.45, 1],
            [2.45, 1],
            [2.45, 1],
        ]);
    });
});

describe('the repair an import makes', () => {
    const loadOf = (h: Json) => loadHouse(h, { snapToModule: false });

    it('leaves a house whose facade closes round its rooms as it is, and says it is watertight', () => {
        const none = read({ rooms: true }, { repair: 'none' });
        const watertight = read({ rooms: true });
        expect(watertight.h).toEqual(none.h);
        expect(none.report.watertight).toBeUndefined();
        expect(watertight.report.watertight).toMatchObject({ watertight: true, leaks: [], openRooms: [] });
        expect(watertightReport(loadOf(watertight.h)).leaks).toEqual([]);
    });

    it('fills a facade the model leaves out with a wall on the line its rooms say', () => {
        const none = read({ rooms: true, gap: true }, { repair: 'none' });
        // With no repair, the three walls close round nothing: no floor, no roof.
        expect(watertightReport(loadOf(none.h)).watertight).toBe(false);
        const { h, report, warned } = read({ rooms: true, gap: true });
        expect(report.changes.map((c) => c.id)).toContain('facade/filled');
        // One on each storey.
        expect(warned).toContain('2 stretches of the storeys');
        // Half the house's own wall out from the rooms' edge: where the wall's line would be.
        const walls = h['walls'] as { storey?: string; points: number[][]; buildUpType?: string }[];
        const east = walls.filter((w) => w.points.every((p) => p[0] === W - T));
        expect(east.map((w) => w.storey)).toEqual(['Stueetage', '1. sal']);
        expect(report.watertight).toMatchObject({ leaks: [] });
    });

    it('gives a shed apart from the house a block of its own, closed', () => {
        const { h, report } = read({ rooms: true, annex: true });
        expect(report.changes.map((c) => c.id)).toEqual(expect.arrayContaining(['outline/plates', 'outline/blocks']));
        const loaded = loadOf(h);
        const kinds = classifyAll(loaded.store.surfaces());
        const floors = loaded.store.surfaces().filter((s) => kinds.get(s.id) === 'floor');
        // The ground floor's two blocks, and the upper storey's.
        expect(floors.map((f) => f.id).sort()).toEqual(['floor', 'floor-1-sal', 'floor-2']);
        expect(report.watertight).toMatchObject({ leaks: [] });
    });

    it('reads a hole over a room under a roof of its own as that room rising through the storey', () => {
        const { h, report } = read({ hall: 'roofed' });
        expect(report.changes.map((c) => c.id)).toContain('outline/voids');
        expect(report.changes.map((c) => c.id)).not.toContain('outline/courtyards');
        // The main roof over the top storey, and the hall's at the top of the storey it rises to.
        const roofs = h['roof'] as { storey?: string; outline?: number[][] }[];
        expect(roofs.map((r) => [r.storey, !!r.outline])).toEqual([
            ['1. sal', false],
            ['1. sal', true],
        ]);
        const loaded = loadOf(h);
        const byId = new Map(loaded.store.surfaces().map((s) => [s.id, s]));
        expect(byId.get('floor-1-sal')!.holes).toHaveLength(1);
        // Nothing roofs the ground floor under it: the hall goes on up.
        expect([...byId.keys()].filter((id) => id.startsWith('roof-stueetage'))).toEqual([]);
        expect(report.watertight).toMatchObject({ leaks: [] });
    });

    it('leaves a hole over a room with no roof of its own a courtyard, the room roofed under it', () => {
        const { h, report } = read({ hall: 'open' });
        expect(report.changes.map((c) => c.id)).toContain('outline/courtyards');
        expect(Array.isArray(h['roof'])).toBe(false);
        const loaded = loadOf(h);
        expect(loaded.store.surfaces().some((s) => s.id.startsWith('roof-stueetage'))).toBe(true);
        expect(report.watertight).toMatchObject({ leaks: [] });
    });

    it('runs a wall the model has in two on as one, from clean up', () => {
        const none = read({ split: true }, { repair: 'none' });
        const clean = read({ split: true }, { repair: 'clean' });
        expect((none.h['walls'] as unknown[]).length).toBe(5);
        expect((clean.h['walls'] as unknown[]).length).toBe(4);
        expect(clean.report.changes.map((c) => c.id)).toContain('clean/lines');
        expect(clean.report.watertight).toMatchObject({ leaks: [] });
    });
});
