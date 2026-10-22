/**
 * A TWB graph validated: Turtle, N-Triples, RDF/XML or JSON-LD that is not a house file — the
 * blueprint as a tool exports it (`ontology/examples/case-house.ttl` is arch's), with its derived
 * parts. It is loaded with the ontology (BOT, the modules, the catalogue), the rules are applied
 * if asked, and every shape of `twb-shapes.ttl` is run.
 *
 * The rules (`ontology/queries/rules/*.rq`, SPARQL CONSTRUCT) run in file-name order, each
 * materialising its triples into the store before the next runs — as `tools/twb_check.py` does,
 * so a later rule sees what an earlier one derived (rule 41's ways through the passages need
 * rule 40's adjacency). A blueprint's adjacency rules are data about it, often kept in a file of
 * their own (`case-house-rules.ttl`, `case-house-use-rules.ttl`): pass them as `with`.
 */

import { TWB_HOUSE_CONTEXT } from '../house/house-jsonld';
import { prepareOntology, type OntologySources, type PreparedOntology } from './ontology';
import { SH, compactIri, construct, termText, type Oxigraph, type OxStore } from './oxigraph';
import { LevelBuilder, makeReport, now, type Report, type Severity } from './report';
import type { ShaclResult } from './shacl';
import { checkVocabulary } from './vocabulary';

export type GraphFormat = 'turtle' | 'n-triples' | 'json-ld' | 'rdf-xml';

/** The media type Oxigraph reads each format as. */
export const GRAPH_MEDIA_TYPES: Record<GraphFormat, string> = {
    turtle: 'text/turtle',
    'n-triples': 'application/n-triples',
    'json-ld': 'application/ld+json',
    'rdf-xml': 'application/rdf+xml',
};

/** Where a graph's relative IRIs resolve, unless the caller gives a base. */
export const GRAPH_BASE = 'https://example.org/twb/graph/';

/** The contexts a TWB JSON-LD document may name, read from the copy every reader has. */
const TWB_CONTEXTS = new Set([
    'https://w3id.org/twb/context/3.jsonld',
    'https://w3id.org/twb/context/2.jsonld',
    'https://w3id.org/twb/context/1.jsonld',
]);

export interface GraphSource {
    name: string;
    text: string;
    format: GraphFormat;
}

export interface GraphOptions {
    /** Apply the rules before the shapes. */
    rules?: boolean;
    /** More data loaded with the graph: a blueprint's adjacency rules kept in a file of their own. */
    with?: GraphSource[];
    /** SPARQL Updates applied after the rules, before the shapes: a repair, a what-if. */
    updates?: string[];
    /** The base relative IRIs resolve against. */
    base?: string;
}

/** A graph, its extra files and the ontology in one store, and the graph's own triples apart. */
export interface LoadedGraph {
    /** The ontology, the graph and its extra files: what the rules and shapes run on. */
    store: OxStore;
    /** Only the graph's and its extra files' triples: what the vocabulary check reads. */
    data: OxStore;
    /** Per source, its triples or why it could not be read. */
    loaded: { name: string; format: GraphFormat; triples?: number; error?: string }[];
}

