/**
 * The authored state of the building: a list of surfaces and the current selection.
 *
 * Mirrors `mep/src/zones/zone-store.ts` in the two decisions that matter. First, **validation
 * lives here, not in the tool** — a tool reports what the user drew and the store decides
 * whether it is admissible, so every path into the model (drawing, loading a file, push/pull)
 * is checked by the same code. Second, **updates are immutable**: every mutation produces a
 * new array, so `Object.is` change detection in `signal.ts` works and the renderer knows
 * exactly when to rebuild.
 *
 * The verbs are SketchUp's, not a CAD tool's: `add` a face, cut a hole in it, `split` it
 * along a line, `extrude` it into a box, `moveVertices` to reshape whatever shares them.
 * Every one of them applies the same three checks — planar, non-degenerate, on the grid in
 * plan — so there is no way to draw a face the framing recipe cannot make sense of, whichever
 * verb produced it.
 *
 * Rejection over exception: every verb returns a result with `violations` rather than
 * throwing. A rejected commit leaves the drawing tool armed so the user simply clicks again.
 *
 * Beside the surfaces sit the **guides** (`guide.ts`): loose lines that are not the side of
 * any face. They have their own, much lighter verbs — add, remove, purge, `breakAt` to put a
 * corner where a line touches an edge, `consumeGuidesOn` to retire the ones a new face was
 * drawn along — and none of the checks, because a guide is not a face and nothing is ever
 * built from one. The exception is a line given a **role** by `setGuideRole`: that one *is*
 * built from (a pergola post, a free beam), so every verb that treats a line as scratch —
 * purge, break, consume — steps over it.
 */

import {
    signal,
    distance3,
    scale3,
    distanceToPlane,
    planeOfPolygon,
    polygonArea3,
    pointInOrOnPolygon2,
    pointInPolygon2,
    toFrameUv,
    type Point3Mm,
} from '../core';
import { validateModularRing, type Violation } from '../grid';
import {
    OPENING_LABELS,
    type OpeningKind,
    type PartitionKind,
    type Surface,
    type SurfaceOpening,
    type SurfaceId,
    type SurfaceKind,
} from './surface';
import type { FaceChanges } from './roof-fit';
import { isStructuralLine, type Guide, type GuideId, type GuideRole } from './guide';
import {
    DEFAULT_STOREY_HEIGHT_MM,
    MIN_STOREY_HEIGHT_MM,
    sortStoreys,
    type Storey,
    type StoreyId,
} from './storey';
import { storeysAfterPull, type StoreyPull } from './storey-follow';
import {
    openingFromRing3,
    openingRing3,
    surfaceFrame,
    type OpeningGeometry,
} from './surface-frame';
import {
    COINCIDENT_MM,
    extrudeRing,
    insertOnRing,
    insideSegment,
    locateOnRing,
    mergeRings,
    moveRingVertices,
    moveRingVerticesTo,
    samePoint,
    segmentOnRing,
    segmentOnSegment,
    roundPoint,
    splitRingAlong,
    type VertexMove,
} from './surface-ops';
import { extendWall, type WallExtendRequest } from './wall-extend';
import {
    moveWallLine,
    onPlanSegment,
    type WallLineMoveRequest,
    type WallLineSegment,
} from './wall-line-move';
import { hostFor, hostOf, sameOutline } from './surface-holes';
import { liftRoof, type RoofLiftRequest } from './roof-lift';

/**
 * Smallest face worth keeping, mm². 0.25 m² — matching mep's `MIN_ZONE_AREA`, and
 * comfortably below any real room while still catching an accidental click-click-click.
 */
const MIN_SURFACE_AREA_MM2 = 250_000;

/**
 * How far a corner may sit off the ring's own best-fit plane before the face is rejected, mm.
 * Matches the tolerance `wall-recipe.ts` will later use for its own `'non-planar'` rejection,
 * so a face this store accepts is also one the framing step can make sense of. Drawn geometry
 * should already be exact — the working plane projects every corner as it is placed — so this
 * is a guard against float/rounding drift on a *drawn* face. It is a real constraint on a
 * *moved* one: lifting one corner of a rectangle folds it, and that is the case this catches.
 */
const PLANARITY_TOLERANCE_MM = 2;

/** Shortest guide worth keeping, mm. Below this it is a double click, not a line. */
const MIN_GUIDE_LENGTH_MM = 50;

let nextId = 1;
let nextGuideId = 1;
let nextStoreyId = 1;

/** Ids are sequential and per-session; `noteExistingIds` rebases after loading a file. */
function mintId(): SurfaceId {
    return `s${nextId++}`;
}

function mintGuideId(): GuideId {
    return `g${nextGuideId++}`;
}

function mintStoreyId(): StoreyId {
    return `st${nextStoreyId++}`;
}

/** A house always has at least one storey, so a fresh or cleared store starts with one. */
function defaultStorey(): Storey {
    return {
        id: mintStoreyId(),
        name: 'Ground floor',
        elevationMm: 0,
        heightMm: DEFAULT_STOREY_HEIGHT_MM,
    };
}

export function noteExistingIds(
    surfaces: readonly Surface[],
    guides: readonly Guide[] = [],
    storeys: readonly Storey[] = []
): void {
    for (const s of surfaces) {
        const n = Number(s.id.slice(1));
        if (Number.isFinite(n) && n >= nextId) nextId = n + 1;
    }
    for (const g of guides) {
        const n = Number(g.id.slice(1));
        if (Number.isFinite(n) && n >= nextGuideId) nextGuideId = n + 1;
    }
    for (const s of storeys) {
        const n = Number(s.id.slice(2));
        if (Number.isFinite(n) && n >= nextStoreyId) nextStoreyId = n + 1;
    }
}

export interface AddOptions {
    /**
     * Whether the modular grid is enforced on commit. Defaults to true.
     *
     * The drawing tools pass the state of the grid toggle through to here, because correcting
     * geometry at commit time would otherwise silently undo everything the user drew with
     * snapping switched off — the store gets the last word, so it has to know.
     */
    enforceModule?: boolean;
}

export interface AddResult {
    surface: Surface | null;
    violations: readonly Violation[];
    /** How far validation moved the geometry, so the UI can report the auto-correction. */
    maxCorrectionMm: number;
}

/** The outcome of a verb that changes existing faces rather than adding one. */
export interface EditResult {
    ok: boolean;
    violations: readonly Violation[];
    /** Every surface the edit touched or created, for the status line. */
    surfaceIds: readonly SurfaceId[];
}

export interface LoadResult {
    loaded: number;
    skipped: readonly { id: SurfaceId; message: string }[];
}

/** What `breakAt` touched: the faces that gained a corner, the guides that were cut in two. */
export interface BreakResult {
    surfaceIds: readonly SurfaceId[];
    guideIds: readonly GuideId[];
}

const LOCKED: Violation = {
    code: 'locked-face',
    message: 'That face is not part of the roof being drawn — save or cancel the roof first.',
    index: 0,
};

const rejected = (violations: readonly Violation[]): EditResult => ({
    ok: false,
    violations,
    surfaceIds: [],
});

