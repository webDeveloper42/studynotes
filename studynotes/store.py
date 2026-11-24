#!/usr/bin/env python3
"""Local data layer for StudyNotes: SQLite storage, search, and Evernote .enex import/export.

Uses only the Python standard library. No network access.
"""
import base64
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from html import escape, unescape

ROOT = os.path.dirname(os.path.abspath(__file__))


def data_dir():
    """Where your notes live: $STUDYNOTES_DATA, else the usual place for app data on this computer (never inside the code folder)."""
    if os.environ.get("STUDYNOTES_DATA"):
        return os.path.expanduser(os.environ["STUDYNOTES_DATA"])
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/StudyNotes")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "studynotes")


DB_PATH = os.environ.get("NOTES_DB") or os.path.join(data_dir(), "notes.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS notebooks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created REAL NOT NULL,
    updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    notebook_id INTEGER NOT NULL REFERENCES notebooks(id),
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    plain TEXT NOT NULL DEFAULT '',
    starred INTEGER NOT NULL DEFAULT 0,
    trashed_at REAL,
    created REAL NOT NULL,
    updated REAL NOT NULL,
    kind TEXT NOT NULL DEFAULT 'canvas'
);
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id);
-- Which notes you wrote in, by the hour (unix time // 3600), for the activity chart.
-- Hours, not days, so the browser can sort them into your own local days.
CREATE TABLE IF NOT EXISTS activity (
    hour INTEGER NOT NULL,
    note_id INTEGER NOT NULL,
    saves INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (hour, note_id)
);
"""

WELCOME = """<h1>Welcome to StudyNotes 📚</h1>
<p>Your own study journal, running locally on this computer.</p>
<h2>Things to try</h2>
<ul class="checklist">
<li class="checked">Open the app</li>
<li>Create a notebook from the sidebar</li>
<li>Add tags to this note below the title</li>
<li>Star a note to add it to <b>Shortcuts</b></li>
<li>Search everything with <code>Ctrl+K</code></li>
</ul>
<p>Use the toolbar for <b>bold</b>, <i>italic</i>, <mark>highlights</mark>, lists, checklists, code blocks, tables and links. Paste or drop images straight into a note.</p>
<p>Moving to another computer? Open <b>Import &amp; Export</b> and download a backup, then restore it there.</p>"""


SETTINGS_PATH = os.path.join(os.path.dirname(DB_PATH), "settings.json")
DEFAULT_SETTINGS = {"name": "", "default_notebook": None, "notebook_order": []}


def load_settings():
    try:
        with open(SETTINGS_PATH) as f:
            return {**DEFAULT_SETTINGS, **json.load(f)}
    except (OSError, ValueError):
        return dict(DEFAULT_SETTINGS)


def save_settings(changes):
    settings = load_settings()
    settings.update({k: v for k, v in changes.items() if k in DEFAULT_SETTINGS})
    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
    with open(SETTINGS_PATH, "w") as f:
        json.dump(settings, f, indent=2)
    return settings


def now():
    return time.time()


def html_to_plain(html):
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<(br|/p|/div|/li|/h\d|/tr)[^>]*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"[ \t\r\f\v]+", " ", text).strip()


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def log_activity(conn, note_id, ts=None):
    """Marks that you wrote in this note during this hour."""
    conn.execute(
        "INSERT INTO activity (hour, note_id) VALUES (?, ?)"
        " ON CONFLICT(hour, note_id) DO UPDATE SET saves = saves + 1",
        (int((ts or now()) // 3600), note_id),
    )


def activity(conn, days=371):
    """[[hour, note_id], …] for roughly the last year."""
    since = int((now() - days * 86400) // 3600)
    return [[r[0], r[1]] for r in conn.execute(
        "SELECT hour, note_id FROM activity WHERE hour >= ? ORDER BY hour", (since,))]


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with connect() as conn:
        new_activity = not conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'activity'").fetchone()
        conn.executescript(SCHEMA)
        if "kind" not in {r[1] for r in conn.execute("PRAGMA table_info(notes)")}:
            # 'canvas' = the open page you place things on; 'plain' = just type. Older notes stay canvas.
            conn.execute("ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'canvas'")
        if "uid" not in {r[1] for r in conn.execute("PRAGMA table_info(notes)")}:
            # A note's identity across devices, so a backup restored elsewhere can tell "same note, newer" from "new note".
            conn.execute("ALTER TABLE notes ADD COLUMN uid TEXT")
        conn.execute("UPDATE notes SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL OR uid = ''")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_uid ON notes(uid)")
        if new_activity:
            # First run with the chart: fill it in from when each note was made and last changed.
            for row in conn.execute("SELECT id, created, updated FROM notes WHERE plain != '' OR title != ''").fetchall():
                for ts in {row["created"], row["updated"]}:
                    log_activity(conn, row["id"], ts)
        if conn.execute("SELECT COUNT(*) FROM notebooks").fetchone()[0] == 0:
            t = now()
            nb = conn.execute(
                "INSERT INTO notebooks (name, created, updated) VALUES (?, ?, ?)",
                ("First Notebook", t, t),
            ).lastrowid
            conn.execute(
                "INSERT INTO notes (notebook_id, title, content, plain, created, updated)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (nb, "Welcome to StudyNotes", WELCOME, html_to_plain(WELCOME), t, t),
            )


# ---------------------------------------------------------------- data access

def note_tags(conn, note_id):
    rows = conn.execute(
        "SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id"
        " WHERE nt.note_id = ? ORDER BY t.name COLLATE NOCASE",
        (note_id,),
    )
    return [r["name"] for r in rows]


def set_note_tags(conn, note_id, names):
    conn.execute("DELETE FROM note_tags WHERE note_id = ?", (note_id,))
    for name in {n.strip() for n in names if n and n.strip()}:
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
        tag_id = conn.execute("SELECT id FROM tags WHERE name = ?", (name,)).fetchone()["id"]
        conn.execute("INSERT OR IGNORE INTO note_tags VALUES (?, ?)", (note_id, tag_id))
    conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)")


def note_dict(conn, row, full=True):
    d = {
        "id": row["id"],
        "notebook_id": row["notebook_id"],
        "title": row["title"],
        "snippet": row["plain"][:200],
        "starred": bool(row["starred"]),
        "trashed": row["trashed_at"] is not None,
        "created": row["created"],
        "updated": row["updated"],
        "tags": note_tags(conn, row["id"]),
        "has_image": "<img" in row["content"],
        "has_file": "download=" in row["content"],
        "kind": row["kind"] if "kind" in row.keys() else "canvas",
    }
    if full:
        d["content"] = row["content"]
    return d


def state(conn):
    notebooks = [
        dict(r)
        for r in conn.execute(
            "SELECT nb.id, nb.name, nb.created, nb.updated,"
            " (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.trashed_at IS NULL) AS count"
            " FROM notebooks nb ORDER BY nb.name COLLATE NOCASE"
        )
    ]
    tags = [
        dict(r)
        for r in conn.execute(
            "SELECT t.id, t.name, COUNT(n.id) AS count FROM tags t"
            " JOIN note_tags nt ON nt.tag_id = t.id"
            " JOIN notes n ON n.id = nt.note_id AND n.trashed_at IS NULL"
            " GROUP BY t.id ORDER BY t.name COLLATE NOCASE"
        )
    ]
    counts = conn.execute(
        "SELECT"
        " SUM(trashed_at IS NULL) AS all_notes,"
        " SUM(trashed_at IS NULL AND starred = 1) AS starred,"
        " SUM(trashed_at IS NOT NULL) AS trash"
        " FROM notes"
    ).fetchone()
    return {
        "notebooks": notebooks,
        "tags": tags,
        "counts": {k: counts[k] or 0 for k in ("all_notes", "starred", "trash")},
    }


SORTS = {
    "updated": "n.updated DESC",
    "created": "n.created DESC",
    "title": "n.title COLLATE NOCASE ASC",
    "oldest": "n.updated ASC",
}


def list_notes(conn, q):
    view = q.get("view", "all")
    where, args = [], []
    where.append("n.trashed_at IS NOT NULL" if view == "trash" else "n.trashed_at IS NULL")
    if view == "starred":
        where.append("n.starred = 1")
    if q.get("notebook"):
        where.append("n.notebook_id = ?")
        args.append(int(q["notebook"]))
    if q.get("tag"):
        where.append(
            "n.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.name = ?)"
        )
        args.append(q["tag"])
    for term in parse_search(q.get("q", "")):
        kind, value = term
        if kind == "tag":
            where.append(
                "n.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.name LIKE ?)"
            )
            args.append(value + "%")
        elif kind == "notebook":
            where.append("n.notebook_id IN (SELECT id FROM notebooks WHERE name LIKE ?)")
            args.append(value + "%")
        elif kind == "intitle":
            where.append("n.title LIKE ?")
            args.append(f"%{value}%")
        elif kind == "todo":
            where.append("n.content LIKE ?")
            args.append('%class="checklist"%')
        else:
            where.append("(n.title LIKE ? OR n.plain LIKE ?)")
            args += [f"%{value}%", f"%{value}%"]
    order = SORTS.get(q.get("sort"), SORTS["updated"])
    sql = f"SELECT n.* FROM notes n WHERE {' AND '.join(where)} ORDER BY {order}"
    return [note_dict(conn, r, full=False) for r in conn.execute(sql, args)]


def parse_search(text):
    """Supports Evernote-ish operators: tag:x notebook:x intitle:x todo:* and "quoted phrases"."""
    terms = []
    for m in re.finditer(r'(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)', text or ""):
        op = (m.group(1) or m.group(3) or "").lower()
        val = m.group(2) if m.group(1) else m.group(4)
        if op in ("tag", "notebook", "intitle", "todo"):
            terms.append((op, val))
        elif m.group(5) is not None:
            terms.append(("text", m.group(5)))
        else:
            terms.append(("text", m.group(0)))
    return [t for t in terms if t[1]]


def get_note_row(conn, note_id):
    return conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()


KINDS = ("canvas", "plain")


def create_note(conn, body):
    nb = body.get("notebook_id") or conn.execute(
        "SELECT id FROM notebooks ORDER BY created LIMIT 1"
    ).fetchone()["id"]
    t = now()
    content = body.get("content", "")
    note_id = conn.execute(
        "INSERT INTO notes (notebook_id, title, content, plain, starred, created, updated, kind, uid)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (nb, body.get("title", ""), content, html_to_plain(content),
         int(bool(body.get("starred"))), body.get("created") or t, body.get("updated") or t,
         body.get("kind") if body.get("kind") in KINDS else "canvas", body.get("uid") or uuid.uuid4().hex),
    ).lastrowid
    if body.get("tags"):
        set_note_tags(conn, note_id, body["tags"])
    if content or body.get("title"):
        log_activity(conn, note_id, body.get("created") or t)
    return note_id


def update_note(conn, note_id, body):
    row = get_note_row(conn, note_id)
    if not row:
        return None
    fields, args = [], []
    for key in ("title", "notebook_id"):
        if key in body:
            fields.append(f"{key} = ?")
            args.append(body[key])
    if "content" in body:
        fields += ["content = ?", "plain = ?"]
        args += [body["content"], html_to_plain(body["content"])]
    if "starred" in body:
        fields.append("starred = ?")
        args.append(int(bool(body["starred"])))
    touches = any(k in body for k in ("title", "content", "notebook_id", "tags"))
    if (body.get("title", row["title"]) != row["title"]) or (body.get("content", row["content"]) != row["content"]):
        log_activity(conn, note_id)  # only real writing counts, not starring or moving
    if touches:
        fields.append("updated = ?")
        args.append(now())
    if fields:
        conn.execute(f"UPDATE notes SET {', '.join(fields)} WHERE id = ?", args + [note_id])
    if "tags" in body:
        set_note_tags(conn, note_id, body["tags"])
    return note_dict(conn, get_note_row(conn, note_id))


# ---------------------------------------------------------------- ENEX import/export

def _ts_to_enex(ts):
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(ts))


def _enex_to_ts(s):
    try:
        return float(time.mktime(time.strptime(s, "%Y%m%dT%H%M%SZ")) - time.timezone)
    except (TypeError, ValueError):
        return None


def import_enex(conn, data, notebook_name=None):
    # Drop the DOCTYPE so expat doesn't try to resolve the external DTD.
    data = re.sub(rb"<!DOCTYPE[^>]*>", b"", data, count=1)
    root = ET.fromstring(data)
    t = now()
    nb_name = notebook_name or "Imported " + time.strftime("%Y-%m-%d %H:%M")
    nb = conn.execute(
        "INSERT INTO notebooks (name, created, updated) VALUES (?, ?, ?)", (nb_name, t, t)
    ).lastrowid
    count = 0
    for note in root.iter("note"):
        resources = {}
        for res in note.findall("resource"):
            data_el = res.find("data")
            mime = (res.findtext("mime") or "application/octet-stream").strip()
            if data_el is None or not data_el.text:
                continue
            raw = base64.b64decode(re.sub(r"\s+", "", data_el.text))
            resources[hashlib.md5(raw).hexdigest()] = (mime, raw, res.findtext("resource-attributes/file-name"))
        enml = note.findtext("content") or ""
        content = enml_to_html(enml, resources)
        tags = [tg.text for tg in note.findall("tag") if tg.text]
        create_note(conn, {
            "notebook_id": nb,
            "title": note.findtext("title") or "Untitled",
            "content": content,
            "tags": tags,
            "created": _enex_to_ts(note.findtext("created")),
            "updated": _enex_to_ts(note.findtext("updated")),
        })
        count += 1
    return {"notebook_id": nb, "imported": count}


def enml_to_html(enml, resources):
    html = re.sub(r"<\?xml[^>]*\?>", "", enml)
    html = re.sub(r"<!DOCTYPE[^>]*>", "", html)
    html = re.sub(r"</?en-note[^>]*>", "", html).strip()

    # Evernote checkboxes: <en-todo checked="true"/>text inside a div → our checklist items.
    def todo_block(m):
        cls = ' class="checked"' if 'checked="true"' in m.group(1) else ""
        return f'<ul class="checklist"><li{cls}>{m.group(2)}</li></ul>'
    html = re.sub(r"<div>\s*<en-todo([^>]*)/?>(.*?)</div>", todo_block, html, flags=re.S)
    html = re.sub(r"<en-todo([^>]*)/?>", lambda m: "☑ " if 'checked="true"' in m.group(1) else "☐ ", html)
    html = html.replace("</ul><ul class=\"checklist\">", "")

    def media(m):
        h = re.search(r'hash="([0-9a-f]+)"', m.group(0))
        res = resources.get(h.group(1)) if h else None
        if not res:
            return ""
        mime, raw, fname = res
        url = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
        if mime.startswith("image/"):
            return f'<img src="{url}">'
        return f'<a href="{url}" download="{escape(fname or "attachment")}">📎 {escape(fname or "attachment")}</a>'
    html = re.sub(r"<en-media[^>]*?(/>|>\s*</en-media>)", media, html)
    html = re.sub(r"<en-crypt[^>]*>.*?</en-crypt>", "<p><i>[encrypted content]</i></p>", html, flags=re.S)
    return html


VOID = r"(br|hr|img|input|col|area|wbr)"


def html_to_enml(html):
    resources = []

    def img(m):
        src = re.search(r'src="data:([^;"]+);base64,([^"]+)"', m.group(0))
        if not src:
            return ""
        mime, b64 = src.group(1), src.group(2)
        raw = base64.b64decode(b64)
        h = hashlib.md5(raw).hexdigest()
        resources.append((mime, b64, h))
        return f'<en-media type="{mime}" hash="{h}"/>'
    body = re.sub(r"<img\b[^>]*>", img, html, flags=re.I)

    def checklist(m):
        items = re.findall(r"<li([^>]*)>(.*?)</li>", m.group(1), flags=re.S)
        out = []
        for attrs, text in items:
            checked = "true" if "checked" in attrs else "false"
            out.append(f'<div><en-todo checked="{checked}"/>{text}</div>')
        return "".join(out)
    body = re.sub(r'<ul class="checklist">(.*?)</ul>', checklist, body, flags=re.S)
    # ENML is XHTML: make void elements self-closing and strip disallowed attributes.
    body = re.sub(rf"<{VOID}\b([^>]*?)/?>", r"<\1\2/>", body, flags=re.I)
    body = re.sub(r'\s(class|id|contenteditable|data-[\w-]+|spellcheck)="[^"]*"', "", body)
    body = body.replace("&nbsp;", "&#160;")
    enml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">'
        f"<en-note>{body}</en-note>"
    )
    return enml, resources


def export_enex(conn, notebook_id=None, note_id=None):
    sql, args = "SELECT * FROM notes WHERE trashed_at IS NULL", []
    if notebook_id:
        sql += " AND notebook_id = ?"
        args.append(notebook_id)
    if note_id:
        sql += " AND id = ?"
        args.append(note_id)
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n'
        f'<en-export export-date="{_ts_to_enex(now())}" application="Notes" version="1.0">\n'
    ]
    for row in conn.execute(sql, args):
        enml, resources = html_to_enml(row["content"])
        parts.append("<note>")
        parts.append(f"<title>{escape(row['title'] or 'Untitled')}</title>")
        parts.append(f"<created>{_ts_to_enex(row['created'])}</created>")
        parts.append(f"<updated>{_ts_to_enex(row['updated'])}</updated>")
        for tag in note_tags(conn, row["id"]):
            parts.append(f"<tag>{escape(tag)}</tag>")
        parts.append(f"<content><![CDATA[{enml.replace(']]>', ']]]]><![CDATA[>')}]]></content>")
        for mime, b64, _h in resources:
            parts.append(f'<resource><data encoding="base64">{b64}</data><mime>{mime}</mime></resource>')
        parts.append("</note>\n")
    parts.append("</en-export>\n")
    return "".join(parts).encode()


# ---------------------------------------------------------------- whole-app backup (move to another device)

BACKUP_FORMAT = "studynotes-backup"
BACKUP_VERSION = 1
NOTE_LINK = re.compile(r'href="#note/(\d{1,9})"')


class BackupError(ValueError):
    """The file isn't a backup this app can read. The message is meant for you."""


def export_backup(conn):
    """Everything: notebooks, notes (Trash too), tags, page kinds, the activity chart and tab order, as one JSON-ready dict."""
    conn.execute("UPDATE notes SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL OR uid = ''")
    notebooks = [dict(r) for r in conn.execute("SELECT id, name, created, updated FROM notebooks ORDER BY id")]
    notes, uids = [], {}
    for row in conn.execute("SELECT * FROM notes ORDER BY id"):
        uids[row["id"]] = row["uid"]
        notes.append({
            "id": row["id"], "uid": row["uid"], "notebook_id": row["notebook_id"], "title": row["title"],
            "content": row["content"], "starred": bool(row["starred"]), "trashed_at": row["trashed_at"],
            "created": row["created"], "updated": row["updated"], "kind": row["kind"], "tags": note_tags(conn, row["id"]),
        })
    activity_rows = [[r["hour"], uids[r["note_id"]], r["saves"]]
                     for r in conn.execute("SELECT hour, note_id, saves FROM activity ORDER BY hour") if r["note_id"] in uids]
    settings = load_settings()
    return {
        "format": BACKUP_FORMAT, "version": BACKUP_VERSION, "app": "StudyNotes", "exported_at": now(),
        "notebooks": notebooks, "notes": notes, "activity": activity_rows,
        "settings": {"name": settings.get("name") or "", "default_notebook": settings.get("default_notebook"),
                     "notebook_order": settings.get("notebook_order") or []},
    }


def _num(value, fallback=None):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else fallback


def _check_backup(data):
    if not isinstance(data, dict) or data.get("format") != BACKUP_FORMAT:
        raise BackupError("That isn't a StudyNotes backup file")
    if not isinstance(data.get("version"), int) or data["version"] > BACKUP_VERSION:
        raise BackupError("That backup was made by a newer version of StudyNotes. Update this copy first")
    notebooks, notes = data.get("notebooks"), data.get("notes")
    if not isinstance(notebooks, list) or not isinstance(notes, list) or not notebooks:
        raise BackupError("That backup file is incomplete")
    for nb in notebooks:
        if not isinstance(nb, dict) or not isinstance(nb.get("id"), int) or not isinstance(nb.get("name"), str) or not nb["name"].strip():
            raise BackupError("That backup has a notebook it can't read")
    for n in notes:
        if not (isinstance(n, dict) and isinstance(n.get("uid"), str) and re.fullmatch(r"[0-9a-f]{8,64}", n["uid"])
                and isinstance(n.get("notebook_id"), int) and isinstance(n.get("title", ""), str) and isinstance(n.get("content", ""), str)):
            raise BackupError("That backup has a note it can't read")
        if not isinstance(n.get("tags", []), list) or not all(isinstance(t, str) for t in n.get("tags", [])):
            raise BackupError("That backup has tags it can't read")


def import_backup(conn, data, mode="merge", clean=lambda html: html):
    """Brings a backup in.

    merge:   notes you don't have are added; a note you do have (same uid) is replaced only if the backup's copy is newer.
    replace: everything here is removed first, so this copy ends up exactly like the backup.
    Notebooks are matched by name. Links between notes are pointed at the new note numbers.
    """
    if mode not in ("merge", "replace"):
        raise BackupError("Pick merge or replace")
    _check_backup(data)
    if mode == "replace":
        for table in ("note_tags", "tags", "activity", "notes", "notebooks"):
            conn.execute(f"DELETE FROM {table}")
    t = now()
    nb_map, made = {}, []
    for nb in data["notebooks"]:
        name = nb["name"].strip()[:100]
        row = conn.execute("SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
        if row:
            nb_map[nb["id"]] = row["id"]
        else:
            nb_map[nb["id"]] = conn.execute("INSERT INTO notebooks (name, created, updated) VALUES (?, ?, ?)",
                                            (name, _num(nb.get("created"), t), _num(nb.get("updated"), t))).lastrowid
            made.append(nb_map[nb["id"]])
    fallback = conn.execute("SELECT id FROM notebooks ORDER BY created LIMIT 1").fetchone()["id"]
    added = updated = skipped = 0
    by_uid, touched, old_ids = {}, [], {}
    for n in data["notes"]:
        content = clean(n.get("content") or "")
        fields = {
            "notebook_id": nb_map.get(n["notebook_id"], fallback), "title": (n.get("title") or "")[:500], "content": content,
            "plain": html_to_plain(content), "starred": int(bool(n.get("starred"))), "trashed_at": _num(n.get("trashed_at")),
            "created": _num(n.get("created"), t), "updated": _num(n.get("updated"), t),
            "kind": n.get("kind") if n.get("kind") in KINDS else "canvas",
        }
        mine = conn.execute("SELECT id, updated FROM notes WHERE uid = ?", (n["uid"],)).fetchone()
        if mine and mine["updated"] >= fields["updated"]:
            by_uid[n["uid"]] = mine["id"]
            skipped += 1
        elif mine:
            conn.execute(f"UPDATE notes SET {', '.join(k + ' = ?' for k in fields)} WHERE id = ?", [*fields.values(), mine["id"]])
            by_uid[n["uid"]] = mine["id"]
            touched.append(mine["id"])
            updated += 1
        else:
            cols = [*fields, "uid"]
            by_uid[n["uid"]] = conn.execute(f"INSERT INTO notes ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                                            [*fields.values(), n["uid"]]).lastrowid
            touched.append(by_uid[n["uid"]])
            added += 1
        if touched and touched[-1] == by_uid[n["uid"]]:
            set_note_tags(conn, by_uid[n["uid"]], [tg[:100] for tg in n.get("tags", [])][:50])
        if isinstance(n.get("id"), int):
            old_ids[n["id"]] = by_uid[n["uid"]]
    # [[links]] are href="#note/<number>", and numbers differ from one device to the next.
    for note_id in touched:
        content = conn.execute("SELECT content FROM notes WHERE id = ?", (note_id,)).fetchone()["content"]
        fixed = NOTE_LINK.sub(lambda m: f'href="#note/{old_ids.get(int(m.group(1)), int(m.group(1)))}"', content)
        if fixed != content:
            conn.execute("UPDATE notes SET content = ? WHERE id = ?", (fixed, note_id))
    for item in data.get("activity") or []:
        if (isinstance(item, list) and len(item) == 3 and isinstance(item[0], int) and isinstance(item[2], int)
                and item[1] in by_uid):
            conn.execute("INSERT INTO activity (hour, note_id, saves) VALUES (?, ?, ?)"
                         " ON CONFLICT(hour, note_id) DO UPDATE SET saves = MAX(saves, excluded.saves)",
                         (item[0], by_uid[item[1]], max(1, item[2])))
    s = data.get("settings") if isinstance(data.get("settings"), dict) else {}
    order = [nb_map[i] for i in s.get("notebook_order") or [] if isinstance(i, int) and i in nb_map]
    current = load_settings()
    if mode == "replace":
        save_settings({"notebook_order": list(dict.fromkeys(order)),
                       "default_notebook": nb_map.get(s.get("default_notebook")) if isinstance(s.get("default_notebook"), int) else None,
                       "name": s.get("name") if isinstance(s.get("name"), str) else current.get("name", "")})
    elif made and current.get("notebook_order"):
        save_settings({"notebook_order": [*current["notebook_order"], *[i for i in made if i not in current["notebook_order"]]]})
    return {"added": added, "updated": updated, "skipped": skipped, "notebooks": len(made)}