/** Loads a graph and its extra files beside the ontology. */
export function loadGraph(
    sources: GraphSource[],
    ontology: PreparedOntology,
    base: string = GRAPH_BASE
): LoadedGraph {
    const { ox } = ontology;
    const data = new ox.Store();
    const loaded: LoadedGraph['loaded'] = [];
    for (const s of sources) {
        const before = data.size;
        try {
            data.load(s.format === 'json-ld' ? withTwbContext(s.text) : s.text, {
                format: GRAPH_MEDIA_TYPES[s.format],
                base_iri: base,
            });
            loaded.push({ name: s.name, format: s.format, triples: data.size - before });
        } catch (e) {
            loaded.push({
                name: s.name,
                format: s.format,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    const store = new ox.Store(ontology.quads);
    for (const q of data.match(null, null, null, null)) store.add(q);
    return { store, data, loaded };
}

/**
 * A JSON-LD document naming TWB's published context, with the context put in: there is no network
 * here, and every reader has the context (`TWB_HOUSE_CONTEXT`). Context 1 is read as context 2,
 * which gives every term of it the same meaning but the documentation's (`twbd:` then, `twb:` now).
 */
export function withTwbContext(text: string): string {
    let doc: unknown;
    try {
        doc = JSON.parse(text);
    } catch {
        return text;
    }
    const inline = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(inline);
        if (typeof node !== 'object' || node === null) return;
        const o = node as Record<string, unknown>;
        const c = o['@context'];
        if (typeof c === 'string' && TWB_CONTEXTS.has(c)) o['@context'] = TWB_HOUSE_CONTEXT;
        else if (Array.isArray(c)) {
            o['@context'] = c.map((x) =>
                typeof x === 'string' && TWB_CONTEXTS.has(x) ? TWB_HOUSE_CONTEXT : x
            );
        }
        if (Array.isArray(o['@graph'])) inline(o['@graph']);
    };
    inline(doc);
    return JSON.stringify(doc);
}

/** The rules applied in order, each one's triples added before the next runs: what each added. */
export function applyRules(
    store: OxStore,
    rules: readonly { name: string; text: string }[]
): { name: string; added: number }[] {
    return rules.map((rule) => {
        let added = 0;
        for (const q of construct(store, rule.text)) {
            if (!store.has(q)) {
                store.add(q);
                added++;
            }
        }
        return { name: rule.name, added };
    });
}

const SEVERITY: Record<ShaclResult['severity'], Severity> = {
    Violation: 'error',
    Warning: 'warning',
    Info: 'info',
};

/** A graph validated: parsed with the ontology, its vocabulary checked, the rules, the shapes. */
export function validateGraph(
    text: string,
    format: GraphFormat,
    ontology: OntologySources,
    ox: Oxigraph,
    options: GraphOptions = {}
): Report {
    const t0 = now();
    const prepared = prepareOntology(ontology, ox);
    const summary: Record<string, string | number> = { format };

    const parse = new LevelBuilder('parse');
    const graph = loadGraph(
        [{ name: 'input', text, format }, ...(options.with ?? [])],
        prepared,
        options.base
    );
    for (const l of graph.loaded) {
        if (l.error) parse.error(`Could not be read as ${l.format}: ${l.error}`, l.name);
        else parse.info(`${l.triples} triples.`, l.name);
    }
    const ontologyTriples = prepared.quads.length;
    summary['triples'] = graph.data.size;
    summary['ontology triples'] = ontologyTriples;
    const levels = [parse.done()];
    if (graph.loaded[0]?.error) {
        levels.push(new LevelBuilder('vocabulary').skip('the graph could not be read.'));
        levels.push(new LevelBuilder('rules').skip('the graph could not be read.'));
        levels.push(new LevelBuilder('shapes').skip('the graph could not be read.'));
        return makeReport('graph', levels, summary, t0, 0);
    }

    const vocabulary = new LevelBuilder('vocabulary');
    const used = checkVocabulary(graph.data, prepared, vocabulary);
    vocabulary.info(`${used.terms} TWB terms and ${used.catalogueValues} catalogue values used.`);
    levels.push(vocabulary.done());

    const rules = new LevelBuilder('rules');
    const explicit = graph.store.size;
    if (options.rules) {
        for (const r of applyRules(graph.store, ontology.rules)) {
            rules.info(`${r.added} triples inferred.`, r.name);
        }
        summary['inferred'] = graph.store.size - explicit;
    }
    for (const [i, u] of (options.updates ?? []).entries()) {
        try {
            graph.store.update(u);
            rules.info('SPARQL Update applied.', `update ${i + 1}`);
        } catch (e) {
            rules.error(`SPARQL Update failed: ${(e as Error).message}`, `update ${i + 1}`);
        }
    }
    levels.push(
        options.rules || options.updates?.length
            ? rules.done()
            : rules.skip(
                  'the rules were not asked for (`rules: true`, `twb validate --rules`). The shapes ' +
                      'see only what the graph states: what the rules derive — the requirements ' +
                      'adjacency rules put on zone boundaries (30, 31), the ways through the ' +
                      'passages (40, 41) — is missing, so the requirement shapes find nothing to ' +
                      'check and EgressShape finds no way out of any room.'
              )
    );

    const prefixes = declaredPrefixes([text, ...(options.with ?? []).map((w) => w.text)]);
    levels.push(runShapes(graph.store, prepared, summary, prefixes));
    return makeReport('graph', levels, summary, t0, graph.data.size);
}

/** Every shape on the store, as findings of the `shapes` level. */
export function runShapes(
    store: OxStore,
    prepared: PreparedOntology,
    summary: Record<string, string | number>,
    dataPrefixes: Record<string, string> = {}
): ReturnType<LevelBuilder['done']> {
    const level = new LevelBuilder('shapes');
    if (prepared.shapes instanceof Error) {
        level.error(`The shapes could not be compiled: ${prepared.shapes.message}`);
        return level.done();
    }
    const shapes = prepared.shapes;
    const prefixes = { ...shapes.prefixes, ...dataPrefixes };
    const results = shapes.validate(store, { prefixes });
    summary['shapes'] = shapes.roots.length;
    summary['results'] = results.length;
    for (const r of results) {
        const focus = termText(r.focus, prefixes);
        level.add(SEVERITY[r.severity], r.message, focus, {
            focus,
            ...(r.path
                ? {
                      path: r.path.replace(/<([^>]+)>/g, (_, iri: string) =>
                          compactIri(iri, prefixes)
                      ),
                  }
                : {}),
            shape: compactIri(r.shape, prefixes),
            component: r.component.startsWith(SH) ? r.component.slice(SH.length) : r.component,
            ...(r.value ? { value: termText(r.value, prefixes) } : {}),
        });
    }
    return level.done();
}

/**
 * The prefixes Turtle (or SPARQL-style) declarations in the texts bind, so that a finding names
 * a node as the file does — `inst:zone/z-bath`, not the whole IRI.
 */
export function declaredPrefixes(texts: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /^\s*(?:@prefix|PREFIX)\s+([A-Za-z][\w.-]*)?:\s*<([^>]*)>/gim;
    for (const text of texts) {
        for (const m of text.matchAll(re)) if (m[1]) out[m[1]] = m[2]!;
    }
    return out;
}
