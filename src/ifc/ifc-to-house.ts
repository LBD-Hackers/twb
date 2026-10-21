/**
 * An IFC model read into a house file: `twb/1`, in the simple shape (`house/simple-house.ts`) —
 * the exterior walls as plan lines, the storeys, the wall height, the windows and doors by their
 * centre and size, the roof by its type and pitch, the partitions, the rooms and the fittings —
 * with the build-ups read off the IFC's material layers. The faces and gables are worked out from
 * that by `expandSimpleHouse` as for a house read from drawings, and a tool that derives a building
 * (arch: the frame, the envelope, the analyses) derives it as it would from any house file.
 *
 * **Heavy or light, from the layers.** A wall's core is the layer that carries: a leaf of
 * masonry or concrete of 75 mm or more (block before facing brick, the thickest of them), or else
 * its layer of studs, or else its insulation (`pickCore`). A core of masonry or concrete makes the
 * wall heavy, and a house whose exterior walls are heavy is a masonry house
 * (`constructionSystem: "masonry"`); otherwise a timber frame.
 *
 * **Where a wall's line is.** arch builds a wall on one line: through the middle of its studs, or
 * of the inner leaf that carries the roof. IFC gives a wall's axis and
 * how its layers lie on it (`IfcMaterialLayerSetUsage`), so the line is put through the middle of
 * the core, wherever it is in the wall: 263 mm in from the brick face of a brick-on-block wall,
 * on the axis of a stud partition. A wall of two leaves that carry (a party wall) stands on one
 * of them, as the house file has it: between two rooms the one with the other on its back, on
 * the outline its own dwelling's (`onLeftLeaf`, `onRoomLeaf`).
 *
 * **Which walls are exterior** is read off the geometry, not `IsExternal` (a party wall between
 * two dwellings says it is): the exterior walls are the ones whose lines close round the house,
 * each meeting the next at a corner (`findLoop`). Their corners are where their lines meet. The
 * rest are partitions (`interiorWalls`), each on the storeys it stands on, its ends taken to the
 * line of the wall they meet; a party wall, stood on one leaf, is met at its other leaf and its
 * linings too. Where rooms meet with no wall between them, a separation parts them on the line of the wall
 * it runs on from, and every end left short of a line is taken to it, so the rooms close. A wall
 * lining another (a furring wall against a party wall), a wall
 * under 1.2 m (a soffit, a knee wall) and the foundation's walls are left out.
 *
 * **Openings** are read from the hole each door or window fills (`IfcOpeningElement`): its
 * extent along the wall's line, its sill and its height. A door's leaves and a window's division
 * come from its type (`IfcDoorStyle`/`IfcWindowStyle`, IFC4's `OperationType` and
 * `PartitioningType`).
 *
 * **Build-ups** (`envelope`): the exterior wall's from the layer set most of its length has; the
 * partitions' by kind — the house's own (`interiorWall`), the other kind's (`lightPartition`,
 * `heavyPartition`) and the party walls' (`partyWall`) — each from the layer set most of its
 * walls' length has, every other layer set of a kind a build-up type of it (`interiorWall:<key>`)
 * its walls are dressed in (`partition`, `buildUpType` on the run); the roof's from the roof, the ground floor's from its slab with the finish
 * laid on it, and the floor between storeys' (`deck`) from the upper storeys' slab with its finish
 * — each inside → outside, the core marked, studs as timber members c/c 600. A floor's or a roof's
 * heavy core is a slab: hollow-core slabs where the IFC names them so, else concrete cast in place.
 * A heavy house says so as its own choice too (`floorStructure`, `roofStructure`,
 * so a use or an expression picked later keeps them concrete.
 *
 * What does not fit the house file (a stair, a steel beam, a roof window in a flat roof) is left
 * out and listed in the report, which also goes into the file's `notes` — see
 * `docs/ifc-import.md`.
 *
 * Coordinates: arch's x east, y north, z up, in mm, with the origin at the south-west corner of
 * the exterior walls' lines and the lowest storey's floor. The IFC's own axes are kept (its
 * project north is taken as north; a true north the file gives is reported, not applied).
 *
 * Pure: no DOM, no three.js.
 */

import type { FileOpeningType, HouseFile } from '../house/house-file';
import { toTwbHouse } from '../house/house-jsonld';
import {
    DETAILED_OPENING_KINDS,
    FLOOR_STRUCTURE_LABELS,
    ROOF_STRUCTURE_LABELS,
    defaultThicknessMm,
    expressionDef,
    openingTakesDetail,
    type FloorStructure,
    type RoofStructure,
} from './catalogue';
import type { PartitionKind } from '../surfacekit/model';
import { isEnum, type StepEntity } from './step';
import { apply, applyDir, IfcModel, scale, type IfcLayer, type Vec3 } from './ifc-model';
import { isTimber, matchMaterial, type LayerRole } from './ifc-materials';

interface P2 {
    x: number;
    y: number;
}

export interface IfcImportOptions {
    /** The project's name; left out, the IFC project's or building's. */
    name?: string;
}

/** Elements of one kind left out for one reason. */
export interface SkippedGroup {
    reason: string;
    /** The IFC entity type, `IFCSTAIR`. */
    type: string;
    count: number;
    /** A few of their names. */
    names: string[];
}

/** One change the import made from what the model says (`IfcImportReport.changes`). */
export interface ImportChange {
    id: string;
    title: string;
    detail: string;
}

export interface IfcImportReport {
    schema: string;
    /** Heavy: the exterior walls' core is masonry or concrete. Light: studs. */
    construction: 'heavy' | 'light';
    /** The storeys, each by its floor's elevation on `originMm` and its height to the next. */
    storeys: { name: string; elevationMm: number; heightMm: number }[];
    /**
     * Where the house file's origin is in the IFC's own coordinates, mm: `x` and `y` the
     * south-west corner of the exterior walls' lines, `z` the lowest storey's floor. A point `p`
     * of the IFC is at `p − originMm` in the house file, to 0.1 mm in plan, so a tool that reads
     * more of the IFC itself (its stairs) lays that out on the house.
     */
    originMm: { x: number; y: number; z: number };
    exteriorWalls: number;
    partitions: number;
    openings: number;
    zones: number;
    fixtures: number;
    lines: number;
    /** The IFC layer set each build-up was read from. */
    buildups: Partial<Record<'exteriorWall' | PartitionBuildUp | 'roof' | 'floor' | 'deck', string>>;
    /** The partitions' other build-ups, each a type of its kind (`interiorWall:plumbing`). */
    buildUpTypes: { id: string; layerSet: string }[];
    /** The window and door types, each from the IFC type it was read from (`window-2` ← its name). */
    openingTypes: { id: string; ifcType: string }[];
    /**
     * The holes the windows in the roof fill, which the house file has no place for: each by its
     * middle in plan (as the house file's positions are) and its size measured on the roof —
     * `widthMm` along the eave, `heightMm` up the slope. A tool that makes roof windows reads them.
     */
    roofOpenings: RoofOpening[];
    /** What the floors between storeys and the roof are, read off their cores. */
    structure: { floors: FloorStructure; roof: RoofStructure };
    /** IFC material names no rule knew, with what they were read as. */
    guessedMaterials: string[];
    skipped: SkippedGroup[];
    /**
     * The IFC's true north: degrees clockwise in plan from the file's project north (+y) to true
     * north, from its `IfcGeometricRepresentationContext`. Reported, not applied; null when the
     * file gives none.
     */
    trueNorthDeg: number | null;
    warnings: string[];
    /**
     * What the import changed from what the model says so the house file can hold it, each once
     * by a stable id (`outline/storey`, `curtain-walls/joined`, `opening/<step id>`, …), with a
     * title and the detail that is also among the `warnings`. A tool lists them for its user.
     */
    changes: ImportChange[];
    /**
     * The glass of each window made of a curtain wall, measured off its panels: what a room's
     * glass in curtain walls is counted from. Not in the house file.
     */
    curtainGlass: CurtainGlass[];
}

/** A hole in the roof a window fills (`IfcImportReport.roofOpenings`). */
export interface RoofOpening {
    at: [number, number];
    widthMm: number;
    heightMm: number;
}

export interface IfcImport {
    /** The house file, `twb/1`. */
    house: Record<string, unknown>;
    report: IfcImportReport;
}

/** The wall heights, mm: a storey has walls of at least this standing on it. */
const STOREY_WALL_MM = 1800;
/** A wall lower than this is not a wall of a room: a parapet, a soffit, a knee wall. */
const MIN_WALL_MM = 1200;
/**
 * How far an upper storey's slab may lie under the storey's level, mm: its top, under the floating
 * floor and screed its storey's level is the top of.
 */
const UPPER_FLOOR_REACH_MM = 150;
/** A heavy layer at least this thick can carry. */
const MIN_LEAF_MM = 75;
/** How far a corner may be from a wall's end, past the wall's thickness. */
const CORNER_REACH_MM = 300;
/** How much more an upper storey's facade must close round than the lowest floor's to be the outline. */
const OUTLINE_GAIN = 1.25;
/** How far a curtain wall may stand past its host wall's ends and faces and still be set in it, mm. */
const SET_IN_MM = 50;
/** Members closer than this along a curtain wall (or up it) are one mullion (or transom), mm. */
const GRID_MERGE_MM = 50;
/** A curtain wall's bay narrower than this, its piers taken off, holds no window: arch's narrowest, mm. */
const MIN_BAY_MM = 400;
/** Over a glazed bay: room for the header arch frames over a window, under the storey above, mm. */
const BAY_HEAD_MM = 300;
/** The most transoms a glazed bay is divided by: arch's window is at most three panes high. */
const MAX_BAY_TRANSOMS = 2;
/** Curtain walls this far apart along one line, or less, are one wall of glass, mm: a mullion's gap. */
const JOIN_GAP_MM = 300;
/** Curtain walls within a degree of each other run the same way. */
const JOIN_COS = Math.cos((1 * Math.PI) / 180);
/** Two king studs back to back: the least wall arch frames between two openings, mm. */
const MIN_PIER_MM = 90;
/** How far a partition's end may be from the wall it meets. */
const PARTITION_REACH_MM = 400;
/** A ceiling hung more than this below what is over it is a lowered one. */
const LOWERED_MM = 300;
/** Lines this close are one line. */
const ON_LINE_MM = 30;
/** The shortest stretch of a partition cut where a lining starts or stops, mm: a shorter one goes with its neighbour. */
const MIN_PIECE_MM = 300;
/** A point this close to a line is on it. */
const ON_POINT_MM = 1;

/** Why a window in the roof is left out of the house file; its hole is in `roofOpenings`. */
const ROOF_WINDOW_SKIPPED =
    "a window in the roof: the house file's simple shape has no openings in a roof; the hole it fills is in the report's roofOpenings.";

/** What a file picker offers for an IFC model. */
export const IFC_FILE_ACCEPT = '.ifc,application/x-step';

/** Whether a file is an IFC model, by its name. */
export function isIfcFileName(name: string): boolean {
    return /\.ifc$/i.test(name);
}

/** Reads an IFC file into a house file. Throws only on a file that is not IFC at all. */
export function ifcToHouse(text: string, options: IfcImportOptions = {}): IfcImport {
    return new Importer(IfcModel.read(text), options).run();
}

/** The report as lines of text: for the house file's notes, a status line, the CLI. */
export function ifcImportSummary(r: IfcImportReport): string[] {
    const lines = [
        `Read from IFC (${r.schema}): ${r.construction === 'heavy' ? 'heavy (masonry)' : 'light (frame)'} construction, ` +
            `${r.storeys.length} storey${r.storeys.length === 1 ? '' : 's'}, ${r.exteriorWalls} exterior walls, ` +
            `${r.partitions} partition runs, ${r.openings} windows and doors, ${r.zones} rooms, ` +
            `${r.fixtures} fittings${r.lines ? `, ${r.lines} posts and beams` : ''}.`,
    ];
    if (r.structure.floors !== 'timber' || r.structure.roof !== 'timber') {
        lines.push(
            `Floors between storeys: ${FLOOR_STRUCTURE_LABELS[r.structure.floors].toLowerCase()}; ` +
                `roof: ${ROOF_STRUCTURE_LABELS[r.structure.roof].toLowerCase()}.`
        );
    }
    const buildups = Object.entries(r.buildups);
    if (buildups.length > 0) {
        lines.push(`Build-ups from: ${buildups.map(([k, v]) => `${k} ← "${v}"`).join('; ')}.`);
    }
    if (r.openingTypes.length > 0) {
        lines.push(
            `Window and door types from: ${r.openingTypes.map((t) => `${t.id} ← "${t.ifcType}"`).join('; ')}.`
        );
    }
    if (r.buildUpTypes.length > 0) {
        lines.push(
            `Build-up types from: ${r.buildUpTypes.map((t) => `${t.id} ← "${t.layerSet}"`).join('; ')}.`
        );
    }
    if (r.guessedMaterials.length > 0) {
        lines.push(`Materials guessed: ${r.guessedMaterials.join('; ')}.`);
    }
    for (const w of r.warnings) lines.push(w);
    for (const s of r.skipped) {
        const names =
            s.names.length > 0
                ? ` (${s.names.join(', ')}${s.count > s.names.length ? ', …' : ''})`
                : '';
        lines.push(`Left out: ${s.count} × ${s.type}${names} — ${s.reason}`);
    }
    return lines;
}

// ---- Walls -------------------------------------------------------------------------------------

interface Wall {
    e: StepEntity;
    name: string;
    /** The IFC axis, in plan. */
    axisA: P2;
    axisB: P2;
    /** Along the axis, and the layers' direction across it (the placement's y), unit vectors. */
    dir: P2;
    normal: P2;
    zLo: number;
    zHi: number;
    /** As the file lists them. */
    layers: IfcLayer[];
    /** Across the axis, where the first layer starts and which way the layers run. */
    offset: number;
    sense: 1 | -1;
    thickness: number;
    core: number;
    heavy: boolean;
    /** Across the axis, where arch's line is. */
    lineY: number;
    /** arch's line. */
    a: P2;
    b: P2;
    layerSetName: string;
    loadBearing: boolean | null;
    isExternal: boolean | null;
    /** A curtain wall's grid: a wall of glass between mullions, with no layers of its own. */
    curtain?: CurtainGrid;
}

/**
 * Where a curtain wall's mullions and transoms stand: each vertical member by its middle along
 * the wall's line (mm from `a`) and the heights it spans, each horizontal one by its middle
 * height and the stretch of the line it spans.
 */
interface CurtainGrid {
    mullions: { t: number; zLo: number; zHi: number }[];
    transoms: { z: number; tLo: number; tHi: number }[];
    /** Its panels (`IfcPlate`), each by the stretch of the line and the heights it covers. */
    panes: { tLo: number; tHi: number; zLo: number; zHi: number }[];
    /** How many of the IFC's curtain walls it is: panels side by side on a line are joined. */
    panels: number;
}

/** The glass of a window made of a curtain wall, measured off its panels, for the quantities. */
export interface CurtainGlass {
    /** The window's `at` and `storey`, as the house file has them. */
    at: [number, number];
    storey?: string;
    /** The panels' area, m², and how many there are. */
    glassAreaM2: number;
    panes: number;
}

type WallRole = 'exterior' | 'partition' | 'foundation' | 'parapet' | 'short' | 'lining';

interface LivingStorey {
    name: string;
    elev: number;
    /** The next storey's elevation, or the eave for the top one. */
    top: number;
}

interface Corner {
    at: P2;
}

class Importer {
    private readonly skipped = new Map<string, SkippedGroup>();
    private readonly warnings: string[] = [];
    private readonly changes: ImportChange[] = [];

    /**
     * A change from what the model says, made so the house file can hold it: reported once under
     * `id` (`report.changes`), its detail with the warnings.
     */
    private change(id: string, title: string, detail: string): void {
        if (this.changes.some((c) => c.id === id)) return;
        this.changes.push({ id, title, detail });
        if (!this.warnings.includes(detail)) this.warnings.push(detail);
    }
    private readonly guessed = new Map<string, string>();

    constructor(
        private readonly m: IfcModel,
        private readonly options: IfcImportOptions
    ) {}

