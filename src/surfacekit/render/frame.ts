/**
 * The one conversion between arch's model frame and three.js.
 *
 * Model frame: integer **millimetres**, **Z-up**, X east / Y north — identical to the IFC
 * frame, which is why `ifc/` contains no axis maths at all.
 * three.js frame: **metres**, **Y-up**, as WebGL conventionally is.
 *
 * Millimetres would work as scene units too, but metres keep the camera's near/far plane
 * ratio, the OrbitControls damping distances and the depth buffer in the range three.js is
 * tuned for — a 5000-unit far plane means 5 km in metres and 5 m in millimetres.
 *
 * The composed mapping is `(x, y, z) -> (x/1000, z/1000, -y/1000)`, which is the same world
 * convention `mep` uses (world X = IFC X, world Y = IFC Z, world Z = -IFC Y), so the two apps
 * agree on orientation and a model looks the same dropped into either.
 *
 * **Every** mm->m conversion in the app goes through this file. If a division by 1000 appears
 * anywhere else, that is the bug.
 */

import * as THREE from 'three';
import type { Dir3, Point3Mm } from '../core';

export const MM_PER_M = 1000;

export function modelToThree(p: Point3Mm): THREE.Vector3 {
    return new THREE.Vector3(p.x / MM_PER_M, p.z / MM_PER_M, -p.y / MM_PER_M);
}

/** In-place variant, for hot paths that must not allocate a Vector3 per point. */
export function modelToThreeInto(p: Point3Mm, out: THREE.Vector3): THREE.Vector3 {
    return out.set(p.x / MM_PER_M, p.z / MM_PER_M, -p.y / MM_PER_M);
}

export function threeToModel(v: THREE.Vector3): Point3Mm {
    return { x: v.x * MM_PER_M, y: -v.z * MM_PER_M, z: v.y * MM_PER_M };
}

/**
 * Direction vectors carry no units, so they are rotated but not scaled. Dividing a direction
 * by 1000 would still normalize to the same vector, but only after a needless round trip
 * through denormal territory — and it reads as a units error to anyone auditing this file.
 */
export function dirToThree(d: Dir3): THREE.Vector3 {
    return new THREE.Vector3(d.x, d.z, -d.y);
}

export function threeDirToModel(v: THREE.Vector3): Dir3 {
    return { x: v.x, y: -v.z, z: v.y };
}

export function mmToM(mm: number): number {
    return mm / MM_PER_M;
}