export class SurfaceStore {
    readonly surfaces = signal<readonly Surface[]>([]);
    readonly guides = signal<readonly Guide[]>([]);
    readonly storeys = signal<readonly Storey[]>([defaultStorey()]);
    readonly selectedId = signal<SurfaceId | null>(null);
    /**
     * The selected line, when the selection is a line rather than a face.
     *
     * Two signals rather than one tagged union because nearly everything that reads the
     * selection wants faces only — the Kinds group, the pitch field, push/pull — and would have
     * to unwrap a union to say so. They are kept mutually exclusive by `select`/`selectGuide`,
     * which is the same "picking one clears the other" rule a modeller applies to a door and its
     * wall: two things are under the cursor, only one of them is being talked about.
     */
    readonly selectedGuideId = signal<GuideId | null>(null);
    /**
     * Faces no verb may change while it is set — roof mode's way of drawing over the house
     * without touching it. Topology here is by coincidence, so a ridge drawn over an interior
     * wall's top would otherwise weld into it and lift it; with the house locked, the drawing
     * tools work as they always do, but only on the faces drawn since.
     *
     * Locked faces are still there to see and snap to. What they refuse depends on the verb: an
     * edit aimed at one (split it, delete it, cut an opening in it) is rejected, and one that
     * only reaches it by coincidence (a weld at a split point, a vertex moved that it happens to
     * share, a new face drawn inside it) passes it by. Not part of the undo history — it is a
     * mode, not a change to the house.
     */
    readonly locked = signal<ReadonlySet<SurfaceId> | null>(null);

    /** Whether `id` is under `locked`. */
    isLocked(id: SurfaceId): boolean {
        return this.locked()?.has(id) ?? false;
    }

    /** Adds a face, snapping it to the modular grid in plan first unless `enforceModule` is false. */
    add(boundaryMm: readonly Point3Mm[], options: AddOptions = {}): AddResult {
        const validation = validateModularRing(boundaryMm, {
            enforceModule: options.enforceModule !== false,
        });
        if (!validation.ok || !validation.correctedMm) {
            return {
                surface: null,
                violations: validation.violations,
                maxCorrectionMm: validation.maxCorrectionMm,
            };
        }
        const shape = checkShape(validation.correctedMm);
        if (shape) return { surface: null, violations: [shape], maxCorrectionMm: 0 };
        const twin = this.surfaces().find((s) =>
            sameOutline(s.boundaryMm, validation.correctedMm!)
        );
        if (twin) {
            return {
                surface: null,
                violations: [
                    {
                        code: 'duplicate-face',
                        message: `${twin.id} already has that outline.`,
                        index: 0,
                    },
                ],
                maxCorrectionMm: 0,
            };
        }

        const surface: Surface = {
            id: mintId(),
            boundaryMm: validation.correctedMm,
            openings: [],
            holes: [],
            kindOverride: null,
            loadBearing: null,
            spanDirectionOverride: null,
            roofGroupId: null,
            studSectionOverride: null,
        };
        // Strictly inside a face on its plane, the ring is an inner loop of that face as well
        // as a face of its own — SketchUp's topology, and how a hole is made (`surface-holes.ts`).
        const host = hostFor(
            surface.boundaryMm,
            this.surfaces().filter((s) => !this.isLocked(s.id))
        );
        this.surfaces.update((list) => [
            ...list.map((s) =>
                s === host ? { ...s, holes: [...s.holes, surface.boundaryMm] } : s
            ),
            surface,
        ]);
        // Lines the face was drawn along are its edges now — retire them, as SketchUp does.
        this.consumeGuidesOn(surface.boundaryMm);
        return { surface, violations: [], maxCorrectionMm: validation.maxCorrectionMm };
    }

    /**
     * Cuts a rectangular opening into a face. The rectangle is given in model space — as the
     * rectangle tool drew it, on the face's own plane — and stored in the face's UV frame.
     *
     * Rejected unless every corner is inside or on the boundary, and the opening is smaller
     * than the face. On the boundary is allowed for a reason: a door's sill *is* the wall's
     * base. A hole that crosses the boundary is a notch, and a notch is a different face.
     */
    addOpening(
        id: SurfaceId,
        ringMm: readonly Point3Mm[],
        kind: OpeningKind,
        door: Pick<SurfaceOpening, 'leaves' | 'typeId'> = {}
    ): EditResult {
        if (this.isLocked(id)) return rejected([LOCKED]);
        const surface = this.get(id);
        if (!surface) return rejected([]);
        const frame = surfaceFrame(surface.boundaryMm);
        if (!frame) return rejected([]);
        const geometry = openingFromRing3(frame, ringMm, nextOpeningId(surface));
        const hole: SurfaceOpening | null = geometry ? { ...geometry, kind, ...door } : null;
        if (!hole) {
            return rejected([
                {
                    code: 'non-planar',
                    message: 'An opening must be a rectangle on the face.',
                    index: 0,
                },
            ]);
        }
        const boundaryUv = surface.boundaryMm.map((p) => toFrameUv(frame, p));
        const corners = openingRing3(frame, hole).map((p) => toFrameUv(frame, p));
        const inside = corners.every((uv) => pointInOrOnPolygon2(uv, boundaryUv));
        const centreInside = pointInPolygon2(
            { x: hole.uMm + hole.widthMm / 2, y: hole.vMm + hole.heightMm / 2 },
            boundaryUv
        );
        // A rectangle that *is* the face is not an opening in it.
        const uMax = Math.max(...boundaryUv.map((q) => q.x));
        const vMax = Math.max(...boundaryUv.map((q) => q.y));
        const wholeFace =
            hole.uMm <= 0 &&
            hole.vMm <= 0 &&
            hole.uMm + hole.widthMm >= uMax - 1 &&
            hole.vMm + hole.heightMm >= vMax - 1;
        if (wholeFace) {
            return rejected([
                { code: 'degenerate-edge', message: 'That rectangle is the whole face.', index: 0 },
            ]);
        }
        if (!inside || !centreInside) {
            return rejected([
                { code: 'outside-face', message: 'An opening must sit inside the face.', index: 0 },
            ]);
        }
        this.patch(id, { openings: [...surface.openings, hole] });
        return { ok: true, violations: [], surfaceIds: [id] };
    }

    /** Undoes a single `addOpening` — removes one opening by id, leaving the rest of the face alone. */
    removeOpening(id: SurfaceId, openingId: string): void {
        if (this.isLocked(id)) return;
        const surface = this.get(id);
        if (!surface) return;
        this.patch(id, { openings: surface.openings.filter((h) => h.id !== openingId) });
    }

    /**
     * Repositions and/or resizes an existing opening in place, subject to the same containment
     * rules `addOpening` enforces on a new one — a door slid along its wall, or a window's
     * rectangle grown or shrunk, must still fit inside the face it is cut into.
     */
    resizeOpening(
        id: SurfaceId,
        openingId: string,
        patch: Partial<
            Pick<
                SurfaceOpening,
                | 'kind'
                | 'uMm'
                | 'vMm'
                | 'widthMm'
                | 'heightMm'
                | 'hingeAtEnd'
                | 'swingsBack'
                | 'leaves'
                | 'glazing'
            >
        >
    ): EditResult {
        if (this.isLocked(id)) return rejected([LOCKED]);
        const surface = this.get(id);
        if (!surface) return rejected([]);
        const existing = surface.openings.find((h) => h.id === openingId);
        if (!existing) return rejected([]);
        const frame = surfaceFrame(surface.boundaryMm);
        if (!frame) return rejected([]);
        const hole: SurfaceOpening = { ...existing, ...patch };
        if (hole.widthMm <= 0 || hole.heightMm <= 0) {
            return rejected([
                {
                    code: 'degenerate-edge',
                    message: 'An opening must have a positive size.',
                    index: 0,
                },
            ]);
        }
        const boundaryUv = surface.boundaryMm.map((p) => toFrameUv(frame, p));
        const corners = openingRing3(frame, hole).map((p) => toFrameUv(frame, p));
        const inside = corners.every((uv) => pointInOrOnPolygon2(uv, boundaryUv));
        const centreInside = pointInPolygon2(
            { x: hole.uMm + hole.widthMm / 2, y: hole.vMm + hole.heightMm / 2 },
            boundaryUv
        );
        if (!inside || !centreInside) {
            return rejected([
                { code: 'outside-face', message: 'An opening must sit inside the face.', index: 0 },
            ]);
        }
        this.patch(id, { openings: surface.openings.map((h) => (h.id === openingId ? hole : h)) });
        return { ok: true, violations: [], surfaceIds: [id] };
    }

