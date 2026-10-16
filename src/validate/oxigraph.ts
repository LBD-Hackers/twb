/**
 * What this library needs of Oxigraph, and the few helpers on its terms every part shares.
 *
 * The validator is handed the Oxigraph module rather than importing one, because which build is
 * right depends on where it runs: `oxigraph` (Node) in the CLI and the tests, `oxigraph/web.js`
 * with its WASM initialised in a browser's worker. Only types are imported here, so neither
 * `@lbd-hackers/twb` nor `@lbd-hackers/twb/validate` pulls Oxigraph into a bundle.
 */

import type * as Ox from 'oxigraph';

/** The parts of an Oxigraph module the validator uses: the Node build, or the web build once its WASM is initialised. */
export type Oxigraph = Pick<typeof Ox, 'Store' | 'namedNode' | 'blankNode'>;

export type OxStore = Ox.Store;
export type OxTerm = Ox.Term;
export type OxQuad = Ox.Quad;

export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
export const XSD = 'http://www.w3.org/2001/XMLSchema#';
export const SH = 'http://www.w3.org/ns/shacl#';
export const TWB = 'https://w3id.org/twb#';
/** The deprecated documentation namespace of context 1, whose terms `twb-doc.ttl` still defines. */
export const TWBD = 'https://w3id.org/twb/doc#';
export const TWB_CATALOGUE = 'https://w3id.org/twb/catalogue/arch#';

/** The prefixes a finding writes IRIs with, so that a reader sees `twb:Room`, not the whole IRI. */
export const PREFIXES: Record<string, string> = {
    twb: TWB,
    twbc: TWB_CATALOGUE,
    twbsh: 'https://w3id.org/twb/shapes#',
    arch: 'https://w3id.org/twb/arch#',
    bot: 'https://w3id.org/bot#',
    geo: 'http://www.opengis.net/ont/geosparql#',
    rdf: RDF,
    rdfs: RDFS,
    xsd: XSD,
    sh: SH,
    skos: 'http://www.w3.org/2004/02/skos/core#',
};

/** An IRI as a prefixed name where a prefix fits, else in angle brackets. */
export function compactIri(iri: string, prefixes: Record<string, string> = PREFIXES): string {
    let best: [string, string] | null = null;
    for (const [p, ns] of Object.entries(prefixes)) {
        if (iri.startsWith(ns) && (!best || ns.length > best[1].length)) best = [p, ns];
    }
    if (!best) return `<${iri}>`;
    const local = iri.slice(best[1].length);
    // A local name with characters a prefixed name cannot hold is written whole.
    return /^[\w\-.~%/:#]*$/u.test(local) ? `${best[0]}:${local}` : `<${iri}>`;
}

/** A term as a reader is shown it: a prefixed name, `_:id`, or a literal's text. */
export function termText(t: OxTerm, prefixes: Record<string, string> = PREFIXES): string {
    switch (t.termType) {
        case 'NamedNode':
            return compactIri(t.value, prefixes);
        case 'BlankNode':
            return `_:${t.value}`;
        case 'Literal':
            return JSON.stringify(t.value);
        default:
            return String(t.value);
    }
}

/** A term in SPARQL's syntax, to be written into a query. A blank node has none. */
export function sparqlTerm(t: OxTerm): string {
    switch (t.termType) {
        case 'NamedNode':
            return `<${t.value}>`;
        case 'Literal': {
            const lexical = JSON.stringify(t.value);
            if (t.language) return `${lexical}@${t.language}`;
            return `${lexical}^^<${t.datatype.value}>`;
        }
        default:
            throw new Error(`A ${t.termType} cannot be written into a query.`);
    }
}

/** A key that is equal for equal terms: for sets and maps of terms. */
export function termKey(t: OxTerm): string {
    if (t.termType === 'Literal') {
        return `L${t.value}\u0000${t.language || t.datatype.value}`;
    }
    return `${t.termType[0]}${t.value}`;
}

/** The SELECT query's solutions. */
export function select(store: OxStore, query: string): Map<string, OxTerm>[] {
    return store.query(query) as Map<string, OxTerm>[];
}

/** The quads a CONSTRUCT query makes. */
export function construct(store: OxStore, query: string): OxQuad[] {
    return store.query(query) as OxQuad[];
}
