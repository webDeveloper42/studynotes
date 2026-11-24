import importlib.util
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "studynotes"))
import webapi  # noqa: E402
from webapi import NotesApi, NotesError, clean_html  # noqa: E402


class Clean(unittest.TestCase):
    def test_keeps_what_notes_use(self):
        html = ('<h1>T</h1><p><b>a</b> <i>b</i> <u>c</u> <mark>d</mark> <code>e</code></p><ul class="checklist"><li class="checked">x</li><li>y</li></ul>'
                '<ol><li>z</li></ol><blockquote>q</blockquote><pre>a  b\nc</pre><hr><table><tr><th>h</th><td colspan="2">d</td></tr></table>'
                '<a href="https://example.com/?a=1&amp;b=2">l</a><img src="data:image/png;base64,AAAA">')
        self.assertEqual(clean_html(html), html)

    def test_removes_anything_that_could_run(self):
        attacks = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<img src="javascript:alert(1)">', '<a href="javascript:alert(1)">x</a>',
                   '<a href=" java\tscript:alert(1)">x</a>', '<a href="&#106;avascript:alert(1)">x</a>', '<svg onload=alert(1)><circle/></svg>', '<iframe src="https://evil.com"></iframe>',
                   '<b onclick="alert(1)">x</b>', '<p style="background:url(https://evil.com)">x</p>', '<a href="data:text/html;base64,PHNjcmlwdD4=" download="x">x</a>',
                   '<img src="data:image/svg+xml;base64,PHN2Zz4=">', '<form action="https://evil.com"><input name="x"></form>', '<style>*{display:none}</style>',
                   '<script><script>alert(1)</script></script>', '<<script>script>alert(1)<</script>/script>', '<!-- --><script>alert(1)</script>', '<meta http-equiv="refresh" content="0;url=https://evil.com">']
        for attack in attacks:
            out = clean_html(attack).lower()
            for bad in ("<script", "onerror", "onclick", "onload", "javascript:", "<iframe", "<svg", "style=", "<style", "<form", "<input", "<meta", "data:text/html", "image/svg"):
                self.assertNotIn(bad, out, attack)

    def test_text_cant_become_html(self):
        self.assertEqual(clean_html("&lt;script&gt;alert(1)&lt;/script&gt;"), "&lt;script&gt;alert(1)&lt;/script&gt;")

    def test_balances_tags_and_is_stable(self):
        for html in ("<p><b>x", "</p>x<b>", "<ul><li>a<li>b</ul>", "<table><tr><td>x"):
            once = clean_html(html)
            self.assertEqual(clean_html(once), once, html)
        self.assertEqual(clean_html("<p><b>x"), "<p><b>x</b></p>")

    def test_lists_dont_end_up_inside_paragraphs(self):
        self.assertEqual(clean_html('<p>a</p><p><ul class="checklist"><li>x</li></ul></p><p>b</p>'), '<p>a</p><ul class="checklist"><li>x</li></ul><p>b</p>')

    def test_attachments_and_text_survive_dropped_tags(self):
        self.assertIn('download="a.pdf"', clean_html('<a href="data:application/pdf;base64,AA" download="a.pdf">f</a>'))
        self.assertEqual(clean_html('<span style="x">kept <font>too</font></span>'), "kept too")


