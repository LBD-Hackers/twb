/**
 * SHACL validation on Oxigraph: the shapes graph read as it is written, each shape compiled into
 * SPARQL, and the queries run on the data's store. Nothing is hand-coded per shape — the shapes of
 * `ontology/twb-shapes.ttl` are data, and a project's own shapes run the same way.
 *
 * **What is supported** — SHACL Core as far as the TWB shapes need it and a little further, each
 * held to pyshacl's results by `shacl.spec.ts` (`tools/shacl_expected.py`):
 *
 * - Targets: `sh:targetClass` (instances of the class and of its `rdfs:subClassOf*` subclasses),
 *   `sh:targetSubjectsOf`, `sh:targetObjectsOf`, `sh:targetNode`.
 * - Paths: an IRI, `sh:inversePath`, sequences, `sh:alternativePath`, `sh:zeroOrMorePath`,
 *   `sh:oneOrMorePath`, `sh:zeroOrOnePath` — SPARQL's property paths, which they map onto.
 * - Constraints: `sh:minCount`, `sh:maxCount`, `sh:class` (through `rdfs:subClassOf*`),
 *   `sh:datatype` (with the lexical form checked for the XSD types SPARQL can cast to),
 *   `sh:nodeKind`, `sh:minInclusive`, `sh:minExclusive`, `sh:maxInclusive`, `sh:maxExclusive`,
 *   `sh:in`, `sh:hasValue`, `sh:node`, `sh:not`, `sh:and`, `sh:or`, `sh:xone`, nested
 *   `sh:property`, and SHACL-SPARQL's `sh:sparql` with `sh:select`, `sh:prefixes`/`sh:declare`,
 *   `$this` pre-bound to each focus node and `$PATH` on a property shape.
 * - `sh:severity`, `sh:message` (with `{?var}` / `{$var}` filled from a SPARQL solution) and
 *   `sh:deactivated`.
 *
 * Anything else the shapes graph says in the `sh:` namespace — `sh:pattern`, `sh:closed`,
 * `sh:qualifiedValueShape`, SHACL-AF rules, a custom constraint component — is not skipped: the
 * validator refuses the shapes graph with a `ShaclUnsupportedError` naming the feature and the
 * shape, so a report never claims a conformance it did not check.
 *
 * **How.** A focus set is a SPARQL group pattern binding one variable (`Focus`): a target is a
 * subquery, and a shape nested under a property shape (`sh:property`, `sh:node`, a logical
 * constraint's members) is focused on its parent's value nodes by wrapping the parent's pattern.
 * Each constraint is one query returning the focus nodes (and values) that fail it. The logical
 * constraints run their member shapes on the same value nodes and count, per value node, the
 * members it conforms to. A SPARQL constraint gets the target subquery put first in its WHERE
 * clause, which pre-binds `$this` as SHACL's substitution does.
 *
 * Results are deduplicated — two solutions of a SPARQL constraint that say the same thing are one
 * result, as pyshacl reports them.
 */

import {
    RDF,
    RDFS,
    SH,
    XSD,
    PREFIXES,
    compactIri,
    select,
    sparqlTerm,
    termKey,
    termText,
    type Oxigraph,
    type OxStore,
    type OxTerm,
} from './oxigraph';

export type ShaclSeverity = 'Violation' | 'Warning' | 'Info';

/** One validation result, as SHACL's `sh:ValidationResult` has it. */
export interface ShaclResult {
    focus: OxTerm;
    /** The value that failed, where the constraint has one (not for the counts or `sh:hasValue`). */
    value?: OxTerm;
    /** The property shape's path, in SPARQL's syntax with full IRIs: `<…#hasRecipe>`, `^<…>`. */
    path?: string;
    /** The shape the constraint belongs to: its IRI, or that of the named shape holding it. */
    shape: string;
    /** The shape node itself in the shapes graph: an IRI, or `_:id` for an anonymous one. */
    sourceShape: string;
    /** The constraint component, e.g. `http://www.w3.org/ns/shacl#MinCountConstraintComponent`. */
    component: string;
    severity: ShaclSeverity;
    message: string;
}

