/**
 * SketchUp's rectangle: two clicks, opposite corners, on whatever plane the first click was
 * on.
 *
 * The rectangle is built in the working plane's own UV frame, so on the ground its sides are
 * world X and Y, on a wall they are along-the-wall and up, and on a roof plane they are
 * along-the-eave and up-the-slope. Nothing here knows which of those it is drawing on, which
 * is what makes one tool cover a floor, a window and a dormer cheek.
 *
 * The plane is the caller's to supply, at the second click and for every preview before it,
 * rather than captured here at the first: a first click on an edge two faces share — the base
 * of a wall, which is also the edge of the floor — does not say which face the rectangle is
 * on, and the caller resolves that from where the cursor goes next. What the rectangle
 * *becomes* — a new face, or an opening cut into the face it was drawn on — is the caller's
 * decision too. Free of three.js and of the store, like `PolygonTool`: points in, a ring out.
 */

import type { Point3Mm } from '../core';
import { fromPlaneUv, toPlaneUv, type WorkingPlane } from './working-plane';

/** Shortest side worth drawing, mm. Below this the two corners are effectively one click. */
export const MIN_RECTANGLE_SIDE_MM = 100;

export interface RectangleToolCallbacks {
    /** Return false to reject — the anchor is kept and the tool stays armed. */
    onCommit(ringMm: readonly Point3Mm[]): boolean;
    onChange(): void;
}

export class RectangleTool {
    private anchorMm: Point3Mm | null = null;
    private active = false;

    constructor(private readonly callbacks: RectangleToolCallbacks) {}

    get isActive(): boolean {
        return this.active;
    }

    /** True once the first corner is down and the next click completes the rectangle. */
    get isArmed(): boolean {
        return this.anchorMm !== null;
    }

    /** What has been drawn so far, for the overlay and the snapping ladder. */
    get vertices(): readonly Point3Mm[] {
        return this.anchorMm ? [this.anchorMm] : [];
    }

    lastVertex(): Point3Mm | null {
        return this.anchorMm;
    }

    start(): void {
        this.active = true;
        this.anchorMm = null;
        this.callbacks.onChange();
    }

    cancel(): void {
        this.active = false;
        this.anchorMm = null;
        this.callbacks.onChange();
    }

    /** First click anchors a corner; the second completes the rectangle in `plane`. */
    click(pointMm: Point3Mm, plane: WorkingPlane): void {
        if (!this.active) return;
        if (!this.anchorMm) {
            this.anchorMm = pointMm;
            this.callbacks.onChange();
            return;
        }
        const ring = this.previewRing(pointMm, plane);
        if (!ring) return;
        if (this.callbacks.onCommit(ring)) this.anchorMm = null;
        this.callbacks.onChange();
    }

    /** Right click, Backspace, Ctrl/Cmd+Z: drop the anchor. */
    popVertex(): void {
        if (!this.active) return;
        this.anchorMm = null;
        this.callbacks.onChange();
    }

    /**
     * Where the second click would land for a typed `width,depth` — each measured from the
     * anchor along the plane's u and v, on the cursor's side of it. A null dimension keeps the
     * cursor's own. Null while nothing is anchored.
     */
    typedCorner(
        cursorMm: Point3Mm,
        plane: WorkingPlane,
        widthMm: number | null,
        depthMm: number | null
    ): Point3Mm | null {
        if (!this.anchorMm) return null;
        const a = toPlaneUv(plane, this.anchorMm);
        const b = toPlaneUv(plane, cursorMm);
        const side = (d: number): number => (d < 0 ? -1 : 1);
        const p = fromPlaneUv(plane, {
            x: widthMm === null ? b.x : a.x + side(b.x - a.x) * Math.abs(widthMm),
            y: depthMm === null ? b.y : a.y + side(b.y - a.y) * Math.abs(depthMm),
        });
        return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
    }

    /**
     * The rectangle a click at `cursorMm` would make in `plane`, or null while it would be too
     * thin. Ordered so the ring is a loop rather than a bow-tie whichever quadrant the cursor
     * is in.
     */
    previewRing(cursorMm: Point3Mm, plane: WorkingPlane): readonly Point3Mm[] | null {
        if (!this.anchorMm) return null;
        const a = toPlaneUv(plane, this.anchorMm);
        const b = toPlaneUv(plane, cursorMm);
        if (
            Math.abs(b.x - a.x) < MIN_RECTANGLE_SIDE_MM ||
            Math.abs(b.y - a.y) < MIN_RECTANGLE_SIDE_MM
        ) {
            return null;
        }
        return [
            { x: a.x, y: a.y },
            { x: b.x, y: a.y },
            { x: b.x, y: b.y },
            { x: a.x, y: b.y },
        ].map((uv) => {
            const p = fromPlaneUv(plane, uv);
            return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
        });
    }
}