    run(): IfcImport {
        const m = this.m;
        const basicWalls = m
            .all('IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE')
            .map((e) => this.readWall(e))
            .filter((w): w is Wall => !!w);
        // A curtain wall set in a wall (Revit's way of drawing a glazed panel in a wall) is a
        // window in that wall; one standing on its own is a wall of glass, read as any wall is.
        const curtains = m
            .all('IFCCURTAINWALL')
            .map((e) => this.readCurtainWall(e))
            .filter((w): w is Wall => !!w);
        const setIn = new Map<Wall, Wall>();
        for (const cw of curtains) {
            const host = hostWallOf(cw, basicWalls);
            if (host) setIn.set(cw, host);
        }
        // Revit writes a glazed wall's every panel as a curtain wall of its own: side by side on a
        // line they are one wall of glass, which a partition can meet.
        const free = curtains.filter((cw) => !setIn.has(cw));
        const glassWalls = joinCurtains(free);
        if (glassWalls.length < free.length) {
            this.change(
                'curtain-walls/joined',
                `${free.length} curtain walls joined into ${glassWalls.length}`,
                `${free.length} curtain walls standing side by side on a line are joined into ${glassWalls.length} walls of glass: ` +
                    'Revit writes each panel of a glazed wall as a curtain wall of its own.'
            );
        }
        const walls = [...basicWalls, ...glassWalls];
        const spaces = m.all('IFCSPACE');

        // ---- Storeys: the ones rooms stand on.
        const storeyEntities = m
            .all('IFCBUILDINGSTOREY')
            .map((e) => ({ e, name: m.name(e) || `Storey ${e.id}`, elev: this.storeyElevation(e) }))
            .sort((a, b) => a.elev - b.elev);
        const tall = walls.filter((w) => w.zHi - w.zLo >= STOREY_WALL_MM);
        const wallTop = tall.length > 0 ? Math.max(...tall.map((w) => w.zHi)) : 0;
        const spaceBoxes = spaces.map((s) => ({ s, box: box3(m.bodyPoints(s)) }));
        let living: { name: string; elev: number }[] = storeyEntities.filter(
            (st) =>
                st.elev <= wallTop - STOREY_WALL_MM &&
                (tall.some((w) => Math.abs(w.zLo - st.elev) <= 400) ||
                    spaceBoxes.some(
                        ({ box }) =>
                            box &&
                            Math.abs(box.min.z - st.elev) <= 400 &&
                            box.max.z - box.min.z >= STOREY_WALL_MM
                    ))
        );
        if (living.length === 0) {
            const lowest = tall.length > 0 ? Math.min(...tall.map((w) => w.zLo)) : 0;
            living = [{ name: 'Ground floor', elev: lowest }];
            this.change(
                'storeys',
                'One storey assumed',
                'No storey with walls standing on it was found; one storey is assumed.'
            );
        }
        const base = living[0]!.elev;
        const bandOf = (z: number): number => {
            let k = 0;
            living.forEach((st, i) => {
                if (z >= st.elev - 50) k = i;
            });
            return k;
        };

        // ---- Which walls are which.
        const role = new Map<Wall, WallRole>();
        for (const w of walls) {
            if (w.zHi <= base + 50) role.set(w, 'foundation');
        }
        const standing = walls.filter((w) => !role.has(w) && w.zHi - w.zLo >= MIN_WALL_MM);
        const onGround = standing.filter((w) => w.zLo < base + 400);
        const flagged = onGround.filter((w) => w.isExternal === true);
        let loop = flagged.length >= 3 ? findLoop(flagged) : null;
        if (!loop) loop = findLoop(onGround);
        // A basement or a plinth with other walls than the house over it: the outline is the
        // facade of the storey that holds the most of the building's rooms — the most it closes
        // round where the IFC has no rooms — which the walls under it are not.
        const loopArea = (l: typeof loop) =>
            l ? Math.abs(signedArea(l.corners.map((c) => c.at))) : 0;
        const roomPoints = spaceBoxes
            .map(({ box }) => box && { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 })
            .filter((p): p is P2 => !!p);
        const roomsIn = (l: typeof loop) => {
            const ring = l?.corners.map((c) => c.at);
            return ring ? roomPoints.filter((p) => insidePolygon(p, ring)).length : 0;
        };
        const lowestArea = loopArea(loop);
        const lowestRooms = roomsIn(loop);
        let outlineStorey = 0;
        living.forEach((st, k) => {
            if (k === 0) return;
            const on = standing.filter((w) => Math.abs(w.zLo - st.elev) <= 400);
            const facade = on.filter((w) => w.isExternal === true);
            const upper = facade.length >= 3 ? findLoop(facade) : findLoop(on);
            if (!upper) return;
            const [more, same] = [roomsIn(upper), roomsIn(loop)];
            if (more > same || (more === same && loopArea(upper) > OUTLINE_GAIN * loopArea(loop))) {
                loop = upper;
                outlineStorey = k;
            }
        });
        if (outlineStorey > 0) {
            const m2 = (a: number) => `${Math.round(a / 1e6).toLocaleString('en')} m²`;
            this.change(
                'outline/storey',
                `The outline read on ${living[outlineStorey]!.name}`,
                `The outline is read on ${living[outlineStorey]!.name}, whose facade closes round ${m2(loopArea(loop))}${roomPoints.length > 0 ? ` and ${roomsIn(loop)} of the ${roomPoints.length} rooms` : ''}; ` +
                    (lowestArea > 0
                        ? `the lowest floor's (${living[0]!.name}) closes round ${m2(lowestArea)}${roomPoints.length > 0 ? ` and ${lowestRooms}` : ''}. `
                        : `the lowest floor's (${living[0]!.name}) closes round nothing. `) +
                    'The house file runs every exterior wall from the lowest floor, so the walls under it are built as partitions.'
            );
        }
        // A party wall on the outline (one dwelling of a pair) stands on the middle of its own
        // dwelling's leaf; its corners are found again from that line.
        if (loop) {
            const ring = loop.corners.map((c) => c.at);
            const moved = loop.walls.filter((w) => isPartyWall(w) && onRoomLeaf(w, ring));
            if (moved.length > 0) loop = findLoop(loop.walls) ?? loop;
        }
        if (!loop) {
            this.change(
                'outline',
                'Every wall on the lowest floor written as an exterior wall',
                'The exterior walls do not close round the house: every wall standing on the lowest floor is written as an exterior wall, and arch will say where the outline breaks.'
            );
        }
        const loopWalls = loop?.walls ?? onGround.filter((w) => w.isExternal !== false);
        const loopLines: { a: P2; b: P2; walls: Wall[] }[] = loop
            ? loop.walls.map((w, i) => ({
                  a: loop!.corners[i]!.at,
                  b: loop!.corners[(i + 1) % loop!.corners.length]!.at,
                  walls: [w],
              }))
            : loopWalls.map((w) => ({ a: w.a, b: w.b, walls: [w] }));
        for (const w of loopWalls) role.set(w, 'exterior');
        // A wall of an upper storey on one of those lines is the same exterior wall, higher up.
        for (const w of standing) {
            if (role.has(w)) continue;
            const line = loopLines.find((l) => onSameLine(w, l.a, l.b));
            if (line) {
                role.set(w, 'exterior');
                line.walls.push(w);
            }
        }
        const exterior = walls.filter((w) => role.get(w) === 'exterior');
        // Exterior walls higher up, off the ground floor's outline, closing round a storey of
        // their own: a setback or an overhang. (A party wall says it is external too, but closes
        // round nothing.)
        const offOutline = living.slice(1).flatMap((st) => {
            const upper = standing.filter(
                (w) => !role.has(w) && w.isExternal !== false && Math.abs(w.zLo - st.elev) <= 400
            );
            return findLoop(upper)?.walls ?? [];
        });
        if (offOutline.length > 0 && loop) {
            this.change(
                'upper-walls',
                `${offOutline.length} exterior wall${offOutline.length === 1 ? '' : 's'} of an upper storey built as partitions`,
                `${offOutline.length} exterior wall${offOutline.length === 1 ? '' : 's'} of an upper storey off the ground floor's outline (a setback or an overhang): ` +
                    'the house file runs every exterior wall from the lowest floor to the eaves, so they are written as partitions.'
            );
        }
        const outline = loopLines.map((l) => l.a);

        // ---- The eave: where the exterior walls end, or the flat roof's underside if it is lower.
        const roofs = this.roofSlabs();
        const roofBox = box3(roofs.flatMap((r) => m.bodyPoints(r)));
        // Each facade's top is its highest wall; the eave is the lowest of those (a gable rises past it).
        const wallsTop =
            loopLines.length > 0
                ? Math.min(...loopLines.map((l) => Math.max(...l.walls.map((w) => w.zHi))))
                : base + 2400;
        const roofShape = this.roofShape(roofs);
        let eave = wallsTop;
        if (
            roofShape.type === 'flat' &&
            roofBox &&
            roofBox.min.z < eave - 50 &&
            roofBox.min.z > base
        ) {
            eave = roofBox.min.z;
        }
        // One eave over every storey: a facade or a roof that stops under the top storey (a
        // terrace, a canopy, a lower wing) does not take the storeys over it out of the house.
        const topFloor = living[living.length - 1]!;
        if (eave < topFloor.elev + STOREY_WALL_MM) {
            const over = roofs
                .map((r) => box3(m.bodyPoints(r))?.min.z)
                .filter((z): z is number => z !== undefined && z >= topFloor.elev + STOREY_WALL_MM);
            const raised = over.length > 0 ? Math.min(...over) : wallTop;
            this.change(
                'eave',
                `The eave put over ${topFloor.name}`,
                `The facade or a roof stops at ${Math.round(eave - base)} mm, under the top storey (${topFloor.name}, at ${Math.round(topFloor.elev - base)} mm): ` +
                    `the house file has one eave over every storey, so it is put at ${Math.round(raised - base)} mm` +
                    (over.length > 0 ? ', under the lowest roof over the top storey' : ', the top of the highest wall') +
                    ', and the roofs under it (terraces, canopies, lower wings) are left out.'
            );
            eave = raised;
        }
        let parapetMm = roofShape.type === 'flat' && wallsTop > eave + 50 ? wallsTop - eave : 0;
        for (const w of walls) {
            if (role.has(w)) continue;
            if (w.zLo >= eave - 50) {
                role.set(w, 'parapet');
                parapetMm = Math.max(parapetMm, w.zHi - eave);
            }
        }
        for (const w of walls) {
            if (!role.has(w) && w.zHi - w.zLo < MIN_WALL_MM) role.set(w, 'short');
        }
        const storeys: LivingStorey[] = living.map((st, i) => ({
            name: st.name,
            elev: st.elev,
            top: i + 1 < living.length ? living[i + 1]!.elev : eave,
        }));

        // ---- Partitions: the rest, less the linings.
        const rest = walls.filter((w) => !role.has(w));
        /** The linings against each wall: part of its build-up where they stand (`linedLayers`). */
        const liningsOf = new Map<Wall, Wall[]>();
        for (const w of rest) {
            const lined = walls.find(
                (v) => v !== w && role.get(v) !== 'foundation' && isLining(w, v)
            );
            if (lined) {
                role.set(w, 'lining');
                liningsOf.set(lined, [...(liningsOf.get(lined) ?? []), w]);
            }
        }
        const partitions = rest.filter((w) => !role.has(w));
        for (const w of partitions) {
            role.set(w, 'partition');
            // A party wall stands on a leaf, as every wall stands on its core: the one with the
            // other on its back, where a partition's layers past its core lie.
            if (isPartyWall(w)) onLeftLeaf(w);
        }
        for (const [w, r] of role) {
            if (r === 'foundation')
                this.skip(
                    w.e,
                    'a wall of the foundation: arch lays out its own foundation from the house.'
                );
            if (r === 'parapet')
                this.skip(
                    w.e,
                    "a parapet over the roof: arch's flat-roof expression builds its own, of the exterior wall, 200 mm over the roofing."
                );
            if (r === 'short')
                this.skip(
                    w.e,
                    'a wall under 1.2 m (a soffit, a bulkhead or a knee wall): not a wall of a room.'
                );
        }
        const linings = [...liningsOf.values()].flat();
        if (linings.length > 0) {
            this.change(
                'linings',
                `${linings.length} lining${linings.length === 1 ? '' : 's'} built into the walls ${linings.length === 1 ? 'it lines' : 'they line'}`,
                `${linings.length} wall${linings.length === 1 ? '' : 's'} lining another (${unique(linings.map((w) => w.layerSetName)).join(', ')}) ` +
                    `${linings.length === 1 ? 'is' : 'are'} built into the wall ${linings.length === 1 ? 'it lines' : 'they line'}: where a lining stands, that wall is of the lining's layers on that side instead of its own, a build-up type of its own.`
            );
        }

        // ---- The origin: the south-west corner of the exterior walls' lines.
        const planPts = outline.length > 0 ? outline : walls.flatMap((w) => [w.a, w.b]);
        const ox = Math.min(...planPts.map((p) => p.x));
        const oy = Math.min(...planPts.map((p) => p.y));
        const T = (p: P2): [number, number] => [Math.round((p.x - ox) * 10) / 10, Math.round((p.y - oy) * 10) / 10];
        const Z = (z: number): number => Math.round(z - base);
        const storeyName = (k: number): string | undefined =>
            storeys.length > 1 ? storeys[k]!.name : undefined;

        // ---- The exterior walls, each named by the way it faces.
        const area = signedArea(outline);
        const usedNames = new Map<string, number>();
        const wallLines = loopLines.map((l) => {
            const d = norm2(sub2(l.b, l.a));
            // Outward: to the right of a counter-clockwise outline.
            const out = area >= 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
            const facing = compass(out);
            const n = (usedNames.get(facing) ?? 0) + 1;
            usedNames.set(facing, n);
            return { ...l, id: n === 1 ? facing : `${facing}-${n}` };
        });
        // Second and later of a name are numbered; the first keeps the plain name only if alone.
        for (const wl of wallLines) {
            if ((usedNames.get(wl.id) ?? 0) > 1) wl.id = `${wl.id}-1`;
        }

        // ---- Partitions: one run per storey each stands on, its ends on the wall they meet.
        const allLines: PlanLine[] = [
            ...loopLines.map((l) => ({ a: l.a, b: l.b, band: storeys.map((_, i) => i) })),
            // A party wall stood on one leaf reaches as far as its other leaf and the linings on
            // it: a partition meeting it there ends on its line all the same.
            ...partitions.map((w) => {
                const party = isPartyWall(w);
                const reach = party ? mul2(w.dir, w.thickness) : { x: 0, y: 0 };
                return {
                    a: sub2(w.a, reach),
                    b: add2(w.b, reach),
                    band: this.bands(w, storeys),
                    w,
                    across: acrossOf(w, liningsOf.get(w) ?? []),
                    ...(party ? { reach: PARTITION_REACH_MM + w.thickness } : {}),
                };
            }),
        ];
        /** Each partition's run on each storey it stands on, written once the rooms are parted. */
        const runs: (PlanLine & { w: Wall })[] = [];
        for (const w of partitions) {
            const bands = this.bands(w, storeys);
            if (bands.length === 0) {
                this.skip(w.e, 'a partition that stands on no storey for most of its height.');
                continue;
            }
            for (const k of bands) {
                const others = allLines.filter((l) => l.band.includes(k) && l.w !== w);
                runs.push({
                    a: snapEnd(w.a, w.b, others),
                    b: snapEnd(w.b, w.a, others),
                    band: [k],
                    w,
                    ...(isPartyWall(w) ? { reach: PARTITION_REACH_MM + w.thickness } : {}),
                });
            }
        }
        // ---- Openings.
        const openings: Record<string, unknown>[] = [];
        let doorSides = 0;
        const hostLine = (w: Wall): { a: P2; b: P2 } | null => {
            if (role.get(w) === 'exterior')
                return wallLines.find((l) => l.walls.includes(w)) ?? null;
            if (role.get(w) === 'partition') return { a: w.a, b: w.b };
            if (role.get(w) === 'lining') {
                const lined = walls.find((v) => v !== w && isLining(w, v));
                return lined ? hostLine(lined) : null;
            }
            return null;
        };
        const fillers = m.all('IFCDOOR', 'IFCWINDOW');
        /** The windows in the roof, each with the points of the hole it fills. */
        const roofHoles: { e: StepEntity; pts: Vec3[] }[] = [];
        const filled = new Set<number>();
        /** The windows, kept back to be coupled where only a sliver of wall is between them. */
        const windows: CouplingWindow<Record<string, unknown>>[] = [];
        /** The windows made of curtain walls, with the panels each holds: measured once placed. */
        const glass: { entry: Record<string, unknown>; panes: CurtainGrid['panes'] }[] = [];
        /** The doors in curtain walls, by the stretch of the wall's line each takes, mm from `a`. */
        const curtainDoors: { wall: Wall; band: number; tLo: number; tHi: number }[] = [];
        for (const f of fillers) {
            const opening = m.openingFilledBy(f);
            if (opening) filled.add(opening.id);
            const host = opening
                ? m.hostOf(opening)
                : (this.nearestWall(f, walls) ?? this.curtainCrossed(f, walls));
            const wall = host ? walls.find((w) => w.e.id === host.id) : undefined;
            const kind =
                f.type === 'IFCWINDOW' ? 'window' : this.isGarageDoor(f) ? 'garage-door' : 'door';
            if (!wall) {
                const inRoof = host?.type === 'IFCROOF' || host?.type === 'IFCSLAB';
                if (inRoof && kind === 'window') {
                    roofHoles.push({ e: opening ?? f, pts: m.bodyPoints(opening ?? f) });
                    this.skip(f, ROOF_WINDOW_SKIPPED);
                    continue;
                }
                this.skip(f, 'a window or door in something that is not a wall.');
                continue;
            }
            const line = hostLine(wall);
            if (!line) {
                this.skip(f, `a window or door in a wall that is left out (${role.get(wall)}).`);
                continue;
            }
            const pts = opening ? m.bodyPoints(opening) : m.bodyPoints(f);
            const o = this.placeOpening(pts, line, bandOf, storeys);
            if (!o) {
                this.skip(f, 'a window or door whose size could not be read.');
                continue;
            }
            const entry: Record<string, unknown> = {
                kind,
                at: T(o.at),
                widthMm: o.width,
                heightMm: o.height,
                sillMm: kind === 'window' ? o.sill : Math.max(0, o.sill),
                ...(storeyName(o.band) ? { storey: storeyName(o.band) } : {}),
            };
            if (kind === 'window') {
                const glazing = this.windowGlazing(f);
                if (glazing) entry['glazing'] = glazing;
                const typeId = this.openingType(f, 'window');
                if (typeId) entry['typeId'] = typeId;
                const d = norm2(sub2(line.b, line.a));
                windows.push({
                    entry,
                    line,
                    alongMm: dot2(sub2(o.at, line.a), d),
                    widthMm: o.width,
                    sillMm: o.sill,
                    heightMm: o.height,
                    band: o.band,
                    mullions: glazing?.['mullions'] ?? 0,
                    transoms: glazing?.['transoms'] ?? 0,
                });
                continue;
            } else {
                const op = this.doorOperation(f);
                if (op && /^DOUBLE_DOOR/.test(op) && role.get(wall) === 'exterior')
                    entry['leaves'] = 'double';
                if (op && /LEFT|RIGHT/.test(op)) doorSides++;
                const typeId = this.openingType(
                    f,
                    kind === 'garage-door'
                        ? 'garage-door'
                        : entry['leaves'] === 'double'
                          ? 'terrace-door'
                          : 'door'
                );
                if (typeId) entry['typeId'] = typeId;
            }
            openings.push(entry);
            // A door in a curtain wall takes the place of the panel it stands in.
            if (wall.curtain) {
                const t = dot2(sub2(o.at, wall.a), wall.dir);
                curtainDoors.push({ wall, band: o.band, tLo: t - o.width / 2, tHi: t + o.width / 2 });
            }
        }
        // A curtain wall set in a wall: a window in it, divided as its mullions and transoms are.
        let setInRead = 0;
        for (const [cw, host] of setIn) {
            const line = hostLine(host);
            if (!line) {
                this.skip(cw.e, `a curtain wall set in a wall that is left out (${role.get(host)}).`);
                continue;
            }
            const pts = [
                { x: cw.a.x, y: cw.a.y, z: cw.zLo },
                { x: cw.b.x, y: cw.b.y, z: cw.zHi },
            ];
            const o = this.placeOpening(pts, line, bandOf, storeys);
            if (!o) {
                this.skip(cw.e, 'a curtain wall whose size could not be read.');
                continue;
            }
            const len = dist2(cw.a, cw.b);
            const mullions = gridLines(cw.curtain!.mullions.map((g) => g.t), 0, len).length;
            const transoms = gridLines(cw.curtain!.transoms.map((g) => g.z), cw.zLo, cw.zHi).length;
            const entry: Record<string, unknown> = {
                kind: 'window',
                at: T(o.at),
                widthMm: o.width,
                heightMm: o.height,
                sillMm: o.sill,
                ...(storeyName(o.band) ? { storey: storeyName(o.band) } : {}),
            };
            const d = norm2(sub2(line.b, line.a));
            windows.push({
                entry,
                line,
                alongMm: dot2(sub2(o.at, line.a), d),
                widthMm: o.width,
                sillMm: o.sill,
                heightMm: o.height,
                band: o.band,
                mullions,
                transoms,
            });
            glass.push({ entry, panes: cw.curtain!.panes });
            setInRead++;
        }
        if (setInRead > 0) {
            this.change(
                'curtain-walls/set-in',
                `${setInRead} curtain wall${setInRead === 1 ? '' : 's'} set in walls read as windows`,
                `${setInRead} curtain wall${setInRead === 1 ? '' : 's'} set in a wall (a glazed panel drawn as a curtain wall) ` +
                    `${setInRead === 1 ? 'is' : 'are'} read as a window in that wall, divided by ${setInRead === 1 ? 'its' : 'their'} mullions and transoms.`
            );
        }
        // Windows with only a sliver of wall between them are one coupled window.
        const coupled = coupleWindows(windows);
        if (coupled.length < windows.length) {
            this.change(
                'windows/coupled',
                `${windows.length - coupled.length + coupled.filter((w) => w.coupled).length} windows coupled into ${coupled.filter((w) => w.coupled).length}`,
                `${windows.length - coupled.length + coupled.filter((w) => w.coupled).length} windows with less than ${COUPLE_GAP_MM} mm of wall between them ` +
                    `are coupled into ${coupled.filter((w) => w.coupled).length}: one window each, their frames joined by mullions or transoms.`
            );
        }
        const close = tooClose(coupled);
        if (close.length > 0) {
            this.change(
                'windows/close',
                `${close.length} pair${close.length === 1 ? '' : 's'} of windows too close for a pier`,
                `${close.length} pair${close.length === 1 ? '' : 's'} of windows with only ${unique(close.map((g) => `${g} mm`)).join(', ')} of wall between them are kept apart: ` +
                    'arch divides a window into equal panes, and theirs are not. Make them one window, or move them apart, in Draw.'
            );
        }
        for (const w of coupled) {
            const d = norm2(sub2(w.line.b, w.line.a));
            const glazing = {
                ...(w.mullions > 0 ? { mullions: w.mullions } : {}),
                ...(w.transoms > 0 ? { transoms: w.transoms } : {}),
            };
            const { glazing: _own, ...rest } = w.entry;
            const placed = {
                ...rest,
                at: T(add2(w.line.a, mul2(d, w.alongMm))),
                widthMm: Math.round(w.widthMm),
                heightMm: Math.round(w.heightMm),
                sillMm: Math.round(w.sillMm),
                ...(Object.keys(glazing).length > 0 ? { glazing } : {}),
            };
            openings.push(placed);
            // A curtain wall's window keeps its glass, under the entry it is written as.
            for (const g of glass) if (g.entry === w.entry) g.entry = placed;
        }
        // A wall of glass: on each storey, a window in each bay between its mullions, a stud's pier
        // where each mullion stands, under a header below the storey above. A door in it takes
        // its bay.
        let glazed = 0;
        let bays = 0;
        for (const cw of walls) {
            if (!cw.curtain) continue;
            const line = hostLine(cw);
            if (!line) continue;
            const d = norm2(sub2(line.b, line.a));
            const len = dist2(cw.a, cw.b);
            const along = (t: number) => dot2(sub2(add2(cw.a, mul2(cw.dir, t)), line.a), d);
            const before = bays;
            storeys.forEach((st, k) => {
                const z0 = Math.max(cw.zLo, st.elev);
                const z1 = Math.min(cw.zHi, st.top - BAY_HEAD_MM);
                if (z1 - z0 < MIN_WALL_MM) return;
                const posts = gridLines(
                    cw.curtain!.mullions
                        .filter((g) => Math.min(g.zHi, z1) - Math.max(g.zLo, z0) > (z1 - z0) / 2)
                        .map((g) => g.t),
                    0,
                    len
                );
                const cuts = [0, ...posts, len];
                for (let i = 0; i + 1 < cuts.length; i++) {
                    const lo = cuts[i]! + (i === 0 ? MIN_PIER_MM : MIN_PIER_MM / 2);
                    const hi = cuts[i + 1]! - (i + 2 === cuts.length ? MIN_PIER_MM : MIN_PIER_MM / 2);
                    if (hi - lo < MIN_BAY_MM) continue;
                    const door = curtainDoors.some(
                        (o) => o.wall === cw && o.band === k && o.tLo < hi && o.tHi > lo
                    );
                    if (door) continue;
                    const mid = (lo + hi) / 2;
                    const transoms = Math.min(
                        MAX_BAY_TRANSOMS,
                        gridLines(
                            cw.curtain!.transoms
                                .filter((g) => g.tLo <= mid && g.tHi >= mid)
                                .map((g) => g.z),
                            z0,
                            z1
                        ).length
                    );
                    const entry: Record<string, unknown> = {
                        kind: 'window',
                        at: T(add2(line.a, mul2(d, along(mid)))),
                        widthMm: Math.round(hi - lo),
                        heightMm: Math.round(z1 - z0),
                        sillMm: Math.round(z0 - st.elev),
                        ...(storeyName(k) ? { storey: storeyName(k) } : {}),
                        ...(transoms > 0 ? { glazing: { transoms } } : {}),
                    };
                    openings.push(entry);
                    // The panels in the bay, on this storey: the glass that faces its rooms.
                    const panes = cw.curtain!.panes.filter((g) => {
                        const t = (g.tLo + g.tHi) / 2;
                        const z = (g.zLo + g.zHi) / 2;
                        return t >= cuts[i]! && t <= cuts[i + 1]! && z >= st.elev && z < st.top;
                    });
                    glass.push({ entry, panes });
                    bays++;
                }
            });
            if (bays > before) glazed += cw.curtain!.panels;
        }
        if (glazed > 0) {
            this.change(
                'curtain-walls/glazed',
                `${glazed} curtain wall${glazed === 1 ? '' : 's'} built as glazed walls`,
                `${glazed} curtain wall${glazed === 1 ? '' : 's'} standing on ${glazed === 1 ? 'its' : 'their'} own ${glazed === 1 ? 'is' : 'are'} built as ` +
                    `${glazed === 1 ? 'a wall' : 'walls'} of the house's frame glazed bay by bay: ${bays} windows, one in each bay between the mullions on each storey, ` +
                    `with a ${MIN_PIER_MM} mm pier of studs at each mullion and a header under the storey above.`
            );
        }
        const roofOpenings = this.roofOpenings(roofHoles, roofShape, T);
        // An opening nothing fills: a passage, or a hole for something left out.
        for (const op of m.all('IFCOPENINGELEMENT')) {
            if (filled.has(op.id)) continue;
            const host = m.hostOf(op);
            const wall = host ? walls.find((w) => w.e.id === host.id) : undefined;
            if (!wall) continue;
            const line = hostLine(wall);
            const o = line ? this.placeOpening(m.bodyPoints(op), line, bandOf, storeys) : null;
            if (!o) continue;
            const door = o.sill <= 50;
            openings.push({
                kind: door ? 'door' : 'window',
                at: T(o.at),
                widthMm: o.width,
                heightMm: o.height,
                sillMm: door ? 0 : o.sill,
                ...(storeyName(o.band) ? { storey: storeyName(o.band) } : {}),
            });
            this.change(
                `opening/${op.id}`,
                `An empty opening built as a ${door ? 'door' : 'window'}`,
                `An opening with nothing in it (#${op.id} in "${wall.name}") is written as a ${door ? 'door' : 'window'}.`
            );
        }
        if (doorSides > 0) {
            this.change(
                'doors/hinges',
                `${doorSides} door${doorSides === 1 ? '' : 's'} hung by the house's rule`,
                `The hinge side of ${doorSides} door${doorSides === 1 ? '' : 's'} is not carried over: arch hangs each door from its own rule.`
            );
        }

        // ---- The roof.
        const roof: Record<string, unknown> = {
            type: roofShape.type,
            pitchDeg: roofShape.pitchDeg,
        };
        if (roofShape.ridge) roof['ridge'] = roofShape.ridge;
        if (roofShape.highSide) roof['highSide'] = roofShape.highSide;
        const overhang = this.overhang(roofBox, outline, roofShape);

        // ---- Build-ups.
        const envelope: Record<string, unknown> = {};
        const buildups: IfcImportReport['buildups'] = {};
        const buildUpTypes: IfcImportReport['buildUpTypes'] = [];
        /** The type each kind's other layer sets are, by `<build-up>|<layer set>`. */
        const typeOf = new Map<string, string>();
        /**
         * The walls of build-up `key` other than `pick`'s layer set: each other layer set a type
         * of it (`interiorWall:plumbing`, `exteriorWall:timber-gable`) its walls are dressed in,
         * heavy or light as the IFC has it, so every wall keeps its own build-up.
         */
        const typesOf = (
            key: string,
            of: readonly Wall[],
            pick: Wall,
            layersOf: (w: Wall) => Record<string, unknown>[]
        ): void => {
            for (const name of unique(of.map((w) => w.layerSetName))) {
                if (!name || name === pick.layerSetName) continue;
                const w = longestBy(
                    of.filter((x) => x.layerSetName === name && x.layers.length > 0),
                    (x) => x.layerSetName
                );
                if (!w) continue;
                // Named as the layer set, short of a family Revit puts before it ("Basic Wall:").
                const own = name.slice(name.lastIndexOf(':') + 1).trim() || name;
                const id = `${key}:${typeKeyFor(envelope, key, own)}`;
                envelope[id] = { name: own, layers: layersOf(w) };
                typeOf.set(`${key}|${name}`, id);
                buildUpTypes.push({ id, layerSet: name });
            }
        };
        // The house is heavy where its exterior walls are — the layer set most of their length
        // has, party walls left out — and its own partitions are of that kind.
        const facades = exterior.filter((w) => !isPartyWall(w));
        const extWall = longestBy(
            facades.filter((w) => w.layers.length > 0),
            (w) => w.layerSetName
        );
        const heavy = extWall ? extWall.heavy : facades.some((w) => w.heavy);
        let facade: string | null = null;
        let insulated = false;
        if (extWall) {
            const exteriorLayers = (w: Wall) => {
                const inside = this.insideOut(w, outline);
                return this.fileLayers(inside, inside.indexOf(w.layers[w.core]!), 'wall');
            };
            envelope['exteriorWall'] = { layers: exteriorLayers(extWall) };
            buildups.exteriorWall = extWall.layerSetName;
            typesOf(
                'exteriorWall',
                facades.filter((w) => w.layers.length > 0),
                extWall,
                exteriorLayers
            );
            const inside = this.insideOut(extWall, outline);
            facade = facadeOf(inside);
            insulated = inside.some(
                (l) => matchMaterial(l.material).role === 'insulation' && l.thickness >= 30
            );
        }
        // One build-up per kind of wall: the house's own partition (`interiorWall`, of the
        // house's kind), the other kind's (`lightPartition` in a heavy house, `heavyPartition` in
        // a light one) and the party wall's — each from the layer set most of its walls' length
        // has, every other layer set of the kind a type of it, so each wall keeps its own.
        const ownKind: 'light' | 'heavy' = heavy ? 'heavy' : 'light';
        const kindOf = (w: Wall): PartitionKind =>
            isPartyWall(w) ? 'party' : w.heavy ? 'heavy' : 'light';
        const kindBuildUp = (kind: PartitionKind): PartitionBuildUp =>
            kind === 'party'
                ? 'partyWall'
                : kind === ownKind
                  ? 'interiorWall'
                  : kind === 'heavy'
                    ? 'heavyPartition'
                    : 'lightPartition';
        const exteriorParty = exterior.filter((w) => isPartyWall(w));
        for (const kind of PARTITION_KINDS) {
            const key = kindBuildUp(kind);
            const of = [
                ...partitions.filter((w) => kindOf(w) === kind),
                ...(kind === 'party' ? exteriorParty : []),
            ];
            const pick = longestBy(
                of.filter((w) => w.layers.length > 0),
                (w) => w.layerSetName
            );
            if (!pick) continue;
            // A partition's from its positive side to its back; a party wall on the outline's
            // from its own dwelling's side out.
            const layersOf = (w: Wall) => {
                const own = exteriorParty.includes(w) ? partyLayers(w) : linedLayers(w, []);
                return this.fileLayers(own.layers, own.core, 'wall');
            };
            envelope[key] = { layers: layersOf(pick) };
            buildups[key] = pick.layerSetName;
            typesOf(key, of, pick, layersOf);
        }
        const roofUsage = this.roofLayers(roofs);
        let covering: string | null = null;
        const structure: IfcImportReport['structure'] = { floors: 'timber', roof: 'timber' };
        if (roofUsage) {
            const inside = orientRoof(roofUsage.layers);
            const core = pickCore(inside);
            envelope['roof'] = { layers: this.fileLayers(inside, core, 'roof') };
            buildups.roof = roofUsage.name;
            structure.roof = slabStructure(inside[core]);
            covering = coveringOf(inside);
            insulated ||= inside.some(
                (l) => matchMaterial(l.material).role === 'insulation' && l.thickness >= 30
            );
        }
        const { ground: floor, deck } = this.floors(outline, base, storeys);
        if (floor) {
            envelope['floor'] = {
                layers: this.fileLayers(floor.layers, pickCore(floor.layers), 'floor'),
            };
            buildups.floor = floor.name;
        }
        if (deck) {
            const core = pickCore(deck.layers);
            envelope['deck'] = { layers: this.fileLayers(deck.layers, core, 'floor') };
            buildups.deck = deck.name;
            structure.floors = slabStructure(deck.layers[core]);
        }

        // ---- What the house is, and how it meets the weather.
        const expressionId = roofShape.type === 'flat' ? 'flat-roof' : 'overhang-barge';
        const def = expressionDef(expressionId)!;
        let roofCovering = covering ?? def.roofs[0]!;
        if (!def.roofs.includes(roofCovering)) {
            this.change(
                'roof/covering',
                `Roof covered with ${def.roofs[0]}, not ${roofCovering}`,
                `The roof's covering (${roofCovering}) is not one a ${def.label.toLowerCase()} takes; written as ${def.roofs[0]}.`
            );
            roofCovering = def.roofs[0]!;
        }
        const expression: Record<string, unknown> = { id: expressionId, roof: roofCovering };
        if (facade) expression['facade'] = facade;
        const jointStandards: Record<string, string> = {};
        if (def.eave !== 'miter' && (expressionId !== 'flat-roof' || parapetMm > 0))
            jointStandards['eave'] = def.eave;
        if (def.verge !== 'miter') jointStandards['verge'] = def.verge;
        if (expressionId === 'flat-roof' && parapetMm === 0) {
            this.warnings.push(
                'The flat roof has no parapet in the IFC: its eaves are left mitred.'
            );
        }
        const openingStandards: Record<string, string> = {};
        for (const kind of DETAILED_OPENING_KINDS) {
            if (
                openingTakesDetail(kind, def.openings) &&
                def.openings !== 'plain'
            ) {
                openingStandards[kind] = def.openings;
            }
        }

        // ---- Rooms, fittings, posts and beams.
        const zones = this.zones(spaces, storeys, bandOf, T, storeyName);
        const parts = this.separations(spaces, storeys, bandOf, allLines);
        // Every end left in the middle of a room taken to the line it stops short of, or that
        // line on to it: the rooms close, found from the lines alone.
        closeEnds(
            [...runs, ...parts],
            allLines.filter((l) => !l.w)
        );
        parts.push(...bridgeEnds([...runs, ...parts], allLines.filter((l) => !l.w)));
        /**
         * The build-up type a stretch of `w` with `linings` against it is: its own layers, those
         * past each lining's inner face replaced by the lining's — what that stretch is built of.
         */
        const linedTypes = new Map<string, string>();
        const linedType = (key: string, w: Wall, linings: readonly Wall[]): string => {
            const { layers, core } = linedLayers(w, linings);
            const fileLayers = this.fileLayers(layers, core, 'wall');
            // One type per build-up: stretches lined alike are dressed in the same one.
            const sig = `${key}|${JSON.stringify(fileLayers)}`;
            const known = linedTypes.get(sig);
            if (known) return known;
            const short = (n: string) => n.slice(n.lastIndexOf(':') + 1).trim() || n;
            const sides = unique(linings.map((l) => (liningSide(w, l) > 0 ? 'front' : 'back')));
            const where = sides.length > 1 ? 'on both sides' : `on its ${sides[0]}`;
            const own = `${short(w.layerSetName)}, lined ${where} with ${unique(linings.map((l) => short(l.layerSetName))).join(' and ')}`;
            const id = `${key}:${typeKeyFor(envelope, key, own)}`;
            envelope[id] = { name: own, layers: fileLayers };
            linedTypes.set(sig, id);
            buildUpTypes.push({ id, layerSet: `${w.layerSetName} + ${unique(linings.map((l) => l.layerSetName)).join(' + ')}` });
            return id;
        };
        const interiorWalls: {
            storey?: string;
            points: [number, number][];
            loadBearing?: boolean;
            partition?: PartitionKind;
            buildUpType?: string;
        }[] = runs.flatMap((run) =>
            linedPieces(run, (liningsOf.get(run.w) ?? []).filter((l) => this.bands(l, storeys).includes(run.band[0]!))).map(
                ({ a, b, linings }) => {
                    const { w, band } = run;
                    const kind = kindOf(w);
                    const key = kindBuildUp(kind);
                    const type =
                        linings.length > 0
                            ? linedType(key, w, linings)
                            : typeOf.get(`${key}|${w.layerSetName}`);
                    return {
                        ...(storeyName(band[0]!) ? { storey: storeyName(band[0]!) } : {}),
                        points: [T(a), T(b)] as [number, number][],
                        ...(w.loadBearing !== null ? { loadBearing: w.loadBearing } : {}),
                        ...(kind !== ownKind ? { partition: kind } : {}),
                        ...(type ? { buildUpType: type } : {}),
                    };
                }
            )
        );
        const zoneSeparations = parts.map(({ a, b, band }) => ({
            ...(storeyName(band[0]!) ? { storey: storeyName(band[0]!) } : {}),
            points: [T(a), T(b)],
        }));
        const fixtures = this.fixtures(walls, role, storeys, bandOf, T, storeyName);
        const linesOut = this.lines(base, ox, oy);
        this.skipTheRest();

        const trueNorth = this.trueNorthDeg();
        if (trueNorth !== null && Math.abs(trueNorth) > 0.5) {
            this.change(
                'north',
                'Project north taken as north',
                `The IFC's true north is ${trueNorth.toFixed(1)}° from its project north; arch takes project north as north.`
            );
        }

        const report: IfcImportReport = {
            schema: m.schema,
            construction: heavy ? 'heavy' : 'light',
            storeys: storeys.map((st) => ({
                name: st.name,
                elevationMm: Z(st.elev),
                heightMm: Math.round(st.top - st.elev),
            })),
            originMm: { x: Math.round(ox * 1000) / 1000, y: Math.round(oy * 1000) / 1000, z: Math.round(base * 1000) / 1000 },
            exteriorWalls: wallLines.length,
            partitions: interiorWalls.length,
            openings: openings.length,
            zones: zones.length,
            fixtures: fixtures.length,
            lines: linesOut.length,
            buildups,
            buildUpTypes,
            openingTypes: [...this.openingTypes.values()].map((t) => ({ id: t.id, ifcType: t.label ?? t.id })),
            roofOpenings,
            structure,
            guessedMaterials: [...this.guessed].map(([name, as]) => `"${name}" as ${as}`),
            skipped: [...this.skipped.values()],
            trueNorthDeg: trueNorth,
            warnings: this.warnings,
            changes: this.changes,
            curtainGlass: glass
                .filter((g) => g.panes.length > 0)
                .map(({ entry, panes }) => ({
                    at: entry['at'] as [number, number],
                    ...(typeof entry['storey'] === 'string' ? { storey: entry['storey'] } : {}),
                    glassAreaM2:
                        Math.round(panes.reduce((sum, g) => sum + (g.tHi - g.tLo) * (g.zHi - g.zLo), 0) / 1e4) / 100,
                    panes: panes.length,
                })),
        };

        const file: Record<string, unknown> = {
            format: 'arch/1',
            name: this.options.name ?? this.projectName(),
            notes: ifcImportSummary(report).join('\n'),
            ...(storeys.length > 1
                ? {
                      storeys: report.storeys.map((s) => ({
                          name: s.name,
                          elevationMm: s.elevationMm,
                          heightMm: s.heightMm,
                      })),
                  }
                : {}),
            wallHeightMm: Z(eave),
            walls: wallLines.map((l) => {
                const party = l.walls.some((w) => isPartyWall(w));
                // The layer set most of the line has, where it is a type of its kind.
                const most = longestBy(
                    l.walls.filter((w) => w.layers.length > 0 && isPartyWall(w) === party),
                    (w) => w.layerSetName
                );
                const key = party ? 'partyWall' : 'exteriorWall';
                const type = most ? typeOf.get(`${key}|${most.layerSetName}`) : undefined;
                return {
                    id: l.id,
                    points: [T(l.a), T(l.b)],
                    ...(party ? { partition: 'party' } : {}),
                    ...(type ? { buildUpType: type } : {}),
                };
            }),
            ...(openings.length > 0 ? { openings } : {}),
            ...(this.openingTypes.size > 0
                ? { fenestrationTypes: [...this.openingTypes.values()] }
                : {}),
            roof,
            roofOverhang: overhang,
            ...(interiorWalls.length > 0 ? { interiorWalls } : {}),
            ...(zones.length > 0 ? { zones } : {}),
            ...(zoneSeparations.length > 0 ? { zoneSeparations } : {}),
            ...(fixtures.length > 0 ? { fixtures } : {}),
            ...(linesOut.length > 0 ? { lines: linesOut } : {}),
            buildingUse: insulated ? 'dwelling' : 'shed-unheated',
            constructionSystem: heavy ? 'masonry' : 'timber-frame',
            // A heavy house's own choice of concrete, which its build-ups already are.
            ...(heavy && structure.floors !== 'timber' ? { floorStructure: structure.floors } : {}),
            ...(heavy && structure.roof !== 'timber' ? { roofStructure: structure.roof } : {}),
            expression,
            roofLoad:
                roofCovering === 'green' ? 'green' : roofCovering === 'tiles' ? 'heavy' : 'light',
            ...(Object.keys(envelope).length > 0 ? { envelope } : {}),
            ...(Object.keys(jointStandards).length > 0
                ? { envelopeJointStandards: jointStandards }
                : {}),
            ...(Object.keys(openingStandards).length > 0
                ? { openingDetails: openingStandards }
                : {}),
        };
        return { house: toTwbHouse(file as unknown as HouseFile), report };
    }

