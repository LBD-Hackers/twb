/**
 * Content for the SVG plan view's layers — pure builders, exactly like `surface-layer.ts` and
 * `grid-helper.ts` are for the 3D scene: given data and a target `<g>`, fill it in. `plan-view.ts`
 * owns the pan/zoom transform and the pointer plumbing; nothing here touches either.
 *
 * A wall footprint is drawn as a thick stroke rather than the true zero-thickness centreline,
 * because a plan the user cannot read as "a wall" at a glance is not a plan — `PLAN_WALL_MM` is
 * a representative stud-wall thickness, not a real dimension anything downstream reads.
 */

import type { Bounds2Mm, Vec2Mm } from '../core';
import type { AreaFootprint, DoorSwingPlan, WallFootprint, WallOpening } from '../model';
import { MODULE_MM } from '../grid';
import type { SnapKind } from '../interaction';
import { THEME } from './theme';
import { svgEl } from './svg-dom';

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Representative wall thickness for the plan, mm — a timber stud wall, not a measured value. */
export const PLAN_WALL_MM = 120;

/** Grid lines within the visible area only, so their count tracks zoom rather than model size. */
export function renderPlanGrid(group: SVGGElement, boundsMm: Bounds2Mm): void {
    const first = (v: number): number => Math.floor(v / MODULE_MM) * MODULE_MM;
    const color = hex(THEME.grid.module);
    const lines: SVGElement[] = [];
    for (let x = first(boundsMm.minX); x <= boundsMm.maxX; x += MODULE_MM) {
        lines.push(
            svgEl('line', {
                x1: String(x),
                y1: String(boundsMm.minY),
                x2: String(x),
                y2: String(boundsMm.maxY),
                stroke: color,
                'stroke-opacity': String(THEME.grid.moduleOpacity),
                'vector-effect': 'non-scaling-stroke',
            })
        );
    }
    for (let y = first(boundsMm.minY); y <= boundsMm.maxY; y += MODULE_MM) {
        lines.push(
            svgEl('line', {
                x1: String(boundsMm.minX),
                y1: String(y),
                x2: String(boundsMm.maxX),
                y2: String(y),
                stroke: color,
                'stroke-opacity': String(THEME.grid.moduleOpacity),
                'vector-effect': 'non-scaling-stroke',
            })
        );
    }
    group.replaceChildren(...lines);
}

/** The plan's walls, and the doors drawn in them: near-black, the drawing's own ink. */
export const PLAN_WALL_HEX = '#002129';

/** A room before it is given a room type: a pale blue-grey, which a room type's colour covers. */
export const PLAN_ROOM_HEX = '#8fa7bb';

/** A roof window overhead: grey enough to read over a room type's colour. */
const PLAN_SKYLIGHT_HEX = '#6b6b6b';

/** Floor outlines for the active storey — a light fill, so the room shapes read at a glance. */
export function renderPlanAreas(group: SVGGElement, floors: readonly AreaFootprint[]): void {
    const polys = floors.map((f) =>
        svgEl('polygon', {
            points: f.ringMm.map((p) => `${p.x},${p.y}`).join(' '),
            fill: PLAN_ROOM_HEX,
            'fill-opacity': '0.35',
            stroke: 'none',
        })
    );
    group.replaceChildren(...polys);
}

/**
 * Wall footprints, drawn as thick strokes with square caps so corners meet cleanly — broken at
 * every door and window, so an opening reads as a gap in the wall rather than an unbroken line
 * pretending nothing is cut there. A window's gap keeps a thin line across it (still a wall
 * assembly there, just glazed); a door's is left open, with its leaf drawn standing open and
 * the arc its edge sweeps — the plan convention for which way, and to which side, it opens.
 */
