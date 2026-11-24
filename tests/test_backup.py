import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "studynotes"))
import store  # noqa: E402
from webapi import NotesApi, NotesError  # noqa: E402


class Backup(unittest.TestCase):
    """A backup made on one device restores on another: two separate data folders stand in for two computers."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def device(self, name):
        return NotesApi(os.path.join(self.tmp.name, name, "notes.db"))

    def new(self, api, title, content="<p>body</p>", **over):
        nid = api.do("new", over)["id"]
        api.do("save", {"id": nid, "base": api.note(nid)["updated"], "title": title, "content": content, "tags": over.get("tags_", [])})
        return nid

    def export(self, api, name="b.studynotes"):
        path = os.path.join(self.tmp.name, name)
        with open(path, "wb") as f:
            f.write(api.export_backup())
        return path

    def test_round_trip_keeps_everything(self):
        a = self.device("mac")
        a.do("add_notebook", {"name": "Biology"})
        bio = next(n["id"] for n in a.state()["notebooks"] if n["name"] == "Biology")
        cells = self.new(a, "Cells", "<p>mitochondria</p>", notebook_id=bio, kind="plain", tags_=["exam"])
        self.new(a, "Index", f'<p>see <a href="#note/{cells}">Cells</a></p><div class="jpage"><div class="jbox" data-x="10" data-y="20"><p>boxed</p></div></div>')
        a.do("star", {"id": cells, "starred": True})
        gone = self.new(a, "Old")
        a.do("trash", {"id": gone})
        a.do("order_notebooks", {"ids": [bio]})
        path = self.export(a)
        data = json.load(open(path))
        self.assertEqual(data["format"], "studynotes-backup")

        b = self.device("other")
        out = b.restore_backup(path, "replace")
        self.assertEqual(out["added"], 4)  # welcome note + three
        st = b.state()
        self.assertEqual(st["notebooks"][0]["name"], "Biology")  # tab order came along
        bnotes = {n["title"]: n for n in st["notes"]}
        self.assertEqual(bnotes["Cells"]["kind"], "plain")
        self.assertTrue(bnotes["Cells"]["starred"])
        self.assertEqual(bnotes["Cells"]["tags"], ["exam"])
        self.assertEqual(b.state("trash")["notes"][0]["title"], "Old")
        index = b.note(bnotes["Index"]["id"])
        self.assertIn(f'href="#note/{bnotes["Cells"]["id"]}"', index["content"])
        self.assertIn('class="jbox"', index["content"])
        self.assertTrue(st["activity"])

    def test_merge_adds_new_and_keeps_newer(self):
        a = self.device("a")
        shared = self.new(a, "Shared", "<p>v1</p>")
        path = self.export(a, "a1.studynotes")
        b = self.device("b")
        b.restore_backup(path, "replace")
        # b edits the shared note later and writes its own note
        sid = next(n["id"] for n in b.state()["notes"] if n["title"] == "Shared")
        time.sleep(0.01)
        b.do("save", {"id": sid, "base": b.note(sid)["updated"], "content": "<p>v2 from b</p>"})
        self.new(b, "Only on b")
        path_b = self.export(b, "b.studynotes")
        # back on a: merge b's backup → a gains "Only on b" and the newer shared text
        a = NotesApi(os.path.join(self.tmp.name, "a", "notes.db"))
        out = a.restore_backup(path_b, "merge")
        self.assertEqual((out["added"], out["updated"]), (1, 1))
        titles = sorted(n["title"] for n in a.state()["notes"])
        self.assertEqual(titles.count("Shared"), 1)
        self.assertIn("Only on b", titles)
        self.assertIn("v2 from b", a.note(shared)["content"])
        # merging the same file again changes nothing
        again = a.restore_backup(path_b, "merge")
        self.assertEqual((again["added"], again["updated"]), (0, 0))

    def test_restore_cleans_content_and_refuses_bad_files(self):
        a = self.device("a")
        conn = sqlite3_conn()
        with conn:
            data = store.export_backup(conn)
        conn.close()
        data["notes"].append({"uid": "ab" * 16, "notebook_id": data["notebooks"][0]["id"], "title": "x",
                              "content": '<p>hi</p><script>alert(1)</script><img src=x onerror=alert(1)>'})
        path = os.path.join(self.tmp.name, "evil.studynotes")
        json.dump(data, open(path, "w"))
        a.restore_backup(path, "merge")
        nid = next(n["id"] for n in a.state()["notes"] if n["title"] == "x")
        raw = sqlite3_conn().execute("SELECT content FROM notes WHERE id = ?", (nid,)).fetchone()[0]
        self.assertNotIn("script", raw)
        self.assertNotIn("onerror", raw)
        for bad in (b"not json", b'{"format":"other"}', b'{"format":"studynotes-backup","version":99,"notebooks":[],"notes":[]}'):
            p = os.path.join(self.tmp.name, "bad")
            open(p, "wb").write(bad)
            with self.assertRaises(NotesError):
                a.restore_backup(p, "replace")
        self.assertTrue(any(n["title"] == "x" for n in a.state()["notes"]))  # a refused file changes nothing
        with self.assertRaises(NotesError):
            a.restore_backup(path, "wipe")

    def test_older_databases_gain_uids(self):
        path = os.path.join(self.tmp.name, "old", "notes.db")
        os.makedirs(os.path.dirname(path))
        c = sqlite3.connect(path)
        c.executescript("CREATE TABLE notebooks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL);"
                        "CREATE TABLE notes (id INTEGER PRIMARY KEY, notebook_id INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',"
                        " plain TEXT NOT NULL DEFAULT '', starred INTEGER NOT NULL DEFAULT 0, trashed_at REAL, created REAL NOT NULL, updated REAL NOT NULL);"
                        "INSERT INTO notebooks VALUES (1, 'N', 1, 1); INSERT INTO notes (notebook_id, title, created, updated) VALUES (1, 'a', 1, 1), (1, 'b', 1, 1);")
        c.commit(); c.close()
        NotesApi(path)
        uids = [r[0] for r in sqlite3.connect(path).execute("SELECT uid FROM notes")]
        self.assertEqual(len(set(uids)), 2)
        self.assertTrue(all(len(u) == 32 for u in uids))


def sqlite3_conn():
    return store.connect()


if __name__ == "__main__":
    unittest.main()
