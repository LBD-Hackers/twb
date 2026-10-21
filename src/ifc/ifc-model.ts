/**
 * An IFC file read as IFC: the entities of `step.ts` with what an importer asks of them — the
 * length unit, where a product stands (its placement chain), the corners of its body in the
 * world, its storey, its material layers, its property sets, the openings in a wall and what
 * fills them. IFC2X3 and IFC4 alike: the attributes read here sit at the same index in both.
 *
 * Every length comes back in **millimetres**, whatever unit the file is in, and every point in
 * the file's world frame (its own origin and axes, Z up).
 *
 * Geometry is read only as far as an importer needs it — a box, a footprint, an axis — not
 * tessellated: an extrusion's profile at its two ends, a b-rep's corners, a mapped item moved to
 * where it is used. A boolean result is read as its first operand (the solid before the cut).
 * Curved profiles are read at their control points and a circle at eight points, which is enough
 * for a box.
 */

import {
    isEnum,
    isRef,
    isTyped,
    readStep,
    type StepEntity,
    type StepFile,
    type StepValue,
} from './step';

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

/** A rigid placement: the three axes and the origin, in world mm. */
export interface Frame {
    o: Vec3;
    x: Vec3;
    y: Vec3;
    z: Vec3;
}

export const IDENTITY: Frame = {
    o: { x: 0, y: 0, z: 0 },
    x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 },
};

/** A material layer as the file gives it, outermost of the set first as the set lists it. */
export interface IfcLayer {
    material: string;
    /** mm */
    thickness: number;
    ventilated: boolean;
    /** IFC4's `Category` (`LoadBearing`, `Insulation`, …), when the file sets it. */
    category: string | null;
}

/** An `IfcMaterialLayerSetUsage`: the layers and how they lie on the element's axis. */
export interface IfcLayerUsage {
    name: string;
    layers: IfcLayer[];
    /** `AXIS2` for a wall (across its axis), `AXIS3` for a slab (up). */
    direction: string;
    /** +1 when the layers are laid along the positive axis, −1 along the negative. */
    sense: 1 | -1;
    /** mm from the reference line (the wall's axis) to the first layer's face. */
    offset: number;
}

export class IfcModel {
    readonly schema: string;
    /** mm per unit of length in the file. */
    readonly mmPerUnit: number;
    private readonly entities: ReadonlyMap<number, StepEntity>;
    private readonly byTypeIndex = new Map<string, StepEntity[]>();
    private readonly frames = new Map<number, Frame>();
    private readonly containedIn = new Map<number, number>();
    private readonly aggregatedIn = new Map<number, number>();
    private readonly children = new Map<number, number[]>();
    private readonly voids = new Map<number, number[]>();
    private readonly voidHost = new Map<number, number>();
    private readonly fills = new Map<number, number>();
    private readonly materialOf = new Map<number, number>();
    private readonly typeOf = new Map<number, number>();
    private readonly psetsOf = new Map<number, number[]>();

    constructor(file: StepFile) {
        this.schema = file.schema;
        this.entities = file.entities;
        for (const e of file.entities.values()) {
            let list = this.byTypeIndex.get(e.type);
            if (!list) this.byTypeIndex.set(e.type, (list = []));
            list.push(e);
        }
        this.mmPerUnit = this.readLengthUnit();
        this.indexRelations();
    }

    static read(text: string): IfcModel {
        return new IfcModel(readStep(text));
    }

    get(id: number | null | undefined): StepEntity | null {
        return id == null ? null : (this.entities.get(id) ?? null);
    }

    /** The entity a reference argument points at, or null. */
    deref(v: StepValue | undefined): StepEntity | null {
        return isRef(v) ? this.get(v.ref) : null;
    }

    /** Every entity of these types, in file order. */
    all(...types: string[]): StepEntity[] {
        return types.flatMap((t) => this.byTypeIndex.get(t) ?? []).sort((a, b) => a.id - b.id);
    }

    // ---- Attributes ------------------------------------------------------------------------

    str(e: StepEntity | null, i: number): string | null {
        const v = e?.args[i];
        if (typeof v === 'string') return v;
        if (isTyped(v) && typeof v.value === 'string') return v.value;
        return null;
    }

    num(e: StepEntity | null, i: number): number | null {
        const v = e?.args[i];
        if (typeof v === 'number') return v;
        if (isTyped(v) && typeof v.value === 'number') return v.value;
        return null;
    }

    enumOf(e: StepEntity | null, i: number): string | null {
        const v = e?.args[i];
        return isEnum(v) ? v.enum : null;
    }

