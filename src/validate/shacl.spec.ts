import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ox from 'oxigraph';
import { describe, expect, it } from 'vitest';
import { applyRules, loadGraph } from './graph';
import { loadOntologySources } from './node';
import { prepareOntology } from './ontology';
import { RDF, XSD, type OxStore, type OxTerm } from './oxigraph';
import { ShaclUnsupportedError, ShaclValidator, type ShaclResult } from './shacl';

const ROOT = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** What pyshacl reported (`tools/shacl_expected.py`), keyed as `canonical` keys a result. */
interface Expected {
    focus: string;
    path: string | null;
    shape: string;
    component: string;
    severity: string;
    value: string | null;
}
const EXPECTED = JSON.parse(read('fixtures/shacl/expected.json')) as {
    caseHouse: { name: string; rules: boolean; updates: string[]; results: Expected[] }[];
    coreFeatures: { shapes: string; data: string; results: Expected[] };
};

const ontology = loadOntologySources(join(ROOT, 'ontology'));
const prepared = prepareOntology(ontology, ox);

const NUMERIC = new Set(
    ['integer', 'decimal', 'double', 'float', 'int', 'long', 'nonNegativeInteger'].map(
        (t) => `${XSD}${t}`
    )
);

/**
 * A term the same whichever engine read it, as `tools/shacl_expected.py` writes it: an IRI as
 * itself, a literal by its value (a number as a number), a blank node as what points at it and
 * what it says.
 */
function canonical(store: OxStore, t: OxTerm | undefined): string | null {
    if (!t) return null;
    if (t.termType === 'NamedNode') return `<${t.value}>`;
    if (t.termType === 'Literal') {
        const n = Number(t.value);
        return `"${NUMERIC.has(t.datatype.value) && t.value.trim() !== '' && !Number.isNaN(n) ? String(n) : t.value}"`;
    }
    const ins = store
        .match(null, null, t, null)
        .filter((q) => q.subject.termType !== 'BlankNode')
        .map((q) => `<${q.subject.value}> <${q.predicate.value}>`)
        .sort();
    const outs = store
        .match(t, null, null, null)
        .filter((q) => q.object.termType !== 'BlankNode')
        .map((q) => `<${q.predicate.value}> ${canonical(store, q.object)}`)
        .sort();
    return `[${[...ins, ...outs].join(' ; ')}]`;
}

const key = (r: Expected) =>
    JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))));
const sorted = (rs: Expected[]) => [...rs].sort((a, b) => key(a).localeCompare(key(b)));

function keyed(store: OxStore, results: ShaclResult[]): Expected[] {
    return sorted(
        results.map((r) => ({
            focus: canonical(store, r.focus)!,
            path: r.path ?? null,
            shape: r.shape.startsWith('_:') ? '[]' : `<${r.shape}>`,
            component: r.component.replace(/^.*#/, ''),
            severity: r.severity,
            value: canonical(store, r.value),
        }))
    );
}

const caseHouse = [
    'ontology/examples/case-house.ttl',
    'ontology/examples/case-house-rules.ttl',
    'ontology/examples/case-house-use-rules.ttl',
].map((name) => ({ name, text: read(name), format: 'turtle' as const }));

/** The case house as exported, and with the rules applied: loaded and derived once, copied per case. */
const exported = loadGraph(caseHouse, prepared).store;
const derived = new ox.Store(exported.match(null, null, null, null));
applyRules(derived, ontology.rules);
const copy = (store: OxStore) => new ox.Store(store.match(null, null, null, null));

describe('the SHACL engine against pyshacl', () => {
    it('compiles every shape of twb-shapes.ttl', () => {
        expect(prepared.shapes).toBeInstanceOf(ShaclValidator);
        expect((prepared.shapes as ShaclValidator).roots.length).toBe(16);
    });

    it.each(EXPECTED.caseHouse.map((c) => [c.name, c] as const))(
        'reports what pyshacl reports on the case house: %s',
        (_, c) => {
            const store = copy(c.rules ? derived : exported);
            for (const u of c.updates) store.update(u);
            const results = (prepared.shapes as ShaclValidator).validate(store);
            expect(keyed(store, results)).toEqual(sorted(c.results));
        }
    );

    it('reports what pyshacl reports for the SHACL Core features twb-shapes.ttl does not use', () => {
        const { shapes, data, results } = EXPECTED.coreFeatures;
        const store = new ox.Store();
        store.load(read(data), { format: 'text/turtle' });
        const actual = new ShaclValidator(ox, read(shapes)).validate(store);
        expect(keyed(store, actual)).toEqual(sorted(results));
    });

    it('fills a SPARQL constraint’s message from its solution', () => {
        const results = (prepared.shapes as ShaclValidator).validate(derived);
        const inst = 'https://example.org/twb/case-house/';
        expect(results.map((r) => r.message)).toContain(
            `<${inst}surface/s3> does not provide twb:WetRoomLining where it meets ` +
                `<${inst}zone/z-bath>: its recipe lacks it on this side and no covering supplies it.`
        );
    });
});

describe('what the SHACL engine refuses', () => {
    const shapes = (body: string) => `
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix ex: <https://example.org/> .
        ex:S a sh:NodeShape ; sh:targetClass ex:C ; ${body} .`;

    it.each([
        ['sh:pattern', 'sh:property [ sh:path ex:p ; sh:pattern "^a" ]'],
        ['sh:closed', 'sh:closed true'],
        [
            'sh:qualified',
            'sh:property [ sh:path ex:p ; sh:qualifiedValueShape [ sh:class ex:D ] ; sh:qualifiedMinCount 1 ]',
        ],
        ['sh:minCount on a node shape', 'sh:minCount 1'],
        ['recursive shapes', 'sh:property [ sh:path ex:p ; sh:node ex:S ]'],
        [
            '$currentShape',
            'sh:sparql [ sh:select "SELECT $this WHERE { $this ?p $currentShape }" ]',
        ],
    ])('a shapes graph using %s, naming it', (feature, body) => {
        expect(() => new ShaclValidator(ox, shapes(body))).toThrow(ShaclUnsupportedError);
        expect(() => new ShaclValidator(ox, shapes(body))).toThrow(feature);
    });

    it('a type of the SHACL namespace it does not implement', () => {
        const text = `@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix ex: <https://example.org/> .
            ex:C a sh:ConstraintComponent ; sh:parameter [ sh:path ex:p ] .`;
        expect(() => new ShaclValidator(ox, text)).toThrow('sh:ConstraintComponent');
    });

    it('nothing outside the SHACL namespace', () => {
        const v = new ShaclValidator(
            ox,
            `@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix ex: <https://example.org/> .
            @prefix rdfs: <${RDF.replace('1999/02/22-rdf-syntax-ns', '2000/01/rdf-schema')}> .
            ex:S a sh:NodeShape ; rdfs:label "S" ; ex:note "mine" ; sh:targetNode ex:a ;
                sh:property [ sh:path ex:p ; sh:minCount 1 ; sh:name "p" ] .`
        );
        const store = new ox.Store();
        expect(v.validate(store).map((r) => r.component)).toEqual([
            'http://www.w3.org/ns/shacl#MinCountConstraintComponent',
        ]);
    });
});
