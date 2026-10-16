/**
 * Push/pull: click a face, move along its normal, click again.
 *
 * The distance is read off a line inference — the ray's nearest approach to the line through
 * the click point along the face's normal, exactly as the vertical inference reads a height —
 * because a face's normal is, like the vertical, an axis no working plane can offer: the
 * plane the cursor would need to land on is perpendicular to the one just clicked. The tool
 * holds the face and the anchor; the caller turns the cursor into a distance and hands it
 * back here so the preview and the commit read the same number.
 *
 * Free of three.js and of the store: a face id, a point and a normal in, a distance out.
 */

import { add3, scale3, type Dir3, type Point3Mm } from '../core';
import type { SurfaceId } from '../model';

/** Below this the pull is a click on the face, not a pull, mm. */
export const MIN_PULL_MM = 50;

export interface PushPullTarget {
    surfaceId: SurfaceId;
    /** Where on the face the first click landed — the point the inference line runs through. */
    anchorMm: Point3Mm;
    normal: Dir3;
}

export interface PushPullToolCallbacks {
    /** Return false to reject — the face stays armed. */
    onCommit(target: PushPullTarget, distanceMm: number): boolean;
    onChange(): void;
}

export class PushPullTool {
    private target: PushPullTarget | null = null;
    private active = false;

    constructor(private readonly callbacks: PushPullToolCallbacks) {}

    get isActive(): boolean {
        return this.active;
    }

    /** The face being pulled, or null while the next click is still choosing one. */
    get armed(): PushPullTarget | null {
        return this.target;
    }

    start(): void {
        this.active = true;
        this.target = null;
        this.callbacks.onChange();
    }

    cancel(): void {
        this.active = false;
        this.target = null;
        this.callbacks.onChange();
    }

    /** First click arms a face. */
    pick(target: PushPullTarget): void {
        if (!this.active) return;
        this.target = target;
        this.callbacks.onChange();
    }

    /** Second click commits the distance the caller read off the cursor. */
    commit(distanceMm: number): void {
        if (!this.active || !this.target) return;
        if (Math.abs(distanceMm) < MIN_PULL_MM) return;
        if (this.callbacks.onCommit(this.target, distanceMm)) this.target = null;
        this.callbacks.onChange();
    }

    /** Right click, Backspace, Ctrl/Cmd+Z: let go of the face. */
    popVertex(): void {
        if (!this.active) return;
        this.target = null;
        this.callbacks.onChange();
    }

    /** Where the pulled face's anchor would sit at `distanceMm`, for the rubber band. */
    pulledAnchor(distanceMm: number): Point3Mm | null {
        if (!this.target) return null;
        return add3(this.target.anchorMm, scale3(this.target.normal, distanceMm));
    }
}
