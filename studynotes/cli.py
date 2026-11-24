#!/usr/bin/env python3
"""StudyNotes in the terminal: the same notes as the web page.

  studynotes cli             full-screen terminal UI
  studynotes cli help        list every command
"""
import argparse
import curses
import json
import locale
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
from html import escape
from html.parser import HTMLParser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store as core  # noqa: E402

ROOT = core.ROOT
DATA = os.path.dirname(core.DB_PATH)

USE_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def c(text, code):
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text


def bold(t): return c(t, "1")
def dim(t): return c(t, "2")
def green(t): return c(t, "32")
def yellow(t): return c(t, "33")
def cyan(t): return c(t, "36")
def red(t): return c(t, "31")


def die(msg):
    print(red("error: ") + msg, file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------- HTML <-> text
# Notes are stored as HTML (the same format Evernote .enex uses). In the terminal they are shown and
# edited as Markdown-ish text. Images and tables can't be edited as text, so they become
# placeholders like ⟦image 1⟧ that are swapped back for the original HTML on save.

BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "blockquote",
              "pre", "table", "tr", "hr", "section", "article"}
INLINE = {"b": "**", "strong": "**", "i": "*", "em": "*", "s": "~~", "strike": "~~", "del": "~~", "mark": "=="}


class _ToText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines, self.buf, self.prefix = [], "", ""
        self.lists, self.quote, self.pre, self.href = [], 0, False, []

    def flush(self):
        text = self.buf if self.pre else re.sub(r"\s+", " ", self.buf).strip()
        if text:
            q = "> " * self.quote
            self.lines.append(q + self.prefix + text)
        self.buf, self.prefix = "", ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        if tag == "br":
            if self.pre:
                self.buf += "\n"
            else:
                keep = self.prefix
                self.flush()
                self.prefix = " " * len(keep) if keep else ""
            return
        if tag in BLOCK_TAGS:
            self.flush()
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.prefix = "#" * min(int(tag[1]), 3) + " "
        elif tag in ("ul", "ol"):
            self.lists.append({"ordered": tag == "ol", "check": "checklist" in cls, "n": 0})
        elif tag == "li":
            lst = self.lists[-1] if self.lists else {"ordered": False, "check": False, "n": 0}
            indent = "  " * max(len(self.lists) - 1, 0)
            if lst["check"]:
                self.prefix = indent + ("- [x] " if "checked" in cls else "- [ ] ")
            elif lst["ordered"]:
                lst["n"] += 1
                self.prefix = f"{indent}{lst['n']}. "
            else:
                self.prefix = indent + "- "
        elif tag == "blockquote":
            self.quote += 1
        elif tag == "pre":
            self.lines.append("```")
            self.pre = True
        elif tag == "hr":
            self.lines.append("---")
        elif tag in INLINE:
            self.buf += INLINE[tag]
        elif tag == "code" and not self.pre:
            self.buf += "`"
        elif tag == "a":
            self.href.append((a.get("href") or "", len(self.buf)))
            self.buf += "["
        elif tag in ("td", "th"):
            self.buf += " | "

    def handle_endtag(self, tag):
        if tag in INLINE:
            self.buf += INLINE[tag]
        elif tag == "code" and not self.pre:
            self.buf += "`"
        elif tag == "a":
            href, start = self.href.pop() if self.href else ("", 0)
            label = self.buf[start + 1:]
            if label == href:  # bare URL: show it as-is (it's auto-linked again on save)
                self.buf = self.buf[:start] + href
            else:
                self.buf += f"]({href})"
        elif tag == "pre":
            self.flush()
            self.lines.append("```")
            self.pre = False
            return
        if tag in BLOCK_TAGS:
            self.flush()
        if tag in ("ul", "ol") and self.lists:
            self.lists.pop()
        elif tag == "blockquote":
            self.quote = max(self.quote - 1, 0)

    def handle_data(self, data):
        self.buf += data


def html_to_text(html, keep=None):
    """Convert note HTML to editable text. Fills `keep` with placeholder -> original HTML."""
    keep = {} if keep is None else keep
    counter = {"image": 0, "table": 0, "attachment": 0, "journal page": 0}

    def stash(kind, raw):
        counter[kind] += 1
        key = f"⟦{kind} {counter[kind]}⟧"
        keep[key] = raw
        return key
    # the designed journal page (free boxes, ink, stickers) is always last; keep it whole so editing here can't scramble it
    html = re.sub(r'<div class="jpage"[^>]*>.*\Z', lambda m: f"<p>{stash('journal page', m.group(0))}</p>", html, flags=re.S | re.I)
    html = re.sub(r"<table\b.*?</table>", lambda m: f"<p>{stash('table', m.group(0))}</p>", html, flags=re.S | re.I)
    html = re.sub(r"<img\b[^>]*>", lambda m: stash("image", m.group(0)), html, flags=re.I)
    html = re.sub(r'<a\b[^>]*href="data:[^"]*"[^>]*>.*?</a>', lambda m: stash("attachment", m.group(0)), html, flags=re.S | re.I)
    p = _ToText()
    p.feed(html)
    p.close()
    p.flush()
    return "\n".join(p.lines)


