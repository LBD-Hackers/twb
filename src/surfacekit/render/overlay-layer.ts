/**
 * The drawing overlay: the ring being drawn, the rubber-band to the cursor, the snap marker,
 * the inference guides, and the hover highlight on whatever the active tool would act on.
 *
 * Rebuilt wholesale on every pointer move, which sounds wasteful and is not: the overlay is a
 * handful of vertices, and the alternative — mutating buffer attributes in place — costs more
 * in bookkeeping than it saves. `mep`'s layer modules take the same `replaceChildren()`
 * approach for the same reason. The scene's *heavy* content (surfaces, thousands of timber
 * members) lives in other layers that are rebuilt only when the model actually changes.
 */

import * as THREE from 'three';
import type { Point3Mm } from '../core';
import type { SnapKind, LockAxis } from '../interaction';
import { modelToThree } from './frame';
import { THEME } from './theme';

/**
 * Marker size as a fraction of viewport height, NOT a world size.
 *
 * A snap marker is a cursor decoration, so it must stay the same size on screen at every zoom
 * — a world-sized marker is a fat blob when zoomed into one stud and an invisible speck when
 * framing the whole house, which is exactly the range this tool works across. Achieved with
 * `sizeAttenuation: false`, where sprite scale is measured in normalized screen units.
 */
const SNAP_MARKER_SIZE = 0.016;
const VERTEX_MARKER_SIZE = 0.012;

export interface DraftState {
    /** Vertices committed so far, in model coordinates. */
    ringMm: readonly Point3Mm[];
    /** The snapped cursor position, or null when the pointer is off the working plane. */
    cursorMm: Point3Mm | null;
    cursorSnap: SnapKind | null;
    /** True when clicking would close the ring — draws the closing hint. */
    wouldClose: boolean;
    /**
     * Closed outlines previewing what a click would create — the rectangle tool's rectangle,
     * push/pull's box, the faces a move would reshape.
     *
     * Separate from `ringMm` because they are not a ring under construction: the user is not
     * placing their corners, the tool is deriving them, and drawing them as closed loops rather
     * than an open polyline is what says so.
     */
    previewRingsMm?: readonly (readonly Point3Mm[])[] | null;
    /** The world axis an engaged lock caught, which colours the rubber band. */
    lockAxis?: LockAxis | null;
    /**
     * An inference guide to aim along, drawn dashed in the axis's colour.
     *
     * Drawn whenever the inference is *available*, not only once it has caught. An invisible
     * magnet is indistinguishable from a broken one: the world vertical does not project to a
     * vertical line on screen, so without the guide the user has no way to know which way to
     * move the mouse and concludes the tool cannot draw upward at all.
     */
    guideMm?: { from: Point3Mm; to: Point3Mm; axis: LockAxis } | null;
    /**
     * The from-point inference: the point the user paused on, drawn as a hollow marker while
     * it is armed, and the dashed line from it to the cursor while the cursor rides one of its
     * lines. The line is what makes the magnet legible — Miro's dashed guide: it appears as the
     * mouse moves off the point and shows exactly which alignment has caught.
     */
    fromPointMm?: Point3Mm | null;
    fromLineMm?: { from: Point3Mm; to: Point3Mm } | null;
    /** The face the active tool would act on if clicked — outlined in the hover colour. */
    hoverRingMm?: readonly Point3Mm[] | null;
    /** The edge (two points) or vertex (one) the move tool would pick up, or is holding. */
    hoverPointsMm?: readonly Point3Mm[] | null;
    /**
     * Where the rubber band starts, when it is not the last placed vertex — push/pull's
     * anchor on the face, the move tool's grip on the edge.
     */
    bandFromMm?: Point3Mm | null;
}

/**
 * Fills `target` with the current draft. The caller disposes the previous contents
 * (`Viewport.clearLayer('overlay')`) before calling.
 */
