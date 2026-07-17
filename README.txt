CrewPortal v6.3.3 Pacific HF-only patch

This patch intentionally contains NO parking files and NO parking workflow.
Upload the included files while preserving their folders.

Current verified assignment seeded from the official page:
- Valid from: 2026-07-17 0215Z
- North America → Asia: 11282 / 5547
- Alaska/North Pacific: 17946 / 13339

Automatic runs continue every 15 minutes. If the official CDN serves an old
cached page, the updater preserves the newer verified assignment and updates
checkedAtUtc with fetchStatus=upstream-stale-cache.

Emergency manual recovery:
Run update-arinc.yml manually and fill all five optional inputs. Leave all
inputs blank for a normal automatic fetch.
