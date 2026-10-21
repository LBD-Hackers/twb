/**
 * The house file: what a TWB tool saves and opens. It is written `twb/1` — JSON-LD in the TWB
 * ontology (`house-jsonld.ts`) — and read as the plain JSON shape below, `arch/1`, which is what
 * `fromTwbHouse` turns a `twb/1` document into. **Deliberately the simplest thing that round-trips
 * a `Surface`**, because the file is meant to be written by hand, by a script, or by a multimodal
 * language model reading a plan and a section off a drawing:
 *
 * - One concept: a face is a list of `[x, y, z]` corners in millimetres, Z up. That is all a
 *   house is. Walls, floors and roofs are not separate types; they are read off the geometry
 *   (`surfacekit/model/classify.ts`), so the writer never has to decide.
 * - A face is the **reference plane of the structure** — through the middle of a timber frame's
 *   studs, joists or rafters, or of a masonry wall's inner leaf — before insulation and cladding.
 *   The file carries no wall thickness and no finishes: 7200 × 9600 means the frame's
 *   centrelines are 7200 apart. A wall of two leaves that carry — a party wall — stands on one of
 *   them: on the outline its own dwelling's, between two rooms the one with the other on its back.
 * - A partition's build-up runs from its **positive side** — the way its normal points: to the
 *   right looking along it towards +X, or +Y for a wall along Y (`surfaceFrame`) — across its core
 *   to its back, so the layers past the core lie on its back. An exterior wall's runs from the
 *   room's side out.
 * - Openings are the same concept again: four corners lying on the face.
 * - A house can also be written in a simpler shape still (`simple-house.ts`): `walls` as plan
 *   lines, a `wallHeightMm`, `openings` by their centre and size, and a `roof` by its type and
 *   pitch. It is expanded into faces before anything else here reads the file.
 * - Nothing is required except the corners. `id` is minted if missing, and the tuning fields
 *   (`kind`, `loadBearing`, ...) are written only when they differ from the default.
 * - `guides` are loose two-point lines; `lines` are the same shape with a `role` — `column` or
 *   `beam` — and are timber, not construction lines: a pergola, a carport, a porch canopy. A
 *   column may be given in plan by its centre `at`, a beam by its two `[x, y]` ends, both on a
 *   `storey` and up to its height (`readLines`). Save writes the ends.
 * - `storeys` — name, elevation and height. Left out, one is made from the geometry's extent.
 * - `interiorWalls` — partitions as plan polylines on the storey they start on, built into wall
 *   faces once the rest has loaded (`load.ts`'s `buildInteriorWalls`).
 * - A wall that is another kind than the house's own partition says so with `partition`, on its
 *   face or on its `interiorWalls` run: `"light"` (a partition of studs), `"heavy"` (of masonry)
 *   or `"party"` (a party wall between two dwellings). Its build-up is the kind's in `envelope`
 *   (`lightPartition`, `heavyPartition`, `partyWall`). A face dressed in one more build-up of its
 *   kind — the bathrooms' plumbing walls — says so with `buildUpType`: the id of that build-up in
 *   `envelope`, `"<kind>:<key>"` (`"interiorWall:plumbing"`). Left out, a partition is the house's
 *   own (`interiorWall`); a pin to a build-up the file does not have is reported and left out.
 * - `zones` — rooms: a name, a room kind, the storey, and one `[x, y]` point inside the room. The
 *   room itself is found around that point from the walls and the `zoneSeparations` (plan lines
 *   dividing two zones where there is no wall), so a file never carries an outline that could
 *   disagree with its own geometry.
 *
 * **What this parser reads, and what it passes on.** It reads the blueprint's geometry — the
 * surfaces and their openings, guides and lines, storeys, partitions, rooms and separations —
 * into `@surfacekit/model`'s types. Everything else a house file may say — build-ups (`envelope`),
 * the joints at edges, the joint and opening standards, the expression, the building use and the
 * blocks a tool keeps for itself (`heating`, `cabinet`, …) — is the business of the tool that
 * derives a building from the blueprint. It is handed on untouched as `settings`, and written back
 * as it came by `serializeHouseFile`, so a file opened, edited and saved here loses none of it.
 *
 * Parsing is strict about *shape* (every corner must be three finite numbers) and says exactly
 * where it is not, since the reader of that message may be the language model that wrote the
 * file. Whether the geometry is admissible — planar, big enough, an opening inside its face — is
 * the store's business (`SurfaceStore`), checked on load.
 *
 * Pure: no DOM, no three.js.
 */

import type { Point3Mm, Vec2Mm } from '../surfacekit/core';
import {
    DOOR_LEAVES,
    OPENING_KINDS,
    PARTITION_KINDS,
    SURFACE_KINDS,
    openingFromRing3,
    openingRing3,
    surfaceFrame,
    isDividedGlazing,
    DEFAULT_STOREY_HEIGHT_MM,
    DEFAULT_WALL_HEIGHT_MM,
    lowestWallTopInStorey,
    sortStoreys,
    type DoorLeaves,
    type OpeningGlazing,
    type OpeningKind,
    type PartitionKind,
    type Surface,
    type SurfaceKind,
    type SurfaceOpening,
    type Guide,
    type GuideRole,
    type Storey,
    type Zone,
    type ZoneSeparation,
} from '../surfacekit/model';
import { expandSimpleHouse, isSimpleHouse, type InteriorOpening } from './simple-house';
import { TWB_HOUSE_FORMAT, fromTwbHouse, toTwbHouse } from './house-jsonld';

/**
 * The house file's original format: still read, no longer written. Save writes `twb/1`, the same
 * model as JSON-LD (`house-jsonld.ts`); `HouseFile` below is the arch/1 shape both are read as.
 */
export const HOUSE_FILE_FORMAT = 'arch/1';

/** The formats a house file can be read from. */
export type HouseFileFormat = typeof HOUSE_FILE_FORMAT | typeof TWB_HOUSE_FORMAT;

/** Whether `format` is one a house file is read from. */
export function isHouseFileFormat(format: unknown): format is HouseFileFormat {
    return format === TWB_HOUSE_FORMAT || format === HOUSE_FILE_FORMAT;
}

