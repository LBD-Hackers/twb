/**
 * The page's side of the RDF worker: one worker for the page, started on first use, and a
 * promise per question.
 */

import type { CheckResult, Scenario, TripleLine } from './engine';
import type { Question, Request, Response } from './rdf-protocol';

export interface HouseSummary {
    size: number;
    classes: { cls: string; n: number }[];
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let next = 1;
const pending = new Map<number, Pending>();

function ask<T>(req: Question): Promise<T> {
    if (!worker) {
        worker = new Worker(new URL('./rdf-worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<Response>) => {
            const r = event.data;
            const p = pending.get(r.id);
            pending.delete(r.id);
            if (!p) return;
            if (r.ok) p.resolve(r.result);
            else p.reject(new Error(r.error));
        };
        worker.onerror = (event) => {
            for (const p of pending.values()) p.reject(new Error(event.message || 'worker failed'));
            pending.clear();
        };
    }
    const id = next++;
    return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        worker!.postMessage({ ...req, id } as Request);
    });
}

export const rdf = {
    check: (scenario: Scenario) => ask<CheckResult>({ method: 'check', scenario }),
    house: (json: string) => ask<HouseSummary>({ method: 'house', json }),
    describe: (iri: string) => ask<TripleLine[]>({ method: 'describe', iri }),
};
