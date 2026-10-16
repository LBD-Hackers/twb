/**
 * The ontology a validation reads: TWB's modules, the catalogue, BOT, the shapes and the rules, as
 * texts. The validator never reads a file itself — in a browser there is no file to read — so the
 * caller hands it the texts: the CLI from the package's own `ontology/` (`node.ts`), a web page
 * however it bundles them, with `ONTOLOGY_FILES` saying which files they are.
 *
 * Parsing the ontology and compiling the shapes is the slow part of a validation, so it is done
 * once per `OntologySources` object and kept (`prepareOntology`): a worker that validates file
 * after file pays for it once.
 */

import { TWB, TWBD, TWB_CATALOGUE, type Oxigraph, type OxQuad } from './oxigraph';
import { ShaclValidator } from './shacl';

/** The ontology's texts. */
export interface OntologySources {
    /** `twb.ttl` and every module it imports (`ONTOLOGY_FILES.modules`), Turtle. */
    modules: { name: string; text: string }[];
    /** `twb-catalogue.ttl`: arch's registries as SKOS. */
    catalogue: string;
    /** `imports/bot.ttl`. */
    bot: string;
    /** `twb-shapes.ttl`. */
    shapes: string;
    /** `queries/rules/*.rq`, in file-name order: the order they are applied in. */
    rules: { name: string; text: string }[];
}

/**
 * Where the texts are in `ontology/`. The modules in import order — each imports only modules
 * before it — as `tools/twb_modules.py` lists them; Oxigraph does not follow `owl:imports`, so
 * they are loaded one by one.
 */
export const ONTOLOGY_FILES = {
    modules: [
        'twb.ttl',
        'twb-core.ttl',
        'twb-construction.ttl',
        'twb-detailing.ttl',
        'twb-requirements.ttl',
        'twb-profile.ttl',
        'twb-decision.ttl',
        'twb-derivation.ttl',
        'twb-housefile.ttl',
        'twb-doc.ttl',
    ],
    catalogue: 'twb-catalogue.ttl',
    bot: 'imports/bot.ttl',
    shapes: 'twb-shapes.ttl',
    /** A directory: every `.rq` file in it, sorted by name. */
    rules: 'queries/rules/',
} as const;

/** The ontology parsed once: what every validation against it starts from. */
export interface PreparedOntology {
    ox: Oxigraph;
    /** BOT, the modules and the catalogue: what a graph is validated together with. */
    quads: OxQuad[];
    /** Every `twb:` (and deprecated `twbd:`) IRI the modules say something about. */
    defined: Set<string>;
    /** Every IRI under the catalogue's namespace the catalogue says something about. */
    catalogue: Set<string>;
    /**
     * The catalogue's groups — `zone-kind/`, `material/`, `use/DK/` — that it enumerates. A value
     * in a group it does not enumerate (`opening-detail/`) cannot be checked against it.
     */
    catalogueGroups: Set<string>;
    /** The shapes compiled, or why they could not be (`ShaclUnsupportedError`). */
    shapes: ShaclValidator | Error;
}

const prepared = new WeakMap<OntologySources, PreparedOntology>();

/** The ontology parsed and its shapes compiled, once per `sources` object. */
export function prepareOntology(sources: OntologySources, ox: Oxigraph): PreparedOntology {
    const known = prepared.get(sources);
    if (known && known.ox === ox) return known;

    const modules = new ox.Store();
    for (const m of sources.modules) modules.load(m.text, { format: 'text/turtle' });
    const defined = new Set<string>();
    for (const q of modules.match(null, null, null, null)) {
        const s = q.subject.value;
        if (q.subject.termType === 'NamedNode' && (s.startsWith(TWB) || s.startsWith(TWBD))) {
            defined.add(s);
        }
    }

    const cat = new ox.Store();
    cat.load(sources.catalogue, { format: 'text/turtle' });
    const catalogue = new Set<string>();
    const catalogueGroups = new Set<string>();
    for (const q of cat.match(null, null, null, null)) {
        const s = q.subject.value;
        if (q.subject.termType !== 'NamedNode' || !s.startsWith(TWB_CATALOGUE)) continue;
        catalogue.add(s);
        catalogueGroups.add(catalogueGroup(s));
    }

    const all = new ox.Store();
    all.load(sources.bot, { format: 'text/turtle' });
    for (const q of modules.match(null, null, null, null)) all.add(q);
    for (const q of cat.match(null, null, null, null)) all.add(q);

    let shapes: ShaclValidator | Error;
    try {
        shapes = new ShaclValidator(ox, sources.shapes);
    } catch (e) {
        shapes = e instanceof Error ? e : new Error(String(e));
    }

    const result: PreparedOntology = {
        ox,
        quads: all.match(null, null, null, null),
        defined,
        catalogue,
        catalogueGroups,
        shapes,
    };
    prepared.set(sources, result);
    return result;
}

/** A catalogue IRI's group: what is between the namespace and the last `/` — `zone-kind/`. */
export function catalogueGroup(iri: string): string {
    const local = iri.slice(TWB_CATALOGUE.length);
    const slash = local.lastIndexOf('/');
    return slash < 0 ? '' : local.slice(0, slash + 1);
}
