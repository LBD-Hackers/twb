/**
 * Interior walls, drawn in the 2D plan view of one storey: click to click, along a single
 * horizontal plane, Enter builds the run.
 *
 * Deliberately simpler than the Line tool it otherwise resembles. There is no loop to close and
 * no split to attempt — an interior wall is an open run, not a face boundary — so every click
 * just extends a polyline, and it is the caller's job (a modeller's `commitInteriorWall`) to turn
 * each finished segment into real wall faces on the storey, up to the floor above or the roof.
 * That is also why commit happens on an explicit `finish()` rather than on every click the way a
 * rectangle or a loop closes on its last one: nothing downstream should build a partial run out
 * of a corner the user has not decided is the last one yet.
 *
 * Free of three.js and of the store, like every other tool here: points in, a polyline out.
 */

import { distance3, type Point3Mm } from '../core';

export interface InteriorWallToolCallbacks {
    /** Return false to reject — the run is kept and the tool stays armed. */
    onCommit(pointsMm: readonly Point3Mm[]): boolean;
    onChange(): void;
}

export class InteriorWallTool {
    private points: Point3Mm[] = [];
    private active = false;

    constructor(private readonly callbacks: InteriorWallToolCallbacks) {}

    get isActive(): boolean {
        return this.active;
    }

    get vertices(): readonly Point3Mm[] {
        return this.points;
    }

    start(): void {
        this.active = true;
        this.points = [];
        this.callbacks.onChange();
    }

    cancel(): void {
        this.active = false;
        this.points = [];
        this.callbacks.onChange();
    }

    /** Places a vertex. Ignores a click on the one just placed, as the other tools do. */
    click(pointMm: Point3Mm): void {
        if (!this.active) return;
        const last = this.points[this.points.length - 1];
        if (last && distance3(last, pointMm) < 1) return;
        this.points.push(pointMm);
        this.callbacks.onChange();
    }

    /** Right click, Backspace, Ctrl/Cmd+Z: undo the last vertex. */
    popVertex(): void {
        if (!this.active || this.points.length === 0) return;
        this.points.pop();
        this.callbacks.onChange();
    }

    lastVertex(): Point3Mm | null {
        return this.points[this.points.length - 1] ?? null;
    }

    /** Enter: build the run so far, if there is at least one segment to build. */
    finish(): void {
        if (!this.active || this.points.length < 2) return;
        if (this.callbacks.onCommit(this.points)) this.points = [];
        this.callbacks.onChange();
    }
}