    // ---- Windows in the roof --------------------------------------------------------------------

    /**
     * The holes the windows in the roof fill (`IfcImportReport.roofOpenings`): each by its middle
     * in plan and its size measured on the roof — along the eave, and up the slope. A hole cut
     * square to a sloping roof is measured in its own plane, its largest face's, so the cut
     * through the roof's thickness does not count; one cut plumb, or in a flat roof, off its box
     * in plan, up the slope at the roof's pitch.
     */
    private roofOpenings(
        holes: readonly { e: StepEntity; pts: Vec3[] }[],
        shape: { type: string; pitchDeg: number; ridge?: string | null; highSide?: string | null },
        T: (p: P2) => [number, number]
    ): RoofOpening[] {
        const flat = shape.type === 'flat';
        // The eave runs along x under a ridge along x, or a shed roof high on the north or south.
        const eaveAlongX =
            flat || shape.ridge === 'x' || shape.highSide === 'north' || shape.highSide === 'south';
        const slope = flat ? 1 : 1 / Math.cos((shape.pitchDeg * Math.PI) / 180);
        return holes.flatMap(({ e, pts }) => {
            const box = box3(pts);
            if (!box) return [];
            const face = this.m.bodyFaces(e).sort((x, y) => y.area - x.area)[0];
            const n = face && (face.normal.z < 0 ? scale(face.normal, -1) : face.normal);
            if (n && n.z > 0.05 && n.z < 0.996) {
                // Down the slope in plan, along the eave, and up the roof's plane.
                const down = norm2({ x: n.x, y: n.y });
                const eave = { x: -down.y, y: down.x };
                const [sin, cos] = [Math.hypot(n.x, n.y), n.z];
                const along = pts.map((p) => dot2(p, eave));
                const up = pts.map((p) => p.z * sin - dot2(p, down) * cos);
                const off = pts.map((p) => p.z * cos + dot2(p, down) * sin);
                const mid = (xs: number[]) => (Math.min(...xs) + Math.max(...xs)) / 2;
                const [a, s, t] = [mid(along), mid(up), mid(off)];
                return [
                    {
                        at: T(add2(mul2(eave, a), mul2(down, t * sin - s * cos))),
                        widthMm: Math.round(Math.max(...along) - Math.min(...along)),
                        heightMm: Math.round(Math.max(...up) - Math.min(...up)),
                    },
                ];
            }
            const dx = box.max.x - box.min.x;
            const dy = box.max.y - box.min.y;
            return [
                {
                    at: T({ x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 }),
                    widthMm: Math.round(eaveAlongX ? dx : dy),
                    heightMm: Math.round((eaveAlongX ? dy : dx) * slope),
                },
            ];
        });
    }

