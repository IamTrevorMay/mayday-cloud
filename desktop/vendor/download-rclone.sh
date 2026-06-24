#!/bin/bash
# Downloads rclone binaries for macOS (arm64 + x64).
# Run from the desktop/vendor/ directory, or it will cd there automatically.
# Binaries are ~50 MB each and excluded from git.
set -euo pipefail

VERSION="1.68.2"

cd "$(dirname "$0")"

for ARCH in arm64 amd64; do
  if [ "$ARCH" = "amd64" ]; then
    TARGET="rclone-darwin-x64"
  else
    TARGET="rclone-darwin-arm64"
  fi

  if [ -f "$TARGET" ]; then
    echo "$TARGET already exists, skipping"
    continue
  fi

  echo "Downloading rclone v${VERSION} for osx-${ARCH}..."
  curl -fSL "https://downloads.rclone.org/v${VERSION}/rclone-v${VERSION}-osx-${ARCH}.zip" -o tmp.zip
  unzip -o tmp.zip "rclone-v${VERSION}-osx-${ARCH}/rclone" -d tmp
  mv "tmp/rclone-v${VERSION}-osx-${ARCH}/rclone" "$TARGET"
  chmod +x "$TARGET"
  rm -rf tmp tmp.zip

  echo "$TARGET downloaded ($(du -h "$TARGET" | cut -f1))"
done

echo "Done."
