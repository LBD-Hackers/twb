/**
 * The view cube in the 3D viewport's bottom-right corner: a small cube that turns with the
 * camera, and a click on it turns the camera to look from there.
 *
 * Each face is cut three by three, the way Autodesk's ViewCube is: the middle of a face looks
 * square onto it (top, an elevation), a strip along an edge looks from between the two faces
 * that share it, and a corner gives the three-quarter view from that corner. An edge or a
 * corner is one place on the cube even though it is drawn on two or three faces, so hovering
 * any part of it lights all of them.
 *
 * Drawn with CSS 3D transforms rather than a second WebGL scene: the labels stay crisp text the
 * app's DOM translation reaches, every cell is its own hit target with no picking to write, and
 * it costs no second GL context in a page that may hold several viewports. It styles itself
 * (the viewport can be mounted in a shadow root that the app's stylesheet does not reach),
 * from the app's theme variables when they are there.
 *
 * Like Revit's (#255) it is drawn in perspective, so its far side shrinks towards a vanishing
 * point and it reads as a solid rather than a flat drawing. It hovers just above a table and casts
 * a soft square shadow on it, which turns with the cube and is gone when the view is from below
 * (#257). Its labels are Revit's too: bold capitals in a plain sans, the word nearly face-wide.
 * Seen square onto one face — Front, say — only that face shows, so no other is a click away:
 * then, while the pointer is over the cube, four small arrows appear round it, each turning the
 * view 90° onto the face beyond that side, in one click.
 *
 * Directions are in three's frame (Y up), from the target towards the camera; model "front" is
 * the side facing model −y, i.e. three +Z.
 */

import * as THREE from 'three';

/** Edge length of the cube, CSS px. */
const SIZE = 52;
/** Width of the edge strips cut from each face, CSS px. */
const EDGE = 10;
/** The face labels' size, CSS px: "BOTTOM" in bold capitals nearly as wide as a face. */
const LABEL_PX = 11;
/** The least room a label keeps from the face's sides, CSS px. */
const LABEL_MARGIN = 5;
/** How far below the cube its shadow lies, how much wider than it, and how soft, CSS px. */
const SHADOW_DROP = SIZE * 0.11;
const SHADOW_GROW = SIZE * 0.06;
const SHADOW_BLUR = 3;
/** The control's box: the cube, with room round it for the arrows, CSS px. */
const BOX = Math.round(SIZE * 2.3);
/** How far the eye stands from the cube, CSS px: near enough for its far side to shrink. */
const PERSPECTIVE = SIZE * 4;
/** How square onto a face the view must be for the arrows to show: the cosine of the angle off it. */
const FACE_ON = 0.999;

type Side = 'up' | 'down' | 'left' | 'right';

/** The four arrows round the cube: where each sits, and how its triangle is turned to point in. */
const ARROWS: readonly { side: Side; dx: number; dy: number; rotate: number }[] = [
    { side: 'up', dx: 0, dy: -1, rotate: 0 },
    { side: 'down', dx: 0, dy: 1, rotate: 180 },
    { side: 'left', dx: -1, dy: 0, rotate: -90 },
    { side: 'right', dx: 1, dy: 0, rotate: 90 },
];

interface FaceSpec {
    label: string;
    /** Outward normal. */
    n: readonly [number, number, number];
    /** The face's own right and up as its label reads, seen from outside the cube. */
    r: readonly [number, number, number];
    u: readonly [number, number, number];
}

const FACES: readonly FaceSpec[] = [
    { label: 'Front', n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
    { label: 'Back', n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0] },
    { label: 'Right', n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0] },
    { label: 'Left', n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0] },
    // Top reads with Front at its foot, Bottom with Front at its head — as they unfold.
    { label: 'Top', n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1] },
    { label: 'Bottom', n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] },
];

const STYLE = `
.nav-cube {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 2;
    width: ${BOX}px;
    height: ${BOX}px;
    user-select: none;
    -webkit-user-select: none;
}
.nav-cube[hidden] { display: none; }
.nav-cube-stage {
    position: absolute;
    inset: 0;
    pointer-events: none;
    perspective: ${PERSPECTIVE}px;
    perspective-origin: 50% 50%;
}
.nav-cube-shadow {
    position: absolute;
    inset: ${-SHADOW_GROW}px;
    background: rgba(0, 0, 0, 0.22);
    filter: blur(${SHADOW_BLUR}px);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    pointer-events: none;
}
.nav-cube-body {
    position: absolute;
    left: 50%;
    top: 50%;
    width: ${SIZE}px;
    height: ${SIZE}px;
    margin: ${-SIZE / 2}px 0 0 ${-SIZE / 2}px;
    transform-style: preserve-3d;
    pointer-events: auto;
}
.nav-cube-arrow {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms;
    color: var(--muted, #5f6368);
}
.nav-cube.is-face-on:hover .nav-cube-arrow,
.nav-cube.is-face-on .nav-cube-arrow:focus-visible {
    opacity: 1;
    pointer-events: auto;
}
.nav-cube-arrow:hover { color: var(--accent, #3f4e4f); }
.nav-cube-arrow svg { display: block; width: 100%; height: 100%; }
.nav-cube-face {
    position: absolute;
    inset: 0;
    display: grid;
    /* minmax(0, …): the middle never grows with what is in it, so the edge strips stay put. */
    grid-template-columns: ${EDGE}px minmax(0, 1fr) ${EDGE}px;
    grid-template-rows: ${EDGE}px minmax(0, 1fr) ${EDGE}px;
    box-sizing: border-box;
    border: 1px solid var(--border, #c9ccd1);
    background: color-mix(in srgb, var(--panel, #ffffff) 92%, transparent);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
}
.nav-cube-cell {
    cursor: pointer;
}
.nav-cube-cell.is-hot {
    background: color-mix(in srgb, var(--accent, #3f4e4f) 35%, transparent);
}
/* The face's word, laid over the whole face and centred on it, not in the middle cell. */
.nav-cube-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}
.nav-cube-word {
    display: inline-block;
    white-space: nowrap;
    /* Revit's labels: bold capitals in a plain sans, dark grey. */
    font: 700 ${LABEL_PX}px/1 Arial, 'Segoe UI', 'Helvetica Neue', Helvetica, sans-serif;
    letter-spacing: -0.2px;
    color: #3c4043;
    text-transform: uppercase;
}
`;

