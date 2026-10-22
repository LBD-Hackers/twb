"""Reads a twb/1 house file as JSON-LD and checks the graph it makes against the TWB ontology.

    python tools/twb_house_check.py [house.json ...]     # default: ontology/examples/case-house.json

For each file it reports the triples the file makes, every twb: or twbd: term it uses that the
ontology (twb.ttl and its modules) does not define, and every JSON key the context does not map (which a
JSON-LD processor drops). The context the file names is read from the copy published at its URL
(ontology/twb-house.context.jsonld for context 3, twb-house.context.2.jsonld and .1.jsonld for
contexts 2 and 1), so the
check runs offline. Exits non-zero when a twb: or twbd: term is undefined.
"""

import json
import pathlib
import sys

import rdflib
from pyld import jsonld

from twb_modules import module_files

PAPER = pathlib.Path(__file__).resolve().parents[1]
ONTO = PAPER / "ontology"
# Context 3 (TWB 0.5.0), context 2 (0.3.0), which put the simple shape's terms under arch:, and
# context 1 before it, which put the sections' terms under twbd: too.
CONTEXTS = {
    "https://w3id.org/twb/context/3.jsonld": ONTO / "twb-house.context.jsonld",
    "https://w3id.org/twb/context/2.jsonld": ONTO / "twb-house.context.2.jsonld",
    "https://w3id.org/twb/context/1.jsonld": ONTO / "twb-house.context.1.jsonld",
}
BASE = "https://example.org/twb/house/"
TWB = "https://w3id.org/twb#"
TWBD = "https://w3id.org/twb/doc#"
# Every term of TWB, and the deprecated twbd: terms of context 1, must be defined.
OWN = (TWB, TWBD)


def loader(url, options=None):
    if url in CONTEXTS:
        return {
            "contentType": "application/ld+json",
            "contextUrl": None,
            "documentUrl": url,
            "document": json.loads(CONTEXTS[url].read_text()),
        }
    raise ValueError(f"no network: {url}")


def defined_terms():
    g = rdflib.Graph()
    for f in module_files():
        g.parse(f)
    return {str(s) for s in g.subjects() if str(s).startswith(OWN)}


def unmapped_keys(doc, context, path="$"):
    """JSON keys that are neither keywords nor terms of the context, with where they stand."""
    out = []
    if isinstance(doc, dict):
        for k, v in doc.items():
            if not k.startswith("@") and k not in context:
                out.append(f"{path}.{k}")
            # JSON literals are kept whole: nothing inside them is a term.
            term = context.get(k)
            if isinstance(term, dict) and term.get("@type") == "@json":
                continue
            # An index map's keys are values, not terms.
            if isinstance(term, dict) and term.get("@container") == "@index" and isinstance(v, dict):
                for key, item in v.items():
                    out += unmapped_keys(item, context, f"{path}.{k}.{key}")
                continue
            out += unmapped_keys(v, context, f"{path}.{k}")
    elif isinstance(doc, list):
        for i, v in enumerate(doc):
            out += unmapped_keys(v, context, f"{path}[{i}]")
    return out


def main(paths):
    known = defined_terms()
    failed = False
    for path in paths:
        doc = json.loads(pathlib.Path(path).read_text())
        context = json.loads(CONTEXTS[doc["@context"]].read_text())["@context"]
        # The terms the Blueprint type brings with it apply to the blueprint's own keys.
        scoped = {**context, **context["Blueprint"]["@context"]}
        nquads = jsonld.to_rdf(
            doc, {"format": "application/n-quads", "base": BASE, "documentLoader": loader}
        )
        g = rdflib.Graph()
        g.parse(data=nquads, format="nt")
        used = {str(t) for t in g.predicates()} | {str(o) for o in g.objects() if isinstance(o, rdflib.URIRef)}
        undefined = sorted(t for t in used if t.startswith(OWN) and t not in known)
        dropped = sorted(set(unmapped_keys(doc, scoped)))
        print(f"{path}: {len(g)} triples")
        print(f"  twb and twbd terms used: {len([t for t in used if t.startswith(OWN)])}, undefined: {undefined or 'none'}")
        print(f"  keys the context does not map: {dropped or 'none'}")
        failed |= bool(undefined)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or [str(ONTO / "examples" / "case-house.json")]))