/**
 * What a house file is called: `.twb` says which format it is, the way `.gltf` and `.geojson` do,
 * and `.jsonld` keeps editors and JSON-LD tools reading it as what it is.
 */
export const HOUSE_FILE_NAME = 'house.twb.jsonld';

/** The media type a house file is served and downloaded as. */
export const HOUSE_FILE_MEDIA_TYPE = 'application/ld+json';

/** The longest project name kept, characters. */
const MAX_PROJECT_NAME = 120;

/** A project name as the file gives it: trimmed, and null when it gives none. */
export function projectNameOf(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const name = raw.trim().slice(0, MAX_PROJECT_NAME);
    return name.length > 0 ? name : null;
}

/**
 * What a project's files are called before their extension: its name with what no file system
 * takes left out and the spaces as dashes — `Villa Nord` saves as `Villa-Nord.twb.jsonld` — and
 * `house` for a project with no name.
 */
export function projectFileBase(name: string | null): string {
    const base = (name ?? '')
        .normalize('NFC')
        .replace(/[\\/:*?"<>|]+/g, '')
        .replace(/\p{Cc}+/gu, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/^\.+/, '');
    return base.length > 0 ? base : 'house';
}

/** The file a project is saved as. */
export function houseFileName(name: string | null): string {
    return `${projectFileBase(name)}.twb.jsonld`;
}

/** `[x, y, z]`, integer millimetres, model frame (Z up). */
export type FilePoint = [number, number, number];

export interface FileSurface {
    /** Optional; `s<n>`. Minted on load when absent. */
    id?: string;
    /** The planar outline, three or more corners, not repeated at the end. */
    points: FilePoint[];
    /** Rectangular openings, each as its four corners lying on the face. */
    openings?: FilePoint[][];
    /** Door swings, one per entry of `openings` (null for a window or a plain door). */
    openingSwings?: (FileDoorSwing | null)[];
    /**
     * What fills each entry of `openings`: `"window"`, `"door"` or `"garage-door"`. Left out, an
     * opening standing on the face's foot is a door and any other a window.
     */
    openingKinds?: OpeningKind[];
    /** Each opening's own finish where it is not its kind's standard — a detail id, or null. */
    openingDetails?: (string | null)[];
    /** Each opening's own lintel where it is not the house's — a lintel id, or null. */
    openingLintels?: (string | null)[];
    /** How each opening is divided — mullions, transoms, glazing bars — or null for one pane. */
    openingGlazing?: (FileGlazing | null)[];
    /** Inner rings — loops drawn strictly inside the face, each three or more corners on its plane. */
    holes?: FilePoint[][];
    /** Pins what the face is. Omit to let the geometry decide (the normal case). */
    kind?: SurfaceKind;
    /** Omit for Auto: whether the wall carries load is left to the tool that frames it. */
    loadBearing?: boolean;
    /** Plan direction the roof's rafters or floor's joists span, for a flat or square roof. */
    spanDirection?: [number, number];
    /** Faces of one roof share a name, so a dormer is not framed as part of the main roof. */
    roofGroup?: string;
    /** A stud section pinned for this one wall — a catalogue id. Omit for Auto. */
    studSection?: string;
    /** The kind of wall this one is, where it is not the house's own partition. */
    partition?: PartitionKind;
    /** The build-up type it is dressed in — an `envelope` id, `"interiorWall:plumbing"`. */
    buildUpType?: string;
}

/** A door that is not the plain one: hinged on its far jamb, opening to the back, more leaves. */
export interface FileDoorSwing {
    hingeAtEnd?: boolean;
    swingsBack?: boolean;
    /** `'one-and-a-half'` or `'double'`; absent is a single leaf. */
    leaves?: DoorLeaves;
}

/** An opening's division: `{ "mullions": 1, "panes": [2, 3] }`. */
export interface FileGlazing {
    mullions?: number;
    transoms?: number;
    panes?: [number, number];
}

export interface FileStorey {
    /** Optional; `st<n>`. Minted on load when absent. */
    id?: string;
    name: string;
    elevationMm: number;
    heightMm: number;
}

/** A partition run, read straight off the plan: its corners and the storey it starts on. */
export interface FileInteriorWall {
    /** A `storeys[].name` to start the run on. Omit for the lowest storey. */
    storey?: string;
    /** The run's corners in plan, `[x, y]` millimetres. Two or more. */
    points: [number, number][];
    /** Whether the run carries load; left out, Auto. */
    loadBearing?: boolean;
    /** The kind of wall the run is (`FileSurface.partition`); left out, the house's own partition. */
    partition?: PartitionKind;
    /** The build-up type the run is dressed in (`FileSurface.buildUpType`). Omit for its kind's own. */
    buildUpType?: string;
}

/** A room: what it is for, and a point inside it. */
export interface FileZone {
    /** Optional; `z<n>`. Minted on load when absent. */
    id?: string;
    name: string;
    /** A room-kind id — `living`, `bedroom`, `kitchen`, `bathroom`, … */
    kind: string;
    /** A `storeys[].id`, or failing that a `storeys[].name`. Omit for the lowest storey. */
    storey?: string;
    /** `[x, y]` in millimetres, anywhere inside the room. */
    point: [number, number];
    /** `flat` (absent), `open` to the floor above or the roof, or `lowered` to `ceilingMm`. */
    ceiling?: 'flat' | 'open' | 'lowered';
    /** A lowered ceiling's height, mm above its storey's floor. */
    ceilingMm?: number;
}

/** A line dividing two zones where there is no wall, as a plan polyline on one storey. */
export interface FileZoneSeparation {
    /** A `storeys[].id` or `.name`. Omit for the lowest storey. */
    storey?: string;
    /** Two or more `[x, y]` corners in millimetres. */
    points: [number, number][];
}

/** A line that is a piece of timber: its two ends and what it is. */
export interface FileLine {
    points: [FilePoint, FilePoint];
    role: GuideRole;
}

/** One layer of a build-up. `members` makes it inhomogeneous: timber of `width` every `cc`. */
export interface FileEnvelopeLayer {
    material: string;
    /** mm */
    thickness: number;
    members?: { material: string; width: number; cc: number; run?: 'along' };
    /** The structural layer. Exactly one per build-up. */
    core?: true;
    cladding?: {
        pattern: string;
        boardWidth: number;
        boardThickness: number;
        overlap: number;
        stripWidth?: number;
        stripThickness?: number;
        fixedSpacing?: true;
    };
    taper?: { fall: number };
    masonry?: { bond: string };
    ties?: { perM2: number; diameter: number };
}

/** A build-up (a TWB recipe): its layers inside → outside. */
export interface FileAssembly {
    /** A build-up type's name, as its source had it: `"Interior - Plumbing (152mm Stud)"`. */
    name?: string;
    /** `exterior` (default), `ground` or `unheated`. */
    boundary?: string;
    airGapLevel?: number;
    layers: FileEnvelopeLayer[];
}

/**
 * A layer's cut at an edge: `"miter"`, `"overhang"`, the index of the other face's layer boundary
 * it ends on, or a line drawn across the section. `null` is the house's standard.
 */
export type FileLayerCut = string | number | { atMm: number; perMm: number } | null;

/** One edge's own joint, keyed by its two face ids joined by `|`. */
export interface FileEdgeJoint {
    edge: string;
    cuts: Record<string, FileLayerCut[]>;
    trims?: FileTrim[];
    boards?: 'break';
}

/** One trim of a joint: a material and its cross-section in the edge's own frame, mm. */
export interface FileTrim {
    material: string;
    profile: [number, number][];
    repeat?: { width: number; cc: number; inset: number };
}

/** A joint kept as the standard for every edge of its kind, between two recipes. */
export interface FileJointTemplate {
    type: string;
    inside?: true;
    first: string;
    second: string;
    firstCuts: FileLayerCut[];
    secondCuts: FileLayerCut[];
    trims?: FileTrim[];
}

/** The roof's overhangs, mm: the house's per kind of edge, and any edge's own. */
export interface FileRoofOverhang {
    eavesMm?: number;
    vergeMm?: number;
    edges?: Record<string, number>;
}

/** A JSON object a tool keeps for itself; this package passes it on as it stands. */
export type FileBlock = Record<string, unknown>;

/**
 * A house file in the arch/1 shape. The geometry is typed in full; the construction (build-ups,
 * joints, standards) is typed as the format has it; the blocks a tool keeps for itself are
 * `FileBlock`s.
 */
export interface HouseFile {
    format: typeof HOUSE_FILE_FORMAT;
    name?: string;
    /** Free text — the source drawing, the assumptions a reader made, anything. */
    notes?: string;
    surfaces: FileSurface[];
    guides?: [FilePoint, FilePoint][];
    lines?: FileLine[];
    storeys?: FileStorey[];
    interiorWalls?: FileInteriorWall[];
    zones?: FileZone[];
    zoneSeparations?: FileZoneSeparation[];
    /** The fixed fittings in the rooms: `{ kind, storey, at, size?, facing? }`. */
    fixtures?: (FileBlock & { kind: string })[];
    /** The sections the drawing set draws: `{ name, line, inDocumentation? }`. */
    sections?: FileBlock[];
    /** Build-ups that differ from the default recipe, by assembly (`wall`, `roof`, `floor`, …). */
    envelope?: Record<string, FileAssembly>;
    edgeJoints?: FileEdgeJoint[];
    roofOverhang?: FileRoofOverhang;
    underFloorC?: number;
    /** The standard joint per kind of edge: `{ "eave": "roof-through" }`. */
    envelopeJointStandards?: Record<string, string>;
    envelopeJointTemplates?: FileJointTemplate[];
    /** The standard finish per kind of opening: `{ "window": "head-sill-boards" }`. */
    openingDetails?: Record<string, string>;
    framingRules?: { choices?: Record<string, string>; params?: Record<string, number> };
    structuralLoads?: { liveKnPerM2?: number; snowKnPerM2?: number; windKnPerM2?: number };
    sawnGradeId?: string;
    consequenceClass?: string;
    buildingUse?: string;
    constructionSystem?: string;
    floorStructure?: string;
    roofStructure?: string;
    expression?: { id: string; facade?: string; roof?: string; gutter?: string; openings?: string };
    roofLoad?: string;
    ifcScope?: string;
    nodeRules?: { edges: [string, string]; through: string }[];
    cabinet?: FileBlock;
    heating?: FileBlock;
    water?: FileBlock;
    lca?: FileBlock;
    foundation?: FileBlock;
    splices?: FileBlock;
    cutting?: FileBlock;
}

/** A parsed, shape-checked `FileInteriorWall`, ready to build once the model is loaded. */
export interface ParsedInteriorWall {
    /** Null means "the lowest storey" — what an omitted `storey` resolves to. */
    storeyName: string | null;
    pointsMm: Vec2Mm[];
    /** Null for Auto. */
    loadBearing: boolean | null;
    /** Null for the house's own partition. */
    partitionKind: PartitionKind | null;
    /** Null for its kind's own build-up. */
    buildUpType: string | null;
}

export interface ParseResult {
    surfaces: Surface[];
    guides: Guide[];
    storeys: Storey[];
    interiorWalls: ParsedInteriorWall[];
    /** The simple shape's openings that stand in a partition, to cut once it is built. */
    interiorOpenings: InteriorOpening[];
    zones: Zone[];
    zoneSeparations: ZoneSeparation[];
    /** Per opening id, its own finish as the file gave it (`FileSurface.openingDetails`). */
    openingDetails: Map<string, string>;
    /** Per opening id, its own lintel as the file gave it (`FileSurface.openingLintels`). */
    openingLintels: Map<string, string>;
    /**
     * Everything else the file says, in the arch/1 shape and untouched: the construction and
     * the blocks a tool keeps for itself. `serializeHouseFile` writes it back as it came.
     */
    settings: Record<string, unknown>;
    /** The project's name, or null when the file gives none. */
    name: string | null;
    notes: string | null;
    /** `twb/1`, `arch/1`, or null when the file says neither. */
    format: HouseFileFormat | null;
    /** Human-readable, one per problem, each naming where in the file it is. */
    errors: string[];
}

/** The keys this parser reads into geometry; every other key is a setting, passed on. */
const GEOMETRY_KEYS = new Set([
    'format',
    'name',
    'notes',
    'surfaces',
    'guides',
    'lines',
    'storeys',
    'interiorWalls',
    'zones',
    'zoneSeparations',
    // The simple shape: input only, written back as the faces it became.
    'walls',
    'wallHeightMm',
    'roof',
    'openings',
]);

const toFilePoint = (p: Point3Mm): FilePoint => [p.x, p.y, p.z];
const toPoint = (p: FilePoint): Point3Mm => ({ x: p[0], y: p[1], z: p[2] });

function emptyResult(errors: string[], more: Partial<ParseResult> = {}): ParseResult {
    return {
        surfaces: [],
        guides: [],
        storeys: [],
        interiorWalls: [],
        interiorOpenings: [],
        zones: [],
        zoneSeparations: [],
        openingDetails: new Map(),
        openingLintels: new Map(),
        settings: {},
        name: null,
        notes: null,
        format: null,
        errors,
        ...more,
    };
}

/** A house file, `twb/1` or `arch/1`, as text or as parsed JSON. */
export function parseHouseFile(input: string | Record<string, unknown>): ParseResult {
    const errors: string[] = [];
    let raw: unknown = input;
    if (typeof input === 'string') {
        try {
            raw = JSON.parse(input);
        } catch (e) {
            return emptyResult([`Not JSON: ${(e as Error).message}`]);
        }
    }
    if (!isRecord(raw)) return emptyResult(['The file must be a JSON object.']);
    // A twb/1 file is read as the arch/1 shape it maps onto (`house-jsonld.ts`).
    const format: HouseFileFormat | null =
        raw['format'] === TWB_HOUSE_FORMAT
            ? TWB_HOUSE_FORMAT
            : raw['format'] === HOUSE_FILE_FORMAT
              ? HOUSE_FILE_FORMAT
              : null;
    const json = format === TWB_HOUSE_FORMAT ? fromTwbHouse(raw) : raw;
    if (format === null) {
        errors.push(
            `"format" must be "${TWB_HOUSE_FORMAT}" (got ${JSON.stringify(json['format'])}).`
        );
    }
    const notes = typeof json['notes'] === 'string' ? json['notes'] : null;
    const name = projectNameOf(json['name']);
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(json)) if (!GEOMETRY_KEYS.has(k)) settings[k] = v;

    // The simple shape — walls as lines, a roof by type and pitch — becomes faces first, and
    // joins whatever faces the file also lists (`simple-house.ts`).
    const simple = isSimpleHouse(json);
    const listed = json['surfaces'];
    const expanded =
        simple && (listed === undefined || Array.isArray(listed))
            ? expandSimpleHouse(json, errors)
            : null;
    const list = expanded
        ? [...((listed as unknown[] | undefined) ?? []), ...expanded.faces]
        : listed;
    const interiorOpenings = expanded?.interiorOpenings ?? [];
    if (!Array.isArray(list)) {
        errors.push('"surfaces" must be an array.');
        return emptyResult(errors, { settings, name, notes, format });
    }

    const surfaces: Surface[] = [];
    const openingDetails = new Map<string, string>();
    const openingLintels = new Map<string, string>();
    const seen = new Set<string>();
    let minted = 0;
    const mint = (): string => {
        let id: string;
        do id = `s${++minted}`;
        while (seen.has(id));
        return id;
    };

    list.forEach((raw, i) => {
        const where = `surfaces[${i}]`;
        if (!isRecord(raw)) {
            errors.push(`${where} must be an object.`);
            return;
        }
        const points = readRing(raw['points'], `${where}.points`, errors);
        if (!points) return;

        let id = typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : mint();
        if (seen.has(id)) {
            errors.push(`${where}.id "${id}" is used twice; the second was renamed.`);
            id = mint();
        }
        seen.add(id);

        const surface: Surface = {
            id,
            boundaryMm: points,
            openings: [],
            holes: [],
            kindOverride: null,
            loadBearing: typeof raw['loadBearing'] === 'boolean' ? raw['loadBearing'] : null,
            spanDirectionOverride: null,
            roofGroupId: typeof raw['roofGroup'] === 'string' ? raw['roofGroup'] : null,
            studSectionOverride: typeof raw['studSection'] === 'string' ? raw['studSection'] : null,
        };
        const partition = readPartitionKind(raw['partition'], `${where}.partition`, errors);
        if (partition) surface.partitionKind = partition;
        const buildUpType = readBuildUpTypePin(raw['buildUpType'], `${where}.buildUpType`, errors);
        if (buildUpType) surface.buildUpType = buildUpType;

        const kind = raw['kind'];
        if (kind !== undefined) {
            if (SURFACE_KINDS.includes(kind as SurfaceKind))
                surface.kindOverride = kind as SurfaceKind;
            else errors.push(`${where}.kind must be one of ${SURFACE_KINDS.join(', ')}.`);
        }
        const span = raw['spanDirection'];
        if (span !== undefined) {
            if (Array.isArray(span) && span.length === 2 && span.every(isFiniteNumber)) {
                surface.spanDirectionOverride = { x: span[0] as number, y: span[1] as number };
            } else errors.push(`${where}.spanDirection must be [x, y].`);
        }

        const holes = raw['holes'];
        if (holes !== undefined) {
            if (!Array.isArray(holes)) {
                errors.push(`${where}.holes must be an array of rings.`);
            } else {
                holes.forEach((h, j) => {
                    const ring = readRing(h, `${where}.holes[${j}]`, errors);
                    if (ring) surface.holes = [...surface.holes, ring];
                });
            }
        }

        const openings = raw['openings'];
        if (openings !== undefined) {
            if (!Array.isArray(openings)) {
                errors.push(`${where}.openings must be an array of four-corner rectangles.`);
            } else {
                const frame = surfaceFrame(points);
                const arrayOf = (key: string): unknown[] =>
                    Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [];
                const swings = arrayOf('openingSwings');
                const kinds = arrayOf('openingKinds');
                const details = arrayOf('openingDetails');
                const lintels = arrayOf('openingLintels');
                const glazings = arrayOf('openingGlazing');
                openings.forEach((o, j) => {
                    const at = `${where}.openings[${j}]`;
                    const ring = readRing(o, at, errors);
                    if (!ring) return;
                    const geometry =
                        frame &&
                        openingFromRing3(frame, ring, `${id}h${surface.openings.length + 1}`);
                    if (!geometry) {
                        errors.push(`${at} must be an axis-aligned rectangle lying on the face.`);
                        return;
                    }
                    const stated = kinds[j];
                    if (stated !== undefined && !OPENING_KINDS.includes(stated as OpeningKind)) {
                        errors.push(
                            `${where}.openingKinds[${j}] must be one of ${OPENING_KINDS.join(', ')}.`
                        );
                    }
                    const kind: OpeningKind = OPENING_KINDS.includes(stated as OpeningKind)
                        ? (stated as OpeningKind)
                        : geometry.vMm === 0
                          ? 'door'
                          : 'window';
                    const hole: SurfaceOpening = { ...geometry, kind };
                    const swing = swings[j];
                    if (swing && typeof swing === 'object') {
                        const { hingeAtEnd, swingsBack, leaves } = swing as Record<string, unknown>;
                        if (hingeAtEnd === true) hole.hingeAtEnd = true;
                        if (swingsBack === true) hole.swingsBack = true;
                        if (leaves !== undefined && leaves !== 'single') {
                            if (DOOR_LEAVES.includes(leaves as DoorLeaves)) {
                                hole.leaves = leaves as DoorLeaves;
                            } else {
                                errors.push(
                                    `${where}.openingSwings[${j}].leaves must be one of ${DOOR_LEAVES.join(', ')}.`
                                );
                            }
                        }
                    }
                    const glazing = readGlazing(
                        glazings[j],
                        `${where}.openingGlazing[${j}]`,
                        errors
                    );
                    if (glazing) hole.glazing = glazing;
                    // Which finishes and lintels exist is the deriving tool's catalogue: kept as given.
                    if (typeof details[j] === 'string') openingDetails.set(hole.id, details[j]);
                    if (typeof lintels[j] === 'string') openingLintels.set(hole.id, lintels[j]);
                    surface.openings = [...surface.openings, hole];
                });
            }
        }
        surfaces.push(surface);
    });

    const guides: Guide[] = [];
    const rawGuides = json['guides'];
    if (rawGuides !== undefined) {
        if (!Array.isArray(rawGuides)) {
            errors.push('"guides" must be an array of two-point lines.');
        } else {
            rawGuides.forEach((raw, i) => {
                const where = `guides[${i}]`;
                if (!Array.isArray(raw) || raw.length !== 2) {
                    errors.push(`${where} must be two [x, y, z] points.`);
                    return;
                }
                const ends = raw.map((p, k) => readPoint(p, `${where}[${k}]`, errors));
                if (ends[0] && ends[1]) {
                    guides.push({ id: `g${guides.length + 1}`, aMm: ends[0], bMm: ends[1] });
                }
            });
        }
    }

    const storeys: Storey[] = [];
    const rawStoreys = json['storeys'];
    if (rawStoreys !== undefined) {
        if (!Array.isArray(rawStoreys)) {
            errors.push('"storeys" must be an array.');
        } else {
            const storeyIds = new Set<string>();
            rawStoreys.forEach((raw, i) => {
                const where = `storeys[${i}]`;
                if (!isRecord(raw)) {
                    errors.push(`${where} must be an object.`);
                    return;
                }
                const name =
                    typeof raw['name'] === 'string' && raw['name']
                        ? raw['name']
                        : `Storey ${i + 1}`;
                const elevationMm = raw['elevationMm'];
                const heightMm = raw['heightMm'];
                if (!isFiniteNumber(elevationMm) || !isFiniteNumber(heightMm)) {
                    errors.push(`${where}.elevationMm and .heightMm must be numbers.`);
                    return;
                }
                let id =
                    typeof raw['id'] === 'string' && raw['id']
                        ? raw['id']
                        : `st${storeys.length + 1}`;
                if (storeyIds.has(id)) id = `st${storeys.length + 1}`;
                storeyIds.add(id);
                storeys.push({
                    id,
                    name,
                    elevationMm: Math.round(elevationMm),
                    heightMm: Math.round(heightMm),
                });
            });
        }
    }
    // No storeys authored: one storey spanning whatever the geometry covers, so a file written
    // without the concept still opens and shows.
    if (storeys.length === 0) {
        const zs = surfaces.flatMap((s) => s.boundaryMm.map((p) => p.z));
        const elevationMm = zs.length > 0 ? Math.min(...zs) : 0;
        const heightMm =
            zs.length > 0
                ? Math.max(DEFAULT_STOREY_HEIGHT_MM, Math.max(...zs) - elevationMm)
                : DEFAULT_STOREY_HEIGHT_MM;
        storeys.push({ id: 'st1', name: 'Ground floor', elevationMm, heightMm });
    }
    // After the storeys, because a column or a beam given in plan stands on one of them.
    guides.push(...readLines(json, storeys, rawStoreys === undefined, guides.length, errors));

    const interiorWalls: ParsedInteriorWall[] = [];
    const rawInteriorWalls = json['interiorWalls'];
    if (rawInteriorWalls !== undefined) {
        if (!Array.isArray(rawInteriorWalls)) {
            errors.push('"interiorWalls" must be an array.');
        } else {
            rawInteriorWalls.forEach((raw, i) => {
                const where = `interiorWalls[${i}]`;
                if (!isRecord(raw)) {
                    errors.push(`${where} must be an object.`);
                    return;
                }
                const storeyName =
                    typeof raw['storey'] === 'string' && raw['storey'] ? raw['storey'] : null;
                const rawPoints = raw['points'];
                if (!Array.isArray(rawPoints) || rawPoints.length < 2) {
                    errors.push(`${where}.points must be an array of at least two [x, y] corners.`);
                    return;
                }
                const pointsMm: Vec2Mm[] = [];
                for (let k = 0; k < rawPoints.length; k++) {
                    const p = readPoint2(rawPoints[k], `${where}.points[${k}]`, errors);
                    if (!p) return;
                    pointsMm.push(p);
                }
                const loadBearing = raw['loadBearing'];
                if (loadBearing !== undefined && typeof loadBearing !== 'boolean') {
                    errors.push(`${where}.loadBearing must be true or false — left on Auto.`);
                }
                interiorWalls.push({
                    storeyName,
                    pointsMm,
                    loadBearing: typeof loadBearing === 'boolean' ? loadBearing : null,
                    partitionKind: readPartitionKind(
                        raw['partition'],
                        `${where}.partition`,
                        errors
                    ),
                    buildUpType: readBuildUpTypePin(
                        raw['buildUpType'],
                        `${where}.buildUpType`,
                        errors
                    ),
                });
            });
        }
    }

    // A pin to a build-up the file does not have is no pin: the face is its kind's own.
    const envelope = isRecord(json['envelope']) ? json['envelope'] : {};
    surfaces.forEach((s, i) => {
        if (s.buildUpType && !(s.buildUpType in envelope)) {
            errors.push(
                `surfaces[${i}].buildUpType ${JSON.stringify(s.buildUpType)} is not a build-up in ` +
                    '"envelope" — dressed in its kind\'s own.'
            );
            delete s.buildUpType;
        }
    });
    interiorWalls.forEach((w, i) => {
        if (w.buildUpType && !(w.buildUpType in envelope)) {
            errors.push(
                `interiorWalls[${i}].buildUpType ${JSON.stringify(w.buildUpType)} is not a build-up in ` +
                    '"envelope" — dressed in its kind\'s own.'
            );
            w.buildUpType = null;
        }
    });

    const zones = readZones(json['zones'], storeys, surfaces, errors);
    const zoneSeparations = readZoneSeparations(json['zoneSeparations'], storeys, errors);

    return {
        surfaces,
        guides,
        storeys,
        interiorWalls,
        interiorOpenings,
        zones,
        zoneSeparations,
        openingDetails,
        openingLintels,
        settings,
        name,
        notes,
        format,
        errors,
    };
}

/** The geometry a house is written from, as a store holds it. */
export interface HouseGeometry {
    surfaces: readonly Surface[];
    guides?: readonly Guide[];
    storeys?: readonly Storey[];
    zones?: readonly Zone[];
    zoneSeparations?: readonly ZoneSeparation[];
    /** Per opening id, its own finish and lintel. */
    openingDetails?: ReadonlyMap<string, string>;
    openingLintels?: ReadonlyMap<string, string>;
}

/** What is written beside the geometry: the name, the notes and the settings passed on. */
export interface HouseFileMore {
    name?: string | null;
    notes?: string | null;
    settings?: Record<string, unknown>;
}

/** A house as the arch/1 shape: the geometry, then every setting as it came. */
export function toHouseFile(geometry: HouseGeometry, more: HouseFileMore = {}): HouseFile {
    const out: HouseFile = { format: HOUSE_FILE_FORMAT, surfaces: [] };
    if (more.name) out.name = more.name;
    if (more.notes) out.notes = more.notes;
    for (const s of geometry.surfaces) {
        const fs: FileSurface = { id: s.id, points: s.boundaryMm.map(toFilePoint) };
        const frame = surfaceFrame(s.boundaryMm);
        if (frame && s.openings.length > 0) {
            fs.openings = s.openings.map((h) => openingRing3(frame, h).map(toFilePoint));
            fs.openingKinds = s.openings.map((h) => h.kind);
            const multiLeaf = (h: SurfaceOpening): boolean =>
                h.leaves !== undefined && h.leaves !== 'single';
            if (s.openings.some((h) => h.hingeAtEnd || h.swingsBack || multiLeaf(h))) {
                fs.openingSwings = s.openings.map((h) =>
                    h.hingeAtEnd || h.swingsBack || multiLeaf(h)
                        ? {
                              ...(h.hingeAtEnd ? { hingeAtEnd: true } : {}),
                              ...(h.swingsBack ? { swingsBack: true } : {}),
                              ...(multiLeaf(h) ? { leaves: h.leaves } : {}),
                          }
                        : null
                );
            }
            const own = s.openings.map((h) => geometry.openingDetails?.get(h.id) ?? null);
            if (own.some((d) => d !== null)) fs.openingDetails = own;
            const lintels = s.openings.map((h) => geometry.openingLintels?.get(h.id) ?? null);
            if (lintels.some((l) => l !== null)) fs.openingLintels = lintels;
            if (s.openings.some((h) => isDividedGlazing(h.glazing))) {
                fs.openingGlazing = s.openings.map((h) =>
                    isDividedGlazing(h.glazing) ? toFileGlazing(h.glazing!) : null
                );
            }
        }
        if (s.holes.length > 0) fs.holes = s.holes.map((ring) => ring.map(toFilePoint));
        if (s.kindOverride) fs.kind = s.kindOverride;
        if (s.loadBearing !== null) fs.loadBearing = s.loadBearing;
        if (s.spanDirectionOverride) {
            fs.spanDirection = [s.spanDirectionOverride.x, s.spanDirectionOverride.y];
        }
        if (s.roofGroupId) fs.roofGroup = s.roofGroupId;
        if (s.studSectionOverride) fs.studSection = s.studSectionOverride;
        if (s.partitionKind) fs.partition = s.partitionKind;
        if (s.buildUpType) fs.buildUpType = s.buildUpType;
        out.surfaces.push(fs);
    }
    // Two lists, because they are two different things to a reader: scratch lines, and timber.
    const guides = geometry.guides ?? [];
    const scratch = guides.filter((g) => g.role === undefined);
    const declared = guides.filter((g) => g.role !== undefined);
    if (scratch.length > 0) {
        out.guides = scratch.map((g) => [toFilePoint(g.aMm), toFilePoint(g.bMm)]);
    }
    if (declared.length > 0) {
        out.lines = declared.map((g) => ({
            points: [toFilePoint(g.aMm), toFilePoint(g.bMm)],
            role: g.role!,
        }));
    }
    const storeys = geometry.storeys ?? [];
    if (storeys.length > 0) {
        out.storeys = sortStoreys(storeys).map((s) => ({
            id: s.id,
            name: s.name,
            elevationMm: s.elevationMm,
            heightMm: s.heightMm,
        }));
    }
    const zones = geometry.zones ?? [];
    if (zones.length > 0) {
        out.zones = zones.map((z) => ({
            id: z.id,
            name: z.name,
            kind: z.kindId,
            storey: z.storeyId,
            point: [z.seedMm.x, z.seedMm.y],
            ...(z.ceiling === 'open' ? { ceiling: 'open' as const } : {}),
            ...(z.ceiling === 'lowered'
                ? { ceiling: 'lowered' as const, ceilingMm: z.ceilingMm }
                : {}),
        }));
    }
    const separations = geometry.zoneSeparations ?? [];
    if (separations.length > 0) {
        out.zoneSeparations = separations.map((s) => ({
            storey: s.storeyId,
            points: [
                [s.aMm.x, s.aMm.y],
                [s.bMm.x, s.bMm.y],
            ],
        }));
    }
    for (const [k, v] of Object.entries(more.settings ?? {})) {
        if (!GEOMETRY_KEYS.has(k) && v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
    }
    return out;
}

/** A house as a `twb/1` file's text, as Save writes it. */
export function serializeHouseFile(geometry: HouseGeometry, more: HouseFileMore = {}): string {
    return JSON.stringify(toTwbHouse(toHouseFile(geometry, more)), null, 2);
}

function toFileGlazing(g: OpeningGlazing): FileGlazing {
    const out: FileGlazing = {};
    if (g.mullions) out.mullions = g.mullions;
    if (g.transoms) out.transoms = g.transoms;
    if (g.panes && (g.panes[0] > 1 || g.panes[1] > 1)) out.panes = [g.panes[0], g.panes[1]];
    return out;
}

function readGlazing(raw: unknown, at: string, errors: string[]): OpeningGlazing | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(`${at} must be an object of mullions, transoms and panes, or null.`);
        return null;
    }
    const r = raw as Record<string, unknown>;
    const count = (v: unknown, min: number): v is number =>
        typeof v === 'number' && Number.isInteger(v) && v >= min;
    const g: { mullions?: number; transoms?: number; panes?: [number, number] } = {};
    for (const key of ['mullions', 'transoms'] as const) {
        if (r[key] === undefined) continue;
        if (count(r[key], 0)) {
            if (r[key] > 0) g[key] = r[key];
        } else errors.push(`${at}.${key} must be a whole number of 0 or more.`);
    }
    if (r['panes'] !== undefined) {
        const p = r['panes'];
        if (Array.isArray(p) && p.length === 2 && count(p[0], 1) && count(p[1], 1)) {
            if (p[0] > 1 || p[1] > 1) g.panes = [p[0], p[1]];
        } else errors.push(`${at}.panes must be [across, up], whole numbers of 1 or more.`);
    }
    return isDividedGlazing(g) ? g : null;
}

