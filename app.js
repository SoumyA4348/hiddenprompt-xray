// HiddenPrompt X-ray: UI. All PDF work happens in worker.js (Pyodide + PyMuPDF + hiddenprompt_scan).
const $ = (id) => document.getElementById(id);
const MAX_BYTES = 200 * 1024 * 1024;

const REASON = {
  light: "White text on a white page",
  tiny: "Text under 1 point",
  invisible: "Invisible text (render mode 3)",
  transparent: "Fully transparent text",
  offpage: "Text outside the page edge",
  covered: "Text covered by a shape or image",
  layer: "Text in a switched-off layer",
};
const TAG = {
  light: "white text", tiny: "tiny text", invisible: "invisible text", transparent: "transparent text",
  offpage: "off the page", covered: "covered text", layer: "hidden layer",
};
const ASK = {
  ignore_instructions: "tells the model to ignore its instructions",
  positive_review: "asks for a positive review",
  positive_only: "asks for a positive review",
  hide_weaknesses: "asks it to hide weaknesses",
  downplay_weaknesses: "asks it to play down weaknesses",
  recommend_accept: "asks it to recommend acceptance",
  accept_paper: "asks it to accept the paper",
  score_request: "asks for the top score",
  praise_frame: "feeds it praise words",
  review_requirements: "invents \"review requirements\"",
  ai_reviewer: "addresses an AI reviewer",
  if_you_are_ai: "addresses an AI directly",
  as_a_model: "addresses an AI directly",
  note_to_ai: "leaves a note for an AI",
  model_name: "names an AI model",
  canary_word: "plants a word to catch AI-written reviews",
  ai_ban: "warns against using AI",
  cjk_override: "tells the model to ignore its instructions",
  cjk_positive: "asks for a positive review",
};
const VERDICT = {
  prompt: { title: "Hidden prompt found", icon: "warn" },
  suspect: { title: "Hidden text mentions AI", icon: "warn" },
  hidden_text: { title: "Hidden text, no instructions", icon: "info" },
  clean: { title: "No hidden text found", icon: "ok" },
  unreadable: { title: "Couldn't read this PDF", icon: "info" },
  encrypted: { title: "This PDF is password-protected", icon: "info" },
};
const INTENT_TEXT = {
  manipulate: "tells an AI reviewer to give a better review",
  override: "tells an AI to ignore its instructions",
  canary: "plants a trap to catch AI-written reviews",
  deter: "warns readers not to use AI",
  address: "speaks to an AI directly",
};
const ICONS = {
  warn: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#f2a564" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>',
  info: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#cdbcbf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
  ok: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#3fd0c9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
};

// ---- worker plumbing ----
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const pending = new Map();
let nextId = 1, engineReady = false, engineFailed = false, queued = null;

worker.onmessage = ({ data: m }) => {
  if (m.type === "status") return engineStatus(`${m.text}…`);
  if (m.type === "ready") {
    engineReady = true;
    $("engine").hidden = true;
    if (queued) { const q = queued; queued = null; runScan(q.name, q.bytes); }
    return;
  }
  if (m.type === "fatal") {
    engineFailed = true;
    $("engine").classList.add("error");
    $("engine-bar").hidden = true;
    return engineStatus(`The scanner couldn't start in this browser (${m.text}). Try an up-to-date Chrome, Edge, Firefox or Safari.`);
  }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.type === "error" ? p.reject(new Error(m.text)) : p.resolve(m);
};

function ask(msg, transfer) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer || []);
  });
}

function engineStatus(text) {
  $("engine-text").textContent = text;
}

function say(text) {
  $("status").textContent = text;
}

// ---- state ----
let doc = null; // { name, size, report, page, pngs: Map, clean, aiMode }

// ---- input ----
$("file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f) takeFile(f);
});
$("sample").addEventListener("click", async () => {
  const res = await fetch("sample/sample-submission.pdf");
  takeFile(new File([await res.blob()], "sample-submission.pdf", { type: "application/pdf" }));
});
const drop = $("drop");
addEventListener("dragover", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  if (!$("start").hidden) drop.classList.add("over");
});
addEventListener("dragleave", (e) => { if (!e.relatedTarget) drop.classList.remove("over"); });
addEventListener("drop", (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  drop.classList.remove("over");
  takeFile(e.dataTransfer.files[0]);
});
$("again").addEventListener("click", () => {
  doc = null;
  $("result").hidden = true;
  $("start").hidden = false;
  $("file").focus();
});

