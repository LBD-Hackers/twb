/**
 * The modelling examples: parts of the paper's case house (`paper/ontology/examples/case-house.json`,
 * a `twb/1` house file), cut out by surface so each shows one idea, and the part of the file
 * that says it.
 */

import caseHouse from '../../../ontology/examples/case-house.json';

export type ExampleId = 'surface' | 'edge' | 'rooms' | 'house';

type HouseFile = typeof caseHouse & Record<string, unknown>;

export interface Example {
    id: ExampleId;
    /** The house file the viewer opens. */
    house: Record<string, unknown>;
    /** The part of the file the example is about, as shown beside it. */
    excerpt: unknown;
    /** The face selected first. */
    first: string;
}

const WALLS = ['wall-south', 'wall-east', 'wall-north', 'wall-west'];
const PARTITIONS = ['s1', 's2', 's3', 's4'];

/** The house with only these surfaces, and only what of the rest is about them. */
function cut(surfaces: string[], keep: (keyof HouseFile)[] = []): Record<string, unknown> {
    const house = caseHouse as HouseFile;
    const out: Record<string, unknown> = {
        '@context': house['@context'],
        format: house.format,
        type: house.type,
        storeys: house.storeys,
        surfaces: house.surfaces.filter((s) => surfaces.includes(s.id)),
    };
    for (const k of keep) out[k] = house[k];
    if (keep.includes('edgeJoints')) {
        out['edgeJoints'] = house.edgeJoints.filter((j) =>
            decodeURIComponent(j.edge.replace(/^edge\//, ''))
                .split('|')
                .every((s) => surfaces.includes(s))
        );
    }
    return out;
}

const surfaceOf = (id: string) => (caseHouse as HouseFile).surfaces.find((s) => s.id === id)!;

export const EXAMPLES: Example[] = [
    {
        id: 'surface',
        house: cut(['wall-east']),
        excerpt: surfaceOf('wall-east'),
        first: 'wall-east',
    },
    {
        id: 'edge',
        house: cut(['floor', 'wall-south', 'wall-west'], ['edgeJoints', 'jointStandards']),
        excerpt: {
            edgeJoints: (caseHouse as HouseFile).edgeJoints
                .filter((j) => j.edge === 'edge/wall-south%7Cwall-west')
                .map((j) => ({ ...j, cuts: [...j.cuts.slice(0, 3), '…'] })),
            jointStandards: caseHouse.jointStandards,
        },
        first: 'wall-west',
    },
    {
        id: 'rooms',
        house: cut(['floor', ...WALLS, ...PARTITIONS], ['zones']),
        excerpt: { zones: caseHouse.zones, s3: surfaceOf('s3') },
        first: 's3',
    },
    {
        id: 'house',
        house: caseHouse as Record<string, unknown>,
        excerpt: null,
        first: 'roof-1',
    },
];

/**
 * JSON the way a person reads a house file: a point, a short list of numbers, on one line;
 * everything else indented.
 */
export function readableJson(value: unknown, indent = ''): string {
    const inner = `${indent}  `;
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        if (value.every((v) => typeof v === 'number')) return `[${value.join(', ')}]`;
        if (value.every((v) => Array.isArray(v) && v.every((n) => typeof n === 'number'))) {
            const one = `[${value.map((v) => readableJson(v)).join(', ')}]`;
            if (one.length + indent.length < 96) return one;
        }
        return `[\n${value.map((v) => inner + readableJson(v, inner)).join(',\n')}\n${indent}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) return '{}';
        const one = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${readableJson(v)}`).join(', ')} }`;
        if (one.length + indent.length < 90 && !one.includes('\n')) return one;
        return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${readableJson(v, inner)}`).join(',\n')}\n${indent}}`;
    }
    return JSON.stringify(value);
}
