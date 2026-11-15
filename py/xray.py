"""Browser glue for HiddenPrompt X-ray (runs in Pyodide).

The verdict comes from hiddenprompt_scan.scan() unchanged. This file only adds what the page
needs to draw: where each hidden run sits on its page, page images, and the extracted text
with the hidden parts marked.
"""
import pymupdf

import hiddenprompt_scan as hps

_doc = None
_data = None
_clean = None


def _open(data):
    global _doc, _data, _clean
    if _doc is not None:
        _doc.close()
    _data, _clean = bytes(data), None
    _doc = pymupdf.open(stream=_data, filetype="pdf")


def _page_spans(page):
    """Same spans, in the same order, as hps._spans(), plus their block/line position."""
    d = page.get_text("dict", flags=hps.EXTRACT, clip=pymupdf.INFINITE_RECT())
    for b, block in enumerate(d["blocks"]):
        for li, line in enumerate(block.get("lines", ())):
            for s in line["spans"]:
                if s["text"].strip():
                    s["dir"] = line["dir"]
                    yield b, li, s


def _looks_hidden(s, rect):
    return bool(hps._attr_reasons(s, rect)) or hps._lum(s["color"]) >= hps.LIGHT


def _locate(runs, spans, rect):
    """Match each run (consecutive span texts joined by spaces) to span indices on its page.
    When the same text appears more than once, prefer the copy whose spans look hidden."""
    placed, used = [], set()
    for run in runs:
        want, options = run["text"], []
        for k in range(len(spans)):
            if k in used or not want.startswith(spans[k][2]["text"][:len(want)]):
                continue
            text, j = spans[k][2]["text"], k
            while len(text) < len(want) and j + 1 < len(spans) and j + 1 not in used:
                nxt = text + " " + spans[j + 1][2]["text"]
                if not want.startswith(nxt[:len(want)]):
                    break
                text, j = nxt, j + 1
            if len(text) >= len(want):
                options.append(list(range(k, j + 1)))
        found = next((ks for ks in options if any(_looks_hidden(spans[k][2], rect) for k in ks)),
                     options[0] if options else [])
        used.update(found)
        placed.append(found)
    return placed


def scan(data):
    """Scan, then attach page geometry and highlight boxes to each run."""
    _open(data)
    rep = hps.scan(_data)
    if rep["status"] != "ok":
        return rep
    rep["page_sizes"] = [[p.rect.width, p.rect.height] for p in _doc]
    by_page = {}
    for i, run in enumerate(rep["runs"]):
        by_page.setdefault(run["page"], []).append(i)
    hidden = {}
    for pno, idx in by_page.items():
        page = _doc[pno - 1]
        spans = list(_page_spans(page))
        for i, ks in zip(idx, _locate([rep["runs"][i] for i in idx], spans, page.rect)):
            run = rep["runs"][i]
            run["boxes"] = [list(spans[k][2]["bbox"]) for k in ks]
            run["hits"] = hps.lexicon_hits(hps.norm(run["text"]))
            hidden.setdefault(pno, set()).update(ks)
    for run in rep["runs"]:
        run.setdefault("boxes", [])
        run.setdefault("hits", hps.lexicon_hits(hps.norm(run["text"])))
    rep["ai_text"] = _ai_text(_doc, hidden)
    return rep


def _ai_text(doc, hidden):
    """Extracted text as [(text, is_hidden)] segments: what an LLM receives from this file."""
    out = []
    for page in doc:
        marked = hidden.get(page.number + 1, set())
        last, k = None, 0
        for b, li, s in _page_spans(page):
            if last is not None:
                out.append(["\n" if (b, li) != last else " ", False])
            out.append([s["text"], k in marked])
            last, k = (b, li), k + 1
        out.append(["\n\n", False])
    merged = []
    for text, h in out:
        if merged and merged[-1][1] == h:
            merged[-1][0] += text
        else:
            merged.append([text, h])
    return merged


def render(pno, zoom):
    """PNG of one page (1-based)."""
    return _doc[pno - 1].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False).tobytes("png")


def clean():
    """Stripped copy (cached), its verdict, and its text: guard()'s strip path."""
    global _clean
    if _clean is None:
        pdf = hps.strip(_data)
        after = hps.scan(pdf)
        with pymupdf.open(stream=pdf, filetype="pdf") as d:
            text = "\n\n".join(p.get_text(flags=hps.EXTRACT, clip=pymupdf.INFINITE_RECT()) for p in d)
        _clean = {"pdf": pdf, "after": after.get("verdict", after["status"]), "text": text}
    return _clean
