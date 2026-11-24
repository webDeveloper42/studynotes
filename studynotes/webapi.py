"""What the web page can do with your notes. Storage rules come from store.py, like the terminal app.

Note content is HTML and can come from imported files, so everything sent to or saved from the page
passes through clean_html first.
"""
import binascii
import json
import datetime as dt
import os
import re
import sqlite3
import sys
import time
import xml.etree.ElementTree as ET
from html import escape
from html.parser import HTMLParser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clip  # noqa: E402
import store  # noqa: E402

MAX_TITLE = 500
MAX_CONTENT = 25 * 1024 * 1024
MAX_NAME = 100
MAX_IMPORT = 200 * 1024 * 1024
KEEP_BACKUPS = 14

ALLOWED = {"p", "div", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "b", "strong", "i", "em", "u", "s", "strike", "del", "mark",
           "code", "pre", "blockquote", "ul", "ol", "li", "a", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "sub", "sup", "span"}
VOID = {"br", "hr", "img"}
# Browsers move these out of a paragraph when they load a note, leaving stray empty ones, so close it first.
NOT_IN_PARAGRAPH = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "pre", "blockquote", "table", "hr"}
DROP_WITH_CONTENT = {"script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "head", "title", "applet", "frameset", "textarea", "select", "button"}
SAFE_IMAGE = re.compile(r"data:image/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+\Z", re.I)
SAFE_LINK = re.compile(r"(https?://|mailto:|#note/\d{1,9}\Z|/jobs/#job/\d{1,9}\Z)", re.I)   # web, email, another note (and a dashboard job link, kept as-is)
CHECKLIST = re.compile(r'<ul class="checklist">(.*?)</ul>', re.S)
CHECK_ITEM = re.compile(r'<li( class="checked")?>(.*?)</li>', re.S)
# A designed journal page: free text boxes, shapes and lines, sticky notes, tape, stickers, photos and pen ink.
# Only these classes and short layout values (positions, sizes, color names) are kept.
JOURNAL_CLASSES = {"jpage", "jink", "jbox", "jsticky", "jtape", "jsticker", "jphoto", "jshape", "jfile"}
JOURNAL_DATA = ("data-x", "data-y", "data-w", "data-h", "data-r", "data-c", "data-f", "data-s", "data-b", "data-paper", "data-tint", "data-pages",
                "data-id", "data-ea", "data-eb")  # id: a thing a line is joined to; ea/eb: what each end of a line is joined to
# Coloured words and highlights: only a text colour or a background colour, and only as hex or rgb()/rgba() numbers.
STYLE_PROPS = {"color", "background-color"}
STYLE_COLOR = re.compile(r"#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)\Z", re.I)


def _safe_style(value):
    kept = []
    for part in (value or "").split(";"):
        name, _, val = part.partition(":")
        name, val = name.strip().lower(), val.strip()
        if name in STYLE_PROPS and STYLE_COLOR.fullmatch(val):
            kept.append(f"{name}: {val}")
    return "; ".join(kept)


ALIGNABLE = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "div", "blockquote"}
TEXT_ALIGN = re.compile(r"\s*text-align\s*:\s*(left|center|right|justify)\s*;?\s*\Z", re.I)


def _align_style(value):
    """Only a paragraph's alignment survives on a block: left, center, right or justify."""
    for part in (value or "").split(";"):
        m = TEXT_ALIGN.match(part)
        if m:
            return f"text-align: {m.group(1).lower()}"
    return ""
JOURNAL_VALUE = re.compile(r"-?[a-z0-9.]{1,16}\Z", re.I)
MAX_ATTACHMENT = 15 * 1024 * 1024


class NotesError(ValueError):
    """Something you can fix. The message is meant for you."""


def _plain_url(value):
    """What a browser would read: control characters and spaces can't hide a scheme."""
    return re.sub(r"[\x00-\x20\x7f]", "", value or "")


