# License material remediation

The release gate remains the single owner of licensing admission. Evidence belongs to exact dependency versions and original publisher sources; missing notices, source revisions, or native build provenance remain blocking. Neither the license classifier nor the material gate receives a blanket exception.

## Retired telemetry

`MYCODE_TELEMETRY_ENABLED` is permanently false. The ARMS SDK bootstrap and vendor dependency are retired rather than initialized or replaced by an SDK-shaped stub. Existing database, process, resource, remote, and MCP diagnostic producers retain their local development logging through the desktop logger. Production logging does not gain new event payloads. Account identity is not synchronized to a telemetry service. Existing renderer IPC admission, validation, business operations, and local action traces remain unchanged.

## Unused copied guidance

The optional vendored React Best Practices development skill is not loaded by the application and has no callers outside its copied directory and inventory record. Remove the copied directory and its matching inventory record together. Do not replace its absent original notice with an invented attribution.

## Corresponding MPL sources

The exact npm publisher git revision is the source identity when present. Snapshot upstream source archives and license files, preserve their hashes, and document source availability in distributed notices. A source snapshot closes only the obligation it actually proves; unidentified native binaries or their dependencies remain pending. Approval never follows from a generic MPL allowlist.

## Validation

Verify retired SDK imports and package graph entries are absent, business code typechecks, local diagnostics remain available in development without adding production payloads, copied-skill files are absent, and tampered source/notice snapshots are rejected. Regenerate third-party notices from the actual installed graph before the strict check. Increment the release version for each submitted change under the existing account identity. Publish only after all evidence and six architecture builds pass.

## Installed-graph admission

The earlier serial CLI scan still produces EMFILE in hosted runners. Read and compare the repository lockfile and pnpm's installed lock snapshot as parsed documents before deriving the production graph directly from the lockfile's importer and snapshot records. The pnpm CLI is not invoked: hosted Windows runners read installed manifests even in lockfile-only mode. Traverse production and optional edges, including peer-resolved snapshot identities and linked workspace packages, while excluding dependency roots used only for development. Continue verifying every required exact version against its real installed package directory. This preserves stale-install rejection while removing the unbounded installed-tree CLI traversal. Tests reject changed snapshots and missing installed versions.

## Publisher declarations without standalone license files

A missing standalone LICENSE is not itself proof that the publisher withheld redistribution permission. Review exact original npm archives, their registry integrity, original package or bower license declarations, README license sections and every textual copyright/permission notice. Preserve these original materials and the declared standard terms in the distribution; do not invent a copyright holder or year when none was supplied. Admission is specific to a verified artifact and declared permissive license, not a general missing-notice exception. Validate the archive identity, original declaration, complete file hashes, and all original notice-bearing members; reject edited bytes, changed declarations, missing coverage and unreviewed versions. Embedded native/WASM and copyleft obligations are separate and remain subject to their own evidence checks.

## Windows ripgrep compiler provenance

Replace only the two Windows Microsoft ripgrep archives that contain an unavailable vendor Rust revision. Build the same ripgrep 14.1.1 source revision with official Rust 1.88.0, its known 6b00bc3880198600130e1cf62b8f8a93494488cc standard-library revision and statically linked PCRE2. Keep x64 and ARM64 Windows target validation, runtime search contracts, release version and native cache integrity. Record the exact source archive and compiler in distributed provenance. Delete the unused Windows archives and their unavailable-compiler record only after the build plans no longer consume them. A failed build or compiler identity mismatch must block packaging.

## Unused Node canvas removal and embedded QuickJS evidence

PDF preview runs in the browser renderer using DOM canvas; desktop packaging already excludes the optional Node-only canvas binaries. Remove only `pdfjs-dist>@napi-rs/canvas` through a root dependency override, retaining PDF preview and all other optional native dependencies. Regenerate the installed lock graph and remove Skia evidence that no remaining component references. Keep the existing packaging exclusion as a regression guard.

QuickJS remains required for PAC proxy evaluation. Validate its exact source and submodule revisions, WASI SDK 32 library notices and compiler revision against the producer sections of every original publisher WASM binary. Missing source, notices or mismatched binary identities must remain blocking.

Windows source extraction must use the existing bounded archive reader rather than an external tar executable: Git Bash tar treats a drive-letter path as a remote hostname. Require the exact immutable source prefix and reject path traversal or drive paths before writing into the build temporary directory.

Initialize the installed MSVC developer environment explicitly on both Windows architectures before dependency installation and compilation. The hosted images now use Visual Studio 2026, which older automatic compiler discovery does not recognize; discover its installation using vswhere, export only compiler/search environment variables, and invoke cl/lib from that environment. Fail if no C++ tools are present.

The source archive contains one HomebrewFormula symlink used only by macOS packaging. Windows extraction skips symbolic links without creating them; the default publisher archive validator continues rejecting links. Compiler source and Cargo.lock are extracted as regular files.

Run Windows source-build verification in PowerShell. Git Bash prepends its Unix tools directory and resolves link.exe to the Unix hard-link utility instead of the initialized MSVC linker. The Windows compiler step must preserve the developer environment PATH.

Both Windows source-build architectures must statically link the CRT as well as PCRE2. ARM64 does not inherit ripgrep’s x64-only Cargo configuration; pass the CRT target-feature explicitly for both targets and retain the existing PE import gate rejecting VC runtime DLL dependencies.
