// A journal page you can write on anywhere, like paper.
// The flowing entry (the Tiptap editor) sits on the ruled lines; on top of it this module adds what a real
// journal has: words written anywhere on the page, pen and highlighter ink, an eraser, sticky notes, washi tape,
// stickers and taped-in photos. Everything you place can be moved, resized, turned and recoloured.
//
// It's saved at the end of the note as one block the server knows how to clean:
//   <div class="jpage" data-paper="lined" data-f="serif" data-pages="1">
//     <div class="jbox" data-x="120" data-y="352" data-w="260" data-r="-2" data-c="blue" data-f="hand" data-s="m"><p>…</p></div>
//     <div class="jsticky" …><p>…</p></div>  <div class="jtape" …></div>  <div class="jsticker" …>⭐</div>
//     <div class="jphoto" …><img src="data:image/jpeg…"></div>   <div class="jink" data-w="880" data-h="1152"><img src="data:image/png…"></div>
//   </div>
// The page is the app's own dark surface, full width. Positions are CSS pixels from the page's top-left; on a
// narrower window anything past the edge is drawn just inside it (its saved place is kept), and ink is never cropped away.
"use strict";

export const PAGE_H = 1152, LINE = 32;   // the page grows in steps of PAGE_H ("more room")
const INK_SHARP = 2;              // ink is kept at twice the page size so it stays sharp on a Retina screen (less on a huge page, to save memory)
const INK_AREA = 48e6, INK_SIDE = 32000;
const WORLD_MAX_W = 12000;         // the page is open: it grows to the right and down as you move around or place things
const TEXT_DEFAULT_KEY = "notes-text-default", ENTRY_FONT_KEY = "notes-entry-font";
const CONTAINERS = ["jshape", "jsticky", "jphoto"]; // things that carry whatever sits fully on top of them
const KINDS = ["jbox", "jsticky", "jtape", "jsticker", "jphoto", "jshape", "jfile"];
const MAX_FILE = 15 * 1024 * 1024, MAX_IMAGE = 15 * 1024 * 1024;
// Shapes you draw by dragging, Canva-style. data-s = kind, data-f = style + weight (e.g. "dash2"), data-c = colour.
const SHAPES = [["line", "Line", "L"], ["arrow", "Arrow", "A"], ["arrow2", "Double arrow", ""], ["rect", "Box", "R"], ["round", "Rounded box", ""], ["ellipse", "Circle", "O"], ["triangle", "Triangle", ""], ["star", "Star", ""]];
const LINE_SHAPES = ["line", "arrow", "arrow2"];
const SHAPE_STYLES = [["solid", "Solid"], ["dash", "Dashed"], ["dot", "Dotted"], ["fill", "Filled"]];
const WEIGHTS = [["1", "Thin"], ["2", "Medium"], ["3", "Thick"]];
const WEIGHT_PX = { 1: 1.6, 2: 2.6, 3: 4.4 };
const HIT = 24; // a line's grab band, so a thin line is still easy to pick up
const PAPERS = [["lined", "Ruled"], ["dots", "Dotted"], ["grid", "Grid"], ["blank", "Blank"]];
const PAGE_FONTS = [["serif", "Serif"], ["hand", "Handwriting"], ["sans", "Sans"], ["type", "Typewriter"]];
const BOX_FONTS = [["hand", "Hand"], ["serif", "Serif"], ["sans", "Sans"], ["type", "Type"]];
const SIZES = [["s", "S"], ["m", "M"], ["l", "L"], ["xl", "XL"]];
const INKS = { chalk: "#ece9e0", sage: "#b9d39a", blue: "#8fb6ff", red: "#ff9a8f", gold: "#f0cf7a", purple: "#c9a8ff", pencil: "#8f978e" }; // light inks that read on the dark page
// Background fills for a text box: muted tones that keep light text readable, plus one light "paper" tone.
const FILLS = { panel: "#262f2b", sage: "#344430", blue: "#2c3d58", red: "#552d2b", gold: "#54461f", purple: "#3f3256", paper: "#efe8d6" };
const MARKERS = { yellow: "#ffe14d", pink: "#ff8fb8", green: "#8ee08a", blue: "#83c8ff", orange: "#ffb35c" };
const STICKIES = { yellow: "#fff1a1", pink: "#ffd3de", blue: "#d2e9ff", green: "#d7f3c9", orange: "#ffdcb3", lilac: "#e5d9ff" };
const TAPES = { mint: "Mint", pink: "Pink", kraft: "Kraft", blue: "Blue", stripe: "Stripes", dots: "Dots" };
const STICKERS = ["⭐", "❤️", "✅", "📌", "💡", "📚", "✏️", "🎯", "🔥", "✨", "🌿", "🌸", "☀️", "🌙", "☕", "⚡", "🧠", "📝", "🏆", "⏰", "❗", "❓", "👍", "🎉"];
const PEN_SIZES = [["fine", 1.6], ["medium", 2.6], ["bold", 4.2]];
const SVG = {
  write: "M5 4h4M7 4v16M5 20h4M13 8h6M13 12h6M13 16h4",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  pen: "M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4zM14 7l3 3",
  marker: "M9 15l-3 3h6M14 4l6 6-8 8-6-6zM4 21h16",
  eraser: "M8 20h12M5.5 14.5l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H8.5z",
  sticky: "M5 4h14v10l-5 6H5zM14 20v-6h5",
  tape: "M3 9l2-1.5L7 9l2-1.5L11 9l2-1.5L15 9l2-1.5L19 9l2-1.5V15l-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5L5 15l-2 1.5z",
  sticker: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
  photo: "M4 6h16v13H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01",
  file: "M16 7l-7.5 7.5a2 2 0 0 0 3 3L19 10a4 4 0 0 0-6-6l-7.5 7.5a6 6 0 0 0 8.5 8.5L20 14",
  open: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  page: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  x: "M6 6l12 12M18 6L6 18", rot: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  shape: "M3 21L10.5 13M4 4h7v7H4zM17.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13", home: "M4 11l8-7 8 7v9h-5v-6H9v6H4z", hand: "M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.2-5.5-3.5L3.8 13a1.5 1.5 0 0 1 2.4-1.8L8 13",
  dup: "M8 8h12v12H8zM16 8V4H4v12h4", front: "M8 8h12v12H8zM4 4h10v3M4 4v10h3", back: "M4 4h12v12H4zM20 8v12H8",
};

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") { for (const [prop, val] of Object.entries(v)) if (prop.startsWith("--")) { if (val) node.style.setProperty(prop, val); } else node.style[prop] = val; }
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return node;
}
function icon(name, size = 18) {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", size); svg.setAttribute("height", size); svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.7"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS(ns, "path"); p.setAttribute("d", SVG[name]); svg.append(p);
  return svg;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// ---------- colours: a preset name, or "h" + 6 hex digits for one you picked yourself ----------
export function parseColor(input) { // "#abc", "#aabbcc", "aabbcc", "rgb(1, 2, 3)" or "1,2,3" → "#aabbcc"
  const t = String(input || "").trim().toLowerCase();
  let m = /^#?([0-9a-f]{3})$/.exec(t); if (m) return "#" + m[1].split("").map((c) => c + c).join("");
  m = /^#?([0-9a-f]{6})$/.exec(t); if (m) return "#" + m[1];
  m = /^(?:rgba?\()?\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)?$/.exec(t);
  if (m && [m[1], m[2], m[3]].every((v) => Number(v) <= 255)) return "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  return null;
}
const isCustom = (key) => /^h[0-9a-f]{6}$/.test(key || "");
export const colorOf = (key, map, fallback) => (isCustom(key) ? `#${key.slice(1)}` : (map && map[key]) || fallback);
export const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
const RECENT_KEY = "notes-recent-colors";
function recentColors() { try { return (JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") || []).filter((c) => /^#[0-9a-f]{6}$/.test(c)).slice(0, 8); } catch (e) { return []; } }
function rememberColor(hex) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([hex, ...recentColors().filter((c) => c !== hex)].slice(0, 8))); } catch (e) { /* only for this visit */ } }
// One colour picker for everything: presets, your recent colours, the system colour wheel, and a hex / rgb box.
let colorPop = null;
export function closeColorPicker() { if (colorPop) { colorPop.el.remove(); document.removeEventListener("pointerdown", colorPop.away, true); colorPop = null; } }
export function openColorPicker(anchor, { title = "Colour", presets = {}, value = "", none = null, onPick }) {
  if (colorPop && colorPop.anchor === anchor) return closeColorPicker();
  closeColorPicker();
  const current = parseColor(value) || "";
  const pick = (hex, isPreset) => { if (hex && !isPreset) rememberColor(hex); closeColorPicker(); onPick(hex); };
  const dot = (hex, label, preset) => el("button", { type: "button", class: `jdot ${current && current === hex ? "on" : ""}`, title: label, "aria-label": label, style: { "--c": hex }, onclick: () => pick(hex, preset) });
  const wheel = el("input", { type: "color", class: "jwheel", value: current || "#a8c287", "aria-label": "Colour wheel", oninput: () => { field.value = wheel.value; preview.style.background = wheel.value; } , onchange: () => pick(wheel.value) });
  const preview = el("span", { class: "jprev", style: { background: current || "transparent" } });
  const err = el("small", { class: "jerr", role: "alert" });
  const field = el("input", { type: "text", class: "jhex", value: current, placeholder: "#hex or rgb(…)", "aria-label": "Hex or RGB colour", spellcheck: "false",
    oninput: () => { const c = parseColor(field.value); err.textContent = ""; if (c) { preview.style.background = c; wheel.value = c; } },
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } if (e.key === "Escape") closeColorPicker(); } });
  const apply = () => { const c = parseColor(field.value); if (!c) { err.textContent = "Type a hex like #ff8800 or rgb(255, 136, 0)"; field.focus(); return; } pick(c); };
  const recent = recentColors();
  const box = el("div", { class: "jpop jcolor", role: "dialog", "aria-label": title },
    el("b", {}, title),
    el("div", { class: "jsw" }, none ? el("button", { type: "button", class: `jdot jnone ${!current ? "on" : ""}`, title: none, "aria-label": none, onclick: () => pick(null, true) }) : null, Object.entries(presets).map(([k, hex]) => dot(hex, k, true))),
    recent.length ? [el("b", {}, "Recent"), el("div", { class: "jsw" }, recent.map((hex) => dot(hex, hex, true)))] : null,
    el("b", {}, "Your own colour"),
    el("div", { class: "jcustom" }, el("label", { class: "jwheel-wrap", title: "Open the colour wheel" }, wheel), preview, field, el("button", { type: "button", class: "jchip on", onclick: apply }, "Use")),
    err);
  document.body.append(box);
  const r = anchor.getBoundingClientRect();
  box.style.left = `${clamp(r.left, 8, innerWidth - box.offsetWidth - 8)}px`;
  box.style.top = `${r.bottom + 8 + box.offsetHeight < innerHeight ? r.bottom + 8 : Math.max(8, r.top - box.offsetHeight - 8)}px`;
  const away = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) closeColorPicker(); };
  setTimeout(() => document.addEventListener("pointerdown", away, true));
  colorPop = { el: box, anchor, away };
  return box;
}
const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// Pull the journal block out of a note so the flowing editor only gets the entry text.
export function splitJournal(html) {
  if (!html || !html.includes("jpage")) return { flow: html || "", layer: "" };
  const box = document.createElement("template");
  box.innerHTML = html;
  const page = box.content.querySelector("div.jpage");
  if (!page) return { flow: html, layer: "" };
  // a terminal edit can leave the block wrapped in a paragraph, which the browser splits into empty ones around it
  const emptyP = (n) => n && n.nodeName === "P" && !n.textContent.trim() && !n.querySelector("img,hr");
  for (const n of [page.previousSibling, page.nextSibling]) if (emptyP(n)) n.remove();
  page.remove();
  const wrap = document.createElement("div"); wrap.append(box.content.cloneNode(true));
  return { flow: wrap.innerHTML, layer: page.outerHTML };
}

// Text that the page holds outside the flowing entry, for search previews and Markdown export.
export function journalText(layerHTML) {
  if (!layerHTML) return [];
  const t = document.createElement("template"); t.innerHTML = layerHTML;
  return [...t.content.querySelectorAll(".jbox, .jsticky")].map((b) => b.innerText || b.textContent).map((s) => s.trim()).filter(Boolean);
}

