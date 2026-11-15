# HiddenPrompt X-ray

Drop a PDF in the browser and see the text an AI reviewer would read but a person can't: white text,
1-point fonts, invisible or transparent text, text off the page, covered text, switched-off layers.
Hidden prompts are lit up on the page, and you can download a clean copy.

The file never leaves the browser tab. The page loads only its own files (no CDN, no analytics, no fonts
from Google), so reviewers can check confidential submissions.

## How it works

- `worker.js` starts [Pyodide](https://pyodide.org) 0.29.5 in a Web Worker and loads PyMuPDF.
- `py/hiddenprompt_scan.py` is the detector from
  [hiddenprompt-scan](https://github.com/SoumyA4348/hiddenprompt-scan), copied byte for byte. The verdict
  is the same one the census used.
- `py/xray.py` adds only what the page needs: where each hidden run sits on its page, page images, and the
  extracted text with hidden parts marked. The clean PDF comes from the detector's own `strip()`.
- `app.js` is the UI. `index.html` holds the static Phase 2 chart (Table II of the paper).

## Checks

- Detector tests (`tests/test_hiddenprompt_scan.py` from the repo) inside Pyodide: 24/24 pass.
- Lin et al.'s 18 known positives (arXiv 2507.06185v2, Table 1): 18/18 `prompt`, with verdict, intent and
  reasons identical to native Python on PyMuPDF 1.28 (`tools/results/`).
- Browser smoke test (engine loads, sample scan, clean copy): Chromium, Firefox, WebKit.

```sh
cd tools && npm i pyodide@0.29.5
node test_pyodide.mjs ../vendor/pymupdf_lite-2.1-cp313-abi3-pyemscripten_2025_0_wasm32.whl <path to hiddenprompt-scan>
node lin_pyodide.mjs <path to hiddenprompt-scan> <folder of Lin PDFs> ../vendor/pymupdf_lite-2.1-cp313-abi3-pyemscripten_2025_0_wasm32.whl
```

Run `test_pyodide.mjs` from inside `tools/` and pass the wheel as a relative path: Pyodide reads a Windows
absolute path as the package name.

## Run locally

Any static server works (a Web Worker can't start from `file://`):

```sh
python -m http.server 8765
```

## Vendored files

| File | Source | Licence |
|---|---|---|
| `vendor/pyodide/` | npm `pyodide@0.29.5` (core files only) | MPL-2.0 |
| `vendor/pymupdf_lite-2.1-…wasm32.whl` | Built from PyMuPDF commit `6cd1dc2` (2026-11-13) with MuPDF branch `1.28.x` (1.28.7): `python scripts/test.py -m "git:--branch 1.28.x https://github.com/ArtifexSoftware/mupdf" --cibw-pyodide 1 cibw` in a `python:3.12-bookworm` container (~9 min) | AGPL-3.0, source: [PyMuPDF](https://github.com/pymupdf/PyMuPDF), [MuPDF](https://github.com/ArtifexSoftware/mupdf) |
| `vendor/fonts/` | Figtree, IBM Plex Mono, Pixelify Sans (Google Fonts, latin subset) | OFL-1.1 |

Pyodide 0.29.5 also ships PyMuPDF 1.26.3. It passes the same tests, but its reasons differ from native on
5 of Lin's 18 papers, so the app uses the 1.28 build.

`sample/sample-submission.pdf` is a made-up paper built by `tools/make_sample.py`.

## Licence

AGPL-3.0 (see `LICENSE`), because the app ships PyMuPDF. The detector itself is also available under MIT in
[hiddenprompt-scan](https://github.com/SoumyA4348/hiddenprompt-scan).

Paper: [doi.org/10.20944/preprints202611.0885.v1](https://doi.org/10.20944/preprints202611.0885.v1)