def _inline(text, keep):
    s = escape(text, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"==(.+?)==", r"<mark>\1</mark>", s)
    s = re.sub(r"~~(.+?)~~", r"<s>\1</s>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", s)
    s = re.sub(r"\[([^\]]*)\]\(([^)\s]+)\)", lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>', s)
    s = re.sub(r"(?<![\"'>=])\b(https?://[^\s<]+)", r'<a href="\1">\1</a>', s)
    for key, raw in keep.items():
        s = s.replace(escape(key, quote=False), raw)
    return s


LIST_RE = re.compile(r"^(\s*)(- \[( |x|X)\] |[-*+] |\d+[.)] )(.*)$")


def text_to_html(text, keep=None):
    keep = keep or {}
    out, stack = [], []  # stack of (indent, kind) where kind is ul/ol/check
    lines = text.replace("\r\n", "\n").split("\n")
    i = 0

    def close_lists(to_indent=-1):
        while stack and stack[-1][0] > to_indent:
            out.append("</li></ul>" if stack[-1][1] != "ol" else "</li></ol>")
            stack.pop()

    while i < len(lines):
        line = lines[i]
        m = LIST_RE.match(line)
        if m:
            indent = len(m.group(1).expandtabs(2))
            marker = m.group(2)
            kind = "check" if marker.startswith("- [") else "ol" if marker[0].isdigit() else "ul"
            while stack and (stack[-1][0] > indent or (stack[-1][0] == indent and stack[-1][1] != kind)):
                out.append("</li></ul>" if stack[-1][1] != "ol" else "</li></ol>")
                stack.pop()
            if stack and stack[-1][0] == indent:
                out.append("</li>")
            else:
                tag = "<ol>" if kind == "ol" else '<ul class="checklist">' if kind == "check" else "<ul>"
                out.append(tag)
                stack.append((indent, kind))
            checked = kind == "check" and m.group(3).lower() == "x"
            cls = ' class="checked"' if checked else ""
            out.append(f"<li{cls}>{_inline(m.group(4), keep) or '<br>'}")
            i += 1
            continue
        if stack and line.startswith(" ") and line.strip():
            out.append("<br>" + _inline(line.strip(), keep))  # continuation of a list item
            i += 1
            continue
        close_lists()
        stripped = line.strip()
        if stripped.startswith("```"):
            body = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            out.append(f"<pre>{escape(chr(10).join(body), quote=False)}</pre>")
        elif stripped in ("---", "***", "___"):
            out.append("<hr>")
        elif re.match(r"#{1,6} ", stripped):
            level = min(len(stripped.split(" ")[0]), 3)
            out.append(f"<h{level}>{_inline(stripped[level + 1:].strip(), keep)}</h{level}>")
        elif stripped.startswith(">"):
            out.append(f"<blockquote>{_inline(stripped.lstrip('> '), keep)}</blockquote>")
        elif stripped in keep and keep[stripped].lower().startswith("<table"):
            out.append(keep[stripped])
        elif stripped:
            out.append(f"<p>{_inline(stripped, keep)}</p>")
        i += 1
    close_lists()
    html = "".join(out)
    for key, raw in keep.items():  # the journal page is a block of its own, not a paragraph
        if key.startswith("⟦journal page"):
            html = html.replace(f"<p>{raw}</p>", raw)
    return html


# ---------------------------------------------------------------- data helpers

def db():
    core.init_db()
    return core.connect()


def notebooks(conn):
    return core.state(conn)["notebooks"]


def find_notebook(conn, name, create=False):
    if name is None:
        return None
    nbs = notebooks(conn)
    if str(name).isdigit() and any(n["id"] == int(name) for n in nbs):
        return int(name)
    exact = [n for n in nbs if n["name"].lower() == name.lower()]
    if exact:
        return exact[0]["id"]
    partial = [n for n in nbs if n["name"].lower().startswith(name.lower())]
    if len(partial) == 1:
        return partial[0]["id"]
    if create:
        t = core.now()
        return conn.execute("INSERT INTO notebooks (name, created, updated) VALUES (?, ?, ?)", (name, t, t)).lastrowid
    die(f"no notebook matching '{name}'" + (" (ambiguous)" if partial else "") + ". See: notes notebooks")


def default_notebook(conn):
    st = core.load_settings()
    nbs = notebooks(conn)
    if any(n["id"] == st.get("default_notebook") for n in nbs):
        return st["default_notebook"]
    return min(nbs, key=lambda n: n["created"])["id"]


def get_note(conn, ident, allow_trash=True):
    row = core.get_note_row(conn, int(ident)) if str(ident).isdigit() else None
    if not row:
        die(f"no note with id {ident}. See: notes ls")
    if row["trashed_at"] is not None and not allow_trash:
        die(f"note {ident} is in the trash (notes restore {ident})")
    return core.note_dict(conn, row)


def ago(ts):
    d = time.time() - ts
    if d < 60:
        return "just now"
    for unit, secs in (("y", 31536000), ("mo", 2592000), ("d", 86400), ("h", 3600), ("m", 60)):
        if d >= secs:
            return f"{int(d // secs)}{unit} ago"


def nb_names(conn):
    return {n["id"]: n["name"] for n in notebooks(conn)}


def print_notes(conn, notes):
    if not notes:
        print(dim("  (no notes)"))
        return
    names = nb_names(conn)
    width = shutil.get_terminal_size((100, 20)).columns
    for n in notes:
        star = yellow("★ ") if n["starred"] else "  "
        title = n["title"] or "Untitled"
        meta = f"{names.get(n['notebook_id'], '?')} · {ago(n['updated'])}"
        tags = " ".join("#" + t for t in n["tags"])
        line = f"{dim(str(n['id']).rjust(4))} {star}{bold(title)}  {dim(meta)}"
        if tags:
            line += "  " + cyan(tags)
        print(line)
        snippet = n["snippet"].replace("\n", " ")
        if snippet:
            print("        " + dim(textwrap.shorten(snippet, max(width - 10, 20), placeholder="…")))


def render_text(text):
    """Pretty-print note text in the terminal."""
    out = []
    for line in text.split("\n"):
        if line.startswith("#"):
            out.append(bold(green(line.lstrip("# "))))
        elif re.match(r"\s*- \[[xX]\] ", line):
            out.append(dim(re.sub(r"- \[[xX]\] ", "☑ ", line, count=1)))
        elif re.match(r"\s*- \[ \] ", line):
            out.append(re.sub(r"- \[ \] ", "☐ ", line, count=1))
        elif re.match(r"\s*- ", line):
            out.append(re.sub(r"- ", "• ", line, count=1))
        elif line.startswith(">"):
            out.append(dim("┃ " + line.lstrip("> ")))
        elif line == "---":
            out.append(dim("─" * 40))
        else:
            line = re.sub(r"\*\*(.+?)\*\*", lambda m: bold(m.group(1)), line)
            out.append(line)
    return "\n".join(out)


# ---------------------------------------------------------------- editor round-trip

def editor_cmd():
    for cand in (os.environ.get("VISUAL"), os.environ.get("EDITOR"), "nano", "vim", "vi"):
        if cand and shutil.which(cand.split()[0]):
            return cand
    die("no text editor found; set $EDITOR")


def edit_in_editor(conn, note=None, notebook_id=None, tags=None):
    """Open a note in $EDITOR. Returns True if something changed."""
    keep = {}
    if note:
        title, nb, tag_list = note["title"], note["notebook_id"], note["tags"]
        body = html_to_text(note["content"], keep)
    else:
        title, nb, tag_list, body = "", notebook_id or default_notebook(conn), tags or [], ""
    header = (f"Title: {title}\nNotebook: {nb_names(conn).get(nb, '')}\nTags: {', '.join(tag_list)}\n"
              "--- (write your note below; '- [ ] ' makes a checkbox; save & quit to keep) ---\n")
    original = header + body + "\n"
    fd, path = tempfile.mkstemp(suffix=".md", prefix="note-")
    with os.fdopen(fd, "w") as f:
        f.write(original)
    try:
        subprocess.call(editor_cmd() + " " + _shquote(path), shell=True)
        with open(path) as f:
            edited = f.read()
    finally:
        os.unlink(path)
    if edited == original:
        return False
    head, _, new_body = edited.partition("\n---")
    new_body = new_body.split("\n", 1)[1] if "\n" in new_body else ""
    fields = {}
    for line in head.split("\n"):
        k, _, v = line.partition(":")
        fields[k.strip().lower()] = v.strip()
    new_title = fields.get("title", title)
    new_nb = find_notebook(conn, fields["notebook"], create=True) if fields.get("notebook") else nb
    new_tags = [t.strip().lstrip("#") for t in fields.get("tags", "").split(",") if t.strip()]
    body_text = new_body.strip("\n")
    if not note:
        if not new_title and not body_text:
            return False
        if not new_title:
            new_title = body_text.split("\n", 1)[0].lstrip("#-[] x").strip()[:80]
        core.create_note(conn, {"notebook_id": new_nb, "title": new_title,
                                "content": text_to_html(body_text), "tags": new_tags})
        return True
    changes = {}
    if new_title != title:
        changes["title"] = new_title
    if new_nb != nb:
        changes["notebook_id"] = new_nb
    if sorted(new_tags) != sorted(tag_list):
        changes["tags"] = new_tags
    if body_text != body.strip("\n"):
        changes["content"] = text_to_html(body_text, keep)
    if changes:
        core.update_note(conn, note["id"], changes)
    return bool(changes)


def _shquote(s):
    return "'" + s.replace("'", "'\\''") + "'"


# ---------------------------------------------------------------- commands

def cmd_ls(a):
    with db() as conn:
        q = {"sort": a.sort}
        if a.trash:
            q["view"] = "trash"
        elif a.starred:
            q["view"] = "starred"
        if a.notebook:
            q["notebook"] = find_notebook(conn, a.notebook)
        if a.tag:
            q["tag"] = a.tag.lstrip("#")
        notes = core.list_notes(conn, q)
        if a.limit:
            notes = notes[: a.limit]
        print_notes(conn, notes)


def cmd_search(a):
    with db() as conn:
        notes = core.list_notes(conn, {"q": " ".join(a.query)})
        print(dim(f"{len(notes)} result{'s' if len(notes) != 1 else ''}"))
        print_notes(conn, notes)


def cmd_show(a):
    with db() as conn:
        n = get_note(conn, a.id)
        text = html_to_text(n["content"])
        if a.raw:
            print(n["content"])
            return
        names = nb_names(conn)
        print(bold(n["title"] or "Untitled") + ("  " + yellow("★") if n["starred"] else ""))
        meta = f"📓 {names.get(n['notebook_id'], '?')}  ·  updated {ago(n['updated'])}"
        if n["tags"]:
            meta += "  ·  " + " ".join("#" + t for t in n["tags"])
        if n["trashed"]:
            meta += "  ·  " + red("in trash")
        print(dim(meta))
        print(dim("─" * min(shutil.get_terminal_size().columns, 80)))
        print(render_text(text) if sys.stdout.isatty() else text)


def cmd_new(a):
    with db() as conn:
        nb = find_notebook(conn, a.notebook, create=True) if a.notebook else default_notebook(conn)
        tags = [t.strip().lstrip("#") for t in (a.tags or "").split(",") if t.strip()]
        body = a.message
        if body is None and not sys.stdin.isatty():
            body = sys.stdin.read()
        if body is None:
            if a.title:
                note_id = core.create_note(conn, {"notebook_id": nb, "title": " ".join(a.title), "tags": tags})
                conn.commit()
                if edit_in_editor(conn, get_note(conn, note_id)):
                    print(green("✓") + f" Saved note {note_id}")
                else:
                    print(green("✓") + f" Created empty note {note_id}")
                return
            if edit_in_editor(conn, None, nb, tags):
                print(green("✓") + " Note saved")
            else:
                print("Nothing written — no note created.")
            return
        title = " ".join(a.title) if a.title else body.strip().split("\n", 1)[0][:80]
        note_id = core.create_note(conn, {"notebook_id": nb, "title": title,
                                          "content": text_to_html(body.strip()), "tags": tags})
        print(green("✓") + f" Created note {note_id}: {title}")


def cmd_edit(a):
    with db() as conn:
        n = get_note(conn, a.id, allow_trash=False)
        print(green("✓") + " Saved" if edit_in_editor(conn, n) else "No changes.")


def cmd_append(a):
    with db() as conn:
        n = get_note(conn, a.id, allow_trash=False)
        text = " ".join(a.text) if a.text else sys.stdin.read()
        stamp = f"<p><i>{time.strftime('%Y-%m-%d %H:%M')}</i></p>" if a.stamp else ""
        core.update_note(conn, n["id"], {"content": n["content"] + stamp + text_to_html(text)})
        print(green("✓") + f" Appended to {n['title'] or 'Untitled'}")


def cmd_todo(a):
    """Toggle/add checklist items from the terminal."""
    with db() as conn:
        n = get_note(conn, a.id, allow_trash=False)
        items = re.findall(r'<li( class="checked")?>(.*?)</li>', n["content"].split("checklist", 1)[-1], re.S) \
            if "checklist" in n["content"] else []
        if a.add:
            new = text_to_html("- [ ] " + " ".join(a.add))
            core.update_note(conn, n["id"], {"content": n["content"] + new})
            print(green("✓") + " Added item")
            return
        if a.toggle:
            count = [0]

            def flip(m):
                count[0] += 1
                if count[0] != a.toggle:
                    return m.group(0)
                return "<li>" if m.group(1) else '<li class="checked">'
            pattern = re.compile(r'<li( class="checked")?>')
            parts = re.split(r'(<ul class="checklist">.*?</ul>)', n["content"], flags=re.S)
            parts = [pattern.sub(flip, p) if p.startswith('<ul class="checklist">') else p for p in parts]
            if count[0] < a.toggle:
                die(f"no item #{a.toggle}")
            core.update_note(conn, n["id"], {"content": "".join(parts)})
            n = get_note(conn, a.id)
        idx = 0
        for block in re.findall(r'<ul class="checklist">(.*?)</ul>', n["content"], re.S):
            for checked, text in re.findall(r'<li( class="checked")?>(.*?)</li>', block, re.S):
                idx += 1
                plain = core.html_to_plain(text)
                print(f"{dim(str(idx).rjust(3))} " + (dim("☑ " + plain) if checked else "☐ " + plain))
        if not idx:
            print(dim("No checklist items. Add one: notes todo %s -a 'buy milk'" % a.id))


def cmd_rm(a):
    with db() as conn:
        for ident in a.ids:
            n = get_note(conn, ident)
            if a.forever or n["trashed"]:
                conn.execute("DELETE FROM notes WHERE id = ?", (n["id"],))
                print(red("✗") + f" Permanently deleted {n['id']}: {n['title'] or 'Untitled'}")
            else:
                conn.execute("UPDATE notes SET trashed_at = ? WHERE id = ?", (core.now(), n["id"]))
                print(f"🗑  Moved to trash {n['id']}: {n['title'] or 'Untitled'}  " + dim(f"(undo: notes restore {n['id']})"))
        conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)")


