#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Сборка DMG требует macOS и Xcode Command Line Tools.' >&2
  exit 1
fi

source native/version.env
out="${1:-$repo/native/out}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
app="$scratch/dmg/Stormcore.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$scratch/Stormcore.iconset"
node native/package-web.mjs "$app/Contents/Resources/stormcore.html"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" native/icon.png --out "$scratch/Stormcore.iconset/icon_${size}x${size}.png" >/dev/null
  doubled=$((size*2))
  sips -z "$doubled" "$doubled" native/icon.png --out "$scratch/Stormcore.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns -o "$app/Contents/Resources/Stormcore.icns" "$scratch/Stormcore.iconset"

python3 - "$app/Contents/Info.plist" "$VERSION" "$BUILD_NUMBER" <<'PY'
from pathlib import Path
import plistlib
import re
import sys

dest, version, build = sys.argv[1:]
source = Path('docs/cloud-config.js').read_text()
endpoint = re.search(r"export const progressEndpoint = '(https://[^']+)';", source)[1]
with open(dest, 'wb') as output:
    plistlib.dump({
        'CFBundleDisplayName': 'Штормовое ядро',
        'CFBundleExecutable': 'Stormcore',
        'CFBundleIconFile': 'Stormcore',
        'CFBundleIdentifier': 'com.stormcore.rift',
        'CFBundleInfoDictionaryVersion': '6.0',
        'CFBundleName': 'Stormcore',
        'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': version,
        'CFBundleVersion': build,
        'LSApplicationCategoryType': 'public.app-category.arcade-games',
        'LSMinimumSystemVersion': '13.0',
        'NSHighResolutionCapable': True,
        'StormcoreProgressURL': endpoint,
    }, output)
PY

sdk="$(xcrun --sdk macosx --show-sdk-path)"
for arch in arm64 x86_64; do
  xcrun swiftc -sdk "$sdk" -target "$arch-apple-macosx13.0" -swift-version 5 \
    -parse-as-library -O native/macos/Stormcore.swift -o "$scratch/Stormcore-$arch"
done
xcrun lipo -create "$scratch/Stormcore-arm64" "$scratch/Stormcore-x86_64" -output "$app/Contents/MacOS/Stormcore"
xcrun lipo -verify_arch arm64 x86_64 "$app/Contents/MacOS/Stormcore"

identity="${STORMCORE_CODESIGN_IDENTITY:--}"
codesign --force --sign "$identity" --options runtime "$app"
codesign --verify --strict "$app"
ln -s /Applications "$scratch/dmg/Applications"
disk="$out/Stormcore-${VERSION}-macOS.dmg"
hdiutil create -ov -format UDZO -volname "Stormcore" -srcfolder "$scratch/dmg" "$disk"
hdiutil verify "$disk"
printf '%s\n' "$disk"