/** CSS's y runs down where three's runs up; everything else matches. */
function flipY(v: readonly [number, number, number]): [number, number, number] {
    return [v[0], -v[1], v[2]];
}

/** The table under the cube, as a plane facing up, reading like Top. */
const SHADOW_PLANE: Pick<FaceSpec, 'n' | 'r' | 'u'> = { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1] };

/**
 * A plane's CSS transform: its own x right, y down and z out onto the cube's axes, column by
 * column, its centre moved to `at` (three's frame, from the cube's middle).
 */
function planeTransform(
    plane: Pick<FaceSpec, 'n' | 'r' | 'u'>,
    at: readonly [number, number, number]
): string {
    const [rx, ry, rz] = flipY(plane.r);
    const [ux, uy, uz] = flipY(plane.u);
    const [nx, ny, nz] = flipY(plane.n);
    const [tx, ty, tz] = flipY(at);
    // prettier-ignore
    return `matrix3d(${[
        rx, ry, rz, 0,
        -ux, -uy, -uz, 0,
        nx, ny, nz, 0,
        tx, ty, tz, 1,
    ].join(',')})`;
}

/** The axis nearest a direction, as a unit vector. */
function snapToAxis(v: THREE.Vector3): THREE.Vector3 {
    const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
    const i = a.indexOf(Math.max(...a));
    return new THREE.Vector3().setComponent(i, Math.sign(v.getComponent(i)) || 1);
}

/** A cell's direction as a key, so the cells of one edge or corner find each other. */
function keyOf(d: THREE.Vector3): string {
    return `${Math.round(d.x)},${Math.round(d.y)},${Math.round(d.z)}`;
}

export class NavCube {
    readonly element: HTMLDivElement;
    private readonly body: HTMLDivElement;
    private readonly cells = new Map<string, HTMLElement[]>();
    private readonly inverse = new THREE.Quaternion();
    private readonly matrix = new THREE.Matrix4();
    private readonly arrows = new Map<Side, HTMLButtonElement>();
    /** What keeps each label fitted to its face. */
    private readonly watchers: ResizeObserver[] = [];
    /** Where each arrow turns the view to, while the view is square onto a face. */
    private readonly arrowTargets = new Map<Side, THREE.Vector3>();

