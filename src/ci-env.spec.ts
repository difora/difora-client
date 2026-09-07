import { detectCi, normalizeBranch, parsePrNumber } from './ci-env';

const SHA = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

describe('pull request number detection', () => {
  it.each([
    'CI_MERGE_REQUEST_IID',
    'BITBUCKET_PR_ID',
    'SYSTEM_PULLREQUEST_PULLREQUESTNUMBER',
    'SYSTEM_PULLREQUEST_PULLREQUESTID',
    'CHANGE_ID',
    'TRAVIS_PULL_REQUEST',
    'DRONE_PULL_REQUEST',
    'BUILDKITE_PULL_REQUEST',
  ])('reads %s', (key) => {
    expect(detectCi({ [key]: '42' }).prNumber).toBe(42);
    expect(detectCi({ [key]: 'false' }).prNumber).toBeUndefined();
  });
  it('uses PR event data then refs, with explicit override first', () => {
    const env = {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: '/tmp/event.json',
      GITHUB_REF: 'refs/pull/12/merge',
    };
    const readFile = () =>
      JSON.stringify({ number: 15, pull_request: { number: 15 } });
    expect(detectCi(env, { readFile }).prNumber).toBe(15);
    expect(detectCi(env, { readFile: () => 'invalid' }).prNumber).toBe(12);
    expect(
      detectCi({ ...env, DIFORA_PR_NUMBER: '20' }, { readFile }).prNumber,
    ).toBe(20);
    expect(detectCi({ GITHUB_REF: 'refs/pull/12/head' }).prNumber).toBe(12);
    expect(
      detectCi(
        { GITHUB_EVENT_NAME: 'issues', GITHUB_EVENT_PATH: '/tmp/event.json' },
        { readFile: () => '{"number":9}' },
      ).prNumber,
    ).toBeUndefined();
  });
  it('rejects invalid explicit values and bounds automatic values', () => {
    for (const value of ['', '0', '-1', '1.5', '2147483648', 'foo', ' 12']) {
      expect(parsePrNumber(value)).toBeUndefined();
      expect(() => detectCi({ DIFORA_PR_NUMBER: value })).toThrow(
        'DIFORA_PR_NUMBER',
      );
    }
    expect(parsePrNumber(2147483647)).toBe(2147483647);
  });
});

