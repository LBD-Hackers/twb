"""TWB's modules, as the files that hold them. https://w3id.org/twb (twb.ttl) imports every one;
tools that read Turtle without following owl:imports load the files themselves."""

import pathlib

ONTO = pathlib.Path(__file__).resolve().parents[1] / "ontology"

# In import order: each module imports only modules before it.
MODULES = ["core", "construction", "detailing", "requirements", "profile", "decision", "derivation", "housefile", "doc"]


def module_files() -> list[pathlib.Path]:
    """The umbrella and every module: TWB as a whole."""
    return [ONTO / "twb.ttl", *(ONTO / f"twb-{m}.ttl" for m in MODULES)]