/**
 * Within this of the walls' top, a ceiling height from a file written before `ceiling` was a
 * choice is read as the flat ceiling on them; under it, as a lowered one. mm.
 */
const LEGACY_FLAT_CEILING_TOLERANCE_MM = 600;

/**
 * The `zones` list, each resolved onto one of the file's storeys — by id first, then by name.
 * Whether an outline is big enough to be a room is the store's call on load, not this parser's.
 */
function readZones(
    raw: unknown,
    storeys: readonly Storey[],
    surfaces: readonly Surface[],
    errors: string[]
): Zone[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
        errors.push('"zones" must be an array.');
        return [];
    }
    const zones: Zone[] = [];
    const ids = new Set<string>();
    raw.forEach((item, i) => {
        const where = `zones[${i}]`;
        if (!isRecord(item)) {
            errors.push(`${where} must be an object.`);
            return;
        }
        const kindId = item['kind'];
        if (typeof kindId !== 'string' || !kindId) {
            errors.push(`${where}.kind must be a room-kind id such as "bedroom".`);
            return;
        }
        const storey = readStoreyRef(item['storey'], storeys, where, errors);
        if (!storey) return;
        const seedMm = readPoint2(item['point'], `${where}.point`, errors);
        if (!seedMm) return;
        let id = typeof item['id'] === 'string' && item['id'] ? item['id'] : `z${i + 1}`;
        while (ids.has(id)) id = `${id}'`;
        ids.add(id);
        const name = typeof item['name'] === 'string' && item['name'] ? item['name'] : kindId;
        const zone: Zone = { id, name, kindId, storeyId: storey.id, seedMm };
        const ceiling = item['ceiling'];
        const ceilingMm = item['ceilingMm'];
        const height =
            typeof ceilingMm === 'number' && Number.isFinite(ceilingMm) && ceilingMm > 0
                ? ceilingMm
                : null;
        if (ceilingMm !== undefined && height === null)
            errors.push(`${where}.ceilingMm must be a positive height in mm.`);
        if (ceiling === 'open') zone.ceiling = 'open';
        else if (ceiling === 'lowered') {
            if (height === null) errors.push(`${where}: a lowered ceiling needs its "ceilingMm".`);
            else Object.assign(zone, { ceiling: 'lowered', ceilingMm: height });
        } else if (ceiling !== undefined && ceiling !== 'flat') {
            errors.push(`${where}.ceiling must be "flat", "open" or "lowered" — read as flat.`);
        } else if (ceiling === undefined && height !== null) {
            const plate = lowestWallTopInStorey(surfaces, storey) - storey.elevationMm;
            if (Number.isFinite(plate) && height < plate - LEGACY_FLAT_CEILING_TOLERANCE_MM)
                Object.assign(zone, { ceiling: 'lowered', ceilingMm: height });
        }
        zones.push(zone);
    });
    return zones;
}

