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
# .github/workflows/ci.yml
- run: npx playwright test # produces ./screenshots/*.png
- run: npx difora upload ./screenshots
  env:
    DIFORA_TOKEN: ${{ secrets.DIFORA_TOKEN }}
```

Start with the [getting-started guide](https://difora.eu/docs/getting-started.html).
Customer-selected integrations receive build metadata; public PR thumbnails require
an owner's opt-in and may be cached outside the EU.

## Public source and installation

Source: [github.com/difora/difora-client](https://github.com/difora/difora-client).
This MIT-licensed repository contains the standalone npm client and capture helpers.
The hosted service is maintained separately. No service code or customer data is included.

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
npm install --save-dev /path/to/difora-client/difora-0.8.1.tgz
npx difora --version
```

See [CONTRIBUTING.md](https://github.com/difora/difora-client/blob/main/CONTRIBUTING.md)
for contribution and release conventions.

## Usage

```
difora upload <dir> [--branch <name>] [--commit <sha>] [--message <text>]
                    [--api-url <url>] [--token <token>] [--no-wait] [--timeout <seconds>]
                    [--exit-zero-on-changes] [--concurrency <n>] [--json] [--post-status]
                    [--parallel] [--shard <i>/<n>] [--parallel-id <key>] [--shard-timeout <minutes>]
                    [--base-branch <name>] [--base-commit <sha>] [--no-merge-base]
                    [--config <file>] [--pr <number>]
difora doctor       Show detected CI values and check the API connection
difora --version | --help
```

- `DIFORA_TOKEN` (or `--token`): a project token from _Settings → CI tokens_ in the Difora app.
- `DIFORA_API_URL` (or `--api-url`): defaults to `https://app.difora.eu/api`.
- Branch and commit are detected on GitHub Actions, GitLab CI, Bitbucket Pipelines, CircleCI,
  Jenkins, Azure DevOps, Travis, Buildkite and Drone (pull/merge requests report the source branch
  and its head commit), or from the local git checkout. `DIFORA_BRANCH` / `DIFORA_COMMIT` override.
- `--post-status` posts the result as a commit status using the pipeline's own credentials
  (`GITHUB_TOKEN`, or `DIFORA_STATUS_TOKEN` for GitLab/Bitbucket) — for repository hosts the
  Difora service cannot reach.

Snapshot names are the PNG paths relative to `<dir>` without the extension, so `login/desktop.png`
becomes `login/desktop`. Every file is hashed (SHA-256); images the server already has are not
transferred again. Network errors, 429 and 5xx responses are retried with back-off.

## Exit codes

| Code | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| 0    | passed (no visual changes) or approved                              |
| 1    | changes pending review, rejected or comparison error — open the URL |
| 2    | usage error, upload failure, or monthly snapshot limit reached      |
| 3    | timed out waiting for the comparison (it continues on the server)   |

`--exit-zero-on-changes` makes pending review non-blocking; `--no-wait` returns right after upload.

Zero runtime dependencies. MIT licensed. Operated by Missus GmbH, Graz, Austria.
Full CI recipes: https://difora.eu/docs/ci.html

## Capture helpers (0.4.0+)

Install Difora as a dev dependency alongside your browser test runner.

```ts
import { diforaScreenshot } from 'difora/playwright';
await diforaScreenshot(page, 'home', { fullPage: true, viewportSuffix: true });
```

`withDifora(base)` binds a `diforaScreenshot(name, options)` fixture to your own Playwright
test; apply it after your existing fixture extensions. `createPostVisit(options)` from
`difora/storybook` supports the Storybook test-runner hook. Options include `fullPage`,
`viewportSuffix`, `dir` and a Storybook `skip(context)` predicate; direct Playwright capture
also supports `mask` locators and `clip`. Helpers disable animations and hide the caret.

Output goes to `dir`, `DIFORA_SCREENSHOT_DIR`, or `./screenshots`. Names retain groups,
with stable hash suffixes when sanitised. Use a fresh directory for each CI run; helpers
do not delete existing files. Wait for your app to be ready before capturing.

Capture recipes: https://difora.eu/docs/capture.html
Getting started: https://difora.eu/docs/getting-started.html

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
