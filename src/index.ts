/**
 * TWB — thin-walled blueprints. The house file and its JSON-LD context, and IFC to TWB.
 *
 * - `@lbd-hackers/twb` (this module): the house file and the IFC importer. Pure: no DOM, no three.js.
 * - `@lbd-hackers/twb/house`, `@lbd-hackers/twb/ifc`: the same, one at a time.
 * - `@lbd-hackers/twb/surfacekit/{core,grid,model,interaction,render}`: the drawing engine.
 * - `@lbd-hackers/twb/elements`: `<arch-paper-model>`, the viewer (needs `lit` and `three`).
 * - `@lbd-hackers/twb/ontology/…`: the TWB ontology, its shapes, rules and examples.
 */

export * from './house';
export * from './ifc';