/** A shapes graph uses a SHACL feature this validator does not implement. */
export class ShaclUnsupportedError extends Error {
    constructor(
        readonly feature: string,
        readonly node: string
    ) {
        super(`SHACL feature not supported: ${feature} (on ${node}).`);
        this.name = 'ShaclUnsupportedError';
    }
}

// ── The compiled shapes ─────────────────────────────────────────────────────────────────────

type Path =
    | { kind: 'iri'; iri: string }
    | { kind: 'inverse'; path: Path }
    | { kind: 'sequence' | 'alternative'; items: Path[] }
    | { kind: 'zeroOrMore' | 'oneOrMore' | 'zeroOrOne'; path: Path };

type Target =
    | { kind: 'class' | 'subjectsOf' | 'objectsOf'; iri: string }
    | { kind: 'node'; term: OxTerm };

type Comparison = 'minInclusive' | 'minExclusive' | 'maxInclusive' | 'maxExclusive';

type Constraint =
    | { kind: 'minCount' | 'maxCount'; n: number }
    | { kind: 'class' | 'datatype' | 'nodeKind'; iri: string }
    | { kind: Comparison; value: OxTerm }
    | { kind: 'in'; values: OxTerm[] }
    | { kind: 'hasValue'; value: OxTerm }
    | { kind: 'node' | 'not'; shape: Shape }
    | { kind: 'and' | 'or' | 'xone'; shapes: Shape[] }
    | { kind: 'sparql'; select: string; prefixes: string; messages: string[] };

interface Shape {
    key: string;
    /** The shape's IRI, or that of the named shape holding it (`ShaclResult.shape`). */
    label: string;
    /** `ShaclResult.sourceShape`. */
    source: string;
    path?: string;
    severity: ShaclSeverity;
    messages: string[];
    deactivated: boolean;
    targets: Target[];
    constraints: Constraint[];
    properties: Shape[];
}

const sh = (local: string) => `${SH}${local}`;

/** What a shape may say: its targets, its constraints, and what does not change a result. */
const SHAPE_TERMS = new Set(
    [
        'targetClass',
        'targetSubjectsOf',
        'targetObjectsOf',
        'targetNode',
        'property',
        'path',
        'minCount',
        'maxCount',
        'class',
        'datatype',
        'nodeKind',
        'minInclusive',
        'minExclusive',
        'maxInclusive',
        'maxExclusive',
        'in',
        'hasValue',
        'node',
        'not',
        'and',
        'or',
        'xone',
        'sparql',
        'severity',
        'message',
        'deactivated',
        'name',
        'description',
        'order',
        'group',
        'defaultValue',
    ].map(sh)
);
const SPARQL_CONSTRAINT_TERMS = new Set(['select', 'message', 'prefixes', 'deactivated'].map(sh));
const PATH_TERMS = new Set(
    ['inversePath', 'alternativePath', 'zeroOrMorePath', 'oneOrMorePath', 'zeroOrOnePath'].map(sh)
);
const PREFIX_TERMS = new Set(['prefix', 'namespace', 'declare'].map(sh));
/** Classes of the shapes graph that are about the graph, not a shape: allowed as types. */
const SHAPE_CLASSES = new Set(
    ['NodeShape', 'PropertyShape', 'Shape', 'SPARQLConstraint', 'PrefixDeclaration'].map(sh)
);

const NODE_KINDS: Record<string, (v: string) => string> = {
    [sh('IRI')]: (v) => `isIRI(${v})`,
    [sh('BlankNode')]: (v) => `isBlank(${v})`,
    [sh('Literal')]: (v) => `isLiteral(${v})`,
    [sh('BlankNodeOrIRI')]: (v) => `(isBlank(${v}) || isIRI(${v}))`,
    [sh('BlankNodeOrLiteral')]: (v) => `(isBlank(${v}) || isLiteral(${v}))`,
    [sh('IRIOrLiteral')]: (v) => `(isIRI(${v}) || isLiteral(${v}))`,
};

/** XSD types SPARQL casts to, so that an ill-formed literal (`"abc"^^xsd:decimal`) fails `sh:datatype`. */
const CASTABLE = new Set(
    ['boolean', 'integer', 'decimal', 'float', 'double', 'dateTime', 'date'].map(
        (t) => `${XSD}${t}`
    )
);

const COMPARISONS: Record<Comparison, string> = {
    minInclusive: '>=',
    minExclusive: '>',
    maxInclusive: '<=',
    maxExclusive: '<',
};

