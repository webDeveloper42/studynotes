import { splitJournal, mountJournal, journalText, openColorPicker, closeColorPicker, rgba } from "/notes/journal.js";
let Editor, TiptapNode, TiptapMark, TiptapExtension;
try { ({ Editor, Node: TiptapNode, Mark: TiptapMark, Extension: TiptapExtension } = await import("@tiptap/core")); }
catch (error) { console.error("Tiptap could not load; using the notes editor fallback.", error); }
if (!TiptapNode) TiptapNode = { create: (spec) => spec };
if (!TiptapMark) TiptapMark = { create: (spec) => spec };
if (!TiptapExtension) TiptapExtension = { create: (spec) => spec };
class NativeEditorFallback {
  constructor(options) {
    this.host = options.element; this.host.contentEditable = String(options.editable); this.host.innerHTML = options.content;
    this.view = { dom: this.host };
    this.commands = {
      focus: (where) => { this.host.focus(); const end = where === "end"; const r = document.createRange(); r.selectNodeContents(this.host); r.collapse(!end); const s = getSelection(); s.removeAllRanges(); s.addRange(r); },
      setContent: (html) => { this.host.innerHTML = html; },
      insertContentAt: (_pos, node) => { if (node && node.type === "paragraph") this.host.append(emptyP()); },
    };
    this.state = { get doc() { const last = options.element.lastElementChild; return { lastChild: last ? { type: { name: last.tagName.toLowerCase() }, content: { size: last.textContent.length } } : null, content: { size: options.element.textContent.length } }; } };
  }
  getHTML() { return this.host.innerHTML; }
  destroy() { this.host.contentEditable = "false"; }
}
if (!Editor) Editor = NativeEditorFallback;
"use strict";
// Notes. Lists and labels go in through textContent. Only note bodies use innerHTML, and only after the server has cleaned them.
// Notes are still stored as the same small set of HTML the terminal app reads; the editor adds Markdown on top:
// type "# ", "- ", "1. ", "[] ", "> ", "```", "---", **bold**, *italic*, `code`, ~~strike~~, ==highlight==, [text](url), or "/" for a menu.
const app = document.getElementById("app");
const dialog = document.getElementById("dialog");
const toastEl = document.getElementById("toast");
const SAVE_AFTER = 700;
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_FILE = 15 * 1024 * 1024;   // an attached file (PDF, Word file…) is kept inside the note
const ZW = "​";                 // lets the caret step out of **bold** or `code` you just finished; never saved
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = MAC ? "⌘" : "Ctrl+", ALT = MAC ? "⌥" : "Alt+", SHIFT = MAC ? "⇧" : "Shift+";
let S = null, view = "all", query = "", sort = "updated", toastTimer = null, searchTimer = null;
let note = null, created = null; // the open note, and a note made by New that hasn't been touched yet
let dirty = new Set(), saveTimer = null, saving = null, conflict = null, saveState = "";
let els = {}, focusMode = false;
let tiptap = null;
let journal = null, keptLayer = ""; // the designed journal page (free writing, ink, stickers…) saved after the entry
let dayFilter = "", journalBrowse = false, journalMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
try { view = localStorage.getItem("notes-view") || "all"; sort = localStorage.getItem("notes-sort") || "updated"; focusMode = localStorage.getItem("notes-focus") === "1"; } catch (e) { /* defaults are fine */ }

// The study journal is the default; the original theme remains one click away.
let theme = "journal"; // StudyNotes opens as the study journal; the original layout is one click away
try { theme = localStorage.getItem("notes-experience-v3") || "journal"; } catch (e) { /* defaults are fine */ }
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.bsTheme = theme === "journal" || (theme === "original" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  app.dataset.experience = theme;
}
applyTheme();

Object.assign(ICON_PATHS, {
  strike: "M5 12h14M16 6.5C15.2 5 13.8 4.5 12 4.5c-2.5 0-4 1.3-4 3 0 1.5 1 2.4 3 3M8 17.5c.8 1.4 2.2 2 4 2 2.6 0 4.2-1.3 4.2-3.2 0-.8-.3-1.5-.8-2",
  hilite: "M9 15l-3 3h6M14 4l6 6-8 8-6-6zM4 21h16", code: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14",
  olist: "M10 6h10M10 12h10M10 18h10M4 5h1v4M4 9h2M4 14.5a1 1 0 0 1 2 0c0 1-2 1.5-2 3h2", quote: "M6 17c-1.5 0-2.5-1-2.5-3 0-3 2-6 5-7M15 17c-1.5 0-2.5-1-2.5-3 0-3 2-6 5-7",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01", clip: "M16 7l-7.5 7.5a2 2 0 0 0 3 3L19 10a4 4 0 0 0-6-6l-7.5 7.5a6 6 0 0 0 8.5 8.5L20 14",
  minus: "M4 12h16", focus: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5", help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4", menu: "M4 7h16M4 12h16M4 17h16", x: "M6 6l12 12M18 6L6 18", heading: "M6 4v16M18 4v16M6 12h12", text: "M5 6V4h14v2M12 4v16M9 20h6",
  table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14", ext: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  headingNumber: "M4 5h3v4H4M4 11h3M4 14h3v5H4M11 6h9M11 12h9M11 18h9",
});

// Tiptap owns the editable document and keeps its structure valid as you type.
// These small extensions describe the HTML already used by the notes API.
const textBlock = (name, tag, content = "inline*", attrs = {}) => TiptapNode.create({
  name, group: "block", content,
  addAttributes() { return Object.fromEntries(Object.entries(attrs).map(([key, fallback]) => [key, {
    default: fallback,
    parseHTML: (el) => el.getAttribute(key) || fallback,
    renderHTML: (a) => a[key] && a[key] !== fallback ? { [key]: a[key] } : {},
  }])); },
  parseHTML() { return [{ tag }]; },
  renderHTML({ HTMLAttributes }) { return [tag, HTMLAttributes, 0]; },
});
const inlineMark = (name, tag, attrs = {}) => TiptapMark.create({
  name, addAttributes() { return Object.fromEntries(Object.entries(attrs).map(([key, fallback]) => [key, {
    default: fallback, parseHTML: (el) => el.getAttribute(key) || fallback,
    renderHTML: (a) => a[key] ? { [key]: a[key] } : {},
  }])); },
  parseHTML() { return [{ tag }]; }, renderHTML({ HTMLAttributes }) { return [tag, HTMLAttributes, 0]; },
});
const tiptapExtensions = [
  TiptapNode.create({ name: "doc", topNode: true, content: "block+" }),
  TiptapNode.create({ name: "text", group: "inline" }),
  textBlock("paragraph", "p"),
  TiptapNode.create({ name: "heading", group: "block", content: "inline*", defining: true,
    addAttributes() { return { level: { default: 1, parseHTML: (el) => Number(el.tagName.slice(1)), renderHTML: ({ level }) => ({}) }, class: { default: null, parseHTML: (el) => el.getAttribute("class"), renderHTML: ({ class: value }) => value ? { class: value } : {} } }; },
    parseHTML() { return [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })); },
    renderHTML({ node, HTMLAttributes }) { return [`h${node.attrs.level}`, HTMLAttributes, 0]; },
  }),
  TiptapNode.create({ name: "bulletList", group: "block", content: "listItem+", addAttributes() { return { class: { default: null, parseHTML: (el) => el.getAttribute("class"), renderHTML: ({ class: value }) => value ? { class: value } : {} } }; }, parseHTML() { return [{ tag: "ul" }]; }, renderHTML({ HTMLAttributes }) { return ["ul", HTMLAttributes, 0]; } }),
  TiptapNode.create({ name: "orderedList", group: "block", content: "listItem+", addAttributes() { return { start: { default: null, parseHTML: (el) => el.hasAttribute("start") ? Number(el.getAttribute("start")) : null, renderHTML: ({ start }) => start ? { start } : {} } }; }, parseHTML() { return [{ tag: "ol" }]; }, renderHTML({ HTMLAttributes }) { return ["ol", HTMLAttributes, 0]; } }),
  TiptapNode.create({ name: "listItem", content: "block+", defining: true,
    // Real list keys: Enter makes the next item (a ticked to-do starts unticked), Enter on an empty item leaves the list,
    // Tab / Shift+Tab nest and un-nest, Backspace at the start of an item turns it back into a line.
    addKeyboardShortcuts() { return {
      Enter: () => this.editor.commands.splitListItem(this.name, { class: null }),
      Tab: () => this.editor.commands.sinkListItem(this.name) || true,
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name) || true,
      Backspace: () => { const { $from, empty } = this.editor.state.selection; return empty && $from.parentOffset === 0 && $from.node(-1).type.name === this.name && $from.index(-1) === 0 ? this.editor.commands.liftListItem(this.name) : false; },
    }; },
    addAttributes() { return { class: { default: null, parseHTML: (el) => el.getAttribute("class"), renderHTML: ({ class: value }) => value ? { class: value } : {} } }; }, parseHTML() { return [{ tag: "li" }]; }, renderHTML({ HTMLAttributes }) { return ["li", HTMLAttributes, 0]; } }),
  textBlock("blockquote", "blockquote", "block+"),
  TiptapNode.create({ name: "hardBreak", inline: true, group: "inline", selectable: false, parseHTML() { return [{ tag: "br" }]; }, renderHTML() { return ["br"]; } }),
  TiptapNode.create({ name: "horizontalRule", group: "block", atom: true, parseHTML() { return [{ tag: "hr" }]; }, renderHTML() { return ["hr"]; } }),
  TiptapNode.create({ name: "codeBlock", group: "block", content: "text*", marks: "", code: true, defining: true,
    // Enter adds a line inside the code; Enter on a blank last line leaves the block
    addKeyboardShortcuts() { return {
      Enter: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parent.type.name !== this.name) return false;
        if ($from.parentOffset === $from.parent.content.size && $from.parent.textContent.endsWith("\n")) return this.editor.chain().command(({ tr }) => { tr.delete($from.pos - 1, $from.pos); return true; }).exitCode().run();
        return this.editor.commands.newlineInCode();
      },
    }; },
    parseHTML() { return [{ tag: "pre", preserveWhitespace: "full" }]; }, renderHTML() { return ["pre", ["code", 0]]; } }),
  // Pictures in the entry can be resized: drag the handle at the corner (the shape is kept). The width is saved on the <img>.
  TiptapNode.create({ name: "image", inline: true, group: "inline", atom: true, draggable: true,
    addAttributes() { return { src: { default: null }, alt: { default: null }, title: { default: null }, width: { default: null, parseHTML: (el) => (/^\d{1,4}$/.test(el.getAttribute("width") || "") ? Number(el.getAttribute("width")) : null), renderHTML: ({ width }) => (width ? { width } : {}) } }; },
    parseHTML() { return [{ tag: "img[src]" }]; }, renderHTML({ HTMLAttributes }) { return ["img", HTMLAttributes]; },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        const wrap = document.createElement("span"), img = document.createElement("img"), grip = document.createElement("span"), tag = document.createElement("span");
        wrap.className = "rimg"; grip.className = "rimg-grip"; grip.title = "Drag to resize"; tag.className = "rimg-size";
        img.src = node.attrs.src; if (node.attrs.alt) img.alt = node.attrs.alt; img.draggable = false;
        const paint = (n) => { img.style.width = n.attrs.width ? `${n.attrs.width}px` : ""; };
        paint(node); wrap.append(img, grip, tag);
        grip.addEventListener("pointerdown", (e) => {
          if (!editor.isEditable) return;
          e.preventDefault(); e.stopPropagation(); grip.setPointerCapture(e.pointerId);
          const startX = e.clientX, startW = img.getBoundingClientRect().width, max = wrap.parentElement ? wrap.closest(".tiptap").clientWidth : 2000;
          wrap.classList.add("resizing");
          const move = (ev) => { const w = Math.round(Math.max(40, Math.min(max, startW + ev.clientX - startX))); img.style.width = `${w}px`; tag.textContent = `${w}px`; };
          const up = () => {
            grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); wrap.classList.remove("resizing");
            const w = Math.round(img.getBoundingClientRect().width), pos = typeof getPos === "function" ? getPos() : null;
            if (pos != null) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: w }));
          };
          grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up, { once: true });
        });
        return { dom: wrap, update: (n) => { if (n.type.name !== "image") return false; node = n; if (img.src !== n.attrs.src) img.src = n.attrs.src; paint(n); return true; },
          selectNode: () => wrap.classList.add("on"), deselectNode: () => wrap.classList.remove("on"), stopEvent: (e) => grip.contains(e.target), ignoreMutation: () => true };
      };
    } }),
  TiptapNode.create({ name: "table", group: "block", content: "tableRow+", tableRole: "table", isolating: true, parseHTML() { return [{ tag: "table" }]; }, renderHTML() { return ["table", ["tbody", 0]]; } }),
  TiptapNode.create({ name: "tableRow", content: "(tableCell|tableHeader)+", tableRole: "row", parseHTML() { return [{ tag: "tr" }]; }, renderHTML() { return ["tr", 0]; } }),
  TiptapNode.create({ name: "tableCell", content: "block+", tableRole: "cell", isolating: true, addAttributes() { return { colspan: { default: 1, parseHTML: (el) => Number(el.getAttribute("colspan") || 1) }, rowspan: { default: 1, parseHTML: (el) => Number(el.getAttribute("rowspan") || 1) } }; }, parseHTML() { return [{ tag: "td" }]; }, renderHTML({ HTMLAttributes }) { return ["td", HTMLAttributes, 0]; } }),
  TiptapNode.create({ name: "tableHeader", content: "block+", tableRole: "header_cell", isolating: true, addAttributes() { return { colspan: { default: 1, parseHTML: (el) => Number(el.getAttribute("colspan") || 1) }, rowspan: { default: 1, parseHTML: (el) => Number(el.getAttribute("rowspan") || 1) } }; }, parseHTML() { return [{ tag: "th" }]; }, renderHTML({ HTMLAttributes }) { return ["th", HTMLAttributes, 0]; } }),
  TiptapMark.create({ name: "bold", parseHTML() { return [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }]; }, renderHTML() { return ["strong", 0]; } }),
  TiptapMark.create({ name: "italic", parseHTML() { return [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }]; }, renderHTML() { return ["em", 0]; } }),
  TiptapMark.create({ name: "strike", parseHTML() { return [{ tag: "s" }, { tag: "del" }, { tag: "strike" }]; }, renderHTML() { return ["s", 0]; } }), inlineMark("code", "code"), inlineMark("underline", "u"),
  // coloured words and coloured highlights: kept as an inline colour the server allows (hex or rgb only)
  TiptapMark.create({ name: "textColor", addAttributes() { return { color: { default: null, parseHTML: (el) => el.style.color || null, renderHTML: ({ color }) => (color ? { style: `color: ${color}` } : {}) } }; },
    parseHTML() { return [{ tag: "span", getAttrs: (el) => (el.style.color ? {} : false) }]; }, renderHTML({ HTMLAttributes }) { return ["span", HTMLAttributes, 0]; } }),
  TiptapMark.create({ name: "highlight", addAttributes() { return { color: { default: null, parseHTML: (el) => el.style.backgroundColor || null, renderHTML: ({ color }) => (color ? { style: `background-color: ${color}` } : {}) } }; },
    parseHTML() { return [{ tag: "mark" }, { tag: "span", getAttrs: (el) => (el.style.backgroundColor ? {} : false) }]; }, renderHTML({ HTMLAttributes }) { return ["mark", HTMLAttributes, 0]; } }),
  TiptapMark.create({ name: "link", inclusive: false, addAttributes() { return { href: { default: null }, target: { default: null }, download: { default: null } }; }, parseHTML() { return [{ tag: "a[href]" }]; }, renderHTML({ HTMLAttributes }) { return ["a", HTMLAttributes, 0]; } }),,
  // left / centre / right / justified paragraphs and headings, kept as a text-align the server allows
  TiptapExtension.create({ name: "textAlign",
    addGlobalAttributes() { return [{ types: ["paragraph", "heading"], attributes: { textAlign: { default: null,
      parseHTML: (el) => (["center", "right", "justify"].includes(el.style.textAlign) ? el.style.textAlign : null),
      renderHTML: ({ textAlign }) => (textAlign ? { style: `text-align: ${textAlign}` } : {}) } } }]; },
    addKeyboardShortcuts() { const set = (a) => () => this.editor.commands.updateAttributes(this.editor.isActive("heading") ? "heading" : "paragraph", { textAlign: a }); return { "Mod-Shift-l": set(null), "Mod-Shift-e": set("center") }; } }) // no Shift+R / Shift+J: those reload the page and open downloads in Chrome
];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "disabled") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  if (tag === "input" && !["checkbox", "radio", "file", "hidden", "button"].includes(el.type)) el.classList.add("form-control");
  if (tag === "select") el.classList.add("form-select");
  if (tag === "textarea") el.classList.add("form-control");
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}
function ic(name, size) { const t = document.createElement("template"); t.innerHTML = icon(name, size); return t.content.firstChild; }
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
async function get(path) {
  const r = await fetch(path); const out = await r.json();
  if (!r.ok) throw new Error(out.error || "Something went wrong");
  return out;
}
async function act(action, data = {}) {
  const r = await fetch("/api/notes/do", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...data }) });
  const out = await r.json();
  if (!r.ok) throw new Error(out.error || "Something went wrong");
  return out;
}
function toast(text, bad, undo) {
  if (!text) return;
  toastEl.replaceChildren(h("span", {}, text), ...(undo ? [h("button", { type: "button", onclick: () => { toastEl.hidden = true; undo(); } }, "Undo")] : []));
  toastEl.className = bad ? "bad" : ""; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, bad ? 6000 : undo ? 6000 : 2500);
}
const fail = (error) => toast(error.message || "Can't reach the server. Is the tunnel still open?", true);
function when(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days <= 0) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); if (days === 1) return "Yesterday"; if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
async function loadList() {
  S = await get(`/api/notes/state?view=${encodeURIComponent(view)}&q=${encodeURIComponent(query)}&sort=${sort}`);
}

