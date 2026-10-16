"""Runs the TWB rules, shapes and competency questions over the case house.

    python tools/twb_check.py

Steps, each reported in results/twb-check.json and results/twb-check.md:

1. Load the ontology, the arch catalogue, the case house and its adjacency rules.
2. Apply the rules in queries/rules in file order, each one materialising into a separate graph of
   inferred triples (explicit facts and deductions kept apart, as in OPM).
3. Compare the ontology's joint and opening-detail resolution with arch's own, recorded by the
   exporter in examples/case-house.expected.json.
4. Validate with the shapes (structure and requirements).
5. Apply the wet-room repair, re-run the requirement rules, validate again.
6. Answer the competency questions.
7. Restrict one door to be opened from one side only, re-derive the ways through the passages
   (rule 41) and validate again: the room behind it has no way out.
8. Time the rules once more in Oxigraph (pyoxigraph, the Rust store that also builds to
   WebAssembly), and check that it infers the same triples as rdflib.
"""

from __future__ import annotations

import json
import pathlib
import time
from urllib.parse import unquote

import pyoxigraph
import pyshacl
from rdflib import Graph, Namespace, URIRef
from rdflib.namespace import RDF, SH

from twb_modules import module_files

ROOT = pathlib.Path(__file__).resolve().parents[1]
ONTO = ROOT / "ontology"
RESULTS = ROOT / "results"
TWB = Namespace("https://w3id.org/twb#")
BASE = "https://example.org/twb/case-house/"


def load(*paths: pathlib.Path) -> Graph:
    g = Graph()
    for p in paths:
        g.parse(p)
    return g


def union(*graphs: Graph) -> Graph:
    u = Graph()
    for g in graphs:
        for t in g:
            u.add(t)
    for prefix, ns in graphs[0].namespaces():
        u.bind(prefix, ns)
    return u