def cmd_restore(a):
    with db() as conn:
        for ident in a.ids:
            n = get_note(conn, ident)
            conn.execute("UPDATE notes SET trashed_at = NULL WHERE id = ?", (n["id"],))
            print(green("✓") + f" Restored {n['id']}: {n['title'] or 'Untitled'}")


def cmd_empty_trash(a):
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM notes WHERE trashed_at IS NOT NULL").fetchone()[0]
        if not count:
            print("Trash is already empty.")
            return
        if not a.yes and input(f"Permanently delete {count} note(s)? [y/N] ").lower() != "y":
            return
        conn.execute("DELETE FROM notes WHERE trashed_at IS NOT NULL")
        conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)")
        print(f"Deleted {count} note(s).")


def cmd_star(a):
    with db() as conn:
        n = get_note(conn, a.id)
        core.update_note(conn, n["id"], {"starred": not n["starred"]})
        print((yellow("★ Starred ") if not n["starred"] else "☆ Unstarred ") + (n["title"] or "Untitled"))


def cmd_mv(a):
    with db() as conn:
        nb = find_notebook(conn, a.notebook, create=True)
        for ident in a.ids:
            n = get_note(conn, ident)
            core.update_note(conn, n["id"], {"notebook_id": nb})
        print(green("✓") + f" Moved {len(a.ids)} note(s) to {nb_names(conn)[nb]}")


