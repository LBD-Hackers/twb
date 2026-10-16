/**
 * The reference: every term TWB's modules define, one card each, and the SHACL shapes that check
 * them. Each card's anchor is the term's local name (`#Surface`), so `https://w3id.org/twb#Surface`
 * lands on it once a browser is sent here. Read from `src/data/reference.json`
 * (`scripts/capture-reference.mjs`), which is captured from `ontology/` before every build.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import reference from '../data/reference.json';
import { BASE } from '../copy';
import { MODULE_COLOURS } from '../model/modules';
import './reference.css';

type Kind =
    | 'class'
    | 'objectProperty'
    | 'datatypeProperty'
    | 'annotationProperty'
    | 'scheme'
    | 'individual';

interface Alignment {
    predicate: string;
    object: string;
    iri: string;
}

interface Term {
    id: string;
    iri: string;
    kind: Kind;
    module: string;
    label: string;
    comment: string | null;
    definition: string | null;
    notation: string | null;
    archTerm: string | null;
    ifc: string | null;
    unit: string | null;
    deprecated: boolean;
    alignments: Alignment[];
    shapes: { shape: string; as: 'target' | 'path' }[];
    superClasses?: string[];
    subClasses?: string[];
    equivalent?: string[];
    disjointWith?: string[];
    instances?: string[];
    domain?: string[];
    range?: string[];
    superProperties?: string[];
    subProperties?: string[];
    inverseOf?: string[];
    characteristics?: string[];
    members?: string[];
    types?: string[];
    inScheme?: string[];
    broader?: string[];
}

interface Shape {
    id: string;
    label: string;
    comment: string | null;
    targetClass: string[];
    targetSubjectsOf: string[];
    targetObjectsOf: string[];
    properties: { path: string; property: string | null; constraints: Record<string, string> }[];
    alternatives: string[];
    sparql: string[];
}

const TERMS = reference.terms as Term[];
const SHAPES = reference.shapes as Shape[];
const BY_ID = new Map(TERMS.map((t) => [t.id, t]));

const KIND_LABELS: Record<Kind, string> = {
    class: 'Class',
    objectProperty: 'Object property',
    datatypeProperty: 'Datatype property',
    annotationProperty: 'Annotation property',
    scheme: 'Concept scheme',
    individual: 'Concept',
};

const KIND_PLURALS: Record<Kind, string> = {
    class: 'Classes',
    objectProperty: 'Object properties',
    datatypeProperty: 'Datatype properties',
    annotationProperty: 'Annotation properties',
    scheme: 'Concept schemes',
    individual: 'Concepts',
};

const KIND_ORDER: Kind[] = [
    'class',
    'objectProperty',
    'datatypeProperty',
    'scheme',
    'individual',
    'annotationProperty',
];

/** Where an IRI outside TWB is documented: the namespace's own page. */
const EXTERNAL: Record<string, string> = {
    bot: 'https://w3id.org/bot#',
    prov: 'http://www.w3.org/ns/prov#',
    geo: 'http://www.opengis.net/ont/geosparql#',
    skos: 'http://www.w3.org/2004/02/skos/core#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    owl: 'http://www.w3.org/2002/07/owl#',
    opm: 'https://w3id.org/opm#',
    bpo: 'https://w3id.org/bpo#',
    sml: 'https://w3id.org/sml#',
    dicm: 'https://w3id.org/digitalconstruction/0.5/Materials#',
    ifc: 'https://standards.buildingsmart.org/IFC/DEV/IFC4/ADD2_TC1/OWL#',
    unit: 'http://qudt.org/vocab/unit/',
    dcterms: 'http://purl.org/dc/terms/',
};

const anchorOf = (id: string) => id.replace(/^\w+:/, '');
const shapeAnchor = (id: string) => `shape-${anchorOf(id)}`;