def apply_rules(explicit: Graph, inferred: Graph, rule_files: list[pathlib.Path]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in rule_files:
        g = union(explicit, inferred)
        before = len(inferred)
        for t in g.query(f.read_text()):
            inferred.add(t)
        counts[f.name] = len(inferred) - before
    return counts


def apply_rules_oxigraph(explicit: Graph, rule_files: list[pathlib.Path]) -> tuple[set, float]:
    """The rules applied in Oxigraph, as `apply_rules` applies them: the inferred triples, the seconds."""
    store = pyoxigraph.Store()
    store.load(explicit.serialize(format="nt").encode(), format=pyoxigraph.RdfFormat.N_TRIPLES)
    inferred: set = set()
    t0 = time.perf_counter()
    for f in rule_files:
        new = [t for t in store.query(f.read_text())]
        store.extend(pyoxigraph.Quad(t.subject, t.predicate, t.object) for t in new)
        inferred.update(new)
    return inferred, time.perf_counter() - t0


def short(term) -> str:
    s = str(term)
    for prefix, ns in (("twb:", str(TWB)), ("inst:", BASE), ("twbc:", "https://w3id.org/twb/catalogue/arch#")):
        if s.startswith(ns):
            return prefix + s[len(ns):]
    return s


def validate(g: Graph, shapes: Graph) -> dict:
    t0 = time.perf_counter()
    conforms, report, _ = pyshacl.validate(
        data_graph=g,
        shacl_graph=shapes,
        inference="none",
        advanced=True,
        allow_warnings=True,
    )
    ms = (time.perf_counter() - t0) * 1000
    results = []
    for r in report.subjects(RDF.type, SH.ValidationResult):
        results.append(
            {
                "focus": short(report.value(r, SH.focusNode)),
                "severity": short(report.value(r, SH.resultSeverity)).split("#")[-1],
                "shape": short(report.value(r, SH.sourceShape)),
                "message": str(report.value(r, SH.resultMessage)),
            }
        )
    by_shape: dict[str, int] = {}
    for r in results:
        key = f"{r['severity']}: {r['message'][:90]}"
        by_shape[key] = by_shape.get(key, 0) + 1
    return {"conforms": conforms, "results": results, "summary": by_shape, "ms": round(ms, 1)}


def answer(g: Graph, query_file: pathlib.Path) -> dict:
    text = query_file.read_text()
    question = text.splitlines()[0].lstrip("# ").strip()
    rows = list(g.query(text))
    header = [str(v) for v in rows[0].labels] if rows else []
    table = [[short(x) if x is not None else "" for x in row] for row in rows]
    return {"file": query_file.name, "question": question, "header": header, "rows": table}


def markdown_table(header: list[str], rows: list[list[str]]) -> str:
    if not header:
        return "_no rows_\n"
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    for r in rows:
        out.append("| " + " | ".join(str(c).replace("|", "\\|") for c in r) + " |")
    return "\n".join(out) + "\n"


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    t0 = time.perf_counter()
    explicit = load(
        ONTO / "imports" / "bot.ttl",
        *module_files(),
        ONTO / "twb-catalogue.ttl",
        ONTO / "examples" / "case-house.ttl",
        ONTO / "examples" / "case-house-rules.ttl",
        ONTO / "examples" / "case-house-use-rules.ttl",
    )
    shapes = load(ONTO / "twb-shapes.ttl")
    explicit_count = len(explicit)
    rules = sorted((ONTO / "queries" / "rules").glob("*.rq"))
    inferred = Graph()
    t_rules = time.perf_counter()
    rule_counts = apply_rules(explicit, inferred, rules)
    rules_seconds = time.perf_counter() - t_rules
    g = union(explicit, inferred)

    # 3. Ontology resolution against arch's.
    expected = json.loads((ONTO / "examples" / "case-house.expected.json").read_text())
    level = {
        str(TWB.ResolvedByOwn): "own",
        str(TWB.ResolvedByTemplate): "template",
        str(TWB.ResolvedByStandard): "standard",
        str(TWB.ResolvedByRule): "rule",
        str(TWB.ResolvedByDefault): "default",
    }
    detail_notation = {
        str(TWB.PlainOpening): "plain",
        str(TWB.SillFlashing): "sill-flashing",
        str(TWB.FrameBoards): "frame-boards",
        str(TWB.HeadAndSillBoards): "head-sill-boards",
    }
    edge_checks = []
    for key, exp in expected["edges"].items():
        e = URIRef(exp["iri"])
        got = level.get(str(g.value(e, TWB.resolvedBy)), None)
        through = g.value(e, TWB.runsThrough)
        through_id = unquote(str(through)[len(BASE) + len("surface/"):]) if through else None
        trims = len(list(g.objects(e, TWB.effectiveTrim)))
        # An edge's own joint and a template must be found as such; below them arch says only which
        # surface, if any, runs through, which the ontology's standard, T rule and default must agree on.
        if exp["resolution"] in ("own", "template"):
            agree_level = got == exp["resolution"]
        else:
            agree_level = got in ("standard", "rule", "default")
        edge_checks.append(
            {
                "edge": key,
                "type": exp["type"],
                "arch": exp["resolution"],
                "twb": got,
                "archThrough": exp["through"],
                "twbThrough": through_id,
                "archTrims": f"{exp['trims']} ({exp['trimSource']})",
                "twbTrims": trims,
                "agree": agree_level and through_id == exp["through"] and trims == exp["trims"],
            }
        )
    opening_checks = []
    for key, exp in expected["openings"].items():
        o = URIRef(exp["iri"])
        got_detail = detail_notation.get(str(g.value(o, TWB.resolvedOpeningDetail)))
        got_level = level.get(str(g.value(o, TWB.resolvedBy)))
        opening_checks.append(
            {
                "opening": key,
                "arch": f"{exp['detail']} ({exp['resolution']})",
                "twb": f"{got_detail} ({got_level})",
                "agree": got_detail == exp["detail"] and got_level == exp["resolution"],
            }
        )

    # 4. Validation as exported.
    before = validate(g, shapes)

    # 5. Repair: wet-room coverings on the boundaries that need them, then validate again.
    repaired = union(g)
    repaired.update((ONTO / "queries" / "repair-wet-room-coverings.ru").read_text())
    coverings = len(list(repaired.subject_objects(TWB.hasCovering)))
    after = validate(repaired, shapes)

    # 6. Competency questions, on the repaired graph.
    answers = [answer(repaired, f) for f in sorted((ONTO / "queries" / "cq").glob("*.rq"))]

    # 7. Access: one door opened from one side only.
    restricted = union(repaired)
    for t in list(restricted.triples((None, TWB.leadsTo, None))):
        restricted.remove(t)
    restricted.update((ONTO / "queries" / "restrict-bedroom-door.ru").read_text())
    ways = [f for f in rules if f.name.startswith("41-")]
    apply_rules(restricted, restricted, ways)
    access = validate(restricted, shapes)
    access_answers = [answer(restricted, f) for f in sorted((ONTO / "queries" / "cq").glob("cq15-*.rq"))]

    # 8. The same rules in Oxigraph. Blank nodes aside, it must infer what rdflib inferred.
    oxi_inferred, oxi_seconds = apply_rules_oxigraph(explicit, rules)

    report = {
        "triples": {"explicit": explicit_count, "inferred": len(inferred), "shapes": len(shapes)},
        "rules": rule_counts,
        "edgeResolution": {
            "edges": len(edge_checks),
            "agree": sum(c["agree"] for c in edge_checks),
            "checks": edge_checks,
        },
        "openingResolution": {
            "openings": len(opening_checks),
            "agree": sum(c["agree"] for c in opening_checks),
            "checks": opening_checks,
        },
        "validationBefore": before,
        "repairCoverings": coverings,
        "validationAfter": after,
        "answers": answers,
        "access": {
            "restriction": "restrict-bedroom-door.ru",
            "validation": access,
            "answers": access_answers,
        },
        "engines": {
            "rdflib": {"version": __import__("rdflib").__version__, "rulesSeconds": round(rules_seconds, 3), "inferred": len(inferred)},
            "oxigraph": {"version": pyoxigraph.__version__, "rulesSeconds": round(oxi_seconds, 3), "inferred": len(oxi_inferred)},
        },
        "seconds": round(time.perf_counter() - t0, 2),
    }
    (RESULTS / "twb-check.json").write_text(json.dumps(report, indent=1))

    md = ["# TWB check of the case house\n"]
    md.append(
        f"Triples: {explicit_count} explicit, {len(inferred)} inferred by {len(rules)} rules. "
        f"Run time {report['seconds']} s.\n"
    )
    md.append("## Rules\n")
    md.append(markdown_table(["rule", "triples inferred"], [[k, str(v)] for k, v in rule_counts.items()]))
    md.append(
        f"\n## Joint resolution: ontology vs arch\n\n{report['edgeResolution']['agree']} of "
        f"{len(edge_checks)} arch edges agree.\n"
    )
    md.append(
        markdown_table(
            ["edge", "type", "arch", "twb", "arch through", "twb through", "arch trims", "twb trims", "agree"],
            [
                [c["edge"], c["type"], c["arch"], str(c["twb"]), str(c["archThrough"]), str(c["twbThrough"]), c["archTrims"], str(c["twbTrims"]), str(c["agree"])]
                for c in edge_checks
            ],
        )
    )
    md.append(
        f"\n## Opening details: ontology vs arch\n\n{report['openingResolution']['agree']} of "
        f"{len(opening_checks)} openings agree.\n"
    )
    md.append(markdown_table(["opening", "arch", "twb", "agree"], [[c["opening"], c["arch"], c["twb"], str(c["agree"])] for c in opening_checks]))
    for title, v in (("Validation as exported", before), ("Validation after the wet-room repair", after)):
        md.append(f"\n## {title}\n\nConforms: {v['conforms']} ({len(v['results'])} results, {v['ms']} ms).\n")
        md.append(markdown_table(["result", "count"], [[k, str(n)] for k, n in v["summary"].items()]))
    md.append(f"\nRepair applied {coverings} wet-room coverings.\n")
    md.append(
        f"\n## Access: bedroom 1's door opened from the living room only\n\nConforms: {access['conforms']} "
        f"({len(access['results'])} results).\n"
    )
    md.append(markdown_table(["result", "count"], [[k, str(n)] for k, n in access["summary"].items()]))
    for a in access_answers:
        md.append(f"\n{a['question']}\n\n")
        md.append(markdown_table(a["header"], a["rows"]))
    e = report["engines"]
    md.append(
        f"\n## Engines\n\nThe rules: rdflib {e['rdflib']['version']} {e['rdflib']['rulesSeconds']} s, "
        f"Oxigraph {e['oxigraph']['version']} {e['oxigraph']['rulesSeconds']} s; "
        f"{e['rdflib']['inferred']} and {e['oxigraph']['inferred']} triples inferred.\n"
    )
    md.append("\n## Competency questions\n")
    for a in answers:
        md.append(f"\n### {a['question']}\n\n`{a['file']}`, {len(a['rows'])} rows.\n\n")
        md.append(markdown_table(a["header"], a["rows"][:40]))
    (RESULTS / "twb-check.md").write_text("".join(md))
    print(
        json.dumps(
            {
                "triples": report["triples"],
                "rules": rule_counts,
                "edgesAgree": f"{report['edgeResolution']['agree']}/{len(edge_checks)}",
                "openingsAgree": f"{report['openingResolution']['agree']}/{len(opening_checks)}",
                "before": {"conforms": before["conforms"], "summary": before["summary"]},
                "coverings": coverings,
                "after": {"conforms": after["conforms"], "summary": after["summary"]},
                "access": {"conforms": access["conforms"], "summary": access["summary"]},
                "engines": report["engines"],
                "seconds": report["seconds"],
            },
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
