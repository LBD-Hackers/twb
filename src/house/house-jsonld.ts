/**
 * The house file as JSON-LD: `twb/1`, the format Save writes. Every house file read as JSON-LD
 * is a graph in the TWB ontology (`ontology/twb.ttl` and its modules): the blueprint, its storeys, surfaces
 * and the openings they host, its rooms, the recipes that differ from the defaults, the edges'
 * own joints, the joint templates and standards, the opening standards and the node rules. What
 * TWB has no terms for — the technical cabinet, heating, water, LCA, the workshop's settings,
 * the foundation drawing, scratch lines — rides along as JSON literals in the
 * `arch:` namespace, so a JSON-LD processor keeps it without pretending to understand it.
 *
 * It is `arch/1` (`house-file.ts`) with the few changes JSON-LD needs, and nothing else:
 *
 * - `@context` and `"type": "Blueprint"`; every object that is a thing has a `type`.
 * - Openings are objects on their surface, `{ type: "Window", points, detail?, lintel?,
 *   glazing?, … }`, instead of six parallel arrays (`openings`, `openingKinds`, `openingDetails`,
 *   `openingLintels`, `openingGlazing`, `openingSwings`).
 * - A surface's pinned kind is `pinnedKind`, a room's purpose `zoneKind`, a fitting's
 *   `fixtureKind`, a line's role its `type`
 *   — each key means one thing wherever it stands.
 * - Recipes carry their layers' `index`; a layer's place is data, not array order.
 * - An edge is named by its IRI, `edge/<key>` with the key percent-encoded (`|`, `#` and `>` are
 *   not allowed in an IRI as they stand) — the same IRI the TWB export gives it.
 * - A joint's cuts are layer terminations, `{ surface, layer, cut }` per layer, with `cut` one of
 *   `"miter"`, `"overhang"`, `"standard"` (arch/1's null), `{ "boundary": n }` or a line drawn
 *   across the section, `{ "line": { "atMm": …, "perMm": … } }`.
 * - A template's kind of edge is a TWB edge type (`OutsideCorner`, `Eave`, …) and its recipes
 *   recipe IRIs; standards per kind of edge and opening are lists of objects, not maps.
 * - The expression's own id is its `notation`.
 * - The documentation's sections are `Section`s, from TWB's documentation module
 *   (`ontology/twb-doc.ttl`): the blueprint `twb:hasSection`, each with its letter, its
 *   line (`twb:cutLineMm`) where the user placed it, and whether the drawing set draws it.
 *
 * Geometry stays as arch/1 has it — `[x, y, z]` millimetres in the project frame — typed
 * `@json` (`twb:pointsMm`), so a file is still written and read as plain JSON. A tool's TWB export
 * adds what is derived: kinds, sides, zone boundaries, edges, resolved joints, WKT geometry and the
 * members (`ontology/examples/case-house.ttl` is arch's).
 *
 * Reading goes the other way: `fromTwbHouse` turns a `twb/1` document back into the arch/1 shape
 * `parseHouseFile` has always read, so one lenient parser checks both. The simple shape — walls
 * as lines, a roof by type — is written the same way in either format.
 *
 * Pure: no DOM, no three.js.
 */

import type { HouseFile } from './house-file';

export const TWB_HOUSE_FORMAT = 'twb/1';

/**
 * Where the context is published: w3id redirects it to twb.madsholten.dk/context/2.jsonld. Readers
 * here use `TWB_HOUSE_CONTEXT` and never fetch it. Context 2 (TWB 0.3.0) differs from context 1
 * only in the documentation's terms, `twbd:` then and `twb:` now, so a file is read the same
 * whichever it names; context 1 stays published as it was (`twb-house.context.1.jsonld`).
 */
export const TWB_HOUSE_CONTEXT_URL = 'https://w3id.org/twb/context/2.jsonld';

/** The base a house file's own ids resolve against, unless a reader gives its own. */
export const TWB_HOUSE_BASE = 'https://example.org/twb/house/';

/** Terms of one enumeration, by the value a file writes. */
type Terms = Record<string, string>;

const vocab = (id: string, terms: Terms | string): Record<string, unknown> => ({
    '@id': id,
    '@type': '@vocab',
    '@context': typeof terms === 'string' ? { '@vocab': terms } : terms,
});