/** Each separation polyline, one `ZoneSeparation` per segment, ids minted in order. */
function readZoneSeparations(
    raw: unknown,
    storeys: readonly Storey[],
    errors: string[]
): ZoneSeparation[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
        errors.push('"zoneSeparations" must be an array.');
        return [];
    }
    const out: ZoneSeparation[] = [];
    raw.forEach((item, i) => {
        const where = `zoneSeparations[${i}]`;
        if (!isRecord(item)) {
            errors.push(`${where} must be an object.`);
            return;
        }
        const storey = readStoreyRef(item['storey'], storeys, where, errors);
        if (!storey) return;
        const rawPoints = item['points'];
        if (!Array.isArray(rawPoints) || rawPoints.length < 2) {
            errors.push(`${where}.points must be an array of at least two [x, y] corners.`);
            return;
        }
        const points: Vec2Mm[] = [];
        for (let k = 0; k < rawPoints.length; k++) {
            const p = readPoint2(rawPoints[k], `${where}.points[${k}]`, errors);
            if (!p) return;
            points.push(p);
        }
        for (let k = 0; k + 1 < points.length; k++) {
            out.push({
                id: `zs${out.length + 1}`,
                storeyId: storey.id,
                aMm: points[k]!,
                bMm: points[k + 1]!,
            });
        }
    });
    return out;
}

