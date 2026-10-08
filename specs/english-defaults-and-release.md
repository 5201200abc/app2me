# English defaults and release evidence

## Language ownership

Shared DEFAULT_LOCALE and app settings schema own the application default: en-US. Missing locale and missing preference use English even on a Chinese operating system. Preserve explicitly saved Chinese or system preferences and legacy saved selections. Renderer initialization, error fallbacks, Bots, share pages without a locale, and MyChat fresh-store language must agree. Explicit Chinese share routes remain Chinese. CLI already defaults to English; make its primary README English as well. HTML language metadata must describe the English default.

## License release gate

Keep the strict license and original-material gate. Close each review only with version-specific publisher evidence, retained original notices, and source availability required by its license. A removed dependency can close a review only after it is absent from the real production and packaged graph. MPL reviews must be exact-version records tied to verified notice/source hashes and an actual distribution path; do not broaden the global allowlist. Do not fabricate copyrights, source revisions, or native build provenance. Unknown linked native components continue to block publication.

## Release

One version per source commit, verified 5201200abc identity, six native CI targets, one latest release after all architecture digests and licensing checks pass. Do not publish partial targets or discard gates to obtain a green run. English initialization on a Chinese host, explicit language preservation, evidence tampering, missing source, and the strict gate are acceptance scenarios.

## CI dependency scanning

The licensing collector owns locked-versus-installed dependency verification. It scans those two graphs sequentially to reduce Windows file-handle pressure without changing the packages under review. The supported-architecture installation includes both glibc and musl so every declared Linux optional package is present; absent packages continue to fail verification. Regression tests cover serial execution, graph mismatch rejection, and missing native packages. Hosted-run results must establish whether the Windows resource failure is resolved.
