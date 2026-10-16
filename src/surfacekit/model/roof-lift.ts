/**
 * Lifting the roof — changing a storey's ceiling height after the house is drawn.
 *
 * The walls of a storey stand from its floor to its ceiling line, and everything on top of that
 * line — the ceiling itself, the roof planes, the gable triangles, the storeys above — sits on
 * it. Raising the ceiling is then one edit: **every vertex at or above the ceiling line moves
 * straight up by the same rise**. Nothing is re-pitched, since every corner of a roof plane
 * travels the same distance; the walls simply get taller. Lowering it is the same edit with a
 * negative rise.
 *
 * "At or above" is read by position, the way `wall-line-move.ts` reads "standing on": a T-wall
 * built up into the roof, a gable's ridge end and a porch roof hung off the eave line all have
 * corners up there, and they all come along without knowing about each other. A face with every
 * corner above the line moves whole; one that straddles it (every wall of the storey) stretches.
 *
 * Only faces from the storey's floor up take part — the storey below shares its top edge with
 * this storey's floor, and it is not the one being lifted.
 *
 * Openings: one that sits above the line (a window up in a gable) rides with the roof; one below
 * it (every ordinary window and door) keeps its place in the world, sill and head where they
 * were. Lowering the ceiling onto a window's head is refused rather than cutting the window.
 *
 * Pure: surfaces in, the next surfaces out. The store validates the shapes and moves the loose
 * lines and the storeys above.
 */

import { pointInOrOnPolygon2, toFrameUv, type Point3Mm } from '../core';
import type { Surface, SurfaceId, SurfaceOpening } from './surface';
import type { Storey } from './storey';
import { classifyAll } from './classify';
import { wallFootprintsInStorey } from './plan-geometry';
import { openingFromRing3, openingRing3, surfaceFrame } from './surface-frame';
import { COINCIDENT_MM, roundPoint } from './surface-ops';

/** Lowest ceiling a lift may leave above the storey's floor, mm — a crawl space, not a room. */
export const MIN_CEILING_HEIGHT_MM = 1200;

export interface RoofLiftRequest {
    /** The ceiling line: every vertex at or above this height moves. */
    fromZMm: number;
    /** How far, up (positive) or down (negative), mm. */
    riseMm: number;
    /** The storey's floor: faces lower than this are left alone. */
    baseZMm: number;
}

export type RoofLiftResult =
    | {
          ok: true;
          /** The whole next model, in the original order. */
          surfaces: Surface[];
          /** Faces that were moved or stretched — the ones the store has to validate. */
          touched: SurfaceId[];
      }
    | { ok: false; message: string };

/**
 * The ceiling line of one wall: the lowest of its corners above its own base. A plain wall's top
 * edge, the eave corners of a gable wall, the low side of a wall under a mono-pitch roof. Null
 * for a face with no corner above its base (nothing a ceiling could stand on).
 */
export function wallCeilingZ(surface: Surface): number | null {
    const zs = surface.boundaryMm.map((p) => p.z);
    const base = Math.min(...zs);
    const above = zs.filter((z) => z > base + COINCIDENT_MM);
    return above.length > 0 ? Math.min(...above) : null;
}

/**
 * A storey's ceiling line: of the walls standing on its floor, the ceiling line that the most
 * wall length reaches — so a low lean-to or a porch wall does not decide the height of the
 * house it is attached to. Null when no wall stands on the floor yet.
 */
export function storeyCeilingZ(surfaces: readonly Surface[], storey: Storey): number | null {
    const byZ = new Map<number, number>();
    for (const fp of wallFootprintsInStorey(surfaces, storey)) {
        const surface = surfaces.find((s) => s.id === fp.surfaceId);
        if (!surface) continue;
        const base = Math.min(...surface.boundaryMm.map((p) => p.z));
        if (Math.abs(base - storey.elevationMm) > COINCIDENT_MM) continue;
        const z = wallCeilingZ(surface);
        if (z === null) continue;
        const lengthMm = Math.hypot(fp.bMm.x - fp.aMm.x, fp.bMm.y - fp.aMm.y);
        byZ.set(z, (byZ.get(z) ?? 0) + lengthMm);
    }
    let best: { z: number; lengthMm: number } | null = null;
    for (const [z, lengthMm] of byZ) {
        if (!best || lengthMm > best.lengthMm + COINCIDENT_MM) best = { z, lengthMm };
    }
    return best?.z ?? null;
}

