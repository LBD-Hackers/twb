# TWB — the Thin-Walled Blueprint ontology (working draft 0.3.0)

An OWL ontology of the inner data model of [arch](https://twb.madsholten.dk) (TWB Architect): a building described as zero-thickness surfaces on the reference planes of its walls, floors and roofs, with construction knowledge attached where it belongs.

| Where | What it carries |
|---|---|
| A **surface** (`twb:Surface`, a `bot:Element` in its thin form) | a **recipe** (`twb:Recipe`): the ordered layers of the assembly that will realise it, one of them the structural core |
| A **side** of a surface (`twb:SurfaceSide`) | which side the recipe starts from (`twb:isInside`), the zones it faces |
| A **zone boundary** (`twb:ZoneBoundary`, a `bot:Interface`) | the area one zone faces, the **requirements** adjacency rules put there, and **coverings** (wet-room system, tiles, paint) |
| An **edge** (`twb:Edge`, a `bot:Interface`) | a **joint detail** (`twb:JointDetail`): how each layer of each meeting surface terminates (mitre, overhang, or on a boundary of the other surface's layers) and the **trims** along it |
| An **opening** (`twb:Opening`, hosted by its surface) | an **opening detail** (sill flashing, frame boards, head and sill boards), and four perimeter edges with their ψ |
| A **node** (`twb:Node`, a `bot:Interface`) | how the trims of the edges meeting there are finished (mitred, butted, run on to an end cap, or one running through as a **node rule** (`twb:NodeRule`) says) |
| A **room** (`twb:Room`, a `bot:Space`) | its purpose and its **ceiling** (flat, open or lowered); the **ceiling surfaces** and the **attic** (`twb:Attic`) over them are derived |
| A **door** (`twb:Door`) | its swing and leaves, and the **passage** (`twb:Passage`, a `bot:Interface`) between the zones on its two sides, with the side it can be opened from |
| The **blueprint** (`twb:Blueprint`, a `prov:Plan`) | project standards per edge type, joint templates per edge type and recipe pair, opening standards, node rules, the architectural expression, the building use and its adjacency rules, the structural parameters, and the **decisions** (`twb:Decision`, a `prov:Entity`) behind its values with their sources |

Details resolve by specificity: an edge's own joint, else the template for its type, corner and recipe pair, else the project standard for its type, else a mitre; an edge along the interior of another surface (a T) always leaves that surface uncut. The element-level building (members, sheets, boards, machining) is derived by a `twb:Derivation` (`prov:Activity`) that follows the blueprint as its plan.

## Modules

TWB is modular, as the SEAS ontologies are: **one namespace**, `twb:` (`https://w3id.org/twb#`), shared by every module; **each module an ontology of its own** that imports only the modules it builds on; and **every term stating the module that defines it** (`rdfs:isDefinedBy`). `https://w3id.org/twb` (`twb.ttl`) defines nothing and imports every module: TWB as a whole. Import a module instead to take only what it needs; a term has the same IRI whichever module one imports.

| Module | IRI | Imports | What it defines |
|---|---|---|---|
| `twb-core.ttl` | `https://w3id.org/twb/core` | — | the blueprint, storeys, zones (rooms, environment zones, attics, passages) and fixtures, surfaces with their sides and zone boundaries, openings, edges and their types, nodes, line elements, foundations, the project frame |
| `twb-construction.ttl` | `/twb/construction` | core | recipes and layers, materials, member/cladding/taper/masonry/tie patterns, coverings, U- and ψ-values, resolution levels |
| `twb-detailing.ttl` | `/twb/detailing` | construction | joint details, layer terminations and trims, joint templates and standards, board seams, opening details and standards, trim meetings and node rules, framing rules and processings |
| `twb-requirements.ttl` | `/twb/requirements` | construction | capabilities, adjacency rules and zone conditions, requirements, U-value limits |
| `twb-profile.ttl` | `/twb/profile` | detailing, requirements | the architectural expression and its derived trims, building use, construction system, structural and delivery parameters |
| `twb-decision.ttl` | `/twb/decision` | core | decisions, their tiers and sources |
| `twb-derivation.ttl` | `/twb/derivation` | detailing | the derivation, members, layer pieces, what governed them |
| `twb-housefile.ttl` | `/twb/housefile` | detailing | the house file's authored geometry (JSON literals, mm) and references by name |
| `twb-doc.ttl` | `/twb/doc` | core | the documentation: sections on the blueprint, the derived drawing set, sheets and drawings |

Beside them, and not imported by `twb.ttl`: the SHACL shapes (`/twb/shapes`), the alignments (`/twb/align`) and arch's catalogue (`/twb/catalogue/arch`); each imports `https://w3id.org/twb`. Every IRI answers an RDF client with Turtle and a browser with the module on the data model page (<https://twb.madsholten.dk/en/datamodel/#moduler>).

The split is checked to be lossless: the modules together hold exactly the triples `twb.ttl` held in 0.2.0, apart from the module headers and `rdfs:isDefinedBy`, and no module uses a term from a module it does not import.

## Files

| File | Content |
|---|---|
| `twb.ttl` | TWB as a whole: imports every module above (97 classes, 115 object and 80 datatype properties in all, the documentation's included) |
| `twb-*.ttl` (the modules) | As above: SKOS vocabularies for edge types, joint standard options, opening details, capabilities, resolutions, ceiling kinds, board seams, decision tiers live in the module of the classes they type |
| `twb-shapes.ttl` | SHACL (13 node shapes): what a well-formed blueprint is (structure, passages, node rules, attics), and whether its construction meets the requirements its zones put on it |
| `twb-align.ttl` | Alignments with BPO, DiCon Materials, SML (EN 17632-1), BEO, ifcOWL (IFC4) and OPM, kept apart so that TWB never forces those imports |
| `twb-house.context.jsonld` | The JSON-LD context of the house file (`twb/1`, either shape), context 3, the same as `TWB_HOUSE_CONTEXT` in [`src/house/house-jsonld.ts`](../src/house/house-jsonld.ts) (a test holds them equal); published at `https://w3id.org/twb/context/3.jsonld` |
| `twb-house.context.2.jsonld` | Context 2, as published from 0.3.0 to 0.4.0 and never changed: the same but for the simple shape's terms, which it puts under `arch:` as JSON |
| `twb-house.context.1.jsonld` | Context 1, as published before 0.3.0 and never changed: the same as context 2 but for the sections' terms, which it puts under `twbd:` |
| `twb-catalogue.ttl` | Generated: arch's registries as SKOS — zone kinds, member roles, BTLx processings, framing rule topics and options, materials, building uses |
| `imports/bot.ttl` | BOT 0.3.2, as published at <https://w3id.org/bot> |
| `queries/rules/*.rq` | Rules as SPARQL CONSTRUCT, applied in file order, each materialising into a graph of inferred triples |
| `queries/cq/*.rq` | The 15 competency questions |
| `queries/restrict-bedroom-door.ru` | An access restriction on the case house: bedroom 1's door opened from the living room only |
| `queries/repair-wet-room-coverings.ru` | The repair step of the demonstration (SPARQL Update) |
| `examples/case-house.input.json` | The case house in the simple shape: wall lines, openings by centre (doors between rooms too), roof by type and pitch |
| `examples/case-house.json` | The case house in the detailed shape, as a twb/1 house file: JSON-LD in these terms (open it in arch) |
| `examples/case-house.ttl` | Generated: the case house as a TWB blueprint, with its ceiling, attic, passages and 298 derived members |
| `examples/case-house-rules.ttl` | Adjacency rules (illustrative capability rules) |
| `examples/case-house-use-rules.ttl` | Generated: the U-value rules of the building use, from arch's national profile (BR18) |
| `examples/case-house.expected.json` | Generated: arch's own resolution of every joint, trim and opening detail |

## Running it

```bash
# 1. Rules, shapes and competency questions (Python 3 with rdflib, pyshacl and pyoxigraph)
python tools/twb_check.py          # writes results/twb-check.{json,md}

# 2. A twb/1 house file read as JSON-LD, checked against the ontology (pyld 2.0.4)
python tools/twb_house_check.py    # default: ontology/examples/case-house.json
```

On arch `18a78d5` the rules reproduce arch's resolution for all 40 edges and all 5 exterior openings of the case house; the shapes find the five zone boundaries towards the bathroom that lack a wet-room lining, and conform once the repair has added the covering. The paper's numbers (30 edges, 280 members) are those of `4dce823`, before rooms had ceilings and partitions doors.

The generated files (`case-house.ttl`, `case-house-use-rules.ttl`, `case-house.expected.json`, `twb-catalogue.ttl`) are exported by arch, which opens, frames and dresses the house with its own chain; they are kept here so the rules, shapes and questions can be run without it.

## What changed in 0.5.0

- **The two shapes of a house file.** A house file is written in the **detailed** shape — every
  surface as its corners, what a modelling tool opens, edits and saves — or the **simple** shape:
  walls as plan lines and heights, the roof by its height, pitch and type, openings by centre and
  size, partitions as plan lines, for whoever reads a drawing, a language model first of all. The
  simple shape is input only and is saturated into the detailed one on opening. Its terms are TWB's
  own now, in the house file module (`twb-housefile.ttl`, 0.5.0): `twb:planWalls`,
  `twb:wallHeightMm`, `twb:planRoof`, `twb:planOpenings`, `twb:planPartitions`. Context 2 put them
  under `arch:` as JSON.
- **Storey by storey.** A wall in the simple shape may name its storey: each storey then stands on
  the blocks its own walls trace — each group of walls that meet is a block, with its own floor —
  its roof flat at its top over what of each block the storey above leaves open (the floors of
  that storey's courtyards among it), and a ring of walls inside a block is a courtyard — or a
  void, where a roof of the storey covers it or the storey above closes or carries it on: a room
  of the storey below rising through it to the roof, with no roof under it. A roof
  names the storey it covers and its height (`eaveMm`); with an `outline`, it covers the block
  that outline lies in, else every block of the storey. No term was added for blocks: they are
  read off the walls.
- **Floor openings.** `twb:planFloorOpenings` (`floorOpenings`, new in context 3): a storey's
  floor opened where a stair rises into it, with no walls round the opening — the room under it
  double height over the opening only.
- **Watertight IFC import.** The IFC import writes a closed house by default (`repair:
  'watertight'`) and checks it: the house file it writes is ordinary simple shape, its stairs'
  openings as `floorOpenings` (see `docs/ifc-import.md`).
- **Context 3.** Save writes `"@context": "https://w3id.org/twb/context/3.jsonld"`; the JSON is
  unchanged and the format is still `twb/1`. A file naming context 2 or 1 opens the same.

## What changed in 0.3.0

- **Modules.** The one file of 0.2.0 is split into the modules above, SEAS-style, with no term added, removed or changed; `twb.ttl` imports them all. The shapes' ontology IRI is `https://w3id.org/twb/shapes` (was `…/shapes#`), and the catalogue has an ontology header.
- **The documentation in `twb:`.** The documentation module's terms moved from `twbd:` (`https://w3id.org/twb/doc#`) into `twb:`, as every module's are; `twbd:Placement`'s `Automatic` and `UserPlaced` are `twb:AutomaticPlacement` and `twb:UserPlacement`. The four `twbd:` terms context 1 maps stay in `twb-doc.ttl`, deprecated, as equivalents.
- **Context 2.** Save writes `"@context": "https://w3id.org/twb/context/2.jsonld"`; the JSON is unchanged and the format is still `twb/1`. A file naming context 1 opens the same.

## What changed in 0.2.0

0.2.0 follows arch from `4dce823` to `18a78d5`:

- **Ceilings and attics.** A room's ceiling is a choice (`twb:ceilingKind`: flat, open, lowered, with `twb:ceilingHeight`). The ceiling surfaces it implies (`twb:CeilingSurface`, `twb:ceilingOf`) and the attic over them (`twb:Attic`, `twb:insulatedAt`, `twb:atticOver`) are derived; a surface split where a ceiling crosses it names its source (`twb:surfacePartOf`). Ceiling edges are `twb:CeilingJunction`. BR18 holds the ceiling under a cold attic to the roof's U-value.
- **Doors between rooms.** A door's swing and leaves (`twb:hingeAtEnd`, `twb:swingsBack`, `twb:doorLeaves`), and a derived `twb:Passage` between the zones on its two sides, with `twb:openableFrom` for access control. Passages make the rooms a graph one can walk (CQ13). Rule 41 derives `twb:leadsTo` from zone to zone through the passages whose doors open from that side; CQ15 asks which rooms can be reached from outside and which can be left, and `twbsh:EgressShape` reports a room with no way out.
- **Roof windows** (`twb:RoofWindow`).
- **Node rules.** `twb:NodeRule` names, for a pair of trimmed edges, the edge whose trims run through (`twb:ThroughMeeting`, `twb:throughEdge`, CQ14).
- **Board seams** on a joint between surfaces in one plane (`twb:boardSeam`: run through or break).
- **Foundations** (`twb:StripFoundation`, `twb:PadFoundation`, `twb:ScrewFoundation`, `twb:PileFoundation`) and **columns and beams drawn as lines** (`twb:Column`, `twb:Beam`).
- **Structural and delivery parameters** on the blueprint: roof load profile, live, snow and wind loads, consequence class, sawn timber grade, IFC scope, facade cladding.
- **Decisions and their sources** (`twb:Decision`, from arch-settings/1): what was decided, in which tier (profile, standard, override), its value, and the drawing or assumption it came from.
- **The house file as JSON-LD.** arch's Save writes `twb/1`, which is JSON-LD in these terms (`twb-house.context.jsonld`). Geometry stays as authored, millimetres in JSON literals (`twb:pointsMm`, `twb:pointMm`, `twb:holesMm`, `twb:profileMm`); references the file needs are `twb:onStorey`, `twb:pinnedKind`, `twb:roofGroupName`; a joint keeps its recipe's layer count with `twb:standardCut`. The case house's file makes 332 triples, every twb: term defined and every key mapped.

**Documentation** has a module of its own, `twb-doc.ttl` (`https://w3id.org/twb/doc`; its terms were `twbd:` until 0.3.0), so that what is drawn of the building stays apart from the building. A house file says which sections it has: `"sections": [{ "type": "Section", "name": "A", "line": [[x, y], [x, y]] }, { "type": "Section", "name": "B", "inDocumentation": false }]` — A and B without a `line` are placed by the drawing set; with one, where the user put them. The drawing set itself (sheets, drawings, scale) is derived output, like the members.

Out of scope: heating, domestic water, ventilation and the technical cabinet. They belong in modules of their own, for example aligned with FSO, not in the core.

## Modelling decisions to discuss

These are the choices most worth revisiting together. Each says what the draft does and why.

1. **Name and namespace.** "Thin-Walled Blueprint" is a working name. The namespace `https://w3id.org/twb#` is registered at w3id ([perma-id/w3id.org#6841](https://github.com/perma-id/w3id.org/pull/6841)): a browser is sent to the data model page at <https://twb.madsholten.dk/en/datamodel/>, an RDF client gets the Turtle, and the modules resolve the same way (`/twb/shapes`, `/twb/doc`, `/twb/align`, `/twb/catalogue/arch`).
2. **A surface is a `bot:Element`, not a `bot:Interface`.** The thin surface is the design-time element (the wall to be); its derived members are its sub-elements (`bot:hasSubElement`) and it hosts its openings (`bot:hostsElement`, whose domain is `bot:Element`). The interfaces are where it meets zones (`twb:ZoneBoundary`), other surfaces (`twb:Edge`), its openings (`twb:OpeningEdge`) and points (`twb:Node`). This follows the 2021 Molio project (walls as elements, `ex:WallSurface` and `ex:WallIntersection` as interfaces) and keeps BOT's disjointness of elements and interfaces meaningful. The alternative — a surface as the interface between two zones, as gbXML and second-level space boundaries have it — makes hosting and sub-elements awkward and loses the "one recipe per surface" reading.
3. **Sides are reified.** Without `twb:SurfaceSide`, neither the orientation of a recipe nor "tiles towards the bathroom, paint towards the bedroom" can be said. IFC's `DirectionSense`, gbXML's ordered `AdjacentSpaceId` and Molio's `ex:oppositeSurface` each solve a part of this.
4. **Requirements land on zone boundaries, not on surfaces.** A partition with a bathroom on one side needs a wet-room lining on that side only, and only where the bathroom is. The repair therefore applies a covering to the boundary rather than changing the surface's recipe. Whether recipes should also vary per boundary patch (a "side recipe") is open.
5. **Rules are data.** An adjacency rule is a `twb:AdjacencyRule` with zone conditions for each side; one generic query applies them all. The building use selects which rules apply (`twb:ruleOfUse`). Datalog or SHACL-AF rules would be the alternatives; SPARQL CONSTRUCT keeps them runnable anywhere.
6. **Template keys.** arch keys a joint template by edge type, inside/outside corner and the recipes in their roles. Should the zones around the edge be part of the key (an eave over a wet room)? The ontology could express it; arch does not yet.
7. **Edge types are SKOS concepts, derived.** The exporter asserts them from arch's own classification. A SPARQL rule could derive most of them from the surfaces' classes, recipes and geometry, but not all (outside vs inside corner needs geometry).
8. **Geometry** is GeoSPARQL WKT with a project CRS IRI. OMG/FOG would let any format be attached instead.
9. **Units** are fixed per property and stated with `twb:unit` (QUDT). QUDT quantity values or OPM property states are the heavier alternatives; OPM is the natural route for requirement/derived states and their history.
10. **Framing rules** are exported as SKOS topics and options; a project chooses one option per topic. Whether a recipe should be able to override a project's choice (a different corner detail for a different wall type) is open.
11. **Nodes** carry trim meetings and, since 0.2.0, node rules. Framing has its own nodes (the butt corners of `wall-corners.ts`); they could be the same individuals.
12. **Derived surfaces.** Ceiling surfaces and the parts of a split surface are exported as surfaces in their own right, because they carry recipes and edges. The alternative is to keep only authored surfaces and to say "the part of this wall above the ceiling" as a zone boundary with its own recipe (decision 4's "side recipe").
13. **Attics are spaces, not environment zones.** An attic belongs to the building and has an outline, so it is a `bot:Space`; whether it is heated follows from where it is insulated.

## Status

A second draft for discussion: syntactically valid, used end to end on the case house, not yet reviewed. The capability rules are illustrative; the U-value rules are BR18's, as arch applies them.