    /**
     * Splits a face along a path whose ends lie on its boundary — a chord when the path is two
     * points, an edge-to-edge polyline otherwise — into two faces, and splices the path's end
     * points into every *other* face whose edge passes through them.
     *
     * The second half is what makes the gable workflow possible at all: a ridge line drawn
     * across a box's top face ends on the top edges of the two end walls, and unless those
     * walls gain a vertex there, lifting the ridge later would tear the roof off them.
     *
     * The interior points of the path must lie inside the face; a path that wanders out and
     * back is rejected, since neither half would be a polygon.
     */
    split(id: SurfaceId, pathMm: readonly Point3Mm[]): EditResult {
        if (this.isLocked(id)) return rejected([LOCKED]);
        const surface = this.get(id);
        if (!surface) return rejected([]);
        const frame = surfaceFrame(surface.boundaryMm);
        if (frame && pathMm.length > 2) {
            const boundaryUv = surface.boundaryMm.map((p) => toFrameUv(frame, p));
            const inside = pathMm
                .slice(1, -1)
                .every((p) => pointInPolygon2(toFrameUv(frame, p), boundaryUv));
            if (!inside) {
                return rejected([
                    {
                        code: 'outside-face',
                        message: 'A line that splits a face has to stay inside it.',
                        index: 0,
                    },
                ]);
            }
        }
        const halves = splitRingAlong(surface.boundaryMm, pathMm);
        if (!halves) {
            return rejected([
                {
                    code: 'degenerate-edge',
                    message: 'Both ends of the line must land on the face’s edges to split it.',
                    index: 0,
                },
            ]);
        }
        for (const half of halves) {
            const shape = checkShape(half);
            if (shape) return rejected([shape]);
        }
        // Every inner ring has to land wholly in one half: a cut through a hole would leave a
        // half with a bite out of its edge that is neither its outline nor a ring inside it.
        const ringHalf = surface.holes.map((ring) =>
            halves.findIndex((half) => ringInside(ring, half))
        );
        if (ringHalf.some((i) => i === -1)) {
            return rejected([
                {
                    code: 'outside-face',
                    message: 'That line runs through a hole in the face — cut beside it instead.',
                    index: 0,
                },
            ]);
        }

        const created: Surface[] = halves.map((boundaryMm, i) => {
            const half: Surface = {
                ...surface,
                id: i === 0 ? surface.id : mintId(),
                boundaryMm,
                openings: [],
                holes: surface.holes.filter((_, j) => ringHalf[j] === i),
            };
            // An opening goes with whichever half contains it, re-measured in that half's frame.
            // (Its old frame is the parent's, whose origin the split may have moved.)
            if (frame) {
                const halfFrame = surfaceFrame(boundaryMm);
                const halfUv = boundaryMm.map((p) => toFrameUv(halfFrame ?? frame, p));
                half.openings = surface.openings.flatMap((hole) => {
                    const ring = openingRing3(frame, hole);
                    const inHalf = ring.every((p) =>
                        pointInPolygon2(toFrameUv(halfFrame ?? frame, p), halfUv)
                    );
                    const moved = halfFrame ? openingFromRing3(halfFrame, ring, hole.id) : null;
                    return inHalf && moved ? [withSwing(moved, hole)] : [];
                });
            }
            return half;
        });

        const ends = [pathMm[0]!, pathMm[pathMm.length - 1]!];
        this.surfaces.update((list) =>
            list.flatMap((s) => {
                if (s.id === id) return created;
                if (this.isLocked(s.id)) return [s];
                // Weld: any neighbour whose edge runs through a split point gains it as a
                // vertex, so the two faces keep sharing that edge when it later moves.
                let ring = s.boundaryMm;
                for (const p of ends) ring = insertOnRing(ring, p)?.ring ?? ring;
                return ring === s.boundaryMm ? [s] : [{ ...s, boundaryMm: ring }];
            })
        );
        // The line that made the cut is an edge of both halves now, not a loose one.
        for (const half of halves) this.consumeGuidesOn(half);
        return { ok: true, violations: [], surfaceIds: created.map((s) => s.id) };
    }

    /**
     * Push/pull: moves a copy of the face `distanceMm` along its normal and joins the two with
     * one face per edge. The original stays as the bottom of the box. Openings ride along on
     * the copy, since it is the same face in a new place.
     */
    extrude(id: SurfaceId, distanceMm: number, options: AddOptions = {}): EditResult {
        const surface = this.get(id);
        if (!surface) return rejected([]);
        const frame = surfaceFrame(surface.boundaryMm);
        if (!frame) return rejected([]);
        if (Math.round(distanceMm) === 0) {
            return rejected([
                {
                    code: 'degenerate-edge',
                    message: 'Pull the face some distance first.',
                    index: 0,
                },
            ]);
        }
        const { top, sides } = extrudeRing(surface.boundaryMm, frame.normal, distanceMm);

        // Validate everything before committing anything: a box with a rejected side is not
        // a box, and the user would be left with the pieces to delete by hand.
        const rings = [top, ...sides];
        const validated: Point3Mm[][] = [];
        for (const ring of rings) {
            const validation = validateModularRing(ring, {
                enforceModule: options.enforceModule !== false,
            });
            if (!validation.ok || !validation.correctedMm) return rejected(validation.violations);
            const shape = checkShape(validation.correctedMm);
            if (shape) return rejected([shape]);
            validated.push([...validation.correctedMm]);
        }

        const created: Surface[] = validated.map((boundaryMm, i) => ({
            id: mintId(),
            boundaryMm,
            openings: i === 0 ? surface.openings : [],
            // An inner loop is not pulled along: the box is solid, and a hole through it would
            // need faces for its own sides that push/pull does not make.
            holes: [],
            kindOverride: null,
            loadBearing: null,
            spanDirectionOverride: null,
            roofGroupId: null,
            studSectionOverride: null,
        }));
        this.surfaces.update((list) => [...list, ...created]);
        const z = surface.boundaryMm[0]!.z;
        this.followPull(frame.normal, { mode: 'box', fromZMm: z, toZMm: top[0]!.z });
        return { ok: true, violations: [], surfaceIds: created.map((s) => s.id) };
    }

    /**
     * Push/pull with Shift: moves the face itself `distanceMm` along its normal, and every face
     * with a corner on it stretches to follow — SketchUp's pull on a box's top, which makes the
     * box taller rather than stacking a second one on it. A face nothing is attached to has
     * nothing to stretch, so it gets the box `extrude` makes instead.
     */
    stretch(id: SurfaceId, distanceMm: number): EditResult {
        const surface = this.get(id);
        if (!surface) return rejected([]);
        const frame = surfaceFrame(surface.boundaryMm);
        if (!frame) return rejected([]);
        const ring = surface.boundaryMm;
        if (!this.hasAttachedFaces(id)) return this.extrude(id, distanceMm);
        const delta = roundPoint(scale3(frame.normal, distanceMm));
        if (delta.x === 0 && delta.y === 0 && delta.z === 0) return rejected([]);
        const result = this.moveVertices(ring, delta);
        if (!result.ok) return result;
        const z = ring[0]!.z;
        this.followPull(frame.normal, { mode: 'stretch', fromZMm: z, toZMm: z + delta.z });
        return result;
    }

    /** Where `stretch` would leave the faces it moves, for the preview. */
    previewStretch(id: SurfaceId, distanceMm: number): readonly Point3Mm[][] | null {
        const surface = this.get(id);
        const frame = surface && surfaceFrame(surface.boundaryMm);
        if (!surface || !frame) return null;
        const ring = surface.boundaryMm;
        if (!this.hasAttachedFaces(id)) return null;
        return this.previewMove(ring, roundPoint(scale3(frame.normal, distanceMm)));
    }