// ---------- saving ----------
// Typing is saved a moment after you pause. Only what you changed is sent, and never a note you only looked at.
function setSaved(text, bad) {
  saveState = text;
  if (els.saved) { els.saved.textContent = text; els.saved.className = `saved ${bad ? "bad" : text === "Saved" ? "ok" : text ? "busy" : ""}`; }
}
function bodyHTML() { return flowHTML() + (journal ? journal.serialize() : keptLayer); }
function flowHTML() {
  if (tiptap && els.editor && els.editor.contains(tiptap.view.dom)) return tiptap.getHTML().split(ZW).join("").replace(/\sclass="([^"]*)"/g, (attr, value) => {
    const classes = value.split(/\s+/).filter((name) => name && name !== "ph");
    return classes.length ? ` class="${classes.join(" ")}"` : "";
  });
  const ph = els.editor.querySelectorAll(".ph");
  ph.forEach((el) => { el.classList.remove("ph"); if (!el.className) el.removeAttribute("class"); });
  const out = els.editor.innerHTML.split(ZW).join("");
  ph.forEach((el) => el.classList.add("ph"));
  return out;
}
function touched(field) {
  if (!note || note.trashed || conflict) return;
  dirty.add(field); created = null;
  setSaved("Saving…");
  clearTimeout(saveTimer); saveTimer = setTimeout(() => flush().catch(() => {}), SAVE_AFTER);
}
async function flush(force) {
  clearTimeout(saveTimer);
  if (saving) await saving.catch(() => {});
  if (!note || !dirty.size || (conflict && !force)) return;
  const fields = { id: note.id, base: note.updated };
  if (force) fields.force = true;
  if (dirty.has("title")) fields.title = els.title.value;
  if (dirty.has("content")) fields.content = bodyHTML();
  if (dirty.has("tags")) fields.tags = note.tags;
  const sent = new Set(dirty); dirty = new Set();
  const opened = note;
  saving = (async () => {
    try {
      const out = await act("save", fields);
      if (out.conflict) { conflict = out.note; for (const f of sent) dirty.add(f); renderEditor(); setSaved("Not saved", true); return; }
      opened.updated = out.updated;
      if ("content" in fields) opened.content = fields.content; // so switching layouts redraws what you wrote, not what was opened
      if ("title" in fields) opened.title = fields.title;
      if (opened === note) { conflict = null; note.tags = out.tags; setSaved(dirty.size ? "Saving…" : "Saved"); if (els.when) els.when.textContent = `Edited ${when(note.updated)}`; }
      updateCard(fields);
    } catch (error) {
      for (const f of sent) dirty.add(f);
      setSaved("Not saved. Will retry", true);
      clearTimeout(saveTimer); saveTimer = setTimeout(() => flush().catch(() => {}), 4000);
      throw error;
    }
  })();
  try { await saving; } finally { saving = null; }
}
function updateCard(fields) {
  const entry = S && S.notes.find((n) => n.id === fields.id);
  if (!entry) return;
  if ("title" in fields) entry.title = fields.title;
  if ("content" in fields && els.editor) entry.snippet = els.editor.innerText.split(ZW).join("").replace(/\s+/g, " ").trim().slice(0, 200);
  entry.updated = Date.now() / 1000;
  renderList();
}
window.addEventListener("pagehide", () => {
  if (!note || !dirty.size || conflict) return;
  const fields = { action: "save", id: note.id, base: note.updated };
  if (dirty.has("title")) fields.title = els.title.value;
  if (dirty.has("content")) fields.content = bodyHTML();
  if (dirty.has("tags")) fields.tags = note.tags;
  fetch("/api/notes/do", { method: "POST", keepalive: fields.content == null || fields.content.length < 60000, headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) }).catch(() => {});
});

// ---------- switching ----------
async function leaveNote() {
  await flush();
  if (created && note && created === note.id) { await act("discard_empty", { id: created }).catch(() => {}); }
  created = null;
}
async function openNote(id, keepFocus) {
  try {
    if (note && note.id === id) { journalBrowse = false; app.classList.add("reading"); if (theme === "journal") render(); return; }
    await leaveNote();
    if (conflict) return toast("Choose what to do with the changed note first", true);
    note = id ? await get(`/api/notes/note?id=${id}`) : null;
    journalBrowse = false;
    dirty = new Set(); setSaved("");
    app.classList.toggle("reading", !!note);
    await loadList(); render();
    if (keepFocus) { const card = els.cards && els.cards.querySelector(".card.on"); if (card) card.focus(); }
  } catch (error) { fail(error); }
  return null;
}
async function go(next) {
  try {
    await leaveNote();
    if (conflict) { toast("Choose what to do with the changed note first", true); return; }
    view = next; dayFilter = ""; if (theme === "journal") journalBrowse = true; if (next !== "search-keep") query = "";
    try { localStorage.setItem("notes-view", next); } catch (e) { /* remembered until reload */ }
    app.classList.remove("reading", "sideopen");
    await loadList();
    note = S.notes.length ? await get(`/api/notes/note?id=${S.notes[0].id}`) : null;
    dirty = new Set(); render();
  } catch (error) { fail(error); view = "all"; await loadList().catch(() => {}); render(); }
}
// Two kinds of page: "canvas" (the open page you place text boxes, shapes and drawings on) or "plain" (just type).
const KINDS = ["canvas", "plain"];
function lastKind() { try { return localStorage.getItem("notes-new-kind") === "plain" ? "plain" : "canvas"; } catch (e) { return "canvas"; } }
function layerHasItems(html) { if (!html) return false; const t = document.createElement("template"); t.innerHTML = html; const page = t.content.querySelector(".jpage"); return !!page && page.children.length > 0; }
// Asks which kind of page to start. Resolves to "canvas", "plain", or null if you cancel.
function chooseKind() {
  return new Promise((resolve) => {
    if (dialog.open) dialog.close();
    let picked = null;
    const pick = (k) => { picked = k; try { localStorage.setItem("notes-new-kind", k); } catch (e) { /* asks with the default next time */ } dialog.close(); };
    const last = lastKind();
    const option = (k, key, title, text, art) => h("button", { type: "button", class: "kind-opt", "data-kind": k, onclick: () => pick(k) },
      h("span", { class: `kind-art kind-art-${k}`, "aria-hidden": "true" }, art),
      h("span", { class: "kind-name" }, h("b", {}, title), h("kbd", { "aria-hidden": "true" }, key), k === last ? h("small", {}, "Last used") : null),
      h("span", { class: "kind-text" }, text));
    const canvasArt = [h("i", { class: "ka-box" }), h("i", { class: "ka-note" }), h("i", { class: "ka-line" }), h("i", { class: "ka-t1" }), h("i", { class: "ka-t2" }), h("i", { class: "ka-dot" })];
    const plainArt = [h("i", { class: "ka-h" }), ...["96%", "88%", "93%", "60%", "", "90%", "72%"].map((w) => h("i", { class: "ka-row", style: w ? `width:${w}` : "visibility:hidden" }))];
    dialog.className = "kind-dialog";
    dialog.replaceChildren(h("div", { onkeydown: (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = { c: "canvas", 1: "canvas", p: "plain", 2: "plain" }[e.key.toLowerCase()];
      if (k) { e.preventDefault(); pick(k); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const opts = [...dialog.querySelectorAll(".kind-opt")]; opts[(opts.indexOf(document.activeElement) + 1) % opts.length].focus(); }
    } },
      h("h2", {}, "New entry"),
      h("p", {}, "Pick the kind of page to start with."),
      h("div", { class: "kind-opts" },
        option("canvas", "C", "Canvas page", "An open page you can move around. Place text boxes, shapes, lines, drawings and images anywhere.", canvasArt),
        option("plain", "P", "Plain page", "Just type. A clean journal page with nothing in the way.", plainArt)),
      h("div", { class: "kind-foot" }, h("span", {}, "You can switch a page later from its ⋯ menu."), h("button", { type: "button", class: "btn", onclick: () => dialog.close() }, "Cancel"))));
    dialog.addEventListener("close", () => resolve(picked), { once: true });
    dialog.showModal();
    dialog.querySelector(`.kind-opt[data-kind="${last}"]`).focus();
  });
}
async function switchKind() {
  if (!note) return;
  const next = note.kind === "plain" ? "canvas" : "plain";
  const run = async () => {
    await flush(); if (saving) await saving.catch(() => {});
    const out = await act("set_kind", { id: note.id, kind: next });
    note.kind = next; const card = S.notes.find((n) => n.id === note.id); if (card) card.kind = next;
    renderEditor(); renderList();
    return out.message;
  };
  if (next === "plain" && journal && layerHasItems(journal.serialize())) {
    ask("Make it a plain page?", h("p", {}, "The things placed on this page (text boxes, shapes, drawings, images) are kept but hidden while it's plain. Switch back to a canvas page any time to see them again."), "Make It Plain", run);
  } else run().then(toast).catch(fail);
}
async function newNote(initialTag = "", kind) {
  if (typeof initialTag !== "string") initialTag = ""; // buttons pass their click event
  if (!KINDS.includes(kind)) { kind = theme === "journal" ? await chooseKind() : lastKind(); if (!kind) return false; }
  try {
    await leaveNote();
    if (conflict) return false;
    const data = { kind };
    if (typeof initialTag === "string" && initialTag) data.tag = initialTag;
    if (view.startsWith("notebook:")) data.notebook_id = Number(view.slice(9));
    else if (view.startsWith("tag:") && !data.tag) data.tag = view.slice(4);
    if (view === "trash" || view === "starred" || view === "todos") { view = "all"; }
    dayFilter = "";
    query = "";
    const out = await act("new", data);
    journalBrowse = false;
    created = out.id;
    note = await get(`/api/notes/note?id=${out.id}`);
    dirty = new Set(); setSaved("");
    app.classList.add("reading"); app.classList.remove("sideopen");
    await loadList(); render(); els.title.focus();
    return true;
  } catch (error) { fail(error); return false; }
}
function newStudyTemplate(kind) {
  const day = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const templates = {
    lecture: { title: `Lecture notes · ${day}`, body: "<p><b>Course / subject</b> · <b>Unit / lecture</b></p><h2>Core ideas</h2><p><br></p><h2>Details & examples</h2><p><br></p><h2>Questions to revisit</h2><ul class=\"checklist\"><li><br></li></ul><h2>Review summary</h2><p><br></p>" },
    study: { title: `Study session · ${day}`, body: "<p><b>Subject</b> · <b>Session goal</b></p><h2>What I already know</h2><p><br></p><h2>Learn / practice</h2><p><br></p><h2>Recall without looking</h2><p><br></p><h2>Next review</h2><ul class=\"checklist\"><li><br></li></ul>" },
    reading: { title: `Reading notes · ${day}`, body: "<p><b>Text / source</b> · <b>Author</b></p><h2>Main argument</h2><p><br></p><h2>Key passages & annotations</h2><p><br></p><h2>Connections</h2><p><br></p><h2>Questions</h2><p><br></p><h2>Takeaway</h2><p><br></p>" },
  };
  newNote(`${kind}-notes`).then(async (made) => {
    if (!made || !note || !templates[kind]) return; // cancelled: leave the open note alone
    els.title.value = templates[kind].title;
    note.title = templates[kind].title;
    tiptap.commands.setContent(templates[kind].body, { emitUpdate: false });
    note.content = templates[kind].body;
    touched("title"); touched("content");
    tiptap.commands.focus("start"); refreshEditorState();
  });
}
function studyTemplateMenu(anchor) {
  openMenu(anchor, [
    { label: "Lecture notes", icon: "note", run: () => newStudyTemplate("lecture") },
    { label: "Study session", icon: "check", run: () => newStudyTemplate("study") },
    { label: "Reading notes", icon: "book", run: () => newStudyTemplate("reading") },
  ]);
}
async function changed() {
  await loadList();
  if (note && !S.notes.some((n) => n.id === note.id)) note = S.notes.length ? await get(`/api/notes/note?id=${S.notes[0].id}`) : null;
  dirty = new Set(); render();
}
async function trashNote() {
  try {
    created = null; await flush();
    const id = note.id;
    await act("trash", { id });
    app.classList.remove("reading");
    toast("Moved to Trash", false, async () => { try { await act("restore", { id }); await loadList(); await openNote(id); } catch (error) { fail(error); } });
    await changed();
  } catch (error) { fail(error); }
}

// ---------- caret and blocks ----------
const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "PRE", "BLOCKQUOTE", "TD", "TH"]);
const isList = (n) => n && (n.tagName === "UL" || n.tagName === "OL");
function blockOf(node, tags) {
  for (let n = node; n && n !== els.editor; n = n.parentNode) if (n.nodeType === 1 && tags.includes(n.tagName)) return n;
  return null;
}
function focusEditor() { if (tiptap) tiptap.commands.focus(); else if (els.editor) els.editor.focus(); }
function cursor() { const s = getSelection(); return s.rangeCount && els.editor && els.editor.contains(s.anchorNode) ? s.anchorNode : null; }
function caret() { const s = getSelection(); return s.rangeCount && els.editor && els.editor.contains(s.anchorNode) ? s.getRangeAt(0) : null; }
function blockAt(node) {
  for (let n = node; n && n !== els.editor; n = n.parentNode) if (n.nodeType === 1 && BLOCK_TAGS.has(n.tagName)) return n;
  return null;
}
function place(node, offset = 0) { const r = document.createRange(); r.setStart(node, offset); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function placeEnd(el) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function ownRange(block, toStart) { // from the block's start (or to its end) to the caret, leaving out lists nested inside a list item
  const c = caret(); if (!c) return null;
  const r = document.createRange();
  if (toStart) { r.setStart(block, 0); r.setEnd(c.startContainer, c.startOffset); }
  else {
    r.setStart(c.endContainer, c.endOffset);
    const nested = [...block.children].find(isList);
    if (nested) r.setEndBefore(nested); else r.setEnd(block, block.childNodes.length);
  }
  return r;
}
const plain = (s) => s.split(ZW).join("").replace(/ /g, " ");
function textBefore(block) { const r = ownRange(block, true); return r ? plain(r.toString()) : ""; }
function atStart(block) { const r = ownRange(block, true); return !!r && !plain(r.toString()) && !r.cloneContents().querySelector("img,hr,table"); }
function atEnd(block) { const r = ownRange(block, false); return !!r && !plain(r.toString()).replace(/\n$/, "") && !r.cloneContents().querySelector("img,hr,table"); }
function ownText(el) { let t = ""; for (const n of el.childNodes) if (!isList(n)) t += n.textContent; return plain(t); }
function isEmpty(el) { return !ownText(el).trim() && !el.querySelector("img,hr,table,a[download]"); }
function emptyP() { return h("p", {}, h("br")); }
function fill(el) { // an empty block needs a <br> or it collapses and the caret jumps to the line above
  for (const n of [...el.childNodes]) if (n.nodeType === 3 && !n.data) n.remove();
  if (!el.firstChild || isList(el.firstChild)) el.prepend(h("br"));
  return el;
}
function retag(el, tag) { // swap an element for another kind, keeping what's inside
  const next = document.createElement(tag);
  while (el.firstChild) next.append(el.firstChild);
  el.replaceWith(next); return next;
}
function sameList(a, b) { return isList(a) && isList(b) && a.tagName === b.tagName && (a.className || "") === (b.className || ""); }
function mergeAround(list) {
  const prev = list.previousElementSibling, next = list.nextElementSibling;
  if (sameList(prev, list)) { prev.append(...list.childNodes); list.remove(); list = prev; }
  if (sameList(list, next)) { list.append(...next.childNodes); next.remove(); }
  return list;
}
function isolate(li) { // give a list item a list of its own, splitting the list around it
  const list = li.parentNode, after = [];
  for (let n = li.nextSibling; n; n = n.nextSibling) after.push(n);
  if (after.length) { const rest = list.cloneNode(false); rest.append(...after); list.after(rest); }
  if (li.previousSibling) { const own = list.cloneNode(false); own.append(li); list.after(own); return own; }
  return list;
}
// Moving nodes around loses the selection, so remember the caret as a text offset inside an element and put it back.
function caretMark(el) { const r = ownRange(el, true); return r ? r.toString().length : 0; }
function caretRestore(el, offset) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => { for (let p = n.parentNode; p && p !== el; p = p.parentNode) if (isList(p)) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; } });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (offset <= n.length) return place(n, offset);
    offset -= n.length;
  }
  place(el, 0);
}
function edited() { touched("content"); refreshEditorState(); }

