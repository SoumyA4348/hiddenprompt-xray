// Scan Lin's 18 known-positive PDFs with hiddenprompt_scan inside Pyodide; print verdict per paper as JSON lines.
// usage: node lin.mjs <release dir> <pdf dir>
import { loadPyodide } from "pyodide";
import fs from "node:fs";
import path from "node:path";

const [release, dir, wheel = "pymupdf"] = process.argv.slice(2);
const py = await loadPyodide();
await py.loadPackage(wheel);
py.FS.mkdirTree("/app");
py.FS.writeFile("/app/hiddenprompt_scan.py", fs.readFileSync(path.join(release, "hiddenprompt_scan.py")));
py.runPython("import sys, json; sys.path.insert(0, '/app'); import hiddenprompt_scan");

for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort()) {
  py.globals.set("data", new Uint8Array(fs.readFileSync(path.join(dir, name))));
  const t = performance.now();
  const out = py.runPython(`
r = hiddenprompt_scan.scan(bytes(data.to_py()))
json.dumps({"verdict": r.get("verdict", r.get("status")), "intent": r.get("intent"), "reasons": sorted(r.get("reasons", []))})`);
  console.log(JSON.stringify({ id: name.replace(".pdf", ""), ms: Math.round(performance.now() - t), ...JSON.parse(out) }));
}
