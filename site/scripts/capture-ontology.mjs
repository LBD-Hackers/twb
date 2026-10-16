/**
 * Reads the TWB ontology (`paper/ontology/twb.ttl` and the modules it imports) into what the data
 * model page draws, and writes it to `src/data/ontology.json`: the modules, each with its IRI,
 * title, description and imports; every class with its superclasses, label, comment, arch term and
 * IFC counterpart; every object and datatype property with its domain and range; and how many
 * individuals of each class the case house has. Committed, like the other captures, so a build
 * needs nothing but the file.
 *
 * Each term's module is the one that defines it (`rdfs:isDefinedBy`), as in SEAS: the graph's
 * filter and colour.
 *
 *     npm run capture:ontology -w apps/twb-site
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import oxigraph from 'oxigraph';

const ONTOLOGY = fileURLToPath(new URL('../../ontology/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/data/ontology.json', import.meta.url));

const TWB = 'https://w3id.org/twb#';
const PREFIXES = {
    twb: TWB,
    bot: 'https://w3id.org/bot#',
    prov: 'http://www.w3.org/ns/prov#',
    geo: 'http://www.opengis.net/ont/geosparql#',
    skos: 'http://www.w3.org/2004/02/skos/core#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    owl: 'http://www.w3.org/2002/07/owl#',
    opm: 'https://w3id.org/opm#',
    dcterms: 'http://purl.org/dc/terms/',
};

/** TWB's modules in import order, with the Danish of their names (the English is the module's title). */
const MODULES = [
    { id: 'core', da: 'Kerne' },
    { id: 'construction', da: 'Konstruktion' },
    { id: 'detailing', da: 'Detaljering' },
    { id: 'requirements', da: 'Krav' },
    { id: 'profile', da: 'Projektprofil' },
    { id: 'decision', da: 'Beslutninger' },
    { id: 'derivation', da: 'Afledning' },
    { id: 'housefile', da: 'Husfil' },
    { id: 'doc', da: 'Dokumentation' },
];
const moduleIri = (id) => `https://w3id.org/twb/${id}`;

const short = (iri) => {
    for (const [p, ns] of Object.entries(PREFIXES)) if (iri.startsWith(ns)) return `${p}:${iri.slice(ns.length)}`;
    return iri;
};

// ── The ontology, read and asked ───────────────────────────────────────────────────────────────

const store = new oxigraph.Store();
for (const file of ['twb.ttl', ...MODULES.map((m) => `twb-${m.id}.ttl`)])
    store.load(readFileSync(`${ONTOLOGY}${file}`, 'utf8'), { format: 'text/turtle', base_iri: 'https://w3id.org/twb' });
const caseHouse = new oxigraph.Store();
caseHouse.load(readFileSync(`${ONTOLOGY}examples/case-house.ttl`, 'utf8'), { format: 'text/turtle' });

const select = (s, query) =>
    s.query(`PREFIX owl: <${PREFIXES.owl}> PREFIX rdfs: <${PREFIXES.rdfs}> PREFIX twb: <${TWB}> PREFIX dcterms: <${PREFIXES.dcterms}> ${query}`).map((row) => {
        const out = {};
        for (const [k, v] of row) out[k] = v.value;
        return out;
    });

const en = (s, iri, property) =>
    select(s, `SELECT ?v WHERE { <${iri}> ${property} ?v . FILTER (LANG(?v) = "en" || LANG(?v) = "") }`)[0]?.v
        ?.replace(/\s*\n\s*/g, ' ')
        .trim();

const counts = new Map(
    select(caseHouse, 'SELECT ?c (COUNT(?s) AS ?n) WHERE { ?s a ?c } GROUP BY ?c').map((r) => [r.c, Number(r.n)])
);

const classIris = select(store, `SELECT DISTINCT ?c WHERE { ?c a owl:Class . FILTER (STRSTARTS(STR(?c), "${TWB}")) }`).map(
    (r) => r.c
);

