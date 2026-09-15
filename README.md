# difora

Command-line client for [Difora](https://difora.eu) — visual regression testing with EU-owned
screenshot comparison and storage. Your CI renders the screenshots; the CLI uploads only what changed and reports the
result of the comparison against your approved baselines.

Install [difora from npm](https://www.npmjs.com/package/difora) in your screenshot project
(Node 20 or newer):

```sh
npm install --save-dev difora
```

Commit `package.json` and `package-lock.json`, then run `npm ci` in CI before capture and upload.

```yaml
# .github/workflows/visual.yml
name: Visual review
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 } # merge-base comparisons need full history
      - uses: actions/setup-node@v5
        with: { node-version: 24 }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npx playwright test # produces ./screenshots/*.png
      - run: npx difora upload ./screenshots
        env:
          DIFORA_TOKEN: ${{ secrets.DIFORA_TOKEN }}
```

Browse the [docs](https://difora.eu/docs/) or start with the [getting-started guide](https://difora.eu/docs/getting-started.html).
The workflow uses the capture config and your site's `build` script; omit the build step
for a no-build site. It fetches full history for merge-base comparisons. Locally, install
Chromium with `npx playwright install chromium`; in CI use
`npx playwright install --with-deps chromium`. Install other browsers only if your projects use them.
See the [full GitHub Actions job](https://difora.eu/docs/ci.html#github).
Customer-selected integrations receive build metadata; public PR thumbnails require
an owner's opt-in and may be cached outside the EU.

## Public source and installation

For a manual download, get the package and `SHA256SUMS` from
[GitHub Releases](https://github.com/difora/difora-client/releases).
The release notes explain checksum verification and installation. GitHub releases and
npm publication are separate.

To build the client yourself, use the public source:

```sh
git clone https://github.com/difora/difora-client.git
cd difora-client
npm ci
npm run build
npm test
npm pack
```

Then, in your screenshot project, install the generated tarball:

```sh
npm install --save-dev /path/to/difora-client/difora-0.9.0.tgz
npx difora --version
```

Full [CLI reference](https://difora.eu/docs/cli.html): option arguments, defaults,
environment variables, exit codes and usage accounting.
[Complete Playwright config and static-site recipe](https://difora.eu/docs/capture.html#playwright-config).

## Usage

```
difora upload <dir> [--branch <name>] [--commit <sha>] [--message <text>]
                    [--api-url <url>] [--token <token>] [--no-wait] [--timeout <seconds>]
                    [--exit-zero-on-changes] [--concurrency <n>] [--json] [--post-status]
                    [--parallel] [--shard <i>/<n>] [--parallel-id <key>] [--shard-timeout <minutes>]
                    [--base-branch <name>] [--base-commit <sha>] [--no-merge-base]
                    [--config <file>] [--pr <number>]
difora doctor       Show detected CI values and check the API connection
difora builds [--branch <name>] [--commit <sha>] [--limit <1-100>] [--before <id>] [--json]
difora inspect <build-number> [--changed-only] [--json] [--download <new-directory>]
difora inspect --build-id <id> [--changed-only] [--json] [--download <new-directory>]
difora --version | --help
```

- `DIFORA_TOKEN` (or `--token`): a project token from _Settings → CI tokens_ in the Difora app.
- `DIFORA_API_URL` (or `--api-url`): defaults to `https://app.difora.eu/api`.
- `DIFORA_READ_TOKEN`: a separate project read token from _Settings → API access_.
  Required by `builds` and `inspect`; upload tokens cannot read review evidence.
- Branch and commit are detected on GitHub Actions, GitLab CI, Bitbucket Pipelines, CircleCI,
  Jenkins, Azure DevOps, Travis, Buildkite and Drone (pull/merge requests report the source branch
  and its head commit), or from the local Git checkout when run outside CI.
  `DIFORA_BRANCH` / `DIFORA_COMMIT` override.
- `--post-status` posts the result as a commit status using the pipeline's own credentials
  (`GITHUB_TOKEN`, or `DIFORA_STATUS_TOKEN` for GitLab/Bitbucket) — for repository hosts the
  Difora service cannot reach.

### Read results and download images

CLI 0.13.0 adds `builds` and `inspect`. Read tokens are scoped to one project, expire
after 90 days by default (365 maximum), and show their secret only at creation.
Discussion text access is optional and off by default. An owner can disable project
read access and revoke existing tokens. These credentials never approve or upload.

`inspect 42` selects project build number 42; `--build-id 123` explicitly selects
API build ID 123. Successful reads exit 0 even for unreviewed/rejected builds;
usage, authorization, transport and download failures exit 2. `--json` writes one
JSON result to stdout. Errors go to stderr. No Git checkout is required.

`--changed-only` includes original changed/new/removed classifications, including
approved snapshots. `--download ./build-42` requires a new directory with an existing
parent. Files use generated snapshot-ID/kind names. Each PNG is authenticated,
bounded and hashed; `manifest.json` is written only after all downloads finish.
An absent manifest means incomplete output. Existing directories and symlinks are
refused. Expired evidence cannot be downloaded, and a rerun invalidates stale
comparison revisions. Tokens are never sent to redirected or arbitrary image URLs.

Both read commands support `DIFORA_API_URL`/`--api-url`; HTTPS is required except
for loopback development. Keep the read credential in your environment or secret
manager, not a command-line argument. The default limits are 120 reads/minute and
30 images/minute per token; the CLI respects bounded retry delays.

[Read API, token setup and OpenAPI reference](https://difora.eu/docs/api.html).

**Baseline environment:** approve baselines only from builds captured in CI, or in the
exact same environment CI uses. Laptop font rendering can differ from Linux CI and make
every CI run show visual changes. To test locally, use a scratch branch with
the command below and leave that build unapproved. Replace `<token>` with your project token;
keep it only in a shell variable or CI secret, never in a file.

```sh
DIFORA_TOKEN='<token>' npx difora upload ./screenshots --branch local-check
```

Snapshot names are the PNG paths relative to `<dir>` without the extension, so `login/desktop.png`
becomes `login/desktop`. Every file is hashed (SHA-256); images the server already has are not
transferred again. Network errors, 429 and 5xx responses are retried with back-off.
Each submitted snapshot counts once when a build starts comparison, including unchanged
images and all shards, against your organization's UTC calendar-month allowance; a new
build attempt counts again. Run pull requests and pushes to `main` only so a PR branch is
not uploaded twice; each new build counts toward snapshot usage. [Usage and retries](https://difora.eu/docs/cli.html#usage).

## Exit codes

| Code | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| 0    | passed (no visual changes) or approved                              |
| 1    | changes pending review, rejected or comparison error — open the URL |
| 2    | usage error, upload failure, or monthly snapshot limit reached      |
| 3    | timed out waiting for the comparison (it continues on the server)   |

`--exit-zero-on-changes` makes pending review non-blocking; `--no-wait` returns right after upload.

## Capture helpers (0.4.0+)

Install Difora as a dev dependency alongside your browser test runner. If the repo already
uses `playwright`, check `npm ls playwright` and install `@playwright/test` at that exact
version: `npm install --save-dev @playwright/test@<same version as playwright>`.
Add `screenshots/`, `test-results/` and `playwright-report/` to `.gitignore`.

For multiple apps, use a `webServer` array and absolute URLs in tests. No-build sites can
serve their source directory directly; SPAs can use http-server's
`-P http://127.0.0.1:PORT?` fallback, with the server's port and trailing `?`.
See the [two-server recipe](https://difora.eu/docs/capture.html#monorepos).

```ts
import { diforaScreenshot } from 'difora/playwright';
await diforaScreenshot(page, 'home', { fullPage: true, viewportSuffix: true });
```

`withDifora(base)` binds a `diforaScreenshot(name, options)` fixture to your own Playwright
test; apply it after your existing fixture extensions. `createPostVisit(options)` from
`difora/storybook` supports the Storybook test-runner hook. Options include `fullPage`,
`viewportSuffix`, `dir` and a Storybook `skip(context)` predicate; direct Playwright capture
and the `withDifora` fixture both support `mask` locators and `clip`. Helpers disable animations and hide the caret.

Output goes to `dir`, `DIFORA_SCREENSHOT_DIR`, or `./screenshots`. Names retain groups,
with stable hash suffixes when sanitised. Use a fresh directory for each CI run; helpers
do not delete existing files. Wait for your app to be ready before capturing.

`viewportSuffix` adds only the width, not the Playwright project name, height, browser
or theme. Use distinct widths or explicit name prefixes; identical paths overwrite.

### Capture metadata and explicit variants (0.10.1+)

Opt in to record the browser, viewport, device scale factor, color preference,
locale, time zone and screenshot settings that the helper can observe:

```ts
const test = withDifora(base, {
  captureMetadata: {
    environment: { id: 'visual-ci', revision: 'image-2026-09' },
  },
});
test('home', async ({ diforaScreenshot }) => {
  await diforaScreenshot('home', {
    variant: 'chromium-desktop-dark',
    captureMetadata: { theme: 'dark' },
  });
});
```

The options also work with direct `diforaScreenshot` and `createPostVisit`.
Per-capture metadata fields override wrapper defaults. `captureMetadata: false`
disables recording when no variant is supplied. Existing calls remain unchanged.

Metadata alone preserves the filename and baseline identity. An explicit `variant`
enables recording and adds `@v-<slug>-<digest>` before `.png`, after any width suffix.
Use a stable variant for each browser/viewport/theme combination. Changing a variant
creates a different snapshot name; changing a browser version does not. Adding a
variant to an established name appears as a new snapshot and a removed old name.
`viewportSuffix` alone still records only width in the name.

Recorded captures refuse to overwrite existing destinations. Use a clean output
directory per CI run, shard and retry attempt. Upload only completed captures and
preserve each PNG together with its `.png.difora.json` sidecar in CI artifacts.
The sidecar contains a SHA-256 binding to the PNG. Orphaned, stale, malformed or
oversized sidecars and incomplete capture locks fail before build creation. PNG-only
uploads keep working. The CLI checks server support before sending metadata and
fails with exit code 2 if the server is older or recording is disabled; it never
silently drops the evidence. Manifests exceeding 5 MiB need fixed-count sharding.

The app’s **Variants** panel filters browser, complete viewport, app theme, explicit
variant and environment. **Capture details** compares the recorded baseline and
current values, including earlier discussion comparisons. Missing values remain
“Not recorded.” Metadata is client-reported evidence, not a guarantee of identical
rendering. App `theme`, renderer `os` and `environment` are declared by the caller;
OS is never inferred from the uploader. Use non-secret labels; no tokens, URLs,
DOM content, locator text or environment dumps belong in metadata.

Generic PNG producers can write the same version 1 sidecar contract. See the
[capture metadata reference](https://difora.eu/docs/capture.html#metadata) for the
bounded fields and an envelope example.

Capture recipes: https://difora.eu/docs/capture.html
Getting started: https://difora.eu/docs/getting-started.html

## Environment warnings (0.11.0+)

After a completed upload, the CLI reports how many successfully compared captures
have a recorded environment difference from their baseline. Browser name/full
version, OS, device scale, locale, time zone and environment identity are checked.
A known difference can coexist with missing fields. Unknown-only evidence and
older servers produce no warning. `--no-wait` does not report an unfinished result.

The warning never changes exit codes or review status. `--json` retains valid JSON
on stdout and sends the warning to stderr. Build review explains the fields and
can filter affected snapshots, including identical PNGs with different provenance.
Use the [pinned capture recipe](https://difora.eu/docs/capture-environment.html)
to match local and CI renderers. Reported values are evidence, not attestation.

## Sharded builds (0.5.0+)

Run `difora upload ./screenshots --shard 1/2` in one job and `--shard 2/2` in the other.
Each directory must contain different, stable snapshot names. Both jobs join one build and poll
its combined result; `--no-wait` returns after that job finishes uploading. `--parallel` uses the
CI provider's shard variables. `DIFORA_SHARD` also accepts one-based `i/n`.

The default group ID is the provider's pipeline/workflow ID; override with `--parallel-id` or
`DIFORA_PARALLEL_ID` for multiple suites. Percy `PERCY_PARALLEL_NONCE/TOTAL` aliases are accepted,
but the count still needs a shard index. Without a run ID the CLI warns and uses the commit SHA.
Use `--shard-timeout <minutes>` to override the project's 30-minute upload timeout and
`--timeout <seconds>` to extend this CLI process's five-minute wait.

Re-uploading a finished group creates a new attempt, keeps the other shards, and waits through
a short grace period before comparing. Every shard that joins that attempt must finish. Keep the
same branch, commit, total and partition; otherwise use a new ID and upload all shards. Duplicate
names across shards return 409. `difora doctor` shows run/attempt/shard detection.
Recipes and retry details: https://difora.eu/docs/ci.html#sharding

## Merge-base comparisons (0.6.0+)

Feature branches use the exact successful baseline-branch build at their Git merge-base,
then apply branch-local approvals and removals. The target comes from `--base-branch`,
`DIFORA_BASE_BRANCH`, CI pull-request metadata, or the project's baseline branch.
Keep full Git history (`fetch-depth: 0`) and fetch the target branch. The CLI uses the
source commit in PR builds; it never changes the checkout. Missing history warns and
falls back visibly in the review UI. No lookup is needed on the baseline branch.

Use `--base-commit <sha>` for a known anchor or `--no-merge-base` to compare against
current branch baselines. All shards must use the same base metadata.
Details: https://difora.eu/docs/ci.html#merge-base

## Pull request comments (0.8.0+)

For PR/MR summary comments, CLI 0.8.0 detects the PR number from supported CI
environments. Set `--pr 12` or `DIFORA_PR_NUMBER=12` to override it; `difora doctor`
shows the detected value. Enable a repository integration in project Settings.
Comments are separate from `--post-status`. Thumbnails are off by default and
require an owner's explicit opt-in; see [setup and privacy](https://difora.eu/docs/ci.html#pr-comments).

## Snapshot rules (0.7.0+)

Use `--config <path>`, or put `difora.config.json` in the screenshot directory (first)
or working directory (second):

```json
{
  "version": 1,
  "rules": [
    {
      "match": "pages/**",
      "threshold": 0.1,
      "changeRatioThreshold": 0.001,
      "ignore": [{ "x": 10, "y": 10, "width": 100, "height": 40 }]
    }
  ]
}
```

Repository rules take priority over saved UI rules; the most specific pattern wins within
each source. Missing fields inherit project defaults. Regions are intrinsic screenshot
pixels, clipped to the overlap, and excluded from the changed-pixel denominator. Size changes
still count. All shards and retries must use the same rules; use a new parallel ID to change
config. Invalid config exits 2 before uploading. Limits: 1 MB, 200 rules, 50 regions per rule.

Patterns, precedence, editor and schema: https://difora.eu/docs/config.html

## Native, mobile and document captures

CLI 0.12.0 adds a local `annotate` command. Record PNGs with your own tools, put
device combinations in stable variant directories, then attach declared metadata:

```sh
npx difora annotate screenshots/ios-dark --platform ios \
  --device-model "iPhone 15" --runtime simulator --os iOS --os-version 17.5 \
  --scale 3 --theme Dark --surface screen --dry-run
# Remove --dry-run to write hash-bound sidecars after checking your actual settings.
npx difora upload screenshots
```

Annotation never changes PNGs or names, infers device values, overwrites sidecars or
contacts a server. Existing/stale/orphan sidecars and incomplete capture locks stop
the operation. Errors exit 2. `--variant` only records a label; directory/file names
remain the baseline identity. Use clean, completed capture output.

`difora annotate --help` lists device, display, OS, framework, renderer, document and
environment flags. Version 2 metadata allows 3,072 UTF-8 bytes, while version 1 stays
valid at 2,048. Server support is checked before build creation. Native review adds
Platform/Device filters and declared capture details.

[Native capture recipes](https://difora.eu/docs/native-capture.html) cover XCTest,
Swift snapshots, Paparazzi, Roborazzi, Compose Preview, Flutter, Maestro, Detox and PDF,
with explicit verification labels and CI guidance.
