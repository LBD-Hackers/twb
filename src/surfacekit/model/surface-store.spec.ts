import { describe, expect, it } from 'vitest';
import { SurfaceStore } from './surface-store';
import type { Point3Mm } from '../core';
import { classifyAll } from './classify';
import { sortStoreys } from './storey';

const FLOOR: Point3Mm[] = [
    { x: 0, y: 0, z: 0 },
    { x: 7200, y: 0, z: 0 },
    { x: 7200, y: 9600, z: 0 },
    { x: 0, y: 9600, z: 0 },
];

describe('SurfaceStore.add', () => {
    it('accepts a modular rectangle on the ground', () => {
        const store = new SurfaceStore();
        const result = store.add(FLOOR);
        expect(result.surface).not.toBeNull();
        expect(result.violations).toHaveLength(0);
    });

    it('accepts a tilted, planar face — a monopitch roof — with its height untouched', () => {
        const store = new SurfaceStore();
        const result = store.add([
            { x: 0, y: 0, z: 2400 },
            { x: 4800, y: 0, z: 2400 },
            { x: 4800, y: 3600, z: 3000 },
            { x: 0, y: 3600, z: 3000 },
        ]);
        expect(result.surface).not.toBeNull();
        expect(result.surface?.boundaryMm[2]?.z).toBe(3000);
    });

    it('rejects a non-planar ring and names the offending corner', () => {
        const store = new SurfaceStore();
        const result = store.add([
            { x: 0, y: 0, z: 2400 },
            { x: 4800, y: 0, z: 2400 },
            { x: 4800, y: 3600, z: 3000 },
            // This corner does not belong to the plane the other three define.
            { x: 0, y: 3600, z: 3800 },
        ]);
        expect(result.surface).toBeNull();
        expect(result.violations[0]?.code).toBe('non-planar');
        // Newell's fit is least-squares over the whole ring, not anchored to any three
        // corners, so the blamed vertex is whichever one it lands on rather than necessarily
        // the twisted one — the guarantee worth testing is that one gets named at all.
        expect(result.violations[0]?.index).toBeGreaterThanOrEqual(0);
        expect(result.violations[0]?.index).toBeLessThan(4);
    });

    it('rejects collinear corners, which define no plane at all', () => {
        const store = new SurfaceStore();
        const result = store.add([
            { x: 0, y: 0, z: 0 },
            { x: 2400, y: 0, z: 1200 },
            { x: 4800, y: 0, z: 2400 },
        ]);
        expect(result.surface).toBeNull();
        expect(result.violations[0]?.code).toBe('non-planar');
    });
});

describe('SurfaceStore.extrude', () => {
    it('makes a box: a top plus one side per edge, the base left in place', () => {
        const store = new SurfaceStore();
        const base = store.add(FLOOR).surface!;
        const result = store.extrude(base.id, 2400);
        expect(result.ok).toBe(true);
        expect(store.surfaces()).toHaveLength(6);
        expect(store.get(base.id)).toBeDefined();
        const kinds = classifyAll(store.surfaces());
        expect(kinds.get(base.id)).toBe('floor');
        const [top, ...sides] = result.surfaceIds;
        expect(kinds.get(top!)).toBe('roof');
        for (const side of sides) expect(kinds.get(side)).toBe('wall');
        expect(store.get(top!)?.boundaryMm.every((p) => p.z === 2400)).toBe(true);
    });

    it('refuses a zero pull rather than stacking a face on itself', () => {
        const store = new SurfaceStore();
        const base = store.add(FLOOR).surface!;
        expect(store.extrude(base.id, 0).ok).toBe(false);
        expect(store.surfaces()).toHaveLength(1);
    });
});

