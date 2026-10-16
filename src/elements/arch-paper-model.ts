/**
 * `<arch-paper-model>`: the paper model — the house's thin faces on the frame's centrelines, as
 * Draw mode shows them — on its own, read-only or editable.
 *
 * ```html
 * <arch-paper-model src="house.json" readonly></arch-paper-model>
 * <arch-paper-model src="house.json" color-by-kind></arch-paper-model>
 * ```
 *
 * - `readonly`: the left button orbits and nothing can be picked or changed.
 * - Editable (the default): a small toolbar with **Select**, **Push/Pull** and **Orbit**, and
 *   **Undo**, **Redo** and **Delete** — a modeller's own verbs on `@surfacekit/model`'s store
 *   (`SurfaceStore.extrude`, `removeFace`), so a face pulled here is validated against the
 *   module exactly as it is in a modeller built on it. Delete/Backspace, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and
 *   Esc work while the element has focus.
 * - `color-by-kind`: tints every face by what `classify.ts` makes of it.
 *
 * Events: `house-load` (`{ problems }`), `face-select` (`{ surfaceId, kind }`, null when the
 * selection is cleared) and, after every edit, `house-change` (`{ json }`: the house as the
 * house file as Save writes it, `twb/1`). `toHouseJson()` returns the same on demand.
 */

