import { describe, expect, it } from 'vitest';
import { ONTOLOGY_COUNTS } from './DataModel';
import { buildGraph, classDetail, data } from './graph';
import { TWB_MODULES } from './modules';

describe('the schema graph', () => {
    it('states the counts of the captured ontology', () => {
        expect(ONTOLOGY_COUNTS).toEqual({
            classes: data.classes.length,
            objectProperties: data.objectProperties.length,
            datatypeProperties: data.datatypeProperties.length,
            version: data.version,
        });
    });

    it('lists the modules as the captured ontology has them', () => {
        expect(TWB_MODULES).toEqual(
            data.modules.map(({ id, imports, classes, objectProperties, datatypeProperties }) => ({
                id,
                imports,
                classes,
                objectProperties,
                datatypeProperties,
            }))
        );
        // Every term is defined by a module.
        const terms = [...data.classes, ...data.objectProperties, ...data.datatypeProperties];
        expect(terms.every((t) => t.module)).toBe(true);
    });

    it('draws every class of the visible modules, and links only nodes it draws', () => {
        const all = new Set(data.modules.map((m) => m.id));
        const { nodes, links } = buildGraph({ modules: all, external: true, vocabularies: true });
        const ids = new Set(nodes.map((n) => n.id));
        expect(data.classes.every((c) => ids.has(c.id))).toBe(true);
        expect(links.every((l) => ids.has(String(l.source)) && ids.has(String(l.target)))).toBe(
            true
        );
    });

    it('puts a surface under bot:Element with its sides and recipe as relations', () => {
        const d = classDetail('twb:Surface');
        expect(d.superClasses).toContain('bot:Element');
        expect(d.subClasses).toEqual(
            expect.arrayContaining(['twb:WallSurface', 'twb:FloorSurface'])
        );
        expect(d.outgoing.map((p) => p.id)).toEqual(
            expect.arrayContaining(['twb:hasRecipe', 'twb:hasSide'])
        );
        expect(d.instances).toBeGreaterThan(10);
    });
});