    /** Whether any other face has a corner on this one's — something for `stretch` to drag. */
    private hasAttachedFaces(id: SurfaceId): boolean {
        const ring = this.get(id)?.boundaryMm ?? [];
        return this.surfaces().some(
            (s) => s.id !== id && s.boundaryMm.some((p) => ring.some((q) => samePoint(p, q)))
        );
    }

    /** A vertical pull keeps the storeys in step with the boxes it built (`storey-follow.ts`). */
    private followPull(normal: Point3Mm, pull: StoreyPull): void {
        if (Math.abs(normal.z) < 1 - 1e-6) return;
        const next = storeysAfterPull(
            this.storeys(),
            this.surfaces(),
            pull,
            (elevationMm, heightMm) => ({
                id: mintStoreyId(),
                name: `Storey ${this.storeys().length + 1}`,
                elevationMm,
                heightMm,
            })
        );
        if (next) this.storeys.set(next);
    }

    /**
     * Moves every vertex of every face that sits at one of `positionsMm` by `deltaMm`.
     *
     * All-or-nothing: if any affected face would fold (go non-planar) or collapse, nothing
     * moves and the fold is reported. That is the one place the missing B-rep shows — SketchUp
     * would auto-fold the face along a diagonal — and refusing is the honest alternative to
     * inventing a fold the user did not ask for.
     */
    moveVertices(positionsMm: readonly Point3Mm[], deltaMm: Point3Mm): EditResult {
        const next: Surface[] = [];
        const touched: SurfaceId[] = [];
        for (const s of this.surfaces()) {
            if (this.isLocked(s.id)) {
                next.push(s);
                continue;
            }
            const { ring, moved } = moveRingVertices(s.boundaryMm, positionsMm, deltaMm);
            const holes = s.holes.map((h) => moveRingVertices(h, positionsMm, deltaMm));
            if (!moved && !holes.some((h) => h.moved)) {
                next.push(s);
                continue;
            }
            const shape = checkShape(ring) ?? checkInnerRings(ring, holes);
            if (shape) {
                return rejected([{ ...shape, message: `${s.id}: ${shape.message}` }]);
            }
            next.push({ ...s, boundaryMm: ring, holes: holes.map((h) => h.ring) });
            touched.push(s.id);
        }
        if (touched.length === 0) return rejected([]);
        this.surfaces.set(next);
        return { ok: true, violations: [], surfaceIds: touched };
    }

    /**
     * The general move: every vertex at a `fromMm` goes to its own `toMm`.
     *
     * `moveVertices` above is the uniform special case — one delta for every picked position —
     * and this is what the edits whose corners travel different distances go through: re-pitching
     * a roof plane sends each corner to a height that depends on its own distance from the hinge
     * (`pitch.ts`). Same checks, same rejection-over-exception contract; the only thing that
     * differs is where the destinations come from.
     */
    moveVerticesTo(moves: readonly VertexMove[]): EditResult {
        const next: Surface[] = [];
        const touched: SurfaceId[] = [];
        for (const s of this.surfaces()) {
            if (this.isLocked(s.id)) {
                next.push(s);
                continue;
            }
            const { ring, moved } = moveRingVerticesTo(s.boundaryMm, moves);
            const holes = s.holes.map((h) => moveRingVerticesTo(h, moves));
            if (!moved && !holes.some((h) => h.moved)) {
                next.push(s);
                continue;
            }
            const shape = checkShape(ring) ?? checkInnerRings(ring, holes);
            if (shape) {
                return rejected([{ ...shape, message: `${s.id}: ${shape.message}` }]);
            }
            next.push({ ...s, boundaryMm: ring, holes: holes.map((h) => h.ring) });
            touched.push(s.id);
        }
        if (touched.length === 0) return rejected([]);
        this.surfaces.set(next);
        return { ok: true, violations: [], surfaceIds: touched };
    }

    /**
     * Pulls a stretch of wall out (or in) in plan — the L-shape edit. The geometry is
     * `wall-extend.ts`'s; this validates every face it reshapes or adds with the same checks
     * every other verb applies, and commits all of it or none of it: half a pulled wing is a
     * house with a hole in it.
     */
    extendWall(request: WallExtendRequest, options: AddOptions = {}): EditResult {
        if (this.locked()) return rejected([LOCKED]);
        const planned = this.planExtendWall(request, options, mintId);
        if (!planned.ok) return rejected(planned.violations);
        this.surfaces.set(planned.surfaces);
        this.selectedId.set(null);
        return { ok: true, violations: [], surfaceIds: planned.touched };
    }

    /** The model `extendWall` would produce, without committing — for the plan's preview. */
    previewExtendWall(
        request: WallExtendRequest,
        options: AddOptions = {}
    ): readonly Surface[] | null {
        // A preview's new faces are never committed, so they must not use up real ids.
        let n = 0;
        const planned = this.planExtendWall(request, options, () => `preview${++n}`);
        return planned.ok ? planned.surfaces : null;
    }

    /**
     * Moves a wall line sideways in plan, with everything standing on it — what an edited
     * dimension does (`wall-line-move.ts`). All or nothing, like every other edit. No module
     * check: the distance was typed, and typing is what bypasses the grid.
     */
    moveWallLine(request: WallLineMoveRequest): EditResult {
        if (this.locked()) return rejected([LOCKED]);
        const planned = this.planMoveWallLine(request);
        if (!planned.ok) return rejected(planned.violations);
        this.surfaces.set(planned.surfaces);
        // Loose lines on the moved line go with it — a porch's columns, a construction line.
        const { aMm, bMm } = planned.segment;
        const onLine = (p: Point3Mm): boolean =>
            p.z >= request.baseZMm - COINCIDENT_MM && onPlanSegment(p, aMm, bMm);
        const shift = (p: Point3Mm): Point3Mm =>
            onLine(p)
                ? roundPoint({ x: p.x + request.shiftMm.x, y: p.y + request.shiftMm.y, z: p.z })
                : p;
        if (this.guides().some((g) => onLine(g.aMm) || onLine(g.bMm))) {
            this.guides.update((list) =>
                list.map((g) =>
                    onLine(g.aMm) || onLine(g.bMm)
                        ? { ...g, aMm: shift(g.aMm), bMm: shift(g.bMm) }
                        : g
                )
            );
        }
        return { ok: true, violations: [], surfaceIds: planned.touched };
    }

    /**
     * Lifts (or lowers) everything from a storey's ceiling line up by `riseMm` — what a typed
     * ceiling height does (`roof-lift.ts`). Loose lines with an end up there follow, a column
     * stretching with its wall; the storeys above move up with the floors they stand on, and the
     * lifted storey's own height grows by the same rise. All or nothing, like every other edit.
     */
    liftRoof(request: RoofLiftRequest): EditResult {
        if (this.locked()) return rejected([LOCKED]);
        const planned = this.planLiftRoof(request);
        if (!planned.ok) return rejected(planned.violations);
        this.surfaces.set(planned.surfaces);
        const rise = Math.round(request.riseMm);
        const lifts = (p: Point3Mm): boolean =>
            p.z >= request.fromZMm - COINCIDENT_MM && p.z >= request.baseZMm - COINCIDENT_MM;
        const lifted = (p: Point3Mm): Point3Mm => (lifts(p) ? { ...p, z: p.z + rise } : p);
        if (this.guides().some((g) => lifts(g.aMm) || lifts(g.bMm))) {
            this.guides.update((list) =>
                list.map((g) =>
                    lifts(g.aMm) || lifts(g.bMm)
                        ? { ...g, aMm: lifted(g.aMm), bMm: lifted(g.bMm) }
                        : g
                )
            );
        }
        this.storeys.update((list) =>
            list.map((s) => {
                if (s.elevationMm >= request.fromZMm - COINCIDENT_MM) {
                    return { ...s, elevationMm: s.elevationMm + rise };
                }
                if (Math.abs(s.elevationMm - request.baseZMm) <= COINCIDENT_MM) {
                    return { ...s, heightMm: Math.max(MIN_STOREY_HEIGHT_MM, s.heightMm + rise) };
                }
                return s;
            })
        );
        return { ok: true, violations: [], surfaceIds: planned.touched };
    }

