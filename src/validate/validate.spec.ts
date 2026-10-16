import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ox from 'oxigraph';
import { describe, expect, it } from 'vitest';
import { validateGraph } from './graph';
import { validateHouseFile, validateIfc } from './house';
import { loadOntologySources } from './node';
import { formatReport, hasErrors, type Finding, type LevelName, type Report } from './report';
import { detectInput, validate } from './validate';

const ROOT = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const ontology = loadOntologySources(join(ROOT, 'ontology'));

const level = (r: Report, name: LevelName) => r.levels.find((l) => l.name === name)!;
const findings = (r: Report, name: LevelName, severity?: Finding['severity']) =>
    level(r, name).findings.filter((f) => !severity || f.severity === severity);

describe('detectInput', () => {
    it.each([
        ['house.twb.jsonld', '{ "format": "twb/1", "surfaces": [] }', 'house'],
        ['old.json', '{ "format": "arch/1", "surfaces": [] }', 'house'],
        ['nameless.json', '{ "walls": [] }', 'house'],
        ['model.ifc', 'ISO-10303-21;\nHEADER;', 'ifc'],
        ['model.txt', '﻿ISO-10303-21;', 'ifc'],
        ['case-house.ttl', '@prefix twb: <https://w3id.org/twb#> .', 'graph'],
        ['graph', 'PREFIX twb: <https://w3id.org/twb#>', 'graph'],
        ['graph.nt', '<a:b> <a:c> <a:d> .', 'graph'],
        ['graph.jsonld', '{ "@context": {}, "@graph": [] }', 'graph'],
        ['notes.txt', 'Hello', 'unknown'],
        ['README.md', '# TWB\n\nThe ontology.', 'unknown'],
        ['export', '# The case house\n@prefix twb: <https://w3id.org/twb#> .', 'graph'],
    ])('%s is a %s', (name, text, kind) => {
        expect(detectInput(name, text).kind).toBe(kind);
    });

    it('tells the graph formats apart', () => {
        expect(detectInput('g.nt', '<a:b> <a:c> <a:d> .')).toEqual({
            kind: 'graph',
            format: 'n-triples',
        });
        expect(detectInput('g.ttl', '@prefix x: <a:> .')).toEqual({
            kind: 'graph',
            format: 'turtle',
        });
        expect(detectInput('g.rdf', '<?xml version="1.0"?>')).toEqual({
            kind: 'graph',
            format: 'rdf-xml',
        });
        expect(detectInput('g.jsonld', '[]')).toEqual({ kind: 'graph', format: 'json-ld' });
    });
});