const CAT = 'https://w3id.org/twb/catalogue/arch#';
const json = (id: string) => ({ '@id': id, '@type': '@json' });
const ref = (id: string) => ({ '@id': id, '@type': '@id' });

/** arch's kinds of edge, as the TWB edge types a template is kept for. */
const TEMPLATE_EDGE_TYPES: Record<string, { type: string; inside?: true }> = {
    OutsideCorner: { type: 'wall-corner' },
    InsideCorner: { type: 'wall-corner', inside: true },
    TJunction: { type: 'wall-partition' },
    Eave: { type: 'eave' },
    Verge: { type: 'verge' },
    WallFloorJunction: { type: 'wall-floor' },
};

const OPENING_TYPES: Record<string, string> = {
    window: 'Window',
    door: 'Door',
    'garage-door': 'GarageDoor',
};

const LINE_TYPES: Record<string, string> = { column: 'Column', beam: 'Beam' };

/**
 * The JSON-LD context of a `twb/1` house file. Published at `TWB_HOUSE_CONTEXT_URL`; a copy is
 * kept as `ontology/twb-house.context.jsonld` (`house-jsonld.spec.ts` holds them equal).
 */
export const TWB_HOUSE_CONTEXT = {
    '@version': 1.1,
    twb: 'https://w3id.org/twb#',
    twbc: CAT,
    arch: 'https://w3id.org/twb/arch#',
    bot: 'https://w3id.org/bot#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    skos: 'http://www.w3.org/2004/02/skos/core#',
    dcterms: 'http://purl.org/dc/terms/',
    id: '@id',
    type: '@type',

    // Classes
    Blueprint: {
        '@id': 'twb:Blueprint',
        // The simple shape's plan-level input: expanded into surfaces on load, kept as written.
        '@context': {
            walls: json('arch:walls'),
            wallHeightMm: 'arch:wallHeightMm',
            roof: json('arch:roof'),
            openings: json('arch:planOpenings'),
        },
    },
    Surface: 'twb:Surface',
    Window: 'twb:Window',
    Door: 'twb:Door',
    GarageDoor: 'twb:GarageDoor',
    Storey: 'bot:Storey',
    Room: 'twb:Room',
    ZoneSeparation: 'twb:ZoneSeparation',
    Fixture: 'twb:Fixture',
    // The documentation's sections (`ontology/twb-doc.ttl`): `line` is the cut's own here,
    // not a joint's line cut.
    Section: {
        '@id': 'twb:Section',
        '@context': { line: json('twb:cutLineMm') },
    },
    Column: 'twb:Column',
    Beam: 'twb:Beam',
    Recipe: 'twb:Recipe',
    JointDetail: 'twb:JointDetail',
    JointTemplate: 'twb:JointTemplate',
    JointStandard: 'twb:JointStandard',
    OpeningStandard: 'twb:OpeningStandard',
    NodeRule: 'twb:NodeRule',
    Expression: 'twb:Expression',

    // The blueprint
    format: 'dcterms:conformsTo',
    notes: 'rdfs:comment',
    storeys: { '@id': 'twb:hasBlueprintPart' },
    surfaces: { '@id': 'twb:hasBlueprintPart' },
    zones: { '@id': 'twb:hasBlueprintPart' },
    zoneSeparations: { '@id': 'twb:hasBlueprintPart' },
    fixtures: { '@id': 'twb:hasBlueprintPart' },
    lines: { '@id': 'twb:hasBlueprintPart' },
    envelope: { '@id': 'twb:hasBlueprintPart', '@container': '@index', '@index': 'twb:archTerm' },
    edgeJoints: { '@id': 'twb:hasBlueprintPart' },
    jointTemplates: { '@id': 'twb:hasJointTemplate' },
    jointStandards: { '@id': 'twb:hasJointStandard' },
    openingStandards: { '@id': 'twb:hasOpeningStandard' },
    nodeRules: { '@id': 'twb:hasNodeRule' },
    expression: { '@id': 'twb:hasExpression' },
    buildingUse: vocab('twb:hasBuildingUse', `${CAT}use/DK/`),
    constructionSystem: vocab('twb:hasConstructionSystem', `${CAT}system/`),
    floorStructure: vocab('twb:hasFloorStructure', `${CAT}floor-structure/`),
    roofStructure: vocab('twb:hasRoofStructure', `${CAT}roof-structure/`),
    roofLoad: 'twb:roofLoadProfile',
    ifcScope: 'twb:ifcScope',
    sawnGradeId: 'twb:sawnTimberGrade',
    consequenceClass: 'twb:consequenceClass',
    structuralLoads: '@nest',
    liveKnPerM2: { '@id': 'twb:liveLoad', '@nest': 'structuralLoads' },
    snowKnPerM2: { '@id': 'twb:snowLoad', '@nest': 'structuralLoads' },
    windKnPerM2: { '@id': 'twb:windPressure', '@nest': 'structuralLoads' },
    roofOverhang: '@nest',
    eavesMm: { '@id': 'twb:defaultEavesOverhang', '@nest': 'roofOverhang' },
    vergeMm: { '@id': 'twb:defaultVergeOverhang', '@nest': 'roofOverhang' },
    edges: { ...json('arch:overhangEdges'), '@nest': 'roofOverhang' },

    // arch's own blocks, kept as JSON
    guides: json('arch:guides'),
    interiorWalls: json('arch:interiorWalls'),
    cabinet: json('arch:cabinet'),
    heating: json('arch:heating'),
    water: json('arch:water'),
    lca: json('arch:lca'),
    foundation: json('arch:foundation'),
    framingRules: json('arch:framingRules'),
    splices: json('arch:splices'),
    cutting: json('arch:cutting'),
    sections: { '@id': 'twb:hasSection', '@container': '@set' },
    inDocumentation: 'twb:inDrawingSet',
    underFloorC: 'arch:underFloorC',

    // Geometry, as authored
    points: json('twb:pointsMm'),
    point: json('twb:pointMm'),
    at: json('twb:pointMm'),
    holes: json('twb:holesMm'),
    spanDirection: json('twb:spanDirection'),

    // Storeys, surfaces, openings, rooms
    name: 'rdfs:label',
    elevationMm: 'twb:elevation',
    heightMm: 'twb:storeyHeight',
    storey: ref('twb:onStorey'),
    openings: { '@id': 'bot:hostsElement' },
    pinnedKind: vocab('twb:pinnedKind', {
        wall: 'twb:WallSurface',
        floor: 'twb:FloorSurface',
        roof: 'twb:RoofSurface',
    }),
    loadBearing: 'twb:loadBearing',
    roofGroup: 'twb:roofGroupName',
    studSection: 'twb:pinnedStudSection',
    partition: 'twb:pinnedPartitionKind',
    recipe: ref('twb:hasRecipe'),
    detail: vocab('twb:hasOwnOpeningDetail', {
        '@vocab': `${CAT}opening-detail/`,
        plain: 'twb:PlainOpening',
        'sill-flashing': 'twb:SillFlashing',
        'frame-boards': 'twb:FrameBoards',
        'head-sill-boards': 'twb:HeadAndSillBoards',
    }),
    lintel: vocab('twb:hasOwnLintel', {
        '@vocab': `${CAT}lintel/`,
        'brick-beam': 'twb:ReinforcedBrickBeam',
        'reinforced-joints': 'twb:ReinforcedBrickwork',
        'soldier-angle': 'twb:SoldierCourseOnAngle',
        angle: 'twb:AngleLintel',
        'flat-arch': 'twb:FlatArch',
    }),
    glazing: json('twb:glazingDivision'),
    hingeAtEnd: 'twb:hingeAtEnd',
    swingsBack: 'twb:swingsBack',
    leaves: vocab('twb:doorLeaves', {
        single: 'twb:SingleLeaf',
        'one-and-a-half': 'twb:OneAndAHalfLeaves',
        double: 'twb:DoubleLeaves',
    }),
    zoneKind: vocab('twb:zoneKind', `${CAT}zone-kind/`),
    ceiling: vocab('twb:ceilingKind', {
        flat: 'twb:FlatCeiling',
        open: 'twb:OpenCeiling',
        lowered: 'twb:LoweredCeiling',
    }),
    ceilingMm: 'twb:ceilingHeight',
    fixtureKind: vocab('twb:fixtureKind', `${CAT}fixture-kind/`),
    variant: vocab('twb:fixtureVariant', `${CAT}fixture-variant/`),
    placedBy: 'arch:placedBy',
    edited: 'arch:editedByUser',
    size: json('twb:footprintMm'),
    facing: json('twb:facing'),

    // Recipes
    boundary: vocab('twb:boundaryCondition', {
        exterior: 'twb:OutdoorAir',
        ground: 'twb:Ground',
        unheated: 'twb:UnheatedSpace',
    }),
    airGapLevel: 'arch:airGapLevel',
    layers: { '@id': 'twb:hasLayer' },
    index: 'twb:layerIndex',
    material: vocab('twb:material', `${CAT}material/`),
    thickness: 'twb:thickness',
    core: 'twb:isCore',
    members: { '@id': 'twb:hasMemberPattern' },
    width: 'twb:memberWidth',
    cc: 'twb:spacing',
    run: 'arch:run',
    cladding: { '@id': 'twb:hasCladdingPattern' },
    pattern: vocab('twb:claddingPattern', `${CAT}cladding/`),
    boardWidth: 'arch:boardWidth',
    boardThickness: 'arch:boardThickness',
    overlap: 'arch:overlap',
    stripWidth: 'arch:stripWidth',
    stripThickness: 'arch:stripThickness',
    fixedSpacing: 'arch:fixedSpacing',
    taper: { '@id': 'twb:hasTaper' },
    masonry: { '@id': 'twb:hasMasonryBond' },
    bond: vocab('twb:brickBond', `${CAT}bond/`),
    ties: { '@id': 'twb:hasWallTies' },
    perM2: 'twb:tiesPerSquareMetre',
    diameter: 'twb:tieDiameter',
    fall: 'twb:fallPercent',

    // Joints, templates, standards, node rules
    edge: { '@reverse': 'twb:hasOwnJoint', '@type': '@id' },
    cuts: { '@id': 'twb:hasLayerTermination' },
    surface: ref('twb:ofSurface'),
    role: vocab('twb:ofRole', { first: 'twb:FirstRole', second: 'twb:SecondRole' }),
    layer: 'twb:layerIndex',
    cut: vocab('twb:cut', {
        miter: 'twb:mitre',
        overhang: 'twb:overhangCut',
        standard: 'twb:standardCut',
        boundary: 'twb:boundaryIndex',
    }),
    line: json('arch:lineCut'),
    trims: { '@id': 'twb:hasTrim' },
    profile: json('twb:profileMm'),
    repeat: json('arch:repeat'),
    boards: vocab('twb:boardSeam', { through: 'twb:BoardsRunThrough', break: 'twb:BoardsBreak' }),
    edgeType: vocab('twb:forEdgeType', 'https://w3id.org/twb#'),
    atInsideCorner: 'twb:atInsideCorner',
    first: ref('twb:firstRoleRecipe'),
    second: ref('twb:secondRoleRecipe'),
    jointType: 'twb:archTerm',
    option: vocab('twb:standardOption', {
        '@vocab': `${CAT}joint-option/`,
        miter: 'twb:Mitred',
        seamless: 'twb:Seamless',
        parapet: 'twb:Parapet',
        'longer-through': 'twb:LongerWallThrough',
        'exterior-through': 'twb:ExteriorWallThrough',
        'partition-through': 'twb:PartitionThrough',
        'roof-through': 'twb:RoofThrough',
        'wall-through': 'twb:WallThrough',
        'floor-through': 'twb:DeckThrough',
        'floor-through-facade': 'twb:DeckThroughFacadeOver',
        'wall-on-joists': 'twb:WallOnJoists',
    }),
    openingType: vocab('twb:forOpeningClass', 'https://w3id.org/twb#'),
    standardDetail: vocab('twb:standardDetail', {
        '@vocab': `${CAT}opening-detail/`,
        plain: 'twb:PlainOpening',
        'sill-flashing': 'twb:SillFlashing',
        'frame-boards': 'twb:FrameBoards',
        'head-sill-boards': 'twb:HeadAndSillBoards',
    }),
    forEdges: { '@id': 'twb:forEdge', '@type': '@id' },
    through: ref('twb:throughEdge'),

    // The expression
    notation: 'skos:notation',
    facade: 'twb:facadeCladding',
    roofCovering: 'twb:roofCovering',
    gutter: 'twb:gutterKind',
    openingFinish: 'arch:openingsExpression',
} as const;

