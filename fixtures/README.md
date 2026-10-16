# Fixtures

- `houses/`: house files the tests read — examples in `twb/1` and the older `arch/1`, in faces and
  in the simple shape.
- `shacl/`: what the SHACL engine of `src/validate` is held to. `expected.json` is written by
  `tools/shacl_expected.py`: pyshacl's results on the case house (as exported with the rules
  applied, repaired, without the rules, and broken variants of it, each a SPARQL Update) and on
  `core-shapes.ttl` × `core-data.ttl`, the SHACL Core features `twb-shapes.ttl` does not use.
- `Duplex.ifc` (not in the repository): the buildingSMART **Duplex Apartment**
  (`Duplex_A_20110907.ifc`, Revit 2011, IFC2X3), the IFC importer's test model. It is not kept
  here because its licence could not be confirmed. Put a copy at `fixtures/Duplex.ifc` and the
  tests in `src/ifc/ifc-to-house.spec.ts` that read it run; without it they are skipped, and the
  importer is tested on the IFC files the spec writes itself.
