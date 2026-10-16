"""Writes what pyshacl reports for the case house, and for broken variants of it, as the fixture the
SHACL engine of src/validate is held to (src/validate/shacl.spec.ts).

    python tools/shacl_expected.py        # writes fixtures/shacl/expected.json

The graph is the one tools/twb_check.py validates: BOT, TWB's modules, the catalogue, the case house
and its adjacency rules, with the rules of queries/rules applied in file order. The cases:

- `as-exported`: the rules applied; the five zone boundaries towards the bathroom lack a wet-room
  lining.
- `repaired`: then the wet-room repair (queries/repair-wet-room-coverings.ru); conforms.
- `no-rules`: the case house as exported, no rules applied: no room has a way out (no twb:leadsTo).
- broken variants of `repaired`: each a SPARQL Update that breaks a few constraints, so that every
  kind of constraint twb-shapes.ttl uses is seen failing at least once.
- `core-features`: fixtures/shacl/core-shapes.ttl on core-data.ttl, for the SHACL Core features
  twb-shapes.ttl does not use.

Each result is keyed by what does not depend on the engine: the focus node, the path, the shape
(an anonymous property shape by the named shape that holds it), the constraint component, the
severity and the value. A blank node is written as what points at it and what it says
(`canonical`), the same way the spec writes it; a number by its value, not its lexical form.
"""

from __future__ import annotations

import json
import pathlib

import pyshacl
from rdflib import BNode, Graph, Literal, URIRef
from rdflib.namespace import RDF, SH, XSD

from twb_check import ONTO, ROOT, apply_rules, load, union
from twb_modules import module_files

OUT = ROOT / "fixtures" / "shacl" / "expected.json"
INST = "https://example.org/twb/case-house/"
PREFIXES = f"""PREFIX twb: <https://w3id.org/twb#>
PREFIX bot: <https://w3id.org/bot#>
PREFIX inst: <{INST}>
"""