def cmd_tag(a):
    with db() as conn:
        n = get_note(conn, a.id)
        tags = list(n["tags"])
        for t in a.tags:
            if t.startswith("-"):
                tags = [x for x in tags if x.lower() != t[1:].lstrip("#").lower()]
            else:
                t = t.lstrip("+#")
                if t.lower() not in (x.lower() for x in tags):
                    tags.append(t)
        core.update_note(conn, n["id"], {"tags": tags})
        print(f"{n['title'] or 'Untitled'}: " + (cyan(" ".join("#" + t for t in tags)) if tags else dim("no tags")))


def cmd_tags(a):
    with db() as conn:
        tags = core.state(conn)["tags"]
        if not tags:
            print(dim("No tags yet. Add one: notes tag <id> work"))
        for t in tags:
            print(f"  {cyan('#' + t['name'])}  {dim(str(t['count']))}")


def cmd_notebooks(a):
    with db() as conn:
        default = default_notebook(conn)
        if a.action == "new":
            nb = find_notebook(conn, " ".join(a.args), create=True)
            print(green("✓") + f" Notebook '{nb_names(conn)[nb]}' ready")
        elif a.action == "rename":
            if len(a.args) < 2:
                die("usage: notes notebooks rename <old> <new name>")
            nb = find_notebook(conn, a.args[0])
            conn.execute("UPDATE notebooks SET name = ?, updated = ? WHERE id = ?", (" ".join(a.args[1:]), core.now(), nb))
            print(green("✓") + " Renamed")
        elif a.action == "rm":
            nb = find_notebook(conn, " ".join(a.args))
            if len(notebooks(conn)) <= 1:
                die("you need at least one notebook")
            fallback = next(n["id"] for n in notebooks(conn) if n["id"] != nb)
            conn.execute("UPDATE notes SET trashed_at = COALESCE(trashed_at, ?), notebook_id = ? WHERE notebook_id = ?",
                         (core.now(), fallback, nb))
            conn.execute("DELETE FROM notebooks WHERE id = ?", (nb,))
            print("Deleted notebook; its notes are in the trash.")
        elif a.action == "default":
            nb = find_notebook(conn, " ".join(a.args))
            core.save_settings({"default_notebook": nb})
            print(green("✓") + f" New notes will go to '{nb_names(conn)[nb]}'")
        else:
            for nb in notebooks(conn):
                mark = green(" (default)") if nb["id"] == default else ""
                print(f"  📓 {bold(nb['name'])}{mark}  {dim(str(nb['count']) + ' notes')}")


