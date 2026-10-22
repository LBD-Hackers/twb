# Geometry in TWB: what is supported, how it is treated, what is not

A reference for agents (and people) who write, read or import TWB house files: every kind of
geometry the package handles, the rule it follows, the constant behind the rule, and the code
that does it. Paths are relative to the repository root. Version: 0.5.0.

Read this before you write a house file by hand or from a drawing, before you change the IFC
importer, and before you decide whether a model "should" be watertight. For the IFC import's
choices about materials, build-ups, openings and rooms in more depth, see
[`ifc-import.md`](ifc-import.md).

## 1. Ground rules

| Rule | Detail | Where |
| --- | --- | --- |
| Units | Millimetres everywhere. Faces are stored to the whole millimetre; the simple shape may carry 0.1 mm, rounded on load. | `surfacekit/model/surface.ts` |
| Axes | x east, y north, z up. IFC: project north is north; true north is reported, not applied. | `ifc/ifc-to-house.ts` |
| Origin (IFC) | The south-west corner of the exterior walls' lines, and the lowest storey's floor. `report.originMm` says where that is in the IFC. | `ifc/ifc-to-house.ts` |
| A face | One planar ring (`boundaryMm`, closed implicitly, no repeated last point), its `openings` (filled by a window or door), its `holes` (inner rings). A face is the centreline of the structure (studs, joists, rafters, a masonry core), never a finished surface: no thickness is stored in the geometry. | `surfacekit/model/surface.ts` |
| Kind | Read off the geometry unless pinned (`kindOverride`): \|normal.z\| < sin 1° is a wall, > cos 1° is horizontal, between is a roof. A horizontal face at the lowest level is a floor; one some other face touches and rises from is a floor; any other horizontal face is a roof. | `surfacekit/model/classify.ts` |
| Coincidence | Points within 1 mm are one point (`COINCIDENT_MM`). Topology is found by coincidence, never stored. | `surfacekit/model/surface-ops.ts` |
| Store limits | A face must be flat to 2 mm (`PLANARITY_TOLERANCE_MM`), enclose at least 0.25 m² (`MIN_SURFACE_AREA_MM2`), and have no edge under 50 mm (`MIN_EDGE_LENGTH_MM`). A face that breaks one is refused on load and listed in `problems`. | `surfacekit/model/surface-store.ts`, `surfacekit/grid/grid-validate.ts` |

## 2. The two shapes of a house file

A house file (`twb/1`, JSON-LD, context 3) is written in one of two shapes, or both.

- **Detailed**: `surfaces`, every face as its corners. What a modeller opens, edits and saves.
  Kept as written.
- **Simple**: walls as plan lines and a height, the roof by type and pitch, openings by centre and
  size, partitions as plan lines, floor openings as rings. Input only: opening the file saturates
  it into faces (`expandSimpleHouse`, then `saturateHouse` writes the detailed shape). What a
  language model reading a drawing is asked to write.

`houseShapeOf(json)` says which: simple if any of `SIMPLE_SHAPE_TERMS` is present (`walls`,
`wallHeightMm`, `roof`, `openings`, `floorOpenings`, `interiorWalls`). Code:
`src/house/simple-house.ts`, `src/house/house-file.ts`, `src/house/house-jsonld.ts`.

## 3. The simple shape, term by term

| Term (JSON-LD) | What it is | How it becomes faces |
| --- | --- | --- |
| `walls` (`twb:planWalls`) | Exterior walls: `{ points, storey?, partition?, buildUpType?, id? }`, each a plan polyline along the structure's line. Every segment is a wall. Any order and direction. | See 3.1 and 3.2. Each wall becomes one face per storey, its top following the roof over it. |
| `wallHeightMm` (`twb:wallHeightMm`) | The eave height above the lowest floor. Storey by storey: a storey's top is the next storey's floor, or its own `heightMm`. | Where a wall stops when no roof is over it. |
| `storeys` | `{ name, elevationMm, heightMm }`. | One floor per storey (see 3.1, 3.2). |
| `roof` (`twb:planRoof`) | `{ type, pitchDeg, eaveMm?, storey?, outline?, ridge?, highSide?, cover? }`, or an array of them. | See 3.3. |
| `openings` (`twb:planOpenings`) | `{ kind, at, widthMm, heightMm, sillMm?, storey?, typeId?, glazing?, leaves?, detail? }`. | See 3.4. |
| `interiorWalls` (`twb:planPartitions`) | Partitions: `{ points, storey?, loadBearing?, partition?, buildUpType? }`. | See 3.5. |
| `floorOpenings` (`twb:planFloorOpenings`) | `{ storey, outline }`: a ring cut out of a storey's floor with no walls round it (a stair's opening, a gallery's edge). Not on the lowest storey. | See 3.6. |
| `zones`, `zoneSeparations` | Rooms by a seed point; separations as plan lines between rooms with no wall. | See 3.7. |

