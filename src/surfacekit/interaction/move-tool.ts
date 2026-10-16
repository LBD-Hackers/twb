/**
 * Move: click an edge or a vertex, move it up or down, click again.
 *
 * Vertical only, on purpose. The one thing this tool exists for is the gable workflow — split
 * a box's top face along the ridge, then lift the ridge — and in plan the grid already says
 * where every edge goes. A move in plan would either fight the grid or be the rectangle tool
 * with extra steps. The height is read off the same vertical line inference the drawing tools
 * use, so a lifted ridge lands on the sub-module by default and anywhere at all with the grid
 * off.
 *
 * What moves is *every* face sharing the picked positions — that is the store's business
 * (`moveVertices`), and the reason lifting a ridge tilts both roof halves and raises both
 * gables in one gesture. This tool only holds the pick and the rise.
 *
 * The rise has a second spelling: a **pitch**. Type `35g` instead of a distance and the commit
 * goes through `commitPitch` instead, which hands the angle to the caller to turn into the
 * corresponding heights (`model/pitch.ts`). It is the same gesture with the same pick — only
 * the number the user chose to say it with differs — so it lives here rather than in a tool of
 * its own.
 */

import type { Point3Mm } from '../core';
import type { Pick } from './pick';

/** Below this the second click is a click on the edge, not a move, mm. */
export const MIN_MOVE_MM = 50;

export interface MoveToolCallbacks {
    /** Return false to reject — the pick stays armed. */
    onCommit(pick: Pick, riseMm: number): boolean;
    /**
     * A typed pitch instead of a rise. Return false to reject — including when the picked edge
     * has no plane to swing from, which only the caller can know.
     */
    onCommitPitch(pick: Pick, pitchDeg: number): boolean;
    onChange(): void;
}

export class MoveTool {
    private picked: Pick | null = null;
    private active = false;

    constructor(private readonly callbacks: MoveToolCallbacks) {}

    get isActive(): boolean {
        return this.active;
    }

    /** The edge or vertex being moved, or null while the next click is still choosing one. */
    get armed(): Pick | null {
        return this.picked;
    }

    start(): void {
        this.active = true;
        this.picked = null;
        this.callbacks.onChange();
    }

    cancel(): void {
        this.active = false;
        this.picked = null;
        this.callbacks.onChange();
    }

    pick(pick: Pick): void {
        if (!this.active) return;
        this.picked = pick;
        this.callbacks.onChange();
    }

    commit(riseMm: number): void {
        if (!this.active || !this.picked) return;
        if (Math.abs(riseMm) < MIN_MOVE_MM) return;
        if (this.callbacks.onCommit(this.picked, riseMm)) this.picked = null;
        this.callbacks.onChange();
    }

    /**
     * Commit a typed pitch. Unlike `commit` there is no minimum: the smallest angle worth
     * setting is the caller's question, since what it is worth depends on the run it is applied
     * over, which this tool never sees.
     */
    commitPitch(pitchDeg: number): void {
        if (!this.active || !this.picked) return;
        if (this.callbacks.onCommitPitch(this.picked, pitchDeg)) this.picked = null;
        this.callbacks.onChange();
    }

    /** Right click, Backspace, Ctrl/Cmd+Z: let go. */
    popVertex(): void {
        if (!this.active) return;
        this.picked = null;
        this.callbacks.onChange();
    }

    /** The picked geometry lifted by `riseMm`, for the rubber band. */
    lifted(riseMm: number): readonly Point3Mm[] {
        const p = this.picked;
        if (!p) return [];
        const lift = (q: Point3Mm): Point3Mm => ({ ...q, z: q.z + riseMm });
        return p.kind === 'vertex' ? [lift(p.pointMm)] : [lift(p.aMm), lift(p.bMm)];
    }
}