async function takeFile(f) {
  if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return flashStart("That isn't a PDF. Choose a .pdf file.");
  if (f.size > MAX_BYTES) return flashStart("That file is over 200 MB, too big to scan in a browser tab.");
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (engineFailed) return;
  if (!engineReady) {
    queued = { name: f.name, bytes };
    $("engine").hidden = false;
    engineStatus(`${f.name} will be scanned as soon as the scanner is ready…`);
    return;
  }
  runScan(f.name, bytes);
}

function flashStart(text) {
  $("engine").hidden = false;
  $("engine-bar").hidden = true;
  engineStatus(text);
  say(text);
}

async function runScan(name, bytes) {
  $("engine").hidden = false;
  $("engine-bar").hidden = false;
  $("engine-bar").removeAttribute("value");
  engineStatus(`Scanning ${name}…`);
  say(`Scanning ${name}`);
  try {
    const size = bytes.byteLength;
    const m = await ask({ type: "scan", bytes }, [bytes.buffer]);
    $("engine").hidden = true;
    showResult(name, size, m.report, m.ms);
  } catch (e) {
    flashStart(`Scan failed: ${e.message}`);
  }
}

// ---- result ----
function showResult(name, size, report, ms) {
  const runs = report.runs || [];
  const first = runs.find((r) => r.hits.length && r.boxes.length) || runs.find((r) => r.boxes.length) || runs[0];
  doc = { name, size, report, page: first ? first.page : 1, pngs: new Map(), clean: null, aiMode: "this" };

  $("file-name").textContent = name;
  const pages = report.pages ? `${report.pages} page${report.pages === 1 ? "" : "s"} · ` : "";
  $("file-meta").textContent = `${pages}scanned on this device in ${(ms / 1000).toFixed(1)} s`;
  $("download-note").hidden = true;
  $("download").hidden = !runs.length;

  renderVerdict(report);
  renderFindings(runs);
  setAiMode("this");

  const ok = report.status === "ok";
  document.querySelector(".viewer").hidden = !ok;
  $("ai-block").hidden = !ok;
  if (ok) {
    renderPageList();
    showPage(doc.page);
  }

  $("start").hidden = true;
  $("result").hidden = false;
  $("verdict-title").focus();
  say(`${$("verdict-title").textContent}. ${$("verdict-text").textContent}`);
}

function renderVerdict(r) {
  const key = r.verdict || r.status;
  const v = VERDICT[key];
  $("verdict-icon").innerHTML = ICONS[v.icon];
  $("verdict-title").textContent = key === "clean" && r.runs?.length ? "No hidden prompt" : v.title;
  const pagesWith = [...new Set((r.runs || []).filter((x) => x.hits.length).map((x) => x.page))];
  const where = pagesWith.length ? `Page${pagesWith.length > 1 ? "s" : ""} ${pagesWith.slice(0, 5).join(", ")}${pagesWith.length > 5 ? "…" : ""}` : "This PDF";
  const text = {
    prompt: `${where} ${pagesWith.length > 1 ? "have" : "has"} text a person can't see that ${INTENT_TEXT[r.intent] || "gives an AI instructions"}.`,
    suspect: `${where} ${pagesWith.length > 1 ? "have" : "has"} hidden text that mentions AI but doesn't clearly ask it for anything. Read it below and judge.`,
    hidden_text: "Some text is invisible to a reader, but none of it gives an AI instructions. This is usually layout leftovers: figure labels, OCR layers, text spilling past the page.",
    clean: r.runs?.length
      ? "Only a few hidden characters, with no instructions to an AI. Too short to matter; they're listed below."
      : "Everything an AI would read here is also visible to a person.",
    unreadable: "The file looks damaged or isn't really a PDF.",
    encrypted: "Open it with its password, save an unlocked copy, and scan that.",
  }[key];
  $("verdict-text").textContent = text;

  const chips = $("chips");
  chips.replaceChildren();
  if (r.status === "ok") {
    chip(`verdict: ${r.verdict}`, r.verdict === "prompt");
    if (r.intent) chip(`intent: ${r.intent}`);
  }
  function chip(t, hot) {
    const s = document.createElement("span");
    s.textContent = t;
    if (hot) s.className = "hot";
    chips.append(s);
  }

  const extra = [];
  if (r.visible_hits?.length && (key === "clean" || key === "hidden_text"))
    extra.push("The visible text also has AI-directed phrases (common in papers about prompts). People can see those, so they don't count.");
  if (r.page_errors) extra.push(`${r.page_errors} page${r.page_errors > 1 ? "s" : ""} couldn't be read fully.`);
  $("verdict-extra").textContent = extra.join(" ");
  $("verdict-extra").hidden = !extra.length;
}

function runTitle(run) {
  const main = ["light", "invisible", "transparent", "tiny", "offpage", "covered", "layer"].find((x) => run.reasons.includes(x));
  return REASON[main] || "Hidden text";
}

