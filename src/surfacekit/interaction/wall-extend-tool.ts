/**
 * Extend wall, drawn in the 2D plan: put a node on a wall, pull the part of it on one side of
 * the node out by a whole number of modules, click. That is how a rectangular plan becomes an
 * L — and, with a second node, a T or a U.
 *
 *   1. **Click a wall** (or a floor edge, before any walls stand on it): the node goes in.
 *   2. **Move away from the wall.** The part between the node and the wall's end on the side
 *      the cursor is on is the part that moves; the distance is read across the wall and rounded
 *      to the grid. Moving back onto the wall and clicking there places a second node instead,
 *      so the part *between* the two nodes is what moves.
 *   3. **Click** (or type a distance and press Enter) to commit.
 *
 * Only the state lives here — which line, which nodes, what the cursor currently reads as. What
 * the pull *does* to the model is `@surfacekit/model`'s `extendWall`, and turning a cursor into
 * a request is `request` below, so a modeller only wires the two together. Free of three.js and
 * the store, like every other tool.
 */

import type { Vec2Mm } from '../core';
import { snapMm } from '../grid';

/** The straight line a node goes on: a wall's plan footprint, or a floor's edge. */
export interface ExtendLine {
    aMm: Vec2Mm;
    bMm: Vec2Mm;
}

export interface WallExtendToolCallbacks {
    onChange(): void;
}

/** What the cursor currently asks for: the stretch to pull, and how far across it. */
export interface WallExtendPull {
    fromMm: Vec2Mm;
    toMm: Vec2Mm;
    /** Signed, across the line: positive to the left of `aMm`→`bMm`. */
    distanceMm: number;
    offsetMm: Vec2Mm;
}

export class WallExtendTool {
    private line: ExtendLine | null = null;
    private placed: Vec2Mm[] = [];
    private active = false;

    constructor(private readonly callbacks: WallExtendToolCallbacks) {}

    get isActive(): boolean {
        return this.active;
    }

    /** The line the nodes are on, once the first one is placed. */
    get target(): ExtendLine | null {
        return this.line;
    }

    get nodes(): readonly Vec2Mm[] {
        return this.placed;
    }

    start(): void {
        this.active = true;
        this.line = null;
        this.placed = [];
        this.callbacks.onChange();
    }

    cancel(): void {
        this.active = false;
        this.line = null;
        this.placed = [];
        this.callbacks.onChange();
    }

    /** Puts a node on `line` at `pointMm` (projected onto it). The first one picks the line. */
    placeNode(line: ExtendLine, pointMm: Vec2Mm): void {
        if (!this.active || this.placed.length >= 2) return;
        const on = projectOnto(this.line ?? line, pointMm);
        if (this.placed.some((n) => Math.hypot(n.x - on.x, n.y - on.y) < 1)) return;
        if (!this.line) this.line = line;
        this.placed.push(on);
        this.callbacks.onChange();
    }

    /** Right click, Backspace, Ctrl/Cmd+Z: take the last node back. */
    popVertex(): void {
        if (!this.active || this.placed.length === 0) return;
        this.placed.pop();
        if (this.placed.length === 0) this.line = null;
        this.callbacks.onChange();
    }

    /** How far across the line the cursor is, signed, rounded to `pitchMm` (0 = no rounding). */
    distanceAt(cursorMm: Vec2Mm, pitchMm: number): number {
        const line = this.line;
        if (!line) return 0;
        const { across } = axes(line);
        const raw = (cursorMm.x - line.aMm.x) * across.x + (cursorMm.y - line.aMm.y) * across.y;
        return pitchMm > 0 ? snapMm(raw, pitchMm) : Math.round(raw);
    }

    /**
     * The pull the cursor currently describes, with `distanceMm` across the line (the rounded
     * cursor distance, or a typed one). Null before the first node, or for a zero distance.
     */
    pullAt(cursorMm: Vec2Mm, distanceMm: number): WallExtendPull | null {
        const line = this.line;
        const first = this.placed[0];
        if (!line || !first || Math.round(distanceMm) === 0) return null;
        const { along, across, lengthMm } = axes(line);
        const tOf = (p: Vec2Mm): number =>
            (p.x - line.aMm.x) * along.x + (p.y - line.aMm.y) * along.y;
        let from: Vec2Mm;
        let to: Vec2Mm;
        if (this.placed.length >= 2) {
            [from, to] = [first, this.placed[1]!];
        } else {
            // The end of the line on the cursor's side of the node.
            const towardB = tOf(cursorMm) >= tOf(first);
            from = first;
            to = towardB ? line.bMm : line.aMm;
            if (Math.abs(tOf(to) - tOf(from)) < 1) to = towardB ? line.aMm : line.bMm;
        }
        if (tOf(to) < tOf(from)) [from, to] = [to, from];
        if (Math.abs(tOf(to) - tOf(from)) < 1 || lengthMm < 1) return null;
        return {
            fromMm: from,
            toMm: to,
            distanceMm,
            offsetMm: { x: across.x * distanceMm, y: across.y * distanceMm },
        };
    }
}

function axes(line: ExtendLine): { along: Vec2Mm; across: Vec2Mm; lengthMm: number } {
    const dx = line.bMm.x - line.aMm.x;
    const dy = line.bMm.y - line.aMm.y;
    const lengthMm = Math.hypot(dx, dy) || 1;
    const along = { x: dx / lengthMm, y: dy / lengthMm };
    return { along, across: { x: -along.y, y: along.x }, lengthMm };
}

/** The nearest point on the line's segment, rounded to whole millimetres. */
function projectOnto(line: ExtendLine, p: Vec2Mm): Vec2Mm {
    const { along, lengthMm } = axes(line);
    const t = Math.max(
        0,
        Math.min(lengthMm, (p.x - line.aMm.x) * along.x + (p.y - line.aMm.y) * along.y)
    );
    return {
        x: Math.round(line.aMm.x + along.x * t),
        y: Math.round(line.aMm.y + along.y * t),
    };
}
