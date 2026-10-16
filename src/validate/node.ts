/**
 * `@lbd-hackers/twb/validate/node`: the ontology's texts read from disk, for the CLI and for tests.
 * Kept apart from `@lbd-hackers/twb/validate` so that a browser bundle of the validator never
 * pulls in `node:fs`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ONTOLOGY_FILES, type OntologySources } from './ontology';

/**
 * The package's own `ontology/` directory. This module runs from `src/validate/` in the repository,
 * and from `dist/`, `dist/validate/` or a shared chunk in `dist/` once built; the directory is
 * looked for upwards from wherever it is.
 */
export function packageOntologyDir(): string {
    // In the CommonJS build, tsup's shim stands in for import.meta.url (`shims` in tsup.config.ts).
    const here = dirname(fileURLToPath(import.meta.url));
    for (let dir = here, i = 0; i < 4; i++, dir = dirname(dir)) {
        const candidate = join(dir, 'ontology');
        if (existsSync(join(candidate, ONTOLOGY_FILES.shapes))) return candidate;
    }
    throw new Error(`The TWB ontology was not found above ${here}.`);
}

/** The ontology's texts from `dir` (by default the package's own `ontology/`). */
export function loadOntologySources(dir: string = packageOntologyDir()): OntologySources {
    const read = (file: string) => readFileSync(resolve(dir, file), 'utf8');
    const rules = resolve(dir, ONTOLOGY_FILES.rules);
    return {
        modules: ONTOLOGY_FILES.modules.map((name) => ({ name, text: read(name) })),
        catalogue: read(ONTOLOGY_FILES.catalogue),
        bot: read(ONTOLOGY_FILES.bot),
        shapes: read(ONTOLOGY_FILES.shapes),
        rules: readdirSync(rules)
            .filter((f) => f.endsWith('.rq'))
            .sort()
            .map((name) => ({ name, text: readFileSync(join(rules, name), 'utf8') })),
    };
}