    /** The model `liftRoof` would produce, without committing — for the preview. */
    previewLiftRoof(request: RoofLiftRequest): readonly Surface[] | null {
        const planned = this.planLiftRoof(request);
        return planned.ok ? planned.surfaces : null;
    }

    private planLiftRoof(
        request: RoofLiftRequest
    ):
        | { ok: true; surfaces: Surface[]; touched: readonly SurfaceId[] }
        | { ok: false; violations: readonly Violation[] } {
        const result = liftRoof(this.surfaces(), request);
        if (!result.ok) {
            return {
                ok: false,
                violations: [{ code: 'degenerate-edge', message: result.message, index: 0 }],
            };
        }
        const touched = new Set(result.touched);
        for (const s of result.surfaces) {
            if (!touched.has(s.id)) continue;
            const shape =
                checkShape(s.boundaryMm) ??
                checkInnerRings(
                    s.boundaryMm,
                    s.holes.map((ring) => ({ ring }))
                );
            if (shape) {
                return {
                    ok: false,
                    violations: [{ ...shape, message: `${s.id}: ${shape.message}` }],
                };
            }
        }
        return { ok: true, surfaces: result.surfaces, touched: result.touched };
    }

    /** The model `moveWallLine` would produce, without committing — for the preview. */
    previewMoveWallLine(request: WallLineMoveRequest): readonly Surface[] | null {
        const planned = this.planMoveWallLine(request);
        return planned.ok ? planned.surfaces : null;
    }

    private planMoveWallLine(request: WallLineMoveRequest):
        | {
              ok: true;
              surfaces: Surface[];
              touched: readonly SurfaceId[];
              segment: WallLineSegment;
          }
        | { ok: false; violations: readonly Violation[] } {
        const result = moveWallLine(this.surfaces(), request);
        if (!result.ok) {
            return {
                ok: false,
                violations: [{ code: 'degenerate-edge', message: result.message, index: 0 }],
            };
        }
        const touched = new Set(result.touched);
        for (const s of result.surfaces) {
            if (!touched.has(s.id)) continue;
            const shape =
                checkShape(s.boundaryMm) ??
                checkInnerRings(
                    s.boundaryMm,
                    s.holes.map((ring) => ({ ring }))
                );
            if (shape) {
                return {
                    ok: false,
                    violations: [{ ...shape, message: `${s.id}: ${shape.message}` }],
                };
            }
        }
        return {
            ok: true,
            surfaces: result.surfaces,
            touched: result.touched,
            segment: result.segment,
        };
    }

    private planExtendWall(
        request: WallExtendRequest,
        options: AddOptions,
        mint: () => SurfaceId
    ):
        | { ok: true; surfaces: Surface[]; touched: readonly SurfaceId[] }
        | { ok: false; violations: readonly Violation[] } {
        const result = extendWall(this.surfaces(), request, mint);
        if (!result.ok) {
            return {
                ok: false,
                violations: [{ code: 'degenerate-edge', message: result.message, index: 0 }],
            };
        }
        const touched = new Set(result.touched);
        const surfaces: Surface[] = [];
        for (const s of result.surfaces) {
            if (!touched.has(s.id)) {
                surfaces.push(s);
                continue;
            }
            const validation = validateModularRing(s.boundaryMm, {
                enforceModule: options.enforceModule !== false,
            });
            if (!validation.ok || !validation.correctedMm) {
                return { ok: false, violations: validation.violations };
            }
            const shape = checkShape(validation.correctedMm);
            if (shape) {
                return {
                    ok: false,
                    violations: [{ ...shape, message: `${s.id}: ${shape.message}` }],
                };
            }
            surfaces.push({ ...s, boundaryMm: validation.correctedMm });
        }
        return { ok: true, surfaces, touched: result.touched };
    }

    /** The faces `moveVerticesTo` would produce, without committing — for the preview. */
    previewMoveTo(moves: readonly VertexMove[]): readonly Point3Mm[][] {
        const rings: Point3Mm[][] = [];
        for (const s of this.surfaces()) {
            const { ring, moved } = moveRingVerticesTo(s.boundaryMm, moves);
            if (moved) rings.push([...ring]);
        }
        return rings;
    }

    /** The faces `moveVertices` would produce, without committing — for the drag preview. */
    previewMove(positionsMm: readonly Point3Mm[], deltaMm: Point3Mm): readonly Point3Mm[][] {
        const rings: Point3Mm[][] = [];
        for (const s of this.surfaces()) {
            const { ring, moved } = moveRingVertices(s.boundaryMm, positionsMm, deltaMm);
            if (moved) rings.push([...ring]);
        }
        return rings;
    }

    // ---- Guides ----

    /**
     * Adds a loose line. Null when it is too short to be one, or when a guide or a face edge
     * already runs along it — re-tracing an edge is how the user *breaks* it (`breakAt`), not
     * a request for a second line on top of the first.
     */
    addGuide(aMm: Point3Mm, bMm: Point3Mm): Guide | null {
        const a = roundPoint(aMm);
        const b = roundPoint(bMm);
        if (distance3(a, b) < MIN_GUIDE_LENGTH_MM) return null;
        if (this.segmentExists(a, b)) return null;
        const guide: Guide = { id: mintGuideId(), aMm: a, bMm: b };
        this.guides.update((list) => [...list, guide]);
        return guide;
    }

    /**
     * Declares the segment a column or a beam, whether or not a line is there yet — the corner
     * of a wall is a face edge, not a guide, and a post can stand on it all the same. A guide
     * already lying exactly along it takes the role; otherwise a new line is added with it, on
     * top of the edge, which a declared line is allowed to be (`consumeGuidesOn` skips it).
     */
    declareLine(aMm: Point3Mm, bMm: Point3Mm, role: GuideRole): Guide | null {
        const a = roundPoint(aMm);
        const b = roundPoint(bMm);
        if (distance3(a, b) < MIN_GUIDE_LENGTH_MM) return null;
        const existing = this.guides().find(
            (g) => segmentOnSegment(g.aMm, g.bMm, a, b) && segmentOnSegment(a, b, g.aMm, g.bMm)
        );
        if (existing) {
            this.setGuideRole(existing.id, role);
            return this.getGuide(existing.id) ?? null;
        }
        const guide: Guide = { id: mintGuideId(), aMm: a, bMm: b, role };
        this.guides.update((list) => [...list, guide]);
        return guide;
    }

    removeGuide(id: GuideId): void {
        this.guides.update((list) => list.filter((g) => g.id !== id));
        if (this.selectedGuideId() === id) this.selectedGuideId.set(null);
    }

    /**
     * Declares a line a column or a beam — or, with `null`, hands it back to the guides.
     *
     * The whole of `recipe/line-members.ts` hangs off this one field: it is how a pergola, a
     * carport or a porch canopy gets framed at all, since there is no face to derive those from.
     * No geometric check, because there is no wrong answer to check against — a raking brace is
     * as real a member as a plumb post — so the store only refuses what it cannot find.
     */
    setGuideRole(id: GuideId, role: GuideRole | null): boolean {
        const guide = this.getGuide(id);
        if (!guide) return false;
        if (guide.role === (role ?? undefined)) return true;
        this.guides.update((list) =>
            list.map((g) => {
                if (g.id !== id) return g;
                if (role === null) {
                    const { role: _dropped, ...rest } = g;
                    return rest;
                }
                return { ...g, role };
            })
        );
        return true;
    }