type Json = Record<string, unknown>;

const isRecord = (x: unknown): x is Json =>
    typeof x === 'object' && x !== null && !Array.isArray(x);
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** An edge's IRI, relative to the file: the same one the TWB export gives it. */
export const edgeRef = (key: string): string => `edge/${encodeURIComponent(key)}`;
const edgeKeyOf = (ref: unknown): unknown =>
    typeof ref === 'string' && ref.startsWith('edge/') ? decodeURIComponent(ref.slice(5)) : ref;

const recipeRef = (id: string): string => `recipe/${id}`;
const recipeIdOf = (ref: unknown): unknown =>
    typeof ref === 'string' && ref.startsWith('recipe/') ? ref.slice(7) : ref;

/**
 * arch/1's per-layer cut: `"miter"`, `"overhang"`, a boundary index, a drawn line, or null for
 * the standard.
 */
type FileCut = string | number | { atMm: number; perMm: number } | null;

const toCut = (c: FileCut): unknown =>
    c === null
        ? 'standard'
        : typeof c === 'number'
          ? { boundary: c }
          : typeof c === 'object'
            ? { line: { atMm: c.atMm, perMm: c.perMm } }
            : c;

const fromCut = (c: unknown): unknown => {
    if (c === 'standard' || c === undefined) return null;
    if (isRecord(c)) return isRecord(c['line']) ? c['line'] : c['boundary'];
    return c;
};