export function liftRoof(surfaces: readonly Surface[], request: RoofLiftRequest): RoofLiftResult {
    const riseMm = Math.round(request.riseMm);
    if (riseMm === 0) return { ok: false, message: 'Nothing to move.' };
    const { fromZMm, baseZMm } = request;
    if (fromZMm + riseMm - baseZMm < MIN_CEILING_HEIGHT_MM) {
        return {
            ok: false,
            message: `A ceiling lower than ${MIN_CEILING_HEIGHT_MM} mm is not a room.`,
        };
    }
    const lifts = (p: Point3Mm): boolean => p.z >= fromZMm - COINCIDENT_MM;
    const lifted = (p: Point3Mm): Point3Mm => roundPoint({ x: p.x, y: p.y, z: p.z + riseMm });
    const kinds = classifyAll(surfaces);

    const next: Surface[] = [];
    const touched: SurfaceId[] = [];
    for (const s of surfaces) {
        const baseZ = Math.min(...s.boundaryMm.map((p) => p.z));
        if (baseZ < baseZMm - COINCIDENT_MM || !s.boundaryMm.some(lifts)) {
            next.push(s);
            continue;
        }
        const whole = s.boundaryMm.every(lifts);
        if (!whole) {
            // A stretched face: its lifted corners must stay above the ones that stay.
            const staying = Math.max(...s.boundaryMm.filter((p) => !lifts(p)).map((p) => p.z));
            if (fromZMm + riseMm <= staying + COINCIDENT_MM) {
                return {
                    ok: false,
                    message: `${s.id} would fold over — the ceiling cannot go that low.`,
                };
            }
        }
        const ring = s.boundaryMm.map((p) => (lifts(p) ? lifted(p) : p));
        const holes = s.holes.map((h) => h.map((p) => (whole || lifts(p) ? lifted(p) : p)));
        const openings = liftOpenings(s, ring, whole, fromZMm, riseMm);
        if (!openings) {
            return {
                ok: false,
                message:
                    kinds.get(s.id) === 'wall'
                        ? `A window or door in ${s.id} reaches above the new ceiling — lower it first.`
                        : `An opening in ${s.id} would end up outside it.`,
            };
        }
        next.push({ ...s, boundaryMm: ring, holes, openings });
        touched.push(s.id);
    }
    if (touched.length === 0) return { ok: false, message: 'There is no roof there to lift.' };
    return { ok: true, surfaces: next, touched };
}

/**
 * The face's openings re-measured in its lifted outline: ones above the ceiling line (or on a
 * face that moves whole) travel with it, the rest keep their place in the world. Null when one
 * no longer fits inside the face.
 */
function liftOpenings(
    surface: Surface,
    ringMm: readonly Point3Mm[],
    whole: boolean,
    fromZMm: number,
    riseMm: number
): SurfaceOpening[] | null {
    if (surface.openings.length === 0) return [];
    const oldFrame = surfaceFrame(surface.boundaryMm);
    const newFrame = surfaceFrame(ringMm);
    if (!oldFrame || !newFrame) return null;
    const boundaryUv = ringMm.map((p) => toFrameUv(newFrame, p));
    const openings: SurfaceOpening[] = [];
    for (const hole of surface.openings) {
        let corners = openingRing3(oldFrame, hole);
        const above = corners.every((p) => p.z >= fromZMm - COINCIDENT_MM);
        if (whole || above) corners = corners.map((p) => ({ ...p, z: p.z + riseMm }));
        const remapped = openingFromRing3(newFrame, corners, hole.id);
        if (!remapped) return null;
        const inside = openingRing3(newFrame, remapped).every((p) =>
            pointInOrOnPolygon2(toFrameUv(newFrame, p), boundaryUv)
        );
        if (!inside) return null;
        openings.push({ ...hole, ...remapped });
    }
    return openings;
}
