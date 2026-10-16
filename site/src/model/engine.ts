/**
 * The data model page's RDF engine: the case house as the paper exports it, the rules as SPARQL
 * CONSTRUCT and the shapes' SPARQL constraints, run with Oxigraph. The page runs it in a worker
 * (`rdf-worker.ts`, the WASM build) and the tests in Node (`engine.spec.ts`), so it is handed
 * the Oxigraph module rather than importing one.
 *
 * Nothing here re-implements a rule or a check: the queries are read from
 * `paper/ontology/queries/rules/*.rq` and the constraints from `twb-shapes.ttl`, as written.
 */

import type * as Ox from 'oxigraph';

export type Oxigraph = Pick<typeof Ox, 'Store' | 'namedNode'>;
type Store = Ox.Store;
type Term = Ox.Term;

export const TWB = 'https://w3id.org/twb#';
const BOT = 'https://w3id.org/bot#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const SH = 'http://www.w3.org/ns/shacl#';
const OUTDOOR = `${TWB}OutdoorAir`;

const PREFIXES = {
    twb: TWB,
    twbc: 'https://w3id.org/twb/catalogue/arch#',
    arch: 'https://w3id.org/twb/arch#',
    bot: BOT,
    geo: 'http://www.opengis.net/ont/geosparql#',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs: RDFS,
    skos: 'http://www.w3.org/2004/02/skos/core#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    dcterms: 'http://purl.org/dc/terms/',
    inst: 'https://example.org/twb/case-house/',
} as const;

const SPARQL_PREFIXES = Object.entries(PREFIXES)
    .map(([p, ns]) => `PREFIX ${p}: <${ns}>`)
    .join('\n');

/** An IRI as a prefixed name where a prefix fits. */
export function compact(iri: string): string {
    for (const [p, ns] of Object.entries(PREFIXES)) {
        if (iri.startsWith(ns)) return `${p}:${decodeURIComponent(iri.slice(ns.length))}`;
    }
    return `<${iri}>`;
}

type Row = Record<string, string>;

function select(store: Store, query: string): Row[] {
    const result = store.query(`${SPARQL_PREFIXES}\n${query}`) as Map<string, Term>[];
    return result.map((binding) => {
        const row: Row = {};
        for (const [k, v] of binding) row[k] = v.value;
        return row;
    });
}

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────

/** The files the engine reads: Turtle for the graph, SPARQL text for the rules. */
export interface EngineSources {
    /** BOT, TWB, the catalogue, the case house and its rules, as Turtle. */
    graph: string[];
    /** `twb-shapes.ttl`. */
    shapes: string;
    /** The rules the checks need, by file name, in the order they are applied. */
    rules: { name: string; text: string }[];
    /** `repair-wet-room-coverings.ru`. */
    repair: string;
    /** The house file's JSON-LD context (`twb-house.context.jsonld`). */
    context: string;
}

/** What the reader has changed on the page before the checks run. */
export interface Scenario {
    /** Apply the wet-room repair (SPARQL Update) after the rules. */
    repair: boolean;
    /** Passages whose door opens from one zone only: passage IRI → that zone's IRI. */
    openableFrom: Record<string, string>;
    /** Recipe U-values set on the page, W/m²K, by recipe IRI. */
    uValues: Record<string, number>;
}

export const NO_CHANGES: Scenario = { repair: false, openableFrom: {}, uValues: {} };

// ── Outputs ─────────────────────────────────────────────────────────────────────────────────

export type Point = [number, number];

export interface PlanWall {
    id: string;
    label: string;
    a: Point;
    b: Point;
    /** An exterior wall, the climate screen (its recipe faces the outdoor air). */
    exterior: boolean;
}

export interface PlanZone {
    id: string;
    label: string;
    outline: Point[];
    seed: Point;
    wet: boolean;
}

export interface PlanOpening {
    id: string;
    kind: 'Door' | 'Window';
    a: Point;
    b: Point;
    /** A door's passage, and the two zones it connects. */
    passage: string | null;
    zones: string[];
}

