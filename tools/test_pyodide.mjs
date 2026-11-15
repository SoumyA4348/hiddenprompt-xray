// Run hiddenprompt_scan's own test file inside Pyodide (Node) with a locally built PyMuPDF wheel.
// usage: node run.mjs <wheel.whl> <release dir>
import { loadPyodide } from "pyodide";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [wheel, release] = process.argv.slice(2);
const t0 = performance.now();
const py = await loadPyodide();
console.log(`pyodide ${py.version} loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const t1 = performance.now();
await py.loadPackage(wheel === "builtin" ? "pymupdf" : wheel);
await py.runPythonAsync("import pymupdf; print('pymupdf', pymupdf.VersionBind, 'mupdf', pymupdf.mupdf_version)");
console.log(`wheel loaded in ${((performance.now() - t1) / 1000).toFixed(1)} s`);

py.FS.mkdirTree("/app/tests");
py.FS.writeFile("/app/hiddenprompt_scan.py", fs.readFileSync(path.join(release, "hiddenprompt_scan.py")));
py.FS.writeFile("/app/tests/test_hiddenprompt_scan.py", fs.readFileSync(path.join(release, "tests", "test_hiddenprompt_scan.py")));

const t2 = performance.now();
await py.runPythonAsync(`
import runpy, sys
sys.argv = ["test"]
try:
    runpy.run_path("/app/tests/test_hiddenprompt_scan.py", run_name="__main__")
except SystemExit as e:
    print("exit", e.code)
`);
console.log(`tests took ${((performance.now() - t2) / 1000).toFixed(1)} s`);
