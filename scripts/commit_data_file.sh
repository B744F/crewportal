#!/usr/bin/env bash
set -euo pipefail

file="${1:?data file path required}"
message="${2:?commit message required}"

python3 -m json.tool "$file" >/dev/null

if git diff --quiet -- "$file"; then
  echo "No verified change for $file"
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add "$file"
git commit -m "$message"

# The workflows share one concurrency group, but retry a rebase/push as a final safeguard.
for attempt in 1 2 3; do
  echo "Push attempt ${attempt}/3"
  if git pull --rebase origin main && git push origin HEAD:main; then
    exit 0
  fi
  git rebase --abort >/dev/null 2>&1 || true
  git fetch origin main
  git rebase origin/main
  sleep $((attempt * 3))
done

echo "Unable to publish $file after three attempts" >&2
exit 1