const COMPONENTS: Record<Constraint['kind'], string> = {
    minCount: 'MinCount',
    maxCount: 'MaxCount',
    class: 'Class',
    datatype: 'Datatype',
    nodeKind: 'NodeKind',
    minInclusive: 'MinInclusive',
    minExclusive: 'MinExclusive',
    maxInclusive: 'MaxInclusive',
    maxExclusive: 'MaxExclusive',
    in: 'In',
    hasValue: 'HasValue',
    node: 'Node',
    not: 'Not',
    and: 'And',
    or: 'Or',
    xone: 'Xone',
    sparql: 'SPARQL',
};

/** A focus set: a group pattern binding the variable it is given, once per focus node. */
type Focus = (v: string) => string;

/** The shapes of one shapes graph, compiled; `validate` runs them on a data store. */
export class ShaclValidator {
    private readonly shapes: ShapesGraph;
    private readonly compiled = new Map<string, Shape>();
    private readonly compiling = new Set<string>();
    /** The shapes with targets: what validation starts from. */
    readonly roots: readonly Shape[];
    /** The prefixes the shapes graph declares, for writing messages. */
    readonly prefixes: Record<string, string>;
    private fresh = 0;
    /** The prefixes the messages of the current `validate` are written with: the data's too. */
    private names: Record<string, string> = PREFIXES;

    constructor(ox: Oxigraph, shapesTurtle: string) {
        const store = new ox.Store();
        store.load(shapesTurtle, { format: 'text/turtle' });
        this.shapes = new ShapesGraph(ox, store);
        this.prefixes = { ...PREFIXES, ...this.declaredPrefixes() };
        this.checkVocabulary();
        const roots: Shape[] = [];
        for (const node of this.shapeNodes()) {
            const shape = this.compile(node, null);
            if (shape.targets.length > 0) roots.push(shape);
        }
        this.roots = roots;
    }

    /** How many shapes the graph has, nested ones included. */
    get size(): number {
        return this.compiled.size;
    }

