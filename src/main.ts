import { loadConfig } from './config';
/**
 * Difora CLI — uploads a directory of PNG screenshots from CI and reports the result.
 *
 * Usage:
 *   difora upload ./screenshots            # branch/commit detected from the CI environment
 *   difora upload ./screenshots --branch main --commit $SHA --post-status
 *   difora doctor                          # shows what would be detected, checks the API
 *
 * Auth: DIFORA_TOKEN env var (a project token, `df_...`).
 * API:  DIFORA_API_URL env var or --api-url (default https://app.difora.eu/api).
 *
 * Exit codes: 0 = passed/approved (or changes with --exit-zero-on-changes),
 *             1 = changes pending review / rejected / comparison error,
 *             2 = usage or upload failure, 3 = timed out while waiting for the comparison.
 */
import { execFileSync } from 'child_process';
import { mergeBase } from './git';
import { createHash } from 'crypto';
import { lstatSync, readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import {
  detectCi,
  parallelOptions,
  parseShard,
  parsePrNumber,
  type CiInfo,
} from './ci-env';
import {
  detectStatusTarget,
  postCommitStatus,
  type StatusState,
  type StatusTarget,
} from './status';

interface CliOptions {
  dir: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  apiUrl: string;
  token: string;
  wait: boolean;
  exitZeroOnChanges: boolean;
  timeoutSeconds: number;
  concurrency: number;
  json: boolean;
  postStatus: boolean;
  parallelId?: string;
  shardIndex?: number;
  shardTotal?: number;
  shardTimeoutMinutes?: number;
  runAttempt?: number;
  baseBranch: string;
  baseCommit?: string;
  noMergeBase: boolean;
  config?: string;
  prNumber?: number;
}

interface BuildStatus {
  prNumber: number | null;
  buildId: number;
  status: string;
  url: string;
  snapshotsTotal: number;
  snapshotsIdentical: number;
  snapshotsChanged: number;
  snapshotsNew: number;
  snapshotsRemoved: number;
}

const VERSION = '0.9.0';
const MAX_ATTEMPTS = 5;
const FINAL_STATUSES = [
  'passed',
  'approved',
  'unreviewed',
  'rejected',
  'error',
];
const USAGE = `difora ${VERSION} — https://difora.eu

Usage:
  difora upload <dir> [--branch <name>] [--commit <sha>] [--message <text>]
                      [--api-url <url>] [--token <token>] [--no-wait] [--timeout <seconds>]
                      [--exit-zero-on-changes] [--concurrency <n>] [--json] [--post-status]
                      [--parallel] [--shard <i>/<n>] [--parallel-id <key>] [--shard-timeout <minutes>]
                      [--base-branch <name>] [--base-commit <sha>] [--no-merge-base] [--config <file>] [--pr <number>]
  difora doctor       Show detected CI values and check the API connection
  difora --version | --help

Environment: DIFORA_TOKEN (project token), DIFORA_API_URL (default https://app.difora.eu/api),
             DIFORA_BRANCH / DIFORA_COMMIT (override detection), DIFORA_STATUS_TOKEN (--post-status)
Detection:   GitHub Actions, GitLab CI, Bitbucket Pipelines, CircleCI, Jenkins, Azure DevOps,
             Travis, Buildkite, Drone — or the local git checkout.
Exit codes:  0 passed/approved · 1 changes need review, rejected or error · 2 usage/upload error
             3 timed out waiting for the comparison (build keeps running on the server)`;

let jsonMode = false;

/** Human-readable progress goes to stderr in --json mode so stdout stays machine-readable. */
function log(message: string): void {
  (jsonMode ? console.error : console.log)(`difora: ${message}`);
}

function fail(message: string, code = 2): never {
  console.error(`difora: ${message}`);
  process.exit(code);
}

function ciInfo(): CiInfo {
  return detectCi(process.env, {
    readFile: (p) => readFileSync(p, 'utf8'),
    git: (args) =>
      execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
  });
}

function parseArgs(argv: string[]): {
  command: 'upload' | 'doctor';
  opts: CliOptions;
} {
  const [command, ...rest] = argv;
  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    process.exit(0);
  }
  if (
    command === undefined ||
    command === '--help' ||
    command === '-h' ||
    command === 'help'
  ) {
    console.log(USAGE);
    process.exit(command === undefined ? 2 : 0);
  }
  if (command !== 'upload' && command !== 'doctor') {
    fail(`unknown command "${command}" — see difora --help`);
  }
  const ci = ciInfo();
  const opts: CliOptions = {
    dir: '',
    branch: ci.branch,
    prNumber: ci.prNumber,
    commitSha: ci.commit,
    commitMessage: ci.message,
    apiUrl: process.env['DIFORA_API_URL'] || 'https://app.difora.eu/api',
    token: process.env['DIFORA_TOKEN'] || '',
    wait: true,
    exitZeroOnChanges: false,
    timeoutSeconds: 300,
    concurrency: 4,
    json: false,
    postStatus: false,
    baseBranch: ci.baseBranch,
    noMergeBase: false,
  };
  let parallel = Boolean(process.env['DIFORA_SHARD'] || ci.parallelId);
  let shard = { shardIndex: ci.shardIndex, shardTotal: ci.shardTotal };
  let parallelId = '';
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = () => {
      const v = rest[++i];
      if (v === undefined) fail(`missing value for ${arg}`);
      return v;
    };
    if (arg === '--parallel') parallel = true;
    else if (arg === '--shard') {
      shard = parseShard(next());
      parallel = true;
    } else if (arg === '--parallel-id') {
      parallelId = next();
      parallel = true;
    } else if (arg === '--shard-timeout') {
      opts.shardTimeoutMinutes = positiveInt(arg, next());
      parallel = true;
    } else if (arg === '--branch') opts.branch = next();
    else if (arg === '--commit') opts.commitSha = next();
    else if (arg === '--base-branch') opts.baseBranch = next();
    else if (arg === '--base-commit') opts.baseCommit = next();
    else if (arg === '--no-merge-base') opts.noMergeBase = true;
    else if (arg === '--config') opts.config = next();
    else if (arg === '--pr') {
      opts.prNumber = parsePrNumber(next());
      if (!opts.prNumber) fail('--pr must be an integer from 1 to 2147483647');
    } else if (arg === '--message') opts.commitMessage = next();
    else if (arg === '--api-url') opts.apiUrl = next();
    else if (arg === '--token') opts.token = next();
    else if (arg === '--no-wait') opts.wait = false;
    else if (arg === '--exit-zero-on-changes') opts.exitZeroOnChanges = true;
    else if (arg === '--timeout')
      opts.timeoutSeconds = positiveInt(arg, next());
    else if (arg === '--concurrency')
      opts.concurrency = Math.min(16, positiveInt(arg, next()));
    else if (arg === '--json') opts.json = true;
    else if (arg === '--post-status') opts.postStatus = true;
    else if (arg.startsWith('-')) fail(`unknown option ${arg}`);
    else if (!opts.dir) opts.dir = arg;
    else fail(`unexpected argument ${arg}`);
  }
  opts.apiUrl = opts.apiUrl.replace(/\/$/, '');
  jsonMode = opts.json;
  if (parallel) {
    const { warning, ...options } = parallelOptions(
      ci,
      shard,
      parallelId,
      opts.commitSha,
    );
    Object.assign(opts, options);
    if (warning) log(`WARNING: ${warning}`);
    if (opts.shardTimeoutMinutes && opts.shardTimeoutMinutes > 1440)
      fail('--shard-timeout must be 1–1440 minutes');
  }
  if (command === 'upload') {
    if (!opts.dir)
      fail('missing screenshot directory — usage: difora upload <dir>');
    if (!opts.token)
      fail('missing project token (set DIFORA_TOKEN or pass --token)');
    if (!opts.branch) {
      fail(
        'could not detect the branch — pass --branch <name> or set DIFORA_BRANCH (run `difora doctor` to see what is detected)',
      );
    }
  }
  return { command, opts };
}