export function renderDraft(target: THREE.Group, draft: DraftState): void {
    const { ringMm, cursorMm } = draft;

    if (draft.guideMm) {
        target.add(
            dashedGuide([draft.guideMm.from, draft.guideMm.to], THEME.lock[draft.guideMm.axis])
        );
    }
    if (draft.fromLineMm) {
        target.add(dashedGuide([draft.fromLineMm.from, draft.fromLineMm.to], THEME.snap.fromPoint));
    }
    if (draft.fromPointMm) {
        target.add(marker(draft.fromPointMm, SNAP_MARKER_SIZE, THEME.snap.fromPoint, 'ring'));
    }

    if (draft.hoverRingMm && draft.hoverRingMm.length > 2) {
        target.add(polyline(draft.hoverRingMm, THEME.surface.hover, true));
    }
    if (draft.hoverPointsMm) {
        if (draft.hoverPointsMm.length === 2) {
            target.add(polyline(draft.hoverPointsMm, THEME.surface.hover, false));
        }
        for (const p of draft.hoverPointsMm) {
            target.add(marker(p, VERTEX_MARKER_SIZE, THEME.surface.hover));
        }
    }

    if (ringMm.length > 1) {
        target.add(polyline(ringMm, THEME.draft.line, false));
    }
    for (const p of ringMm) {
        target.add(marker(p, VERTEX_MARKER_SIZE, THEME.draft.vertex));
    }

    // The rubber band is its own line rather than the tail of the ring polyline, because it is
    // the one segment that carries the lock colour — the user needs to see which inference
    // caught *before* clicking, and the committed edges behind it must not change colour too.
    //
    // Suppressed once a preview outline is showing and no lock is engaged: the preview already
    // says exactly what a click would make, and a second line cutting across it to the cursor
    // is noise. With a lock engaged the band is the guide itself, so it stays.
    const from = draft.bandFromMm ?? ringMm[ringMm.length - 1];
    const previews = draft.previewRingsMm ?? [];
    if (from && cursorMm && (draft.lockAxis || previews.length === 0)) {
        const color = draft.lockAxis ? THEME.lock[draft.lockAxis] : THEME.draft.line;
        target.add(polyline([from, cursorMm], color, false));
    }

    for (const ring of previews) {
        if (ring.length < 3) continue;
        target.add(polyline(ring, THEME.draft.line, true));
    }

    if (cursorMm) {
        const kind = draft.cursorSnap ?? 'module-grid';
        const color = draft.wouldClose
            ? THEME.draft.closing
            : draft.lockAxis
              ? THEME.lock[draft.lockAxis]
              : snapColor(kind);
        target.add(marker(cursorMm, SNAP_MARKER_SIZE, color, markerShape(kind)));
    }
}

/**
 * A dashed inference guide. Dashed rather than solid so it never reads as drawn geometry —
 * it is a hint about where the cursor can go, not an edge of the model.
 */
function dashedGuide(pointsMm: readonly Point3Mm[], color: number): THREE.Object3D {
    const geometry = new THREE.BufferGeometry().setFromPoints(pointsMm.map(modelToThree));
    const line = new THREE.Line(
        geometry,
        new THREE.LineDashedMaterial({
            color,
            dashSize: 0.12,
            gapSize: 0.1,
            depthTest: false,
            transparent: true,
            opacity: 0.8,
        })
    );
    // Dash spacing comes from a per-vertex attribute, not from the material alone.
    line.computeLineDistances();
    line.renderOrder = 997;
    return line;
}

/**
 * An overlay line through model points, open or closed. Always drawn over the scene.
 *
 * `transparent: true` on an opaque colour is not a mistake. three.js renders opaque materials
 * first and transparent ones after, and the surfaces are translucent — so an opaque overlay
 * line, `depthTest: false` or not, gets painted *over* by every face in front of it and comes
 * out as a 55%-dimmed smear a shade off the grid. Flagging the line transparent moves it into
 * the late pass, where `renderOrder` finally means what it says. The sprites never had the
 * problem because `SpriteMaterial` is transparent by default.
 */
function polyline(pointsMm: readonly Point3Mm[], color: number, closed: boolean): THREE.Object3D {
    const geometry = new THREE.BufferGeometry().setFromPoints(pointsMm.map(modelToThree));
    const material = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
    const object = closed
        ? new THREE.LineLoop(geometry, material)
        : new THREE.Line(geometry, material);
    object.renderOrder = 998;
    return object;
}

