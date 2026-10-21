# From an IFC model to a house file

An IFC model (`.ifc`, IFC2X3 or IFC4) is read into a TWB house file (`twb/1`) with no language
model and no geometry kernel: the IFC already says where every wall, opening and layer is. The
importer is [`src/ifc/`](../src/ifc/): a STEP reader (`step.ts`), the IFC entities it needs
(`ifc-model.ts`), materials matched by name (`ifc-materials.ts`) and the house it makes
(`ifc-to-house.ts`). It runs anywhere JavaScript does — Node, a browser, a worker:

```ts
import { ifcToHouse, ifcImportSummary } from '@lbd-hackers/twb/ifc';

const { house, report } = ifcToHouse(ifcText, { name: 'Duplex' });
// house: the twb/1 document (JSON-LD); report: what was read, guessed and left out
console.log(ifcImportSummary(report).join('\n'));
```

```bash
npx twb import-ifc model.ifc -o house.twb.jsonld
npx twb validate model.ifc     # read it, then check the house file it makes (needs oxigraph)
```

The test model is the buildingSMART **Duplex** (Revit 2011, IFC2X3; see
[`fixtures/README.md`](../fixtures/README.md)). It reads in well under a second as a two-storey masonry house: four exterior
walls on the middle of the concrete block, 28 windows and doors (the stair windows coupled), 22
partition runs, 20 rooms (with the open kitchen/living rooms parted by `zoneSeparations`), 21
fittings, a flat green roof behind a parapet, and build-ups for the exterior wall, partitions,
roof, ground floor and the floor between storeys.