import { html, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import {
    History,
    add3,
    computed,
    dot3,
    effect,
    scale3,
    signal,
    sub3,
    type ReadonlySignal,
    type Signal,
} from '../surfacekit/core';
import { snapMm } from '../surfacekit/grid';
import { PushPullTool, rayToLine, worldAxisOf, type PushPullTarget } from '../surfacekit/interaction';
import {
    classifyAll,
    extrudeRing,
    roundPoint,
    surfaceFrame,
    type SurfaceId,
    type SurfaceKind,
} from '../surfacekit/model';
import { renderDraft, renderSurfaces, type ModelRay, type Viewport } from '../surfacekit/render';
import { serializeLoadedHouse, type LoadedHouse } from '../house/load';
import { HouseViewElement } from './house-view-element';

type Tool = 'select' | 'pushpull' | 'orbit';

/** The guide drawn through a pulled face's anchor, each way, mm. */
const GUIDE_LENGTH_MM = 50_000;
/** Push/pull snaps to this pitch below the module, mm. */
const PULL_PITCH_MM = 600;

export interface FaceSelectDetail {
    surfaceId: SurfaceId | null;
    kind: SurfaceKind | null;
}

export interface HouseChangeDetail {
    json: string;
}

export class ArchPaperModel extends HouseViewElement {
    static override properties: PropertyDeclarations = {
        readonly: { type: Boolean, reflect: true },
        colorByKind: { type: Boolean, attribute: 'color-by-kind' },
        tool: { state: true },
        status: { state: true },
        canUndo: { state: true },
        canRedo: { state: true },
        hasSelection: { state: true },
    };

    declare readonly: boolean;
    declare colorByKind: boolean;
    declare protected tool: Tool;
    declare protected status: string;
    declare protected canUndo: boolean;
    declare protected canRedo: boolean;
    declare protected hasSelection: boolean;

    private history: History | null = null;
    /** The house `history` records. */
    private historyOf: LoadedHouse | null = null;
    /** What every face of the house attached is, kept current as it is edited. */
    private kinds: ReadonlySignal<ReadonlyMap<SurfaceId, SurfaceKind>> = () => new Map();
    private readonly pushPull: PushPullTool;
    /** The push/pull's distance as the cursor reads it, mm — the preview's. */
    private readonly pullMm = signal(0);
    /** Bumped when the tool's own state changes, so the overlay redraws. */
    private readonly draftVersion = signal(0);
    private readonly kindColours: Signal<boolean> = signal(false);

    constructor() {
        super();
        this.readonly = false;
        this.colorByKind = false;
        this.tool = 'select';
        this.status = '';
        this.canUndo = false;
        this.canRedo = false;
        this.hasSelection = false;
        this.tabIndex = 0;
        this.pushPull = new PushPullTool({
            onCommit: (target, distanceMm) => this.commitPull(target, distanceMm),
            onChange: () => this.draftVersion.update((n) => n + 1),
        });
        this.addEventListener('keydown', this.handleKey);
    }

    /** The house file (`twb/1`) with every edit made here. */
    toHouseJson(): string | null {
        return this.loaded ? serializeLoadedHouse(this.loaded) : null;
    }

    undo(): void {
        if (this.readonly) return;
        this.pushPull.popVertex();
        this.history?.undo();
    }

    redo(): void {
        if (this.readonly) return;
        this.history?.redo();
    }

    /** Removes the selected face; its edges stay as lines. */
    deleteSelected(): void {
        const store = this.loaded?.store;
        const id = store?.selectedId();
        if (this.readonly || !store || !id) return;
        store.removeFace(id);
        this.status = `Removed ${id} — its edges stay as lines.`;
    }

    override willUpdate(changed: PropertyValues): void {
        super.willUpdate(changed);
        if (changed.has('colorByKind')) this.kindColours.set(this.colorByKind);
        if (changed.has('readonly') && this.readonly) {
            this.loaded?.store.select(null);
            this.setTool('select');
        }
    }

    override updated(changed: PropertyValues): void {
        super.updated(changed);
        if (changed.has('readonly') || changed.has('tool')) this.applyNavMode();
    }

    protected override attach(house: LoadedHouse, viewport: Viewport): () => void {
        const store = house.store;
        // One history per house: undo never reaches back into the house loaded before it.
        if (!this.history || this.historyOf !== house) {
            this.history = new History([
                store.surfaces,
                store.guides,
                store.storeys,
            ] as Signal<unknown>[]);
            this.historyOf = house;
        }
        const history = this.history;
        this.kinds = computed(() => classifyAll(store.surfaces()));
        const kinds = this.kinds;
        this.applyNavMode();
        let first = true;
        const disposers = [
            effect(() => {
                const group = viewport.clearLayer('surfaces');
                renderSurfaces(group, store.surfaces(), {
                    selectedId: store.selectedId(),
                    kinds: kinds(),
                    colorByKind: this.kindColours(),
                });
                viewport.renderOnce();
            }),
            effect(() => {
                this.draftVersion();
                const group = viewport.clearLayer('overlay');
                const target = this.pushPull.armed;
                const surface = target ? store.get(target.surfaceId) : undefined;
                if (target && surface) {
                    const distance = this.pullMm();
                    renderDraft(group, {
                        ringMm: [],
                        cursorMm: this.pushPull.pulledAnchor(distance),
                        cursorSnap: 'axis',
                        wouldClose: false,
                        hoverRingMm: surface.boundaryMm,
                        bandFromMm: target.anchorMm,
                        guideMm: {
                            from: add3(target.anchorMm, scale3(target.normal, -GUIDE_LENGTH_MM)),
                            to: add3(target.anchorMm, scale3(target.normal, GUIDE_LENGTH_MM)),
                            axis: worldAxisOf(target.normal),
                        },
                        previewRingsMm:
                            distance === 0
                                ? null
                                : (() => {
                                      const { top, sides } = extrudeRing(
                                          surface.boundaryMm,
                                          target.normal,
                                          distance
                                      );
                                      return [top, ...sides];
                                  })(),
                    });
                }
                viewport.renderOnce();
            }),
            effect(() => {
                const id = store.selectedId();
                this.hasSelection = id !== null;
            }),
            effect(() => {
                this.canUndo = history.canUndo();
                this.canRedo = history.canRedo();
            }),
            effect(() => {
                store.surfaces();
                store.guides();
                store.storeys();
                if (first) {
                    first = false;
                    return;
                }
                queueMicrotask(() =>
                    this.dispatchEvent(
                        new CustomEvent<HouseChangeDetail>('house-change', {
                            detail: { json: serializeLoadedHouse(house) },
                            bubbles: true,
                            composed: true,
                        })
                    )
                );
            }),
        ];
        return () => {
            for (const dispose of disposers) dispose();
            viewport.clearLayer('surfaces');
            viewport.clearLayer('overlay');
        };
    }

    protected override renderOverlay(): TemplateResult {
        if (this.readonly) return html``;
        const toolButton = (id: Tool, label: string, hint: string) =>
            html`<button
                type="button"
                class=${this.tool === id ? 'is-active' : ''}
                title=${hint}
                @click=${() => this.setTool(id)}
            >
                ${label}
            </button>`;
        return html`
            <div class="element-toolbar" part="toolbar">
                ${toolButton('select', 'Select', 'Select — click a face')}
                ${toolButton(
                    'pushpull',
                    'Push/Pull',
                    'Push/Pull — click a face, move along its normal, click again'
                )}
                ${toolButton('orbit', 'Orbit', 'Orbit — drag to turn the model')}
                <span class="sep"></span>
                <button type="button" ?disabled=${!this.canUndo} @click=${() => this.undo()}>
                    Undo
                </button>
                <button type="button" ?disabled=${!this.canRedo} @click=${() => this.redo()}>
                    Redo
                </button>
                <button
                    type="button"
                    ?disabled=${!this.hasSelection}
                    @click=${() => this.deleteSelected()}
                >
                    Delete
                </button>
            </div>
            <div class="element-status" part="status">${this.status}</div>
        `;
    }

    protected override onViewportClick(ray: ModelRay): void {
        const viewport = this.viewport;
        const house = this.loaded;
        if (this.readonly || !viewport || !house) return;
        const store = house.store;
        if (this.tool === 'select') {
            const pick = viewport.pickSurface(ray.pixel);
            const id = pick?.surfaceId ?? null;
            store.select(id);
            this.status = id ? `${id} — ${this.kinds().get(id) ?? 'face'}` : '';
            this.dispatchEvent(
                new CustomEvent<FaceSelectDetail>('face-select', {
                    detail: { surfaceId: id, kind: id ? (this.kinds().get(id) ?? null) : null },
                    bubbles: true,
                    composed: true,
                })
            );
            return;
        }
        if (this.tool !== 'pushpull') return;
        const armed = this.pushPull.armed;
        if (armed) {
            this.pushPull.commit(pullDistance(ray, armed));
            return;
        }
        const pick = viewport.pickSurface(ray.pixel);
        const surface = pick ? store.get(pick.surfaceId) : undefined;
        const frame = surface ? surfaceFrame(surface.boundaryMm) : null;
        if (!pick || !frame) return;
        this.pullMm.set(0);
        this.pushPull.pick({
            surfaceId: pick.surfaceId,
            anchorMm: roundPoint(pick.pointMm),
            normal: frame.normal,
        });
        this.status = 'Push/Pull — move along the face’s normal and click. Esc lets go.';
    }

    protected override onViewportMove(ray: ModelRay): void {
        const armed = this.pushPull.armed;
        if (this.readonly || this.tool !== 'pushpull' || !armed) return;
        const distance = pullDistance(ray, armed);
        this.pullMm.set(distance);
        this.status = `Push/Pull — ${distance} mm`;
    }

    protected override onViewportRightClick(): void {
        this.pushPull.popVertex();
    }

    private setTool(tool: Tool): void {
        this.tool = tool;
        if (tool === 'pushpull') this.pushPull.start();
        else this.pushPull.cancel();
        this.status = '';
    }

    private applyNavMode(): void {
        this.viewport?.setNavMode(this.readonly || this.tool === 'orbit' ? 'orbit' : 'off');
        this.viewport?.setToolCursor(this.tool === 'pushpull' ? 'crosshair' : 'default');
    }

    private commitPull(target: PushPullTarget, distanceMm: number): boolean {
        const store = this.loaded?.store;
        if (!store) return false;
        const result = store.extrude(target.surfaceId, distanceMm, { enforceModule: true });
        if (!result.ok) {
            this.status = result.violations[0]?.message ?? 'That pull is not allowed.';
            return false;
        }
        this.pullMm.set(0);
        this.status = `Pulled ${target.surfaceId} by ${Math.abs(distanceMm)} mm — ${result.surfaceIds.length} new faces.`;
        return true;
    }

    private readonly handleKey = (event: KeyboardEvent): void => {
        if (this.readonly) return;
        const chord = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if (event.key === 'Escape') {
            if (this.pushPull.armed) this.pushPull.popVertex();
            else this.loaded?.store.select(null);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
            this.deleteSelected();
        } else if (chord && ((key === 'z' && event.shiftKey) || key === 'y')) {
            this.redo();
        } else if (chord && key === 'z') {
            this.undo();
        } else {
            return;
        }
        event.preventDefault();
    };
}

/** Push/pull's distance along the face normal, read off the line inference and quantised. */
function pullDistance(ray: ModelRay, target: PushPullTarget): number {
    const hit = rayToLine(ray.originMm, ray.dir, target.anchorMm, target.normal);
    if (!hit) return 0;
    const along = dot3(sub3(hit.pointMm, target.anchorMm), target.normal);
    return Math.round(snapMm(along, PULL_PITCH_MM));
}