describe('detectCi', () => {
  it('GitHub Actions: pull request uses the PR head sha, not the merge commit', () => {
    const info = detectCi(
      {
        GITHUB_ACTIONS: 'true',
        GITHUB_HEAD_REF: 'feature/x',
        GITHUB_REF_NAME: '12/merge',
        GITHUB_SHA: SHA,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: '/tmp/event.json',
        GITHUB_REPOSITORY: 'acme/web',
      },
      {
        readFile: () =>
          JSON.stringify({ pull_request: { head: { sha: HEAD } } }),
      },
    );
    expect(info).toMatchObject({
      provider: 'github',
      branch: 'feature/x',
      commit: HEAD,
      repo: 'acme/web',
    });
  });

  it('GitHub Actions: push builds use GITHUB_REF_NAME and GITHUB_SHA', () => {
    const info = detectCi({
      GITHUB_ACTIONS: 'true',
      GITHUB_REF_NAME: 'main',
      GITHUB_SHA: SHA,
      GITHUB_EVENT_NAME: 'push',
    });
    expect(info.branch).toBe('main');
    expect(info.commit).toBe(SHA);
  });

  it('GitLab CI: merge requests report the source branch and its sha', () => {
    const info = detectCi({
      GITLAB_CI: 'true',
      CI_COMMIT_REF_NAME: 'refs/merge-requests/7/head',
      CI_COMMIT_SHA: SHA,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'fix/login',
      CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: HEAD,
      CI_COMMIT_TITLE: 'Fix login',
      CI_PROJECT_PATH: 'acme/web',
    });
    expect(info).toMatchObject({
      provider: 'gitlab',
      branch: 'fix/login',
      commit: HEAD,
      message: 'Fix login',
      repo: 'acme/web',
    });
  });

  it('Bitbucket Pipelines', () => {
    const info = detectCi({
      BITBUCKET_BUILD_NUMBER: '42',
      BITBUCKET_BRANCH: 'develop',
      BITBUCKET_COMMIT: SHA,
      BITBUCKET_WORKSPACE: 'acme',
      BITBUCKET_REPO_SLUG: 'web',
    });
    expect(info).toMatchObject({
      provider: 'bitbucket',
      branch: 'develop',
      commit: SHA,
      repo: 'acme/web',
    });
  });

  it('Azure DevOps: strips refs/heads/ and prefers the PR source branch', () => {
    const info = detectCi({
      TF_BUILD: 'True',
      BUILD_SOURCEBRANCH: 'refs/heads/main',
      BUILD_SOURCEBRANCHNAME: 'main',
      BUILD_SOURCEVERSION: SHA,
      SYSTEM_PULLREQUEST_SOURCEBRANCH: 'refs/heads/feature/deep/path',
      SYSTEM_PULLREQUEST_SOURCECOMMITID: HEAD,
    });
    expect(info.branch).toBe('feature/deep/path');
    expect(info.commit).toBe(HEAD);
  });

  it('Jenkins multibranch uses CHANGE_BRANCH for PRs and strips origin/', () => {
    expect(
      detectCi({
        JENKINS_URL: 'http://j',
        GIT_BRANCH: 'origin/main',
        GIT_COMMIT: SHA,
      }).branch,
    ).toBe('main');
    expect(
      detectCi({
        JENKINS_URL: 'http://j',
        CHANGE_BRANCH: 'feature/y',
        BRANCH_NAME: 'PR-3',
        GIT_COMMIT: SHA,
      }).branch,
    ).toBe('feature/y');
  });

  it('DIFORA_BRANCH / DIFORA_COMMIT override whatever the CI says', () => {
    const info = detectCi({
      GITHUB_ACTIONS: 'true',
      GITHUB_REF_NAME: 'main',
      GITHUB_SHA: SHA,
      DIFORA_BRANCH: 'release/1.2',
      DIFORA_COMMIT: HEAD,
    });
    expect(info.branch).toBe('release/1.2');
    expect(info.commit).toBe(HEAD);
  });

  it('falls back to git; a detached HEAD gives no branch', () => {
    const answers: Record<string, string> = {
      'rev-parse --abbrev-ref HEAD': 'topic\n',
      'rev-parse HEAD': `${SHA}\n`,
      'log -1 --pretty=%s': 'msg\n',
    };
    const git = (args: string[]) => answers[args.join(' ')] ?? '';
    expect(detectCi({}, { git })).toMatchObject({
      provider: 'git',
      branch: 'topic',
      commit: SHA,
      message: 'msg',
    });
    answers['rev-parse --abbrev-ref HEAD'] = 'HEAD\n';
    expect(detectCi({}, { git }).branch).toBe('');
  });

  it('rejects garbage commit values instead of passing them on', () => {
    expect(detectCi({ DIFORA_COMMIT: 'not-a-sha' }).commit).toBe('');
  });
});

describe('normalizeBranch', () => {
  it('strips ref and remote prefixes', () => {
    expect(normalizeBranch('refs/heads/main')).toBe('main');
    expect(normalizeBranch('refs/tags/v1')).toBe('v1');
    expect(normalizeBranch(' origin/feature/x ')).toBe('feature/x');
    expect(normalizeBranch('main')).toBe('main');
  });
});