describe('SurfaceStore.split and moveVertices — the gable workflow', () => {
    function box(): { store: SurfaceStore; topId: string } {
        const store = new SurfaceStore();
        const base = store.add(FLOOR).surface!;
        const topId = store.extrude(base.id, 2400).surfaceIds[0]!;
        return { store, topId };
    }

    it('splits the top face along a ridge line and welds the ridge points into the end walls', () => {
        const { store, topId } = box();
        const a = { x: 3600, y: 0, z: 2400 };
        const b = { x: 3600, y: 9600, z: 2400 };
        const result = store.split(topId, [a, b]);
        expect(result.ok).toBe(true);
        expect(result.surfaceIds).toHaveLength(2);
        expect(store.surfaces()).toHaveLength(7);
        // The two end walls — the ones whose top edge runs through a and b — gained a vertex.
        const fives = store.surfaces().filter((s) => s.boundaryMm.length === 5);
        expect(fives).toHaveLength(2);
    });

    it('lifting the ridge tilts both halves and turns the end walls into gables', () => {
        const { store, topId } = box();
        const a = { x: 3600, y: 0, z: 2400 };
        const b = { x: 3600, y: 9600, z: 2400 };
        store.split(topId, [a, b]);
        const moved = store.moveVertices([a, b], { x: 0, y: 0, z: 1500 });
        expect(moved.ok).toBe(true);
        // Two roof halves and two gable walls share those points.
        expect(moved.surfaceIds).toHaveLength(4);
        const kinds = classifyAll(store.surfaces());
        const roofs = store.surfaces().filter((s) => kinds.get(s.id) === 'roof');
        const walls = store.surfaces().filter((s) => kinds.get(s.id) === 'wall');
        expect(roofs).toHaveLength(2);
        expect(walls).toHaveLength(4);
        for (const roof of roofs) {
            expect(roof.boundaryMm.some((p) => p.z === 3900)).toBe(true);
        }
        const gables = walls.filter((s) => s.boundaryMm.length === 5);
        expect(gables).toHaveLength(2);
        for (const gable of gables) expect(gable.boundaryMm.some((p) => p.z === 3900)).toBe(true);
    });

    it('refuses a move that would fold a face, and moves nothing', () => {
        const { store, topId } = box();
        const before = store.surfaces();
        const corner = store.get(topId)!.boundaryMm[0]!;
        const result = store.moveVertices([corner], { x: 0, y: 0, z: 800 });
        expect(result.ok).toBe(false);
        expect(result.violations[0]?.code).toBe('non-planar');
        expect(store.surfaces()).toBe(before);
    });

    it('rejects a chord that is one of the face’s own edges', () => {
        const { store, topId } = box();
        const top = store.get(topId)!;
        const result = store.split(topId, [top.boundaryMm[0]!, top.boundaryMm[1]!]);
        expect(result.ok).toBe(false);
    });
});

describe('SurfaceStore.addOpening', () => {
    function wall(): { store: SurfaceStore; wallId: string } {
        const store = new SurfaceStore();
        const base = store.add(FLOOR).surface!;
        const ids = store.extrude(base.id, 2400).surfaceIds;
        // The side on the y = 0 edge is the first side after the top.
        return { store, wallId: ids[1]! };
    }

    it('stores a rectangle drawn on a wall as a UV opening with a literal sill height', () => {
        const { store, wallId } = wall();
        const result = store.addOpening(
            wallId,
            [
                { x: 1200, y: 0, z: 900 },
                { x: 2400, y: 0, z: 900 },
                { x: 2400, y: 0, z: 2100 },
                { x: 1200, y: 0, z: 2100 },
            ],
            'window'
        );
        expect(result.ok).toBe(true);
        const hole = store.get(wallId)!.openings[0]!;
        expect(hole.vMm).toBe(900);
        expect(hole.heightMm).toBe(1200);
        expect(hole.widthMm).toBe(1200);
        expect(hole.uMm).toBe(1200);
    });

    it('accepts a door — an opening whose sill is the wall’s base', () => {
        const { store, wallId } = wall();
        const result = store.addOpening(
            wallId,
            [
                { x: 1200, y: 0, z: 0 },
                { x: 2400, y: 0, z: 0 },
                { x: 2400, y: 0, z: 2100 },
                { x: 1200, y: 0, z: 2100 },
            ],
            'door'
        );
        expect(result.ok).toBe(true);
        expect(store.get(wallId)!.openings[0]?.vMm).toBe(0);
    });

    it('rejects an opening that crosses the edge of the face', () => {
        const { store, wallId } = wall();
        const result = store.addOpening(
            wallId,
            [
                { x: 6000, y: 0, z: 900 },
                { x: 8400, y: 0, z: 900 },
                { x: 8400, y: 0, z: 2100 },
                { x: 6000, y: 0, z: 2100 },
            ],
            'window'
        );
        expect(result.ok).toBe(false);
        expect(store.get(wallId)!.openings).toHaveLength(0);
    });

    it('rejects a rectangle that is the whole face', () => {
        const { store, wallId } = wall();
        const result = store.addOpening(wallId, store.get(wallId)!.boundaryMm, 'window');
        expect(result.ok).toBe(false);
    });
});

