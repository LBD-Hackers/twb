/**
 * What the IFC import asks of an IFC file: the questions `ifcToHouse` puts to it, and nothing
 * else. `IfcModel` answers them from the text through `step.ts`; another reader (a native one,
 * for a file of hundreds of MB) can answer them as well and be handed to `ifcToHouse` in its
 * place. Whatever answers them, the house file is the same if the answers are.
 *
 * An entity is held by its express id and its type; an attribute is asked for by its index in
 * the entity, as `IfcModel` reads it (IFC2X3 and IFC4 alike). Every length comes back in
 * **millimetres** and every point in the file's world frame (its own origin and axes, Z up), as
 * `IfcModel` documents for each answer.
 */

import type { Frame, IfcLayerUsage, Vec3 } from './ifc-model';
import type { StepValue } from './step';

/** An entity of the file: its express id (`#12`) and its type, upper case (`IFCWALL`). */
export interface IfcEntity {
    readonly id: number;
    readonly type: string;
}

export interface IfcSource {
    /** The schema the file declares (`IFC2X3`, `IFC4`, …). */
    readonly schema: string;
    /** mm per unit of length in the file. */
    readonly mmPerUnit: number;

    /** Every entity of these types, in file order (by express id). */
    all(...types: string[]): IfcEntity[];

    /** Attribute `i` as a string (a typed label's value too), or null. */
    str(e: IfcEntity | null, i: number): string | null;
    /** Attribute `i` as a number (a typed measure's value too), or null. */
    num(e: IfcEntity | null, i: number): number | null;
    /** Attribute `i` as an enumeration's value (`ELEMENT`), or null. */
    enumOf(e: IfcEntity | null, i: number): string | null;
    /** The entity attribute `i` refers to, or null. */
    ref(e: IfcEntity | null, i: number): IfcEntity | null;
    /** Its name (attribute 2), or ''. */
    name(e: IfcEntity | null): string;

    /** The whole it is a part of (`IfcRelAggregates`), or null. */
    wholeOf(e: IfcEntity): IfcEntity | null;
    /** The parts it is made of (`IfcRelAggregates`): a roof's slabs, a stair's flights. */
    partsOf(e: IfcEntity): IfcEntity[];
    /** The openings cut in this element (`IfcRelVoidsElement`). */
    openingsIn(e: IfcEntity): IfcEntity[];
    /** The element an opening is cut in, or null. */
    hostOf(opening: IfcEntity): IfcEntity | null;
    /** The opening a door or window fills (`IfcRelFillsElement`), or null. */
    openingFilledBy(filler: IfcEntity): IfcEntity | null;
    /** Its type object (`IfcWallType`, `IfcDoorStyle`, …), or null. */
    typeObject(e: IfcEntity): IfcEntity | null;

    /**
     * Its single-valued properties and its type's, by property-set name and property name; its
     * own win over its type's.
     */
    properties(e: IfcEntity): Map<string, Map<string, StepValue>>;
    /** One property by name from any of its property sets, or undefined. */
    property(e: IfcEntity, name: string): StepValue | undefined;
    /** Its layered material (its own or its type's) and how it lies on its axis, or null. */
    layerUsage(e: IfcEntity): IfcLayerUsage | null;
    /** The names of its materials when it has no layers. */
    materialNames(e: IfcEntity): string[];

    /** Where it stands: its placement chain resolved to the world, in mm. */
    placementOf(e: IfcEntity): Frame;
    /** An `IfcDirection`'s ratios as a vector, as the file has them (not normalised), or null. */
    direction(d: IfcEntity | null): Vec3 | null;
    /** A wall's axis in the world: the two ends of its `Axis` representation, or null. */
    axisOf(e: IfcEntity): [Vec3, Vec3] | null;
    /** The corners of its body in the world: enough for its box and its footprint. */
    bodyPoints(e: IfcEntity): Vec3[];
    /** The planar faces of its body in the world, each with its normal and its area (mm²). */
    bodyFaces(e: IfcEntity): { normal: Vec3; area: number; points: Vec3[] }[];
    /**
     * Its body's extruded solids: the profile (in the frame's own plane), the frame, the
     * extrusion's direction in that frame, and its depth in mm.
     */
    extrusions(e: IfcEntity): { profile: Vec3[]; frame: Frame; dir: Vec3; depth: number }[];
}
