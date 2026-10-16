/**
 * Reads the TWB ontology into what the reference page lists, and writes it to
 * `src/data/reference.json`: every term the modules define (`rdfs:isDefinedBy`) — classes,
 * properties, concept schemes and their concepts — with its labels and definitions, its place in
 * the hierarchy, its domain and range, its alignments (`twb-align.ttl`), and the SHACL shapes
 * (`twb-shapes.ttl`) that check it. Run before every build (`npm run ontology`), so the page always
 * says what this commit's ontology says.
 *
 *     node scripts/capture-reference.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import oxigraph from 'oxigraph';

const ONTOLOGY = fileURLToPath(new URL('../../ontology/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/data/reference.json', import.meta.url));

const PREFIXES = {
    twb: 'https://w3id.org/twb#',
    twbsh: 'https://w3id.org/twb/shapes#',
    twbc: 'https://w3id.org/twb/catalogue/arch#',
    bot: 'https://w3id.org/bot#',
    prov: 'http://www.w3.org/ns/prov#',
    geo: 'http://www.opengis.net/ont/geosparql#',
    skos: 'http://www.w3.org/2004/02/skos/core#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    owl: 'http://www.w3.org/2002/07/owl#',
    sh: 'http://www.w3.org/ns/shacl#',
    dcterms: 'http://purl.org/dc/terms/',
    opm: 'https://w3id.org/opm#',
    qudt: 'http://qudt.org/schema/qudt/',
    unit: 'http://qudt.org/vocab/unit/',
    bpo: 'https://w3id.org/bpo#',
    dicm: 'https://w3id.org/digitalconstruction/0.5/Materials#',
    sml: 'https://w3id.org/sml#',
    beo: 'https://pi.pauwel.be/voc/buildingelement#',
    ifc: 'https://standards.buildingsmart.org/IFC/DEV/IFC4/ADD2_TC1/OWL#',
    vann: 'http://purl.org/vocab/vann/',
};
const SPARQL = Object.entries(PREFIXES)
    .map(([p, ns]) => `PREFIX ${p}: <${ns}>`)
    .join('\n');

const short = (iri) => {
    for (const [p, ns] of Object.entries(PREFIXES)) {
        if (iri.startsWith(ns) && /^[\w.-]*$/.test(iri.slice(ns.length))) return `${p}:${iri.slice(ns.length)}`;
    }
    return iri;
};

const MODULES = ['core', 'construction', 'detailing', 'requirements', 'profile', 'decision', 'derivation', 'housefile', 'doc'];

const store = new oxigraph.Store();
const load = (file, graph) =>
    store.load(readFileSync(`${ONTOLOGY}${file}`, 'utf8'), {
        format: 'text/turtle',
        base_iri: 'https://w3id.org/twb',
        to_graph_name: oxigraph.namedNode(`urn:file:${graph}`),
    });
for (const m of MODULES) load(`twb-${m}.ttl`, 'twb');
load('twb.ttl', 'twb');
load('twb-align.ttl', 'align');
load('twb-shapes.ttl', 'shapes');

/** Rows of a SELECT over the union of the files, each value as its string. */
const select = (query) =>
    store.query(`${SPARQL}\n${query}`, { use_default_graph_as_union: true }).map((row) => {
        const out = {};
        for (const [k, v] of row) out[k] = v.termType === 'Literal' ? v.value : v.value;
        return out;
    });

const oneLine = (s) => s?.replace(/\s*\n\s*/g, ' ').trim();

/** An English (or untagged) literal of `iri` for `property`, if any. */
const text = (iri, property) =>
    oneLine(
        select(`SELECT ?v WHERE { <${iri}> ${property} ?v . FILTER (LANG(?v) = "en" || LANG(?v) = "") }`)[0]?.v
    ) ?? null;

const objects = (iri, property, extra = '') =>
    select(`SELECT DISTINCT ?o WHERE { <${iri}> ${property} ?o . FILTER isIRI(?o) ${extra} } ORDER BY ?o`).map((r) =>
        short(r.o)
    );
