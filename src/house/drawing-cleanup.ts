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

/** Past this, a face's box is clear of a point or edge every test here would find on it, mm. */
const BOX_SLACK_MM = PLANE_MM + 3;
/** Plan cells the faces are filed in for `nearbyFaces`, mm. */
const CELL_MM = 2000;

interface Box {
    lo: Point3Mm;
    hi: Point3Mm;
}

function boxOfPoints(points: readonly Point3Mm[]): Box {
    const lo = { x: Infinity, y: Infinity, z: Infinity };
    const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const p of points) {
        lo.x = Math.min(lo.x, p.x);
        lo.y = Math.min(lo.y, p.y);
        lo.z = Math.min(lo.z, p.z);
        hi.x = Math.max(hi.x, p.x);
        hi.y = Math.max(hi.y, p.y);
        hi.z = Math.max(hi.z, p.z);
    }
    return { lo, hi };
}

/** Each ring's box, read once: a merge makes a new ring rather than changing one. */
const ringBoxes = new WeakMap<readonly Point3Mm[], Box>();

function boxOfRing(ring: readonly Point3Mm[]): Box {
    let box = ringBoxes.get(ring);
    if (!box) {
        box = boxOfPoints(ring);
        ringBoxes.set(ring, box);
    }
    return box;
}

function boxesTouch(a: Box, b: Box, d = BOX_SLACK_MM): boolean {
    return (
        a.lo.x <= b.hi.x + d &&
        b.lo.x <= a.hi.x + d &&
        a.lo.y <= b.hi.y + d &&
        b.lo.y <= a.hi.y + d &&
        a.lo.z <= b.hi.z + d &&
        b.lo.z <= a.hi.z + d
    );
}

/**
 * The faces filed by where they stand in plan, so a face is held only against those whose boxes
 * touch its own — the others share no edge with it and pass through none of its edges — in the
 * order `surfaces` gives them, which is the order the merges are looked for in.
 */
function nearbyFaces(surfaces: readonly Surface[], rings: ReadonlyMap<SurfaceId, readonly Point3Mm[]>) {
    const byId = new Map(surfaces.map((s) => [s.id, s]));
    const order = new Map(surfaces.map((s, k) => [s.id, k]));
    const alive = new Set(surfaces.map((s) => s.id));
    const cells = new Map<string, Set<SurfaceId>>();
    const keysOf = (box: Box): string[] => {
        const d = BOX_SLACK_MM;
        const x0 = Math.floor((box.lo.x - d) / CELL_MM);
        const x1 = Math.floor((box.hi.x + d) / CELL_MM);
        const y0 = Math.floor((box.lo.y - d) / CELL_MM);
        const y1 = Math.floor((box.hi.y + d) / CELL_MM);
        const keys: string[] = [];
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x},${y}`);
        return keys;
    };
    const file = (id: SurfaceId) => {
        for (const k of keysOf(boxOfRing(rings.get(id)!))) {
            let cell = cells.get(k);
            if (!cell) cells.set(k, (cell = new Set()));
            cell.add(id);
        }
    };
    for (const s of surfaces) file(s.id);
    const within = (box: Box): SurfaceId[] => {
        const found = new Set<SurfaceId>();
        for (const k of keysOf(box)) {
            for (const id of cells.get(k) ?? []) {
                if (alive.has(id) && boxesTouch(box, boxOfRing(rings.get(id)!))) found.add(id);
            }
        }
        return [...found].sort((m, n) => order.get(m)! - order.get(n)!);
    };
    return {
        surface: (id: SurfaceId) => byId.get(id)!,
        within,
        /** The faces after `id` in order whose boxes touch `box`. */
        after: (id: SurfaceId, box: Box) => within(box).filter((o) => order.get(o)! > order.get(id)!),
        drop: (id: SurfaceId) => alive.delete(id),
        /** Files a face again where its new ring reaches. */
        file,
    };
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
    const settings = new Map(surfaces.map((s) => [s.id, settingsKey(s)]));
    const near = nearbyFaces(surfaces, rings);

    /** Whether anything else is drawn along a run of shared edge. */
    const pinned = (seg: Segment, a: SurfaceId, b: SurfaceId): boolean => {
        const [p, q] = seg;
        const along = ([x, y]: Segment): boolean =>
            segmentOnSegment(p, q, x, y) || segmentOnSegment(x, y, p, q);
        if (lines.some(along)) return true;
        const level = Math.abs(p.z - q.z) <= PLANE_MM;
        if (level && floorLevels.some((z) => Math.abs(p.z - z) <= PLANE_MM)) return true;
        const mid = midpoint3(p, q);
        return near.within(boxOfPoints([p, q])).some((c) => {
            if (c === a || c === b) return false;
            const ring = rings.get(c)!;
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

    // After a merge the search starts over, and a face before the merged one heals no
    // differently unless the merge reached it: the merged face's new ring, where the face it
    // took in lay too, is all that changed. Those it did not reach are passed over.
    let resumeAt = 0;
    let changed: Box | null = null;
    for (let healed = true; healed;) {
        healed = false;
        outer: for (let i = 0; i < live.length; i++) {
            const a = live[i]!;
            const ringA = rings.get(a.id)!;
            if (changed && i < resumeAt && !boxesTouch(boxOfRing(ringA), changed, 2 * BOX_SLACK_MM))
                continue;
            const plane = planeOfPolygon(ringA);
            if (!plane) continue;
            // Only the later faces whose boxes touch `a`'s can share an edge with it.
            for (const id of near.after(a.id, boxOfRing(ringA))) {
                const b = near.surface(id);
                if (settings.get(a.id) !== settings.get(b.id)) continue;
                const ringB = rings.get(b.id)!;
                if (ringB.some((p) => Math.abs(distanceToPlane(p, plane)) > PLANE_MM)) continue;
                const shared = sharedSegments(ringA, ringB);
                if (shared.length === 0) continue;
                if (shared.some((seg) => pinned(seg, a.id, b.id))) continue;
                const ring = mergeRings(ringA, ringB);
                if (!ring) continue;
                rings.set(a.id, ring);
                live.splice(live.indexOf(b), 1);
                near.drop(b.id);
                near.file(a.id);
                merges.push({ keep: a.id, drop: b.id });
                resumeAt = i;
                changed = boxOfRing(ring);
                healed = true;
                // `a` has a new outline: look again from the start.
                break outer;
            }
        }
    }
    return merges;
}
