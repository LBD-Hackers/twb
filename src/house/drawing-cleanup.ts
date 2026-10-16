/**
 * What a drawing holds twice, and the drawing without it — and the faces split for nothing that
 * can be healed back into one.
 *
 * A face drawn on top of another — the same corners, in any order — is one piece of building
 * the model holds twice. Nothing in the drawing shows it, since the two render as one, but every
 * mode downstream takes both: the frame puts two decks in the same place, the envelope two build-
 * ups, the take-off twice the timber. A guide drawn twice is only clutter, but it is the same
 * mistake and costs nothing to find with it. Both come from files more than from drawing — an
 * import that emitted a face twice, two drawings pasted together — so they are cleaned on load,
 * and on demand in Draw mode for a drawing that already has them.
 *
 * The first of each set is the one kept: it is the one any room, joint or pin was more likely
 * made against, and it keeps its id.
 *
 * **Faces split for nothing.** A wall drawn as six strips side by side — an import that cut it
 * at every roof point, a line drawn across it and never used — is one wall in six pieces, a line
 * between each two, and six walls to frame. `faceMerges` finds the neighbours that heal into
 * one the way deleting the line between them would (`SurfaceStore.mergeFaces`): in one plane,
 * sharing an edge, and alike in everything a face carries besides its shape. A split is kept
 * where it means something:
 * - another face meets the drawing along that edge — a partition butting into a wall, a roof
 *   resting on it — or crosses it: a floor deck the edge lies in, which a wall stops at;
 * - it runs level at a storey's floor, where a wall of one storey stands on the one below, even
 *   with no deck drawn between them;
 * - a line declared a column or a beam runs along it. Healing only runs on demand, from the Clean up panel — never on load, unlike the repeats:
 * it changes faces the user may have split on purpose.
 *
 * Pure: no signals, no DOM.
 */

import {
    distanceToPlane,
    planeOfPolygon,
    pointInOrOnPolygon2,
    toFrameUv,
    type Point3Mm,
} from '../surfacekit/core';
import {
    isStructuralLine,
    mergeRings,
    midpoint3,
    segmentOnRing,
    segmentOnSegment,
    surfaceFrame,
    type Guide,
    type Storey,
    type Surface,
    type SurfaceId,
} from '../surfacekit/model';

export interface DrawingDuplicate {
    kind: 'surface' | 'guide';
    /** The one that goes. */
    id: string;
    /** The one it repeats, which stays. */
    sameAs: string;
}

export interface CleanDrawing {
    surfaces: Surface[];
    guides: Guide[];
    removed: DrawingDuplicate[];
}