    /**
     * Throws away every line that is still just a guide. Returns how many went.
     *
     * Lines with a role are timber (`guide.ts`), and Purge is the "clear the scratch" verb —
     * sweeping a user's pergola away with their construction marks would make the one button
     * that is meant to be safe the most destructive one in the app.
     */
    purgeGuides(): number {
        const keep = this.guides().filter(isStructuralLine);
        const count = this.guides().length - keep.length;
        if (count > 0) {
            this.guides.set(keep);
            const selected = this.selectedGuideId();
            if (selected && !keep.some((g) => g.id === selected)) this.selectedGuideId.set(null);
        }
        return count;
    }

    /** How many lines Purge would take — what the rail's button shows itself for. */
    purgeableGuideCount(): number {
        return this.guides().filter((g) => !isStructuralLine(g)).length;
    }

    getGuide(id: GuideId): Guide | undefined {
        return this.guides().find((g) => g.id === id);
    }

    /** Is the segment already an edge — of a face, or a guide — so that drawing it adds nothing? */
    segmentExists(aMm: Point3Mm, bMm: Point3Mm): boolean {
        return (
            this.surfaces().some(
                (s) =>
                    segmentOnRing(s.boundaryMm, aMm, bMm) ||
                    s.holes.some((ring) => segmentOnRing(ring, aMm, bMm))
            ) || this.guides().some((g) => segmentOnSegment(g.aMm, g.bMm, aMm, bMm))
        );
    }

    /**
     * Puts a corner at each of `pointsMm` in every face edge and every guide that passes
     * through it — SketchUp's "an edge is split where a line touches it". A point already at
     * a corner, or on nothing, changes nothing. This is what gives the user a new vertex and
     * two new midpoints to snap to after drawing a line onto an edge.
     */
    breakAt(pointsMm: readonly Point3Mm[]): BreakResult {
        const surfaceIds: SurfaceId[] = [];
        const next = this.surfaces().map((s) => {
            if (this.isLocked(s.id)) return s;
            let ring = s.boundaryMm;
            for (const p of pointsMm) {
                const where = locateOnRing(ring, p);
                if (where?.kind === 'edge') ring = insertOnRing(ring, p)?.ring ?? ring;
            }
            if (ring === s.boundaryMm) return s;
            surfaceIds.push(s.id);
            return { ...s, boundaryMm: ring };
        });
        if (surfaceIds.length > 0) this.surfaces.set(next);

        const guideIds: GuideId[] = [];
        const guides = this.guides().flatMap((g) => {
            // A line that is a column or a beam is a *piece*, and a piece does not become two
            // pieces because something was drawn across it. Only scratch gets cut.
            if (isStructuralLine(g)) return [g];
            // Cut at every point along it, in order along the line, so a guide touched twice
            // becomes three.
            const cuts = pointsMm
                .filter((p) => insideSegment(g.aMm, g.bMm, p))
                .map(roundPoint)
                .sort((p, q) => distance3(g.aMm, p) - distance3(g.aMm, q));
            if (cuts.length === 0) return [g];
            guideIds.push(g.id);
            const stops = [g.aMm, ...cuts, g.bMm];
            const pieces: Guide[] = [];
            for (let i = 0; i + 1 < stops.length; i++) {
                if (samePoint(stops[i]!, stops[i + 1]!)) continue;
                pieces.push({
                    id: i === 0 ? g.id : mintGuideId(),
                    aMm: stops[i]!,
                    bMm: stops[i + 1]!,
                });
            }
            return pieces;
        });
        if (guideIds.length > 0) this.guides.set(guides);
        return { surfaceIds, guideIds };
    }

    /**
     * Removes every guide that lies along the ring's edges. Returns how many went.
     *
     * Lines with a role survive: a beam drawn along what later becomes a wall's top edge is
     * still that beam, and having it disappear the moment a face was drawn past it would read
     * as the app eating the user's work.
     */
    consumeGuidesOn(ringMm: readonly Point3Mm[]): number {
        const keep = this.guides().filter(
            (g) => isStructuralLine(g) || !segmentOnRing(ringMm, g.aMm, g.bMm)
        );
        const removed = this.guides().length - keep.length;
        if (removed > 0) this.guides.set(keep);
        return removed;
    }

    /** Every edge in the model — face boundaries and guides — for the loop finder. */
    allEdges(): readonly (readonly [Point3Mm, Point3Mm])[] {
        const edges: (readonly [Point3Mm, Point3Mm])[] = [];
        for (const s of this.surfaces()) {
            for (const ring of [s.boundaryMm, ...s.holes]) {
                for (let i = 0; i < ring.length; i++) {
                    edges.push([ring[i]!, ring[(i + 1) % ring.length]!]);
                }
            }
        }
        for (const g of this.guides()) edges.push([g.aMm, g.bMm]);
        return edges;
    }

    // ---- Storeys ----

    /** Adds a storey above the highest one — the way a house is actually built up. */
    addStorey(): Storey {
        const sorted = sortStoreys(this.storeys());
        const top = sorted[sorted.length - 1] ?? null;
        const storey: Storey = {
            id: mintStoreyId(),
            name: `Storey ${sorted.length + 1}`,
            elevationMm: top ? top.elevationMm + top.heightMm : 0,
            heightMm: DEFAULT_STOREY_HEIGHT_MM,
        };
        this.storeys.update((list) => [...list, storey]);
        return storey;
    }

    renameStorey(id: StoreyId, name: string): boolean {
        return this.patchStorey(id, { name });
    }

    setStoreyElevation(id: StoreyId, elevationMm: number): boolean {
        return this.patchStorey(id, { elevationMm: Math.round(elevationMm) });
    }

    setStoreyHeight(id: StoreyId, heightMm: number): boolean {
        if (heightMm < MIN_STOREY_HEIGHT_MM) return false;
        return this.patchStorey(id, { heightMm: Math.round(heightMm) });
    }

    /** Refuses to drop the last storey — a house always has at least one to view and export. */
    removeStorey(id: StoreyId): boolean {
        if (this.storeys().length <= 1 || !this.getStorey(id)) return false;
        this.storeys.update((list) => list.filter((s) => s.id !== id));
        return true;
    }

    getStorey(id: StoreyId): Storey | undefined {
        return this.storeys().find((s) => s.id === id);
    }