const subjects = (property, iri) =>
    select(`SELECT DISTINCT ?s WHERE { ?s ${property} <${iri}> . FILTER isIRI(?s) } ORDER BY ?s`).map((r) =>
        short(r.s)
    );

// ── The terms ─────────────────────────────────────────────────────────────────────────────────

const defined = select(`
    SELECT DISTINCT ?t ?m WHERE {
        GRAPH <urn:file:twb> { ?t rdfs:isDefinedBy ?m }
        FILTER (STRSTARTS(STR(?t), "${PREFIXES.twb}"))
    } ORDER BY ?t`);

const KINDS = [
    ['owl:Class', 'class'],
    ['owl:ObjectProperty', 'objectProperty'],
    ['owl:DatatypeProperty', 'datatypeProperty'],
    ['owl:AnnotationProperty', 'annotationProperty'],
    ['skos:ConceptScheme', 'scheme'],
];
const kindOf = (iri) => {
    const types = objects(iri, 'a');
    for (const [type, kind] of KINDS) if (types.includes(type)) return kind;
    return 'individual';
};

/** What the alignments module says about a term: the predicate and the other ontology's term. */
const alignments = (iri) =>
    select(`
        SELECT ?p ?o WHERE { GRAPH <urn:file:align> { <${iri}> ?p ?o . FILTER isIRI(?o) } }
        ORDER BY ?p ?o`).map((r) => ({ predicate: short(r.p), object: short(r.o), iri: r.o }));

