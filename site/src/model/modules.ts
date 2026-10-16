/**
 * TWB's modules, as the data model page lists them: what each imports and defines, read from the
 * captured ontology (`scripts/capture-ontology.mjs`, run before every build). The words are in
 * `copy.ts`.
 */

import ontology from '../data/ontology.json';

export interface TwbModule {
    id: string;
    imports: readonly string[];
    classes: number;
    objectProperties: number;
    datatypeProperties: number;
}

export const TWB_MODULES: readonly TwbModule[] = ontology.modules.map((m) => ({
    id: m.id,
    imports: m.imports,
    classes: m.classes,
    objectProperties: m.objectProperties,
    datatypeProperties: m.datatypeProperties,
}));

/** The modules that define classes: the ones the schema graph draws, each with its colour. */
export const CLASS_MODULES = TWB_MODULES.filter((m) => m.classes > 0).map((m) => m.id);

/** The categorical slots in fixed order (the dataviz palette), one per module that has classes. */
export const MODULE_COLOURS: Record<string, string> = Object.fromEntries(
    CLASS_MODULES.map((id, i) => [
        id,
        ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'][
            i
        ]!,
    ])
);

export const moduleIri = (id: string) => `https://w3id.org/twb/${id}`;