### 3.1 One outline (no wall names a storey)

- **The outline** is traced round the outside of all wall lines (`outerOutline`): segments are
  split where they cross or where an end lands on another (ends within 1 mm join), then the walk
  turns as far right as it can at every corner. Partitions, splits at doors and lines sticking out
  are never reached, or are walked out and back and cut off. Lines that close round nothing give
  the error `"walls" do not close around the house`.
- **Floors**: one per storey on the outline, with every corner the walk passed (so each shares
  the walls' corners), at the storey's elevation. A storey starting above the eaves gets no floor.
- **Walls**: each line from the lowest floor up to the roof over it, split into one face per
  storey (ids `<wall>-<storey>`).
- **Blocks apart** are not supported on this path: only the block the walk reaches first is the
  outline. Name the walls' storeys to get several blocks.

### 3.2 Storey by storey (any wall names a storey)

A wall naming no storey stands on the lowest. Each storey:

- **Blocks** (`planBlocks`): the storey's wall lines are grouped by which meet (`segmentGroups`).
  Each group traced round its outside is a block, unless it lies inside another block's outline,
  where it is a **courtyard** of that block. Largest block first; the first keeps the plain ids
  (`floor`, `floor-<storey>`), later ones are numbered (`floor-<storey>-2`). Groups that close
  round nothing are ignored silently; a storey none of whose walls close gives an error.
- **Floors**: one per block on its outline, with its courtyards (and voids) as holes, at the
  storey's elevation.
- **Walls**: from the storey's floor to its top (the next storey's floor, or its own height), up
  to the roof over them.
- **Courtyard or void.** A ring of walls inside a block is a courtyard (open to the sky) unless it
  is a **void**: a room of the storey below rising through this one. A courtyard is a void when a
  roof of the storey covers it (a roof part naming the storey with the courtyard as its
  `outline`), or when the storey above stands over it with no ring there (its floor closes it), or
  when the storey above has a void there (it rises on). Worked out from the top storey down, so a
  void rises through any number of storeys to the roof.
- **Roofs**: see 3.3. A storey with no roof of its own is roofed flat at its top over what of each
  block the storey above does not stand on (`outlineDifference`), plus the floor of each
  courtyard of the storey above (open to the sky), less this storey's own courtyards there. Under
  a void of the storey above: nothing (the room rises on). Courtyards are holes in that roof.
- **Openings** go into walls of their own storey only.

### 3.3 Roofs

`generateRoof` (`surfacekit/model/roof-generate.ts`):

| Type | Outline it accepts | Result |
| --- | --- | --- |
| `flat` | Any | One level plane at the eave. |
| `shed` | Any | One plane rising from the low side to `highSide`. |
| `gable` | Square corners only (rectangle, L, T, U, cross) | Built wing by wing: the outline covered by the largest rectangles, each with its ridge along its length (`ridge` picks the axis where it is ambiguous); valleys where wings meet; a step between wings closed by an upright face. |
| `hip` | Square corners, or any convex outline | Wing by wing as gable, hips at the short sides; on a convex outline the straight skeleton. |

Pitch between 0.5° and 85° (`MIN_PITCH_DEG`, `MAX_PITCH_DEG`). `cover` runs the roof on over a
shallow recess. A roof that cannot be made gives an error (`roof: …`, `the roof over "S": …`).

Which roof covers what:

- One outline: the roof (or each part, each needing its own `outline` when there are several)
  over the outline, eave at `eaveMm` or `wallHeightMm`. Wall tops meet roof corners exactly
  (`withCorners`).