/** A point as whole millimetres — the precision the store rounds every drawn point to. */
function pointKey(p: Point3Mm): string {
    return `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
}

/** A face's corners regardless of where its ring starts or which way it runs. */
export function surfaceKey(surface: Surface): string {
    return surface.boundaryMm.map(pointKey).sort().join(';');
}

/** A guide's two ends regardless of which way it was drawn, and what it was declared. */
function guideKey(guide: Guide): string {
    return `${[pointKey(guide.aMm), pointKey(guide.bMm)].sort().join('|')}|${guide.role ?? ''}`;
}

/** Every face and guide that repeats an earlier one. */
export function drawingDuplicates(
    surfaces: readonly Surface[],
    guides: readonly Guide[]
): DrawingDuplicate[] {
    return cleanDrawing(surfaces, guides).removed;
}

/** The drawing with every repeat taken out, and what was. */
export function cleanDrawing(surfaces: readonly Surface[], guides: readonly Guide[]): CleanDrawing {
    const removed: DrawingDuplicate[] = [];
    const firstSurface = new Map<string, SurfaceId>();
    const keptSurfaces = surfaces.filter((s) => {
        const key = surfaceKey(s);
        const first = firstSurface.get(key);
        if (first !== undefined) {
            removed.push({ kind: 'surface', id: s.id, sameAs: first });
            return false;
        }
        firstSurface.set(key, s.id);
        return true;
    });
    const firstGuide = new Map<string, string>();
    const keptGuides = guides.filter((g) => {
        const key = guideKey(g);
        const first = firstGuide.get(key);
        if (first !== undefined) {
            removed.push({ kind: 'guide', id: g.id, sameAs: first });
            return false;
        }
        firstGuide.set(key, g.id);
        return true;
    });
    return { surfaces: keptSurfaces, guides: keptGuides, removed };
}

/** One line saying what `removed` took out and `merged` healed, for the status bar. */
export function describeCleanup(
    removed: readonly DrawingDuplicate[],
    merged: readonly FaceMerge[] = []
): string {
    const surfaces = removed.filter((d) => d.kind === 'surface');
    const guides = removed.filter((d) => d.kind === 'guide');
    const parts: string[] = [];
    if (surfaces.length > 0) {
        parts.push(
            `${surfaces.length} face${surfaces.length === 1 ? '' : 's'} drawn on top of another (${surfaces.map((d) => `${d.id} = ${d.sameAs}`).join(', ')})`
        );
    }
    if (guides.length > 0) {
        parts.push(`${guides.length} guide${guides.length === 1 ? '' : 's'} drawn twice`);
    }
    const heal =
        merged.length > 0
            ? `Healed ${merged.length} face${merged.length === 1 ? '' : 's'} into ${new Set(merged.map((m) => m.keep)).size} (${merged.map((m) => `${m.drop} → ${m.keep}`).join(', ')}).`
            : '';
    if (parts.length === 0) return heal || 'Nothing to clean up.';
    return [`Removed ${parts.join(' and ')}.`, heal].filter(Boolean).join(' ');
}

/** Two faces that heal into one: `drop` goes, `keep` takes its place and its openings. */
export interface FaceMerge {
    keep: SurfaceId;
    drop: SurfaceId;
}

/** Farther off a face's plane than this, a point is not on it, mm — the store's own tolerance. */
const PLANE_MM = 2;

type Segment = readonly [Point3Mm, Point3Mm];

/** Everything a face carries besides its shape, openings and inner rings. */
function settingsKey(s: Surface): string {
    return JSON.stringify([
        s.kindOverride,
        s.loadBearing,
        s.spanDirectionOverride,
        s.roofGroupId,
        s.studSectionOverride,
    ]);
}

function edgesOf(ring: readonly Point3Mm[]): Segment[] {
    return ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as const);
}

/** The runs of edge two faces share — each one's edges lying along the other's. */
function sharedSegments(a: readonly Point3Mm[], b: readonly Point3Mm[]): Segment[] {
    return [
        ...edgesOf(a).filter(([p, q]) => segmentOnRing(b, p, q)),
        ...edgesOf(b).filter(([p, q]) => segmentOnRing(a, p, q)),
    ];
}

/**
 * The faces split for nothing, as the merges that heal them, in the order to make them — see
 * the module doc. A face healed from three pieces is two merges into the same `keep`.
 */
export function faceMerges(
    surfaces: readonly Surface[],
    guides: readonly Guide[],
    storeys: readonly Storey[] = []
): FaceMerge[] {
    const lines = guides.filter(isStructuralLine).map((g) => [g.aMm, g.bMm] as const);
    const lowest = Math.min(...storeys.map((st) => st.elevationMm));
    const floorLevels = storeys.map((st) => st.elevationMm).filter((z) => z > lowest);
    // The rings as they are once the merges so far are made.
    const rings = new Map(surfaces.map((s) => [s.id, s.boundaryMm]));
    const live = [...surfaces];
    const merges: FaceMerge[] = [];

    /** Whether anything else is drawn along a run of shared edge. */
    const pinned = (seg: Segment, a: SurfaceId, b: SurfaceId): boolean => {
        const [p, q] = seg;
        const along = ([x, y]: Segment): boolean =>
            segmentOnSegment(p, q, x, y) || segmentOnSegment(x, y, p, q);
        if (lines.some(along)) return true;
        const level = Math.abs(p.z - q.z) <= PLANE_MM;
        if (level && floorLevels.some((z) => Math.abs(p.z - z) <= PLANE_MM)) return true;
        const mid = midpoint3(p, q);
        return live.some((c) => {
            if (c.id === a || c.id === b) return false;
            const ring = rings.get(c.id)!;
            if (edgesOf(ring).some(along)) return true;
            // Lying in `c` and across it: `c` passes through the split.
            const frame = surfaceFrame(ring);
            const plane = planeOfPolygon(ring);
            if (!frame || !plane) return false;
            if ([p, q].some((r) => Math.abs(distanceToPlane(r, plane)) > PLANE_MM)) return false;
            return pointInOrOnPolygon2(
                toFrameUv(frame, mid),
                ring.map((r) => toFrameUv(frame, r))
            );
        });
    };

    for (let healed = true; healed;) {
        healed = false;
        outer: for (let i = 0; i < live.length; i++) {
            const a = live[i]!;
            const ringA = rings.get(a.id)!;
            const plane = planeOfPolygon(ringA);
            if (!plane) continue;
            for (let j = i + 1; j < live.length; j++) {
                const b = live[j]!;
                if (settingsKey(a) !== settingsKey(b)) continue;
                const ringB = rings.get(b.id)!;
                if (ringB.some((p) => Math.abs(distanceToPlane(p, plane)) > PLANE_MM)) continue;
                const shared = sharedSegments(ringA, ringB);
                if (shared.length === 0) continue;
                if (shared.some((seg) => pinned(seg, a.id, b.id))) continue;
                const ring = mergeRings(ringA, ringB);
                if (!ring) continue;
                rings.set(a.id, ring);
                live.splice(j, 1);
                merges.push({ keep: a.id, drop: b.id });
                healed = true;
                // `a` has a new outline: look again from the start.
                break outer;
            }
        }
    }
    return merges;
}
