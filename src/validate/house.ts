/**
 * A house file validated, in the levels a reader meets it in:
 *
 * 1. `file` — its shape, as `parseHouseFile` reads it: every corner three numbers, every
 *    reference to a storey one the file has. Each error names where it is.
 * 2. `geometry` — opened as a tool opens it (`loadHouse`): what the store would not take, the
 *    partitions it could not build, the doors it could not cut; and what the house is, in numbers.
 * 3. `vocabulary` — read as JSON-LD with TWB's context put in (no network): the keys the context
 *    does not map (a JSON-LD processor drops them), the `twb:` terms no module defines, the
 *    catalogue values the catalogue does not list. An `arch/1` file is written as `twb/1` first.
 * 4. `shapes` — not run, and an info finding says why: the shapes check a blueprint graph with its
 *    derived parts (an opening's u, v and perimeter edges, typed layers, edges, passages), which a
 *    house file does not carry; run on one, every result is about something a derivation adds.
 *    Validate the graph a tool exports instead (`validateGraph`).
 *
 * An IFC file is read into a house file first (`validateIfc`), with what the importer read,
 * guessed and left out as an `import` level before them.
 */

import { classifyAll } from '../surfacekit/model';
import { HOUSE_FILE_FORMAT, parseHouseFile, type HouseFile } from '../house/house-file';
import {
    TWB_HOUSE_BASE,
    TWB_HOUSE_CONTEXT,
    TWB_HOUSE_CONTEXT_URL,
    TWB_HOUSE_FORMAT,
    toTwbHouse,
} from '../house/house-jsonld';
import { loadHouse } from '../house/load';
import { ifcImportSummary, ifcToHouse, type IfcImportOptions } from '../ifc';
import { prepareOntology, type OntologySources } from './ontology';
import type { Oxigraph } from './oxigraph';
import { LevelBuilder, makeReport, now, type Report, type ReportLevel } from './report';
import { checkVocabulary } from './vocabulary';

/** Context 1, which a file may still name: read as context 2 (`withTwbContext`). */
const TWB_HOUSE_CONTEXT_1_URL = 'https://w3id.org/twb/context/1.jsonld';

const SHAPES_NOT_RUN =
    'The SHACL shapes are not run on a house file. They check a blueprint graph with its derived ' +
    'parts — an opening’s u, v, width, height and perimeter edges, typed layers, edges, passages — ' +
    'which a house file does not carry, so every result on one is about something a derivation ' +
    'adds. Validate the graph a tool exports from the house (Turtle) to run them.';

/** A house file (`twb/1` JSON-LD or `arch/1` JSON), as text or parsed, validated level by level. */
export function validateHouseFile(
    input: string | Record<string, unknown>,
    ontology: OntologySources,
    ox: Oxigraph
): Report {
    return houseReport('house', input, ontology, ox, [], now());
}

/** An IFC file read into a house file (`ifcToHouse`), and the house file validated. */
export function validateIfc(
    text: string,
    ontology: OntologySources,
    ox: Oxigraph,
    options: IfcImportOptions = {}
): Report {
    const t0 = now();
    const level = new LevelBuilder('import');
    let house: Record<string, unknown>;
    try {
        const read = ifcToHouse(text, options);
        house = read.house as unknown as Record<string, unknown>;
        for (const line of ifcImportSummary(read.report)) level.info(line);
    } catch (e) {
        level.error(`The IFC file could not be read: ${(e as Error).message}`);
        const skip = (name: ReportLevel['name']) =>
            new LevelBuilder(name).skip('the IFC file could not be read.');
        return makeReport(
            'ifc',
            [level.done(), skip('file'), skip('geometry'), skip('vocabulary'), skip('shapes')],
            {},
            t0
        );
    }
    return houseReport('ifc', house, ontology, ox, [level.done()], t0);
}

