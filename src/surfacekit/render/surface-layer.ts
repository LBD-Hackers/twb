/**
 * Renders the authored surfaces — the massing model the user actually draws.
 *
 * Surfaces are drawn translucent with a solid edge, for the same reason mep renders its
 * building envelope that way: the whole point of the tool is to see the framing generated
 * *inside* these surfaces, and an opaque wall would hide it entirely. The edge carries the
 * shape; the fill just says "there is a surface here".
 *
 * Every face is the same neutral colour until the kind filter is on. That is the visual half
 * of the model's rule that a face does not know what it is (`model/surface.ts`): the tint is
 * a *read-out* of `classify.ts`, applied on request, so the user can check the classification
 * at a glance and switch it off again to draw without the noise.
 *
 * Geometry is built by triangulating the boundary in the surface's own frame, which handles
 * the concave floors and gable-topped walls that a naive fan triangulation gets wrong, and the
 * openings are cut out of the triangulation itself — so a raycast through a window misses the
 * wall, as it must for the rectangle and push/pull tools to reach what is behind.
 */

import * as THREE from 'three';
import {
    openingRing3,
    surfaceFrame,
    type Surface,
    type SurfaceId,
    type SurfaceKind,
} from '../model';
import { toFrameUv } from '../core';
import { modelToThree } from './frame';
import { THEME } from './theme';

export interface SurfaceLayerOptions {
    selectedId: SurfaceId | null;
    /** A selection of several faces, drawn the way a single selected one is. */
    selectedIds?: ReadonlySet<SurfaceId>;
    /** From `classifyAll`. Only read when `colorByKind` is on. */
    kinds: ReadonlyMap<SurfaceId, SurfaceKind>;
    colorByKind: boolean;
    /**
     * Drawn faint, fill and edges both — the model as a backdrop while something else is being
     * drawn over it (roof mode's draft), there to snap to and not to compete with it.
     */
    dimmed?: boolean;
    /**
     * The faces of one colour drawn as one mesh, for a view nothing is picked in: a big house's
     * thousands of faces are a handful of draw calls. `Viewport.pickSurface` finds no face in it.
     */
    merged?: boolean;
}

/** Fill colours, keyed by surface kind. */
export function kindColor(kind: SurfaceKind): number {
    switch (kind) {
        case 'floor':
            return THEME.surface.floor;
        case 'wall':
            return THEME.surface.wall;
        case 'roof':
            return THEME.surface.roof;
    }
}

/**
 * Fills `target` with every surface. The caller disposes the previous contents.
 *
 * Each mesh carries its `surfaceId` in `userData` so `Viewport.pickSurface` can read it
 * straight off a raycast hit — the same trick mep uses for zone picking. Merged
 * (`options.merged`), a mesh is all the faces of one colour and opacity, and carries none.
 */
