# StudyNotes 📚

A study journal that runs on your own computer and opens in your browser. Nothing is uploaded anywhere.

- **Subjects as tabs**, an **Index** with search, a calendar and a GitHub-style activity chart
- **Canvas pages** you can write anywhere on: text boxes, shapes, arrows that join things, sticky notes, pen and highlighter, images and attached files
- **Plain pages** for just typing, with Markdown shortcuts (`#`, `-`, `[ ]`, `**bold**`, `/` for blocks) and `[[links]]` between notes
- A **Review** tab that gathers every unchecked to-do from your notes
- Export a note as PDF, HTML, Word, Markdown or text; import and export Evernote `.enex` files
- **Move everything to another computer** with one backup file (see below)

## Set it up on a Mac

```bash
git clone https://github.com/webDeveloper42/studynotes.git
cd studynotes
./setup-mac.sh
```

The script:

1. checks for Python 3.9+ (it uses the one from Apple's Command Line Tools or Homebrew, and asks to install the tools if neither is there)
2. installs Node.js with Homebrew if you don't have it (it asks before installing Homebrew itself). Node is only used to download the editor packages.
3. runs `npm ci` to install the editor (Tiptap) and Bootstrap at the exact versions in `package-lock.json`
4. runs the tests
5. adds a `studynotes` command
6. offers to start StudyNotes automatically when you log in

Then run:

```bash
studynotes            # starts it and opens http://127.0.0.1:8765/notes/
```

Other commands: `studynotes --port 9000`, `studynotes cli` (terminal version), `studynotes where` (shows the data folder), `studynotes test`.
To remove the command and login item: `./setup-mac.sh --uninstall` (your notes stay).

## Move your notes to another device

1. In the copy that has your notes, click **Export all** in the Index's top bar (also in a note's ⬇ Export dialog and in Import & Export). You get one `studynotes-backup-YYYY-MM-DD.studynotes` file.
2. Copy that file to the other computer (AirDrop, USB stick, email to yourself…).
3. There, click **Import all** in the Index's top bar, pick the file, check what's in it, and choose:
   - **Merge with my notes**: adds notes you don't have, and updates a note only when the backup's copy is newer. Merging the same file twice changes nothing.
   - **Replace everything**: makes this copy match the backup exactly.

Either way, a safety copy of what was there is saved first (in the data folder's `backups/`).
The backup holds every notebook and note (Trash too), tags, page designs, images and attachments, the activity chart, your tab order, and your app settings (layout, sort, default text style, entry font, recent colours). Links between notes keep working.

## Where your notes are

`~/Library/Application Support/StudyNotes/` on a Mac (`~/.local/share/studynotes/` on Linux). Set `STUDYNOTES_DATA` to use another folder.
It holds `notes.db` (SQLite), `settings.json`, and a daily `backups/` copy (the newest 14 are kept). None of it is part of this repo.

## Privacy

The server listens on `127.0.0.1` only and refuses other hostnames, so other devices on your network can't reach it.
Writes must come from the page itself, and every note is cleaned to a small allowlist of HTML before it's saved or shown.
The only time it goes online is when you use **Save a web page** to clip an article.

## Development

```bash
python3 -m studynotes.server --port 8765 --data /tmp/studynotes-test   # throwaway data
python3 -m unittest discover -s tests
```

- `studynotes/server.py`: the web server (standard library only)
- `studynotes/webapi.py`: what the page can do, plus the HTML cleaner
- `studynotes/store.py`: SQLite storage, Evernote import/export, and the backup format
- `studynotes/cli.py`: the terminal app
- `studynotes/static/`: the page (`app.js`, `journal.js` for canvas pages, `app.css`)