    // ---- Reading one wall -----------------------------------------------------------------------

    private readWall(e: StepEntity): Wall | null {
        const m = this.m;
        const pts = m.bodyPoints(e);
        if (pts.length === 0) {
            this.skip(e, 'a wall with no body to read.');
            return null;
        }
        const frame = m.placementOf(e);
        let normal = norm2({ x: frame.y.x, y: frame.y.y });
        const axis = m.axisOf(e);
        let axisA: P2;
        let axisB: P2;
        if (axis) {
            axisA = { x: axis[0].x, y: axis[0].y };
            axisB = { x: axis[1].x, y: axis[1].y };
        } else {
            // No axis: the body's footprint along the placement's x, on its middle.
            const along = norm2({ x: frame.x.x, y: frame.x.y });
            const across = { x: -along.y, y: along.x };
            const o = { x: frame.o.x, y: frame.o.y };
            const t = pts.map((p) => dot2(sub2(p, o), along));
            const s = pts.map((p) => dot2(sub2(p, o), across));
            const mid = (Math.min(...s) + Math.max(...s)) / 2;
            axisA = add2(o, add2(mul2(along, Math.min(...t)), mul2(across, mid)));
            axisB = add2(o, add2(mul2(along, Math.max(...t)), mul2(across, mid)));
            normal = across;
        }
        const len = dist2(axisA, axisB);
        if (len < 100) {
            this.skip(e, 'a wall shorter than 100 mm.');
            return null;
        }
        const dir = norm2(sub2(axisB, axisA));
        // The layers run across the axis: the placement's y, made square to it.
        normal = norm2(sub2(normal, mul2(dir, dot2(normal, dir))));
        if (!Number.isFinite(normal.x) || Math.hypot(normal.x, normal.y) < 0.5)
            normal = { x: -dir.y, y: dir.x };

        const usage = m.layerUsage(e);
        const across = pts.map((p) => dot2(sub2(p, axisA), normal));
        const bodyLo = Math.min(...across);
        const bodyHi = Math.max(...across);
        let layers: IfcLayer[];
        let offset: number;
        let sense: 1 | -1;
        if (usage && usage.layers.length > 0) {
            layers = usage.layers;
            offset = usage.offset;
            sense = usage.sense;
        } else {
            const names = m.materialNames(e);
            layers = [
                {
                    material: names[0] ?? m.name(e),
                    thickness: bodyHi - bodyLo,
                    ventilated: false,
                    category: null,
                },
            ];
            offset = bodyHi;
            sense = -1;
        }
        const thickness = layers.reduce((s, l) => s + l.thickness, 0);
        const core = pickCore(layers);
        const heavy = core >= 0 && matchMaterial(layers[core]!.material).role === 'heavy';
        const before = layers.slice(0, Math.max(core, 0)).reduce((s, l) => s + l.thickness, 0);
        const lineY =
            core >= 0
                ? offset + sense * (before + layers[core]!.thickness / 2)
                : offset + (sense * thickness) / 2;
        const z = pts.map((p) => p.z);
        const lb = m.property(e, 'LoadBearing');
        const ext = m.property(e, 'IsExternal');
        return {
            e,
            name: m.name(e),
            axisA,
            axisB,
            dir,
            normal,
            zLo: Math.min(...z),
            zHi: Math.max(...z),
            layers,
            offset,
            sense,
            thickness,
            core,
            heavy,
            lineY,
            a: add2(axisA, mul2(normal, lineY)),
            b: add2(axisB, mul2(normal, lineY)),
            layerSetName: usage?.name ?? m.name(e),
            loadBearing: typeof lb === 'boolean' ? lb : isEnum(lb) ? lb.enum === 'T' : null,
            isExternal: typeof ext === 'boolean' ? ext : isEnum(ext) ? ext.enum === 'T' : null,
        };
    }

    /**
     * A curtain wall as a wall of glass: its line through the middle of its plates and members,
     * along the way they run in plan, and its grid. It has no body of its own, only its parts,
     * and no layers: the build-ups are read from the walls that have them.
     */
    private readCurtainWall(e: StepEntity): Wall | null {
        const m = this.m;
        const parts = m.partsOf(e);
        const pts = [...m.bodyPoints(e), ...parts.flatMap((p) => m.bodyPoints(p))];
        if (pts.length === 0) {
            this.skip(e, 'a curtain wall with no panels or mullions to read.');
            return null;
        }
        // The way it runs: the plan's principal axis.
        const c = {
            x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
            y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
        };
        let sxx = 0;
        let syy = 0;
        let sxy = 0;
        for (const p of pts) {
            sxx += (p.x - c.x) ** 2;
            syy += (p.y - c.y) ** 2;
            sxy += (p.x - c.x) * (p.y - c.y);
        }
        const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        const normal = { x: -dir.y, y: dir.x };
        const t = pts.map((p) => dot2(sub2(p, c), dir));
        const across = pts.map((p) => dot2(sub2(p, c), normal));
        const len = Math.max(...t) - Math.min(...t);
        if (len < 100) {
            this.skip(e, 'a curtain wall shorter than 100 mm.');
            return null;
        }
        const mid = (Math.min(...across) + Math.max(...across)) / 2;
        const axisA = add2(c, add2(mul2(dir, Math.min(...t)), mul2(normal, mid)));
        const axisB = add2(c, add2(mul2(dir, Math.max(...t)), mul2(normal, mid)));
        const grid: CurtainGrid = { mullions: [], transoms: [], panes: [], panels: 1 };
        for (const part of parts) {
            if (part.type !== 'IFCMEMBER' && part.type !== 'IFCPLATE') continue;
            const ps = m.bodyPoints(part);
            if (ps.length === 0) continue;
            const pt = ps.map((p) => dot2(sub2(p, axisA), dir));
            const pz = ps.map((p) => p.z);
            const [tLo, tHi] = [Math.min(...pt), Math.max(...pt)];
            const [zLo, zHi] = [Math.min(...pz), Math.max(...pz)];
            if (part.type === 'IFCPLATE') grid.panes.push({ tLo, tHi, zLo, zHi });
            else if (zHi - zLo > tHi - tLo) grid.mullions.push({ t: (tLo + tHi) / 2, zLo, zHi });
            else grid.transoms.push({ z: (zLo + zHi) / 2, tLo, tHi });
        }
        const z = pts.map((p) => p.z);
        const ext = m.property(e, 'IsExternal');
        return {
            e,
            name: m.name(e),
            axisA,
            axisB,
            dir,
            normal,
            zLo: Math.min(...z),
            zHi: Math.max(...z),
            layers: [],
            offset: 0,
            sense: 1,
            thickness: Math.max(1, Math.max(...across) - Math.min(...across)),
            core: -1,
            heavy: false,
            lineY: 0,
            a: axisA,
            b: axisB,
            layerSetName: '',
            loadBearing: false,
            isExternal: typeof ext === 'boolean' ? ext : isEnum(ext) ? ext.enum === 'T' : null,
            curtain: grid,
        };
    }

    /** The storeys a partition stands on for most of the height of each. */
    private bands(w: Wall, storeys: readonly LivingStorey[]): number[] {
        const out: number[] = [];
        storeys.forEach((st, i) => {
            const overlap = Math.min(w.zHi, st.top) - Math.max(w.zLo, st.elev);
            const need = Math.min(1500, 0.6 * (st.top - st.elev));
            if (overlap >= need) out.push(i);
        });
        return out;
    }

    private storeyElevation(e: StepEntity): number {
        const z = this.m.placementOf(e).o.z;
        const attr = this.m.num(e, 9);
        if (Math.abs(z) < 1 && attr !== null && Math.abs(attr) > 0) return attr * this.m.mmPerUnit;
        return z;
    }

    private nearestWall(f: StepEntity, walls: readonly Wall[]): StepEntity | null {
        const b = box3(this.m.bodyPoints(f));
        if (!b) return null;
        const c = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
        let best: Wall | null = null;
        let bestD = Infinity;
        for (const w of walls) {
            if (w.zLo > b.max.z || w.zHi < b.min.z) continue;
            const d = distToSegment(c, w.axisA, w.axisB);
            if (d < bestD && d <= w.thickness) {
                best = w;
                bestD = d;
            }
        }
        return best?.e ?? null;
    }

    /**
     * The curtain wall a door with no hole of its own stands in: one whose line runs through the
     * door's plan, at its height. A door's body takes in its leaf's swing, so its middle stands
     * off the glass by half of it, too far for `nearestWall`.
     */
    private curtainCrossed(f: StepEntity, walls: readonly Wall[]): StepEntity | null {
        const b = box3(this.m.bodyPoints(f));
        if (!b) return null;
        const c = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
        let best: Wall | null = null;
        let bestD = Infinity;
        for (const w of walls) {
            if (!w.curtain || w.zLo > b.max.z || w.zHi < b.min.z) continue;
            // The line through the door's box, square to it, within the curtain wall's length.
            const len = dist2(w.a, w.b);
            const t = dot2(sub2(c, w.a), w.dir);
            if (t < -SET_IN_MM || t > len + SET_IN_MM) continue;
            const corners = [
                { x: b.min.x, y: b.min.y },
                { x: b.max.x, y: b.min.y },
                { x: b.min.x, y: b.max.y },
                { x: b.max.x, y: b.max.y },
            ].map((p) => dot2(sub2(p, w.a), w.normal));
            if (Math.min(...corners) > SET_IN_MM || Math.max(...corners) < -SET_IN_MM) continue;
            const d = Math.abs(dot2(sub2(c, w.a), w.normal));
            if (d < bestD) {
                best = w;
                bestD = d;
            }
        }
        return best?.e ?? null;
    }

    // ---- Openings ----------------------------------------------------------------------------------

    private placeOpening(
        pts: readonly Vec3[],
        line: { a: P2; b: P2 },
        bandOf: (z: number) => number,
        storeys: readonly LivingStorey[]
    ): { at: P2; width: number; height: number; sill: number; band: number } | null {
        if (pts.length === 0) return null;
        const d = norm2(sub2(line.b, line.a));
        const t = pts.map((p) => dot2(sub2(p, line.a), d));
        const z = pts.map((p) => p.z);
        const t0 = Math.min(...t);
        const t1 = Math.max(...t);
        const z0 = Math.min(...z);
        const z1 = Math.max(...z);
        if (t1 - t0 < 100 || z1 - z0 < 100) return null;
        const band = bandOf(z0 + 10);
        return {
            at: add2(line.a, mul2(d, (t0 + t1) / 2)),
            width: Math.round(t1 - t0),
            height: Math.round(z1 - z0),
            sill: Math.round(z0 - storeys[band]!.elev),
            band,
        };
    }

    private typeName(e: StepEntity): string {
        const t = this.m.typeObject(e);
        return [this.m.name(e), this.m.str(e, 4) ?? '', t ? this.m.name(t) : ''].join(' ');
    }

    private isGarageDoor(f: StepEntity): boolean {
        const op = this.doorOperation(f) ?? '';
        return (
            /garage|\bport\b|overhead|sectional|roll(ing)?[- ]?up|ledhejse|vippeport|carport/i.test(
                this.typeName(f)
            ) || op === 'ROLLINGUP'
        );
    }

    /** The window and door types read, by the IFC type (or style) each is read from. */
    private readonly openingTypes = new Map<string, FileOpeningType>();

    /**
     * The window or door type `f` is an instance of: one per IFC type or style (`IfcWindowType`,
     * `IfcDoorStyle`, …) by name in `slot`, `<slot>-2` on — `<slot>` alone is the slot's default — named
     * as the IFC type, a door's glazed where it or its type is named so, with the U-value its
     * property set gives. Undefined for one with no type: its slot's default.
     */
    private openingType(f: StepEntity, slot: FileOpeningType['slot']): string | undefined {
        const t = this.m.typeObject(f);
        if (!t) return undefined;
        // Revit writes a type more than once under one name: one type each name and slot.
        const own = this.m.name(t).replace(/:\d+$/, '').trim();
        const key = `${slot}|${own || t.id}`;
        const known = this.openingTypes.get(key);
        if (known) return known.id;
        const n = [...this.openingTypes.values()].filter((x) => x.slot === slot).length + 2;
        const props = this.m.properties(f);
        const u = props.get('Pset_WindowCommon')?.get('ThermalTransmittance') ??
            props.get('Pset_DoorCommon')?.get('ThermalTransmittance');
        const type: FileOpeningType = {
            id: `${slot}-${n}`,
            slot,
            ...(own ? { label: own } : {}),
            ...(slot !== 'window' && this.isGlazedDoor(f) ? { glazed: true } : {}),
            ...(typeof u === 'number' && u > 0 ? { uWm2K: Math.round(u * 100) / 100 } : {}),
        };
        this.openingTypes.set(key, type);
        return type.id;
    }

    /** Whether a door is named glazed — "Glass", "Glazed", Danish "Glas" — or its type is. */
    private isGlazedDoor(f: StepEntity): boolean {
        const names = [this.m.name(f), this.m.name(this.m.typeObject(f))];
        // A fibreglass door is a solid one.
        return names.some((n) => /glas|glaz/i.test(n) && !/fib(er|re) ?glass/i.test(n));
    }

    /** A door's `OperationType`: IFC4's on the door or its type, IFC2X3's on its style. */
    private doorOperation(f: StepEntity): string | null {
        const m = this.m;
        const own = m.enumOf(f, 11);
        if (own && own !== 'NOTDEFINED') return own;
        const t = m.typeObject(f);
        if (t?.type === 'IFCDOORSTYLE') return m.enumOf(t, 8);
        if (t?.type === 'IFCDOORTYPE') return m.enumOf(t, 10);
        return null;
    }

    /** A window's division from its `PartitioningType` (IFC4) or its style's `OperationType`. */
    private windowGlazing(f: StepEntity): Record<string, number> | null {
        const m = this.m;
        const t = m.typeObject(f);
        const kind =
            m.enumOf(f, 11) ??
            (t?.type === 'IFCWINDOWSTYLE'
                ? m.enumOf(t, 9)
                : t?.type === 'IFCWINDOWTYPE'
                  ? m.enumOf(t, 10)
                  : null);
        switch (kind) {
            case 'DOUBLE_PANEL_VERTICAL':
                return { mullions: 1 };
            case 'DOUBLE_PANEL_HORIZONTAL':
                return { transoms: 1 };
            case 'TRIPLE_PANEL_VERTICAL':
                return { mullions: 2 };
            case 'TRIPLE_PANEL_HORIZONTAL':
                return { transoms: 2 };
            case 'TRIPLE_PANEL_BOTTOM':
            case 'TRIPLE_PANEL_TOP':
            case 'TRIPLE_PANEL_LEFT':
            case 'TRIPLE_PANEL_RIGHT':
                return { mullions: 1, transoms: 1 };
            default:
                return null;
        }
    }

    // ---- The roof ----------------------------------------------------------------------------------

    private roofSlabs(): StepEntity[] {
        const m = this.m;
        const out: StepEntity[] = [];
        const seen = new Set<number>();
        for (const r of m.all('IFCROOF')) {
            const parts = m.partsOf(r);
            for (const p of parts.length > 0 ? parts : [r]) {
                if (!seen.has(p.id)) out.push(p);
                seen.add(p.id);
            }
        }
        for (const s of m.all('IFCSLAB')) {
            if (m.enumOf(s, 8) === 'ROOF' && !seen.has(s.id)) {
                out.push(s);
                seen.add(s.id);
            }
        }
        return out;
    }