export function renderPlanWalls(
    group: SVGGElement,
    walls: readonly WallFootprint[],
    openings: readonly WallOpening[],
    colorHex: string,
    opacity = 1
): void {
    const elements: SVGElement[] = [];
    for (const w of walls) {
        const dx = w.bMm.x - w.aMm.x;
        const dy = w.bMm.y - w.aMm.y;
        const len2 = dx * dx + dy * dy;
        const lerp = (t: number): Vec2Mm => ({ x: w.aMm.x + dx * t, y: w.aMm.y + dy * t });
        const project = (p: Vec2Mm): number =>
            len2 > 0 ? ((p.x - w.aMm.x) * dx + (p.y - w.aMm.y) * dy) / len2 : 0;

        const gaps = openings
            .filter((o) => o.surfaceId === w.surfaceId)
            .map((o) => ({ t0: project(o.aMm), t1: project(o.bMm), opening: o }))
            .map((g) => ({ ...g, t0: Math.min(g.t0, g.t1), t1: Math.max(g.t0, g.t1) }))
            .sort((a, b) => a.t0 - b.t0);

        let cursor = 0;
        for (const gap of gaps) {
            const t0 = Math.max(cursor, Math.min(1, gap.t0));
            if (t0 > cursor) elements.push(wallSegment(lerp(cursor), lerp(t0), colorHex, opacity));
            if (gap.opening.swings.length > 0) {
                for (const swing of gap.opening.swings) {
                    elements.push(...doorSwing(swing, colorHex, opacity));
                }
            } else if (gap.opening.kind === 'garage-door') {
                elements.push(garageDoorLine(gap.opening.aMm, gap.opening.bMm, colorHex, opacity));
            } else if (!gap.opening.isDoor) {
                elements.push(...windowMark(gap.opening.aMm, gap.opening.bMm, opacity));
            }
            cursor = Math.max(cursor, Math.min(1, gap.t1));
        }
        if (cursor < 1) elements.push(wallSegment(lerp(cursor), lerp(1), colorHex, opacity));
    }
    group.replaceChildren(...elements);
}

function wallSegment(a: Vec2Mm, b: Vec2Mm, colorHex: string, opacity: number): SVGElement {
    return svgEl('line', {
        x1: String(a.x),
        y1: String(a.y),
        x2: String(b.x),
        y2: String(b.y),
        stroke: colorHex,
        'stroke-opacity': String(opacity),
        'stroke-width': String(PLAN_WALL_MM),
        'stroke-linecap': 'square',
    });
}

/** A window's glazing in plan: light blue, see-through. */
export const PLAN_WINDOW_HEX = '#6fb8ea';

/**
 * A window across its gap: the wall's thickness marked in a see-through light blue, so a window
 * reads at a glance from a wall and a door, and the glass as a thin blue line down its middle.
 */
function windowMark(a: Vec2Mm, b: Vec2Mm, opacity: number): SVGElement[] {
    const line = (width: number, strokeOpacity: number): SVGElement =>
        svgEl('line', {
            x1: String(a.x),
            y1: String(a.y),
            x2: String(b.x),
            y2: String(b.y),
            stroke: PLAN_WINDOW_HEX,
            'stroke-opacity': String(strokeOpacity * opacity),
            'stroke-width': String(width),
            'stroke-linecap': 'butt',
        });
    return [line(PLAN_WALL_MM, 0.35), line(PLAN_WALL_MM * 0.18, 0.95)];
}

/**
 * Roof windows over the plan, each its outline projected down: a very thin, dashed grey
 * line — the plan convention for what is overhead, not cut. Added to `group`, not in place of
 * what is there.
 */
export function renderPlanSkylights(
    group: SVGGElement,
    rings: readonly (readonly Vec2Mm[])[]
): void {
    for (const ring of rings) {
        if (ring.length < 3) continue;
        group.append(
            svgEl('polygon', {
                points: ring.map((p) => `${p.x},${p.y}`).join(' '),
                fill: 'none',
                stroke: PLAN_SKYLIGHT_HEX,
                'stroke-width': String(PLAN_WALL_MM * 0.15),
                'stroke-dasharray': `${PLAN_WALL_MM * 0.9} ${PLAN_WALL_MM * 0.6}`,
                'data-skylight': '',
                'pointer-events': 'none',
            })
        );
    }
}

/**
 * A garage door across its gap: dashed, the plan convention for a door that lifts up out of the
 * way overhead rather than swinging through the plan.
 */
function garageDoorLine(a: Vec2Mm, b: Vec2Mm, colorHex: string, opacity: number): SVGElement {
    return svgEl('line', {
        x1: String(a.x),
        y1: String(a.y),
        x2: String(b.x),
        y2: String(b.y),
        stroke: colorHex,
        'stroke-opacity': String(opacity),
        'stroke-width': String(PLAN_WALL_MM * 0.5),
        'stroke-dasharray': `${PLAN_WALL_MM * 1.5} ${PLAN_WALL_MM}`,
    });
}