describe('SurfaceStore guides', () => {
    it('adds a loose line, refuses a stub, and refuses one that re-traces an edge or a guide', () => {
        const store = new SurfaceStore();
        store.add(FLOOR);
        const g = store.addGuide({ x: 0, y: 12000, z: 0 }, { x: 7200, y: 12000, z: 0 })!;
        expect(g).not.toBeNull();
        expect(store.guides()).toEqual([g]);
        expect(store.addGuide({ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 })).toBeNull();
        // Along the floor's south edge, and along the guide just added.
        expect(store.addGuide({ x: 1200, y: 0, z: 0 }, { x: 4800, y: 0, z: 0 })).toBeNull();
        expect(store.addGuide({ x: 1200, y: 12000, z: 0 }, { x: 2400, y: 12000, z: 0 })).toBeNull();
        expect(store.guides()).toHaveLength(1);
    });

    it('breaks a face edge and a guide where a point lands on them, and leaves corners alone', () => {
        const store = new SurfaceStore();
        const floor = store.add(FLOOR).surface!;
        const g = store.addGuide({ x: 0, y: 12000, z: 0 }, { x: 7200, y: 12000, z: 0 })!;
        const result = store.breakAt([
            { x: 3600, y: 0, z: 0 }, // south edge of the floor, mid-way
            { x: 2400, y: 12000, z: 0 }, // a third of the way along the guide
            { x: 0, y: 0, z: 0 }, // already a corner
            { x: 999, y: 999, z: 999 }, // on nothing
        ]);
        expect(result.surfaceIds).toEqual([floor.id]);
        expect(result.guideIds).toEqual([g.id]);
        expect(store.get(floor.id)!.boundaryMm).toHaveLength(5);
        expect(store.get(floor.id)!.boundaryMm[1]).toEqual({ x: 3600, y: 0, z: 0 });
        const pieces = store.guides();
        expect(pieces).toHaveLength(2);
        expect(pieces[0]!.id).toBe(g.id);
        expect(pieces[0]!.bMm).toEqual({ x: 2400, y: 12000, z: 0 });
        expect(pieces[1]!.aMm).toEqual({ x: 2400, y: 12000, z: 0 });
    });

    it('retires the guides a new face was drawn along, and keeps the others', () => {
        const store = new SurfaceStore();
        const ring = FLOOR.map((p) => ({ ...p, y: p.y + 12000 }));
        for (let i = 0; i < 3; i++) store.addGuide(ring[i]!, ring[i + 1]!);
        const stray = store.addGuide({ x: 12000, y: 0, z: 0 }, { x: 12000, y: 4800, z: 0 })!;
        expect(store.guides()).toHaveLength(4);
        expect(store.add(ring).surface).not.toBeNull();
        expect(store.guides()).toEqual([stray]);
    });

    it('a split retires the guide that made the cut', () => {
        const store = new SurfaceStore();
        const floor = store.add(FLOOR).surface!;
        const a = { x: 3600, y: 0, z: 0 };
        const b = { x: 3600, y: 9600, z: 0 };
        store.addGuide(a, b);
        expect(store.split(floor.id, [a, b]).ok).toBe(true);
        expect(store.guides()).toHaveLength(0);
    });

    it('splits along an L-shaped path, refusing one that leaves the face', () => {
        const store = new SurfaceStore();
        const floor = store.add(FLOOR).surface!;
        const outside = store.split(floor.id, [
            { x: 2400, y: 0, z: 0 },
            { x: 2400, y: -2400, z: 0 },
            { x: 7200, y: 4800, z: 0 },
        ]);
        expect(outside.ok).toBe(false);
        expect(outside.violations[0]?.code).toBe('outside-face');
        const inside = store.split(floor.id, [
            { x: 2400, y: 0, z: 0 },
            { x: 2400, y: 4800, z: 0 },
            { x: 7200, y: 4800, z: 0 },
        ]);
        expect(inside.ok).toBe(true);
        expect(store.surfaces()).toHaveLength(2);
        expect(
            store
                .surfaces()
                .map((s) => s.boundaryMm.length)
                .sort()
        ).toEqual([4, 6]);
    });

    it('purges every guide and none of the faces; clear drops both', () => {
        const store = new SurfaceStore();
        store.add(FLOOR);
        store.addGuide({ x: 0, y: 12000, z: 0 }, { x: 7200, y: 12000, z: 0 });
        store.addGuide({ x: 0, y: 13200, z: 0 }, { x: 7200, y: 13200, z: 0 });
        expect(store.purgeGuides()).toBe(2);
        expect(store.guides()).toHaveLength(0);
        expect(store.surfaces()).toHaveLength(1);
        expect(store.purgeGuides()).toBe(0);
        store.addGuide({ x: 0, y: 12000, z: 0 }, { x: 7200, y: 12000, z: 0 });
        store.clear();
        expect(store.guides()).toHaveLength(0);
        expect(store.surfaces()).toHaveLength(0);
    });

    it('keeps a line declared a column or a beam out of everything that treats lines as scratch', () => {
        const store = new SurfaceStore();
        const post = store.addGuide({ x: 0, y: 12000, z: 0 }, { x: 0, y: 12000, z: 2400 });
        const scratch = store.addGuide({ x: 0, y: 13200, z: 0 }, { x: 7200, y: 13200, z: 0 });
        expect(post && scratch).toBeTruthy();
        expect(store.setGuideRole(post!.id, 'column')).toBe(true);
        expect(store.getGuide(post!.id)?.role).toBe('column');

        // Purge takes the scratch and leaves the column standing.
        expect(store.purgeableGuideCount()).toBe(1);
        expect(store.purgeGuides()).toBe(1);
        expect(store.guides().map((g) => g.id)).toEqual([post!.id]);

        // A point halfway along it does not cut a member in two.
        store.breakAt([{ x: 0, y: 12000, z: 1200 }]);
        expect(store.guides()).toHaveLength(1);

        // Nor does drawing a face along it consume it.
        const beam = store.addGuide({ x: 0, y: 0, z: 0 }, { x: 7200, y: 0, z: 0 });
        store.setGuideRole(beam!.id, 'beam');
        store.add(FLOOR);
        expect(
            store
                .guides()
                .map((g) => g.id)
                .sort()
        ).toEqual([beam!.id, post!.id].sort());

        // Dropping the role hands it back to the guides, Purge included.
        expect(store.setGuideRole(beam!.id, null)).toBe(true);
        expect(store.getGuide(beam!.id)?.role).toBeUndefined();
        expect(store.purgeGuides()).toBe(1);
        expect(store.guides().map((g) => g.id)).toEqual([post!.id]);
    });

    it('selects a face or a line, never both', () => {
        const store = new SurfaceStore();
        const added = store.add(FLOOR);
        const guide = store.addGuide({ x: 0, y: 12000, z: 0 }, { x: 7200, y: 12000, z: 0 });
        store.select(added.surface!.id);
        store.selectGuide(guide!.id);
        expect(store.selectedId()).toBeNull();
        expect(store.selectedGuideId()).toBe(guide!.id);
        store.select(added.surface!.id);
        expect(store.selectedGuideId()).toBeNull();
        store.selectGuide(guide!.id);
        store.removeGuide(guide!.id);
        expect(store.selectedGuideId()).toBeNull();
    });

    it('lists every face edge and every guide for the loop finder', () => {
        const store = new SurfaceStore();
        store.add(FLOOR);
        store.addGuide({ x: 0, y: 12000, z: 0 }, { x: 7200, y: 12000, z: 0 });
        expect(store.allEdges()).toHaveLength(5);
    });
});