/**
 * The marker shapes, following the AutoCAD convention `theme.ts` names: square for a vertex,
 * triangle for a midpoint, X for an intersection, a hollow ring for a point an inference hangs
 * from. The shape is what makes a midpoint snap *read* as one at a glance — the colours are
 * the same green, on purpose, since all three are "a real point of the model".
 */
type MarkerShape = 'square' | 'triangle' | 'cross' | 'ring';

function markerShape(kind: SnapKind): MarkerShape {
    switch (kind) {
        case 'midpoint':
            return 'triangle';
        case 'intersection':
            return 'cross';
        default:
            return 'square';
    }
}

/**
 * Sprite textures for the non-square shapes, drawn once on a small canvas and cached. White
 * on transparent, so the material's `color` tints them like it tints the plain square.
 */
const markerTextures = new Map<MarkerShape, THREE.Texture>();
function markerTexture(shape: MarkerShape): THREE.Texture | null {
    if (shape === 'square') return null;
    const cached = markerTextures.get(shape);
    if (cached) return cached;
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    if (shape === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(size / 2, 1);
        ctx.lineTo(size - 1, size - 2);
        ctx.lineTo(1, size - 2);
        ctx.closePath();
        ctx.fill();
    } else if (shape === 'cross') {
        ctx.beginPath();
        ctx.moveTo(4, 4);
        ctx.lineTo(size - 4, size - 4);
        ctx.moveTo(size - 4, 4);
        ctx.lineTo(4, size - 4);
        ctx.stroke();
    } else {
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
        ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    markerTextures.set(shape, texture);
    return texture;
}

/**
 * A small camera-facing shape at a model point.
 *
 * `Sprite` rather than a mesh so it always faces the camera and never disappears edge-on
 * during an orbit — a snap marker that vanishes at certain angles is worse than none.
 * `depthTest: false` keeps it visible through geometry it sits behind, which is what makes
 * snapping to a far corner of a drawn floor possible.
 */
function marker(
    pMm: Point3Mm,
    size: number,
    color: number,
    shape: MarkerShape = 'square'
): THREE.Sprite {
    const map = markerTexture(shape);
    const material = new THREE.SpriteMaterial({
        color,
        depthTest: false,
        sizeAttenuation: false,
        ...(map ? { map } : {}),
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(modelToThree(pMm));
    sprite.scale.set(size, size, 1);
    // Overlay markers must paint last, over everything.
    sprite.renderOrder = 999;
    return sprite;
}

function snapColor(kind: SnapKind): number {
    switch (kind) {
        case 'vertex':
            return THEME.snap.vertex;
        case 'midpoint':
            return THEME.snap.midpoint;
        case 'intersection':
            return THEME.snap.intersection;
        case 'edge':
            return THEME.snap.edge;
        case 'axis':
            return THEME.snap.axis;
        case 'from-point':
            return THEME.snap.fromPoint;
        case 'free':
            return THEME.snap.free;
        default:
            return THEME.snap.grid;
    }
}

/**
 * Human-readable snap kind for the status bar.
 *
 * An engaged lock is named by its world axis rather than reported as a bare "Axis lock",
 * because "Vertical" is the word the user is thinking in and "the lock is on" is not the
 * question they have — *which* lock is.
 */
export function snapLabel(kind: SnapKind, lockAxis: LockAxis | null = null): string {
    if (kind === 'axis') {
        switch (lockAxis) {
            case 'z':
                return 'Vertical lock';
            case 'x':
                return 'Axis lock · X';
            case 'y':
                return 'Axis lock · Y';
            case 'diagonal':
                return 'Axis lock · 45°';
            default:
                return 'Axis lock';
        }
    }
    // Crossed with a lock, the from-point names both: that crossing is the one place a click
    // is pinned by two constraints at once, and the read-out should say so.
    if (kind === 'from-point') {
        return lockAxis ? `From point × ${snapLabel('axis', lockAxis)}` : 'From point';
    }
    switch (kind) {
        case 'vertex':
            return 'Vertex';
        case 'midpoint':
            return 'Midpoint';
        case 'intersection':
            return 'Intersection';
        case 'edge':
            return 'On edge';
        case 'sub-grid':
            return 'Sub-grid';
        case 'module-grid':
            return 'Module grid';
        case 'free':
            return 'Free';
    }
}