- Storey by storey: a part naming a storey covers it (one naming none covers the top storey), over
  the block its `outline` lies in, or over every block when it gives none; eave at the storey's top
  unless it says. A flat part is open over the block's courtyards (not its voids). A part whose
  outline lies in a courtyard roofs that courtyard: it makes it a void.

Not supported: mansard, half-hip, dormers, curved roofs, a gable on an outline without square
corners, a hip on a concave outline without square corners, a pitched roof with courtyard holes.

### 3.4 Openings (windows, doors)

- Each opening goes on the **exterior wall line nearest its `at`** (of its own storey, storey by
  storey), centred there, if within 600 mm (`OPENING_REACH_MM`); else the error `openings[i].at is
  not on any wall`.
- A **partition** line nearer than the exterior line by more than 1 mm takes it instead; on a tie
  the exterior wall keeps it. Partition openings are cut in once the partition is built
  (`placeInteriorOpenings`, within 300 mm of its face).
- The opening must fit on one storey's face of the wall (sill and head inside it); else `does not
  fit on one storey of wall`.
- `sillMm` is above the opening's storey's floor; a door's sill is 0.
- No openings in roofs or floors: a roof window is not representable in the simple shape (the IFC
  import lists them in `report.roofOpenings`).

### 3.5 Partitions

`buildInteriorWalls` (`src/house/load.ts`): each run's points are saturated onto the storey's
geometry (an end near an exterior wall lands on it; an end on another run stays where it is),
snapped to the module grid only on a storey drawn to it (`storeyOnModule`; `snapToModule: false`
keeps the file's numbers, as the IFC import needs), then built on that storey up to the floor
above, or the roof on the top storey (`interiorWallSegmentRings`). Then a partition not marked
load-bearing, between two rooms that both have ceilings, is cut to stop under the higher ceiling
(`partitionCeilingFits`). A run that collapses below two distinct points is reported.

### 3.6 Floor openings

`floorOpenings` (`floorFaces` in `simple-house.ts`): each ring is cut out of its storey's floor in
either path, in the block it lies in. Strictly inside the floor it becomes a hole; reaching the
floor's edge, a notch; cutting the floor through, pieces (`<floor>-piece-2`). Wall corners on the
floor's straight runs stay corners of it. The room under it is double height over the opening
only. Errors: a storey the file does not have, or the lowest storey.

### 3.7 Rooms

A zone is a seed point; its room is the face of the storey's plan graph containing it, made of the
storey's wall footprints, its floors' edges and its separations (`resolveZoneRooms`,
`roomOutlineAt`). Stubs that end mid-room are pruned. A room under 0.25 m² (`MIN_ZONE_AREA_M2`),
or one an earlier zone already claims, has no outline (`open` / `shared`).

## 4. Opening a file (`loadHouse`)

1. `parseHouseFile` (the simple shape saturated first).
2. `cleanDrawing`: a face with exactly the same corners as an earlier one (any order) is dropped;
   so is a repeated guide. Always.
3. `SurfaceStore.load`: faces breaking the store limits (section 1) are skipped and reported.
4. Partitions built, their doors cut in (3.5).
5. Zones loaded.
6. Only with `repair: 'clean'`: faces split for nothing are healed (`faceMerges`, each through
   `SurfaceStore.mergeFaces`; a refused merge is left; `merged` counts them). Two faces heal when
   they are coplanar, share an edge, carry the same settings, and nothing else is drawn along the
   shared edge (a partition, a floor at that level, a structural line, a face crossing it). The
   default `'none'` mends nothing: a modeller's own drawing is never healed on load.

`problems` lists the file's errors, the skipped faces and what partitions and their doors could
not build. `saturateHouse(input, options)` = `loadHouse` + Save. CLI: `twb saturate [--no-snap]
[--clean]`, `twb check`.

## 5. Is it closed? (`watertightReport`)

`src/house/watertight.ts`, on any opened house, either shape. Plain data:

- **Shell**: every roof; every floor over the ground or the weather (not one between storeys,
  nor one round a hall rising through it); every wall with the house on one side and the weather
  on the other. "Inside" at a point = the highest floor or roof under it (not cut out of that face)
  is a floor. Each wall is probed 50 mm either side, 50 mm over its foot; a floor 50 mm under
  itself. Partitions and garden walls are not shell.
- **Leaks**: stretches (2 mm or longer) of a shell face's edges (its outline and its holes, not its
  openings) that nothing closes. Closed = the edges of other shell faces or of any floor or roof
  run along it (collinear within 1 mm, overlapping, however split: a T counts), or it lies inside
  one of those faces (coplanar within 1 mm): a wall's top under a wider floor above.
- **openRooms**: zones with no room outline. **openingsInNoFace**: `openings[i]…` and `interior
  window/door …` problems.
- `watertight` = a shell exists and all three lists are empty. `watertightSummary` gives text;
  `twb check` prints it.

## 6. The IFC import's geometry (`ifcToHouse`)

`src/ifc/ifc-to-house.ts`, `src/ifc/storey-plate.ts`. It writes the **simple shape**; tools that
post-process it (arch) work in those terms. Options: `{ name?, repair? }`.

### 6.1 Repair levels

| `repair` | Geometry it writes |
| --- | --- |
| `'none'` | The facade as its walls close round (6.3), storey by storey where storeys differ. Byte-identical to the importer before repair levels existed. |
| `'clean'` | `'none'`, plus: consecutive facade lines in line and alike (ring, storeys, build-up, party or not) run on into one (`clean/lines`); partition runs and separations written twice (either way round) written once (`clean/repeats`). |
| `'watertight'` (default) | `'clean'`, plus plates (6.4), fitted facades and fillers (6.5), voids (6.6), stair openings (6.7), the check (`report.watertight`), and a flat cap on a roof that cannot be generated (`roof/capped`). |

With any level but `'none'`, the import opens the result (`loadHouse`, `snapToModule: false`) and
puts `watertightReport` in `report.watertight`. Cost: one more open (B101: about 6 s).

### 6.2 What it reads from each element

- **Storeys**: the IFC storeys that walls ≥ 1.8 m tall or rooms stand on (within 400 mm of the
  storey's elevation), below the top of the tallest walls.
- **Walls** (`IfcWall`, `IfcWallStandardCase`, `IfcWallElementedCase`): the axis (or the body's
  footprint along the placement's x), the layers (`IfcMaterialLayerSetUsage`), and the line put
  through the middle of the core. Shorter than 100 mm: left out. Under 1.2 m: left out (soffits,
  knee walls). Top at or under the lowest floor: foundation, left out. Standing on the eaves:
  parapet, left out. Thinner and face to face along most of another: a lining, built into it.
- **Curtain walls**: from their members and plates; side by side within 300 mm on a line, joined;
  set in a wall, a window in it; standing alone, a wall glazed bay by bay.
- **Openings**: from the hole each door or window fills (`IfcOpeningElement`); empty openings
  written as a door (reaching the floor) or a window — except one meeting the hole a door or
  window fills in another wall (that hole carried on into the next wall at a corner), left out.
- **Rooms** (`IfcSpace`): a seed point well inside the footprint (first upright extrusion's
  profile; or a sideways-pushed section; or a b-rep's largest level face).
- **Slabs**: build-ups only on `'none'`/`'clean'`; under `'watertight'` also the plates of
  storeys without rooms (6.4) and the stair openings (6.7).
- **Roofs** (`IfcRoof` parts, `IfcSlab` `.ROOF.`): the type and pitch read off their planes
  (flat, shed, gable, hip), the eave, the overhang; under `'watertight'` also evidence for voids.

### 6.3 The facade with `'none'`

- Where every storey stands on one outline: the exterior walls are the chain of walls on the
  lowest floor that closes round the largest area (`findLoop`), corners where lines cross within a
  wall's thickness + 300 mm (`CORNER_REACH_MM`) of their ends. The storey whose facade closes
  round the most rooms may give the outline (`outline/storey`).
- Storey by storey, where two storeys' outlines differ by more than 2 % (`SAME_OUTLINE`): each
  storey's outline is the outside of its walls' lines run on by thickness + 300 mm (`outerLoop`);
  a storey whose facade does not close borrows the nearest (`outline/storeys/borrowed`);
  courtyards are rings of IFC-external or glass walls inside, round no room, 10 m² or more.
- `IsExternal` is not trusted: exterior is read off the geometry.

### 6.4 Plates (`'watertight'`)

Each storey's plate (`storeyPlate`, a 100 mm grid, coarser past 6 million cells):

1. Paint the storey's rooms, and the bodies of every wall over most of the storey's height.
2. Close (grow, shrink) by 500 mm (`CLOSE_MM`): gaps up to a metre between rooms (walls, slivers)
   fill. Fill holes under 10 m² (`MIN_HOLE_MM2`) or narrower than 2 m everywhere
   (`MIN_COURT_WIDE_MM`) now, while thin walls still close them.
3. Open (shrink, grow) by 400 mm (`OPEN_MM`): walls standing out of it go. OR with the closed
   rooms, so the rooms' sharp corners stay.
4. Fill holes again; keep only pieces that hold a room.
5. Trace each piece round its cells; straighten: jogs < 300 mm between runs ≥ 1 m first, then
   Douglas–Peucker at 1.2 cells, then any jog < 300 mm (`MIN_JOG_MM`), corners stepped < 600 mm
   both ways squared (`MIN_CORNER_STEP_MM`).

Sources, in order: rooms (plus the storey's own facade loop where it closes round no more than
1.15 × the rooms, `LOOP_SLACK`: the stairs and halls no room was placed in; the rooms' own holes
are kept); else the storey's facade loop (`walls`); else its floor slabs (`slabs`); else the
nearest storey's plate (`borrowed`). Slabs are not used where there are rooms: converters write
bounding boxes for slabs they cannot read (rvt-rs: a 211 × 103 m rectangle round B101), and
upper slabs have stairs cut out of their edges.

If every storey's plate is one block with no holes and the same outline (2 %) the facade already
closes round, the import writes what `'clean'` writes (the Duplex). Otherwise it writes the
storeys storey by storey on their plates (`outline/plates`, `outline/blocks`).

Each hole left in a plate is a **courtyard** (`outline/courtyards`) unless it is a void (6.6).
Filled holes are reported (`floor/filled`).

### 6.5 Fitting the facade onto the plate (`fitRing`, `stackOn`)

- Each plate edge takes the wall running along most of it: parallel within 5° (`FIT_SIN`), out
  from the plate by up to its thickness + 300 mm or into it by up to its thickness + 250 mm,
  overlapping half the edge or 1.5 m, and not running off into the plate (`runsInto`: its middle
  farther from the ring than thickness + 300 mm). The edge moves onto that wall's line.
- An edge with no wall is a **filler wall**: the house's own exterior build-up, on the plate's
  edge moved out by half the facade's thickness (`facade/filled`).
- Corners: where neighbouring lines cross (within 2 m of the plate's corner); lines in line
  within 50 mm are one line (`MIN_STEP_MM`); otherwise the step between them is a side of its
  own. Sides under 200 mm are removed, their neighbours meeting (`MIN_SIDE_MM`). A ring the
  fitting would turn inside out, cross itself, or shrink by more than 20 % or grow by more than
  25 % in area, stays as the plate had it (each edge keeping the wall found for it).
- Storeys stack: a line within 300 mm of a line of the storey below (`STACK_MM`), along half the
  shorter, is moved onto it.
- Corners written to the whole millimetre, shared by both lines.
- Walls along a side (parallel, within thickness + 300 mm, along half the shorter of wall and
  line) join it as part of that exterior wall: other leaves, linings, curtain walls along several
  lines, ribbon glazing over a parapet the model lost. Their openings go on the nearest line of
  their own storey.
- A wall off every plate it stands on is left out (a retaining wall round the site). A partition
  off the plate on one storey is built only on the others, and an opening in it there is left out.

### 6.6 Voids (`'watertight'`)

A hole in storey k's plate is a void (`outline/voids`) when:

- rooms of storey k − 1 stand under at least half of it (`VOID_ROOM_SHARE`, sampled 20 × 20), or a
  void of storey k − 1 is under it (it rises on); **and**
- an IFC roof over storey k (bottom ≥ storey elevation + 1.2 m) has at least half of its plan box
  over the hole (`ROOF_OVER_SHARE`): a roof of its own, not a converter's box over a whole block.

Its walls are written as a ring (`void-…`). It gets a flat roof part on the last storey it rises
through (the one with no block over it, or with an open courtyard over it). B101: the sports hall
rises from the ground floor through the first, under the boxes rvt-rs made of its special roof;
its planted courtyards over the basement stay courtyards.

### 6.7 Stair openings (`'watertight'`)

On each storey over the lowest, inside the plan box of each `IfcStair` (or a flight on its own)
that climbs to its floor (from at least 1.2 m below to within 600 mm of it): what the storey's
floor slabs (top within 150 mm of its elevation, not roof, landing or base slab) leave uncovered,
plus the openings cut into those slabs. Pieces under 0.5 m², or slivers (2 × area ÷ perimeter under 300 mm: the gap between a slab's
edge and a wall's line), go. Edges
within 600 mm of the storey's edge move out to it (a notch, not a sliver of floor); edges within
100 mm of a partition's, separation's or facade's line move onto it. Written as `floorOpenings`
(`floor/openings`); separations along their edges are dropped. The Duplex: two notches of
1.17 × 3.54 m on Level 2.

## 7. Not supported

**Geometry the house file cannot hold**

- Curved walls, curved or free-form roofs (B101's sports hall roof is written flat at its storey's
  top), mansards, dormers, half-hips.
- Openings in roofs (skylights, roof windows: listed in `report.roofOpenings` by the IFC import)
  and in floors other than as `floorOpenings`.
- A pitched roof with a courtyard through it.
- Split levels and half storeys; a storey's floor at more than one height.
- Walls that lean, or a wall whose thickness changes up its height. A face has no thickness.
- Stairs, ramps, railings, footings, piles, chimneys, terrain.

**Simple shape**

- Several blocks on the one-outline path (name the walls' storeys instead).
- A block inside a courtyard (an island) is read as a courtyard of the outer block.
- A void needs a ring of walls round it; a stair's opening (no walls) needs `floorOpenings`.

**IFC import**

- A storey's plate comes from its rooms: a part of a building with no `IfcSpace` in it is left out
  of the plate; a room nobody placed, 10 m² or more and over 2 m wide, inside a block, is read as a
  courtyard (or a void, with a room below and a roof of its own over it).
- Slab shapes are not trusted where rooms exist; slab voids (`IfcArbitraryProfileDefWithVoids`)
  are not read, only `IfcOpeningElement`s in slabs and gaps between slabs.
- Roof shapes from the IFC's geometry (piece 3 in the 0.5.0 plan) are not read: a roof is flat,
  shed, gable or hip over the outline, or flat at a storey's top.
- Stairs without a body (rvt-rs) give no stair openings.
- Rooms that do not close from the lines (B101: 86 of 888) and openings that land in no face
  (B101: 109) are reported, not mended.
- True north, georeferencing, ifcXML, ifcZIP and IFC5 are not read (see `ifc-import.md`).

## 8. Change ids the import reports (geometry)

`report.changes[].id`, stable, each once:

| Id | Meaning |
| --- | --- |
| `outline` | The facade does not close; every wall on the lowest floor written as exterior. |
| `outline/storey` | The outline read on an upper storey. |
| `outline/storeys` | Each storey on an outline of its own (`'none'`/`'clean'`). |
| `outline/storeys/borrowed` | A storey on the nearest storey's outline or plate. |
| `outline/courtyards` | Courtyards left open. |
| `outline/plates` | Each storey on its plate, with areas, blocks and sources (`'watertight'`). |
| `outline/blocks` | Storeys of several blocks. |
| `outline/voids` | Halls rising through storeys. |
| `floor/filled` | Holes in plates filled. |
| `floor/openings` | Stair openings cut out of floors. |
| `facade/filled` | Filler walls. |
| `clean/lines` | Facade lines run on into one. |
| `clean/repeats` | Repeated partition runs and separations written once. |
| `roof/capped` | A roof that could not be made, made flat. |
| `eave` | The eave raised over the top storey. |
| `upper-walls` | Upper storeys' exterior walls written as partitions (one outline). |
| `curtain-walls/joined`, `curtain-walls/set-in`, `curtain-walls/glazed` | Curtain walls joined, read as windows, glazed bay by bay. |
| `windows/coupled`, `windows/close` | Windows coupled, or too close for a pier. |
| `opening/<step id>` | An empty opening written as a door or window. |
| `linings` | Linings built into the walls they line. |