export interface Plan {
    walls: PlanWall[];
    zones: PlanZone[];
    openings: PlanOpening[];
    /** The floor's outline. */
    outline: Point[];
}

/** A capability a zone boundary requires, and whether the construction there provides it. */
export interface Requirement {
    boundary: string;
    surface: string;
    zone: string;
    capability: string;
    rule: string;
    providedBy: 'recipe' | 'covering' | null;
}

export interface Violation {
    shape: string;
    focus: string;
    message: string;
    /** The constraint's other variables, as the query bound them. */
    bindings: Row;
}

export interface UValueCheck {
    surface: string;
    recipe: string;
    recipeLabel: string;
    u: number;
    max: number;
    rule: string;
}

export interface WayOut {
    zone: string;
    label: string;
    reachable: boolean;
    canLeave: boolean;
}

export interface CheckResult {
    plan: Plan;
    requirements: Requirement[];
    uValues: UValueCheck[];
    ways: WayOut[];
    leadsTo: [string, string][];
    violations: Violation[];
    /** The constraints that ran, as read from the shapes. */
    constraints: ShapeConstraint[];
    /** The SPARQL Update the scenario ran before the rules, as text: what the page changed. */
    updates: string[];
    triples: { explicit: number; inferred: number };
    ms: { rules: number; checks: number };
}

export interface ShapeConstraint {
    shape: string;
    message: string;
    select: string;
    target: string;
}

// ── The engine ──────────────────────────────────────────────────────────────────────────────

export class Engine {
    private readonly base: Ox.Quad[];
    readonly constraints: ShapeConstraint[];
    readonly baseSize: number;

    constructor(
        private readonly ox: Oxigraph,
        private readonly sources: EngineSources
    ) {
        const store = new ox.Store();
        for (const ttl of sources.graph) store.load(ttl, { format: 'text/turtle' });
        this.base = store.match(null, null, null, null);
        this.baseSize = this.base.length;
        this.constraints = readConstraints(ox, sources.shapes);
    }

    /** The rules and the requirement constraints on the case house, as the scenario changes it. */
    check(scenario: Scenario): CheckResult {
        const store = new this.ox.Store(this.base);
        const updates = scenarioUpdates(scenario);
        for (const u of updates) store.update(`${SPARQL_PREFIXES}\n${u}`);
        const explicit = store.size;

        const t0 = performance.now();
        for (const rule of this.sources.rules) {
            const quads = store.query(rule.text) as Ox.Quad[];
            for (const q of quads) store.add(q);
        }
        if (scenario.repair) store.update(this.sources.repair);
        const t1 = performance.now();

        const violations = this.constraints.flatMap((c) => runConstraint(store, c));
        const result: CheckResult = {
            plan: readPlan(store),
            requirements: readRequirements(store),
            uValues: readUValues(store),
            ways: readWays(store),
            leadsTo: select(store, 'SELECT ?a ?b WHERE { ?a twb:leadsTo ?b }').map((r) => [
                r['a']!,
                r['b']!,
            ]),
            violations,
            constraints: this.constraints,
            updates,
            triples: { explicit, inferred: store.size - explicit },
            ms: { rules: 0, checks: 0 },
        };
        result.ms = { rules: Math.round(t1 - t0), checks: Math.round(performance.now() - t1) };
        return result;
    }

    /** A house file (`twb/1`) read as JSON-LD: its triples, and what they are about. */
    readHouse(json: string): HouseGraph {
        const doc = JSON.parse(json) as Record<string, unknown>;
        doc['@context'] = (JSON.parse(this.sources.context) as { '@context': unknown })['@context'];
        const store = new this.ox.Store();
        store.load(JSON.stringify(doc), { format: 'application/ld+json', base_iri: HOUSE_BASE });
        return new HouseGraph(store, this.ox);
    }
}

/** Where the relative ids of a house file (`wall-east`, `edge/…`) land. */
export const HOUSE_BASE = 'https://example.org/house/';