const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v); return n; }
function shapeStyle(f) { const m = /^(solid|dash|dot|fill)([123])$/.exec(f || ""); return { style: m ? m[1] : "solid", weight: m ? m[2] : "2" }; }
// Draws a shape into an SVG the size of its box. Lines run along the middle of a HIT-tall band and are turned by the box's rotation.
function shapeSVG(kind, w, h, f, color) {
  const { style, weight } = shapeStyle(f), sw = WEIGHT_PX[weight];
  const svg = svgEl("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: "jshape-svg", "aria-hidden": "true" });
  const dash = style === "dash" ? `${sw * 3.2} ${sw * 2.4}` : style === "dot" ? `0.1 ${sw * 2.4}` : null;
  const common = { stroke: color, "stroke-width": sw, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": dash, fill: "none", "vector-effect": "non-scaling-stroke" };
  const i = sw / 2 + 0.5;
  let d;
  if (LINE_SHAPES.includes(kind)) {
    const y = h / 2, head = Math.min(6 + sw * 3, w / 3), a = kind !== "line" ? head * 0.55 : 0;
    const x1 = kind === "arrow2" ? i + a : i, x2 = kind === "line" ? w - i : w - i - a;
    svg.append(svgEl("path", { d: `M${i} ${y}H${w - i}`, class: "hit", stroke: "transparent", "stroke-width": HIT, fill: "none" }));
    svg.append(svgEl("path", { ...common, d: `M${x1} ${y}H${x2}` }));
    const arrow = (tip, dir) => svg.append(svgEl("path", { ...common, "stroke-dasharray": null, fill: color, d: `M${tip} ${y}L${tip - dir * head} ${y - head * 0.5}L${tip - dir * head} ${y + head * 0.5}Z` }));
    if (kind !== "line") arrow(w - i, 1);
    if (kind === "arrow2") arrow(i, -1);
    return svg;
  }
  if (kind === "rect" || kind === "round") d = { tag: "rect", x: i, y: i, width: Math.max(1, w - 2 * i), height: Math.max(1, h - 2 * i), rx: kind === "round" ? Math.min(18, w / 4, h / 4) : 2 };
  else if (kind === "ellipse") d = { tag: "ellipse", cx: w / 2, cy: h / 2, rx: Math.max(1, w / 2 - i), ry: Math.max(1, h / 2 - i) };
  else if (kind === "triangle") d = { tag: "path", d: `M${w / 2} ${i}L${w - i} ${h - i}L${i} ${h - i}Z` };
  else { // star
    const pts = []; for (let k = 0; k < 10; k += 1) { const ang = -Math.PI / 2 + (k * Math.PI) / 5, rad = k % 2 ? 0.42 : 1; pts.push(`${w / 2 + Math.cos(ang) * (w / 2 - i) * rad} ${h / 2 + Math.sin(ang) * (h / 2 - i) * rad}`); }
    d = { tag: "path", d: `M${pts.join("L")}Z` };
  }
  const { tag, ...attrs } = d;
  const fill = style === "fill";
  svg.append(svgEl(tag, { ...attrs, class: "hit", stroke: "transparent", "stroke-width": HIT, fill: fill ? "transparent" : "none" }));
  svg.append(svgEl(tag, { ...attrs, ...common, "stroke-dasharray": fill ? null : dash, fill: fill ? color : "none", "fill-opacity": fill ? 0.22 : null }));
  return svg;
}
// Where a line's two ends are, from its box (x, y, w, rotation about the centre).
function lineEnds(x, y, w, r) { const c = { x: x + w / 2, y: y + HIT / 2 }, a = (r * Math.PI) / 180, dx = Math.cos(a) * w / 2, dy = Math.sin(a) * w / 2; return [{ x: c.x - dx, y: c.y - dy }, { x: c.x + dx, y: c.y + dy }]; }
function lineBox(A, B, snap) {
  let dx = B.x - A.x, dy = B.y - A.y;
  if (snap) { const len = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12); dx = Math.cos(ang) * len; dy = Math.sin(ang) * len; }
  const len = Math.max(Math.hypot(dx, dy), 12), r = Math.round((Math.atan2(dy, dx) * 1800) / Math.PI) / 10;
  const cx = A.x + dx / 2, cy = A.y + dy / 2;
  return { x: Math.round(cx - len / 2), y: Math.round(cy - HIT / 2), w: Math.round(len), h: HIT, r };
}

// A file card: what kind of file it is, at a glance
function fileKind(name, href) {
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(name || "") || [])[1]?.toLowerCase() || "", type = (/^data:([^;,]+)/.exec(href || "") || [])[1] || "";
  if (ext === "pdf" || type === "application/pdf") return ["PDF", "#e0706a"];
  if (["doc", "docx", "odt", "rtf", "pages"].includes(ext)) return ["DOC", "#6f9be8"];
  if (["xls", "xlsx", "csv", "ods", "numbers"].includes(ext)) return ["XLS", "#6cc28c"];
  if (["ppt", "pptx", "key", "odp"].includes(ext)) return ["PPT", "#e8a05c"];
  if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return ["ZIP", "#b49ad8"];
  if (type.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg", "flac"].includes(ext)) return ["AUDIO", "#d886b8"];
  if (type.startsWith("video/") || ["mp4", "mov", "webm", "mkv"].includes(ext)) return ["VIDEO", "#d8c26c"];
  if (type.startsWith("image/")) return ["IMG", "#7fc8c0"];
  if (type.startsWith("text/") || ["txt", "md"].includes(ext)) return ["TXT", "#a6aa9d"];
  return [(ext || "FILE").toUpperCase().slice(0, 5), "#a6aa9d"];
}
function fileSize(href) { const i = (href || "").indexOf(","), n = i < 0 ? 0 : Math.floor(((href.length - i - 1) * 3) / 4); return n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`; }

const newId = () => Math.random().toString(36).slice(2, 10);
const isLineNode = (n) => n.classList.contains("jshape") && LINE_SHAPES.includes(n.dataset.s);
function store(key, value) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* kept for this visit only */ } }
function stored(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
// What new text looks like: your default font, size and colour, until you change it
export function textDefault() {
  const v = stored(TEXT_DEFAULT_KEY) || {};
  return { f: pick(v.f, BOX_FONTS.map((x) => x[0]), "hand"), s: pick(v.s, SIZES.map((x) => x[0]), "m"), c: typeof v.c === "string" && (INKS[v.c] || isCustom(v.c)) ? v.c : "" };
}
export function mountJournal({ paper, layerHTML, editable, onChange, editorEl, toast = () => {}, openFile = () => {} }) {
  const src = document.createElement("template"); src.innerHTML = layerHTML || "";
  const saved = src.content.querySelector("div.jpage");
  const settings = {
    paper: pick(saved && saved.dataset.paper, PAPERS.map((p) => p[0]), "lined"),
    font: pick(saved && saved.dataset.f, PAGE_FONTS.map((p) => p[0]), pick(stored(ENTRY_FONT_KEY), PAGE_FONTS.map((p) => p[0]), "serif")),
    pages: clamp(Math.round(num(saved && saved.dataset.pages, 1)), 1, 60),
  };
  let shapePick = { s: "rect", c: "chalk", style: "solid", weight: "2" }, shaping = null;
  let tool = "write", pen = { color: "chalk", size: "medium" }, marker = "yellow", tape = "mint", stickerPick = "⭐", stickyColor = "yellow";
  const chosen = new Set(); // everything selected; `selected` is the one you touched last (its style bar shows)
  let roomW = 0, roomH = 0, inkScale = INK_SHARP, inkNeedW = 0, inkReach = { r: 0, b: 0 }, spaceDown = false, pan = null;
  let selected = null, popover = null, inkW = 0, inkHas = false, inkDirty = false, inkURL = "", undoStack = [], redoStack = [];
  const cleanup = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanup.push(() => target.removeEventListener(type, fn, opts)); };

  // ---------- the paper ----------
  paper.classList.add("jpaper");
  const layer = el("div", { class: "jlayer" });
  const canvas = el("canvas", { class: "jink-canvas", "aria-label": "Pen ink on this page" });
  const live = el("canvas", { class: "jink-live", "aria-hidden": "true" });
  const ctx = canvas.getContext("2d"), lctx = live.getContext("2d");
  const addPage = editable ? el("button", { type: "button", class: "jaddpage", title: "Make the page longer", onclick: () => { snapshot(); settings.pages += 1; layout(); changed(); } }, "+ More room") : null;
  paper.append(layer, canvas, live);
  if (addPage) paper.after(addPage);
  const styleBar = el("div", { class: "jstyle", hidden: true });
  layer.append(styleBar);

  // Ruled / Dotted / Grid / Blank, always one click away in the note's top bar (and kept in sync with the page menu)
  const pageSwitch = el("div", { class: "jpaperswitch", role: "radiogroup", "aria-label": "Page design" });
  function paintPageSwitch() {
    pageSwitch.replaceChildren(...PAPERS.map(([k, label]) => el("button", { type: "button", role: "radio", class: `jps ${settings.paper === k ? "on" : ""}`, "aria-checked": String(settings.paper === k), title: `${label} page`, disabled: editable ? null : true,
      onclick: () => { if (settings.paper === k) return; snapshot(); settings.paper = k; applySettings(); changed(); } }, el("span", { class: `jps-icon jps-${k}`, "aria-hidden": "true" }), el("span", { class: "jps-label" }, label))));
  }
  function applySettings() {
    if (typeof paintPageSwitch === "function") queueMicrotask(paintPageSwitch);
    for (const c of [...paper.classList]) if (/^(paper|pfont)-/.test(c)) paper.classList.remove(c);
    paper.classList.add(`paper-${settings.paper}`, `pfont-${settings.font}`);
  }
  applySettings();

  // the page grows a sheet at a time, and never shorter than what's written or placed on it
  function neededPages() {
    let bottom = inkReach.b;
    const top = paper.getBoundingClientRect().top;
    if (editorEl) bottom = Math.max(bottom, editorEl.getBoundingClientRect().bottom - top);
    for (const o of objects()) bottom = Math.max(bottom, num(o.dataset.y, 0) + o.offsetHeight);
    return Math.max(1, Math.ceil((bottom + LINE * 2) / PAGE_H));
  }
  const scroller = () => paper.closest(".doc");
  function naturalW() { // how wide the page is on screen before it grows sideways
    const host = scroller() || paper.parentElement; if (!host) return 800;
    const cs = getComputedStyle(host);
    return Math.max(320, host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  }
  let laying = false;
  function layout() {
    if (laying) return; laying = true;
    try {
      const need = neededPages();
      if (need > settings.pages) { settings.pages = need; if (editable) changed(); }
      for (const o of objects()) place(o);
      // open world: always room to keep going right, and more appears as you scroll or drag past the edge
      const nat = naturalW();
      let right = inkReach.r;
      for (const o of objects()) right = Math.max(right, o.offsetLeft + o.offsetWidth);
      const worldW = Math.round(Math.min(WORLD_MAX_W, Math.max(nat + roomW, right > nat - 40 ? right + nat * 0.6 : nat)));
      if (paper.style.width !== `${worldW}px`) paper.style.width = `${worldW}px`;
      const cs = getComputedStyle(paper);
      paper.style.setProperty("--entry-w", `${Math.max(240, nat - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))}px`);
      const height = settings.pages * PAGE_H + roomH;
      paper.style.minHeight = `${height}px`;
      const inkWant = Math.min(worldW, Math.max(nat, inkNeedW, inkReach.r + 40));
      if (Math.round(canvas.height / inkScale) !== height || Math.round(canvas.width / inkScale) < inkWant) resizeInk(inkWant, height);
      // ruled lines start where the entry starts, so its text and words placed on the page share the same lines
      if (editorEl) paper.style.setProperty("--lines-top", `${linesTop()}px`);
      updateLinks();
      if (selected) paintStyleBar();
    } finally { laying = false; }
  }
  function linesTop() { return editorEl ? Math.round(editorEl.getBoundingClientRect().top - paper.getBoundingClientRect().top) : 0; }
  function resizeInk(width, height) { // the ink only ever grows sideways, so a narrower window never crops a drawing
    width = Math.ceil(Math.max(width, canvas.width / inkScale || 0)); inkW = width;
    const was = inkScale;
    inkScale = Math.min(INK_SHARP, Math.sqrt(INK_AREA / (width * height)), INK_SIDE / width, INK_SIDE / height);
    const old = canvas.width ? (() => { const c = document.createElement("canvas"); c.width = canvas.width; c.height = canvas.height; c.getContext("2d").drawImage(canvas, 0, 0); return c; })() : null;
    for (const c of [canvas, live]) { c.width = Math.round(width * inkScale); c.height = Math.round(height * inkScale); c.style.width = `${width}px`; c.style.height = `${height}px`; }
    if (old) ctx.drawImage(old, 0, 0, old.width * (inkScale / was), old.height * (inkScale / was));
  }
  function pointOf(e) { const r = paper.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  const pageW = () => paper.clientWidth || 800;

  // ---------- placed things ----------
  const objects = () => [...layer.querySelectorAll(":scope > .jobj")];
  function readObj(node) {
    const kind = KINDS.find((k) => node.classList.contains(k));
    const d = node.dataset;
    return { kind, x: num(d.x, 100), y: num(d.y, 200), w: num(d.w, 0), h: num(d.h, 0), r: num(d.r, 0), c: d.c || "", f: d.f || "", s: d.s || "", b: d.b || "", id: d.id || "", ea: d.ea || "", eb: d.eb || "", html: node.innerHTML, src: (node.querySelector("img") || {}).src || "", text: node.textContent,
      href: (node.querySelector("a[download]") || { getAttribute: () => "" }).getAttribute("href") || "", name: (node.querySelector("a[download]") || { getAttribute: () => "" }).getAttribute("download") || "" };
  }
  function makeObj(o) {
    const node = el("div", { class: `jobj ${o.kind}`, tabindex: "-1" });
    const body = el("div", { class: "jbody" });
    if (o.kind === "jbox" || o.kind === "jsticky") {
      body.innerHTML = o.html || "<p><br></p>";
      if (editable) { body.contentEditable = "true"; body.spellcheck = true; body.setAttribute("role", "textbox"); body.setAttribute("aria-multiline", "true"); body.setAttribute("aria-label", o.kind === "jbox" ? "Words on the page" : "Sticky note"); }
    } else if (o.kind === "jsticker") body.textContent = (o.text || "⭐").trim().slice(0, 8);
    else if (o.kind === "jphoto") { if (!o.src) return null; body.append(el("img", { src: o.src, alt: "", draggable: "false" })); }
    if (o.kind === "jshape" && !SHAPES.some((x) => x[0] === o.s)) return null;
    if (o.kind === "jfile") {
      if (!/^data:/.test(o.href)) return null;
      const [label, tint] = fileKind(o.name, o.href);
      body.append(el("a", { href: o.href, download: o.name || "file", class: "jfile-link", hidden: true }),
        el("span", { class: "jfile-badge", style: { "--t": tint } }, label),
        el("span", { class: "jfile-text" }, el("b", { title: o.name }, o.name || "Attachment"), el("small", {}, fileSize(o.href))),
        el("button", { type: "button", class: "jfile-open", title: label === "PDF" ? "Open" : "Download", "aria-label": `Open ${o.name || "attachment"}` }, icon("open", 15)));
    }
    node.append(body);
    if (editable && o.kind === "jshape" && LINE_SHAPES.includes(o.s)) node.append(el("span", { class: "jend", "data-end": "a", title: "Drag this end" }), el("span", { class: "jend", "data-end": "b", title: "Drag this end" }));
    if (editable) node.append(
      el("span", { class: "jgrip", title: "Drag to move", "aria-hidden": "true" }, "⠿"),
      el("button", { type: "button", class: "jdel", title: "Remove", "aria-label": "Remove" }, icon("x", 12)),
      el("span", { class: "jrot", title: "Drag to turn", "aria-hidden": "true" }, icon("rot", 12)),
      el("span", { class: "jsize", title: "Drag to resize", "aria-hidden": "true" }),
      ...(o.kind === "jbox" || o.kind === "jsticky" || o.kind === "jphoto" || o.kind === "jfile" ? [el("span", { class: "jside", "data-side": "l", title: "Drag to make it wider or narrower", "aria-hidden": "true" }), el("span", { class: "jside", "data-side": "r", title: "Drag to make it wider or narrower", "aria-hidden": "true" })] : []));
    Object.assign(node.dataset, { x: Math.round(o.x), y: Math.round(o.y), r: Math.round(num(o.r, 0) * 10) / 10 });
    if (o.w) node.dataset.w = Math.round(o.w);
    if (o.h) node.dataset.h = Math.round(o.h);
    if (o.c) node.dataset.c = o.c; if (o.f) node.dataset.f = o.f; if (o.s) node.dataset.s = o.s; if (o.b) node.dataset.b = o.b;
    for (const k of ["id", "ea", "eb"]) if (o[k] && /^[a-z0-9]{1,16}$/.test(o[k])) node.dataset[k] = o[k];
    place(node);
    return node;
  }
  function place(node) {
    const d = node.dataset, kind = KINDS.find((k) => node.classList.contains(k));
    node.style.left = `${Math.max(0, num(d.x, 0))}px`; node.style.top = `${num(d.y, 0)}px`; // the page is open: things stay where you put them
    node.style.transform = num(d.r, 0) ? `rotate(${num(d.r, 0)}deg)` : "";
    node.style.width = d.w ? `${d.w}px` : "";
    node.style.height = (kind === "jsticky" || kind === "jtape" || kind === "jshape") && d.h ? `${d.h}px` : "";
    if (kind === "jsticker") node.style.fontSize = `${num(d.w, 48)}px`;
    if (kind === "jbox") {
      const body = node.querySelector(".jbody");
      body.style.color = isCustom(d.c) ? `#${d.c.slice(1)}` : "";
      const fill = d.b ? colorOf(d.b, FILLS, "") : "";
      body.style.background = fill; node.classList.toggle("filled", !!fill);
      if (fill) { const n = parseInt(fill.slice(1), 16), light = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150; node.classList.toggle("on-light", light); } else node.classList.remove("on-light");
      body.style.minHeight = d.h ? `${d.h}px` : "";
    }
    if (kind === "jsticky") { if (isCustom(d.c)) node.style.setProperty("--sc", `#${d.c.slice(1)}`); else node.style.removeProperty("--sc"); }
    if (kind === "jshape") {
      const isLine = LINE_SHAPES.includes(d.s);
      if (isLine) { d.h = HIT; node.style.height = `${HIT}px`; }
      node.classList.toggle("line", isLine); node.classList.toggle("filled", shapeStyle(d.f).style === "fill");
      node.querySelector(".jbody").replaceChildren(shapeSVG(d.s, Math.max(1, num(d.w, 120)), Math.max(1, num(d.h, 80)), d.f, colorOf(d.c, INKS, INKS.chalk)));
    }
    if (node === selected && !laying) paintStyleBar();
  }
  function add(o, { focus = false, select = true } = {}) {
    const node = makeObj(o); if (!node) return null;
    layer.insertBefore(node, styleBar);
    if (select) selectObj(node);
    if (focus) { const b = node.querySelector("[contenteditable=true]"); if (b) { b.focus(); const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
    layout();
    return node;
  }
  for (const node of saved ? saved.children : []) {
    const kind = KINDS.find((k) => node.classList.contains(k));
    if (kind) { const made = makeObj(readObj(node)); if (made) layer.insertBefore(made, styleBar); }
  }

  // ---------- ink ----------
  const savedInk = saved && saved.querySelector(":scope > .jink img");
  const savedInkW = saved && saved.querySelector(":scope > .jink") ? num(saved.querySelector(":scope > .jink").dataset.w, 0) : 0;
  inkNeedW = savedInkW; inkReach.r = savedInkW ? Math.min(savedInkW, 1200) : 0;
  resizeInk(Math.max(savedInkW, 800), settings.pages * PAGE_H);
  if (savedInk) {
    const img = new Image();
    img.onload = () => { const s = savedInkW ? (savedInkW * inkScale) / img.naturalWidth : inkScale / INK_SHARP; ctx.drawImage(img, 0, 0, img.naturalWidth * s, img.naturalHeight * s); inkHas = true; inkURL = savedInk.getAttribute("src"); };
    img.src = savedInk.getAttribute("src");
    inkURL = savedInk.getAttribute("src"); inkHas = true;
  }
  let stroke = null;
  function inkDown(e) {
    if (!editable || !["pen", "marker", "eraser"].includes(tool) || e.button > 0) return;
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    snapshot();
    const p = pointOf(e);
    const width = tool === "pen" ? PEN_SIZES.find((s) => s[0] === pen.size)[1] : tool === "marker" ? 16 : 24;
    stroke = { tool, pts: [p], width, color: tool === "pen" ? colorOf(pen.color, INKS, INKS.chalk) : colorOf(marker, MARKERS, MARKERS.yellow) };
    const c = tool === "eraser" ? ctx : lctx;
    c.save(); c.scale(inkScale, inkScale); c.lineCap = "round"; c.lineJoin = "round"; c.lineWidth = width;
    if (tool === "eraser") c.globalCompositeOperation = "destination-out";
    c.strokeStyle = tool === "eraser" ? "#000" : stroke.color; c.fillStyle = c.strokeStyle;
    if (tool === "marker") { c.lineCap = "square"; live.style.opacity = ".38"; } else live.style.opacity = "1";
    c.beginPath(); c.arc(p.x, p.y, width / 2, 0, Math.PI * 2); c.fill(); c.beginPath(); c.moveTo(p.x, p.y);
    stroke.ctx = c;
  }
  function inkMove(e) {
    if (!stroke) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const p = pointOf(ev), last = stroke.pts[stroke.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.8) continue;
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      stroke.ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y); stroke.ctx.stroke(); stroke.ctx.beginPath(); stroke.ctx.moveTo(mid.x, mid.y);
      stroke.pts.push(p);
      if (stroke.tool !== "eraser") { inkReach.r = Math.max(inkReach.r, p.x + stroke.width); inkReach.b = Math.max(inkReach.b, p.y + stroke.width); }
    }
  }
  function inkUp() {
    if (!stroke) return;
    const last = stroke.pts[stroke.pts.length - 1]; stroke.ctx.lineTo(last.x, last.y); stroke.ctx.stroke(); stroke.ctx.restore();
    if (stroke.tool !== "eraser") { // the live layer is copied down so a highlighter stroke never darkens where it crosses itself
      ctx.save(); ctx.globalAlpha = stroke.tool === "marker" ? 0.38 : 1; ctx.drawImage(live, 0, 0); ctx.restore();
      lctx.clearRect(0, 0, live.width, live.height); inkHas = true;
    }
    stroke = null; inkDirty = true; changed();
  }
  listen(canvas, "pointerdown", inkDown); listen(canvas, "pointermove", inkMove);
  listen(canvas, "pointerup", inkUp); listen(canvas, "pointercancel", inkUp);
  function inkBlank() {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 16) if (data[i]) return false;
    return true;
  }
  function currentInk() {
    if (inkDirty) { inkDirty = false; inkHas = !inkBlank(); inkURL = inkHas ? canvas.toDataURL("image/png") : ""; }
    return inkHas ? inkURL : "";
  }

  // ---------- undo ----------
  function objectsHTML() { return objects().map(serializeObj).join(""); }
  const state = () => ({ objs: objectsHTML(), ink: currentInk(), inkCss: canvas.width / inkScale, settings: { ...settings } });
  function snapshot() { undoStack.push(state()); if (undoStack.length > 40) undoStack.shift(); redoStack = []; paintTray(); }
  function restore(state) {
    selectObj(null);
    for (const o of objects()) o.remove();
    const t = document.createElement("template"); t.innerHTML = state.objs;
    for (const node of t.content.children) { const made = makeObj(readObj(node)); if (made) layer.insertBefore(made, styleBar); }
    Object.assign(settings, state.settings); applySettings();
    ctx.clearRect(0, 0, canvas.width, canvas.height); inkURL = state.ink; inkHas = !!state.ink; inkDirty = false;
    layout();
    if (state.ink) { const img = new Image(); img.onload = () => { const s = (state.inkCss * inkScale) / img.naturalWidth; ctx.drawImage(img, 0, 0, img.naturalWidth * s, img.naturalHeight * s); }; img.src = state.ink; }
    changed(); paintTray();
  }
  function undo() { if (!undoStack.length) return toast("Nothing to undo on the page"); redoStack.push(state()); restore(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(state()); restore(redoStack.pop()); }

  // ---------- selecting, moving, resizing, turning ----------
  const picked = () => [...chosen].filter((n) => n.isConnected);
  function paintSel() {
    for (const o of objects()) o.classList.toggle("sel", chosen.has(o));
    paper.classList.toggle("multi", chosen.size > 1);
    paintStyleBar();
  }
  function selectObj(node) { // just this one, or nothing
    if (selected === node && chosen.size === (node ? 1 : 0)) return;
    chosen.clear(); if (node) chosen.add(node); selected = node; paintSel();
  }
  function toggleSel(node) { // Shift-click: add it, or take it back out
    if (chosen.has(node)) { chosen.delete(node); if (selected === node) selected = picked().pop() || null; } else { chosen.add(node); selected = node; }
    paintSel();
  }
  function setSel(nodes, keep = false) { if (!keep) chosen.clear(); for (const n of nodes) chosen.add(n); selected = picked().pop() || null; paintSel(); }
  function forget(node) { chosen.delete(node); if (selected === node) selected = picked().pop() || null; }
  function removeNodes(nodes) {
    if (!nodes.length) return;
    snapshot(); for (const n of nodes) { forget(n); n.remove(); }
    paintSel(); layout(); changed();
  }

  // ---------- what sits on what, and what's joined to what (Figma-style) ----------
  // A shape, sticky note or photo carries everything lying fully on top of it. A line whose end you drop on something
  // stays joined to it: move the thing and the line follows, meeting its edge.
  function rectOf(n) {
    const d = n.dataset;
    if (isLineNode(n)) { const [A, B] = lineEnds(num(d.x, 0), num(d.y, 0), num(d.w, 100), num(d.r, 0)); return { x: Math.min(A.x, B.x), y: Math.min(A.y, B.y), w: Math.abs(A.x - B.x), h: Math.abs(A.y - B.y) }; }
    if (n.classList.contains("jbox") && !d.b) { // a text box is as big as its words (its box can be wider than what's written)
      const body = n.querySelector(".jbody"), r = document.createRange(); r.selectNodeContents(body);
      const rects = [...r.getClientRects()].filter((q) => q.width > 0.5), base = paper.getBoundingClientRect();
      if (rects.length && !num(d.r, 0)) {
        const L = Math.min(...rects.map((q) => q.left)) - base.left, R = Math.max(...rects.map((q) => q.right)) - base.left;
        return { x: Math.max(0, num(d.x, 0)), y: num(d.y, 0), w: Math.max(24, R - Math.max(0, num(d.x, 0)) + 8), h: n.offsetHeight };
      }
    }
    return { x: Math.max(0, num(d.x, 0)), y: num(d.y, 0), w: n.offsetWidth, h: n.offsetHeight };
  }
  const isContainer = (n) => CONTAINERS.some((k) => n.classList.contains(k)) && !isLineNode(n);
  const inside = (a, b) => a.x >= b.x - 2 && a.y >= b.y - 2 && a.x + a.w <= b.x + b.w + 2 && a.y + a.h <= b.y + b.h + 2;
  function contents(host, all = objects()) {
    if (!isContainer(host)) return [];
    const box = rectOf(host), at = all.indexOf(host);
    return all.filter((o, i) => i > at && inside(rectOf(o), box));
  }
  function withContents(nodes) {
    const all = objects(), out = new Set();
    const walk = (n) => { if (out.has(n)) return; out.add(n); for (const k of contents(n, all)) walk(k); };
    for (const n of nodes) walk(n);
    return all.filter((o) => out.has(o)); // in stacking order
  }
  function hostOf(nodes) { // the topmost container that would now carry these
    const all = objects(), set = new Set(nodes), r = nodes.map(rectOf).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }));
    const lowest = Math.min(...nodes.map((n) => all.indexOf(n)));
    return all.slice(0, lowest).reverse().find((o) => !set.has(o) && isContainer(o) && inside(r, rectOf(o))) || null;
  }
  function ensureId(n) { if (!n.dataset.id) n.dataset.id = newId(); return n.dataset.id; }
  function linkTargetAt(p, skip) { // what a line's end would join to here
    for (const o of objects().reverse()) {
      if (o === skip || isLineNode(o) || o.classList.contains("drawing")) continue;
      const r = rectOf(o);
      if (p.x >= r.x - 10 && p.x <= r.x + r.w + 10 && p.y >= r.y - 10 && p.y <= r.y + r.h + 10) return o;
    }
    return null;
  }
  const centreOf = (n) => { const r = rectOf(n); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
  function edgePoint(n, toward) { // where a line heading for `toward` leaves n's outline
    const r = rectOf(n), cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = toward.x - cx, dy = toward.y - cy, hw = r.w / 2 + 6, hh = r.h / 2 + 6;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { x: cx, y: cy };
    const round = n.classList.contains("jshape") && n.dataset.s === "ellipse" || (n.classList.contains("jphoto") && n.dataset.f === "round");
    const t = round ? 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh)) : Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return { x: cx + dx * t, y: cy + dy * t };
  }
  function updateLinks() {
    const ids = new Map(); for (const o of objects()) if (o.dataset.id) ids.set(o.dataset.id, o);
    for (const ln of objects()) {
      if (!isLineNode(ln)) continue;
      const d = ln.dataset; if (!d.ea && !d.eb) continue;
      const ta = d.ea && ids.get(d.ea), tb = d.eb && ids.get(d.eb);
      if (d.ea && !ta) delete d.ea; if (d.eb && !tb) delete d.eb; // what it was joined to is gone: that end stays put
      if (!ta && !tb) continue;
      const [A0, B0] = lineEnds(num(d.x, 0), num(d.y, 0), num(d.w, 100), num(d.r, 0));
      const A = ta ? edgePoint(ta, tb ? centreOf(tb) : B0) : A0, B = tb ? edgePoint(tb, ta ? centreOf(ta) : A0) : B0;
      const box = lineBox(A, B, false);
      if (box.x !== num(d.x, 0) || box.y !== num(d.y, 0) || box.w !== num(d.w, 0) || Math.abs(box.r - num(d.r, 0)) > 0.05) { Object.assign(d, { x: box.x, y: box.y, w: box.w, r: box.r }); place(ln); }
    }
  }
  function markTarget(n) { for (const o of layer.querySelectorAll(".jlink-target, .jhost")) if (o !== n) o.classList.remove("jlink-target", "jhost"); if (n) n.classList.add("jlink-target"); }
  function changed() { onChange(); }
  let drag = null;
  function objDown(e) {
    const node = e.target.closest(".jobj"); if (!node || !editable || e.button > 0) return;
    if (e.target.closest(".jfile-open")) { e.preventDefault(); const a = node.querySelector("a[download]"); if (a) openFile(a); return; }
    if (e.target.closest(".jdel")) { e.preventDefault(); removeNodes([node]); return; }
    const kind = KINDS.find((k) => node.classList.contains(k));
    const inText = e.target.closest("[contenteditable=true]");
    let mode = e.target.closest(".jside") ? `side-${e.target.closest(".jside").dataset.side}` : e.target.closest(".jend") ? `end-${e.target.closest(".jend").dataset.end}` : e.target.closest(".jsize") ? "size" : e.target.closest(".jrot") ? "rot" : e.target.closest(".jgrip") ? "move"
      : inText && (kind === "jbox" || (kind === "jsticky" && pointOf(e).y - num(node.dataset.y, 0) > 26)) ? null : "move";
    const typingHere = inText && document.activeElement === inText;
    let narrow = false; // a click (no drag) on one of several selected things selects just that one, like Figma
    if (e.shiftKey && !typingHere && (mode === "move" || mode === null)) { // Shift-click adds or removes; Shift-drag moves them all
      e.preventDefault(); toggleSel(node);
      if (!chosen.has(node)) return;
      mode = "move";
    } else if (chosen.has(node) && chosen.size > 1 && (mode === "move" || (mode === null && !typingHere))) { narrow = true; mode = "move"; } // drag any of them to move them all
    else selectObj(node);
    if (!mode) return; // typing in a text box or a sticky note: let the caret land
    e.preventDefault();
    if (document.activeElement && node.contains(document.activeElement) && mode !== "move") document.activeElement.blur();
    const p = pointOf(e), d = node.dataset;
    if (kind === "jshape" && LINE_SHAPES.includes(d.s)) drag = { ends: lineEnds(num(d.x, 0), num(d.y, 0), num(d.w, 100), num(d.r, 0)) };
    drag = { ...(drag || {}), node, mode, kind, start: p, x: node.offsetLeft, y: num(d.y, 0), fs: num(d.w, 48), w: node.offsetWidth, h: node.offsetHeight, r: num(d.r, 0), moved: false, inText, narrow, pointerId: e.pointerId };
    if (mode === "move") drag.items = withContents(picked()).map((n) => ({ n, x: Math.max(0, num(n.dataset.x, 0)), y: num(n.dataset.y, 0) }));
    node.setPointerCapture(e.pointerId);
  }
  function objMove(e) {
    if (!drag) return;
    const p = pointOf(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y, { node, kind } = drag;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 3) return;
      drag.moved = true; snapshot(); node.classList.add("dragging");
      if (drag.mode === "move") {
        // picking things up puts them on top (in the same order); moving them in the page drops the pointer capture, so take it again
        const lifted = drag.items.map((it) => it.n);
        if (lifted.some((n, i) => n.nextElementSibling !== (lifted[i + 1] || styleBar))) { for (const n of lifted) layer.insertBefore(n, styleBar); try { node.setPointerCapture(e.pointerId); } catch (err) { /* the pointer already let go */ } }
        if (drag.items.length === 1 && isLineNode(node)) { delete node.dataset.ea; delete node.dataset.eb; } // dragging a line by its middle unhooks it
      }
    }
    const d = node.dataset;
    if (drag.mode === "move") {
      let ddx = dx, ddy = dy;
      if (kind === "jbox" && settings.paper !== "blank") { const t = linesTop(), y = drag.y + dy; ddy = t + Math.round((y - t) / (LINE / 2)) * (LINE / 2) - drag.y; } // words settle onto the lines
      ddx = Math.max(ddx, -Math.min(...drag.items.map((it) => it.x))); ddy = Math.max(ddy, -Math.min(...drag.items.map((it) => it.y)) - 10); // never off the top or left edge
      for (const it of drag.items) { it.n.dataset.x = Math.round(it.x + ddx); it.n.dataset.y = Math.round(it.y + ddy); if (it.n !== node) place(it.n); }
      const host = hostOf(picked()); for (const o of layer.querySelectorAll(".jhost")) if (o !== host) o.classList.remove("jhost"); if (host) host.classList.add("jhost");
      edgeGrow(e);
    } else if (drag.mode.startsWith("end-")) { // a line's end follows the pointer and joins whatever it's dropped on; Shift keeps it to 15° steps
      const [A, B] = drag.ends, other = drag.mode === "end-a" ? B : A;
      const target = e.altKey ? null : linkTargetAt(p, node); markTarget(target); drag.target = target;
      const end = target ? edgePoint(target, other) : p;
      const box = drag.mode === "end-a" ? lineBox(end, B, e.shiftKey && !target) : lineBox(A, end, e.shiftKey && !target);
      d.x = box.x; d.y = box.y; d.w = box.w; d.r = box.r;
    } else if (drag.mode === "side-r" || drag.mode === "side-l") { // edges change the width; the left edge moves the box too
      const a = (-drag.r * Math.PI) / 180, ldx = dx * Math.cos(a) - dy * Math.sin(a), min = kind === "jbox" ? 60 : kind === "jfile" ? 180 : kind === "jphoto" ? 48 : 80;
      if (drag.mode === "side-r") d.w = Math.round(clamp(drag.w + ldx, min, 4000));
      else { const w = clamp(drag.w - ldx, min, drag.x + drag.w); d.w = Math.round(w); d.x = Math.round(drag.x + (drag.w - w)); }
    } else if (drag.mode === "size") {
      const a = (-drag.r * Math.PI) / 180, ldx = dx * Math.cos(a) - dy * Math.sin(a), ldy = dx * Math.sin(a) + dy * Math.cos(a);
      if (kind === "jsticker") d.w = Math.round(clamp(drag.fs + (ldx + ldy) / 2, 20, 220));
      else if (kind === "jshape") { let w = clamp(drag.w + ldx, 12, 4000), h = clamp(drag.h + ldy, 12, 1600); if (e.shiftKey) w = h = Math.max(w, h); d.w = Math.round(w); d.h = Math.round(h); }
      else if (kind === "jbox") { d.w = Math.round(clamp(drag.w + ldx, 60, 4000)); d.h = Math.round(clamp(drag.h + ldy, 32, 2400)); } // corner: width and height
      else if (kind === "jphoto") { const diag = Math.abs(ldx) > Math.abs(ldy * drag.w / Math.max(1, drag.h)) ? ldx : ldy * drag.w / Math.max(1, drag.h); d.w = Math.round(clamp(drag.w + diag, 48, 4000)); } // a picture keeps its shape
      else d.w = Math.round(clamp(drag.w + ldx, kind === "jtape" ? 40 : 80, 4000));
      if (kind === "jsticky" || kind === "jtape") d.h = Math.round(clamp(drag.h + ldy, kind === "jtape" ? 16 : 80, 900));
    } else if (drag.mode === "rot") {
      const cx = drag.x + drag.w / 2, cy = drag.y + drag.h / 2;
      let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (deg > 180) deg -= 360;
      if (Math.abs(deg) < 3) deg = 0;
      d.r = Math.round(e.shiftKey ? Math.round(deg / 15) * 15 : deg);
    }
    place(node);
    updateLinks();
  }
  function objUp() {
    if (!drag) return;
    const { node, moved, inText, mode, narrow } = drag, target = drag.target; drag = null;
    node.classList.remove("dragging");
    for (const o of layer.querySelectorAll(".jhost, .jlink-target")) o.classList.remove("jhost", "jlink-target");
    if (moved && mode.startsWith("end-")) { const key = mode === "end-a" ? "ea" : "eb"; if (target) node.dataset[key] = ensureId(target); else delete node.dataset[key]; }
    if (moved) { layout(); changed(); }
    else if (narrow) { selectObj(node); if (inText) inText.focus(); }
    else if (inText) { const b = node.querySelector("[contenteditable=true]"); if (b && document.activeElement !== b) b.focus(); }
  }
  listen(layer, "dblclick", (e) => { const card = e.target.closest(".jfile"); if (card && !e.target.closest(".jdel, .jsize, .jside, .jrot")) { const a = card.querySelector("a[download]"); if (a) openFile(a); } });
  listen(layer, "pointerdown", objDown); listen(layer, "pointermove", objMove);
  listen(layer, "pointerup", objUp); listen(layer, "pointercancel", objUp);
  listen(layer, "input", (e) => { if (e.target.closest(".jobj")) { layout(); changed(); } });
  // An empty text box goes away when you click somewhere else on the page (like it was never written), but not when you
  // use its style bar, a colour picker or the formatting toolbar: those are part of writing it.
  const blankBox = (o) => o.classList.contains("jbox") && !o.querySelector(".jbody").textContent.trim() && !o.querySelector(".jbody img");
  function sweepEmpty(keep) {
    const gone = objects().filter((o) => o !== keep && blankBox(o));
    for (const o of gone) { forget(o); o.remove(); }
    if (gone.length) { paintSel(); changed(); }
  }
  listen(document, "pointerdown", (e) => {
    if (!paper.isConnected || e.target.closest(".jstyle, .jcolor, .jpop, .tools, .menu, dialog")) return;
    sweepEmpty(e.target.closest(".jbox"));
  }, true);
  listen(layer, "paste", (e) => { // words only inside a text box; formatting from elsewhere would fight the paper
    if (!e.target.closest("[contenteditable=true]")) return;
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    e.preventDefault(); if (text) document.execCommand("insertText", false, text);
  });
  listen(layer, "keydown", (e) => {
    const b = e.target.closest("[contenteditable=true]");
    if (b && e.key === "Escape") { b.blur(); const n = b.closest(".jobj"); selectObj(n); n.focus(); }
    if (b && (e.metaKey || e.ctrlKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) { e.preventDefault(); document.execCommand({ b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()]); changed(); }
  });

  // ---------- the style bar over whatever is selected ----------
  // preset dots plus a rainbow "+" that opens the full picker (wheel, hex, rgb); a picked colour comes back as "h" + hex
  function swatches(list, current, onPick, cls = "", custom = true, title = "Colour") {
    const plus = custom ? el("button", { type: "button", class: `jdot jplus ${isCustom(current) ? "on" : ""}`, title: "Your own colour: wheel, hex or RGB", "aria-label": "Your own colour", style: { "--c": isCustom(current) ? `#${current.slice(1)}` : "" },
      onclick: (e) => openColorPicker(e.currentTarget, { title, presets: list, value: colorOf(current, list, ""), onPick: (hex) => { const key = Object.keys(list).find((k) => list[k] === hex); onPick(key || `h${hex.slice(1)}`); } }) }) : null;
    return el("span", { class: "jsw" }, Object.entries(list).map(([key, value]) => el("button", { type: "button", class: `jdot ${cls} ${key === current ? "on" : ""}`, title: key, "aria-label": key, "aria-pressed": String(key === current), style: { "--c": typeof value === "string" && value.startsWith("#") ? value : "" }, "data-k": key, onclick: () => onPick(key) })), plus);
  }
  function chips(list, current, onPick) {
    return el("span", { class: "jchips" }, list.map(([key, label]) => el("button", { type: "button", class: `jchip ${key === current ? "on" : ""}`, "aria-pressed": String(key === current), onclick: () => onPick(key) }, label)));
  }
  function duplicate(nodes) { // copies come with what sits on them, and lines between copies stay joined to the copies
    snapshot();
    const order = withContents(nodes), ids = new Map();
    for (const n of order) if (n.dataset.id) ids.set(n.dataset.id, newId());
    const made = [];
    for (const n of order) {
      const t = document.createElement("template"); t.innerHTML = serializeObj(n);
      const o = readObj(t.content.firstElementChild); o.x += 24; o.y += 24;
      o.id = ids.get(o.id) || ""; o.ea = ids.get(o.ea) || ""; o.eb = ids.get(o.eb) || "";
      const copy = makeObj(o); if (copy) { layer.insertBefore(copy, styleBar); made.push(copy); }
    }
    setSel(made.filter((m, i) => nodes.includes(order[i]))); layout(); changed();
    return made[0];
  }
  function restack(node, front) {
    snapshot();
    const set = withContents(chosen.has(node) ? picked() : [node]); // a shape takes what's on it along
    if (front) for (const n of set) layer.insertBefore(n, styleBar); else for (const n of set.reverse()) layer.insertBefore(n, layer.firstChild);
    changed(); paintStyleBar();
  }
  const kindOf = (n) => KINDS.find((k) => n.classList.contains(k));
  const sameKind = (node) => (chosen.has(node) ? picked() : [node]).filter((n) => kindOf(n) === kindOf(node) && isLineNode(n) === isLineNode(node));
  function setShape(node, key, value) { snapshot(); for (const n of sameKind(node)) { const cur = shapeStyle(n.dataset.f); cur[key] = value; n.dataset.f = `${cur.style}${cur.weight}`; place(n); } layout(); changed(); paintStyleBar(); }
  function setData(node, key, value, { snap = true } = {}) { // changes every selected thing of the same kind
    if (snap) snapshot();
    for (const n of sameKind(node)) { if (value === "" || value == null) delete n.dataset[key]; else n.dataset[key] = value; place(n); }
    layout(); changed(); paintStyleBar(); refocus();
  }
  let barFocus = null; // the text box you were typing in when you used the style bar, so the caret comes back
  function refocus() { if (barFocus && barFocus.isConnected) { const b = barFocus; barFocus = null; b.focus(); } }
  listen(styleBar, "mousedown", (e) => { if (!e.target.closest("input, select, textarea")) e.preventDefault(); }); // keep the caret in the box
  listen(styleBar, "pointerdown", () => { const a = document.activeElement; barFocus = a && a.closest && a.closest(".jlayer [contenteditable=true]") ? a : null; });
  // text alignment: while you're typing it's the paragraph you're in; otherwise the whole box (or every selected box)
  const ALIGN_PATHS = { left: "M4 6h16M4 10h10M4 14h16M4 18h10", center: "M4 6h16M7 10h10M4 14h16M7 18h10", right: "M4 6h16M10 10h10M4 14h16M10 18h10", justify: "M4 6h16M4 10h16M4 14h16M4 18h16" };
  const alignIcon = (a) => { const t = document.createElement("template"); t.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="${ALIGN_PATHS[a]}"/></svg>`; return t.content.firstChild; };
  function alignOf(node) {
    const body = node.querySelector(".jbody"), sel = getSelection(), at = sel.rangeCount && body.contains(sel.anchorNode) ? sel.anchorNode : null;
    const blk = at ? (at.nodeType === 1 ? at : at.parentElement).closest("p, div:not(.jbody), h1, h2, h3, li") : body.querySelector("p, div, h1, h2, h3, li");
    const a = getComputedStyle(blk && body.contains(blk) ? blk : body).textAlign;
    return a === "start" || a === "-webkit-left" ? "left" : a;
  }
  function alignText(node, a) {
    const body = node.querySelector(".jbody");
    snapshot();
    if (document.activeElement === body) { document.execCommand({ left: "justifyLeft", center: "justifyCenter", right: "justifyRight", justify: "justifyFull" }[a]); }
    else for (const n of sameKind(node)) for (const blk of n.querySelectorAll(".jbody > p, .jbody > div, .jbody > h1, .jbody > h2, .jbody > h3, .jbody > ul > li, .jbody > ol > li")) blk.style.textAlign = a === "left" ? "" : a;
    for (const n of sameKind(node)) for (const blk of n.querySelectorAll("[style=\"\"]")) blk.removeAttribute("style");
    layout(); changed(); paintStyleBar();
  }
  function arrange(how) { // line several things up with each other
    const items = picked(); if (items.length < 2) return;
    snapshot();
    const rs = items.map(rectOf), L = Math.min(...rs.map((r) => r.x)), R = Math.max(...rs.map((r) => r.x + r.w)), T = Math.min(...rs.map((r) => r.y)), B = Math.max(...rs.map((r) => r.y + r.h));
    items.forEach((n, i) => {
      const r = rs[i], dx = how === "left" ? L - r.x : how === "center" ? (L + R) / 2 - (r.x + r.w / 2) : how === "right" ? R - (r.x + r.w) : 0;
      const dy = how === "top" ? T - r.y : how === "middle" ? (T + B) / 2 - (r.y + r.h / 2) : how === "bottom" ? B - (r.y + r.h) : 0;
      for (const m of withContents([n])) { m.dataset.x = Math.round(num(m.dataset.x, 0) + dx); m.dataset.y = Math.round(num(m.dataset.y, 0) + dy); place(m); }
    });
    layout(); changed();
  }
  function makeDefault(node) {
    const d = node.dataset, v = { f: d.f || "hand", s: d.s || "m", c: d.c || "" };
    store(TEXT_DEFAULT_KEY, v);
    toast(`New text will be ${BOX_FONTS.find((x) => x[0] === v.f)[1]}, size ${v.s.toUpperCase()}${v.c ? ", in this colour" : ""}`);
    paintStyleBar();
  }
  function paintStyleBar() {
    if (!selected || !editable || !selected.isConnected) { styleBar.hidden = true; return; }
    const node = selected, d = node.dataset, kind = KINDS.find((k) => node.classList.contains(k));
    const parts = [], many = picked(), mixed = many.length > 1 && sameKind(node).length !== many.length;
    if (many.length > 1) parts.push(el("b", { class: "jcount" }, `${many.length} selected`));
    if (mixed) { paintGroupBar(node, parts, many); return; }
    const pickBtn = (label, cls, hex, opts) => el("button", { type: "button", class: `jpick ${cls}`, title: label, "aria-label": label, "aria-haspopup": "dialog", onclick: (e) => openColorPicker(e.currentTarget, opts) }, el("span", { class: "jpick-icon" }, cls === "fill" ? "▣" : "A"), el("i", { style: { background: hex || "transparent" } }));
    const def = textDefault();
    const fontChips = (cur) => el("span", { class: "jchips" }, BOX_FONTS.map(([key, label]) => el("button", { type: "button", class: `jchip jfont-${key} ${key === cur ? "on" : ""}`, "aria-pressed": String(key === cur), title: key === def.f ? `${label} (your default)` : label, onclick: () => setData(node, "f", key) }, label, key === def.f ? el("i", { class: "jdefdot", "aria-hidden": "true" }) : null)));
    const alignChips = () => { const cur = alignOf(node); return el("span", { class: "jchips jalign", role: "group", "aria-label": "Text alignment" }, ["left", "center", "right", "justify"].map((a) => el("button", { type: "button", class: `jchip jicon ${a === cur ? "on" : ""}`, "aria-pressed": String(a === cur), title: { left: "Align left", center: "Centre", right: "Align right", justify: "Justify" }[a], "aria-label": { left: "Align left", center: "Centre", right: "Align right", justify: "Justify" }[a], onclick: () => alignText(node, a) }, alignIcon(a)))); };
    const isDefault = (d.f || "hand") === def.f && (d.s || "m") === def.s && (d.c || "") === def.c;
    if (kind === "jbox") parts.push(fontChips(d.f || "hand"), chips(SIZES, d.s || "m", (v) => setData(node, "s", v)), alignChips(),
      pickBtn("Text colour for the whole box", "text", colorOf(d.c, INKS, getComputedStyle(node.querySelector(".jbody")).color), { title: "Text colour", presets: INKS, value: colorOf(d.c, INKS, ""), none: "Default", onPick: (hex) => { const key = hex && Object.keys(INKS).find((k) => INKS[k] === hex); setData(node, "c", hex ? key || `h${hex.slice(1)}` : ""); } }),
      pickBtn("Background fill", "fill", d.b ? colorOf(d.b, FILLS, "") : "", { title: "Background fill", presets: FILLS, value: colorOf(d.b, FILLS, ""), none: "No fill", onPick: (hex) => { const key = hex && Object.keys(FILLS).find((k) => FILLS[k] === hex); setData(node, "b", hex ? key || `h${hex.slice(1)}` : ""); } }),
      el("button", { type: "button", class: `jchip jdefault ${isDefault ? "on" : ""}`, title: isDefault ? "This is how new text looks" : "Make new text look like this (font, size and colour)", "aria-pressed": String(isDefault), onclick: () => makeDefault(node) }, isDefault ? "✓ Default" : "Set as default"));
    if (kind === "jsticky") parts.push(swatches(STICKIES, d.c || "yellow", (v) => setData(node, "c", v), "", true, "Sticky note colour"), fontChips(d.f || "hand"), alignChips());
    if (kind === "jtape") parts.push(swatches(Object.fromEntries(Object.keys(TAPES).map((k) => [k, ""])), d.c || "mint", (v) => setData(node, "c", v), "tape", false));
    if (kind === "jphoto") parts.push(chips([["plain", "Plain"], ["polaroid", "Polaroid"], ["round", "Round"]], d.f || "polaroid", (v) => setData(node, "f", v)),
      chips([["s", "Small"], ["m", "Medium"], ["l", "Large"], ["full", "Full width"]], "", (v) => { if (v === "full") { snapshot(); d.x = 16; d.r = 0; setData(node, "w", String(Math.max(120, pageW() - 32))); } else setData(node, "w", String(Math.min({ s: 180, m: 320, l: 520 }[v], pageW() - 32))); }));
    if (kind === "jshape") {
      const st = shapeStyle(d.f), isLine = LINE_SHAPES.includes(d.s);
      parts.push(swatches(INKS, d.c || "chalk", (v) => setData(node, "c", v), "", true, "Shape colour"),
        chips(SHAPE_STYLES.filter(([k]) => !(isLine && k === "fill")), st.style, (v) => setShape(node, "style", v)),
        chips(WEIGHTS, st.weight, (v) => setShape(node, "weight", v)));
      if (isLine) parts.push(chips([["line", "—"], ["arrow", "→"], ["arrow2", "↔"]], d.s, (v) => setData(node, "s", v)));
    }
    if (many.length > 1) parts.push(arrangeChips());
    if (isLineNode(node) && (d.ea || d.eb) && many.length === 1) parts.push(el("button", { type: "button", class: "jchip", title: "Unhook both ends so the line stays put", onclick: () => { snapshot(); delete d.ea; delete d.eb; changed(); paintStyleBar(); } }, "Unlink"));
    parts.push(actions(node, kind));
    showBar(parts, many);
  }
  const act = (name, label, fn) => el("button", { type: "button", class: "jact", title: label, "aria-label": label, onclick: fn }, icon(name, 15));
  function actions(node, kind) {
    const many = picked();
    return el("span", { class: "jacts" },
      act("dup", "Duplicate  Ctrl+D", () => duplicate(many.length > 1 ? many : [node])), act("front", "Bring to front  ]", () => restack(node, true)), act("back", "Send to back  [", () => restack(node, false)),
      isLineNode(node) || many.length > 1 ? null : act("rot", "Straighten", () => setData(node, "r", 0)),
      act("trash", many.length > 1 ? `Remove all ${many.length}  Delete` : "Remove  Delete", () => removeNodes(many.length > 1 ? many : [node])));
  }
  function arrangeChips() {
    const A = { left: "M5 4v16M9 7h10v4H9zM9 14h6v4H9z", center: "M12 4v16M6 7h12v4H6zM8 14h8v4H8z", right: "M19 4v16M5 7h10v4H5zM9 14h6v4H9z", top: "M4 5h16M7 9h4v10H7zM14 9h4v6h-4z", middle: "M4 12h16M7 6h4v12H7zM14 8h4v8h-4z", bottom: "M4 19h16M7 5h4v10H7zM14 9h4v6h-4z" };
    const label = { left: "Line up left edges", center: "Line up centres", right: "Line up right edges", top: "Line up tops", middle: "Line up middles", bottom: "Line up bottoms" };
    return el("span", { class: "jchips jarrange", role: "group", "aria-label": "Line them up" }, Object.keys(A).map((k) => { const t = document.createElement("template"); t.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${A[k]}"/></svg>`; return el("button", { type: "button", class: "jchip jicon", title: label[k], "aria-label": label[k], onclick: () => arrange(k) }, t.content.firstChild); }));
  }
  function paintGroupBar(node, parts, many) { parts.push(arrangeChips(), actions(node, null)); showBar(parts, many); }
  function showBar(parts, many) {
    styleBar.replaceChildren(...parts);
    styleBar.hidden = false;
    // sit fully above what's selected (its real outline on screen, so a tilted line's far end stays free), or below when there's no room
    const base = paper.getBoundingClientRect(), boxes = many.map((n) => n.getBoundingClientRect());
    const top = Math.min(...boxes.map((b) => b.top)) - base.top, bottom = Math.max(...boxes.map((b) => b.bottom)) - base.top, left = Math.min(...boxes.map((b) => b.left)) - base.left;
    // inside the window while what it styles is on screen; when that's scrolled away, the bar goes with it
    const view = scroller(), right = Math.max(...boxes.map((b) => b.right)) - base.left;
    let x = clamp(left, 0, Math.max(0, paper.offsetWidth - styleBar.offsetWidth - 8));
    if (view) { const vl = view.scrollLeft, vr = vl + view.clientWidth - parseFloat(getComputedStyle(view).paddingLeft); if (right > vl && left < vr) x = clamp(x, vl + 4, Math.max(vl + 4, vr - styleBar.offsetWidth - 8)); }
    styleBar.style.left = `${x}px`;
    const turn = many.length === 1 && !isLineNode(many[0]) ? 30 : 0; // room for the turn handle
    const above = top - styleBar.offsetHeight - 14 - turn;
    styleBar.style.top = `${above >= 4 ? above : bottom + 14}px`;
  }

  // ---------- clicking on the paper ----------
  function freshBox(p) {
    const w = Math.min(320, Math.max(150, naturalW() + (scroller() ? scroller().scrollLeft : 0) - p.x - 16)), t = linesTop();
    const y = settings.paper !== "blank" ? t + Math.floor((p.y - t) / LINE) * LINE : p.y - 16;
    const def = textDefault();
    // written inside a shape or sticky note: it wraps inside it, so it belongs to it and moves with it
    const host = objects().reverse().find((o) => isContainer(o) && (() => { const r = rectOf(o); return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h; })());
    const room = host ? rectOf(host).x + rectOf(host).w - (p.x - 6) - 8 : 0;
    return add({ kind: "jbox", x: Math.max(0, p.x - 6), y, w: host && room >= 60 ? Math.min(room, 320) : Math.max(w, 150), f: def.f, s: def.s, c: def.c }, { focus: true });
  }
  function placeAt(p) {
    const tilt = () => Math.round((Math.random() - 0.5) * 6);
    snapshot();
    if (tool === "text") freshBox(p);
    else if (tool === "sticky") { const node = add({ kind: "jsticky", x: p.x - 100, y: p.y - 30, w: 200, h: 200, r: tilt(), c: stickyColor, f: textDefault().f }, { focus: true }); if (node) node.querySelector(".jbody").focus(); }
    else if (tool === "tape") add({ kind: "jtape", x: p.x - 70, y: p.y - 17, w: 140, h: 34, r: tilt() * 2, c: tape });
    else if (tool === "sticker") add({ kind: "jsticker", x: p.x - 24, y: p.y - 28, w: 48, r: tilt(), text: stickerPick });
    layout(); changed();
    setTool("write");
  }
  // Is the pointer on the entry's actual words (edit them), or on empty space beside or between them (write a new note there)?
  // This keeps old entries from grabbing every click: the space to the right of a short line is free page.
  function onWords(e) {
    const t = e.target, pm = t.closest && t.closest(".tiptap");
    if (!pm) return false;
    if (editorEl && editorEl.classList.contains("blanknote")) return true;      // an empty entry: clicking starts it
    if (e.shiftKey) return true;                                                  // extending a selection
    if (t.closest("pre, table, img, hr, a")) return true;
    const block = t.closest("li, p, h1, h2, h3, h4, h5, h6, blockquote");
    if (!block || !pm.contains(block)) return false;                              // the gap between blocks, or below them
    const li = t.closest("li");
    if (li && pm.contains(li)) { const first = li.firstElementChild; if (first && e.clientX < first.getBoundingClientRect().left + 2) return true; } // the bullet or tick box
    const text = block.tagName === "LI" && block.firstElementChild ? block.firstElementChild : block;
    const r = document.createRange(); r.selectNodeContents(text);
    const rects = [...r.getClientRects()].filter((q) => q.width > 1);
    if (!rects.length) { const sel = getSelection(); return !!(sel.rangeCount && text.contains(sel.anchorNode)); } // the empty line you're typing on
    return rects.some((q) => e.clientX >= q.left - 6 && e.clientX <= q.right + 14 && e.clientY >= q.top - 6 && e.clientY <= q.bottom + 6);
  }
  let hoverFrame = 0;
  listen(paper, "pointermove", (e) => { // the cursor shows which one a click will do
    if (!editable || tool !== "write" || hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const free = !e.target.closest(".jobj, .jstyle, .titlein, .meta, .entry-date, .backlinks, input, button") && !onWords(e);
      paper.classList.toggle("over-space", free);
    });
  });
  listen(paper, "pointerleave", () => paper.classList.remove("over-space"));
  listen(paper, "pointerdown", (e) => {
    // moving around the open page: ⌘/Ctrl-drag, Space-drag or the middle button (two-finger scrolling works too)
    if (e.button === 1 || (e.button === 0 && (e.metaKey || e.ctrlKey || spaceDown || tool === "hand"))) { if (!e.target.closest(".jstyle, a[href]")) { startPan(e); return; } }
    if (!editable || e.button > 0) return;
    if (e.target.closest(".jstyle")) return;
    if (tool === "shape") { e.preventDefault(); e.stopPropagation(); startShape(e); return; } // lines can start on a box to join it
    if (e.target.closest(".jobj, .jink-canvas")) return;
    if (["text", "sticky", "tape", "sticker"].includes(tool)) { e.preventDefault(); e.stopPropagation(); placeAt(pointOf(e)); return; }
    if (tool !== "write") { selectObj(null); return; }
    if (e.target.closest(".titlein, .meta, .entry-date, .backlinks, input, button")) { selectObj(null); return; }
    if (onWords(e)) { selectObj(null); return; }
    // empty paper: a click starts writing right there; a drag draws a box that selects everything it touches
    e.preventDefault();
    startMarquee(e);
  }, true);
  function startMarquee(e) {
    const A = pointOf(e), keep = e.shiftKey, before = keep ? picked() : [];
    let box = null;
    const move = (ev) => {
      const B = pointOf(ev);
      if (!box) { if (Math.hypot(B.x - A.x, B.y - A.y) < 5) return; box = el("div", { class: "jmarquee" }); layer.append(box); if (!keep) selectObj(null); if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur(); }
      const r = { x: Math.min(A.x, B.x), y: Math.min(A.y, B.y), w: Math.abs(B.x - A.x), h: Math.abs(B.y - A.y) };
      Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      const hit = objects().filter((o) => { const q = rectOf(o); return q.x < r.x + r.w && q.x + Math.max(q.w, 2) > r.x && q.y < r.y + r.h && q.y + Math.max(q.h, 2) > r.y; });
      setSel([...before, ...hit]);
      edgeGrow(ev);
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
      if (box) { box.remove(); return; }
      selectObj(null); freshBox(A);
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  }
  // ---------- the open page: move around it, and it grows as you go ----------
  function startPan(e) {
    const view = scroller(); if (!view) return;
    e.preventDefault(); e.stopPropagation();
    pan = { x: e.clientX, y: e.clientY, left: view.scrollLeft, top: view.scrollTop, moved: false };
    paper.classList.add("panning");
    const move = (ev) => {
      const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) < 3) return;
      pan.moved = true;
      const wantL = pan.left - dx, wantT = pan.top - dy;
      if (wantL > view.scrollWidth - view.clientWidth - 2) grow("w");
      if (wantT > view.scrollHeight - view.clientHeight - 2) grow("h");
      view.scrollLeft = wantL; view.scrollTop = wantT;
    };
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up); paper.classList.remove("panning"); setTimeout(() => { pan = null; }, 0); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  }
  function grow(axis) { // more page appears past the edge, up to a generous limit
    const view = scroller(); if (!view) return;
    if (axis === "w" && paper.offsetWidth < WORLD_MAX_W) { roomW = Math.max(roomW, paper.offsetWidth - naturalW()) + Math.round(view.clientWidth / 2); layout(); }
    if (axis === "h" && roomH < PAGE_H * 20) { roomH += PAGE_H / 2; layout(); }
  }
  function coverInk() { // the pen can draw wherever you've scrolled to
    const view = scroller(); if (!view || !["pen", "marker", "eraser"].includes(tool)) return;
    const want = view.scrollLeft + view.clientWidth;
    if (want > inkNeedW + 4) { inkNeedW = want; layout(); }
  }
  function edgeGrow(e) { // dragging something to the edge of the screen scrolls the page (and grows it)
    const view = scroller(); if (!view) return;
    const r = view.getBoundingClientRect(), edge = 36;
    const sx = e.clientX > r.right - edge ? 14 : e.clientX < r.left + edge + 70 && view.scrollLeft > 0 ? -14 : 0;
    const sy = e.clientY > r.bottom - edge ? 14 : e.clientY < r.top + edge && view.scrollTop > 0 ? -14 : 0;
    if (sx > 0 && view.scrollLeft + view.clientWidth >= view.scrollWidth - 4) grow("w");
    if (sy > 0 && view.scrollTop + view.clientHeight >= view.scrollHeight - 4) grow("h");
    if (sx || sy) { view.scrollLeft += sx; view.scrollTop += sy; }
  }
  listen(paper, "contextmenu", (e) => { if (e.ctrlKey || (pan && pan.moved)) e.preventDefault(); }); // Ctrl-click on a Mac is for moving around here
  const homeBtn = el("button", { type: "button", class: "jhome", hidden: true, title: "Back to the start of the page", onclick: () => { const v = scroller(); if (v) v.scrollTo({ left: 0, behavior: "smooth" }); } }, icon("home", 15), el("span", {}, "Back to the entry"));
  let homeFrame = 0;
  function onScroll() {
    if (homeFrame) return;
    homeFrame = requestAnimationFrame(() => {
      homeFrame = 0;
      const view = scroller(); if (!view || !paper.isConnected) return;
      homeBtn.hidden = view.scrollLeft < 160;
      if (view.scrollLeft + view.clientWidth > view.scrollWidth - 240) grow("w"); // nearly at the edge: there's always more page
      if (view.scrollTop + view.clientHeight > view.scrollHeight - 240 && view.scrollTop > 0) grow("h");
      coverInk();
      if (selected) paintStyleBar();
    });
  }
  function onWheel(e) { // at the very edge a trackpad swipe keeps going: grow the page instead of stopping dead
    const view = scroller(); if (!view || e.ctrlKey) return;
    if (e.deltaX > 0 && view.scrollLeft + view.clientWidth >= view.scrollWidth - 2) grow("w");
    if (e.deltaY > 0 && view.scrollTop + view.clientHeight >= view.scrollHeight - 2 && view.scrollTop > 0) grow("h");
  }
  requestAnimationFrame(() => {
    const view = scroller(); if (!view) return;
    listen(view, "scroll", onScroll, { passive: true }); listen(view, "wheel", onWheel, { passive: true });
    const desk = paper.closest(".jdesk"); if (desk) desk.append(homeBtn);
    if (editable && !stored("notes-pan-tip")) { store("notes-pan-tip", 1); setTimeout(() => toast("Tip: the page is open. Swipe with two fingers, or hold ⌘/Ctrl and drag, to move around it"), 900); }
  });
  listen(paper, "dragover", (e) => { if (editable && e.dataTransfer && [...e.dataTransfer.types].includes("Files") && !e.target.closest(".tiptap")) e.preventDefault(); });
  listen(paper, "drop", (e) => {
    if (!editable || e.target.closest(".tiptap")) return;
    const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
    if (!files.length) return;
    e.preventDefault();
    const p = pointOf(e);
    files.forEach((f, i) => { const at = { x: p.x + i * 24, y: p.y + i * 40 }; if (/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) addPhoto(f, at); else addFile(f, at); });
  });

  // ---------- drawing a shape: press, drag, let go ----------
  function startShape(e) {
    snapshot();
    const A = pointOf(e), kind = shapePick.s, isLine = LINE_SHAPES.includes(kind);
    const style = isLine && shapePick.style === "fill" ? "solid" : shapePick.style;
    const from = isLine && !e.altKey ? linkTargetAt(A, null) : null;
    const node = add({ kind: "jshape", s: kind, c: shapePick.c, f: `${style}${shapePick.weight}`, x: A.x, y: A.y, w: 1, h: isLine ? HIT : 1, r: 0 });
    node.classList.add("drawing");
    shaping = { node, A, moved: false, from, to: null };
    const move = (ev) => {
      const B = pointOf(ev); if (!shaping.moved && Math.hypot(B.x - A.x, B.y - A.y) < 4) return;
      shaping.moved = true;
      const d = node.dataset;
      if (isLine) {
        const to = ev.altKey ? null : linkTargetAt(B, node); shaping.to = to && to !== from ? to : null;
        markTarget(shaping.to || from);
        if (from) from.classList.add("jlink-target");
        const end = shaping.to ? edgePoint(shaping.to, from ? centreOf(from) : A) : B, start = from ? edgePoint(from, shaping.to ? centreOf(shaping.to) : B) : A;
        Object.assign(d, lineBox(start, end, ev.shiftKey && !shaping.to));
      }
      else {
        let w = Math.abs(B.x - A.x), h = Math.abs(B.y - A.y);
        if (ev.shiftKey) w = h = Math.max(w, h);
        d.x = Math.round(B.x < A.x ? A.x - w : A.x); d.y = Math.round(B.y < A.y ? A.y - h : A.y); d.w = Math.round(Math.max(w, 2)); d.h = Math.round(Math.max(h, 2)); d.r = 0;
      }
      place(node);
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
      const d = node.dataset; node.classList.remove("drawing");
      if (!shaping.moved) { // a plain click drops a ready-made shape where you clicked
        if (isLine) Object.assign(d, lineBox({ x: A.x - 80, y: A.y }, { x: A.x + 80, y: A.y }, false));
        else { const w = kind === "ellipse" || kind === "star" ? 120 : 160, h = kind === "ellipse" || kind === "star" ? 120 : 100; d.x = Math.round(A.x - w / 2); d.y = Math.round(A.y - h / 2); d.w = w; d.h = h; }
      }
      if (isLine && shaping.moved) { if (shaping.from) d.ea = ensureId(shaping.from); if (shaping.to) d.eb = ensureId(shaping.to); }
      markTarget(null);
      shaping = null; place(node); selectObj(node); layout(); changed(); setTool("write"); selectObj(node);
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  }

  // ---------- photos ----------
  function addPhoto(file, at, frame = "plain") {
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) return addFile(file, at); // anything else goes in as an attachment
    if (file.size > MAX_IMAGE) return toast("That picture is over 15 MB. Try a smaller one");
    const reader = new FileReader(), img = new Image(); // the page only shows data: pictures, so read the file in rather than linking to it
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = () => toast("That picture couldn't be read");
    img.onload = () => {
      const max = 1800, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const keepPNG = (file.type === "image/png" || file.type === "image/gif") && file.size < 1500000; // screenshots and see-through pictures stay PNG
      const data = keepPNG ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88);
      const w0 = Math.round(Math.min(frame === "polaroid" ? 280 : 360, img.naturalWidth, pageW() - 40));
      const view = paper.closest(".doc"), r = paper.getBoundingClientRect();
      const p = at || { x: pageW() / 2, y: view ? view.getBoundingClientRect().top + view.clientHeight / 2 - r.top : 300 };
      snapshot();
      add({ kind: "jphoto", x: clamp(p.x - w0 / 2, 10, Math.max(10, pageW() - w0 - 10)), y: Math.max(20, p.y - 120), w: w0, r: frame === "polaroid" ? Math.round((Math.random() - 0.5) * 6) : 0, f: frame, src: data });
      changed(); setTool("write");
    };
    img.onerror = () => toast("That picture couldn't be opened");
    reader.readAsDataURL(file);
  }
  function pickPhoto() {
    const input = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", multiple: true, onchange: () => { [...input.files].forEach((f, i) => addPhoto(f, i ? { x: pageW() / 2 + i * 30, y: centreY() + i * 30 } : null)); } });
    input.click();
  }
  function centreY() { const view = paper.closest(".doc"), r = paper.getBoundingClientRect(); return view ? view.getBoundingClientRect().top + view.clientHeight / 2 - r.top : 300; }
  // ---------- attachments: a file card you can move and open ----------
  function addFile(file, at) {
    if (!file) return;
    if (file.size > MAX_FILE) return toast("That file is over 15 MB. Attach a smaller one, or keep it in Drive and link to it");
    if (/^(text\/html|image\/svg)/.test(file.type) || /\.(html?|svg)$/i.test(file.name)) return toast("Web pages and SVG pictures can't be attached. Save it as a PDF instead");
    const reader = new FileReader();
    reader.onload = () => {
      const p = at || { x: pageW() / 2, y: centreY() };
      snapshot();
      add({ kind: "jfile", x: clamp(p.x - 130, 10, Math.max(10, pageW() - 270)), y: Math.max(20, p.y - 30), w: 260, href: reader.result, name: file.name.replace(/[<>"&]/g, "_").slice(0, 120) || "file" });
      changed(); setTool("write");
    };
    reader.onerror = () => toast("That file couldn't be read");
    reader.readAsDataURL(file);
  }
  function pickFile() {
    const input = el("input", { type: "file", multiple: true, onchange: () => { [...input.files].forEach((f, i) => { const at = { x: pageW() / 2 + i * 24, y: centreY() + i * 70 }; if (/^image\//.test(f.type) && !/svg/.test(f.type)) addPhoto(f, at); else addFile(f, at); }); } });
    input.click();
  }

  // ---------- the tool tray ----------
  const btn = {};
  const toolBtn = (name, label, keys, onclick) => (btn[name] = el("button", { type: "button", class: "jtool", "data-tool": name, title: keys ? `${label}  ${keys}` : label, "aria-label": label, onclick }, icon(name), el("i", { class: "jtool-dot" })));
  const tray = el("div", { class: "jtray", role: "toolbar", "aria-label": "Journal tools", "aria-orientation": "vertical" },
    toolBtn("write", "Write — click empty paper to write there", "W", () => setTool("write")),
    toolBtn("text", "Text anywhere — click to place words. Click again for your default font", "T", () => (tool === "text" ? openPop("text") : setTool("text"))),
    toolBtn("hand", "Move around the page — or swipe with two fingers, or hold ⌘/Ctrl (or Space) and drag", "Space", () => setTool(tool === "hand" ? "write" : "hand")),
    el("hr"),
    toolBtn("pen", "Pen", "P", () => (tool === "pen" ? openPop("pen") : setTool("pen"))),
    toolBtn("marker", "Highlighter", "H", () => (tool === "marker" ? openPop("marker") : setTool("marker"))),
    toolBtn("eraser", "Eraser", "E", () => setTool("eraser")),
    el("hr"),
    toolBtn("sticky", "Sticky note", "N", () => (tool === "sticky" ? openPop("sticky") : setTool("sticky"))),
    toolBtn("tape", "Washi tape", "", () => (tool === "tape" ? openPop("tape") : setTool("tape"))),
    toolBtn("sticker", "Sticker", "", () => openPop("sticker")),
    toolBtn("photo", "Add an image (or drop / paste one on the page)", "", pickPhoto),
    toolBtn("file", "Attach a file (PDF, Word, anything)", "", pickFile),
    el("hr"),
    toolBtn("shape", "Shapes and lines — drag on the page to draw", "L R O A", () => openPop("shape")),
    el("hr"),
    toolBtn("undo", "Undo on the page", "", undo),
    toolBtn("redo", "Redo", "", redo),
    toolBtn("page", "Page lines, font and length", "", () => openPop("page")));
  for (const name of ["pen", "marker", "sticky", "tape", "text"]) btn[name].setAttribute("aria-haspopup", "true");
  btn.sticker.setAttribute("aria-haspopup", "true"); btn.page.setAttribute("aria-haspopup", "true"); btn.shape.setAttribute("aria-haspopup", "true");

  function paintTray() {
    for (const [name, b] of Object.entries(btn)) {
      const on = name === tool;
      b.classList.toggle("on", on); if (["write", "text", "hand", "pen", "marker", "eraser", "sticky", "tape"].includes(name)) b.setAttribute("aria-pressed", String(on));
    }
    btn.shape.style.setProperty("--dot", colorOf(shapePick.c, INKS, INKS.chalk));
    btn.pen.style.setProperty("--dot", colorOf(pen.color, INKS, INKS.chalk)); btn.marker.style.setProperty("--dot", colorOf(marker, MARKERS, MARKERS.yellow)); btn.sticky.style.setProperty("--dot", colorOf(stickyColor, STICKIES, STICKIES.yellow));
    btn.undo.disabled = !undoStack.length; btn.redo.disabled = !redoStack.length;
    paper.dataset.tool = tool;
    canvas.style.pointerEvents = ["pen", "marker", "eraser"].includes(tool) ? "auto" : "none";
  }
  function setTool(name) { tool = name; closePop(); if (name !== "write" && name !== "text") selectObj(null); paintTray(); coverInk(); }

  function closePop() { if (popover) { popover.el.remove(); document.removeEventListener("pointerdown", popover.away, true); popover = null; } }
  function openPop(kind) {
    if (popover && popover.kind === kind) return closePop();
    closePop();
    const box = el("div", { class: "jpop", role: "dialog", "aria-label": kind });
    const repaint = () => { closePop(); openPop(kind); };
    if (kind === "text") {
      const def = textDefault(), save = (k, v) => { store(TEXT_DEFAULT_KEY, { ...textDefault(), [k]: v }); repaint(); };
      const sample = el("div", { class: `jsample jfont-${def.f} jsize-${def.s}`, style: { color: colorOf(def.c, INKS, "") } }, "Your words look like this");
      box.append(el("b", {}, "New text starts as"), sample,
        el("b", {}, "Font"), el("span", { class: "jchips" }, BOX_FONTS.map(([k, label]) => el("button", { type: "button", class: `jchip jfont-${k} ${k === def.f ? "on" : ""}`, "aria-pressed": String(k === def.f), onclick: () => save("f", k) }, label))),
        el("b", {}, "Size"), chips(SIZES, def.s, (v) => save("s", v)),
        el("b", {}, "Colour"), swatches({ chalk: INKS.chalk, ...Object.fromEntries(Object.entries(INKS).filter(([k]) => k !== "chalk")) }, def.c || "chalk", (v) => save("c", v === "chalk" ? "" : v), "", true, "Default text colour"),
        el("button", { type: "button", class: "jchip", title: "Give every text box on this page the default look", onclick: () => {
          const boxes = objects().filter((o) => o.classList.contains("jbox")); if (!boxes.length) return toast("There's no text on this page yet");
          snapshot(); const d2 = textDefault(); for (const o of boxes) { o.dataset.f = d2.f; o.dataset.s = d2.s; if (d2.c) o.dataset.c = d2.c; else delete o.dataset.c; place(o); } layout(); changed(); toast(`Updated ${boxes.length} text box${boxes.length === 1 ? "" : "es"}`);
        } }, "Use on all text on this page"),
        el("small", {}, "To change one box later, click it and pick a font. Set as default there makes that look the new default."));
    }
    if (kind === "pen") box.append(el("b", {}, "Pen colour"), swatches(INKS, pen.color, (v) => { pen.color = v; paintTray(); repaint(); }, "", true, "Pen colour"), el("b", {}, "Thickness"), chips(PEN_SIZES.map(([k]) => [k, k[0].toUpperCase() + k.slice(1)]), pen.size, (v) => { pen.size = v; repaint(); }));
    if (kind === "marker") box.append(el("b", {}, "Highlighter"), swatches(MARKERS, marker, (v) => { marker = v; paintTray(); repaint(); }, "", true, "Highlighter colour"));
    if (kind === "sticky") box.append(el("b", {}, "Sticky note colour"), swatches(STICKIES, stickyColor, (v) => { stickyColor = v; paintTray(); repaint(); }, "", true, "Sticky note colour"), el("small", {}, "Then click the page to stick it."));
    if (kind === "tape") box.append(el("b", {}, "Washi tape"), swatches(Object.fromEntries(Object.keys(TAPES).map((k) => [k, ""])), tape, (v) => { tape = v; repaint(); }, "tape", false), el("small", {}, "Then click the page to lay a strip."));
    if (kind === "sticker") box.append(el("b", {}, "Pick a sticker, then click the page"), el("div", { class: "jstickers" }, STICKERS.map((s) => el("button", { type: "button", class: `jstk ${s === stickerPick ? "on" : ""}`, "aria-label": `Sticker ${s}`, onclick: () => { stickerPick = s; tool = "sticker"; closePop(); paintTray(); } }, s))));
    if (kind === "shape") box.append(el("b", {}, "Draw a shape — pick one, then drag on the page"),
      el("div", { class: "jshapes" }, SHAPES.map(([k, label, key]) => el("button", { type: "button", class: `jshp ${tool === "shape" && shapePick.s === k ? "on" : ""}`, title: key ? `${label}  ${key}` : label, "aria-label": label, onclick: () => { shapePick.s = k; tool = "shape"; selectObj(null); closePop(); paintTray(); } },
        shapeSVG(k, LINE_SHAPES.includes(k) ? 30 : 26, LINE_SHAPES.includes(k) ? 24 : 22, `${k === "triangle" || k === "star" ? "solid" : shapePick.style === "fill" && !LINE_SHAPES.includes(k) ? "fill" : "solid"}2`, "currentColor")))),
      el("b", {}, "Colour"), swatches(INKS, shapePick.c, (v) => { shapePick.c = v; paintTray(); repaint(); }, "", true, "Shape colour"),
      el("b", {}, "Style"), chips(SHAPE_STYLES, shapePick.style, (v) => { shapePick.style = v; repaint(); }),
      el("b", {}, "Thickness"), chips(WEIGHTS, shapePick.weight, (v) => { shapePick.weight = v; repaint(); }),
      el("small", {}, "Hold Shift for a perfect circle or square, or a straight line."));
    if (kind === "page") box.append(
      el("b", {}, "Guide lines"), chips(PAPERS, settings.paper, (v) => { snapshot(); settings.paper = v; applySettings(); changed(); repaint(); }),
      el("b", {}, "Entry handwriting"), chips(PAGE_FONTS, settings.font, (v) => { snapshot(); settings.font = v; applySettings(); changed(); repaint(); }),
      (() => { const def = pick(stored(ENTRY_FONT_KEY), PAGE_FONTS.map((x) => x[0]), "serif"); return def === settings.font ? el("small", {}, "✓ New notes start in this font") : el("button", { type: "button", class: "jchip", onclick: () => { store(ENTRY_FONT_KEY, settings.font); toast(`New notes will start in ${PAGE_FONTS.find((x) => x[0] === settings.font)[1]}`); repaint(); } }, "Use this font for new notes"); })(),
      el("b", {}, "Page length"),
      el("span", { class: "jchips" },
        el("button", { type: "button", class: "jchip", onclick: () => { snapshot(); settings.pages += 1; layout(); changed(); repaint(); } }, "+ More room"),
        el("button", { type: "button", class: "jchip", disabled: settings.pages <= neededPages() ? true : null, title: "Only empty room at the bottom can be taken away", onclick: () => { snapshot(); settings.pages = Math.max(neededPages(), settings.pages - 1); layout(); changed(); repaint(); } }, "Less room")),
      el("button", { type: "button", class: "jchip danger", onclick: () => { if (!inkHas) return toast("There's no ink on this page"); snapshot(); ctx.clearRect(0, 0, canvas.width, canvas.height); inkDirty = true; changed(); closePop(); toast("Ink cleared. Undo brings it back"); } }, "Clear all ink"));
    const anchor = btn[kind]; const r = anchor.getBoundingClientRect();
    document.body.append(box);
    const wide = innerWidth > 820;
    box.style.left = `${wide ? r.right + 10 : clamp(r.left - 120, 8, innerWidth - box.offsetWidth - 8)}px`;
    box.style.top = `${wide ? clamp(r.top - 8, 8, innerHeight - box.offsetHeight - 8) : r.top - box.offsetHeight - 10}px`;
    const away = (e) => { if (!box.contains(e.target) && e.target !== anchor && !anchor.contains(e.target) && !e.target.closest(".jcolor")) closePop(); };
    document.addEventListener("pointerdown", away, true);
    popover = { el: box, kind, away };
  }

  // single-letter tool keys when you're not typing, Esc to put the pen down, Delete for what's selected, Ctrl+Z for the page
  listen(document, "keydown", (e) => {
    if (!editable || !paper.isConnected) return;
    const a = document.activeElement, typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    if (e.key === "Escape") { if (popover) return closePop(); if (tool !== "write") { setTool("write"); return; } if (selected && !typing) selectObj(null); return; }
    if (typing || document.querySelector("dialog[open]")) return;
    if (e.key === " " && !e.repeat && !(a && a.closest && a.closest("button, a, select, summary, [role=button], [role=radio]"))) { e.preventDefault(); spaceDown = true; paper.classList.add("pan-ready"); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); return redo(); }
    if (mod && e.key.toLowerCase() === "d" && selected) { e.preventDefault(); return duplicate(picked()); }
    if (mod && e.key.toLowerCase() === "a" && objects().length) { e.preventDefault(); return setSel(objects()); } // everything placed on the page
    if (mod || e.altKey) return;
    if (selected && e.key.startsWith("Arrow")) { // nudge: 1px, or 10px with Shift; what's selected moves with what sits on it
      e.preventDefault(); const step = e.shiftKey ? 10 : 1;
      if (!e.repeat) snapshot();
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      for (const n of withContents(picked())) { const d = n.dataset; d.x = Math.max(0, num(d.x, 0) + dx); d.y = Math.max(-10, num(d.y, 0) + dy); place(n); }
      updateLinks(); paintStyleBar(); changed(); return;
    }
    if (selected && (e.key === "]" || e.key === "[")) { e.preventDefault(); return restack(selected, e.key === "]"); }
    const shapeKey = { l: "line", r: "rect", o: "ellipse", a: "arrow" }[e.key.toLowerCase()];
    if (shapeKey) { e.preventDefault(); shapePick.s = shapeKey; selectObj(null); setTool("shape"); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); removeNodes(picked()); return; }
    const keyTool = { w: "write", t: "text", p: "pen", h: "marker", e: "eraser", n: "sticky" }[e.key.toLowerCase()];
    if (keyTool) { e.preventDefault(); setTool(keyTool); }
  });
  listen(document, "keyup", (e) => { if (e.key === " " && spaceDown) { spaceDown = false; paper.classList.remove("pan-ready"); } });
  listen(window, "blur", () => { spaceDown = false; paper.classList.remove("pan-ready"); });
  listen(document, "paste", (e) => {
    if (!editable || !paper.isConnected) return;
    const a = document.activeElement; if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return; // typing: the text field handles it
    const files = e.clipboardData ? [...e.clipboardData.files] : [];
    if (!files.length) return;
    e.preventDefault();
    files.forEach((f, i) => { const at = { x: pageW() / 2 + i * 24, y: centreY() + i * 40 }; if (/^image\//.test(f.type)) addPhoto(f, at); else addFile(f, at); });
  });
  listen(document, "pointerdown", (e) => { if (selected && !paper.contains(e.target) && !e.target.closest(".jpop, .tools, .jcolor, .jhome, .jtray")) selectObj(null); }, true);
  const ro = new ResizeObserver(() => layout()); // the entry growing, or the window changing size
  if (editorEl) ro.observe(editorEl);
  ro.observe(paper);
  cleanup.push(() => ro.disconnect());

  // ---------- saving ----------
  function serializeObj(node) {
    const o = readObj(node), d = node.dataset;
    const attrs = ["x", "y", "w", "h", "r", "c", "f", "s", "b", "id", "ea", "eb"].filter((k) => d[k] != null && d[k] !== "" && !(k === "r" && Number(d[k]) === 0)).map((k) => ` data-${k}="${escAttr(d[k])}"`).join("");
    const body = node.querySelector(".jbody");
    let inner = "";
    if (o.kind === "jbox" || o.kind === "jsticky") { // keep coloured words and highlights; unwrap any other span (spell-check marks and the like)
      const copy = body.cloneNode(true);
      for (const sp of [...copy.querySelectorAll("span")]) if (!sp.style.color && !sp.style.backgroundColor) sp.replaceWith(...sp.childNodes);
      inner = copy.innerHTML.replace(/\u200b/g, "");
    }
    else if (o.kind === "jsticker") inner = body.textContent.replace(/[<&]/g, "");
    else if (o.kind === "jphoto") inner = `<img src="${escAttr(o.src)}">`;
    else if (o.kind === "jfile") inner = `<a href="${escAttr(o.href)}" download="${escAttr(o.name || "file")}">${String(o.name || "file").replace(/[<&]/g, "")}</a>`;
    return `<div class="${o.kind}"${attrs}>${inner}</div>`;
  }
  function serialize() {
    const objs = objects().filter((n) => !(n.classList.contains("jbox") && !n.querySelector(".jbody").textContent.trim())).map(serializeObj).join("");
    const ink = currentInk();
    const plain = !objs && !ink && settings.paper === "lined" && settings.font === "serif" && settings.pages === 1;
    if (plain) return ""; // an ordinary entry stays an ordinary note
    const inkHTML = ink ? `<div class="jink" data-w="${Math.round(canvas.width / inkScale)}" data-h="${Math.round(canvas.height / inkScale)}"><img src="${ink}"></div>` : "";
    return `<div class="jpage" data-paper="${settings.paper}" data-f="${settings.font}" data-pages="${settings.pages}">${objs}${inkHTML}</div>`;
  }

  paintTray();
  requestAnimationFrame(layout);
  return {
    tray, serialize, setTool, undo, pageSwitch,
    destroy() { closePop(); closeColorPicker(); for (const fn of cleanup) fn(); if (addPage) addPage.remove(); homeBtn.remove(); },
  };
}
