/**
 * The 2D plan view: an actual SVG drawing of one storey, not a 3D camera pretending to be one.
 *
 * A modeller's earlier attempt reused the 3D `Viewport` — locking `OrbitControls` to look
 * straight down and clipping the scene to the storey's ceiling — and it cost two real three.js
 * gotchas to get pixels on screen at all, for a view
 * that is fundamentally 2D. This is the SVG plan properly: a `<g>` transformed by pan and zoom
 * state this class owns, drawn straight in model millimetres so nothing here does unit
 * conversion, and a `screenToModel` that is the SVG version of `Viewport.rayFor` — a pointer
 * event in, a model-frame position out, so the same snapping ladder (`interaction/snap3.ts`)
 * that drives the 3D tools drives the Interior Wall tool here too.
 *
 * Content is layered exactly like `Viewport`'s three.js scene (`grid`, `areas`, `foundation`,
 * `zones`, `walls`, `ghost`, `equipment`, `overlay`), for the same reason: a layer module replaces its own
 * contents on the model's own terms without touching what anyone else drew.
 */

import {
    boundsCenter2,
    boundsHeight2,
    boundsWidth2,
    type Bounds2Mm,
    type Vec2Mm,
} from '../core';
import { svgEl } from './svg-dom';

export type PlanLayerName =
    | 'underlay'
    | 'grid'
    | 'areas'
    | 'foundation'
    | 'zones'
    | 'fixtures'
    | 'walls'
    | 'frame'
    | 'ghost'
    | 'equipment'
    | 'overlay';
const LAYER_NAMES: readonly PlanLayerName[] = [
    // A drawing traced over sits under everything, the grid included.
    'underlay',
    'grid',
    'areas',
    // What the house stands on, under the walls it carries.
    'foundation',
    'zones',
    // The fittings in the rooms, over the rooms' fill and under the walls they stand against.
    'fixtures',
    'walls',
    'frame',
    'ghost',
    'equipment',
    'overlay',
];

export interface PlanViewCallbacks {
    onPointerMove(modelMm: Vec2Mm): void;
    onClick(modelMm: Vec2Mm): void;
    onRightClick(): void;
    /**
     * Whether a left press at this point starts a drag rather than a click — asked on the press,
     * so the answer can depend on what is under it. Absent or false: the press stays a click.
     */
    wantsDrag?(modelMm: Vec2Mm): boolean;
    /**
     * A left drag the press was granted: `start` once it clears the click threshold (with the
     * point the press was at), `move` as it goes, `end` on release. A drag never also clicks.
     */
    onDrag?(phase: 'start' | 'move' | 'end', modelMm: Vec2Mm): void;
}

/** Click-vs-drag threshold in CSS pixels, matching `Viewport`'s. */
const CLICK_DRAG_TOLERANCE_PX = 4;

const MIN_SCALE = 1e-4;
const MAX_SCALE = 2;

export class PlanView {
    readonly svg: SVGSVGElement;
    private readonly root: SVGGElement;
    private readonly layers = new Map<PlanLayerName, SVGGElement>();
    private readonly resizeObserver: ResizeObserver;
    private readonly viewListeners = new Set<() => void>();

    /** Px per mm. */
    private scale = 0.05;
    /** The model point drawn at the centre of the element. */
    private centerMm: Vec2Mm = { x: 0, y: 0 };

    private downPos: {
        x: number;
        y: number;
        button: number;
        ctrlKey: boolean;
        pointerId: number;
        /** Granted by `wantsDrag`: a left drag from here edits rather than doing nothing. */
        editDrag: boolean;
    } | null = null;
    private dragging = false;
    private disposed = false;
    /** The nav bar's Pan: a left drag pans too, and a left click picks nothing. */
    private leftPans = false;

    constructor(
        private readonly host: HTMLElement,
        private readonly callbacks: PlanViewCallbacks
    ) {
        this.svg = svgEl('svg', {
            width: '100%',
            height: '100%',
            // No text selection: a drag pans or edits, it never selects a room's name.
            style: 'display:block;touch-action:none;cursor:crosshair;user-select:none;',
        });
        this.root = svgEl('g');
        this.svg.append(this.root);
        for (const name of LAYER_NAMES) {
            const g = svgEl('g');
            this.layers.set(name, g);
            this.root.append(g);
        }
        host.appendChild(this.svg);

        this.svg.addEventListener('pointerdown', this.handlePointerDown);
        this.svg.addEventListener('pointermove', this.handlePointerMove);
        this.svg.addEventListener('pointerup', this.handlePointerUp);
        this.svg.addEventListener('wheel', this.handleWheel, { passive: false });
        this.svg.addEventListener('contextmenu', this.handleContextMenu);

        this.resizeObserver = new ResizeObserver(() => this.applyTransform());
        this.resizeObserver.observe(host);
        this.applyTransform();
    }