// ---------- block changes (Markdown, the / menu and the toolbar all use these) ----------
function liftOut(li) { // a list item becomes a plain paragraph, splitting its list
  const at = caretMark(li), list = isolate(li);
  const p = document.createElement("p"), nested = [];
  for (const n of [...li.childNodes]) { if (isList(n)) nested.push(n); else p.append(n); }
  fill(p); list.replaceWith(p);
  if (nested.length) p.after(...nested);
  caretRestore(p, at); return p;
}
const isHeading = (el) => el && /^H[1-6]$/.test(el.tagName);
function headingInItem(li) { return [...li.children].find(isHeading) || null; }
function isHeadingSequence(list, tag) {
  return !!list && list.tagName === "OL" && list.children.length > 0 && [...list.children].every((li) => headingInItem(li) && headingInItem(li).tagName === tag);
}
function numberedHeadingItem(heading) {
  const li = heading && heading.parentElement;
  return isHeading(heading) && li && li.tagName === "LI" && li.parentElement && li.parentElement.tagName === "OL" && [...li.children].includes(heading) ? li : null;
}
function unwrapNumberedHeading(heading) {
  const li = numberedHeadingItem(heading);
  if (!li) return false;
  const at = caretMark(heading), list = isolate(li), children = [...li.childNodes];
  list.replaceWith(...children); caretRestore(heading, at); return true;
}
function toggleHeadingNumber() {
  const at = cursor(), heading = at && blockOf(at, ["H1", "H2", "H3", "H4", "H5", "H6"]);
  if (!heading) { toast("Place the cursor in a heading first"); return; }
  if (numberedHeadingItem(heading)) unwrapNumberedHeading(heading);
  else {
    if (heading.parentElement.tagName === "LI") { toast("Number a heading at the top level of a list"); return; }
    const tag = heading.tagName, offset = caretMark(heading);
    let list = heading.previousElementSibling;
    if (!isHeadingSequence(list, tag)) {
      list = h("ol"); heading.before(list);
    }
    const li = h("li", {}, heading); list.append(li);
    const next = list.nextElementSibling;
    if (isHeadingSequence(next, tag)) { list.append(...next.childNodes); next.remove(); }
    caretRestore(heading, offset);
  }
  edited(); syncTools();
}
function indent(li) {
  const prev = li.previousElementSibling; if (!prev || prev.tagName !== "LI") return false;
  const at = caretMark(li), list = li.parentNode;
  let sub = [...prev.children].reverse().find(isList);
  if (!sub || sub !== prev.lastElementChild) { sub = list.cloneNode(false); prev.append(sub); }
  sub.append(li); caretRestore(li, at); return true;
}
function outdent(li) {
  const list = li.parentNode, holder = list.parentNode;
  if (!isList(list) || !(holder.tagName === "LI" || isList(holder))) return false;
  const at = caretMark(li), after = [];
  for (let n = li.nextSibling; n; n = n.nextSibling) after.push(n);
  if (after.length) { const rest = list.cloneNode(false); rest.append(...after); li.append(rest); }
  (holder.tagName === "LI" ? holder : list).after(li);
  if (!list.children.length) list.remove();
  caretRestore(li, at); return true;
}
function nested(li) { return li.parentNode && (li.parentNode.parentNode.tagName === "LI" || isList(li.parentNode.parentNode)); }
function toList(block, tag, checklist, checked) {
  const at = caretMark(block);
  if (block.tagName === "LI") { // typed in a list item: just this item changes kind
    fill(block);
    let list = isolate(block);
    if (list.tagName !== tag) list = retag(list, tag);
    list.className = checklist ? "checklist" : ""; if (!list.className) list.removeAttribute("class");
    if (checked) block.className = "checked";
    caretRestore(block, at); mergeAround(list); return block;
  }
  if (block.parentNode.tagName === "BLOCKQUOTE") block = unquote(block);
  const li = document.createElement("li");
  while (block.firstChild) li.append(block.firstChild);
  fill(li); if (checked) li.className = "checked";
  const list = h(tag, { class: checklist ? "checklist" : null }, li);
  block.replaceWith(list); mergeAround(list);
  caretRestore(li, at); return li;
}
function toHeading(block, tag) {
  const at = caretMark(block);
  if (block.tagName === "LI") block = liftOut(block);
  const inNumberedHeading = numberedHeadingItem(block);
  const next = retag(block, tag); fill(next);
  if (!inNumberedHeading && next.parentElement === els.editor) {
    const prev = next.previousElementSibling;
    if (isHeadingSequence(prev, tag)) { const li = h("li", {}, next); prev.append(li); }
  }
  caretRestore(next, at); return next;
}
function toParagraph(block) {
  const at = caretMark(block);
  if (block.tagName === "LI") return liftOut(block);
  if (block.parentNode.tagName === "BLOCKQUOTE") return unquote(block);
  if (block.tagName === "PRE") { const p = h("p"); p.innerHTML = esc(block.textContent).replace(/\n/g, "<br>"); fill(p); block.replaceWith(p); caretRestore(p, at); return p; }
  if (block.tagName === "BLOCKQUOTE") { const p = retag(block, "p"); fill(p); caretRestore(p, at); return p; }
  const p = block.tagName === "P" ? block : retag(block, "p"); fill(p); caretRestore(p, at); return p;
}
function unquote(block) { // move a paragraph out of its quote, splitting the quote
  const quote = block.parentNode, at = caretMark(block), after = [];
  for (let n = block.nextSibling; n; n = n.nextSibling) after.push(n);
  if (after.length) { const rest = h("blockquote"); rest.append(...after); quote.after(rest); }
  quote.after(block);
  if (!quote.textContent.trim() && !quote.querySelector("img")) quote.remove();
  caretRestore(block, at); return block;
}
function toQuote(block) {
  const at = caretMark(block);
  if (block.tagName === "LI") block = liftOut(block);
  if (block.tagName === "BLOCKQUOTE" || block.parentNode.tagName === "BLOCKQUOTE") return block;
  if (/^H\d$|^PRE$/.test(block.tagName)) block = retag(block, "p");
  const quote = h("blockquote"); block.replaceWith(quote); quote.append(block);
  const prev = quote.previousElementSibling; if (prev && prev.tagName === "BLOCKQUOTE") { prev.append(...quote.childNodes); quote.remove(); }
  fill(block); caretRestore(block, at); return block;
}
function toCode(block) {
  if (block.tagName === "LI") block = liftOut(block);
  const pre = h("pre"); pre.textContent = plain(block.innerText || block.textContent).replace(/\n$/, "");
  if (!pre.textContent) pre.append(h("br"));
  block.replaceWith(pre); placeEnd(pre); return pre;
}
function addAfter(block, el) { // put something after the block you're in (or after its list/quote)
  let top = block; while (top.parentNode !== els.editor && top.parentNode) top = top.parentNode;
  if (block.tagName === "LI" && isEmpty(block)) { const p = liftOut(block); p.replaceWith(el); top = el; }
  else if (block.tagName === "P" && block.parentNode === els.editor && isEmpty(block)) { block.replaceWith(el); top = el; }
  else top.after(el);
  let next = el.nextElementSibling;
  if (!next || next.tagName !== "P") { next = emptyP(); el.after(next); }
  place(next, 0); return next;
}
// With the real editor, block changes go through its own commands so the document stays valid.
function tiptapBlock(kind) {
  const ed = tiptap, chain = () => ed.chain().focus(), $f = ed.state.selection.$from;
  let list = null, heading = $f.parent.type.name === "heading" ? $f.parent : null;
  for (let d = $f.depth; d > 0 && !list; d -= 1) if (["bulletList", "orderedList"].includes($f.node(d).type.name)) list = $f.node(d);
  if (kind === "ul" || kind === "check") {
    const want = kind === "check" ? "checklist" : null;
    if (list && list.type.name === "bulletList") return (list.attrs.class || null) === want ? chain().liftListItem("listItem").run() : chain().updateAttributes("bulletList", { class: want }).run();
    if (list) return chain().toggleList("bulletList", "listItem").updateAttributes("bulletList", { class: want }).run(); // numbered → bullets
    return chain().setNode("paragraph").toggleList("bulletList", "listItem").updateAttributes("bulletList", { class: want }).run();
  }
  if (kind === "ol") return list && list.type.name === "orderedList" ? chain().liftListItem("listItem").run() : chain().setNode("paragraph").toggleList("orderedList", "listItem").run();
  if (kind === "p") return chain().setNode("paragraph").run();
  if (/^h[1-6]$/.test(kind)) { const level = Number(kind[1]); return heading && heading.attrs.level === level ? chain().setNode("paragraph").run() : chain().setNode("heading", { level }).run(); }
  if (kind === "quote") return chain().toggleWrap("blockquote").run();
  if (kind === "pre") return chain().toggleNode("codeBlock", "paragraph").run();
  return false;
}
function setBlock(kind) {
  if (tiptapLive()) { tiptapBlock(kind); syncTools(); return; }
  focusEditor();
  const c = caret();
  let block = c && blockAt(c.startContainer);
  if (!block) { document.execCommand("formatBlock", false, "p"); block = cursor() && blockAt(cursor()); if (!block) return; }
  if (["TD", "TH"].includes(block.tagName)) { if (kind !== "p") toast("That can't go inside a table cell"); return; }
  const inList = block.tagName === "LI" ? block.parentNode : null;
  const isCheck = inList && inList.classList.contains("checklist");
  // the toolbar works on every line you selected; the browser does that well for lists and headings
  if (c && !c.collapsed && blockAt(c.endContainer) !== block) {
    if (kind === "ul" || kind === "ol" || kind === "check") {
      document.execCommand(kind === "ol" ? "insertOrderedList" : "insertUnorderedList");
      if (kind === "check") { const ul = cursor() && blockOf(cursor(), ["UL"]); if (ul && ul.parentNode) ul.className = "checklist"; }
      return edited();
    }
    document.execCommand("formatBlock", false, kind === "quote" ? "blockquote" : kind); return edited();
  }
  if (kind === "p") toParagraph(block);
  else if (/^h[1-6]$/.test(kind)) { if (block.tagName === kind.toUpperCase()) toParagraph(block); else toHeading(block, kind.toUpperCase()); }
  else if (kind === "ul") { if (inList && inList.tagName === "UL" && !isCheck) liftAll(inList); else toList(block, "UL", false); }
  else if (kind === "ol") { if (inList && inList.tagName === "OL") liftAll(inList); else toList(block, "OL", false); }
  else if (kind === "check") { if (isCheck) liftAll(inList); else toList(block, "UL", true); }
  else if (kind === "quote") { if (block.parentNode.tagName === "BLOCKQUOTE" || block.tagName === "BLOCKQUOTE") toParagraph(block); else toQuote(block); }
  else if (kind === "pre") { if (block.tagName === "PRE") toParagraph(block); else toCode(block); }
  edited();
}
function liftAll(list) { // the toolbar button for the kind of list you're in turns it back into paragraphs
  const c = caret(), li = c && blockOf(c.startContainer, ["LI"]);
  if (list.children.length === 1 || !li) { if (li) liftOut(li); return; }
  liftOut(li);
}
function insertBlock(kind) {
  focusEditor();
  const c = caret(); const block = (c && blockAt(c.startContainer)) || els.editor.lastElementChild;
  if (kind === "hr") { if (!block) els.editor.append(h("hr"), emptyP()); else addAfter(block, h("hr")); }
  if (kind === "table") {
    const cell = (t) => h(t, {}, h("br"));
    const table = h("table", {}, h("thead", {}, h("tr", {}, cell("th"), cell("th"), cell("th"))), h("tbody", {}, h("tr", {}, cell("td"), cell("td"), cell("td")), h("tr", {}, cell("td"), cell("td"), cell("td"))));
    if (!block) els.editor.append(table, emptyP()); else addAfter(block, table);
    place(table.querySelector("th"), 0);
  }
  edited();
}

// ---------- Markdown as you type ----------
const LINE_RULES = [
  [/^(#{1,3}) $/, (b, m) => toHeading(b, `H${m[1].length}`), "noList"],
  [/^(?:[-*+] )?\[( |x|X)?\] $/, (b, m) => toList(b, "UL", true, /x/i.test(m[1] || ""))],
  [/^[-*+] $/, (b) => toList(b, "UL", false), "noList"],
  [/^(\d+)[.)] $/, (b) => toList(b, "OL", false), "noList"],
  [/^> $/, (b) => toQuote(b), "noList"],
];
function lineShortcut() {
  const c = caret(); if (!c || !c.collapsed) return false;
  const block = blockAt(c.startContainer); if (!block || ["PRE", "TD", "TH"].includes(block.tagName) || blockOf(c.startContainer, ["CODE"])) return false;
  const before = textBefore(block);
  for (const [re, run, rule] of LINE_RULES) {
    const m = before.match(re); if (!m) continue;
    if (rule === "noList" && block.tagName === "LI") continue;
    if (/^H\d$/.test(block.tagName) && !/^#/.test(before)) continue;
    snapshot();
    const r = ownRange(block, true); r.deleteContents();
    run(block, m); edited(); return true;
  }
  return false;
}
const INLINE_RULES = [
  [/\*\*([^*\s](?:[^*]*?[^*\s])?)\*\*$/, "b", 2], [/__([^_\s](?:[^_]*?[^_\s])?)__$/, "b", 2],
  [/~~([^~\s](?:[^~]*?[^~\s])?)~~$/, "s", 2], [/==([^=\s](?:[^=]*?[^=\s])?)==$/, "mark", 2],
  [/`([^`]+)`$/, "code", 1],
  [/(?:^|[^*\w])\*([^*\s](?:[^*]*?[^*\s])?)\*$/, "i", 1], [/(?:^|[^_\w])_([^_\s](?:[^_]*?[^_\s])?)_$/, "i", 1],
  [/\[([^\]]+)\]\(([^)\s]+)\)$/, "a", 0],
];
function inlineShortcut(typed) {
  if (!/[*_~=`)]$/.test(typed || "")) return false;
  const c = caret(); if (!c || !c.collapsed || c.startContainer.nodeType !== 3) return false;
  if (blockOf(c.startContainer, ["CODE", "PRE", "A"])) return false;
  const node = c.startContainer, before = node.data.slice(0, c.startOffset);
  for (const [re, tag, fence] of INLINE_RULES) {
    const m = before.match(re); if (!m) continue;
    let el, token;
    if (tag === "a") {
      const url = safeUrl(m[2]); if (!url) return false;
      token = m[0]; el = h("a", { href: url }, m[1]);
    } else { token = before.slice(before.length - (m[1].length + fence * 2)); el = h(tag, {}, m[1]); }
    snapshot();
    const r = document.createRange(); r.setStart(node, c.startOffset - token.length); r.setEnd(node, c.startOffset);
    r.deleteContents();
    const out = document.createTextNode(ZW); // the caret goes after this, outside the new format
    r.insertNode(out); r.insertNode(el);
    place(out, 1); edited(); return true;
  }
  return false;
}
function safeUrl(typed) {
  const t = (typed || "").trim(); if (!t) return null;
  if (/^#note\/\d+$/.test(t) || /^(https?:\/\/|mailto:)/i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null;
  return /^[\w-]+(\.[\w-]+)+/.test(t) ? `https://${t}` : null;
}
// One Undo step back to what you typed, right after a Markdown shortcut changed a line.
let snap = null;
function snapshot() { const c = caret(); snap = { html: bodyHTML(), at: c ? textOffset(c.startContainer, c.startOffset) : 0 }; }
function textOffset(node, offset) { const r = document.createRange(); r.setStart(els.editor, 0); r.setEnd(node, offset); return r.toString().length; }
function undoShortcut() {
  if (!snap) return false;
  if (tiptap) tiptap.commands.setContent(snap.html, { emitUpdate: false }); else els.editor.innerHTML = snap.html;
  const at = snap.at; snap = null;
  const walk = document.createTreeWalker(els.editor, NodeFilter.SHOW_TEXT); let left = at;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (left <= n.length) { place(n, left); break; } left -= n.length; }
  edited(); return true;
}

// ---------- keys inside the note ----------
function onEnter(e) {
  const c = caret(); if (!c) return;
  const block = blockAt(c.startContainer); if (!block) return;
  if (!c.collapsed) return;
  const li = block.tagName === "LI" ? block : null;
  if (tiptapLive()) { // the real editor owns code blocks; "```" + Enter starts one through its commands
    if (block.tagName === "PRE") return;
    if (!li && /^```[\w+-]*$/.test(ownText(block).trim()) && block.tagName === "P") {
      e.preventDefault(); const { $from } = tiptap.state.selection;
      tiptap.chain().focus().command(({ tr }) => { tr.delete($from.start(), $from.end()); return true; }).setNode("codeBlock").run(); return;
    }
  }
  if (li && isEmpty(li)) { e.preventDefault(); if (nested(li)) outdent(li); else liftOut(li); return edited(); } // Enter twice leaves the list
  if (li && li.classList.contains("checked") && atEnd(li)) { setTimeout(() => { const now = cursor() && blockOf(cursor(), ["LI"]); if (now && now !== li) { now.classList.remove("checked"); if (!now.className) now.removeAttribute("class"); edited(); } }); return; }
  if (block.tagName === "PRE") { e.preventDefault(); preEnter(block); return edited(); }
  const line = ownText(block).trim();
  if (!li && /^(-{3,}|\*{3,}|_{3,})$/.test(line) && !["TD", "TH"].includes(block.tagName)) { e.preventDefault(); snapshot(); const hr = h("hr"); block.replaceWith(hr); const p = emptyP(); hr.after(p); place(p, 0); return edited(); }
  if (!li && /^```[\w+-]*$/.test(line) && !["TD", "TH"].includes(block.tagName)) { e.preventDefault(); snapshot(); const pre = h("pre", {}, h("br")); block.replaceWith(pre); place(pre, 0); return edited(); }
  if (block.parentNode.tagName === "BLOCKQUOTE" && isEmpty(block)) { e.preventDefault(); unquote(block); return edited(); }
  if (block.tagName === "BLOCKQUOTE" && isEmpty(block)) { e.preventDefault(); toParagraph(block); return edited(); }
  if (/^H[1-6]$/.test(block.tagName)) {
    if (isEmpty(block)) { e.preventDefault(); if (numberedHeadingItem(block)) unwrapNumberedHeading(block); toParagraph(block); return edited(); }
    if (atEnd(block)) {
      e.preventDefault();
      const current = numberedHeadingItem(block);
      if (current) {
        const next = h("li", {}, h(block.tagName.toLowerCase(), {}, h("br")));
        current.after(next); place(next.firstElementChild, 0);
      } else { const p = emptyP(); block.after(p); place(p, 0); }
      return edited();
    }
  }
}
// Code blocks hold plain text with real newlines. A lone newline at the very end doesn't show, so the last line keeps a spare one.
function preEnter(pre) {
  const c = caret(), full = pre.textContent, before = full.slice(0, ownRange(pre, true).toString().length), after = full.slice(before.length);
  const atLast = !after.replace(/\n$/, "");
  if (atLast && (!before || before.endsWith("\n"))) { // Enter on a blank last line leaves the code block
    const keep = full.replace(/\n+$/, ""), p = emptyP();
    if (!keep) pre.replaceWith(p); else { pre.textContent = keep; pre.after(p); }
    place(p, 0); return;
  }
  c.deleteContents();
  c.insertNode(document.createTextNode(atLast && !after ? "\n\n" : "\n"));
  pre.querySelectorAll("br").forEach((b) => b.remove());
  pre.normalize(); caretRestore(pre, before.length + 1);
}
function onBackspace(e) {
  const c = caret(); if (!c || !c.collapsed) return;
  const block = blockAt(c.startContainer); if (!block || !atStart(block)) return;
  if (block.tagName === "LI") { e.preventDefault(); if (nested(block)) outdent(block); else liftOut(block); return edited(); }
  if (/^H[1-6]$/.test(block.tagName) || (block.tagName === "PRE" && !block.textContent.trim()) || block.tagName === "BLOCKQUOTE") { e.preventDefault(); toParagraph(block); return edited(); }
  if (block.parentNode.tagName === "BLOCKQUOTE") { e.preventDefault(); unquote(block); return edited(); }
  const prev = block.previousElementSibling;
  if (prev && prev.tagName === "HR" && block.parentNode === els.editor) { e.preventDefault(); prev.remove(); return edited(); }
  if (!prev && block.parentNode === els.editor && isEmpty(block) && els.editor.children.length === 1) { e.preventDefault(); els.title.focus(); }
}
function onTab(e) {
  const c = caret(); if (!c) return;
  const li = blockOf(c.startContainer, ["LI"]), pre = blockOf(c.startContainer, ["PRE"]), cell = blockOf(c.startContainer, ["TD", "TH"]);
  if (li) { e.preventDefault(); if (e.shiftKey ? outdent(li) : indent(li)) edited(); return; }
  if (pre) { e.preventDefault(); if (!e.shiftKey) { document.execCommand("insertText", false, "  "); edited(); } return; }
  if (cell) { // move between table cells
    e.preventDefault();
    const cells = [...cell.closest("table").querySelectorAll("th,td")], i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
    if (cells[i]) { const r = document.createRange(); r.selectNodeContents(cells[i]); getSelection().removeAllRanges(); getSelection().addRange(r); }
    else if (!e.shiftKey) { const row = cell.closest("tr"), copy = h("tr", {}, [...row.children].map(() => h("td", {}, h("br")))); (row.parentNode.tagName === "THEAD" ? cell.closest("table").tBodies[0] || cell.closest("table") : row.parentNode).append(copy); place(copy.firstChild, 0); edited(); }
  }
}
function addListDescription(li) {
  const p = emptyP(), nestedList = [...li.children].find(isList);
  li.insertBefore(p, nestedList || null); place(p, 0); return p;
}
function insertListDescription() {
  const at = cursor(), li = at && blockOf(at, ["LI"]);
  if (!li) { toast("Place the cursor in a list item first"); return; }
  addListDescription(li); edited();
}
function onAltEnter(e) {
  const at = caret(), li = at && blockOf(at.startContainer, ["LI"]);
  if (!li) return false;
  e.preventDefault();
  const block = blockAt(at.startContainer);
  if (block && block.tagName === "P" && block.parentElement === li) {
    const tag = headingInItem(li), list = li.parentElement;
    const next = tag && list.tagName === "OL"
      ? h("li", {}, h(tag.tagName.toLowerCase(), {}, h("br")))
      : h("li", {}, h("br"));
    li.after(next); place(next.firstElementChild, 0);
  } else addListDescription(li);
  edited(); return true;
}
function toggleCheck(li) {
  if (tiptapLive()) { // tick or untick through the editor, so the change sticks and saves
    const $p = tiptap.state.doc.resolve(tiptap.view.posAtDOM(li, 0));
    for (let d = $p.depth; d > 0; d -= 1) { const n = $p.node(d); if (n.type.name === "listItem") { tiptap.view.dispatch(tiptap.state.tr.setNodeMarkup($p.before(d), undefined, { ...n.attrs, class: n.attrs.class === "checked" ? null : "checked" })); return; } }
    return;
  }
  li.classList.toggle("checked"); if (!li.className) li.removeAttribute("class"); edited(); }
function shortcutKeys(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return false;
  const k = e.code;
  const run = (fn) => { e.preventDefault(); fn(); return true; };
  if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "z" && snap) return run(undoShortcut);
  if (e.shiftKey && !e.altKey) {
    if (k === "Digit7") return run(() => setBlock("ol"));
    if (k === "Digit8") return run(() => setBlock("ul"));
    if (k === "Digit9") return run(() => setBlock("check"));
    if (k === "KeyX") return run(() => fmt("strike"));
    if (k === "KeyH") return run(highlight);
    if (k === "Period") return run(() => setBlock("quote"));
  }
  if (e.altKey && !e.shiftKey) {
    const m = /^Digit([0-3])$/.exec(k); if (m) return run(() => setBlock(m[1] === "0" ? "p" : `h${m[1]}`));
    if (k === "KeyC") return run(() => setBlock("pre"));
  }
  if (!e.shiftKey && !e.altKey) {
    if (k === "KeyE") return run(inlineCode);
    if (k === "KeyK") return run(linkDialog);
    if (e.key === "Enter") { const li = cursor() && blockOf(cursor(), ["LI"]); if (li && li.parentNode.classList.contains("checklist")) return run(() => toggleCheck(li)); }
  }
  return false;
}

