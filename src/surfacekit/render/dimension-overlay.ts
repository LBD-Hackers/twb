/**
 * Editable dimensions drawn over either view — Revit's temporary dimensions.
 *
 * One overlay for the 2D plan and the 3D view alike, because it works in **screen pixels**: the
 * caller hands it a projector (model point → pixel in the host), and it draws the extension
 * lines, the dimension line, the value and the two pins there. A dimension in plan and the same
 * dimension in 3D are then the same drawing, just projected differently, and a label is the same
 * size at every zoom — which is what makes it readable and clickable at every zoom.
 *
 * The value is a real HTML element, so clicking it can turn it into an `<input>`: type a number,
 * Enter applies it, Escape drops it, Tab applies it and moves on to the next one. The input
 * swallows its own keystrokes, since the app's window-level shortcuts would otherwise read a
 * typed "1200" as a Measurements box value and an "m" as the Move tool.
 *
 * Each end carries a pin. The filled one is the end that stays; clicking the hollow one moves
 * the pin there. An end that can never move (the base of a wall, for a sill) is drawn locked.
 * What a pin *means* for the model is the caller's (`@surfacekit/model`'s `dimensions.ts`): this
 * only draws the choice and reports it.
 */

import type { Point3Mm } from '../core';
import { svgEl } from './svg-dom';

export interface OverlayDimension {
    id: string;
    fromMm: Point3Mm;
    toMm: Point3Mm;
    /** Which way, in model space, the dimension line stands off the measured points. */
    sideMm: Point3Mm;
    valueMm: number;
    /** The end that currently stays. */
    pinned: 0 | 1;
    /** An end that can never move, so the pin can never leave it. */
    lockedEnd: 0 | 1 | null;
}

export interface DimensionOverlayCallbacks {
    /** The user moved the pin to `end`. */
    onPin(id: string, end: 0 | 1): void;
    /** A typed value, to apply. Return false to keep the input open (and marked invalid). */
    onCommit(id: string, text: string): boolean;
    /** The value being typed, for a preview; null when editing stops. */
    onPreview(id: string, text: string | null): void;
}

/** Model point → pixel relative to the host's top-left, or null when it is off-camera. */
export type Projector = (pointMm: Point3Mm) => { x: number; y: number } | null;

/** How far the dimension line stands off the measured points, px. */
const OFFSET_PX = 26;
/** Shorter than this on screen and a dimension is not worth drawing, px. */
const MIN_LENGTH_PX = 14;
const TICK_PX = 5;
const PIN_R_PX = 5;

interface Placed {
    dim: OverlayDimension;
    label: HTMLElement;
}

export class DimensionOverlay {
    private readonly root: HTMLDivElement;
    private readonly svg: SVGSVGElement;
    private projector: Projector | null = null;
    private dims: readonly OverlayDimension[] = [];
    private readonly labels = new Map<string, HTMLElement>();
    private editingId: string | null = null;

    constructor(
        host: HTMLElement,
        private readonly callbacks: DimensionOverlayCallbacks
    ) {
        this.root = document.createElement('div');
        this.root.className = 'dim-overlay';
        this.svg = svgEl('svg', { class: 'dim-lines' });
        this.root.append(this.svg);
        host.append(this.root);
    }

    /** Whether a value is being typed — the caller keeps its selection steady while it is. */
    get isEditing(): boolean {
        return this.editingId !== null;
    }

    setProjector(projector: Projector | null): void {
        this.projector = projector;
        this.redraw();
    }

    setDimensions(dims: readonly OverlayDimension[]): void {
        this.dims = dims;
        if (this.editingId && !dims.some((d) => d.id === this.editingId)) this.stopEditing();
        this.redraw();
    }

    /** Opens the value of dimension `id` for typing, as a click on it would. */
    edit(id: string): void {
        const label = this.labels.get(id);
        const dim = this.dims.find((d) => d.id === id);
        if (label && dim) this.startEditing(dim, label);
    }

    /** Re-places everything — call when the view pans, zooms or orbits. */
    redraw(): void {
        this.svg.replaceChildren();
        const project = this.projector;
        const placed: Placed[] = [];
        for (const dim of project ? this.dims : []) {
            const drawn = this.draw(dim, project!);
            if (drawn) placed.push({ dim, label: drawn });
        }
        const keep = new Set(placed.map((p) => p.label));
        for (const [id, label] of this.labels) {
            if (keep.has(label)) continue;
            if (id === this.editingId) this.stopEditing();
            label.remove();
            this.labels.delete(id);
        }
    }

    destroy(): void {
        this.root.remove();
    }

