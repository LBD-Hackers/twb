/**
 * The click-to-place polygon drawing state machine behind the Line tool.
 *
 * Follows `mep/src/interaction/tool-manager.ts`'s interaction grammar, which is worth matching
 * exactly because users already know it from every CAD tool: each left click places a vertex,
 * right click pops the last one, Escape cancels, and clicking back on the first vertex closes
 * the ring and commits. There is no "Finish" button — the ring closing *is* the commit — and a
 * rejected commit leaves the tool armed rather than discarding the work, so the user can nudge
 * a corner and click again.
 *
 * Deliberately free of three.js and of the store: it takes snapped model points in and calls
 * back with a finished ring. That keeps the whole grammar testable by feeding it points, with
 * no renderer and no WebGL context.
 */

import { distance3, type Point3Mm } from '../core';

/** How near the first vertex a click must land to close the ring, in mm at model scale. */
export const CLOSE_TOLERANCE_MM = 300;

export interface PolygonToolCallbacks {
    /** Return false to reject — the ring is kept and the tool stays armed. */
    onCommit(ringMm: readonly Point3Mm[]): boolean;
    onChange(): void;
}

export class PolygonTool {
    private ring: Point3Mm[] = [];
    private active = false;

    constructor(private readonly callbacks: PolygonToolCallbacks) {}

    get isActive(): boolean {
        return this.active;
    }

    get vertices(): readonly Point3Mm[] {
        return this.ring;
    }

    start(): void {
        this.active = true;
        this.ring = [];
        this.callbacks.onChange();
    }

    cancel(): void {
        this.active = false;
        this.ring = [];
        this.callbacks.onChange();
    }

    /**
     * Would a click at this position close the ring?
     *
     * Three vertices minimum: closing on two would commit a degenerate sliver, and the user
     * clicking near the start with only one edge drawn almost certainly means to reposition,
     * not to finish.
     */
    wouldClose(pointMm: Point3Mm): boolean {
        if (!this.active || this.ring.length < 3) return false;
        return distance3(pointMm, this.ring[0]!) <= CLOSE_TOLERANCE_MM;
    }

    /** Places a vertex, or closes and commits when the click lands on the first vertex. */
    click(pointMm: Point3Mm): void {
        if (!this.active) return;

        if (this.wouldClose(pointMm)) {
            const committed = this.callbacks.onCommit(this.ring);
            if (committed) this.ring = [];
            this.callbacks.onChange();
            return;
        }

        // Ignore a click on the vertex just placed — a double click would otherwise leave a
        // zero-length edge that `grid-validate.ts` then has to reject.
        const last = this.ring[this.ring.length - 1];
        if (last && distance3(pointMm, last) < 1) return;

        this.ring.push(pointMm);
        this.callbacks.onChange();
    }

    /** Right click, Backspace, or Ctrl/Cmd+Z: undo the last vertex. */
    popVertex(): void {
        if (!this.active || this.ring.length === 0) return;
        this.ring.pop();
        this.callbacks.onChange();
    }

    /** The vertex a rubber-band should stretch from, if any. */
    lastVertex(): Point3Mm | null {
        return this.ring[this.ring.length - 1] ?? null;
    }
}
