/**
 * Detects branch, commit and commit message from the CI environment. Every provider exposes
 * different variables; pull/merge-request builds must report the SOURCE branch and its head
 * commit (not the synthetic merge commit), otherwise the status never lands on the PR.
 */
export interface CiInfo {
  provider: string;
  branch: string;
  commit: string;
  message: string;
  /** "owner/repo", "group/project" or "workspace/slug" when the provider tells us. */
  repo: string;
  baseBranch: string;
  runId: string;
  runAttempt?: number;
  shardIndex?: number;
  shardTotal?: number;
  parallelId: string;
  prNumber?: number;
}

export interface DetectOptions {
  /** Reads a file (used for the GitHub Actions event payload). */
  readFile?: (path: string) => string;
  /** Runs `git` with the given args and returns stdout (plain checkout fallback). */
  git?: (args: string[]) => string;
}

/** Strips the ref prefixes CI systems tend to pass ("refs/heads/main", "origin/main"). */
export function normalizeBranch(input: string): string {
  return input
    .trim()
    .replace(/^refs\/(heads|tags)\//, '')
    .replace(/^origin\//, '')
    .slice(0, 200);
}

const SHA_RE = /^[0-9a-f]{7,64}$/i;

function sha(value: string | undefined): string {
  const v = (value ?? '').trim();
  return SHA_RE.test(v) ? v : '';
}

function githubPrHeadSha(
  env: NodeJS.ProcessEnv,
  readFile?: (p: string) => string,
): string {
  const event = env['GITHUB_EVENT_NAME'] ?? '';
  const path = env['GITHUB_EVENT_PATH'] ?? '';
  if (!/^pull_request(_target)?$/.test(event) || !path || !readFile) {
    return '';
  }
  try {
    const payload = JSON.parse(readFile(path)) as {
      pull_request?: { head?: { sha?: string } };
    };
    return sha(payload.pull_request?.head?.sha);
  } catch {
    return '';
  }
}

export function detectCi(
  env: NodeJS.ProcessEnv = process.env,
  options: DetectOptions = {},
): CiInfo {
  const detected = detectProvider(env, options);
  const info: CiInfo = {
    ...detected,
    prNumber: detectPrNumber(env, options),
    baseBranch: normalizeBranch(
      env['DIFORA_BASE_BRANCH'] ||
        env['GITHUB_BASE_REF'] ||
        env['CI_MERGE_REQUEST_TARGET_BRANCH_NAME'] ||
        env['BITBUCKET_PR_DESTINATION_BRANCH'] ||
        env['SYSTEM_PULLREQUEST_TARGETBRANCH'] ||
        env['CHANGE_TARGET'] ||
        '',
    ),
    ...detectParallel(env, detected.provider),
  };
  // Explicit overrides always win (also the escape hatch for unknown CI systems).
  if (env['DIFORA_BRANCH']) info.branch = env['DIFORA_BRANCH'];
  if (env['DIFORA_COMMIT']) info.commit = env['DIFORA_COMMIT'];
  if (env['DIFORA_COMMIT_MESSAGE']) info.message = env['DIFORA_COMMIT_MESSAGE'];
  info.branch = normalizeBranch(info.branch);
  info.commit = sha(info.commit);
  info.message = (info.message ?? '').trim().slice(0, 500);
  return info;
}

export function parsePrNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (!/^[1-9]\d*$/.test(String(value))) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= 2147483647 ? n : undefined;
}

function detectPrNumber(
  env: NodeJS.ProcessEnv,
  options: DetectOptions,
): number | undefined {
  if (env['DIFORA_PR_NUMBER'] !== undefined) {
    const n = parsePrNumber(env['DIFORA_PR_NUMBER']);
    if (!n)
      throw new Error(
        'DIFORA_PR_NUMBER must be an integer from 1 to 2147483647',
      );
    return n;
  }
  if (
    /^pull_request(_target)?$/.test(env['GITHUB_EVENT_NAME'] ?? '') &&
    env['GITHUB_EVENT_PATH'] &&
    options.readFile
  ) {
    try {
      const event = JSON.parse(options.readFile(env['GITHUB_EVENT_PATH']));
      if (event.pull_request) {
        const n = parsePrNumber(event.pull_request.number ?? event.number);
        if (n) return n;
      }
    } catch {
      /* Malformed/missing event: try the documented ref and provider variables. */
    }
  }
  const ref = /^refs\/pull\/([1-9]\d*)\/(?:merge|head)$/.exec(
    env['GITHUB_REF'] ?? '',
  );
  if (ref) return parsePrNumber(ref[1]);
  for (const key of [
    'CI_MERGE_REQUEST_IID',
    'BITBUCKET_PR_ID',
    'SYSTEM_PULLREQUEST_PULLREQUESTNUMBER',
    'SYSTEM_PULLREQUEST_PULLREQUESTID',
    'CHANGE_ID',
    'TRAVIS_PULL_REQUEST',
    'DRONE_PULL_REQUEST',
    'BUILDKITE_PULL_REQUEST',
  ]) {
    const n = parsePrNumber(env[key]);
    if (n) return n;
  }
  return undefined;
}

function detectProvider(
  env: NodeJS.ProcessEnv,
  options: DetectOptions,
): Pick<CiInfo, 'provider' | 'branch' | 'commit' | 'message' | 'repo'> {
  if (env['GITHUB_ACTIONS'] === 'true') {
    return {
      provider: 'github',
      branch: env['GITHUB_HEAD_REF'] || env['GITHUB_REF_NAME'] || '',
      commit: githubPrHeadSha(env, options.readFile) || env['GITHUB_SHA'] || '',
      message: '',
      repo: env['GITHUB_REPOSITORY'] ?? '',
    };
  }
  if (env['GITLAB_CI'] === 'true') {
    return {
      provider: 'gitlab',
      branch:
        env['CI_MERGE_REQUEST_SOURCE_BRANCH_NAME'] ||
        env['CI_COMMIT_REF_NAME'] ||
        '',
      commit:
        env['CI_MERGE_REQUEST_SOURCE_BRANCH_SHA'] || env['CI_COMMIT_SHA'] || '',
      message: env['CI_COMMIT_TITLE'] ?? '',
      repo: env['CI_PROJECT_PATH'] ?? '',
    };
  }
  if (env['BITBUCKET_BUILD_NUMBER']) {
    return {
      provider: 'bitbucket',
      branch: env['BITBUCKET_BRANCH'] || env['BITBUCKET_TAG'] || '',
      commit: env['BITBUCKET_COMMIT'] ?? '',
      message: '',
      repo:
        env['BITBUCKET_WORKSPACE'] && env['BITBUCKET_REPO_SLUG']
          ? `${env['BITBUCKET_WORKSPACE']}/${env['BITBUCKET_REPO_SLUG']}`
          : '',
    };
  }
  if (env['CIRCLECI'] === 'true') {
    return {
      provider: 'circleci',
      branch: env['CIRCLE_BRANCH'] || env['CIRCLE_TAG'] || '',
      commit: env['CIRCLE_SHA1'] ?? '',
      message: '',
      repo:
        env['CIRCLE_PROJECT_USERNAME'] && env['CIRCLE_PROJECT_REPONAME']
          ? `${env['CIRCLE_PROJECT_USERNAME']}/${env['CIRCLE_PROJECT_REPONAME']}`
          : '',
    };
  }
  if (env['TF_BUILD'] === 'True' || env['TF_BUILD'] === 'true') {
    // Azure: BUILD_SOURCEBRANCH carries refs/heads/…; BUILD_SOURCEBRANCHNAME is only the last path
    // segment ("feature" for "feature/x") and must never be used.
    return {
      provider: 'azure',
      branch:
        env['SYSTEM_PULLREQUEST_SOURCEBRANCH'] ||
        env['BUILD_SOURCEBRANCH'] ||
        '',
      commit:
        env['SYSTEM_PULLREQUEST_SOURCECOMMITID'] ||
        env['BUILD_SOURCEVERSION'] ||
        '',
      message: env['BUILD_SOURCEVERSIONMESSAGE'] ?? '',
      repo: env['BUILD_REPOSITORY_NAME'] ?? '',
    };
  }
  if (env['JENKINS_URL']) {
    return {
      provider: 'jenkins',
      branch:
        env['CHANGE_BRANCH'] || env['BRANCH_NAME'] || env['GIT_BRANCH'] || '',
      commit: env['GIT_COMMIT'] ?? '',
      message: '',
      repo: '',
    };
  }
  if (env['TRAVIS'] === 'true') {
    return {
      provider: 'travis',
      branch: env['TRAVIS_PULL_REQUEST_BRANCH'] || env['TRAVIS_BRANCH'] || '',
      commit: env['TRAVIS_PULL_REQUEST_SHA'] || env['TRAVIS_COMMIT'] || '',
      message: env['TRAVIS_COMMIT_MESSAGE'] ?? '',
      repo: env['TRAVIS_REPO_SLUG'] ?? '',
    };
  }
  if (env['BUILDKITE'] === 'true') {
    return {
      provider: 'buildkite',
      branch: env['BUILDKITE_BRANCH'] ?? '',
      commit: env['BUILDKITE_COMMIT'] ?? '',
      message: env['BUILDKITE_MESSAGE'] ?? '',
      repo: '',
    };
  }
  if (env['DRONE'] === 'true') {
    return {
      provider: 'drone',
      branch: env['DRONE_SOURCE_BRANCH'] || env['DRONE_BRANCH'] || '',
      commit: env['DRONE_COMMIT_SHA'] ?? '',
      message: env['DRONE_COMMIT_MESSAGE'] ?? '',
      repo: env['DRONE_REPO'] ?? '',
    };
  }
  // Plain checkout (local run, unknown CI): ask git. A detached HEAD yields no branch.
  const git = options.git;
  if (git) {
    try {
      const ref = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
      return {
        provider: 'git',
        branch: ref === 'HEAD' ? '' : ref,
        commit: git(['rev-parse', 'HEAD']).trim(),
        message: git(['log', '-1', '--pretty=%s']).trim(),
        repo: '',
      };
    } catch {
      // not a git checkout
    }
  }
  return { provider: 'unknown', branch: '', commit: '', message: '', repo: '' };
}

/** CLI/env shard notation is one-based; the API always receives a zero-based index. */
export function parseShard(value: string): {
  shardIndex: number;
  shardTotal: number;
} {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  if (!match || Number(match[1]) > Number(match[2]) || Number(match[2]) > 256)
    throw new Error('Shard must be i/n with 1 <= i <= n <= 256');
  return { shardIndex: Number(match[1]) - 1, shardTotal: Number(match[2]) };
}
function int(value: string | undefined, minimum: number): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= minimum ? n : undefined;
}
function detectParallel(
  env: NodeJS.ProcessEnv,
  provider: string,
): Pick<
  CiInfo,
  'runId' | 'runAttempt' | 'shardIndex' | 'shardTotal' | 'parallelId'