function houseReport(
    kind: 'house' | 'ifc',
    input: string | Record<string, unknown>,
    ontology: OntologySources,
    ox: Oxigraph,
    before: ReportLevel[],
    t0: number
): Report {
    const summary: Record<string, string | number> = {};
    const levels = [...before];

    // 1. The file's shape.
    const file = new LevelBuilder('file');
    let json: Record<string, unknown> | null = null;
    if (typeof input === 'string') {
        try {
            const raw: unknown = JSON.parse(input);
            if (isRecord(raw)) json = raw;
            else file.error('The file must be a JSON object.');
        } catch (e) {
            file.error(`Not JSON: ${(e as Error).message}`);
        }
    } else json = input;
    if (!json) {
        levels.push(file.done());
        for (const name of ['geometry', 'vocabulary', 'shapes'] as const) {
            levels.push(new LevelBuilder(name).skip('the file is not a JSON object.'));
        }
        return makeReport(kind, levels, summary, t0);
    }
    const parsed = parseHouseFile(json);
    summary['format'] = parsed.format ?? 'none';
    for (const e of parsed.errors) file.error(e, jsonPathOf(e, json));
    levels.push(file.done());

    // 2. Opened into a model.
    const geometry = new LevelBuilder('geometry');
    const house = loadHouse(json);
    const parseErrors = [...parsed.errors];
    for (const p of house.problems) {
        const i = parseErrors.indexOf(p);
        if (i >= 0) {
            parseErrors.splice(i, 1);
            continue;
        }
        geometry.error(p, problemWhere(p, json));
    }
    const surfaces = house.store.surfaces();
    const kinds = classifyAll(surfaces);
    const byKind = (k: string) => [...kinds.values()].filter((v) => v === k).length;
    const openings = surfaces.flatMap((s) => s.openings);
    const ofKind = (k: string) => openings.filter((o) => o.kind === k).length;
    Object.assign(summary, {
        faces: surfaces.length,
        walls: byKind('wall'),
        floors: byKind('floor'),
        roofs: byKind('roof'),
        storeys: house.store.storeys().length,
        rooms: house.zones.zones().length,
        openings: openings.length,
        'partition faces': house.interiorFaces,
    });
    geometry.info(
        `${surfaces.length} faces (${byKind('wall')} walls, ${byKind('floor')} floors, ` +
            `${byKind('roof')} roofs), ${house.store.storeys().length} storeys, ` +
            `${house.zones.zones().length} rooms, ${openings.length} openings (${ofKind('window')} ` +
            `windows, ${ofKind('door')} doors, ${ofKind('garage-door')} garage doors), ` +
            `${house.interiorFaces} partition faces, ${house.interiorOpenings} doors and windows ` +
            `cut into partitions.`
    );
    levels.push(geometry.done());

    // 3. Read as RDF, against the ontology.
    const vocabulary = new LevelBuilder('vocabulary');
    let doc: Record<string, unknown> = json;
    if (json['format'] === HOUSE_FILE_FORMAT) {
        vocabulary.info(
            `arch/1 is deprecated: tools write ${TWB_HOUSE_FORMAT}, the same model as JSON-LD. ` +
                'Read here as the twb/1 it converts to (twb convert writes it).'
        );
        doc = toTwbHouse(json as unknown as HouseFile) as Record<string, unknown>;
    }
    const context = doc['@context'];
    if (context === TWB_HOUSE_CONTEXT_1_URL) {
        vocabulary.info(
            'Names context 1; read with context 2, the same terms but for the documentation’s.',
            '@context'
        );
    } else if (context === undefined) {
        vocabulary.warning(
            `Names no @context: a JSON-LD processor reads no triples from it. Read here with ` +
                `${TWB_HOUSE_CONTEXT_URL}.`,
            '@context'
        );
    } else if (context !== TWB_HOUSE_CONTEXT_URL) {
        vocabulary.warning(
            `Names ${JSON.stringify(context).slice(0, 120)} as its context, not ` +
                `${TWB_HOUSE_CONTEXT_URL}; read here with TWB's.`,
            '@context'
        );
    }
    for (const key of unmappedKeys(doc)) {
        vocabulary.warning(
            'The JSON-LD context does not map this key: a JSON-LD processor drops it, so a tool ' +
                'reading the file as RDF does not see it.',
            key
        );
    }
    const prepared = prepareOntology(ontology, ox);
    const store = new ox.Store();
    let triples: number | undefined;
    try {
        store.load(JSON.stringify({ ...doc, '@context': TWB_HOUSE_CONTEXT }), {
            format: 'application/ld+json',
            base_iri: TWB_HOUSE_BASE,
        });
        triples = store.size;
        const used = checkVocabulary(store, prepared, vocabulary);
        vocabulary.info(
            `${store.size} triples; ${used.terms} TWB terms and ${used.catalogueValues} catalogue values used.`
        );
        summary['triples'] = store.size;
    } catch (e) {
        vocabulary.error(`Not readable as JSON-LD: ${(e as Error).message}`);
    }
    levels.push(vocabulary.done());

    // 4. The shapes: not on a house file.
    const shapes = new LevelBuilder('shapes');
    shapes.ran = false;
    shapes.info(SHAPES_NOT_RUN);
    levels.push(shapes.done());

    return makeReport(kind, levels, summary, t0, triples);
}