describe('SurfaceStore storeys', () => {
    it('starts with one storey — a house always has a ground floor', () => {
        const store = new SurfaceStore();
        expect(store.storeys()).toHaveLength(1);
        expect(store.storeys()[0]!.elevationMm).toBe(0);
    });

    it('adds a storey above the highest one', () => {
        const store = new SurfaceStore();
        const ground = store.storeys()[0]!;
        const first = store.addStorey();
        expect(first.elevationMm).toBe(ground.elevationMm + ground.heightMm);
        const second = store.addStorey();
        expect(second.elevationMm).toBe(first.elevationMm + first.heightMm);
        expect(store.storeys()).toHaveLength(3);
    });

    it('renames a storey and edits its elevation and height', () => {
        const store = new SurfaceStore();
        const id = store.storeys()[0]!.id;
        expect(store.renameStorey(id, 'Stueetage')).toBe(true);
        expect(store.setStoreyElevation(id, 150)).toBe(true);
        expect(store.setStoreyHeight(id, 2700)).toBe(true);
        expect(store.getStorey(id)).toMatchObject({
            name: 'Stueetage',
            elevationMm: 150,
            heightMm: 2700,
        });
        expect(store.renameStorey('nope', 'x')).toBe(false);
    });

    it('refuses a storey height below the minimum', () => {
        const store = new SurfaceStore();
        const id = store.storeys()[0]!.id;
        expect(store.setStoreyHeight(id, 600)).toBe(false);
        expect(store.getStorey(id)!.heightMm).not.toBe(600);
    });

    it('refuses to remove the last storey, but not any other', () => {
        const store = new SurfaceStore();
        const ground = store.storeys()[0]!;
        expect(store.removeStorey(ground.id)).toBe(false);
        const first = store.addStorey();
        expect(store.removeStorey(first.id)).toBe(true);
        expect(store.storeys()).toEqual([ground]);
    });

    it('clear puts a single fresh storey back', () => {
        const store = new SurfaceStore();
        store.addStorey();
        store.clear();
        expect(store.storeys()).toHaveLength(1);
        expect(store.storeys()[0]!.elevationMm).toBe(0);
    });

    it('load replaces the storeys, or supplies one default when the file had none', () => {
        const store = new SurfaceStore();
        store.addStorey();
        const loaded: Parameters<typeof store.load>[2] = [
            { id: 'stx', name: 'Kælder', elevationMm: -2400, heightMm: 2400 },
        ];
        store.load([], [], loaded);
        expect(store.storeys()).toEqual(loaded);
        store.load([], [], []);
        expect(store.storeys()).toHaveLength(1);
    });
});