/** Terminations, in order, back into one array per surface or role. */
function cutsOf(terms: unknown, key: 'surface' | 'role'): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const t of list(terms)) {
        if (!isRecord(t) || typeof t[key] !== 'string' || typeof t['layer'] !== 'number') continue;
        const cuts = (out[t[key] as string] ??= []);
        cuts[t['layer'] as number] = fromCut(t['cut']);
    }
    for (const cuts of Object.values(out)) for (let i = 0; i < cuts.length; i++) cuts[i] ??= null;
    return out;
}

/** One termination per layer of each surface (or role), in order — nulls too, so a recipe's layer count is kept. */
const terminations = (key: 'surface' | 'role', cuts: Record<string, readonly FileCut[]>): Json[] =>
    Object.entries(cuts).flatMap(([id, layers]) =>
        layers.map((c, layer) => ({ [key]: id, layer, cut: toCut(c) }))
    );

const typed = (type: string, o: Json): Json => ({ type, ...o });

/** Copies `keys` of `from` that are present, under the same names. */
function pick(from: Json, keys: readonly string[]): Json {
    const out: Json = {};
    for (const k of keys) if (from[k] !== undefined) out[k] = from[k];
    return out;
}

/** An arch/1 house file as `twb/1`. */
export function toTwbHouse(file: HouseFile): Json {
    const f = file as unknown as Json;
    const out: Json = {
        '@context': TWB_HOUSE_CONTEXT_URL,
        format: TWB_HOUSE_FORMAT,
        type: 'Blueprint',
    };
    if (file.name) out['name'] = file.name;
    if (file.notes) out['notes'] = file.notes;
    // The simple shape's input, as written (`simple-house.ts`).
    Object.assign(out, pick(f, ['wallHeightMm', 'walls', 'roof']));
    if (Array.isArray(f['openings'])) out['openings'] = f['openings'];
    // Storeys by id: a reference is an IRI, and a name — "Ground floor" — is not one. A storey the
    // file left without an id gets the one `parseHouseFile` would mint, and a reference by name
    // is written as that id; both read back as the same storey.
    const storeyIds = new Map<string, string>();
    if (file.storeys) {
        out['storeys'] = file.storeys.map((s, i) => {
            const id = s.id || `st${i + 1}`;
            if (typeof s.name === 'string') storeyIds.set(s.name, id);
            return typed('Storey', { ...s, id });
        });
    }
    const ids = new Set(storeyIds.values());
    const storeyRef = <T extends { storey?: string }>(o: T): T =>
        o.storey !== undefined && !ids.has(o.storey) && storeyIds.has(o.storey)
            ? { ...o, storey: storeyIds.get(o.storey)! }
            : o;
    // A file in the simple shape may have no surfaces of its own.
    if (file.surfaces)
        out['surfaces'] = file.surfaces.map((s) => {
            const o: Json = typed('Surface', { ...pick(s as unknown as Json, ['id', 'points']) });
            if (s.openings?.length) {
                o['openings'] = s.openings.map((points, i) => ({
                    // A file that leaves the kind to the opening's place keeps leaving it.
                    ...(s.openingKinds?.[i] ? { type: OPENING_TYPES[s.openingKinds[i]] } : {}),
                    points,
                    ...(s.openingDetails?.[i] ? { detail: s.openingDetails[i] } : {}),
                    ...(s.openingLintels?.[i] ? { lintel: s.openingLintels[i] } : {}),
                    ...(s.openingGlazing?.[i] ? { glazing: s.openingGlazing[i] } : {}),
                    ...(s.openingSwings?.[i] ?? {}),
                }));
            }
            if (s.holes) o['holes'] = s.holes;
            if (s.kind) o['pinnedKind'] = s.kind;
            Object.assign(
                o,
                pick(s as unknown as Json, [
                    'loadBearing',
                    'spanDirection',
                    'roofGroup',
                    'studSection',
                    'partition',
                ])
            );
            if (s.buildUpType) o['recipe'] = recipeRef(s.buildUpType);
            return o;
        });
    if (file.guides) out['guides'] = file.guides;
    if (file.lines) {
        // The simple shape's lines may also carry `at`, `storey` and `heightMm` (`simple-house.ts`).
        out['lines'] = file.lines.map(({ role, ...l }) =>
            typed(LINE_TYPES[role] ?? role, storeyRef(l as { storey?: string }))
        );
    }
    if (file.interiorWalls) out['interiorWalls'] = file.interiorWalls;
    if (file.zones) {
        out['zones'] = file.zones.map(({ kind, ...z }) =>
            typed('Room', { ...storeyRef(z), zoneKind: kind })
        );
    }
    if (file.zoneSeparations) {
        out['zoneSeparations'] = file.zoneSeparations.map((z) =>
            typed('ZoneSeparation', { ...storeyRef(z) })
        );
    }
    if (file.fixtures) {
        out['fixtures'] = file.fixtures.map(({ kind, ...x }) =>
            typed('Fixture', { ...storeyRef(x), fixtureKind: kind })
        );
    }
    if (file.sections) out['sections'] = file.sections.map((x) => typed('Section', { ...x }));
    if (file.envelope) {
        out['envelope'] = Object.fromEntries(
            Object.entries(file.envelope).map(([id, a]) => [
                id,
                typed('Recipe', {
                    id: recipeRef(id),
                    ...pick(a as unknown as Json, ['name', 'boundary', 'airGapLevel']),
                    layers: a!.layers.map((l, index) => ({ index, ...l })),
                }),
            ])
        );
    }
    if (file.edgeJoints) {
        out['edgeJoints'] = file.edgeJoints.map((j) =>
            typed('JointDetail', {
                edge: edgeRef(j.edge),
                cuts: terminations('surface', j.cuts),
                ...(j.trims ? { trims: j.trims } : {}),
                ...(j.boards ? { boards: j.boards } : {}),
            })
        );
    }
    if (file.envelopeJointTemplates) {
        out['jointTemplates'] = file.envelopeJointTemplates.map((t) => {
            const edgeType =
                Object.entries(TEMPLATE_EDGE_TYPES).find(
                    ([, d]) =>
                        d.type === t.type && (t.type !== 'wall-corner' || !!d.inside === !!t.inside)
                )?.[0] ?? t.type;
            return typed('JointTemplate', {
                edgeType,
                atInsideCorner: !!t.inside,
                first: recipeRef(t.first),
                second: recipeRef(t.second),
                cuts: terminations('role', { first: t.firstCuts, second: t.secondCuts }),
                ...(t.trims ? { trims: t.trims } : {}),
            });
        });
    }
    if (file.envelopeJointStandards) {
        out['jointStandards'] = Object.entries(file.envelopeJointStandards).map(
            ([jointType, option]) => typed('JointStandard', { jointType, option })
        );
    }
    if (file.openingDetails) {
        out['openingStandards'] = Object.entries(file.openingDetails).map(([kind, detail]) =>
            typed('OpeningStandard', {
                openingType: OPENING_TYPES[kind] ?? kind,
                standardDetail: detail,
            })
        );
    }
    if (file.nodeRules) {
        out['nodeRules'] = file.nodeRules.map((r) =>
            typed('NodeRule', { forEdges: r.edges.map(edgeRef), through: edgeRef(r.through) })
        );
    }
    if (file.roofOverhang) out['roofOverhang'] = { ...file.roofOverhang };
    if (file.expression) {
        const { id, roof, openings, ...rest } = file.expression;
        out['expression'] = typed('Expression', {
            notation: id,
            ...rest,
            ...(roof !== undefined ? { roofCovering: roof } : {}),
            ...(openings !== undefined ? { openingFinish: openings } : {}),
        });
    }
    Object.assign(
        out,
        pick(f, [
            'buildingUse',
            'constructionSystem',
            'floorStructure',
            'roofStructure',
            'roofLoad',
            'ifcScope',
            'sawnGradeId',
            'consequenceClass',
            'structuralLoads',
            'underFloorC',
            'cabinet',
            'heating',
            'water',
            'lca',
            'foundation',
            'framingRules',
            'splices',
            'cutting',
        ])
    );
    // A field this module does not know yet — one added to arch/1 after it — is written as it
    // stands rather than lost. It reads back, but a JSON-LD processor drops it until the context
    // maps it: `house-jsonld.spec.ts` fails for every such key, naming it.
    for (const [k, v] of Object.entries(f)) {
        if (!(k in out) && !REWRITTEN.has(k)) out[k] = v;
    }
    return out;
}

