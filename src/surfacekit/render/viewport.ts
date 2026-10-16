/**
 * The 3D viewport: scene, camera, orbit controls, render loop, and the pointer plumbing the
 * drawing tools sit on top of.
 *
 * Follows `mep/src/render/scene3d.ts` for the parts that are the same problem — renderer
 * setup, `ResizeObserver`-driven resize, render-on-mutation rather than a free-running loop,
 * and the disposal discipline that keeps an editing session from leaking geometry. It
 * diverges in one important way: mep's 3D view is read-only, so `OrbitControls` owns the
 * pointer outright. arch *draws* in 3D, so the left button belongs to the tools.
 *
 * **Navigation is a first-class tool, not a mouse-button trick.** Reserving the left button
 * for drawing and leaving orbit on the middle button alone makes the view immovable on any
 * machine without a middle button — a laptop trackpad, most obviously — and a view you cannot
 * turn reads as a fixed isometric picture rather than a 3D world. So there are three ways in,
 * exactly as SketchUp has: an explicit Orbit/Pan tool (`setNavMode`) that takes over the left
 * button, modifier chords that work under any tool (alt-drag orbits, alt+shift-drag pans), and
 * the middle/right buttons for anyone who has them. The camera itself is unconstrained — full
 * polar range, so the model can be viewed from below like any other orbit world.
 *
 * Every chord is gated on Alt because plain Shift belongs to the drawing tools, where it forces
 * the axis lock on; a modifier cannot serve both, since a shift-pan chord also swallows the
 * shift-click that places a point on the locked axis.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NavCube } from './nav-cube';
import type { Dir3, Point3Mm } from '../core';
import type { PixelPos } from '../interaction';
import { MM_PER_M, modelToThree, threeDirToModel, threeToModel } from './frame';
import { THEME } from './theme';

/**
 * Click-vs-drag threshold in CSS pixels.
 *
 * A browser fires `click` after a press-drag-release as long as it starts and ends on the same
 * element, so a listener on the canvas fires after every orbit too. mep documents hitting this
 * exactly; arch inherits the fix — track `pointerdown`/`pointerup` positions and treat the
 * release as a click only when the pointer barely moved.
 */
const CLICK_DRAG_TOLERANCE_PX = 4;

/**
 * What the left button does.
 *
 * `'off'` gives it to the active drawing tool; the other two make it a navigation handle. A
 * mode rather than a boolean because orbit and pan are genuinely different verbs and the user
 * picks between them — the same choice SketchUp's toolbar offers.
 */
export type NavMode = 'off' | 'orbit' | 'pan';

/**
 * Cursors that say which verb the left button currently has. In `'off'` the drawing tool owns
 * the pointer and supplies its own shape via `setToolCursor`.
 */
const NAV_CURSORS: Record<Exclude<NavMode, 'off'>, string> = {
    orbit: 'all-scroll',
    pan: 'grab',
};

export type { PixelPos };

/** A pointer ray in the model frame (mm, Z-up), ready for `rayToPlane`. */
export interface ModelRay {
    originMm: Point3Mm;
    dir: Dir3;
    /**
     * Where on the canvas the ray came from.
     *
     * Carried along because some inferences are only correct in screen space: whether the
     * cursor is "on" the world vertical is a question about what the user can see, and a
     * world-space tolerance answers a different question — one whose answer changes with
     * perspective foreshortening as the point travels away from the eye.
     */
    pixel: PixelPos;
}

/** A face under the cursor, from `Viewport.pickSurface`. */
export interface SurfacePick {
    surfaceId: string;
    /** Where the ray met the face, model frame, unsnapped. */
    pointMm: Point3Mm;
}

/** A zone volume under the cursor, from `Viewport.pickZone`. */
export interface ZonePick {
    zoneId: string;
    pointMm: Point3Mm;
}

/** A timber member under the cursor, from `Viewport.pickFraming`. */
export interface FramingPick {
    memberId: string;
    /** Where the ray met the member's box, model frame. */
    pointMm: Point3Mm;
}

/**
 * What is under the cursor in Build mode, from `Viewport.pickBuild`: a timber member, or a piece
 * of the envelope stamped with a `pieceId` (a sheet, a cladding board).
 */
export type BuildPick =
    | { kind: 'member'; memberId: string; pointMm: Point3Mm }
    | { kind: 'piece'; pieceId: string; pieceKind: string; pointMm: Point3Mm };

/**
 * A face of anything visible under the cursor, from `Viewport.pickFace`: where the ray met it,
 * and the face's own normal turned towards the eye.
 */
export interface FacePick {
    pointMm: Point3Mm;
    /** Unit, model frame, pointing from the face to the side the camera is on. */
    normal: Dir3;
}

/**
 * A plane the model is cut by, for `Viewport.setSection`: everything on the side `normal`
 * points to is hidden, the rest is drawn.
 */
export interface SectionPlane {
    pointMm: Point3Mm;
    /** Unit, model frame, pointing into the side that is hidden. */
    normal: Dir3;
}

/**
 * How the cut face of one kind of solid is drawn where the section plane passes through it: a
 * tile of hatching laid over the cut, repeated every `SECTION_CAP_TILE_MM`. What the kinds are,
 * and which solid is which, is the profile's to say (`markSectionCap`) — the engine only closes
 * the cut and lays the tile on it.
 */
export interface SectionCapStyle {
    /** The tile, drawn to repeat on all four sides. */
    map: THREE.Texture;
    /**
     * For a kind drawn as one band across each solid's own thickness (`markSectionBand`): the
     * band — its x along the solid, repeating, and its y across the thickness, once. One tile is
     * as long as the solid is thick.
     */
    band?: THREE.Texture;
}

/**
 * A solid that is a slab — a layer between two parallel planes — whose cut face is drawn as one
 * band across its thickness, whatever that is: insulation's row of loops, as wide as the
 * insulation is thick.
 */
export interface SectionBand {
    /** The kind, as for `markSectionCap`. Its style has a `band`. */
    kind: number;
    /** Across the slab, unit, in three's frame. */
    normal: THREE.Vector3;
    /** Where the slab starts along `normal`, in three's units. */
    from: number;
    /** How thick it is, in three's units. */
    thickness: number;
}

/**
 * Says that `object` is a sheet too thin to hatch, whose cut face is drawn as a thick stroke in
 * its kind's fill — a membrane. The band's `kind`, `normal`, `from` and `thickness` say where
 * the sheet is. In place of `markSectionCap`, not beside it.
 */
export function markSectionLine(object: THREE.Object3D, sheet: SectionBand): void {
    object.userData['sectionLine'] = sheet;
}

/**
 * Says that `object` is a slab whose cut face is one band across its thickness. In place of
 * `markSectionCap`, not beside it.
 */
export function markSectionBand(object: THREE.Object3D, band: SectionBand): void {
    object.userData['sectionBand'] = band;
}