export function renderSurfaces(
    target: THREE.Group,
    surfaces: readonly Surface[],
    options: SurfaceLayerOptions
): void {
    // Every outline of one colour goes into one `LineSegments`: a big model's thousands of faces
    // and openings would otherwise be as many draw calls again as there are faces.
    const edges = new Map<number, number[]>();
    const addRing = (ringMm: readonly { x: number; y: number; z: number }[], color: number) => {
        const out = edges.get(color) ?? [];
        edges.set(color, out);
        const points = ringMm.map(modelToThree);
        points.forEach((a, i) => {
            const b = points[(i + 1) % points.length]!;
            out.push(a.x, a.y, a.z, b.x, b.y, b.z);
        });
    };
    const fills = new Map<THREE.MeshLambertMaterial, Triangles[]>();
    for (const surface of surfaces) {
        const selected =
            surface.id === options.selectedId || (options.selectedIds?.has(surface.id) ?? false);
        const color = options.colorByKind
            ? kindColor(options.kinds.get(surface.id) ?? 'wall')
            : THEME.surface.neutral;
        const dimmed = options.dimmed ?? false;
        const triangles = surfaceTriangles(surface);
        const material = fillMaterial(
            color,
            dimmed
                ? THEME.surface.opacityDimmed
                : selected
                  ? THEME.surface.opacitySelected
                  : THEME.surface.opacity
        );
        if (triangles && options.merged) {
            fills.set(material, [...(fills.get(material) ?? []), triangles]);
        } else if (triangles) {
            const mesh = new THREE.Mesh(geometryOf([triangles]), material);
            mesh.userData['surfaceId'] = surface.id;
            target.add(mesh);
        }
        const edge = dimmed
            ? THEME.surface.edgeDimmed
            : selected
              ? THEME.surface.edgeSelected
              : THEME.surface.edge;
        addRing(surface.boundaryMm, edge);
        const frame = surfaceFrame(surface.boundaryMm);
        if (frame) {
            for (const hole of surface.openings) {
                addRing(openingRing3(frame, hole), THEME.surface.hole);
            }
        }
        // An inner ring is an edge of its face, drawn like one; filled, the face in it draws it
        // too, and open it is the edge of a hole.
        for (const ring of surface.holes) {
            addRing(ring, selected ? THEME.surface.edgeSelected : THEME.surface.edge);
        }
    }
    for (const [material, parts] of fills) target.add(new THREE.Mesh(geometryOf(parts), material));
    for (const [color, positions] of edges) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        target.add(new THREE.LineSegments(geometry, lineMaterial(color)));
    }
}

/**
 * The materials, one per colour and opacity, shared by every face drawn in them. A layer's
 * clearing disposes its geometry only (`disposeGroupChildren`), so a material of its own per
 * face would be made anew, and kept, on every redraw.
 */
const fillMaterials = new Map<string, THREE.MeshLambertMaterial>();
const lineMaterials = new Map<number, THREE.LineBasicMaterial>();

function fillMaterial(color: number, opacity: number): THREE.MeshLambertMaterial {
    const key = `${color}/${opacity}`;
    const known = fillMaterials.get(key);
    if (known) return known;
    const material = new THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity,
        // A thin surface is viewed from both sides constantly during an orbit; backface
        // culling would make half the model vanish depending on winding direction.
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    fillMaterials.set(key, material);
    return material;
}

function lineMaterial(color: number): THREE.LineBasicMaterial {
    const known = lineMaterials.get(color);
    if (known) return known;
    const material = new THREE.LineBasicMaterial({ color });
    lineMaterials.set(color, material);
    return material;
}

/** A face's triangles: its corners, in three's frame, and the corners each triangle runs round. */
interface Triangles {
    positions: number[];
    indices: number[];
}

function surfaceTriangles(surface: Surface): Triangles | null {
    const frame = surfaceFrame(surface.boundaryMm);
    if (!frame) return null;

    // Triangulate in the surface's own 2D frame. THREE.ShapeUtils.triangulateShape handles
    // concave outlines (an L-shaped floor, a gable wall) that a triangle fan would fold over,
    // and takes the openings as hole contours in the same frame.
    const toVec2 = (p: { x: number; y: number }): THREE.Vector2 => new THREE.Vector2(p.x, p.y);
    const contour = surface.boundaryMm.map((p) => toVec2(toFrameUv(frame, p)));
    const holeRings = [
        ...surface.openings.map((hole) => openingRing3(frame, hole)),
        ...surface.holes,
    ];
    const holes = holeRings.map((ring) => ring.map((p) => toVec2(toFrameUv(frame, p))));
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    if (faces.length === 0) return null;

    // Indices from `triangulateShape` run over the contour followed by each hole in turn.
    const positions: number[] = [];
    for (const p of [...surface.boundaryMm, ...holeRings.flat()]) {
        const v = modelToThree(p);
        positions.push(v.x, v.y, v.z);
    }
    const indices: number[] = [];
    for (const face of faces) indices.push(face[0]!, face[1]!, face[2]!);
    return { positions, indices };
}

/** One geometry of the faces' triangles, each face's corners its own. */
function geometryOf(parts: readonly Triangles[]): THREE.BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    for (const part of parts) {
        const base = positions.length / 3;
        for (const p of part.positions) positions.push(p);
        for (const i of part.indices) indices.push(base + i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}