# Each variant is applied to the repaired case house, and breaks the constraints its name says.
VARIANTS = {
    "surface-with-two-recipes": """
        INSERT DATA { <%(i)ssurface/s1> twb:hasRecipe <%(i)srecipe/exteriorWall> }""",
    "surface-without-recipe": """
        DELETE WHERE { <%(i)ssurface/s2> twb:hasRecipe ?r }""",
    "layer-without-material": """
        DELETE WHERE { <%(i)srecipe/ceiling/layer/0> twb:material ?m }""",
    "layer-thickness-negative-and-integer": """
        DELETE { ?l twb:thickness ?t } INSERT { ?l twb:thickness ?n } WHERE {
            VALUES (?l ?n) { (<%(i)srecipe/ceiling/layer/1> "-5.0"^^<http://www.w3.org/2001/XMLSchema#decimal>) (<%(i)srecipe/ceiling/layer/2> 50) }
            ?l twb:thickness ?t }""",
    "recipe-with-two-cores-and-a-shared-index": """
        DELETE { <%(i)srecipe/ceiling/layer/0> twb:isCore false . <%(i)srecipe/atticRoof/layer/1> twb:layerIndex 1 }
        INSERT { <%(i)srecipe/ceiling/layer/0> twb:isCore true . <%(i)srecipe/atticRoof/layer/1> twb:layerIndex 0 }
        WHERE {}""",
    "passage-with-one-zone": """
        DELETE DATA { <%(i)spassage/s1-s1h1> twb:connectsZone <%(i)szone/z-bed2> }""",
    "door-openable-from-a-zone-it-does-not-connect": """
        INSERT DATA { <%(i)spassage/s3-s3h1> twb:openableFrom <%(i)szone/z-bed2> }""",
    "side-inside-not-boolean": """
        INSERT DATA { <%(i)ssurface/floor/positive> twb:isInside "yes" }""",
    "surface-sides-the-same": """
        DELETE { <%(i)ssurface/s4> twb:negativeSide ?n } INSERT { <%(i)ssurface/s4> twb:negativeSide ?p }
        WHERE { <%(i)ssurface/s4> twb:negativeSide ?n ; twb:positiveSide ?p }""",
    "edge-broken": """
        DELETE { <%(i)sedge/floor%%7Cwall-east> twb:length ?l . <%(i)sedge/floor%%7Cwall-south> twb:edgeType ?t }
        INSERT {
            <%(i)sedge/floor%%7Cwall-east> twb:length 0.0 .
            <%(i)sedge/floor%%7Cwall-south> twb:edgeType twb:mitre .
            <%(i)sedge/floor%%7Cwall-north> twb:edgeOf <%(i)ssurface/wall-south> }
        WHERE { <%(i)sedge/floor%%7Cwall-east> twb:length ?l . <%(i)sedge/floor%%7Cwall-south> twb:edgeType ?t }""",
    "opening-hosted-twice-without-u": """
        DELETE { <%(i)sopening/wall-east/wall-easth1> twb:u ?u }
        INSERT { <%(i)ssurface/s1> bot:hostsElement <%(i)sopening/wall-south/wall-southh1> }
        WHERE { <%(i)sopening/wall-east/wall-easth1> twb:u ?u }""",
    "layer-terminations-of-surface-and-role-or-neither": """
        DELETE { ?neither twb:ofSurface ?s } INSERT { ?both twb:ofRole twb:FirstRole }
        WHERE {
            ?both a twb:LayerTermination ; twb:ofSurface <%(i)ssurface/wall-west> ; twb:layerIndex 3 .
            ?neither a twb:LayerTermination ; twb:ofSurface ?s ; twb:layerIndex 4 .
            FILTER (?s = <%(i)ssurface/wall-west>) }""",
    "node-rule-through-another-edge": """
        DELETE { ?r twb:throughEdge ?e } INSERT { ?r twb:throughEdge <%(i)sedge/floor%%7Cwall-east> }
        WHERE { ?r a twb:NodeRule ; twb:throughEdge ?e }""",
    "attic-not-insulated-fixture-without-kind": """
        DELETE { <%(i)szone/attic%%3Afloor~ceiling> twb:insulatedAt ?i }
        INSERT { <%(i)sfixture/f1> a twb:Fixture ; twb:pointMm "[1000, 1000]" ; twb:onStorey <%(i)sstorey/st1>, <%(i)sstorey/st2> }
        WHERE { <%(i)szone/attic%%3Afloor~ceiling> twb:insulatedAt ?i }""",
    "u-value-exceeded": """
        DELETE { <%(i)srecipe/exteriorWall> twb:uValue ?u } INSERT { <%(i)srecipe/exteriorWall> twb:uValue 0.9 }
        WHERE { <%(i)srecipe/exteriorWall> twb:uValue ?u }""",
    "room-with-no-way-out": """
        DELETE WHERE { <%(i)szone/z-bed1> twb:leadsTo ?z }""",
}


def number(lexical: str) -> str:
    """A number as JavaScript's String(Number(x)) writes it, so that 245.0 and 245 agree."""
    f = float(lexical)
    return str(int(f)) if f.is_integer() and abs(f) < 1e21 else repr(f)


NUMERIC = {XSD.integer, XSD.decimal, XSD.double, XSD.float, XSD.int, XSD.long, XSD.nonNegativeInteger}


def literal(t: Literal) -> str:
    if t.datatype in NUMERIC:
        try:
            return number(str(t))
        except ValueError:
            pass
    return str(t)


def canonical(g: Graph, t) -> str | None:
    """A term the same whichever engine read it: an IRI as itself, a literal by its value, a blank
    node as `[<s> <p> ; <p> value ; …]`: what points at it and what it says, sorted."""
    if t is None:
        return None
    if isinstance(t, URIRef):
        return f"<{t}>"
    if isinstance(t, Literal):
        return f'"{literal(t)}"'
    ins = sorted(f"<{s}> <{p}>" for s, p in g.subject_predicates(t) if not isinstance(s, BNode))
    outs = sorted(
        f"<{p}> {canonical(g, o)}" for p, o in g.predicate_objects(t) if not isinstance(o, BNode)
    )
    return "[" + " ; ".join(ins + outs) + "]"