// ---------- the / menu ----------
const SLASH = [
  { id: "p", label: "Text", hint: "Plain paragraph", icon: "text", words: "paragraph normal plain" },
  { id: "h1", label: "Heading 1", hint: "#", mono: "H1", words: "title big large" },
  { id: "h2", label: "Heading 2", hint: "##", mono: "H2", words: "subtitle medium" },
  { id: "h3", label: "Heading 3", hint: "###", mono: "H3", words: "small" },
  { id: "ul", label: "Bulleted list", hint: "-", icon: "list", words: "bullet unordered points" },
  { id: "ol", label: "Numbered list", hint: "1.", icon: "olist", words: "ordered number" },
  { id: "check", label: "Checklist", hint: "[]", icon: "task", words: "todo to-do task checkbox" },
  { id: "quote", label: "Quote", hint: ">", icon: "quote", words: "blockquote citation" },
  { id: "pre", label: "Code block", hint: "```", icon: "code", words: "snippet monospace" },
  { id: "hr", label: "Divider", hint: "---", icon: "minus", words: "line rule separator hr" },
  { id: "table", label: "Table", hint: "3 × 3", icon: "table", words: "grid rows columns" },
  { id: "image", label: "Image", hint: "Upload a picture", icon: "image", words: "photo picture png jpg" },
  { id: "file", label: "Attach a file", hint: "PDF, Word… up to 15 MB", icon: "clip", words: "attachment pdf upload" },
  { id: "note", label: "Link to a note", hint: "[[", icon: "note", words: "wiki backlink" },
  { id: "link", label: "Web link", hint: `${MOD}K`, icon: "link", words: "url address" },
];
let slash = null;
function closeSlash() { if (slash) { slash.el.remove(); slash = null; } }
function slashTyped() {
  const c = caret(); if (!c || !c.collapsed || c.startContainer.nodeType !== 3) return closeSlash();
  const block = blockAt(c.startContainer); if (!block || block.tagName === "PRE" || blockOf(c.startContainer, ["CODE"])) return closeSlash();
  const node = c.startContainer, before = node.data.slice(0, c.startOffset);
  const m = before.match(/(^|[\s ])\/([\w -]{0,24})$/);
  if (!m || (m[1] === "" && textBefore(block).length !== m[0].length)) return closeSlash();
  const q = m[2].toLowerCase().trim();
  const items = SLASH.filter((it) => !q || `${it.label} ${it.words} ${it.hint}`.toLowerCase().includes(q));
  if (!items.length && m[2].length > 2) return closeSlash();
  if (!slash) { slash = { el: h("div", { class: "menu", role: "listbox", "aria-label": "Insert" }), pick: 0 }; document.body.append(slash.el); }
  Object.assign(slash, { node, start: c.startOffset - m[2].length - 1, end: c.startOffset, items, pick: Math.min(slash.pick, Math.max(items.length - 1, 0)) });
  paintSlash();
  const rect = c.getBoundingClientRect(), box = rect.top || rect.left ? rect : node.parentElement.getBoundingClientRect();
  const below = innerHeight - box.bottom > 260;
  slash.el.style.left = `${Math.min(box.left, innerWidth - 250)}px`;
  slash.el.style.top = below ? `${box.bottom + 6}px` : ""; slash.el.style.bottom = below ? "" : `${innerHeight - box.top + 6}px`;
}
function paintSlash() {
  if (!slash) return;
  slash.el.replaceChildren(...(slash.items.length ? [h("div", { class: "mh" }, "Blocks"), ...slash.items.map((it, i) => h("button", { type: "button", class: `mi ${i === slash.pick ? "on" : ""}`, role: "option", "aria-selected": String(i === slash.pick), onmousedown: (e) => { e.preventDefault(); runSlash(it); } },
    h("span", { class: "mic" }, it.icon ? ic(it.icon, 15) : it.mono), h("span", { class: "ml" }, it.label, h("small", {}, it.hint))))] : [h("div", { class: "lp none" }, "No matching block")]));
  const on = slash.el.querySelector(".mi.on"); if (on) on.scrollIntoView({ block: "nearest" });
}
function runSlash(it) {
  const p = slash; closeSlash(); if (!p) return;
  const r = document.createRange(); r.setStart(p.node, p.start); r.setEnd(p.node, Math.min(p.end, p.node.length)); r.deleteContents();
  place(p.node, p.start);
  if (["p", "h1", "h2", "h3", "ul", "ol", "check", "quote", "pre"].includes(it.id)) setBlock(it.id);
  else if (it.id === "hr" || it.id === "table") insertBlock(it.id);
  else if (it.id === "image") pickImage();
  else if (it.id === "file") pickFile();
  else if (it.id === "note") { document.execCommand("insertText", false, "[["); linkTyped(); }
  else if (it.id === "link") linkDialog();
  touched("content");
}
function slashKeys(e) {
  if (!slash) return false;
  if (e.key === "Escape") { e.preventDefault(); closeSlash(); return true; }
  if (!slash.items.length) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); slash.pick = (slash.pick + (e.key === "ArrowDown" ? 1 : slash.items.length - 1)) % slash.items.length; paintSlash(); return true; }
  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); runSlash(slash.items[slash.pick]); return true; }
  return false;
}

// ---------- inline tools ----------
// ---------- one toolbar for whatever text you're in: the entry, or a text box / sticky note on the journal page ----------
const TEXT_COLORS = { white: "#ece9e0", sage: "#b9d39a", blue: "#8fb6ff", red: "#ff9a8f", orange: "#ffb26b", gold: "#f0cf7a", purple: "#c9a8ff", pink: "#ff9ccf", teal: "#7fd6c8", grey: "#8f978e" };
const HIGHLIGHTS = { yellow: "#ffe14d", green: "#8ee08a", blue: "#83c8ff", pink: "#ff8fb8", orange: "#ffb35c", purple: "#c49bff" }; // shown at 40% so light text stays readable
let lastBox = null, lastBoxRange = null; // the text box you were typing in (and its selection), so the toolbar still formats it
document.addEventListener("selectionchange", () => { const sel = getSelection(); if (sel.rangeCount && sel.anchorNode && sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest(".jlayer [contenteditable=true]")) lastBoxRange = sel.getRangeAt(0).cloneRange(); });
document.addEventListener("focusin", (e) => { const b = e.target.closest && e.target.closest(".jlayer [contenteditable=true]"); lastBox = b || (e.target.closest && e.target.closest(".tiptap, .titlein") ? null : lastBox); });
function boxTarget() { const a = document.activeElement; if (a && a.closest && a.closest(".jlayer [contenteditable=true]")) return a; return lastBox && lastBox.isConnected && (document.activeElement === document.body || (a && a.closest && a.closest(".jcolor"))) ? lastBox : null; }
function fmt(what, value, range) { // range: the entry selection to colour, saved before a picker took focus
  const box = range ? null : boxTarget();
  if (box) { // a text box is plain contenteditable: the browser's own commands, colours as inline styles
    box.focus();
    const css = what === "color" || what === "highlight";
    document.execCommand("styleWithCSS", false, css);
    if (what === "color") document.execCommand("foreColor", false, value || getComputedStyle(box).color);
    else if (what === "highlight") document.execCommand("hiliteColor", false, value || "transparent");
    else document.execCommand({ bold: "bold", italic: "italic", underline: "underline", strike: "strikeThrough" }[what]);
    document.execCommand("styleWithCSS", false, false);
    return;
  }
  if (tiptapLive()) {
    const c = tiptap.chain().focus();
    if (range) c.setTextSelection(range);
    if (what === "color") (value ? c.setMark("textColor", { color: value }) : c.unsetMark("textColor")).run();
    else if (what === "highlight") (value ? c.setMark("highlight", { color: value }) : c.unsetMark("highlight")).run();
    else c.toggleMark(what).run();
    syncTools(); return;
  }
  if (what === "color" || what === "highlight") { focusEditor(); document.execCommand("styleWithCSS", false, true); document.execCommand(what === "color" ? "foreColor" : "hiliteColor", false, value || (what === "color" ? getComputedStyle(els.editor).color : "transparent")); document.execCommand("styleWithCSS", false, false); edited(); return; }
  exec({ bold: "bold", italic: "italic", underline: "underline", strike: "strikeThrough" }[what]);
}
let lastHighlight = rgba(HIGHLIGHTS.yellow, 0.4);
function colorTool(kind) { // the A (text colour) and highlighter buttons: click opens the picker with presets, recent, wheel and hex/rgb
  const isText = kind === "color";
  const bar = h("i", { class: "tb-swatch", style: `background:${isText ? "var(--text)" : lastHighlight}` });
  const b = h("button", { type: "button", class: "tb btn btn-sm tb-color", title: isText ? "Text colour" : `Highlight colour  ${MOD}${SHIFT}H`, "aria-label": isText ? "Text colour" : "Highlight colour", "aria-haspopup": "dialog",
    onmousedown: (e) => e.preventDefault(),
    onclick: () => {
      const box = boxTarget(), keep = !box && getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
      const entryRange = !box && tiptapLive() ? { from: tiptap.state.selection.from, to: tiptap.state.selection.to } : null;
      openColorPicker(b, { title: isText ? "Text colour" : "Highlight colour", presets: isText ? TEXT_COLORS : HIGHLIGHTS, none: isText ? "Default colour" : "No highlight",
        onPick: (hex) => {
          if (box) box.focus(); else if (!entryRange) focusEditor();
          if (keep && !entryRange) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(keep); }
          const value = hex ? (isText ? hex : rgba(hex, 0.4)) : null;
          if (!isText && value) { lastHighlight = value; bar.style.background = value; }
          if (isText) bar.style.background = hex || "var(--text)";
          if (box) { const sel = getSelection(); if (lastBoxRange && box.contains(lastBoxRange.startContainer)) { sel.removeAllRanges(); sel.addRange(lastBoxRange); } }
          fmt(kind, value, entryRange);
        } });
    } }, isText ? h("span", { class: "tb-a" }, "A") : ic("hilite", 16), bar);
  return b;
}
function exec(command, value) { focusEditor(); document.execCommand(command, false, value); edited(); syncTools(); }
function wrapSelection(tag, why) {
  focusEditor();
  const s = getSelection();
  if (!s.rangeCount || !els.editor.contains(s.anchorNode)) return;
  const inside = blockOf(s.anchorNode, [tag.toUpperCase()]);
  if (inside) { const at = s.getRangeAt(0).cloneRange(); inside.replaceWith(...inside.childNodes); s.removeAllRanges(); s.addRange(at); edited(); return; }
  if (s.isCollapsed) { toast(why); return; }
  const range = s.getRangeAt(0), el = document.createElement(tag);
  if (tag === "code") el.textContent = range.toString(); else el.append(range.extractContents());
  range.deleteContents(); range.insertNode(el);
  const r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); edited();
}
const highlight = () => (boxTarget() || tiptapLive() ? fmt("highlight", (tiptapLive() && !boxTarget() && tiptap.isActive("highlight")) ? null : lastHighlight) : wrapSelection("mark", "Select some text to highlight first"));
const inlineCode = () => wrapSelection("code", "Select some text first");
function linkDialog() {
  const s = getSelection();
  const saved = s.rangeCount && els.editor.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
  const existing = saved && blockOf(saved.startContainer, ["A"]);
  if (!saved) { toast("Click in the note first"); return; }
  const text = h("input", { value: existing ? existing.textContent : saved.toString(), placeholder: "Text to show" });
  const url = h("input", { placeholder: "https://example.com", required: true, value: existing ? existing.getAttribute("href") : "" });
  ask(existing ? "Edit link" : "Add a link", [h("label", { class: "field" }, "Text", text), h("div", { style: "height:10px" }), h("label", { class: "field" }, "Address", url)], existing ? "Save" : "Add", async () => {
    const value = safeUrl(url.value);
    if (!value) throw new Error("Use a web or email address, like https://example.com");
    dialog.close();
    focusEditor(); s.removeAllRanges();
    if (existing) { existing.setAttribute("href", value); existing.textContent = text.value.trim() || value; placeEnd(existing); }
    else { s.addRange(saved); document.execCommand("insertHTML", false, `<a href="${esc(value)}">${esc(text.value.trim() || value)}</a>${ZW}`); }
    edited(); return null;
  });
  (saved.collapsed && !existing ? text : url).focus();
}
function addImage(file) {
  if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { toast("Use a PNG, JPEG, GIF or WebP image", true); return; }
  if (file.size > MAX_IMAGE) { toast("That image is over 10 MB. Try a smaller one", true); return; }
  const reader = new FileReader();
  reader.onload = () => { if (tiptapLive()) tiptap.chain().focus().insertContent({ type: "image", attrs: { src: reader.result } }).run(); else exec("insertImage", reader.result); };
  reader.readAsDataURL(file);
}
function pickImage() {
  const saved = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
  const picker = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", style: "display:none" });
  picker.onchange = () => {
    if (saved && els.editor.contains(saved.startContainer)) { focusEditor(); const s = getSelection(); s.removeAllRanges(); s.addRange(saved); }
    addImage(picker.files[0]); picker.remove();
  };
  document.body.append(picker); picker.click();
}

// ---------- toolbar ----------
function syncTools() {
  if (!els.block || !els.editor) return;
  syncAlign();
  const at = cursor(); if (!at) return;
  const quote = blockOf(at, ["BLOCKQUOTE"]), pre = blockOf(at, ["PRE"]), head = blockOf(at, ["H1", "H2", "H3"]);
  els.block.value = pre ? "pre" : quote ? "quote" : head ? head.tagName.toLowerCase() : "p";
  const list = blockOf(at, ["UL", "OL"]);
  const kind = !list ? "" : list.tagName === "OL" ? "ol" : list.classList.contains("checklist") ? "check" : "ul";
  for (const [button, command] of els.toggles) {
    let on;
    if (command === "mark" || command === "code") on = !!blockOf(at, [command.toUpperCase()]);
    else if (command === "link") on = !!blockOf(at, ["A"]);
    else if (command === "headingNumber") on = !!numberedHeadingItem(blockOf(at, ["H1", "H2", "H3", "H4", "H5", "H6"]));
    else if (["ul", "ol", "check"].includes(command)) on = kind === command;
    else on = document.queryCommandState(command);
    button.classList.toggle("on", on); button.setAttribute("aria-pressed", String(on));
  }
}
function toolBtn(name, label, keys, action, command) {
  const b = h("button", { type: "button", class: "tb btn btn-sm", title: keys ? `${label}  ${keys}` : label, "aria-label": label, onmousedown: (e) => e.preventDefault(), onclick: action }, ic(name, 16));
  if (command) els.toggles.push([b, command]);
  return b;
}
// Align: one button showing the current alignment; its menu has left, centre, right and justified
const ALIGNS = [["left", "Align left", `${MOD}${SHIFT}L`], ["center", "Centre", `${MOD}${SHIFT}E`], ["right", "Align right", ""], ["justify", "Justify", ""]];
const ALIGN_ICON = { left: "M4 6h16M4 10h10M4 14h16M4 18h10", center: "M4 6h16M7 10h10M4 14h16M7 18h10", right: "M4 6h16M10 10h10M4 14h16M10 18h10", justify: "M4 6h16M4 10h16M4 14h16M4 18h16" };
const alignIcon = (a, size = 16) => { const t = document.createElement("template"); t.innerHTML = `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="${ALIGN_ICON[a]}"/></svg>`; return t.content.firstChild; };
function currentAlign() {
  const box = boxTarget();
  if (box) { const sel = getSelection(), n = sel.rangeCount && sel.anchorNode, blk = n && (n.nodeType === 1 ? n : n.parentElement).closest("p, div, h1, h2, h3, li"); const a = getComputedStyle(blk && box.contains(blk) ? blk : box).textAlign; return a === "start" ? "left" : a; }
  if (tiptapLive()) { for (const a of ["center", "right", "justify"]) if (tiptap.isActive({ textAlign: a })) return a; }
  return "left";
}
function setAlign(a) {
  const box = boxTarget();
  if (box) { box.focus(); document.execCommand({ left: "justifyLeft", center: "justifyCenter", right: "justifyRight", justify: "justifyFull" }[a]); box.dispatchEvent(new Event("input", { bubbles: true })); syncAlign(); return; }
  if (tiptapLive()) { tiptap.chain().focus().updateAttributes("paragraph", { textAlign: a === "left" ? null : a }).updateAttributes("heading", { textAlign: a === "left" ? null : a }).run(); syncAlign(); }
}
function syncAlign() { if (!els.align) return; const a = currentAlign(); els.align.replaceChildren(alignIcon(a), ic("down", 11)); els.align.title = `Alignment: ${ALIGNS.find((x) => x[0] === a)[1].toLowerCase()}`; }
function alignTool() {
  const b = h("button", { type: "button", class: "tb btn btn-sm tb-align", "aria-haspopup": "menu", "aria-label": "Text alignment", title: "Text alignment", onmousedown: (e) => e.preventDefault(),
    onclick: () => { const cur = currentAlign(); openMenu(b, ALIGNS.map(([a, label, keys]) => ({ label: cur === a ? `${label}  ✓` : label, keys, run: () => setAlign(a) }))); } }, alignIcon("left"), ic("down", 11));
  els.align = b; return b;
}
function toolbar() {
  els.toggles = [];
  els.block = h("select", { "aria-label": "Text style", title: "Text style", onchange: () => { setBlock(els.block.value); syncTools(); } },
    h("option", { value: "p" }, "Text"), h("option", { value: "h1" }, "Heading 1"), h("option", { value: "h2" }, "Heading 2"), h("option", { value: "h3" }, "Heading 3"), h("option", { value: "quote" }, "Quote"), h("option", { value: "pre" }, "Code block"));
  const insertBtn = h("button", { type: "button", class: "tb btn btn-sm", "aria-haspopup": "menu", title: "Insert", onmousedown: (e) => e.preventDefault(), onclick: () => openMenu(insertBtn, [
    { label: "Table", icon: "table", run: () => insertBlock("table") },
    { label: "Divider", icon: "minus", keys: "---", run: () => insertBlock("hr") },
    { label: "Description under list item", icon: "text", keys: "Alt+Enter", run: insertListDescription },
    { label: "Code block", icon: "code", keys: "```", run: () => setBlock("pre") },
    "-",
    { label: "Image", icon: "image", run: pickImage },
    { label: "Attach a file", icon: "clip", run: pickFile },
    "-",
    { label: "Link to a note", icon: "note", keys: "[[", run: noteLinkDialog },
  ]) }, ic("plus", 15), "Insert", ic("down", 13));
  return h("div", { class: "tools", role: "toolbar", "aria-label": "Formatting" }, els.block, h("span", { class: "sep" }),
    toolBtn("bold", "Bold", `${MOD}B`, () => fmt("bold"), "bold"), toolBtn("italic", "Italic", `${MOD}I`, () => fmt("italic"), "italic"),
    toolBtn("underline", "Underline", `${MOD}U`, () => fmt("underline"), "underline"), toolBtn("strike", "Strikethrough", `${MOD}${SHIFT}X`, () => fmt("strike"), "strikeThrough"),
    colorTool("color"), colorTool("highlight"), alignTool(), toolBtn("code", "Inline code", `${MOD}E`, inlineCode, "code"), toolBtn("link", "Link", `${MOD}K`, () => linkDialog(), "link"),
    h("span", { class: "sep" }),
    toolBtn("list", "Bulleted list", `${MOD}${SHIFT}8`, () => setBlock("ul"), "ul"), toolBtn("olist", "Numbered list", `${MOD}${SHIFT}7`, () => setBlock("ol"), "ol"), toolBtn("headingNumber", "Toggle numbered heading", null, toggleHeadingNumber, "headingNumber"), toolBtn("task", "Checklist", `${MOD}${SHIFT}9`, () => setBlock("check"), "check"),
    h("span", { class: "sep" }), insertBtn, h("span", { class: "grow" }),
    h("button", { type: "button", class: "tb btn btn-sm", title: "Markdown and keyboard shortcuts", "aria-label": "Markdown and keyboard shortcuts", onclick: shortcutsDialog }, ic("help", 16)));
}