class _Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.open, self.skip = [], [], []
        self.spans = []  # for each <span> seen: kept (it carries a colour) or dropped (its words stay)

    def handle_starttag(self, tag, attrs):
        if self.skip:
            if tag == self.skip[-1]:
                self.skip.append(tag)
            return
        if tag in DROP_WITH_CONTENT:
            self.skip.append(tag)
            return
        if tag not in ALLOWED:
            return
        if tag == "span":
            self.spans.append(bool(_safe_style(dict(attrs).get("style"))))
            if not self.spans[-1]:
                return
        if tag in NOT_IN_PARAGRAPH and "p" in self.open:
            self.handle_endtag("p")
        attrs = dict(attrs)
        kept = []
        if tag == "a":
            href = _plain_url(attrs.get("href"))
            if SAFE_LINK.match(href):
                kept.append(("href", href))
            elif "download" in attrs and href.lower().startswith("data:") and not href.lower().startswith(("data:text/html", "data:image/svg")):
                kept += [("href", href), ("download", attrs.get("download") or "attachment")]
        elif tag == "img":
            src = _plain_url(attrs.get("src"))
            if not (SAFE_IMAGE.match(src) or re.match(r"https?://", src, re.I)):
                return
            kept.append(("src", src))
            if attrs.get("alt"):
                kept.append(("alt", attrs["alt"]))
            if re.fullmatch(r"\d{1,4}", attrs.get("width") or ""):  # a picture resized in the editor
                kept.append(("width", attrs["width"]))
        elif tag == "ul" and attrs.get("class") == "checklist":
            kept.append(("class", "checklist"))
        elif tag == "li" and attrs.get("class") == "checked":
            kept.append(("class", "checked"))
        elif tag in ("td", "th"):
            kept += [(k, attrs[k]) for k in ("colspan", "rowspan") if (attrs.get(k) or "").isdigit()]
        elif tag in ("span", "mark") and _safe_style(attrs.get("style")):
            kept.append(("style", _safe_style(attrs.get("style"))))
        elif tag == "div" and attrs.get("class") in JOURNAL_CLASSES:
            kept.append(("class", attrs["class"]))
            kept += [(k, attrs[k]) for k in JOURNAL_DATA if JOURNAL_VALUE.match(attrs.get(k) or "")]
        if tag in ALIGNABLE and _align_style(attrs.get("style")):
            kept.append(("style", _align_style(attrs.get("style"))))
        text = "".join(f' {k}="{escape(v or "", quote=True)}"' for k, v in kept)
        self.out.append(f"<{tag}{text}>")
        if tag not in VOID:
            self.open.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID and not self.skip:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.skip:
            if tag == self.skip[-1]:
                self.skip.pop()
            return
        if tag == "span" and self.spans and not self.spans.pop():
            return
        if tag in self.open:
            while self.open:
                last = self.open.pop()
                self.out.append(f"</{last}>")
                if last == tag:
                    break

    def handle_data(self, data):
        if not self.skip:
            self.out.append(escape(data, quote=False))

    def finish(self):
        self.close()
        while self.open:
            self.out.append(f"</{self.open.pop()}>")
        return re.sub(r"<p>(\s|<br>)*</p>", "", "".join(self.out)) if len(self.out) > 3 else "".join(self.out)


def clean_html(html):
    cleaner = _Cleaner()
    cleaner.feed(html or "")
    return cleaner.finish()


def _text(value, limit, label):
    if not isinstance(value, str):
        raise NotesError(f"Enter {label}")
    return value.strip()[:limit]


def _id(value, label="note"):
    if isinstance(value, bool) or not isinstance(value, int):
        raise NotesError(f"Pick a {label}")
    return value