class Api(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.api = NotesApi(os.path.join(self.tmp.name, "notes.db"))

    def do(self, action, **data):
        return self.api.do(action, data)

    def new(self, title="T", content="<p>body</p>", **over):
        nid = self.do("new", **over)["id"]
        self.do("save", id=nid, base=self.api.note(nid)["updated"], title=title, content=content)
        return nid

    def test_page_kind_is_chosen_kept_and_switchable(self):
        canvas = self.new()
        plain = self.new(kind="plain")
        self.assertEqual(self.api.note(canvas)["kind"], "canvas")  # older notes and the default stay canvas
        self.assertEqual(self.api.note(plain)["kind"], "plain")
        self.assertEqual({n["id"]: n["kind"] for n in self.api.state()["notes"]}[plain], "plain")
        before = self.api.note(plain)
        self.assertEqual(self.do("set_kind", id=plain, kind="canvas")["kind"], "canvas")
        after = self.api.note(plain)
        self.assertEqual((after["kind"], after["content"], after["updated"]), ("canvas", before["content"], before["updated"]))
        with self.assertRaises(NotesError):
            self.do("new", kind="board")
        with self.assertRaises(NotesError):
            self.do("set_kind", id=plain, kind="<b>")

    def test_old_databases_gain_the_kind_column(self):
        import sqlite3
        path = os.path.join(self.tmp.name, "old.db")
        c = sqlite3.connect(path)
        c.executescript("CREATE TABLE notebooks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL);"
                        "CREATE TABLE notes (id INTEGER PRIMARY KEY, notebook_id INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',"
                        " plain TEXT NOT NULL DEFAULT '', starred INTEGER NOT NULL DEFAULT 0, trashed_at REAL, created REAL NOT NULL, updated REAL NOT NULL);"
                        "INSERT INTO notebooks VALUES (1, 'NB', 1, 1); INSERT INTO notes (notebook_id, title, content, plain, created, updated) VALUES (1, 'Old', '<p>x</p>', 'x', 1, 1);")
        c.commit(); c.close()
        api = NotesApi(path)
        self.assertEqual([n["kind"] for n in api.state()["notes"]], ["canvas"])

    def titles(self, view="all", q=""):
        return [n["title"] for n in self.api.state(view, q)["notes"]]

    def test_save_and_read(self):
        nid = self.new("Hello", "<h1>Hi</h1><script>bad()</script>")
        note = self.api.note(nid)
        self.assertEqual((note["title"], note["content"]), ("Hello", "<h1>Hi</h1>"))
        self.assertIn("Hello", self.titles())

    def test_old_unsafe_content_is_cleaned_on_read_without_rewriting(self):
        nid = self.new()
        conn = webapi.store.connect()
        conn.execute("UPDATE notes SET content = ? WHERE id = ?", ("<p onclick='x()'>old</p><script>x()</script>", nid))
        conn.commit()
        self.assertEqual(self.api.note(nid)["content"], "<p>old</p>")
        self.assertIn("script", conn.execute("SELECT content FROM notes WHERE id = ?", (nid,)).fetchone()[0])
        conn.close()

    def test_conflict_is_reported_not_overwritten(self):
        nid = self.new("A", "<p>mine</p>")
        base = self.api.note(nid)["updated"]
        conn = webapi.store.connect()
        webapi.store.update_note(conn, nid, {"content": "<p>from terminal</p>"})
        conn.commit(); conn.close()
        out = self.do("save", id=nid, base=base, content="<p>web</p>")
        self.assertTrue(out["conflict"])
        self.assertIn("from terminal", out["note"]["content"])
        self.assertIn("from terminal", self.api.note(nid)["content"])
        self.do("save", id=nid, force=True, content="<p>web</p>")
        self.assertIn("web", self.api.note(nid)["content"])

    def test_consecutive_saves_use_the_new_stamp(self):
        nid = self.new()
        base = self.api.note(nid)["updated"]
        base = self.do("save", id=nid, base=base, title="1")["updated"]
        self.assertNotIn("conflict", self.do("save", id=nid, base=base, title="2"))

    def test_trash_restore_forever(self):
        nid = self.new("Gone")
        with self.assertRaises(NotesError):
            self.do("delete_forever", id=nid)
        self.do("trash", id=nid)
        self.assertNotIn("Gone", self.titles())
        self.assertIn("Gone", self.titles("trash"))
        with self.assertRaises(NotesError):
            self.do("save", id=nid, force=True, title="x")
        self.do("restore", id=nid)
        self.assertIn("Gone", self.titles())
        self.do("trash", id=nid)
        self.do("delete_forever", id=nid)
        with self.assertRaises(NotesError):
            self.api.note(nid)

    def test_empty_trash_only_touches_trash(self):
        keep, gone = self.new("Keep"), self.new("Gone")
        self.do("trash", id=gone)
        self.do("empty_trash")
        self.assertIn("Keep", self.titles())
        self.assertEqual(self.titles("trash"), [])

    def test_star_tags_views_and_search(self):
        nid = self.new("Plan")
        self.do("star", id=nid, starred=True)
        self.assertEqual(self.titles("starred"), ["Plan"])
        self.do("save", id=nid, force=True, tags=["#move", "home", " "])
        self.assertEqual(self.api.note(nid)["tags"], ["home", "move"])
        self.assertEqual(self.titles("tag:move"), ["Plan"])
        self.assertEqual(self.titles("all", "tag:home"), ["Plan"])
        self.assertEqual(self.titles("all", "intitle:plan"), ["Plan"])
        self.assertEqual(self.titles("all", "body"), ["Plan"])
        self.assertEqual(self.titles("all", "nothing"), [])
        self.assertEqual(self.titles("all", "' OR 1=1 --"), [])

    def test_notebooks(self):
        nb = self.do("add_notebook", name="Trips")["id"]
        nid = self.new("Rome", notebook_id=nb)
        self.assertEqual(self.titles(f"notebook:{nb}"), ["Rome"])
        with self.assertRaises(NotesError):
            self.do("add_notebook", name="trips")
        self.do("rename_notebook", id=nb, name="Travel")
        self.assertEqual(self.api.state(f"notebook:{nb}")["title"], "Travel")
        other = self.do("add_notebook", name="Other")["id"]
        self.do("move", id=nid, notebook_id=other)
        self.assertEqual(self.titles(f"notebook:{nb}"), [])
        self.do("move", id=nid, notebook_id=nb)
        self.do("delete_notebook", id=nb)
        self.assertIn("Rome", self.titles("trash"))
        self.do("restore", id=nid)
        self.assertIn("Rome", self.titles())

    def test_last_notebook_stays(self):
        for n in self.api.state()["notebooks"]:
            with self.assertRaises(NotesError):
                self.do("delete_notebook", id=n["id"])

    def test_discard_only_removes_truly_empty(self):
        empty = self.do("new")["id"]
        self.do("discard_empty", id=empty)
        with self.assertRaises(NotesError):
            self.api.note(empty)
        for fields in (dict(title="x"), dict(content="<p>x</p>"), dict(content='<img src="data:image/png;base64,AAAA">'), dict(tags=["t"])):
            nid = self.do("new")["id"]
            self.do("save", id=nid, force=True, **fields)
            self.do("discard_empty", id=nid)
            self.assertTrue(self.api.note(nid), fields)

    def test_web_notes_open_in_the_terminal_format(self):
        spec = importlib.util.spec_from_file_location("notes_cli", os.path.join(ROOT, "studynotes", "cli.py"))
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        html = '<h1>T</h1><p><b>a</b></p><ul class="checklist"><li class="checked">done</li><li>todo</li></ul>'
        nid = self.new("X", html)
        text = cli.html_to_text(self.api.note(nid)["content"])
        self.assertIn("- [x] done", text)
        self.assertIn("- [ ] todo", text)
        self.assertIn("# T", text)
        self.assertEqual(cli.text_to_html(text).count('class="checked"'), 1)

    def test_refuses_bad_input(self):
        for call in (lambda: self.do("nope"), lambda: self.do("__init__"), lambda: self.do("save", id="1"), lambda: self.do("trash", id=True), lambda: self.do("trash", id=999),
                     lambda: self.api.state("evil"), lambda: self.api.state("notebook:999"), lambda: self.do("add_notebook", name=" "), lambda: self.do("save", id=self.new(), force=True, content=5),
                     lambda: self.do("save", id=self.new(), force=True, content="x" * (webapi.MAX_CONTENT + 1))):
            with self.assertRaises(NotesError):
                call()

    def test_evernote_export_then_import(self):
        nb = self.do("add_notebook", name="Trips")["id"]
        nid = self.new("Rome", '<h1>Go</h1><ul class="checklist"><li class="checked">Pack</li></ul>', notebook_id=nb)
        self.do("save", id=nid, force=True, tags=["travel"])
        data = self.api.export_enex(nb)
        self.assertIn(b"<title>Rome</title>", data)
        path = os.path.join(self.tmp.name, "x.enex")
        with open(path, "wb") as f:
            f.write(data)
        out = self.api.import_enex(path, "Imported Trips")
        self.assertEqual(out["imported"], 1)
        notes = self.api.state(f"notebook:{out['notebook_id']}")["notes"]
        self.assertEqual((notes[0]["title"], notes[0]["tags"]), ("Rome", ["travel"]))
        back = self.api.note(notes[0]["id"])["content"]
        self.assertIn('class="checked"', back)
        self.assertIn(b"Rome", self.api.export_enex(None, nid))
        self.assertGreater(len(self.api.export_enex()), len(self.api.export_enex(nb)))

    def test_imported_scripts_never_reach_the_page(self):
        path = os.path.join(self.tmp.name, "evil.enex")
        with open(path, "w") as f:
            f.write('<en-export><note><title>Evil</title><content><![CDATA[<en-note><p>ok</p><script>x()</script><img src="x" onerror="y()"/></en-note>]]></content></note></en-export>')
        out = self.api.import_enex(path)
        nid = self.api.state(f"notebook:{out['notebook_id']}")["notes"][0]["id"]
        html = self.api.note(nid)["content"]
        self.assertIn("ok", html)
        self.assertNotIn("script", html)
        self.assertNotIn("onerror", html)

    def test_bad_import_files(self):
        path = os.path.join(self.tmp.name, "bad.enex")
        for content in ("not xml at all", "<en-export><note>", ""):
            with open(path, "w") as f:
                f.write(content)
            with self.assertRaises(NotesError, msg=content):
                self.api.import_enex(path)

    def test_default_notebook_and_backup(self):
        nb = self.do("add_notebook", name="Inbox")["id"]
        self.do("default_notebook", id=nb)
        self.assertEqual(self.api.state()["default_notebook"], nb)
        nid = self.do("new")["id"]
        self.assertEqual(self.api.note(nid)["notebook_id"], nb)
        with self.assertRaises(NotesError):
            self.do("default_notebook", id=999)
        out = self.do("backup")
        self.assertTrue(os.path.exists(out["message"].split(" to ", 1)[1]))
        with self.assertRaises(NotesError):
            self.api.export_enex(999)

    def test_backup_on_first_use(self):
        self.assertTrue(os.listdir(os.path.join(self.tmp.name, "backups")))

    def test_private_folder_for_backups(self):
        self.assertEqual(os.stat(os.path.join(self.tmp.name, "backups")).st_mode & 0o777, 0o700)


if __name__ == "__main__":
    unittest.main()


class NewFeatures(unittest.TestCase):
    """Links between notes, the to-do list from every note, saving web pages, and attachments."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.api = NotesApi(os.path.join(self.tmp.name, "notes.db"))

    def new(self, title, content):
        nid = self.api.do("new", {})["id"]
        note = self.api.note(nid)
        self.api.do("save", {"id": nid, "base": note["updated"], "title": title, "content": content})
        return nid

    def test_links_between_notes_and_backlinks(self):
        a = self.new("Interview prep", "<p>See also</p>")
        b = self.new("GDIT", f'<p>Prep is in <a href="#note/{a}">Interview prep</a>, the job is <a href="/jobs/#job/12">here</a></p>')
        self.assertIn(f'href="#note/{a}"', self.api.note(b)["content"])
        self.assertIn('href="/jobs/#job/12"', self.api.note(b)["content"])
        self.assertEqual(self.api.note(a)["backlinks"], [{"id": b, "title": "GDIT"}])
        self.assertEqual([n["title"] for n in self.api.do("titles", {"q": "inter"})["notes"]], ["Interview prep"])
        self.assertNotIn("href", clean_html('<a href="#note/1 onclick=x">x</a><a href="/etc/passwd">y</a>'))

    def test_todo_list_from_every_note(self):
        a = self.new("Groceries", '<ul class="checklist"><li>milk</li><li class="checked">eggs</li><li>bread</li></ul>')
        b = self.new("Job hunt", '<p>x</p><ul class="checklist"><li>Update resume</li></ul>')
        st = self.api.state("todos")
        mine = [t for t in st["todos"] if t["note_id"] in (a, b)]   # the welcome note has a checklist too
        self.assertEqual(sorted(t["text"] for t in mine), ["Update resume", "bread", "milk"])
        before = st["counts"]["todos"]
        self.assertEqual(before, len(st["todos"]))
        bread = next(t for t in st["todos"] if t["text"] == "bread")
        self.assertEqual(bread["index"], 2)
        self.api.do("todo_check", {"id": a, "index": 2, "checked": True})
        self.assertIn('<li class="checked">bread</li>', self.api.note(a)["content"])
        self.assertEqual(self.api.state("all")["counts"]["todos"], before - 1)
        self.api.do("todo_check", {"id": a, "index": 1, "checked": False})
        self.assertIn("<li>eggs</li>", self.api.note(a)["content"])
        with self.assertRaises(NotesError):
            self.api.do("todo_check", {"id": b, "index": 5})

    def test_saving_a_web_page(self):
        import clip
        page = ('<html><head><title>How to ace a help desk interview</title><script>alert(1)</script></head><body><nav>menu</nav>'
                '<article><h1>Ace it</h1><p>' + "Be ready to explain how you troubleshoot. " * 10 + '</p><img src="/pic.png" onerror="x"></article><footer>f</footer></body></html>')
        from unittest import mock
        with mock.patch.object(clip, "fetch", return_value=("https://example.com/tips", page)):
            out = self.api.do("clip", {"url": "example.com/tips"})
        note = self.api.note(out["id"])
        self.assertEqual(note["title"], "How to ace a help desk interview")
        self.assertIn("web clip", note["tags"])
        self.assertIn('<a href="https://example.com/tips">example.com</a>', note["content"])
        self.assertIn('<img src="https://example.com/pic.png"', note["content"])
        for bad in ("<script", "onerror", "menu", ">f<"):
            self.assertNotIn(bad, note["content"])

    def test_local_addresses_cant_be_clipped(self):
        import clip
        for url in ("http://127.0.0.1:8800/api/notes/state", "http://localhost/", "http://192.168.1.1/", "file:///etc/passwd"):
            with self.assertRaises(clip.ClipError):
                clip.fetch(url)

    def test_attachments_listed(self):
        nid = self.new("Resume", '<p><a href="data:application/pdf;base64,JVBERi0=" download="resume.pdf">resume.pdf</a></p>')
        self.assertTrue(next(n for n in self.api.state("all")["notes"] if n["id"] == nid)["has_file"])