    layer(name: PlanLayerName): SVGGElement {
        return this.layers.get(name)!;
    }

    clearLayer(name: PlanLayerName): SVGGElement {
        const g = this.layer(name);
        g.replaceChildren();
        return g;
    }

    /** Frames a plan-space bounding box, with a margin so the geometry is not flush with the edge. */
    fitTo(bounds: Bounds2Mm, marginMm = 1800): void {
        const width = Math.max(boundsWidth2(bounds), 1000) + marginMm * 2;
        const height = Math.max(boundsHeight2(bounds), 1000) + marginMm * 2;
        const w = this.host.clientWidth || 1;
        const h = this.host.clientHeight || 1;
        this.scale = clamp(Math.min(w / width, h / height), MIN_SCALE, MAX_SCALE);
        this.centerMm = boundsCenter2(bounds);
        this.applyTransform();
    }

    /** The inverse of the pan/zoom transform: a client-space pointer position -> model mm. */
    screenToModel(clientX: number, clientY: number): Vec2Mm {
        const rect = this.svg.getBoundingClientRect();
        const w = rect.width || 1;
        const h = rect.height || 1;
        return {
            x: this.centerMm.x + (clientX - rect.left - w / 2) / this.scale,
            y: this.centerMm.y - (clientY - rect.top - h / 2) / this.scale,
        };
    }

    /**
     * The forward transform: model mm -> a position relative to the element's own top-left
     * corner, in CSS pixels. The plan's equivalent of `Viewport.projectToPixel`, and for the
     * same reason: `scripts/smoke.mjs` needs to aim a real pointer event at a model position,
     * and only this class knows where that lands on screen.
     */
    modelToScreen(modelMm: Vec2Mm): { x: number; y: number } {
        const w = this.host.clientWidth || 1;
        const h = this.host.clientHeight || 1;
        return {
            x: w / 2 + (modelMm.x - this.centerMm.x) * this.scale,
            y: h / 2 - (modelMm.y - this.centerMm.y) * this.scale,
        };
    }

    /** Model mm spanned by one screen pixel — the plan's equivalent of `Viewport.mmPerPixel`. */
    mmPerPixel(): number {
        return 1 / this.scale;
    }

    /** The model-space rectangle currently on screen — what the grid layer draws lines within. */
    visibleBoundsMm(): Bounds2Mm {
        const w = this.host.clientWidth || 1;
        const h = this.host.clientHeight || 1;
        const halfWidthMm = w / 2 / this.scale;
        const halfHeightMm = h / 2 / this.scale;
        return {
            minX: this.centerMm.x - halfWidthMm,
            maxX: this.centerMm.x + halfWidthMm,
            minY: this.centerMm.y - halfHeightMm,
            maxY: this.centerMm.y + halfHeightMm,
        };
    }

    /**
     * Calls `listener` whenever the pan, zoom or size changes — for anything drawn over the plan
     * in screen pixels, which has to be re-placed when the model moves under it. Returns the
     * unsubscribe.
     */
    onViewChange(listener: () => void): () => void {
        this.viewListeners.add(listener);
        return () => this.viewListeners.delete(listener);
    }

    private applyTransform(): void {
        const w = this.host.clientWidth || 1;
        const h = this.host.clientHeight || 1;
        this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        const s = this.scale;
        // Y is negated: model north is up on screen, SVG's own Y increases downward.
        this.root.setAttribute(
            'transform',
            `translate(${w / 2} ${h / 2}) scale(${s} ${-s}) translate(${-this.centerMm.x} ${-this.centerMm.y})`
        );
        for (const listener of this.viewListeners) listener();
    }

    private readonly handleWheel = (event: WheelEvent): void => {
        event.preventDefault();
        const before = this.screenToModel(event.clientX, event.clientY);
        const newScale = clamp(this.scale * Math.exp(-event.deltaY * 0.001), MIN_SCALE, MAX_SCALE);
        const rect = this.svg.getBoundingClientRect();
        const w = rect.width || 1;
        const h = rect.height || 1;
        const localX = event.clientX - rect.left;
        const localY = event.clientY - rect.top;
        // Solved from the same transform `screenToModel` inverts, so the model point under the
        // cursor lands back under the cursor at the new scale — wheel zoom converging on the
        // pivot the user is actually pointing at, the same promise `Viewport.zoomToCursor` makes.
        this.centerMm = {
            x: before.x - (localX - w / 2) / newScale,
            y: before.y - (h / 2 - localY) / newScale,
        };
        this.scale = newScale;
        this.applyTransform();
    };

