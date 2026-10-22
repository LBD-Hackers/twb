/**
 * What every embeddable element shares: a house file in, a 3D view of it out.
 *
 * The house comes from the `src` attribute (a URL to a house file) or the `house` property (the
 * file's text, or its parsed JSON); either is opened with `loadHouse` (`house/load.ts`). A page
 * that has opened the house itself sets `loadedHouse` instead, and it is shown as it is: a big
 * house is not parsed and built a second time for its view. The view
 * is `@surfacekit/render`'s `Viewport`, mounted in the element's shadow root, so the camera,
 * picking and render-on-change behave exactly as they do in a modeller built on it.
 *
 * A subclass draws by `attach(house, viewport)`, called whenever there is both a house and a
 * view — after a load, and again when the element is put back into the page — and returning
 * what undoes it. Everything a subclass shows is derived from the house inside `attach`, the
 * rule a modeller keeps: nothing derived is stored on the element.
 */

import {
    LitElement,
    html,
    nothing,
    type PropertyDeclarations,
    type PropertyValues,
    type TemplateResult,
} from 'lit';
import type { Point3Mm } from '../surfacekit/core';
import { groundPlane } from '../surfacekit/interaction';
import { DEFAULT_WALL_HEIGHT_MM } from '../surfacekit/model';
import { Viewport, buildModuleGrid, type ModelRay } from '../surfacekit/render';
import { loadHouse, type LoadedHouse } from '../house/load';
import { frameStyles, tokenStyles } from './element-styles';

/** `house-load`'s detail: what the file had wrong, and what Open skipped. */
export interface HouseLoadDetail {
    problems: readonly string[];
}

export abstract class HouseViewElement extends LitElement {
    static override styles = [tokenStyles, frameStyles];

    static override properties: PropertyDeclarations = {
        src: { type: String },
        house: { attribute: false },
        loadedHouse: { attribute: false },
        noGrid: { type: Boolean, attribute: 'no-grid' },
        keepCamera: { type: Boolean, attribute: 'keep-camera' },
        error: { state: true },
    };

    /** A URL to a house file. */
    declare src: string | null;
    /** The house file's text, or its parsed JSON — set instead of `src`. */
    declare house: string | object | null;
    /**
     * A house the page opened itself (`loadHouse`), set instead of `src` or `house`. It is drawn
     * from its own store, so an editable element edits that very house.
     */
    declare loadedHouse: LoadedHouse | null;
    /** Leaves out the module grid on the ground. */
    declare noGrid: boolean;
    /**
     * A house set through `house` keeps the camera where it is, once there has been one — for a
     * view that follows an editor. A new `src` is framed all the same.
     */
    declare keepCamera: boolean;
    declare protected error: string | null;

    protected viewport: Viewport | null = null;
    /** The house as opened, or null before one is. */
    protected loaded: LoadedHouse | null = null;
    private detach: (() => void) | null = null;
    /** Bumped on every load, so a slow fetch cannot land over a newer house. */
    private loadToken = 0;

    constructor() {
        super();
        this.src = null;
        this.house = null;
        this.loadedHouse = null;
        this.noGrid = false;
        this.keepCamera = false;
        this.error = null;
    }

    /** How much bigger than the house the camera frames — room for what is drawn round it. */
    protected frameScale = 1;

    /** Draws `house` into `viewport`; returns what clears it again. */
    protected abstract attach(house: LoadedHouse, viewport: Viewport): () => void;

    /** What floats over the canvas — a legend, a toolbar. */
    protected renderOverlay(): TemplateResult | typeof nothing {
        return nothing;
    }

    protected onViewportClick(_ray: ModelRay, _event: PointerEvent): void {}
    protected onViewportMove(_ray: ModelRay, _event: PointerEvent): void {}
    protected onViewportRightClick(_event: PointerEvent): void {}

    override render(): TemplateResult {
        return html`<div class="stage">
            <div class="canvas"></div>
            ${
                this.error
                    ? html`<div class="message is-error">${this.error}</div>`
                    : !this.loaded && (this.src || this.house || this.loadedHouse)
                      ? html`<div class="message">Loading…</div>`
                      : nothing
            }
            ${this.renderOverlay()}
        </div>`;
    }