/** The SPARQL constraints of the requirement shapes, read out of `twb-shapes.ttl`. */
function readConstraints(ox: Oxigraph, shapesTtl: string): ShapeConstraint[] {
    const shapes = new ox.Store();
    shapes.load(shapesTtl, { format: 'text/turtle' });
    const rows = select(
        shapes,
        `PREFIX sh: <${SH}>
        SELECT ?shape ?message ?select ?targetClass ?targetSubjectsOf WHERE {
            ?shape sh:sparql ?c . ?c sh:select ?select ; sh:message ?message .
            OPTIONAL { ?shape sh:targetClass ?targetClass }
            OPTIONAL { ?shape sh:targetSubjectsOf ?targetSubjectsOf }
            VALUES ?shape { <https://w3id.org/twb/shapes#CapabilityShape> <https://w3id.org/twb/shapes#UValueShape> <https://w3id.org/twb/shapes#EgressShape> }
        }`
    );
    return rows.map((r) => ({
        shape: r['shape']!.replace(/^.*#/, ''),
        message: r['message']!,
        select: r['select']!,
        // The focus nodes, once each: SHACL's target, as a subquery that binds `?this`.
        target: r['targetClass']
            ? `{ SELECT DISTINCT ?this WHERE { ?this a/rdfs:subClassOf* <${r['targetClass']}> } }`
            : `{ SELECT DISTINCT ?this WHERE { ?this <${r['targetSubjectsOf']}> ?value } }`,
    }));
}

/**
 * A SHACL-SPARQL constraint, evaluated as SHACL does: `$this` bound to each focus node of the
 * shape's target, one violation per solution, the message filled from the solution.
 */
function runConstraint(store: Store, c: ShapeConstraint): Violation[] {
    const query = c.select
        .replace(/\$this/g, '?this')
        .replace(/WHERE\s*\{/, (m) => `${m} ${c.target}`);
    return select(store, query).map((row) => ({
        shape: c.shape,
        focus: row['this']!,
        message: c.message.replace(/\{[?$](\w+)\}/g, (_, v: string) => {
            const value = v === 'this' ? row['this']! : (row[v] ?? '?');
            return /^https?:/.test(value) ? compact(value) : value;
        }),
        bindings: row,
    }));
}

/** What the reader changed, as the SPARQL Update that changes it. */
function scenarioUpdates(s: Scenario): string[] {
    const out: string[] = [];
    for (const [passage, zone] of Object.entries(s.openableFrom)) {
        out.push(`INSERT DATA { <${passage}> twb:openableFrom <${zone}> . }`);
    }
    for (const [recipe, u] of Object.entries(s.uValues)) {
        out.push(
            `DELETE { <${recipe}> twb:uValue ?u } INSERT { <${recipe}> twb:uValue ${u.toFixed(3)} } WHERE { <${recipe}> twb:uValue ?u }`
        );
    }
    return out;
}

// ── Reading the results back ────────────────────────────────────────────────────────────────

const parseWkt = (wkt: string): [number, number, number][] => {
    const body = /\(\(?([^()]+)\)?\)/.exec(wkt.replace(/^<[^>]*>\s*/, ''))?.[1] ?? '';
    return body
        .split(',')
        .map((p) => p.trim().split(/\s+/).map(Number) as [number, number, number]);
};

function readPlan(store: Store): Plan {
    const walls: PlanWall[] = [];
    for (const r of select(
        store,
        `SELECT ?s ?label ?wkt ?boundary WHERE {
            ?s a twb:WallSurface ; geo:hasGeometry/geo:asWKT ?wkt .
            OPTIONAL { ?s rdfs:label ?label }
            OPTIONAL { ?s twb:hasRecipe/twb:boundaryCondition ?boundary }
            FILTER NOT EXISTS { ?s twb:surfacePartOf ?whole }
            FILTER (!CONTAINS(STR(?s), "~"))
        }`
    )) {
        const pts = parseWkt(r['wkt']!);
        const low = Math.min(...pts.map((p) => p[2]));
        const foot = pts.filter((p) => p[2] === low);
        if (foot.length < 2) continue;
        const [a, b] = extremes(foot.map((p) => [p[0], p[1]] as Point));
        walls.push({
            id: r['s']!,
            label: r['label'] ?? compact(r['s']!),
            a,
            b,
            exterior: r['boundary'] === OUTDOOR,
        });
    }
    const zones: PlanZone[] = select(
        store,
        `SELECT ?z ?label ?wkt ?seed ?wet WHERE {
            ?z a twb:Room ; rdfs:label ?label ; geo:hasGeometry/geo:asWKT ?wkt ; twb:seed/geo:asWKT ?seed .
            OPTIONAL { ?z twb:zoneKind/twb:isWet ?wet }
        }`
    ).map((r) => ({
        id: r['z']!,
        label: r['label']!,
        outline: parseWkt(r['wkt']!)
            .slice(0, -1)
            .map((p) => [p[0], p[1]] as Point),
        seed: parseWkt(r['seed']!).map((p) => [p[0], p[1]] as Point)[0]!,
        wet: r['wet'] === 'true',
    }));
    const passages = new Map<string, { passage: string; zones: string[] }>();
    for (const r of select(
        store,
        'SELECT ?p ?door ?z WHERE { ?p a twb:Passage ; twb:passageThrough ?door ; twb:connectsZone ?z }'
    )) {
        const entry = passages.get(r['door']!) ?? { passage: r['p']!, zones: [] };
        entry.zones.push(r['z']!);
        passages.set(r['door']!, entry);
    }
    const openings: PlanOpening[] = [];
    for (const r of select(
        store,
        `SELECT ?o ?kind ?wkt WHERE {
            ?host a twb:WallSurface ; bot:hostsElement ?o . ?o a ?kind ; geo:hasGeometry/geo:asWKT ?wkt .
            VALUES ?kind { twb:Door twb:Window }
        }`
    )) {
        const pts = parseWkt(r['wkt']!);
        const [a, b] = extremes(pts.map((p) => [p[0], p[1]] as Point));
        const p = passages.get(r['o']!);
        openings.push({
            id: r['o']!,
            kind: r['kind'] === `${TWB}Door` ? 'Door' : 'Window',
            a,
            b,
            passage: p?.passage ?? null,
            zones: p?.zones ?? [],
        });
    }
    const floor = select(
        store,
        'SELECT ?wkt WHERE { ?s a twb:FloorSurface ; geo:hasGeometry/geo:asWKT ?wkt . FILTER (!CONTAINS(STR(?s), "~")) }'
    )[0];
    const outline = floor
        ? parseWkt(floor['wkt']!)
              .slice(0, -1)
              .map((p) => [p[0], p[1]] as Point)
        : [];
    return { walls, zones, openings, outline };
}

/** The two points of a set furthest apart: a wall's foot or an opening's sill in plan. */
function extremes(points: Point[]): [Point, Point] {
    let best: [Point, Point] = [points[0]!, points[0]!];
    let d = -1;
    for (const p of points) {
        for (const q of points) {
            const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
            if (dd > d) {
                d = dd;
                best = [p, q];
            }
        }
    }
    return best[0][0] + best[0][1] <= best[1][0] + best[1][1] ? best : [best[1], best[0]];
}

function readRequirements(store: Store): Requirement[] {
    return select(
        store,
        `SELECT ?b ?surface ?zone ?cap ?rule ?byRecipe ?byCovering WHERE {
            ?b twb:requires ?cap ; twb:onSide ?side ; bot:interfaceOf ?zone ; twb:governedBy ?rule .
            ?rule twb:thenRequires ?cap .
            ?surface twb:positiveSide|twb:negativeSide ?side ; twb:hasRecipe ?r .
            FILTER (?zone != ?surface)
            BIND (EXISTS { ?r twb:provides ?cap }
                || EXISTS { ?side twb:isInside true . ?r twb:providesInside ?cap }
                || EXISTS { ?side twb:isInside false . ?r twb:providesOutside ?cap } AS ?byRecipe)
            BIND (EXISTS { ?b twb:hasCovering ?c . ?c twb:provides ?cap } AS ?byCovering)
        }`
    ).map((r) => ({
        boundary: r['b']!,
        surface: r['surface']!,
        zone: r['zone']!,
        capability: r['cap']!,
        rule: r['rule']!,
        providedBy:
            r['byRecipe'] === 'true' ? 'recipe' : r['byCovering'] === 'true' ? 'covering' : null,
    }));
}

function readUValues(store: Store): UValueCheck[] {
    return select(
        store,
        `SELECT ?s ?r ?label ?u ?max ?rule WHERE {
            ?s twb:requiresMaxUValue ?max ; twb:hasRecipe ?r ; twb:governedBy ?rule .
            ?rule twb:thenRequiresMaxUValue ?max .
            ?r twb:uValue ?u ; rdfs:label ?label .
        } ORDER BY ?s`
    ).map((r) => ({
        surface: r['s']!,
        recipe: r['r']!,
        recipeLabel: r['label']!,
        u: Number(r['u']),
        max: Number(r['max']),
        rule: r['rule']!,
    }));
}

function readWays(store: Store): WayOut[] {
    return select(
        store,
        `SELECT ?z ?label ?reachable ?canLeave WHERE {
            ?z a twb:Room ; rdfs:label ?label .
            BIND (EXISTS { twb:OutdoorAir twb:leadsTo+ ?z } AS ?reachable)
            BIND (EXISTS { ?z twb:leadsTo+ twb:OutdoorAir } AS ?canLeave)
        } ORDER BY ?label`
    ).map((r) => ({
        zone: r['z']!,
        label: r['label']!,
        reachable: r['reachable'] === 'true',
        canLeave: r['canLeave'] === 'true',
    }));
}

// ── A house file as a graph ─────────────────────────────────────────────────────────────────

export interface TripleLine {
    predicate: string;
    object: string;
    /** The object is a node described further down (an opening, a recipe layer). */
    nested?: TripleLine[];
}

export class HouseGraph {
    constructor(
        private readonly store: Store,
        private readonly ox: Oxigraph
    ) {}

    get size(): number {
        return this.store.size;
    }

    /** How many nodes of each class the file makes, most first. */
    classes(): { cls: string; n: number }[] {
        return select(
            this.store,
            'SELECT ?c (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s a ?c } GROUP BY ?c ORDER BY DESC(?n) ?c'
        ).map((r) => ({ cls: compact(r['c']!), n: Number(r['n']) }));
    }

    /** What the file says about one node, with the blank nodes it owns spelled out. */
    describe(iri: string, depth = 2): TripleLine[] {
        const quads = this.store.match(this.ox.namedNode(iri), null, null, null);
        return quads.map((q) => this.line(q, depth));
    }

    private line(q: Ox.Quad, depth: number): TripleLine {
        const o = q.object;
        const predicate =
            q.predicate.value === `${PREFIXES.rdf}type` ? 'a' : compact(q.predicate.value);
        if (o.termType === 'BlankNode' && depth > 0) {
            return {
                predicate,
                object: '[ ]',
                nested: this.store.match(o, null, null, null).map((n) => this.line(n, depth - 1)),
            };
        }
        return { predicate, object: termText(o) };
    }
}

function termText(t: Term): string {
    if (t.termType === 'NamedNode') return compact(t.value);
    if (t.termType === 'BlankNode') return '[ ]';
    if (t.termType === 'Literal') {
        const dt = t.datatype.value;
        if (dt.endsWith('#JSON')) return `${short(t.value, 64)}^^rdf:JSON`;
        if (dt.endsWith('#string') || dt.endsWith('#langString')) return JSON.stringify(t.value);
        return t.value;
    }
    return t.value;
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
