/**
 * `@lbd-hackers/twb/validate`: house files, IFC files and TWB graphs validated against the TWB
 * ontology, its catalogue and its SHACL shapes, with Oxigraph.
 *
 * Runs in Node and in a browser (in a Web Worker, say): the caller hands it the Oxigraph module —
 * `oxigraph` in Node, `oxigraph/web.js` once its WASM is initialised in a browser — and the
 * ontology's texts (`OntologySources`; in Node, `loadOntologySources` from
 * `@lbd-hackers/twb/validate/node` reads them from the package). Oxigraph is an optional peer
 * dependency: only this entry needs it.
 *
 * ```ts
 * import * as ox from 'oxigraph';
 * import { validate, formatReport } from '@lbd-hackers/twb/validate';
 * import { loadOntologySources } from '@lbd-hackers/twb/validate/node';
 *
 * const report = validate('house.twb.jsonld', text, loadOntologySources(), ox);
 * console.log(formatReport(report!));
 * ```
 */

export * from './report';
export * from './ontology';
export {
    ShaclValidator,
    ShaclUnsupportedError,
    type ShaclResult,
    type ShaclSeverity,
} from './shacl';
export {
    validateGraph,
    loadGraph,
    applyRules,
    withTwbContext,
    GRAPH_BASE,
    GRAPH_MEDIA_TYPES,
    type GraphFormat,
    type GraphOptions,
    type GraphSource,
    type LoadedGraph,
} from './graph';
export { validateHouseFile, validateIfc, unmappedKeys } from './house';
export { detectInput, validate, type DetectedInput, type ValidateOptions } from './validate';
export { compactIri, termText, type Oxigraph } from './oxigraph';