/**
 * A door's leaf, standing square to the wall at its hinge, and the quarter arc its free edge
 * sweeps back to the latch jamb. Both start at the wall's face on the opening side rather than
 * its centreline, so the leaf does not disappear into the thick wall stroke.
 */
function doorSwing(swing: DoorSwingPlan, colorHex: string, opacity: number): SVGElement[] {
    const { hingeMm, latchMm, openDir } = swing;
    const radiusMm = Math.hypot(latchMm.x - hingeMm.x, latchMm.y - hingeMm.y);
    if (radiusMm === 0) return [];
    const faceMm = PLAN_WALL_MM / 2;
    const off = (p: Vec2Mm): Vec2Mm => ({
        x: p.x + openDir.x * faceMm,
        y: p.y + openDir.y * faceMm,
    });
    const hinge = off(hingeMm);
    const latch = off(latchMm);
    const tip = { x: hinge.x + openDir.x * radiusMm, y: hinge.y + openDir.y * radiusMm };
    // SVG's sweep flag 1 turns towards increasing angle in the path's own coordinates, i.e.
    // from the open leaf towards the latch exactly when their cross product is positive.
    const alongX = latch.x - hinge.x;
    const alongY = latch.y - hinge.y;
    const sweep = openDir.x * alongY - openDir.y * alongX > 0 ? 1 : 0;
    const stroke = { stroke: colorHex, 'stroke-opacity': String(opacity), fill: 'none' };
    return [
        svgEl('line', {
            x1: String(hinge.x),
            y1: String(hinge.y),
            x2: String(tip.x),
            y2: String(tip.y),
            ...stroke,
            'stroke-width': String(PLAN_WALL_MM * 0.3),
        }),
        svgEl('path', {
            d: `M ${tip.x} ${tip.y} A ${radiusMm} ${radiusMm} 0 0 ${sweep} ${latch.x} ${latch.y}`,
            ...stroke,
            'stroke-width': String(PLAN_WALL_MM * 0.12),
        }),
    ];
}

/**
 * The ghost reference a wall snaps to: the storey above's own walls. Dashed and pale, so it
 * never reads as something already built on *this* storey. The roof's footprint is snapped to
 * but not drawn: its eaves would run straight through the walls, and its ridge across the rooms.
 */
export function renderPlanGhost(group: SVGGElement, walls: readonly WallFootprint[]): void {
    const color = hex(THEME.guide.line);
    const elements: SVGElement[] = walls.map((w) =>
        svgEl('line', {
            x1: String(w.aMm.x),
            y1: String(w.aMm.y),
            x2: String(w.bMm.x),
            y2: String(w.bMm.y),
            stroke: color,
            'stroke-opacity': '0.55',
            'stroke-width': String(PLAN_WALL_MM),
            'stroke-dasharray': '200 150',
            'stroke-linecap': 'square',
        })
    );
    group.replaceChildren(...elements);
}

export interface PlanDraftState {
    /** The Interior Wall run drawn so far. */
    ringMm: readonly Vec2Mm[];
    cursorMm: Vec2Mm | null;
    cursorSnap: SnapKind | null;
    /** The selected door or window's own segment, highlighted so the pick reads back. */
    selectedOpeningMm: { aMm: Vec2Mm; bMm: Vec2Mm } | null;
    /** The selected roof window's outline projected down — or where a drag would leave it. */
    selectedSkylightMm?: readonly Vec2Mm[] | null;
    /** Extend wall: the nodes placed on the wall so far. */
    nodesMm?: readonly Vec2Mm[];
    /** Extend wall: the stretch of wall the cursor would pull, where it stands now. */
    pullSegmentMm?: { aMm: Vec2Mm; bMm: Vec2Mm } | null;
    /** Extend wall: the storey's walls and floor outline as they would be after the pull. */
    previewWallsMm?: readonly { aMm: Vec2Mm; bMm: Vec2Mm }[];
    previewAreasMm?: readonly (readonly Vec2Mm[])[];
}