const terms = defined.map(({ t: iri, m }) => {
    const kind = kindOf(iri);
    const term = {
        id: short(iri),
        iri,
        kind,
        module: m.replace(/^.*\//, ''),
        label: text(iri, 'rdfs:label') ?? text(iri, 'skos:prefLabel') ?? short(iri).slice(4),
        comment: text(iri, 'rdfs:comment'),
        definition: text(iri, 'skos:definition'),
        notation: text(iri, 'skos:notation'),
        archTerm: text(iri, 'twb:archTerm'),
        ifc: text(iri, 'twb:ifcCounterpart'),
        unit: objects(iri, 'twb:unit')[0] ?? text(iri, 'twb:unit'),
        deprecated: text(iri, 'owl:deprecated') === 'true',
        alignments: alignments(iri),
    };
    if (kind === 'class') {
        Object.assign(term, {
            superClasses: objects(iri, 'rdfs:subClassOf'),
            subClasses: subjects('rdfs:subClassOf', iri),
            equivalent: objects(iri, 'owl:equivalentClass'),
            disjointWith: [...objects(iri, 'owl:disjointWith'), ...subjects('owl:disjointWith', iri)],
            instances: subjects('a', iri).filter((s) => s.startsWith('twb:')),
        });
    } else if (kind.endsWith('Property')) {
        const types = objects(iri, 'a');
        Object.assign(term, {
            domain: objects(iri, 'rdfs:domain'),
            range: objects(iri, 'rdfs:range'),
            superProperties: objects(iri, 'rdfs:subPropertyOf'),
            subProperties: subjects('rdfs:subPropertyOf', iri),
            inverseOf: [...objects(iri, 'owl:inverseOf'), ...subjects('owl:inverseOf', iri)],
            characteristics: types
                .filter((t) => /Functional|Transitive|Symmetric|Asymmetric|Reflexive|Irreflexive/.test(t))
                .map((t) => t.replace(/^owl:|Property$/g, '')),
        });
    } else if (kind === 'scheme') {
        term.members = subjects('skos:inScheme', iri);
    } else {
        Object.assign(term, {
            types: objects(iri, 'a').filter((t) => t !== 'owl:NamedIndividual'),
            inScheme: objects(iri, 'skos:inScheme'),
            broader: objects(iri, 'skos:broader'),
        });
    }
    return term;
});

// ── The shapes, and what each checks ──────────────────────────────────────────────────────────

const CONSTRAINTS = [
    'minCount',
    'maxCount',
    'class',
    'datatype',
    'nodeKind',
    'in',
    'hasValue',
    'minInclusive',
    'maxInclusive',
    'minExclusive',
    'maxExclusive',
    'pattern',
    'node',
    'severity',
    'message',
];

function propertyShapes(shape) {
    const nodes = store
        .query(`${SPARQL} SELECT ?ps WHERE { GRAPH <urn:file:shapes> { <${shape}> sh:property ?ps } }`)
        .map((r) => r.get('ps'));
    const out = [];
    for (const ps of nodes) {
        // Blank nodes cannot be named back in a query: read the property shape's triples directly.
        const triples = store.match(ps, null, null, null);
        const constraints = {};
        let path = null;
        for (const q of triples) {
            const p = q.predicate.value.replace(PREFIXES.sh, '');
            if (p === 'path') {
                if (q.object.termType === 'NamedNode') path = { text: short(q.object.value), property: short(q.object.value) };
                else {
                    const inv = store.match(q.object, oxigraph.namedNode(`${PREFIXES.sh}inversePath`), null, null)[0];
                    if (inv) path = { text: `^${short(inv.object.value)}`, property: short(inv.object.value) };
                }
            } else if (CONSTRAINTS.includes(p)) {
                constraints[p] = q.object.termType === 'NamedNode' ? short(q.object.value) : oneLine(q.object.value);
            }
        }
        if (path) out.push({ path: path.text, property: path.property, constraints });
    }
    // sh:or of property shapes: the alternatives, by path.
    const ors = store.query(
        `${SPARQL} SELECT ?alt WHERE { GRAPH <urn:file:shapes> { <${shape}> sh:or/rdf:rest*/rdf:first ?alt } }`
    );
    const alternatives = ors.map((r) => {
        const alt = r.get('alt');
        const path = store.match(alt, oxigraph.namedNode(`${PREFIXES.sh}path`), null, null)[0];
        return path ? short(path.object.value) : '?';
    });
    return { properties: out, alternatives };
}

const shapes = select(`
    SELECT DISTINCT ?s WHERE { GRAPH <urn:file:shapes> { ?s a sh:NodeShape } } ORDER BY ?s`).map(({ s }) => {
    const { properties, alternatives } = propertyShapes(s);
    return {
        id: short(s),
        label: text(s, 'rdfs:label') ?? short(s).replace(/^\w+:/, ''),
        comment: text(s, 'rdfs:comment'),
        targetClass: objects(s, 'sh:targetClass'),
        targetSubjectsOf: objects(s, 'sh:targetSubjectsOf'),
        targetObjectsOf: objects(s, 'sh:targetObjectsOf'),
        properties,
        alternatives,
        sparql: select(`
            SELECT ?message WHERE { GRAPH <urn:file:shapes> { <${s}> sh:sparql ?c . ?c sh:message ?message } }`).map(
            (r) => oneLine(r.message)
        ),
    };
});

// ── Where each term is checked ────────────────────────────────────────────────────────────────

const byId = new Map(terms.map((t) => [t.id, t]));
for (const t of terms) t.shapes = [];
const checkedBy = (id, shape, as) => {
    const t = byId.get(id);
    if (t && !t.shapes.some((s) => s.shape === shape && s.as === as)) t.shapes.push({ shape, as });
};
for (const shape of shapes) {
    for (const c of shape.targetClass) checkedBy(c, shape.id, 'target');
    for (const p of [...shape.targetSubjectsOf, ...shape.targetObjectsOf]) checkedBy(p, shape.id, 'target');
    for (const ps of shape.properties) checkedBy(ps.property, shape.id, 'path');
}

const modules = MODULES.map((id) => {
    const iri = `https://w3id.org/twb/${id}`;
    return { id, iri, title: text(iri, 'dcterms:title'), description: text(iri, 'dcterms:description') };
});

writeFileSync(OUT, `${JSON.stringify({ version: text('https://w3id.org/twb', 'owl:versionInfo'), modules, terms, shapes }, null, 1)}\n`);
const count = (k) => terms.filter((t) => t.kind === k).length;
console.log(
    `reference: ${terms.length} terms (${count('class')} classes, ${count('objectProperty')} object, ${count('datatypeProperty')} datatype, ${count('annotationProperty')} annotation properties, ${count('scheme')} schemes, ${count('individual')} concepts), ${shapes.length} shapes → ${OUT}`
);
