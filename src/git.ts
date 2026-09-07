import { execFileSync } from 'child_process';
import { normalizeBranch } from './ci-env';

export type GitRunner = (args: string[]) => string;
export const runGit: GitRunner = (args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
  }).trim();

/** Read-only git queries. Never fetch or change the customer's checkout. */
export function mergeBase(
  branch: string,
  baseBranch: string,
  options: {
    disabled?: boolean;
    baseCommit?: string;
    head?: string;
    git?: GitRunner;
  } = {},
): { baseBranch?: string; baseCommit?: string; warning?: string } {
  const base = normalizeBranch(baseBranch);
  if (options.disabled || normalizeBranch(branch) === base) return {};
  if (!base || base.startsWith('-') || /[\s~^:?*[\\]/.test(base))
    throw new Error('Base branch must be a valid Git branch name');
  if (options.baseCommit !== undefined) {
    if (!/^[0-9a-f]{7,64}$/i.test(options.baseCommit))
      throw new Error('--base-commit must contain 7–64 hexadecimal characters');
    return { baseBranch: base, baseCommit: options.baseCommit };
  }
  const git = options.git ?? runGit;
  let shallow = false;
  try {
    shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    /* Not a checkout; report the fallback below. */
  }
  for (const ref of [`origin/${base}`, base]) {
    try {
      const sha = git(['merge-base', options.head || 'HEAD', ref]).trim();
      if (/^[0-9a-f]{7,64}$/i.test(sha))
        return {
          baseBranch: base,
          baseCommit: sha,
          ...(shallow
            ? {
                warning:
                  'Shallow checkout: merge-base may be incomplete. Use fetch-depth: 0 for reliable ancestry.',
              }
            : {}),
        };
    } catch {
      /* Try the local branch before falling back to current baselines. */
    }
  }
  return {
    baseBranch: base,
    warning: `Could not resolve merge-base with ${base}${shallow ? ' in this shallow checkout' : ''}. Use fetch-depth: 0 and fetch the base branch; comparing against current branch baselines.`,
  };
}
