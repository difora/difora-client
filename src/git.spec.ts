import { mergeBase } from './git';

const SHA = 'b'.repeat(40);
describe('merge-base', () => {
  it('prefers the remote branch and accepts an explicit commit without git', () => {
    const git = jest.fn((args: string[]) =>
      args[0] === 'merge-base' ? SHA : 'false',
    );
    expect(mergeBase('topic', 'refs/heads/main', { git })).toEqual({
      baseBranch: 'main',
      baseCommit: SHA,
    });
    expect(git).toHaveBeenCalledWith(['merge-base', 'HEAD', 'origin/main']);
    git.mockClear();
    expect(mergeBase('topic', 'main', { git, baseCommit: 'aaaa111' })).toEqual({
      baseBranch: 'main',
      baseCommit: 'aaaa111',
    });
    expect(git).not.toHaveBeenCalled();
  });
  it('uses the detected source commit on synthetic PR merge checkouts', () => {
    const git = jest.fn((args: string[]) =>
      args[0] === 'merge-base' ? SHA : 'false',
    );
    mergeBase('topic', 'main', { git, head: 'c'.repeat(40) });
    expect(git).toHaveBeenCalledWith([
      'merge-base',
      'c'.repeat(40),
      'origin/main',
    ]);
  });
  it('tries the local branch when the remote ref is absent', () => {
    const git = jest.fn((args: string[]) => {
      if (args[2] === 'origin/main') throw new Error('unknown ref');
      return args[0] === 'merge-base' ? SHA : 'false';
    });
    expect(mergeBase('topic', 'main', { git }).baseCommit).toBe(SHA);
    expect(git).toHaveBeenCalledWith(['merge-base', 'HEAD', 'main']);
  });
  it('warns on shallow clones and missing history without inventing an anchor', () => {
    const git = (args: string[]) => {
      if (args[0] === 'rev-parse') return 'true';
      throw new Error('no ancestor');
    };
    expect(mergeBase('topic', 'main', { git })).toMatchObject({
      baseBranch: 'main',
      warning: expect.stringContaining('fetch-depth: 0'),
    });
    expect(mergeBase('topic', 'main', { git }).baseCommit).toBeUndefined();
  });
  it('skips the baseline branch and explicit opt-out without querying git', () => {
    const git = jest.fn();
    expect(mergeBase('origin/main', 'main', { git })).toEqual({});
    expect(mergeBase('topic', '', { git, disabled: true })).toEqual({});
    expect(git).not.toHaveBeenCalled();
  });
  it.each(['--help', 'main~1', 'main:secret', 'bad branch'])(
    'rejects unsafe base refs %s',
    (base) => {
      expect(() => mergeBase('topic', base)).toThrow('valid Git branch');
    },
  );
  it('rejects invalid explicit commits', () => {
    expect(() =>
      mergeBase('topic', 'main', { baseCommit: 'not-a-sha' }),
    ).toThrow('hexadecimal');
  });
});
