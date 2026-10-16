import { describe, expect, it } from 'vitest';
import type { Point3Mm } from '../core';
import { SurfaceStore } from './surface-store';
import { interiorWallSegmentRings } from './interior-wall-geometry';
import { pitchMoves, pitchTargets } from './pitch';
import { roofFollowMoves } from './roof-follow';
import type { VertexMove } from './surface-ops';

const FLOOR: Point3Mm[] = [
    { x: 0, y: 0, z: 0 },
    { x: 7200, y: 0, z: 0 },
    { x: 7200, y: 9600, z: 0 },
    { x: 0, y: 9600, z: 0 },
];

/** The ridge's two ends, wherever they currently stand — it moves with every re-pitch. */
function ridgeOf(store: SurfaceStore): Point3Mm[] {
    const ends: Point3Mm[] = [];
    for (const y of [0, 9600]) {
        let top: Point3Mm | null = null;
        for (const s of store.surfaces()) {
            for (const p of s.boundaryMm) {
                if (p.x === 3600 && p.y === y && (!top || p.z > top.z)) top = p;
            }
        }
        ends.push(top!);
    }
    return ends;
}

/**
 * The gabled box with an interior wall running across it under the ridge — the case the roof
 * edit used to leave behind. Its top edge is two pieces, meeting at the ridge crossing.
 */
function houseWithInteriorWall(): { store: SurfaceStore; wallIds: string[] } {
    const store = new SurfaceStore();
    const base = store.add(FLOOR).surface!;
    const topId = store.extrude(base.id, 2400).surfaceIds[0]!;
    const a = { x: 3600, y: 0, z: 2400 };
    const b = { x: 3600, y: 9600, z: 2400 };
    store.split(topId, [a, b]);
    store.moveVertices([a, b], { x: 0, y: 0, z: 1500 });

    const pieces = interiorWallSegmentRings(
        store.surfaces(),
        store.storeys(),
        store.storeys()[0]!,
        { x: 0, y: 4800 },
        { x: 7200, y: 4800 }
    );
    const wallIds = pieces.map((p) => store.add(p.ringMm, { enforceModule: false }).surface!.id);
    return { store, wallIds };
}

/** The apex of the interior wall run: its corner on the ridge line, between the ridge's ends. */
function apexZ(store: SurfaceStore, wallIds: readonly string[]): number[] {
    return wallIds.map(
        (id) => store.get(id)!.boundaryMm.find((p) => p.x === 3600 && p.y === 4800 && p.z > 0)!.z
    );
}

function repitch(store: SurfaceStore, pitchDeg: number): readonly VertexMove[] {
    const ridge = ridgeOf(store);
    const target = pitchTargets(store.surfaces(), ridge)[0]!;
    return pitchMoves(target, ridge, pitchDeg);
}

describe('roofFollowMoves', () => {
    it('takes the interior wall’s top up with a re-pitched roof', () => {
        const { store, wallIds } = houseWithInteriorWall();
        expect(apexZ(store, wallIds)).toEqual([3900, 3900]);

        const moves = repitch(store, 45);
        const followers = roofFollowMoves(store.surfaces(), moves);
        expect(store.moveVerticesTo([...moves, ...followers]).ok).toBe(true);

        // 45° over a 3600 run from the 2400 eave.
        expect(apexZ(store, wallIds)).toEqual([6000, 6000]);
    });

    it('takes it back down again, and the wall is still one plane', () => {
        const { store, wallIds } = houseWithInteriorWall();
        const up = repitch(store, 45);
        store.moveVerticesTo([...up, ...roofFollowMoves(store.surfaces(), up)]);

        const down = repitch(store, 15);
        const result = store.moveVerticesTo([...down, ...roofFollowMoves(store.surfaces(), down)]);

        expect(result.ok).toBe(true);
        // 2400 + 3600·tan15 = 3364.6
        expect(apexZ(store, wallIds)).toEqual([3365, 3365]);
    });

    it('follows a plain rise too — the walls do not care which number was typed', () => {
        const { store, wallIds } = houseWithInteriorWall();
        const lifted = ridgeOf(store).map((p) => ({ fromMm: p, toMm: { ...p, z: p.z + 600 } }));
        const result = store.moveVerticesTo([
            ...lifted,
            ...roofFollowMoves(store.surfaces(), lifted),
        ]);

        expect(result.ok).toBe(true);
        expect(apexZ(store, wallIds)).toEqual([4500, 4500]);
    });

    it('adds nothing for the faces that already share a corner with the roof', () => {
        const { store } = houseWithInteriorWall();
        const followers = roofFollowMoves(store.surfaces(), repitch(store, 45));

        // The gables and the eave walls have their tops *at* the roof's own corners, so they
        // move by coincidence. The interior wall's apex is the one position that does not, and
        // both of its pieces share it, so it is one move and not two.
        expect(followers).toHaveLength(1);
        expect(followers[0]!.fromMm).toMatchObject({ x: 3600, y: 4800 });
    });

    it('is empty when nothing moved, and leaves a wall with no roof over it alone', () => {
        const { store } = houseWithInteriorWall();
        expect(roofFollowMoves(store.surfaces(), [])).toEqual([]);

        // A free-standing wall well outside the roof's footprint.
        const away = store.add(
            [
                { x: 20400, y: 0, z: 0 },
                { x: 24000, y: 0, z: 0 },
                { x: 24000, y: 0, z: 2400 },
                { x: 20400, y: 0, z: 2400 },
            ],
            { enforceModule: false }
        ).surface!;
        const before = away.boundaryMm;

        const moves = repitch(store, 45);
        store.moveVerticesTo([...moves, ...roofFollowMoves(store.surfaces(), moves)]);
        expect(store.get(away.id)!.boundaryMm).toEqual(before);
    });
});