def cmd_import(a):
    with db() as conn:
        with open(a.file, "rb") as f:
            name = a.notebook or os.path.splitext(os.path.basename(a.file))[0]
            res = core.import_enex(conn, f.read(), name)
        print(green("✓") + f" Imported {res['imported']} note(s) into notebook '{name}'")


def cmd_export(a):
    with db() as conn:
        nb = find_notebook(conn, a.notebook) if a.notebook else None
        data = core.export_enex(conn, nb)
    if a.output:
        with open(a.output, "wb") as f:
            f.write(data)
        print(green("✓") + f" Wrote {a.output}", file=sys.stderr)
    else:
        sys.stdout.buffer.write(data)


def cmd_config(a):
    if a.key is None:
        for k, v in core.load_settings().items():
            print(f"  {k}: {v}")
        print(dim(f"  data folder: {DATA}"))
        return
    if a.key != "name":
        die("settable key: name (use `notes notebooks default <nb>` for the default notebook)")
    value = " ".join(a.value).strip()
    core.save_settings({a.key: value})
    print(green("✓") + f" {a.key} updated")


def cmd_backup(a):
    with db() as conn:
        dest = a.path or os.path.join(DATA, "backups", time.strftime("notes-%Y%m%d-%H%M%S.db"))
        os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
        target = core.sqlite3.connect(dest)
        conn.backup(target)
        target.close()
    print(green("✓") + f" Backed up to {dest}")


# ---------------------------------------------------------------- curses TUI

HELP = [
    ("↑/↓ j/k", "move"), ("enter", "read note"), ("e", "edit in $EDITOR"), ("n", "new note"),
    ("/", "search"), ("b", "pick notebook"), ("#", "pick tag"), ("a", "all notes"), ("*", "shortcuts"),
    ("T", "trash"), ("s", "star"), ("d", "trash/delete"), ("r", "restore"), ("m", "move"),
    ("t", "edit tags"), ("x", "toggle 1st open todo"), ("o", "sort"), ("q", "quit"),
]