class NotesApi:
    def __init__(self, path=None):
        store.DB_PATH = path or os.environ.get("NOTES_DB") or os.path.join(store.data_dir(), "notes.db")
        store.SETTINGS_PATH = os.path.join(os.path.dirname(store.DB_PATH), "settings.json")
        store.init_db()
        self._backup()

    def _backup(self):
        """One copy a day, keeping the newest few, since this page can change your notes."""
        try:
            folder = os.path.join(os.path.dirname(store.DB_PATH), "backups")
            os.makedirs(folder, mode=0o700, exist_ok=True)
            target = os.path.join(folder, f"web-notes-{dt.date.today().isoformat()}.db")
            if not os.path.exists(target):
                source, out = store.connect(), sqlite3.connect(target)
                try:
                    source.backup(out)
                finally:
                    out.close()
                    source.close()
                os.chmod(target, 0o600)
            old = sorted(f for f in os.listdir(folder) if f.startswith("web-notes-") and f.endswith(".db"))
            for name in old[:-KEEP_BACKUPS]:
                os.remove(os.path.join(folder, name))
        except (OSError, sqlite3.Error):
            pass  # a failed backup shouldn't lock you out of your notes

    def _with(self, fn, *args):
        conn = store.connect()
        conn.execute("PRAGMA busy_timeout = 5000")
        try:
            with conn:
                return fn(conn, *args)
        finally:
            conn.close()

    # ── reading ──────────────────────────────────────────────────────────
    def state(self, view="all", query="", sort="updated"):
        return self._with(self._state, view or "all", query or "", sort or "updated")

    def _state(self, conn, view, query, sort):
        kind, _, arg = view.partition(":")
        where, title = {"q": query, "sort": sort}, "Notes"
        side = store.state(conn)
        order = {nb: i for i, nb in enumerate(store.load_settings().get("notebook_order") or [])}  # the order you dragged the tabs into
        side["notebooks"].sort(key=lambda n: (order.get(n["id"], len(order)), n["name"].lower()))
        if kind == "starred":
            where["view"], title = "starred", "Shortcuts"
        elif kind == "trash":
            where["view"], title = "trash", "Trash"
        elif kind == "notebook":
            match = next((n for n in side["notebooks"] if str(n["id"]) == arg), None)
            if not match:
                raise NotesError("That notebook no longer exists")
            where["notebook"], title = match["id"], match["name"]
        elif kind == "tag":
            where["tag"], title = arg, f"#{arg}"
        elif kind == "todos":
            todos = self._todos(conn)
            return {**side, "view": view, "title": "To-do", "default_notebook": None, "notes": [], "todos": todos,
                    "counts": {**side["counts"], "todos": len(todos)}}
        elif kind != "all":
            raise NotesError("Unknown view")
        settings = store.load_settings()
        default = settings.get("default_notebook") if any(n["id"] == settings.get("default_notebook") for n in side["notebooks"]) else None
        default = default or (min(side["notebooks"], key=lambda n: n["created"])["id"] if side["notebooks"] else None)
        side["counts"]["todos"] = len(self._todos(conn))
        return {**side, "view": view, "title": title, "default_notebook": default, "notes": store.list_notes(conn, where),
                "activity": store.activity(conn)}

    def note(self, note_id):
        return self._with(self._note, note_id)

    def _existing(self, conn, note_id):
        row = store.get_note_row(conn, _id(note_id))
        if not row:
            raise NotesError("That note no longer exists")
        return row

    def _note(self, conn, note_id):
        full = store.note_dict(conn, self._existing(conn, note_id))
        full["content"] = clean_html(full["content"])
        # notes that link here: [[links]] are <a href="#note/ID">
        full["backlinks"] = [{"id": r["id"], "title": r["title"] or "Untitled"} for r in conn.execute(
            "SELECT id, title FROM notes WHERE trashed_at IS NULL AND id != ? AND content LIKE ? ORDER BY updated DESC LIMIT 50",
            (full["id"], f'%href="#note/{full["id"]}"%'))]
        return full

    # ── to-dos from every note ──────────────────────────────────────────
    def _todos(self, conn):
        """Every unchecked checklist item in your notes (not the Trash), with where it is."""
        out = []
        for r in conn.execute("SELECT id, title, content, updated FROM notes WHERE trashed_at IS NULL AND content LIKE '%class=\"checklist\"%' ORDER BY updated DESC"):
            n = 0
            for block in CHECKLIST.finditer(r["content"]):
                for item in CHECK_ITEM.finditer(block.group(1)):
                    text = " ".join(store.html_to_plain(item.group(2)).split())
                    if not item.group(1) and text:
                        out.append({"note_id": r["id"], "title": r["title"] or "Untitled", "index": n, "text": text[:500]})
                    n += 1
        return out

    def export_enex(self, notebook=None, note=None):
        """An Evernote .enex file of everything, one notebook, or one note."""
        def make(conn):
            if notebook is not None and not conn.execute("SELECT 1 FROM notebooks WHERE id = ?", (notebook,)).fetchone():
                raise NotesError("That notebook no longer exists")
            if note is not None:
                self._existing(conn, note)
            return store.export_enex(conn, notebook, note)
        return self._with(make)

    def import_enex(self, path, name=None):
        """Bring in an Evernote .enex file as a new notebook. Unsafe content is cleaned whenever it's shown."""
        if os.path.getsize(path) > MAX_IMPORT:
            raise NotesError("That file is too big to import here")
        with open(path, "rb") as f:
            data = f.read()
        title = _text(name, MAX_NAME, "a name") if name else None

        def bring_in(conn):
            try:
                return store.import_enex(conn, data, title or None)
            except (ET.ParseError, ValueError, TypeError, binascii.Error):
                raise NotesError("That doesn't look like an Evernote .enex file") from None
        out = self._with(bring_in)
        count = out["imported"]
        return {"notebook_id": out["notebook_id"], "imported": count, "message": f"Imported {count} note{'' if count == 1 else 's'}"}

    # ── moving everything to another device ─────────────────────────────
    def export_backup(self):
        """One .studynotes file with every notebook, note, tag and chart square, to restore on another computer."""
        return json.dumps(self._with(store.export_backup), ensure_ascii=False, separators=(",", ":")).encode()

    def backup_name(self):
        return f"studynotes-backup-{dt.date.today().isoformat()}.studynotes"

    def restore_backup(self, path, mode="merge"):
        """Bring a .studynotes backup in. A copy of what's here now is saved first, whichever way you choose."""
        if mode not in ("merge", "replace"):
            raise NotesError("Pick merge or replace")
        if os.path.getsize(path) > MAX_IMPORT:
            raise NotesError("That file is too big to restore here")
        try:
            with open(path, "rb") as f:
                data = json.loads(f.read().decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise NotesError("That isn't a StudyNotes backup file") from None
        saved = self._with(self._do_backup, {})["message"]

        def bring_in(conn):
            try:
                return store.import_backup(conn, data, mode, clean_html)
            except store.BackupError as e:
                raise NotesError(str(e)) from None
        out = self._with(bring_in)
        plural = lambda n, word: f"{n} {word}{'' if n == 1 else 's'}"
        parts = [plural(out["added"], "note") + " added"]
        if out["updated"]:
            parts.append(f"{out['updated']} updated")
        if out["skipped"]:
            parts.append(f"{out['skipped']} already up to date")
        lead = "Restored the backup" if mode == "replace" else "Merged the backup"
        return {**out, "mode": mode, "message": f"{lead}: {', '.join(parts)}", "safety_copy": saved}

    # ── changing ─────────────────────────────────────────────────────────
    def do(self, action, data):
        handler = getattr(self, f"_do_{action}", None) if isinstance(action, str) and action.isidentifier() else None
        if not handler:
            raise NotesError("Unknown action")
        return self._with(handler, data)

    def _notebook(self, conn, nb):
        _id(nb, "notebook")
        if not conn.execute("SELECT 1 FROM notebooks WHERE id = ?", (nb,)).fetchone():
            raise NotesError("That notebook no longer exists")
        return nb

    def _do_new(self, conn, d):
        nb = d.get("notebook_id")
        if nb is not None:
            self._notebook(conn, nb)
        else:
            settings = store.load_settings()
            row = conn.execute("SELECT id FROM notebooks WHERE id = ?", (settings.get("default_notebook"),)).fetchone()
            nb = row["id"] if row else conn.execute("SELECT id FROM notebooks ORDER BY created LIMIT 1").fetchone()["id"]
        tag = d.get("tag")
        kind = d.get("kind", "canvas")
        if kind not in store.KINDS:
            raise NotesError("Pick a canvas page or a plain page")
        note_id = store.create_note(conn, {"notebook_id": nb, "title": "", "content": "", "kind": kind, "tags": [tag] if isinstance(tag, str) and tag else []})
        return {"id": note_id}

    def _do_set_kind(self, conn, d):
        """Switches a note between the canvas page and the plain page. Nothing in it is removed."""
        row = self._existing(conn, d.get("id"))
        if d.get("kind") not in store.KINDS:
            raise NotesError("Pick a canvas page or a plain page")
        conn.execute("UPDATE notes SET kind = ? WHERE id = ?", (d["kind"], row["id"]))
        return {"kind": d["kind"], "message": "Now a canvas page" if d["kind"] == "canvas" else "Now a plain page"}

    def _do_save(self, conn, d):
        """Refuses to overwrite a note that changed somewhere else since you opened it, unless told to."""
        row = self._existing(conn, d.get("id"))
        if row["trashed_at"] is not None:
            raise NotesError("Restore this note from the trash to edit it")
        if not d.get("force") and d.get("base") != row["updated"]:
            return {"conflict": True, "note": self._note(conn, row["id"])}
        body = {}
        if "title" in d:
            body["title"] = _text(d["title"], MAX_TITLE, "a title")
        if "content" in d:
            if not isinstance(d["content"], str) or len(d["content"]) > MAX_CONTENT:
                raise NotesError("That note is too large to save. Try smaller images")
            body["content"] = clean_html(d["content"])
        if "tags" in d:
            if not isinstance(d["tags"], list) or not all(isinstance(t, str) for t in d["tags"]):
                raise NotesError("Bad tags")
            body["tags"] = [t.strip().lstrip("#")[:MAX_NAME] for t in d["tags"] if t.strip().lstrip("#")][:50]
        saved = store.update_note(conn, row["id"], body)
        return {"updated": saved["updated"], "tags": saved["tags"]}

    def _do_todo_check(self, conn, d):
        """Check off (or uncheck) one checklist item, found by its place among the note's checklist items."""
        row = self._existing(conn, d.get("id"))
        index = d.get("index")
        if not isinstance(index, int) or index < 0:
            raise NotesError("Pick an item")
        content, n, done = row["content"], 0, False
        out, pos = [], 0
        for block in CHECKLIST.finditer(content):
            inner, start = block.group(1), block.start(1)
            for item in CHECK_ITEM.finditer(inner):
                if n == index:
                    want = bool(d.get("checked", True))
                    tag = '<li class="checked">' if want else "<li>"
                    a = start + item.start()
                    out.append(content[pos:a] + tag)
                    pos = a + len(item.group(0)) - len(item.group(2)) - len("</li>")
                    done = True
                n += 1
        if not done:
            raise NotesError("That item isn't in the note anymore")
        out.append(content[pos:])
        saved = store.update_note(conn, row["id"], {"content": clean_html("".join(out))})
        return {"updated": saved["updated"], "message": "Checked off" if d.get("checked", True) else "Unchecked"}

    def _do_titles(self, conn, d):
        """Notes whose title matches, for [[links]]."""
        q = str(d.get("q") or "").strip()
        rows = conn.execute("SELECT id, title FROM notes WHERE trashed_at IS NULL AND title != '' AND title LIKE ? ORDER BY title LIKE ? DESC, updated DESC LIMIT 8",
                            (f"%{q}%", f"{q}%"))
        return {"notes": [{"id": r["id"], "title": r["title"]} for r in rows]}

    def _do_clip(self, conn, d):
        """A web page saved as a new note: its title, main text and a link back."""
        url = _text(d.get("url"), 2000, "a web address")
        try:
            title, html = clip.read(url)
        except clip.ClipError as e:
            raise NotesError(str(e)) from None
        nb = d.get("notebook_id")
        if nb is not None:
            self._notebook(conn, nb)
        else:
            settings = store.load_settings()
            row = conn.execute("SELECT id FROM notebooks WHERE id = ?", (settings.get("default_notebook"),)).fetchone()
            nb = row["id"] if row else conn.execute("SELECT id FROM notebooks ORDER BY created LIMIT 1").fetchone()["id"]
        content = clean_html(html)[:MAX_CONTENT]
        note_id = store.create_note(conn, {"notebook_id": nb, "title": title[:MAX_TITLE], "content": content, "tags": ["web clip"]})
        return {"id": note_id, "message": f"Saved “{title[:60]}”"}

    def _do_star(self, conn, d):
        row = self._existing(conn, d.get("id"))
        store.update_note(conn, row["id"], {"starred": bool(d.get("starred"))})
        return {"message": ""}

    def _do_move(self, conn, d):
        row = self._existing(conn, d.get("id"))
        saved = store.update_note(conn, row["id"], {"notebook_id": self._notebook(conn, d.get("notebook_id"))})
        return {"message": "Moved", "updated": saved["updated"]}

    def _do_trash(self, conn, d):
        row = self._existing(conn, d.get("id"))
        conn.execute("UPDATE notes SET trashed_at = ? WHERE id = ?", (store.now(), row["id"]))
        return {"message": "Moved to Trash"}

    def _do_restore(self, conn, d):
        row = self._existing(conn, d.get("id"))
        conn.execute("UPDATE notes SET trashed_at = NULL WHERE id = ?", (row["id"],))
        return {"message": "Restored"}

    def _do_delete_forever(self, conn, d):
        row = self._existing(conn, d.get("id"))
        if row["trashed_at"] is None:
            raise NotesError("Move it to the Trash first")
        conn.execute("DELETE FROM notes WHERE id = ?", (row["id"],))
        conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)")
        return {"message": "Deleted forever"}

    def _do_discard_empty(self, conn, d):
        """A note you opened with New and never typed in leaves nothing behind."""
        row = store.get_note_row(conn, _id(d.get("id")))
        if row and row["trashed_at"] is None and not row["title"].strip() and not row["plain"].strip() and "<img" not in row["content"] and "<table" not in row["content"] and "<a " not in row["content"] and "<hr" not in row["content"] and not store.note_tags(conn, row["id"]):
            conn.execute("DELETE FROM notes WHERE id = ?", (row["id"],))
        return {"message": ""}

    def _do_empty_trash(self, conn, d):
        count = conn.execute("DELETE FROM notes WHERE trashed_at IS NOT NULL").rowcount
        conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)")
        return {"message": f"Deleted {count} note{'' if count == 1 else 's'} forever"}

    def _name(self, conn, d, current=None):
        name = _text(d.get("name"), MAX_NAME, "a name")
        if not name:
            raise NotesError("Give the notebook a name")
        other = conn.execute("SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
        if other and other["id"] != current:
            raise NotesError("You already have a notebook with that name")
        return name

    def _do_add_notebook(self, conn, d):
        name, stamp = self._name(conn, d), store.now()
        nb = conn.execute("INSERT INTO notebooks (name, created, updated) VALUES (?, ?, ?)", (name, stamp, stamp)).lastrowid
        return {"id": nb, "message": f"Added {name}"}

    def _do_default_notebook(self, conn, d):
        nb = self._notebook(conn, d.get("id"))
        store.save_settings({"default_notebook": nb})
        return {"message": "New notes will go to this notebook"}

    def _do_backup(self, conn, d):
        """A dated copy you asked for, separate from the automatic daily ones."""
        folder = os.path.join(os.path.dirname(store.DB_PATH), "backups")
        os.makedirs(folder, mode=0o700, exist_ok=True)
        path = os.path.join(folder, f"notes-{time.strftime('%Y%m%d-%H%M%S')}.db")
        out = sqlite3.connect(path)
        try:
            conn.backup(out)
        finally:
            out.close()
        os.chmod(path, 0o600)
        return {"message": f"Backed up to {path}"}

    def _do_order_notebooks(self, conn, d):
        ids = d.get("ids")
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            raise NotesError("That order couldn't be saved")
        known = {r["id"] for r in conn.execute("SELECT id FROM notebooks")}
        store.save_settings({"notebook_order": [i for i in dict.fromkeys(ids) if i in known]})
        return {"message": "Tabs rearranged"}

    def _do_rename_notebook(self, conn, d):
        nb = self._notebook(conn, d.get("id"))
        conn.execute("UPDATE notebooks SET name = ?, updated = ? WHERE id = ?", (self._name(conn, d, nb), store.now(), nb))
        return {"message": "Renamed"}

    def _do_delete_notebook(self, conn, d):
        """Same rule as the terminal app: its notes go to the Trash, so nothing is lost right away."""
        nb = self._notebook(conn, d.get("id"))
        other = conn.execute("SELECT id FROM notebooks WHERE id != ? ORDER BY created LIMIT 1", (nb,)).fetchone()
        if not other:
            raise NotesError("You need at least one notebook")
        conn.execute("UPDATE notes SET trashed_at = COALESCE(trashed_at, ?), notebook_id = ? WHERE notebook_id = ?", (store.now(), other["id"], nb))
        conn.execute("DELETE FROM notebooks WHERE id = ?", (nb,))
        return {"message": "Notebook deleted. Its notes are in the Trash"}
