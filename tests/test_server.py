"""The server end to end, on a random port with a throwaway data folder."""
import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from studynotes import server  # noqa: E402


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.app = server.App(os.path.join(cls.tmp.name, "data"))
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(cls.app))
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Host": f"127.0.0.1:{self.port}", **(headers or {})}
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, dict(r.getheaders()), data

    def test_page_and_api(self):
        status, headers, body = self.req("GET", "/notes/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>StudyNotes</title>", body)
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(self.req("GET", "/")[0], 302)
        status, _, body = self.req("GET", "/api/notes/state")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["notebooks"])

    def test_backup_download_then_restore_through_upload(self):
        status, _, out = self.req("POST", "/api/notes/do", {"action": "new"})
        nid = json.loads(out)["id"]
        note = json.loads(self.req("GET", f"/api/notes/note?id={nid}")[2])
        self.req("POST", "/api/notes/do", {"action": "save", "id": nid, "base": note["updated"], "title": "Photosynthesis", "content": "<p>light</p>"})
        status, headers, backup = self.req("GET", "/api/notes/backup")
        self.assertEqual(status, 200)
        self.assertRegex(headers["Content-Disposition"], r'studynotes-backup-\d{4}-\d\d-\d\d\.studynotes')
        self.assertEqual(json.loads(backup)["format"], "studynotes-backup")
        status, _, up = self.req("POST", "/api/upload?path=my%20backup.studynotes", backup, {"Content-Type": "application/octet-stream", "X-Capture-Upload": "1"})
        self.assertEqual(status, 200)
        name = json.loads(up)["name"]
        status, _, out = self.req("POST", "/api/notes/restore", {"file": name, "mode": "replace"})
        self.assertEqual(status, 200, out)
        self.assertIn("Restored the backup", json.loads(out)["message"])
        self.assertFalse((self.app.incoming / name).exists())  # the upload is cleared once used
        titles = [n["title"] for n in json.loads(self.req("GET", "/api/notes/state")[2])["notes"]]
        self.assertIn("Photosynthesis", titles)

    def test_refuses_other_sites_and_hosts(self):
        self.assertEqual(self.req("GET", "/api/notes/state", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.req("POST", "/api/notes/do", {"action": "new"}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.req("POST", "/api/notes/do", b'{"action":"new"}', {"Content-Type": "text/plain"})[0], 403)
        self.assertEqual(self.req("POST", "/api/upload?path=x", b"x", {"Content-Type": "application/octet-stream"})[0], 403)
        status, _, out = self.req("POST", "/api/notes/restore", {"file": "../notes.db", "mode": "replace"})
        self.assertEqual(status, 400)
        self.assertEqual(self.req("GET", "/vendor/npm/../../studynotes/store.py")[0], 404)


if __name__ == "__main__":
    unittest.main()
