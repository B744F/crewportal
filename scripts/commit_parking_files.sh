#!/usr/bin/env bash
set -euo pipefail

files=(data/parking.json data/airport-parking.json)

for file in "${files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Required data file missing: $file" >&2
    exit 1
  fi
  python3 -m json.tool "$file" >/dev/null
done

changed=()
for file in "${files[@]}"; do
  if ! git diff --quiet -- "$file"; then
    changed+=("$file")
  fi
done

if (( ${#changed[@]} == 0 )); then
  echo "No verified parking data changes"
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add "${changed[@]}"
git commit -m "Update crew and airport parking data"

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

echo "Unable to publish parking data after three attempts" >&2
exit 1