type Term =
    | string
    | { '@type'?: string; '@container'?: string; '@context'?: Record<string, unknown> };
const TERMS = TWB_HOUSE_CONTEXT as unknown as Record<string, Term>;
/** The terms the Blueprint type brings with it apply to the blueprint's own keys. */
const BLUEPRINT_TERMS = (TERMS['Blueprint'] as { '@context': Record<string, Term> })['@context'];

/**
 * Every key of a twb/1 document that the context does not map, as a JSON path — what a JSON-LD
 * processor would drop. JSON literals are not looked into; an index map's keys are values.
 */
export function unmappedKeys(doc: unknown): string[] {
    return walk(doc, { ...TERMS, ...BLUEPRINT_TERMS }, '');
}

function walk(doc: unknown, terms: Record<string, Term>, at: string): string[] {
    if (Array.isArray(doc)) return doc.flatMap((v, i) => walk(v, terms, `${at}[${i}]`));
    if (!isRecord(doc)) return [];
    const key = (k: string) => (at ? `${at}.${k}` : k);
    return Object.entries(doc).flatMap(([k, v]) => {
        if (k.startsWith('@')) return [];
        const term = terms[k];
        if (term === undefined) return [key(k)];
        if (typeof term === 'object' && term['@type'] === '@json') return [];
        if (typeof term === 'object' && term['@container'] === '@index' && isRecord(v)) {
            return Object.entries(v).flatMap(([i, item]) => walk(item, TERMS, `${key(k)}.${i}`));
        }
        return walk(v, TERMS, key(k));
    });
}

/**
 * Where a parse error is, read off its start: `surfaces[3].openings[0] must be …` is at
 * `surfaces[3].openings[0]`, `"format" must be …` at `format`. Only a path whose first key the
 * file has, or a list the parser reads, counts — `Not JSON: …` is at no path.
 */
function jsonPathOf(message: string, json: Record<string, unknown>): string | undefined {
    const m = /^"?([A-Za-z_]\w*(?:\[\d+\]|\.[A-Za-z_]\w*)*)"?(?=[\s.:,]|$)/.exec(message);
    if (!m) return undefined;
    const path = m[1]!;
    const first = /^[A-Za-z_]\w*/.exec(path)![0];
    return first in json || READ_KEYS.has(first) ? path : undefined;
}

const READ_KEYS = new Set([
    'format',
    'surfaces',
    'guides',
    'lines',
    'storeys',
    'interiorWalls',
    'zones',
    'zoneSeparations',
    'walls',
    'openings',
    'roof',
]);

/** Where a problem Open reports is: a skipped face by its place in `surfaces`, a partition's in its list. */
function problemWhere(problem: string, json: Record<string, unknown>): string | undefined {
    const skipped = /^(\S+) skipped:/.exec(problem);
    if (skipped) {
        const list = Array.isArray(json['surfaces']) ? (json['surfaces'] as unknown[]) : [];
        const i = list.findIndex((s) => isRecord(s) && s['id'] === skipped[1]);
        return i >= 0 ? `surfaces[${i}]` : `surface ${skipped[1]}`;
    }
    if (problem.startsWith('interior wall')) return 'interiorWalls';
    const opening = /^interior (?:door|window|garage-door) \d+ at \[[^\]]*\]/.exec(problem);
    if (opening) return opening[0];
    return jsonPathOf(problem, json);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
