#!/bin/bash
# Pre-push hook: runs unit tests before allowing a push.
# Install: cp scripts/pre-push.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push
# Remove:  rm .git/hooks/pre-push

set -e
ROOT="$(git rev-parse --show-toplevel)"

echo "[pre-push] Running API unit tests..."
cd "$ROOT/api" && npx vitest run --reporter=dot

echo "[pre-push] Running client unit tests..."
cd "$ROOT/client" && npx vitest run --reporter=dot

echo "[pre-push] All tests passed. Pushing..."