    refs(e: StepEntity | null, i: number): StepEntity[] {
        const v = e?.args[i];
        if (!Array.isArray(v)) return [];
        return v.map((r) => this.deref(r)).filter((x): x is StepEntity => !!x);
    }

    name(e: StepEntity | null): string {
        return this.str(e, 2) ?? '';
    }

    // ---- Units -----------------------------------------------------------------------------

    private readLengthUnit(): number {
        const project = this.all('IFCPROJECT')[0];
        const assignment = project ? this.deref(project.args[8]) : null;
        for (const u of this.refs(assignment, 0)) {
            if (u.type === 'IFCSIUNIT' && this.enumOf(u, 1) === 'LENGTHUNIT') {
                return siScale(this.enumOf(u, 2)) * 1000;
            }
            if (u.type === 'IFCCONVERSIONBASEDUNIT' && this.enumOf(u, 1) === 'LENGTHUNIT') {
                const measure = this.deref(u.args[3]);
                const factor = this.num(measure, 0) ?? 1;
                const base = this.deref(measure?.args[1]);
                const baseMm =
                    base?.type === 'IFCSIUNIT' ? siScale(this.enumOf(base, 2)) * 1000 : 1000;
                return factor * baseMm;
            }
        }
        return 1000;
    }

    // ---- Relations -------------------------------------------------------------------------

