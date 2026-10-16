/**
 * The ontology (`data/ontology.json`, captured from `twb.ttl` and its modules) as the nodes and links the schema
 * graph lays out, in the VOWL notation WebVOWL draws: a class is a circle, a class from another
 * ontology (BOT, PROV, GeoSPARQL, SKOS) a dark circle, an object property a labelled arrow from
 * its domain to its range, and a subclass a dashed arrow to its superclass.
 */

import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import ontology from '../data/ontology.json';

export type ModuleId = (typeof ontology.modules)[number]['id'];

export interface OntologyClass {
    id: string;
    label: string;
    comment: string | null;
    archTerm: string | null;
    ifc: string | null;
    module: string;
    superClasses: string[];
    instances: number;
}

export interface OntologyProperty {
    id: string;
    label: string;
    comment: string | null;
    archTerm: string | null;
    module: string;
    domain: string[];
    range: string[];
    superProperties: string[];
    functional: boolean;
    uses: number;
}

export const data = ontology as unknown as {
    version: string;
    modules: {
        id: ModuleId;
        iri: string;
        label: { da: string; en: string };
        description: string;
        imports: string[];
        classes: number;
        objectProperties: number;
        datatypeProperties: number;
    }[];
    classes: OntologyClass[];
    externalClasses: { id: string; label: string; prefix: string }[];
    objectProperties: OntologyProperty[];
    datatypeProperties: OntologyProperty[];
};

export { MODULE_COLOURS } from './modules';

/** The modules the graph draws and filters by: those that define classes (the house file's has none). */
export const graphModules = data.modules.filter((m) => m.classes > 0);

export interface GraphNode extends SimulationNodeDatum {
    id: string;
    label: string;
    external: boolean;
    module: ModuleId | null;
    r: number;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
    id: string;
    source: string | GraphNode;
    target: string | GraphNode;
    kind: 'subclass' | 'property';
    label: string;
    /** This link's place among the links between the same two nodes, for the curve. */
    lane: number;
    lanes: number;
}

export interface GraphOptions {
    modules: ReadonlySet<string>;
    /** Show the classes TWB borrows from BOT, PROV, GeoSPARQL and SKOS. */
    external: boolean;
    /** Show the SKOS vocabularies (edge types, ceiling kinds, …) as classes. */
    vocabularies: boolean;
}

const classById = new Map(data.classes.map((c) => [c.id, c]));

/** A class's direct subclasses. */
export const subClassesOf = (id: string): OntologyClass[] =>
    data.classes.filter((c) => c.superClasses.includes(id));

/** Individuals of a class and of all its subclasses in the case house. */
export function instancesOf(id: string, seen = new Set<string>()): number {
    if (seen.has(id)) return 0;
    seen.add(id);
    const own = classById.get(id)?.instances ?? 0;
    return own + subClassesOf(id).reduce((n, c) => n + instancesOf(c.id, seen), 0);
}

const isVocabulary = (c: OntologyClass) => c.superClasses.includes('skos:Concept');

export function buildGraph(opts: GraphOptions): { nodes: GraphNode[]; links: GraphLink[] } {
    const nodes = new Map<string, GraphNode>();
    for (const c of data.classes) {
        if (!opts.modules.has(c.module)) continue;
        if (!opts.vocabularies && isVocabulary(c)) continue;
        const degree =
            subClassesOf(c.id).length +
            data.objectProperties.filter((p) => p.domain.includes(c.id) || p.range.includes(c.id))
                .length;
        nodes.set(c.id, {
            id: c.id,
            label: c.label,
            external: false,
            module: c.module as ModuleId,
            r: 24 + Math.min(18, Math.sqrt(degree) * 4),
        });
    }
    if (opts.external) {
        for (const e of data.externalClasses) {
            if (e.id === 'skos:Concept' && !opts.vocabularies) continue;
            nodes.set(e.id, { id: e.id, label: e.id, external: true, module: null, r: 30 });
        }
    }

    const raw: Omit<GraphLink, 'lane' | 'lanes'>[] = [];
    for (const c of data.classes) {
        for (const s of c.superClasses) {
            if (nodes.has(c.id) && nodes.has(s)) {
                raw.push({
                    id: `${c.id}⊑${s}`,
                    source: c.id,
                    target: s,
                    kind: 'subclass',
                    label: '',
                });
            }
        }
    }
    for (const p of data.objectProperties) {
        for (const d of p.domain) {
            for (const r of p.range) {
                if (nodes.has(d) && nodes.has(r)) {
                    raw.push({
                        id: `${p.id}:${d}→${r}`,
                        source: d,
                        target: r,
                        kind: 'property',
                        label: p.label,
                    });
                }
            }
        }
    }

    // Links between the same pair of nodes, either way, fan out into lanes.
    const pairKey = (l: { source: string | GraphNode; target: string | GraphNode }) =>
        [id(l.source), id(l.target)].sort().join('|');
    const byPair = new Map<string, number>();
    for (const l of raw) byPair.set(pairKey(l), (byPair.get(pairKey(l)) ?? 0) + 1);
    const seen = new Map<string, number>();
    const links = raw.map((l) => {
        const key = pairKey(l);
        const lane = seen.get(key) ?? 0;
        seen.set(key, lane + 1);
        return { ...l, lane, lanes: byPair.get(key)! };
    });
    return { nodes: [...nodes.values()], links };
}

export const id = (n: string | GraphNode): string => (typeof n === 'string' ? n : n.id);

/** What the side panel says about a class: its place in the hierarchy and its properties. */
export function classDetail(classId: string) {
    const c = classById.get(classId);
    const external = data.externalClasses.find((e) => e.id === classId);
    return {
        cls: c ?? null,
        external: external ?? null,
        superClasses: c?.superClasses ?? [],
        subClasses: data.classes.filter((s) => s.superClasses.includes(classId)).map((s) => s.id),
        outgoing: data.objectProperties.filter((p) => p.domain.includes(classId)),
        incoming: data.objectProperties.filter((p) => p.range.includes(classId)),
        attributes: data.datatypeProperties.filter((p) => p.domain.includes(classId)),
        instances: instancesOf(classId),
    };
}

export const labelOf = (classId: string): string =>
    classById.get(classId)?.label ??
    data.externalClasses.find((e) => e.id === classId)?.id ??
    classId;
