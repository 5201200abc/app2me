# Automatic app2me releases

## Ownership and trigger

The release workflow runs on every push to `main`, including PR merges, or an explicit manual retry of a commit. Each new first-parent source commit receives one shared root/desktop version. Locally prepared commits already containing a valid increasing shared version are reused, not incremented twice. Otherwise CI creates a version commit with a `Release-Commit` trailer; generated version commits are excluded from source processing. Batched pushes process every source commit in order. Retries reuse the recorded identity. Both local and CI release commits use the verified repository owner identity, 5201200abc <5201200abc@gmail.com>. Concurrent preparations retry rejected non-fast-forward pushes against the new head. Historic commits predating this workflow are excluded.

## Version identity

Public artifact names remain `app2me-YYYY-MM-DD`, with one GitHub `latest` release. Internal versions use the existing UTC date/time scheme and increase monotonically, including multiple merges within one second. All six build jobs consume the same committed version, date, and Windows build version. A newer prepared version supersedes older publication jobs; they cannot overwrite a newer release.

## Build and publication

Build macOS, Windows, and Linux for x64 and arm64 on matching hosted runners. Each job builds and verifies its own manifest and uploads it under a unique target name. The final job verifies all six manifests, equal identities, unique asset names, and SHA-256 digests before calling the existing publication path. Architecture-specific update channels prevent x64 and arm64 feeds from overwriting one another. No release is published after a missing, failed, or mismatched target.

Only version and publish jobs have repository write permission. Builds have read permission. Publishing jobs share an exclusive lock. Interrupted or failed builds preserve the previous release. The existing publisher's post-commit failure boundary remains: once old remote assets are deleted, rollback is not guaranteed. No new semantic-version release tags or additional historical releases are created.

## Licensing and cleanup

Retain user-configured Bots, generic provider error handling, third-party MCP OAuth, event subscriptions, and history compatibility. Remove stale deleted-directory configuration and unused promotional copy/code. Never change immutable database migration identifiers or third-party copyright text as cosmetic cleanup.

License classification and material completeness are separate checks. A release requires both, including original notice provenance. Mixed license expressions must retain restrictive terms. Missing upstream evidence blocks release; absent material must not be resolved by fabricated attribution or an unreviewed broad allowlist.

## Acceptance

Tests cover monotonic versions, retries, shared target identity, incomplete target sets, collisions and tampered artifacts, and architecture-specific feeds. Workflow validation checks push-triggered execution and commit retry inputs, six native targets, limited permissions, and publication dependencies. Local verification does not claim a hosted build, signed installer, or successful GitHub publication.
