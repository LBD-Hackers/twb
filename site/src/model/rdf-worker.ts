/**
 * The RDF engine in a worker, so the page stays responsive while Oxigraph (WASM) parses the
 * case house and runs the rules. The page talks to it through `rdf-client.ts`.
 */

import init, * as ox from 'oxigraph/web.js';
// Named, so dev's pre-bundling and the build both serve the WASM from where the URL says.
import wasm from 'oxigraph/web_bg.wasm?url';
import bot from '../../../ontology/imports/bot.ttl?raw';
import catalogue from '../../../ontology/twb-catalogue.ttl?raw';
import shapes from '../../../ontology/twb-shapes.ttl?raw';
import context from '../../../ontology/twb-house.context.jsonld?raw';
import caseHouse from '../../../ontology/examples/case-house.ttl?raw';
import caseRules from '../../../ontology/examples/case-house-rules.ttl?raw';
import useRules from '../../../ontology/examples/case-house-use-rules.ttl?raw';
import repair from '../../../ontology/queries/repair-wet-room-coverings.ru?raw';
import { Engine, type HouseGraph, type Scenario } from './engine';
import { RULE_FILES, type Answer, type Request, type Response } from './rdf-protocol';

// TWB as a whole: the umbrella (twb.ttl) and every module it imports, since Oxigraph does not follow owl:imports.
const twb = Object.values(
    import.meta.glob(
        '../../../ontology/twb{,-core,-construction,-detailing,-requirements,-profile,-decision,-derivation,-housefile,-doc}.ttl',
        {
            query: '?raw',
            import: 'default',
            eager: true,
        }
    ) as Record<string, string>
);

const ruleTexts = import.meta.glob('../../../ontology/queries/rules/*.rq', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

let engine: Promise<Engine> | null = null;
let house: HouseGraph | null = null;

/** The engine, made once: questions arriving together share one WASM instance. */
function ready(): Promise<Engine> {
    engine ??= start();
    return engine;
}

async function start(): Promise<Engine> {
    await init({ module_or_path: wasm });
    return new Engine(ox, {
        graph: [bot, ...twb, catalogue, caseHouse, caseRules, useRules],
        shapes,
        rules: RULE_FILES.map((name) => ({
            name,
            text: Object.entries(ruleTexts).find(([path]) => path.endsWith(`/${name}.rq`))![1],
        })),
        repair,
        context,
    });
}

self.onmessage = async (event: MessageEvent<Request>) => {
    const req = event.data;
    const reply = (r: Answer) => self.postMessage({ id: req.id, ...r } as Response);
    try {
        const e = await ready();
        switch (req.method) {
            case 'check':
                reply({ ok: true, result: e.check(req.scenario as Scenario) });
                break;
            case 'house': {
                house = e.readHouse(req.json);
                reply({ ok: true, result: { size: house.size, classes: house.classes() } });
                break;
            }
            case 'describe':
                reply({ ok: true, result: house?.describe(req.iri) ?? [] });
                break;
        }
    } catch (err) {
        reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
};