function positiveInt(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0)
    fail(`${flag} expects a positive integer`);
  return n;
}

interface ScreenshotFile {
  name: string;
  path: string;
  hash: string;
}

/** PNG files under `dir` (symlinks are skipped), named by their relative path without extension. */
function collectPngs(dir: string): ScreenshotFile[] {
  const results: ScreenshotFile[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.toLowerCase().endsWith('.png')) {
        const name = relative(dir, full)
          .split(sep)
          .join('/')
          .replace(/\.png$/i, '');
        const hash = createHash('sha256')
          .update(readFileSync(full))
          .digest('hex');
        results.push({ name, path: full, hash });
      }
    }
  };
  try {
    walk(dir);
  } catch (err) {
    fail(
      `cannot read ${dir}: ${String(err instanceof Error ? err.message : err)}`,
    );
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function extractMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) return parsed.message.join(', ');
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // not JSON
  }
  return text.slice(0, 300);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries network errors, 429 and 5xx with exponential back-off (honouring Retry-After). */
async function api<T>(
  opts: CliOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const isBuffer = body instanceof Uint8Array;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${opts.apiUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${opts.token}`,
          'content-type': isBuffer ? 'image/png' : 'application/json',
          'user-agent': `difora-cli/${VERSION}`,
        },
        body:
          body === undefined
            ? undefined
            : isBuffer
              ? new Uint8Array(body as Uint8Array)
              : JSON.stringify(body),
        signal: AbortSignal.timeout(isBuffer ? 120_000 : 30_000),
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS - 1) {
        throw new Error(
          `${method} ${path}: network error after ${MAX_ATTEMPTS} attempts (${String(err instanceof Error ? err.message : err)})`,
        );
      }
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      return (await res.json()) as T;
    }
    const text = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS - 1) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '');
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 60) * 1000
          : 1000 * 2 ** attempt;
      log(
        `${method} ${path} → ${res.status}, retrying in ${Math.round(delay / 1000)}s`,
      );
      await sleep(delay);
      continue;
    }
    throw new HttpError(
      res.status,
      `${method} ${path} failed (${res.status}): ${extractMessage(text)}`,
    );
  }
}

async function uploadMissing(
  opts: CliOptions,
  buildId: number,
  files: ScreenshotFile[],
): Promise<void> {
  const seen = new Set<string>();
  const queue = files.filter((f) =>
    seen.has(f.hash) ? false : (seen.add(f.hash), true),
  );
  let done = 0;
  const worker = async () => {
    for (;;) {
      const file = queue.shift();
      if (!file) return;
      await api(
        opts,
        'POST',
        `/ci/builds/${buildId}/images/${file.hash}`,
        readFileSync(file.path),
      );
      done++;
      if (done % 25 === 0) log(`uploaded ${done} images`);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, queue.length) }, worker),
  );
}

function describe(status: string): { state: StatusState; description: string } {
  switch (status) {
    case 'passed':
      return { state: 'success', description: 'No visual changes' };
    case 'approved':
      return { state: 'success', description: 'Visual changes approved' };
    case 'unreviewed':
      return { state: 'failure', description: 'Visual changes need review' };
    case 'rejected':
      return { state: 'failure', description: 'Visual changes rejected' };
    case 'processing':
    case 'uploading':
      return { state: 'pending', description: 'Comparing screenshots…' };
    default:
      return { state: 'failure', description: `Build ${status}` };
  }
}

async function safePostStatus(
  target: StatusTarget | null,
  status: string,
  url: string,
): Promise<void> {
  if (!target) return;
  const { state, description } = describe(status);
  try {
    await postCommitStatus(target, state, description, url);
    log(`posted ${state} status to ${target.provider}`);
  } catch (err) {
    log(
      `WARNING: could not post the commit status — ${String(err instanceof Error ? err.message : err)}`,
    );
  }
}

async function upload(opts: CliOptions): Promise<never> {
  const config = loadConfig(opts.dir, opts.config);
  const files = collectPngs(opts.dir);
  if (files.length === 0) {
    fail(`no .png files found under ${opts.dir}`);
  }
  log(
    `${files.length} screenshots in ${opts.dir} (branch ${opts.branch}${opts.commitSha ? `, commit ${opts.commitSha.slice(0, 8)}` : ''})`,
  );

  if (!opts.noMergeBase && !opts.baseBranch) {
    const project = await api<{ baselineBranch: string }>(
      opts,
      'GET',
      '/ci/project',
    );
    opts.baseBranch = project.baselineBranch;
  }
  const { warning, ...base } = mergeBase(opts.branch, opts.baseBranch, {
    disabled: opts.noMergeBase,
    baseCommit: opts.baseCommit,
    head: opts.commitSha,
  });
  if (warning) log(`WARNING: ${warning}`);
  const build = await api<{ buildId: number; number: number; url: string }>(
    opts,
    'POST',
    '/ci/builds',
    {
      ...base,
      branch: opts.branch,
      commitSha: opts.commitSha,
      commitMessage: opts.commitMessage,
      parallelId: opts.parallelId,
      shardIndex: opts.shardIndex,
      shardTotal: opts.shardTotal,
      shardTimeoutMinutes: opts.shardTimeoutMinutes,
      runAttempt: opts.runAttempt,
      prNumber: opts.prNumber,
    },
  );
  log(`build #${build.number} created`);
  const statusTarget = opts.postStatus
    ? detectStatusTarget(process.env, ciInfo(), opts.commitSha)
    : null;
  if (opts.postStatus && !statusTarget) {
    log(
      'WARNING: --post-status: no repository host / token detected, statuses are skipped (see `difora doctor`)',
    );
  }
  await safePostStatus(statusTarget, 'processing', build.url);

  const manifest = await api<{ missingHashes: string[] }>(
    opts,
    'POST',
    `/ci/builds/${build.buildId}/manifest`,
    {
      snapshots: files.map((f) => ({ name: f.name, hash: f.hash })),
      rules: config.rules,
      shardIndex: opts.shardIndex,
    },
  );
  const missing = new Set(manifest.missingHashes);
  const toUpload = files.filter((f) => missing.has(f.hash));
  log(
    `uploading ${toUpload.length} new images (${files.length - toUpload.length} already stored)`,
  );
  await uploadMissing(opts, build.buildId, toUpload);

  let status = await api<BuildStatus>(
    opts,
    'POST',
    `/ci/builds/${build.buildId}/finalize`,
    { shardIndex: opts.shardIndex },
  );
  if (opts.wait) {
    const deadline = Date.now() + opts.timeoutSeconds * 1000;
    while (!FINAL_STATUSES.includes(status.status) && Date.now() < deadline) {
      await sleep(2000);
      status = await api<BuildStatus>(
        opts,
        'GET',
        `/ci/builds/${build.buildId}/status`,
      );
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ ...status, number: build.number }, null, 2));
  }
  const final = FINAL_STATUSES.includes(status.status);
  if (final) {
    await safePostStatus(statusTarget, status.status, status.url);
  }
  log(`build ${status.status} — ${status.url}`);
  if (['passed', 'approved'].includes(status.status)) {
    process.exit(0);
  }
  if (status.status === 'unreviewed') {
    log('visual changes need review before this build passes.');
    process.exit(opts.exitZeroOnChanges ? 0 : 1);
  }
  if (!final) {
    if (!opts.wait) process.exit(0);
    log(
      `still ${status.status} after ${opts.timeoutSeconds}s — the comparison continues on the server; the review link above shows the result.`,
    );
    process.exit(3);
  }
  process.exit(1);
}