// ---------- menus ----------
let menu = null;
function closeMenu() { if (menu) { menu.el.remove(); document.removeEventListener("mousedown", menu.away, true); const back = menu.back; menu = null; if (back && document.contains(back)) back.focus(); } }
function openMenu(anchor, items) {
  if (menu && menu.anchor === anchor) return closeMenu();
  closeMenu();
  const keep = els.editor && cursor() ? getSelection().getRangeAt(0).cloneRange() : null;
  const buttons = [];
  const el = h("div", { class: "menu", role: "menu", onkeydown: (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length].focus(); }
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
  } }, items.filter(Boolean).map((it) => {
    if (it === "-") return h("hr");
    const b = h("button", { type: "button", class: `mi ${it.danger ? "danger" : ""}`, role: "menuitem", onclick: () => {
      menu.back = null; closeMenu();
      if (keep && els.editor && document.contains(keep.startContainer)) { focusEditor(); const s = getSelection(); s.removeAllRanges(); s.addRange(keep); }
      it.run();
    } }, it.icon ? ic(it.icon, 16) : null, h("span", { class: "ml" }, it.label), it.keys ? h("kbd", {}, it.keys) : null);
    buttons.push(b); return b;
  }));
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  el.style.top = `${Math.min(r.bottom + 4, innerHeight - el.offsetHeight - 8)}px`;
  el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8))}px`;
  menu = { el, anchor, back: anchor, away: (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); } };
  document.addEventListener("mousedown", menu.away, true);
  if (buttons[0] && !keep) buttons[0].focus();
}

// ---------- link bubble: see where a link goes, open, edit or remove it ----------
let bubble = null;
function closeBubble() { if (bubble) { bubble.remove(); bubble = null; } }
function linkBubble() {
  const at = cursor(); const a = at && blockOf(at, ["A"]);
  if (!a || a.hasAttribute("download") || (slash || linkPop)) return closeBubble();
  const href = a.getAttribute("href") || "", isNote = /^#note\/\d+$/.test(href);
  if (bubble && bubble.link === a) return;
  closeBubble();
  bubble = h("div", { class: "linkbubble", role: "toolbar", "aria-label": "Link", onmousedown: (e) => e.preventDefault() },
    h("span", { class: "url", title: href }, isNote ? "Note link" : href.replace(/^mailto:/, "")),
    h("button", { type: "button", onclick: () => { if (isNote) openNote(Number(href.slice(6))); else window.open(href, "_blank", "noopener"); } }, "Open ↗"),
    isNote ? null : h("button", { type: "button", onclick: () => { closeBubble(); linkDialog(); } }, "Edit"),
    h("button", { type: "button", onclick: () => { closeBubble(); a.replaceWith(...a.childNodes); edited(); } }, "Remove"));
  bubble.link = a;
  document.body.append(bubble);
  const r = a.getBoundingClientRect();
  bubble.style.left = `${Math.max(8, Math.min(r.left, innerWidth - bubble.offsetWidth - 8))}px`;
  bubble.style.top = `${r.bottom + 6}px`;
}

// ---------- the placeholder on the empty line you're on, and the word count ----------
let countTimer = null;
function refreshEditorState() {
  if (!els.editor) return;
  const blank = !els.editor.textContent.split(ZW).join("").trim() && !els.editor.querySelector("img,table,hr,li,pre,blockquote,a[download]") && els.editor.querySelectorAll("p,h1,h2,h3,div:not(.tiptap)").length <= 1;
  els.editor.classList.toggle("blanknote", blank);
  const at = document.activeElement === els.editor ? cursor() : null, block = at && blockAt(at);
  for (const el of els.editor.querySelectorAll(".ph")) if (el !== block) { el.classList.remove("ph"); if (!el.className) el.removeAttribute("class"); }
  if (block && !["TD", "TH", "PRE", "BLOCKQUOTE"].includes(block.tagName) && isEmpty(block)) block.classList.add("ph");
  else if (block) { block.classList.remove("ph"); if (!block.className) block.removeAttribute("class"); }
  clearTimeout(countTimer); countTimer = setTimeout(countWords, 300);
}
function countWords() {
  if (!els.words || !els.editor) return;
  const words = (els.editor.innerText.split(ZW).join("").match(/[\p{L}\p{N}'’-]+/gu) || []).length;
  els.words.textContent = `${words.toLocaleString()} word${words === 1 ? "" : "s"}`;
}

function tiptapLive() { return !!tiptap && !(tiptap instanceof NativeEditorFallback); }
function inListItem() { const at = cursor(); const el = at && (at.nodeType === 1 ? at : at.parentNode); return !!(el && el.closest && el.closest(".tiptap li")); }
function editorEvents(editor) {
  editor.addEventListener("mousedown", () => { snap = null; });
  editor.addEventListener("input", (e) => {
    if (e.isComposing) return;
    if (e.inputType === "insertText" && e.data === " " && lineShortcut()) { closeSlash(); return; }
    if (e.inputType === "insertText" && inlineShortcut(e.data)) return;
    touched("content"); refreshEditorState(); linkTyped(); slashTyped();
  });
  editor.addEventListener("focus", refreshEditorState);
  editor.addEventListener("blur", () => setTimeout(() => { closeLinkPop(); closeSlash(); if (document.activeElement !== els.editor) { closeBubble(); refreshEditorState(); } }, 150));
  editor.addEventListener("click", (e) => {
    const link = e.target.closest && e.target.closest("a");
    if (link && /^#note\/\d+$/.test(link.getAttribute("href") || "") && (e.metaKey || e.ctrlKey || editor.contentEditable === "false")) { e.preventDefault(); openNote(Number(link.getAttribute("href").slice(6))); return; }
    if (link && link.hasAttribute("download")) { e.preventDefault(); openAttachment(link); return; }
    if (link && (e.metaKey || e.ctrlKey)) { window.open(link.href, "_blank", "noopener"); e.preventDefault(); return; }
    if (link && editor.contentEditable === "false") { window.open(link.href, "_blank", "noopener"); e.preventDefault(); return; }
    const li = e.target.tagName === "LI" && e.target.parentNode.classList.contains("checklist") ? e.target : null;
    if (li && e.clientX - li.getBoundingClientRect().left < parseFloat(getComputedStyle(li).paddingLeft) && !note.trashed) { e.preventDefault(); toggleCheck(li); }
  });
  editor.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (slashKeys(e) || linkPopKeys(e)) return;
    if (!["Shift", "Control", "Meta", "Alt"].includes(e.key) && !((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z")) snap = null; // Undo of a Markdown change only works right after it
    if (shortcutKeys(e)) return;
    // inside a list, the real editor's own list keys do the work (the old line-by-line code can't see Tiptap's list items)
    if (tiptapLive() && ["Enter", "Tab", "Backspace"].includes(e.key) && !e.altKey && !e.metaKey && !e.ctrlKey && inListItem()) return;
    if (e.key === "Enter" && e.altKey && !e.metaKey && !e.ctrlKey && onAltEnter(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) { onEnter(e); return; }
    if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) { onBackspace(e); return; }
    if (e.key === "Tab") { onTab(e); return; }
    if (e.key === "ArrowUp" && !e.shiftKey) { const c = caret(); if (c && c.collapsed && textOffset(c.startContainer, c.startOffset) === 0) { e.preventDefault(); els.title.focus(); els.title.setSelectionRange(els.title.value.length, els.title.value.length); } }
    if (e.key === "Escape" && focusMode) { setFocus(false); }
  }, true);
  editor.addEventListener("keyup", () => { syncTools(); });
  editor.addEventListener("mouseup", syncTools);
  editor.addEventListener("paste", (e) => {
    const data = e.clipboardData; if (!data) return;
    const image = [...data.files].find((f) => f.type.startsWith("image/")), other = [...data.files].find((f) => !f.type.startsWith("image/"));
    e.preventDefault();
    if (image) return addImage(image);
    if (other) return attachFile(other);
    const text = data.getData("text/plain"); if (!text) return;
    const at = cursor(), url = text.trim();
    if (/^https?:\/\/\S+$/.test(url) && !getSelection().isCollapsed && !(at && blockOf(at, ["PRE", "CODE"]))) { document.execCommand("createLink", false, url); return edited(); } // paste a link over selected words
    if ((at && blockOf(at, ["PRE", "CODE"])) || !looksLikeMarkdown(text)) { document.execCommand("insertText", false, text); return; }
    document.execCommand("insertHTML", false, mdToHtml(text)); edited();
  });
  const copy = (e) => {
    const s = getSelection(); if (!s.rangeCount || s.isCollapsed) return;
    const box = h("div"); box.append(s.getRangeAt(0).cloneContents());
    if (!box.querySelector("p,h1,h2,h3,h4,li,pre,blockquote,b,strong,i,em,code,mark,s,del,strike,a,hr,table")) return;
    e.clipboardData.setData("text/plain", htmlToMd(box).trim()); e.clipboardData.setData("text/html", box.innerHTML.split(ZW).join(""));
    e.preventDefault();
    if (e.type === "cut") { document.execCommand("delete"); edited(); }
  };
  editor.addEventListener("copy", copy); editor.addEventListener("cut", copy);
  editor.addEventListener("drop", (e) => {
    const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
    const image = files.find((f) => f.type.startsWith("image/")), other = files.find((f) => !f.type.startsWith("image/"));
    if (image) { e.preventDefault(); addImage(image); } else if (other) { e.preventDefault(); attachFile(other); }
  });
}

// ---------- Markdown in and out ----------
function looksLikeMarkdown(text) {
  return /\n/.test(text.trim()) || /^(#{1,6} |[-*+] |\d+[.)] |> |```|- \[[ xX]\] )/m.test(text) || /\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|~~[^~]+~~|==[^=]+==/.test(text);
}
function mdInline(s) {
  const codes = [];
  let out = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${c}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, alt, src) => `<img src="${src}" alt="${alt}">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => { const url = safeUrl(u.replace(/&amp;/g, "&")); return url ? `<a href="${esc(url)}">${t}</a>` : m; })
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (_, pre, u) => `${pre}<a href="${u}">${u}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<i>$2</i>").replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<i>$2</i>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>").replace(/==([^=]+)==/g, "<mark>$1</mark>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[i]);
}
function mdToHtml(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"), out = [];
  const listRe = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { const body = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]); i++; out.push(`<pre>${esc(body.join("\n")) || "<br>"}</pre>`); continue; }
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) { const n = Math.min(m[1].length, 3); out.push(`<h${n}>${mdInline(m[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\s*>/.test(line)) { const body = []; while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, "")); out.push(`<blockquote>${mdToHtml(body.join("\n"))}</blockquote>`); continue; }
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => mdInline(c.trim()) || "<br>");
      const head = cells(line); i += 2; const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (listRe.test(line)) {
      const items = [];
      while (i < lines.length && listRe.test(lines[i])) { const [, sp, mark, box, body] = lines[i++].match(listRe); items.push({ depth: sp.replace(/\t/g, "    ").length, tag: /\d/.test(mark) ? "ol" : "ul", box, body }); }
      out.push(buildList(items, 0, items.length ? items[0].depth : 0).html); continue;
    }
    if (!line.trim()) { i++; continue; }
    out.push(`<p>${mdInline(line)}</p>`); i++;
  }
  return out.join("");
}
function buildList(items, start, depth) {
  let i = start, html = "", open = null;
  while (i < items.length && items[i].depth >= depth) {
    const it = items[i];
    if (it.depth > depth) { const sub = buildList(items, i, it.depth); html = html.replace(/<\/li>$/, `${sub.html}</li>`); i = sub.next; continue; }
    const kind = it.box != null ? "check" : it.tag;
    if (open !== kind) { if (open) html += `</${open === "ol" ? "ol" : "ul"}>`; html += kind === "check" ? '<ul class="checklist">' : `<${kind}>`; open = kind; }
    html += `<li${it.box && /x/i.test(it.box) ? ' class="checked"' : ""}>${mdInline(it.body) || "<br>"}</li>`; i++;
  }
  if (open) html += `</${open === "ol" ? "ol" : "ul"}>`;
  return { html, next: i };
}
function htmlToMd(root) {
  const inline = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return n.data.split(ZW).join("").replace(/ /g, " ");
    if (n.nodeType !== 1 || isList(n)) return "";
    const t = n.tagName, x = inline(n);
    if (t === "B" || t === "STRONG") return x.trim() ? `**${x}**` : x;
    if (t === "I" || t === "EM") return x.trim() ? `*${x}*` : x;
    if (t === "S" || t === "DEL" || t === "STRIKE") return `~~${x}~~`;
    if (t === "MARK") return `==${x}==`;
    if (t === "CODE") return `\`${n.textContent}\``;
    if (t === "BR") return "\n";
    if (t === "IMG") return /^data:/.test(n.getAttribute("src") || "") ? "![image]" : `![${n.getAttribute("alt") || ""}](${n.getAttribute("src")})`;
    if (t === "A") return n.hasAttribute("download") ? `${x} (attachment)` : `[${x}](${n.getAttribute("href")})`;
    return x;
  }).join("");
  const blocks = (node, pad) => {
    const out = [];
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.data.trim()) out.push(pad + n.data.trim()); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (/^H[1-6]$/.test(t)) out.push(`${"#".repeat(Number(t[1]))} ${inline(n).trim()}`);
      else if (t === "UL" || t === "OL") out.push(listMd(n, pad));
      else if (t === "BLOCKQUOTE") out.push(blocks(n, "").split("\n").map((l) => `> ${l}`.trimEnd()).join("\n"));
      else if (t === "PRE") out.push("```\n" + n.textContent.replace(/\n$/, "") + "\n```");
      else if (t === "HR") out.push("---");
      else if (t === "TABLE") {
        const rows = [...n.querySelectorAll("tr")].map((r) => `| ${[...r.children].map((c) => inline(c).replace(/\n/g, " ").replace(/\|/g, "\\|").trim()).join(" | ")} |`);
        if (rows.length) rows.splice(1, 0, `|${" --- |".repeat(n.querySelector("tr").children.length)}`);
        out.push(rows.join("\n"));
      } else if (t === "P" || t === "DIV" || t === "LI") { const x = inline(n).trim(); if (x) out.push(x); }
      else { const x = inline({ childNodes: [n] }).trim(); if (x) out.push(x); }
    }
    return out.join("\n\n");
  };
  const listMd = (list, pad) => [...list.children].map((li, i) => {
    const mark = list.tagName === "OL" ? `${i + 1}.` : list.classList.contains("checklist") ? (li.classList.contains("checked") ? "- [x]" : "- [ ]") : "-";
    const subs = [...li.children].filter(isList).map((s) => listMd(s, pad + "  "));
    return [`${pad}${mark} ${inline(li).trim().replace(/\n/g, " ")}`, ...subs].join("\n");
  }).join("\n");
  return blocks(root, "");
}
function noteMarkdown() { const box = h("div"); box.innerHTML = flowHTML(); const extra = journalText(journal ? journal.serialize() : keptLayer); return `# ${els.title.value.trim() || "Untitled"}\n\n${htmlToMd(box)}${extra.length ? `\n\n${extra.join("\n\n")}` : ""}\n`; }
async function copyMarkdown() {
  try { await navigator.clipboard.writeText(noteMarkdown()); toast("Copied as Markdown"); }
  catch (e) { const area = h("textarea", { style: "position:fixed;opacity:0" }); area.value = noteMarkdown(); document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); toast("Copied as Markdown"); }
}
function downloadMarkdown() {
  const url = URL.createObjectURL(new Blob([noteMarkdown()], { type: "text/markdown" }));
  const a = h("a", { href: url, download: `${(els.title.value.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80)}.md` }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ---------- exporting one note ----------
// Every format in one place. PDF and Web page keep the page exactly as it looks (writing anywhere, shapes, ink, pictures);
// Word, Markdown and plain text carry the words (text on the page comes after the entry).
const fileStem = () => (els.title.value.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
function saveFile(name, type, data) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function pageText() { return journalText(journal ? journal.serialize() : keptLayer); }
// The note as it is on screen, cleaned of editing handles, with the ink turned into a picture.
function noteSnapshot() {
  const live = els.pane.querySelector(".jpaper, .page"); if (!live) return null;
  const copy = live.cloneNode(true);
  const liveCanvas = live.querySelector(".jink-canvas"), copyCanvas = copy.querySelector(".jink-canvas");
  if (liveCanvas && copyCanvas) copyCanvas.replaceWith(h("img", { class: "jink-canvas", src: liveCanvas.toDataURL("image/png"), style: liveCanvas.getAttribute("style") || "", alt: "" }));
  copy.querySelectorAll(".jink-live, .jgrip, .jdel, .jrot, .jsize, .jside, .jend, .jstyle, .rimg-grip, .rimg-size, .meta input, .jfile-open").forEach((n) => n.remove());
  copy.querySelectorAll("[contenteditable]").forEach((n) => n.removeAttribute("contenteditable"));
  copy.querySelectorAll(".sel, .over-space, .ProseMirror-focused").forEach((n) => n.classList.remove("sel", "over-space", "ProseMirror-focused"));
  const title = copy.querySelector(".titlein"); if (title) title.replaceWith(h("h1", { class: "titlein" }, els.title.value || "Untitled"));
  copy.querySelectorAll(".jfile").forEach((card) => { const a = card.querySelector("a[download]"); if (a) { a.hidden = false; a.className = "jfile-link-export"; a.textContent = "Download"; } });
  return copy;
}
async function exportHTML() {
  const snap = noteSnapshot(); if (!snap) return;
  let css = ""; try { css = await (await fetch("/notes/app.css")).text(); } catch (e) { /* the words still come through */ }
  const doc = `<!doctype html><html lang="en" data-theme="${theme}" data-bs-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(els.title.value || "Untitled")}</title>
<style>${css}</style><style>html,body{height:auto}body{overflow:auto}#app{display:block!important;height:auto!important}.jexport{max-width:1280px;margin:0 auto;padding:24px 0 48px}.jexport .jpaper{overflow:visible}.jfile-link-export{margin-left:auto;color:var(--accent-ink)}</style></head>
<body><div id="app" data-experience="${theme}"><div class="jexport">${snap.outerHTML}</div></div></body></html>`;
  saveFile(`${fileStem()}.html`, "text/html", doc);
}
function exportPDF() { // the browser's print dialog, set up to print just this note; choose "Save as PDF"
  document.body.classList.add("printing-note");
  const done = () => { document.body.classList.remove("printing-note"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 50);
}
function exportWord() {
  const box = h("div"); box.innerHTML = flowHTML();
  box.querySelectorAll("span[style], mark[style]").forEach((n) => { n.style.removeProperty("color"); }); // light-on-dark text colours would vanish on a white page
  const extra = pageText().map((t) => `<p>${esc(t).replace(/\n/g, "<br>")}</p>`).join("");
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(els.title.value || "Untitled")}</title>
<style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.5}h1{font-size:22pt}mark{background:#fff27a}ul.checklist{list-style:none}li.checked{text-decoration:line-through;color:#777}</style></head>
<body><h1>${esc(els.title.value || "Untitled")}</h1>${box.innerHTML}${extra ? `<hr>${extra}` : ""}</body></html>`;
  saveFile(`${fileStem()}.doc`, "application/msword", doc);
}
function exportText() {
  const box = h("div"); box.innerHTML = flowHTML();
  const text = htmlToMd(box).replace(/[*_`~=]{1,2}([^*_`~=]+)[*_`~=]{1,2}/g, "$1").replace(/!\[[^\]]*\](\([^)]*\))?/g, "[picture]").replace(/\[([^\]]+)\]\((?:data:|https?:)[^)]*\)/g, "$1");
  const extra = pageText();
  saveFile(`${fileStem()}.txt`, "text/plain", `${els.title.value.trim() || "Untitled"}\n\n${text.trim()}${extra.length ? `\n\n${extra.join("\n\n")}` : ""}\n`);
}
function exportDialog() {
  const item = (icon, label, about, run) => h("button", { type: "button", class: "xopt", onclick: async () => { dialog.close(); try { await flush(); await run(); } catch (error) { fail(error); } } },
    h("span", { class: "xicon" }, ic(icon, 18)), h("span", { class: "xtext" }, h("b", {}, label), h("small", {}, about)));
  dialog.className = "wide";
  dialog.replaceChildren(h("h2", {}, "Export this note"),
    h("div", { class: "xlist" },
      item("download", "PDF", "Looks exactly like the page. Opens the print window: choose “Save as PDF”.", exportPDF),
      item("ext", "Web page (.html)", "One file that opens in any browser, with the whole page design.", exportHTML),
      item("note", "Word (.doc)", "Opens in Word, Pages or Google Docs. Words, lists and pictures in the entry.", exportWord),
      item("copy", "Markdown (.md)", "Plain text with formatting marks, for other notes apps.", downloadMarkdown),
      item("text", "Plain text (.txt)", "Just the words.", exportText),
      item("share", "Evernote (.enex)", "Brings the note into Evernote or another notes app.", () => { location.href = `/api/notes/export?note=${note.id}`; })),
    h("p", { class: "hint" }, "Want every note, or moving to another computer? ", h("button", { type: "button", class: "linkish", onclick: () => { dialog.close(); importExport(); } }, "Open Import & Export"), "."),
    h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => dialog.close() }, "Close")));
  dialog.showModal();
}

