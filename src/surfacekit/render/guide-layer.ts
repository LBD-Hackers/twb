/**
 * Renders the lines: the dashed guides the Line tool leaves behind until they close a face,
 * and the ones the user has since declared a column or a beam.
 *
 * Three batched `LineSegments` rather than one — dashed guides, columns, beams — because the
 * distinction is the whole point of the role: a violet dashed line is scratch that Purge will
 * take, a solid timber-coloured one is a piece that will be built. Drawn over the scene like
 * the overlay is: a construction mark a face in front can hide is one the user will draw twice.
 * Rebuilt whenever the guide list or the selection changes, which is rare and cheap — a line is
 * two vertices.
 *
 * The selected line is drawn once more on top in the selection blue, the same signal a selected
 * face's edges get, so "which line am I about to make a column" needs no second read-out. A
 * selected face edge is drawn the same way here, since it is a line being talked about too.
 */

import * as THREE from 'three';
import type { Point3Mm } from '../core';
import { isStructuralLine, type Guide, type GuideId } from '../model';
import { modelToThree } from './frame';
import { THEME } from './theme';

export function renderGuides(
    target: THREE.Group,
    guides: readonly Guide[],
    selectedId: GuideId | null = null,
    /** A face's edge, when the selection is one — drawn like a selected line. */
    selectedEdge: readonly [Point3Mm, Point3Mm] | null = null,
    /** A selection of several lines, drawn the way a single selected one is. */
    selectedIds: ReadonlySet<GuideId> = new Set()
): void {
    if (selectedEdge) {
        const [aMm, bMm] = selectedEdge;
        const line = new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints([modelToThree(aMm), modelToThree(bMm)]),
            new THREE.LineBasicMaterial({
                color: THEME.surface.edgeSelected,
                depthTest: false,
                transparent: true,
            })
        );
        line.renderOrder = 997;
        target.add(line);
    }
    if (guides.length === 0) return;

    const scratch = guides.filter((g) => !isStructuralLine(g));
    if (scratch.length > 0) {
        const lines = new THREE.LineSegments(
            geometryOf(scratch),
            new THREE.LineDashedMaterial({
                color: THEME.guide.line,
                dashSize: 0.16,
                gapSize: 0.08,
                depthTest: false,
                transparent: true,
                opacity: THEME.guide.opacity,
            })
        );
        lines.computeLineDistances();
        // Under the draft overlay, over the faces — see `overlay-layer.ts` on why `transparent`.
        lines.renderOrder = 996;
        target.add(lines);
    }

    for (const [role, color] of [
        ['column', THEME.timber.column],
        ['beam', THEME.timber.beam],
    ] as const) {
        const members = guides.filter((g) => g.role === role);
        if (members.length === 0) continue;
        const lines = new THREE.LineSegments(
            geometryOf(members),
            new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true })
        );
        lines.renderOrder = 996;
        target.add(lines);
    }

    const selected = guides.filter((g) => g.id === selectedId || selectedIds.has(g.id));
    if (selected.length > 0) {
        const lines = new THREE.LineSegments(
            geometryOf(selected),
            new THREE.LineBasicMaterial({
                color: THEME.surface.edgeSelected,
                depthTest: false,
                transparent: true,
            })
        );
        lines.renderOrder = 997;
        target.add(lines);
    }
}

function geometryOf(guides: readonly Guide[]): THREE.BufferGeometry {
    return new THREE.BufferGeometry().setFromPoints(
        guides.flatMap((g) => [modelToThree(g.aMm), modelToThree(g.bMm)])
    );
}