    /** `onPick` gets the unit direction, three frame, from the target to where the camera goes. */
    constructor(
        host: HTMLElement,
        private readonly onPick: (direction: THREE.Vector3) => void
    ) {
        this.element = document.createElement('div');
        this.element.className = 'nav-cube';
        const style = document.createElement('style');
        style.textContent = STYLE;
        this.body = document.createElement('div');
        this.body.className = 'nav-cube-body';
        const stage = document.createElement('div');
        stage.className = 'nav-cube-stage';
        stage.append(this.body);
        this.element.append(style, stage);

        // The shadow: a soft square on the table the cube hovers just above, facing up — so it
        // turns with the cube, and seen from under the table it is not there.
        const shadow = document.createElement('div');
        shadow.className = 'nav-cube-shadow';
        shadow.style.transform = planeTransform(SHADOW_PLANE, [0, -(SIZE / 2 + SHADOW_DROP), 0]);
        this.body.appendChild(shadow);

        // The arrows, a little out from the cube's sides, pointing in at it as Revit's do.
        // Square onto a face, that face is nearer the eye than the middle, so drawn larger: clear it.
        const reach = (SIZE / 2) * (PERSPECTIVE / (PERSPECTIVE - SIZE / 2)) + 20;
        for (const a of ARROWS) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `nav-cube-arrow is-${a.side}`;
            button.style.transform = `translate(${a.dx * reach}px, ${a.dy * reach}px) rotate(${a.rotate}deg)`;
            // A triangle pointing down; turned, it points in at the cube from its side.
            button.innerHTML =
                '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4 L14 4 L8 12 Z" fill="currentColor"/></svg>';
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const target = this.arrowTargets.get(a.side);
                if (target) this.onPick(target.clone());
            });
            this.arrows.set(a.side, button);
            this.element.appendChild(button);
        }

        const half = SIZE / 2;
        for (const face of FACES) {
            const el = document.createElement('div');
            el.className = 'nav-cube-face';
            el.style.transform = planeTransform(face, [
                face.n[0] * half,
                face.n[1] * half,
                face.n[2] * half,
            ]);
            const n = new THREE.Vector3(...face.n);
            const r = new THREE.Vector3(...face.r);
            const u = new THREE.Vector3(...face.u);
            for (let row = -1; row <= 1; row++) {
                for (let col = -1; col <= 1; col++) {
                    const dir = n.clone().addScaledVector(r, col).addScaledVector(u, -row);
                    const key = keyOf(dir);
                    const cell = document.createElement('div');
                    cell.className = 'nav-cube-cell';
                    if (row === 0 && col === 0) cell.title = `${face.label} view`;
                    cell.addEventListener('pointerenter', () => this.light(key, true));
                    cell.addEventListener('pointerleave', () => this.light(key, false));
                    cell.addEventListener('click', (event) => {
                        event.stopPropagation();
                        this.onPick(dir.clone().normalize());
                    });
                    el.appendChild(cell);
                    const group = this.cells.get(key);
                    if (group) group.push(cell);
                    else this.cells.set(key, [cell]);
                }
            }
            el.appendChild(this.label(face.label));
            this.body.appendChild(el);
        }
        // The cube is a control over the canvas, not part of the scene: no press on it may reach
        // whatever listens for drawing clicks further up.
        this.element.addEventListener('pointerdown', (event) => event.stopPropagation());
        this.element.addEventListener('contextmenu', (event) => event.preventDefault());
        host.appendChild(this.element);
    }

    /** Turns the cube to show the model's axes as `camera` sees them. */
    update(camera: THREE.Camera): void {
        // The view's rotation is the inverse of the camera's, conjugated by the y flip into CSS.
        this.inverse.copy(camera.quaternion).invert();
        const e = this.matrix.makeRotationFromQuaternion(this.inverse).elements;
        // `elements` is column-major, as matrix3d is; S·R·S negates the y row and the y column.
        // prettier-ignore
        const m = [
            e[0], -e[1], e[2], 0,
            -e[4], e[5], -e[6], 0,
            e[8], -e[9], e[10], 0,
            0, 0, 0, 1,
        ];
        this.body.style.transform = `matrix3d(${m.map((v) => v.toFixed(6)).join(',')})`;
        this.updateArrows(camera);
    }

    /**
     * Square onto a face, each arrow turns the view onto the face beyond its side of the screen:
     * the one up the screen, down it, to its left and to its right. Off square, they hide.
     */
    private updateArrows(camera: THREE.Camera): void {
        const q = camera.quaternion;
        const toCamera = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
        const faceOn =
            Math.max(Math.abs(toCamera.x), Math.abs(toCamera.y), Math.abs(toCamera.z)) >= FACE_ON;
        this.element.classList.toggle('is-face-on', faceOn);
        this.arrowTargets.clear();
        if (!faceOn) return;
        const up = snapToAxis(new THREE.Vector3(0, 1, 0).applyQuaternion(q));
        const right = snapToAxis(new THREE.Vector3(1, 0, 0).applyQuaternion(q));
        const targets: Record<Side, THREE.Vector3> = {
            up,
            down: up.clone().negate(),
            right,
            left: right.clone().negate(),
        };
        for (const a of ARROWS) {
            const dir = targets[a.side];
            this.arrowTargets.set(a.side, dir);
            const face = FACES.find((f) => keyOf(new THREE.Vector3(...f.n)) === keyOf(dir));
            const button = this.arrows.get(a.side);
            if (button && face) button.title = `${face.label} view`;
        }
    }

    setVisible(visible: boolean): void {
        this.element.hidden = !visible;
    }

    dispose(): void {
        for (const watch of this.watchers) watch.disconnect();
        this.element.remove();
    }

    /**
     * A face's word, centred on the face and shrunk to fit inside it with a margin — whatever the
     * word, in whatever language the app's DOM translation turns it into, which is why its width
     * is watched rather than worked out once.
     */
    private label(text: string): HTMLElement {
        const word = document.createElement('span');
        word.className = 'nav-cube-word';
        word.textContent = text;
        const fit = (): void => {
            const width = word.offsetWidth;
            const room = SIZE - 2 * LABEL_MARGIN;
            word.style.transform = width > room ? `scale(${(room / width).toFixed(3)})` : '';
        };
        if (typeof ResizeObserver !== 'undefined') {
            const watch = new ResizeObserver(fit);
            watch.observe(word);
            this.watchers.push(watch);
        }
        const out = document.createElement('div');
        out.className = 'nav-cube-label';
        out.appendChild(word);
        return out;
    }

    private light(key: string, on: boolean): void {
        for (const cell of this.cells.get(key) ?? []) cell.classList.toggle('is-hot', on);
    }
}
