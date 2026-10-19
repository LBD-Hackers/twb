/**
 * Inner loops and real holes, SketchUp's way.
 *
 * A loop drawn strictly inside a face does two things at once: the face gains the loop as an
 * inner ring (`Surface.holes`), and a new face with that outline fills it. Nothing else is
 * recorded. Whether a ring is a hole in the building is read off the model: while a face with its
 * outline exists, the ring is **filled**, and the host is whole as far as anything built from it
 * is concerned; delete that face and the ring is **open**, a void nothing fills.
 *
 * So a hole is only ever there because someone took a face out of one. A window or a door is not
 * a hole at all, but an opening (`SurfaceOpening`), with a kind, which Framing and Envelope treat
 * as a window or a door; a hole they treat as a hole.
 *
 * `resolvedSurfaces` is the building as derivation sees it: filler faces gone, hosts carrying only
 * their open holes. Drawing, snapping and rendering keep the faces as drawn.
 */

import {
    distanceToPlane,
    planeOfPolygon,
    pointInOrOnPolygon2,
    pointInPolygon2,
    polygonArea3,
    toFrameUv,
    type Point3Mm,
} from '../core';
import type { Surface } from './surface';
import { surfaceFrame } from './surface-frame';
import { locateOnRing } from './surface-ops';

/** How far a corner may sit off a host's plane and still be on it, mm — `checkShape`'s. */
const ON_PLANE_MM = 2;

/**
 * Whether two rings are the same outline: every corner of each on the other, and the same area.
 * Corners rather than equality because one of them may carry an extra corner on a straight edge
 * — a point a line broke into it — and still be the same face.
 */
export function sameOutline(a: readonly Point3Mm[], b: readonly Point3Mm[]): boolean {
    if (Math.abs(polygonArea3(a) - polygonArea3(b)) > 1) return false;
    return (
        a.every((p) => locateOnRing(b, p) !== null) && b.every((p) => locateOnRing(a, p) !== null)
    );
}

/** The face filling `ring` in `host`, if there is one. */
export function fillerOf(
    host: Surface,
    ring: readonly Point3Mm[],
    surfaces: readonly Surface[]
): Surface | undefined {
    return surfaces.find((s) => s.id !== host.id && sameOutline(s.boundaryMm, ring));
}

/** The face `filler` fills an inner ring of, and which ring — or null when it fills none. */
export function hostOf(
    filler: Surface,
    surfaces: readonly Surface[]
): { host: Surface; index: number } | null {
    for (const host of surfaces) {
        if (host.id === filler.id) continue;
        const index = host.holes.findIndex((ring) => sameOutline(ring, filler.boundaryMm));
        if (index !== -1) return { host, index };
    }
    return null;
}

/** The inner rings of `surface` no face fills — its real holes. */
export function openHoles(
    surface: Surface,
    surfaces: readonly Surface[]
): readonly (readonly Point3Mm[])[] {
    return surface.holes.filter((ring) => !fillerOf(surface, ring, surfaces));
}

/**
 * The faces as Framing, Envelope and the IFC should see them: a face that fills an inner ring is
 * dropped — its host is whole there — and each host keeps only its open holes.
 */
export function resolvedSurfaces(surfaces: readonly Surface[]): Surface[] {
    const fillers = new Set<string>();
    const out: Surface[] = [];
    for (const s of surfaces) {
        if (s.holes.length === 0) continue;
        for (const ring of s.holes) {
            const filler = fillerOf(s, ring, surfaces);
            if (filler) fillers.add(filler.id);
        }
    }
    for (const s of surfaces) {
        if (fillers.has(s.id)) continue;
        if (s.holes.length === 0) {
            out.push(s);
            continue;
        }
        const open = s.holes.filter((ring) => !fillerOf(s, ring, surfaces));
        out.push(open.length === s.holes.length ? s : { ...s, holes: open });
    }
    return out;
}

/**
 * The face a new ring lies strictly inside, on its plane — the face the ring becomes an inner
 * loop of. Strictly: a corner on the face's edge makes the ring a notch, which is a split, not
 * a loop. It must also keep clear of the face's other inner rings. The smallest such face wins,
 * so a loop drawn inside a loop belongs to the inner one.
 */
export function hostFor(ring: readonly Point3Mm[], surfaces: readonly Surface[]): Surface | null {
    let best: { surface: Surface; area: number } | null = null;
    const within = boxOf(ring, false);
    for (const s of surfaces) {
        // A ring on a face's plane and inside its outline is inside its box, give or take the
        // plane's tolerance: the faces it is not are passed over before their planes are read.
        if (!boxHolds(boxOf(s.boundaryMm), within, ON_PLANE_MM + 1)) continue;
        const plane = planeOfPolygon(s.boundaryMm);
        const frame = surfaceFrame(s.boundaryMm);
        if (!plane || !frame) continue;
        if (ring.some((p) => Math.abs(distanceToPlane(p, plane)) > ON_PLANE_MM)) continue;
        if (ring.some((p) => locateOnRing(s.boundaryMm, p) !== null)) continue;
        const uv = (r: readonly Point3Mm[]) => r.map((p) => toFrameUv(frame, p));
        const boundaryUv = uv(s.boundaryMm);
        const ringUv = uv(ring);
        if (!ringUv.every((p) => pointInPolygon2(p, boundaryUv))) continue;
        const clear = s.holes.every((hole) => {
            const holeUv = uv(hole);
            return (
                !ringUv.some((p) => pointInOrOnPolygon2(p, holeUv)) &&
                !holeUv.some((p) => pointInOrOnPolygon2(p, ringUv))
            );
        });
        if (!clear) continue;
        const area = polygonArea3(s.boundaryMm);
        if (!best || area < best.area) best = { surface: s, area };
    }
    return best?.surface ?? null;
}

interface Box3 {
    lo: Point3Mm;
    hi: Point3Mm;
}

/** Each ring's box, read once: a face's boundary is replaced, not changed, when it moves. */
const boxes = new WeakMap<readonly Point3Mm[], Box3>();

function boxOf(ring: readonly Point3Mm[], keep = true): Box3 {
    const known = keep ? boxes.get(ring) : undefined;
    if (known) return known;
    const lo = { x: Infinity, y: Infinity, z: Infinity };
    const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const p of ring) {
        lo.x = Math.min(lo.x, p.x);
        lo.y = Math.min(lo.y, p.y);
        lo.z = Math.min(lo.z, p.z);
        hi.x = Math.max(hi.x, p.x);
        hi.y = Math.max(hi.y, p.y);
        hi.z = Math.max(hi.z, p.z);
    }
    const box = { lo, hi };
    if (keep) boxes.set(ring, box);
    return box;
}

/** Whether `outer`, grown by `slack` every way, holds `inner`. */
function boxHolds(outer: Box3, inner: Box3, slack: number): boolean {
    return (
        inner.lo.x >= outer.lo.x - slack &&
        inner.lo.y >= outer.lo.y - slack &&
        inner.lo.z >= outer.lo.z - slack &&
        inner.hi.x <= outer.hi.x + slack &&
        inner.hi.y <= outer.hi.y + slack &&
        inner.hi.z <= outer.hi.z + slack
    );
}