    /** The roof's type and pitch, read off the slope of its planes. */
    private roofShape(roofs: readonly StepEntity[]): {
        type: 'flat' | 'shed' | 'gable' | 'hip';
        pitchDeg: number;
        ridge?: 'x' | 'y';
        highSide?: 'north' | 'south' | 'east' | 'west';
    } {
        const faces = roofs
            .flatMap((r) => this.m.bodyFaces(r))
            .map((f) => ({
                ...f,
                normal:
                    f.normal.z < 0 ? { x: -f.normal.x, y: -f.normal.y, z: -f.normal.z } : f.normal,
            }));
        const sloped = faces.filter((f) => f.normal.z > 0.05 && f.normal.z < 0.996);
        const level = faces.filter((f) => f.normal.z >= 0.996);
        const slopedArea = sloped.reduce((s, f) => s + f.area, 0);
        const levelArea = level.reduce((s, f) => s + f.area, 0);
        if (roofs.length === 0) {
            this.change(
                'roof/assumed',
                'A flat roof assumed',
                'The IFC has no roof: a flat roof is assumed at the top of the walls.'
            );
            return { type: 'flat', pitchDeg: 0 };
        }
        if (slopedArea <= levelArea * 0.25) return { type: 'flat', pitchDeg: 0 };
        // The planes by the way they fall, in 20° sectors.
        const groups = new Map<number, { area: number; nz: number; nx: number; ny: number }>();
        for (const f of sloped) {
            const az =
                Math.round(((Math.atan2(f.normal.y, f.normal.x) * 180) / Math.PI + 360) / 20) % 18;
            const g = groups.get(az) ?? { area: 0, nz: 0, nx: 0, ny: 0 };
            g.area += f.area;
            g.nz += f.normal.z * f.area;
            g.nx += f.normal.x * f.area;
            g.ny += f.normal.y * f.area;
            groups.set(az, g);
        }
        const main = [...groups.values()].filter((g) => g.area >= slopedArea * 0.05);
        const nz = main.reduce((s, g) => s + g.nz, 0) / main.reduce((s, g) => s + g.area, 0);
        const pitchDeg = Math.round(((Math.acos(Math.min(1, nz)) * 180) / Math.PI) * 10) / 10;
        if (main.length === 1) {
            const g = main[0]!;
            // The plane falls the way its normal leans; it rises to the other side.
            const up = { x: -g.nx, y: -g.ny };
            const highSide =
                Math.abs(up.x) > Math.abs(up.y)
                    ? up.x > 0
                        ? 'east'
                        : 'west'
                    : up.y > 0
                      ? 'north'
                      : 'south';
            return { type: 'shed', pitchDeg, highSide };
        }
        if (main.length === 2) {
            const [g, h] = main as [(typeof main)[0], (typeof main)[0]];
            const opposite = g.nx * h.nx + g.ny * h.ny < 0;
            if (opposite) {
                const ridge = Math.abs(g.nx) > Math.abs(g.ny) ? 'y' : 'x';
                return { type: 'gable', pitchDeg, ridge };
            }
        }
        if (main.length >= 3) {
            if (main.length !== 4) {
                this.change(
                    'roof/shape',
                    'The roof built as a hip roof',
                    `The roof has ${main.length} slopes; it is written as a hip roof.`
                );
            }
            return { type: 'hip', pitchDeg };
        }
        this.change(
            'roof/shape',
            'The roof built as a gable roof',
            "The roof's slopes could not be read as a shed, gable or hip roof; written as a gable roof."
        );
        return { type: 'gable', pitchDeg };
    }

    /** How far the roof runs past the walls' lines, mm, down the slope at the eaves. */
    private overhang(
        roofBox: Box3 | null,
        outline: readonly P2[],
        shape: { type: string; pitchDeg: number; ridge?: 'x' | 'y'; highSide?: string }
    ): { eavesMm: number; vergeMm: number } {
        if (!roofBox || outline.length < 3) return { eavesMm: 0, vergeMm: 0 };
        const xs = outline.map((p) => p.x);
        const ys = outline.map((p) => p.y);
        const sides = {
            west: Math.min(...xs) - roofBox.min.x,
            east: roofBox.max.x - Math.max(...xs),
            south: Math.min(...ys) - roofBox.min.y,
            north: roofBox.max.y - Math.max(...ys),
        };
        const avg = (a: number, b: number) => Math.max(0, (a + b) / 2);
        const round10 = (v: number) => Math.round(v / 10) * 10;
        const slope = Math.cos((shape.pitchDeg * Math.PI) / 180);
        if (shape.type === 'flat' || shape.type === 'hip') {
            const all = avg(avg(sides.west, sides.east), avg(sides.south, sides.north));
            return { eavesMm: round10(all / slope), vergeMm: round10(all) };
        }
        // Eaves run along the ridge, verges across it.
        const alongX =
            shape.type === 'gable'
                ? shape.ridge === 'x'
                : shape.highSide === 'north' || shape.highSide === 'south';
        const eaves = alongX ? avg(sides.south, sides.north) : avg(sides.west, sides.east);
        const verge = alongX ? avg(sides.west, sides.east) : avg(sides.south, sides.north);
        return { eavesMm: round10(eaves / slope), vergeMm: round10(verge) };
    }

    private roofLayers(roofs: readonly StepEntity[]): { name: string; layers: IfcLayer[] } | null {
        const m = this.m;
        const candidates = [...m.all('IFCROOF'), ...roofs];
        for (const r of candidates) {
            const u = m.layerUsage(r);
            if (u && u.layers.length > 0) return { name: u.name, layers: u.layers };
        }
        return null;
    }

    // ---- The floors ----------------------------------------------------------------------------------

    /**
     * The ground floor's build-up and the floor between storeys': each the slab most of its area
     * is, with the finish most of it is laid with. The upper storeys' floors are one build-up
     * (`deck`), as arch has one.
     */
    private floors(
        outline: readonly P2[],
        base: number,
        storeys: readonly LivingStorey[]
    ): {
        ground: { name: string; layers: IfcLayer[] } | null;
        deck: { name: string; layers: IfcLayer[] } | null;
    } {
        const m = this.m;
        const slabs = m.all('IFCSLAB').filter((s) => m.enumOf(s, 8) !== 'ROOF' && !m.wholeOf(s));
        type Slab = { s: StepEntity; layers: IfcLayer[]; area: number; name: string };
        type Finish = { layers: IfcLayer[]; area: number; name: string };
        const structural: Slab[] = [];
        const finishes: Finish[] = [];
        const upperStructural: Slab[] = [];
        const upperFinishes: Finish[] = [];
        /** Whether a level is an upper storey's floor, its slab's top under its finish. */
        const atUpperFloor = (z: number): boolean =>
            storeys.some((st, i) => i > 0 && Math.abs(z - st.elev) <= UPPER_FLOOR_REACH_MM);
        for (const s of slabs) {
            const b = box3(m.bodyPoints(s));
            if (!b) continue;
            const centre = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
            const area = (b.max.x - b.min.x) * (b.max.y - b.min.y);
            if (outline.length >= 3 && !insidePolygon(centre, outline)) {
                this.skip(
                    s,
                    'a slab outside the house (a terrace, a path): not part of the house.'
                );
                continue;
            }
            const u = m.layerUsage(s);
            const layers = u?.layers ?? [
                {
                    material: m.materialNames(s)[0] ?? m.name(s),
                    thickness: b.max.z - b.min.z,
                    ventilated: false,
                    category: null,
                },
            ];
            const total = layers.reduce((sum, l) => sum + l.thickness, 0);
            const finish =
                total <= 40 &&
                layers.every((l) =>
                    ['finish', 'insulation', 'membrane', 'board'].includes(
                        matchMaterial(l.material).role
                    )
                );
            const onGround = Math.abs(b.min.z - base) <= 60 || Math.abs(b.max.z - base) <= 60;
            const name = u?.name ?? m.name(s);
            if (finish) {
                if (onGround) finishes.push({ layers, area, name });
                else if (atUpperFloor(b.max.z)) upperFinishes.push({ layers, area, name });
                else this.skip(s, "a floor finish at no storey's floor level.");
                continue;
            }
            if (onGround && b.max.z <= base + 60) {
                structural.push({ s, layers, area, name });
                continue;
            }
            if (atUpperFloor(b.max.z)) {
                upperStructural.push({ s, layers, area, name });
                continue;
            }
            this.skip(s, "a slab at no storey's floor level.");
        }
        /** The slab most of the area is, with the finish most of it is laid with. */
        const buildup = (
            slabsOf: readonly Slab[],
            finishesOf: readonly Finish[]
        ): { name: string; layers: IfcLayer[] } | null => {
            if (slabsOf.length === 0) return null;
            const slab = largestBy(slabsOf, (x) => x.name);
            const finish = finishesOf.length > 0 ? largestBy(finishesOf, (x) => x.name) : null;
            // A floor reads top → bottom, inside → outside: the finish, then the slab.
            const slabLayers = orientFloor(slab.layers);
            const finishLayers = finish
                ? [...finish.layers].sort((a, b) => finishRank(a) - finishRank(b))
                : [];
            return {
                name: finish ? `${slab.name} + ${finish.name}` : slab.name,
                layers: [...finishLayers, ...slabLayers],
            };
        };
        return {
            ground: buildup(structural, finishes),
            deck: buildup(upperStructural, upperFinishes),
        };
    }

    // ---- Layers into the file -------------------------------------------------------------------

    /** The file's layers for a build-up, inside → outside, with its core. */
    private fileLayers(
        layers: readonly IfcLayer[],
        core: number,
        kind: 'wall' | 'roof' | 'floor'
    ): Record<string, unknown>[] {
        const roles = layers.map((l) => this.match(l.material));
        const insulationOutside = layers.some(
            (l, i) => i !== core && roles[i]!.role === 'insulation' && l.thickness >= 45
        );
        let metal = false;
        const out = layers.map((l, i) => {
            const r = roles[i]!;
            const thickness =
                l.thickness > 0.5
                    ? Math.round(l.thickness)
                    : defaultThicknessMm(r.materialId);
            if (/steel|stål|metal/i.test(l.material)) metal = true;
            const layer: Record<string, unknown> = {
                material: r.role === 'air' && l.ventilated ? 'air-ventilated' : r.materialId,
                thickness,
            };
            // A floor's or a roof's heavy core is a slab: hollow-core, or else concrete.
            if (i === core && kind !== 'wall' && r.role === 'heavy') {
                layer['material'] = r.materialId === 'hollow-core' ? 'hollow-core' : 'concrete';
            }
            if (r.role === 'studs') {
                // A layer of studs: timber members c/c 600, with insulation between unless the
                // build-up has its insulation elsewhere.
                layer['material'] = i === core && !insulationOutside ? 'mw-37' : 'air-still';
                layer['members'] = { material: 'softwood', width: 45, cc: 600 };
            } else if (i === core && r.role === 'insulation') {
                layer['members'] = { material: 'softwood', width: 45, cc: 600 };
            } else if (i === core && r.role !== 'heavy') {
                layer['members'] = { material: 'softwood', width: 45, cc: 600 };
            }
            if (i === core) layer['core'] = true;
            if (r.materialId === 'brick' && i !== core) layer['masonry'] = { bond: 'stretcher' };
            // Insulation between two leaves of masonry is tied across.
            if (r.role === 'insulation' && kind === 'wall') {
                const heavyIn = roles.slice(0, i).some((x) => x.role === 'heavy');
                const heavyOut = roles.slice(i + 1).some((x) => x.role === 'heavy');
                if (heavyIn && heavyOut) layer['ties'] = { perM2: 4, diameter: 4 };
            }
            return layer;
        });
        if (metal) {
            const w =
                'Steel studs, joists or framing are built as timber members (45 mm c/c 600): arch frames in timber.';
            this.change('steel-studs', 'Steel studs and joists built as timber', w);
        }
        return out;
    }

    /** The exterior wall's layers inside → outside: the side of the outline the first is on decides. */
    private insideOut(w: Wall, outline: readonly P2[]): IfcLayer[] {
        const firstY = w.offset + (w.sense * (w.layers[0]?.thickness ?? 0)) / 2;
        const side = Math.sign(firstY - w.lineY) || 1;
        const mid = mul2(add2(w.a, w.b), 0.5);
        const probe = add2(mid, mul2(w.normal, side * Math.max(w.thickness, 200)));
        const firstOutside =
            outline.length >= 3 ? !insidePolygon(probe, outline) : facadeAtStart(w.layers);
        return firstOutside ? [...w.layers].reverse() : [...w.layers];
    }

    private match(name: string): ReturnType<typeof matchMaterial> {
        const r = matchMaterial(name);
        if (!r.known) this.guessed.set(name, r.materialId);
        return r;
    }

    // ---- Rooms --------------------------------------------------------------------------------------