/** Draws a band: across the slab's thickness once, along it every thickness. */
function bandMaterial(map: THREE.Texture): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            map: { value: map },
            bandNormal: { value: new THREE.Vector3() },
            bandAlong: { value: new THREE.Vector3() },
            bandFrom: { value: 0 },
            bandThickness: { value: 1 },
        },
        vertexShader: `
            varying vec3 vWorld;
            void main() {
                vec4 world = modelMatrix * vec4(position, 1.0);
                vWorld = world.xyz;
                gl_Position = projectionMatrix * viewMatrix * world;
            }`,
        fragmentShader: `
            uniform sampler2D map;
            uniform vec3 bandNormal;
            uniform vec3 bandAlong;
            uniform float bandFrom;
            uniform float bandThickness;
            varying vec3 vWorld;
            void main() {
                float across = (dot(vWorld, bandNormal) - bandFrom) / bandThickness;
                float run = dot(vWorld, bandAlong) / bandThickness;
                gl_FragColor = texture2D(map, vec2(run, clamp(across, 0.0, 1.0)));
                #include <colorspace_fragment>
            }`,
        side: THREE.DoubleSide,
        stencilWrite: true,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilRef: 0,
        stencilFail: THREE.KeepStencilOp,
        stencilZFail: THREE.ZeroStencilOp,
        stencilZPass: THREE.ZeroStencilOp,
    });
}

/** A cut this close to a slab's own planes shows no thickness to lay a band across. */
const BAND_PARALLEL_DOT = 0.985;

/** The side of one hatching tile on the cut, mm. */
export const SECTION_CAP_TILE_MM = 400;
/** How many kinds of cut face there can be: each has a rendering layer of its own. */
export const SECTION_CAP_KINDS = 16;
/** The first of the rendering layers the kinds of cut face are told apart by. */
const SECTION_CAP_LAYER = 8;

/**
 * Says that `object` is a closed solid whose cut face is drawn as kind `kind` — an index into
 * the styles handed to `Viewport.setSectionCaps`. Only a closed solid can be capped: an open
 * sheet has no inside for the cut to show.
 */
export function markSectionCap(object: THREE.Object3D, kind: number): void {
    if (kind >= 0 && kind < SECTION_CAP_KINDS) object.layers.enable(SECTION_CAP_LAYER + kind);
}

/**
 * Says which pixels look into a solid through the cut, drawing nothing: every face behind the
 * cut, front or back, flips the stencil. Looking into a solid through the cut crosses an odd
 * number of its faces; looking through a whole solid crosses an even number, in at one and out
 * at another, and leaves nothing. Counting crossings rather than fronts against backs asks only
 * that a solid is closed, not that its triangles all wind the same way — which a member cut to
 * shape does not promise.
 */
function crossingCount(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: THREE.InvertStencilOp,
        stencilZFail: THREE.InvertStencilOp,
        stencilZPass: THREE.InvertStencilOp,
    });
}

/**
 * The same count for a sheet too thin to see cut — a membrane — swollen to a line's width: each
 * vertex is pushed out from the sheet's middle along its normal, so its cut face is a stroke.
 */
function swollenCount(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            lineNormal: { value: new THREE.Vector3() },
            lineMiddle: { value: 0 },
            lineGrow: { value: 0 },
        },
        vertexShader: `
            #include <clipping_planes_pars_vertex>
            uniform vec3 lineNormal;
            uniform float lineMiddle;
            uniform float lineGrow;
            void main() {
                vec4 world = modelMatrix * vec4(position, 1.0);
                float side = dot(world.xyz, lineNormal) - lineMiddle;
                world.xyz += lineNormal * (side < 0.0 ? -lineGrow : lineGrow);
                vec4 mvPosition = viewMatrix * world;
                gl_Position = projectionMatrix * mvPosition;
                #include <clipping_planes_vertex>
            }`,
        fragmentShader: `
            #include <clipping_planes_pars_fragment>
            void main() {
                #include <clipping_planes_fragment>
                gl_FragColor = vec4(0.0);
            }`,
        clipping: true,
        side: THREE.DoubleSide,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: THREE.InvertStencilOp,
        stencilZFail: THREE.InvertStencilOp,
        stencilZPass: THREE.InvertStencilOp,
    });
}

/** How wide the stroke of a cut membrane is drawn, mm of building. */
const SECTION_LINE_MM = 8;

/** The section plane's own colour: the selection blue, so it reads as a tool's handle. */
const SECTION_COLOR = 0x3f4e4f;
/** How far past the model the drawn plane reaches, as a share of the model's own size. */
const SECTION_MARGIN = 1.15;
/** Layers that are not the building: a face is never picked from them, and they do not size the plane. */
const NOT_BUILDING: ReadonlySet<string> = new Set(['underlay', 'grid', 'guides', 'overlay']);

export interface ViewportCallbacks {
    onPointerMove(ray: ModelRay, event: PointerEvent): void;
    onClick(ray: ModelRay, event: PointerEvent): void;
    onRightClick(event: PointerEvent): void;
    /**
     * Whether a left-drag with the tools' button should draw a selection box. Asked at press
     * time; without it a drag does nothing, as it always has.
     */
    wantsBoxDrag?(): boolean;
    /**
     * The selection box, in canvas pixels, as it is dragged (`'move'`), when it is let go
     * (`'end'`), and when it is abandoned (`'cancel'`). A box never also reports a click.
     */
    onBoxDrag?(
        from: PixelPos,
        to: PixelPos,
        phase: 'move' | 'end' | 'cancel',
        event: PointerEvent
    ): void;
}

/** Named groups so layer modules can replace their own contents without touching others. */
export type LayerName =
    | 'underlay'
    | 'grid'
    | 'foundation'
    | 'surfaces'
    | 'guides'
    | 'framing'
    | 'build'
    | 'envelope'
    | 'zones'
    | 'fixtures'
    | 'heating'
    | 'equipment'
    | 'overlay';
const LAYER_NAMES: readonly LayerName[] = [
    'underlay',
    'grid',
    'foundation',
    'surfaces',
    'guides',
    'framing',
    'build',
    'envelope',
    'zones',
    'fixtures',
    'heating',
    'equipment',
    'overlay',
];

export class Viewport {
    readonly scene = new THREE.Scene();
    private readonly camera: THREE.PerspectiveCamera;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly controls: OrbitControls;
    private readonly raycaster = new THREE.Raycaster();
    private readonly resizeObserver: ResizeObserver;
    private readonly layers = new Map<LayerName, THREE.Group>();
    private readonly cameraListeners = new Set<() => void>();
    private readonly navCube: NavCube;
    /** The camera's swing to a view the nav cube picked, while it lasts. */
    private turn: CameraTurn | null = null;
    /** The plane the model is cut by, in three's frame — what is on its negative side is hidden. */
    private sectionClip: THREE.Plane | null = null;
    /**
     * The section plane as drawn. In a scene of its own, rendered after the model and without
     * the cut, since a plane drawn *on* the cut would otherwise be cut away by it.
     */
    private readonly gizmoScene = new THREE.Scene();
    /**
     * The cut faces, one sheet per kind on the section plane (`setSectionCaps`), each drawn only
     * where the cut passes through a solid of its kind.
     */
    private readonly capScene = new THREE.Scene();
    private readonly capSheets: THREE.Mesh[] = [];
    /** The sheet a banded solid's cut face is drawn with, one solid at a time. */
    private readonly bandSheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    private readonly bandMaterials = new Map<number, THREE.ShaderMaterial>();
    /** Marks where the eye looks into a solid through the cut (`crossingCount`). */
    private readonly count = crossingCount();
    /** The same for a membrane, swollen to a stroke (`swollenCount`). */
    private readonly countLine = swollenCount();

