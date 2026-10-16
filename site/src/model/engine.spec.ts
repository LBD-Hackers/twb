import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ox from 'oxigraph';
import { describe, expect, it } from 'vitest';
import caseHouse from '../../../ontology/examples/case-house.json';
import { Engine, NO_CHANGES } from './engine';
import { RULE_FILES } from './rdf-protocol';

const ONTOLOGY = fileURLToPath(new URL('../../../ontology/', import.meta.url));
const read = (path: string) => readFileSync(`${ONTOLOGY}${path}`, 'utf8');

const engine = new Engine(ox, {
    graph: [
        'imports/bot.ttl',
        'twb.ttl',
        ...[
            'core',
            'construction',
            'detailing',
            'requirements',
            'profile',
            'decision',
            'derivation',
            'housefile',
            'doc',
        ].map((m) => `twb-${m}.ttl`),
        'twb-catalogue.ttl',
        'examples/case-house.ttl',
        'examples/case-house-rules.ttl',
        'examples/case-house-use-rules.ttl',
    ].map(read),
    shapes: read('twb-shapes.ttl'),
    rules: RULE_FILES.map((name) => ({ name, text: read(`queries/rules/${name}.rq`) })),
    repair: read('queries/repair-wet-room-coverings.ru'),
    context: read('twb-house.context.jsonld'),
});

const INST = 'https://example.org/twb/case-house/';

describe('the checks on the case house', () => {
    it('finds the five boundaries towards the bathroom without a wet-room lining, as the paper does', () => {
        const r = engine.check(NO_CHANGES);
        const wet = r.violations.filter((v) => v.shape === 'CapabilityShape');
        expect(wet).toHaveLength(5);
        expect(new Set(wet.map((v) => v.bindings['surface']))).toEqual(
            new Set(
                ['floor', 'wall-east', 'wall-south', 's3', 's4'].map((s) => `${INST}surface/${s}`)
            )
        );
        expect(r.violations.filter((v) => v.shape !== 'CapabilityShape')).toHaveLength(0);
    });

    it('conforms once the repair has added the coverings', () => {
        const r = engine.check({ ...NO_CHANGES, repair: true });
        expect(r.violations).toHaveLength(0);
        expect(r.requirements.filter((q) => q.providedBy === 'covering')).toHaveLength(5);
    });

    it('reports bedroom 1 with no way out when its door opens from the living room only', () => {
        const r = engine.check({
            ...NO_CHANGES,
            repair: true,
            openableFrom: { [`${INST}passage/s3-s3h2`]: `${INST}zone/z-living` },
        });
        expect(r.violations.map((v) => [v.shape, v.focus])).toEqual([
            ['EgressShape', `${INST}zone/z-bed1`],
        ]);
        expect(r.ways.find((w) => w.zone === `${INST}zone/z-bed1`)).toMatchObject({
            reachable: true,
            canLeave: false,
        });
    });

    it('holds a wall recipe to BR18’s 0.30 W/m²K', () => {
        const recipe = `${INST}recipe/exteriorWall`;
        const r = engine.check({ ...NO_CHANGES, repair: true, uValues: { [recipe]: 0.35 } });
        const u = r.violations.filter((v) => v.shape === 'UValueShape');
        expect(u).toHaveLength(4);
        expect(r.uValues.filter((c) => c.recipe === recipe).every((c) => c.max === 0.3)).toBe(true);
    });

    it('draws the plan from the graph: four exterior walls, four partitions, four rooms and the doors', () => {
        const { plan } = engine.check(NO_CHANGES);
        expect(plan.walls.filter((w) => w.exterior)).toHaveLength(4);
        expect(plan.walls.filter((w) => !w.exterior)).toHaveLength(4);
        expect(plan.zones.map((z) => z.label).sort()).toEqual([
            'Bathroom',
            'Bedroom 1',
            'Bedroom 2',
            'Living and kitchen',
        ]);
        expect(plan.openings.filter((o) => o.kind === 'Door' && o.passage)).toHaveLength(4);
    });
});

describe('a house file read as JSON-LD', () => {
    it('makes the 332 triples the ontology README counts', () => {
        const g = engine.readHouse(JSON.stringify(caseHouse));
        expect(g.size).toBe(332);
        expect(g.classes().find((c) => c.cls === 'twb:Surface')?.n).toBe(11);
        const wall = g.describe('https://example.org/house/wall-east');
        expect(wall.some((l) => l.predicate === 'a' && l.object === 'twb:Surface')).toBe(true);
        expect(wall.filter((l) => l.nested?.some((n) => n.object === 'twb:Window'))).toHaveLength(
            2
        );
    });
});
