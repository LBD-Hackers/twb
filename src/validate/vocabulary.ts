/**
 * The vocabulary check: whether the `twb:` terms a graph uses are terms of TWB, and whether the
 * catalogue values it names are in arch's catalogue. The same for a house file read as JSON-LD and
 * for a graph; `tools/twb_house_check.py` is the Python original of the first half.
 */

import type { PreparedOntology } from './ontology';
import { catalogueGroup } from './ontology';
import { TWB, TWBD, TWB_CATALOGUE, compactIri, type OxStore } from './oxigraph';
import type { LevelBuilder } from './report';

export interface VocabularyCounts {
    /** Distinct `twb:` terms used as a property or as an IRI value. */
    terms: number;
    /** Distinct catalogue values used. */
    catalogueValues: number;
}

/** Checks the triples of `data` against the ontology, into `level`. */
export function checkVocabulary(
    data: OxStore,
    ontology: PreparedOntology,
    level: LevelBuilder
): VocabularyCounts {
    const used = new Map<string, { asProperty: number; asValue: number }>();
    const values = new Map<string, Set<string>>();
    const use = (iri: string, role: 'asProperty' | 'asValue') => {
        const u = used.get(iri) ?? { asProperty: 0, asValue: 0 };
        u[role]++;
        used.set(iri, u);
    };
    for (const q of data.match(null, null, null, null)) {
        const p = q.predicate.value;
        if (p.startsWith(TWB) || p.startsWith(TWBD)) use(p, 'asProperty');
        if (q.object.termType !== 'NamedNode') continue;
        const o = q.object.value;
        if (o.startsWith(TWB) || o.startsWith(TWBD)) use(o, 'asValue');
        if (o.startsWith(TWB_CATALOGUE)) {
            const by = values.get(o) ?? new Set<string>();
            by.add(compactIri(p));
            values.set(o, by);
        }
    }

    for (const [iri, u] of [...used].sort(([a], [b]) => a.localeCompare(b))) {
        if (ontology.defined.has(iri)) continue;
        const roles = [
            u.asProperty ? `${u.asProperty}× as a property` : '',
            u.asValue ? `${u.asValue}× as a value` : '',
        ].filter(Boolean);
        level.error(
            `${compactIri(iri)} is used (${roles.join(', ')}) but no TWB module defines it.`,
            compactIri(iri)
        );
    }

    const unchecked = new Map<string, number>();
    for (const [iri, by] of [...values].sort(([a], [b]) => a.localeCompare(b))) {
        const group = catalogueGroup(iri);
        if (!ontology.catalogueGroups.has(group)) {
            unchecked.set(group, (unchecked.get(group) ?? 0) + 1);
            continue;
        }
        if (ontology.catalogue.has(iri)) continue;
        level.warning(
            `${compactIri(iri)} (the value of ${[...by].join(', ')}) is not in arch's catalogue ` +
                `(twb-catalogue.ttl lists the ${group.replace(/\/$/, '')} values it knows).`,
            compactIri(iri)
        );
    }
    if (unchecked.size > 0) {
        const groups = [...unchecked].map(([g, n]) => `${g || '(no group)'} ${n}`).join(', ');
        level.info(
            `Not checked against the catalogue, which does not enumerate them: ${groups} value(s).`
        );
    }
    return { terms: used.size, catalogueValues: values.size };
}