> {
  const vars: Record<string, [string, string?, string?, number?]> = {
    github: ['GITHUB_RUN_ID'],
    gitlab: ['CI_PIPELINE_ID', 'CI_NODE_INDEX', 'CI_NODE_TOTAL', 1],
    bitbucket: [
      'BITBUCKET_BUILD_NUMBER',
      'BITBUCKET_PARALLEL_STEP',
      'BITBUCKET_PARALLEL_STEP_COUNT',
      0,
    ],
    circleci: [
      'CIRCLE_WORKFLOW_ID',
      'CIRCLE_NODE_INDEX',
      'CIRCLE_NODE_TOTAL',
      0,
    ],
    azure: [
      'BUILD_BUILDID',
      'SYSTEM_JOBPOSITIONINPHASE',
      'SYSTEM_TOTALJOBSINPHASE',
      1,
    ],
    jenkins: ['BUILD_TAG'],
    travis: ['TRAVIS_BUILD_ID'],
    buildkite: [
      'BUILDKITE_BUILD_ID',
      'BUILDKITE_PARALLEL_JOB',
      'BUILDKITE_PARALLEL_JOB_COUNT',
      0,
    ],
    drone: ['DRONE_BUILD_NUMBER'],
  };
  const [run, index, total, offset = 0] = vars[provider] ?? [''];
  const rawIndex = int(index ? env[index] : undefined, offset);
  const info = {
    runId: env[run] ?? '',
    runAttempt:
      provider === 'github' ? int(env['GITHUB_RUN_ATTEMPT'], 1) : undefined,
    shardIndex: rawIndex === undefined ? undefined : rawIndex - offset,
    shardTotal: int(total ? env[total] : undefined, 1),
    parallelId: env['DIFORA_PARALLEL_ID'] || env['PERCY_PARALLEL_NONCE'] || '',
  };
  if (env['PERCY_PARALLEL_TOTAL'])
    info.shardTotal = int(env['PERCY_PARALLEL_TOTAL'], 1);
  if (env['DIFORA_SHARD']) Object.assign(info, parseShard(env['DIFORA_SHARD']));
  return info;
}