/** A term by its prefixed name: a link to its card, or to its own ontology's IRI. */
function TermRef({ id }: { id: string }) {
    const own = BY_ID.get(id);
    if (own) {
        return (
            <a href={`#${anchorOf(id)}`} className={`ref-term is-${own.kind}`}>
                {id}
            </a>
        );
    }
    const [prefix, local] = id.split(':');
    const ns = prefix && local !== undefined ? EXTERNAL[prefix] : undefined;
    return ns ? (
        <a href={`${ns}${local}`} className="ref-term is-external">
            {id}
        </a>
    ) : (
        <code className="ref-term">{id}</code>
    );
}

function Refs({ ids }: { ids: string[] | undefined }) {
    if (!ids?.length) return null;
    return (
        <span className="ref-list">
            {ids.map((id) => (
                <TermRef key={id} id={id} />
            ))}
        </span>
    );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    if (children === null || children === undefined || children === false) return null;
    return (
        <div className="ref-row">
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}

const has = (list: string[] | undefined) => (list?.length ? <Refs ids={list} /> : null);

function TermCard({ term }: { term: Term }) {
    return (
        <article
            id={anchorOf(term.id)}
            className={`ref-card${term.deprecated ? ' is-deprecated' : ''}`}
        >
            <header className="ref-card-head">
                <h3>
                    {term.label}
                    {term.deprecated && <span className="ref-badge is-deprecated">deprecated</span>}
                </h3>
                <span className={`ref-badge is-${term.kind}`}>{KIND_LABELS[term.kind]}</span>
                <a href={`${BASE}#modul-${term.module}`} className="ref-badge is-module">
                    <span
                        className="module-dot"
                        style={{ background: MODULE_COLOURS[term.module] ?? 'var(--muted)' }}
                        aria-hidden
                    />
                    {term.module}
                </a>
            </header>
            <p className="ref-iri">
                <code>{term.iri}</code>
                <button
                    type="button"
                    className="ref-copy"
                    onClick={() => void navigator.clipboard?.writeText(term.iri)}
                    title="Copy the IRI"
                >
                    copy
                </button>
            </p>
            {term.comment && <p className="ref-text">{term.comment}</p>}
            {term.definition && term.definition !== term.comment && (
                <p className="ref-text">{term.definition}</p>
            )}
            <dl className="ref-facts">
                <Row label="Subclass of">{has(term.superClasses)}</Row>
                <Row label="Subclasses">{has(term.subClasses)}</Row>
                <Row label="Equivalent to">{has(term.equivalent)}</Row>
                <Row label="Disjoint with">{has(term.disjointWith)}</Row>
                <Row label="Members">{has(term.instances)}</Row>
                <Row label="Domain">{has(term.domain)}</Row>
                <Row label="Range">{has(term.range)}</Row>
                <Row label="Subproperty of">{has(term.superProperties)}</Row>
                <Row label="Subproperties">{has(term.subProperties)}</Row>
                <Row label="Inverse of">{has(term.inverseOf)}</Row>
                <Row label="Characteristics">
                    {term.characteristics?.length ? term.characteristics.join(', ') : null}
                </Row>
                <Row label="Concepts">{has(term.members)}</Row>
                <Row label="Type">{has(term.types)}</Row>
                <Row label="In scheme">{has(term.inScheme)}</Row>
                <Row label="Broader">{has(term.broader)}</Row>
                <Row label="Notation">
                    {term.notation ? <code>{term.notation}</code> : null}
                </Row>
                <Row label="Unit">{term.unit ? <TermRef id={term.unit} /> : null}</Row>
                <Row label="In IFC">{term.ifc}</Row>
                <Row label="In arch">{term.archTerm}</Row>
                <Row label="Aligned with">
                    {term.alignments.length ? (
                        <span className="ref-list">
                            {term.alignments.map((a) => (
                                <span key={`${a.predicate} ${a.iri}`}>
                                    <code className="ref-pred">{a.predicate}</code>{' '}
                                    <a href={a.iri} className="ref-term is-external">
                                        {a.object}
                                    </a>
                                </span>
                            ))}
                        </span>
                    ) : null}
                </Row>
                <Row label="Checked by">
                    {term.shapes.length ? (
                        <span className="ref-list">
                            {term.shapes.map((s) => (
                                <a
                                    key={`${s.shape} ${s.as}`}
                                    href={`#${shapeAnchor(s.shape)}`}
                                    className="ref-term is-shape"
                                    title={s.as === 'target' ? 'the shape’s target' : 'a property the shape constrains'}
                                >
                                    {s.shape}
                                    {s.as === 'path' ? ' (property)' : ''}
                                </a>
                            ))}
                        </span>
                    ) : null}
                </Row>
            </dl>
        </article>
    );
}

const CONSTRAINT_TEXT: Record<string, (v: string) => string> = {
    minCount: (v) => `at least ${v}`,
    maxCount: (v) => `at most ${v}`,
    class: (v) => `of class ${v}`,
    datatype: (v) => `of type ${v}`,
    nodeKind: (v) => `a ${v.replace(/^sh:/, '')}`,
    hasValue: (v) => `has ${v}`,
    minInclusive: (v) => `≥ ${v}`,
    maxInclusive: (v) => `≤ ${v}`,
    minExclusive: (v) => `> ${v}`,
    maxExclusive: (v) => `< ${v}`,
    pattern: (v) => `matches /${v}/`,
    node: (v) => `conforms to ${v}`,
    in: (v) => `one of ${v}`,
};

function ShapeCard({ shape }: { shape: Shape }) {
    const targets = [
        ...shape.targetClass,
        ...shape.targetSubjectsOf.map((p) => `subjects of ${p}`),
        ...shape.targetObjectsOf.map((p) => `objects of ${p}`),
    ];
    return (
        <article id={shapeAnchor(shape.id)} className="ref-card is-shape">
            <header className="ref-card-head">
                <h3>{shape.label}</h3>
                <span className="ref-badge is-shape">Node shape</span>
            </header>
            <p className="ref-iri">
                <code>{shape.id.replace(/^twbsh:/, 'https://w3id.org/twb/shapes#')}</code>
            </p>
            {shape.comment && <p className="ref-text">{shape.comment}</p>}
            <dl className="ref-facts">
                <Row label="Checks">
                    <span className="ref-list">
                        {targets.map((t) =>
                            t.includes(' ') ? <span key={t}>{t}</span> : <TermRef key={t} id={t} />
                        )}
                    </span>
                </Row>
            </dl>
            {shape.properties.length > 0 && (
                <table className="ref-constraints">
                    <thead>
                        <tr>
                            <th>Property</th>
                            <th>Constraint</th>
                            <th>Says</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shape.properties.map((p, i) => {
                            const { message, severity, ...rest } = p.constraints;
                            return (
                                <tr key={i}>
                                    <td>
                                        {p.path.startsWith('^') ? '^ ' : ''}
                                        {p.property ? <TermRef id={p.property} /> : p.path}
                                    </td>
                                    <td>
                                        {Object.entries(rest)
                                            .map(([k, v]) => CONSTRAINT_TEXT[k]?.(v) ?? `${k} ${v}`)
                                            .join(', ')}
                                        {severity && severity !== 'sh:Violation' && (
                                            <span className="ref-badge is-warning">
                                                {severity.replace(/^sh:/, '').toLowerCase()}
                                            </span>
                                        )}
                                    </td>
                                    <td>{message ?? ''}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
            {shape.alternatives.length > 0 && (
                <p className="ref-text">
                    One of: <Refs ids={shape.alternatives} />
                </p>
            )}
            {shape.sparql.length > 0 && (
                <ul className="ref-sparql">
                    {shape.sparql.map((m) => (
                        <li key={m}>
                            <span className="ref-badge is-sparql">SPARQL</span> {m}
                        </li>
                    ))}
                </ul>
            )}
        </article>
    );
}

/** Jump to the term in the URL's hash once the cards are on the page. */
function useHashJump(): void {
    useEffect(() => {
        if (!location.hash) return;
        const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        el?.scrollIntoView({ block: 'start' });
        el?.classList.add('is-target');
    }, []);
}

export function Reference() {
    useHashJump();
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState<Kind | 'all'>('all');
    const [module, setModule] = useState<string>('all');
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return TERMS.filter(
            (t) =>
                (kind === 'all' || t.kind === kind) &&
                (module === 'all' || t.module === module) &&
                (!q ||
                    t.id.toLowerCase().includes(q) ||
                    t.label.toLowerCase().includes(q) ||
                    (t.comment ?? '').toLowerCase().includes(q) ||
                    (t.definition ?? '').toLowerCase().includes(q))
        );
    }, [query, kind, module]);
    const counts = (k: Kind) => TERMS.filter((t) => t.kind === k).length;
    return (
        <section className="section ref-page">
            <div className="wrap">
                <header className="section-head">
                    <p className="kicker">Reference · TWB {reference.version}</p>
                    <h2>Every class and property</h2>
                    <p className="lead">
                        The {TERMS.length} terms TWB’s modules define, in the one namespace{' '}
                        <code>https://w3id.org/twb#</code>, with their definitions, their place in
                        the hierarchy, their alignments with other ontologies and the SHACL shapes
                        that check them. A term’s card is at its local name:{' '}
                        <a href="#Surface">#Surface</a>. The modules and how they import each other
                        are on the <a href={`${BASE}#moduler`}>data model page</a>.
                    </p>
                </header>
                <div className="ref-layout">
                    <aside className="ref-side" aria-label="Filter">
                        <input
                            type="search"
                            className="ref-search"
                            placeholder="Find a term…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        <div className="ref-filter">
                            <button
                                type="button"
                                className={kind === 'all' ? 'is-on' : ''}
                                onClick={() => setKind('all')}
                            >
                                All <span>{TERMS.length}</span>
                            </button>
                            {KIND_ORDER.map((k) => (
                                <button
                                    key={k}
                                    type="button"
                                    className={kind === k ? 'is-on' : ''}
                                    onClick={() => setKind(k)}
                                >
                                    {KIND_PLURALS[k]} <span>{counts(k)}</span>
                                </button>
                            ))}
                        </div>
                        <select
                            className="ref-module"
                            value={module}
                            onChange={(e) => setModule(e.target.value)}
                            aria-label="Module"
                        >
                            <option value="all">Every module</option>
                            {reference.modules.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.id} — {m.title?.replace(/^TWB /, '') ?? m.id}
                                </option>
                            ))}
                        </select>
                        <nav className="ref-index" aria-label="Terms">
                            {shown.map((t) => (
                                <a key={t.id} href={`#${anchorOf(t.id)}`} className={`is-${t.kind}`}>
                                    {anchorOf(t.id)}
                                </a>
                            ))}
                            <a href="#shapes" className="is-shape">
                                SHACL shapes
                            </a>
                        </nav>
                    </aside>
                    <div className="ref-main">
                        {shown.length === 0 && <p className="ref-text">No term matches.</p>}
                        {shown.map((t) => (
                            <TermCard key={t.id} term={t} />
                        ))}
                        <h2 id="shapes" className="ref-shapes-head">
                            SHACL shapes
                        </h2>
                        <p className="ref-text">
                            What a well-formed blueprint is, and whether its construction meets the
                            requirements its zones put on it:{' '}
                            <a href={`${BASE}ontology/twb-shapes.ttl`}>twb-shapes.ttl</a>, the
                            module <code>https://w3id.org/twb/shapes</code>. The{' '}
                            <a href={`${BASE}validate/`}>validator</a> runs them in your browser.
                        </p>
                        {SHAPES.map((s) => (
                            <ShapeCard key={s.id} shape={s} />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