    /**
     * Every result of every shape with a target, on `store`. `prefixes` — the data's own, say —
     * are used besides the shapes graph's to write IRIs in messages.
     */
    validate(store: OxStore, options: { prefixes?: Record<string, string> } = {}): ShaclResult[] {
        this.names = { ...this.prefixes, ...options.prefixes };
        const results: ShaclResult[] = [];
        for (const shape of this.roots)
            results.push(...this.run(store, shape, this.targetFocus(shape)));
        const seen = new Set<string>();
        const unique = results.filter((r) => {
            const key = [
                r.sourceShape,
                r.component,
                termKey(r.focus),
                r.path ?? '',
                r.value ? termKey(r.value) : '',
                r.message,
            ].join('\u0001');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        return unique.sort(
            (a, b) =>
                a.shape.localeCompare(b.shape) ||
                a.component.localeCompare(b.component) ||
                termKey(a.focus).localeCompare(termKey(b.focus))
        );
    }

    // ── Reading the shapes graph ────────────────────────────────────────────────────────────

    private declaredPrefixes(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const q of this.shapes.match(null, sh('declare'))) {
            const p = this.shapes.one(q.object, sh('prefix'));
            const ns = this.shapes.one(q.object, sh('namespace'));
            if (p && ns) out[p.value] = ns.value;
        }
        return out;
    }

    /**
     * Every `sh:` term the graph uses must be one this validator implements: a shape's, a SPARQL
     * constraint's, a path's or a prefix declaration's. A term it does not know is refused here,
     * once, rather than ignored on every run.
     */
    private checkVocabulary(): void {
        const g = this.shapes;
        const aux = new Map<string, Set<string>>();
        const mark = (t: OxTerm, terms: Set<string>) => aux.set(termKey(t), terms);
        for (const q of g.match(null, sh('sparql'))) mark(q.object, SPARQL_CONSTRAINT_TERMS);
        for (const q of g.match(null, sh('declare'))) mark(q.object, PREFIX_TERMS);
        for (const q of g.match(null, sh('path'))) this.markPath(q.object, mark);
        for (const q of g.match(null, `${RDF}first`)) mark(q.subject, new Set());
        for (const q of g.match(null, `${RDF}type`)) {
            const t = q.object.value;
            if (t.startsWith(SH) && !SHAPE_CLASSES.has(t)) {
                throw new ShaclUnsupportedError(compactIri(t), this.name(q.subject));
            }
        }
        for (const q of g.match(null, null)) {
            const p = q.predicate.value;
            if (!p.startsWith(SH)) continue;
            const allowed = aux.get(termKey(q.subject));
            if (p === sh('declare')) continue;
            if (allowed ? allowed.has(p) : SHAPE_TERMS.has(p)) continue;
            throw new ShaclUnsupportedError(compactIri(p), this.name(q.subject));
        }
    }

    private markPath(t: OxTerm, mark: (t: OxTerm, terms: Set<string>) => void): void {
        if (t.termType !== 'BlankNode') return;
        mark(t, PATH_TERMS);
        for (const q of this.shapes.match(t, null)) {
            if (PATH_TERMS.has(q.predicate.value)) this.markPath(q.object, mark);
        }
        for (const item of this.shapes.list(t)) this.markPath(item, mark);
    }

    /** The shapes the graph declares or targets. Nested ones are reached from them. */
    private shapeNodes(): OxTerm[] {
        const out = new Map<string, OxTerm>();
        for (const cls of ['NodeShape', 'PropertyShape']) {
            for (const q of this.shapes.match(null, `${RDF}type`, sh(cls))) {
                out.set(termKey(q.subject), q.subject);
            }
        }
        for (const t of ['targetClass', 'targetSubjectsOf', 'targetObjectsOf', 'targetNode']) {
            for (const q of this.shapes.match(null, sh(t))) out.set(termKey(q.subject), q.subject);
        }
        return [...out.values()].sort((a, b) => termKey(a).localeCompare(termKey(b)));
    }

    private name(t: OxTerm): string {
        return termText(t, this.prefixes);
    }

    private compile(node: OxTerm, parent: Shape | null): Shape {
        const key = termKey(node);
        const known = this.compiled.get(key);
        if (known) return known;
        if (this.compiling.has(key)) {
            throw new ShaclUnsupportedError('recursive shapes', this.name(node));
        }
        this.compiling.add(key);
        const g = this.shapes;
        const at = this.name(node);
        const pathNode = g.one(node, sh('path'));
        const severity = g.one(node, sh('severity'))?.value;
        const shape: Shape = {
            key,
            label:
                node.termType === 'NamedNode' ? node.value : (parent?.label ?? `_:${node.value}`),
            source: node.termType === 'NamedNode' ? node.value : `_:${node.value}`,
            path: pathNode ? pathText(this.readPath(pathNode, at)) : undefined,
            severity:
                severity === sh('Warning')
                    ? 'Warning'
                    : severity === sh('Info')
                      ? 'Info'
                      : 'Violation',
            messages: g.all(node, sh('message')).map((m) => m.value),
            deactivated: g.one(node, sh('deactivated'))?.value === 'true',
            targets: [],
            constraints: [],
            properties: [],
        };
        const iri = (t: OxTerm, what: string): string => {
            if (t.termType !== 'NamedNode') {
                throw new ShaclUnsupportedError(`${what} that is not an IRI`, at);
            }
            return t.value;
        };
        const count = (t: OxTerm, what: string): number => {
            const n = Number(t.value);
            if (t.termType !== 'Literal' || !Number.isInteger(n) || n < 0) {
                throw new ShaclUnsupportedError(`${what} that is not a count`, at);
            }
            return n;
        };
        const value = (t: OxTerm, what: string): OxTerm => {
            if (t.termType === 'BlankNode') {
                throw new ShaclUnsupportedError(`${what} that is a blank node`, at);
            }
            return t;
        };
        for (const q of g.match(node, null)) {
            const o = q.object;
            switch (q.predicate.value.slice(SH.length)) {
                case 'targetClass':
                    shape.targets.push({ kind: 'class', iri: iri(o, 'sh:targetClass') });
                    break;
                case 'targetSubjectsOf':
                    shape.targets.push({ kind: 'subjectsOf', iri: iri(o, 'sh:targetSubjectsOf') });
                    break;
                case 'targetObjectsOf':
                    shape.targets.push({ kind: 'objectsOf', iri: iri(o, 'sh:targetObjectsOf') });
                    break;
                case 'targetNode':
                    shape.targets.push({ kind: 'node', term: value(o, 'sh:targetNode') });
                    break;
                case 'minCount':
                case 'maxCount': {
                    const kind = q.predicate.value === sh('minCount') ? 'minCount' : 'maxCount';
                    if (!shape.path)
                        throw new ShaclUnsupportedError(`sh:${kind} on a node shape`, at);
                    shape.constraints.push({ kind, n: count(o, `sh:${kind}`) });
                    break;
                }
                case 'class':
                case 'datatype':
                case 'nodeKind': {
                    const kind = q.predicate.value.slice(SH.length) as
                        | 'class'
                        | 'datatype'
                        | 'nodeKind';
                    const target = iri(o, `sh:${kind}`);
                    if (kind === 'nodeKind' && !NODE_KINDS[target]) {
                        throw new ShaclUnsupportedError(`sh:nodeKind ${this.name(o)}`, at);
                    }
                    shape.constraints.push({ kind, iri: target });
                    break;
                }
                case 'minInclusive':
                case 'minExclusive':
                case 'maxInclusive':
                case 'maxExclusive': {
                    const kind = q.predicate.value.slice(SH.length) as Comparison;
                    if (o.termType !== 'Literal') {
                        throw new ShaclUnsupportedError(`sh:${kind} that is not a literal`, at);
                    }
                    shape.constraints.push({ kind, value: o });
                    break;
                }
                case 'in':
                    shape.constraints.push({
                        kind: 'in',
                        values: g.list(o).map((t) => value(t, 'a member of sh:in')),
                    });
                    break;
                case 'hasValue':
                    shape.constraints.push({ kind: 'hasValue', value: value(o, 'sh:hasValue') });
                    break;
                case 'node':
                case 'not': {
                    const kind = q.predicate.value === sh('node') ? 'node' : 'not';
                    shape.constraints.push({ kind, shape: this.compile(o, shape) });
                    break;
                }
                case 'and':
                case 'or':
                case 'xone': {
                    const kind = q.predicate.value.slice(SH.length) as 'and' | 'or' | 'xone';
                    shape.constraints.push({
                        kind,
                        shapes: g.list(o).map((m) => this.compile(m, shape)),
                    });
                    break;
                }
                case 'property':
                    shape.properties.push(this.compile(o, shape));
                    break;
                case 'sparql':
                    if (g.one(o, sh('deactivated'))?.value === 'true') break;
                    shape.constraints.push(this.readSparql(o, at, shape));
                    break;
            }
        }
        this.compiling.delete(key);
        this.compiled.set(key, shape);
        return shape;
    }

    private readSparql(node: OxTerm, at: string, shape: Shape): Constraint {
        const g = this.shapes;
        const query = g.one(node, sh('select'))?.value;
        if (!query) throw new ShaclUnsupportedError('a SPARQL constraint without sh:select', at);
        for (const pre of ['currentShape', 'shapesGraph']) {
            if (new RegExp(`\\$${pre}\\b`).test(query)) {
                throw new ShaclUnsupportedError(`$${pre} in a SPARQL constraint`, at);
            }
        }
        if (/\$PATH\b/.test(query) && !shape.path) {
            throw new ShaclUnsupportedError('$PATH in a node shape', at);
        }
        const prefixes: string[] = [];
        for (const from of g.all(node, sh('prefixes'))) {
            for (const d of g.all(from, sh('declare'))) {
                const p = g.one(d, sh('prefix'));
                const ns = g.one(d, sh('namespace'));
                if (p && ns) prefixes.push(`PREFIX ${p.value}: <${ns.value}>`);
            }
        }
        return {
            kind: 'sparql',
            select: query,
            prefixes: prefixes.join('\n'),
            messages: g.all(node, sh('message')).map((m) => m.value),
        };
    }

    private readPath(node: OxTerm, at: string): Path {
        if (node.termType === 'NamedNode') return { kind: 'iri', iri: node.value };
        const g = this.shapes;
        const one = (p: string) => g.one(node, sh(p));
        const inverse = one('inversePath');
        if (inverse) return { kind: 'inverse', path: this.readPath(inverse, at) };
        const alternatives = one('alternativePath');
        if (alternatives) {
            return {
                kind: 'alternative',
                items: g.list(alternatives).map((p) => this.readPath(p, at)),
            };
        }
        for (const kind of ['zeroOrMore', 'oneOrMore', 'zeroOrOne'] as const) {
            const inner = one(`${kind}Path`);
            if (inner) return { kind, path: this.readPath(inner, at) };
        }
        const items = g.list(node);
        if (items.length > 0) {
            return { kind: 'sequence', items: items.map((p) => this.readPath(p, at)) };
        }
        throw new ShaclUnsupportedError('a path of this form', at);
    }

    // ── Running the shapes ──────────────────────────────────────────────────────────────────

    private var(): string {
        return `_v${++this.fresh}`;
    }

    /** The focus nodes of a shape's targets. */
    private targetFocus(shape: Shape): Focus {
        return (v) => {
            const parts = shape.targets.map((t) => {
                switch (t.kind) {
                    case 'class':
                        return `{ ?${v} <${RDF}type>/<${RDFS}subClassOf>* <${t.iri}> }`;
                    case 'subjectsOf':
                        return `{ ?${v} <${t.iri}> ?${this.var()} }`;
                    case 'objectsOf':
                        return `{ ?${this.var()} <${t.iri}> ?${v} }`;
                    case 'node':
                        return `{ VALUES ?${v} { ${sparqlTerm(t.term)} } }`;
                }
            });
            return `{ SELECT DISTINCT ?${v} WHERE { ${parts.join(' UNION ')} } }`;
        };
    }

    /** A pattern binding `?this` to each focus node and `?value` to each of its value nodes. */
    private valuePairs(shape: Shape, focus: Focus): string {
        return shape.path
            ? `${focus('this')} ?this ${shape.path} ?value .`
            : `${focus('this')} BIND (?this AS ?value)`;
    }

    /** The focus set of what is nested under `shape`: its value nodes. */
    private valueFocus(shape: Shape, focus: Focus): Focus {
        const path = shape.path;
        if (!path) return focus;
        return (v) => {
            const f = this.var();
            return `{ SELECT DISTINCT ?${v} WHERE { ${focus(f)} ?${f} ${path} ?${v} . } }`;
        };
    }

    private run(store: OxStore, shape: Shape, focus: Focus): ShaclResult[] {
        if (shape.deactivated) return [];
        const out: ShaclResult[] = [];
        for (const c of shape.constraints) out.push(...this.check(store, shape, c, focus));
        const nested = this.valueFocus(shape, focus);
        for (const p of shape.properties) out.push(...this.run(store, p, nested));
        return out;
    }

    private check(store: OxStore, shape: Shape, c: Constraint, focus: Focus): ShaclResult[] {
        const result = (
            focusNode: OxTerm,
            value: OxTerm | undefined,
            message: string
        ): ShaclResult => ({
            focus: focusNode,
            ...(value ? { value } : {}),
            ...(shape.path ? { path: shape.path } : {}),
            shape: shape.label,
            sourceShape: shape.source,
            component: `${SH}${COMPONENTS[c.kind]}ConstraintComponent`,
            severity: shape.severity,
            message,
        });
        const message = (fallback: string, value?: OxTerm) =>
            shape.messages[0] ?? `${fallback}${value ? ` (${termText(value, this.names)})` : ''}`;
        const on = shape.path ? ` of ${this.pathName(shape.path)}` : '';

        switch (c.kind) {
            case 'minCount':
            case 'maxCount': {
                const op = c.kind === 'minCount' ? '<' : '>';
                const rows = select(
                    store,
                    `SELECT ?this WHERE { ${focus('this')} OPTIONAL { ?this ${shape.path} ?value } }
                    GROUP BY ?this HAVING (COUNT(DISTINCT ?value) ${op} ${c.n})`
                );
                const text =
                    c.kind === 'minCount'
                        ? `Fewer than ${c.n} values${on}`
                        : `More than ${c.n} values${on}`;
                return rows.map((r) => result(r.get('this')!, undefined, message(text)));
            }
            case 'hasValue': {
                const v = sparqlTerm(c.value);
                const rows = select(
                    store,
                    shape.path
                        ? `SELECT ?this WHERE { ${focus('this')} FILTER NOT EXISTS { ?this ${shape.path} ${v} } }`
                        : `SELECT ?this WHERE { ${focus('this')} FILTER (!sameTerm(?this, ${v})) }`
                );
                const text = `Missing the value ${termText(c.value, this.names)}${on}`;
                return rows.map((r) => result(r.get('this')!, undefined, message(text)));
            }
            case 'node':
            case 'not':
            case 'and':
            case 'or':
            case 'xone':
                return this.logical(store, shape, c, focus, result, message);
            case 'sparql':
                return this.sparql(store, shape, c, focus, result);
            default: {
                const failing = this.valueCondition(c, '?value');
                const rows = select(
                    store,
                    `SELECT ?this ?value WHERE { ${this.valuePairs(shape, focus)} FILTER (${failing}) }`
                );
                const text = this.valueMessage(c) + on;
                return rows.map((r) => {
                    const v = r.get('value')!;
                    return result(r.get('this')!, v, message(text, v));
                });
            }
        }
    }

    /** A SPARQL expression true where `v` fails a constraint on single value nodes. */
    private valueCondition(c: Constraint, v: string): string {
        switch (c.kind) {
            case 'class':
                return `NOT EXISTS { ${v} <${RDF}type>/<${RDFS}subClassOf>* <${c.iri}> }`;
            case 'datatype': {
                const wellFormed = CASTABLE.has(c.iri)
                    ? ` && !isIRI(COALESCE(<${c.iri}>(${v}), <urn:x-twb:ill-formed>))`
                    : '';
                return `!(isLiteral(${v}) && datatype(${v}) = <${c.iri}>${wellFormed})`;
            }
            case 'nodeKind':
                return `!${NODE_KINDS[c.iri]!(v)}`;
            case 'minInclusive':
            case 'minExclusive':
            case 'maxInclusive':
            case 'maxExclusive':
                // Not comparable — an IRI, a string against a number — fails, as SHACL says.
                return `!COALESCE(${v} ${COMPARISONS[c.kind]} ${sparqlTerm(c.value)}, false)`;
            case 'in':
                return `!(${c.values.map((t) => `sameTerm(${v}, ${sparqlTerm(t)})`).join(' || ') || 'false'})`;
            default:
                throw new Error(`not a value constraint: ${c.kind}`);
        }
    }

    private valueMessage(c: Constraint): string {
        switch (c.kind) {
            case 'class':
                return `Value is not a ${compactIri(c.iri, this.names)}`;
            case 'datatype':
                return `Value is not a well-formed ${compactIri(c.iri, this.names)}`;
            case 'nodeKind':
                return `Value is not of node kind ${compactIri(c.iri, this.names)}`;
            case 'minInclusive':
            case 'minExclusive':
            case 'maxInclusive':
            case 'maxExclusive':
                return `Value is not ${COMPARISONS[c.kind]} ${termText(c.value, this.names)}`;
            case 'in':
                return `Value is not one of ${c.values.map((t) => termText(t, this.names)).join(', ')}`;
            default:
                return c.kind;
        }
    }

    /**
     * `sh:node`, `sh:not`, `sh:and`, `sh:or`, `sh:xone`: the member shapes run on this shape's
     * value nodes; a value node conforms to a member when the member reports nothing on it.
     */
    private logical(
        store: OxStore,
        shape: Shape,
        c: Extract<Constraint, { kind: 'node' | 'not' | 'and' | 'or' | 'xone' }>,
        focus: Focus,
        result: (f: OxTerm, v: OxTerm | undefined, m: string) => ShaclResult,
        message: (fallback: string, value?: OxTerm) => string
    ): ShaclResult[] {
        const members: Shape[] = 'shape' in c ? [c.shape] : c.shapes;
        const nested = this.valueFocus(shape, focus);
        const failing = members.map(
            (m) => new Set(this.run(store, m, nested).map((r) => termKey(r.focus)))
        );
        const out: ShaclResult[] = [];
        for (const row of select(
            store,
            `SELECT ?this ?value WHERE { ${this.valuePairs(shape, focus)} }`
        )) {
            const v = row.get('value')!;
            const conforms = failing.filter((f) => !f.has(termKey(v))).length;
            const fails =
                c.kind === 'node' || c.kind === 'and'
                    ? conforms < members.length
                    : c.kind === 'not'
                      ? conforms > 0
                      : c.kind === 'or'
                        ? conforms === 0
                        : conforms !== 1;
            if (!fails) continue;
            const text =
                c.kind === 'node'
                    ? `Value does not conform to ${this.shapeName(c.shape)}`
                    : c.kind === 'not'
                      ? `Value conforms to ${this.shapeName(c.shape)}, which it must not`
                      : c.kind === 'xone'
                        ? `Value conforms to ${conforms} of the sh:xone shapes, not exactly one`
                        : c.kind === 'or'
                          ? 'Value conforms to none of the sh:or shapes'
                          : 'Value does not conform to every one of the sh:and shapes';
            out.push(result(row.get('this')!, v, message(text, shape.path ? v : undefined)));
        }
        return out;
    }

    /** A SHACL-SPARQL constraint: `$this` pre-bound by putting the focus subquery first. */
    private sparql(
        store: OxStore,
        shape: Shape,
        c: Extract<Constraint, { kind: 'sparql' }>,
        focus: Focus,
        result: (f: OxTerm, v: OxTerm | undefined, m: string) => ShaclResult
    ): ShaclResult[] {
        let query = c.select.replace(/\$this\b/g, '?this');
        if (shape.path) query = query.replace(/\$PATH\b/g, shape.path);
        const open = query.indexOf('{');
        if (open < 0)
            throw new ShaclUnsupportedError(
                'a SPARQL constraint without a WHERE clause',
                shape.label
            );
        query = `${c.prefixes}\n${query.slice(0, open + 1)} ${focus('this')} ${query.slice(open + 1)}`;
        const template =
            c.messages[0] ?? shape.messages[0] ?? 'The SPARQL constraint reports this node.';
        return select(store, query).map((row) => {
            const f = row.get('this')!;
            const text = template.replace(/\{[?$](\w+)\}/g, (_, name: string) => {
                const t = row.get(name);
                return t
                    ? t.termType === 'Literal'
                        ? t.value
                        : termText(t, this.names)
                    : `{?${name}}`;
            });
            return result(f, row.get('value') ?? (shape.path ? undefined : f), text);
        });
    }

    private pathName(path: string): string {
        return path.replace(/<([^>]+)>/g, (_, iri: string) => compactIri(iri, this.names));
    }

    private shapeName(shape: Shape): string {
        return shape.source.startsWith('_:') ? 'its shape' : compactIri(shape.source, this.names);
    }
}

/** A path in SPARQL's syntax, full IRIs: what `ShaclResult.path` holds and the queries use. */
function pathText(p: Path): string {
    switch (p.kind) {
        case 'iri':
            return `<${p.iri}>`;
        case 'inverse':
            return `^${pathText(p.path)}`;
        case 'sequence':
            return `(${p.items.map(pathText).join('/')})`;
        case 'alternative':
            return `(${p.items.map(pathText).join('|')})`;
        case 'zeroOrMore':
            return `(${pathText(p.path)})*`;
        case 'oneOrMore':
            return `(${pathText(p.path)})+`;
        case 'zeroOrOne':
            return `(${pathText(p.path)})?`;
    }
}

/** The shapes graph, with the few ways of reading it the compiler needs. */
class ShapesGraph {
    constructor(
        private readonly ox: Oxigraph,
        private readonly store: OxStore
    ) {}

    match(s: OxTerm | null, p: string | null, o?: string): ReturnType<OxStore['match']> {
        return this.store.match(
            s,
            p ? this.ox.namedNode(p) : null,
            o ? this.ox.namedNode(o) : null,
            null
        );
    }

    all(s: OxTerm, p: string): OxTerm[] {
        return this.match(s, p).map((q) => q.object);
    }

    one(s: OxTerm, p: string): OxTerm | undefined {
        return this.all(s, p)[0];
    }

    /** An RDF list's members, in order. */
    list(head: OxTerm): OxTerm[] {
        const out: OxTerm[] = [];
        let node: OxTerm | undefined = head;
        const seen = new Set<string>();
        while (node && node.value !== `${RDF}nil` && !seen.has(termKey(node))) {
            seen.add(termKey(node));
            const first = this.one(node, `${RDF}first`);
            if (!first) break;
            out.push(first);
            node = this.one(node, `${RDF}rest`);
        }
        return out;
    }
}