    private patchStorey(id: StoreyId, patch: Partial<Omit<Storey, 'id'>>): boolean {
        if (!this.getStorey(id)) return false;
        this.storeys.update((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
        return true;
    }

    setKindOverride(id: SurfaceId, kind: SurfaceKind | null): boolean {
        return this.patch(id, { kindOverride: kind });
    }

    /** Whether a face carries load, `null` for Auto. See `Surface.loadBearing`. */
    setLoadBearing(id: SurfaceId, loadBearing: boolean | null): boolean {
        return this.patch(id, { loadBearing });
    }

    /** What kind of wall one wall is pinned to be, `null` for Auto. See `Surface.partitionKind`. */
    setPartitionKind(id: SurfaceId, kind: PartitionKind | null): boolean {
        return this.patch(id, { partitionKind: kind });
    }

    /** The build-up type one face is pinned to, `null` for its kind's own. See `Surface.buildUpType`. */
    setBuildUpType(id: SurfaceId, type: string | null): boolean {
        return this.patch(id, { buildUpType: type });
    }

    /** Manual stud-section pin for one wall, `null` for Auto. See `Surface.studSectionOverride`. */
    setStudSectionOverride(id: SurfaceId, sectionId: string | null): boolean {
        return this.patch(id, { studSectionOverride: sectionId });
    }

    remove(id: SurfaceId): void {
        if (this.isLocked(id)) return;
        this.surfaces.update((list) => list.filter((s) => s.id !== id));
        if (this.selectedId() === id) this.selectedId.set(null);
    }

    /**
     * Takes faces out, reshapes others and adds new ones, as one edit — roof mode's Save
     * (`roof-fit.ts`), which groups the roof and grows the walls up to it together.
     *
     * Every reshaped and added ring passes the same shape check a drawn face does, a reshaped
     * face must still hold its openings and inner rings, and no face may end up with the outline
     * of another. All or nothing: half a roof is worse than the old one.
     */
    applyFaceChanges(changes: FaceChanges): EditResult {
        const removed = new Set(changes.removeIds);
        const reshaped = new Map(changes.reshape.map((r) => [r.id, r]));
        const next: Surface[] = [];
        const touched: SurfaceId[] = [];
        for (const s of this.surfaces()) {
            if (removed.has(s.id)) continue;
            const change = reshaped.get(s.id);
            if (!change) {
                next.push(s);
                continue;
            }
            const roofGroupId =
                change.roofGroupId === undefined ? s.roofGroupId : change.roofGroupId;
            if (!change.boundaryMm) {
                next.push({ ...s, roofGroupId });
                continue;
            }
            const boundaryMm = change.boundaryMm.map(roundPoint);
            const shape =
                checkShape(boundaryMm) ??
                checkInnerRings(
                    boundaryMm,
                    s.holes.map((h) => ({ ring: h }))
                );
            if (shape) return rejected([{ ...shape, message: `${s.id}: ${shape.message}` }]);
            const frame = surfaceFrame(boundaryMm);
            const lost = frame
                ? s.openings.find((o) => !ringInside(openingRing3(frame, o), boundaryMm))
                : undefined;
            if (lost) {
                return rejected([
                    {
                        code: 'outside-face',
                        message: `${s.id}: its ${OPENING_LABELS[lost.kind]} would be left outside the wall.`,
                        index: 0,
                    },
                ]);
            }
            next.push({ ...s, boundaryMm, roofGroupId });
            touched.push(s.id);
        }
        for (const face of changes.add) {
            const boundaryMm = face.boundaryMm.map(roundPoint);
            const shape = checkShape(boundaryMm);
            if (shape) return rejected([shape]);
            next.push({
                id: mintId(),
                boundaryMm,
                openings: [],
                holes: [],
                kindOverride: face.kindOverride,
                loadBearing: null,
                spanDirectionOverride: null,
                roofGroupId: face.roofGroupId,
                studSectionOverride: null,
                ...(face.partitionKind ? { partitionKind: face.partitionKind } : {}),
                ...(face.buildUpType ? { buildUpType: face.buildUpType } : {}),
            });
            touched.push(next[next.length - 1]!.id);
        }
        for (const id of touched) {
            const s = next.find((f) => f.id === id)!;
            const twin = next.find((f) => f !== s && sameOutline(f.boundaryMm, s.boundaryMm));
            if (twin) {
                return rejected([
                    {
                        code: 'duplicate-face',
                        message: `${twin.id} already has that outline.`,
                        index: 0,
                    },
                ]);
            }
        }
        this.surfaces.set(next);
        const selected = this.selectedId();
        if (selected && removed.has(selected)) this.selectedId.set(null);
        return { ok: true, violations: [], surfaceIds: touched };
    }

    /**
     * Erases a face the way SketchUp does: the face goes, its edges stay. Every edge that is not
     * already some other face's edge or a line is left behind as a guide — which is what lets a
     * wall be taken out of a box and the corner it stood on be kept, and declared a column.
     */
    removeFace(id: SurfaceId, options: { except?: readonly [Point3Mm, Point3Mm] } = {}): boolean {
        const surface = this.get(id);
        if (!surface || this.isLocked(id)) return false;
        this.remove(id);
        const except = options.except;
        for (const ring of [surface.boundaryMm, ...surface.holes]) {
            for (let i = 0; i < ring.length; i++) {
                const a = ring[i]!;
                const b = ring[(i + 1) % ring.length]!;
                if (except && segmentOnSegment(except[0], except[1], a, b)) continue;
                this.addGuide(a, b);
            }
        }
        return true;
    }

    /** The faces with `a`–`b` along one of their edges. */
    facesOnEdge(aMm: Point3Mm, bMm: Point3Mm): Surface[] {
        return this.surfaces().filter((s) => segmentOnRing(s.boundaryMm, aMm, bMm));
    }

    /**
     * Heals two coplanar faces sharing an edge into one — the undo of a split. The first keeps
     * its id and settings and takes the second's openings. Rejected when they are not one plane
     * or do not meet along an edge.
     */
    mergeFaces(keepId: SurfaceId, dropId: SurfaceId): EditResult {
        if (this.isLocked(keepId) || this.isLocked(dropId)) return rejected([LOCKED]);
        const keep = this.get(keepId);
        const drop = this.get(dropId);
        if (!keep || !drop || keep === drop) {
            return rejected([{ code: 'degenerate-edge', message: 'Nothing to merge.', index: 0 }]);
        }
        const plane = planeOfPolygon(keep.boundaryMm);
        const coplanar =
            plane &&
            drop.boundaryMm.every(
                (p) => Math.abs(distanceToPlane(p, plane)) <= PLANARITY_TOLERANCE_MM
            );
        const ring = coplanar ? mergeRings(keep.boundaryMm, drop.boundaryMm) : null;
        if (!ring) {
            return rejected([
                {
                    code: 'non-planar',
                    message: `${keepId} and ${dropId} are not one flat face either side of an edge.`,
                    index: 0,
                },
            ]);
        }
        const shape = checkShape(ring);
        if (shape) return rejected([shape]);
        const frame = surfaceFrame(ring);
        const moveOpenings = (s: Surface): SurfaceOpening[] => {
            const from = surfaceFrame(s.boundaryMm);
            if (!frame || !from) return [];
            return s.openings.flatMap((h) => {
                const moved = openingFromRing3(frame, openingRing3(from, h), h.id);
                return moved ? [withSwing(moved, h)] : [];
            });
        };
        const openings = [...moveOpenings(keep), ...moveOpenings(drop)];
        const holes = [...keep.holes, ...drop.holes];
        this.surfaces.update((list) =>
            list
                .filter((s) => s.id !== dropId)
                .map((s) => (s.id === keepId ? { ...s, boundaryMm: ring, openings, holes } : s))
        );
        if (this.selectedId() === dropId) this.selectedId.set(keepId);
        return { ok: true, violations: [], surfaceIds: [keepId] };
    }

    /**
     * Makes a face a window or a door in the face around it — the context menu's verb, and the
     * way every window is made now that a rectangle drawn in a wall is a face like any other.
     *
     * Two cases, one for each way the rectangle can have been drawn. Strictly inside the wall it
     * fills an inner ring of it (`surface-holes.ts`): the ring and the face go, and the wall gets
     * the opening. Against the wall's edge — a door drawn up from the floor — it split the wall
     * instead, and the wall is healed around it first (`mergeFaces`), then given the opening.
     * Either way the face must be an axis-aligned rectangle on the wall's frame, which is what
     * the opening recipe frames.
     */
    makeOpening(id: SurfaceId, kind: OpeningKind): EditResult {
        if (this.isLocked(id)) return rejected([LOCKED]);
        const piece = this.get(id);
        if (!piece) return rejected([]);
        const notRectangle = rejected([
            {
                code: 'non-planar',
                message: `A ${kind} has to be a rectangle square to the face it is in.`,
                index: 0,
            },
        ]);

        const inner = hostOf(piece, this.surfaces());
        if (inner) {
            const { host, index } = inner;
            const frame = surfaceFrame(host.boundaryMm);
            const geometry = frame
                ? openingFromRing3(frame, piece.boundaryMm, nextOpeningId(host))
                : null;
            if (!geometry) return notRectangle;
            const opening: SurfaceOpening = { ...geometry, kind };
            this.surfaces.update((list) =>
                list
                    .filter((s) => s.id !== id)
                    .map((s) =>
                        s.id === host.id
                            ? {
                                  ...s,
                                  holes: s.holes.filter((_, j) => j !== index),
                                  openings: [...s.openings, opening],
                              }
                            : s
                    )
            );
            if (this.selectedId() === id) this.selectedId.set(host.id);
            return { ok: true, violations: [], surfaceIds: [host.id] };
        }

        const ownFrame = surfaceFrame(piece.boundaryMm);
        if (!ownFrame || !openingFromRing3(ownFrame, piece.boundaryMm, 'probe')) {
            return notRectangle;
        }
        const plane = planeOfPolygon(piece.boundaryMm);
        const host = this.surfaces()
            .filter(
                (s) =>
                    s.id !== id &&
                    plane !== null &&
                    s.boundaryMm.every(
                        (p) => Math.abs(distanceToPlane(p, plane)) <= PLANARITY_TOLERANCE_MM
                    ) &&
                    mergeRings(s.boundaryMm, piece.boundaryMm) !== null
            )
            .sort((a, b) => polygonArea3(b.boundaryMm) - polygonArea3(a.boundaryMm))[0];
        if (!host) {
            return rejected([
                {
                    code: 'outside-face',
                    message: `${id} is not inside or against a face to be a ${kind} in.`,
                    index: 0,
                },
            ]);
        }
        const merged = this.mergeFaces(host.id, id);
        if (!merged.ok) return merged;
        const added = this.addOpening(host.id, piece.boundaryMm, kind);
        return added.ok ? { ok: true, violations: [], surfaceIds: [host.id] } : added;
    }

    /**
     * Erases an edge. Between two coplanar faces that is the line between them, and they heal
     * into one; anywhere else a face cannot survive losing a side, so every face along it goes,
     * leaving its other edges behind as `removeFace` does.
     */
    removeEdge(aMm: Point3Mm, bMm: Point3Mm): EditResult {
        const faces = this.facesOnEdge(aMm, bMm);
        if (faces.length === 2) {
            const merged = this.mergeFaces(faces[0]!.id, faces[1]!.id);
            if (merged.ok) return merged;
        }
        for (const f of faces) this.removeFace(f.id, { except: [aMm, bMm] });
        return { ok: faces.length > 0, violations: [], surfaceIds: faces.map((f) => f.id) };
    }

    select(id: SurfaceId | null): void {
        this.selectedId.set(id);
        if (id !== null) this.selectedGuideId.set(null);
    }

    /** Selects a line. The face selection goes, for the reason on `selectedGuideId`. */
    selectGuide(id: GuideId | null): void {
        this.selectedGuideId.set(id);
        if (id !== null) this.selectedId.set(null);
    }

    get(id: SurfaceId): Surface | undefined {
        return this.surfaces().find((s) => s.id === id);
    }

    /**
     * Replaces the model with a loaded file's faces, keeping every face that passes the same
     * shape check a drawn one does and naming each one that does not. Lenient on purpose: a
     * file written by hand (or by an LLM reading a drawing) is looked at by loading it, and
     * eleven good faces plus a message about the twelfth is far more useful than nothing.
     */
    load(
        surfaces: readonly Surface[],
        guides: readonly Guide[] = [],
        storeys: readonly Storey[] = []
    ): LoadResult {
        const kept: Surface[] = [];
        const skipped: { id: SurfaceId; message: string }[] = [];
        for (const s of surfaces) {
            const shape = checkShape(s.boundaryMm);
            if (shape) skipped.push({ id: s.id, message: shape.message });
            else kept.push(s);
        }
        const keptGuides = guides.filter((g) => distance3(g.aMm, g.bMm) >= MIN_GUIDE_LENGTH_MM);
        // A file with no storeys of its own (or none at all) still needs one to view and export.
        const keptStoreys = storeys.length > 0 ? sortStoreys(storeys) : [defaultStorey()];
        noteExistingIds(kept, keptGuides, keptStoreys);
        this.surfaces.set(kept);
        this.guides.set(keptGuides);
        this.storeys.set(keptStoreys);
        this.selectedId.set(null);
        this.selectedGuideId.set(null);
        return { loaded: kept.length, skipped };
    }

    clear(): void {
        this.surfaces.set([]);
        this.guides.set([]);
        this.storeys.set([defaultStorey()]);
        this.selectedId.set(null);
        this.selectedGuideId.set(null);
    }

    private patch(id: SurfaceId, patch: Partial<Omit<Surface, 'id'>>): boolean {
        if (!this.get(id) || this.isLocked(id)) return false;
        this.surfaces.update((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
        return true;
    }
}

/** Holes as model-space rings, for snapping and rendering. Empty for a degenerate face. */
export function surfaceOpeningRings(surface: Surface): readonly Point3Mm[][] {
    const frame = surfaceFrame(surface.boundaryMm);
    if (!frame) return [];
    return surface.openings.map((hole) => openingRing3(frame, hole));
}

/** An id for the next opening in `surface`, clear of every one it has. */
function nextOpeningId(surface: Surface): string {
    let n = surface.openings.length + 1;
    while (surface.openings.some((o) => o.id === `${surface.id}h${n}`)) n++;
    return `${surface.id}h${n}`;
}

/**
 * Inner rings must stay on their face's plane through an edit. A move that takes a host's
 * corners somewhere its hole's corners do not follow would tilt the host out from under them.
 */
function checkInnerRings(
    boundaryMm: readonly Point3Mm[],
    holes: readonly { ring: readonly Point3Mm[] }[]
): Violation | null {
    const plane = planeOfPolygon(boundaryMm);
    if (!plane || holes.length === 0) return null;
    const off = holes.some(({ ring }) =>
        ring.some((p) => Math.abs(distanceToPlane(p, plane)) > PLANARITY_TOLERANCE_MM)
    );
    return off
        ? {
              code: 'non-planar',
              message: 'That would pull the face off the plane of the hole drawn in it.',
              index: 0,
          }
        : null;
}

/** Whether `ring` lies inside `outline` (both on one plane), measured in the outline's frame. */
function ringInside(ring: readonly Point3Mm[], outline: readonly Point3Mm[]): boolean {
    const frame = surfaceFrame(outline);
    if (!frame) return false;
    const outlineUv = outline.map((p) => toFrameUv(frame, p));
    return ring.every((p) => pointInOrOnPolygon2(toFrameUv(frame, p), outlineUv));
}

/**
 * The two checks every ring passes before it becomes a face, whichever verb produced it:
 * planar, with the worst offending corner named, and large enough to be a face at all.
 *
 * `planeOfPolygon` returning null means the ring has no well-defined normal — three or more
 * corners that are collinear, or otherwise degenerate — which is reported the same way a
 * genuine planarity miss is, since neither is a plane the recipe engine could frame onto.
 */
function checkShape(ringMm: readonly Point3Mm[]): Violation | null {
    const plane = planeOfPolygon(ringMm);
    if (!plane) {
        return {
            code: 'non-planar',
            message: 'Those corners do not define a plane — they are collinear.',
            index: 0,
        };
    }
    let worstIndex = -1;
    let worstMm = 0;
    ringMm.forEach((p, i) => {
        const errorMm = Math.abs(distanceToPlane(p, plane));
        if (errorMm > worstMm) {
            worstMm = errorMm;
            worstIndex = i;
        }
    });
    if (worstIndex !== -1 && worstMm > PLANARITY_TOLERANCE_MM) {
        return {
            code: 'non-planar',
            message: `Corner ${worstIndex + 1} is ${Math.round(worstMm)} mm off the face’s plane — a face must be flat.`,
            index: worstIndex,
        };
    }
    if (polygonArea3(ringMm) < MIN_SURFACE_AREA_MM2) {
        return {
            code: 'degenerate-edge',
            message: 'That outline encloses almost no area.',
            index: 0,
        };
    }
    return null;
}

/** `hole` re-measured as `moved`, keeping what a ring alone does not carry: kind and swing. */
function withSwing(moved: OpeningGeometry, hole: SurfaceOpening): SurfaceOpening {
    return { ...hole, ...moved };
}
