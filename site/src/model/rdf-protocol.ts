/** What the page and the RDF worker say to each other (`rdf-worker.ts`, `rdf-client.ts`). */

import type { Scenario } from './engine';

/** The rules the checks need, applied in this order: requirements, U-values, BOT, passages. */
export const RULE_FILES = [
    '30-adjacency-capabilities',
    '31-adjacency-uvalue',
    '40-bot-adjacency',
    '41-passage-ways',
] as const;

export type Question =
    | { method: 'check'; scenario: Scenario }
    | { method: 'house'; json: string }
    | { method: 'describe'; iri: string };

export type Answer = { ok: true; result: unknown } | { ok: false; error: string };

export type Request = { id: number } & Question;
export type Response = { id: number } & Answer;
