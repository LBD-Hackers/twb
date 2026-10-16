/**
 * The validator's worker: Oxigraph (WASM) and the ontology, loaded once, and every file the page
 * hands it validated with `@lbd-hackers/twb/validate` — the library's own code, read from `src/`.
 * A house file or an IFC model also comes back as the house file, for the viewer to show.
 */

import init, * as ox from 'oxigraph/web.js';
import wasm from 'oxigraph/web_bg.wasm?url';
import bot from '../../../ontology/imports/bot.ttl?raw';
import catalogue from '../../../ontology/twb-catalogue.ttl?raw';
import shapes from '../../../ontology/twb-shapes.ttl?raw';
import { ifcToHouse } from '@twb/ifc';
import {
    ONTOLOGY_FILES,
    detectInput,
    validate,
    type OntologySources,
    type Oxigraph,
} from '@twb/validate';
import type { ValidateRequest, ValidateResponse } from './protocol';

const moduleTexts = import.meta.glob('../../../ontology/twb*.ttl', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;
const ruleTexts = import.meta.glob('../../../ontology/queries/rules/*.rq', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const fileName = (path: string) => path.replace(/^.*\//, '');

const ontology: OntologySources = {
    modules: ONTOLOGY_FILES.modules.map((name) => {
        const text = Object.entries(moduleTexts).find(([path]) => fileName(path) === name)?.[1];
        if (text === undefined) throw new Error(`The ontology has no ${name}.`);
        return { name, text };
    }),
    catalogue,
    bot,
    shapes,
    rules: Object.entries(ruleTexts)
        .map(([path, text]) => ({ name: fileName(path), text }))
        .sort((a, b) => a.name.localeCompare(b.name)),
};

const ready = init(wasm);

self.onmessage = async (e: MessageEvent<ValidateRequest>) => {
    const { id, name, text, rules, extra } = e.data;
    try {
        await ready;
        const input = detectInput(name, text);
        const withGraphs = extra.flatMap((f) => {
            const d = detectInput(f.name, f.text);
            return d.kind === 'graph' ? [{ name: f.name, text: f.text, format: d.format }] : [];
        });
        const report = validate(name, text, ontology, ox as unknown as Oxigraph, {
            rules,
            with: withGraphs,
            ifc: { name: name.replace(/\.ifc$/i, '') },
        });
        let house: string | null = null;
        if (input.kind === 'house') house = text;
        else if (input.kind === 'ifc' && report && report.counts.error === 0) {
            house = JSON.stringify(ifcToHouse(text, { name: name.replace(/\.ifc$/i, '') }).house, null, 2);
        }
        const response: ValidateResponse = {
            id,
            report,
            input,
            house,
            ignored: extra.filter((f) => detectInput(f.name, f.text).kind !== 'graph').map((f) => f.name),
        };
        self.postMessage(response);
    } catch (err) {
        const response: ValidateResponse = {
            id,
            report: null,
            input: { kind: 'unknown', reason: err instanceof Error ? err.message : String(err) },
            house: null,
            ignored: [],
        };
        self.postMessage(response);
    }
};