async function doctor(opts: CliOptions): Promise<never> {
  const ci = ciInfo();
  console.log(`difora ${VERSION}`);
  console.log(`CI provider:     ${ci.provider}`);
  console.log(
    `branch:          ${opts.branch || '(none — pass --branch or set DIFORA_BRANCH)'}`,
  );
  console.log(`commit:          ${opts.commitSha || '(none)'}`);
  console.log(`repository:      ${ci.repo || '(unknown)'}`);
  console.log(`pull request:    ${opts.prNumber ?? '(not detected)'}`);
  console.log(
    `CI run:          ${ci.runId || '(unknown)'} · attempt ${ci.runAttempt ?? '(not provided)'}`,
  );
  console.log(
    `parallel ID:     ${opts.parallelId || ci.parallelId || (ci.runId ? `${ci.provider}-${ci.runId}` : '(set --parallel-id)')}`,
  );
  console.log(
    `shard:           ${opts.shardIndex !== undefined ? `${opts.shardIndex + 1}/${opts.shardTotal}` : ci.shardIndex !== undefined ? `${ci.shardIndex + 1}/${ci.shardTotal} (use --parallel)` : '(set --shard i/n)'}`,
  );
  console.log(`API URL:         ${opts.apiUrl}`);
  console.log(
    `project token:   ${opts.token ? `set (${opts.token.slice(0, 6)}…)` : 'MISSING — set DIFORA_TOKEN'}`,
  );
  const target = detectStatusTarget(process.env, ci, opts.commitSha || 'HEAD');
  console.log(
    `--post-status:   ${target ? `would post to ${target.provider}` : 'no host/token detected (DIFORA_STATUS_TOKEN)'}`,
  );
  let ok = true;
  try {
    const res = await fetch(`${opts.apiUrl}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`API health:      ${res.status} ${res.ok ? 'OK' : 'not OK'}`);
    ok = res.ok;
  } catch (err) {
    console.log(
      `API health:      unreachable (${String(err instanceof Error ? err.message : err)})`,
    );
    ok = false;
  }
  if (opts.token && ok) {
    try {
      await api(opts, 'GET', '/ci/builds/0/status');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 0;
      // 404 = token accepted, build 0 does not exist; 401 = bad token.
      console.log(
        `project token:   ${status === 404 ? 'valid' : status === 401 ? 'REJECTED by the API' : `check failed (${status || 'network'})`}`,
      );
      if (status === 401) ok = false;
    }
  }
  process.exit(ok ? 0 : 2);
}

async function main(): Promise<void> {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (command === 'doctor') {
    await doctor(opts);
  }
  await upload(opts);
}

main().catch((err) => fail(String(err instanceof Error ? err.message : err)));
