#!/bin/sh
# Retakes media/screenshots/*.png in a clean VS Code profile. Needs Hyprland + grim.
set -e
cd "$(dirname "$0")/.."
npm run build >/dev/null
tmp=$(mktemp -d)
mkdir -p "$tmp/data/User"
cat > "$tmp/data/User/settings.json" <<'EOF'
{
  "workbench.startupEditor": "none",
  "window.restoreWindows": "none",
  "workbench.tips.enabled": false,
  "editor.minimap.enabled": false,
  "workbench.colorTheme": "Default Dark Modern",
  "editor.fontSize": 15,
  "terminal.integrated.fontSize": 14,
  "security.workspace.trust.enabled": false,
  "chat.disableAIFeatures": true,
  "git.enabled": false,
  "scm.diffDecorations": "none",
  "window.title": "${activeEditorShort} — Visual Studio G",
  "extensions.ignoreRecommendations": true,
  "update.mode": "none"
}
EOF
rm -f test-integration/result.txt
code --new-window --user-data-dir="$tmp/data" --extensions-dir="$tmp/ext" \
  --extensionDevelopmentPath="$PWD" --extensionTestsPath="$PWD/test-integration/screenshots.js" \
  "$PWD/exemplos" --wait
cat test-integration/result.txt
rm -rf "$tmp"
