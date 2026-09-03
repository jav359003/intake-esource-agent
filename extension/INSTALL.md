# Installing and running

## 1. A platform to build into

Either the supplied mock:

```bash
cd <assignment>/esource-mock && npm install && npm run dev      # localhost:5173
```

or the second platform in this repository, which the agent was never written
against:

```bash
cd second-mock && python3 -m http.server 5199                   # localhost:5199
```

## 2. Load the extension

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select the `extension/` folder in this repository
4. Pin it if you like; the toolbar icon opens the side panel

Chrome 114 or newer, for the side panel API.

## 3. Run it

1. Open the platform tab and click the extension icon — the side panel opens
2. Expand **API key**, paste an OpenAI key, **Save**
   *Two calls per platform: reading the element library and mapping the field
   types. Nothing per field.*
3. **Choose the study specification** → `<assignment>/data/abc-101-study.ir.json`
4. **Inspect platform** — it reports the element types it found and which
   control commits
5. Confirm the type mapping card
6. **Build the study**

A full run is 240 steps and takes about two minutes. Anything the agent is not
sure about appears in the panel as a decision, grouped so one answer covers
every place it applies.

## If something goes wrong

| | |
|---|---|
| "agent modules not loaded on this page" | The content scripts run on http/https pages only. Reload the platform tab after loading the extension. |
| No side panel when clicking the icon | Chrome older than 114. |
| "no API key saved" | The key is stored per browser profile; re-save it in the panel. |
| The run stops with decisions outstanding | That is the design. Clear the queue; blocking items are shown first. |

## Verifying a run yourself

Both mocks expose a hook for a human to check results by hand — `__readState()`
on the supplied mock, `__dump()` on the second. **The agent never calls
either.** From the DevTools console on the platform tab:

```js
copy(JSON.stringify(__dump()))          # second mock
```

then, from this repository:

```bash
python3 tools/score-mock-b.py <file>
```