function runWhy(run) {
  if (!run.hits.length) return "No instructions to an AI, so it doesn't count.";
  const asks = [...new Set(run.hits.map((h) => ASK[h]).filter(Boolean))];
  const s = asks.slice(0, 2).join(" and ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

function renderFindings(runs) {
  const list = $("findings");
  list.replaceChildren();
  $("findings-block").hidden = !runs.length;
  const sorted = [...runs].sort((a, b) => (b.hits.length > 0) - (a.hits.length > 0) || a.page - b.page);
  for (const run of sorted.slice(0, 40)) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<span class="f-top"><span class="f-title"></span><span class="f-page"></span></span>
      <span class="f-why"></span><span class="f-text"></span><span class="f-codes"></span>`;
    b.querySelector(".f-title").textContent = runTitle(run);
    b.querySelector(".f-page").textContent = `page ${run.page}`;
    b.querySelector(".f-why").textContent = runWhy(run);
    b.querySelector(".f-text").textContent = run.text.trim();
    const codes = b.querySelector(".f-codes");
    codes.textContent = [...run.reasons, ...(run.hits.length ? run.hits : ["no lexicon match"])].join(" · ");
    if (!run.hits.length) codes.classList.add("dim");
    b.addEventListener("click", () => {
      showPage(run.page);
      $("page-frame").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
    li.append(b);
    list.append(li);
  }
  if (sorted.length > 40) {
    const li = document.createElement("li");
    li.className = "more";
    li.textContent = `and ${sorted.length - 40} more hidden runs`;
    list.append(li);
  }
}

function renderPageList() {
  const list = $("pages");
  list.replaceChildren();
  const runs = doc.report.runs;
  for (let n = 1; n <= doc.report.pages; n++) {
    const here = runs.filter((r) => r.page === n);
    const flagged = here.some((r) => r.hits.length);
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = n;
    b.dataset.page = n;
    if (flagged) b.classList.add("flag");
    else if (here.length) b.classList.add("minor");
    b.setAttribute("aria-label", `Page ${n}${flagged ? ", hidden prompt" : here.length ? ", hidden text without instructions" : ""}`);
    b.addEventListener("click", () => showPage(n));
    li.append(b);
    list.append(li);
  }
}

async function showPage(n) {
  doc.page = n;
  for (const b of $("pages").querySelectorAll("button")) {
    if (Number(b.dataset.page) === n) {
      b.setAttribute("aria-current", "page");
      b.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else b.removeAttribute("aria-current");
  }
  $("page-label").textContent = `Page ${n} of ${doc.report.pages}`;
  drawOverlay(n);

  const frame = $("page-frame"), img = $("page-img");
  let png = doc.pngs.get(n);
  if (!png) {
    frame.classList.add("loading");
    const zoom = Math.min(3, Math.max(1.5, (frame.clientWidth * devicePixelRatio) / doc.report.page_sizes[n - 1][0]));
    const current = doc;
    try {
      const m = await ask({ type: "render", page: n, zoom });
      if (current !== doc) return;
      png = URL.createObjectURL(new Blob([m.png], { type: "image/png" }));
      doc.pngs.set(n, png);
    } catch (e) {
      frame.classList.remove("loading");
      $("page-note").textContent = `Couldn't draw this page: ${e.message}`;
      return;
    }
  }
  if (doc.page !== n) return;
  img.src = png;
  img.alt = `Page ${n} of ${doc.name}`;
  frame.classList.remove("loading");
}

