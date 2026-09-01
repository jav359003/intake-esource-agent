"""Score a Mock B build against the input file. Run after dumping __dump()."""
import json, pathlib, sys
raw = pathlib.Path(sys.argv[1]).read_text()
b = json.loads(raw[raw.find('{'):raw.rfind('}')+1])
ir = json.loads(pathlib.Path("assignment/data/abc-101-study.ir.json").read_text())
bt = {t["name"]: t for t in b["timepoints"]}
n = dict(v=0,f=0,fl=0,t=0,r=0,o=0,g=0,rep=0,rules=0)
tot = dict(v=len(ir["visits"]),f=0,fl=0,coded=0,ranged=0,rules=0,rep=0)
issues = []
for v in ir["visits"]:
    t = bt.get(v["name"]); n["v"] += 1 if t else 0
    bp = {p["name"]: p for p in (t or {}).get("pages", [])}
    for f in v["forms"]:
        tot["f"] += 1; g = bp.get(f["name"])
        if not g: issues.append("missing page " + f["name"]); continue
        n["f"] += 1; tot["rep"] += 1
        if (g["style"] == "Repeating log") == bool(f.get("repeating")): n["rep"] += 1
        else: issues.append(f"record style {f['name']}")
        gf = {x["label"]: x for x in g["fields"]}
        for fl in f["fields"]:
            tot["fl"] += 1; x = gf.get(fl["label"])
            if fl.get("options"): tot["coded"] += 1
            if fl.get("min") is not None: tot["ranged"] += 1
            if fl.get("skip_logic"): tot["rules"] += 1
            if not x: issues.append("missing field " + fl["label"]); continue
            n["fl"] += 1
            if x["canonical"] == fl["type"]: n["t"] += 1
            else: issues.append(f"type {fl['label']}: want {fl['type']} got {x['canonical']}")
            if bool(x["required"]) == bool(fl.get("required")): n["r"] += 1
            if fl.get("options"):
                if [(c["code"],c["label"]) for c in x["choices"]] == [(o["code"],o["label"]) for o in fl["options"]]: n["o"] += 1
                else: issues.append("choices " + fl["label"])
            if fl.get("min") is not None:
                if str(x.get("min"))==str(fl["min"]) and str(x.get("max"))==str(fl["max"]): n["g"] += 1
                else: issues.append("range " + fl["label"])
            if fl.get("skip_logic"):
                rl = x.get("rule")
                if rl and rl["when"]==fl["skip_logic"]["when_field_label"] and str(rl["equals"])==str(fl["skip_logic"]["equals_value"]): n["rules"] += 1
                else: issues.append("rule " + fl["label"])
pc = lambda a,t: f"{a}/{t}".ljust(11) + (f"{100*a//t}%" if t else "")
print("MOCK B — same extension, no code changed for this platform")
print(f"  timepoints       {pc(n['v'],tot['v'])}")
print(f"  casebook pages   {pc(n['f'],tot['f'])}")
print(f"  record style     {pc(n['rep'],tot['rep'])}")
print(f"  fields           {pc(n['fl'],tot['fl'])}")
print(f"  types            {pc(n['t'],tot['fl'])}")
print(f"  required         {pc(n['r'],tot['fl'])}")
print(f"  coded choices    {pc(n['o'],tot['coded'])}")
print(f"  ranges           {pc(n['g'],tot['ranged'])}")
print(f"  display rules    {pc(n['rules'],tot['rules'])}")
print(f"\n  issues: {len(issues)}  {issues[:5]}")
