#!/bin/bash
set -uo pipefail

# Downloads and installs editor binaries on macOS.
# Idempotent: skips editors already installed in /Applications/.
# Best-effort: continues past download failures so CI doesn't break
# when a URL is stale. The test runner skips missing editors.
# Usage: ./e2e/install-editors.sh [install_dir]

INSTALL_DIR="${1:-/tmp/glean-e2e-editors}"
mkdir -p "$INSTALL_DIR"

install_dmg_app() {
  local name="$1" url="$2" app_name="$3"

  if [ -d "/Applications/${app_name}.app" ]; then
    echo "${app_name} already installed, skipping"
    return 0
  fi

  echo "Downloading ${name}..."
  local dmg_path="${INSTALL_DIR}/${name}.dmg"
  if ! curl -fSL --connect-timeout 10 --max-time 300 -o "$dmg_path" "$url"; then
    echo "WARNING: Failed to download ${name}, skipping"
    rm -f "$dmg_path"
    return 0
  fi

  echo "Mounting and installing ${name}..."
  local mount_point
  if ! mount_point=$(hdiutil attach "$dmg_path" -nobrowse -quiet | tail -1 | awk '{print $NF}'); then
    echo "WARNING: Failed to mount ${name} DMG, skipping"
    rm -f "$dmg_path"
    return 0
  fi

  cp -R "${mount_point}/${app_name}.app" /Applications/
  hdiutil detach "$mount_point" -quiet
  rm -f "$dmg_path"
  echo "${name} installed to /Applications/${app_name}.app"
}

# Cursor
install_dmg_app "cursor" \
  "https://downloader.cursor.sh/arm64/dmg/stable/latest" \
  "Cursor"

# Windsurf
install_dmg_app "windsurf" \
  "https://windsurf-stable.codeiumdata.com/macos-arm64/stable/latest" \
  "Windsurf"

# Antigravity - URL TBD, may need to be updated
install_dmg_app "antigravity" \
  "https://antigravity.dev/download/macos-arm64/latest" \
  "Antigravity"

echo ""
echo "Done. Installed editors:"
ls -d /Applications/{Cursor,Windsurf,Antigravity}.app 2>/dev/null || echo "(none found)"
