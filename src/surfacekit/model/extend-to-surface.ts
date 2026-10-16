/**
 * Extend to surface: a roof's end carried on until it meets another roof — the wing of an
 * L-shaped house run into the main roof, its ridge ending on the main roof's slope and a valley
 * down each side.
 *
 * The wing is drawn as a roof of its own, its ridge stopping where its walls do. What it lacks is
 * the stretch between there and the main roof, and that stretch is exactly its own planes carried
 * on: the ridge continues along the ridge, each eave along its eave, until they hit the main
 * roof's plane. So a picked point never moves freely. It slides along the one edge that runs into
 * it and lies in every face it is a corner of — the ridge, for a ridge end, which lies in both
 * planes; the eave, for an eave corner — and stops where that line meets the target. Moving along
 * such an edge keeps every face it touches flat, which is why this can be one click rather than a
 * drag that has to be aimed.
 *
 * Where a point already is on the target (an eave corner on the main roof's eave) it stays. Where
 * no edge into it runs towards the target, there is nothing to extend, and the plan says so.
 */

import {
    distance3,
    dot3,
    normalize3,
    planeOfPolygon,
    pointInOrOnPolygon2,
    rayPlaneT,
    sub3,
    toFrameUv,
    type Point3Mm,
    type Vec2Mm,
} from '../core';
import type { Surface, SurfaceId } from './surface';
import { samePoint, roundPoint, type VertexMove } from './surface-ops';
import { surfaceFrame } from './surface-frame';

/** A point this close to the target's plane is on it already, mm. */
const ON_PLANE_MM = 1;
/** How far outside the target's outline a hit may land and still meet it, mm. */
const OUTLINE_SLACK_MM = 5;

/** Every face a model-space ray passes through, nearest first, skipping `exclude`. */
export function facesAlongRay(
    surfaces: readonly Surface[],
    originMm: Point3Mm,
    dir: Point3Mm,
    exclude: ReadonlySet<SurfaceId>
): { surface: Surface; pointMm: Point3Mm }[] {
    const hits: { surface: Surface; pointMm: Point3Mm; t: number }[] = [];
    for (const surface of surfaces) {
        if (exclude.has(surface.id)) continue;
        const plane = planeOfPolygon(surface.boundaryMm);
        if (!plane) continue;
        const t = rayPlaneT(originMm, dir, plane);
        if (t === null || t <= 0) continue;
        const pointMm = {
            x: originMm.x + dir.x * t,
            y: originMm.y + dir.y * t,
            z: originMm.z + dir.z * t,
        };
        if (onFace(surface, pointMm, 0)) hits.push({ surface, pointMm, t });
    }
    return hits.sort((a, b) => a.t - b.t).map(({ surface, pointMm }) => ({ surface, pointMm }));
}

/**
 * The roof `pointsMm` should be extended to, of the faces under the cursor: the one their own
 * lines reach first. Seen from the far side of a gable, the slope a wing's ridge runs into is
 * behind the one facing the camera; the ray passes through both, and the one the ridge meets
 * first is the one it means. Falls back to the nearest face, with its reason, when none works.
 */
export function aimExtendToSurface(
    surfaces: readonly Surface[],
    editable: readonly Surface[],
    pointsMm: readonly Point3Mm[],
    originMm: Point3Mm,
    dir: Point3Mm
): { target: Surface; pointMm: Point3Mm; plan: ExtendPlan } | null {
    const own = new Set(
        surfaces
            .filter((s) => s.boundaryMm.some((q) => pointsMm.some((p) => samePoint(p, q))))
            .map((s) => s.id)
    );
    const hits = facesAlongRay(surfaces, originMm, dir, own);
    if (hits.length === 0) return null;
    let best: { target: Surface; pointMm: Point3Mm; plan: ExtendPlan; reach: number } | null = null;
    for (const hit of hits) {
        const plan = planExtendToSurface(editable, pointsMm, hit.surface);
        if (!plan.ok) continue;
        const reach = plan.moves.reduce((sum, m) => sum + distance3(m.fromMm, m.toMm), 0);
        if (!best || reach < best.reach)
            best = { target: hit.surface, pointMm: hit.pointMm, plan, reach };
    }
    if (best) return { target: best.target, pointMm: best.pointMm, plan: best.plan };
    const nearest = hits[0]!;
    return {
        target: nearest.surface,
        pointMm: nearest.pointMm,
        plan: planExtendToSurface(editable, pointsMm, nearest.surface),
    };
}

