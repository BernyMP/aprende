#!/bin/bash
# Builds every new origin/main commit on this Mac and installs it as the desktop app.
# Usage: desktop-autodeploy.sh install [checkout] | uninstall | status | run
set -euo pipefail

LABEL="dev.aprende.desktop-autodeploy"
STATE_DIR="${APRENDE_AUTODEPLOY_HOME:-$HOME/.aprende-autodeploy}"
CHECKOUT="${APRENDE_AUTODEPLOY_CHECKOUT:-$STATE_DIR/checkout}"
APP_DIR="${APRENDE_AUTODEPLOY_APP_DIR:-/Applications}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INTERVAL_SECONDS=300

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
notify() {
  osascript -e "display notification \"$1\" with title \"aprende\"" >/dev/null 2>&1 || true
}
read_state() { cat "$STATE_DIR/$1" 2>/dev/null || true; }

acquire_lock() {
  # A build can outlast the launchd interval; let the running one finish.
  if ! mkdir "$STATE_DIR/lock" 2>/dev/null; then
    local holder
    holder=$(cat "$STATE_DIR/lock/pid" 2>/dev/null || true)
    if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then exit 0; fi
    rm -rf "$STATE_DIR/lock"
    mkdir "$STATE_DIR/lock"
  fi
  echo $$ >"$STATE_DIR/lock/pid"
  trap 'rm -rf "$STATE_DIR/lock"' EXIT
}

# Called from `if`, where bash ignores `set -e`, so every step returns explicitly.
build() {
  local target=$1 arch
  arch=$(uname -m)
  [ "$arch" = "x86_64" ] && arch=x64
  cd "$CHECKOUT" || return 1
  git checkout --quiet --detach "$target" || return 1
  # shellcheck disable=SC1091
  if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi
  ./node_modules/.bin/vp install --frozen-lockfile || return 1
  rm -rf "$STATE_DIR/build"
  APRENDE_DESKTOP_OUTPUT_DIR="$STATE_DIR/build" \
    ./node_modules/.bin/vp run "dist:desktop:dmg:$arch" || return 1
}

stage() {
  local zip dmg mount app
  rm -rf "$STATE_DIR/staged"
  mkdir -p "$STATE_DIR/staged"
  zip=$(find "$STATE_DIR/build" -maxdepth 1 -name '*.zip' | head -1)
  if [ -n "$zip" ]; then
    ditto -x -k "$zip" "$STATE_DIR/staged" || return 1
  else
    dmg=$(find "$STATE_DIR/build" -maxdepth 1 -name '*.dmg' | head -1)
    [ -n "$dmg" ] || { log "build produced no zip or dmg"; return 1; }
    mount=$(mktemp -d)
    hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mount" "$dmg" || return 1
    app=$(find "$mount" -maxdepth 1 -name '*.app' | head -1)
    ditto "$app" "$STATE_DIR/staged/$(basename "$app")" || { hdiutil detach -quiet "$mount"; return 1; }
    hdiutil detach -quiet "$mount"
  fi
  [ -n "$(find "$STATE_DIR/staged" -maxdepth 1 -name '*.app')" ] || { log "no app in the build"; return 1; }
}

install_staged() {
  local target=$1 app name subject
  app=$(find "$STATE_DIR/staged" -maxdepth 1 -name '*.app' | head -1)
  [ -n "$app" ] || { log "nothing staged"; return 1; }
  name=$(basename "$app")
  # Prefix match on full command lines: the name has regex characters ("aprende (Beta).app"),
  # and a grep for the path would match its own command line.
  if ps -axww -o command= |
    awk -v p="$APP_DIR/$name/Contents/MacOS/" 'index($0, p) == 1 { found = 1 } END { exit !found }'; then
    if [ "$(read_state notified-sha)" != "$target" ]; then
      notify "A new build from main is ready. Quit aprende and it installs within 5 minutes."
      echo "$target" >"$STATE_DIR/notified-sha"
    fi
    log "$name is running; install of ${target:0:10} waits for it to quit"
    return 0
  fi
  rm -rf "${APP_DIR:?}/$name"
  ditto "$app" "$APP_DIR/$name"
  echo "$target" >"$STATE_DIR/installed-sha"
  subject=$(git -C "$CHECKOUT" log -1 --format=%s "$target")
  log "installed ${target:0:10}: $subject"
  notify "Updated to ${target:0:7}: $subject"
}

run() {
  mkdir -p "$STATE_DIR"
  acquire_lock
  cd "$CHECKOUT"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    log "$CHECKOUT has local changes; not deploying"
    exit 1
  fi
  git fetch --quiet origin main
  local target
  target=$(git rev-parse origin/main)
  [ "$target" = "$(read_state installed-sha)" ] && exit 0
  [ "$target" = "$(read_state failed-sha)" ] && exit 0
  if [ "$target" != "$(read_state staged-sha)" ]; then
    log "building ${target:0:10}"
    if ! build "$target" || ! stage; then
      echo "$target" >"$STATE_DIR/failed-sha"
      notify "Building main at ${target:0:7} failed. See $STATE_DIR/autodeploy.log"
      exit 1
    fi
    echo "$target" >"$STATE_DIR/staged-sha"
  fi
  install_staged "$target"
}

install_agent() {
  local checkout=${1:-$CHECKOUT} source_repo
  source_repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
  mkdir -p "$STATE_DIR" "$(dirname "$PLIST")"
  if [ ! -d "$checkout" ]; then
    git -C "$source_repo" fetch --quiet origin main
    git -C "$source_repo" worktree add --quiet --detach "$checkout" origin/main
    (cd "$checkout" && "$source_repo/node_modules/.bin/vp" install --frozen-lockfile)
  fi
  checkout=$(cd "$checkout" && pwd)
  # launchd runs this copy, so checking out other commits never rewrites a running script.
  cp "$0" "$STATE_DIR/desktop-autodeploy.sh"
  cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$STATE_DIR/desktop-autodeploy.sh</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH</string>
    <key>APRENDE_AUTODEPLOY_HOME</key><string>$STATE_DIR</string>
    <key>APRENDE_AUTODEPLOY_CHECKOUT</key><string>$checkout</string>
    <key>APRENDE_AUTODEPLOY_APP_DIR</key><string>$APP_DIR</string>
  </dict>
  <key>StartInterval</key><integer>$INTERVAL_SECONDS</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$STATE_DIR/autodeploy.log</string>
  <key>StandardErrorPath</key><string>$STATE_DIR/autodeploy.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  log "watching origin/main from $checkout every ${INTERVAL_SECONDS}s; log: $STATE_DIR/autodeploy.log"
}

uninstall_agent() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  log "stopped; $STATE_DIR and the installed app are left in place"
}

status() {
  echo "installed: $(read_state installed-sha)"
  echo "staged:    $(read_state staged-sha)"
  echo "failed:    $(read_state failed-sha)"
  launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E '^\s*(state|last exit code)' || echo "agent not loaded"
  tail -n 5 "$STATE_DIR/autodeploy.log" 2>/dev/null || true
}

case "${1:-}" in
  run) run ;;
  install) install_agent "${2:-}" ;;
  uninstall) uninstall_agent ;;
  status) status ;;
  *)
    echo "usage: $0 install [checkout] | uninstall | status | run" >&2
    exit 2
    ;;
esac
