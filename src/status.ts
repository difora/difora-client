/**
 * Posting the build result as a commit status from INSIDE the pipeline, with the CI's own
 * credentials. This is the path for repository hosts the Difora service cannot reach (self-hosted
 * GitLab behind a firewall) or where you would rather not hand Difora a token.
 */
import type { CiInfo } from './ci-env';

export type StatusState = 'pending' | 'success' | 'failure';

export interface StatusTarget {
  provider: 'github' | 'gitlab' | 'bitbucket';
  url: string;
  headers: Record<string, string>;
  body: (state: StatusState, description: string, targetUrl: string) => unknown;
  hint: string;
}

export function detectStatusTarget(
  env: NodeJS.ProcessEnv,
  ci: CiInfo,
  sha: string,
): StatusTarget | null {
  const token = env['DIFORA_STATUS_TOKEN'] ?? '';
  if (ci.provider === 'github' && ci.repo) {
    const auth = token || env['GITHUB_TOKEN'] || '';
    if (!auth) return null;
    return {
      provider: 'github',
      url: `${(env['GITHUB_API_URL'] || 'https://api.github.com').replace(/\/$/, '')}/repos/${ci.repo}/statuses/${sha}`,
      headers: {
        authorization: `Bearer ${auth}`,
        accept: 'application/vnd.github+json',
      },
      body: (state, description, target_url) => ({
        state,
        description,
        target_url,
        context: 'Difora',
      }),
      hint: 'GITHUB_TOKEN needs "statuses: write" (add `permissions: statuses: write` to the job).',
    };
  }
  if (
    ci.provider === 'gitlab' &&
    env['CI_API_V4_URL'] &&
    env['CI_PROJECT_ID']
  ) {
    const jobToken = env['CI_JOB_TOKEN'] ?? '';
    if (!token && !jobToken) return null;
    return {
      provider: 'gitlab',
      url: `${env['CI_API_V4_URL'].replace(/\/$/, '')}/projects/${env['CI_PROJECT_ID']}/statuses/${sha}`,
      headers: token ? { 'PRIVATE-TOKEN': token } : { 'JOB-TOKEN': jobToken },
      body: (state, description, target_url) => ({
        state: state === 'failure' ? 'failed' : state,
        name: 'Difora',
        description,
        target_url,
      }),
      hint: 'Set DIFORA_STATUS_TOKEN to a project access token with the "api" scope (the job token is not allowed to post commit statuses on every GitLab version).',
    };
  }
  if (ci.provider === 'bitbucket' && ci.repo && token) {
    return {
      provider: 'bitbucket',
      url: `https://api.bitbucket.org/2.0/repositories/${ci.repo}/commit/${sha}/statuses/build`,
      headers: { authorization: `Bearer ${token}` },
      body: (state, description, url) => ({
        state:
          state === 'pending'
            ? 'INPROGRESS'
            : state === 'success'
              ? 'SUCCESSFUL'
              : 'FAILED',
        key: 'difora',
        name: 'Difora',
        description,
        url,
      }),
      hint: 'Set DIFORA_STATUS_TOKEN to a repository access token with "repository:write" (secured pipeline variable).',
    };
  }
  return null;
}

export async function postCommitStatus(
  target: StatusTarget,
  state: StatusState,
  description: string,
  targetUrl: string,
): Promise<void> {
  const res = await fetch(target.url, {
    method: 'POST',
    headers: { ...target.headers, 'content-type': 'application/json' },
    body: JSON.stringify(target.body(state, description, targetUrl)),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(
      `${target.provider} status API answered ${res.status}: ${text}. ${target.hint}`,
    );
  }
}
