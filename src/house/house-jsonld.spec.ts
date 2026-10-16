import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    parseHouseFile,
    serializeHouseFile,
    toHouseFile,
    type HouseFile,
    type ParseResult,
} from './house-file';
import {
    TWB_HOUSE_CONTEXT,
    TWB_HOUSE_CONTEXT_URL,
    TWB_HOUSE_FORMAT,
    edgeRef,
    fromTwbHouse,
    toTwbHouse,
} from './house-jsonld';

const ROOT = join(__dirname, '../..');

/** Every arch/1 house file kept in the repository's fixtures. */
const ARCH1_FILES = readdirSync(join(ROOT, 'fixtures/houses'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => join('fixtures/houses', f))
    .filter((f) => /"format":\s*"arch\/1"/.test(readFileSync(join(ROOT, f), 'utf8')));

/**
 * What a parse says about the house, without which format it came in — as plain JSON, Maps as
 * entries, and without the layer ids a parse hands out from a counter of its own.
 */
const house = ({ format: _format, ...rest }: ParseResult): Record<string, unknown> =>
    JSON.parse(
        JSON.stringify(rest, (key, v: unknown) =>
            v instanceof Map
                ? [...v]
                : key === 'id' && typeof v === 'string' && /^L\d+$/.test(v)
                  ? undefined
                  : v
        )
    );

type Term =
    string | { '@type'?: string; '@container'?: string; '@context'?: Record<string, unknown> };
const TERMS = TWB_HOUSE_CONTEXT as unknown as Record<string, Term>;
const BLUEPRINT_TERMS = (TERMS['Blueprint'] as { '@context': Record<string, Term> })['@context'];

/**
 * Every key of `doc` that the context does not map, with where it stands — what a JSON-LD
 * processor would drop. JSON literals are not looked into; an index map's keys are values.
 */
function unmappedKeys(doc: unknown, terms: Record<string, Term>, at = '$'): string[] {
    if (Array.isArray(doc)) return doc.flatMap((v, i) => unmappedKeys(v, terms, `${at}[${i}]`));
    if (typeof doc !== 'object' || doc === null) return [];
    return Object.entries(doc).flatMap(([k, v]) => {
        if (k.startsWith('@')) return [];
        const term = terms[k];
        if (term === undefined) return [`${at}.${k}`];
        if (typeof term === 'object' && term['@type'] === '@json') return [];
        if (
            typeof term === 'object' &&
            term['@container'] === '@index' &&
            typeof v === 'object' &&
            v
        ) {
            return Object.entries(v).flatMap(([i, item]) =>
                unmappedKeys(item, TERMS, `${at}.${k}.${i}`)
            );
        }
        return unmappedKeys(v, TERMS, `${at}.${k}`);
    });
}

describe('twb/1, the house file as JSON-LD', () => {
    it('finds the repository’s arch/1 files to check against', () => {
        expect(ARCH1_FILES.length).toBeGreaterThan(8);
    });

    it.each(ARCH1_FILES)('reads %s the same as arch/1 and as twb/1', (file) => {
        const text = readFileSync(join(ROOT, file), 'utf8');
        const arch1 = parseHouseFile(text);
        expect(arch1.format).toBe('arch/1');
        const twb1 = parseHouseFile(JSON.stringify(toTwbHouse(JSON.parse(text) as HouseFile)));
        expect(twb1.format).toBe(TWB_HOUSE_FORMAT);
        expect(house(twb1)).toEqual(house(arch1));
    });

    it.each(ARCH1_FILES)('saves %s as twb/1 and reads back what arch/1 would', (file) => {
        const p = parseHouseFile(readFileSync(join(ROOT, file), 'utf8'));
        const geometry = {
            surfaces: p.surfaces,
            guides: p.guides,
            storeys: p.storeys,
            zones: p.zones,
            zoneSeparations: p.zoneSeparations,
            openingDetails: p.openingDetails,
            openingLintels: p.openingLintels,
        };
        const more = { name: p.name, notes: p.notes, settings: p.settings };
        const text = serializeHouseFile(geometry, more);
        const doc = JSON.parse(text);
        expect(doc['@context']).toBe(TWB_HOUSE_CONTEXT_URL);
        expect(doc.format).toBe(TWB_HOUSE_FORMAT);
        const back = parseHouseFile(text);
        expect(back.errors).toEqual([]);
        // Against the same house saved as arch/1, so that only the format is under test.
        const arch1 = parseHouseFile(JSON.stringify(toHouseFile(geometry, more)));
        expect(house(back)).toEqual(house(arch1));
    });

    it.each(ARCH1_FILES)('maps every key it writes for %s to a term of its context', (file) => {
        const doc = toTwbHouse(JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as HouseFile);
        // A key listed here is one a JSON-LD processor drops: give it a term in TWB_HOUSE_CONTEXT
        // (and in TWB, ontology/twb-*.ttl, or as JSON under arch:).
        expect(unmappedKeys(doc, { ...TERMS, ...BLUEPRINT_TERMS })).toEqual([]);
    });

    it('writes a field it does not know as it stands, so that it is not lost on Save', () => {
        const doc = toTwbHouse({
            format: 'arch/1',
            surfaces: [],
            furniture: [{ kind: 'sofa' }],
        } as HouseFile);
        expect(doc['furniture']).toEqual([{ kind: 'sofa' }]);
        expect(fromTwbHouse(doc)['furniture']).toEqual([{ kind: 'sofa' }]);
        expect(unmappedKeys(doc, { ...TERMS, ...BLUEPRINT_TERMS })).toEqual(['$.furniture']);
    });

    it('writes the documentation’s sections as typed things of the doc module', () => {
        const file = {
            format: 'arch/1',
            surfaces: [],
            sections: [
                {
                    name: 'A',
                    line: [
                        [3600, -600],
                        [3600, 7800],
                    ],
                },
                { name: 'B', inDocumentation: false },
            ],
        } as HouseFile;
        const doc = toTwbHouse(file);
        expect(doc['sections']).toEqual([
            {
                type: 'Section',
                name: 'A',
                line: [
                    [3600, -600],
                    [3600, 7800],
                ],
            },
            { type: 'Section', name: 'B', inDocumentation: false },
        ]);
        expect(unmappedKeys(doc, { ...TERMS, ...BLUEPRINT_TERMS })).toEqual([]);
        // Within a Section, `line` is the cut's, not a joint's line cut.
        expect(TERMS['Section']).toMatchObject({
            '@context': { line: { '@id': 'twb:cutLineMm' } },
        });
        expect(TERMS['sections']).toMatchObject({ '@id': 'twb:hasSection' });
        expect(house(parseHouseFile(JSON.stringify(doc)))).toEqual(
            house(parseHouseFile(JSON.stringify(file)))
        );
    });

    it('writes fixtures as typed things with a fixtureKind, on their storey by id', () => {
        const file = {
            format: 'arch/1',
            surfaces: [],
            storeys: [{ name: 'Stueplan', elevationMm: 0, heightMm: 2600 }],
            fixtures: [
                { kind: 'wc', storey: 'Stueplan', at: [800, 600] },
                { kind: 'island', at: [4000, 3000], size: [2400, 1000], facing: 'y+' },
            ],
        } as HouseFile;
        const doc = toTwbHouse(file);
        expect(doc['fixtures']).toEqual([
            { type: 'Fixture', storey: 'st1', at: [800, 600], fixtureKind: 'wc' },
            {
                type: 'Fixture',
                at: [4000, 3000],
                size: [2400, 1000],
                facing: 'y+',
                fixtureKind: 'island',
            },
        ]);
        expect(unmappedKeys(doc, { ...TERMS, ...BLUEPRINT_TERMS })).toEqual([]);
        // Fixtures are passed on as settings; the storey they name is the same one by its id.
        const back = parseHouseFile(JSON.stringify(doc));
        const wc = (back.settings['fixtures'] as { storey: string }[])[0]!;
        expect(back.storeys.find((s) => s.id === wc.storey)?.name).toBe('Stueplan');
    });

    it('refers to storeys by id, the one parseHouseFile would mint, not by name', () => {
        const file = {
            format: 'arch/1',
            surfaces: [],
            storeys: [
                { name: 'Stueplan', elevationMm: 0, heightMm: 2600 },
                { id: 'loft', name: '1. sal', elevationMm: 2600, heightMm: 2400 },
            ],
            zones: [
                { name: 'Stue', kind: 'living', storey: 'Stueplan', point: [1000, 1000] },
                { name: 'Værelse', kind: 'bedroom', storey: '1. sal', point: [1000, 1000] },
            ],
            zoneSeparations: [
                {
                    storey: 'loft',
                    points: [
                        [0, 0],
                        [0, 1000],
                    ],
                },
            ],
        } as HouseFile;
        const doc = toTwbHouse(file);
        expect((doc['storeys'] as { id: string }[]).map((s) => s.id)).toEqual(['st1', 'loft']);
        expect((doc['zones'] as { storey: string }[]).map((z) => z.storey)).toEqual([
            'st1',
            'loft',
        ]);
        expect((doc['zoneSeparations'] as { storey: string }[])[0]!.storey).toBe('loft');
        expect(house(parseHouseFile(JSON.stringify(doc)))).toEqual(
            house(parseHouseFile(JSON.stringify(file)))
        );
    });

    it('writes openings as objects on their surface, and edges by IRI', () => {
        const doc = toTwbHouse({
            format: 'arch/1',
            surfaces: [
                {
                    id: 's1',
                    points: [
                        [0, 0, 0],
                        [3000, 0, 0],
                        [3000, 0, 2400],
                        [0, 0, 2400],
                    ],
                    openings: [
                        [
                            [500, 0, 0],
                            [1400, 0, 0],
                            [1400, 0, 2100],
                            [500, 0, 2100],
                        ],
                    ],
                    openingKinds: ['door'],
                    openingSwings: [{ hingeAtEnd: true }],
                },
            ],
            edgeJoints: [{ edge: 's1|s2#2', cuts: { s1: [null, 2, 'miter'] } }],
        });
        expect((doc['surfaces'] as { openings: unknown[] }[])[0]!.openings).toEqual([
            {
                type: 'Door',
                points: [
                    [500, 0, 0],
                    [1400, 0, 0],
                    [1400, 0, 2100],
                    [500, 0, 2100],
                ],
                hingeAtEnd: true,
            },
        ]);
        expect(doc['edgeJoints']).toEqual([
            {
                type: 'JointDetail',
                edge: 'edge/s1%7Cs2%232',
                cuts: [
                    { surface: 's1', layer: 0, cut: 'standard' },
                    { surface: 's1', layer: 1, cut: { boundary: 2 } },
                    { surface: 's1', layer: 2, cut: 'miter' },
                ],
            },
        ]);
        expect(edgeRef('s1|s2#2')).toBe('edge/s1%7Cs2%232');
        expect(fromTwbHouse(doc)['edgeJoints']).toEqual([
            { edge: 's1|s2#2', cuts: { s1: [null, 2, 'miter'] } },
        ]);
    });

    // `UPDATE_CONTEXT=1 npx vitest run src/house/house-jsonld.spec.ts` writes the copy again.
    it('keeps the published copy of its context equal to the one it writes against', () => {
        const path = join(ROOT, 'ontology/twb-house.context.jsonld');
        const context = { '@context': TWB_HOUSE_CONTEXT };
        if (process.env['UPDATE_CONTEXT'])
            writeFileSync(path, JSON.stringify(context, null, 4) + '\n');
        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(context);
    });

    // Context 1 is published and never changes; a file naming it must read as one naming context 2:
    // every term it has means the same in context 2, which only gains terms.
    it('keeps context 1’s terms in its own but for the documentation’s twbd: terms', () => {
        const path = join(ROOT, 'ontology/twb-house.context.1.jsonld');
        const text = readFileSync(path, 'utf8')
            .replace(/\s*"twbd": "https:\/\/w3id\.org\/twb\/doc#",/, '')
            .replaceAll('"twbd:', '"twb:');
        const one = (JSON.parse(text) as { '@context': Record<string, unknown> })['@context'];
        for (const [term, meaning] of Object.entries(one)) {
            expect(TWB_HOUSE_CONTEXT[term as keyof typeof TWB_HOUSE_CONTEXT], term).toEqual(
                meaning
            );
        }
    });
});
