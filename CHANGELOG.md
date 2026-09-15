# Changelog

## 0.13.0

Read build results from your terminal with project-scoped read tokens.

- Add `difora builds` with branch/commit filters, bounded pagination and JSON output.
- Add `difora inspect <build-number>` and explicit `--build-id` lookup, preserving comparison revisions and original change classifications.
- Add authenticated PNG downloads into new directories, generated safe filenames and a completion manifest with SHA-256 hashes.
- Use the separate `DIFORA_READ_TOKEN` environment variable. Read commands cannot upload or make review decisions and exit 0 after successful reading, regardless of review status.
- Reject redirected image requests, mixed revisions, unsafe output targets and incomplete downloads. Preserve the CLI's zero runtime dependencies and existing upload behavior.

Requires the Difora read API. Setup and API reference: https://difora.eu/docs/api.html.

## 0.12.0

Add declared capture metadata for native, mobile, desktop and document screenshots.

- `difora annotate <dir>` writes hash-bound metadata beside completed PNGs, with dry-run validation, explicit device/renderer settings and no overwrite or renaming.
- Metadata version 2 adds platform, device, display, framework, renderer and document fields. Version 1 remains compatible, and uploads check every metadata version and byte limit before creating a build.
- Environment warnings recognize native renderer differences. The README links the native capture recipes and explains stable variant naming and server compatibility.

## 0.11.0

- Report recorded capture-environment differences after completed uploads, with a bounded count and field labels.
- Preserve JSON on stdout, send informational warnings to stderr, and keep review decisions and exit codes unchanged.
- Remain compatible with servers that omit environment summaries and with unfinished `--no-wait` uploads.
- Document a pinned Playwright container recipe for comparable local and CI capture environments.

## 0.10.1

- Record optional browser, viewport, device scale factor, color preference, locale, time zone and screenshot settings with the Playwright and Storybook helpers.
- Add stable explicit variants and configurable capture defaults. Existing names and PNG-only uploads stay compatible.
- Bind metadata sidecars to their PNG hashes, refuse duplicate recorded captures, and reject incomplete or stale capture output before upload.
- Negotiate server metadata support and validate the complete manifest before creating a build. Requires a server with capture metadata version 1 enabled.
- Document variant identity, clean attempt directories, declared environment labels and the generic producer sidecar format.
- Correct release notes for the first metadata client release. The v0.10.0 release preparation failed before publishing any package assets.

## 0.10.0 (unreleased)

Release preparation rejected duplicated notes before any package assets were published. The corrected release is 0.10.1.

- Record optional browser, viewport, device scale factor, color preference, locale, time zone and screenshot settings with the Playwright and Storybook helpers.
- Add stable explicit variants and configurable capture defaults. Existing names and PNG-only uploads stay compatible.
- Bind metadata sidecars to their PNG hashes, refuse duplicate recorded captures, and reject incomplete or stale capture output before upload.
- Negotiate server metadata support and validate the complete manifest before creating a build. Requires a server with capture metadata version 1 enabled.
- Document variant identity, clean attempt directories, declared environment labels and the generic producer sidecar format.

## 0.9.0

- Show a complete GitHub Actions workflow with full checkout history and pull requests plus main-branch pushes to avoid duplicate uploads.
- Clarify Chromium installation, matching Playwright package versions and generated-directory ignores.
- Add local token and scratch-branch guidance, plus links to the documentation index and two-server, no-build and SPA capture recipes.
- CLI and capture-helper behavior are unchanged.

## 0.8.3

- Warn before replacing an existing screenshot; use distinct names for each viewport, browser or theme.
- Link a complete Playwright configuration and static-site recipe, and spell out CI setup prerequisites.
- Document fixture mask and clip options, viewport naming collisions, snapshot usage and retry counting.
- Link the complete CLI reference and clarify that baselines must use the same rendering environment as CI.
- Simplify the README and remove the contribution guide and its links.

## 0.8.1

Updated installation documentation for the published npm client.

- Use `npm install --save-dev difora` and link directly to the npm package.
- Explain committing the package manifest and lockfile and running `npm ci` before capture and upload in CI.
- Remove the temporary npm-unavailable message; retain source builds and release downloads as optional installation methods.

CLI behavior, capture helpers and runtime dependencies are unchanged.

## 0.8.0

First public source release of the standalone Difora CLI and capture helpers.

- Upload PNG suites, detect nine CI providers, retry transient failures and report build results.
- Capture with Playwright and Storybook helpers, with structural TypeScript declarations.
- Aggregate parallel shards and support attempt-aware reruns.
- Resolve merge-base comparisons with explicit fallback warnings.
- Validate snapshot rules, thresholds and intrinsic ignore regions from difora.config.json.
- Detect PR/MR numbers for optional summary comments and provide doctor diagnostics.
- Build and test independently on Node 20, 22 and 24; zero runtime dependencies.

The hosted service and customer data are separate. npm registry publication is pending;
see README.md for building and installing the client from this public source repository.
