# TWB — thin-walled blueprints

**An open data model for houses before they are detailed, and the code to read, write, view and
exchange it.** A wall in TWB is not an object with a thickness: it is a surface with none, on the
reference plane of the structure, and what is known about the wall sits where it belongs — a
**recipe** on the surface, a **joint** on the edge where two surfaces meet, a **requirement** on
the side that faces a room.

- Website and the data model explained, with an interactive schema and rule checks that run in
  your browser: **<https://twb.madsholten.dk>** (English: <https://twb.madsholten.dk/en/>, data
  model: <https://twb.madsholten.dk/en/datamodel/>)
- The data model in detail — every class and property, the SHACL shapes, and a validator for
  house files, IFC models and TWB graphs that runs in your browser:
  **<https://lbd-hackers.github.io/twb/>** (built from [`site/`](site/)).
- Namespace: `https://w3id.org/twb#` — an RDF client gets the Turtle from this repository (served
  at <https://lbd-hackers.github.io/twb/ontology/>), a browser the data model page.
- The method: *Thin-walled blueprints: a building model in which surfaces carry assembly recipes,
  edges carry joint details and zone boundaries carry rules*, submitted to Automation in
  Construction, 2026.

This repository holds the open part of TWB, published on npm as
[`@lbd-hackers/twb`](https://www.npmjs.com/package/@lbd-hackers/twb):

| | What | Licence |
| --- | --- | --- |
| [`ontology/`](ontology/) | The TWB ontology (OWL, SEAS-style modules on top of [BOT](https://w3id.org/bot)), the SHACL shapes, the SPARQL rules and competency questions, the alignments, the catalogue and the paper's case house | CC BY 4.0 |
| [`src/house/`](src/house/) | The house file, `twb/1`: its JSON-LD context, its types, the parser and writer of its geometry, the simple shape (walls as plan lines, a roof by type and pitch), and Open — a file into a model store | Apache-2.0 |
| [`src/ifc/`](src/ifc/) | **IFC to TWB**: an IFC2X3 or IFC4 model read into a house file, with a report of what was read, guessed and left out ([docs/ifc-import.md](docs/ifc-import.md)) | Apache-2.0 |
| [`src/surfacekit/`](src/surfacekit/) | The drawing engine: thin planar surfaces, storeys and zones with a validated store, the module grid, push/pull and the other tools, the three.js viewport | Apache-2.0 |
| [`src/elements/`](src/elements/) | `<arch-paper-model>`, the viewer of a house file as a web component, read-only or editable | Apache-2.0 |
| [`src/validate/`](src/validate/) | The validator: a house file, an IFC file or a TWB graph against the ontology, its catalogue and its SHACL shapes, with a SHACL engine on [Oxigraph](https://github.com/oxigraph/oxigraph) that runs in Node and the browser | Apache-2.0 |
| [`src/cli.ts`](src/cli.ts) | `twb`, the command line: IFC to TWB, checking, validating and converting house files | Apache-2.0 |

The line between open and closed is the one the website draws: **open is what defines a blueprint
and lets anyone draw, read and exchange it; closed is what turns a blueprint into a building.** The
framing recipes and their sizing, the placement of the envelope's layers, joints and trims, the
bill of materials, the cutting plans and the IFC export are [arch](https://twb.madsholten.dk)'s
(TWB Architect), the tool this was written for. A house file keeps whatever such a tool writes
into it: this package reads the blueprint's geometry and passes every other block on untouched.

## Install

```bash
npm install @lbd-hackers/twb
```

Node 20 or later, or any modern browser. The house file, the IFC importer and the engine's model
are pure TypeScript with no dependencies. The viewer and the engine's renderer need
[`three`](https://www.npmjs.com/package/three) and [`lit`](https://www.npmjs.com/package/lit),
which are optional peer dependencies: install them if you use `@lbd-hackers/twb/elements` or
`@lbd-hackers/twb/surfacekit/render`. [`oxigraph`](https://www.npmjs.com/package/oxigraph) 0.5.11
or later is needed by `@lbd-hackers/twb/validate` and `twb validate` only. It is not a peer
dependency, so an app on an older Oxigraph that does not validate can use the rest of the package;
install it yourself if you validate.

## From the command line

```bash
npx @lbd-hackers/twb import-ifc model.ifc -o house.twb.jsonld   # IFC to TWB; the report goes to stderr
npx @lbd-hackers/twb check house.twb.jsonld                     # open it; list what it has wrong
npx @lbd-hackers/twb convert old-house.json -o house.twb.jsonld # arch/1 to twb/1
npx @lbd-hackers/twb context                                    # the JSON-LD context
```

### Validate

`twb validate` checks a house file, an IFC file or a TWB graph against the ontology, its catalogue
and its SHACL shapes, with the ontology the package ships. It needs
[`oxigraph`](https://www.npmjs.com/package/oxigraph) 0.5.11 or later, installed beside it
(`npm install oxigraph@^0.5.11`; earlier versions cannot read JSON-LD 1.1), and exits 1 on any finding of severity error.

```bash
npx @lbd-hackers/twb validate house.twb.jsonld        # a house file, twb/1 or arch/1
npx @lbd-hackers/twb validate model.ifc               # read into a house file first
npx @lbd-hackers/twb validate case-house.ttl --rules  # a graph: the rules applied, then every shape
npx @lbd-hackers/twb validate house.ttl --with rules.ttl --json
```

A **house file** is checked in levels: `file` (its shape: every corner three numbers, every
storey named one the file has, each error with its JSON path), `geometry` (opened as a tool opens
it: faces the store would not take, partitions and doors it could not build; and the house in
numbers), `vocabulary` (read as JSON-LD, no network: keys the context does not map, `twb:` terms
no module defines, catalogue values the catalogue does not list). The shapes are not run on a house
file — they check a blueprint with its derived parts (an opening's perimeter edges, typed layers,
edges, passages), which a house file does not carry.

A **graph** (Turtle, N-Triples, RDF/XML, JSON-LD) is loaded with BOT, TWB's modules and the
catalogue; with `--rules` the rules of `ontology/queries/rules/` are applied in order, each
materialising its triples before the next; then every shape of `twb-shapes.ttl` runs. A
blueprint's adjacency rules kept beside it as `<name>-rules.ttl` and `<name>-use-rules.ttl` are
loaded with it, as the case house keeps them; `--with` adds any other file. On the case house,
`--rules` finds the five zone boundaries towards the bathroom that lack a wet-room lining; without
the rules there is no `twb:leadsTo`, so the egress shape finds no way out of any room.

## From code

**IFC to TWB.**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { ifcToHouse, ifcImportSummary } from '@lbd-hackers/twb/ifc';

const { house, report } = ifcToHouse(readFileSync('Duplex.ifc', 'utf8'));
writeFileSync('duplex.twb.jsonld', JSON.stringify(house, null, 2));
console.log(ifcImportSummary(report).join('\n'));
// Read from IFC (IFC2X3): heavy (masonry) construction, 2 storeys, 4 exterior walls,
// 26 partition runs, 28 windows and doors, 20 rooms, 21 fittings. …
```

**Open a house file** — parse it, expand the simple shape, build the partitions and cut their
doors, and get a store of surfaces, storeys and zones:

```ts
import { loadHouse, serializeLoadedHouse } from '@lbd-hackers/twb';
import { classifyAll } from '@lbd-hackers/twb/surfacekit/model';

const house = loadHouse(text); // twb/1 or arch/1, as text or parsed JSON
console.log(house.problems); // what the file had wrong, each naming where
for (const [id, kind] of classifyAll(house.store.surfaces())) console.log(id, kind); // wall, floor, roof
const saved = serializeLoadedHouse(house); // twb/1 again, every block the file had kept
```

**As RDF.** A `twb/1` house file is JSON-LD. Its context is published at
`https://w3id.org/twb/context/2.jsonld`, and ships with the package as
`@lbd-hackers/twb/context.jsonld` (and as `TWB_HOUSE_CONTEXT`), so any JSON-LD processor turns
the file into triples in the TWB ontology without a network:

```ts
import jsonld from 'jsonld';
import { TWB_HOUSE_CONTEXT } from '@lbd-hackers/twb';

const quads = await jsonld.toRDF(
    { ...house, '@context': TWB_HOUSE_CONTEXT },
    { format: 'application/n-quads', base: 'https://example.org/my-house/' }
);
```

**Validate** — the same in code, in Node or in a browser's Web Worker. The validator is handed
the Oxigraph module (`oxigraph` in Node, `oxigraph/web.js` once its WASM is initialised in a
browser) and the ontology's texts; `@lbd-hackers/twb/validate/node` reads them from the package.

```ts
import * as ox from 'oxigraph';
import { validate, validateGraph, formatReport } from '@lbd-hackers/twb/validate';
import { loadOntologySources } from '@lbd-hackers/twb/validate/node';

const ontology = loadOntologySources(); // the package's ontology/: modules, catalogue, BOT, shapes, rules
const report = validate('house.twb.jsonld', text, ontology, ox); // house file, IFC or graph, by content
console.log(formatReport(report!)); // or report.levels[i].findings: { level, severity, message, where }

const graph = validateGraph(turtle, 'turtle', ontology, ox, { rules: true, with: [adjacencyRules] });
```

The SHACL engine (`ShaclValidator`) compiles the shapes graph into SPARQL as it is written:
targets, paths (inverse, sequence, alternative, `*`, `+`, `?`), the count, class, datatype,
node-kind, range, `sh:in`, `sh:hasValue`, `sh:node` and logical constraints, and SHACL-SPARQL
constraints with `$this` pre-bound and their messages filled in. It refuses a shapes graph that
uses anything else, naming the feature, rather than skip it. Its results are held to pyshacl's on
the case house and on broken variants of it (`tools/shacl_expected.py`).

**On a web page.**

```html
<script type="module">
    import '@lbd-hackers/twb/elements'; // defines <arch-paper-model>; needs lit and three
</script>

<arch-paper-model src="house.twb.jsonld" color-by-kind></arch-paper-model>
<arch-paper-model src="house.twb.jsonld" readonly></arch-paper-model>
```

Editable by default: **Select**, **Push/Pull** and **Orbit**, with undo, redo and delete; every
pull is validated against the module grid. Events: `house-load` (`{ problems }`), `face-select`
(`{ surfaceId, kind }`) and `house-change` (`{ json }`, the edited house file); `toHouseJson()`
returns the same on demand. Its design tokens (`--accent`, `--bg`, `--border`, …) can be set from
the page.

## The house file

One concept: a face is a list of `[x, y, z]` corners in millimetres, Z up, on the reference plane
of the structure. Walls, floors and roofs are not separate types; they are read off the geometry.
A house can also be written in a **simple shape** — the numbers a plan and a section print — and
every corner that has to be worked out (a gable's apex, the valley of an L) is worked out on
opening:

```json
{
    "@context": "https://w3id.org/twb/context/2.jsonld",
    "format": "twb/1",
    "type": "Blueprint",
    "name": "Gable house",
    "wallHeightMm": 2400,
    "walls": [{ "points": [[0, 0], [9600, 0], [9600, 7200], [0, 7200], [0, 0]] }],
    "openings": [
        { "kind": "door", "at": [2400, 0], "widthMm": 1000, "heightMm": 2100 },
        { "kind": "window", "at": [9600, 3600], "widthMm": 1200, "heightMm": 1200, "sillMm": 900 }
    ],
    "interiorWalls": [{ "points": [[4800, 0], [4800, 7200]] }],
    "zones": [
        { "type": "Room", "name": "Living", "zoneKind": "living", "point": [2400, 3600] },
        { "type": "Room", "name": "Bedroom", "zoneKind": "bedroom", "point": [7200, 3600] }
    ],
    "roof": { "type": "gable", "pitchDeg": 30 }
}
```

A wall that is not the house's own partition or facade says what it is — `"partition": "light"`,
`"heavy"` or `"party"` — and a wall of another build-up than its kind's names it, `"buildUpType":
"interiorWall:plumbing"`, a build-up in `envelope`. A partition's build-up runs from its positive
side (to the right looking along it towards +x, or +y) across its core to its back; a party wall
of two leaves stands on one of them.

**Types.** A type is a prototype: it holds what holds for every instance of it, set once and
shared. A wall, a roof or a slab is an instance of a build-up — its layers, a `twb:Recipe`, in
`envelope` — and a window or a door of a window or door type — its product, frame, panes, U-value,
colours, a `twb:OpeningType`, in `fenestrationTypes`. Each kind has a default type; an instance is
pinned to another by its id (`buildUpType`, an opening's `typeId`); what an instance states itself
wins over its type's; and a type is written with only what differs from its kind's default.

The format is described in full in [`src/house/house-file.ts`](src/house/house-file.ts) and
[`src/house/simple-house.ts`](src/house/simple-house.ts), and as JSON-LD in
[`src/house/house-jsonld.ts`](src/house/house-jsonld.ts). Example houses are in
[`fixtures/houses/`](fixtures/houses/) and [`ontology/examples/`](ontology/examples/).

## The ontology

TWB is modular, as the SEAS ontologies are: one namespace, `twb:`, shared by every module; each
module an ontology of its own that imports only what it builds on; every term stating the module
that defines it.

| Module | What it defines |
| --- | --- |
| `twb-core.ttl` | the blueprint, storeys, zones, surfaces with their sides and zone boundaries, openings, edges, nodes, line elements, foundations |
| `twb-construction.ttl` | recipes and layers, materials, member and cladding patterns, coverings, U- and ψ-values |
| `twb-detailing.ttl` | joint details, layer terminations and trims, joint templates and standards, opening details, node rules, framing rules |
| `twb-requirements.ttl` | capabilities, adjacency rules and zone conditions, requirements, U-value limits |
| `twb-profile.ttl` | the architectural expression, building use, construction system, structural parameters |
| `twb-decision.ttl` | decisions, their tiers and sources |
| `twb-derivation.ttl` | the derivation, members, layer pieces |
| `twb-housefile.ttl` | the house file's authored geometry |
| `twb-doc.ttl` | the documentation: sections, the drawing set |

`twb.ttl` imports them all. Beside them: the SHACL shapes (`twb-shapes.ttl`), the alignments with
BPO, DiCon, SML, BEO, ifcOWL and OPM (`twb-align.ttl`) and arch's catalogue (`twb-catalogue.ttl`).
The files are in the package too: `@lbd-hackers/twb/ontology/twb.ttl`. See
[`ontology/README.md`](ontology/README.md) for the modules, the rules, the competency questions and
the modelling decisions open for discussion.

## Developing

```bash
npm install
npm test            # vitest: the engine, the house file, the IFC importer
npm run typecheck
npm run build       # dist/: ES modules and type declarations

# The ontology's rules, shapes and competency questions, and the case house read as JSON-LD
python3 -m pip install -r tools/requirements.txt
npm run check:ontology
```

| Path | |
| --- | --- |
| `src/surfacekit/{core,grid,model,interaction,render}` | the engine, one module each: geometry and signals; the module grid; surfaces, storeys, zones and their store; the tools; the viewport |
| `src/house/` | the house file |
| `src/ifc/` | IFC to TWB |
| `src/elements/` | `<arch-paper-model>` |
| `src/validate/` | the validator and its SHACL engine |
| `ontology/` | the ontology, shapes, queries and examples |
| `tools/` | the ontology's checks (Python); `shacl_expected.py` writes pyshacl's results the SHACL engine is held to |
| `fixtures/` | house files for the tests, and `shacl/` for the SHACL engine's; see [`fixtures/README.md`](fixtures/README.md) for the IFC test model |

Issues and pull requests are welcome at <https://github.com/LBD-Hackers/twb>.

## Licence

The code is under the [Apache License 2.0](LICENSE). The ontology, its shapes, rules and examples
(everything in [`ontology/`](ontology/)) are under
[Creative Commons Attribution 4.0](ontology/LICENSE); `ontology/imports/bot.ttl` is BOT, under its
own Creative Commons Attribution licence.