function drawOverlay(n) {
  const [pw, ph] = doc.report.page_sizes[n - 1];
  const layer = $("overlay");
  layer.replaceChildren();
  layer.hidden = !$("show-hidden").checked;
  const notes = [];
  for (const run of doc.report.runs.filter((r) => r.page === n)) {
    if (!run.boxes.length) {
      if (run.reasons.includes("layer")) notes.push("Some hidden text sits in a switched-off layer, so it has no spot on the page. It's listed in Findings.");
      continue;
    }
    run.boxes.forEach((bb, i) => {
      let [x0, y0, x1, y1] = bb;
      const off = x1 < 0 || y1 < 0 || x0 > pw || y0 > ph;
      if (off) notes.push("Text placed outside the page is marked on the nearest edge.");
      x0 = clamp(x0, 0, pw - 4); x1 = clamp(x1, x0 + 4, pw); y0 = clamp(y0, 0, ph - 4); y1 = clamp(y1, y0 + 4, ph);
      const el = document.createElement("div");
      el.className = `hl${run.hits.length ? " count" : ""}${off ? " edge" : ""}`;
      Object.assign(el.style, {
        left: `${(x0 / pw) * 100}%`, top: `${(y0 / ph) * 100}%`,
        width: `${((x1 - x0) / pw) * 100}%`, height: `${((y1 - y0) / ph) * 100}%`,
      });
      layer.append(el);
      if (i === 0 && run.hits.length) {
        // Hidden prompts are often 1 pt: write the text out in a readable callout at the same spot.
        const left = Math.min((x0 / pw) * 100, 28);
        const call = document.createElement("div");
        call.className = "callout";
        Object.assign(call.style, { left: `${left}%`, top: `${Math.max((y0 / ph) * 100, 2.5)}%`, maxWidth: `${96 - left}%` });
        const tag = document.createElement("span");
        tag.className = "hl-tag";
        const main = run.reasons.find((x) => TAG[x]);
        tag.textContent = `HIDDEN · ${TAG[main] || "text"}`;
        const p = document.createElement("p");
        p.textContent = run.text.length > 320 ? `${run.text.slice(0, 320).trim()}…` : run.text.trim();
        call.append(tag, p);
        layer.append(call);
      } else if (i === 0) {
        const tag = document.createElement("span");
        tag.className = "hl-tag";
        const main = run.reasons.find((x) => TAG[x]);
        tag.textContent = `HIDDEN · ${TAG[main] || "text"}`;
        Object.assign(tag.style, { left: `${(x0 / pw) * 100}%`, top: `${Math.max((y0 / ph) * 100, 2.5)}%` });
        layer.append(tag);
      }
    });
  }
  $("page-note").textContent = [...new Set(notes)].join(" ");
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

$("show-hidden").addEventListener("change", () => { if (doc) drawOverlay(doc.page); });

// ---- what the AI reads ----
$("ai-this").addEventListener("click", () => setAiMode("this"));
$("ai-clean").addEventListener("click", () => setAiMode("clean"));
$("jump").addEventListener("click", () => {
  const m = $("ai-text").querySelector("mark");
  if (m) { m.scrollIntoView({ block: "center" }); $("ai-text").focus(); }
});

async function setAiMode(mode) {
  if (!doc) return;
  doc.aiMode = mode;
  $("ai-this").setAttribute("aria-pressed", mode === "this");
  $("ai-clean").setAttribute("aria-pressed", mode === "clean");
  const pre = $("ai-text");
  if (mode === "this") {
    pre.replaceChildren(...(doc.report.ai_text || []).map(([t, hidden]) => {
      if (!hidden) return document.createTextNode(t);
      const m = document.createElement("mark");
      m.textContent = t;
      return m;
    }));
    $("jump").hidden = !pre.querySelector("mark");
    $("ai-note").textContent = "This is the text a model gets when the PDF is uploaded or pasted into a chat. Hidden parts are marked.";
  } else {
    $("jump").hidden = true;
    if (!doc.report.runs.length) {
      pre.textContent = "";
      pre.append(...(doc.report.ai_text || []).map(([t]) => document.createTextNode(t)));
      $("ai-note").textContent = "Nothing was hidden, so the clean PDF reads the same.";
      return;
    }
    pre.textContent = "Making the clean copy…";
    const c = await getClean();
    if (!c || doc.aiMode !== "clean") return;
    pre.textContent = c.text;
    $("ai-note").textContent = c.after === "prompt"
      ? "A hidden prompt survives in the clean copy (covered text or a switched-off layer). Don't give this file to an AI."
      : "The clean copy keeps what a person can see and drops the hidden text.";
  }
  pre.scrollTop = 0;
}

async function getClean() {
  if (doc.clean) return doc.clean;
  const current = doc;
  try {
    const m = await ask({ type: "clean" });
    if (current !== doc) return null;
    doc.clean = { pdf: m.pdf, after: m.after, text: m.text };
    return doc.clean;
  } catch (e) {
    noteDownload(`Couldn't make a clean copy: ${e.message}`, true);
    return null;
  }
}

$("download").addEventListener("click", async () => {
  const btn = $("download");
  btn.disabled = true;
  say("Making the clean copy");
  const c = await getClean();
  btn.disabled = false;
  if (!c) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([c.pdf], { type: "application/pdf" }));
  a.download = doc.name.replace(/\.pdf$/i, "") + "-clean.pdf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  if (c.after === "prompt") noteDownload("Saved, but a hidden prompt survives in the copy (covered text or a switched-off layer). Don't give this file to an AI.", true);
  else noteDownload(`Saved ${a.download}. Hidden text removed; a rescan of the copy says: ${c.after.replace("_", " ")}.`);
});

function noteDownload(text, warn) {
  const n = $("download-note");
  n.textContent = text;
  n.classList.toggle("warn", !!warn);
  n.hidden = false;
  say(text);
}