def path_text(shapes: Graph, p) -> str | None:
    """A result path in SPARQL's syntax, full IRIs."""
    if p is None:
        return None
    if isinstance(p, URIRef):
        return f"<{p}>"
    inverse = shapes.value(p, SH.inversePath)
    if inverse is not None:
        return "^" + path_text(shapes, inverse)
    for key, op in ((SH.zeroOrMorePath, "*"), (SH.oneOrMorePath, "+"), (SH.zeroOrOnePath, "?")):
        inner = shapes.value(p, key)
        if inner is not None:
            return f"({path_text(shapes, inner)}){op}"
    alternatives = shapes.value(p, SH.alternativePath)
    if alternatives is not None:
        return "(" + "|".join(path_text(shapes, x) for x in shapes.items(alternatives)) + ")"
    # A sequence: an RDF list.
    return "(" + "/".join(path_text(shapes, x) for x in shapes.items(p)) + ")"


def shape_name(shapes: Graph, s) -> str:
    """A shape by its IRI, an anonymous one by the named shape that holds it."""
    seen = set()
    while isinstance(s, BNode) and s not in seen:
        seen.add(s)
        parent = shapes.value(predicate=SH.property, object=s)
        if parent is None:
            break
        s = parent
    return f"<{s}>" if isinstance(s, URIRef) else "[]"


def validate(data: Graph, shapes: Graph) -> list[dict]:
    _, report, _ = pyshacl.validate(
        data_graph=data, shacl_graph=shapes, inference="none", advanced=True, allow_warnings=True
    )
    results = []
    # The report's own results; those under sh:detail say why a sh:node or the like failed.
    for r in report.objects(report.value(predicate=RDF.type, object=SH.ValidationReport), SH.result):
        results.append(
            {
                "focus": canonical(data, report.value(r, SH.focusNode)),
                "path": path_text(report, report.value(r, SH.resultPath)),
                "shape": shape_name(shapes, report.value(r, SH.sourceShape)),
                "component": str(report.value(r, SH.sourceConstraintComponent)).split("#")[-1],
                "severity": str(report.value(r, SH.resultSeverity)).split("#")[-1],
                "value": canonical(data, report.value(r, SH.value)),
            }
        )
    return sorted(results, key=lambda r: json.dumps(r, sort_keys=True))


def main() -> None:
    explicit = load(
        ONTO / "imports" / "bot.ttl",
        *module_files(),
        ONTO / "twb-catalogue.ttl",
        ONTO / "examples" / "case-house.ttl",
        ONTO / "examples" / "case-house-rules.ttl",
        ONTO / "examples" / "case-house-use-rules.ttl",
    )
    shapes = load(ONTO / "twb-shapes.ttl")
    rules = sorted((ONTO / "queries" / "rules").glob("*.rq"))
    inferred = Graph()
    apply_rules(explicit, inferred, rules)
    derived = union(explicit, inferred)
    repair = (ONTO / "queries" / "repair-wet-room-coverings.ru").read_text()

    cases = []

    def case(name: str, data: Graph, rules_applied: bool, updates: list[str]) -> None:
        g = union(data)
        for u in updates:
            g.update(u)
        results = validate(g, shapes)
        cases.append({"name": name, "rules": rules_applied, "updates": updates, "results": results})
        print(f"{name}: {len(results)} results")

    case("as-exported", derived, True, [])
    case("repaired", derived, True, [repair])
    case("no-rules", explicit, False, [])
    for name, update in VARIANTS.items():
        case(name, derived, True, [repair, PREFIXES + (update % {"i": INST}).strip()])

    core = validate(
        load(ROOT / "fixtures" / "shacl" / "core-data.ttl"),
        load(ROOT / "fixtures" / "shacl" / "core-shapes.ttl"),
    )
    print(f"core-features: {len(core)} results")

    OUT.write_text(
        json.dumps(
            {
                "generatedBy": "tools/shacl_expected.py",
                "pyshacl": pyshacl.__version__,
                "caseHouse": cases,
                "coreFeatures": {
                    "shapes": "fixtures/shacl/core-shapes.ttl",
                    "data": "fixtures/shacl/core-data.ttl",
                    "results": core,
                },
            },
            indent=1,
            ensure_ascii=False,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