/**
 * The `lines` list: columns and beams, each either as its two `[x, y, z]` ends or in plan. In plan
 * a column is its centre, `at: [x, y]`, standing from the floor of its `storey` to `heightMm`
 * above it; a beam is its two `[x, y]` ends at `heightMm` above that floor. `heightMm` left out is
 * the storey's height — the wall height when the file authors no storeys.
 */
function readLines(
    json: Record<string, unknown>,
    storeys: readonly Storey[],
    storeysSynthesised: boolean,
    idOffset: number,
    errors: string[]
): Guide[] {
    const raw = json['lines'];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
        errors.push('"lines" must be an array of { points, role }.');
        return [];
    }
    const wallHeight = json['wallHeightMm'];
    const out: Guide[] = [];
    raw.forEach((item, i) => {
        const where = `lines[${i}]`;
        if (!isRecord(item)) {
            errors.push(`${where} must be an object with "points" and "role".`);
            return;
        }
        const role = item['role'];
        if (role !== 'column' && role !== 'beam') {
            errors.push(`${where}.role must be "column" or "beam".`);
            return;
        }
        const push = (a: Point3Mm, b: Point3Mm) =>
            out.push({ id: `g${idOffset + out.length + 1}`, aMm: a, bMm: b, role });
        const points = item['points'];
        const inPlan =
            item['at'] !== undefined ||
            (Array.isArray(points) && points.every((p) => Array.isArray(p) && p.length === 2));
        if (!inPlan) {
            if (!Array.isArray(points) || points.length !== 2) {
                errors.push(`${where}.points must be two [x, y, z] points.`);
                return;
            }
            const ends = points.map((p, k) => readPoint(p, `${where}.points[${k}]`, errors));
            if (ends[0] && ends[1]) push(ends[0], ends[1]);
            return;
        }
        const storey = readStoreyRef(item['storey'], storeys, where, errors);
        if (!storey) return;
        const height = item['heightMm'];
        if (height !== undefined && !(isFiniteNumber(height) && height > 0)) {
            errors.push(
                `${where}.heightMm must be a height in millimetres above its storey's floor.`
            );
            return;
        }
        const floor = storey.elevationMm;
        const top =
            floor +
            Math.round(
                isFiniteNumber(height)
                    ? height
                    : storeysSynthesised
                      ? isFiniteNumber(wallHeight) && wallHeight > 0
                          ? wallHeight
                          : DEFAULT_WALL_HEIGHT_MM
                      : storey.heightMm
            );
        if (role === 'column') {
            if (points !== undefined) {
                errors.push(
                    `${where}: a column in plan is its centre, "at": [x, y] — not "points".`
                );
                return;
            }
            const at = readPoint2(item['at'], `${where}.at`, errors);
            if (at) push({ x: at.x, y: at.y, z: floor }, { x: at.x, y: at.y, z: top });
            return;
        }
        if (item['at'] !== undefined || !Array.isArray(points) || points.length !== 2) {
            errors.push(`${where}.points must be a beam's two [x, y] ends.`);
            return;
        }
        const ends = points.map((p, k) => readPoint2(p, `${where}.points[${k}]`, errors));
        if (ends[0] && ends[1]) {
            push({ x: ends[0].x, y: ends[0].y, z: top }, { x: ends[1].x, y: ends[1].y, z: top });
        }
    });
    return out;
}