describe('parallel CI metadata', () => {
  it.each([
    [
      { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '2' },
      'github',
      '99',
      undefined,
      undefined,
      2,
    ],
    [
      {
        GITLAB_CI: 'true',
        CI_PIPELINE_ID: '99',
        CI_NODE_INDEX: '1',
        CI_NODE_TOTAL: '4',
      },
      'gitlab',
      '99',
      0,
      4,
      undefined,
    ],
    [
      {
        BITBUCKET_BUILD_NUMBER: '99',
        BITBUCKET_PARALLEL_STEP: '0',
        BITBUCKET_PARALLEL_STEP_COUNT: '4',
      },
      'bitbucket',
      '99',
      0,
      4,
      undefined,
    ],
    [
      {
        CIRCLECI: 'true',
        CIRCLE_WORKFLOW_ID: '99',
        CIRCLE_NODE_INDEX: '3',
        CIRCLE_NODE_TOTAL: '4',
      },
      'circleci',
      '99',
      3,
      4,
      undefined,
    ],
    [
      {
        TF_BUILD: 'True',
        BUILD_BUILDID: '99',
        SYSTEM_JOBPOSITIONINPHASE: '1',
        SYSTEM_TOTALJOBSINPHASE: '4',
      },
      'azure',
      '99',
      0,
      4,
      undefined,
    ],
    [
      { JENKINS_URL: 'https://ci.example.test', BUILD_TAG: '99' },
      'jenkins',
      '99',
      undefined,
      undefined,
      undefined,
    ],
    [
      { TRAVIS: 'true', TRAVIS_BUILD_ID: '99' },
      'travis',
      '99',
      undefined,
      undefined,
      undefined,
    ],
    [
      {
        BUILDKITE: 'true',
        BUILDKITE_BUILD_ID: '99',
        BUILDKITE_PARALLEL_JOB: '3',
        BUILDKITE_PARALLEL_JOB_COUNT: '4',
      },
      'buildkite',
      '99',
      3,
      4,
      undefined,
    ],
    [
      { DRONE: 'true', DRONE_BUILD_NUMBER: '99' },
      'drone',
      '99',
      undefined,
      undefined,
      undefined,
    ],
  ])(
    'normalizes provider identity and zero-based indices: %j',
    (env, provider, runId, shardIndex, shardTotal, runAttempt) => {
      expect(detectCi(env as NodeJS.ProcessEnv)).toMatchObject({
        provider,
        runId,
        shardIndex,
        shardTotal,
        runAttempt,
      });
    },
  );
  it('respects Difora overrides before Percy aliases and provider values', () => {
    expect(
      detectCi({
        GITLAB_CI: 'true',
        CI_NODE_INDEX: '1',
        CI_NODE_TOTAL: '4',
        PERCY_PARALLEL_NONCE: 'percy',
        PERCY_PARALLEL_TOTAL: '6',
      }),
    ).toMatchObject({ parallelId: 'percy', shardIndex: 0, shardTotal: 6 });
    expect(
      detectCi({
        DIFORA_PARALLEL_ID: 'difora',
        DIFORA_SHARD: '2/3',
        PERCY_PARALLEL_NONCE: 'percy',
        PERCY_PARALLEL_TOTAL: '6',
      }),
    ).toMatchObject({ parallelId: 'difora', shardIndex: 1, shardTotal: 3 });
  });
});

describe('base branch detection', () => {
  it.each([
    'GITHUB_BASE_REF',
    'CI_MERGE_REQUEST_TARGET_BRANCH_NAME',
    'BITBUCKET_PR_DESTINATION_BRANCH',
    'SYSTEM_PULLREQUEST_TARGETBRANCH',
    'CHANGE_TARGET',
  ])('reads %s and lets DIFORA_BASE_BRANCH override it', (key) => {
    expect(detectCi({ [key]: 'refs/heads/release' }).baseBranch).toBe(
      'release',
    );
    expect(
      detectCi({ [key]: 'main', DIFORA_BASE_BRANCH: 'origin/custom' })
        .baseBranch,
    ).toBe('custom');
  });
});