    private draw(dim: OverlayDimension, project: Projector): HTMLElement | null {
        const a = project(dim.fromMm);
        const b = project(dim.toMm);
        if (!a || !b) return null;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < MIN_LENGTH_PX) return null;
        const u = { x: dx / len, y: dy / len };
        // Stand off to whichever side of the screen line the model's side direction falls.
        let n = { x: -u.y, y: u.x };
        const side = project({
            x: dim.fromMm.x + dim.sideMm.x * 100,
            y: dim.fromMm.y + dim.sideMm.y * 100,
            z: dim.fromMm.z + dim.sideMm.z * 100,
        });
        if (side && (side.x - a.x) * n.x + (side.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };

        const off = (p: { x: number; y: number }, k: number) => ({
            x: p.x + n.x * k,
            y: p.y + n.y * k,
        });
        const a1 = off(a, OFFSET_PX);
        const b1 = off(b, OFFSET_PX);
        const g = svgEl('g', { class: 'dim' });
        const line = (p: { x: number; y: number }, q: { x: number; y: number }, cls: string) =>
            g.append(
                svgEl('line', {
                    x1: `${p.x}`,
                    y1: `${p.y}`,
                    x2: `${q.x}`,
                    y2: `${q.y}`,
                    class: cls,
                })
            );
        line(off(a, 4), off(a, OFFSET_PX + 6), 'dim-ext');
        line(off(b, 4), off(b, OFFSET_PX + 6), 'dim-ext');
        line(a1, b1, 'dim-line');
        // Architectural ticks: short 45° slashes across each end.
        const t = { x: (u.x + n.x) * TICK_PX * 0.7, y: (u.y + n.y) * TICK_PX * 0.7 };
        for (const p of [a1, b1]) {
            line({ x: p.x - t.x, y: p.y - t.y }, { x: p.x + t.x, y: p.y + t.y }, 'dim-tick');
        }
        for (const end of [0, 1] as const) {
            g.append(this.pin(dim, end, off(end === 0 ? a : b, OFFSET_PX + 6 + PIN_R_PX + 3)));
        }
        this.svg.append(g);

        const label = this.labelFor(dim);
        const mid = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
        label.style.left = `${mid.x}px`;
        label.style.top = `${mid.y}px`;
        return label;
    }

    private pin(dim: OverlayDimension, end: 0 | 1, at: { x: number; y: number }): SVGElement {
        const pinned = dim.pinned === end;
        const locked = dim.lockedEnd === end;
        const cls = locked ? 'dim-pin is-locked' : pinned ? 'dim-pin is-pinned' : 'dim-pin';
        const pin = svgEl('circle', {
            cx: `${at.x}`,
            cy: `${at.y}`,
            r: `${PIN_R_PX}`,
            class: cls,
        });
        const title = svgEl('title');
        title.textContent = locked
            ? 'This end never moves'
            : pinned
              ? 'Pinned — this end stays'
              : 'Pin this end instead';
        pin.append(title);
        if (!pinned && !locked && dim.lockedEnd === null) {
            pin.addEventListener('pointerdown', (event) => {
                event.stopPropagation();
                event.preventDefault();
                this.callbacks.onPin(dim.id, end);
            });
        }
        return pin;
    }

    private labelFor(dim: OverlayDimension): HTMLElement {
        let label = this.labels.get(dim.id);
        if (!label) {
            label = document.createElement('div');
            label.className = 'dim-label';
            label.addEventListener('pointerdown', (event) => {
                event.stopPropagation();
                if (this.editingId === dim.id) return;
                event.preventDefault();
                const current = this.dims.find((d) => d.id === dim.id);
                if (current) this.startEditing(current, label!);
            });
            this.root.append(label);
            this.labels.set(dim.id, label);
        }
        if (this.editingId !== dim.id) label.textContent = `${Math.round(dim.valueMm)}`;
        return label;
    }

    private startEditing(dim: OverlayDimension, label: HTMLElement): void {
        if (this.editingId) this.stopEditing();
        this.editingId = dim.id;
        const input = document.createElement('input');
        input.className = 'dim-input';
        input.type = 'text';
        input.inputMode = 'decimal';
        input.value = `${Math.round(dim.valueMm)}`;
        input.size = Math.max(4, input.value.length + 1);
        label.classList.add('is-editing');
        label.replaceChildren(input);
        input.focus();
        input.select();

        input.addEventListener('input', () => {
            input.classList.remove('is-invalid');
            input.size = Math.max(4, input.value.length + 1);
            this.callbacks.onPreview(dim.id, input.value);
        });
        input.addEventListener('keydown', (event) => {
            // Every key is the input's: the app's shortcuts must not see a typed value.
            event.stopPropagation();
            if (event.key === 'Escape') {
                event.preventDefault();
                this.stopEditing();
            } else if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                const next = event.key === 'Tab' ? this.neighbour(dim.id, event.shiftKey) : null;
                const changed = input.value.trim() !== `${Math.round(dim.valueMm)}`;
                if (changed && !this.callbacks.onCommit(dim.id, input.value)) {
                    input.classList.add('is-invalid');
                    return;
                }
                this.stopEditing();
                if (next) this.edit(next);
            }
        });
        input.addEventListener('blur', () => {
            if (this.editingId === dim.id) this.stopEditing();
        });
    }

    private stopEditing(): void {
        const id = this.editingId;
        if (!id) return;
        this.editingId = null;
        const label = this.labels.get(id);
        const dim = this.dims.find((d) => d.id === id);
        if (label) {
            label.classList.remove('is-editing');
            label.textContent = dim ? `${Math.round(dim.valueMm)}` : '';
        }
        this.callbacks.onPreview(id, null);
    }

    private neighbour(id: string, back: boolean): string | null {
        const shown = this.dims.filter((d) => this.labels.has(d.id));
        const i = shown.findIndex((d) => d.id === id);
        if (i < 0 || shown.length < 2) return null;
        return shown[(i + (back ? shown.length - 1 : 1)) % shown.length]!.id;
    }
}