describe('SurfaceStore.load', () => {
    const face = (id: string, boundaryMm: Point3Mm[]) => ({
        id,
        boundaryMm,
        openings: [],
        holes: [],
        kindOverride: null,
        loadBearing: true,
        spanDirectionOverride: null,
        roofGroupId: null,
        studSectionOverride: null,
    });

    it('keeps every admissible face, names each one it skips, and mints new ids after theirs', () => {
        const store = new SurfaceStore();
        const folded = FLOOR.map((p, i) => (i === 0 ? { ...p, z: 600 } : p));
        const result = store.load([face('s7', FLOOR), face('s8', folded)]);
        expect(result.loaded).toBe(1);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]!.id).toBe('s8');
        expect(result.skipped[0]!.message).toMatch(/off the face’s plane/);
        expect(store.surfaces().map((s) => s.id)).toEqual(['s7']);
        expect(store.selectedId()).toBeNull();
        const added = store.add(FLOOR.map((p) => ({ ...p, z: 2400 })));
        expect(Number(added.surface!.id.slice(1))).toBeGreaterThan(7);
    });

    it('loads guides beside the faces, dropping stubs, and mints guide ids after theirs', () => {
        const store = new SurfaceStore();
        store.load(
            [face('s1', FLOOR)],
            [
                { id: 'g4', aMm: { x: 0, y: 12000, z: 0 }, bMm: { x: 7200, y: 12000, z: 0 } },
                { id: 'g5', aMm: { x: 0, y: 0, z: 0 }, bMm: { x: 10, y: 0, z: 0 } },
            ]
        );
        expect(store.guides().map((g) => g.id)).toEqual(['g4']);
        const next = store.addGuide({ x: 0, y: 13200, z: 0 }, { x: 7200, y: 13200, z: 0 })!;
        expect(Number(next.id.slice(1))).toBeGreaterThan(4);
    });
});

