# Veridian EDC — the second platform

A working eSource written **after** the agent already ran on the supplied mock,
and made as unlike it as possible while modelling the same clinical concepts.
It exists so the claim "this works on an eSource it has never seen" can be
tested rather than asserted.

```bash
python3 -m http.server 5199        # then open localhost:5199
```

## What differs from the supplied mock

| | supplied mock | here |
|---|---|---|
| vocabulary | Visit, Source Document, Save | Timepoint, Casebook Page, Commit Draft |
| element library | Dropdown, Check List, Checkbox, Number (Whole) | Picklist, Multi-Pick, Tick Box, Whole Number |
| layout | library left, options right | palette **right**, properties **left** |
| screens | list → detail → builder | list → detail → **builder opens on create** |
| markup | `<button>`, `<table>` | `div[role=button]`, `div[role=grid]` |
| repeating | a checkbox | a picklist ("Record Style") |
| decoy beside save | `Save As Template` | `Commit to Library` |

## What is deliberately the same

It exposes correct ARIA roles and accessible names, because every usable web
application does and that is the contract the agent is built against. A mock
that hid its semantics would be testing whether the agent can read minds, not
whether it generalises.

## Verifying a run

`window.__dump()` returns the saved study as JSON — the equivalent of the
supplied mock's `__readState()`, and used the same way: by a person, to check
results by hand. The agent never calls it.

```bash
# after a run, in the browser console:
copy(JSON.stringify(__dump()))
# then, from the repo root:
python3 tools/score-mock-b.py <that file>
```