class TUI:
    SORTS = ["updated", "created", "title"]

    def __init__(self, scr):
        self.scr = scr
        self.view = {"type": "all"}
        self.search = ""
        self.sort = "updated"
        self.sel = 0
        self.top = 0
        self.notes = []
        self.msg = ""
        self.reading = False
        self.read_scroll = 0
        curses.curs_set(0)
        curses.use_default_colors()
        for i, col in enumerate((curses.COLOR_GREEN, curses.COLOR_YELLOW, curses.COLOR_CYAN, curses.COLOR_RED), 1):
            curses.init_pair(i, col, -1)
        curses.init_pair(5, curses.COLOR_BLACK, curses.COLOR_GREEN)
        self.load()

    def load(self):
        with db() as conn:
            q = {"sort": self.sort}
            if self.search:
                q["q"] = self.search
            else:
                v = self.view
                if v["type"] in ("starred", "trash"):
                    q["view"] = v["type"]
                elif v["type"] == "notebook":
                    q["notebook"] = v["id"]
                elif v["type"] == "tag":
                    q["tag"] = v["name"]
            self.notes = core.list_notes(conn, q)
            self.names = nb_names(conn)
            self.settings = core.load_settings()
        self.sel = max(0, min(self.sel, len(self.notes) - 1))

    def title(self):
        if self.search:
            return f"Search: {self.search}"
        v = self.view
        return {"all": "All Notes", "starred": "Shortcuts", "trash": "Trash"}.get(v["type"]) or (
            "📓 " + self.names.get(v.get("id"), "") if v["type"] == "notebook" else "#" + v["name"])

    def put(self, y, x, text, attr=0, width=None):
        h, w = self.scr.getmaxyx()
        if y >= h or x >= w:
            return
        width = min(width or w - x, w - x)
        try:
            self.scr.addnstr(y, x, text, width, attr)
        except curses.error:
            pass

    def current(self):
        return self.notes[self.sel] if self.notes else None

    def draw(self):
        self.scr.erase()
        h, w = self.scr.getmaxyx()
        who = f"{self.settings['name']}'s Notes" if self.settings.get("name") else "Notes"
        header = f" 🐘 {who}  ·  {self.title()}  ·  {len(self.notes)} notes  ·  sort: {self.sort} "
        self.put(0, 0, header.ljust(w), curses.color_pair(5) | curses.A_BOLD)
        if self.reading:
            self.draw_reader(h, w)
        else:
            self.draw_list(h, w)
        footer = self.msg or " ? help  n new  e edit  / search  b notebooks  # tags  d delete  q quit"
        self.put(h - 1, 0, footer.ljust(w), curses.A_REVERSE)
        self.scr.refresh()

    def draw_list(self, h, w):
        list_w = min(max(w // 2, 36), w) if w >= 90 else w
        rows = h - 2
        per = 2
        visible = rows // per
        if self.sel < self.top:
            self.top = self.sel
        elif self.sel >= self.top + visible:
            self.top = self.sel - visible + 1
        if not self.notes:
            self.put(2, 2, "No notes here. Press n to create one." if not self.search else "No matches.", curses.A_DIM)
        for i, n in enumerate(self.notes[self.top:self.top + visible]):
            idx = self.top + i
            y = 1 + i * per
            selected = idx == self.sel
            attr = curses.A_REVERSE if selected else 0
            star = "★ " if n["starred"] else "  "
            title = (n["title"] or "Untitled")
            right = ago(n["updated"])
            self.put(y, 0, " " * list_w, attr)
            self.put(y, 1, star, attr | curses.color_pair(2))
            self.put(y, 3, title, attr | curses.A_BOLD, list_w - len(right) - 5)
            self.put(y, list_w - len(right) - 1, right, attr | curses.A_DIM)
            sub = f"{self.names.get(n['notebook_id'], '')}  " + " ".join("#" + t for t in n["tags"])
            sub += "  " + n["snippet"].replace("\n", " ")
            self.put(y + 1, 3, sub, curses.A_DIM, list_w - 4)
        if list_w < w:
            for y in range(1, h - 1):
                self.put(y, list_w, "│", curses.A_DIM)
            n = self.current()
            if n:
                self.draw_note(n, list_w + 2, w - list_w - 3, 0)

    def note_text(self, n):
        with db() as conn:
            full = core.note_dict(conn, core.get_note_row(conn, n["id"]))
        return full, html_to_text(full["content"])

    def draw_note(self, n, x, width, scroll):
        h, _ = self.scr.getmaxyx()
        full, text = self.note_text(n)
        y = 1
        self.put(y, x, full["title"] or "Untitled", curses.A_BOLD | curses.color_pair(1), width)
        y += 1
        meta = f"📓 {self.names.get(full['notebook_id'], '')}  ·  {ago(full['updated'])}"
        if full["tags"]:
            meta += "  ·  " + " ".join("#" + t for t in full["tags"])
        if full["trashed"]:
            meta += "  ·  IN TRASH (r to restore)"
        self.put(y, x, meta, curses.A_DIM, width)
        y += 2
        lines = []
        for line in text.split("\n"):
            attr = 0
            if line.startswith("#"):
                attr, line = curses.A_BOLD | curses.color_pair(1), line.lstrip("# ")
            elif re.match(r"\s*- \[[xX]\] ", line):
                attr, line = curses.A_DIM, re.sub(r"- \[[xX]\] ", "☑ ", line, count=1)
            elif re.match(r"\s*- \[ \] ", line):
                line = re.sub(r"- \[ \] ", "☐ ", line, count=1)
            elif re.match(r"\s*- ", line):
                line = re.sub(r"- ", "• ", line, count=1)
            elif line.startswith(">"):
                attr, line = curses.A_DIM, "┃ " + line.lstrip("> ")
            elif line.startswith("⟦"):
                attr = curses.color_pair(3)
            wrapped = textwrap.wrap(line, max(width, 10), subsequent_indent="  " if re.match(r"\s*[☐☑•]", line) else "") or [""]
            lines += [(seg, attr) for seg in wrapped]
        self.max_scroll = max(0, len(lines) - (h - 1 - y))
        for seg, attr in lines[scroll:]:
            if y >= h - 1:
                break
            self.put(y, x, seg, attr, width)
            y += 1

    def draw_reader(self, h, w):
        n = self.current()
        if not n:
            self.reading = False
            return
        width = min(w - 4, 100)
        self.read_scroll = max(0, min(self.read_scroll, getattr(self, "max_scroll", 0) or self.read_scroll))
        self.draw_note(n, max((w - width) // 2, 1), width, self.read_scroll)

    def prompt(self, label, initial=""):
        h, w = self.scr.getmaxyx()
        curses.curs_set(1)
        text = initial
        while True:
            self.put(h - 1, 0, (label + text).ljust(w), curses.A_REVERSE)
            self.scr.move(h - 1, min(len(label) + len(text), w - 1))
            ch = self.scr.get_wch()
            if ch in ("\n", "\r", curses.KEY_ENTER):
                break
            if ch == "\x1b":
                text = None
                break
            if ch in (curses.KEY_BACKSPACE, "\x7f", "\b"):
                text = text[:-1]
            elif isinstance(ch, str) and ch.isprintable():
                text += ch
        curses.curs_set(0)
        return text

    def pick(self, title, options):
        """Simple list picker. options = [(label, value)]. Returns value or None."""
        sel = 0
        while True:
            h, w = self.scr.getmaxyx()
            self.scr.erase()
            self.put(0, 0, f" {title} ".ljust(w), curses.color_pair(5) | curses.A_BOLD)
            for i, (label, _) in enumerate(options[: h - 2]):
                self.put(1 + i, 2, label, curses.A_REVERSE if i == sel else 0, w - 4)
            self.put(h - 1, 0, " enter select   esc cancel".ljust(w), curses.A_REVERSE)
            self.scr.refresh()
            ch = self.scr.get_wch()
            if ch in ("j", curses.KEY_DOWN):
                sel = min(sel + 1, len(options) - 1)
            elif ch in ("k", curses.KEY_UP):
                sel = max(sel - 1, 0)
            elif ch in ("\n", "\r", curses.KEY_ENTER):
                return options[sel][1] if options else None
            elif ch in ("\x1b", "q"):
                return None

    def run_editor(self, note=None):
        curses.def_prog_mode()
        curses.endwin()
        with db() as conn:
            nb = self.view["id"] if self.view["type"] == "notebook" else None
            tags = [self.view["name"]] if self.view["type"] == "tag" else None
            changed = edit_in_editor(conn, note, nb, tags)
        curses.reset_prog_mode()
        self.scr.refresh()
        self.load()
        if changed and not note:
            self.sel = 0 if self.sort == "updated" else self.sel
        self.msg = " ✓ Saved" if changed else " No changes"

    def loop(self):
        while True:
            self.draw()
            ch = self.scr.get_wch()
            self.msg = ""
            n = self.current()
            if self.reading:
                if ch in ("q", "\x1b", curses.KEY_LEFT, "h"):
                    self.reading = False
                    continue
                if ch in ("j", curses.KEY_DOWN):
                    self.read_scroll += 1
                    continue
                if ch in ("k", curses.KEY_UP):
                    self.read_scroll = max(0, self.read_scroll - 1)
                    continue
                if ch in (" ", curses.KEY_NPAGE):
                    self.read_scroll += self.scr.getmaxyx()[0] - 4
                    continue
                if ch == curses.KEY_PPAGE:
                    self.read_scroll = max(0, self.read_scroll - self.scr.getmaxyx()[0] + 4)
                    continue
            if ch == "q":
                return
            elif ch in ("j", curses.KEY_DOWN):
                self.sel = min(self.sel + 1, len(self.notes) - 1)
            elif ch in ("k", curses.KEY_UP):
                self.sel = max(self.sel - 1, 0)
            elif ch in ("g", curses.KEY_HOME):
                self.sel = 0
            elif ch in ("G", curses.KEY_END):
                self.sel = max(len(self.notes) - 1, 0)
            elif ch == curses.KEY_NPAGE:
                self.sel = min(self.sel + 10, len(self.notes) - 1)
            elif ch == curses.KEY_PPAGE:
                self.sel = max(self.sel - 10, 0)
            elif ch in ("\n", "\r", curses.KEY_ENTER, "l", curses.KEY_RIGHT) and n:
                self.reading, self.read_scroll = True, 0
            elif ch == "e" and n:
                if n["trashed"]:
                    self.msg = " Restore it first (r)"
                else:
                    with db() as conn:
                        full = core.note_dict(conn, core.get_note_row(conn, n["id"]))
                    self.run_editor(full)
            elif ch == "n":
                if self.view["type"] == "trash" or self.search:
                    self.view, self.search = {"type": "all"}, ""
                self.run_editor(None)
            elif ch == "/":
                q = self.prompt("Search (tag:x notebook:x intitle:x): ", self.search)
                if q is not None:
                    self.search, self.sel = q.strip(), 0
                    self.load()
            elif ch == "\x1b":
                if self.search:
                    self.search = ""
                    self.load()
            elif ch == "a":
                self.view, self.search, self.sel = {"type": "all"}, "", 0
                self.load()
            elif ch == "*":
                self.view, self.search, self.sel = {"type": "starred"}, "", 0
                self.load()
            elif ch == "T":
                self.view, self.search, self.sel = {"type": "trash"}, "", 0
                self.load()
            elif ch == "b":
                with db() as conn:
                    opts = [(f"📓 {nb['name']}  ({nb['count']})", nb["id"]) for nb in notebooks(conn)]
                opts.append(("＋ New notebook…", "new"))
                choice = self.pick("Notebooks", opts)
                if choice == "new":
                    name = self.prompt("New notebook name: ")
                    if name and name.strip():
                        with db() as conn:
                            choice = find_notebook(conn, name.strip(), create=True)
                    else:
                        choice = None
                if choice is not None:
                    self.view, self.search, self.sel = {"type": "notebook", "id": choice}, "", 0
                    self.load()
            elif ch == "#":
                with db() as conn:
                    opts = [(f"#{t['name']}  ({t['count']})", t["name"]) for t in core.state(conn)["tags"]]
                if not opts:
                    self.msg = " No tags yet (press t on a note to add some)"
                else:
                    choice = self.pick("Tags", opts)
                    if choice:
                        self.view, self.search, self.sel = {"type": "tag", "name": choice}, "", 0
                        self.load()
            elif ch == "s" and n:
                with db() as conn:
                    core.update_note(conn, n["id"], {"starred": not n["starred"]})
                self.load()
            elif ch == "d" and n:
                with db() as conn:
                    if n["trashed"]:
                        if self.prompt("Delete permanently? (y/N) ") != "y":
                            continue
                        conn.execute("DELETE FROM notes WHERE id = ?", (n["id"],))
                        self.msg = " Deleted permanently"
                    else:
                        conn.execute("UPDATE notes SET trashed_at = ? WHERE id = ?", (core.now(), n["id"]))
                        self.msg = " Moved to trash (T to view, r to restore)"
                self.reading = False
                self.load()
            elif ch == "r" and n and n["trashed"]:
                with db() as conn:
                    conn.execute("UPDATE notes SET trashed_at = NULL WHERE id = ?", (n["id"],))
                self.msg = " Restored"
                self.load()
            elif ch == "m" and n:
                with db() as conn:
                    opts = [(f"📓 {nb['name']}", nb["id"]) for nb in notebooks(conn)]
                choice = self.pick("Move to notebook", opts)
                if choice:
                    with db() as conn:
                        core.update_note(conn, n["id"], {"notebook_id": choice})
                    self.load()
            elif ch == "t" and n:
                tags = self.prompt("Tags (comma separated): ", ", ".join(n["tags"]))
                if tags is not None:
                    with db() as conn:
                        core.update_note(conn, n["id"], {"tags": [t.strip().lstrip("#") for t in tags.split(",")]})
                    self.load()
            elif ch == "x" and n:
                with db() as conn:
                    full = core.note_dict(conn, core.get_note_row(conn, n["id"]))
                    new, k = re.subn(r'(<ul class="checklist">(?:(?!</ul>).)*?)<li>', r'\1<li class="checked">',
                                     full["content"], count=1, flags=re.S)
                    if k:
                        core.update_note(conn, n["id"], {"content": new})
                        self.msg = " ☑ Checked off next item"
                    else:
                        self.msg = " No open checklist items"
                self.load()
            elif ch == "o":
                self.sort = self.SORTS[(self.SORTS.index(self.sort) + 1) % len(self.SORTS)]
                self.load()
            elif ch == "?":
                self.pick("Keys (esc to close)", [(f"{k:<10} {v}", None) for k, v in HELP])
            elif ch == curses.KEY_RESIZE:
                pass


def cmd_tui(a):
    if not sys.stdout.isatty():
        return cmd_ls(argparse.Namespace(trash=False, starred=False, notebook=None, tag=None, sort="updated", limit=None))
    locale.setlocale(locale.LC_ALL, "")
    os.environ.setdefault("ESCDELAY", "25")
    db().close()
    curses.wrapper(lambda scr: TUI(scr).loop())


# ---------------------------------------------------------------- argument parsing

def build_parser():
    p = argparse.ArgumentParser(prog="studynotes cli", description="Your StudyNotes, right in the terminal.")
    sub = p.add_subparsers(dest="cmd", metavar="<command>")

    def add(name, fn, help, aliases=()):
        sp = sub.add_parser(name, help=help, aliases=list(aliases))
        sp.set_defaults(fn=fn)
        return sp

    add("ui", cmd_tui, "full-screen terminal UI (default)", ["tui"])

    sp = add("ls", cmd_ls, "list notes", ["list"])
    sp.add_argument("-n", "--notebook")
    sp.add_argument("-t", "--tag")
    sp.add_argument("-s", "--starred", action="store_true")
    sp.add_argument("--trash", action="store_true")
    sp.add_argument("--sort", choices=list(core.SORTS), default="updated")
    sp.add_argument("-l", "--limit", type=int)

    sp = add("search", cmd_search, 'search notes (supports tag:x notebook:x intitle:x "phrase")', ["s", "find"])
    sp.add_argument("query", nargs="+")

    sp = add("show", cmd_show, "print a note", ["cat", "view"])
    sp.add_argument("id")
    sp.add_argument("--raw", action="store_true", help="print stored HTML")

    sp = add("new", cmd_new, "create a note (opens $EDITOR, or use -m / stdin)", ["add"])
    sp.add_argument("title", nargs="*")
    sp.add_argument("-m", "--message", help="note body (Markdown-ish)")
    sp.add_argument("-n", "--notebook")
    sp.add_argument("-t", "--tags", help="comma-separated tags")

    sp = add("edit", cmd_edit, "edit a note in $EDITOR", ["e"])
    sp.add_argument("id")

    sp = add("append", cmd_append, "append text to a note")
    sp.add_argument("id")
    sp.add_argument("text", nargs="*")
    sp.add_argument("--stamp", action="store_true", help="add a timestamp line first")

    sp = add("todo", cmd_todo, "show / toggle / add checklist items in a note")
    sp.add_argument("id")
    sp.add_argument("-x", "--toggle", type=int, metavar="N", help="toggle item N")
    sp.add_argument("-a", "--add", nargs="+", metavar="TEXT", help="add an unchecked item")

    sp = add("rm", cmd_rm, "move notes to trash (or --forever)", ["delete", "trash"])
    sp.add_argument("ids", nargs="+")
    sp.add_argument("-f", "--forever", action="store_true")
    sp = add("restore", cmd_restore, "restore notes from trash")
    sp.add_argument("ids", nargs="+")
    sp = add("empty-trash", cmd_empty_trash, "permanently delete everything in trash")
    sp.add_argument("-y", "--yes", action="store_true")

    sp = add("star", cmd_star, "toggle a note in Shortcuts", ["pin"])
    sp.add_argument("id")
    sp = add("mv", cmd_mv, "move notes to a notebook (created if needed)", ["move"])
    sp.add_argument("ids", nargs="+")
    sp.add_argument("notebook")
    sp = add("tag", cmd_tag, "add tags (or -tag to remove) on a note")
    sp.add_argument("id")
    sp.add_argument("tags", nargs="+")
    add("tags", cmd_tags, "list all tags")

    sp = add("notebooks", cmd_notebooks, "list notebooks, or: new|rename|rm|default", ["nb"])
    sp.add_argument("action", nargs="?", choices=["new", "rename", "rm", "default", "ls"])
    sp.add_argument("args", nargs="*")

    sp = add("import", cmd_import, "import an Evernote .enex export")
    sp.add_argument("file")
    sp.add_argument("-n", "--notebook", help="notebook name (default: file name)")
    sp = add("export", cmd_export, "export notes as .enex (to stdout or -o file)")
    sp.add_argument("-n", "--notebook")
    sp.add_argument("-o", "--output")

    sp = add("config", cmd_config, "show settings, or set: name <your name>")
    sp.add_argument("key", nargs="?")
    sp.add_argument("value", nargs="*")
    sp = add("backup", cmd_backup, "snapshot the database")
    sp.add_argument("path", nargs="?")

    sub.add_parser("help", help="show this help").set_defaults(fn=lambda a: p.print_help())
    return p


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    parser = build_parser()
    # `notes 12` is shorthand for `notes show 12`; `notes "some text"` would be confusing, so only ids.
    if argv and argv[0].isdigit():
        argv = ["show"] + argv
    # Let `notes tag 5 -work` remove a tag instead of being parsed as a flag.
    if len(argv) > 2 and argv[0] == "tag" and "--" not in argv:
        argv = argv[:2] + ["--"] + argv[2:]
    args = parser.parse_args(argv)
    if not getattr(args, "fn", None):
        args.fn = cmd_tui
    try:
        args.fn(args)
    except KeyboardInterrupt:
        print()
    except BrokenPipeError:
        pass


if __name__ == "__main__":
    main()