describe('a house file validated', () => {
    const caseHouse = validateHouseFile(read('ontology/examples/case-house.json'), ontology, ox);

    it('finds nothing wrong with the case house', () => {
        expect(caseHouse.kind).toBe('house');
        expect(caseHouse.levels.map((l) => l.name)).toEqual([
            'file',
            'geometry',
            'vocabulary',
            'shapes',
        ]);
        expect(caseHouse.counts.error).toBe(0);
        expect(caseHouse.counts.warning).toBe(0);
        expect(caseHouse.triples).toBe(332);
        expect(caseHouse.summary).toMatchObject({
            format: 'twb/1',
            faces: 11,
            rooms: 4,
            storeys: 1,
        });
    });

    it('does not run the shapes on it, and says why', () => {
        const shapes = level(caseHouse, 'shapes');
        expect(shapes.ran).toBe(false);
        expect(shapes.findings).toHaveLength(1);
        expect(shapes.findings[0]!.message).toMatch(/derived parts/);
    });

    it.each([
        'gable-house.json',
        'masonry-bungalow.json',
        'open-ridge-house.twb.json',
        'vent-2storey.json',
    ])('finds nothing wrong with fixtures/houses/%s', (file) => {
        const r = validateHouseFile(read(`fixtures/houses/${file}`), ontology, ox);
        expect([...findings(r, 'file', 'error'), ...findings(r, 'vocabulary', 'error')]).toEqual(
            []
        );
        expect(hasErrors(r)).toBe(false);
    });

    it('reads an arch/1 file as the twb/1 it converts to, and says arch/1 is deprecated', () => {
        const r = validateHouseFile(read('fixtures/houses/garage-carport.json'), ontology, ox);
        expect(r.summary['format']).toBe('arch/1');
        expect(
            findings(r, 'vocabulary', 'info')
                .map((f) => f.message)
                .join()
        ).toMatch(/arch\/1 is deprecated/);
        expect(r.triples).toBeGreaterThan(0);
    });

    it('says where a corner is not three numbers', () => {
        const r = validateHouseFile(
            {
                format: 'twb/1',
                surfaces: [
                    {
                        points: [
                            [0, 0],
                            [3000, 0, 0],
                            [3000, 0, 2400],
                        ],
                    },
                ],
            },
            ontology,
            ox
        );
        const [error] = findings(r, 'file', 'error');
        expect(error).toMatchObject({ level: 'file', where: 'surfaces[0].points[0]' });
        expect(hasErrors(r)).toBe(true);
    });

    it('reports a key the context drops, a twb: term no module defines and a value not in the catalogue', () => {
        const r = validateHouseFile(
            {
                '@context': 'https://w3id.org/twb/context/2.jsonld',
                format: 'twb/1',
                type: 'Blueprint',
                surfaces: [],
                storeys: [
                    { type: 'twb:Mezzanine', name: 'Ground floor', elevationMm: 0, heightMm: 2600 },
                ],
                zones: [
                    { type: 'Room', name: 'Spa', zoneKind: 'spa', point: [1000, 1000] },
                    { type: 'Room', name: 'Bath', zoneKind: 'bathroom', point: [3000, 1000] },
                ],
                furniture: [{ kind: 'sofa' }],
            },
            ontology,
            ox
        );
        const vocabulary = level(r, 'vocabulary').findings;
        expect(vocabulary).toContainEqual(
            expect.objectContaining({ severity: 'warning', where: 'furniture' })
        );
        expect(vocabulary).toContainEqual(
            expect.objectContaining({ severity: 'error', where: 'twb:Mezzanine' })
        );
        expect(vocabulary).toContainEqual(
            expect.objectContaining({ severity: 'warning', where: 'twbc:zone-kind/spa' })
        );
        expect(vocabulary.some((f) => f.where === 'twbc:zone-kind/bathroom')).toBe(false);
    });

    it('stops at the file level when the file is not JSON', () => {
        const r = validateHouseFile('{ "format": ', ontology, ox);
        expect(findings(r, 'file', 'error')[0]!.message).toMatch(/^Not JSON/);
        expect(r.levels.filter((l) => !l.ran).map((l) => l.name)).toEqual([
            'geometry',
            'vocabulary',
            'shapes',
        ]);
    });

    it('reads an IFC file first, and says when it cannot', () => {
        const r = validateIfc('ISO-10303-21;\nnothing here', ontology, ox);
        expect(r.kind).toBe('ifc');
        expect(level(r, 'import').findings.length).toBeGreaterThan(0);
    });
});