The house file it writes opens in any TWB tool. In [arch](https://twb.madsholten.dk), the
reference tool, it is framed, dressed in its envelope, analysed and drawn like a house drawn there;
the report's wording ("arch hangs each door by its own rule") is that tool's.

## How it reads a model

The house file it writes is the **simple shape** ([`src/house/simple-house.ts`](../src/house/simple-house.ts)) — the exterior walls
as plan lines, a wall height, the storeys, the openings by centre and size, the roof by type and
pitch, the partitions as plan lines, the rooms by a point — so arch works out every face, gable
and corner the same way it does for a house read from drawings.

- **Storeys** are the IFC storeys that walls of a room's height (≥ 1.8 m) or rooms stand on,
  below the eaves. A foundation level and a roof level are not storeys. Elevations are kept as
  the IFC gives them, the lowest storey at 0.
- **Heavy or light, from the layers.** A wall's core is the layer that carries: one IFC4 marks
  `LoadBearing`; else the thickest leaf of masonry or concrete of 75 mm or more (block or
  concrete before facing brick); else the thickest layer of studs; else the thickest insulation.
  A core of masonry or concrete makes the wall heavy. Heavy exterior walls make a masonry house
  (`constructionSystem: "masonry"`), light ones a timber frame.
- **The faces are laid on the core.** arch builds a wall on one line: through the middle of its
  studs, or of the inner leaf that carries the roof. The importer puts it through the middle of
  the core, from the wall's axis and its `IfcMaterialLayerSetUsage` (offset, direction, sense).
  For the Duplex's brick-on-block wall that is 263.5 mm in from the brick face. A heavy wall of
  two mirrored leaves (a party wall) is put on its middle.
- **Exterior or partition is read off the geometry**, not `IsExternal` (the Duplex's party walls
  say they are external). The exterior walls are the chain of walls standing on the lowest floor
  that closes round the largest area, each meeting the next at a corner within its thickness +
  300 mm; the corners are where their lines cross. Upper storeys' walls on those lines are the
  same walls, higher up. Every other wall is a partition, written once per storey it stands on,
  its ends taken to the line of the wall they meet (within 400 mm; within 400 mm plus its
  thickness of a party wall, whose faces and linings stand off its middle).
- **Curtain walls** are read from their panels and mullions (they have no body of their own): their
  line the long direction of their parts in plan, through the middle of their thickness. Those side
  by side on one line (Revit writes each panel of a glazed wall as one), within 300 mm of each
  other along it, are joined into one wall of glass first. One set
  in a wall (parallel to it, inside its thickness, its length and its height — Revit's glazed
  panel in a wall) is a window in that wall, divided by its mullions and transoms. One on its own
  is a wall of the house's build-up on its line, a facade on the outline or a partition, glazed
  bay by bay: on each storey a window between each two mullions, 45 mm short of each (a 90 mm
  pier of studs), 90 mm short of the wall's ends, from its foot up to 300 mm under the storey
  above, divided by at most two transoms. A door in a curtain wall takes its bay; Revit writes its
  body with the leaf's swing in it, so it is found by the curtain wall whose line runs through it.
  A curtain wall has no layers, so it never decides a build-up: a facade that is glass all round
  gets the default exterior wall. Each window made of a curtain wall keeps its glass, measured off
  its panels (their area and count), in the report's `curtainGlass`, by where the window is: the
  house file has the window as a hole of a size, the report what glass is in it.
- **Left out as walls:** foundation walls (top at or under the lowest floor), parapets (standing
  on the eaves), walls under 1.2 m (soffits, bulkheads, knee walls) and linings (a thinner wall
  face to face with another along most of its length — the Duplex's furring walls).
- **Openings** are read from the hole each door or window fills: its extent along the wall's
  line, its sill above its storey's floor and its height. `IfcWindow` is a window; `IfcDoor` a
  door, or a garage door by its name or `ROLLINGUP`. A window's division comes from its
  `PartitioningType` (IFC4) or its style's `OperationType` (IFC2X3); a door's leaves from its
  `OperationType` (`DOUBLE_DOOR_*` is a double door). An opening nothing fills is written as a
  door if it reaches the floor, else a window, and reported.
- **Coupled windows**: windows on one wall and storey with less than 150 mm of wall between them
  (`COUPLE_GAP_MM`) leave no pier: they are one window, their frames joined. Two stacked
  over each other, as wide and in line, become one window with a transom between; two beside each
  other, as high and level, one with a mullion. The Duplex's stair windows, three of 819 × 759
  with 66 mm between, are each one window of 819 × 2410 with two transoms. arch divides a window
  into equal panes, so a narrow window close beside a wide one is kept apart and reported.
- **The roof**: flat when its slabs are level, else read off the slope of its planes — one slope
  a shed roof (and the side it rises to), two opposite a gable (and the ridge's direction), more
  a hip roof — with the pitch from their normals. The eave is where the exterior walls end (the
  lowest facade's top), or a flat roof's underside where that is lower — but never lower than a
  storey's walls (1.8 m) over the top storey's floor: a canopy, a terrace or a lower wing's roof
  under the top storey is left out instead of taking the storeys over it out of the house. The overhang is how far
  the roof runs past the walls' lines.
- **Build-ups** (`envelope`): the exterior wall's from the layer set most of its length has.
  The partitions' by kind: the house's own partition (`interiorWall`, the kind most of the
  partitions' length is), the other kind's (`lightPartition` of studs or `heavyPartition` of
  masonry) and the party walls' (`partyWall`, a wall named so or heavy with its leaves laid
  mirror-wise), each from the layer set most of its walls' length has. A partition of another
  kind than the house's own says so (`"partition": "party"`). Every other layer set of a kind is
  a build-up type of it, named after the layer set (`interiorWall:interior-plumbing-152mm-stud`),
  and its walls are dressed in it (`buildUpType`), so each keeps its own thickness. The roof's from the roof; the ground floor's from its slab with the finish
  that covers most of it on top. Inside → outside (the exterior wall by which side of the
  outline its first layer is on; a roof's covering outside; a floor's finish on top), the core
  marked, a layer of studs as timber members 45 mm c/c 600 (insulated between unless the
  build-up has its insulation elsewhere), insulation between two leaves tied, facing brick laid
  in stretcher bond. Materials are matched by name, English and Danish
  ([`src/ifc/ifc-materials.ts`](../src/ifc/ifc-materials.ts)); a name nothing matches is guessed and reported.
- **What the house is**: `buildingUse` is a dwelling when the walls or roof are insulated, else an
  unheated shed. The expression is a flat roof with parapet for a flat roof, else overhang and
  barge board; the facade from the exterior wall's outermost layer (brick, boards, sheet); the
  roof covering and `roofLoad` from the roof's outermost (green, felt, zinc, tiles).
- **Rooms** (`zones`) are the `IfcSpace`s on the storeys: number and name ("A102 Living Room"),
  a room kind from the name, and a point well inside the footprint. Where two rooms' footprints
  share an edge no wall stands on, a `zoneSeparation` parts them. A footprint stops at the walls'
  faces, so an edge running on from a partition's end, in line with its face, is moved onto the
  partition's line. A room over a stair, which Revit draws as a section pushed across the stair,
  has the footprint that section sweeps; a room written as a b-rep, its largest level face at its
  floor (the Duplex's upper hallways, without the stair's opening). A stretch of a room's edge
  that no wall and no other room stands on parts it too (the room beyond is one Revit has not
  placed). Then every end of a partition or a separation left in the middle of a room is taken to
  the line it stops short of, or that line run on to it, and two loose ends within 300 mm of each
  other are joined (a separation drawn a little beside the wall it runs on from), so the rooms
  close from the lines alone. A room gets a lowered ceiling
  only where its `IfcCovering` ceiling hangs more than 300 mm under the slab or roof over it; a
  ceiling fixed under the joists is arch's flat ceiling.
- **Fittings** (`fixtures`) from the furniture and sanitary terminals by name: wc, basin, sink,
  worktop (an island where no wall stands behind it), the sink cut into a worktop, fridge,
  dishwasher, washer, dryer, hob, shower, bathtub, floor drain, tall cabinet. Each faces away from
  the nearest wall. Base and wall cabinets are part of the kitchen run; beds, sofas and tables
  are loose furniture.
- **Posts and beams** of timber are written as `lines`.
- **Coordinates**: x east, y north, z up, in mm; the origin at the south-west corner of the
  exterior walls' lines and the lowest storey's floor. The IFC's project north is taken as north.

Every choice above is a default computed by the importer, and every value it writes is an
ordinary house-file value, so it can be changed in a tool or in the file like any other.

## Not yet supported by the parser

What the importer leaves out or reads only roughly. Everything left out is listed in the report,
which also goes into the house file's `notes`.

**Geometry and storeys**

- **Upper storeys with another outline** (setbacks, overhangs, a narrower top floor): the simple
  shape runs every exterior wall from the lowest floor to the eaves. Such walls are reported and
  written as partitions.
- **Basements and split levels**: a storey below ground is read as any other storey; half
  storeys are not recognised. A basement with other walls than the house over it: the outline is
  the facade of the storey that holds the most of the building's rooms (with no rooms in the IFC,
  the one that closes round the most, if at least a quarter more than the lowest floor's), and the
  walls under it are partitions.
- **Several buildings** in one IFC: only the largest closed outline becomes the exterior walls.
- **Curved walls**: read as the straight line between their ends.
- **Walls with no layer set** (IFC4 `IfcMaterialConstituentSet`, profile sets, a plain material)
  are one layer of the body's thickness; elemented walls (`IfcWallElementedCase` with studs as
  elements) are read by their body, not their members.
- **Floor levels**: the IFC storey elevations (usually finished floor) are taken as arch's floor
  level (the top of the joists or the slab) with no correction for the floor's build-up.
- **True north and georeferencing** (`TrueNorth`, `IfcMapConversion`): reported, not applied.
- **ifcXML, ifcZIP and IFCX (IFC5 JSON)**: only STEP `.ifc` is read. IFC4X3 is read as IFC4 but
  not tested.

**Openings**

- **The hinge side and swing of a door** (`SINGLE_SWING_LEFT/RIGHT`, swinging out): not carried;
  arch hangs each door by its own rule. Double doors in partitions are written as single doors
  (the simple shape carries leaves only on exterior walls).
- **Window divisions** come only from the partitioning type, not from the frame's geometry or
  `IfcWindowPanelProperties`; glazing bars are not read.
- **Size**: the opening is the hole in the wall (the rough opening), not the frame's own size.
  Arched or round openings become their bounding rectangle.
- **Windows in the roof** (skylights, roof windows): left out.

**Roof**

- Only flat, shed, gable and hip roofs. Mansard, half-hip, dormers, a roof of several parts at
  different heights, or a roof whose outline is not the walls' (a carport under the same roof)
  are read as the nearest of those four, over the walls' outline.
- The overhang is one value per house (eaves and verge), averaged over the sides.
- A parapet's own height is not carried (arch's is 200 mm over the roofing).

**Build-ups**

- **One build-up per kind** for the exterior wall, the roof and the ground floor: the one most of
  the length or area has. Other exterior wall types are built as that one. Partitions keep theirs
  (see Build-ups).
- **Stud size and spacing** are not read: every layer of studs is 45 mm c/c 600.
- **Steel studs and joists** are built as timber.
- **Material properties** in the IFC (`Pset_MaterialThermal`, declared λ, densities) are not
  read; materials are matched by name to arch's catalogue. Names in other languages than English
  and Danish are guessed.
- **Thin layers** (membranes of 0 mm) take arch's default thickness for the material.
- **Floors between storeys** are written as the `deck` build-up: the upper storeys' slab with the
  finish that covers most of it, read from the top. A heavy core is a slab, of hollow-core
  elements where the IFC names them so (`hollow core`, `huldæk`, `HD 220`) and of concrete cast in
  place otherwise. A heavy house also gets `floorStructure` and `roofStructure`, so a use or an
  expression picked later keeps them concrete. **Ceiling build-ups** are read but not written,
  since arch has none for them. Finishes per room are not kept: each floor takes the finish that
  covers most of it.

**Rooms, fittings and the rest**

- Room kinds come from the room's name (English and Danish words); `IfcZone` groupings, space
  boundaries and the spaces' own properties (area, occupancy) are not read.
- Fittings are recognised by name only, and face away from the nearest wall.
- **Not read at all**: stairs and ramps, railings, footings and piles (arch lays out
  its own foundation), chimneys, `IfcBuildingElementProxy`, the site and terrain, terraces and
  paths outside the house, MEP (ducts, pipes, terminals other than sanitary ones), grids,
  annotations, classifications, and steel or concrete columns and beams (lintels included).