const describe = (iri) => ({
    id: short(iri),
    label: en(store, iri, 'rdfs:label') ?? short(iri).replace(/^\w+:/, ''),
    comment: en(store, iri, 'rdfs:comment') ?? null,
    archTerm: en(store, iri, 'twb:archTerm') ?? null,
    ifc: en(store, iri, 'twb:ifcCounterpart') ?? null,
    module: select(store, `SELECT ?m WHERE { <${iri}> rdfs:isDefinedBy ?m }`)[0]?.m.replace(/^.*\//, ''),
});

const classes = classIris.map((iri) => ({
    ...describe(iri),
    superClasses: select(store, `SELECT ?s WHERE { <${iri}> rdfs:subClassOf ?s . FILTER isIRI(?s) }`).map((r) => short(r.s)),
    instances: counts.get(iri) ?? 0,
}));

const properties = (kind) =>
    select(store, `SELECT DISTINCT ?p WHERE { ?p a owl:${kind} . FILTER (STRSTARTS(STR(?p), "${TWB}")) }`).map(({ p }) => ({
        ...describe(p),
        domain: select(store, `SELECT ?d WHERE { <${p}> rdfs:domain ?d . FILTER isIRI(?d) }`).map((r) => short(r.d)),
        range: select(store, `SELECT ?r WHERE { <${p}> rdfs:range ?r . FILTER isIRI(?r) }`).map((r) => short(r.r)),
        superProperties: select(store, `SELECT ?s WHERE { <${p}> rdfs:subPropertyOf ?s . FILTER isIRI(?s) }`).map((r) =>
            short(r.s)
        ),
        functional: store.query(`ASK { <${p}> a <${PREFIXES.owl}FunctionalProperty> }`) === true,
    }));

const objectProperties = properties('ObjectProperty');
const datatypeProperties = properties('DatatypeProperty');

// How often the case house uses each property.
const uses = new Map(
    select(caseHouse, 'SELECT ?p (COUNT(*) AS ?n) WHERE { ?s ?p ?o } GROUP BY ?p').map((r) => [short(r.p), Number(r.n)])
);
for (const p of [...objectProperties, ...datatypeProperties]) p.uses = uses.get(p.id) ?? 0;

// The classes outside TWB that TWB's terms point at: BOT, PROV, GeoSPARQL, SKOS.
const known = new Set(classes.map((c) => c.id));
const external = new Set();
for (const c of classes) for (const s of c.superClasses) if (!known.has(s)) external.add(s);
for (const p of objectProperties)
    for (const t of [...p.domain, ...p.range]) if (!known.has(t) && t !== 'owl:Class') external.add(t);
for (const p of datatypeProperties) for (const t of p.domain) if (!known.has(t)) external.add(t);
const externalClasses = [...external].sort().map((id) => ({ id, label: id.replace(/^\w+:/, ''), prefix: id.split(':')[0] }));

const version = en(store, 'https://w3id.org/twb', 'owl:versionInfo');

// The modules, each with what it defines: the graph colours the ones that define classes.
const modules = MODULES.map(({ id, da }) => {
    const iri = moduleIri(id);
    const title = en(store, iri, 'dcterms:title');
    const name = title.replace(/^TWB /, '');
    const count = (list) => list.filter((t) => t.module === id).length;
    return {
        id,
        iri,
        label: { da, en: name.charAt(0).toUpperCase() + name.slice(1) },
        description: en(store, iri, 'dcterms:description'),
        imports: select(store, `SELECT ?i WHERE { <${iri}> owl:imports ?i }`).map((r) => r.i.replace(/^.*\//, '')),
        classes: count(classes),
        objectProperties: count(objectProperties),
        datatypeProperties: count(datatypeProperties),
    };
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
    OUT,
    `${JSON.stringify(
        {
            version,
            modules,
            classes,
            externalClasses,
            objectProperties,
            datatypeProperties,
        },
        null,
        1
    )}\n`
);
console.log(
    `ontology ${version}: ${classes.length} classes, ${objectProperties.length} object and ${datatypeProperties.length} datatype properties, ${externalClasses.length} external classes → ${OUT}`
);
