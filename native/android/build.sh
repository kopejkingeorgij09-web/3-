#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"
source native/version.env
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
: "${sdk:?ANDROID_HOME must point to the Android SDK}"
: "${STORMCORE_ANDROID_KEYSTORE:?Set the path to the PKCS12 release keystore}"
: "${STORMCORE_ANDROID_PASSWORD_FILE:?Set the path to a file with the signing password}"
tools="$sdk/build-tools/35.0.0"
platform="$sdk/platforms/android-35/android.jar"
[[ -x "$tools/aapt2" && -f "$platform" ]] || { echo 'Install Android SDK platform 35 and build tools 35.0.0.' >&2; exit 1; }

out="${1:-$repo/native/out}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch"/{assets,classes,dex,res/drawable-nodpi}
cp native/android/res/values/styles.xml "$scratch/styles.xml"
mkdir -p "$scratch/res/values"
mv "$scratch/styles.xml" "$scratch/res/values/"
cp native/icon.png "$scratch/res/drawable-nodpi/stormcore.png"
node native/package-web.mjs "$scratch/assets/stormcore.html"

"$tools/aapt2" compile --dir "$scratch/res" -o "$scratch/resources.zip"
"$tools/aapt2" link --manifest native/android/AndroidManifest.xml -I "$platform" \
  --min-sdk-version 26 --target-sdk-version 35 --version-code "$BUILD_NUMBER" --version-name "$VERSION" \
  -A "$scratch/assets" -o "$scratch/unsigned.apk" "$scratch/resources.zip"
jdk_bin="${JAVA_HOME:+$JAVA_HOME/bin/}"
"${jdk_bin}javac" --release 11 -encoding UTF-8 -classpath "$platform" -d "$scratch/classes" native/android/src/MainActivity.java
"${jdk_bin}jar" cf "$scratch/compiled.jar" -C "$scratch/classes" .
"$tools/d8" --release --min-api 26 --lib "$platform" --output "$scratch/dex" "$scratch/compiled.jar"
zip -q -j "$scratch/unsigned.apk" "$scratch/dex/classes.dex"
"$tools/zipalign" -f 4 "$scratch/unsigned.apk" "$scratch/aligned.apk"
apk="$out/Stormcore-${VERSION}-Android.apk"
"$tools/apksigner" sign --ks "$STORMCORE_ANDROID_KEYSTORE" --ks-type PKCS12 \
  --ks-key-alias stormcore --ks-pass "file:$STORMCORE_ANDROID_PASSWORD_FILE" \
  --out "$apk" "$scratch/aligned.apk"
"$tools/apksigner" verify --verbose "$apk"
"$tools/zipalign" -c 4 "$apk"
printf '%s\n' "$apk"