    override willUpdate(changed: PropertyValues): void {
        if (changed.has('loadedHouse') && this.loadedHouse !== null) {
            this.loadToken++;
            this.show(this.loadedHouse);
        } else if (changed.has('house') && this.house !== null) {
            this.open(typeof this.house === 'string' ? this.house : JSON.stringify(this.house));
        } else if (changed.has('src') && this.src && this.house === null) {
            void this.fetchHouse(this.src);
        }
    }

    override updated(_changed: PropertyValues): void {
        this.mountView();
    }

    override connectedCallback(): void {
        super.connectedCallback();
        // Put back into the page after a removal: the view was torn down with it.
        if (this.hasUpdated) this.mountView();
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.detach?.();
        this.detach = null;
        this.viewport?.destroy();
        this.viewport = null;
    }

    /** Fits the whole house in view — the way back from having orbited into empty space. */
    zoomExtents(): void {
        const viewport = this.viewport;
        if (!viewport) return;
        const store = this.loaded?.store;
        const points: Point3Mm[] = store
            ? [
                  ...store.surfaces().flatMap((s) => s.boundaryMm),
                  ...store.guides().flatMap((g) => [g.aMm, g.bMm]),
              ]
            : [];
        if (points.length === 0) {
            viewport.frameOn({ x: 0, y: 0, z: 0 }, 8000);
            return;
        }
        // Folded, not spread: a big house has more corners than a call takes arguments.
        const min = (k: 'x' | 'y' | 'z') => points.reduce((m, p) => Math.min(m, p[k]), Infinity);
        const max = (k: 'x' | 'y' | 'z') => points.reduce((m, p) => Math.max(m, p[k]), -Infinity);
        const center = {
            x: (min('x') + max('x')) / 2,
            y: (min('y') + max('y')) / 2,
            // Biased upward: a floors-only model would otherwise put
            // the camera at ankle height.
            z: (min('z') + max('z')) / 2 + DEFAULT_WALL_HEIGHT_MM / 2,
        };
        const radius = Math.max(max('x') - min('x'), max('y') - min('y'), max('z') - min('z')) / 2;
        viewport.frameOn(center, radius * this.frameScale + DEFAULT_WALL_HEIGHT_MM);
    }

    /** Draws the house again from scratch — after a subclass's own settings change it. */
    protected redraw(): void {
        this.detach?.();
        this.detach = null;
        if (this.loaded && this.viewport) this.detach = this.attach(this.loaded, this.viewport);
    }

    private async fetchHouse(url: string): Promise<void> {
        const token = ++this.loadToken;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const text = await response.text();
            if (token === this.loadToken) this.open(text, true);
        } catch (e) {
            if (token !== this.loadToken) return;
            this.error = `Could not load ${url}: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    /** `reframe`: fit the camera to the house even with `keep-camera` — a new file, not an edit. */
    private open(text: string, reframe = false): void {
        this.loadToken++;
        let house: LoadedHouse;
        try {
            house = loadHouse(text);
        } catch (e) {
            this.error = `Not a house file: ${e instanceof Error ? e.message : String(e)}`;
            return;
        }
        this.show(house, reframe);
    }

    /** Shows an opened house; `reframe` as for `open`. */
    private show(house: LoadedHouse, reframe = false): void {
        this.error = null;
        const fit = reframe || !this.keepCamera || !this.loaded;
        this.loaded = house;
        this.redraw();
        if (fit) this.zoomExtents();
        this.dispatchEvent(
            new CustomEvent<HouseLoadDetail>('house-load', {
                detail: { problems: house.problems },
                bubbles: true,
                composed: true,
            })
        );
        this.requestUpdate();
    }

    private mountView(): void {
        if (this.viewport || !this.isConnected) return;
        const host = this.renderRoot.querySelector<HTMLElement>('.canvas');
        if (!host) return;
        this.viewport = new Viewport(host, {
            onPointerMove: (ray, event) => this.onViewportMove(ray, event),
            onClick: (ray, event) => this.onViewportClick(ray, event),
            onRightClick: (event) => this.onViewportRightClick(event),
        });
        if (!this.noGrid) {
            this.viewport.layer('grid').add(buildModuleGrid(groundPlane(0), { subPitchMm: 600 }));
        }
        this.redraw();
        this.zoomExtents();
    }
}