/** A storey named by id, then by name; the lowest one when omitted. Null, with an error, if none. */
function readStoreyRef(
    ref: unknown,
    storeys: readonly Storey[],
    where: string,
    errors: string[]
): Storey | null {
    const storey =
        ref === undefined
            ? sortStoreys(storeys)[0]
            : typeof ref === 'string'
              ? (storeys.find((s) => s.id === ref) ?? storeys.find((s) => s.name === ref))
              : undefined;
    if (!storey)
        errors.push(`${where}.storey ${JSON.stringify(ref)} names no storey in this file.`);
    return storey ?? null;
}

function readRing(raw: unknown, where: string, errors: string[]): Point3Mm[] | null {
    if (!Array.isArray(raw) || raw.length < 3) {
        errors.push(`${where} must be an array of at least three [x, y, z] corners.`);
        return null;
    }
    const ring: Point3Mm[] = [];
    for (let k = 0; k < raw.length; k++) {
        const p = readPoint(raw[k], `${where}[${k}]`, errors);
        if (!p) return null;
        ring.push(p);
    }
    return ring;
}

function readPoint(raw: unknown, where: string, errors: string[]): Point3Mm | null {
    if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(isFiniteNumber)) {
        errors.push(`${where} must be [x, y, z] in millimetres.`);
        return null;
    }
    return toPoint(raw.map(Math.round) as FilePoint);
}

function readPoint2(raw: unknown, where: string, errors: string[]): Vec2Mm | null {
    if (!Array.isArray(raw) || raw.length !== 2 || !raw.every(isFiniteNumber)) {
        errors.push(`${where} must be [x, y] in millimetres.`);
        return null;
    }
    return { x: Math.round(raw[0] as number), y: Math.round(raw[1] as number) };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A wall's `partition` (`FileSurface.partition`), or null where there is none or it cannot be read. */
function readPartitionKind(raw: unknown, where: string, errors: string[]): PartitionKind | null {
    if (raw === undefined || raw === null) return null;
    if ((PARTITION_KINDS as readonly unknown[]).includes(raw)) return raw as PartitionKind;
    errors.push(
        `${where} must be one of ${PARTITION_KINDS.join(', ')} — the house's own partition is used.`
    );
    return null;
}

/** A face's `buildUpType`: a build-up's id, `"<kind>:<key>"`, or null. */
function readBuildUpTypePin(raw: unknown, where: string, errors: string[]): string | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'string' && /^[A-Za-z]+:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) return raw;
    errors.push(
        `${where} must be a build-up type's id, "<build-up>:<key>" — dressed in its kind's own.`
    );
    return null;
}
