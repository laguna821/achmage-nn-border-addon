#!/usr/bin/env bash
# Builds an isolated test vault under dev/e2e/work and starts Obsidian on it
# headless (no window) with the Chrome DevTools Protocol on $CDP_PORT.
#
#   SOURCE_VAULT=/path/to/your/vault dev/e2e/setup-vault.sh
#
# Notebook Navigator, Style Settings, Minimal Theme Settings and the Minimal
# theme are copied from SOURCE_VAULT (code and settings). Everything lands in
# dev/e2e/work, which is git-ignored. Your own Obsidian config is not touched:
# Obsidian runs with its own --user-data-dir.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="$HERE/work"
VAULT="$WORK/vault"
USERDATA="$WORK/userdata"
CDP_PORT="${CDP_PORT:-9333}"
ELECTRON="${OBSIDIAN_ELECTRON:-$(command -v electron43 || command -v electron || true)}"
ASAR="${OBSIDIAN_ASAR:-/usr/lib/obsidian/app.asar}"

: "${SOURCE_VAULT:?Set SOURCE_VAULT to a vault that has Notebook Navigator installed}"
[ -n "$ELECTRON" ] || { echo "electron not found; set OBSIDIAN_ELECTRON" >&2; exit 1; }
[ -f "$ASAR" ] || { echo "Obsidian app.asar not found; set OBSIDIAN_ASAR" >&2; exit 1; }

if [ -f "$WORK/obsidian.pid" ] && kill -0 "$(cat "$WORK/obsidian.pid")" 2>/dev/null; then
  echo "Test Obsidian is already running (pid $(cat "$WORK/obsidian.pid")). Stop it first." >&2
  exit 1
fi

rm -rf "$WORK"
mkdir -p "$VAULT/.obsidian/plugins" "$VAULT/.obsidian/themes" "$USERDATA" "$WORK/shots"

# Folder tree shaped like a DIKM vault.
for dir in \
  "00. Meta" "01. Inbox" \
  "10. Data (D)/101. Fleeting" "10. Data (D)/102. Raw Data" \
  "20. Information (I)/201. Patterns" "30. Knowledge (K)/301. Philosophy" \
  "40. Meaning (M)/401. Practice" "50. Teaching Materials/502. Obsidian" \
  "70. Documentations/705. Minutes" "80. References" "90. Settings" \
  "Cards" "kit" "NotePack CODEX"; do
  mkdir -p "$VAULT/$dir"
  echo "# test" > "$VAULT/$dir/note.md"
done

copy_plugin() {
  local id="$1" src="$SOURCE_VAULT/.obsidian/plugins/$1"
  [ -d "$src" ] || { echo "skip $id (not in SOURCE_VAULT)"; return; }
  mkdir -p "$VAULT/.obsidian/plugins/$id"
  for f in main.js manifest.json styles.css data.json; do
    [ -f "$src/$f" ] && cp "$src/$f" "$VAULT/.obsidian/plugins/$id/"
  done
  return 0
}
copy_plugin notebook-navigator
copy_plugin obsidian-style-settings
copy_plugin obsidian-minimal-settings
[ -d "$SOURCE_VAULT/.obsidian/themes/Minimal" ] && cp -r "$SOURCE_VAULT/.obsidian/themes/Minimal" "$VAULT/.obsidian/themes/"
[ -f "$SOURCE_VAULT/.obsidian/appearance.json" ] && cp "$SOURCE_VAULT/.obsidian/appearance.json" "$VAULT/.obsidian/"
[ -f "$VAULT/.obsidian/plugins/notebook-navigator/main.js" ] || { echo "Notebook Navigator is required" >&2; exit 1; }

# The add-on under test, straight from the repo, with demo groups.
ADDON="$VAULT/.obsidian/plugins/achmage-nn-border-addon"
mkdir -p "$ADDON"
cp "$REPO/main.js" "$REPO/manifest.json" "$REPO/styles.css" "$ADDON/"
cp "$HERE/demo-data.json" "$ADDON/data.json"

echo '["notebook-navigator","obsidian-style-settings","obsidian-minimal-settings","achmage-nn-border-addon"]' \
  > "$VAULT/.obsidian/community-plugins.json"

# Use the same Obsidian build as the desktop app if an update asar exists.
latest_asar="$(ls -1 "${XDG_CONFIG_HOME:-$HOME/.config}"/obsidian/obsidian-*.asar 2>/dev/null | sort -V | tail -n 1 || true)"
[ -n "$latest_asar" ] && cp "$latest_asar" "$USERDATA/"
cat > "$USERDATA/obsidian.json" <<JSON
{"vaults":{"e2e0000000000001":{"path":"$VAULT","ts":1700000000000,"open":true}},"updateDisabled":true}
JSON

setsid "$ELECTRON" "$ASAR" \
  --user-data-dir="$USERDATA" \
  --remote-debugging-port="$CDP_PORT" \
  --ozone-platform=headless \
  > "$WORK/obsidian.log" 2>&1 &
echo $! > "$WORK/obsidian.pid"

for _ in $(seq 1 30); do
  curl -s "http://127.0.0.1:$CDP_PORT/json/list" > /dev/null 2>&1 && break
  sleep 1
done
echo "Test Obsidian started (pid $(cat "$WORK/obsidian.pid"), CDP port $CDP_PORT)."
echo "Next: node dev/e2e/smoke.mjs"
