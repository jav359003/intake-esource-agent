# Tools

Development harnesses. None of this ships in the extension.

| | |
|---|---|
| `test-typemap.mjs` | Runs the type-mapping prompt against an element library outside the extension, so the prompt can be iterated on without loading Chrome. Caches responses to disk. `node tools/test-typemap.mjs '["Dropdown","Check List",…]'` |
| `score-mock-b.py` | Diffs a Veridian EDC run against the input file. Takes a JSON file containing `__dump()` output. |
| `preview/` | Renders the reviewer panel outside Chrome against sample escalations, so the gate could be designed by looking at it. Serve the repo root and open `/tools/preview/`. |
