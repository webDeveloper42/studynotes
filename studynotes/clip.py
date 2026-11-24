"""Saving a web page as a note, like Evernote's web clipper: the page's title and its main text, with a link back.

Only http and https pages on the internet are fetched. Addresses on this machine or the home network are refused,
so a pasted link can't be used to reach the server's own services. The page's scripts never run: it's read as
text, and the note keeps only what the notes allowlist allows (headings, paragraphs, lists, links, pictures).
"""
import datetime as dt
import ipaddress
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from html import escape, unescape
from html.parser import HTMLParser

AGENT = "Mozilla/5.0 (X11; Linux x86_64) notes-clipper/1.0"
MAX_BYTES = 4 * 1024 * 1024
TIMEOUT = 20
SKIP = {"script", "style", "noscript", "nav", "header", "footer", "aside", "form", "button", "svg", "iframe", "select", "template", "dialog", "menu"}
KEEP = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code", "b", "strong", "i", "em", "a", "img", "br", "table",
        "thead", "tbody", "tr", "th", "td", "hr", "figure", "figcaption"}


class ClipError(ValueError):
    pass


def _public(host):
    """True when every address the name points to is on the public internet."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise ClipError("That address couldn't be found") from None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


class _NoRedirectToPrivate(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urllib.parse.urlsplit(newurl)
        if parts.scheme not in ("http", "https") or not parts.hostname or not _public(parts.hostname):
            raise ClipError("That page sends you somewhere that can't be saved")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url):
    """(final url, html text) for a public web page."""
    url = (url or "").strip()
    if not re.match(r"https?://", url, re.I):
        url = "https://" + url
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ClipError("Use a web address, like https://example.com/article")
    if not _public(parts.hostname):
        raise ClipError("Pages on this computer or your home network can't be saved")
    opener = urllib.request.build_opener(_NoRedirectToPrivate)
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "text/html,application/xhtml+xml"})
    try:
        with opener.open(req, timeout=TIMEOUT) as r:
            kind = r.headers.get("Content-Type", "")
            if "html" not in kind and "text/plain" not in kind:
                raise ClipError("That link isn't a web page (it's " + (kind.split(";")[0] or "a file") + ")")
            data = r.read(MAX_BYTES)
            charset = r.headers.get_content_charset() or (re.search(rb'charset=["\']?([\w-]+)', data[:4000], re.I) or [None, b"utf-8"])[1].decode()
            final = r.geturl()
    except ClipError:
        raise
    except urllib.error.HTTPError as e:
        raise ClipError(f"The page answered {e.code}") from None
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        raise ClipError(f"Couldn't reach that page ({getattr(e, 'reason', e)})") from None
    try:
        text = data.decode(charset, "replace")
    except LookupError:
        text = data.decode("utf-8", "replace")
    if "text/plain" in kind:
        text = "<pre>" + escape(text) + "</pre>"
    return final, text


class _Reader(HTMLParser):
    """Collects the page's title and the readable part: <article> or <main> when there is one, else the body."""
    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.title, self.og_title = base, "", ""
        self.parts = {"article": [], "main": [], "body": []}
        self.where, self.skip, self.in_title = [], 0, False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("property") in ("og:title", "twitter:title") and a.get("content") and not self.og_title:
            self.og_title = a["content"]
        if tag == "title":
            self.in_title = True
        if tag in SKIP:
            self.skip += 1
            return
        if tag in ("article", "main", "body"):
            self.where.append(tag)
        if self.skip or tag not in KEEP:
            return
        if tag == "a":
            href = urllib.parse.urljoin(self.base, a.get("href") or "")
            text = f'<a href="{escape(href, quote=True)}">' if re.match(r"https?://", href) else "<a>"
        elif tag == "img":
            src = urllib.parse.urljoin(self.base, a.get("src") or a.get("data-src") or "")
            if not re.match(r"https?://", src):
                return
            text = f'<img src="{escape(src, quote=True)}" alt="{escape(a.get("alt") or "", quote=True)}">'
        else:
            text = f"<{tag}>"
        self._emit(text)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if tag in ("article", "main", "body") and tag in self.where:
            self.where.remove(tag)
        if not self.skip and tag in KEEP and tag not in ("img", "br", "hr"):
            self._emit(f"</{tag}>")

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if not self.skip:
            self._emit(escape(data, quote=False))

    def _emit(self, text):
        for key in ("article", "main", "body"):
            if key in self.where:
                self.parts[key].append(text)


def read(url):
    """(title, html) of a page's main content, ready to become a note (it's cleaned again when saved)."""
    final, page = fetch(url)
    r = _Reader(final)
    try:
        r.feed(page)
        r.close()
    except Exception:  # noqa: BLE001 - broken pages still give their text
        pass
    body = ""
    for key in ("article", "main", "body"):
        html = "".join(r.parts[key])
        if len(re.sub(r"<[^>]+>|\s", "", html)) > 200:
            body = html
            break
    if not body:
        body = "".join(r.parts["body"]) or "<p>" + escape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", page))[:20000]) + "</p>"
    title = " ".join(unescape(r.og_title or r.title or final).split())[:300]
    when = dt.date.today().strftime("%B %-d, %Y")
    source = f'<p><i>Saved from <a href="{escape(final, quote=True)}">{escape(urllib.parse.urlsplit(final).hostname or final)}</a> on {when}.</i></p><hr>'
    return title, source + body