    private downPos: { x: number; y: number } | null = null;
    private rafHandle: number | null = null;
    /** Whether something changed since the last frame was drawn — see `renderOnce`. */
    private dirty = true;
    private disposed = false;
    private navMode: NavMode = 'off';
    private toolCursor = 'crosshair';
    /** Whether the press in progress belongs to the camera rather than to a tool. */
    private dragIsNav = false;
    /** Where a selection box started, in canvas pixels, while the press may become one. */
    private boxFrom: PixelPos | null = null;
    /** Whether the press has moved far enough to be a box rather than a click. */
    private boxing = false;

    constructor(
        private readonly host: HTMLElement,
        private readonly callbacks: ViewportCallbacks
    ) {
        this.scene.background = new THREE.Color(THEME.background);

        for (const name of LAYER_NAMES) {
            const group = new THREE.Group();
            group.name = name;
            this.layers.set(name, group);
            this.scene.add(group);
        }

        // Three lights rather than one: a single directional source leaves every north-facing
        // stud face in flat black, which makes framing unreadable at a glance.
        const hemi = new THREE.HemisphereLight(0xffffff, 0x6b6b6b, 1.15);
        const sun = new THREE.DirectionalLight(0xffffff, 1.3);
        sun.position.set(15, 30, 10);
        this.scene.add(hemi, sun, new THREE.AmbientLight(0xffffff, 0.25));

        // Scene units are metres, so a 5000 far plane is 5 km — ample for a house, and the
        // 0.05 near plane keeps depth precision usable when zoomed in on a single member.
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
        this.camera.position.set(15, 9, 17);

        // The stencil buffer is what closes a cut solid (`drawSectionCaps`).
        this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.domElement.style.display = 'block';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        host.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        // The polar range is left at its full 0..PI default on purpose. Clamping it at the
        // horizon — the obvious way to stop the camera going underground — is what makes an
        // orbit world feel like a fixed picture: the user can never check a soffit, a floor
        // joist or a beam-to-pillar junction from below. `rayToPlane` already rejects hits
        // behind the eye, so drawing from underneath lands on the plane correctly.
        this.controls.target.set(4, 0, -4);
        // Pan along the screen, not along the ground plane: dragging a model sideways should
        // move it sideways whatever the camera pitch is.
        this.controls.screenSpacePanning = true;
        // Wheel zoom converges on whatever is under the cursor rather than on the orbit pivot,
        // which is how every 3D modeller behaves and the only way to close in on one stud
        // without panning after every scroll.
        this.controls.zoomToCursor = true;
        this.controls.minDistance = 0.3;
        this.controls.maxDistance = 400;

        // SketchUp's arrangement, and the reason arch cannot just reuse mep's controls: the
        // LEFT button belongs to the drawing tools unless a nav mode or a modifier chord
        // claims it (see `resolveDragAction`). Middle orbits, right pans.
        this.controls.mouseButtons = {
            LEFT: null,
            MIDDLE: THREE.MOUSE.ROTATE,
            RIGHT: THREE.MOUSE.PAN,
        };
        this.controls.addEventListener('change', this.renderOnce);
        this.controls.addEventListener('change', this.notifyCamera);
        // A drag the user starts mid-swing wins: the camera stays where the swing had got to.
        this.controls.addEventListener('start', this.endTurn);

        this.navCube = new NavCube(host, (dir) => this.turnTo(dir));

        const canvas = this.renderer.domElement;
        this.applyCursor();
        // Capture phase: this must run *before* OrbitControls' own pointerdown listener, which
        // reads `mouseButtons` at press time. Resolving the chord here is what lets alt-drag
        // orbit under any tool without any keydown/keyup state to get stuck on a window blur.
        canvas.addEventListener('pointerdown', this.handleNavChord, { capture: true });
        canvas.addEventListener('pointerdown', this.handlePointerDown);
        canvas.addEventListener('pointermove', this.handlePointerMove);
        canvas.addEventListener('pointerup', this.handlePointerUp);
        canvas.addEventListener('pointercancel', this.handlePointerCancel);
        // Right-drag pans, so the browser menu must never appear over the canvas.
        canvas.addEventListener('contextmenu', this.handleContextMenu);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(host);
        this.resize();
        this.start();
    }

    /** Gives the left button to the camera (`'orbit'`/`'pan'`) or back to the tools (`'off'`). */
    setNavMode(mode: NavMode): void {
        this.navMode = mode;
        this.controls.mouseButtons.LEFT = leftButtonFor(mode);
        this.applyCursor();
    }

    /**
     * The pointer the active drawing tool wants (a CSS `cursor` value). Shown whenever the left
     * button is the tool's; a nav mode overrides it while it lasts and it comes back after.
     */
    setToolCursor(cursor: string): void {
        this.toolCursor = cursor;
        this.applyCursor();
    }

    private applyCursor(): void {
        this.renderer.domElement.style.cursor =
            this.navMode === 'off' ? this.toolCursor : NAV_CURSORS[this.navMode];
    }

    layer(name: LayerName): THREE.Group {
        return this.layers.get(name)!;
    }

    /** Empties a layer and disposes everything it owned. */
    clearLayer(name: LayerName): THREE.Group {
        const group = this.layer(name);
        disposeGroupChildren(group);
        return group;
    }

    /**
     * Converts a pointer event into a ray in the model frame.
     *
     * NDC must come from the canvas's own `getBoundingClientRect()`, not from `window` — the
     * canvas sits inside a grid cell with a sidebar beside it, and using window coordinates
     * offsets every pick by the sidebar's width.
     */
    /** Where the canvas is on the page, for anything drawn over it in page coordinates. */
    canvasRect(): DOMRect {
        return this.renderer.domElement.getBoundingClientRect();
    }

