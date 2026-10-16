/**
 * The planar quads one interior-wall segment on one storey expands into — the shared core of the
 * interactive Interior Wall tool (a modeller's `commitInteriorWallRun`, the caller behind
 * `interaction/interior-wall-tool.ts`) and of expanding a house file's `interiorWalls` on load
 * (`house/load.ts`'s `buildInteriorWalls`), so a run built by a click and a run read from a
 * file are turned into the same faces the same way.
 *
 * A partition stands on its own storey only, and by default it runs up to the floor of the
 * storey above or, with none above, to the roof (`roofTopProfile`), splitting into as many quads
 * as it takes to follow the roof through a ridge, hip or valley rather than cutting a single
 * plane between the segment's two endpoints. Under a storey above, the roof still lowers it
 * wherever the roof comes down under that floor (a one-storey wing beside a two-storey one).
 * A ceiling (`ceilingMm`) is the exception: the wall stops flat under it wherever the roof or
 * the floor above would have taken it higher.
 */

import type { Point3Mm } from '../core';
import { sortStoreys, type Storey } from './storey';
import type { Surface } from './surface';
import { roofTopProfile, type RoofProfilePoint } from './roof-height';

export interface InteriorWallPiece {
    ringMm: Point3Mm[];
    /** False when a roof crossing split the segment into more than one piece. */
    singlePiece: boolean;
}

export interface InteriorWallOptions {
    /** A ceiling over the wall, mm above the storey's floor. Absent: the floor above, or the roof. */
    ceilingMm?: number;
}

/** `storeys` is every storey in the model; the wall stands on `storey`. */
export function interiorWallSegmentRings(
    surfaces: readonly Surface[],
    storeys: readonly Storey[],
    storey: Storey,
    a: { x: number; y: number },
    b: { x: number; y: number },
    options: InteriorWallOptions = {}
): InteriorWallPiece[] {
    const nominalTopMm = storey.elevationMm + storey.heightMm;
    const hasStoreyAbove = sortStoreys(storeys).some((s) => s.elevationMm > storey.elevationMm + 1);
    const caps: number[] = [];
    if (hasStoreyAbove) caps.push(nominalTopMm);
    if (options.ceilingMm !== undefined) caps.push(storey.elevationMm + options.ceilingMm);
    const roof = roofTopProfile(surfaces, a, b, storey.elevationMm, nominalTopMm);
    const profile = caps.length > 0 ? capProfile(roof, Math.min(...caps)) : roof;
    // Splitting into more than one piece only ever happens under a roof whose planes change
    // partway across the run, at whatever plan position that crossing falls — module-grid
    // lengths are not guaranteed for those interior pieces the way they are for the run as
    // drawn, so only a single, unsplit piece is still eligible for grid enforcement.
    const singlePiece = profile.length === 2;
    const pieces: InteriorWallPiece[] = [];
    for (let k = 0; k + 1 < profile.length; k++) {
        const p0 = profile[k]!;
        const p1 = profile[k + 1]!;
        pieces.push({
            ringMm: [
                { x: p0.x, y: p0.y, z: storey.elevationMm },
                { x: p1.x, y: p1.y, z: storey.elevationMm },
                { x: p1.x, y: p1.y, z: p1.z },
                { x: p0.x, y: p0.y, z: p0.z },
            ],
            singlePiece,
        });
    }
    return pieces;
}

/**
 * A top edge held down to `capZ`: a corner where it crosses the cap, and one flat stretch
 * wherever it would have run above it (so a ceiling under a ridge leaves one rectangle).
 */
function capProfile(profile: readonly RoofProfilePoint[], capZ: number): RoofProfilePoint[] {
    const capped: RoofProfilePoint[] = [];
    for (let k = 0; k < profile.length; k++) {
        const p0 = profile[k]!;
        capped.push({ ...p0, z: Math.min(p0.z, capZ) });
        const p1 = profile[k + 1];
        if (p1 && (p0.z - capZ) * (p1.z - capZ) < 0) {
            const t = (capZ - p0.z) / (p1.z - p0.z);
            capped.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, z: capZ });
        }
    }
    const atCap = (p: RoofProfilePoint) => Math.abs(p.z - capZ) < 1;
    return capped.filter(
        (p, i) =>
            i === 0 ||
            i === capped.length - 1 ||
            !(atCap(capped[i - 1]!) && atCap(p) && atCap(capped[i + 1]!))
    );
}