// ---------- dialogs ----------
function ask(title, body, label, action, danger) {
  const err = h("p", { class: "err", role: "alert" });
  dialog.className = "";
  dialog.replaceChildren(h("form", { method: "dialog", onsubmit: async (e) => {
    e.preventDefault();
    try { const msg = await action(); if (dialog.open) dialog.close(); toast(msg); } catch (error) { err.textContent = error.message; }
  } }, h("h2", {}, title), body, err, h("div", { class: "actions" }, h("button", { type: "button", class: "btn", onclick: () => dialog.close() }, "Cancel"), h("button", { type: "submit", class: `btn ${danger ? "danger" : "primary"}` }, label))));
  if (!dialog.open) dialog.showModal();
}
function nameDialog(title, label, initial, save) {
  const name = h("input", { value: initial, required: true, maxlength: 100 });
  ask(title, h("label", { class: "field" }, "Name", name), label, () => save(name.value));
  name.select();
}
function shortcutsDialog() {
  const row = (a, b) => h("div", {}, h("span", {}, a), typeof b === "string" ? h("code", {}, b) : b);
  dialog.className = "wide";
  dialog.replaceChildren(h("div", {}, h("h2", {}, "Writing in StudyNotes"),
    h("p", {}, "Type Markdown and it turns into formatting as you go. Press Backspace right after to undo a change."),
    h("div", { class: "keys" },
      h("h3", {}, "Start a line with"),
      row("Heading 1 / 2 / 3", "# ## ###"), row("Bulleted list", "- "), row("Numbered list", "1. "), row("Checklist", "[] "), row("Quote", "> "), row("Code block", "``` Enter"), row("Divider", "--- Enter"), row("Any block", "/"),
      h("h3", {}, "Around words"),
      row("Bold", "**bold**"), row("Italic", "*italic*"), row("Strikethrough", "~~strike~~"), row("Highlight", "==highlight=="), row("Code", "`code`"), row("Link", "[text](url)"), row("Link to a note", "[["),
      h("h3", {}, "Keys"),
      row("Leave a list", "Enter twice"), row("Indent / outdent item", "Tab / Shift+Tab"), row("Choose nested bullet or number style", "Indent, then use list buttons"), row("Add description / continue list", "Alt+Enter"), row("Check off a to-do", `${MOD}Enter`), row("Line break in a list", "Shift+Enter"),
      row("Number headings / turn numbering off", "Toggle numbered heading in toolbar"), row("Continue numbered headings", "Enter at heading end"),
      row("Bold / italic / underline", `${MOD}B / I / U`), row("Strikethrough / highlight", `${MOD}${SHIFT}X / H`), row("Inline code / link", `${MOD}E / K`),
      row("Bullets / numbers / checklist", `${MOD}${SHIFT}8 / 7 / 9`), row("Heading 1-3 / text", `${MOD}${ALT}1-3 / 0`),
      row("New note", `${MOD}${ALT}N`), row("Focus mode", `${MOD}${SHIFT}F`), row("Search", "/ (outside a note)")),
    h("div", { class: "actions" }, h("button", { type: "button", class: "btn primary", onclick: () => dialog.close() }, "Got it"))));
  dialog.showModal();
}

