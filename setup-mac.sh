#!/usr/bin/env bash
# Sets up StudyNotes on a Mac: checks Python 3, installs Node.js if needed (through Homebrew),
# installs the editor packages, runs the tests, and adds a `studynotes` command.
#
#   ./setup-mac.sh                 interactive setup
#   ./setup-mac.sh --yes           say yes to everything (Homebrew, start at login)
#   ./setup-mac.sh --no-autostart  don't offer to start StudyNotes when you log in
#   ./setup-mac.sh --uninstall     remove the command and the login item (your notes stay)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
YES=0; AUTOSTART=ask; UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    --no-autostart) AUTOSTART=no ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
ask()  { # ask "question" → 0 for yes
  [ "$YES" = 1 ] && return 0
  local reply; read -r -p "  $1 [y/N] " reply </dev/tty || return 1
  [[ "$reply" =~ ^[Yy] ]]
}

LABEL="com.studynotes.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${STUDYNOTES_PORT:-8765}"

if [ "$UNINSTALL" = 1 ]; then
  bold "Removing StudyNotes' command and login item"
  if [ -f "$PLIST" ]; then launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; ok "Login item removed"; fi
  for link in /usr/local/bin/studynotes /opt/homebrew/bin/studynotes "$HOME/.local/bin/studynotes"; do
    if [ -L "$link" ] && [ "$(readlink "$link")" = "$ROOT/bin/studynotes" ]; then rm -f "$link"; ok "Removed $link"; fi
  done
  echo "  Your notes were left where they are: $HOME/Library/Application Support/StudyNotes"
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || warn "This script is written for macOS. Carrying on anyway."
bold "Setting up StudyNotes in $ROOT"

# ── 1. Python 3.9 or newer (the server and engine use only its standard library) ──
python_ok() { "$1" -c 'import sys, sqlite3; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; }
PY=""
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if [ -x "$candidate" ] && python_ok "$candidate"; then PY="$candidate"; break; fi
done
if [ -z "$PY" ]; then
  # /usr/bin/python3 is a stub until Apple's Command Line Tools are installed, and running it opens an installer.
  if xcode-select -p >/dev/null 2>&1 && python_ok /usr/bin/python3; then
    PY=/usr/bin/python3
  elif command -v brew >/dev/null 2>&1; then
    echo "  Installing Python with Homebrew…"; brew install python; PY="$(brew --prefix)/bin/python3"
  else
    warn "Python 3 needs Apple's Command Line Tools."
    xcode-select --install 2>/dev/null || true
    die "Finish the Command Line Tools install in the window that opened, then run ./setup-mac.sh again."
  fi
fi
ok "Python: $("$PY" --version 2>&1) ($PY)"

# ── 2. Node.js, only to download the editor packages (Tiptap, Bootstrap) ──
find_brew() {
  command -v brew >/dev/null 2>&1 && return 0
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$b" ]; then eval "$("$b" shellenv)"; return 0; fi
  done
  return 1
}
if ! command -v npm >/dev/null 2>&1; then
  if ! find_brew; then
    warn "Node.js isn't installed, and neither is Homebrew (the usual way to get it on a Mac)."
    if ask "Install Homebrew now? (it asks for your Mac password)"; then
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      find_brew || die "Homebrew didn't finish installing. Run ./setup-mac.sh again once it has."
    else
      die "Install Node.js from https://nodejs.org (the LTS version), then run ./setup-mac.sh again."
    fi
  fi
  echo "  Installing Node.js with Homebrew…"
  brew install node
fi
ok "Node.js: $(node -v), npm $(npm -v)"

# ── 3. The editor packages, at the exact versions in package-lock.json ──
echo "  Installing the editor packages…"
npm ci --no-audit --no-fund --loglevel=error
ok "Packages installed in node_modules"

# ── 4. Make sure it works ──
echo "  Running the tests…"
if "$PY" -m unittest discover -s tests >/tmp/studynotes-tests.log 2>&1; then
  ok "Tests passed"
else
  tail -20 /tmp/studynotes-tests.log
  die "Some tests failed (full log: /tmp/studynotes-tests.log)."
fi

# ── 5. A `studynotes` command ──
chmod +x bin/studynotes
LINKED=""
for dir in /opt/homebrew/bin /usr/local/bin; do
  if [ -d "$dir" ] && [ -w "$dir" ]; then ln -sf "$ROOT/bin/studynotes" "$dir/studynotes"; LINKED="$dir/studynotes"; break; fi
done
if [ -z "$LINKED" ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$ROOT/bin/studynotes" "$HOME/.local/bin/studynotes"
  LINKED="$HOME/.local/bin/studynotes"
  RC="$HOME/.zshrc"; [ "${SHELL##*/}" = "bash" ] && RC="$HOME/.bash_profile"
  if ! grep -qs '.local/bin' "$RC"; then
    printf '\n# StudyNotes\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC"
    warn "Added ~/.local/bin to your PATH in $RC. Open a new Terminal window for it to take effect."
  fi
fi
ok "Command installed: $LINKED"

DATA="$("$PY" -c 'import sys; sys.path.insert(0, "studynotes"); import store; print(store.data_dir())')"
mkdir -p "$DATA"
ok "Your notes will be stored in: $DATA"

# ── 6. Optionally start at login, so the page is always there ──
if [ "$AUTOSTART" = ask ] && [ "$(uname -s)" = "Darwin" ] && ask "Start StudyNotes automatically when you log in?"; then
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$PY</string><string>-m</string><string>studynotes.server</string><string>--port</string><string>$PORT</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/StudyNotes.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/StudyNotes.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  ok "StudyNotes now starts when you log in (log: ~/Library/Logs/StudyNotes.log)"
fi

echo
bold "All set."
echo "  Start it:            studynotes          (opens http://127.0.0.1:$PORT/notes/)"
echo "  Terminal version:    studynotes cli"
echo "  Bring your notes over: in the old copy, Import & Export → Download backup;"
echo "                       here, Import & Export → Restore from backup."