/** Whether a point on a face's plane is inside its outline, give or take `slackMm`. */
function onFace(surface: Surface, pointMm: Point3Mm, slackMm: number): boolean {
    const frame = surfaceFrame(surface.boundaryMm);
    if (!frame) return false;
    const ring = surface.boundaryMm.map((p) => toFrameUv(frame, p));
    const uv = toFrameUv(frame, pointMm);
    if (pointInOrOnPolygon2(uv, ring)) return true;
    return (
        slackMm > 0 &&
        ring.some((a, i) => segmentDistance(uv, a, ring[(i + 1) % ring.length]!) <= slackMm)
    );
}

function segmentDistance(p: Vec2Mm, a: Vec2Mm, b: Vec2Mm): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The faces that have a corner at `p`. */
function facesAt(surfaces: readonly Surface[], p: Point3Mm): Surface[] {
    return surfaces.filter((s) => s.boundaryMm.some((q) => samePoint(q, p)));
}

/** A corner's two neighbours round its face's ring. */
function neighbours(surface: Surface, p: Point3Mm): Point3Mm[] {
    const ring = surface.boundaryMm;
    const i = ring.findIndex((q) => samePoint(q, p));
    if (i < 0) return [];
    return [ring[(i - 1 + ring.length) % ring.length]!, ring[(i + 1) % ring.length]!];
}

export type ExtendPlan = { ok: true; moves: VertexMove[] } | { ok: false; message: string };

/**
 * Where each of `pointsMm` goes to meet `target` — see the header. `surfaces` are the faces the
 * points may carry with them (in roof mode, the roof being drawn); `target` is never one of them.
 */
export function planExtendToSurface(
    surfaces: readonly Surface[],
    pointsMm: readonly Point3Mm[],
    target: Surface
): ExtendPlan {
    const plane = planeOfPolygon(target.boundaryMm);
    if (!plane) return { ok: false, message: `${target.id} has no plane to extend to.` };
    const faces = surfaces.filter((s) => s.id !== target.id);
    const moves: VertexMove[] = [];
    for (const p of pointsMm) {
        const distance = dot3(plane.normal, p) - plane.d;
        if (Math.abs(distance) <= ON_PLANE_MM) continue;
        const incident = facesAt(faces, p);
        if (incident.length === 0) {
            return {
                ok: false,
                message: 'That point is not a corner of a face that can be extended.',
            };
        }
        // The edges into the point that every face at it shares — the ridge, at a ridge end —
        // leading from a point that is not moving itself.
        const candidates = neighbours(incident[0]!, p).filter(
            (u) =>
                !pointsMm.some((q) => samePoint(q, u)) &&
                incident.every((f) => neighbours(f, p).some((v) => samePoint(v, u)))
        );
        let best: { toMm: Point3Mm; t: number } | null = null;
        for (const u of candidates) {
            const dir = normalize3(sub3(p, u));
            const t = rayPlaneT(p, dir, plane);
            if (t === null || t <= 0 || (best && t >= best.t)) continue;
            const toMm = { x: p.x + dir.x * t, y: p.y + dir.y * t, z: p.z + dir.z * t };
            if (!onFace(target, toMm, OUTLINE_SLACK_MM)) continue;
            best = { toMm, t };
        }
        if (!best) {
            return {
                ok: false,
                message: `Nothing running into (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}) meets ${target.id} — pick the ridge's end facing it.`,
            };
        }
        moves.push({ fromMm: p, toMm: roundPoint(best.toMm) });
    }
    if (moves.length === 0) {
        return { ok: false, message: `That already meets ${target.id}.` };
    }
    return { ok: true, moves };
}