    private zones(
        spaces: readonly StepEntity[],
        storeys: readonly LivingStorey[],
        bandOf: (z: number) => number,
        T: (p: P2) => [number, number],
        storeyName: (k: number) => string | undefined
    ): Record<string, unknown>[] {
        const m = this.m;
        const ceilings = m
            .all('IFCCOVERING')
            .filter((c) => m.enumOf(c, 8) === 'CEILING')
            .map((c) => box3(m.bodyPoints(c)))
            .filter((b): b is Box3 => !!b);
        // What is over a room: the floors and roofs, whose underside its ceiling may hang from.
        const structure = m
            .all('IFCSLAB', 'IFCROOF')
            .map((x) => box3(m.bodyPoints(x)))
            .filter((b): b is Box3 => !!b && b.max.z - b.min.z > 50);
        const out: Record<string, unknown>[] = [];
        for (const s of spaces) {
            const b = box3(m.bodyPoints(s));
            if (!b) continue;
            const top = storeys[storeys.length - 1]!.top;
            if (b.min.z >= top - 50 || b.max.z <= storeys[0]!.elev + 50) {
                this.skip(s, 'a space on no storey of the house (over the roof, under the floor).');
                continue;
            }
            const k = bandOf(b.min.z + 50);
            const footprint = this.footprint(s);
            const point =
                footprint && footprint.length >= 3
                    ? interiorPoint(footprint)
                    : { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
            // Its number and its name, "A102 Living Room": two dwellings have rooms of one name.
            const long = (m.str(s, 7) ?? '').trim();
            const short = m.name(s).trim();
            const name =
                [short, long].filter((x, i, xs) => x && xs.indexOf(x) === i).join(' ') ||
                `Room ${s.id}`;
            const zone: Record<string, unknown> = {
                name,
                kind: zoneKind(long || short),
                ...(storeyName(k) ? { storey: storeyName(k) } : {}),
                point: T(point),
            };
            const st = storeys[k]!;
            const ceiling = ceilings.find(
                (c) =>
                    c.min.z > st.elev + 1500 &&
                    c.min.z < st.top &&
                    point.x >= c.min.x &&
                    point.x <= c.max.x &&
                    point.y >= c.min.y &&
                    point.y <= c.max.y
            );
            // Lowered only where it hangs well below what is over it: a ceiling fixed under the
            // joists is arch's flat ceiling, whatever its battens.
            const over = structure
                .filter(
                    (x) =>
                        x.min.z >= (ceiling?.min.z ?? st.top) - 1 &&
                        x.min.z <= st.top + 300 &&
                        point.x >= x.min.x &&
                        point.x <= x.max.x &&
                        point.y >= x.min.y &&
                        point.y <= x.max.y
                )
                .map((x) => x.min.z);
            const underside = over.length > 0 ? Math.min(...over) : st.top;
            if (ceiling && underside - ceiling.min.z > LOWERED_MM) {
                zone['ceiling'] = 'lowered';
                zone['ceilingMm'] = Math.round(ceiling.min.z - st.elev);
            }
            out.push(zone);
        }
        return out;
    }

    /**
     * Where two rooms meet with no wall between them (a kitchen open to the living room): the
     * edge their footprints share, taken out to the walls at its ends; and every other stretch of
     * a room's edge no wall stands on (the room beyond is not in the IFC). A room's footprint
     * stops at the walls' faces, so an edge running on from a wall's end is moved onto that
     * wall's line, where the house file has the wall.
     */
    private separations(
        spaces: readonly StepEntity[],
        storeys: readonly LivingStorey[],
        bandOf: (z: number) => number,
        walls: readonly PlanLine[]
    ): PlanLine[] {
        const rooms: { k: number; ring: P2[] }[] = [];
        for (const s of spaces) {
            const b = box3(this.m.bodyPoints(s));
            const ring = this.footprint(s);
            if (!b || !ring || ring.length < 3) continue;
            if (
                b.min.z >= storeys[storeys.length - 1]!.top - 50 ||
                b.max.z <= storeys[0]!.elev + 50
            )
                continue;
            rooms.push({ k: bandOf(b.min.z + 50), ring });
        }
        const seen = new Set<string>();
        // Separations already found, which a later one may end on.
        const found: PlanLine[] = [];
        for (let i = 0; i < rooms.length; i++) {
            for (let j = i + 1; j < rooms.length; j++) {
                const [r, q] = [rooms[i]!, rooms[j]!];
                if (r.k !== q.k) continue;
                const onStorey = [...walls, ...found].filter((w) => w.band.includes(r.k));
                for (const [a, b] of edges(r.ring)) {
                    for (const [c, d] of edges(q.ring)) {
                        const edge = sharedEdge(a, b, c, d);
                        if (!edge) continue;
                        const shared = ontoWallLine(edge, onStorey);
                        const mid = mul2(add2(shared[0], shared[1]), 0.5);
                        // A wall on the edge already parts the rooms.
                        const dir = norm2(sub2(shared[1], shared[0]));
                        const walled = onStorey.some((w) => {
                            const wd = norm2(sub2(w.b, w.a));
                            return (
                                Math.abs(wd.x * dir.y - wd.y * dir.x) < 0.05 &&
                                distToSegment(mid, w.a, w.b) < 400
                            );
                        });
                        if (walled) continue;
                        const ends = [
                            snapEnd(shared[0], shared[1], onStorey),
                            snapEnd(shared[1], shared[0], onStorey),
                        ];
                        const key = `${r.k}:${ends.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(';')}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        found.push({ a: ends[0]!, b: ends[1]!, band: [r.k] });
                    }
                }
            }
        }
        // A room's edge no wall and no separation stands on bounds it all the same: the room
        // beyond it is not in the IFC (a room Revit has not placed), or is no room at all.
        for (const r of rooms) {
            for (const [a, b] of edges(r.ring)) {
                const onStorey = [...walls, ...found].filter((w) => w.band.includes(r.k));
                for (const piece of uncovered(a, b, onStorey)) {
                    const shared = ontoWallLine(piece, onStorey);
                    const ends = [
                        snapEnd(shared[0], shared[1], onStorey),
                        snapEnd(shared[1], shared[0], onStorey),
                    ];
                    found.push({ a: ends[0]!, b: ends[1]!, band: [r.k] });
                }
            }
        }
        return found;
    }

    /**
     * A product's footprint in plan: the profile of its first upright extrusion; else what one
     * pushed sideways sweeps over (Revit draws a room over a stair as its section, pushed across
     * the stair); else, for a b-rep, its largest level face at its floor.
     */
    private footprint(e: StepEntity): P2[] | null {
        const extrusions = this.m.extrusions(e);
        for (const x of extrusions) {
            const world = x.profile.map((p) => {
                const q = {
                    x: x.frame.o.x + x.frame.x.x * p.x + x.frame.y.x * p.y,
                    y: x.frame.o.y + x.frame.x.y * p.x + x.frame.y.y * p.y,
                };
                return q;
            });
            if (Math.abs(x.frame.z.z) > 0.99 && world.length >= 3) return world;
        }
        for (const x of extrusions) {
            const d3 = scale(applyDir(x.frame, x.dir), x.depth);
            const d = { x: d3.x, y: d3.y };
            if (Math.abs(d3.z) > 1 || Math.hypot(d.x, d.y) < 100 || x.profile.length < 2) continue;
            const pts = x.profile.map((p) => apply(x.frame, p));
            const dn = norm2(d);
            const u = { x: -dn.y, y: dn.x };
            const across = pts.map((p) => dot2(p, u));
            const along = pts.reduce((sum, p) => sum + dot2(p, dn), 0) / pts.length;
            const [lo, hi] = [Math.min(...across), Math.max(...across)];
            if (hi - lo < 100) continue;
            const at = (s: number, t: number) => add2(mul2(u, s), mul2(dn, t));
            const len = Math.hypot(d.x, d.y);
            return [at(lo, along), at(hi, along), at(hi, along + len), at(lo, along + len)];
        }
        // A b-rep (Revit writes a room over a stair as one): its largest level face at its floor.
        const level = this.m.bodyFaces(e).filter((f) => Math.abs(f.normal.z) > 0.99);
        const floorZ = Math.min(...level.map((f) => f.points[0]!.z));
        const floor = level
            .filter((f) => f.points.every((p) => Math.abs(p.z - floorZ) <= 50))
            .sort((x, y) => y.area - x.area)[0];
        return floor ? floor.points.map((p) => ({ x: p.x, y: p.y })) : null;
    }

    // ---- Fittings -----------------------------------------------------------------------------------

    private fixtures(
        walls: readonly Wall[],
        role: ReadonlyMap<Wall, WallRole>,
        storeys: readonly LivingStorey[],
        bandOf: (z: number) => number,
        T: (p: P2) => [number, number],
        storeyName: (k: number) => string | undefined
    ): Record<string, unknown>[] {
        const m = this.m;
        const kept = walls.filter(
            (w) =>
                role.get(w) === 'exterior' ||
                role.get(w) === 'partition' ||
                role.get(w) === 'lining'
        );
        const out: Record<string, unknown>[] = [];
        const elements = m.all(
            'IFCFURNISHINGELEMENT',
            'IFCFURNITURE',
            'IFCSYSTEMFURNITUREELEMENT',
            'IFCSANITARYTERMINAL',
            'IFCFLOWTERMINAL',
            'IFCELECTRICAPPLIANCE',
            'IFCWASTETERMINAL'
        );
        for (const e of elements) {
            const name = this.typeName(e);
            const kind = fixtureKind(name);
            if (kind === null) continue; // part of the kitchen's worktop, or not a fitting at all
            if (kind === 'loose') {
                this.skip(e, 'loose furniture: arch places only the fixed fittings.');
                continue;
            }
            const pts = m.bodyPoints(e);
            const b = box3(pts);
            if (!b) continue;
            if (b.min.z >= storeys[storeys.length - 1]!.top || b.max.z <= storeys[0]!.elev)
                continue;
            const k = bandOf(b.min.z + 10);
            const st = storeys[k]!;
            const centre = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
            // Its back is to the nearest wall; it faces away from it.
            let best: Wall | null = null;
            let bestD = Infinity;
            for (const w of kept) {
                if (w.zHi < st.elev + 500 || w.zLo > st.elev + 500) continue;
                const d = distToSegment(centre, w.a, w.b);
                if (d < bestD) {
                    best = w;
                    bestD = d;
                }
            }
            let facing: P2 = { x: 0, y: -1 };
            let along: P2 = { x: 1, y: 0 };
            if (best) {
                const d = best.dir;
                const n = { x: -d.y, y: d.x };
                facing = dot2(sub2(centre, best.a), n) >= 0 ? n : { x: -n.x, y: -n.y };
                along = d;
            }
            const width = spread(pts, along);
            const depth = spread(pts, facing);
            const backGap = bestD - depth / 2 - (best?.thickness ?? 0) / 2;
            const isKitchenRun = kind === 'worktop';
            const finalKind = isKitchenRun && (!best || backGap > 300) ? 'island' : kind;
            out.push({
                kind: finalKind,
                ...(storeyName(k) ? { storey: storeyName(k) } : {}),
                at: T(centre),
                size: [Math.round(width), Math.round(depth)],
                facing: facingOf(facing),
            });
            // A sink cut into the worktop: the hole it is in. Revit writes the hole of a worktop
            // turned half round the wrong way round, through the worktop's origin and out of it:
            // turned back through that origin, it is in the worktop again.
            if (isKitchenRun) {
                const inside = (p: P2) =>
                    p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y;
                const origin = m.placementOf(e).o;
                for (const hole of m.openingsIn(e)) {
                    const hb = box3(m.bodyPoints(hole));
                    if (!hb) continue;
                    let at = { x: (hb.min.x + hb.max.x) / 2, y: (hb.min.y + hb.max.y) / 2 };
                    if (!inside(at)) {
                        const back = { x: 2 * origin.x - at.x, y: 2 * origin.y - at.y };
                        at = inside(back) ? back : centre;
                    }
                    out.push({
                        kind: 'sink',
                        ...(storeyName(k) ? { storey: storeyName(k) } : {}),
                        at: T(at),
                        facing: facingOf(facing),
                    });
                }
            }
        }
        return out;
    }

    // ---- Posts and beams ------------------------------------------------------------------------------

    private lines(base: number, ox: number, oy: number): Record<string, unknown>[] {
        const m = this.m;
        const out: Record<string, unknown>[] = [];
        for (const e of m.all('IFCCOLUMN', 'IFCBEAM', 'IFCMEMBER')) {
            // A stair's stringers and a curtain wall's mullions are counted with them.
            const whole = m.wholeOf(e);
            if (
                whole &&
                ['IFCSTAIR', 'IFCRAMP', 'IFCCURTAINWALL', 'IFCRAILING'].includes(whole.type)
            )
                continue;
            const materials = m.materialNames(e).join(' ') || this.typeName(e);
            if (!isTimber(materials)) {
                this.skip(
                    e,
                    'a post or beam of steel or concrete: arch frames in timber, and works out its own beams and lintels.'
                );
                continue;
            }
            const x = m.extrusions(e)[0];
            if (!x) {
                this.skip(e, 'a post or beam whose axis could not be read.');
                continue;
            }
            const p0 = x.frame.o;
            const d = {
                x: x.frame.x.x * x.dir.x + x.frame.y.x * x.dir.y + x.frame.z.x * x.dir.z,
                y: x.frame.x.y * x.dir.x + x.frame.y.y * x.dir.y + x.frame.z.y * x.dir.z,
                z: x.frame.x.z * x.dir.x + x.frame.y.z * x.dir.y + x.frame.z.z * x.dir.z,
            };
            const p1 = {
                x: p0.x + d.x * x.depth,
                y: p0.y + d.y * x.depth,
                z: p0.z + d.z * x.depth,
            };
            const pt = (p: Vec3) => [
                Math.round(p.x - ox),
                Math.round(p.y - oy),
                Math.round(p.z - base),
            ];
            out.push({
                role: e.type === 'IFCCOLUMN' ? 'column' : 'beam',
                points: [pt(p0), pt(p1)],
            });
        }
        return out;
    }

    // ---- What is left out --------------------------------------------------------------------------

    private skipTheRest(): void {
        const m = this.m;
        const reasons: [string[], string][] = [
            [['IFCSTAIR', 'IFCRAMP'], 'a stair or ramp: arch has no stairs yet.'],
            [['IFCRAILING'], 'a railing: arch has no railings.'],
            [
                ['IFCFOOTING', 'IFCPILE'],
                'the foundation: arch lays out its own foundation from the house.',
            ],
            [['IFCBUILDINGELEMENTPROXY'], 'an element of no known kind.'],
            [['IFCCHIMNEY'], 'a chimney: arch has none.'],
        ];
        for (const [types, reason] of reasons) {
            for (const e of m.all(...types)) {
                // A stair's flights and railings are counted with it.
                const whole = m.wholeOf(e);
                if (whole && ['IFCSTAIR', 'IFCRAMP'].includes(whole.type)) continue;
                this.skip(e, reason);
            }
        }
        for (const c of m.all('IFCCOVERING')) {
            const kind = m.enumOf(c, 8);
            this.skip(
                c,
                kind === 'CEILING'
                    ? 'a ceiling: its height is read into the rooms under it; its build-up is not carried (arch has none for a ceiling under a floor or a warm roof).'
                    : 'a covering: arch builds its own from the build-ups.'
            );
        }
    }

    private skip(e: StepEntity, reason: string): void {
        const key = `${e.type}|${reason}`;
        const g = this.skipped.get(key) ?? { reason, type: e.type, count: 0, names: [] };
        g.count++;
        const name = this.m.name(e).replace(/:\d+$/, '');
        if (name && g.names.length < 3 && !g.names.includes(name)) g.names.push(name);
        this.skipped.set(key, g);
    }

    private projectName(): string | undefined {
        const m = this.m;
        const project = m.all('IFCPROJECT')[0] ?? null;
        const building = m.all('IFCBUILDING')[0] ?? null;
        const candidates = [
            m.str(project, 5),
            m.name(project),
            m.name(building),
            m.str(building, 7),
        ];
        return (
            candidates.find((n) => n && !/^\d*$/.test(n.trim()) && !/^default$/i.test(n.trim())) ??
            undefined
        );
    }

    private trueNorthDeg(): number | null {
        const m = this.m;
        for (const c of m.all('IFCGEOMETRICREPRESENTATIONCONTEXT')) {
            const d = m.direction(m.deref(c.args[5]));
            if (d) return (Math.atan2(d.x, d.y) * 180) / Math.PI;
        }
        return null;
    }
}

// ---- Cores and orientation --------------------------------------------------------------------------

/**
 * The layer that carries: one the file marks load-bearing (IFC4's `Category`), or the thickest
 * heavy leaf of 75 mm or more — block or concrete before facing brick — or the thickest layer of
 * studs, or the thickest insulation, or the thickest layer. −1 for no layers.
 */
export function pickCore(layers: readonly IfcLayer[]): number {
    if (layers.length === 0) return -1;
    const marked = layers.findIndex((l) => /load ?bearing/i.test(l.category ?? ''));
    if (marked >= 0) return marked;
    const roles = layers.map((l) => matchMaterial(l.material));
    const thickest = (idx: number[]) =>
        idx.reduce(
            (best, i) => (layers[i]!.thickness > layers[best]!.thickness ? i : best),
            idx[0]!
        );
    const heavy = layers
        .map((_, i) => i)
        .filter((i) => roles[i]!.role === 'heavy' && layers[i]!.thickness >= MIN_LEAF_MM);
    if (heavy.length > 0) {
        const inner = heavy.filter((i) => roles[i]!.materialId !== 'brick');
        return thickest(inner.length > 0 ? inner : heavy);
    }
    for (const role of ['studs', 'insulation'] as LayerRole[]) {
        const idx = layers
            .map((_, i) => i)
            .filter((i) => roles[i]!.role === role && layers[i]!.thickness >= 20);
        if (idx.length > 0) return thickest(idx);
    }
    return thickest(layers.map((_, i) => i));
}

function isMirrored(layers: readonly IfcLayer[]): boolean {
    const n = layers.length;
    return layers.every(
        (l, i) =>
            l.material === layers[n - 1 - i]!.material &&
            Math.abs(l.thickness - layers[n - 1 - i]!.thickness) < 1
    );
}

/** The way a wall's positive side lies in plan: right looking along it towards +x, or +y. */
function positiveOf(w: Wall): P2 {
    const u =
        w.dir.x > 1e-9 || (Math.abs(w.dir.x) <= 1e-9 && w.dir.y > 0) ? w.dir : mul2(w.dir, -1);
    return { x: u.y, y: -u.x };
}

/**
 * Where each of `of`'s layers lies across `w`'s line, mm towards `w`'s positive side: `lo` to
 * `hi`. `of` is `w` itself or a wall lining it.
 */
function spansOn(w: Wall, of: Wall): { layer: IfcLayer; lo: number; hi: number }[] {
    const p = positiveOf(w);
    let at = of.offset;
    return of.layers.map((layer) => {
        const from = at;
        at += of.sense * layer.thickness;
        const [y0, y1] = [from, at].map((y) => dot2(sub2(add2(of.axisA, mul2(of.normal, y)), w.a), p));
        return { layer, lo: Math.min(y0!, y1!), hi: Math.max(y0!, y1!) };
    });
}

/**
 * `w`'s layers from its positive side to its back, with `linings` standing against it: on each
 * lining's side, the layers past the lining's inner face give way to the lining's own. Its core
 * is `w`'s.
 */
function linedLayers(w: Wall, linings: readonly Wall[]): { layers: IfcLayer[]; core: number } {
    const coreLayer = w.layers[w.core];
    let spans = spansOn(w, w);
    for (const l of linings) {
        const ls = spansOn(w, l);
        const positive = ls.reduce((s, x) => s + x.lo + x.hi, 0) > 0;
        const inner = positive ? Math.min(...ls.map((x) => x.lo)) : Math.max(...ls.map((x) => x.hi));
        spans = spans.filter((x) => {
            const mid = (x.lo + x.hi) / 2;
            return x.layer === coreLayer || (positive ? mid < inner : mid > inner);
        });
        spans.push(...ls);
    }
    const ordered = spans.sort((x, y) => y.hi - x.hi).map((x) => x.layer);
    return { layers: ordered, core: Math.max(0, ordered.indexOf(coreLayer!)) };
}

/** Which side of `w` a lining against it stands on: 1 its positive side, -1 its back. */
function liningSide(w: Wall, lining: Wall): 1 | -1 {
    return spansOn(w, lining).reduce((sum, x) => sum + x.lo + x.hi, 0) > 0 ? 1 : -1;
}

/** How far `w`'s faces, and those of the linings against it, stand off its line at most, mm. */
function acrossOf(w: Wall, linings: readonly Wall[]): number {
    return Math.max(...[w, ...linings].flatMap((x) => spansOn(w, x).flatMap((s) => [Math.abs(s.lo), Math.abs(s.hi)])));
}

/**
 * A partition's run cut where the linings against it start and stop: each stretch with the
 * linings that stand along it.
 */
function linedPieces(
    run: { a: P2; b: P2 },
    linings: readonly Wall[]
): { a: P2; b: P2; linings: Wall[] }[] {
    const len = dist2(run.a, run.b);
    if (linings.length === 0 || len < 1) return [{ a: run.a, b: run.b, linings: [] }];
    const d = norm2(sub2(run.b, run.a));
    const extent = linings.map((l) => {
        const [t0, t1] = [l.axisA, l.axisB].map((q) => dot2(sub2(q, run.a), d));
        return { l, lo: Math.max(0, Math.min(t0!, t1!)), hi: Math.min(len, Math.max(t0!, t1!)) };
    });
    const cuts = unique([0, len, ...extent.flatMap((e) => [e.lo, e.hi])])
        .filter((t) => t >= 0 && t <= len)
        .sort((x, y) => x - y);
    const pieces: { a: P2; b: P2; linings: Wall[] }[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
        const [t0, t1] = [cuts[i]!, cuts[i + 1]!];
        const mid = (t0 + t1) / 2;
        const on = extent.filter((e) => e.lo <= mid && mid <= e.hi).map((e) => e.l);
        const last = pieces[pieces.length - 1];
        // A stretch too short to build as a face of its own goes with the one before it.
        const same = last && last.linings.length === on.length && last.linings.every((l) => on.includes(l));
        if (last && (same || t1 - t0 < MIN_PIECE_MM)) {
            last.b = add2(run.a, mul2(d, t1));
            continue;
        }
        pieces.push({ a: add2(run.a, mul2(d, t0)), b: add2(run.a, mul2(d, t1)), linings: on });
    }
    // A first stretch too short goes with the one after it.
    if (pieces.length > 1 && dist2(pieces[0]!.a, pieces[0]!.b) < MIN_PIECE_MM) {
        pieces[1]!.a = pieces[0]!.a;
        pieces.shift();
    }
    return pieces.length > 0 ? pieces : [{ a: run.a, b: run.b, linings: [] }];
}

/** A party wall named as one: "lejlighedsskel", "party wall", "separating wall". */
const PARTY_NAME = /party|lejligheds|separating|brandsektion|skelvæg/i;

/** Whether a wall parts two dwellings: named so, or heavy with its leaves laid mirror-wise. */
function isPartyWall(w: Wall): boolean {
    if (PARTY_NAME.test(w.layerSetName) || PARTY_NAME.test(w.name)) return true;
    return isMirrored(w.layers) && leaves(w.layers).length >= 2;
}

/**
 * The leaves of a wall that carry: its leaves of masonry or concrete of 75 mm or more where it
 * has any — the studs of a lining on them are no leaf — else its layers of studs.
 */
function leaves(layers: readonly IfcLayer[]): number[] {
    const roles = layers.map((l) => matchMaterial(l.material).role);
    const heavy = layers
        .map((_, i) => i)
        .filter((i) => roles[i] === 'heavy' && layers[i]!.thickness >= MIN_LEAF_MM);
    if (heavy.length > 0) return heavy;
    return layers.map((_, i) => i).filter((i) => roles[i] === 'studs');
}

/** Where across the axis layer `i` of `w` is in the middle. */
function layerMidY(w: Wall, i: number): number {
    const before = w.layers.slice(0, i).reduce((s, l) => s + l.thickness, 0);
    return w.offset + w.sense * (before + w.layers[i]!.thickness / 2);
}

/** `w`'s line moved onto the middle of layer `i`, which becomes its core. */
function setOnLayer(w: Wall, i: number): void {
    w.core = i;
    w.lineY = layerMidY(w, i);
    w.a = add2(w.axisA, mul2(w.normal, w.lineY));
    w.b = add2(w.axisB, mul2(w.normal, w.lineY));
}

/**
 * A party wall on the outline set out on its own dwelling's leaf — the one inside `ring`. Whether
 * its line moved.
 */
function onRoomLeaf(w: Wall, ring: readonly P2[]): boolean {
    const ls = leaves(w.layers);
    if (ls.length < 2) return false;
    const mid = mul2(add2(w.axisA, w.axisB), 0.5);
    const inside = ls.filter((i) =>
        insidePolygon(add2(mid, mul2(w.normal, layerMidY(w, i))), ring)
    );
    const pick = inside.length > 0 ? inside[0]! : ls[0]!;
    if (pick === w.core) return false;
    setOnLayer(w, pick);
    return true;
}

/**
 * A party wall's layers as its build-up lists them, and which is the core: from the far side of
 * the leaf it is set out on, across that leaf to the other — on the outline, the room's side
 * first, since its own dwelling's leaf is the one it is set out on.
 */
function partyLayers(w: Wall): { layers: IfcLayer[]; core: number } {
    const core = w.core >= 0 ? w.core : (leaves(w.layers)[0] ?? 0);
    const other = leaves(w.layers).find((i) => i !== core);
    const forward = other === undefined || other > core;
    return forward
        ? { layers: [...w.layers], core }
        : { layers: [...w.layers].reverse(), core: w.layers.length - 1 - core };
}

/**
 * A party wall between two rooms set out on the leaf that has the other on its back: a
 * partition's layers past its core lie on the back of its face — on the left looking along the
 * wall towards +x, or +y for a wall along y (`surfaceFrame`) — so the leaf the line goes through
 * is the one that puts the other where the IFC has it.
 */
function onLeftLeaf(w: Wall): void {
    const ls = leaves(w.layers);
    if (ls.length < 2) return;
    // The canonical direction along the wall, and its left.
    const u =
        w.dir.x > 1e-9 || (Math.abs(w.dir.x) <= 1e-9 && w.dir.y > 0) ? w.dir : mul2(w.dir, -1);
    const left = { x: -u.y, y: u.x };
    const across = (i: number) => layerMidY(w, i) * dot2(w.normal, left);
    // The leaf furthest right is the one with every other on its left.
    const pick = ls.reduce((best, i) => (across(i) < across(best) ? i : best), ls[0]!);
    if (pick !== w.core) setOnLayer(w, pick);
}

/** Whether a wall's first layer is its facade: brick or cladding first, a board last. */
function facadeAtStart(layers: readonly IfcLayer[]): boolean {
    const first = matchMaterial(layers[0]?.material ?? '');
    return first.role === 'covering' || first.materialId === 'brick';
}

/** A roof's layers inside → outside: the covering goes outside. */
function orientRoof(layers: readonly IfcLayer[]): IfcLayer[] {
    const roles = layers.map((l) => matchMaterial(l.material).role);
    const first = roles.indexOf('covering');
    const last = roles.lastIndexOf('covering');
    if (first < 0) return [...layers];
    return first < layers.length - 1 - last ? [...layers].reverse() : [...layers];
}

/** A floor slab's layers top → bottom: a finish or screed on top, the ground under. */
function orientFloor(layers: readonly IfcLayer[]): IfcLayer[] {
    if (layers.length < 2) return [...layers];
    const roles = layers.map((l) => matchMaterial(l.material).role);
    const topish = (r: LayerRole) => r === 'finish' || r === 'board';
    return topish(roles[roles.length - 1]!) && !topish(roles[0]!)
        ? [...layers].reverse()
        : [...layers];
}

/** A finish's layers top first: what is walked on, then what it lies on. */
function finishRank(l: IfcLayer): number {
    const r = matchMaterial(l.material);
    if (r.role === 'finish' && r.materialId !== 'screed') return 0;
    if (r.materialId === 'screed' && /tile|flise|ceramic|klinke/i.test(l.material)) return 0;
    if (r.role === 'finish') return 1;
    return 2;
}

/** The facade cladding an exterior wall's outermost layers make. */
function facadeOf(insideOut: readonly IfcLayer[]): string | null {
    for (let i = insideOut.length - 1; i >= 0; i--) {
        const l = insideOut[i]!;
        const r = matchMaterial(l.material);
        if (r.role === 'air' || r.role === 'membrane') continue;
        if (r.materialId === 'brick') return 'brick';
        if (r.materialId === 'facade-sheet') return 'sheet';
        if (r.materialId === 'cladding') {
            if (/lap|klink|weatherboard|siding/i.test(l.material)) return 'lap';
            if (/batten|liste/i.test(l.material)) return 'board-and-batten';
            return 'board-on-board';
        }
        if (r.materialId === 'screed') return 'sheet';
        return null;
    }
    return null;
}

/** The roof covering a roof's outermost layers make. */
function coveringOf(insideOut: readonly IfcLayer[]): string | null {
    for (let i = insideOut.length - 1; i >= 0; i--) {
        const r = matchMaterial(insideOut[i]!.material);
        if (r.role === 'air') continue;
        switch (r.materialId) {
            case 'green-roof':
                return 'green';
            case 'zinc':
                return 'zinc';
            case 'roofing':
                return 'tiles';
            case 'roofing-felt':
                return 'felt';
            default:
                return null;
        }
    }
    return null;
}

// ---- Rooms and fittings by name ---------------------------------------------------------------------

const ZONE_KINDS: readonly [RegExp, string][] = [
    [/bath|\bbad\b|badeværelse|shower|bruse/i, 'bathroom'],
    [/\bwc\b|toilet|lavatory|powder/i, 'wc'],
    [/kitchen|køkken|dining|spise/i, 'kitchen'],
    [/bed|sove|værelse|guest|gæste|child|børne|nursery/i, 'bedroom'],
    [
        /utility|laundry|bryggers|vaskerum|storage|depot|closet|pantry|viktualie|garderobe/i,
        'utility',
    ],
    [
        /hall|foyer|entr|\bgang\b|corridor|stair|trappe|vindfang|landing|passage|lobby/i,
        'circulation',
    ],
    [/tech|teknik|mechanical|installation|boiler|\bfyr/i, 'technical'],
];

function zoneKind(name: string): string {
    for (const [re, kind] of ZONE_KINDS) if (re.test(name)) return kind;
    return 'living';
}

/** A fitting's kind from its name; null for a part of the kitchen run, `loose` for furniture. */
function fixtureKind(name: string): string | null {
    if (/upper cabinet|wall cabinet|overskab|base cabinet|underskab|drawer|skuffe/i.test(name))
        return null;
    if (/water ?closet|\bwc\b|toilet/i.test(name)) return 'wc';
    if (/vanity|lavatory|wash ?basin|\bbasin|håndvask/i.test(name)) return 'basin';
    if (/counter|worktop|bordplade|køkkenelement/i.test(name)) return 'worktop';
    if (/island|køkkenø/i.test(name)) return 'island';
    if (/kitchen sink|køkkenvask|\bsink\b/i.test(name)) return 'sink';
    if (/refrigerat|fridge|freezer|køleskab|fryser/i.test(name)) return 'fridge';
    if (/dishwash|opvask/i.test(name)) return 'dishwasher';
    if (/washing machine|washer|vaskemaskine/i.test(name)) return 'washer';
    if (/dryer|tumble|tørretumbler/i.test(name)) return 'dryer';
    if (/\brange\b|stove|cooktop|\bhob\b|komfur|kogeplade/i.test(name)) return 'hob';
    if (/shower|bruse/i.test(name)) return 'shower';
    if (/bath ?tub|\bbath\b|badekar/i.test(name)) return 'bathtub';
    if (/floor ?drain|gulvafløb|linjeafløb/i.test(name)) return 'floor-drain';
    if (/tall cabinet|højskab|pantry cabinet/i.test(name)) return 'cabinet';
    return 'loose';
}

function facingOf(v: P2): string | number {
    const deg = ((Math.atan2(v.y, v.x) * 180) / Math.PI + 360) % 360;
    const named: [number, string][] = [
        [0, 'x+'],
        [90, 'y+'],
        [180, 'x-'],
        [270, 'y-'],
        [360, 'x+'],
    ];
    for (const [d, n] of named) if (Math.abs(deg - d) < 1) return n;
    return Math.round(deg);
}

function compass(v: P2): string {
    if (Math.abs(v.x) >= Math.abs(v.y)) return v.x > 0 ? 'east' : 'west';
    return v.y > 0 ? 'north' : 'south';
}

// ---- The exterior loop ------------------------------------------------------------------------------

/**
 * The walls whose lines close round the house, in order, and the corners where each meets the
 * next: of all the closed chains of walls meeting end to end, the one round the largest area.
 * Two walls meet where their lines cross, or, in line, between their ends; the corner must be
 * within a wall's thickness and 300 mm of each end. Null when no chain closes.
 */
export function findLoop(walls: readonly Wall[]): { walls: Wall[]; corners: Corner[] } | null {
    if (walls.length < 3) return null;
    const endOf = (w: Wall, k: 0 | 1) => (k === 0 ? w.a : w.b);
    interface Join {
        j: number;
        l: 0 | 1;
        at: P2;
        score: number;
    }
    const best = new Map<string, Join>();
    walls.forEach((w, i) => {
        for (const k of [0, 1] as const) {
            const e = endOf(w, k);
            let pick: Join | null = null;
            walls.forEach((v, j) => {
                if (j === i) return;
                for (const l of [0, 1] as const) {
                    const f = endOf(v, l);
                    const at = meet(w, v, e, f);
                    if (!at) continue;
                    const de = dist2(at, e);
                    const df = dist2(at, f);
                    if (de > w.thickness + CORNER_REACH_MM || df > v.thickness + CORNER_REACH_MM)
                        continue;
                    const score = de + df;
                    if (!pick || score < pick.score) pick = { j, l, at, score };
                }
            });
            if (pick) best.set(`${i}:${k}`, pick);
        }
    });
    // Only joins both ends agree on.
    const join = (i: number, k: 0 | 1): Join | null => {
        const p = best.get(`${i}:${k}`);
        if (!p) return null;
        const back = best.get(`${p.j}:${p.l}`);
        return back && back.j === i && back.l === k ? p : null;
    };
    let bestLoop: { walls: Wall[]; corners: Corner[]; area: number } | null = null;
    const seen = new Set<number>();
    walls.forEach((_, start) => {
        if (seen.has(start)) return;
        const order: number[] = [];
        const corners: Corner[] = [];
        let i = start;
        let k: 0 | 1 = 1; // leave by this end
        const entry = join(start, 0);
        if (!entry) return;
        for (let guard = 0; guard <= walls.length; guard++) {
            order.push(i);
            const next = join(i, k);
            if (!next) return;
            corners.push({ at: next.at });
            if (next.j === start) {
                if (next.l !== 0) return;
                for (const n of order) seen.add(n);
                // corners[n] is where order[n] ends; the loop's corner list starts where order[0] starts.
                const loopCorners = [corners[corners.length - 1]!, ...corners.slice(0, -1)];
                const area = Math.abs(signedArea(loopCorners.map((c) => c.at)));
                if (!bestLoop || area > bestLoop.area) {
                    bestLoop = { walls: order.map((n) => walls[n]!), corners: loopCorners, area };
                }
                return;
            }
            if (order.includes(next.j)) return;
            i = next.j;
            k = next.l === 0 ? 1 : 0;
        }
    });
    if (!bestLoop) return null;
    const found = bestLoop as { walls: Wall[]; corners: Corner[]; area: number };
    return { walls: found.walls, corners: found.corners };
}

/** Where two walls' lines meet near ends `e` and `f`: their crossing, or between the ends if in line. */
function meet(w: Wall, v: Wall, e: P2, f: P2): P2 | null {
    const cross = w.dir.x * v.dir.y - w.dir.y * v.dir.x;
    if (Math.abs(cross) < 0.02) {
        // In line: one line, the ends close.
        const off = Math.abs(dot2(sub2(f, w.a), { x: -w.dir.y, y: w.dir.x }));
        if (off > ON_LINE_MM) return null;
        return mul2(add2(e, f), 0.5);
    }
    const d = sub2(v.a, w.a);
    const t = (d.x * v.dir.y - d.y * v.dir.x) / cross;
    return add2(w.a, mul2(w.dir, t));
}

/**
 * The wall a curtain wall is set in: one it lies in the thickness of, square to it, within its
 * length and its height. Revit draws a glazed panel in a wall so, and its IFC keeps the wall whole.
 */
function hostWallOf(cw: Wall, walls: readonly Wall[]): Wall | null {
    let best: Wall | null = null;
    for (const w of walls) {
        if (w.zLo > cw.zLo + SET_IN_MM || w.zHi < cw.zHi - SET_IN_MM) continue;
        if (Math.abs(dot2(cw.dir, w.dir)) < 0.99) continue;
        const len = dist2(w.axisA, w.axisB);
        const ta = dot2(sub2(cw.a, w.axisA), w.dir);
        const tb = dot2(sub2(cw.b, w.axisA), w.dir);
        if (Math.min(ta, tb) < -SET_IN_MM || Math.max(ta, tb) > len + SET_IN_MM) continue;
        // Across: inside the wall's body, from its first layer's face to its last's.
        const lo = Math.min(w.offset, w.offset + w.sense * w.thickness) - SET_IN_MM;
        const hi = Math.max(w.offset, w.offset + w.sense * w.thickness) + SET_IN_MM;
        const s = dot2(sub2(mul2(add2(cw.a, cw.b), 0.5), w.axisA), w.normal);
        if (s < lo || s > hi) continue;
        if (!best || w.thickness > best.thickness) best = w;
    }
    return best;
}

/**
 * Curtain walls side by side on one line joined into one wall of glass: in line (within a degree
 * and `ON_LINE_MM`), at most `JOIN_GAP_MM` apart along it, over most of the same height. Revit
 * writes each panel of a glazed wall as a curtain wall of its own; left apart, a partition meeting
 * the glass would end in the gap a mullion leaves between two of them.
 */
function joinCurtains(walls: readonly Wall[]): Wall[] {
    const parent = walls.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
    const along = (w: Wall, p: P2) => dot2(sub2(p, w.a), w.dir);
    const off = (w: Wall, p: P2) => Math.abs(dot2(sub2(p, w.a), { x: -w.dir.y, y: w.dir.x }));
    for (let i = 0; i < walls.length; i++) {
        const a = walls[i]!;
        const len = dist2(a.a, a.b);
        for (let j = i + 1; j < walls.length; j++) {
            const b = walls[j]!;
            if (Math.abs(dot2(a.dir, b.dir)) < JOIN_COS) continue;
            if (off(a, b.a) > ON_LINE_MM || off(a, b.b) > ON_LINE_MM) continue;
            const [t0, t1] = [along(a, b.a), along(a, b.b)].sort((x, y) => x - y) as [number, number];
            if (t0 > len + JOIN_GAP_MM || t1 < -JOIN_GAP_MM) continue;
            const shared = Math.min(a.zHi, b.zHi) - Math.max(a.zLo, b.zLo);
            if (shared < 0.5 * Math.min(a.zHi - a.zLo, b.zHi - b.zLo)) continue;
            parent[root(j)] = root(i);
        }
    }
    const groups = new Map<number, Wall[]>();
    walls.forEach((w, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), w]));
    return [...groups.values()].map((group) => (group.length === 1 ? group[0]! : joined(group)));
}

/** One wall of glass from curtain walls on one line, its grid and panels laid along it. */
function joined(group: readonly Wall[]): Wall {
    const base = group[0]!;
    const { dir } = base;
    const normal = { x: -dir.y, y: dir.x };
    const t = (p: P2) => dot2(sub2(p, base.a), dir);
    // Each wall's own positions along its line, onto the joined one's.
    const onto = (w: Wall, s: number) => t(add2(w.a, mul2(w.dir, s)));
    const ends = group.flatMap((w) => [t(w.a), t(w.b)]);
    const lo = Math.min(...ends);
    const hi = Math.max(...ends);
    const across =
        group.reduce((sum, w) => sum + dot2(sub2(w.a, base.a), normal) + dot2(sub2(w.b, base.a), normal), 0) /
        (2 * group.length);
    const at = (s: number) => add2(base.a, add2(mul2(dir, s), mul2(normal, across)));
    const span = (w: Wall, x: number, y: number): [number, number] => {
        const [p, q] = [onto(w, x) - lo, onto(w, y) - lo];
        return p <= q ? [p, q] : [q, p];
    };
    const grid: CurtainGrid = {
        mullions: group.flatMap((w) => w.curtain!.mullions.map((g) => ({ ...g, t: onto(w, g.t) - lo }))),
        transoms: group.flatMap((w) =>
            w.curtain!.transoms.map((g) => {
                const [tLo, tHi] = span(w, g.tLo, g.tHi);
                return { z: g.z, tLo, tHi };
            })
        ),
        panes: group.flatMap((w) =>
            w.curtain!.panes.map((g) => {
                const [tLo, tHi] = span(w, g.tLo, g.tHi);
                return { tLo, tHi, zLo: g.zLo, zHi: g.zHi };
            })
        ),
        panels: group.reduce((n, w) => n + w.curtain!.panels, 0),
    };
    const ext = group.map((w) => w.isExternal);
    return {
        ...base,
        axisA: at(lo),
        axisB: at(hi),
        a: at(lo),
        b: at(hi),
        zLo: Math.min(...group.map((w) => w.zLo)),
        zHi: Math.max(...group.map((w) => w.zHi)),
        thickness: Math.max(...group.map((w) => w.thickness)),
        isExternal: ext.includes(true) ? true : ext.includes(false) ? false : null,
        curtain: grid,
    };
}

/** Positions closer than `GRID_MERGE_MM` taken as one, strictly between `lo` and `hi`, sorted. */
function gridLines(values: readonly number[], lo: number, hi: number): number[] {
    const out: number[] = [];
    for (const v of [...values].sort((a, b) => a - b)) {
        if (v <= lo + GRID_MERGE_MM || v >= hi - GRID_MERGE_MM) continue;
        if (out.length > 0 && v - out[out.length - 1]! < GRID_MERGE_MM) continue;
        out.push(v);
    }
    return out;
}

/** Whether a wall lies on the line from `a` to `b`, along part of it. */
function onSameLine(w: Wall, a: P2, b: P2): boolean {
    const d = norm2(sub2(b, a));
    const n = { x: -d.y, y: d.x };
    if (
        Math.abs(dot2(sub2(w.a, a), n)) > ON_LINE_MM ||
        Math.abs(dot2(sub2(w.b, a), n)) > ON_LINE_MM
    )
        return false;
    const len = dist2(a, b);
    const t0 = dot2(sub2(w.a, a), d);
    const t1 = dot2(sub2(w.b, a), d);
    return Math.min(Math.max(t0, t1), len) - Math.max(Math.min(t0, t1), 0) > 100;
}

/**
 * Whether `w` lines `v`: in line with it, face to face, along most of its own length, and the
 * thinner of the two (a furring wall against a party wall, a lining inside an exterior wall).
 */
function isLining(w: Wall, v: Wall): boolean {
    if (w.thickness >= v.thickness) return false;
    if (Math.abs(w.dir.x * v.dir.y - w.dir.y * v.dir.x) > 0.02) return false;
    if (w.zHi < v.zLo + 300 || w.zLo > v.zHi - 300) return false;
    const n = { x: -v.dir.y, y: v.dir.x };
    // Between the two walls' middles, across them.
    const mid = (x: Wall) => add2(x.axisA, mul2(x.normal, x.offset + (x.sense * x.thickness) / 2));
    const midB = (x: Wall) => add2(x.axisB, mul2(x.normal, x.offset + (x.sense * x.thickness) / 2));
    const gap = Math.abs(dot2(sub2(mid(w), mid(v)), n));
    if (gap > (w.thickness + v.thickness) / 2 + ON_LINE_MM) return false;
    const t0 = dot2(sub2(mid(w), mid(v)), v.dir);
    const t1 = dot2(sub2(midB(w), mid(v)), v.dir);
    const vLen = dist2(v.axisA, v.axisB);
    const overlap = Math.min(Math.max(t0, t1), vLen) - Math.max(Math.min(t0, t1), 0);
    return overlap >= 0.5 * Math.abs(t1 - t0);
}

function edges(ring: readonly P2[]): [P2, P2][] {
    return ring.map((p, i) => [p, ring[(i + 1) % ring.length]!]);
}

/** The part two edges share, in line and at least 300 mm long, or null. */
function sharedEdge(a: P2, b: P2, c: P2, d: P2): [P2, P2] | null {
    const len = dist2(a, b);
    if (len < 300) return null;
    const u = norm2(sub2(b, a));
    const n = { x: -u.y, y: u.x };
    if (Math.abs(dot2(sub2(c, a), n)) > ON_LINE_MM || Math.abs(dot2(sub2(d, a), n)) > ON_LINE_MM)
        return null;
    const tc = dot2(sub2(c, a), u);
    const td = dot2(sub2(d, a), u);
    const t0 = Math.max(0, Math.min(tc, td));
    const t1 = Math.min(len, Math.max(tc, td));
    if (t1 - t0 < 300) return null;
    return [add2(a, mul2(u, t0)), add2(a, mul2(u, t1))];
}

/**
 * A line in plan that bounds rooms on the storeys of `band`: an exterior wall's, a partition's, a
 * separation's. `w` is the partition it is the line of; `reach` how far an end may be from it and
 * still meet it (`PARTITION_REACH_MM`, more for a party wall, whose faces and linings stand off its line).
 */
interface PlanLine {
    a: P2;
    b: P2;
    band: number[];
    w?: Wall;
    reach?: number;
    /** How far its wall's faces stand off the line at most, its linings' too, mm. */
    across?: number;
}

/** A partition's end taken to the nearest line it runs into within reach, along its own line. */
function snapEnd(end: P2, other: P2, lines: readonly PlanLine[]): P2 {
    const d = norm2(sub2(end, other));
    let best: P2 = end;
    let bestT = Infinity;
    for (const l of lines) {
        const ld = sub2(l.b, l.a);
        const cross = d.x * ld.y - d.y * ld.x;
        if (Math.abs(cross) / Math.hypot(ld.x, ld.y) < 0.5) continue; // nearly parallel
        const q = sub2(l.a, end);
        const t = (q.x * ld.y - q.y * ld.x) / cross;
        const u = (q.x * d.y - q.y * d.x) / cross;
        const len = Math.hypot(ld.x, ld.y);
        if (u * len < -ON_LINE_MM || u * len > len + ON_LINE_MM) continue;
        if (Math.abs(t) > (l.reach ?? PARTITION_REACH_MM)) continue;
        if (Math.abs(t) < Math.abs(bestT)) {
            bestT = t;
            best = add2(end, mul2(d, t));
        }
    }
    return best;
}

/**
 * The stretches of the edge `a`–`b`, 300 mm or longer, that no line of `lines` runs along: none
 * parallel to it as far across as the wall's faces and linings stand off its line (400 mm for a
 * line that is no partition's) — a room's edge is a wall's face, not its line.
 */
function uncovered(a: P2, b: P2, lines: readonly PlanLine[]): [P2, P2][] {
    const len = dist2(a, b);
    if (len < 300) return [];
    const d = norm2(sub2(b, a));
    const n = { x: -d.y, y: d.x };
    const covered = lines
        .filter((l) => {
            const ld = norm2(sub2(l.b, l.a));
            const off = l.across !== undefined ? l.across + 50 : 400;
            return (
                Math.abs(ld.x * d.y - ld.y * d.x) < 0.05 &&
                Math.abs(dot2(sub2(l.a, a), n)) < off &&
                Math.abs(dot2(sub2(l.b, a), n)) < off
            );
        })
        .map((l) => {
            const [t0, t1] = [dot2(sub2(l.a, a), d), dot2(sub2(l.b, a), d)];
            return [Math.max(0, Math.min(t0, t1)), Math.min(len, Math.max(t0, t1))] as const;
        })
        .filter(([t0, t1]) => t1 > t0)
        .sort((x, y) => x[0] - y[0]);
    const out: [P2, P2][] = [];
    let at = 0;
    for (const [t0, t1] of [...covered, [len, len] as const]) {
        if (t0 - at >= 300) out.push([add2(a, mul2(d, at)), add2(a, mul2(d, t0))]);
        at = Math.max(at, t1);
    }
    return out;
}

/**
 * An edge of a room's footprint that runs on from a partition's end, in line with one of its
 * faces, moved across onto the partition's line; else as it is.
 */
function ontoWallLine(edge: [P2, P2], lines: readonly PlanLine[]): [P2, P2] {
    const [p, q] = edge;
    const d = norm2(sub2(q, p));
    const n = { x: -d.y, y: d.x };
    let best: number | null = null;
    for (const l of lines) {
        const w = l.w;
        if (!w || Math.abs(w.dir.x * d.y - w.dir.y * d.x) > 0.02) continue;
        // The wall's own line and ends, not the reach a party wall's lines are given.
        const across = dot2(sub2(w.a, p), n);
        const faces = [w.offset, w.offset + w.sense * w.thickness].map((f) => f - w.lineY);
        const half = Math.max(l.across ?? 0, ...faces.map(Math.abs));
        if (Math.abs(across) > half + ON_LINE_MM) continue;
        const [e0, e1] = [dot2(sub2(w.a, p), d), dot2(sub2(w.b, p), d)];
        const len = dist2(p, q);
        const gap = Math.max(Math.min(e0, e1) - len, -Math.max(e0, e1));
        if (gap < -ON_LINE_MM || gap > PARTITION_REACH_MM) continue;
        if (best === null || Math.abs(across) < Math.abs(best)) best = across;
    }
    if (best === null) return edge;
    const by = mul2(n, best);
    return [add2(p, by), add2(q, by)];
}

/**
 * Every end of `movable` left in the middle of a room — on no other line of its storey — taken
 * to the line it stops short of: along its own line onto one it runs into, or onto the end of
 * one in line with it; or, where it stops on the line of one that ends short of it (a partition
 * on a party wall's line past the party wall's end, two separations set out on two walls' faces
 * a little apart), that one run on to it. The nearest within reach wins. The exterior walls'
 * `fixed` lines are met, never moved.
 */
function closeEnds(movable: PlanLine[], fixed: readonly PlanLine[]): void {
    const onLine = (p: P2, l: PlanLine) => distToSegment(p, l.a, l.b) <= ON_POINT_MM;
    for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (const s of movable) {
            for (const endKey of ['a', 'b'] as const) {
                const end = s[endKey];
                const other = endKey === 'a' ? s.b : s.a;
                const k = s.band[0]!;
                const lines = [...movable, ...fixed].filter((l) => l !== s && l.band.includes(k));
                // On one already: exactly, on its end if it is at one.
                const on = lines.find((l) => onLine(end, l));
                if (on) {
                    s[endKey] =
                        [on.a, on.b].find((q) => dist2(q, end) <= 2 * ON_POINT_MM) ??
                        nearestOnSegment(end, on.a, on.b);
                    continue;
                }
                const d = norm2(sub2(end, other));
                const n = { x: -d.y, y: d.x };
                const found: { cost: number; to: P2; extend?: { l: PlanLine; key: 'a' | 'b' } }[] =
                    [];
                for (const l of lines) {
                    const ld = sub2(l.b, l.a);
                    const len = Math.hypot(ld.x, ld.y);
                    if (len < ON_POINT_MM) continue;
                    const reach = Math.max(
                        s.reach ?? PARTITION_REACH_MM,
                        l.reach ?? PARTITION_REACH_MM
                    );
                    const cross = d.x * ld.y - d.y * ld.x;
                    if (Math.abs(cross) / len < 0.5) {
                        // In line: onto its nearer end, ahead of this one or just short of it.
                        for (const q of [l.a, l.b]) {
                            if (Math.abs(dot2(sub2(q, end), n)) > ON_POINT_MM) continue;
                            const t = dot2(sub2(q, end), d);
                            if (t >= -ON_LINE_MM && t <= reach) found.push({ cost: t, to: q });
                        }
                        continue;
                    }
                    const q = sub2(l.a, end);
                    const t = (q.x * ld.y - q.y * ld.x) / cross;
                    const u = (q.x * d.y - q.y * d.x) / cross;
                    if (Math.abs(t) > reach) continue;
                    const to = add2(end, mul2(d, t));
                    const past = Math.max(-u * len, (u - 1) * len);
                    if (past <= ON_POINT_MM) {
                        found.push({ cost: Math.abs(t), to });
                    } else if (!fixed.includes(l) && past <= (l.reach ?? PARTITION_REACH_MM)) {
                        found.push({
                            cost: Math.abs(t) + past,
                            to,
                            extend: { l, key: u < 0 ? 'a' : 'b' },
                        });
                    }
                }
                const pick = found.sort((x, y) => x.cost - y.cost)[0];
                if (!pick) continue;
                s[endKey] = pick.to;
                if (pick.extend) pick.extend.l[pick.extend.key] = pick.to;
                moved = true;
            }
        }
        if (!moved) break;
    }
}

/** How far apart two loose ends may be and still be joined by a separation of their own, mm. */
const BRIDGE_MM = 300;

/**
 * A separation for each two loose ends left near each other — on no other line of their storey,
 * at least one a separation's: a room's boundary that steps across from a partition's end to a
 * separation set out off its line (Revit's room separation drawn a little beside the wall).
 */
function bridgeEnds(lines: readonly PlanLine[], fixed: readonly PlanLine[]): PlanLine[] {
    const all = [...lines, ...fixed];
    const loose = (p: P2, own: PlanLine) =>
        !all.some(
            (l) => l !== own && l.band.includes(own.band[0]!) && distToSegment(p, l.a, l.b) <= ON_LINE_MM
        );
    const ends = lines.flatMap((l) =>
        [l.a, l.b].filter((p) => loose(p, l)).map((p) => ({ p, l, separation: !l.w }))
    );
    const out: PlanLine[] = [];
    const used = new Set<P2>();
    for (const e of ends) {
        if (!e.separation || used.has(e.p)) continue;
        const near = ends
            .filter((f) => f.l !== e.l && !used.has(f.p) && f.l.band.includes(e.l.band[0]!))
            .map((f) => ({ f, d: dist2(e.p, f.p) }))
            .filter(({ d }) => d > ON_POINT_MM && d <= BRIDGE_MM)
            .sort((x, y) => x.d - y.d)[0];
        if (!near) continue;
        used.add(e.p).add(near.f.p);
        out.push({ a: e.p, b: near.f.p, band: [e.l.band[0]!] });
    }
    return out;
}

// ---- Plan geometry ---------------------------------------------------------------------------------

interface Box3 {
    min: Vec3;
    max: Vec3;
}

function box3(pts: readonly Vec3[]): Box3 | null {
    if (pts.length === 0) return null;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const p of pts) {
        min.x = Math.min(min.x, p.x);
        min.y = Math.min(min.y, p.y);
        min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x);
        max.y = Math.max(max.y, p.y);
        max.z = Math.max(max.z, p.z);
    }
    return { min, max };
}

function add2(a: P2, b: P2): P2 {
    return { x: a.x + b.x, y: a.y + b.y };
}

function sub2(a: P2, b: P2): P2 {
    return { x: a.x - b.x, y: a.y - b.y };
}

function mul2(a: P2, k: number): P2 {
    return { x: a.x * k, y: a.y * k };
}

function dot2(a: P2, b: P2): number {
    return a.x * b.x + a.y * b.y;
}

function dist2(a: P2, b: P2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function norm2(a: P2): P2 {
    const l = Math.hypot(a.x, a.y);
    return l < 1e-12 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
}

function nearestOnSegment(p: P2, a: P2, b: P2): P2 {
    const ab = sub2(b, a);
    const len2 = dot2(ab, ab);
    if (len2 === 0) return a;
    const t = Math.max(0, Math.min(1, dot2(sub2(p, a), ab) / len2));
    return add2(a, mul2(ab, t));
}

function distToSegment(p: P2, a: P2, b: P2): number {
    return dist2(p, nearestOnSegment(p, a, b));
}

/** How far points spread along a direction. */
function spread(pts: readonly Vec3[], d: P2): number {
    const t = pts.map((p) => p.x * d.x + p.y * d.y);
    return Math.max(...t) - Math.min(...t);
}

function signedArea(ring: readonly P2[]): number {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        const q = ring[(i + 1) % ring.length]!;
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
}

function insidePolygon(p: P2, ring: readonly P2[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

/** A point well inside a polygon: of a grid over it, the one farthest from its edges. */
function interiorPoint(ring: readonly P2[]): P2 {
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    let best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    let bestD = -1;
    const n = 24;
    for (let i = 1; i < n; i++) {
        for (let j = 1; j < n; j++) {
            const p = { x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * j) / n };
            if (!insidePolygon(p, ring)) continue;
            let d = Infinity;
            for (let k = 0; k < ring.length; k++) {
                d = Math.min(d, distToSegment(p, ring[k]!, ring[(k + 1) % ring.length]!));
            }
            if (d > bestD) {
                bestD = d;
                best = p;
            }
        }
    }
    return best;
}

/** A partition's build-up in `envelope`, by its kind. */
type PartitionBuildUp = 'interiorWall' | 'lightPartition' | 'heavyPartition' | 'partyWall';

/** The kinds of wall a partition is read as (`Surface.partitionKind`). */
const PARTITION_KINDS: readonly PartitionKind[] = ['light', 'heavy', 'party'];

/** A build-up type's key made from `label`, unique among `kind`'s types in `envelope`. */
function typeKeyFor(envelope: Readonly<Record<string, unknown>>, kind: string, label: string): string {
    const base =
        label
            .toLowerCase()
            .replace(/æ/g, 'ae')
            .replace(/ø/g, 'oe')
            .replace(/å/g, 'aa')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'type';
    let key = base;
    for (let n = 2; `${kind}:${key}` in envelope; n++) key = `${base}-${n}`;
    return key;
}

function unique<T>(xs: readonly T[]): T[] {
    return [...new Set(xs)];
}

/** Of the walls, one of the layer set most of their length has. */
function longestBy(walls: readonly Wall[], key: (w: Wall) => string): Wall | null {
    if (walls.length === 0) return null;
    const total = new Map<string, number>();
    for (const w of walls) total.set(key(w), (total.get(key(w)) ?? 0) + dist2(w.axisA, w.axisB));
    const top = [...total].sort((a, b) => b[1] - a[1])[0]![0];
    return walls.find((w) => key(w) === top)!;
}

/** Of the slabs, one of the kind that covers the most. */
/**
 * How much wall two windows may have between them and still be one coupled window, mm: less than
 * this is no pier that can be built — a sliver of masonry or a stud between two frames — and the
 * frames are joined instead, with a joint or a mullion between them, as a window maker couples
 * them.
 */
export const COUPLE_GAP_MM = 150;
/** How closely two windows' edges have to line up to be coupled, mm. */
const COUPLE_ALIGN_MM = 30;

/** A window as the coupling reads it: on its wall's line, with its extent and division. */
export interface CouplingWindow<T> {
    entry: T;
    line: { a: P2; b: P2 };
    /** Its middle, mm along its line from `line.a`. */
    alongMm: number;
    widthMm: number;
    sillMm: number;
    heightMm: number;
    /** The storey it is on. */
    band: number;
    mullions: number;
    transoms: number;
    /** Whether it was made of more than one. */
    coupled?: boolean;
}

/**
 * Windows on one wall and storey with less than `COUPLE_GAP_MM` of wall between them, as one
 * window each: two stacked over each other, as wide and in line, coupled by a transom; two beside
 * each other, as high and level, by a mullion. Pairs are joined until none is left to join, so a
 * column of three becomes one window of three panes. Only where the panes come out equal: a
 * window's division is even (`OpeningGlazing`), so a narrow window beside a wide one is left as
 * two, and `tooClose` lists them.
 */
export function coupleWindows<T>(windows: readonly CouplingWindow<T>[]): CouplingWindow<T>[] {
    const out = windows.map((w) => ({ ...w }));
    const near = (x: number, y: number) => Math.abs(x - y) <= COUPLE_ALIGN_MM;
    // Panes are as large within a tenth: a joined pair's panes have the joint between them in.
    const samePane = (x: number, y: number) =>
        Math.abs(x - y) <= Math.max(COUPLE_ALIGN_MM, 0.1 * Math.max(x, y));
    const sameLine = (p: CouplingWindow<T>, q: CouplingWindow<T>) =>
        p.line === q.line ||
        (near(p.line.a.x, q.line.a.x) &&
            near(p.line.a.y, q.line.a.y) &&
            near(p.line.b.x, q.line.b.x) &&
            near(p.line.b.y, q.line.b.y));
    const join = (p: CouplingWindow<T>, q: CouplingWindow<T>): CouplingWindow<T> | null => {
        if (p.band !== q.band || !sameLine(p, q)) return null;
        // Stacked: in line and as wide, one over the other, their panes as high.
        if (near(p.alongMm, q.alongMm) && near(p.widthMm, q.widthMm)) {
            const [lo, hi] = p.sillMm <= q.sillMm ? [p, q] : [q, p];
            const gap = hi.sillMm - (lo.sillMm + lo.heightMm);
            if (gap < -COUPLE_ALIGN_MM || gap >= COUPLE_GAP_MM) return null;
            if (!samePane(p.heightMm / (p.transoms + 1), q.heightMm / (q.transoms + 1))) {
                return null;
            }
            return {
                ...lo,
                widthMm: Math.max(p.widthMm, q.widthMm),
                heightMm: hi.sillMm + hi.heightMm - lo.sillMm,
                mullions: Math.max(p.mullions, q.mullions),
                transoms: p.transoms + q.transoms + 1,
                coupled: true,
            };
        }
        // Side by side: level and as high, one beside the other.
        if (near(p.sillMm, q.sillMm) && near(p.heightMm, q.heightMm)) {
            const [lo, hi] = p.alongMm <= q.alongMm ? [p, q] : [q, p];
            const gap = hi.alongMm - hi.widthMm / 2 - (lo.alongMm + lo.widthMm / 2);
            if (gap < -COUPLE_ALIGN_MM || gap >= COUPLE_GAP_MM) return null;
            if (!samePane(p.widthMm / (p.mullions + 1), q.widthMm / (q.mullions + 1))) {
                return null;
            }
            const from = lo.alongMm - lo.widthMm / 2;
            const to = hi.alongMm + hi.widthMm / 2;
            return {
                ...lo,
                alongMm: (from + to) / 2,
                widthMm: to - from,
                heightMm: Math.max(p.heightMm, q.heightMm),
                mullions: p.mullions + q.mullions + 1,
                transoms: Math.max(p.transoms, q.transoms),
                coupled: true,
            };
        }
        return null;
    };
    for (let joined = true; joined;) {
        joined = false;
        outer: for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                const both = join(out[i]!, out[j]!);
                if (!both) continue;
                out[i] = both;
                out.splice(j, 1);
                joined = true;
                break outer;
            }
        }
    }
    return out;
}

/**
 * Pairs of windows on one wall and storey with less than `COUPLE_GAP_MM` of wall between them,
 * side by side or stacked, that `coupleWindows` could not join: the wall between them, mm.
 */
export function tooClose<T>(windows: readonly CouplingWindow<T>[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
            const p = windows[i]!;
            const q = windows[j]!;
            if (p.band !== q.band || p.line !== q.line) continue;
            const across = Math.abs(p.alongMm - q.alongMm) - (p.widthMm + q.widthMm) / 2;
            const up =
                Math.max(p.sillMm, q.sillMm) -
                Math.min(p.sillMm + p.heightMm, q.sillMm + q.heightMm);
            // Beside each other where they overlap in height; over each other where in width.
            const gap = up < 0 ? across : across < 0 ? up : Infinity;
            if (gap >= 0 && gap < COUPLE_GAP_MM) out.push(Math.round(gap));
        }
    }
    return out;
}

/** What a floor or a roof is, by its core: hollow-core slabs, concrete cast in place, or timber. */
function slabStructure(core: IfcLayer | undefined): FloorStructure {
    if (!core) return 'timber';
    const r = matchMaterial(core.material);
    if (r.role !== 'heavy') return 'timber';
    return r.materialId === 'hollow-core' ? 'hollow-core' : 'cast-concrete';
}

function largestBy<T extends { area: number }>(xs: readonly T[], key: (x: T) => string): T {
    const total = new Map<string, number>();
    for (const x of xs) total.set(key(x), (total.get(key(x)) ?? 0) + x.area);
    const top = [...total].sort((a, b) => b[1] - a[1])[0]![0];
    return xs.find((x) => key(x) === top)!;
}