const SNAP_COLOR: Record<SnapKind, number> = {
    vertex: THEME.snap.vertex,
    midpoint: THEME.snap.midpoint,
    intersection: THEME.snap.intersection,
    edge: THEME.snap.edge,
    'from-point': THEME.snap.fromPoint,
    axis: THEME.snap.axis,
    'sub-grid': THEME.snap.grid,
    'module-grid': THEME.snap.grid,
    free: THEME.snap.free,
};

/** The run in progress, its committed vertices, and a marker for the cursor's own snap. */
export function renderPlanDraft(
    group: SVGGElement,
    draft: PlanDraftState,
    mmPerPixel: number
): void {
    const elements: SVGElement[] = [];
    const draftColor = hex(THEME.draft.line);
    const points = draft.cursorMm ? [...draft.ringMm, draft.cursorMm] : draft.ringMm;
    if (points.length > 1) {
        elements.push(
            svgEl('polyline', {
                points: points.map((p) => `${p.x},${p.y}`).join(' '),
                fill: 'none',
                stroke: draftColor,
                'stroke-width': String(mmPerPixel * 2),
            })
        );
    }
    const vertexRadiusMm = mmPerPixel * 4;
    for (const p of draft.ringMm) {
        elements.push(
            svgEl('circle', {
                cx: String(p.x),
                cy: String(p.y),
                r: String(vertexRadiusMm),
                fill: draftColor,
            })
        );
    }
    if (draft.cursorMm && draft.cursorSnap) {
        elements.push(
            svgEl('circle', {
                cx: String(draft.cursorMm.x),
                cy: String(draft.cursorMm.y),
                r: String(mmPerPixel * 5),
                fill: 'none',
                stroke: hex(SNAP_COLOR[draft.cursorSnap]),
                'stroke-width': String(mmPerPixel * 2),
            })
        );
    }
    // The pull's result, so the house the click would leave is visible before the click.
    for (const ring of draft.previewAreasMm ?? []) {
        elements.push(
            svgEl('polygon', {
                points: ring.map((p) => `${p.x},${p.y}`).join(' '),
                fill: draftColor,
                'fill-opacity': '0.08',
                stroke: 'none',
            })
        );
    }
    for (const w of draft.previewWallsMm ?? []) {
        elements.push(
            svgEl('line', {
                x1: String(w.aMm.x),
                y1: String(w.aMm.y),
                x2: String(w.bMm.x),
                y2: String(w.bMm.y),
                stroke: draftColor,
                'stroke-width': String(mmPerPixel * 2),
                'stroke-dasharray': `${mmPerPixel * 8} ${mmPerPixel * 5}`,
            })
        );
    }
    if (draft.pullSegmentMm) {
        const { aMm, bMm } = draft.pullSegmentMm;
        elements.push(
            svgEl('line', {
                x1: String(aMm.x),
                y1: String(aMm.y),
                x2: String(bMm.x),
                y2: String(bMm.y),
                stroke: draftColor,
                'stroke-opacity': '0.6',
                'stroke-width': String(PLAN_WALL_MM * 1.3),
            })
        );
    }
    for (const p of draft.nodesMm ?? []) {
        const half = mmPerPixel * 5;
        elements.push(
            svgEl('rect', {
                x: String(p.x - half),
                y: String(p.y - half),
                width: String(half * 2),
                height: String(half * 2),
                fill: '#fff',
                stroke: draftColor,
                'stroke-width': String(mmPerPixel * 2),
            })
        );
    }
    if (draft.selectedOpeningMm) {
        const { aMm, bMm } = draft.selectedOpeningMm;
        elements.push(
            svgEl('line', {
                x1: String(aMm.x),
                y1: String(aMm.y),
                x2: String(bMm.x),
                y2: String(bMm.y),
                stroke: draftColor,
                'stroke-opacity': '0.8',
                'stroke-width': String(PLAN_WALL_MM * 1.3),
                'stroke-linecap': 'round',
            })
        );
    }
    if (draft.selectedSkylightMm && draft.selectedSkylightMm.length >= 3) {
        elements.push(
            svgEl('polygon', {
                points: draft.selectedSkylightMm.map((p) => `${p.x},${p.y}`).join(' '),
                fill: draftColor,
                'fill-opacity': '0.12',
                stroke: draftColor,
                'stroke-opacity': '0.8',
                'stroke-width': String(PLAN_WALL_MM * 0.3),
            })
        );
    }
    group.replaceChildren(...elements);
}
