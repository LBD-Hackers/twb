# TWB — thin-walled blueprints

**An open data model for houses before they are detailed, and the code to read, write, view and
exchange it.** A wall in TWB is not an object with a thickness: it is a surface with none, on the
reference plane of the structure, and what is known about the wall sits where it belongs — a
**recipe** on the surface, a **joint** on the edge where two surfaces meet, a **requirement** on
the side that faces a room.

- Website and the data model explained, with an interactive schema and rule checks that run in
  your browser: **<https://twb.madsholten.dk>** (English: <https://twb.madsholten.dk/en/>, data
  model: <https://twb.madsholten.dk/en/datamodel/>)
- Namespace: `https://w3id.org/twb#` — an RDF client gets Turtle, a browser the data model page.
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
| [`src/cli.ts`](src/cli.ts) | `twb`, the command line: IFC to TWB, checking and converting house files | Apache-2.0 |

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
`@lbd-hackers/twb/surfacekit/render`.

## From the command line

```bash
npx @lbd-hackers/twb import-ifc model.ifc -o house.twb.jsonld   # IFC to TWB; the report goes to stderr
npx @lbd-hackers/twb check house.twb.jsonld                     # open it; list what it has wrong
npx @lbd-hackers/twb convert old-house.json -o house.twb.jsonld # arch/1 to twb/1
npx @lbd-hackers/twb context                                    # the JSON-LD context
```

## From code

**IFC to TWB.**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { ifcToHouse, ifcImportSummary } from '@lbd-hackers/twb/ifc';

const { house, report } = ifcToHouse(readFileSync('Duplex.ifc', 'utf8'));
writeFileSync('duplex.twb.jsonld', JSON.stringify(house, null, 2));
console.log(ifcImportSummary(report).join('\n'));
// Read from IFC (IFC2X3): heavy (masonry) construction, 2 storeys, 4 exterior walls,
// 22 partition runs, 28 windows and doors, 20 rooms, 21 fittings. …
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
| `ontology/` | the ontology, shapes, queries and examples |
| `tools/` | the ontology's checks (Python) |
| `fixtures/` | house files for the tests; see [`fixtures/README.md`](fixtures/README.md) for the IFC test model |

Issues and pull requests are welcome at <https://github.com/LBD-Hackers/twb>.

## Licence

The code is under the [Apache License 2.0](LICENSE). The ontology, its shapes, rules and examples
(everything in [`ontology/`](ontology/)) are under
[Creative Commons Attribution 4.0](ontology/LICENSE); `ontology/imports/bot.ttl` is BOT, under its
own Creative Commons Attribution licence.