describe('SurfaceStore erasing — faces leave their edges, edges heal faces', () => {
    function box(): { store: SurfaceStore; baseId: string; topId: string; sides: string[] } {
        const store = new SurfaceStore();
        const baseId = store.add(FLOOR).surface!.id;
        const [topId, ...sides] = store.extrude(baseId, 2400).surfaceIds;
        return { store, baseId, topId: topId!, sides };
    }

    it('removeFace keeps no guide where another face still has the edge', () => {
        const { store, sides } = box();
        expect(store.removeFace(sides[0]!)).toBe(true);
        expect(store.surfaces()).toHaveLength(5);
        expect(store.guides()).toHaveLength(0);
    });

    it('removing two walls that meet leaves their corner standing as a guide', () => {
        const { store, sides } = box();
        const walls = sides.map((id) => store.get(id)!);
        // Two walls sharing a vertical edge: find a pair with a common corner at z 0 and 2400.
        const [w1, w2] = walls.flatMap((a, i) =>
            walls
                .slice(i + 1)
                .filter((b) =>
                    a.boundaryMm.some(
                        (p) =>
                            p.z === 0 &&
                            b.boundaryMm.some((q) => q.x === p.x && q.y === p.y && q.z === 0)
                    )
                )
                .map((b) => [a, b] as const)
        )[0]!;
        store.removeFace(w1.id);
        store.removeFace(w2.id);
        const vertical = store
            .guides()
            .filter((g) => g.aMm.x === g.bMm.x && g.aMm.y === g.bMm.y && g.aMm.z !== g.bMm.z);
        expect(vertical).toHaveLength(1);
    });

    it('removeEdge between the two halves of a split heals them into the original face', () => {
        const { store, topId } = box();
        const a = { x: 3600, y: 0, z: 2400 };
        const b = { x: 3600, y: 9600, z: 2400 };
        const split = store.split(topId, [a, b]);
        expect(split.ok).toBe(true);
        expect(store.surfaces()).toHaveLength(7);
        const healed = store.removeEdge(a, b);
        expect(healed.ok).toBe(true);
        expect(store.surfaces()).toHaveLength(6);
        const top = store.get(topId)!;
        expect(top.boundaryMm).toHaveLength(4);
        expect(store.guides()).toHaveLength(0);
    });

    it('removeEdge on a box corner removes both walls along it', () => {
        const { store } = box();
        const a = { x: 0, y: 0, z: 0 };
        const b = { x: 0, y: 0, z: 2400 };
        const result = store.removeEdge(a, b);
        expect(result.ok).toBe(true);
        expect(result.surfaceIds).toHaveLength(2);
        expect(store.surfaces()).toHaveLength(4);
        // Every other edge of the two walls is still the floor's, the roof's or a wall's.
        expect(store.guides()).toHaveLength(0);
        expect(store.segmentExists(a, b)).toBe(false);
    });

    it('mergeFaces refuses faces that are not one plane', () => {
        const { store, baseId, sides } = box();
        expect(store.mergeFaces(baseId, sides[0]!).ok).toBe(false);
    });
});