/** The arch/1 fields `toTwbHouse` writes under another name or in another shape. */
const REWRITTEN = new Set([
    'format',
    'envelopeJointTemplates',
    'envelopeJointStandards',
    'openingDetails',
]);

/**
 * A `twb/1` document back in the arch/1 shape `parseHouseFile` reads. Lenient like the parser:
 * what it cannot make sense of it passes on as it stands, for the parser to name.
 */
export function fromTwbHouse(doc: Json): Json {
    const out: Json = {};
    for (const [k, v] of Object.entries(doc)) {
        if (k === '@context' || k === 'type') continue;
        out[k] = v;
    }
    out['format'] = 'arch/1';
    if (Array.isArray(doc['storeys'])) out['storeys'] = doc['storeys'].map(untyped);
    if (Array.isArray(doc['surfaces'])) {
        out['surfaces'] = doc['surfaces'].map((raw) => {
            if (!isRecord(raw)) return raw;
            const { type: _type, openings, pinnedKind, recipe, ...s } = raw;
            const o: Json = { ...s };
            if (pinnedKind !== undefined) o['kind'] = pinnedKind;
            if (recipe !== undefined) o['buildUpType'] = recipeIdOf(recipe);
            const ops = list(openings).filter(isRecord);
            if (ops.length > 0) {
                o['openings'] = ops.map((h) => h['points']);
                if (ops.some((h) => h['type'] !== undefined)) {
                    o['openingKinds'] = ops.map(
                        (h) =>
                            Object.entries(OPENING_TYPES).find(([, t]) => t === h['type'])?.[0] ??
                            h['type']
                    );
                }
                const details = ops.map((h) => h['detail'] ?? null);
                if (details.some((d) => d !== null)) o['openingDetails'] = details;
                const lintels = ops.map((h) => h['lintel'] ?? null);
                if (lintels.some((l) => l !== null)) o['openingLintels'] = lintels;
                const glazings = ops.map((h) => h['glazing'] ?? null);
                if (glazings.some((g) => g !== null)) o['openingGlazing'] = glazings;
                const swings = ops.map((h) => {
                    const sw = pick(h, ['hingeAtEnd', 'swingsBack', 'leaves']);
                    return Object.keys(sw).length > 0 ? sw : null;
                });
                if (swings.some((sw) => sw !== null)) o['openingSwings'] = swings;
            }
            return o;
        });
    }
    if (Array.isArray(doc['lines'])) {
        out['lines'] = doc['lines'].map((l) =>
            isRecord(l)
                ? (({ type, ...rest }) => ({
                      ...rest,
                      role:
                          rest['role'] ??
                          Object.entries(LINE_TYPES).find(([, t]) => t === type)?.[0] ??
                          type,
                  }))(l)
                : l
        );
    }
    if (Array.isArray(doc['zones'])) {
        out['zones'] = doc['zones'].map((z) => {
            if (!isRecord(z)) return z;
            const { type: _type, zoneKind, ...rest } = z;
            return { ...rest, kind: zoneKind };
        });
    }
    if (Array.isArray(doc['zoneSeparations']))
        out['zoneSeparations'] = doc['zoneSeparations'].map(untyped);
    if (Array.isArray(doc['sections'])) out['sections'] = doc['sections'].map(untyped);
    if (Array.isArray(doc['fixtures'])) {
        out['fixtures'] = doc['fixtures'].map((x) => {
            if (!isRecord(x)) return x;
            const { type: _type, fixtureKind, ...rest } = x;
            return { ...rest, kind: fixtureKind };
        });
    }
    if (isRecord(doc['envelope'])) {
        out['envelope'] = Object.fromEntries(
            Object.entries(doc['envelope']).map(([id, a]) => {
                if (!isRecord(a)) return [id, a];
                const { type: _type, id: _id, layers, ...rest } = a;
                const sorted = list(layers)
                    .filter(isRecord)
                    .map((l, i) => ({ l, at: typeof l['index'] === 'number' ? l['index'] : i }))
                    .sort((x, y) => x.at - y.at)
                    .map(({ l }) => {
                        const { index: _index, ...layer } = l;
                        return layer;
                    });
                return [id, { ...rest, layers: sorted }];
            })
        );
    }
    if (Array.isArray(doc['edgeJoints'])) {
        out['edgeJoints'] = doc['edgeJoints'].map((j) => {
            if (!isRecord(j)) return j;
            return {
                edge: edgeKeyOf(j['edge']),
                cuts: cutsOf(j['cuts'], 'surface'),
                ...pick(j, ['trims', 'boards']),
            };
        });
    }
    delete out['jointTemplates'];
    if (Array.isArray(doc['jointTemplates'])) {
        out['envelopeJointTemplates'] = doc['jointTemplates'].map((t) => {
            if (!isRecord(t)) return t;
            const kind = TEMPLATE_EDGE_TYPES[t['edgeType'] as string];
            const cuts = cutsOf(t['cuts'], 'role');
            return {
                type: kind?.type ?? t['edgeType'],
                ...(t['atInsideCorner'] === true || kind?.inside ? { inside: true } : {}),
                first: recipeIdOf(t['first']),
                second: recipeIdOf(t['second']),
                firstCuts: cuts['first'] ?? [],
                secondCuts: cuts['second'] ?? [],
                ...pick(t, ['trims']),
            };
        });
    }
    delete out['jointStandards'];
    if (Array.isArray(doc['jointStandards'])) {
        out['envelopeJointStandards'] = Object.fromEntries(
            doc['jointStandards'].filter(isRecord).map((s) => [s['jointType'], s['option']])
        );
    }
    delete out['openingStandards'];
    if (Array.isArray(doc['openingStandards'])) {
        out['openingDetails'] = Object.fromEntries(
            doc['openingStandards']
                .filter(isRecord)
                .map((s) => [
                    Object.entries(OPENING_TYPES).find(([, t]) => t === s['openingType'])?.[0] ??
                        s['openingType'],
                    s['standardDetail'],
                ])
        );
    }
    if (Array.isArray(doc['nodeRules'])) {
        out['nodeRules'] = doc['nodeRules'].map((r) =>
            isRecord(r)
                ? { edges: list(r['forEdges']).map(edgeKeyOf), through: edgeKeyOf(r['through']) }
                : r
        );
    }
    if (isRecord(doc['expression'])) {
        const { type: _type, notation, roofCovering, openingFinish, ...rest } = doc['expression'];
        out['expression'] = {
            id: notation,
            ...rest,
            ...(roofCovering !== undefined ? { roof: roofCovering } : {}),
            ...(openingFinish !== undefined ? { openings: openingFinish } : {}),
        };
    }
    return out;
}

function untyped(x: unknown): unknown {
    if (!isRecord(x)) return x;
    const { type: _type, ...rest } = x;
    return rest;
}
