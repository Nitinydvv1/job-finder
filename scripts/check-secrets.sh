#!/usr/bin/env bash
set -euo pipefail

# Blocks commits that include likely secrets in staged changes.
# Allows .env.example placeholders, but blocks real-looking credentials.

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to run secret checks."
  exit 1
fi

STAGED_DIFF="$(git diff --cached --name-only --diff-filter=ACMRT)"
if [[ -z "$STAGED_DIFF" ]]; then
  exit 0
fi

BLOCK_PATTERNS='(GEMINI_API_KEY\s*=\s*["\x27]?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY)'

# Scan staged patch (added lines only) excluding trusted template file.
SUSPECT_LINES="$(git diff --cached --unified=0 -- . ':(exclude).env.example' | grep -E '^\+' | grep -Ev '^\+\+\+' | grep -E "$BLOCK_PATTERNS" || true)"

if [[ -n "$SUSPECT_LINES" ]]; then
  echo ""
  echo "Commit blocked: potential secrets detected in staged changes."
  echo "Remove secrets from staged files and use environment variables instead."
  echo ""
  echo "Detected lines:"
  echo "$SUSPECT_LINES"
  echo ""
  exit 1
fi

exit 0