// ---------- moving notes: a whole-app backup for another device, and Evernote .enex ----------
async function uploadFile(file) {
  const sent = await fetch(`/api/upload?path=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Capture-Upload": "1" }, body: file });
  const up = await sent.json(); if (!sent.ok) throw new Error(up.error || "The upload failed");
  return up.name;
}
function chooseFile(accept, then) {
  const file = h("input", { type: "file", accept, style: "display:none" });
  file.onchange = () => { const f = file.files[0]; file.remove(); if (f) then(f); };
  document.body.append(file); file.click();
}
async function postJSON(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await r.json(); if (!r.ok) throw new Error(out.error || "That didn't work");
  return out;
}
function importExport() {
  const nb = view.startsWith("notebook:") ? Number(view.slice(9)) : null;
  const status = h("p", { class: "err", role: "status" });
  const say = (text) => { status.textContent = text; };

  // A whole-app backup: every notebook, note, tag, page kind and the activity chart, to restore on another computer.
  const backupLink = h("button", { type: "button", class: "btn primary", onclick: async () => {
    try { await flush(); } catch (error) { return say(error.message); } // the open note's last few keystrokes go in too
    const a = h("a", { href: "/api/notes/backup", download: "" }); document.body.append(a); a.click(); a.remove();
  } }, ic("download", 15), "Download backup");
  const chosen = h("div", { class: "restore-choice", hidden: true });
  const restore = async (f, mode) => {
    if (mode === "replace" && !confirm(`Replace everything in this app with “${f.name}”?\n\nA safety copy of what's here now is saved first.`)) return;
    say(mode === "replace" ? "Restoring…" : "Merging…");
    try {
      await leaveNote();
      const name = await uploadFile(f);
      const out = await postJSON("/api/notes/restore", { file: name, mode });
      note = null; created = null; dirty = new Set(); conflict = null;
      dialog.close(); toast(out.message); await go("all");
    } catch (error) { say(error.message); }
  };
  const pickBackup = h("button", { type: "button", class: "btn", onclick: () => chooseFile(".studynotes,.json,application/json", (f) => {
    say("");
    chosen.hidden = false;
    chosen.replaceChildren(
      h("p", {}, h("b", {}, f.name), ` · ${f.size < 1048576 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1048576).toFixed(1)} MB`}. How should it come in?`),
      h("div", { class: "actions", style: "justify-content:flex-start;margin:6px 0 0;flex-wrap:wrap" },
        h("button", { type: "button", class: "btn primary", onclick: () => restore(f, "merge") }, "Merge with my notes"),
        h("button", { type: "button", class: "btn danger", onclick: () => restore(f, "replace") }, "Replace everything")),
      h("p", { class: "hint" }, "Merge adds notes you don't have and updates ones that changed. Replace makes this app match the backup exactly."));
  }) }, "Restore from backup…");

  // Evernote's .enex format, for one notebook, one note, or everything.
  const scope = h("select", { "aria-label": "What to export" }, h("option", { value: "" }, "All notes"), S.notebooks.map((n) => h("option", { value: `notebook=${n.id}` }, n.name)), note ? h("option", { value: `note=${note.id}` }, `Only: ${note.title || "Untitled"}`) : null);
  if (nb) scope.value = `notebook=${nb}`;
  const link = h("a", { class: "btn", href: "#", download: "notes.enex" }, ic("download", 15), "Download .enex");
  const syncLink = () => { link.href = `/api/notes/export${scope.value ? `?${scope.value}` : ""}`; };
  scope.onchange = syncLink; syncLink();
  const pick = h("button", { type: "button", class: "btn", onclick: () => chooseFile(".enex", async (f) => {
    say("Importing…");
    try {
      const out = await postJSON("/api/notes/import", { file: await uploadFile(f) });
      dialog.close(); toast(out.message); await go(`notebook:${out.notebook_id}`);
    } catch (error) { say(error.message); }
  }) }, "Choose .enex File");

  dialog.className = "";
  dialog.replaceChildren(h("div", { class: "move-dialog" }, h("h2", {}, "Import & Export"),
    h("h3", {}, "Move to another device"),
    h("p", {}, "A backup holds everything: notebooks, notes (Trash too), tags, page designs and your activity chart. Restore it in StudyNotes on any computer."),
    h("div", { class: "actions", style: "justify-content:flex-start;margin:8px 0 6px;flex-wrap:wrap" }, backupLink, pickBackup), chosen,
    h("h3", {}, "Evernote (.enex)"),
    h("label", { class: "field" }, "Export", scope), h("div", { class: "actions", style: "justify-content:flex-start;margin:8px 0 10px;flex-wrap:wrap" }, link, pick),
    h("p", { class: "hint" }, "An imported .enex file becomes a new notebook."), status,
    h("div", { class: "actions", style: "justify-content:space-between;margin:14px 0 0" }, h("button", { type: "button", class: "btn", title: "Saves a dated copy next to your notes", onclick: async () => { try { say((await act("backup")).message); } catch (error) { say(error.message); } } }, "Back Up Now"), h("button", { type: "button", class: "btn", onclick: () => dialog.close() }, "Close"))));
  dialog.showModal();
}

// ---------- page ----------
function localDayKey(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function journalCalendar() {
  const y = journalMonth.getFullYear(), m = journalMonth.getMonth();
  const monthName = journalMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const firstOffset = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const entries = new Map([...activityDays()].map(([key, ids]) => [key, ids.size]));
  const grid = ["M", "T", "W", "T", "F", "S", "S"].map((label) => h("span", { class: "weekday" }, label));
  for (let i = 0; i < firstOffset; i += 1) grid.push(h("span", { class: "day-empty" }));
  for (let day = 1; day <= days; day += 1) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const count = entries.get(key) || 0;
    grid.push(h("button", { type: "button", class: `journal-day ${count ? "has-entry" : ""} ${dayFilter === key ? "selected" : ""}`, "aria-label": `${monthName} ${day}${count ? `, ${count} entr${count === 1 ? "y" : "ies"}` : ""}`, "aria-pressed": String(dayFilter === key), onclick: () => { pickDay(key); const active = app.querySelector(".journal-day.selected") || app.querySelector(".journal-day"); if (active) active.focus(); } }, String(day), count ? h("i") : null));
  }
  return h("section", { class: "journal-calendar", "aria-label": "Entry calendar" },
    h("div", { class: "calendar-title" }, h("button", { type: "button", "aria-label": "Previous month", onclick: () => { journalMonth = new Date(y, m - 1, 1); app.querySelector(".journal-calendar").replaceWith(journalCalendar()); } }, "‹"), h("b", {}, monthName), h("button", { type: "button", "aria-label": "Next month", onclick: () => { journalMonth = new Date(y, m + 1, 1); app.querySelector(".journal-calendar").replaceWith(journalCalendar()); } }, "›")),
    h("div", { class: "calendar-grid" }, grid),
    dayFilter ? h("button", { class: "calendar-clear", type: "button", onclick: () => pickDay("") }, "Clear date filter") : h("small", { class: "calendar-clear" }, "Dots mark days with entries"));
}
// ---------- activity ----------
// Every save marks the hour you wrote in a note (server side). Here those hours become your local days.
let activityRows = [];
function activityDays() {
  if (S && S.activity) activityRows = S.activity; // the To-do view doesn't send it, so keep the last copy
  const days = new Map();
  for (const [hour, id] of activityRows) {
    const key = localDayKey(hour * 3600);
    if (!days.has(key)) days.set(key, new Set());
    days.get(key).add(id);
  }
  return days;
}
function onDay(n, key, days = activityDays()) { return (days.get(key) || new Set()).has(n.id) || localDayKey(n.updated) === key; }
// Choosing a day (in the chart or the calendar) filters the entries; choosing it again clears it.
function pickDay(key) {
  dayFilter = dayFilter === key ? "" : key;
  if (dayFilter) { const [y, m] = dayFilter.split("-").map(Number); journalMonth = new Date(y, m - 1, 1); }
  renderList();
  const title = app.querySelector(".lst h2 > span"); if (title) title.textContent = dayFilter ? new Date(`${dayFilter}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : S.title;
  const cal = app.querySelector(".journal-calendar"); if (cal) cal.replaceWith(journalCalendar());
  const chart = app.querySelector(".activity"); if (chart) chart.replaceWith(activityChart(chart.querySelector(".ax-scroll").scrollLeft));
}
const AX_WEEKS = 53;
function activityChart(keepScroll) {
  const days = activityDays();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (AX_WEEKS - 1) * 7); // a Monday, 52 weeks back
  const level = (n) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);
  const nice = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const cells = [], months = [], keys = [];
  let activeDays = 0, notesWritten = new Set();
  for (let i = 0; i < AX_WEEKS * 7; i += 1) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (d.getDate() === 1 || i === 0) { const w = Math.floor(i / 7) + (i === 0 || i % 7 === 0 ? 0 : 1); months.push([w, d]); }
    if (d > today) { cells.push(h("span", { class: "ax-cell ax-future", "aria-hidden": "true" })); continue; }
    const key = localDayKey(d.getTime() / 1000), ids = days.get(key), n = ids ? ids.size : 0;
    if (n) { activeDays += 1; ids.forEach((id) => notesWritten.add(id)); }
    const label = `${n ? `Wrote in ${n} note${n === 1 ? "" : "s"}` : "No notes"} on ${nice(d)}`;
    keys.push(key);
    cells.push(h("button", { type: "button", class: `ax-cell ax-l${level(n)} ${dayFilter === key ? "selected" : ""} ${+d === +today ? "today" : ""}`, "data-key": key, "data-tip": label, "aria-label": label, "aria-pressed": String(dayFilter === key), tabindex: "-1", onclick: () => { pickDay(key); const again = app.querySelector(`.ax-cell[data-key="${key}"]`); if (again) again.focus(); } }));
  }
  // Month names sit over the week a month starts in; a name too close to the next one is dropped.
  const labels = months.filter(([w], i) => w < AX_WEEKS && (i === months.length - 1 || months[i + 1][0] - w >= 3))
    .map(([w, d]) => h("span", { style: `grid-column:${w + 1} / span 4` }, d.toLocaleDateString(undefined, { month: "short" })));
  // Streaks: today counts if you've written; otherwise the streak still stands from yesterday.
  let streak = 0, longest = 0, run = 0;
  for (const key of keys) { run = days.has(key) ? run + 1 : 0; longest = Math.max(longest, run); }
  for (let i = keys.length - 1; i >= 0; i -= 1) { if (days.has(keys[i])) streak += 1; else if (i !== keys.length - 1) break; }
  const grid = h("div", { class: "ax-grid", role: "group", "aria-label": "One square per day, oldest on the left", onkeydown: (e) => {
    const step = { ArrowRight: 7, ArrowLeft: -7, ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity }[e.key];
    if (step === undefined) return;
    const all = [...grid.querySelectorAll("button.ax-cell")], i = all.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault();
    const next = all[Math.max(0, Math.min(all.length - 1, i + step))]; all[i].tabIndex = -1; next.tabIndex = 0; next.focus();
  } }, cells);
  const home = grid.querySelector("button.ax-cell.selected") || grid.querySelector("button.ax-cell.today") || [...grid.querySelectorAll("button.ax-cell")].pop();
  if (home) home.tabIndex = 0;
  const tip = h("div", { class: "ax-tip", role: "presentation", hidden: true });
  const show = (e) => {
    const cell = e.target.closest && e.target.closest("button.ax-cell"); if (!cell) { tip.hidden = true; return; }
    tip.textContent = cell.dataset.tip; tip.hidden = false;
    const box = card.getBoundingClientRect(), r = cell.getBoundingClientRect();
    const left = Math.max(4, Math.min(box.width - tip.offsetWidth - 4, r.left - box.left + r.width / 2 - tip.offsetWidth / 2));
    tip.style.left = `${left}px`; tip.style.top = `${r.top - box.top - tip.offsetHeight - 6}px`;
  };
  const scroll = h("div", { class: "ax-scroll", onscroll: () => { tip.hidden = true; } },
    h("div", { class: "ax-inner" }, h("div", { class: "ax-months", "aria-hidden": "true" }, labels),
      h("div", { class: "ax-days", "aria-hidden": "true" }, h("span", {}, ""), h("span", {}, "Mon"), h("span", {}, ""), h("span", {}, "Wed"), h("span", {}, ""), h("span", {}, "Fri"), h("span", {}, "")), grid));
  const swatches = [0, 1, 2, 3, 4].map((l) => h("i", { class: `ax-cell ax-l${l}` }));
  const summary = activeDays ? `Wrote on ${activeDays} day${activeDays === 1 ? "" : "s"} in the past year, across ${notesWritten.size} note${notesWritten.size === 1 ? "" : "s"}` : "Nothing written in the past year yet. Each day you write fills a square.";
  const card = h("section", { class: "activity", "aria-label": "Writing activity", onpointerover: show, onfocusin: show, onpointerleave: () => { tip.hidden = true; }, onfocusout: () => { tip.hidden = true; } },
    h("div", { class: "ax-top" },
      h("div", {}, h("h3", {}, "Activity"), h("p", {}, summary)),
      activeDays ? h("dl", { class: "ax-stats" }, h("div", {}, h("dt", {}, "Current streak"), h("dd", {}, `${streak} day${streak === 1 ? "" : "s"}`)), h("div", {}, h("dt", {}, "Longest"), h("dd", {}, `${longest} day${longest === 1 ? "" : "s"}`))) : null),
    scroll,
    h("div", { class: "ax-foot" }, dayFilter ? h("button", { type: "button", class: "ax-clear", onclick: () => pickDay("") }, "Show all days") : h("span", {}, "Click a day to see what you wrote"),
      h("span", { class: "ax-legend", "aria-hidden": "true" }, "Less", swatches, "More")),
    tip);
  // Open on the latest weeks (they matter most), or where you were if this is a refresh.
  requestAnimationFrame(() => { scroll.scrollLeft = keepScroll === undefined ? scroll.scrollWidth : keepScroll; });
  return card;
}
function journalTopTabs() {
  const tab = (id, label, extra = "") => { const active = id === "all" ? journalBrowse && view === "all" && !dayFilter : view === id; return h("button", { type: "button", class: `journal-tab nav-link ${active ? "active" : ""} ${extra}`, "aria-current": active ? "page" : null, onclick: () => id === "all" ? browseJournal() : go(id) }, label); };
  const addNotebook = h("button", { type: "button", class: "journal-tab add-tab nav-link", title: "Add a subject notebook", onclick: () => nameDialog("New subject notebook", "Add", "", async (name) => { const out = await act("add_notebook", { name }); dialog.close(); await go(`notebook:${out.id}`); return out.message; }) }, "+ Subject");
  // subject tabs: drag one to a new spot, double-click to rename, the ▾ (or right-click) for rename / move / delete
  const subjectMenu = (n, anchor) => {
    const i = S.notebooks.findIndex((x) => x.id === n.id);
    openMenu(anchor, [
      { label: "Rename tab", icon: "note", run: () => renameSubject(n) },
      i > 0 ? { label: "Move left", icon: "left", run: () => orderSubjects(n.id, i - 1) } : null,
      i < S.notebooks.length - 1 ? { label: "Move right", icon: "right", run: () => orderSubjects(n.id, i + 1) } : null,
      S.default_notebook === n.id ? null : { label: "Make new entries go here", icon: "star", run: async () => { try { toast((await act("default_notebook", { id: n.id })).message); await loadList(); render(); } catch (error) { fail(error); } } },
      "-",
      { label: "Delete tab", icon: "trash", danger: true, run: () => ask(`Delete the ${n.name} tab?`, h("p", {}, `${n.count ? `Its ${n.count} entr${n.count === 1 ? "y goes" : "ies go"} to the Trash, where you can restore ${n.count === 1 ? "it" : "them"}.` : "It has no entries."}`), "Delete tab", async () => { const out = await act("delete_notebook", { id: n.id }); dialog.close(); if (view === `notebook:${n.id}`) await go("all"); else await changed(); return out.message; }, true) },
    ].filter(Boolean));
  };
  const subjectTab = (n) => {
    const b = tab(`notebook:${n.id}`, n.name, "subject-tab");
    b.title = `${n.name}. Drag to move, double-click to rename, right-click for more`;
    b.draggable = true; b.dataset.nb = n.id;
    b.addEventListener("dblclick", (e) => { e.preventDefault(); renameSubject(n); });
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); subjectMenu(n, b); });
    b.addEventListener("keydown", (e) => {
      if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") { e.preventDefault(); subjectMenu(n, b); }
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); const i = S.notebooks.findIndex((x) => x.id === n.id); orderSubjects(n.id, clampIndex(i + (e.key === "ArrowLeft" ? -1 : 1))); }
    });
    b.addEventListener("dragstart", (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-notebook", String(n.id)); b.classList.add("tab-dragging"); });
    b.addEventListener("dragend", () => { b.classList.remove("tab-dragging"); for (const t of document.querySelectorAll(".drop-before, .drop-after")) t.classList.remove("drop-before", "drop-after"); });
    b.addEventListener("dragover", (e) => {
      if (![...e.dataTransfer.types].includes("text/x-notebook")) return;
      e.preventDefault(); const r = b.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
      for (const t of document.querySelectorAll(".drop-before, .drop-after")) if (t !== b) t.classList.remove("drop-before", "drop-after");
      b.classList.toggle("drop-after", after); b.classList.toggle("drop-before", !after);
    });
    b.addEventListener("dragleave", () => b.classList.remove("drop-before", "drop-after"));
    b.addEventListener("drop", (e) => {
      const id = Number(e.dataTransfer.getData("text/x-notebook")); if (!id || id === n.id) return;
      e.preventDefault(); const r = b.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
      const rest = S.notebooks.filter((x) => x.id !== id), at = rest.findIndex((x) => x.id === n.id) + (after ? 1 : 0);
      orderSubjects(id, at);
    });
    return b;
  };
  return h("div", { class: "journal-shell container-fluid d-flex flex-column p-0" },
    h("header", { class: "journal-top" },
      h("div", { class: "journal-masthead" }, h("span", { class: "masthead-mark" }, "✳"), h("span", {}, h("b", {}, "STUDYNOTES"), h("small", {}, "STUDY JOURNAL · YOUR LEARNING, IN ORDER")), h("time", {}, new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })), h("button", { class: "journal-switch", type: "button", onclick: switchTheme }, "Original notes")),
      h("nav", { class: "journal-tabs nav nav-tabs flex-nowrap", "aria-label": "Journal tabs" }, tab("all", "Index", "index-tab"), tab("starred", "Pinned"), tab("todos", "Review"), h("span", { class: "tab-divider" }), S.notebooks.map(subjectTab), addNotebook)),
    h("div", { class: "journal-spread container-fluid d-flex flex-column p-0" }));
}
const clampIndex = (i) => Math.max(0, Math.min(S.notebooks.length - 1, i));
function renameSubject(n) { nameDialog("Rename tab", "Save", n.name, async (name) => { const out = await act("rename_notebook", { id: n.id, name }); await changed(); return out.message; }); }
async function orderSubjects(id, index) {
  const ids = S.notebooks.map((x) => x.id).filter((x) => x !== id);
  ids.splice(Math.max(0, Math.min(ids.length, index)), 0, id);
  if (ids.join() === S.notebooks.map((x) => x.id).join()) return;
  const byId = new Map(S.notebooks.map((x) => [x.id, x]));
  S.notebooks = ids.map((x) => byId.get(x)); // move it on screen right away, then save
  const nav = app.querySelector(".journal-tabs");
  if (nav) { const tabs = new Map([...nav.querySelectorAll(".subject-tab")].map((t) => [Number(t.dataset.nb), t])); const add = nav.querySelector(".add-tab"); for (const x of ids) nav.insertBefore(tabs.get(x), add); const moved = tabs.get(id); if (moved) moved.focus(); }
  try { await act("order_notebooks", { ids }); } catch (error) { fail(error); await loadList(); render(); }
}
async function browseJournal() {
  try {
    await leaveNote();
    if (conflict) return toast("Choose what to do with the changed note first", true);
    journalBrowse = true; dayFilter = ""; view = "all"; query = "";
    try { localStorage.setItem("notes-view", view); } catch (e) { /* remembered until reload */ }
    await loadList(); render();
  } catch (error) { fail(error); }
}
function refreshSidebar() { const old = app.querySelector("aside"); if (old) old.replaceWith(sidebar()); } // the journal's note view has no sidebar on screen
function searchBox() {
  const search = h("input", { class: "form-control form-control-sm", value: query, placeholder: theme === "journal" ? "Search entries, topics, tag:…" : "Search notes", title: 'Try tag:ideas, notebook:work, intitle:plan, or a "quoted phrase"', "aria-label": "Search notes. Supports tag, notebook, title, and quoted phrase filters.", id: "search", type: "search", oninput: () => {
    query = search.value; clearTimeout(searchTimer); clear.hidden = !query;
    searchTimer = setTimeout(async () => { try { await flush(); await loadList(); renderList(); } catch (error) { fail(error); } }, 200);
  }, onkeydown: (e) => {
    if (e.key === "Escape" && search.value) { e.preventDefault(); search.value = ""; search.dispatchEvent(new Event("input")); }
    if (e.key === "Enter" || e.key === "ArrowDown") { const first = els.cards && els.cards.querySelector(".card"); if (first) { e.preventDefault(); first.focus(); } }
  } });
  const clear = h("button", { type: "button", class: "clear", "aria-label": "Clear search", hidden: !query, onclick: () => { search.value = ""; search.dispatchEvent(new Event("input")); search.focus(); } }, ic("x", 13));
  return h("label", { class: "find" }, ic("search", 14), search, theme === "journal" ? h("kbd", { class: "find-key", "aria-hidden": "true" }, "/") : null, clear);
}
const addNotebookDialog = () => nameDialog("New notebook", "Add", "", async (name) => { const out = await act("add_notebook", { name }); dialog.close(); go(`notebook:${out.id}`); return out.message; });
function sidebar() {
  const nav = (id, name, label, n) => h("button", { class: `nav nav-link ${view === id ? "on" : ""}`, "aria-current": view === id ? "page" : null, title: label, onclick: () => go(id) }, ic(name, 16), h("span", { class: "ellip" }, label), n ? h("span", { class: "n badge rounded-pill" }, n) : null);
  const smartTags = S.tags.filter((t) => ["review", "to review", "review queue", "exam", "exam prep"].includes(t.name.toLowerCase()));
  const topicTags = theme === "journal" ? S.tags.filter((t) => !smartTags.includes(t)) : S.tags;
  const tools = [
    h("button", { class: "nav", onclick: clipDialog }, ic("download", 16), h("span", { class: "ellip" }, "Save a web page")),
    h("button", { class: "nav", onclick: importExport }, ic("share", 16), h("span", { class: "ellip" }, "Import & Export")),
    h("button", { class: "nav theme-toggle", type: "button", "aria-label": `Switch to ${theme === "journal" ? "original" : "journal"} layout`, onclick: switchTheme }, ic("today", 16), h("span", { class: "ellip" }, theme === "journal" ? "Original layout" : "Study journal layout")),
    nav("trash", "trash", "Trash", S.counts.trash)];
  if (theme === "journal") {
    // The Index rail: filters you narrow the entries with, grouped from most to least used. Rare tools sit quietly at the bottom.
    const group = (label, items, action) => h("section", { class: "jx-group" }, h("div", { class: "jx-label" }, h("span", {}, label), action || null), h("div", { class: "jx-list" }, items));
    return h("aside", { class: "jx-side", "aria-label": "Browse the journal" },
      journalCalendar(),
      h("div", { class: "jx-card" },
        group("Collections", [nav("all", "note", "All notes", S.counts.all_notes), nav("starred", "star", "Shortcuts", S.counts.starred), nav("todos", "check", "To-do", S.counts.todos)]),
        smartTags.length ? group("Study queues", smartTags.map((t) => nav(`tag:${t.name}`, ["exam", "exam prep"].includes(t.name.toLowerCase()) ? "book" : "clock", ["exam", "exam prep"].includes(t.name.toLowerCase()) ? "Exam prep" : "Review queue", t.count))) : null,
        group("Notebooks", S.notebooks.map((n) => nav(`notebook:${n.id}`, "book", n.name, n.count)), h("button", { type: "button", class: "jx-add", "aria-label": "New notebook", title: "New notebook", onclick: addNotebookDialog }, ic("plus", 14))),
        topicTags.length ? group("Topics & tags", h("div", { class: "jx-tags" }, topicTags.map((t) => h("button", { type: "button", class: `jx-tag ${view === `tag:${t.name}` ? "on" : ""}`, "aria-current": view === `tag:${t.name}` ? "page" : null, onclick: () => go(`tag:${t.name}`) }, `#${t.name}`, h("span", {}, t.count))))) : null),
      h("div", { class: "jx-tools" }, tools));
  }
  return h("aside", {},
    h("button", { class: "new btn btn-primary", title: `New note  ${MOD}${ALT}N`, onclick: newNote }, ic("plus", 16), "New note"),
    searchBox(),
    nav("all", "note", "All notes", S.counts.all_notes), nav("starred", "star", "Shortcuts", S.counts.starred),
    nav("todos", "check", "To-do", S.counts.todos),
    h("div", { class: "sidehead" }, "Notebooks", h("button", { "aria-label": "New notebook", title: "New notebook", onclick: addNotebookDialog }, ic("plus", 14))),
    S.notebooks.map((n) => nav(`notebook:${n.id}`, "book", n.name, n.count)),
    topicTags.length ? [h("div", { class: "sidehead" }, "Tags"), topicTags.map((t) => nav(`tag:${t.name}`, "tag", t.name, t.count))] : null,
    h("div", { class: "gap" }),
    h("div", { class: "sidefoot" }, tools));
}
// The Index's top bar: find something (most common), or start writing (the one primary action).
function indexHead() {
  return h("header", { class: "jx-head" },
    searchBox(),
    h("button", { type: "button", class: "jx-browse btn", "aria-expanded": "false", onclick: (e) => { const open = app.querySelector(".journal-index-page").classList.toggle("jx-showside"); e.currentTarget.setAttribute("aria-expanded", String(open)); } }, ic("menu", 15), "Browse"),
    h("button", { class: "study-template btn", type: "button", "aria-haspopup": "menu", onclick: (e) => studyTemplateMenu(e.currentTarget) }, ic("book", 15), h("span", {}, "Study template"), ic("down", 12)),
    h("button", { class: "new btn btn-primary", title: `New entry  ${MOD}${ALT}N`, onclick: newNote }, ic("plus", 16), "New entry"));
}
function renderList() {
  if (!els.cards) return;
  const days = activityDays();
  const entries = theme === "journal" && dayFilter ? S.notes.filter((n) => onDay(n, dayFilter, days)) : S.notes;
  els.count.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
  if (!entries.length) { els.cards.replaceChildren(emptyList()); return; }
  const card = (n) => h("button", { class: `card note-card ${note && n.id === note.id ? "on" : ""}`, "data-id": n.id, onclick: () => openNote(n.id), "aria-current": note && n.id === note.id ? "true" : null },
    h("b", { class: n.title ? null : "untitled" }, n.title || "Untitled"), h("p", {}, n.snippet || "No text yet"),
    h("time", {}, when(n.updated), theme === "journal" && n.kind === "plain" ? h("span", { class: "kind-tag", title: "Plain page" }, "Plain") : null, n.starred ? h("span", { class: "star", "aria-label": "Shortcut" }, "★") : null, n.has_file ? h("span", { "aria-label": "Has an attachment", title: "Has an attachment" }, "📎") : null, n.has_image ? h("span", { "aria-label": "Has an image", title: "Has an image" }, ic("image", 12)) : null));
  if (theme !== "journal") { els.cards.replaceChildren(...entries.map(card)); return; }
  const groups = new Map();
  for (const n of entries) {
    const age = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(n.updated * 1000).setHours(0, 0, 0, 0)) / 86400000);
    const label = age <= 0 ? "Today" : age === 1 ? "Yesterday" : age < 7 ? "This week" : new Date(n.updated * 1000).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(card(n));
  }
  els.cards.replaceChildren(...[...groups].map(([label, entries]) => h("section", { class: "entry-group" }, h("h3", {}, label), ...entries)));
}
function emptyList() {
  const text = dayFilter ? ["No entries on this day", "Choose another marked date or clear the date filter."] : query.trim() ? ["No matches", "Try tag:, notebook:, intitle: or a quoted phrase."] : view === "trash" ? ["Trash is empty", "Deleted notes stay here until you remove them."] : view === "starred" ? ["No shortcuts yet", "Star a note to keep it close."] : ["No notes here", "Write your first one."];
  return h("div", { class: "none" }, h("b", {}, text[0]), text[1], !query.trim() && !["trash", "starred"].includes(view) ? h("div", {}, h("button", { class: "btn primary", onclick: newNote }, ic("plus", 14), "New note")) : null);
}
function listPane() {
  els.cards = h("div", { class: "cards", onkeydown: (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const cards = [...els.cards.querySelectorAll(".card")], i = cards.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); const next = cards[i + (e.key === "ArrowDown" ? 1 : -1)]; if (next) { next.focus(); openNote(Number(next.dataset.id), true); }
  } });
  els.count = h("span", {});
  const picker = h("select", { class: "form-select form-select-sm", "aria-label": "Sort notes", onchange: async () => { sort = picker.value; try { localStorage.setItem("notes-sort", sort); } catch (e) { /* until reload */ } await loadList().catch(fail); renderList(); } },
    h("option", { value: "updated" }, "Recently edited"), h("option", { value: "created" }, "Recently created"), h("option", { value: "title" }, "Title"), h("option", { value: "oldest" }, "Oldest edits"));
  picker.value = sort;
  const nb = view.startsWith("notebook:") ? Number(view.slice(9)) : null;
  const tools = [];
  if (nb) {
    const more = h("button", { "aria-label": "Notebook options", title: "Notebook options", "aria-haspopup": "menu", onclick: () => openMenu(more, [
      S.default_notebook === nb ? { label: "New notes go here", icon: "check", run: () => {} } : { label: "Make default notebook", icon: "star", run: async () => { try { const out = await act("default_notebook", { id: nb }); toast(out.message); await loadList(); render(); } catch (error) { fail(error); } } },
      { label: "Rename", icon: "note", run: () => nameDialog("Rename notebook", "Save", S.title, async (name) => { const out = await act("rename_notebook", { id: nb, name }); await changed(); return out.message; }) },
      "-",
      { label: "Delete notebook", icon: "trash", danger: true, run: () => ask(`Delete ${S.title}?`, h("p", {}, "The notebook goes away and its notes move to the Trash, where you can restore them."), "Delete Notebook", async () => { const out = await act("delete_notebook", { id: nb }); dialog.close(); await go("all"); return out.message; }, true) },
    ]) }, ic("dots", 16));
    tools.push(more);
  }
  if (view === "trash" && S.notes.length) tools.push(h("button", { onclick: () => ask("Empty the Trash?", h("p", {}, `This permanently deletes ${S.notes.length} note${S.notes.length === 1 ? "" : "s"}. It can't be undone.`), "Delete Forever", async () => { const out = await act("empty_trash"); note = null; await changed(); return out.message; }, true) }, "Empty Trash"));
  const icon2 = view === "trash" ? "trash" : view.startsWith("notebook") ? "book" : view.startsWith("tag:") ? "tag" : view === "starred" ? "star" : "note";
  const listTitle = theme === "journal" && dayFilter ? new Date(`${dayFilter}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : S.title;
  return h("section", { class: "lst d-flex flex-column", "aria-label": "Notes" }, h("header", {},
    h("div", { class: "headrow" }, h("button", { class: "menubtn", "aria-label": "Show notebooks", onclick: () => app.classList.toggle("sideopen") }, ic("menu", 18)), h("h2", {}, ic(icon2, 18), h("span", {}, listTitle)), h("span", { class: "headtools" }, tools)),
    h("div", { class: "sub" }, els.count, picker)), els.cards);
}
function setFocus(on) {
  focusMode = on; app.classList.toggle("focus", on);
  try { localStorage.setItem("notes-focus", on ? "1" : "0"); } catch (e) { /* until reload */ }
  if (els.focusBtn) { els.focusBtn.classList.toggle("active", on); els.focusBtn.setAttribute("aria-pressed", String(on)); els.focusBtn.title = on ? `Leave focus mode  Esc` : `Focus mode  ${MOD}${SHIFT}F`; }
}
async function switchTheme() {
  try {
    await flush();
    if (conflict) return toast("Choose what to do with the changed note first", true);
    theme = theme === "journal" ? "original" : "journal";
    applyTheme();
    try { localStorage.setItem("notes-experience-v3", theme); } catch (e) { /* remembered until reload */ }
    render();
  } catch (error) { fail(error); }
}
function renderEditor() {
  if (!els.pane) return;
  if (tiptap) { tiptap.destroy(); tiptap = null; }
  if (journal) { journal.destroy(); journal = null; }
  closeColorPicker();
  keptLayer = "";
  closeBubble(); closeSlash(); closeLinkPop();
  els.editor = null; els.words = null; els.when = null;
  if (!note) {
    els.pane.replaceChildren(h("div", { class: "blank" }, h("div", {}, h("b", {}, S.notes.length ? "Pick a note to read it" : "Nothing here yet"), S.notes.length ? "Or start a fresh one." : "Notes you write show up in the list.",
      h("div", {}, h("button", { class: "btn primary", onclick: newNote }, ic("plus", 14), "New note")), h("p", { style: "margin-top:14px;font-size:12px" }, h("kbd", {}, `${MOD}${ALT}N`), " new note · ", h("kbd", {}, "/"), " search"))));
    return;
  }
  const locked = note.trashed;
  els.title = h("input", { class: "titlein form-control-plaintext", value: note.title, placeholder: "Untitled", "aria-label": "Title", disabled: locked, maxlength: 500, oninput: () => touched("title"),
    onkeydown: (e) => {
      if (e.key === "Enter" || (e.key === "ArrowDown" && !e.shiftKey)) { e.preventDefault(); tiptap.commands.focus("start"); }
    } });
  els.editor = h("div", { class: "editor", contenteditable: locked ? "false" : null, role: "textbox", "aria-multiline": "true", "aria-label": "Note body", spellcheck: "true" });
  const parts = splitJournal(note.content || ""); // the entry goes to the editor; the designed page is drawn on top of it
  keptLayer = parts.layer;
  const editorOptions = {
    element: els.editor,
    extensions: tiptapExtensions,
    content: parts.flow.trim() ? parts.flow : "<p></p>", // cleaned by the server
    editable: !locked,
    editorProps: { attributes: { class: "tiptap", role: "textbox", "aria-multiline": "true", "aria-label": "Note body", spellcheck: "true" } },
    onUpdate: () => { touched("content"); refreshEditorState(); linkTyped(); slashTyped(); syncTools(); },
  };
  try { tiptap = new Editor(editorOptions); }
  catch (error) { console.error("Tiptap initialization failed; using the notes editor fallback.", error); tiptap = new NativeEditorFallback(editorOptions); }
  editorEvents(els.editor);
  els.saved = h("span", { class: "saved", role: "status" }); setSaved(saveState);
  const crumb = locked ? h("span", { class: "crumb" }, ic("trash", 15), "In Trash") : (() => {
    const move = h("select", { "aria-label": "Notebook", title: "Move to another notebook", onchange: async () => {
      try { await flush(); const out = await act("move", { id: note.id, notebook_id: Number(move.value) }); note.updated = out.updated; toast(out.message); await loadList(); note.notebook_id = Number(move.value); render(); } catch (error) { fail(error); }
    } }, S.notebooks.map((n) => h("option", { value: n.id }, n.name)));
    move.value = String(note.notebook_id);
    return h("label", { class: "crumb" }, ic("book", 15), move);
  })();
  const back = h("button", { class: "iconbtn back btn btn-sm", "aria-label": "Back to the list", onclick: async () => { await flush().catch(() => {}); app.classList.remove("reading"); } }, ic("left", 18));
  const star = h("button", { class: `iconbtn btn btn-sm ${note.starred ? "on" : ""}`, "aria-pressed": String(note.starred), "aria-label": "Shortcut", title: note.starred ? "Remove from Shortcuts" : "Add to Shortcuts", onclick: async () => {
    try { await act("star", { id: note.id, starred: !note.starred }); note.starred = !note.starred; await loadList(); refreshSidebar(); renderList(); star.classList.toggle("on", note.starred); star.setAttribute("aria-pressed", String(note.starred)); star.title = note.starred ? "Remove from Shortcuts" : "Add to Shortcuts"; } catch (error) { fail(error); }
  } }, ic("star", 17));
  const exportBtn = h("button", { class: "iconbtn btn btn-sm", "aria-label": "Export", title: "Export: PDF, web page, Word, Markdown…", onclick: exportDialog }, ic("download", 17));
  els.focusBtn = h("button", { class: "iconbtn btn btn-sm", "aria-label": "Focus mode", onclick: () => setFocus(!focusMode) }, ic("focus", 17));
  const more = h("button", { class: "iconbtn btn btn-sm", "aria-label": "More", title: "More", "aria-haspopup": "menu", onclick: () => openMenu(more, [
    { label: "Export…", icon: "download", run: exportDialog },
    { label: "Copy as Markdown", icon: "copy", run: copyMarkdown },
    "-",
    theme === "journal" && !locked ? (note.kind === "plain" ? { label: "Make it a canvas page", icon: "board", run: switchKind } : { label: "Make it a plain page", icon: "text", run: switchKind }) : null,
    { label: "Markdown & shortcuts", icon: "help", keys: `${MOD}/`, run: shortcutsDialog },
    "-",
    { label: "Move to Trash", icon: "trash", danger: true, run: trashNote },
  ]) }, ic("dots", 18));
  const banners = [];
  if (conflict) banners.push(h("div", { class: "conflict", role: "alert" }, h("span", {}, "This note changed somewhere else while you were editing. Your latest typing isn't saved yet."),
    h("button", { class: "btn", onclick: async () => { const fresh = conflict; conflict = null; dirty = new Set(); note = fresh; setSaved(""); await loadList(); render(); } }, "Use the Other Version"),
    h("button", { class: "btn primary", onclick: async () => { try { await flush(true); render(); } catch (error) { fail(error); } } }, "Keep Mine")));
  if (locked) banners.push(h("div", { class: "trashbar" }, h("span", {}, "This note is in the Trash. Restore it to edit."),
    h("button", { class: "btn", onclick: async () => { const out = await act("restore", { id: note.id }).catch((e) => { fail(e); return null; }); if (out) { toast(out.message); note.trashed = false; await changed(); } } }, "Restore"),
    h("button", { class: "btn danger", onclick: () => ask("Delete this note forever?", h("p", {}, `"${note.title || "Untitled"}" will be gone. This can't be undone.`), "Delete Forever", async () => { const out = await act("delete_forever", { id: note.id }); note = null; await changed(); return out.message; }, true) }, "Delete Forever")));
  const tag = h("input", { class: "form-control form-control-sm tag-input", placeholder: note.tags.length ? "Add topic tag" : "Add a topic tag…", "aria-label": "Add a topic tag", onkeydown: (e) => {
    if ((e.key === "Enter" || e.key === ",") && tag.value.trim()) { e.preventDefault(); const name = tag.value.trim().replace(/^#/, ""); if (name && !note.tags.includes(name)) { note.tags.push(name); tagsChanged(); } tag.value = ""; }
    else if (e.key === "Backspace" && !tag.value && note.tags.length) { note.tags.pop(); tagsChanged(); }
    else if (e.key === "Enter") { e.preventDefault(); focusEditor(); }
  }, onblur: () => { const name = tag.value.trim().replace(/^#/, ""); if (name && !note.tags.includes(name)) { note.tags.push(name); tag.value = ""; tagsChanged(); } } });
  els.tags = h("span", { style: "display:contents" });
  const tagsChanged = () => { paintTags(); touched("tags"); flush().then(() => loadList()).then(() => { const was = document.activeElement; refreshSidebar(); if (was === tag) tag.focus(); }).catch(fail); };
  const paintTags = () => els.tags.replaceChildren(...note.tags.map((t) => h("span", { class: `chip badge rounded-pill ${locked ? "ro" : ""}` }, `#${t}`, locked ? null : h("button", { type: "button", "aria-label": `Remove tag ${t}`, onclick: () => { note.tags = note.tags.filter((x) => x !== t); tagsChanged(); } }, "×"))));
  paintTags();
  els.words = h("span", { class: "words" }); els.when = h("span", { class: "when" }, `Edited ${when(note.updated)}`);
  const entryDate = new Date(note.created * 1000);
  const canvas = theme === "journal" && note.kind !== "plain";
  const page = h("article", { class: `page ${theme === "journal" && !canvas ? "plain-page" : ""}` },
    theme === "journal" ? h("div", { class: "entry-date" }, h("span", { class: "date-stamp" }, String(entryDate.getDate()).padStart(2, "0")), h("span", {}, h("b", {}, "STUDY JOURNAL"), h("small", {}, entryDate.toLocaleDateString(undefined, { weekday: "long", month: "long", year: "numeric" })))) : null,
    els.title,
    h("div", { class: "meta" }, ic("tag", 13), els.tags, locked ? null : tag),
    theme === "journal" && !canvas && layerHasItems(keptLayer) ? h("p", { class: "jkept" }, "This page also has things placed on its canvas. They're kept safe and hidden. ", locked ? null : h("button", { type: "button", class: "linkbtn", onclick: switchKind }, "Show them as a canvas page")) : null,
    els.editor,
    theme !== "journal" && keptLayer ? h("p", { class: "jkept" }, "This entry also has a designed journal page (writing, drawings or stickers placed on the paper). It's kept safe. Switch to the journal layout to see it.") : null,
    (note.backlinks || []).length ? h("div", { class: "backlinks" }, h("b", {}, "Linked from: "), note.backlinks.map((b, i) => [i ? " · " : "", h("a", { href: `#note/${b.id}`, onclick: (e) => { e.preventDefault(); openNote(b.id); } }, b.title)])) : null);
  const docEl = h("div", { class: "doc", onmousedown: (e) => { // a click in the empty space below the note starts a fresh writing line
    if (canvas || locked || (e.target !== docEl && e.target !== page)) return;
    const r = els.editor.getBoundingClientRect(); if (e.clientY < r.bottom) return;
    e.preventDefault();
    const last = tiptap.state.doc.lastChild;
    if (!last || last.type.name !== "paragraph" || last.content.size) tiptap.commands.insertContentAt(tiptap.state.doc.content.size, { type: "paragraph" });
    tiptap.commands.focus("end"); refreshEditorState();
  }, onscroll: closeBubble }, page);
  if (canvas) journal = mountJournal({ paper: page, layerHTML: keptLayer, editable: !locked, editorEl: els.editor, onChange: () => touched("content"), toast, openFile: openAttachment });
  els.pane.replaceChildren(
    h("div", { class: "bar d-flex align-items-center gap-2" }, back, crumb, journal && !locked ? journal.pageSwitch : null, els.saved, locked ? null : star, exportBtn, els.focusBtn, locked ? null : more), ...banners,
    locked ? "" : toolbar(), journal ? h("div", { class: "jdesk" }, locked ? null : journal.tray, docEl) : docEl,
    h("div", { class: "foot" }, els.words, locked ? null : h("button", { type: "button", class: "mdhint", title: "Markdown and keyboard shortcuts", onclick: shortcutsDialog }, "Markdown works · type ", h("kbd", {}, "/"), " for blocks"), els.when));
  setFocus(focusMode); refreshEditorState(); countWords();
}
function render() {
  if (!S) return;
  closeMenu();
  els.pane = h("section", { class: "ed", "aria-label": "Note" });
  const index = sidebar(), entries = view === "todos" ? todoPane() : listPane();
  if (theme === "journal") {
    const shell = journalTopTabs();
    shell.querySelector(".journal-spread").replaceChildren(journalBrowse ? h("main", { class: "journal-index-page" }, h("div", { class: "jx-wrap" }, indexHead(), activityChart(), h("div", { class: "jx-body" }, entries, index))) : els.pane);
    app.replaceChildren(shell);
    app.classList.toggle("reading", !!note && !journalBrowse);
  } else app.replaceChildren(index, entries, els.pane);
  app.classList.toggle("focus", focusMode && !!note);
  renderList(); renderEditor();
}
// ---------- links between notes ----------
// [[ while typing opens a list of notes to link to; the link is <a href="#note/ID">. A click on one opens that note.
let linkPop = null;
function closeLinkPop() { if (linkPop) { linkPop.el.remove(); linkPop = null; } }
function linkTyped() {
  const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return closeLinkPop();
  const node = s.anchorNode; if (!node || node.nodeType !== 3 || !els.editor.contains(node)) return closeLinkPop();
  const before = node.nodeValue.slice(0, s.anchorOffset), m = before.match(/\[\[([^\[\]]{0,60})$/);
  if (!m) return closeLinkPop();
  const q = m[1], start = s.anchorOffset - m[0].length;
  const rect = s.getRangeAt(0).getBoundingClientRect();
  if (!linkPop) { linkPop = { el: h("div", { class: "linkpop", role: "listbox" }), pick: 0, items: [] }; document.body.append(linkPop.el); }
  Object.assign(linkPop, { node, start, end: s.anchorOffset, q });
  linkPop.el.style.left = `${rect.left}px`; linkPop.el.style.top = `${rect.bottom + 4}px`;
  const ask2 = linkPop;
  act("titles", { q }).then((out) => { if (linkPop !== ask2) return; linkPop.items = out.notes.filter((n) => !note || n.id !== note.id); linkPop.pick = 0; paintLinkPop(); }).catch(() => {});
}
function paintLinkPop() {
  if (!linkPop) return;
  const items = linkPop.items;
  linkPop.el.replaceChildren(...(items.length ? items.map((n, i) => h("button", { class: `lp ${i === linkPop.pick ? "on" : ""}`, onmousedown: (e) => { e.preventDefault(); insertNoteLink(n); } }, n.title))
    : [h("div", { class: "lp none" }, linkPop.q ? `No note called “${linkPop.q}”` : "Type a note's title")]));
}
function insertNoteLink(n) {
  const p = linkPop; if (!p) return;
  closeLinkPop();
  const r = document.createRange(); r.setStart(p.node, p.start); r.setEnd(p.node, Math.min(p.end, p.node.nodeValue.length));
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand("insertHTML", false, `<a href="#note/${n.id}">${esc(n.title)}</a>&nbsp;`);
  touched("content");
}
function linkPopKeys(e) {
  if (!linkPop || !linkPop.items.length) { if (linkPop && e.key === "Escape") closeLinkPop(); return false; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); linkPop.pick = (linkPop.pick + (e.key === "ArrowDown" ? 1 : linkPop.items.length - 1)) % linkPop.items.length; paintLinkPop(); return true; }
  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertNoteLink(linkPop.items[linkPop.pick]); return true; }
  if (e.key === "Escape") { e.preventDefault(); closeLinkPop(); return true; }
  return false;
}
function noteLinkDialog() {
  const s = getSelection(), saved = s.rangeCount && els.editor.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
  const q = h("input", { placeholder: "Search note titles", "aria-label": "Note title" }), list = h("div", { class: "picklist" });
  const fill2 = async () => { const out = await act("titles", { q: q.value }).catch(() => ({ notes: [] }));
    list.replaceChildren(...out.notes.filter((n) => !note || n.id !== note.id).map((n) => h("button", { type: "button", class: "lp", onclick: () => {
      dialog.close(); focusEditor(); const sel = getSelection(); sel.removeAllRanges(); if (saved) sel.addRange(saved);
      const text = saved && !saved.collapsed ? saved.toString() : n.title;
      document.execCommand("insertHTML", false, `<a href="#note/${n.id}">${esc(text)}</a>&nbsp;`); touched("content"); } }, n.title))); };
  q.oninput = fill2;
  ask("Link to a note", [h("label", { class: "field" }, "Note", q), list, h("p", { class: "hint" }, "Tip: type [[ in a note to link without leaving the keyboard.")], "Close", async () => null);
  fill2(); q.focus();
}
// #note/12 in the address opens that note (links from other notes, the Jobs board, or a bookmark)
async function openFromHash() {
  const m = /^#note\/(\d+)$/.exec(location.hash);
  if (!m) return false;
  const id = Number(m[1]);
  if (note && note.id === id) return true;
  if (view === "trash") { await leaveNote(); view = "all"; await loadList(); }
  await openNote(id);   // saves the note you were in first
  if (!note) { note = null; await loadList(); render(); }
  return true;
}
window.addEventListener("hashchange", () => { openFromHash().catch(fail); });

// ---------- to-dos from every note ----------
function todoPane() {
  const groups = new Map();
  for (const t of S.todos || []) { if (!groups.has(t.note_id)) groups.set(t.note_id, { title: t.title, items: [] }); groups.get(t.note_id).items.push(t); }
  const body = groups.size ? [...groups.entries()].map(([id, g]) => h("div", { class: "todogroup" },
      h("button", { class: "todonote", onclick: () => openNote(id) }, ic("note", 14), g.title || "Untitled"),
      g.items.map((t) => h("label", { class: "todo" }, h("input", { type: "checkbox", onchange: async (e) => {
        e.target.disabled = true;
        try { await flush(); const out = await act("todo_check", { id: t.note_id, index: t.index, checked: true }); toast(out.message);
          if (note && note.id === t.note_id) note = await get(`/api/notes/note?id=${note.id}`); await loadList(); render(); } catch (error) { fail(error); e.target.disabled = false; }
      } }), h("span", {}, t.text)))))
    : [h("div", { class: "none" }, h("b", {}, "Nothing to do"), "Unchecked items from every note's checklists show up here.")];
  return h("section", { class: "lst", "aria-label": "To-do" }, h("header", {}, h("div", { class: "headrow" }, h("button", { class: "menubtn", "aria-label": "Show notebooks", onclick: () => app.classList.toggle("sideopen") }, ic("menu", 18)), h("h2", {}, ic("check", 18), h("span", {}, "To-do"))),
    h("p", { class: "sub" }, `${(S.todos || []).length} open item${(S.todos || []).length === 1 ? "" : "s"} across your notes. Check one off here and it's checked in its note.`)), h("div", { class: "cards todos" }, body));
}

// ---------- saving a web page ----------
function clipDialog() {
  const url = h("input", { placeholder: "https://example.com/article", "aria-label": "Web address", required: true });
  ask("Save a web page", [h("label", { class: "field" }, "Address", url), h("p", { class: "hint" }, "The page's title and main text become a new note, with a link back to the page. It's tagged web clip.")], "Save page", async () => {
    await leaveNote();
    const out = await act("clip", { url: url.value });
    dialog.close(); view = "all"; query = ""; note = null; await loadList(); await openNote(out.id);
    return out.message;
  });
  url.focus();
}

// ---------- attached files ----------
function attachFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE) { toast("That file is over 15 MB. Attach a smaller one, or keep it in Drive and link to it", true); return; }
  if (/^(text\/html|image\/svg)/.test(file.type)) { toast("Web pages and SVG pictures can't be attached. Save it as a PDF instead", true); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const kb = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1048576).toFixed(1)} MB`;
    const safe = file.name.replace(/[<>"&]/g, "_");
    const html = `<p><a href="${reader.result}" download="${safe}">📎 ${safe} (${kb})</a></p><p></p>`;
    if (tiptapLive()) tiptap.chain().focus().insertContent(html).run(); else exec("insertHTML", html);
  };
  reader.readAsDataURL(file);
}
function pickFile() {
  const saved = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
  const picker = h("input", { type: "file", style: "display:none" });
  picker.onchange = () => {
    if (saved && els.editor.contains(saved.startContainer)) { focusEditor(); const s = getSelection(); s.removeAllRanges(); s.addRange(saved); }
    attachFile(picker.files[0]); picker.remove();
  };
  document.body.append(picker); picker.click();
}
// A PDF opens in a new tab; anything else downloads.
function openAttachment(a) {
  const href = a.getAttribute("href") || "", name = a.getAttribute("download") || "file";
  if (/^data:application\/pdf;base64,/.test(href)) {
    const bytes = atob(href.slice(href.indexOf(",") + 1)), arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60000); return;
  }
  const tmp = h("a", { href, download: name }); document.body.append(tmp); tmp.click(); tmp.remove();
}

// ---------- page-wide keys ----------
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if (mod && e.altKey && e.code === "KeyN") { e.preventDefault(); newNote(); return; }
  if (mod && e.shiftKey && e.code === "KeyF") { if (note) { e.preventDefault(); setFocus(!focusMode); } return; }
  if (mod && e.key === "/") { e.preventDefault(); shortcutsDialog(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); flush().then(() => toast("Saved")).catch(fail); return; }
  if (dialog.open || typing) return;
  if (e.key === "/" && !mod) { const s = document.getElementById("search"); if (s) { e.preventDefault(); if (focusMode) setFocus(false); s.focus(); s.select(); } }
  if (e.key === "Escape" && focusMode) setFocus(false);
  if (e.key === "Escape" && app.classList.contains("sideopen")) app.classList.remove("sideopen");
});
app.addEventListener("click", (e) => { if (app.classList.contains("sideopen") && !e.target.closest("aside") && !e.target.closest(".menubtn")) app.classList.remove("sideopen"); });
document.addEventListener("selectionchange", () => { if (cursor()) { syncTools(); refreshEditorState(); linkBubble(); } else closeBubble(); });
window.addEventListener("resize", () => { closeBubble(); closeMenu(); });
window.addEventListener("focus", async () => {
  if (dirty.size || saving || conflict || dialog.open) return;
  try {
    await loadList();
    if (dirty.size || conflict || dialog.open) return;
    renderList();
    const fresh = note && S.notes.find((n) => n.id === note.id);
    if (fresh && fresh.updated !== note.updated) { note = await get(`/api/notes/note?id=${note.id}`); if (!dirty.size) renderEditor(); }
  } catch (error) { /* tried again next time you come back */ }
});
(async () => {
  try { document.execCommand("defaultParagraphSeparator", false, "p"); await loadList(); }
  catch (error) { view = "all"; try { await loadList(); } catch (again) { fail(again); return; } }
  if (await openFromHash().catch(() => false)) return;
  note = S.notes.length ? await get(`/api/notes/note?id=${S.notes[0].id}`).catch(() => null) : null;
  render();
})();