    /** An event's position in canvas pixels, the frame every pick and projection uses. */
    private canvasPixel(event: PointerEvent): PixelPos {
        const rect = this.renderer.domElement.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    rayFor(event: PointerEvent | MouseEvent): ModelRay {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        return {
            originMm: threeToModel(this.raycaster.ray.origin),
            dir: threeDirToModel(this.raycaster.ray.direction),
            pixel: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        };
    }

    /**
     * The authored face under a canvas pixel, and where on it the ray lands, or null.
     *
     * A raycast against the surface meshes — which is why `surface-layer.ts` stamps each mesh
     * with its `surfaceId`, and why the openings are cut out of the mesh geometry rather than
     * painted over it: a click through a window must hit whatever is behind it, not the wall.
     * Only meshes are tested; the outline `Line`s in the same layer would otherwise catch the
     * ray at their own threshold and report a face for a click on empty ground beside it.
     *
     * Faces in `skip` are passed over, so a click reaches whatever is behind one the app has
     * hidden.
     */
    pickSurface(pixel: PixelPos, skip?: ReadonlySet<string>): SurfacePick | null {
        const canvas = this.renderer.domElement;
        const ndc = new THREE.Vector2(
            (pixel.x / canvas.clientWidth) * 2 - 1,
            -(pixel.y / canvas.clientHeight) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const meshes = this.layer('surfaces').children.filter(
            (child): child is THREE.Mesh =>
                (child as THREE.Mesh).isMesh === true &&
                typeof child.userData['surfaceId'] === 'string' &&
                !skip?.has(child.userData['surfaceId'] as string)
        );
        const hit = this.firstShown(meshes);
        if (!hit) return null;
        return {
            surfaceId: hit.object.userData['surfaceId'] as string,
            pointMm: threeToModel(hit.point),
        };
    }

    /**
     * The zone volume under a canvas pixel, or null — the nearest one the ray enters, read off
     * the `zoneId` a zone layer stamps on each mesh, the way `pickSurface` reads `surfaceId`.
     */
    pickZone(pixel: PixelPos): ZonePick | null {
        const canvas = this.renderer.domElement;
        const ndc = new THREE.Vector2(
            (pixel.x / canvas.clientWidth) * 2 - 1,
            -(pixel.y / canvas.clientHeight) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const meshes = this.layer('zones').children.filter(
            (child): child is THREE.Mesh =>
                (child as THREE.Mesh).isMesh === true &&
                typeof child.userData['zoneId'] === 'string'
        );
        const hit = this.firstShown(meshes);
        if (!hit) return null;
        return {
            zoneId: hit.object.userData['zoneId'] as string,
            pointMm: threeToModel(hit.point),
        };
    }

    /**
     * The fitting under a canvas pixel, or null — the nearest one the ray meets, read off the
     * `fixtureId` the fixtures layer stamps on each mesh (#253).
     */
    pickFixture(pixel: PixelPos): string | null {
        const canvas = this.renderer.domElement;
        const ndc = new THREE.Vector2(
            (pixel.x / canvas.clientWidth) * 2 - 1,
            -(pixel.y / canvas.clientHeight) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const meshes: THREE.Mesh[] = [];
        this.layer('fixtures').traverseVisible((child) => {
            if (
                (child as THREE.Mesh).isMesh === true &&
                typeof child.userData['fixtureId'] === 'string'
            ) {
                meshes.push(child as THREE.Mesh);
            }
        });
        const hit = this.firstShown(meshes);
        return hit ? (hit.object.userData['fixtureId'] as string) : null;
    }

    /**
     * The timber member under a canvas pixel, or null.
     *
     * A raycast against the `InstancedMesh`es `frame-layer.ts` fills the `framing` layer with.
     * Three reports the hit as an `instanceId` into one of those meshes rather than an object of
     * its own, so the member id comes back out of the `userData['memberIds']` array that layer
     * stamps on each mesh — index-aligned with the instance matrices, the same way
     * `pickSurface` reads `userData['surfaceId']` off a surface mesh. The meshes are gathered
     * from the whole visible subtree, so a hidden group is never hit. Build mode has its own
     * pick, `pickBuild`, which also finds the envelope's pieces.
     */
    pickFraming(pixel: PixelPos): FramingPick | null {
        const canvas = this.renderer.domElement;
        const ndc = new THREE.Vector2(
            (pixel.x / canvas.clientWidth) * 2 - 1,
            -(pixel.y / canvas.clientHeight) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const meshes: THREE.InstancedMesh[] = [];
        this.layer('framing').traverseVisible((child) => {
            if (
                (child as THREE.InstancedMesh).isInstancedMesh === true &&
                Array.isArray(child.userData['memberIds'])
            ) {
                meshes.push(child as THREE.InstancedMesh);
            }
        });
        const hit = this.firstShown(meshes);
        if (!hit || hit.instanceId === undefined) return null;
        const memberIds = hit.object.userData['memberIds'] as string[] | undefined;
        const memberId = memberIds?.[hit.instanceId];
        if (!memberId) return null;
        return { memberId, pointMm: threeToModel(hit.point) };
    }

    /**
     * What stands nearest under a canvas pixel in Build mode's layer: a member (read off its
     * `InstancedMesh` as `pickFraming` does) or an envelope piece stamped with `pieceId` and
     * `pieceKind`. Every visible mesh is tested, so a membrane or a bay of insulation in front
     * hides what is behind it — the nearest hit decides, and one that is neither is null.
     */
    pickBuild(pixel: PixelPos): BuildPick | null {
        const canvas = this.renderer.domElement;
        const ndc = new THREE.Vector2(
            (pixel.x / canvas.clientWidth) * 2 - 1,
            -(pixel.y / canvas.clientHeight) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const meshes: THREE.Mesh[] = [];
        this.layer('build').traverseVisible((child) => {
            if ((child as THREE.Mesh).isMesh === true) meshes.push(child as THREE.Mesh);
        });
        const hit = this.firstShown(meshes);
        if (!hit) return null;
        const pointMm = threeToModel(hit.point);
        const data = hit.object.userData;
        if (Array.isArray(data['memberIds']) && hit.instanceId !== undefined) {
            const memberId = (data['memberIds'] as string[])[hit.instanceId];
            return memberId ? { kind: 'member', memberId, pointMm } : null;
        }
        if (typeof data['pieceId'] === 'string') {
            return {
                kind: 'piece',
                pieceId: data['pieceId'],
                pieceKind: String(data['pieceKind'] ?? ''),
                pointMm,
            };
        }
        return null;
    }

    /**
     * The envelope piece nearest under a canvas pixel in `layer` — a sheet or a cladding board,
     * stamped with `pieceId` and `pieceKind` as `pickBuild` reads them — or null. Only the nearest
     * hit counts: a piece behind another is not reached through it. A mesh marked
     * `userData.overlay` — a tint drawn over the faces — is looked through.
     */
    pickPiece(
        pixel: PixelPos,
        layer: LayerName
    ): { pieceId: string; pieceKind: string; pointMm: Point3Mm } | null {
        const canvas = this.renderer.domElement;
        const ndc = new THREE.Vector2(
            (pixel.x / canvas.clientWidth) * 2 - 1,
            -(pixel.y / canvas.clientHeight) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const meshes: THREE.Mesh[] = [];
        this.layer(layer).traverseVisible((child) => {
            if ((child as THREE.Mesh).isMesh === true && child.userData['overlay'] !== true) {
                meshes.push(child as THREE.Mesh);
            }
        });
        const hit = this.firstShown(meshes);
        const data = hit?.object.userData;
        if (!hit || typeof data?.['pieceId'] !== 'string') return null;
        return {
            pieceId: data['pieceId'],
            pieceKind: String(data['pieceKind'] ?? ''),
            pointMm: threeToModel(hit.point),
        };
    }

    /**
     * Whatever is drawn nearest under a canvas pixel in `layer`, as it stands now — moved apart
     * in an exploded view or not — and what its mesh is stamped with: its `userData`, and for an
     * instanced mesh the instance hit. Null over empty space. What it means is the app's to read.
     * A mesh marked `userData.overlay` — a tint drawn over the faces — is looked through.
     */
    pickSolid(
        pixel: PixelPos,
        layer: LayerName
    ): {
        data: Readonly<Record<string, unknown>>;
        instanceId: number | undefined;
        pointMm: Point3Mm;
    } | null {
        const canvas = this.renderer.domElement;
        const ndc = new THREE.Vector2(
            (pixel.x / canvas.clientWidth) * 2 - 1,
            -(pixel.y / canvas.clientHeight) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const meshes: THREE.Mesh[] = [];
        this.layer(layer).traverseVisible((child) => {
            if ((child as THREE.Mesh).isMesh === true && child.userData['overlay'] !== true) {
                meshes.push(child as THREE.Mesh);
            }
        });
        const hit = this.firstShown(meshes);
        if (!hit) return null;
        return {
            data: hit.object.userData,
            instanceId: hit.instanceId,
            pointMm: threeToModel(hit.point),
        };
    }

    /**
     * The nearest hit of the raycaster's ray on `meshes` that the section plane has not cut away —
     * the nearest one there is, without one.
     *
     * Where the plane cuts a solid, what is seen is its cut face, and a ray through that face is
     * inside the solid: the next face it meets is the inside of the solid's far side. So while
     * there is a cut, every face is hit from both sides, whatever its material draws — a click on
     * a cut stud is the stud, not what stands behind it.
     */
    private firstShown(meshes: readonly THREE.Object3D[]): THREE.Intersection | undefined {
        const clip = this.sectionClip;
        if (!clip) return this.raycaster.intersectObjects(meshes as THREE.Object3D[], false)[0];
        const sides = new Map<THREE.Material, THREE.Side>();
        for (const mesh of meshes) {
            const material = (mesh as THREE.Mesh).material;
            for (const m of Array.isArray(material) ? material : material ? [material] : []) {
                if (!sides.has(m)) sides.set(m, m.side);
                m.side = THREE.DoubleSide;
            }
        }
        try {
            return this.raycaster
                .intersectObjects(meshes as THREE.Object3D[], false)
                .find((hit) => clip.distanceToPoint(hit.point) >= 0);
        } finally {
            for (const [m, side] of sides) m.side = side;
        }
    }

    /**
     * The face of whatever is drawn nearest under a canvas pixel — a surface, a timber member,
     * a layer of the envelope, anything of the building in any mode — with its normal turned
     * towards the eye. Null over empty space. What a section plane is laid parallel to.
     *
     * Every visible mesh of the building's layers is tested, and what the section already hides
     * is passed over, so a second cut is laid on what can be seen. The normal is the hit
     * triangle's own, carried into the world by the mesh's normal matrix — and by its instance's,
     * for the instanced boxes the frame is drawn with.
     */
    pickFace(pixel: PixelPos): FacePick | null {
        const canvas = this.renderer.domElement;
        const ndc = new THREE.Vector2(
            (pixel.x / canvas.clientWidth) * 2 - 1,
            -(pixel.y / canvas.clientHeight) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const meshes: THREE.Mesh[] = [];
        for (const [name, group] of this.layers) {
            if (NOT_BUILDING.has(name)) continue;
            group.traverseVisible((child) => {
                if ((child as THREE.Mesh).isMesh === true) meshes.push(child as THREE.Mesh);
            });
        }
        const hit = this.firstShown(meshes);
        if (!hit?.face) return null;
        const world = new THREE.Matrix4().copy(hit.object.matrixWorld);
        const instanced = hit.object as THREE.InstancedMesh;
        if (instanced.isInstancedMesh === true && hit.instanceId !== undefined) {
            const instance = new THREE.Matrix4();
            instanced.getMatrixAt(hit.instanceId, instance);
            world.multiply(instance);
        }
        const normal = hit.face.normal
            .clone()
            .applyMatrix3(new THREE.Matrix3().getNormalMatrix(world))
            .normalize();
        // A face has two sides; the one being looked at is the one the ray came in through.
        if (normal.dot(this.raycaster.ray.direction) > 0) normal.negate();
        return { pointMm: threeToModel(hit.point), normal: threeDirToModel(normal) };
    }

    /**
     * Cuts the model by a plane, or — with null — shows it whole again.
     *
     * Everything on the side the plane's normal points to is hidden, in every layer: the cut is
     * the renderer's own clipping plane, so nothing that draws has to know about it. The plane
     * itself is drawn as a pale sheet with an outline, a little larger than the model, so there
     * is something to see where the cut is and to move.
     */
    setSection(plane: SectionPlane | null): void {
        disposeGroupChildren(this.gizmoScene);
        if (!plane) {
            this.sectionClip = null;
            for (const sheet of this.capSheets) sheet.visible = false;
            this.renderOnce();
            return;
        }
        const point = modelToThree(plane.pointMm);
        const hidden = new THREE.Vector3(
            plane.normal.x,
            plane.normal.z,
            -plane.normal.y
        ).normalize();
        // three keeps what is on a clipping plane's positive side, so it faces the kept side.
        this.sectionClip = new THREE.Plane().setFromNormalAndCoplanarPoint(
            hidden.clone().negate(),
            point
        );

        // The sheet: centred where the model's middle falls on the plane, and as wide as the model.
        const bounds = new THREE.Box3();
        for (const [name, group] of this.layers) {
            if (!NOT_BUILDING.has(name)) bounds.expandByObject(group);
        }
        const sphere = bounds.isEmpty()
            ? new THREE.Sphere(point.clone(), 4)
            : bounds.getBoundingSphere(new THREE.Sphere());
        const centre = this.sectionClip.projectPoint(sphere.center, new THREE.Vector3());
        const half = Math.max(sphere.radius, 1) * SECTION_MARGIN;
        this.placeSectionCaps(centre, half);
        const sheet = new THREE.PlaneGeometry(half * 2, half * 2);
        const gizmo = new THREE.Group();
        gizmo.add(
            new THREE.Mesh(
                sheet,
                new THREE.MeshBasicMaterial({
                    color: SECTION_COLOR,
                    transparent: true,
                    opacity: 0.07,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                })
            ),
            new THREE.LineSegments(
                new THREE.EdgesGeometry(sheet),
                new THREE.LineBasicMaterial({ color: SECTION_COLOR })
            )
        );
        gizmo.position.copy(centre);
        gizmo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hidden);
        this.gizmoScene.add(gizmo);
        this.renderOnce();
    }

    /**
     * Where a model point lands on the canvas, in CSS pixels. Null when it is behind the eye.
     *
     * The inverse of `rayFor`, and needed for the same reason it carries its pixel: an
     * inference the user aims at by eye has to be tested where their eye is — on the screen.
     */
    projectToPixel(pointMm: Point3Mm): PixelPos | null {
        const ndc = modelToThree(pointMm).project(this.camera);
        // `project` divides by w, which flips the sign behind the camera rather than failing.
        if (ndc.z > 1) return null;
        const canvas = this.renderer.domElement;
        return {
            x: ((ndc.x + 1) / 2) * canvas.clientWidth,
            y: ((1 - ndc.y) / 2) * canvas.clientHeight,
        };
    }

    /**
     * Model units (mm) spanned by one screen pixel at the working distance.
     *
     * This is what converts `SNAP_TOLERANCE_PX` into the model-unit tolerance `snapOnPlane`
     * takes. Derived from the perspective frustum height at the orbit target's distance, so it
     * tracks zoom — which is the entire point, since a fixed model tolerance is unusable at
     * both ends of the zoom range.
     */
    mmPerPixel(): number {
        const distanceM = this.camera.position.distanceTo(this.controls.target);
        const frustumHeightM = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * distanceM;
        const heightPx = this.renderer.domElement.clientHeight || 1;
        return (frustumHeightM / heightPx) * 1000;
    }

    /**
     * Frames the camera on a model-space bounding sphere.
     *
     * The 1.05 margin and the raised view direction are tuned rather than arbitrary: at the
     * textbook `radius / tan(fov/2)` the subject fills the frame exactly and the surrounding
     * grid — which is what gives the modular system its legibility — is cropped away, while a
     * larger margin shrinks the building until the grid reads as noise instead of context.
     */
    /** `from` is the model-frame direction from the target to the camera; the default view's
     *  when absent. */
    frameOn(centerMm: Point3Mm, radiusMm: number, from?: Point3Mm): void {
        const radiusM = Math.max(radiusMm, 1000) / 1000;
        const target = new THREE.Vector3(centerMm.x / 1000, centerMm.z / 1000, -centerMm.y / 1000);
        const distance = (radiusM * 1.05) / Math.tan((this.camera.fov * Math.PI) / 360);
        // Elevated enough to read the plan, low enough to keep wall heights legible — close to
        // SketchUp's own default iso view.
        // Deliberately *not* the (1,1,1) isometric direction: an exactly symmetric three-
        // quarter view reads as a flat axonometric drawing, which is the opposite of the
        // impression an orbitable world should give on first load. Off-axis and a little lower
        // shows the perspective convergence immediately.
        const dir = from
            ? new THREE.Vector3(from.x, from.z, -from.y).normalize()
            : new THREE.Vector3(1, 0.95, 1.45).normalize();
        this.controls.target.copy(target);
        this.camera.position.copy(target).addScaledVector(dir, distance);
        this.controls.update();
        this.renderOnce();
    }

    /**
     * Shows or hides the 3D canvas — a modeller toggles this against the SVG plan view
     * (`render/plan-view.ts`) sharing its host element, rather than repurposing this camera to
     * fake a top-down 2D view the way an earlier version did. The render loop keeps running
     * while hidden; a WebGL canvas nobody can see costs nothing worth guarding against.
     */
    setVisible(visible: boolean): void {
        this.renderer.domElement.style.display = visible ? 'block' : 'none';
        this.navCube.setVisible(visible);
    }

    /**
     * Swings the camera round the orbit target to look from `from` (model frame, target to
     * camera) — Top is `{0, 0, 1}`, the front elevation `{0, -1, 0}` — keeping its distance.
     * What the nav cube does on a click; animated so the user sees which way the model turned.
     */
    viewFrom(from: Point3Mm): void {
        this.turnTo(new THREE.Vector3(from.x, from.z, -from.y).normalize());
    }

    /**
     * Starts the swing to `dir` (three frame). It runs in polar angle and azimuth rather than
     * along a great circle: OrbitControls keeps its up axis fixed, so a great circle into a
     * plan view would arrive with whatever heading it had and then snap. Straight down or up
     * has no azimuth of its own, and takes the one with model north at the top of the screen.
     */
    private turnTo(dir: THREE.Vector3): void {
        const offset = this.camera.position.clone().sub(this.controls.target);
        const from = new THREE.Spherical().setFromVector3(offset);
        const to = new THREE.Spherical().setFromVector3(dir);
        if (Math.hypot(dir.x, dir.z) < 1e-6) to.theta = 0;
        // The short way round.
        let dTheta = (to.theta - from.theta) % (2 * Math.PI);
        if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
        if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
        this.endTurn();
        // Damping would carry the last drag's momentum on through the swing.
        this.controls.enableDamping = false;
        this.turn = {
            startMs: performance.now(),
            radius: from.radius,
            phi0: from.phi,
            dPhi: to.phi - from.phi,
            theta0: from.theta,
            dTheta,
        };
        this.renderOnce();
    }

    /** Places the camera along the swing at `nowMs`; false once it has arrived. */
    private stepTurn(turn: CameraTurn, nowMs: number): boolean {
        const t = Math.min(1, (nowMs - turn.startMs) / TURN_MS);
        const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        const at = new THREE.Spherical(
            turn.radius,
            turn.phi0 + turn.dPhi * eased,
            turn.theta0 + turn.dTheta * eased
        ).makeSafe();
        this.camera.position.setFromSpherical(at).add(this.controls.target);
        this.camera.lookAt(this.controls.target);
        this.notifyCamera();
        return t < 1;
    }

    private readonly endTurn = (): void => {
        if (!this.turn) return;
        this.turn = null;
        this.controls.enableDamping = true;
    };

    /**
     * Decides, at press time, whether this drag drives the camera or the active tool.
     *
     * Modifier chords beat the nav mode so navigation is always one key away mid-draw: **alt
     * orbits, alt+shift pans**. Every camera chord is gated on Alt, and that is not arbitrary —
     * plain Shift belongs to the drawing tools, where it forces the axis lock on (see
     * `interaction/snap3.ts`). A chord cannot be shared: shift-left-drag as a pan would also
     * swallow every shift-click, and a shift-click is how you place a point on a locked axis.
     */
    private readonly handleNavChord = (event: PointerEvent): void => {
        if (event.button === 0) {
            const chord: NavMode | null = event.altKey ? (event.shiftKey ? 'pan' : 'orbit') : null;
            const mode = chord ?? this.navMode;
            this.controls.mouseButtons.LEFT = leftButtonFor(mode);
            this.dragIsNav = mode !== 'off';
        } else {
            // Middle and right are always camera buttons.
            this.dragIsNav = true;
        }
    };

    private readonly handlePointerDown = (event: PointerEvent): void => {
        this.downPos = { x: event.clientX, y: event.clientY };
        this.boxFrom = null;
        this.boxing = false;
        if (
            event.button === 0 &&
            !event.ctrlKey &&
            !this.dragIsNav &&
            this.callbacks.wantsBoxDrag?.()
        ) {
            this.boxFrom = this.canvasPixel(event);
            this.renderer.domElement.setPointerCapture(event.pointerId);
        }
    };

    private readonly handlePointerMove = (event: PointerEvent): void => {
        // While the camera is being dragged the cursor is steering the view, not pointing at a
        // location in the model — reporting a snap for it would make the rubber band flail
        // across the screen for the whole orbit.
        if (this.dragIsNav && event.buttons !== 0) return;
        const down = this.downPos;
        if (this.boxFrom && down && (event.buttons & 1) !== 0) {
            const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
            if (this.boxing || moved > CLICK_DRAG_TOLERANCE_PX) {
                this.boxing = true;
                this.callbacks.onBoxDrag?.(this.boxFrom, this.canvasPixel(event), 'move', event);
                return;
            }
        }
        this.callbacks.onPointerMove(this.rayFor(event), event);
    };

    private readonly handlePointerUp = (event: PointerEvent): void => {
        const down = this.downPos;
        const wasNav = this.dragIsNav;
        const boxFrom = this.boxFrom;
        const boxing = this.boxing;
        this.downPos = null;
        this.dragIsNav = false;
        this.boxFrom = null;
        this.boxing = false;
        if (boxFrom && this.renderer.domElement.hasPointerCapture(event.pointerId)) {
            this.renderer.domElement.releasePointerCapture(event.pointerId);
        }
        if (boxFrom && boxing) {
            this.callbacks.onBoxDrag?.(boxFrom, this.canvasPixel(event), 'end', event);
            return;
        }
        if (!down) return;
        const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        if (moved > CLICK_DRAG_TOLERANCE_PX) return;
        // Ctrl+click is the Mac's right click: one-button trackpads have no other.
        if (event.button === 2 || (event.button === 0 && event.ctrlKey)) {
            this.callbacks.onRightClick(event);
            return;
        }
        if (event.button !== 0) return;
        // A click that ended a nav drag — or that landed while the Orbit tool is active — is
        // not a tool click, even though it never moved far enough to count as a drag.
        if (wasNav) return;
        this.callbacks.onClick(this.rayFor(event), event);
    };

    /** The browser took the pointer away mid-press: a box in progress is dropped, not applied. */
    private readonly handlePointerCancel = (event: PointerEvent): void => {
        if (this.boxFrom && this.boxing) {
            this.callbacks.onBoxDrag?.(this.boxFrom, this.canvasPixel(event), 'cancel', event);
        }
        this.downPos = null;
        this.dragIsNav = false;
        this.boxFrom = null;
        this.boxing = false;
    };

    private readonly handleContextMenu = (event: Event): void => {
        event.preventDefault();
    };

    resize(): void {
        const width = this.host.clientWidth || 1;
        const height = this.host.clientHeight || 1;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.renderOnce();
        this.notifyCamera();
    }

    /**
     * Calls `listener` whenever the camera moves or the canvas is resized — for anything drawn
     * over the canvas in screen pixels, which has to follow the model as it orbits. Returns the
     * unsubscribe.
     */
    onCameraChange(listener: () => void): () => void {
        this.cameraListeners.add(listener);
        return () => this.cameraListeners.delete(listener);
    }

    private readonly notifyCamera = (): void => {
        for (const listener of this.cameraListeners) listener();
    };

    /**
     * How the cut faces are drawn, kind by kind — index `i` is the kind `markSectionCap` gives a
     * solid. A kind with no style is left open, as every cut was before.
     */
    setSectionCaps(styles: readonly (SectionCapStyle | null)[]): void {
        for (const sheet of this.capSheets) {
            sheet.geometry.dispose();
            (sheet.material as THREE.Material).dispose();
        }
        this.capScene.clear();
        this.capSheets.length = 0;
        for (const material of this.bandMaterials.values()) material.dispose();
        this.bandMaterials.clear();
        this.bandSheet.visible = false;
        this.capScene.add(this.bandSheet);
        styles.slice(0, SECTION_CAP_KINDS).forEach((style, kind) => {
            if (!style) return;
            style.map.wrapS = style.map.wrapT = THREE.RepeatWrapping;
            style.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            const sheet = new THREE.Mesh(
                new THREE.PlaneGeometry(1, 1),
                new THREE.MeshBasicMaterial({
                    map: style.map,
                    side: THREE.DoubleSide,
                    // Only where the count says the cut is inside a solid — and the count is
                    // wiped as the sheet is drawn, ready for the next kind.
                    stencilWrite: true,
                    stencilFunc: THREE.NotEqualStencilFunc,
                    stencilRef: 0,
                    stencilFail: THREE.KeepStencilOp,
                    stencilZFail: THREE.ZeroStencilOp,
                    stencilZPass: THREE.ZeroStencilOp,
                })
            );
            if (style.band) {
                style.band.wrapS = THREE.RepeatWrapping;
                style.band.wrapT = THREE.ClampToEdgeWrapping;
                style.band.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
                this.bandMaterials.set(kind, bandMaterial(style.band));
            }
            sheet.userData['capKind'] = kind;
            sheet.visible = false;
            this.capSheets.push(sheet);
            this.capScene.add(sheet);
        });
        this.renderOnce();
    }

    /**
     * Lays the cut faces' sheets on the section plane: `half` to each side of `centre`, turned
     * so the hatching stands upright on a vertical cut, and moved in whole tiles so the pattern
     * stays where it is on the building while the plane is dragged along its normal.
     */
    private placeSectionCaps(centre: THREE.Vector3, half: number): void {
        const clip = this.sectionClip;
        if (!clip) return;
        const n = clip.normal;
        // Up on the sheet is up in the world; on a level cut, north.
        const up = Math.abs(n.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
        const v = up.sub(n.clone().multiplyScalar(up.dot(n))).normalize();
        const u = new THREE.Vector3().crossVectors(v, n).normalize();
        const tile = SECTION_CAP_TILE_MM / MM_PER_M;
        const anchor = clip.projectPoint(new THREE.Vector3(), new THREE.Vector3());
        const rel = centre.clone().sub(anchor);
        const snap = (along: THREE.Vector3): number => Math.round(rel.dot(along) / tile) * tile;
        const at = anchor.clone().addScaledVector(u, snap(u)).addScaledVector(v, snap(v));
        // A whole number of tiles across, and an even one, so the sheet's corner is on the grid.
        const tiles = 2 * Math.ceil(half / tile);
        const basis = new THREE.Matrix4().makeBasis(u, v, n);
        for (const sheet of [...this.capSheets, this.bandSheet]) {
            sheet.position.copy(at);
            sheet.quaternion.setFromRotationMatrix(basis);
            sheet.scale.set(tiles * tile, tiles * tile, 1);
        }
        for (const sheet of this.capSheets) {
            (sheet.material as THREE.MeshBasicMaterial).map?.repeat.set(tiles, tiles);
            sheet.visible = true;
        }
    }

    /**
     * Closes what the section plane has cut open: for each kind of solid, the stencil buffer is
     * marked wherever the eye looks into a solid of that kind through the cut (`crossingCount`),
     * and that kind's sheet is drawn there. Kind by kind, since each has its own hatching; the
     * kinds are told apart by the rendering layer `markSectionCap` puts a solid on. Only what
     * the plane itself passes through is marked: a solid deeper in the view is crossed in and
     * out again, and stays as it is drawn.
     */
    private drawSectionCaps(): void {
        const clip = this.sectionClip!;
        if (this.capSheets.length === 0) return;
        this.renderer.autoClear = false;
        // A scene with a background colour clears the frame whenever it is rendered, autoClear
        // or not — which would wipe the model just drawn. It goes without one for these passes.
        const background = this.scene.background;
        this.scene.background = null;
        try {
            for (const sheet of this.capSheets) {
                const kind = sheet.userData['capKind'] as number;
                this.camera.layers.set(SECTION_CAP_LAYER + kind);
                this.renderer.clippingPlanes = [clip];
                this.scene.overrideMaterial = this.count;
                this.renderer.render(this.scene, this.camera);
                this.scene.overrideMaterial = null;
                this.camera.layers.set(0);
                // The sheet lies on the cut itself, so it is drawn without the cut.
                this.renderer.clippingPlanes = [];
                for (const other of this.capSheets) other.visible = other === sheet;
                this.renderer.render(this.capScene, this.camera);
            }
            this.drawSectionBands(clip);
        } finally {
            // Put back even when a pass throws: without autoClear no frame after it is cleared,
            // and the cut faces are lost under what the last one left.
            this.scene.overrideMaterial = null;
            this.camera.layers.set(0);
            this.scene.background = background;
            this.renderer.autoClear = true;
        }
    }

    /**
     * The cut faces drawn solid by solid: a slab's as one band across its thickness
     * (`markSectionBand`), a membrane's as a thick stroke (`markSectionLine`). Each solid the
     * plane passes through is counted and capped on its own, since what is drawn is laid by that
     * solid's own planes — across from one to the other, and along where they meet the cut. A
     * slab cut along its own planes shows no thickness, and gets its kind's tile instead.
     */
    private drawSectionBands(clip: THREE.Plane): void {
        for (const sheet of this.capSheets) sheet.visible = false;
        const sphere = new THREE.Sphere();
        const offset = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const grow = SECTION_LINE_MM / 2 / MM_PER_M;
        this.scene.traverseVisible((object) => {
            const band = object.userData['sectionBand'] as SectionBand | undefined;
            const line = object.userData['sectionLine'] as SectionBand | undefined;
            const mesh = object as THREE.Mesh;
            const said = band ?? line;
            if (!said || mesh.isMesh !== true) return;
            const tile = this.capSheets.find((s) => s.userData['capKind'] === said.kind);
            const banded = band ? this.bandMaterials.get(band.kind) : undefined;
            if (!tile && !banded) return;
            // A solid built in a worker has its userData cloned across, where a `Vector3`
            // arrives as a plain `{ x, y, z }`: the normal is read into one again.
            normal.copy(said.normal);
            // Only what the plane passes through has a cut face.
            if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
            sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);
            if (Math.abs(clip.distanceToPoint(sphere.center)) > sphere.radius + grow) return;
            // Where the solid has been moved since it was built — an exploded view — its planes
            // have moved with it.
            offset.setFromMatrixPosition(mesh.matrixWorld);
            const from = said.from + offset.dot(normal);

            const own = mesh.material;
            if (line) {
                const u = this.countLine.uniforms;
                u['lineNormal']!.value.copy(normal);
                u['lineMiddle']!.value = from + line.thickness / 2;
                u['lineGrow']!.value = grow;
                mesh.material = this.countLine;
            } else {
                mesh.material = this.count;
            }
            this.renderer.clippingPlanes = [clip];
            this.renderer.render(mesh, this.camera);
            mesh.material = own;

            const flat = Math.abs(normal.dot(clip.normal)) > BAND_PARALLEL_DOT;
            if (banded && !flat) {
                banded.uniforms['bandNormal']!.value.copy(normal);
                banded.uniforms['bandAlong']!.value.crossVectors(clip.normal, normal).normalize();
                banded.uniforms['bandFrom']!.value = from;
                banded.uniforms['bandThickness']!.value = said.thickness;
                this.bandSheet.material = banded;
            } else if (tile) {
                this.bandSheet.material = tile.material;
            } else {
                return;
            }
            this.bandSheet.visible = true;
            this.renderer.clippingPlanes = [];
            this.renderer.render(this.capScene, this.camera);
            this.bandSheet.visible = false;
        });
        for (const sheet of this.capSheets) sheet.visible = true;
    }

    /** Draws one frame. Called after every mutation so a paused scene is never stale. */
    /**
     * Asks for a frame. Drawn on the next animation frame, once however many ask before it: an
     * edit runs a dozen effects that each change a layer and ask, and drawing the whole scene
     * for each of them cost more than all the work that changed it.
     */
    readonly renderOnce = (): void => {
        if (this.disposed) return;
        this.dirty = true;
    };

    /**
     * The model, cut by the section plane when there is one — then the cut faces of its solids,
     * hatched (`drawSectionCaps`), and the plane itself over it, uncut, and against the depth the model left behind so the model still hides what of the
     * plane is behind it.
     */
    private draw(): void {
        this.navCube.update(this.camera);
        this.renderer.clippingPlanes = this.sectionClip ? [this.sectionClip] : [];
        this.renderer.render(this.scene, this.camera);
        if (!this.sectionClip) return;
        this.drawSectionCaps();
        this.renderer.clippingPlanes = [];
        this.renderer.autoClear = false;
        this.renderer.render(this.gizmoScene, this.camera);
        this.renderer.autoClear = true;
    }

    private start(): void {
        const tick = (): void => {
            if (this.disposed) return;
            this.rafHandle = requestAnimationFrame(tick);
            // Damping means the camera keeps easing after the pointer stops, so the loop has
            // to run; `update()` returns true while it is still moving.
            const turning = this.turn !== null && this.stepTurn(this.turn, performance.now());
            if (this.turn && !turning) this.endTurn();
            const moving = this.controls.update();
            if (turning || moving || this.dirty) {
                this.dirty = false;
                this.draw();
            }
        };
        tick();
    }

    destroy(): void {
        this.disposed = true;
        if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
        this.resizeObserver.disconnect();
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('pointerdown', this.handleNavChord, { capture: true });
        canvas.removeEventListener('pointerdown', this.handlePointerDown);
        canvas.removeEventListener('pointermove', this.handlePointerMove);
        canvas.removeEventListener('pointerup', this.handlePointerUp);
        canvas.removeEventListener('pointercancel', this.handlePointerCancel);
        canvas.removeEventListener('contextmenu', this.handleContextMenu);
        this.controls.dispose();
        this.navCube.dispose();
        for (const name of LAYER_NAMES) disposeGroupChildren(this.layer(name));
        disposeGroupChildren(this.gizmoScene);
        this.renderer.dispose();
        canvas.remove();
    }
}

/** How long the nav cube's swing takes. */
const TURN_MS = 450;

interface CameraTurn {
    startMs: number;
    radius: number;
    phi0: number;
    dPhi: number;
    theta0: number;
    dTheta: number;
}

function leftButtonFor(mode: NavMode): THREE.MOUSE | null {
    if (mode === 'orbit') return THREE.MOUSE.ROTATE;
    if (mode === 'pan') return THREE.MOUSE.PAN;
    return null;
}

/**
 * Disposes every child's geometry, then empties the group.
 *
 * Not its materials. Disposing a material releases its shader program, and three deletes a
 * program the moment no material uses it — so a layer rebuilt with the same materials, as every
 * layer is on every edit, compiled and linked all its shaders again: a hundred ms and more of
 * each edit. A material left alone holds nothing on the GPU — three keeps its state in a
 * WeakMap — and is collected with the mesh; its program stays cached for the next rebuild's.
 */
export function disposeGroupChildren(group: THREE.Object3D): void {
    for (const child of [...group.children]) {
        group.remove(child);
        disposeObject(child);
    }
}

function disposeObject(object: THREE.Object3D): void {
    for (const child of [...object.children]) disposeObject(child);
    (object as Partial<THREE.Mesh>).geometry?.dispose();
}
