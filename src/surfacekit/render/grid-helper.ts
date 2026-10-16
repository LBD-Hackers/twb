/**
 * The visible modular grid, drawn on the active working plane.
 *
 * Deliberately not `THREE.GridHelper`: that draws one uniform pitch on the XZ plane, and arch
 * needs two pitches with different weights (so the 1200 module reads as the primary rhythm and
 * the 400/600 subdivisions as guidance), drawn on whichever plane the active tool is working
 * on — which for a rectangle on a wall is vertical, and for one on a roof plane is tilted.
 *
 * The grid is what makes the modular system legible rather than merely enforced. A user who
 * can see the 1200 lines understands why a wall snapped where it did; one who cannot just
 * experiences the snapping as the tool fighting them.
 */

import * as THREE from 'three';
import { fromPlaneUv, lockAxisOf, type LockAxis, type WorkingPlane } from '../interaction';
import { MODULE_MM } from '../grid';
import { modelToThree } from './frame';
import { THEME } from './theme';

/** Half-extent of the drawn grid, in mm. 24 m covers a large single-family plot. */
const GRID_EXTENT_MM = 24_000;

/** Bounds in the plane's own 2D coordinates. */
export interface GridBoundsMm {
    uMin: number;
    uMax: number;
    vMin: number;
    vMax: number;
}

export interface GridOptions {
    /** The finer pitch drawn between module lines. 0 draws module lines only. */
    subPitchMm?: number;
    extentMm?: number;
    /**
     * Explicit bounds, overriding the symmetric `extentMm`.
     *
     * The ground grid wants to be a large square centred on the origin; a wall's grid wants to
     * be the size of the wall, sitting on the ground and rising from it. A symmetric extent
     * gives the second case a grid stretching as far below ground as above, which is not a
     * reference anyone reads a wall height against.
     */
    boundsMm?: GridBoundsMm;
}

/**
 * Builds the grid for a plane. The caller owns disposal (`Viewport.clearLayer('grid')`).
 *
 * Three `LineSegments` rather than one: each needs its own material (weight and opacity carry
 * the hierarchy), and batching all lines of one weight into a single draw call is what keeps
 * a 24 m grid at 400 mm — roughly 500 lines — off the frame budget.
 */
export function buildModuleGrid(plane: WorkingPlane, options: GridOptions = {}): THREE.Group {
    const extent = options.extentMm ?? GRID_EXTENT_MM;
    const bounds: GridBoundsMm = options.boundsMm ?? {
        uMin: -extent,
        uMax: extent,
        vMin: -extent,
        vMax: extent,
    };
    const sub = options.subPitchMm ?? 0;
    const group = new THREE.Group();

    const modulePoints: THREE.Vector3[] = [];
    const subPoints: THREE.Vector3[] = [];
    const axisXPoints: THREE.Vector3[] = [];
    const axisYPoints: THREE.Vector3[] = [];

    const push = (into: THREE.Vector3[], u0: number, v0: number, u1: number, v1: number): void => {
        into.push(modelToThree(fromPlaneUv(plane, { x: u0, y: v0 })));
        into.push(modelToThree(fromPlaneUv(plane, { x: u1, y: v1 })));
    };

    // Sub-lines first so that where both pitches coincide the module line is the one drawn
    // last and wins the depth tie.
    if (sub > 0) {
        for (const u of ticks(bounds.uMin, bounds.uMax, sub)) {
            if (u % MODULE_MM === 0) continue;
            push(subPoints, u, bounds.vMin, u, bounds.vMax);
        }
        for (const v of ticks(bounds.vMin, bounds.vMax, sub)) {
            if (v % MODULE_MM === 0) continue;
            push(subPoints, bounds.uMin, v, bounds.uMax, v);
        }
    }

    for (const u of ticks(bounds.uMin, bounds.uMax, MODULE_MM)) {
        if (u === 0) continue;
        push(modulePoints, u, bounds.vMin, u, bounds.vMax);
    }
    for (const v of ticks(bounds.vMin, bounds.vMax, MODULE_MM)) {
        if (v === 0) continue;
        push(modulePoints, bounds.uMin, v, bounds.uMax, v);
    }

    // The two axes through the origin, coloured, so orientation is never ambiguous mid-orbit.
    //
    // Coloured by the **world** axis each one runs along, not by which of the plane's own two
    // axes it is. On a wall's vertical plane the second axis is world Z, and drawing it in the
    // ground plane's "second axis" colour would say green where every other part of the UI
    // says blue for vertical. Same table as the inference locks, for the same reason.
    push(axisXPoints, bounds.uMin, 0, bounds.uMax, 0);
    push(axisYPoints, 0, bounds.vMin, 0, bounds.vMax);
    const uColor = THEME.lock[lockAxisOf(plane, { x: 1, y: 0 }) as LockAxis];
    const vColor = THEME.lock[lockAxisOf(plane, { x: 0, y: 1 }) as LockAxis];

    if (subPoints.length > 0) {
        group.add(lineSegments(subPoints, THEME.grid.sub, THEME.grid.subOpacity));
    }
    group.add(lineSegments(modulePoints, THEME.grid.module, THEME.grid.moduleOpacity));
    group.add(lineSegments(axisXPoints, uColor, 1));
    group.add(lineSegments(axisYPoints, vColor, 1));

    return group;
}

/** Multiples of `pitch` within `[min, max]`, so a bounded grid still lands on the global grid. */
function ticks(min: number, max: number, pitch: number): number[] {
    const out: number[] = [];
    for (let t = Math.ceil(min / pitch) * pitch; t <= max; t += pitch) out.push(t);
    return out;
}

function lineSegments(points: THREE.Vector3[], color: number, opacity: number): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        // The grid is a reference surface, not an object in the scene: writing depth would let
        // it occlude framing that sits exactly on it (a bottom plate at z = 0, for instance).
        depthWrite: false,
    });
    return new THREE.LineSegments(geometry, material);
}