export function parallelOptions(
  ci: CiInfo,
  shard: { shardIndex?: number; shardTotal?: number },
  parallelId: string,
  commit: string,
): {
  parallelId: string;
  shardIndex: number;
  shardTotal: number;
  runAttempt?: number;
  warning?: string;
} {
  const total = shard.shardTotal;
  const index = shard.shardIndex ?? (total === 1 ? 0 : undefined);
  if (
    total === undefined ||
    index === undefined ||
    !Number.isInteger(total) ||
    total < 1 ||
    total > 256 ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= total
  )
    throw new Error(
      'Parallel upload requires --shard i/n, DIFORA_SHARD or valid CI shard variables',
    );
  const id =
    parallelId ||
    ci.parallelId ||
    (ci.runId
      ? `${ci.provider}-${ci.runId}`
      : commit
        ? `commit-${commit}`
        : '');
  if (!id.trim() || id.length > 200)
    throw new Error(
      'Parallel upload requires --parallel-id (1–200 characters) or a detected run ID/commit',
    );
  return {
    parallelId: id,
    shardIndex: index,
    shardTotal: total,
    runAttempt: ci.runAttempt,
    ...(!parallelId && !ci.parallelId && !ci.runId
      ? {
          warning:
            'Using commit SHA as parallel ID; set --parallel-id to distinguish separate pipeline runs of the same commit.',
        }
      : {}),
  };
}