    /**
     * Makes a left drag pan the plan, as the right drag always does — the nav bar's Pan, the
     * plan's counterpart of `Viewport.setNavMode('pan')`. A left click then picks nothing.
     */
    setLeftPans(on: boolean): void {
        this.leftPans = on;
        this.svg.style.cursor = on ? 'grab' : 'crosshair';
    }

    /** Right-drag pans (mirrors `Viewport`'s RIGHT = PAN); a plain right click still pops a vertex. */
    private readonly handlePointerDown = (event: PointerEvent): void => {
        const leftPress = event.button === 0 && !event.ctrlKey;
        this.downPos = {
            x: event.clientX,
            y: event.clientY,
            button: event.button,
            ctrlKey: event.ctrlKey,
            pointerId: event.pointerId,
            editDrag:
                leftPress &&
                !this.leftPans &&
                (this.callbacks.wantsDrag?.(this.screenToModel(event.clientX, event.clientY)) ??
                    false),
        };
        this.svg.setPointerCapture(event.pointerId);
    };

    private readonly handlePointerMove = (event: PointerEvent): void => {
        const down = this.downPos;
        // Right (2) or middle (4) button held — or the left, in Pan — pan once the drag clears
        // the click threshold.
        if (down && (event.buttons & (this.leftPans ? 0b111 : 0b110)) !== 0) {
            const dx = event.clientX - down.x;
            const dy = event.clientY - down.y;
            if (this.dragging || Math.hypot(dx, dy) > CLICK_DRAG_TOLERANCE_PX) {
                this.dragging = true;
                this.centerMm = {
                    x: this.centerMm.x - dx / this.scale,
                    y: this.centerMm.y + dy / this.scale,
                };
                down.x = event.clientX;
                down.y = event.clientY;
                this.applyTransform();
                return;
            }
        }
        // Left button held on something draggable: past the threshold it is an edit drag.
        if (down?.editDrag && (event.buttons & 1) !== 0) {
            const at = this.screenToModel(event.clientX, event.clientY);
            if (!this.dragging) {
                const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
                if (moved <= CLICK_DRAG_TOLERANCE_PX) {
                    this.callbacks.onPointerMove(at);
                    return;
                }
                this.dragging = true;
                this.callbacks.onDrag?.('start', this.screenToModel(down.x, down.y));
            }
            this.callbacks.onDrag?.('move', at);
            return;
        }
        this.callbacks.onPointerMove(this.screenToModel(event.clientX, event.clientY));
    };

    private readonly handlePointerUp = (event: PointerEvent): void => {
        const down = this.downPos;
        const wasDragging = this.dragging;
        this.downPos = null;
        this.dragging = false;
        if (down) this.svg.releasePointerCapture(down.pointerId);
        if (!down) return;
        if (down.editDrag && wasDragging) {
            this.callbacks.onDrag?.('end', this.screenToModel(event.clientX, event.clientY));
            return;
        }
        const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        if (wasDragging || moved > CLICK_DRAG_TOLERANCE_PX) return;
        // Ctrl+click is the Mac's right click: one-button trackpads have no other.
        if (down.button === 2 || (down.button === 0 && down.ctrlKey)) {
            this.callbacks.onRightClick();
            return;
        }
        if (down.button !== 0 || this.leftPans) return;
        this.callbacks.onClick(this.screenToModel(event.clientX, event.clientY));
    };

    private readonly handleContextMenu = (event: Event): void => {
        event.preventDefault();
    };

    destroy(): void {
        this.disposed = true;
        this.resizeObserver.disconnect();
        this.svg.removeEventListener('pointerdown', this.handlePointerDown);
        this.svg.removeEventListener('pointermove', this.handlePointerMove);
        this.svg.removeEventListener('pointerup', this.handlePointerUp);
        this.svg.removeEventListener('wheel', this.handleWheel);
        this.svg.removeEventListener('contextmenu', this.handleContextMenu);
        this.svg.remove();
    }

    get isDisposed(): boolean {
        return this.disposed;
    }
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}