describe('a graph validated', () => {
    const caseHouse = read('ontology/examples/case-house.ttl');
    const rules = ['case-house-rules.ttl', 'case-house-use-rules.ttl'].map((name) => ({
        name,
        text: read(`ontology/examples/${name}`),
        format: 'turtle' as const,
    }));

    it('finds the five zone boundaries towards the bathroom without a wet-room lining, rules applied', () => {
        const r = validateGraph(caseHouse, 'turtle', ontology, ox, { rules: true, with: rules });
        expect(r.levels.map((l) => l.name)).toEqual(['parse', 'vocabulary', 'rules', 'shapes']);
        const errors = findings(r, 'shapes', 'error');
        expect(errors).toHaveLength(5);
        for (const e of errors) {
            expect(e.result).toMatchObject({
                shape: 'twbsh:CapabilityShape',
                component: 'SPARQLConstraintComponent',
            });
            expect(e.where).toMatch(/^inst:zone-boundary\/.*\/z-bath$/);
            expect(e.message).toMatch(/does not provide twb:WetRoomLining/);
        }
        expect(findings(r, 'vocabulary', 'error')).toEqual([]);
        expect(r.summary['inferred']).toBe(266);
    }, 60_000);

    it('without the rules, finds no way out of any room', () => {
        const r = validateGraph(caseHouse, 'turtle', ontology, ox, { with: rules });
        expect(level(r, 'rules').ran).toBe(false);
        const errors = findings(r, 'shapes', 'error');
        expect(errors.map((e) => e.where).sort()).toEqual([
            'inst:zone/z-bath',
            'inst:zone/z-bed1',
            'inst:zone/z-bed2',
            'inst:zone/z-living',
        ]);
        expect(errors.every((e) => e.result!.shape === 'twbsh:EgressShape')).toBe(true);
    });

    it('stops at the parse level when the graph cannot be read', () => {
        const r = validateGraph('@prefix x: <a:> . x:a x:b', 'turtle', ontology, ox);
        expect(findings(r, 'parse', 'error')).toHaveLength(1);
        expect(r.levels.filter((l) => !l.ran).map((l) => l.name)).toEqual([
            'vocabulary',
            'rules',
            'shapes',
        ]);
    });

    it('reads a JSON-LD graph naming TWB’s context without a network', () => {
        const r = validate(
            'g.jsonld',
            JSON.stringify({
                '@context': 'https://w3id.org/twb/context/2.jsonld',
                '@graph': [{ id: 'room', type: 'Room', name: 'Living' }],
            }),
            ontology,
            ox
        )!;
        expect(r.kind).toBe('graph');
        expect(findings(r, 'parse', 'error')).toEqual([]);
        expect(r.triples).toBe(2);
    });

    it('says the shapes could not be compiled when they use a feature it does not implement', () => {
        const odd = {
            ...ontology,
            shapes: `${ontology.shapes}\n<urn:s> <http://www.w3.org/ns/shacl#pattern> "x" ; <http://www.w3.org/ns/shacl#path> <urn:p> .`,
        };
        const r = validateGraph('<urn:a> <urn:b> <urn:c> .', 'n-triples', odd, ox);
        expect(findings(r, 'shapes', 'error')[0]!.message).toMatch(/sh:pattern/);
    });

    it('writes a report a reader can follow', () => {
        const r = validateGraph(caseHouse, 'turtle', ontology, ox, { with: rules });
        const text = formatReport(r);
        expect(text).toMatch(/^graph: format turtle/);
        expect(text).toMatch(/shapes — 4 errors, 0 warnings/);
        expect(text.split('\n').at(-1)).toMatch(/^FAILED: 4 errors/);
    });
});

describe('the package around the validator', () => {
    it('keeps Oxigraph out of every entry at load time: types only, the CLI importing it when it runs', () => {
        const files = (dir: string): string[] =>
            readdirSync(dir).flatMap((f) => {
                const path = join(dir, f);
                return statSync(path).isDirectory()
                    ? files(path)
                    : path.endsWith('.ts') && !path.endsWith('.spec.ts')
                      ? [path]
                      : [];
            });
        for (const file of files(join(ROOT, 'src'))) {
            for (const line of readFileSync(file, 'utf8').split('\n')) {
                if (!/['"]oxigraph['"]/.test(line) || /^\s*(\*|\/\/)/.test(line)) continue;
                expect(line, file).toMatch(/^import type |await import\('oxigraph'\)/);
            }
        }
    });

    it('keeps node:fs out of @lbd-hackers/twb/validate', () => {
        for (const f of [
            'index',
            'graph',
            'house',
            'ontology',
            'oxigraph',
            'report',
            'shacl',
            'validate',
            'vocabulary',
        ]) {
            expect(read(`src/validate/${f}.ts`), f).not.toMatch(/from 'node:/);
        }
    });
});