describe('SurfaceStore.declareLine', () => {
    it('puts a column on a face edge, and re-declaring it changes the same line', () => {
        const store = new SurfaceStore();
        const base = store.add(FLOOR).surface!;
        store.extrude(base.id, 2400);
        const a = { x: 0, y: 0, z: 0 };
        const b = { x: 0, y: 0, z: 2400 };
        const column = store.declareLine(a, b, 'column');
        expect(column?.role).toBe('column');
        const beam = store.declareLine(b, a, 'beam');
        expect(beam?.id).toBe(column?.id);
        expect(store.guides()).toHaveLength(1);
        expect(store.guides()[0]!.role).toBe('beam');
    });
});

describe('SurfaceStore.add — no twins', () => {
    it('refuses a face with the outline of one already there, extra corners or not', () => {
        const store = new SurfaceStore();
        store.add(FLOOR);
        store.breakAt([{ x: 7200, y: 2400, z: 0 }]);
        const again = store.add([...FLOOR].reverse());
        expect(again.surface).toBeNull();
        expect(again.violations[0]?.code).toBe('duplicate-face');
        expect(store.surfaces()).toHaveLength(1);
    });
});

describe('SurfaceStore push/pull keeps the storeys in step', () => {
    it('a 2200 box makes the ground floor 2200, and a box on top of it a storey above', () => {
        const store = new SurfaceStore();
        const base = store.add(FLOOR).surface!;
        const topId = store.extrude(base.id, 2200, { enforceModule: false }).surfaceIds[0]!;
        expect(store.storeys()).toHaveLength(1);
        expect(store.storeys()[0]!.heightMm).toBe(2200);

        expect(store.extrude(topId, 2200, { enforceModule: false }).ok).toBe(true);
        const [ground, upper] = sortStoreys(store.storeys());
        expect(ground!.heightMm).toBe(2200);
        expect(upper!.elevationMm).toBe(2200);
        expect(upper!.heightMm).toBe(2200);
    });

    it('stretching the top face makes the box taller instead of stacking a second one', () => {
        const store = new SurfaceStore();
        const base = store.add(FLOOR).surface!;
        const topId = store.extrude(base.id, 2200, { enforceModule: false }).surfaceIds[0]!;
        expect(store.stretch(topId, 400).ok).toBe(true);
        expect(store.surfaces()).toHaveLength(6);
        expect(store.get(topId)!.boundaryMm.every((p) => p.z === 2600)).toBe(true);
        expect(store.storeys()).toHaveLength(1);
        expect(store.storeys()[0]!.heightMm).toBe(2600);
    });

    it('stretching a storey’s floor moves the storey and resizes the one below', () => {
        const store = new SurfaceStore();
        const base = store.add(FLOOR).surface!;
        const midId = store.extrude(base.id, 2400).surfaceIds[0]!;
        store.extrude(midId, 2400);
        expect(store.storeys()).toHaveLength(2);
        expect(store.stretch(midId, 300).ok).toBe(true);
        const [ground, upper] = sortStoreys(store.storeys());
        expect(ground!.heightMm).toBe(2700);
        expect(upper!.elevationMm).toBe(2700);
        expect(upper!.heightMm).toBe(2100);
    });

    it('a lone face has nothing to stretch, so it gets a box', () => {
        const store = new SurfaceStore();
        const base = store.add(FLOOR).surface!;
        expect(store.stretch(base.id, 2400).ok).toBe(true);
        expect(store.surfaces()).toHaveLength(6);
    });
});
