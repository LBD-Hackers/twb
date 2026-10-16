/**
 * One entry for any file: what it is (`detectInput`), and the validation that fits it
 * (`validate`) — a house file, an IFC file, or a TWB graph.
 */

import type { IfcImportOptions } from '../ifc';
import { validateGraph, type GraphFormat, type GraphOptions } from './graph';
import { validateHouseFile, validateIfc } from './house';
import type { OntologySources } from './ontology';
import type { Oxigraph } from './oxigraph';
import type { Report } from './report';

export type DetectedInput =
    | { kind: 'house' }
    | { kind: 'ifc' }
    | { kind: 'graph'; format: GraphFormat }
    | { kind: 'unknown'; reason: string };

/** The keys only a house file has at its top level. */
const HOUSE_KEYS = ['surfaces', 'walls', 'storeys', 'zones', 'interiorWalls', 'roof'];

/**
 * What a file is, from its name and its text: a house file (`twb/1` or `arch/1`), an IFC file
 * (`ISO-10303-21`), or a graph — Turtle, N-Triples, RDF/XML, or JSON-LD that is not a house file.
 * The text decides where it can; the extension where it cannot (Turtle and N-Triples look alike,
 * and N-Triples is read as Turtle anyway).
 */
export function detectInput(name: string, text: string): DetectedInput {
    const head = text.replace(/^﻿/, '').trimStart();
    const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
    if (head.startsWith('ISO-10303-21') || ext === 'ifc') return { kind: 'ifc' };
    if (head.startsWith('{') || head.startsWith('[')) {
        let json: unknown;
        try {
            json = JSON.parse(head);
        } catch {
            return ext === 'jsonld' || ext === 'json'
                ? { kind: 'house' } // Let the file level say what is wrong with it.
                : { kind: 'unknown', reason: 'it looks like JSON but does not parse' };
        }
        if (Array.isArray(json)) return { kind: 'graph', format: 'json-ld' };
        const o = json as Record<string, unknown>;
        if (o['format'] === 'twb/1' || o['format'] === 'arch/1' || o['type'] === 'Blueprint') {
            return { kind: 'house' };
        }
        if ('@graph' in o || ('@context' in o && !HOUSE_KEYS.some((k) => k in o))) {
            return { kind: 'graph', format: 'json-ld' };
        }
        return { kind: 'house' };
    }
    if (ext === 'nt') return { kind: 'graph', format: 'n-triples' };
    if (
        ext === 'rdf' ||
        ext === 'owl' ||
        ext === 'xml' ||
        head.startsWith('<?xml') ||
        /^<rdf:RDF\b/.test(head)
    ) {
        return { kind: 'graph', format: 'rdf-xml' };
    }
    // A comment alone does not make Turtle (Markdown starts with `#` too): the first statement does.
    const statement = head.replace(/^(#[^\n]*\n\s*)+/, '');
    if (ext === 'ttl' || /^(@prefix|@base|prefix\b|base\b|<[^>]*>|_:)/i.test(statement)) {
        return { kind: 'graph', format: 'turtle' };
    }
    return { kind: 'unknown', reason: 'it is not a house file, an IFC file or an RDF graph' };
}

export interface ValidateOptions extends GraphOptions {
    /** For an IFC file: what the importer is told (the project name). */
    ifc?: IfcImportOptions;
}

/** A file validated as what it is (`detectInput`). Null when it is none of the three. */
export function validate(
    name: string,
    text: string,
    ontology: OntologySources,
    ox: Oxigraph,
    options: ValidateOptions = {}
): Report | null {
    const input = detectInput(name, text);
    switch (input.kind) {
        case 'house':
            return validateHouseFile(text, ontology, ox);
        case 'ifc':
            return validateIfc(text, ontology, ox, options.ifc);
        case 'graph':
            return validateGraph(text, input.format, ontology, ox, options);
        case 'unknown':
            return null;
    }
}