    private indexRelations(): void {
        for (const r of this.all('IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
            const structure = isRef(r.args[5]) ? r.args[5].ref : null;
            if (structure === null) continue;
            for (const e of this.refs(r, 4)) this.containedIn.set(e.id, structure);
        }
        for (const r of this.all('IFCRELAGGREGATES', 'IFCRELNESTS')) {
            const whole = isRef(r.args[4]) ? r.args[4].ref : null;
            if (whole === null) continue;
            const parts = this.refs(r, 5).map((e) => e.id);
            for (const p of parts) this.aggregatedIn.set(p, whole);
            this.children.set(whole, [...(this.children.get(whole) ?? []), ...parts]);
        }
        for (const r of this.all('IFCRELVOIDSELEMENT')) {
            const host = isRef(r.args[4]) ? r.args[4].ref : null;
            const opening = isRef(r.args[5]) ? r.args[5].ref : null;
            if (host === null || opening === null) continue;
            this.voids.set(host, [...(this.voids.get(host) ?? []), opening]);
            this.voidHost.set(opening, host);
        }
        for (const r of this.all('IFCRELFILLSELEMENT')) {
            const opening = isRef(r.args[4]) ? r.args[4].ref : null;
            const filler = isRef(r.args[5]) ? r.args[5].ref : null;
            if (opening !== null && filler !== null) this.fills.set(filler, opening);
        }
        for (const r of this.all('IFCRELASSOCIATESMATERIAL')) {
            const material = isRef(r.args[5]) ? r.args[5].ref : null;
            if (material === null) continue;
            for (const e of this.refs(r, 4)) this.materialOf.set(e.id, material);
        }
        for (const r of this.all('IFCRELDEFINESBYTYPE')) {
            const type = isRef(r.args[5]) ? r.args[5].ref : null;
            if (type === null) continue;
            for (const e of this.refs(r, 4)) this.typeOf.set(e.id, type);
        }
        for (const r of this.all('IFCRELDEFINESBYPROPERTIES')) {
            const pset = isRef(r.args[5]) ? r.args[5].ref : null;
            if (pset === null) continue;
            for (const e of this.refs(r, 4)) {
                this.psetsOf.set(e.id, [...(this.psetsOf.get(e.id) ?? []), pset]);
            }
        }
    }

    /** The storey (or other spatial element) a product is in, through its whole. */
    storeyOf(e: StepEntity): StepEntity | null {
        let id: number | undefined = e.id;
        for (let guard = 0; id !== undefined && guard < 16; guard++) {
            const container = this.containedIn.get(id);
            if (container !== undefined) {
                const c = this.get(container);
                if (c?.type === 'IFCBUILDINGSTOREY') return c;
                id = container;
                continue;
            }
            const whole = this.aggregatedIn.get(id);
            const w = this.get(whole);
            if (w?.type === 'IFCBUILDINGSTOREY') return w;
            id = whole;
        }
        return null;
    }

    /** The parts an element is made of (`IfcRelAggregates`): a roof's slabs, a stair's flights. */
    partsOf(e: StepEntity): StepEntity[] {
        return (this.children.get(e.id) ?? []).map((id) => this.get(id)!).filter(Boolean);
    }

    /** The whole an element is a part of, if any. */
    wholeOf(e: StepEntity): StepEntity | null {
        return this.get(this.aggregatedIn.get(e.id));
    }

    /** The openings cut into an element. */
    openingsIn(e: StepEntity): StepEntity[] {
        return (this.voids.get(e.id) ?? []).map((id) => this.get(id)!).filter(Boolean);
    }

    /** The element an opening is cut into. */
    hostOf(opening: StepEntity): StepEntity | null {
        return this.get(this.voidHost.get(opening.id));
    }

    /** The opening a door or window fills. */
    openingFilledBy(filler: StepEntity): StepEntity | null {
        return this.get(this.fills.get(filler.id));
    }

    /** The element's type object (`IfcWallType`, `IfcDoorStyle`, …), if it has one. */
    typeObject(e: StepEntity): StepEntity | null {
        return this.get(this.typeOf.get(e.id));
    }

    /**
     * Every single-valued property of the element and of its type, by property-set name and
     * property name; the element's own win over its type's.
     */
    properties(e: StepEntity): Map<string, Map<string, StepValue>> {
        const out = new Map<string, Map<string, StepValue>>();
        const add = (pset: StepEntity | null) => {
            if (!pset || pset.type !== 'IFCPROPERTYSET') return;
            const name = this.name(pset);
            let props = out.get(name);
            if (!props) out.set(name, (props = new Map()));
            for (const p of this.refs(pset, 4)) {
                if (p.type !== 'IFCPROPERTYSINGLEVALUE') continue;
                const key = this.str(p, 0);
                const value = p.args[2];
                if (key) props.set(key, isTyped(value) ? value.value : (value ?? null));
            }
        };
        const type = this.typeObject(e);
        if (type) for (const p of this.refs(type, 5)) add(p);
        for (const id of this.psetsOf.get(e.id) ?? []) add(this.get(id));
        return out;
    }

    /** One property by name from any property set (`IsExternal`, `LoadBearing`), or undefined. */
    property(e: StepEntity, name: string): StepValue | undefined {
        for (const props of this.properties(e).values()) {
            if (props.has(name)) return props.get(name);
        }
        return undefined;
    }

    // ---- Materials -------------------------------------------------------------------------

    /**
     * The element's layered material: its own `IfcMaterialLayerSetUsage` or layer set, or failing
     * that its type's. Null for an element of one material or none.
     */
    layerUsage(e: StepEntity): IfcLayerUsage | null {
        const own = this.get(this.materialOf.get(e.id));
        const type = this.typeObject(e);
        const fromType = type ? this.get(this.materialOf.get(type.id)) : null;
        for (const m of [own, fromType]) {
            if (!m) continue;
            if (m.type === 'IFCMATERIALLAYERSETUSAGE') {
                const set = this.deref(m.args[0]);
                if (!set) continue;
                return {
                    name: this.str(set, 1) ?? '',
                    layers: this.layersOf(set),
                    direction: this.enumOf(m, 1) ?? 'AXIS2',
                    sense: this.enumOf(m, 2) === 'NEGATIVE' ? -1 : 1,
                    offset: (this.num(m, 3) ?? 0) * this.mmPerUnit,
                };
            }
            if (m.type === 'IFCMATERIALLAYERSET') {
                return {
                    name: this.str(m, 1) ?? '',
                    layers: this.layersOf(m),
                    direction: 'AXIS2',
                    sense: 1,
                    offset: 0,
                };
            }
        }
        return null;
    }

    /** The names of the element's materials when it has no layers: one, a list, or a constituent set. */
    materialNames(e: StepEntity): string[] {
        const m = this.get(this.materialOf.get(e.id));
        if (!m) return [];
        if (m.type === 'IFCMATERIAL') return [this.str(m, 0) ?? ''];
        if (m.type === 'IFCMATERIALLIST') return this.refs(m, 0).map((x) => this.str(x, 0) ?? '');
        if (m.type === 'IFCMATERIALLAYERSETUSAGE' || m.type === 'IFCMATERIALLAYERSET') {
            return (this.layerUsage(e)?.layers ?? []).map((l) => l.material);
        }
        if (m.type === 'IFCMATERIALCONSTITUENTSET') {
            return this.refs(m, 2).map((c) => this.str(this.deref(c.args[2]), 0) ?? '');
        }
        return [];
    }

    private layersOf(set: StepEntity): IfcLayer[] {
        return this.refs(set, 0).map((l) => ({
            material: this.str(this.deref(l.args[0]), 0) ?? '',
            thickness: (this.num(l, 1) ?? 0) * this.mmPerUnit,
            ventilated: l.args[2] === true || (isEnum(l.args[2]) && l.args[2].enum === 'T'),
            category: this.str(l, 5),
        }));
    }

    // ---- Placement -------------------------------------------------------------------------

    /** Where a product's local frame is in the world. */
    placementOf(e: StepEntity): Frame {
        return this.localPlacement(this.deref(e.args[5]));
    }

    private localPlacement(p: StepEntity | null): Frame {
        if (!p || p.type !== 'IFCLOCALPLACEMENT') return IDENTITY;
        const cached = this.frames.get(p.id);
        if (cached) return cached;
        const parent = this.localPlacement(this.deref(p.args[0]));
        const own = this.axis2(this.deref(p.args[1]));
        const frame = compose(parent, own);
        this.frames.set(p.id, frame);
        return frame;
    }

    /** An `IfcAxis2Placement3D` or `2D` as a frame, in mm. */
    axis2(a: StepEntity | null): Frame {
        if (!a) return IDENTITY;
        const o = this.point(this.deref(a.args[0]));
        if (a.type === 'IFCAXIS2PLACEMENT2D') {
            const xd = this.direction(this.deref(a.args[1])) ?? { x: 1, y: 0, z: 0 };
            const x = normalize({ x: xd.x, y: xd.y, z: 0 });
            return { o, x, y: { x: -x.y, y: x.x, z: 0 }, z: { x: 0, y: 0, z: 1 } };
        }
        const z = normalize(this.direction(this.deref(a.args[1])) ?? { x: 0, y: 0, z: 1 });
        const ref = this.direction(this.deref(a.args[2])) ?? { x: 1, y: 0, z: 0 };
        // The x axis is the reference direction made square to z.
        let x = sub(ref, scale(z, dot(ref, z)));
        if (length(x) < 1e-9) x = Math.abs(z.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        x = normalize(sub(x, scale(z, dot(x, z))));
        return { o, x, y: cross(z, x), z };
    }

    /** A cartesian point in mm (2D points get z = 0). */
    point(p: StepEntity | null): Vec3 {
        const c = p?.args[0];
        if (!Array.isArray(c)) return { x: 0, y: 0, z: 0 };
        const k = this.mmPerUnit;
        return {
            x: ((c[0] as number) ?? 0) * k,
            y: ((c[1] as number) ?? 0) * k,
            z: ((c[2] as number) ?? 0) * k,
        };
    }

    direction(d: StepEntity | null): Vec3 | null {
        const c = d?.args[0];
        if (!Array.isArray(c)) return null;
        return { x: (c[0] as number) ?? 0, y: (c[1] as number) ?? 0, z: (c[2] as number) ?? 0 };
    }

    // ---- Representations -------------------------------------------------------------------

    /** The product's shape representations by identifier: `Axis`, `Body`, `FootPrint`, … */
    representations(e: StepEntity): Map<string, StepEntity[]> {
        const shape = this.deref(e.args[6]);
        const out = new Map<string, StepEntity[]>();
        for (const rep of this.refs(shape, 2)) {
            const id = this.str(rep, 1) ?? '';
            out.set(id, [...(out.get(id) ?? []), rep]);
        }
        return out;
    }

    /** The axis of a wall in the world: the two ends of its `Axis` representation. */
    axisOf(e: StepEntity): [Vec3, Vec3] | null {
        const frame = this.placementOf(e);
        for (const rep of this.representations(e).get('Axis') ?? []) {
            for (const item of this.refs(rep, 3)) {
                const pts = this.curvePoints(item, IDENTITY);
                if (pts.length >= 2) {
                    return [apply(frame, pts[0]!), apply(frame, pts[pts.length - 1]!)];
                }
            }
        }
        return null;
    }

    /**
     * Every point of a product's `'Axis'` curve in the world, in order — a stair flight's walking
     * line, round its turns; null where it has none.
     */
    axisPoints(e: StepEntity): Vec3[] | null {
        const frame = this.placementOf(e);
        for (const rep of this.representations(e).get('Axis') ?? []) {
            for (const item of this.refs(rep, 3)) {
                const pts = this.curvePoints(item, IDENTITY);
                if (pts.length >= 2) return pts.map((p) => apply(frame, p));
            }
        }
        return null;
    }

    /** The corners of a product's body in the world — enough for its box and its footprint. */
    bodyPoints(e: StepEntity): Vec3[] {
        const frame = this.placementOf(e);
        const reps = this.representations(e);
        const body = reps.get('Body') ?? reps.get('') ?? [];
        const out: Vec3[] = [];
        for (const rep of body) {
            for (const item of this.refs(rep, 3)) this.itemPoints(item, frame, out);
        }
        return out;
    }

    /**
     * The planar faces of a product's body in the world, each with its area (mm²): an
     * extrusion's two caps, a b-rep's or a face set's faces. Enough to read a roof's planes.
     */
    bodyFaces(e: StepEntity): { normal: Vec3; area: number; points: Vec3[] }[] {
        const out: { normal: Vec3; area: number; points: Vec3[] }[] = [];
        const push = (points: Vec3[]) => {
            if (points.length < 3) return;
            const n = newell(points);
            const area = length(n) / 2;
            if (area > 1) out.push({ normal: normalize(n), area, points });
        };
        for (const x of this.extrusions(e)) {
            const cap = x.profile.map((p) => apply(x.frame, p));
            push(cap);
            const d = scale(applyDir(x.frame, x.dir), x.depth);
            push(cap.map((p) => add(p, d)));
        }
        const frame = this.placementOf(e);
        const visit = (item: StepEntity | null, at: Frame): void => {
            if (!item) return;
            if (item.type === 'IFCMAPPEDITEM') {
                const map = this.deref(item.args[0]);
                const target = this.transformOperator(this.deref(item.args[1]));
                const origin = this.axis2(this.deref(map?.args[0]));
                const placed = compose(compose(at, target), invert(origin));
                for (const sub of this.refs(this.deref(map?.args[1]), 3)) visit(sub, placed);
                return;
            }
            const faces: StepEntity[] =
                item.type === 'IFCFACETEDBREP' || item.type === 'IFCFACETEDBREPWITHVOIDS'
                    ? this.refs(this.deref(item.args[0]), 0)
                    : item.type === 'IFCFACEBASEDSURFACEMODEL'
                      ? this.refs(item, 0).flatMap((set) => this.refs(set, 0))
                      : item.type === 'IFCSHELLBASEDSURFACEMODEL'
                        ? this.refs(item, 0).flatMap((shell) => this.refs(shell, 0))
                        : [];
            for (const face of faces) {
                const outer = this.refs(face, 0)[0];
                const loop = this.deref(outer?.args[0]);
                if (loop?.type === 'IFCPOLYLOOP') {
                    push(this.refs(loop, 0).map((p) => apply(at, this.point(p))));
                }
            }
        };
        for (const rep of this.representations(e).get('Body') ?? []) {
            for (const item of this.refs(rep, 3)) visit(item, frame);
        }
        return out;
    }

    /**
     * The extruded solids of a product's body, as the profile (in the frame's own plane), the
     * frame, the extrusion's direction in that frame, and its depth in mm.
     */
    extrusions(e: StepEntity): { profile: Vec3[]; frame: Frame; dir: Vec3; depth: number }[] {
        const frame = this.placementOf(e);
        const out: { profile: Vec3[]; frame: Frame; dir: Vec3; depth: number }[] = [];
        const visit = (item: StepEntity | null, at: Frame): void => {
            if (!item) return;
            if (item.type === 'IFCBOOLEANCLIPPINGRESULT' || item.type === 'IFCBOOLEANRESULT') {
                visit(this.deref(item.args[1]), at);
            } else if (item.type === 'IFCEXTRUDEDAREASOLID') {
                const pos = compose(at, this.axis2(this.deref(item.args[1])));
                const d = this.direction(this.deref(item.args[2])) ?? { x: 0, y: 0, z: 1 };
                out.push({
                    profile: this.profilePoints(this.deref(item.args[0])),
                    frame: pos,
                    dir: normalize(d),
                    depth: (this.num(item, 3) ?? 0) * this.mmPerUnit,
                });
            } else if (item.type === 'IFCMAPPEDITEM') {
                const map = this.deref(item.args[0]);
                const target = this.transformOperator(this.deref(item.args[1]));
                const origin = this.axis2(this.deref(map?.args[0]));
                const placed = compose(compose(at, target), invert(origin));
                for (const sub of this.refs(this.deref(map?.args[1]), 3)) visit(sub, placed);
            }
        };
        for (const rep of this.representations(e).get('Body') ?? []) {
            for (const item of this.refs(rep, 3)) visit(item, frame);
        }
        return out;
    }

    private itemPoints(item: StepEntity, at: Frame, out: Vec3[]): void {
        switch (item.type) {
            case 'IFCEXTRUDEDAREASOLID': {
                const pos = compose(at, this.axis2(this.deref(item.args[1])));
                const d = normalize(
                    this.direction(this.deref(item.args[2])) ?? { x: 0, y: 0, z: 1 }
                );
                const depth = (this.num(item, 3) ?? 0) * this.mmPerUnit;
                for (const p of this.profilePoints(this.deref(item.args[0]))) {
                    out.push(apply(pos, p));
                    out.push(apply(pos, add(p, scale(d, depth))));
                }
                return;
            }
            case 'IFCBOOLEANCLIPPINGRESULT':
            case 'IFCBOOLEANRESULT': {
                const first = this.deref(item.args[1]);
                if (first) this.itemPoints(first, at, out);
                return;
            }
            case 'IFCMAPPEDITEM': {
                const map = this.deref(item.args[0]);
                const target = this.transformOperator(this.deref(item.args[1]));
                const origin = this.axis2(this.deref(map?.args[0]));
                const placed = compose(compose(at, target), invert(origin));
                for (const sub of this.refs(this.deref(map?.args[1]), 3)) {
                    this.itemPoints(sub, placed, out);
                }
                return;
            }
            case 'IFCFACETEDBREP':
            case 'IFCFACETEDBREPWITHVOIDS': {
                const shell = this.deref(item.args[0]);
                for (const face of this.refs(shell, 0)) this.facePoints(face, at, out);
                return;
            }
            case 'IFCFACEBASEDSURFACEMODEL':
                for (const set of this.refs(item, 0)) {
                    for (const face of this.refs(set, 0)) this.facePoints(face, at, out);
                }
                return;
            case 'IFCSHELLBASEDSURFACEMODEL':
                for (const shell of this.refs(item, 0)) {
                    for (const face of this.refs(shell, 0)) this.facePoints(face, at, out);
                }
                return;
            case 'IFCTRIANGULATEDFACESET':
            case 'IFCPOLYGONALFACESET': {
                const list = this.deref(item.args[0]);
                const coords = list?.args[0];
                if (!Array.isArray(coords)) return;
                const k = this.mmPerUnit;
                for (const c of coords) {
                    if (!Array.isArray(c)) continue;
                    const [x, y, z] = c as number[];
                    out.push(apply(at, { x: (x ?? 0) * k, y: (y ?? 0) * k, z: (z ?? 0) * k }));
                }
                return;
            }
            default:
                return;
        }
    }

    private facePoints(face: StepEntity, at: Frame, out: Vec3[]): void {
        for (const bound of this.refs(face, 0)) {
            const loop = this.deref(bound.args[0]);
            if (loop?.type !== 'IFCPOLYLOOP') continue;
            for (const p of this.refs(loop, 0)) out.push(apply(at, this.point(p)));
        }
    }

    private transformOperator(t: StepEntity | null): Frame {
        if (!t) return IDENTITY;
        const x = this.direction(this.deref(t.args[0]));
        const y = this.direction(this.deref(t.args[1]));
        const o = this.point(this.deref(t.args[2]));
        const z = t.args.length > 4 ? this.direction(this.deref(t.args[4])) : null;
        const xx = normalize(x ?? { x: 1, y: 0, z: 0 });
        const zz = normalize(z ?? cross(xx, y ?? { x: 0, y: 1, z: 0 }));
        return { o, x: xx, y: cross(zz, xx), z: zz };
    }

    /** A profile's outline in its own plane (z = 0), mm. */
    profilePoints(profile: StepEntity | null): Vec3[] {
        if (!profile) return [];
        switch (profile.type) {
            case 'IFCRECTANGLEPROFILEDEF':
            case 'IFCROUNDEDRECTANGLEPROFILEDEF':
            case 'IFCRECTANGLEHOLLOWPROFILEDEF': {
                const pos = this.axis2(this.deref(profile.args[2]));
                const hx = ((this.num(profile, 3) ?? 0) * this.mmPerUnit) / 2;
                const hy = ((this.num(profile, 4) ?? 0) * this.mmPerUnit) / 2;
                return [
                    { x: -hx, y: -hy, z: 0 },
                    { x: hx, y: -hy, z: 0 },
                    { x: hx, y: hy, z: 0 },
                    { x: -hx, y: hy, z: 0 },
                ].map((p) => apply(pos, p));
            }
            case 'IFCCIRCLEPROFILEDEF':
            case 'IFCCIRCLEHOLLOWPROFILEDEF': {
                const pos = this.axis2(this.deref(profile.args[2]));
                const r = (this.num(profile, 3) ?? 0) * this.mmPerUnit;
                return Array.from({ length: 8 }, (_, i) => {
                    const a = (i * Math.PI) / 4;
                    return apply(pos, { x: r * Math.cos(a), y: r * Math.sin(a), z: 0 });
                });
            }
            case 'IFCARBITRARYCLOSEDPROFILEDEF':
            case 'IFCARBITRARYPROFILEDEFWITHVOIDS':
                return this.curvePoints(this.deref(profile.args[2]), IDENTITY);
            case 'IFCDERIVEDPROFILEDEF': {
                const parent = this.profilePoints(this.deref(profile.args[2]));
                const op = this.deref(profile.args[3]);
                if (!op) return parent;
                const x = this.direction(this.deref(op.args[0])) ?? { x: 1, y: 0, z: 0 };
                const o = this.point(this.deref(op.args[2]));
                const xx = normalize({ x: x.x, y: x.y, z: 0 });
                const f: Frame = {
                    o,
                    x: xx,
                    y: { x: -xx.y, y: xx.x, z: 0 },
                    z: { x: 0, y: 0, z: 1 },
                };
                return parent.map((p) => apply(f, p));
            }
            default: {
                // An I, L, T, U or C section: its box is enough.
                const pos = this.axis2(this.deref(profile.args[2]));
                const w = (this.num(profile, 3) ?? 0) * this.mmPerUnit;
                const d = (this.num(profile, 4) ?? 0) * this.mmPerUnit;
                if (!w || !d) return [];
                return [
                    { x: -w / 2, y: -d / 2, z: 0 },
                    { x: w / 2, y: -d / 2, z: 0 },
                    { x: w / 2, y: d / 2, z: 0 },
                    { x: -w / 2, y: d / 2, z: 0 },
                ].map((p) => apply(pos, p));
            }
        }
    }

    /** A curve's points in mm: a polyline's corners, a composite curve's, a trimmed line's ends. */
    curvePoints(c: StepEntity | null, at: Frame): Vec3[] {
        if (!c) return [];
        switch (c.type) {
            case 'IFCPOLYLINE':
                return this.refs(c, 0).map((p) => apply(at, this.point(p)));
            case 'IFCINDEXEDPOLYCURVE': {
                const list = this.deref(c.args[0]);
                const coords = list?.args[0];
                if (!Array.isArray(coords)) return [];
                const k = this.mmPerUnit;
                return coords.map((v) => {
                    const [x, y, z] = (v as number[]) ?? [];
                    return apply(at, { x: (x ?? 0) * k, y: (y ?? 0) * k, z: (z ?? 0) * k });
                });
            }
            case 'IFCCOMPOSITECURVE': {
                const out: Vec3[] = [];
                for (const seg of this.refs(c, 0)) {
                    const pts = this.curvePoints(this.deref(seg.args[2]), at);
                    const same = seg.args[1] !== false;
                    for (const p of same ? pts : pts.reverse()) {
                        const last = out[out.length - 1];
                        if (!last || length(sub(last, p)) > 1e-6) out.push(p);
                    }
                }
                return out;
            }
            case 'IFCTRIMMEDCURVE': {
                const basis = this.deref(c.args[0]);
                const trims = [c.args[1], c.args[2]].map((t) => this.trimPoint(t, basis));
                if (basis?.type === 'IFCCIRCLE' || basis?.type === 'IFCELLIPSE') {
                    return this.arcPoints(basis, c, at);
                }
                const pts = trims.filter((p): p is Vec3 => !!p).map((p) => apply(at, p));
                return c.args[3] === false ? pts.reverse() : pts;
            }
            case 'IFCLINE': {
                const p = this.point(this.deref(c.args[0]));
                return [apply(at, p)];
            }
            case 'IFCCIRCLE':
                return this.arcPoints(c, null, at);
            default:
                return [];
        }
    }

    /** A trim given as a cartesian point (the only kind that needs no basis maths), else null. */
    private trimPoint(v: StepValue | undefined, basis: StepEntity | null): Vec3 | null {
        const list = Array.isArray(v) ? v : [];
        for (const t of list) {
            const p = this.deref(t);
            if (p?.type === 'IFCCARTESIANPOINT') return this.point(p);
        }
        // A line trimmed by parameters: the point at that distance along it.
        if (basis?.type === 'IFCLINE') {
            const param = list.find((t) => isTyped(t)) as { value: number } | undefined;
            if (param) {
                const origin = this.point(this.deref(basis.args[0]));
                const vector = this.deref(basis.args[1]);
                const dir = normalize(
                    this.direction(this.deref(vector?.args[0])) ?? { x: 1, y: 0, z: 0 }
                );
                const mag = (this.num(vector, 1) ?? 1) * this.mmPerUnit;
                return add(origin, scale(dir, param.value * mag));
            }
        }
        return null;
    }

    private arcPoints(circle: StepEntity, trimmed: StepEntity | null, at: Frame): Vec3[] {
        const pos = this.axis2(this.deref(circle.args[0]));
        const r = (this.num(circle, 1) ?? 0) * this.mmPerUnit;
        const angle = (v: StepValue | undefined): number | null => {
            for (const t of Array.isArray(v) ? v : []) {
                if (isTyped(t) && typeof t.value === 'number') return (t.value * Math.PI) / 180;
                const p = this.deref(t);
                if (p?.type === 'IFCCARTESIANPOINT') {
                    const q = this.point(p);
                    const d = sub(q, pos.o);
                    return Math.atan2(dot(d, pos.y), dot(d, pos.x));
                }
            }
            return null;
        };
        let a0 = trimmed ? (angle(trimmed.args[1]) ?? 0) : 0;
        let a1 = trimmed ? (angle(trimmed.args[2]) ?? 2 * Math.PI) : 2 * Math.PI;
        const sense = trimmed ? trimmed.args[3] !== false : true;
        if (!sense) [a0, a1] = [a1, a0];
        while (a1 <= a0) a1 += 2 * Math.PI;
        const n = Math.max(2, Math.ceil(((a1 - a0) / (2 * Math.PI)) * 8));
        const pts = Array.from({ length: n + 1 }, (_, i) => {
            const a = a0 + ((a1 - a0) * i) / n;
            return apply(at, apply(pos, { x: r * Math.cos(a), y: r * Math.sin(a), z: 0 }));
        });
        return sense ? pts : pts.reverse();
    }
}

function siScale(prefix: string | null): number {
    switch (prefix) {
        case 'MILLI':
            return 1e-3;
        case 'CENTI':
            return 1e-2;
        case 'DECI':
            return 1e-1;
        case 'KILO':
            return 1e3;
        default:
            return 1;
    }
}

// ---- Vector maths ----------------------------------------------------------------------------

export function add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, k: number): Vec3 {
    return { x: a.x * k, y: a.y * k, z: a.z * k };
}

export function dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function length(a: Vec3): number {
    return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a: Vec3): Vec3 {
    const l = length(a);
    return l < 1e-12 ? { x: 0, y: 0, z: 1 } : scale(a, 1 / l);
}

/** A point given in `f`'s frame, in the world. */
export function apply(f: Frame, p: Vec3): Vec3 {
    return {
        x: f.o.x + f.x.x * p.x + f.y.x * p.y + f.z.x * p.z,
        y: f.o.y + f.x.y * p.x + f.y.y * p.y + f.z.y * p.z,
        z: f.o.z + f.x.z * p.x + f.y.z * p.y + f.z.z * p.z,
    };
}

/** A direction given in `f`'s frame, in the world. */
export function applyDir(f: Frame, d: Vec3): Vec3 {
    return sub(apply(f, d), f.o);
}

/** `inner` placed in `outer`. */
export function compose(outer: Frame, inner: Frame): Frame {
    return {
        o: apply(outer, inner.o),
        x: applyDir(outer, inner.x),
        y: applyDir(outer, inner.y),
        z: applyDir(outer, inner.z),
    };
}

/** A polygon's normal by Newell's method, its length twice the polygon's area. */
export function newell(points: readonly Vec3[]): Vec3 {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        x += (a.y - b.y) * (a.z + b.z);
        y += (a.z - b.z) * (a.x + b.x);
        z += (a.x - b.x) * (a.y + b.y);
    }
    return { x, y, z };
}

/** The inverse of a rigid frame. */
export function invert(f: Frame): Frame {
    const x = { x: f.x.x, y: f.y.x, z: f.z.x };
    const y = { x: f.x.y, y: f.y.y, z: f.z.y };
    const z = { x: f.x.z, y: f.y.z, z: f.z.z };
    const o = { x: -dot(f.x, f.o), y: -dot(f.y, f.o), z: -dot(f.z, f.o) };
    return { o, x, y, z };
}
