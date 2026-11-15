// Runs Pyodide + PyMuPDF + hiddenprompt_scan off the main thread. Every file is same-origin.
import { loadPyodide } from "./vendor/pyodide/pyodide.mjs";

const WHEEL = "pymupdf_lite-2.1-cp313-abi3-pyemscripten_2025_0_wasm32.whl";
const base = new URL("./", import.meta.url);
let py;

const ready = (async () => {
  post({ type: "status", text: "Loading Python" });
  py = await loadPyodide({ indexURL: new URL("vendor/pyodide/", base).href });
  post({ type: "status", text: "Loading the PDF engine" });
  await py.loadPackage(new URL(`vendor/${WHEEL}`, base).href);
  py.FS.mkdirTree("/app");
  for (const name of ["hiddenprompt_scan.py", "xray.py"]) {
    const res = await fetch(new URL(`py/${name}`, base));
    if (!res.ok) throw new Error(`could not load ${name}`);
    py.FS.writeFile(`/app/${name}`, new Uint8Array(await res.arrayBuffer()));
  }
  py.runPython("import sys; sys.path.insert(0, '/app'); import json, xray");
  post({ type: "ready" });
})().catch((e) => post({ type: "fatal", text: String(e?.message || e) }));

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

function call(code, vars) {
  for (const [k, v] of Object.entries(vars)) py.globals.set(k, v);
  try {
    return py.runPython(code);
  } finally {
    for (const k of Object.keys(vars)) py.globals.delete(k);
  }
}

self.onmessage = async ({ data: msg }) => {
  try {
    await ready;
    if (!py) return;
    if (msg.type === "scan") {
      const t = performance.now();
      const json = call("json.dumps(xray.scan(bytes(data.to_py())), ensure_ascii=False)", { data: msg.bytes });
      post({ type: "report", id: msg.id, report: JSON.parse(json), ms: Math.round(performance.now() - t) });
    } else if (msg.type === "render") {
      const proxy = call("xray.render(pno, zoom)", { pno: msg.page, zoom: msg.zoom });
      const png = proxy.toJs();
      proxy.destroy();
      post({ type: "page", id: msg.id, page: msg.page, png }, [png.buffer]);
    } else if (msg.type === "clean") {
      const proxy = call("xray.clean()", {});
      const out = proxy.toJs({ dict_converter: Object.fromEntries });
      proxy.destroy();
      post({ type: "clean", id: msg.id, pdf: out.pdf, after: out.after, text: out.text }, [out.pdf.buffer]);
    }
  } catch (e) {
    post({ type: "error", id: msg.id, text: String(e?.message || e).split("\n").slice(-2).join(" ") });
  }
};
